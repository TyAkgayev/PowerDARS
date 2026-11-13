// Daily brief push: one notification each morning that sums up every
// bot-fed status tile on the Car screen (DMV, Insurance, DOF payment plan, Lease).
// Runs after the Grok bots' morning runs and after the court (8:00) and card
// (8:15) reminders. For each tile it uses, in order: the bot's "alerts"
// (short warnings), else its one-line "summary", else the bare status
// value. Tiles not refreshed in the last STALE_HOURS are called out so a bot
// that silently stopped running doesn't look like an all-clear.
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { db } = require('../lib/common');
const { sendToUserTokens } = require('../lib/push');

const STALE_HOURS = 26;
const MAX_BODY = 900;

const BRIEF_TILES = [
  { coll: 'licenseStatus', label: 'DMV', value: d => d.licenseStatus && `License ${d.licenseStatus}` },
  { coll: 'insuranceStatus', label: 'Insurance', value: d => d.insuranceStatus },
  { coll: 'dofPaymentPlan', label: 'DOF plan', value: d => d.planStatus },
  { coll: 'leaseStatus', label: 'Lease', value: d => d.leaseStatus && (d.dueDate ? `${d.leaseStatus}, next payment ${d.dueDate}` : d.leaseStatus) },
];

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

// Returns { lines, alertCount } for one user, or null if no tile has data.
async function buildBrief(userRef) {
  const snaps = await Promise.all(BRIEF_TILES.map(t => userRef.collection(t.coll).doc('latest').get()));
  const lines = [];
  let alertCount = 0;
  const now = Date.now();

  snaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const tile = BRIEF_TILES[i];
    const d = snap.data();
    const at = d.checkedAt?.toDate ? d.checkedAt.toDate() : null;
    if (!at) return;

    if (now - at.getTime() > STALE_HOURS * 3600 * 1000) {
      alertCount += 1;
      lines.push(`⏳ ${tile.label}: not checked since ${fmtDate(at)}`);
      return;
    }
    if (d.status === 'failed') {
      alertCount += 1;
      lines.push(`❌ ${tile.label}: check failed${d.error ? ` (${d.error})` : ''}`);
      return;
    }
    const alerts = Array.isArray(d.alerts) ? d.alerts : [];
    if (alerts.length) {
      alertCount += alerts.length;
      alerts.forEach(a => lines.push(`⚠️ ${tile.label}: ${a}`));
      return;
    }
    const text = d.summary || tile.value(d);
    if (text) lines.push(`✅ ${tile.label}: ${text}`);
  });

  return lines.length ? { lines, alertCount } : null;
}

exports.sendDailyBrief = onSchedule(
  { schedule: '30 8 * * *', timeZone: 'America/New_York' },
  async () => {
    try {
      const usersSnap = await db.collection('users').get();
      for (const userDoc of usersSnap.docs) {
        try {
          const brief = await buildBrief(userDoc.ref);
          if (!brief) continue;
          const { lines, alertCount } = brief;
          const title = alertCount
            ? `Daily brief · ${alertCount} alert${alertCount === 1 ? '' : 's'}`
            : 'Daily brief · all clear';
          let body = lines.join('\n');
          if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 1)}…`;
          await sendToUserTokens(userDoc.id, { title, body });
        } catch (err) {
          console.error(`sendDailyBrief error for ${userDoc.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('sendDailyBrief error:', err.message);
    }
  }
);

exports.buildBrief = buildBrief;
