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
