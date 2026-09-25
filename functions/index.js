// v2
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');
const cors = require('cors')({ origin: true });
const twilio = require('twilio');

admin.initializeApp();
const db = admin.firestore();

// Verifies the caller's Firebase ID token and returns their uid, or throws.
// Every endpoint that touches per-user data requires this.
async function requireUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const err = new Error('Missing Authorization bearer token');
    err.statusCode = 401;
    throw err;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch (e) {
    const err = new Error('Invalid or expired auth token');
    err.statusCode = 401;
    throw err;
  }
}

const PLAID_CLIENT_ID      = defineSecret('PLAID_CLIENT_ID');
const PLAID_SECRET         = defineSecret('PLAID_SECRET');
const TWILIO_ACCOUNT_SID   = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN    = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_FROM_NUMBER   = defineSecret('TWILIO_FROM_NUMBER');
const NYGOV_USERNAME       = defineSecret('NYGOV_USERNAME');
const NYGOV_PASSWORD       = defineSecret('NYGOV_PASSWORD');
const BROWSER_USE_API_KEY  = defineSecret('BROWSER_USE_API_KEY');

// Plaid environment: 'sandbox' | 'development' | 'production'
const PLAID_ENV = 'production';

function getPlaidClient(clientId, secret) {
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  }));
}

// ── createLinkToken ────────────────────────────────────────────────────────────
// Called by the app to get a short-lived token that initialises Plaid Link UI.
exports.createLinkToken = onRequest(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const plaid = getPlaidClient(PLAID_CLIENT_ID.value(), PLAID_SECRET.value());
        const { redirect_uri } = req.body || {};
        const response = await plaid.linkTokenCreate({
          user: { client_user_id: uid },
          client_name: 'PowerSync',
          products: ['auth'],
          country_codes: ['US'],
          language: 'en',
          ...(redirect_uri ? { redirect_uri } : {}),
        });
        res.json({ link_token: response.data.link_token });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        const plaidErr = err.response?.data;
        console.error('createLinkToken error:', plaidErr || err.message);
        res.status(500).json({
          error: 'Failed to create link token',
          plaid_error_type: plaidErr?.error_type,
          plaid_error_code: plaidErr?.error_code,
          plaid_error_message: plaidErr?.error_message,
        });
      }
    });
  }
);

// ── exchangePublicToken ────────────────────────────────────────────────────────
// After the user connects their bank in Plaid Link, the app sends the
// public_token here. We exchange it for a permanent access_token and store it
// in Firestore (server-side only — never sent to the client).
exports.exchangePublicToken = onRequest(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const { public_token, accountId, plaidAccountId } = req.body;
        if (!public_token || !accountId) {
          return res.status(400).json({ error: 'public_token and accountId required' });
        }

        const plaid = getPlaidClient(PLAID_CLIENT_ID.value(), PLAID_SECRET.value());
        const response = await plaid.itemPublicTokenExchange({ public_token });
        const { access_token, item_id } = response.data;

        // Store access token + the specific Plaid account ID the user selected
        await db.collection('users').doc(uid).collection('plaidItems').doc(accountId).set({
          access_token,
          item_id,
          accountId,
          plaidAccountId: plaidAccountId || null,
          linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ success: true, item_id });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('exchangePublicToken error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to exchange token' });
      }
    });
  }
);

// ── syncBalances ───────────────────────────────────────────────────────────────
// Fetches live balances from Plaid and writes them to settings/plaidBalances.
// Plaid-linked accounts are never overwritten in DARS — the dashboard reads
// balances directly from this document instead.
exports.syncBalances = onRequest(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const plaid = getPlaidClient(PLAID_CLIENT_ID.value(), PLAID_SECRET.value());

        const userRef = db.collection('users').doc(uid);
        const itemsSnap = await userRef.collection('plaidItems').get();
        if (itemsSnap.empty) return res.json({ synced: 0 });

        const liveBalances = {};

        for (const itemDoc of itemsSnap.docs) {
          const { access_token, accountId, plaidAccountId } = itemDoc.data();

          const balRes = await plaid.accountsBalanceGet({ access_token });
          const accounts = balRes.data.accounts;
          if (!accounts.length) continue;

          // Match the exact account the user selected; fall back to first depository, then first account
          const plaidAcc = (plaidAccountId && accounts.find(a => a.account_id === plaidAccountId))
            || accounts.find(a => a.type === 'depository')
            || accounts[0];

          const balance = plaidAcc.balances.available ?? plaidAcc.balances.current ?? 0;
          liveBalances[accountId] = balance;
          console.log(`Synced ${accountId}: ${plaidAcc.name} (${plaidAcc.subtype}) = ${balance}`);
        }

        await userRef.collection('settings').doc('plaidBalances').set({
          balances: liveBalances,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ synced: Object.keys(liveBalances).length });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('syncBalances error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to sync balances' });
      }
    });
  }
);

// ── getTransactions ────────────────────────────────────────────────────────────
// Returns last 30 days of transactions across all linked Plaid items.
exports.getTransactions = onRequest(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const plaid = getPlaidClient(PLAID_CLIENT_ID.value(), PLAID_SECRET.value());
        const itemsSnap = await db.collection('users').doc(uid).collection('plaidItems').get();
        if (itemsSnap.empty) return res.json({ transactions: [] });

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

        const all = [];
        for (const itemDoc of itemsSnap.docs) {
          const { access_token, accountId } = itemDoc.data();
          try {
            const resp = await plaid.transactionsGet({
              access_token,
              start_date: fmt(startDate),
              end_date: fmt(endDate),
              options: { count: 100, offset: 0 },
            });
            resp.data.transactions.forEach(tx => {
              all.push({
                id: tx.transaction_id,
                accountId,
                name: tx.merchant_name || tx.name,
                amount: tx.amount,
                date: tx.date,
                category: tx.personal_finance_category?.primary || tx.category?.[0] || 'Other',
                subcategory: tx.personal_finance_category?.detailed || tx.category?.[1] || '',
                channel: tx.payment_channel || '',
                pending: tx.pending,
              });
            });
          } catch (e) {
            console.error(`Failed transactions for ${accountId}:`, e.message);
          }
        }

        all.sort((a, b) => b.date.localeCompare(a.date));
        res.json({ transactions: all });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('getTransactions error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── getDailyQuote ─────────────────────────────────────────────────────────
// Proxies ZenQuotes so the browser avoids CORS. Returns today's quote.
exports.getDailyQuote = onRequest(
  { cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const response = await fetch('https://zenquotes.io/api/today');
        const data = await response.json();
        if (data?.[0]?.q) {
          res.json({ text: data[0].q, author: data[0].a });
        } else {
          res.status(502).json({ error: 'No quote returned' });
        }
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── sendWelcomeSms ────────────────────────────────────────────────────────
// Called when the user saves their phone number. Sends a welcome text
// explaining they can reply "next" to get their next shift.
exports.sendWelcomeSms = onRequest(
  { secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        await requireUser(req);
        const { phone } = req.body || {};
        if (!phone) return res.status(400).json({ error: 'phone required' });
        const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
        await client.messages.create({
          body: `👋 Welcome to PowerSync shift reminders!\n\nYou'll get a text 12 hours before each shift.\n\nYou can also text this number "next" anytime to get your next upcoming shift.`,
          from: TWILIO_FROM_NUMBER.value(),
          to: phone,
        });
        res.json({ success: true });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('sendWelcomeSms error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);

// ── handleIncomingSMS ─────────────────────────────────────────────────────
// Twilio webhook: receives inbound texts to the Twilio number.
// If the body is "next", replies with the next upcoming shift.
exports.handleIncomingSMS = onRequest(
  { secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER], invoker: 'public' },
  async (req, res) => {
    try {
      const body = (req.body.Body || '').trim().toLowerCase();
      const from = req.body.From;

      const twiml = (msg) => {
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`);
      };

      if (body !== 'next') {
        return twiml('Text "next" to get your next upcoming shift.');
      }

      // Reverse-lookup which account this phone number belongs to.
      const ownerSnap = await db.collection('users').where('phoneNumber', '==', from).limit(1).get();
      if (ownerSnap.empty) {
        return twiml('This number is not linked to a PowerSync account.');
      }
      const workScheduleRef = ownerSnap.docs[0].ref.collection('workSchedule');

      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

      let nextShift = null;
      for (let i = 0; i < 14; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        const ds = toDateStr(d);
        const snap = await workScheduleRef.doc(ds).get();
        if (!snap.exists) continue;
        const { shift, location } = snap.data();
        const startHour = SHIFT_START_HOURS[shift];
        if (startHour === undefined) continue;
        const shiftStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), startHour, 0, 0);
        if (shiftStart > now) { nextShift = { ds, shift, location, shiftStart }; break; }
      }

      if (!nextShift) return twiml('No upcoming shifts found in the next 14 days.');

      const hoursUntil = Math.round((nextShift.shiftStart - now) / (1000 * 60 * 60));
      const locationStr = nextShift.location ? `\n📍 ${nextShift.location}` : '';
      twiml(`⏰ Next shift: ${nextShift.shift}\n📅 ${nextShift.ds}${locationStr}\n🕐 ${hoursUntil}h from now`);
    } catch (err) {
      console.error('handleIncomingSMS error:', err.message);
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error looking up your schedule. Try again later.</Message></Response>`);
    }
  }
);

// ── sendShiftReminders ─────────────────────────────────────────────────────
// Runs every hour. Checks if any work shift starts in ~12 hours and texts
// the user's phone number via Twilio if so.
const SHIFT_START_HOURS = {
  '8am-8pm':  8,
  '8pm-8am':  20,
  '3pm-11pm': 15,
  '7am-3pm':  7,
  '7am-7pm':  7,
  '11pm-7am': 23,
};

exports.sendShiftReminders = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'America/New_York',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER],
  },
  async () => {
    try {
      const usersSnap = await db.collection('users').get();
      if (usersSnap.empty) return;

      const now = new Date();

      // Look at work schedule docs for today and tomorrow
      const checkDates = [];
      for (let offset = 0; offset <= 1; offset++) {
        const d = new Date(now);
        d.setDate(d.getDate() + offset);
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        checkDates.push(`${y}-${mo}-${dy}`);
      }

      for (const userDoc of usersSnap.docs) {
        const phoneNumber = userDoc.data().phoneNumber;
        if (!phoneNumber) continue;

        for (const dateStr of checkDates) {
          const snap = await userDoc.ref.collection('workSchedule').doc(dateStr).get();
          if (!snap.exists) continue;

          const { shift, location } = snap.data();
          const startHour = SHIFT_START_HOURS[shift];
          if (startHour === undefined) continue;

          // Build the shift start datetime in the server's local time
          const [sy, sm, sd] = dateStr.split('-').map(Number);
          const shiftStart = new Date(sy, sm - 1, sd, startHour, 0, 0, 0);
          const diffMs = shiftStart - now;
          const diffHours = diffMs / (1000 * 60 * 60);

          // Send reminder if shift starts between 11.5 and 12.5 hours from now
          if (diffHours >= 11.5 && diffHours <= 12.5) {
            const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
            const locationStr = location ? ` at ${location}` : '';
            await client.messages.create({
              body: `⏰ PowerSync Reminder: Your ${shift} shift starts in 12 hours${locationStr}. Stay ready!`,
              from: TWILIO_FROM_NUMBER.value(),
              to: phoneNumber,
            });
            console.log(`Sent shift reminder for ${userDoc.id} ${dateStr} ${shift} to ${phoneNumber}`);
          }
        }
      }
    } catch (err) {
      console.error('sendShiftReminders error:', err.message);
    }
  }
);

// ── DMV check (browser-use cloud agent) ──────────────────────────────────────
// Logs into the NY.gov account via a browser-use cloud agent and follows a
// specific, known navigation path through MyDMV Online to read back license
// status, registration status/expiration, and open TVB tickets. The path is
// spelled out step by step (rather than "find the tickets section") so the
// agent doesn't waste time exploring — that's what made earlier runs slow.
// Login credentials are passed as secretBindings so the raw values never
// appear in the task prompt/logs, only the aliases do.
const BROWSER_USE_API = 'https://api.browser-use.com/api/v4';
const NYGOV_LOGIN_URL = 'https://my.ny.gov/LoginV4/login.xhtml';
const BROWSER_USE_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function buildDMVCheckTask() {
  return (
    `Go to ${NYGOV_LOGIN_URL}. Log in by typing ny_username into the username field ` +
    `and ny_password into the password field, then submit. ` +
    `After logging in, navigate to "MyDMV Online". On that page: ` +
    `(1) find the driving/license status, e.g. "Valid" or "Suspended", and record it; ` +
    `(2) find the vehicle registration status, e.g. "Valid" or "Suspended", and record it, ` +
    `along with its expiration date. ` +
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
    `"registrationStatus": "", "registrationExpiration": "", "tickets": [{"ticketNumber": "", ` +
    `"violationCharge": "", "violationPoints": "", "hearingDate": ""}]}. Use an ISO date (YYYY-MM-DD) ` +
    `for registrationExpiration and hearingDate when possible. Set any field to null if it can't be ` +
    `found, and use an empty array if there are no open tickets.`
  );
}

async function createBrowserUseRun(apiKey, task, secretBindings) {
  const createResp = await fetch(`${BROWSER_USE_API}/runs`, {
    method: 'POST',
    headers: { 'X-Browser-Use-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, secretBindings }),
  });
  if (!createResp.ok) {
    throw new Error(`browser-use create run failed: ${createResp.status} ${await createResp.text()}`);
  }
  const { id: runId } = await createResp.json();
  return runId;
}

// Checks a run once. Returns { done: false } while still running, or
// { done: true, ok, resultText } once it reaches a terminal status. A real
// login flow (MFA, slow pages) can take a while, so callers should call this
// repeatedly rather than blocking on a single long wait.
async function pollBrowserUseRunOnce(apiKey, runId) {
  const statusResp = await fetch(`${BROWSER_USE_API}/runs/${runId}/status`, {
    headers: { 'X-Browser-Use-API-Key': apiKey },
  });
  if (!statusResp.ok) return { done: false };
  const { status } = await statusResp.json();
  if (!BROWSER_USE_TERMINAL_STATUSES.has(status)) return { done: false, status };

  const runResp = await fetch(`${BROWSER_USE_API}/runs/${runId}`, {
    headers: { 'X-Browser-Use-API-Key': apiKey },
  });
  const run = await runResp.json();
  if (status !== 'completed') {
    return { done: true, ok: false, error: `browser-use run ${status}: ${run.result || 'no details'}` };
  }
  return { done: true, ok: true, resultText: run.result };
}

// Runs a task to completion by polling, for callers that aren't waiting on a
// synchronous button press (e.g. the scheduled job).
async function runBrowserUseTaskToCompletion(apiKey, task, secretBindings, maxWaitMs = 8 * 60 * 1000) {
  const runId = await createBrowserUseRun(apiKey, task, secretBindings);
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await pollBrowserUseRunOnce(apiKey, runId);
    if (result.done) {
      if (!result.ok) throw new Error(result.error);
      return result.resultText;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`browser-use run ${runId} did not finish within ${Math.round(maxWaitMs / 1000)}s`);
}

const EMPTY_DMV_RESULT = { licenseStatus: null, registrationStatus: null, registrationExpiration: null, tickets: [] };

function parseDMVCheckResult(resultText) {
  try {
    const parsed = JSON.parse(resultText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        licenseStatus: parsed.licenseStatus ?? null,
        registrationStatus: parsed.registrationStatus ?? null,
        registrationExpiration: parsed.registrationExpiration ?? null,
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
