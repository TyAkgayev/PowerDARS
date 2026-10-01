// Shared helpers for every scheduled push-reminder job (court dates, card
// payments, ...). Device tokens aren't reminder-type-specific — one web push
// registration (users/{uid}/pushTokens, written by
// src/utils/pushNotifications.js) receives pushes from every job below.
const { admin, db } = require('./common');

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

module.exports = { daysUntil, sendToUserTokens };
