// DMV status agent: logs into the NY.gov account via a browser-use cloud
// agent and follows a specific, known navigation path through MyDMV Online
// to read back license status, registration status/expiration, license
// points, and open TVB tickets. The path is spelled out step by step
// (rather than "find the tickets section") so the agent doesn't waste time
// exploring — that's what made earlier runs slow. Login credentials are
// passed as secretBindings so the raw values never appear in the task
// prompt/logs, only the aliases do.
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const cors = require('cors')({ origin: true });
const { admin, db, requireUser } = require('../lib/common');
const {
  createBrowserUseRun, pollBrowserUseRunOnce, runBrowserUseTaskToCompletion,
} = require('../lib/browserUseClient');

const NYGOV_USERNAME      = defineSecret('NYGOV_USERNAME');
const NYGOV_PASSWORD      = defineSecret('NYGOV_PASSWORD');
const BROWSER_USE_API_KEY = defineSecret('BROWSER_USE_API_KEY');
const NYGOV_LOGIN_URL = 'https://my.ny.gov/LoginV4/login.xhtml';

function buildDMVCheckTask() {
  return (
    `Go to ${NYGOV_LOGIN_URL}. Log in by typing ny_username into the username field ` +
    `and ny_password into the password field, then submit. ` +
    `After logging in, navigate to "MyDMV Online". On that page: ` +
    `(1) find the driving/license status, e.g. "Valid" or "Suspended", and record it; ` +
    `(2) find the vehicle registration status, e.g. "Valid" or "Suspended", and record it, ` +
    `along with its expiration date; ` +
    `(3) find the total number of points currently on the driver's license (the DMV point total, ` +
    `not a per-ticket value) and record it as a number. ` +
    `Then, from that same MyDMV Online page, navigate to "Manage New York City Tickets", then click ` +
    `"Plead To or Pay a TVB Ticket". On the Ticket Action Selection screen, click ` +
    `"Start Ticket Action Selection" — this will show only the open TVB tickets. For each open ` +
    `ticket listed, record its ticket number, Violation Charge, Violation Points, and Hearing Date. ` +
    `The Violation Points column header exists in the page's HTML, but its cell values may not be ` +
    `present in the raw DOM/CSS text for pending tickets. Before concluding a Violation Points value ` +
    `is missing, take a screenshot of the ticket table and visually check whether a number is actually ` +
    `rendered in that column for each row — do not rely on DOM text extraction alone for this field. ` +
    `If, after visually checking, the cell is genuinely empty, that's a legitimate answer (NY TVB often ` +
    `doesn't assess points until after a hearing/conviction) — record it as null rather than guessing or ` +
    `estimating a point value from the violation type. ` +
    `Do NOT plead, pay, or make any changes to any ticket — this is read-only. Once you've recorded ` +
    `every open ticket on that screen, stop and do not navigate any further (do not open individual ` +
    `ticket detail pages). Then return everything you recorded. ` +
    `Return ONLY a JSON object as your final answer, shaped like {"licenseStatus": "", ` +
    `"registrationStatus": "", "registrationExpiration": "", "licensePoints": 0, "tickets": [{"ticketNumber": "", ` +
    `"violationCharge": "", "violationPoints": "", "hearingDate": ""}]}. Use an ISO date (YYYY-MM-DD) ` +
    `for registrationExpiration and hearingDate when possible. Set any field to null if it can't be ` +
    `found, and use an empty array if there are no open tickets.`
  );
}

const EMPTY_DMV_RESULT = {
  licenseStatus: null, registrationStatus: null, registrationExpiration: null, licensePoints: null, tickets: [],
};

function parseDMVCheckResult(resultText) {
  try {
    const parsed = JSON.parse(resultText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        licenseStatus: parsed.licenseStatus ?? null,
        registrationStatus: parsed.registrationStatus ?? null,
        registrationExpiration: parsed.registrationExpiration ?? null,
        licensePoints: typeof parsed.licensePoints === 'number' ? parsed.licensePoints : (parsed.licensePoints ?? null),
        tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      };
    }
  } catch {
    // fall through
  }
  // Agent didn't return clean JSON; surface the raw text rather than silently losing it.
  return { ...EMPTY_DMV_RESULT, tickets: [{ raw: resultText }] };
}

function nygovSecretBindings(nygovUsername, nygovPassword) {
  return [
    { alias: 'ny_username', source: { type: 'inline', value: nygovUsername }, allowedDomains: ['my.ny.gov'] },
    { alias: 'ny_password', source: { type: 'inline', value: nygovPassword }, allowedDomains: ['my.ny.gov'] },
  ];
}

// Used by the scheduled 7am job, which has no button/spinner waiting on it so
// it's fine to block until the run finishes.
async function checkAndStoreLicenseStatus(uid, apiKey, nygovUsername, nygovPassword) {
  const secretBindings = nygovSecretBindings(nygovUsername, nygovPassword);
  const docRef = db.collection('users').doc(uid).collection('licenseStatus').doc('latest');
  try {
    const resultText = await runBrowserUseTaskToCompletion(apiKey, buildDMVCheckTask(), secretBindings, 15 * 60 * 1000);
    const dmv = parseDMVCheckResult(resultText);
    await docRef.set({
      ...dmv, status: 'completed', error: null,
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ...dmv, status: 'completed' };
  } catch (err) {
    await docRef.set({
      ...EMPTY_DMV_RESULT,
      status: 'failed',
      error: err.message,
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    throw err;
  }
}

// ── checkLicenseStatus ───────────────────────────────────────────────────────
// Called by the "Check Now" button on the Car screen. Only starts the run and
// returns right away — the login can take longer than an HTTP request should
// block for, so the client polls pollLicenseStatus for the outcome.
exports.checkLicenseStatus = onRequest(
  { secrets: [NYGOV_USERNAME, NYGOV_PASSWORD, BROWSER_USE_API_KEY], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const secretBindings = nygovSecretBindings(NYGOV_USERNAME.value(), NYGOV_PASSWORD.value());
        const runId = await createBrowserUseRun(BROWSER_USE_API_KEY.value(), buildDMVCheckTask(), secretBindings);
        await db.collection('users').doc(uid).collection('licenseStatus').doc('latest').set({
          runId, status: 'running', ...EMPTY_DMV_RESULT, error: null,
          checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.json({ runId, status: 'running' });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('checkLicenseStatus error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── pollLicenseStatus ────────────────────────────────────────────────────────
// Called repeatedly by the Car screen while a check is running. Advances the
// run by one status check and, once terminal, writes the final result.
exports.pollLicenseStatus = onRequest(
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
        const docRef = db.collection('users').doc(uid).collection('licenseStatus').doc('latest');
        const result = await pollBrowserUseRunOnce(BROWSER_USE_API_KEY.value(), runId);
        if (!result.done) return res.json({ status: 'running' });

        if (!result.ok) {
          await docRef.set({
            ...EMPTY_DMV_RESULT, status: 'failed', error: result.error,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          return res.json({ status: 'failed', error: result.error });
        }

        const dmv = parseDMVCheckResult(result.resultText);
        await docRef.set({
          ...dmv, status: 'completed', error: null,
          checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ status: 'completed', ...dmv });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('pollLicenseStatus error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── checkLicenseStatusScheduled ──────────────────────────────────────────────
// Refreshes the license status every morning at 7am ET for the account tied
// to the NY.gov credentials above.
exports.checkLicenseStatusScheduled = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: 'America/New_York',
    secrets: [NYGOV_USERNAME, NYGOV_PASSWORD, BROWSER_USE_API_KEY],
    timeoutSeconds: 1200,
  },
  async () => {
    try {
      const snap = await db.collection('users').where('email', '==', 'takgayev@powerdars.app').limit(1).get();
      if (snap.empty) return;
      const uid = snap.docs[0].id;
      await checkAndStoreLicenseStatus(uid, BROWSER_USE_API_KEY.value(), NYGOV_USERNAME.value(), NYGOV_PASSWORD.value());
    } catch (err) {
      console.error('checkLicenseStatusScheduled error:', err.message);
    }
  }
);
