// Capital One credit card agent: logs into Capital One once (via a browser-use
// cloud agent) and populates three accounts in a single run — Platinum,
// QuickSilver, and Kohls all live under the same Capital One login, so one
// sign-in/MFA pass is enough to read all three cards instead of three
// separate logins.
//
// Follows the same dynamic-fields pattern as the Best Buy agent (reads each
// account's category fields at runtime and writes into
// users/{uid}/accountReports/{accountId}.values), but asks the model for one
// JSON object keyed by card instead of a flat object, since three different
// accountReports docs need to come out of a single run.
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const cors = require('cors')({ origin: true });
const { admin, db, requireUser } = require('../lib/common');
const {
  createBrowserUseRun, pollBrowserUseRunOnce, runBrowserUseTaskToCompletion,
  withSelfAssessment, extractSelfAssessment,
} = require('../lib/browserUseClient');

const CAPITALONE_USERNAME  = defineSecret('CAPITALONE_USERNAME');
const CAPITALONE_PASSWORD  = defineSecret('CAPITALONE_PASSWORD');
const BROWSER_USE_API_KEY  = defineSecret('BROWSER_USE_API_KEY');
const CAPITALONE_LOGIN_URL = 'https://verified.capitalone.com/auth/signin';
const CAPITALONE_PROFILE_ID = '734254a1-c516-4f1f-b7a6-647e9f02d400'; // "CapitalOne Credit Cards" profile in browser-use cloud
const CAPITALONE_BROWSER_SETTINGS = { profileId: CAPITALONE_PROFILE_ID };

// Account name (as created on the Accounts screen) -> JSON key the agent
// should use for that card's data in its response.
const CAPITALONE_CARDS = [
  { key: 'platinum', accountName: 'Capital One Platinum' },
  { key: 'quicksilver', accountName: 'Capital One QuickSilver' },
  { key: 'kohls', accountName: 'Capital One Kohls' },
];

function buildCapitalOneTask(fields) {
  const fieldList = fields
    .map(f => `- ${f.label} — return as JSON key "${f.id}"${f.type === 'date' ? ' (ISO date YYYY-MM-DD)' : ''}`)
    .join('\n');
  const perCardShape = `{${fields.map(f => `"${f.id}": ${f.type === 'text' ? '""' : 'null'}`).join(', ')}}`;
  const cardNames = CAPITALONE_CARDS.map(c => `"${c.accountName}"`).join(', ');
  return (
    `Go to ${CAPITALONE_LOGIN_URL}. If you land on the account dashboard already signed in (this browser ` +
    `profile may already have an active session), skip straight to the next step. Otherwise log in by typing ` +
    `capitalone_username into the username field and capitalone_password into the password field, then submit. ` +
    `If a two-factor/verification step appears that you cannot complete automatically, stop and report that ` +
    `in your final answer rather than guessing. ` +
    `This Capital One login has three credit cards on it: ${cardNames}. For EACH of the three cards ` +
    `separately, find the following information:\n${fieldList}\n` +
    `Do NOT make any payments or changes to any account — this is read-only. ` +
    `Return ONLY a JSON object as your final answer, shaped like ` +
    `{"platinum": ${perCardShape}, "quicksilver": ${perCardShape}, "kohls": ${perCardShape}}. ` +
    `Set any field to null if it can't be found for that card.`
  );
}

function capitalOneSecretBindings(username, password) {
  const allowedDomains = ['capitalone.com', 'verified.capitalone.com', 'myaccounts.capitalone.com'];
  return [
    { alias: 'capitalone_username', source: { type: 'inline', value: username }, allowedDomains },
    { alias: 'capitalone_password', source: { type: 'inline', value: password }, allowedDomains },
  ];
}

// Splits the single multi-card JSON result into one {values, success, summary}
// per card, keyed the same way as CAPITALONE_CARDS.
function parseCapitalOneResult(resultText, fields) {
  const empty = () => {
    const values = {};
    fields.forEach(f => { values[f.id] = null; });
    return values;
  };
  try {
    const parsed = JSON.parse(resultText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const assessment = extractSelfAssessment(parsed);
      const byCard = {};
      CAPITALONE_CARDS.forEach(({ key }) => {
        const cardData = parsed[key];
        const values = empty();
        if (cardData && typeof cardData === 'object') {
          fields.forEach(f => { values[f.id] = cardData[f.id] ?? null; });
        }
        byCard[key] = { values, ...assessment };
      });
      return byCard;
    }
  } catch {
    // fall through
  }
  const byCard = {};
  CAPITALONE_CARDS.forEach(({ key }) => {
    byCard[key] = { values: empty(), success: false, summary: 'Agent did not return valid JSON.' };
  });
  return byCard;
}

// Finds all three Capital One accounts and the (shared) category field list.
// Throws with a clear message if any account or its category isn't set up.
async function findCapitalOneAccountsAndFields(uid) {
  const accountsByKey = {};
  let fields = null;
  for (const { key, accountName } of CAPITALONE_CARDS) {
    const snap = await db.collection('users').doc(uid).collection('accounts')
      .where('name', '==', accountName).limit(1).get();
    if (snap.empty) {
      throw new Error(`No account named "${accountName}" found. Create it on the Accounts screen first.`);
    }
    const accountDoc = snap.docs[0];
    const account = accountDoc.data();
    if (!account.categoryId) {
      throw new Error(`"${accountName}" has no category assigned yet.`);
    }
    if (!fields) {
      const categorySnap = await db.collection('users').doc(uid).collection('categories').doc(account.categoryId).get();
      fields = categorySnap.exists ? (categorySnap.data().fields || []) : [];
      if (fields.length === 0) {
        throw new Error(`The category assigned to "${accountName}" has no fields defined yet.`);
      }
    }
    accountsByKey[key] = accountDoc.id;
  }
  return { accountsByKey, fields };
}

// Used by the scheduled 7am job, which has no button/spinner waiting on it so
// it's fine to block until the run finishes.
async function checkAndStoreCapitalOne(uid, apiKey, username, password) {
  const { accountsByKey, fields } = await findCapitalOneAccountsAndFields(uid);
  const secretBindings = capitalOneSecretBindings(username, password);
  const prompt = withSelfAssessment(buildCapitalOneTask(fields));
  const docRefs = CAPITALONE_CARDS.map(({ key }) =>
    db.collection('users').doc(uid).collection('accountReports').doc(accountsByKey[key])
  );
  try {
    const { resultText, durationMinutes } = await runBrowserUseTaskToCompletion(
      apiKey, prompt, secretBindings, 12 * 60 * 1000, CAPITALONE_BROWSER_SETTINGS
    );
    const byCard = parseCapitalOneResult(resultText, fields);
    await Promise.all(CAPITALONE_CARDS.map(({ key }, i) => {
      const { values, success, summary } = byCard[key];
      return docRefs[i].set({
        accountId: accountsByKey[key], values, success, summary, prompt, rawResult: resultText,
        status: 'completed', error: null, durationMinutes,
        checkedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }));
    return { status: 'completed' };
  } catch (err) {
    await Promise.all(CAPITALONE_CARDS.map(({ key }, i) => docRefs[i].set({
      accountId: accountsByKey[key], values: {}, success: false, summary: null, prompt, rawResult: null,
      durationMinutes: err.durationMinutes ?? null, status: 'failed', error: err.message,
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })));
    throw err;
  }
}

// ── checkCapitalOneStatus ────────────────────────────────────────────────────
// Called by a "Check Now"/"Refresh" trigger on any one of the three cards.
// Only starts the run and returns right away — the client polls
// pollCapitalOneStatus for the outcome, same as every other agent here.
exports.checkCapitalOneStatus = onRequest(
  { secrets: [CAPITALONE_USERNAME, CAPITALONE_PASSWORD, BROWSER_USE_API_KEY], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const { accountsByKey, fields } = await findCapitalOneAccountsAndFields(uid);
        const secretBindings = capitalOneSecretBindings(CAPITALONE_USERNAME.value(), CAPITALONE_PASSWORD.value());
        const prompt = withSelfAssessment(buildCapitalOneTask(fields));
        const runId = await createBrowserUseRun(
          BROWSER_USE_API_KEY.value(), prompt, secretBindings, CAPITALONE_BROWSER_SETTINGS
        );
        await Promise.all(CAPITALONE_CARDS.map(({ key }) =>
          db.collection('users').doc(uid).collection('accountReports').doc(accountsByKey[key]).set({
            accountId: accountsByKey[key], runId, prompt, rawResult: null, status: 'running',
            durationMinutes: null, values: {}, success: null, summary: null, error: null,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        ));
        res.json({ runId, status: 'running' });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('checkCapitalOneStatus error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── pollCapitalOneStatus ─────────────────────────────────────────────────────
// Called repeatedly while a check is running. Advances the run by one status
// check and, once terminal, writes the final field values to all three
// accountReports docs at once.
exports.pollCapitalOneStatus = onRequest(
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
        const { accountsByKey, fields } = await findCapitalOneAccountsAndFields(uid);
        const docRefs = CAPITALONE_CARDS.map(({ key }) =>
          db.collection('users').doc(uid).collection('accountReports').doc(accountsByKey[key])
        );
        const result = await pollBrowserUseRunOnce(BROWSER_USE_API_KEY.value(), runId);
        if (!result.done) return res.json({ status: 'running' });

        if (!result.ok) {
          await Promise.all(docRefs.map((ref, i) => ref.set({
            accountId: accountsByKey[CAPITALONE_CARDS[i].key], values: {}, success: false, summary: null,
            rawResult: null, status: 'failed', error: result.error, durationMinutes: result.durationMinutes,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true })));
          return res.json({ status: 'failed', error: result.error });
        }

        const byCard = parseCapitalOneResult(result.resultText, fields);
        await Promise.all(CAPITALONE_CARDS.map(({ key }, i) => {
          const { values, success, summary } = byCard[key];
          return docRefs[i].set({
            accountId: accountsByKey[key], values, success, summary, rawResult: result.resultText,
            status: 'completed', error: null, durationMinutes: result.durationMinutes,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }));
        res.json({ status: 'completed' });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('pollCapitalOneStatus error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── checkCapitalOneStatusScheduled ───────────────────────────────────────────
// Refreshes all three cards every morning at 7:15am ET.
exports.checkCapitalOneStatusScheduled = onSchedule(
  {
    schedule: '15 7 * * *',
    timeZone: 'America/New_York',
    secrets: [CAPITALONE_USERNAME, CAPITALONE_PASSWORD, BROWSER_USE_API_KEY],
    timeoutSeconds: 900,
  },
  async () => {
    try {
      const snap = await db.collection('users').where('email', '==', 'takgayev@powerdars.app').limit(1).get();
      if (snap.empty) return;
      const uid = snap.docs[0].id;
      await checkAndStoreCapitalOne(uid, BROWSER_USE_API_KEY.value(), CAPITALONE_USERNAME.value(), CAPITALONE_PASSWORD.value());
    } catch (err) {
      console.error('checkCapitalOneStatusScheduled error:', err.message);
    }
  }
);
