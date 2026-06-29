import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, Modal,
  TouchableOpacity, StyleSheet, useWindowDimensions,
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

const ACCT_COLORS = ['#3B82F6','#A855F7','#F59E0B','#22C55E','#EF4444','#06B6D4'];

const ACCOUNT_GROUPS = [
  { title: 'Banks',        types: ['checking', 'savings', 'investment'] },
  { title: 'Credit Cards', types: ['credit'] },
  { title: 'Car',          types: ['car_lease', 'car_insurance'] },
  { title: 'Phone',        types: ['phone'] },
  { title: 'Loans',        types: ['loan'] },
  { title: 'Other',        types: ['utility', 'subscription', 'other'] },
];

function todayReadable() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function DayPicker({ visible, selected, onSelect, onClose }) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const rows = [];
  for (let i = 0; i < 31; i += 7) rows.push(days.slice(i, Math.min(i + 7, 31)));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={dp.overlay} onPress={onClose} activeOpacity={1}>
        <View style={dp.box}>
          <Text style={dp.title}>Select Day</Text>
          {rows.map((row, ri) => (
            <View key={ri} style={dp.row}>
              {row.map(day => {
                const sel = selected === String(day);
                return (
                  <TouchableOpacity
                    key={day}
                    style={[dp.cell, sel && dp.cellSel]}
                    onPress={() => { onSelect(String(day)); onClose(); }}
                  >
                    <Text style={[dp.cellTxt, sel && dp.cellTxtSel]}>{day}</Text>
                  </TouchableOpacity>
                );
              })}
              {row.length < 7 && Array.from({ length: 7 - row.length }).map((_, i) => (
                <View key={`e${i}`} style={dp.cell} />
              ))}
            </View>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function AccountEntry({ account, values, onChange, color, isMobile }) {
  const [pickerFieldId, setPickerFieldId] = useState(null);

  return (
    <View style={s.acctCard}>
      <DayPicker
        visible={pickerFieldId !== null}
        selected={pickerFieldId !== null ? values?.[pickerFieldId] : undefined}
        onSelect={day => onChange(pickerFieldId, day)}
        onClose={() => setPickerFieldId(null)}
      />
      <View style={s.acctHeader}>
        <View style={[s.acctIcon, { backgroundColor: color + '20' }]}>
          <Text style={s.acctIconTxt}>{account.icon || '🏦'}</Text>
        </View>
        <View>
          <Text style={s.acctName}>{account.name}</Text>
          <Text style={s.acctType}>{account.type}{account.lastFour ? ` •••• ${account.lastFour}` : ''}</Text>
        </View>
      </View>

      <View style={s.fields}>
        {(account.fields || []).map(field => (
          <View key={field.id} style={[s.fieldRow, isMobile && s.fieldRowMobile]}>
            <Text style={[s.fieldLabel, isMobile && s.fieldLabelMobile]}>{field.label}</Text>
            {field.type === 'date' ? (
              <TouchableOpacity
                style={[s.fieldInput, isMobile && s.fieldInputMobile, s.dayTouchable]}
                onPress={() => setPickerFieldId(field.id)}
              >
                <Text style={values?.[field.id] ? s.dayVal : s.dayPlaceholder}>
                  {values?.[field.id] ? `Day ${values[field.id]}` : 'Tap to select'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TextInput
                style={[s.fieldInput, isMobile && s.fieldInputMobile]}
                value={values?.[field.id] !== undefined ? String(values[field.id]) : ''}
                onChangeText={v => onChange(field.id, v)}
                keyboardType={field.type === 'currency' || field.type === 'number' ? 'decimal-pad' : 'default'}
                placeholder={field.type === 'currency' ? '0.00' : '—'}
                placeholderTextColor={C.faint}
              />
            )}
            {!isMobile && field.type === 'currency' && <Text style={s.fieldPrefix}>$</Text>}
          </View>
        ))}
        {(!account.fields || account.fields.length === 0) && (
          <Text style={s.noFields}>No fields defined. Edit this account to add fields.</Text>
        )}
      </View>
    </View>
  );
}

function SubmittedView({ darsEntry, accounts, onEdit }) {
  const getVal = (accountId, fieldId) => {
    return darsEntry?.entries?.[accountId]?.[fieldId];
  };

  const ACCT_COLORS = ['#3B82F6','#A855F7','#F59E0B','#22C55E','#EF4444','#06B6D4'];

  return (
    <View style={sv.container}>
      <View style={sv.successBadge}>
        <Text style={sv.successIcon}>✓</Text>
        <Text style={sv.successTxt}>DARS submitted for today</Text>
      </View>
      <Text style={sv.submittedAt}>
        {darsEntry?.submittedAt ? 'Submitted successfully' : 'Saved'}
      </Text>

      {ACCOUNT_GROUPS.map(group => {
        const groupAccts = accounts.filter(a => group.types.includes(a.type));
        if (groupAccts.length === 0) return null;
        return (
          <View key={group.title}>
            <Text style={sv.groupHeader}>{group.title}</Text>
            {groupAccts.map((acc, gi) => {
              const idx = accounts.indexOf(acc);
              const col = acc.color || ACCT_COLORS[idx % ACCT_COLORS.length];
              return (
                <View key={acc.id} style={sv.card}>
                  <View style={sv.cardHeader}>
                    <View style={[sv.icon, { backgroundColor: col + '20' }]}>
                      <Text style={sv.iconTxt}>{acc.icon || '🏦'}</Text>
                    </View>
                    <Text style={sv.acctName}>{acc.name}</Text>
                  </View>
                  {(acc.fields || []).map(field => {
                    const val = getVal(acc.id, field.id);
                    return (
                      <View key={field.id} style={sv.row}>
                        <Text style={sv.fieldLabel}>{field.label}</Text>
                        <Text style={[sv.fieldVal, field.type === 'currency' && val < 0 && { color: C.bills }]}>
                          {field.type === 'currency' && val !== undefined
                            ? (val < 0 ? `-$${Math.abs(val).toLocaleString('en-US', {minimumFractionDigits:2})}` : `$${parseFloat(val || 0).toLocaleString('en-US', {minimumFractionDigits:2})}`)
                            : val !== undefined ? String(val) : '—'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        );
      })}

      <TouchableOpacity style={sv.editBtn} onPress={onEdit}>
        <Text style={sv.editTxt}>Edit Today's Entry</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function DARSScreen() {
  const { accounts, saveDars, getTodaysDars, setCurrentScreen } = useApp();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const todaysDars = getTodaysDars();
  const [values, setValues] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    if (todaysDars) {
      setValues(todaysDars.entries || {});
      setSubmitted(true);
    } else {
      setSubmitted(false);
      setValues({});
    }
  }, [todaysDars]);

  const handleChange = (accountId, fieldId, val) => {
    setValues(prev => ({
      ...prev,
      [accountId]: { ...(prev[accountId] || {}), [fieldId]: val },
    }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await saveDars(values);
      setSubmitted(true);
      setEditMode(false);
      setCurrentScreen('dashboard');
    } finally {
      setSaving(false);
    }
  };

  const showForm = !submitted || editMode;

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, isMobile && s.contentMobile]}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>DARS</Text>
          <Text style={s.subtitle}>Daily Account Review Sheet</Text>
          <Text style={s.date}>{todayReadable()}</Text>
        </View>
      </View>

      {accounts.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={s.emptyIcon}>🏦</Text>
          <Text style={s.emptyTitle}>No Accounts Yet</Text>
          <Text style={s.emptyMsg}>Go to Accounts to add your first account before filling out DARS.</Text>
          <TouchableOpacity style={s.emptyBtn} onPress={() => setCurrentScreen('accounts')}>
            <Text style={s.emptyBtnTxt}>Go to Accounts</Text>
          </TouchableOpacity>
        </View>
      ) : submitted && !editMode ? (
        <SubmittedView
          darsEntry={todaysDars}
          accounts={accounts}
          onEdit={() => setEditMode(true)}
        />
      ) : (
        <>
          <View style={s.intro}>
            <Text style={s.introTxt}>
              {editMode ? 'Edit your entries below, then save.' : 'Fill in the current values for each of your accounts, then submit.'}
            </Text>
          </View>

          {ACCOUNT_GROUPS.map(group => {
            const groupAccts = accounts.filter(a => group.types.includes(a.type));
            if (groupAccts.length === 0) return null;
            return (
              <View key={group.title}>
                <Text style={s.groupHeader}>{group.title}</Text>
                {groupAccts.map(acc => {
                  const idx = accounts.indexOf(acc);
                  return (
                    <AccountEntry
                      key={acc.id}
                      account={acc}
                      values={values[acc.id]}
                      onChange={(fieldId, val) => handleChange(acc.id, fieldId, val)}
                      color={acc.color || ACCT_COLORS[idx % ACCT_COLORS.length]}
                      isMobile={isMobile}
                    />
                  );
                })}
              </View>
            );
          })}

          <View style={s.footer}>
            {editMode && (
              <TouchableOpacity style={s.cancelBtn} onPress={() => setEditMode(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.submitBtn, saving && s.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={saving}
            >
              <Text style={s.submitTxt}>{saving ? 'Saving…' : editMode ? 'Save Changes' : 'Submit DARS ✓'}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 28, paddingBottom: 60 },
  contentMobile: { padding: 16, paddingBottom: 80 },
  header: { marginBottom: 28 },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 15, color: C.primary, fontWeight: '600', marginTop: 2 },
  date: { fontSize: 14, color: C.muted, marginTop: 4 },
  intro: { backgroundColor: C.primaryLight, borderRadius: 12, padding: 14, marginBottom: 20 },
  introTxt: { fontSize: 14, color: C.primary, fontWeight: '500' },
  acctCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: {width:0,height:2}, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  acctHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  acctIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  acctIconTxt: { fontSize: 20 },
  acctName: { fontSize: 16, fontWeight: '700', color: C.text },
  acctType: { fontSize: 13, color: C.faint, marginTop: 2, textTransform: 'capitalize' },
  fields: { gap: 12 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldRowMobile: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  fieldLabel: { width: 140, fontSize: 14, color: C.muted, fontWeight: '500' },
  fieldLabelMobile: { width: 'auto', fontSize: 13 },
  fieldInput: {
    flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.text,
    backgroundColor: '#FAFAFA',
  },
  fieldInputMobile: { flex: undefined, width: '100%' },
  fieldPrefix: { fontSize: 15, color: C.faint, position: 'absolute', left: 154, top: 10 },
  noFields: { fontSize: 13, color: C.faint, textAlign: 'center', paddingVertical: 8 },
  dayTouchable: { justifyContent: 'center' },
  dayVal: { fontSize: 15, color: C.text },
  dayPlaceholder: { fontSize: 15, color: C.faint },
  footer: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 28 },
  cancelTxt: { fontSize: 16, color: C.muted, fontWeight: '500' },
  submitBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.6 },
  submitTxt: { fontSize: 16, color: '#fff', fontWeight: '700' },
  groupHeader: { fontSize: 12, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 10 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 8 },
  emptyMsg: { fontSize: 15, color: C.muted, textAlign: 'center', maxWidth: 320, lineHeight: 22 },
  emptyBtn: { marginTop: 24, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  emptyBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

const sv = StyleSheet.create({
  container: {},
  groupHeader: { fontSize: 12, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 10 },
  successBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ECFDF5', borderRadius: 12, padding: 16, marginBottom: 8 },
  successIcon: { fontSize: 20, color: '#22C55E' },
  successTxt: { fontSize: 16, color: '#22C55E', fontWeight: '700' },
  submittedAt: { fontSize: 13, color: C.faint, marginBottom: 20 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOffset: {width:0,height:2}, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 18 },
  acctName: { fontSize: 16, fontWeight: '700', color: C.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  fieldLabel: { fontSize: 14, color: C.muted },
  fieldVal: { fontSize: 14, fontWeight: '600', color: C.text },
  editBtn: { borderWidth: 1, borderColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  editTxt: { fontSize: 15, color: C.primary, fontWeight: '600' },
});

const dp = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  box: { backgroundColor: '#fff', borderRadius: 18, padding: 20, width: 300, shadowColor: '#000', shadowOffset: {width:0,height:4}, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8 },
  title: { fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 6 },
  cell: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  cellSel: { backgroundColor: C.primary },
  cellTxt: { fontSize: 13, fontWeight: '600', color: C.text },
  cellTxtSel: { color: '#fff' },
});
