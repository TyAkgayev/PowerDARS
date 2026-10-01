// Daily push reminder for card/account payments due tomorrow. Runs once a
// day and, for every category account whose category has an Amount Due and
// Due Date field (credit cards today, but this isn't hardcoded to the
// "Credit Card" category name — it works for any category shaped that way,
// e.g. a future "Bill" or "Payment Plan" category), sends a push if that
// account's latest accountReports value has a balance due tomorrow.
//
// Field matching mirrors src/screens/DARScreen.js's credit-card tile exactly
// (same patterns, same ISO-date parsing convention) since both are reading
// the same free-form category fields and need to agree on what "Amount Due"
// and "Due Date" mean for a given category.
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { db } = require('../lib/common');
const { daysUntil, sendToUserTokens } = require('../lib/push');

const REMINDER_DAYS_BEFORE = 1;

const AMOUNT_DUE_PATTERNS = [/amount\s*due/i, /minimum\s*due/i, /payment\s*due\s*amount/i];
const DUE_DATE_PATTERNS = [
  /next\s*payment\s*date/i, /payment\s*due\s*date/i, /due\s*date/i, /date\s*due/i,
];

function findFieldByPatterns(fields, patterns, type) {
  return fields.find(f => (!type || f.type === type) && patterns.some(re => re.test(f.label)));
}

// Strips everything but digits/sign/decimal, same as DARScreen.js's
// parseNumericValue, since agents sometimes return "$29.00" instead of 29.
function parseNumericValue(value) {
  if (value === undefined || value === null || value === '') return NaN;
  if (typeof value === 'number') return value;
  return parseFloat(String(value).replace(/[^0-9.-]/g, ''));
}

async function findDuePaymentsForUser(uid) {
  const [accountsSnap, categoriesSnap, reportsSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('accounts').where('kind', '==', 'category').get(),
    db.collection('users').doc(uid).collection('categories').get(),
    db.collection('users').doc(uid).collection('accountReports').get(),
  ]);
  if (accountsSnap.empty) return [];

  const categoriesById = {};
  categoriesSnap.forEach(doc => { categoriesById[doc.id] = doc.data(); });
  const reportsById = {};
  reportsSnap.forEach(doc => { reportsById[doc.id] = doc.data(); });

  const due = [];
  accountsSnap.forEach(doc => {
    const account = doc.data();
    const category = categoriesById[account.categoryId];
    if (!category) return;
    const fields = category.fields || [];
    const amountDueField = findFieldByPatterns(fields, AMOUNT_DUE_PATTERNS, 'currency');
    const dueDateField = findFieldByPatterns(fields, DUE_DATE_PATTERNS, 'date');
    if (!amountDueField || !dueDateField) return;

    const values = reportsById[doc.id]?.values || {};
    const amountDue = parseNumericValue(values[amountDueField.id]);
    const dueDateStr = values[dueDateField.id];
    const daysAway = daysUntil(dueDateStr);
    if (daysAway !== REMINDER_DAYS_BEFORE) return;
    if (isNaN(amountDue) || amountDue <= 0) return;

    due.push({ name: account.name, amountDue, dueDateStr });
  });
  return due;
}

exports.sendCardPaymentReminders = onSchedule(
  { schedule: '15 8 * * *', timeZone: 'America/New_York' },
  async () => {
    try {
      const usersSnap = await db.collection('users').get();

      for (const userDoc of usersSnap.docs) {
        const due = await findDuePaymentsForUser(userDoc.id);
        if (due.length === 0) continue;

        const fmtAmount = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        const title = due.length === 1
          ? `${due[0].name} payment due tomorrow`
          : `${due.length} payments due tomorrow`;
        const body = due.length === 1
          ? `${fmtAmount(due[0].amountDue)} due ${due[0].dueDateStr}`
          : due.map((d) => `${d.name}: ${fmtAmount(d.amountDue)}`).join('\n');

        await sendToUserTokens(userDoc.id, { title, body });
      }
    } catch (err) {
      console.error('sendCardPaymentReminders error:', err.message);
    }
  }
);
