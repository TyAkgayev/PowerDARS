// Daily push reminder for upcoming court hearings. Runs once a day and, for
// every open ticket with a hearing date within REMINDER_WINDOW_DAYS (7),
// sends a push to every device token the user has registered (see
// src/utils/pushNotifications.js on the client, which writes to
// users/{uid}/pushTokens). Not a browser-use agent — this just reads the
// ticket data the DMV status agent already wrote to Firestore.
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const cors = require('cors')({ origin: true });
const { admin, db, requireUser } = require('../lib/common');

const REMINDER_WINDOW_DAYS = 7;
const UNREGISTERED_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

// Whole calendar days between today and an ISO (YYYY-MM-DD) date string, or
// null if the date is missing/unparseable.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

async function sendToUserTokens(uid, notification) {
  const tokensSnap = await db.collection('users').doc(uid).collection('pushTokens').get();
  if (tokensSnap.empty) return;

  const tokens = tokensSnap.docs.map((d) => d.id);
  const resp = await admin.messaging().sendEachForMulticast({ tokens, notification });

  resp.responses.forEach((r, i) => {
    if (!r.success && UNREGISTERED_TOKEN_ERRORS.has(r.error?.code)) {
      tokensSnap.docs[i].ref.delete().catch(() => {});
    }
  });
}

exports.sendCourtReminders = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/New_York' },
  async () => {
    try {
      const usersSnap = await db.collection('users').get();

      for (const userDoc of usersSnap.docs) {
        const licenseSnap = await userDoc.ref.collection('licenseStatus').doc('latest').get();
        if (!licenseSnap.exists) continue;

        const tickets = licenseSnap.data().tickets || [];
        const upcoming = tickets
          .map((t) => ({ ...t, daysAway: daysUntil(t.hearingDate) }))
          .filter((t) => t.daysAway !== null && t.daysAway >= 0 && t.daysAway <= REMINDER_WINDOW_DAYS)
          .sort((a, b) => a.daysAway - b.daysAway);

        if (upcoming.length === 0) continue;

        const soonest = upcoming[0];
        const title = upcoming.length === 1
          ? `Court hearing in ${soonest.daysAway === 0 ? 'today' : `${soonest.daysAway}d`}`
          : `${upcoming.length} court hearings in the next ${REMINDER_WINDOW_DAYS} days`;
        const body = upcoming.length === 1
          ? `${soonest.violationCharge || 'Ticket'}${soonest.ticketNumber ? ` #${soonest.ticketNumber}` : ''} — ${soonest.hearingDate}`
          : upcoming.map((t) => `${t.hearingDate}: ${t.violationCharge || 'Ticket'}`).join('\n');

        await sendToUserTokens(userDoc.id, { title, body });
      }
    } catch (err) {
      console.error('sendCourtReminders error:', err.message);
    }
  }
);

// ── sendTestNotification ─────────────────────────────────────────────────────
// Called by a "Send Test Notification" button so the caller can confirm their
// device is actually receiving pushes, without waiting for a real hearing to
// fall inside the reminder window.
exports.sendTestNotification = onRequest(
  { cors: true, invoker: 'public' },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const tokensSnap = await db.collection('users').doc(uid).collection('pushTokens').get();
        if (tokensSnap.empty) {
          return res.status(400).json({ error: 'No registered device found. Enable reminders first.' });
        }
        await sendToUserTokens(uid, {
          title: 'PowerSync test notification',
          body: 'If you can see this, court reminders are wired up correctly.',
        });
        res.json({ sent: tokensSnap.size });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('sendTestNotification error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);
