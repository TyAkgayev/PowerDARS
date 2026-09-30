import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, useWindowDimensions, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { useApp } from '../context/AppContext';

// react-native-web's Alert.alert is a no-op stub, so on web this must go
// through window.alert instead or it silently does nothing.
function notify(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
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

function fmtFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return null;
  if (field.type === 'currency') {
    const n = parseFloat(value);
    if (isNaN(n)) return String(value);
    return n < 0
      ? `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  }
  if (field.type === 'percent') {
    const n = parseFloat(value);
    return isNaN(n) ? String(value) : `${n}%`;
  }
  return String(value);
}

// ─── Account Tile ───────────────────────────────────────────────────────────
// Each account's field values, sourced from accountReports (the "latest
// known state" doc a future daily agent writes to — see AppContext.js). Shows
// a dashed placeholder for any field nothing has populated yet.
function AccountTile({ account, category, report, onRefresh, refreshing }) {
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

// ─── Category Group (bracketed) ─────────────────────────────────────────────
// A colored left border + heading "brackets" every account tile belonging to
// that category, visually grouping them the way the Accounts screen groups
// account cards.
function CategoryGroup({ category, accounts, accountReports, onRefreshAccount, refreshingId }) {
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
            refreshing={refreshingId === account.id}
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

  // accountId currently refreshing, 'all' while a refresh-all is in flight,
  // or null. No agents exist yet — see the TODOs below — so this only tracks
  // the stub's fake loading state for now.
  const [refreshingId, setRefreshingId] = useState(null);

  const categoryAccounts = accounts.filter(a => a.kind === 'category');

  // TODO: wire to a real Cloud Function trigger-then-poll call once each
  // category has an agent, following the checkLicenseStatus/pollLicenseStatus
  // pattern already used for the Car screen's agents (see CarScreen.js's
  // useCheckPolling). This stub just proves out the seam.
  const handleRefreshAccount = async (account) => {
    setRefreshingId(account.id);
    try {
      notify('Not connected yet', `"${account.name}" isn't wired to an agent yet. This button will trigger a live refresh once one is.`);
    } finally {
      setRefreshingId(null);
    }
  };

  // TODO: same seam as above, but for every account at once.
  const handleRefreshAll = async () => {
    setRefreshingId('all');
    try {
      notify('Not connected yet', "Refresh All will trigger every account's agent once they're wired up.");
    } finally {
      setRefreshingId(null);
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
        <TouchableOpacity style={s.refreshAllBtn} onPress={handleRefreshAll} disabled={refreshingId === 'all'}>
          {refreshingId === 'all'
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
              refreshingId={refreshingId}
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
});
