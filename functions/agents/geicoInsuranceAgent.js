// GEICO insurance agent: logs into ecams.geico.com via a browser-use cloud
// agent and checks whether the policy/account shows any past-due balance.
// Deliberately narrow in scope — just a green/red OK-vs-Overdue read, nothing
// else — matching the "Insurance" tile on the Car screen's DMV Status card.
//
// Reuses a persistent browser-use profile (GEICO_PROFILE_ID, already
// authenticated through GEICO's 2FA once via the browser-use dashboard) so
// runs don't need to re-clear 2FA every time. Login credentials are passed
// as secretBindings so the raw values never appear in the task prompt/logs,
// only the aliases do.
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const cors = require('cors')({ origin: true });
const { admin, db, requireUser } = require('../lib/common');
const {
  createBrowserUseRun, pollBrowserUseRunOnce, runBrowserUseTaskToCompletion,
} = require('../lib/browserUseClient');

const GEICO_USERNAME      = defineSecret('GEICO_USERNAME');
const GEICO_PASSWORD      = defineSecret('GEICO_PASSWORD');
const BROWSER_USE_API_KEY = defineSecret('BROWSER_USE_API_KEY');
const GEICO_LOGIN_URL = 'https://ecams.geico.com/';
const GEICO_PROFILE_ID = '2da4ed6f-3741-4074-b95f-8255e1f24306'; // "GEICO" profile in browser-use cloud
const GEICO_BROWSER_SETTINGS = { profileId: GEICO_PROFILE_ID };

function buildGeicoCheckTask() {
  return (
    `Go to ${GEICO_LOGIN_URL}. If you land on an account/policy page already signed in (this browser ` +
    `profile may already have an active, 2FA-verified session), skip straight to the next step. ` +
    `Otherwise log in by typing geico_username into the username/email field and geico_password into ` +
    `the password field, then submit. If a two-factor/verification step appears that you cannot complete ` +
    `automatically, stop and report that in your final answer rather than guessing. ` +
    `Once on the account page, look for any indication that the policy or account has a past-due balance ` +
    `— e.g. a "past due" notice, an overdue payment banner, a balance due with a missed due date, or ` +
    `similar. Do NOT make any payments or changes — this is read-only. ` +
    `Return ONLY a JSON object as your final answer, shaped like {"insuranceStatus": "OK"} if there is no ` +
    `indication of a past-due balance, or {"insuranceStatus": "Overdue"} if the account appears past due. ` +
    `If you could not determine this (e.g. blocked by 2FA or a login failure), use ` +
    `{"insuranceStatus": null}.`
  );
}

const EMPTY_GEICO_RESULT = { insuranceStatus: null };

function parseGeicoCheckResult(resultText) {
  try {
    const parsed = JSON.parse(resultText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { insuranceStatus: parsed.insuranceStatus ?? null };
    }
  } catch {
    // fall through
  }
  return EMPTY_GEICO_RESULT;
}

function geicoSecretBindings(geicoUsername, geicoPassword) {
  return [
    { alias: 'geico_username', source: { type: 'inline', value: geicoUsername }, allowedDomains: ['ecams.geico.com', 'geico.com'] },
    { alias: 'geico_password', source: { type: 'inline', value: geicoPassword }, allowedDomains: ['ecams.geico.com', 'geico.com'] },
  ];
}

// Used by the scheduled 7am job, which has no button/spinner waiting on it so
// it's fine to block until the run finishes.
async function checkAndStoreInsuranceStatus(uid, apiKey, geicoUsername, geicoPassword) {
  const secretBindings = geicoSecretBindings(geicoUsername, geicoPassword);
  const docRef = db.collection('users').doc(uid).collection('insuranceStatus').doc('latest');
  try {
    const resultText = await runBrowserUseTaskToCompletion(
      apiKey, buildGeicoCheckTask(), secretBindings, 10 * 60 * 1000, GEICO_BROWSER_SETTINGS
    );
    const geico = parseGeicoCheckResult(resultText);
    await docRef.set({
      ...geico, status: 'completed', error: null,
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ...geico, status: 'completed' };
  } catch (err) {
    await docRef.set({
      ...EMPTY_GEICO_RESULT,
      status: 'failed',
      error: err.message,
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    throw err;
  }
}

// ── checkInsuranceStatus ──────────────────────────────────────────────────────
// Called by the "Check Now" button on the Car screen. Only starts the run and
// returns right away — the login can take longer than an HTTP request should
// block for, so the client polls pollInsuranceStatus for the outcome.
exports.checkInsuranceStatus = onRequest(
  { secrets: [GEICO_USERNAME, GEICO_PASSWORD, BROWSER_USE_API_KEY], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const secretBindings = geicoSecretBindings(GEICO_USERNAME.value(), GEICO_PASSWORD.value());
        const runId = await createBrowserUseRun(
          BROWSER_USE_API_KEY.value(), buildGeicoCheckTask(), secretBindings, GEICO_BROWSER_SETTINGS
        );
        await db.collection('users').doc(uid).collection('insuranceStatus').doc('latest').set({
          runId, status: 'running', ...EMPTY_GEICO_RESULT, error: null,
          checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.json({ runId, status: 'running' });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('checkInsuranceStatus error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── pollInsuranceStatus ───────────────────────────────────────────────────────
// Called repeatedly by the Car screen while a check is running. Advances the
// run by one status check and, once terminal, writes the final result.
exports.pollInsuranceStatus = onRequest(
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
        const docRef = db.collection('users').doc(uid).collection('insuranceStatus').doc('latest');
        const result = await pollBrowserUseRunOnce(BROWSER_USE_API_KEY.value(), runId);
        if (!result.done) return res.json({ status: 'running' });

        if (!result.ok) {
          await docRef.set({
            ...EMPTY_GEICO_RESULT, status: 'failed', error: result.error,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          return res.json({ status: 'failed', error: result.error });
        }

        const geico = parseGeicoCheckResult(result.resultText);
        await docRef.set({
          ...geico, status: 'completed', error: null,
          checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ status: 'completed', ...geico });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('pollInsuranceStatus error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── checkInsuranceStatusScheduled ────────────────────────────────────────────
// Refreshes the insurance status every morning at 7am ET for the account tied
// to the GEICO credentials above.
exports.checkInsuranceStatusScheduled = onSchedule(
  {
    schedule: '5 7 * * *',
    timeZone: 'America/New_York',
    secrets: [GEICO_USERNAME, GEICO_PASSWORD, BROWSER_USE_API_KEY],
    timeoutSeconds: 900,
  },
  async () => {
    try {
      const snap = await db.collection('users').where('email', '==', 'takgayev@powerdars.app').limit(1).get();
      if (snap.empty) return;
      const uid = snap.docs[0].id;
      await checkAndStoreInsuranceStatus(uid, BROWSER_USE_API_KEY.value(), GEICO_USERNAME.value(), GEICO_PASSWORD.value());
    } catch (err) {
      console.error('checkInsuranceStatusScheduled error:', err.message);
    }
  }
);
