// Best Buy credit card agent: logs into Citi Retail Services (the Best Buy
// card's issuer) via a browser-use cloud agent and populates whatever fields
// the "Best Buy" account's category defines in Firestore.
//
// Unlike the DMV/GEICO agents (which write to their own bespoke
// licenseStatus/insuranceStatus docs with a fixed shape), this is the first
// agent for an account in the new category system: it looks up the account
// by name, reads its category's field list at runtime, builds the task
// prompt from those field labels, and writes results into
// users/{uid}/accountReports/{accountId}.values keyed by the category's
// actual field ids — the same "latest known state" doc DARScreen.js reads.
//
// Reuses a persistent browser-use profile (BESTBUY_PROFILE_ID, already past
// Citi's login/verification once via the browser-use dashboard) so runs
// don't need to re-clear that every time. Login credentials are passed as
// secretBindings so the raw values never appear in the task prompt/logs,
// only the aliases do.
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const cors = require('cors')({ origin: true });
const { admin, db, requireUser } = require('../lib/common');
const {
  createBrowserUseRun, pollBrowserUseRunOnce, runBrowserUseTaskToCompletion,
  withSelfAssessment, extractSelfAssessment,
} = require('../lib/browserUseClient');

const BESTBUY_USERNAME    = defineSecret('BESTBUY_USERNAME');
const BESTBUY_PASSWORD    = defineSecret('BESTBUY_PASSWORD');
const BROWSER_USE_API_KEY = defineSecret('BROWSER_USE_API_KEY');
const BESTBUY_LOGIN_URL = 'https://citiretailservices.citibankonline.com/RSauth/signon?pageName=signon&siteId=PLCN_BESTBUY&langId=en_US';
const BESTBUY_PROFILE_ID = '5ea4cfe1-5091-4a10-8381-56291d7556c8'; // "Best Buy Credit Card" profile in browser-use cloud
const BESTBUY_BROWSER_SETTINGS = { profileId: BESTBUY_PROFILE_ID };
const BESTBUY_ACCOUNT_NAME = 'Best Buy'; // must match the account name created in the Accounts screen

function buildBestBuyTask(fields) {
  const fieldList = fields
    .map(f => `- ${f.label} — return as JSON key "${f.id}"${f.type === 'date' ? ' (ISO date YYYY-MM-DD)' : ''}`)
    .join('\n');
  const shapeEntries = fields.map(f => `"${f.id}": ${f.type === 'text' ? '""' : 'null'}`).join(', ');
  return (
    `Go to ${BESTBUY_LOGIN_URL}. If you land on the account page already signed in (this browser profile ` +
    `may already have an active session), skip straight to the next step. Otherwise log in by typing ` +
    `bestbuy_username into the username field and bestbuy_password into the password field, then submit. ` +
    `If a two-factor/verification step appears that you cannot complete automatically, stop and report that ` +
    `in your final answer rather than guessing. ` +
    `Once on the account page, find the following information:\n${fieldList}\n` +
    `Do NOT make any payments or changes to the account — this is read-only. ` +
    `Return ONLY a JSON object as your final answer, shaped like {${shapeEntries}}. Set any field to null if ` +
    `it can't be found.`
  );
}

function bestBuySecretBindings(username, password) {
  return [
    { alias: 'bestbuy_username', source: { type: 'inline', value: username }, allowedDomains: ['citiretailservices.citibankonline.com', 'citibankonline.com'] },
    { alias: 'bestbuy_password', source: { type: 'inline', value: password }, allowedDomains: ['citiretailservices.citibankonline.com', 'citibankonline.com'] },
  ];
}

function parseBestBuyResult(resultText, fields) {
  const values = {};
  try {
    const parsed = JSON.parse(resultText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      fields.forEach(f => { values[f.id] = parsed[f.id] ?? null; });
      return { values, ...extractSelfAssessment(parsed) };
    }
  } catch {
    // fall through
  }
  fields.forEach(f => { values[f.id] = null; });
  return { values, success: false, summary: 'Agent did not return valid JSON.' };
}

// Finds the Best Buy account and its category's field list. Throws with a
// clear message (surfaced to the "failed" report doc) if the account or its
// category isn't set up yet.
async function findBestBuyAccountAndFields(uid) {
  const accountsSnap = await db.collection('users').doc(uid).collection('accounts')
    .where('name', '==', BESTBUY_ACCOUNT_NAME).limit(1).get();
  if (accountsSnap.empty) {
    throw new Error(`No account named "${BESTBUY_ACCOUNT_NAME}" found. Create it on the Accounts screen first.`);
  }
  const accountDoc = accountsSnap.docs[0];
  const account = accountDoc.data();
  if (!account.categoryId) {
    throw new Error(`"${BESTBUY_ACCOUNT_NAME}" has no category assigned yet.`);
  }
  const categorySnap = await db.collection('users').doc(uid).collection('categories').doc(account.categoryId).get();
  const fields = categorySnap.exists ? (categorySnap.data().fields || []) : [];
  if (fields.length === 0) {
    throw new Error(`The category assigned to "${BESTBUY_ACCOUNT_NAME}" has no fields defined yet.`);
  }
  return { accountId: accountDoc.id, fields };
}

// Used by the scheduled 7am job, which has no button/spinner waiting on it so
// it's fine to block until the run finishes.
async function checkAndStoreBestBuy(uid, apiKey, username, password) {
  const { accountId, fields } = await findBestBuyAccountAndFields(uid);
  const docRef = db.collection('users').doc(uid).collection('accountReports').doc(accountId);
  const secretBindings = bestBuySecretBindings(username, password);
  const prompt = withSelfAssessment(buildBestBuyTask(fields));
  try {
    const { resultText, durationMinutes } = await runBrowserUseTaskToCompletion(
      apiKey, prompt, secretBindings, 10 * 60 * 1000, BESTBUY_BROWSER_SETTINGS
    );
    const { values, success, summary } = parseBestBuyResult(resultText, fields);
    await docRef.set({
      accountId, values, success, summary, prompt, rawResult: resultText, status: 'completed', error: null, durationMinutes,
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { accountId, values, status: 'completed' };
  } catch (err) {
    await docRef.set({
      accountId, values: {}, success: false, summary: null, prompt, rawResult: null, durationMinutes: err.durationMinutes ?? null,
      status: 'failed', error: err.message,
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    throw err;
  }
}

// ── checkBestBuyStatus ───────────────────────────────────────────────────────
// Called by a "Check Now" trigger. Only starts the run and returns right
// away — the login can take longer than an HTTP request should block for, so
// the client polls pollBestBuyStatus for the outcome.
exports.checkBestBuyStatus = onRequest(
  { secrets: [BESTBUY_USERNAME, BESTBUY_PASSWORD, BROWSER_USE_API_KEY], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const { accountId, fields } = await findBestBuyAccountAndFields(uid);
        const secretBindings = bestBuySecretBindings(BESTBUY_USERNAME.value(), BESTBUY_PASSWORD.value());
        const prompt = withSelfAssessment(buildBestBuyTask(fields));
        const runId = await createBrowserUseRun(
          BROWSER_USE_API_KEY.value(), prompt, secretBindings, BESTBUY_BROWSER_SETTINGS
        );
        await db.collection('users').doc(uid).collection('accountReports').doc(accountId).set({
          accountId, runId, prompt, rawResult: null, status: 'running', durationMinutes: null, values: {}, success: null, summary: null, error: null,
          checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.json({ runId, accountId, status: 'running' });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('checkBestBuyStatus error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── pollBestBuyStatus ────────────────────────────────────────────────────────
// Called repeatedly while a check is running. Advances the run by one status
// check and, once terminal, writes the final field values.
exports.pollBestBuyStatus = onRequest(
  { secrets: [BROWSER_USE_API_KEY], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const runId = req.query.runId || req.body?.runId;
        if (!runId) {
          const err = new Error('Missing runId');
          err.statusCode = 400;
          throw err;
        }
        const { accountId, fields } = await findBestBuyAccountAndFields(uid);
        const docRef = db.collection('users').doc(uid).collection('accountReports').doc(accountId);
        const result = await pollBrowserUseRunOnce(BROWSER_USE_API_KEY.value(), runId);
        if (!result.done) return res.json({ status: 'running' });

        if (!result.ok) {
          await docRef.set({
            accountId, values: {}, success: false, summary: null, rawResult: null,
            status: 'failed', error: result.error, durationMinutes: result.durationMinutes,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          return res.json({ status: 'failed', error: result.error });
        }

        const { values, success, summary } = parseBestBuyResult(result.resultText, fields);
        await docRef.set({
          accountId, values, success, summary, rawResult: result.resultText, status: 'completed', error: null, durationMinutes: result.durationMinutes,
          checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ status: 'completed', accountId, values });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('pollBestBuyStatus error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── checkBestBuyStatusScheduled ──────────────────────────────────────────────
// Refreshes the Best Buy card's fields every morning at 7:10am ET.
exports.checkBestBuyStatusScheduled = onSchedule(
  {
    schedule: '10 7 * * *',
    timeZone: 'America/New_York',
    secrets: [BESTBUY_USERNAME, BESTBUY_PASSWORD, BROWSER_USE_API_KEY],
    timeoutSeconds: 900,
  },
  async () => {
    try {
      const snap = await db.collection('users').where('email', '==', 'takgayev@powerdars.app').limit(1).get();
      if (snap.empty) return;
      const uid = snap.docs[0].id;
      await checkAndStoreBestBuy(uid, BROWSER_USE_API_KEY.value(), BESTBUY_USERNAME.value(), BESTBUY_PASSWORD.value());
    } catch (err) {
      console.error('checkBestBuyStatusScheduled error:', err.message);
    }
  }
);
