// Bot ingest API: lets an external automation bot (Grok bots) push the data
// it scraped straight into Firestore, replacing the browser-use start/poll
// flow. The bot runs on its own schedule, logs into each site itself, and
// POSTs the result here; the endpoint writes it into the exact same docs the
// browser-use agents used to write, so every screen keeps working unchanged:
//
//   dmv        -> users/{uid}/licenseStatus/latest
//   geico      -> users/{uid}/insuranceStatus/latest
//   dof        -> users/{uid}/dofPaymentPlan/latest (NYC DOF ticket payment plan)
//   lease      -> users/{uid}/leaseStatus/latest (Nissan lease account)
//   bestbuy    -> users/{uid}/accountReports/{Best Buy accountId}
//   capitalone -> users/{uid}/accountReports/{each of the 3 card accountIds}
//
// Auth is a long random shared secret (BOT_INGEST_KEY) sent as
// "Authorization: Bearer <key>", not a Firebase ID token, because those expire
// hourly and a bot can't refresh one. The key maps to a single owner account.
//
// Two endpoints:
//   GET  botSchema        -> the JSON shape expected for each source (Best Buy
//                            and Capital One fields come from the account's
//                            category, so they can change; the bot should read
//                            this at the start of each run)
//   POST ingestBotResult  -> { source, status?, error?, success?, summary?,
//                              durationMinutes?, data }
const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { admin, db, requireUser } = require('../lib/common');

const BOT_INGEST_KEY = defineSecret('BOT_INGEST_KEY');
// The bot's "check now" webhook (a Cursor automation). Both the URL and the
// key are secrets: the repo is public and the URL alone can start runs.
const BOT_TRIGGER_URL = defineSecret('BOT_TRIGGER_URL');
const BOT_TRIGGER_KEY = defineSecret('BOT_TRIGGER_KEY');
const TRIGGER_COOLDOWN_MS = 3 * 60 * 1000;
const OWNER_EMAIL = 'takgayev@powerdars.app';

const BESTBUY_ACCOUNT_NAME = 'Best Buy';
const CAPITALONE_CARDS = [
  { key: 'platinum', accountName: 'Capital One Platinum' },
  { key: 'quicksilver', accountName: 'Capital One QuickSilver' },
  { key: 'kohls', accountName: 'Capital One Kohls' },
];

const MAX_TEXT = 500;
const MAX_BRIEF = 4000;   // the bot's full write-up, shown when a tile is tapped
const MAX_ALERTS = 5;     // short warnings that lead the daily push
const MAX_ALERT_LEN = 160;
const MAX_TICKETS = 100;
const SOURCES = ['dmv', 'dmv_license', 'dmv_tickets', 'geico', 'dof', 'lease', 'bestbuy', 'capitalone'];
// Fields dmv_license may set. Only the keys the bot actually includes are
// written, so a license-only or registration-only bot doesn't null out the
// other half (or the tickets list) of licenseStatus/latest.
const DMV_LICENSE_KEYS = ['licenseStatus', 'registrationStatus', 'registrationExpiration', 'licensePoints'];

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// Constant-time comparison so the key can't be guessed byte-by-byte from timing.
function requireBotKey(req) {
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const expected = BOT_INGEST_KEY.value();
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!provided || !expected || !crypto.timingSafeEqual(a, b)) {
    throw httpError(401, 'Invalid bot key');
  }
}

async function ownerUid() {
  const snap = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
  if (snap.empty) throw httpError(500, 'Owner account not found');
  return snap.docs[0].id;
}

// ── Value coercion ───────────────────────────────────────────────────────────
// Bots return loosely typed JSON ("$1,234.56", "4", "12/02/2026"), so values
// are normalized here and anything unrecognizable becomes null rather than
// landing in Firestore as junk.

function toText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return s ? s.slice(0, MAX_TEXT) : null;
}

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[$,%\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function toIsoDate(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (us) m = [null, us[3], us[1].padStart(2, '0'), us[2].padStart(2, '0')];
  }
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function coerceField(type, v) {
  switch (type) {
    case 'currency':
    case 'number':
    case 'percent':
      return toNumber(v);
    case 'date':
      return toIsoDate(v);
    default:
      return toText(v);
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ── Category-driven accounts (Best Buy, Capital One) ────────────────────────

async function findAccountAndFields(uid, accountName) {
  const snap = await db.collection('users').doc(uid).collection('accounts')
    .where('name', '==', accountName).limit(1).get();
  if (snap.empty) throw httpError(422, `No account named "${accountName}" found. Create it on the Accounts screen first.`);
  const accountDoc = snap.docs[0];
  const { categoryId } = accountDoc.data();
  if (!categoryId) throw httpError(422, `"${accountName}" has no category assigned yet.`);
  const categorySnap = await db.collection('users').doc(uid).collection('categories').doc(categoryId).get();
  const fields = categorySnap.exists ? (categorySnap.data().fields || []) : [];
  if (fields.length === 0) throw httpError(422, `The category assigned to "${accountName}" has no fields defined yet.`);
  return { accountId: accountDoc.id, fields };
}

function coerceValues(fields, raw) {
  const values = {};
  fields.forEach(f => { values[f.id] = isPlainObject(raw) ? coerceField(f.type, raw[f.id]) : null; });
  return values;
}

function describeFields(fields) {
  return fields.map(f => ({ key: f.id, label: f.label, type: f.type }));
}

// ── Per-source parsing ───────────────────────────────────────────────────────

function parseDmv(data) {
  const tickets = Array.isArray(data?.tickets) ? data.tickets.slice(0, MAX_TICKETS) : [];
  return {
    licenseStatus: toText(data?.licenseStatus),
    registrationStatus: toText(data?.registrationStatus),
    registrationExpiration: toIsoDate(data?.registrationExpiration),
    licensePoints: toNumber(data?.licensePoints),
    tickets: tickets.filter(isPlainObject).map(t => ({
      ticketNumber: toText(t.ticketNumber),
      violationCharge: toText(t.violationCharge),
      violationPoints: toNumber(t.violationPoints),
      hearingDate: toIsoDate(t.hearingDate),
    })),
  };
}

function parseGeico(data) {
  const s = toText(data?.insuranceStatus);
  const normalized = s && s.toLowerCase() === 'ok' ? 'OK' : s && s.toLowerCase() === 'overdue' ? 'Overdue' : null;
  return { insuranceStatus: normalized };
}

// NYC DOF payment plan: OK (current), Grace (missed payment, still in the
// grace window), Cancelled (plan defaulted). Anything else becomes null.
function parseDof(data) {
  const s = (toText(data?.planStatus) || '').toLowerCase();
  const planStatus = s === 'ok' ? 'OK' : s === 'grace' ? 'Grace'
    : (s === 'cancelled' || s === 'canceled') ? 'Cancelled' : null;
  return { planStatus };
}

// Nissan lease: OK (nothing past due) or Overdue, plus the payment details
// the Lease tile and daily brief show.
function parseLease(data) {
  const s = (toText(data?.leaseStatus) || '').toLowerCase();
  return {
    leaseStatus: s === 'ok' ? 'OK' : (s === 'overdue' || s === 'past due') ? 'Overdue' : null,
    amountDue: toNumber(data?.amountDue),
    dueDate: toIsoDate(data?.dueDate),
    autopay: typeof data?.autopay === 'boolean' ? data.autopay : null,
    paymentsRemaining: toNumber(data?.paymentsRemaining),
    leaseEndDate: toIsoDate(data?.leaseEndDate),
    milesAllowed: toNumber(data?.milesAllowed),
  };
}

const EMPTY = {
  dmv: { licenseStatus: null, registrationStatus: null, registrationExpiration: null, licensePoints: null, tickets: [] },
  geico: { insuranceStatus: null },
  dof: { planStatus: null },
  lease: { leaseStatus: null, amountDue: null, dueDate: null, autopay: null, paymentsRemaining: null, leaseEndDate: null, milesAllowed: null },
};

// ── Writes ───────────────────────────────────────────────────────────────────

function toBrief(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, MAX_BRIEF) : null;
}

function toAlerts(v) {
  if (!Array.isArray(v)) return [];
  return v.map(toText).filter(Boolean).map(a => a.slice(0, MAX_ALERT_LEN)).slice(0, MAX_ALERTS);
}

function baseMeta(body, failed) {
  // brief/alerts are only set on a successful run; a failed run is merged
  // without them so the last good analysis stays visible.
  const analysis = failed ? {} : { brief: toBrief(body.brief), alerts: toAlerts(body.alerts) };
  return {
    ...analysis,
    source: 'grok',
    prompt: null,
    runId: null,
    rawResult: body.data === undefined ? null : JSON.stringify(body.data).slice(0, 20000),
    status: failed ? 'failed' : 'completed',
    error: failed ? (toText(body.error) || 'Bot reported failure') : null,
    success: failed ? false : (typeof body.success === 'boolean' ? body.success : null),
    summary: toText(body.summary),
    durationMinutes: toNumber(body.durationMinutes),
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function ingest(uid, body) {
  const { source } = body;
  const failed = body.status === 'failed';
  if (!failed && !isPlainObject(body.data)) throw httpError(400, '"data" must be a JSON object');
  const meta = baseMeta(body, failed);
  const userRef = db.collection('users').doc(uid);

  // Partial DMV updates: merge into licenseStatus/latest without touching
  // the fields the other half owns.
  if (source === 'dmv_license' || source === 'dmv_tickets') {
    const ref = userRef.collection('licenseStatus').doc('latest');
    if (failed) {
      await ref.set({ ...meta }, { merge: true });
      return { written: ['licenseStatus/latest'] };
    }
    const full = parseDmv(body.data);
    let partial;
    if (source === 'dmv_tickets') {
      if (!Array.isArray(body.data.tickets)) throw httpError(400, '"data.tickets" must be an array (use [] for no open tickets)');
      partial = { tickets: full.tickets };
    } else {
      partial = {};
      DMV_LICENSE_KEYS.forEach(k => { if (k in body.data) partial[k] = full[k]; });
      if (Object.keys(partial).length === 0) {
        throw httpError(400, `"data" must include at least one of: ${DMV_LICENSE_KEYS.join(', ')}`);
      }
    }
    await ref.set({ ...partial, ...meta }, { merge: true });
    return { written: ['licenseStatus/latest'], stored: partial };
  }

  if (source === 'dmv' || source === 'geico' || source === 'dof' || source === 'lease') {
    const coll = { dmv: 'licenseStatus', geico: 'insuranceStatus', dof: 'dofPaymentPlan', lease: 'leaseStatus' }[source];
    const parse = { dmv: parseDmv, geico: parseGeico, dof: parseDof, lease: parseLease }[source];
    const parsed = failed ? EMPTY[source] : parse(body.data);
    if (source === 'dof' && !failed && parsed.planStatus === null) {
      throw httpError(400, '"data.planStatus" must be "OK", "Grace" or "Cancelled"');
    }
    if (source === 'lease' && !failed && parsed.leaseStatus === null) {
      throw httpError(400, '"data.leaseStatus" must be "OK" or "Overdue"');
    }
    // On failure, merge so the last good values stay visible next to the error.
    await userRef.collection(coll).doc('latest').set(
      failed ? { ...meta } : { ...parsed, ...meta },
      { merge: failed }
    );
    return { written: [`${coll}/latest`], ...(failed ? {} : { stored: parsed }) };
  }

  if (source === 'bestbuy') {
    const { accountId, fields } = await findAccountAndFields(uid, BESTBUY_ACCOUNT_NAME);
    const values = failed ? undefined : coerceValues(fields, body.data);
    await userRef.collection('accountReports').doc(accountId).set(
      failed ? { accountId, ...meta } : { accountId, values, ...meta },
      { merge: failed }
    );
    return { written: [`accountReports/${accountId}`], ...(failed ? {} : { stored: values }) };
  }

  if (source === 'capitalone') {
    const written = [];
    const stored = {};
    for (const { key, accountName } of CAPITALONE_CARDS) {
      const { accountId, fields } = await findAccountAndFields(uid, accountName);
      const ref = userRef.collection('accountReports').doc(accountId);
      if (failed) {
        await ref.set({ accountId, ...meta }, { merge: true });
      } else {
        stored[key] = coerceValues(fields, body.data[key]);
        await ref.set({ accountId, values: stored[key], ...meta });
      }
      written.push(`accountReports/${accountId}`);
    }
    return { written, ...(failed ? {} : { stored }) };
  }

  throw httpError(400, `Unknown source "${source}". Expected one of: ${SOURCES.join(', ')}`);
}

// ── ingestBotResult ──────────────────────────────────────────────────────────
exports.ingestBotResult = onRequest(
  { secrets: [BOT_INGEST_KEY], invoker: 'public' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') throw httpError(405, 'Use POST');
      requireBotKey(req);
      const body = isPlainObject(req.body) ? req.body : null;
      if (!body) throw httpError(400, 'Body must be JSON (Content-Type: application/json)');
      if (!SOURCES.includes(body.source)) {
        throw httpError(400, `"source" must be one of: ${SOURCES.join(', ')}`);
      }
      const uid = await ownerUid();
      const result = await ingest(uid, body);
      res.json({ ok: true, source: body.source, status: body.status === 'failed' ? 'failed' : 'completed', ...result });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
      console.error('ingestBotResult error:', err);
      res.status(500).json({ ok: false, error: 'Internal error' });
    }
  }
);

// ── botSchema ────────────────────────────────────────────────────────────────
exports.botSchema = onRequest(
  { secrets: [BOT_INGEST_KEY], invoker: 'public' },
  async (req, res) => {
    try {
      if (req.method !== 'GET') throw httpError(405, 'Use GET');
      requireBotKey(req);
      const uid = await ownerUid();
      const safe = async fn => { try { return await fn(); } catch (e) { return { error: e.message }; } };

      const bestbuy = await safe(async () => {
        const { fields } = await findAccountAndFields(uid, BESTBUY_ACCOUNT_NAME);
        return { fields: describeFields(fields) };
      });
      const capitalone = await safe(async () => {
        const cards = {};
        for (const { key, accountName } of CAPITALONE_CARDS) {
          const { fields } = await findAccountAndFields(uid, accountName);
          cards[key] = { accountName, fields: describeFields(fields) };
        }
        return { cards };
      });

      res.json({
        post: 'POST ingestBotResult with { "source": <one of below>, "data": {...} }. To report a failed run send ' +
          '{ "source": ..., "status": "failed", "error": "why" }. Optional on any call: "success" (bool), ' +
          '"summary" (one sentence), "brief" (your full analysis, up to 4000 chars, shown in the app), ' +
          '"alerts" (up to 5 short warnings, each under 160 chars, that lead the daily push), ' +
          '"durationMinutes" (number). Dates are YYYY-MM-DD; numbers may be plain numbers.',
        sources: {
          dmv: {
            data: {
              licenseStatus: 'text', registrationStatus: 'text', registrationExpiration: 'date', licensePoints: 'number',
              tickets: [{ ticketNumber: 'text', violationCharge: 'text', violationPoints: 'number|null', hearingDate: 'date' }],
            },
          },
          dmv_license: {
            note: 'Updates only the keys you include; tickets are left alone. Include at least one.',
            data: { licenseStatus: 'text', registrationStatus: 'text', registrationExpiration: 'date', licensePoints: 'number' },
          },
          dmv_tickets: {
            note: 'Replaces only the open tickets list; license/registration are left alone. Use [] for none.',
            data: { tickets: [{ ticketNumber: 'text', violationCharge: 'text', violationPoints: 'number|null', hearingDate: 'date' }] },
          },
          geico: { data: { insuranceStatus: '"OK" | "Overdue" | null' } },
          dof: { data: { planStatus: '"OK" | "Grace" | "Cancelled"' } },
          lease: {
            data: {
              leaseStatus: '"OK" | "Overdue"', amountDue: 'number', dueDate: 'date', autopay: 'true|false',
              paymentsRemaining: 'number', leaseEndDate: 'date', milesAllowed: 'number',
            },
          },
          bestbuy: { note: 'data is an object keyed by each field "key"', ...bestbuy },
          capitalone: { note: 'data is { platinum: {...}, quicksilver: {...}, kohls: {...} }, each keyed by field "key"', ...capitalone },
        },
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
      console.error('botSchema error:', err);
      res.status(500).json({ ok: false, error: 'Internal error' });
    }
  }
);

// ── triggerBotCheck ──────────────────────────────────────────────────────────
// Called by the app's "Check Now" buttons (signed-in user). Asks the bot to
// run right away for the given sources; the bot posts its results to
// ingestBotResult like a normal scheduled run, usually within minutes. This
// only starts the run. It stamps botRequestedAt on each affected doc so the
// app can show "Checking…" until a checkedAt newer than that arrives.
// Rate-limited to one trigger per TRIGGER_COOLDOWN_MS per user so repeated
// taps don't stack up bot runs.
const TRIGGER_DOCS = {
  dmv: 'licenseStatus', dmv_license: 'licenseStatus', dmv_tickets: 'licenseStatus',
  geico: 'insuranceStatus', dof: 'dofPaymentPlan', lease: 'leaseStatus',
};

exports.triggerBotCheck = onRequest(
  { secrets: [BOT_TRIGGER_URL, BOT_TRIGGER_KEY], cors: true, invoker: 'public' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') throw httpError(405, 'Use POST');
      const uid = await requireUser(req);
      const requested = req.body?.sources;
      let sources;
      if (requested !== undefined) {
        if (!Array.isArray(requested) || requested.length === 0 || !requested.every(s => SOURCES.includes(s))) {
          throw httpError(400, `"sources" must be a non-empty array of: ${SOURCES.join(', ')}`);
        }
        sources = [...new Set(requested)];
      }

      // Claim the cooldown slot atomically so two quick taps can't both pass.
      const throttleRef = db.collection('users').doc(uid).collection('settings').doc('botTrigger');
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(throttleRef);
        const last = snap.exists ? snap.data().lastTriggeredAt?.toMillis?.() : null;
        if (last && Date.now() - last < TRIGGER_COOLDOWN_MS) {
          const waitSec = Math.ceil((TRIGGER_COOLDOWN_MS - (Date.now() - last)) / 1000);
          throw httpError(429, `A check was just started. Try again in ${Math.ceil(waitSec / 60)} min.`);
        }
        tx.set(throttleRef, { lastTriggeredAt: admin.firestore.Timestamp.now(), sources: sources || 'all' });
      });

      const resp = await fetch(BOT_TRIGGER_URL.value(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${BOT_TRIGGER_KEY.value()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(sources ? { sources } : {}),
        signal: AbortSignal.timeout(15000),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || payload.success === false) {
        await throttleRef.delete().catch(() => {}); // don't lock the button out after a failed start
        console.error('triggerBotCheck webhook error:', resp.status, JSON.stringify(payload).slice(0, 300));
        throw httpError(502, 'The bot could not be started. Try again shortly.');
      }

      const colls = [...new Set((sources || Object.keys(TRIGGER_DOCS)).map(s => TRIGGER_DOCS[s]).filter(Boolean))];
      await Promise.all(colls.map(c => db.collection('users').doc(uid).collection(c).doc('latest')
        .set({ botRequestedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })));

      res.json({ ok: true, status: 'started', runId: payload.runUuid || null, sources: sources || 'all' });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
      console.error('triggerBotCheck error:', err);
      res.status(500).json({ ok: false, error: 'Internal error' });
    }
  }
);
