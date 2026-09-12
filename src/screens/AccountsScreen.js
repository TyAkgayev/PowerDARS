import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Modal, TextInput, Alert, Platform, useWindowDimensions,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { ICONS } from '../config/icons';
import { usePlaidLink } from '../hooks/usePlaidLink';

// react-native-web's Alert.alert is a no-op stub, so on web these dialogs
// must go through window.confirm/alert instead or they silently do nothing.
function confirmAsync(title, message) {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

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
  bills: '#EF4444',
  income: '#22C55E',
};

const ACCT_TYPES = [
  { id: 'checking',     label: 'Checking',     icon: ICONS.checking },
  { id: 'savings',      label: 'Savings',       icon: ICONS.savings },
  { id: 'credit',       label: 'Credit Card',   icon: ICONS.credit },
  { id: 'investment',   label: 'Investment',    icon: ICONS.investment },
  { id: 'utility',      label: 'Utility',       icon: ICONS.utility },
  { id: 'subscription', label: 'Subscription',  icon: ICONS.subscription },
  { id: 'phone',        label: 'Phone',         icon: ICONS.phone },
  { id: 'loan',         label: 'Loan',          icon: ICONS.loan },
  { id: 'car_lease',    label: 'Car Lease',     icon: ICONS.car_lease },
  { id: 'car_insurance',label: 'Car Insurance', icon: ICONS.car_insurance },
  { id: 'other',        label: 'Other',         icon: ICONS.other },
];

const FIELD_TYPES = [
  { id: 'currency', label: 'Currency ($)' },
  { id: 'number',   label: 'Number' },
  { id: 'text',     label: 'Text' },
  { id: 'percent',  label: 'Percentage (%)' },
];

const PALETTE = ['#3B82F6','#A855F7','#F59E0B','#22C55E','#EF4444','#06B6D4','#EC4899','#8B5CF6'];
const ACCT_COLORS = PALETTE;

// No due-day fields — every account is paid on whatever day you choose,
// scheduled manually from the Bills checklist instead of on autopay.
const SUGGESTED_FIELDS = {
  checking:     [{ label: 'Balance', type: 'currency' }, { label: 'Available Balance', type: 'currency' }],
  savings:      [{ label: 'Balance', type: 'currency' }],
  credit:       [{ label: 'Amount Due', type: 'currency' }],
  investment:   [{ label: 'Portfolio Value', type: 'currency' }, { label: 'Daily Change', type: 'currency' }],
  utility:      [{ label: 'Amount Due', type: 'currency' }],
  subscription: [{ label: 'Monthly Amount', type: 'currency' }],
  phone:        [{ label: 'Monthly Bill', type: 'currency' }, { label: 'Account Number', type: 'text' }],
  loan:         [{ label: 'Remaining Balance', type: 'currency' }, { label: 'Monthly Payment', type: 'currency' }],
  car_lease:    [{ label: 'Monthly Payment', type: 'currency' }, { label: 'Remaining Payments', type: 'number' }, { label: 'Lease End Date', type: 'text' }],
  car_insurance:[{ label: 'Monthly Premium', type: 'currency' }, { label: 'Policy Number', type: 'text' }, { label: 'Coverage End Date', type: 'text' }],
  other:        [{ label: 'Amount', type: 'currency' }],
};

const BANK_TYPES = ['checking', 'savings'];
const CREDIT_TYPES = ['credit'];

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

// ─── Add/Edit Account Modal ───────────────────────────────────────────────────
function AccountModal({ visible, onClose, onSave, existing, isMobile, bankAccounts = [] }) {
  const isEdit = !!existing;
  const typeObj = existing ? ACCT_TYPES.find(t => t.id === existing.type) : null;

  const [name, setName] = useState(existing?.name || '');
  const [type, setType] = useState(existing?.type || 'checking');
  const [lastFour, setLastFour] = useState(existing?.lastFour || '');
  const [color, setColor] = useState(existing?.color || PALETTE[0]);
  const [icon, setIcon] = useState(existing?.icon || '');
  const [fields, setFields] = useState(existing?.fields || []);
  const [linkedBankId, setLinkedBankId] = useState(existing?.linkedBankId || null);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState('currency');

  const handleTypeChange = (t) => {
    setType(t);
    const typeInfo = ACCT_TYPES.find(a => a.id === t);
    if (typeInfo && !isEdit) setIcon(typeInfo.icon);
    if (!isEdit && fields.length === 0) {
      const suggested = (SUGGESTED_FIELDS[t] || []).map(f => ({ id: makeId(), ...f }));
      setFields(suggested);
    }
  };

  const addField = () => {
    if (!newFieldLabel.trim()) return;
    setFields(prev => [...prev, { id: makeId(), label: newFieldLabel.trim(), type: newFieldType }]);
    setNewFieldLabel('');
    setNewFieldType('currency');
  };

  const removeField = (id) => setFields(prev => prev.filter(f => f.id !== id));

  const handleSave = async () => {
    if (!name.trim()) return;
    const typeInfo = ACCT_TYPES.find(t2 => t2.id === type);
    await onSave({
      name: name.trim(),
      type,
      lastFour: lastFour.trim() || null,
      color,
      icon: icon || typeInfo?.icon || '🏦',
      fields,
      linkedBankId: type === 'credit' ? linkedBankId : null,
    });
    onClose();
  };

  const selectedType = ACCT_TYPES.find(t => t.id === type);

  return (
    <Modal visible={visible} transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[m.overlay, isMobile && m.overlayMobile]}>
        <ScrollView contentContainerStyle={[m.scrollContent, isMobile && m.scrollContentMobile]}>
          <View style={[m.box, isMobile && m.boxMobile]}>
            <Text style={m.title}>{isEdit ? 'Edit Account' : 'Add Account'}</Text>

            {/* Name */}
            <Text style={m.label}>Account Name</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. Chase Checking"
              value={name}
              onChangeText={setName}
              placeholderTextColor={C.faint}
            />

            {/* Type */}
            <Text style={m.label}>Account Type</Text>
            <View style={m.typeGrid}>
              {ACCT_TYPES.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={[m.typeBtn, type === t.id && m.typeBtnActive]}
                  onPress={() => handleTypeChange(t.id)}
                >
                  <Text style={m.typeIcon}>{t.icon}</Text>
                  <Text style={[m.typeTxt, type === t.id && m.typeTxtActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Last four (optional) */}
            <Text style={m.label}>Last 4 Digits (optional)</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. 5678"
              value={lastFour}
              onChangeText={setLastFour}
              keyboardType="number-pad"
              maxLength={4}
              placeholderTextColor={C.faint}
            />

            {/* Icon */}
            <Text style={m.label}>Icon (emoji)</Text>
            <TextInput
              style={m.input}
              placeholder={selectedType?.icon || '🏦'}
              value={icon}
              onChangeText={setIcon}
              placeholderTextColor={C.faint}
            />

            {type === 'credit' && bankAccounts.length > 0 && (
              <>
                <Text style={m.label}>Draws from (bank account)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <TouchableOpacity
                    style={[m.typeBtn, linkedBankId === null && m.typeBtnActive]}
                    onPress={() => setLinkedBankId(null)}
                  >
                    <Text style={[m.typeTxt, linkedBankId === null && m.typeTxtActive]}>None</Text>
                  </TouchableOpacity>
                  {bankAccounts.map(bank => (
                    <TouchableOpacity
                      key={bank.id}
                      style={[m.typeBtn, linkedBankId === bank.id && m.typeBtnActive]}
                      onPress={() => setLinkedBankId(bank.id)}
                    >
                      <Text style={[m.typeTxt, linkedBankId === bank.id && m.typeTxtActive]}>{bank.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Color */}
            <Text style={m.label}>Color</Text>
            <View style={m.colorRow}>
              {PALETTE.map(col => (
                <TouchableOpacity
                  key={col}
                  style={[m.colorSwatch, { backgroundColor: col }, color === col && m.colorSwatchActive]}
                  onPress={() => setColor(col)}
                />
              ))}
            </View>

            {/* Fields */}
            <Text style={m.label}>Tracked Fields</Text>
            {fields.length === 0 && (
              <Text style={m.emptyFields}>No fields yet. Add fields below.</Text>
            )}
            {fields.map(field => (
              <View key={field.id} style={m.fieldRow}>
                <View style={m.fieldInfo}>
                  <Text style={m.fieldName}>{field.label}</Text>
                  <Text style={m.fieldType}>{FIELD_TYPES.find(f => f.id === field.type)?.label || field.type}</Text>
                </View>
                <TouchableOpacity onPress={() => removeField(field.id)} style={m.fieldDel}>
                  <Text style={m.fieldDelTxt}>×</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* Add field */}
            <View style={m.addFieldRow}>
              <TextInput
                style={[m.input, { flex: 1 }]}
                placeholder="Field name..."
                value={newFieldLabel}
                onChangeText={setNewFieldLabel}
                placeholderTextColor={C.faint}
              />
              <View style={m.fieldTypeSelect}>
                {FIELD_TYPES.map(ft => (
                  <TouchableOpacity
                    key={ft.id}
                    style={[m.ftBtn, newFieldType === ft.id && m.ftBtnActive]}
                    onPress={() => setNewFieldType(ft.id)}
                  >
                    <Text style={[m.ftTxt, newFieldType === ft.id && m.ftTxtActive]}>{ft.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={m.addFieldBtn} onPress={addField}>
                <Text style={m.addFieldTxt}>+ Add</Text>
              </TouchableOpacity>
            </View>

            {/* Suggested fields */}
            {!isEdit && (SUGGESTED_FIELDS[type] || []).length > 0 && fields.length === 0 && (
              <TouchableOpacity
                style={m.suggestBtn}
                onPress={() => setFields((SUGGESTED_FIELDS[type] || []).map(f => ({ id: makeId(), ...f })))}
              >
                <Text style={m.suggestTxt}>Use suggested fields for {selectedType?.label}</Text>
              </TouchableOpacity>
            )}

            {/* Actions */}
            <View style={m.btnRow}>
              <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
                <Text style={m.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.saveBtn} onPress={handleSave}>
                <Text style={m.saveTxt}>{isEdit ? 'Save Changes' : 'Add Account'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Account Card ─────────────────────────────────────────────────────────────
function AccountCard({ account, onEdit, onDelete, onLinkBank, color, isMobile, bankAccounts = [] }) {
  const isLinked = !!account.plaidLinked;
  return (
    <View style={[c.card, isMobile && c.cardMobile]}>
      <View style={c.left}>
        <View style={[c.icon, { backgroundColor: color + '20' }]}>
          <Text style={c.iconTxt}>{account.icon || '🏦'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={c.name}>{account.name}</Text>
            {isLinked && (
              <View style={c.linkedBadge}>
                <Text style={c.linkedBadgeTxt}>🔗 Linked</Text>
              </View>
            )}
          </View>
          <Text style={c.type}>
            {ACCT_TYPES.find(t => t.id === account.type)?.label || account.type}
            {account.lastFour ? ` •••• ${account.lastFour}` : ''}
          </Text>
          {(account.fields || []).length > 0 && (
            <View style={c.fields}>
              {(account.fields || []).map(f => (
                <View key={f.id} style={[c.fieldChip, { borderColor: color }]}>
                  <Text style={[c.fieldChipTxt, { color }]}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}
          {account.type === 'credit' && bankAccounts.length > 0 && (
            <Text style={c.drawsFrom}>
              {account.linkedBankId
                ? `Draws from: ${bankAccounts.find(b => b.id === account.linkedBankId)?.name || 'Unknown'}`
                : 'No bank linked'}
            </Text>
          )}
        </View>
      </View>
      <View style={[c.actions, isMobile && c.actionsMobile]}>
        <TouchableOpacity style={c.linkBtn} onPress={onLinkBank}>
          <Text style={c.linkTxt}>{isLinked ? '🔄 Re-link' : '🏦 Link Bank'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={c.editBtn} onPress={onEdit}>
          <Text style={c.editTxt}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={c.delBtn} onPress={onDelete}>
          <Text style={c.delTxt}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── AccountsScreen ───────────────────────────────────────────────────────────
export default function AccountsScreen() {
  const { accounts, addAccount, updateAccount, deleteAccount } = useApp();
  const { openLink, syncBalances } = usePlaidLink();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const [showAdd, setShowAdd] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const handleAdd = async (data) => {
    await addAccount(data);
    setShowAdd(false);
  };

  const handleEdit = async (data) => {
    if (!editingAccount) return;
    await updateAccount(editingAccount.id, data);
    setEditingAccount(null);
  };

  const handleDelete = async (account) => {
    const ok = await confirmAsync(
      'Delete Account',
      `Are you sure you want to delete "${account.name}"? This cannot be undone.`
    );
    if (ok) deleteAccount(account.id);
  };

  const handleLinkBank = (account) => {
    openLink(account.id, async () => {
      await updateAccount(account.id, { plaidLinked: true });
      notify('Bank Linked', `${account.name} is now connected. Tap "Sync Balances" to pull live data.`);
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncBalances();
      notify('Synced', `Updated balances for ${result.synced} account(s).`);
    } catch {
      notify('Sync Failed', 'Could not reach the server. Make sure Cloud Functions are deployed.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollView style={sc.screen} contentContainerStyle={[sc.content, isMobile && sc.contentMobile]}>
      {/* Header */}
      <View style={[sc.header, isMobile && sc.headerMobile]}>
        <View>
          <Text style={sc.title}>Accounts</Text>
          <Text style={sc.subtitle}>Manage your tracked accounts and their fields</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={sc.syncBtn} onPress={handleSync} disabled={syncing}>
            <Text style={sc.syncTxt}>{syncing ? 'Syncing…' : '🔄 Sync Balances'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[sc.addBtn, isMobile && sc.addBtnMobile]} onPress={() => setShowAdd(true)}>
            <Text style={sc.addTxt}>+ Add Account</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Empty state */}
      {accounts.length === 0 && (
        <View style={sc.empty}>
          <Text style={sc.emptyIcon}>🏦</Text>
          <Text style={sc.emptyTitle}>No accounts yet</Text>
          <Text style={sc.emptyMsg}>
            Add your first account to start tracking balances and amounts due with DARS.
          </Text>
          <TouchableOpacity style={sc.emptyBtn} onPress={() => setShowAdd(true)}>
            <Text style={sc.emptyBtnTxt}>Add Your First Account</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Account list — grouped: Banks → Credit Cards → Other */}
      {(() => {
        const banks = accounts.filter(a => BANK_TYPES.includes(a.type));
        const credits = accounts.filter(a => CREDIT_TYPES.includes(a.type));
        const others = accounts.filter(a => !BANK_TYPES.includes(a.type) && !CREDIT_TYPES.includes(a.type));
        const groups = [
          { label: '🏦 Banks', items: banks },
          { label: '💳 Credit Cards', items: credits },
          { label: '📂 Other', items: others },
        ].filter(g => g.items.length > 0);
        return groups.map(group => (
          <View key={group.label} style={{ marginBottom: 8 }}>
            <Text style={sc.groupLabel}>{group.label}</Text>
            {group.items.map((account, idx) => (
              <AccountCard
                key={account.id}
                account={account}
                color={account.color || ACCT_COLORS[accounts.indexOf(account) % ACCT_COLORS.length]}
                onEdit={() => setEditingAccount(account)}
                onDelete={() => handleDelete(account)}
                onLinkBank={() => handleLinkBank(account)}
                isMobile={isMobile}
                bankAccounts={banks}
              />
            ))}
          </View>
        ));
      })()}

      {/* Modals */}
      <AccountModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={handleAdd}
        existing={null}
        isMobile={isMobile}
        bankAccounts={accounts.filter(a => ['checking','savings'].includes(a.type))}
      />
      {editingAccount && (
        <AccountModal
          visible={true}
          onClose={() => setEditingAccount(null)}
          onSave={handleEdit}
          existing={editingAccount}
          isMobile={isMobile}
          bankAccounts={accounts.filter(a => ['checking','savings'].includes(a.type))}
        />
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 28, paddingBottom: 60 },
  contentMobile: { padding: 16, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  headerMobile: { flexDirection: 'column', gap: 12 },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 4 },
  addBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, alignSelf: 'flex-start' },
  addBtnMobile: { alignSelf: 'stretch', alignItems: 'center' },
  addTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  syncBtn: { borderWidth: 1, borderColor: C.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignSelf: 'flex-start' },
  syncTxt: { color: C.primary, fontWeight: '600', fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: 80 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 8 },
  emptyMsg: { fontSize: 15, color: C.muted, textAlign: 'center', maxWidth: 360, lineHeight: 22, marginBottom: 28 },
  emptyBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  emptyBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  groupLabel: { fontSize: 13, fontWeight: '700', color: C.muted, marginBottom: 8, marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase' },
});

const c = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: 16, padding: 20, marginBottom: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    shadowColor: '#000', shadowOffset: {width:0,height:2}, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  cardMobile: { flexDirection: 'column', alignItems: 'flex-start', gap: 12 },
  left: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, flex: 1 },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 22 },
  name: { fontSize: 17, fontWeight: '700', color: C.text },
  type: { fontSize: 13, color: C.faint, marginTop: 2, textTransform: 'capitalize' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  fieldChip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  fieldChipTxt: { fontSize: 12, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 8 },
  actionsMobile: { width: '100%', justifyContent: 'flex-end' },
  linkBtn: { borderWidth: 1, borderColor: '#22C55E', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#F0FDF4' },
  linkTxt: { fontSize: 13, color: '#16A34A', fontWeight: '600' },
  linkedBadge: { backgroundColor: '#DCFCE7', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  linkedBadgeTxt: { fontSize: 11, color: '#16A34A', fontWeight: '600' },
  editBtn: { borderWidth: 1, borderColor: C.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  editTxt: { fontSize: 13, color: C.primary, fontWeight: '600' },
  delBtn: { borderWidth: 1, borderColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#FEF2F2' },
  delTxt: { fontSize: 13, color: C.bills, fontWeight: '600' },
  drawsFrom: { fontSize: 11, color: C.faint, marginTop: 4, fontStyle: 'italic' },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  overlayMobile: { justifyContent: 'flex-end' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  scrollContentMobile: { padding: 0 },
  box: { backgroundColor: C.card, borderRadius: 20, padding: 28, width: 520, maxWidth: '100%', alignSelf: 'center' },
  boxMobile: { width: '100%', maxWidth: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.text, backgroundColor: '#FAFAFA' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeBtnActive: { borderColor: C.primary, backgroundColor: C.primaryLight },
  typeIcon: { fontSize: 16 },
  typeTxt: { fontSize: 13, color: C.muted, fontWeight: '500' },
  typeTxtActive: { color: C.primary, fontWeight: '600' },
  colorRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  colorSwatch: { width: 32, height: 32, borderRadius: 16 },
  colorSwatchActive: { borderWidth: 3, borderColor: '#1F2937' },
  emptyFields: { fontSize: 13, color: C.faint, fontStyle: 'italic', marginBottom: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 6 },
  fieldInfo: { flex: 1 },
  fieldName: { fontSize: 14, fontWeight: '600', color: C.text },
  fieldType: { fontSize: 12, color: C.faint, marginTop: 2 },
  fieldDel: { padding: 6 },
  fieldDelTxt: { fontSize: 20, color: C.faint },
  addFieldRow: { gap: 8, marginTop: 8 },
  fieldTypeSelect: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ftBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  ftBtnActive: { borderColor: C.primary, backgroundColor: C.primaryLight },
  ftTxt: { fontSize: 12, color: C.muted },
  ftTxtActive: { color: C.primary, fontWeight: '600' },
  addFieldBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  addFieldTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },
  suggestBtn: { borderWidth: 1, borderColor: C.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  suggestTxt: { color: C.primary, fontWeight: '500', fontSize: 14 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  cancelTxt: { fontSize: 15, color: C.muted, fontWeight: '500' },
  saveBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  saveTxt: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
