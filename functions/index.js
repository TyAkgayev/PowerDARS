const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');
const cors = require('cors')({ origin: true });

admin.initializeApp();
const db = admin.firestore();

const PLAID_CLIENT_ID = defineSecret('PLAID_CLIENT_ID');
const PLAID_SECRET    = defineSecret('PLAID_SECRET');

// Plaid environment: 'sandbox' for testing, 'production' for real banks
const PLAID_ENV = 'sandbox';

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
        const plaid = getPlaidClient(PLAID_CLIENT_ID.value(), PLAID_SECRET.value());
        const response = await plaid.linkTokenCreate({
          user: { client_user_id: 'powerdars-user' },
          client_name: 'PowerDARS',
          products: ['auth', 'transactions'],
          country_codes: ['US'],
          language: 'en',
        });
        res.json({ link_token: response.data.link_token });
      } catch (err) {
        console.error('createLinkToken error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to create link token' });
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
        const { public_token, accountId } = req.body;
        if (!public_token || !accountId) {
          return res.status(400).json({ error: 'public_token and accountId required' });
        }

        const plaid = getPlaidClient(PLAID_CLIENT_ID.value(), PLAID_SECRET.value());
        const response = await plaid.itemPublicTokenExchange({ public_token });
        const { access_token, item_id } = response.data;

        // Store access token server-side in a protected collection
        await db.collection('plaidItems').doc(accountId).set({
          access_token,
          item_id,
          accountId,
          linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ success: true, item_id });
      } catch (err) {
        console.error('exchangePublicToken error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to exchange token' });
      }
    });
  }
);

// ── syncBalances ───────────────────────────────────────────────────────────────
// Fetches the latest balances for all linked accounts and writes them into
// the existing dars/today document so the dashboard reflects real data.
exports.syncBalances = onRequest(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const plaid = getPlaidClient(PLAID_CLIENT_ID.value(), PLAID_SECRET.value());

        // Fetch all linked Plaid items
        const itemsSnap = await db.collection('plaidItems').get();
        if (itemsSnap.empty) return res.json({ synced: 0 });

        // Fetch current account metadata to map Plaid accounts → app accounts
        const accountsSnap = await db.collection('accounts').get();
        const appAccounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

        // Load or create today's DARS entry
        const darsRef = db.collection('dars').doc(dateStr);
        const darsSnap = await darsRef.get();
        const entries = darsSnap.exists ? (darsSnap.data().entries || {}) : {};

        let synced = 0;
        for (const itemDoc of itemsSnap.docs) {
          const { access_token, accountId } = itemDoc.data();

          const balRes = await plaid.accountsBalanceGet({ access_token });
          const plaidAccounts = balRes.data.accounts;

          // Match each Plaid account back to the app account by stored mapping,
          // or fall back to matching by accountId field on the item doc.
          const appAcc = appAccounts.find(a => a.id === accountId);
          if (!appAcc) continue;

          // Use the first Plaid account's current balance
          const plaidAcc = plaidAccounts[0];
          if (!plaidAcc) continue;

          const balance = plaidAcc.balances.current ?? plaidAcc.balances.available ?? 0;

          // Find the currency field on this account and update it
          const currencyField = (appAcc.fields || []).find(f => f.type === 'currency');
          if (!currencyField) continue;

          if (!entries[accountId]) entries[accountId] = {};
          entries[accountId][currencyField.id] = String(balance);
          synced++;
        }

        await darsRef.set({ date: dateStr, entries, syncedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        res.json({ synced, date: dateStr });
      } catch (err) {
        console.error('syncBalances error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to sync balances' });
      }
    });
  }
);
