import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, useWindowDimensions, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { authedFetch } from '../utils/api';

// react-native-web's Alert.alert is a no-op stub, so on web this must go
// through window.alert instead or it silently does nothing.
function notify(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

// Maps an account's name to its Cloud Function endpoints, for accounts that
// actually have an agent wired up. Accounts not listed here fall back to the
// "not connected yet" message. Add an entry here each time a new category
// agent goes live (see functions/agents/bestBuyCreditCardAgent.js for the
// pattern: create/poll endpoints that read the account's category fields
// dynamically and write into accountReports).
const ACCOUNT_AGENTS = {
  'Best Buy': {
    checkUrl: 'https://us-central1-dars-4e5d0.cloudfunctions.net/checkBestBuyStatus',
    pollUrl: 'https://us-central1-dars-4e5d0.cloudfunctions.net/pollBestBuyStatus',
  },
};

const POLL_INTERVAL_MS = 4000;

function pollAgentUntilDone(pollUrl, runId) {
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const res = await authedFetch(`${pollUrl}?runId=${encodeURIComponent(runId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Check failed');
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
          resolve(data);
        }
      } catch (e) {
        clearInterval(interval);
        resolve({ status: 'failed', error: e.message });
      }
    }, POLL_INTERVAL_MS);
  });
}

// Starts a real check for one account and waits for it to finish. Throws if
// the account has no agent, the trigger fails, or the run itself fails.
async function refreshOneAccount(account) {
  const agent = ACCOUNT_AGENTS[account.name];
  if (!agent) {
    throw new Error(`"${account.name}" isn't wired to an agent yet.`);
  }
  const res = await authedFetch(agent.checkUrl, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to start check');
  const result = await pollAgentUntilDone(agent.pollUrl, data.runId);
  if (result.status === 'failed') throw new Error(result.error || 'Check failed');
}

const C = {
  primary: '#4361EE',
  primaryLight: '#EEF2FF',
  bg: '#F0F4FF',
  card: '#FFFFFF',
  text: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
};

function fmtCheckedAt(checkedAt) {
  if (!checkedAt) return null;
  const d = checkedAt.toDate ? checkedAt.toDate() : new Date(checkedAt);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Agents sometimes return currency/percent values pre-formatted (e.g. "$29.00",
// "1,234.56") since that's how the number actually appears on the page they're
// reading, instead of a clean number. Strip everything but digits/sign/decimal
// before parsing so a stray "$" or "," doesn't turn into NaN downstream.
function parseNumericValue(value) {
  if (value === undefined || value === null || value === '') return NaN;
  if (typeof value === 'number') return value;
  return parseFloat(String(value).replace(/[^0-9.-]/g, ''));
}

function fmtFieldValue(field, value) {
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

// "2027-03-10" -> "03-10-27". Plain string manipulation (not Date parsing) so
// there's no UTC-vs-local timezone shift risk; falls back to the raw value if
// it isn't ISO YYYY-MM-DD (e.g. an agent or manual entry wrote something else).
function fmtDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return String(value);
  const [, yyyy, mm, dd] = m;
  return `${mm}-${dd}-${yyyy.slice(2)}`;
}

// Same as fmtDate but without the year, for glanceable spots (e.g. the
// collapsed credit card tile) where the current year is implied.
function fmtDateShort(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return String(value);
  const [, , mm, dd] = m;
  return `${mm}-${dd}`;
}

// ─── Credit card field matching & status logic ──────────────────────────────
// Category fields are free-form (id/label/type the user chose), so the
// concise credit-card view below matches the fields it needs by label
// pattern rather than a fixed id — best-effort, but consistent with how the
// rest of this app already matches fields by label (see DashboardScreen.js).
// Any field that doesn't match a pattern just stays under "More details"
// instead of disappearing.
function isCreditCardCategory(category) {
  return /credit/i.test(category?.name || '');
}

function findFieldByPatterns(fields, patterns, type) {
  return fields.find(f => (!type || f.type === type) && patterns.some(re => re.test(f.label)));
}

const BALANCE_PATTERNS = [/available\s*balance/i, /^balance$/i, /\bbalance\b/i];
const AMOUNT_DUE_PATTERNS = [/amount\s*due/i, /minimum\s*due/i, /payment\s*due\s*amount/i];
const DUE_DATE_PATTERNS = [
  /next\s*payment\s*date/i, /payment\s*due\s*date/i, /due\s*date/i, /date\s*due/i,
];
const LAST_PAYMENT_DATE_PATTERNS = [
  /last\s*payment\s*date/i, /last\s*paid\s*date/i, /date\s*of\s*last\s*payment/i,
  /previous\s*payment\s*date/i, /last\s*pay(ment)?\b.*date/i,
  /date\s*last\s*paid/i, /date\s*last\s*payment/i,
];
const BILLING_CYCLE_DAYS = 35; // ~one month, with slack for a late-posting payment

// Parses "YYYY-MM-DD" into a local-midnight Date, or null — string parsing
// (not `new Date(str)`) so there's no UTC-vs-local shift, same as fmtDate.
function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

// "Current" is decided here, by app logic, from the raw numbers/dates the
// agent retrieves — the agent itself never judges this. Green requires BOTH:
// (1) last month's payment was actually made (a Last Payment Date within the
// last billing cycle), and (2) the current payment isn't past due yet. Either
// one failing makes it past due; not having enough data to check at all
// returns null (shown as "Unknown") rather than guessing.
function computeCreditCardStatus(fields, values) {
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

const CREDIT_STATUS_META = {
  current:  { label: 'Current',  color: '#14532D' },
  past_due: { label: 'Past Due', color: '#EF4444' },
  unknown:  { label: 'Unknown',  color: C.faint },
};

// ─── Account Tile ───────────────────────────────────────────────────────────
// Each account's field values, sourced from accountReports (the "latest
// known state" doc a future daily agent writes to — see AppContext.js). Shows
// a dashed placeholder for any field nothing has populated yet. Credit card
// accounts get the more concise CreditCardTile instead (see below).
function AccountTile(props) {
  if (isCreditCardCategory(props.category)) return <CreditCardTile {...props} />;
  return <GenericAccountTile {...props} />;
}

function GenericAccountTile({ account, category, report, onRefresh, refreshing }) {
  const fields = category?.fields || [];
  const checkedAtLabel = fmtCheckedAt(report?.checkedAt);
  const accentColor = account.color || category?.color || C.primary;

  return (
    <View style={t.tile}>
      <View style={t.tileHeader}>
        <View style={[t.tileIcon, { backgroundColor: `${accentColor}20` }]}>
          <Text style={t.tileIconTxt}>{account.icon || category?.icon || '📄'}</Text>
        </View>
        <Text style={t.tileName} numberOfLines={1}>{account.name}</Text>
      </View>

      <View style={t.tileFields}>
        {fields.length === 0 ? (
          <Text style={t.tileEmpty}>This category has no fields yet — edit it on Accounts.</Text>
        ) : fields.map(field => {
          const display = fmtFieldValue(field, report?.values?.[field.id]);
          return (
            <View key={field.id} style={t.fieldRow}>
              <Text style={t.fieldLabel} numberOfLines={1}>{field.label}</Text>
              <Text style={[t.fieldValue, display === null && t.fieldValuePlaceholder]}>
                {display ?? '—'}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={t.tileFooter}>
        <Text style={t.tileRefreshed} numberOfLines={1}>
          {checkedAtLabel ? `Refreshed ${checkedAtLabel}` : 'Not yet populated'}
        </Text>
        <TouchableOpacity style={t.refreshBtn} onPress={onRefresh} disabled={refreshing}>
          {refreshing
            ? <ActivityIndicator size="small" color={C.primary} />
            : <Text style={t.refreshTxt}>🔄 Refresh</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Concise credit-card tile: Current/Past Due at a glance plus amount due and
// due date; balance and everything else from the category collapses behind a
// "More details" toggle instead of listing every field up front.
function CreditCardTile({ account, category, report, onRefresh, refreshing }) {
  const [expanded, setExpanded] = useState(false);
  const fields = category?.fields || [];
  const values = report?.values || {};
  const checkedAtLabel = fmtCheckedAt(report?.checkedAt);
  const accentColor = account.color || category?.color || C.primary;

  const balanceField = findFieldByPatterns(fields, BALANCE_PATTERNS, 'currency');
  const amountDueField = findFieldByPatterns(fields, AMOUNT_DUE_PATTERNS, 'currency');
  const dueDateField = findFieldByPatterns(fields, DUE_DATE_PATTERNS, 'date');
  const highlightIds = new Set([balanceField, amountDueField, dueDateField].filter(Boolean).map(f => f.id));
  const otherFields = fields.filter(f => !highlightIds.has(f.id));

  const status = computeCreditCardStatus(fields, values) || 'unknown';
  const statusMeta = CREDIT_STATUS_META[status];
  const tinted = status !== 'unknown';

  return (
    <View style={[
      t.tile, t.ccTile,
      expanded && t.ccTileExpanded,
      tinted && { borderColor: statusMeta.color, backgroundColor: `${statusMeta.color}14` },
    ]}>
      <TouchableOpacity onPress={() => setExpanded(e => !e)} activeOpacity={0.7}>
        <View style={[t.tileIcon, t.ccTileIcon, { backgroundColor: `${accentColor}20`, alignSelf: 'center' }]}>
          <Text style={[t.tileIconTxt, t.ccTileIconTxt]}>{account.icon || category?.icon || '💳'}</Text>
        </View>
        <Text style={[t.tileName, t.ccTileName, t.ccCenterTxt]} numberOfLines={1}>{account.name}</Text>

        <View style={[t.ccStatusBadge, t.ccStatusBadgeCentered, { backgroundColor: `${statusMeta.color}20`, borderColor: statusMeta.color }]}>
          <Text style={[t.ccStatusTxt, { color: statusMeta.color }]}>{statusMeta.label}</Text>
        </View>

        <Text style={[t.ccAmountTxt, !amountDueField && t.fieldValuePlaceholder]}>
          {amountDueField ? (fmtFieldValue(amountDueField, values[amountDueField.id]) ?? '—') : 'N/A'}
        </Text>
        <Text style={[t.ccDateTxt, !dueDateField && t.fieldValuePlaceholder]}>
          {dueDateField ? (values[dueDateField.id] ? fmtDateShort(values[dueDateField.id]) : '—') : 'N/A'}
        </Text>

        <Text style={t.ccChevron}>{expanded ? '▴' : '▾'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 8, width: '100%' }}>
          {balanceField && (
            <View style={t.ccDetailRow}>
              <Text style={t.ccFieldLabel} numberOfLines={1}>{balanceField.label}</Text>
              <Text style={t.ccFieldValue}>{fmtFieldValue(balanceField, values[balanceField.id]) ?? '—'}</Text>
            </View>
          )}
          {otherFields.map(field => {
            const display = fmtFieldValue(field, values[field.id]);
            return (
              <View key={field.id} style={t.ccDetailRow}>
                <Text style={t.ccFieldLabel} numberOfLines={1}>{field.label}</Text>
                <Text style={[t.ccFieldValue, display === null && t.fieldValuePlaceholder]}>
                  {display ?? '—'}
                </Text>
              </View>
            );
          })}

          <View style={t.tileFooter}>
            <Text style={t.tileRefreshed} numberOfLines={1}>
              {checkedAtLabel ? `Refreshed ${checkedAtLabel}` : 'Not yet populated'}
            </Text>
            <TouchableOpacity style={t.refreshBtn} onPress={onRefresh} disabled={refreshing}>
              {refreshing
                ? <ActivityIndicator size="small" color={C.primary} />
                : <Text style={t.refreshTxt}>🔄 Refresh</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Category Group (bracketed) ─────────────────────────────────────────────
// A colored left border + heading "brackets" every account tile belonging to
// that category, visually grouping them the way the Accounts screen groups
// account cards.
function CategoryGroup({ category, accounts, accountReports, onRefreshAccount, refreshingIds }) {
  return (
    <View style={[g.group, { borderLeftColor: category.color }]}>
      <View style={g.heading}>
        <Text style={g.headingIcon}>{category.icon}</Text>
        <Text style={g.headingTxt}>{category.name}</Text>
      </View>
      <View style={g.tilesGrid}>
        {accounts.map(account => (
          <AccountTile
            key={account.id}
            account={account}
            category={category}
            report={accountReports[account.id]}
            onRefresh={() => onRefreshAccount(account)}
            refreshing={refreshingIds.has(account.id)}
          />
        ))}
      </View>
    </View>
  );
}

// ─── DARScreen ───────────────────────────────────────────────────────────────
export default function DARScreen() {
  const { accounts, categories, accountReports, setCurrentScreen } = useApp();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  // Account ids currently mid-refresh (per-tile spinners), and a separate
  // flag for the Refresh All button's own spinner.
  const [refreshingIds, setRefreshingIds] = useState(new Set());
  const [allRefreshing, setAllRefreshing] = useState(false);

  const categoryAccounts = accounts.filter(a => a.kind === 'category');

  const handleRefreshAccount = async (account) => {
    setRefreshingIds(prev => new Set(prev).add(account.id));
    try {
      await refreshOneAccount(account);
    } catch (e) {
      notify('Refresh Failed', e.message);
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
    }
  };

  const handleRefreshAll = async () => {
    const connected = categoryAccounts.filter(a => ACCOUNT_AGENTS[a.name]);
    if (connected.length === 0) {
      notify('Not connected yet', "None of your accounts are wired to an agent yet.");
      return;
    }
    setAllRefreshing(true);
    setRefreshingIds(new Set(connected.map(a => a.id)));
    try {
      await Promise.all(connected.map(async (account) => {
        try {
          await refreshOneAccount(account);
        } catch (e) {
          notify('Refresh Failed', `${account.name}: ${e.message}`);
        } finally {
          setRefreshingIds(prev => {
            const next = new Set(prev);
            next.delete(account.id);
            return next;
          });
        }
      }));
    } finally {
      setAllRefreshing(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, isMobile && s.contentMobile]}>
      {/* Header */}
      <View style={[s.header, isMobile && s.headerMobile]}>
        <View>
          <Text style={s.title}>📊 DAR</Text>
          <Text style={s.subtitle}>Daily Account Report</Text>
        </View>
        <TouchableOpacity style={s.refreshAllBtn} onPress={handleRefreshAll} disabled={allRefreshing}>
          {allRefreshing
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={s.refreshAllTxt}>🔄 Refresh All</Text>}
        </TouchableOpacity>
      </View>

      {/* Empty state */}
      {categoryAccounts.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={s.emptyIcon}>📊</Text>
          <Text style={s.emptyTitle}>No accounts to report on yet</Text>
          <Text style={s.emptyMsg}>
            Create a category and add an account to it on the Accounts screen — it'll show up here as a tile.
          </Text>
          <TouchableOpacity style={s.emptyBtn} onPress={() => setCurrentScreen('accounts')}>
            <Text style={s.emptyBtnTxt}>Go to Accounts</Text>
          </TouchableOpacity>
        </View>
      ) : (
        categories.map(category => {
          const items = categoryAccounts.filter(a => a.categoryId === category.id);
          if (items.length === 0) return null;
          return (
            <CategoryGroup
              key={category.id}
              category={category}
              accounts={items}
              accountReports={accountReports}
              onRefreshAccount={handleRefreshAccount}
              refreshingIds={refreshingIds}
            />
          );
        })
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 28, paddingBottom: 60 },
  contentMobile: { padding: 16, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 12, flexWrap: 'wrap' },
  headerMobile: { flexDirection: 'column' },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 4 },
  refreshAllBtn: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18,
    alignSelf: 'flex-start', minWidth: 130, alignItems: 'center',
  },
  refreshAllTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyState: { alignItems: 'center', paddingVertical: 80 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 8 },
  emptyMsg: { fontSize: 15, color: C.muted, textAlign: 'center', maxWidth: 360, lineHeight: 22, marginBottom: 28 },
  emptyBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  emptyBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

const g = StyleSheet.create({
  group: {
    borderLeftWidth: 4, borderRadius: 12, backgroundColor: C.card,
    padding: 18, paddingLeft: 16, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  headingIcon: { fontSize: 18 },
  headingTxt: { fontSize: 16, fontWeight: '700', color: C.text },
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});

const t = StyleSheet.create({
  tile: {
    width: 220, borderWidth: 1, borderColor: C.border, borderRadius: 14,
    padding: 14, backgroundColor: '#FAFAFA',
  },
  tileHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  tileIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tileIconTxt: { fontSize: 16 },
  tileName: { fontSize: 14, fontWeight: '700', color: C.text, flex: 1 },
  tileFields: { gap: 6, marginBottom: 10 },
  tileEmpty: { fontSize: 11, color: C.faint, fontStyle: 'italic' },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  fieldLabel: { fontSize: 11, color: C.muted, flexShrink: 1 },
  fieldValue: { fontSize: 12, fontWeight: '700', color: C.text },
  fieldValuePlaceholder: { color: C.faint, fontWeight: '500' },
  tileFooter: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, gap: 8 },
  tileRefreshed: { fontSize: 10, color: C.faint },
  refreshBtn: {
    borderWidth: 1, borderColor: C.primary, borderRadius: 8,
    paddingVertical: 6, alignItems: 'center',
  },
  refreshTxt: { fontSize: 11, color: C.primary, fontWeight: '600' },
  ccTile: { width: 132, paddingTop: 10, paddingHorizontal: 10, paddingBottom: 4, alignItems: 'center' },
  ccTileExpanded: { width: 190, paddingBottom: 10 },
  ccDetailRow: { marginBottom: 6, width: '100%' },
  ccTileIcon: { width: 28, height: 28, borderRadius: 14, marginBottom: 6 },
  ccTileIconTxt: { fontSize: 14 },
  ccTileName: { fontSize: 12, marginBottom: 6, flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  ccCenterTxt: { textAlign: 'center' },
  ccFieldLabel: { fontSize: 10, color: C.muted, flexShrink: 1 },
  ccFieldValue: { fontSize: 11, fontWeight: '700', color: C.text },
  ccStatusBadge: {
    borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2,
  },
  ccStatusBadgeCentered: { alignSelf: 'center', marginBottom: 8 },
  ccStatusTxt: { fontSize: 10, fontWeight: '700' },
  ccAmountTxt: { fontSize: 19, fontWeight: '800', color: C.text, textAlign: 'center' },
  ccDateTxt: { fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 2, marginBottom: 2 },
  ccChevron: { fontSize: 11, color: C.faint, textAlign: 'center', lineHeight: 12 },
});
