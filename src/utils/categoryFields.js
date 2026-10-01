// Shared field-matching for the free-form category fields system. Category
// fields are user-chosen label/type pairs (see AccountsScreen.js), so any
// screen that needs to find "the Amount Due field" or "the Due Date field"
// for a given category matches by label pattern rather than a fixed id.
// Used by DARScreen.js (tiles) and DashboardScreen.js (calendar bill
// placement) — both need to agree on what these mean for a given account, so
// the matching logic lives here once instead of drifting between copies.

export const BALANCE_PATTERNS = [/available\s*balance/i, /^balance$/i, /\bbalance\b/i];
export const AMOUNT_DUE_PATTERNS = [/amount\s*due/i, /minimum\s*due/i, /payment\s*due\s*amount/i];
export const DUE_DATE_PATTERNS = [
  /next\s*payment\s*date/i, /payment\s*due\s*date/i, /due\s*date/i, /date\s*due/i,
];
export const LAST_PAYMENT_DATE_PATTERNS = [
  /last\s*payment\s*date/i, /last\s*paid\s*date/i, /date\s*of\s*last\s*payment/i,
  /previous\s*payment\s*date/i, /last\s*pay(ment)?\b.*date/i,
  /date\s*last\s*paid/i, /date\s*last\s*payment/i,
];
export const BILLING_CYCLE_DAYS = 35; // ~one month, with slack for a late-posting payment

export function findFieldByPatterns(fields, patterns, type) {
  return fields.find(f => (!type || f.type === type) && patterns.some(re => re.test(f.label)));
}

// Agents sometimes return currency/percent values pre-formatted (e.g. "$29.00",
// "1,234.56") since that's how the number actually appears on the page they're
// reading, instead of a clean number. Strip everything but digits/sign/decimal
// before parsing so a stray "$" or "," doesn't turn into NaN downstream.
export function parseNumericValue(value) {
  if (value === undefined || value === null || value === '') return NaN;
  if (typeof value === 'number') return value;
  return parseFloat(String(value).replace(/[^0-9.-]/g, ''));
}

// Parses "YYYY-MM-DD" into a local-midnight Date, or null — string parsing
// (not `new Date(str)`) so there's no UTC-vs-local shift.
export function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

// "2027-03-10" -> "03-10-27". Plain string manipulation (not Date parsing) so
// there's no UTC-vs-local timezone shift risk; falls back to the raw value if
// it isn't ISO YYYY-MM-DD (e.g. an agent or manual entry wrote something else).
export function fmtDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return String(value);
  const [, yyyy, mm, dd] = m;
  return `${mm}-${dd}-${yyyy.slice(2)}`;
}

// Same as fmtDate but without the year, for glanceable spots (e.g. the
// collapsed credit card tile) where the current year is implied.
export function fmtDateShort(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return String(value);
  const [, , mm, dd] = m;
  return `${mm}-${dd}`;
}

export function fmtFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return null;
  if (field.type === 'currency') {
    const n = parseNumericValue(value);
    if (isNaN(n)) return String(value);
    return n < 0
      ? `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  }
  if (field.type === 'percent') {
    const n = parseNumericValue(value);
    return isNaN(n) ? String(value) : `${n}%`;
  }
  if (field.type === 'date') {
    return fmtDate(value);
  }
  return String(value);
}

export function isCreditCardCategory(category) {
  return /credit/i.test(category?.name || '');
}

// "Current" is decided here, by app logic, from the raw numbers/dates the
// agent retrieves — the agent itself never judges this. Green requires BOTH:
// (1) last month's payment was actually made (a Last Payment Date within the
// last billing cycle), and (2) the current payment isn't past due yet. Either
// one failing makes it past due; not having enough data to check at all
// returns null (shown as "Unknown") rather than guessing.
export function computeCreditCardStatus(fields, values) {
  const dueDateField = findFieldByPatterns(fields, DUE_DATE_PATTERNS, 'date');
  const amountDueField = findFieldByPatterns(fields, AMOUNT_DUE_PATTERNS, 'currency');
  const lastPaymentDateField = findFieldByPatterns(fields, LAST_PAYMENT_DATE_PATTERNS, 'date');
  if (!dueDateField || !amountDueField || !lastPaymentDateField) return null;

  const dueDate = parseIsoDate(values?.[dueDateField.id]);
  const amountDue = parseNumericValue(values?.[amountDueField.id]);
  const lastPaymentDate = parseIsoDate(values?.[lastPaymentDateField.id]);
  if (!dueDate || isNaN(amountDue) || !lastPaymentDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Already past due right now: a balance is owed and the due date has passed.
  if (dueDate < today && amountDue > 0) return 'past_due';

  const daysSinceLastPayment = Math.round((today - lastPaymentDate) / 86400000);
  if (daysSinceLastPayment < 0) return null; // last payment date is in the future — can't make sense of it

  // Last month's payment missing (too long since the last one) counts as
  // past due even if the next due date technically hasn't arrived yet.
  return daysSinceLastPayment <= BILLING_CYCLE_DAYS ? 'current' : 'past_due';
}

// Finds this account's Amount Due + Due Date fields and current values (if
// any agent has populated them yet). Returns null if the category has no
// Amount Due field at all — nothing to show for this account anywhere a
// "what's due" list is built (e.g. the Dashboard calendar).
export function getDuePayment(category, report) {
  const fields = category?.fields || [];
  const amountDueField = findFieldByPatterns(fields, AMOUNT_DUE_PATTERNS, 'currency');
  if (!amountDueField) return null;
  const dueDateField = findFieldByPatterns(fields, DUE_DATE_PATTERNS, 'date');

  const values = report?.values || {};
  const amount = parseNumericValue(values[amountDueField.id]);
  const dueDateStr = dueDateField ? (values[dueDateField.id] || null) : null;
  return { amount: isNaN(amount) ? null : amount, dueDateStr };
}
