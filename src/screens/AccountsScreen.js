import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Modal, TextInput, Alert, useWindowDimensions,
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
  bills: '#EF4444',
  income: '#22C55E',
};

const ACCT_TYPES = [
  { id: 'checking',     label: 'Checking',     icon: '🏦' },
  { id: 'savings',      label: 'Savings',       icon: '💰' },
  { id: 'credit',       label: 'Credit Card',   icon: '💳' },
  { id: 'investment',   label: 'Investment',    icon: '📈' },
  { id: 'utility',      label: 'Utility',       icon: '💡' },
  { id: 'subscription', label: 'Subscription',  icon: '📱' },
  { id: 'phone',        label: 'Phone',         icon: '📞' },
  { id: 'loan',         label: 'Loan',          icon: '🏠' },
  { id: 'car_lease',    label: 'Car Lease',     icon: '🚗' },
  { id: 'car_insurance',label: 'Car Insurance', icon: '🛡️' },
  { id: 'other',        label: 'Other',         icon: '📄' },
];

const FIELD_TYPES = [
  { id: 'currency', label: 'Currency ($)' },
  { id: 'number',   label: 'Number' },
  { id: 'date',     label: 'Date (YYYY-MM-DD)' },
  { id: 'text',     label: 'Text' },
  { id: 'percent',  label: 'Percentage (%)' },
];

const PALETTE = ['#3B82F6','#A855F7','#F59E0B','#22C55E','#EF4444','#06B6D4','#EC4899','#8B5CF6'];
const ACCT_COLORS = PALETTE;

const SUGGESTED_FIELDS = {
  checking:     [{ label: 'Balance', type: 'currency' }, { label: 'Available Balance', type: 'currency' }],
  savings:      [{ label: 'Balance', type: 'currency' }],
  credit:       [{ label: 'Current Balance', type: 'currency' }, { label: 'Due Date', type: 'date' }, { label: 'Minimum Due', type: 'currency' }, { label: 'Credit Limit', type: 'currency' }],
  investment:   [{ label: 'Portfolio Value', type: 'currency' }, { label: 'Daily Change', type: 'currency' }],
  utility:      [{ label: 'Amount Due', type: 'currency' }, { label: 'Due Date', type: 'date' }],
  subscription: [{ label: 'Monthly Amount', type: 'currency' }, { label: 'Next Bill Date', type: 'date' }],
  phone:        [{ label: 'Monthly Bill', type: 'currency' }, { label: 'Due Date', type: 'date' }, { label: 'Account Number', type: 'text' }],
  loan:         [{ label: 'Remaining Balance', type: 'currency' }, { label: 'Monthly Payment', type: 'currency' }, { label: 'Due Date', type: 'date' }],
  car_lease:    [{ label: 'Monthly Payment', type: 'currency' }, { label: 'Due Date', type: 'date' }, { label: 'Remaining Payments', type: 'number' }, { label: 'Lease End Date', type: 'date' }],
  car_insurance:[{ label: 'Monthly Premium', type: 'currency' }, { label: 'Due Date', type: 'date' }, { label: 'Policy Number', type: 'text' }, { label: 'Coverage End Date', type: 'date' }],
  other:        [{ label: 'Amount', type: 'currency' }],
};

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

// ─── Add/Edit Account Modal ───────────────────────────────────────────────────
function AccountModal({ visible, onClose, onSave, existing, isMobile }) {
  const isEdit = !!existing;
  const typeObj = existing ? ACCT_TYPES.find(t => t.id === existing.type) : null;

  const [name, setName] = useState(existing?.name || '');
  const [type, setType] = useState(existing?.type || 'checking');
  const [lastFour, setLastFour] = useState(existing?.lastFour || '');
  const [color, setColor] = useState(existing?.color || PALETTE[0]);
  const [icon, setIcon] = useState(existing?.icon || '');
  const [fields, setFields] = useState(existing?.fields || []);
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
function AccountCard({ account, onEdit, onDelete, color, isMobile }) {
  return (
    <View style={[c.card, isMobile && c.cardMobile]}>
      <View style={c.left}>
        <View style={[c.icon, { backgroundColor: color + '20' }]}>
          <Text style={c.iconTxt}>{account.icon || '🏦'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={c.name}>{account.name}</Text>
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
        </View>
      </View>
      <View style={[c.actions, isMobile && c.actionsMobile]}>
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
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const [showAdd, setShowAdd] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);

  const handleAdd = async (data) => {
    await addAccount(data);
    setShowAdd(false);
  };

  const handleEdit = async (data) => {
    if (!editingAccount) return;
    await updateAccount(editingAccount.id, data);
    setEditingAccount(null);
  };

  const handleDelete = (account) => {
    Alert.alert(
      'Delete Account',
      `Are you sure you want to delete "${account.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteAccount(account.id) },
      ]
    );
  };

  return (
    <ScrollView style={sc.screen} contentContainerStyle={[sc.content, isMobile && sc.contentMobile]}>
      {/* Header */}
      <View style={[sc.header, isMobile && sc.headerMobile]}>
        <View>
          <Text style={sc.title}>Accounts</Text>
          <Text style={sc.subtitle}>Manage your tracked accounts and their fields</Text>
        </View>
        <TouchableOpacity style={[sc.addBtn, isMobile && sc.addBtnMobile]} onPress={() => setShowAdd(true)}>
          <Text style={sc.addTxt}>+ Add Account</Text>
        </TouchableOpacity>
      </View>

      {/* Empty state */}
      {accounts.length === 0 && (
        <View style={sc.empty}>
          <Text style={sc.emptyIcon}>🏦</Text>
          <Text style={sc.emptyTitle}>No accounts yet</Text>
          <Text style={sc.emptyMsg}>
            Add your first account to start tracking balances, due dates, and more with DARS.
          </Text>
          <TouchableOpacity style={sc.emptyBtn} onPress={() => setShowAdd(true)}>
            <Text style={sc.emptyBtnTxt}>Add Your First Account</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Account list */}
      {accounts.map((account, idx) => (
        <AccountCard
          key={account.id}
          account={account}
          color={account.color || ACCT_COLORS[idx % ACCT_COLORS.length]}
          onEdit={() => setEditingAccount(account)}
          onDelete={() => handleDelete(account)}
          isMobile={isMobile}
        />
      ))}

      {/* Modals */}
      <AccountModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={handleAdd}
        existing={null}
        isMobile={isMobile}
      />
      {editingAccount && (
        <AccountModal
          visible={true}
          onClose={() => setEditingAccount(null)}
          onSave={handleEdit}
          existing={editingAccount}
          isMobile={isMobile}
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
  empty: { alignItems: 'center', paddingVertical: 80 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 8 },
  emptyMsg: { fontSize: 15, color: C.muted, textAlign: 'center', maxWidth: 360, lineHeight: 22, marginBottom: 28 },
  emptyBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  emptyBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
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
  editBtn: { borderWidth: 1, borderColor: C.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  editTxt: { fontSize: 13, color: C.primary, fontWeight: '600' },
  delBtn: { borderWidth: 1, borderColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#FEF2F2' },
  delTxt: { fontSize: 13, color: C.bills, fontWeight: '600' },
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
