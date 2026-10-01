// Daily push reminder for upcoming court hearings. Runs once a day and, for
// every open ticket with a hearing date within REMINDER_WINDOW_DAYS (7),
// sends a push to every device token the user has registered (see
// src/utils/pushNotifications.js on the client, which writes to
// users/{uid}/pushTokens). Not a browser-use agent — this just reads the
// ticket data the DMV status agent already wrote to Firestore.
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const cors = require('cors')({ origin: true });
const { db, requireUser } = require('../lib/common');
const { daysUntil, sendToUserTokens } = require('../lib/push');

const REMINDER_WINDOW_DAYS = 7;

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
// fall inside the reminder window. Waits 15s before actually sending so the
// caller has time to background/close the app first, to test delivery while
// it's not running rather than just the (already-working) foreground path.
const TEST_NOTIFICATION_DELAY_MS = 15000;

exports.sendTestNotification = onRequest(
  { cors: true, invoker: 'public', timeoutSeconds: 30 },
  async (req, res) => {
    cors(req, res, async () => {
      try {
        const uid = await requireUser(req);
        const tokensSnap = await db.collection('users').doc(uid).collection('pushTokens').get();
        if (tokensSnap.empty) {
          return res.status(400).json({ error: 'No registered device found. Enable reminders first.' });
        }
        await new Promise((r) => setTimeout(r, TEST_NOTIFICATION_DELAY_MS));
        await sendToUserTokens(uid, {
          title: 'PowerSync test notification',
          body: 'If you can see this, court reminders are wired up correctly.',
        });
        res.json({ sent: tokensSnap.size, delayedMs: TEST_NOTIFICATION_DELAY_MS });
      } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('sendTestNotification error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }
);
