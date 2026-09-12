import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useApp } from '../context/AppContext';

const C = {
  primary: '#4361EE',
  primaryLight: '#EEF2FF',
  bg: '#F0F4FF',
  card: '#FFFFFF',
  text: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
  income: '#22C55E',
  bills: '#EF4444',
};

const CAT_COLORS = {
  FOOD_AND_DRINK: '#F59E0B',
  TRANSPORTATION: '#3B82F6',
  GENERAL_MERCHANDISE: '#A855F7',
  ENTERTAINMENT: '#EC4899',
  PERSONAL_CARE: '#14B8A6',
  MEDICAL: '#EF4444',
  GENERAL_SERVICES: '#6366F1',
  TRAVEL: '#F97316',
  INCOME: '#22C55E',
  TRANSFER_IN: '#22C55E',
  TRANSFER_OUT: '#64748B',
  LOAN_PAYMENTS: '#EF4444',
  RENT_AND_UTILITIES: '#8B5CF6',
  OTHER: '#9CA3AF',
};

const PRETTY_NAMES = {
  FOOD_AND_DRINK: 'Food & Drink',
  GENERAL_MERCHANDISE: 'Shopping',
  GENERAL_SERVICES: 'Services',
  PERSONAL_CARE: 'Personal Care',
  RENT_AND_UTILITIES: 'Bills & Utilities',
  LOAN_PAYMENTS: 'Loan Payments',
  TRANSPORTATION: 'Transportation',
  ENTERTAINMENT: 'Entertainment',
  MEDICAL: 'Medical',
  TRAVEL: 'Travel',
  INCOME: 'Income',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
  OTHER: 'Other',
};

const GET_TRANSACTIONS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/getTransactions';

function prettifyCategory(cat) {
  if (!cat) return 'Other';
  const upper = cat.toUpperCase();
  if (PRETTY_NAMES[upper]) return PRETTY_NAMES[upper];
  // Fallback: replace underscores, title case
  return cat
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getCatColor(cat) {
  if (!cat) return CAT_COLORS.OTHER;
  const upper = cat.toUpperCase();
  return CAT_COLORS[upper] || CAT_COLORS.OTHER;
}

function fmtDollar(n) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDollarRounded(n) {
  return '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
}

function fmtDate(dateStr) {
  // dateStr: "2024-06-04"
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isTransfer(cat) {
  const upper = (cat || '').toUpperCase();
  return upper === 'TRANSFER_IN' || upper === 'TRANSFER_OUT';
}

function computeStats(transactions) {
  // Plaid: positive = expense (debit), negative = income/credit
  const spending = transactions.filter(tx => tx.amount > 0 && !isTransfer(tx.category));
  const totalSpent = spending.reduce((s, tx) => s + tx.amount, 0);
  const maxTx = transactions.reduce((best, tx) => {
    if (tx.amount > 0 && tx.amount > (best ? best.amount : 0)) return tx;
    return best;
  }, null);
  const avgPerDay = totalSpent / 30;
  const txCount = transactions.length;
  return { totalSpent, maxTx, avgPerDay, txCount };
}

function computeCategories(transactions) {
  const map = {};
  for (const tx of transactions) {
    const cat = (tx.category || 'OTHER').toUpperCase();
    if (!map[cat]) map[cat] = 0;
    map[cat] += tx.amount; // positive = expense, negative = income
  }
  return Object.entries(map)
    .map(([cat, total]) => ({ cat, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

function computeTopMerchants(transactions) {
  const map = {};
  for (const tx of transactions) {
    if (tx.amount <= 0 || isTransfer(tx.category)) continue;
    const name = tx.name || 'Unknown';
    if (!map[name]) map[name] = 0;
    map[name] += tx.amount;
  }
  return Object.entries(map)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

export default function SpendingScreen() {
  const { plaidLinkedIds } = useApp();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(GET_TRANSACTIONS_URL, { method: 'POST' });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTransactions(data.transactions || []);
    } catch (e) {
      setError(e.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (plaidLinkedIds && plaidLinkedIds.size > 0) {
      fetchTransactions();
    }
  }, [plaidLinkedIds]);

  const noPlaid = !plaidLinkedIds || plaidLinkedIds.size === 0;

  const stats = transactions.length ? computeStats(transactions) : null;
  const categories = transactions.length ? computeCategories(transactions) : [];
  const topMerchants = transactions.length ? computeTopMerchants(transactions) : [];
  const recentTx = transactions.slice(0, 20);

  // Largest bar value for proportional widths
  const maxCatTotal = categories.length ? Math.max(...categories.map(c => Math.abs(c.total))) : 1;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Spending</Text>
          <Text style={styles.headerSub}>Last 30 days</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={fetchTransactions}
          activeOpacity={0.7}
          disabled={loading}
        >
          <Text style={styles.refreshBtnText}>{loading ? 'Loading…' : '↻ Refresh'}</Text>
        </TouchableOpacity>
      </View>

      {/* No Plaid linked */}
      {noPlaid && !loading && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🏦</Text>
          <Text style={styles.emptyTitle}>No bank linked</Text>
          <Text style={styles.emptyText}>
            Link a bank account in the Accounts screen to see your spending analysis.
          </Text>
        </View>
      )}

      {/* Loading */}
      {loading && !noPlaid && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Fetching transactions…</Text>
        </View>
      )}

      {/* Error */}
      {error && !loading && (
        <View style={styles.errorState}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Could not load transactions</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchTransactions} activeOpacity={0.7}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Content */}
      {!loading && !error && !noPlaid && transactions.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No transactions found</Text>
          <Text style={styles.emptyText}>
            No transactions were found for the last 30 days.
          </Text>
        </View>
      )}

      {!loading && !error && transactions.length > 0 && stats && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* Summary cards */}
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, { flex: 1.2 }]}>
              <Text style={styles.summaryLabel}>Total Spent</Text>
              <Text style={styles.summaryValue}>{fmtDollarRounded(stats.totalSpent)}</Text>
              <Text style={styles.summarySub}>excl. transfers</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Largest</Text>
              <Text style={styles.summaryValue}>{fmtDollarRounded(stats.maxTx?.amount || 0)}</Text>
              <Text style={styles.summarySub} numberOfLines={1}>{stats.maxTx?.name || '—'}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Avg / Day</Text>
              <Text style={styles.summaryValue}>{fmtDollarRounded(stats.avgPerDay)}</Text>
              <Text style={styles.summarySub}>over 30 days</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Transactions</Text>
              <Text style={styles.summaryValue}>{stats.txCount}</Text>
              <Text style={styles.summarySub}>total</Text>
            </View>
          </View>

          {/* Category breakdown */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spending by Category</Text>
            <View style={styles.card}>
              {categories.map(({ cat, total }) => {
                const color = getCatColor(cat);
                const barWidth = (Math.abs(total) / maxCatTotal) * 100;
                const isNegative = total < 0; // income / refunds
                return (
                  <View key={cat} style={styles.catRow}>
                    <View style={styles.catLeft}>
                      <View style={[styles.catDot, { backgroundColor: color }]} />
                      <Text style={styles.catName} numberOfLines={1}>{prettifyCategory(cat)}</Text>
                    </View>
                    <View style={styles.catBarWrap}>
                      <View style={[styles.catBar, { width: `${barWidth}%`, backgroundColor: color + '33' }]}>
                        <View style={[styles.catBarFill, { width: '100%', backgroundColor: color }]} />
                      </View>
                    </View>
                    <Text style={[styles.catAmount, isNegative && { color: C.income }]}>
                      {isNegative ? '+' : ''}{fmtDollarRounded(total)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Top Merchants */}
          {topMerchants.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top Merchants</Text>
              <View style={styles.card}>
                {topMerchants.map(({ name, total }, idx) => (
                  <View key={name} style={[styles.merchantRow, idx < topMerchants.length - 1 && styles.merchantRowBorder]}>
                    <View style={styles.merchantRank}>
                      <Text style={styles.merchantRankText}>#{idx + 1}</Text>
                    </View>
                    <Text style={styles.merchantName} numberOfLines={1}>{name}</Text>
                    <Text style={styles.merchantAmount}>{fmtDollar(total)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Recent Transactions */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
            <View style={styles.card}>
              {recentTx.map((tx, idx) => {
                const isIncome = tx.amount < 0;
                const color = getCatColor(tx.category);
                return (
                  <View key={tx.id || idx} style={[styles.txRow, idx < recentTx.length - 1 && styles.txRowBorder]}>
                    <View style={styles.txLeft}>
                      <View style={[styles.txDot, { backgroundColor: color }]} />
                      <View style={styles.txInfo}>
                        <View style={styles.txNameRow}>
                          <Text style={styles.txName} numberOfLines={1}>{tx.name || 'Unknown'}</Text>
                          {tx.pending && (
                            <View style={styles.pendingBadge}>
                              <Text style={styles.pendingText}>pending</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.txDate}>{fmtDate(tx.date)}</Text>
                      </View>
                    </View>
                    <Text style={[styles.txAmount, { color: isIncome ? C.income : C.bills }]}>
                      {isIncome ? '+' : '-'}{fmtDollar(tx.amount)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.bottomPad} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 16,
    backgroundColor: C.bg,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: C.text,
  },
  headerSub: {
    fontSize: 13,
    color: C.muted,
    marginTop: 2,
  },
  refreshBtn: {
    backgroundColor: C.primaryLight,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  refreshBtnText: {
    color: C.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    color: C.muted,
    fontSize: 14,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 52,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: C.muted,
    textAlign: 'center',
    lineHeight: 21,
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    marginBottom: 6,
  },
  errorText: {
    fontSize: 13,
    color: C.muted,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: C.primary,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  retryBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },

  // Summary cards
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryLabel: {
    fontSize: 11,
    color: C.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  summarySub: {
    fontSize: 11,
    color: C.faint,
  },

  // Section
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  // Category rows
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  catLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 120,
    gap: 8,
    flexShrink: 0,
  },
  catDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  catName: {
    fontSize: 13,
    color: C.text,
    fontWeight: '500',
    flex: 1,
  },
  catBarWrap: {
    flex: 1,
    height: 8,
    backgroundColor: C.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  catBar: {
    height: '100%',
    borderRadius: 4,
    overflow: 'hidden',
    minWidth: 2,
  },
  catBarFill: {
    height: '100%',
    borderRadius: 4,
    opacity: 0.85,
  },
  catAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
    minWidth: 60,
    textAlign: 'right',
    flexShrink: 0,
  },

  // Merchants
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  merchantRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  merchantRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  merchantRankText: {
    fontSize: 11,
    fontWeight: '700',
    color: C.primary,
  },
  merchantName: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    fontWeight: '500',
  },
  merchantAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },

  // Transactions
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 12,
  },
  txRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  txLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  txDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  txInfo: {
    flex: 1,
    minWidth: 0,
  },
  txNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  txName: {
    fontSize: 14,
    fontWeight: '500',
    color: C.text,
    flex: 1,
  },
  pendingBadge: {
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  pendingText: {
    fontSize: 10,
    color: C.faint,
    fontWeight: '600',
  },
  txDate: {
    fontSize: 12,
    color: C.faint,
    marginTop: 2,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 0,
    minWidth: 64,
    textAlign: 'right',
  },

  bottomPad: {
    height: 20,
  },
});
