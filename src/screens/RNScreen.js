import React, { useState } from 'react';
import {
  View, Text, ScrollView, TextInput, Modal,
  TouchableOpacity, StyleSheet, Switch, useWindowDimensions,
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
  green: '#22C55E',
  red: '#EF4444',
  orange: '#F59E0B',
};

// ─── Edit Modal ─────────────────────────────────────────────────────────────
function RNEditModal({ visible, profile, onSave, onClose }) {
  const [form, setForm] = useState({
    licenseNumber: profile.licenseNumber || '',
    expiration: profile.expiration || '',
    state: profile.state || '',
    compact: profile.compact || false,
    ceCredits: profile.ceCredits || '',
    ceRequired: profile.ceRequired || '',
    notes: profile.notes || '',
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={m.overlay} onPress={onClose} activeOpacity={1}>
        <TouchableOpacity activeOpacity={1} style={m.box}>
          <Text style={m.title}>RN License Details</Text>

          <Text style={m.label}>License Number</Text>
          <TextInput
            style={m.input}
            value={form.licenseNumber}
            onChangeText={v => set('licenseNumber', v)}
            placeholder="e.g. RN-1234567"
            placeholderTextColor={C.faint}
            autoFocus
          />

          <Text style={m.label}>Expiration Date</Text>
          <TextInput
            style={m.input}
            value={form.expiration}
            onChangeText={v => set('expiration', v)}
            placeholder="MM/DD/YYYY"
            placeholderTextColor={C.faint}
          />

          <Text style={m.label}>State</Text>
          <TextInput
            style={m.input}
            value={form.state}
            onChangeText={v => set('state', v)}
            placeholder="e.g. NY"
            placeholderTextColor={C.faint}
            autoCapitalize="characters"
          />

          <View style={m.switchRow}>
            <Text style={m.switchLabel}>Compact License</Text>
            <Switch
              value={form.compact}
              onValueChange={v => set('compact', v)}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#fff"
            />
          </View>

          <Text style={m.label}>CE Credits Completed</Text>
          <TextInput
            style={m.input}
            value={form.ceCredits}
            onChangeText={v => set('ceCredits', v)}
            placeholder="e.g. 18"
            placeholderTextColor={C.faint}
            keyboardType="number-pad"
          />

          <Text style={m.label}>CE Credits Required</Text>
          <TextInput
            style={m.input}
            value={form.ceRequired}
            onChangeText={v => set('ceRequired', v)}
            placeholder="e.g. 30"
            placeholderTextColor={C.faint}
            keyboardType="number-pad"
          />

          <Text style={m.label}>Notes</Text>
          <TextInput
            style={[m.input, m.textarea]}
            value={form.notes}
            onChangeText={v => set('notes', v)}
            placeholder="Any additional notes..."
            placeholderTextColor={C.faint}
            multiline
          />

          <View style={m.actions}>
            <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
              <Text style={m.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={m.saveBtn} onPress={() => { onSave(form); onClose(); }}>
              <Text style={m.saveTxt}>Save</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Info Row ───────────────────────────────────────────────────────────────
function InfoRow({ label, value, color }) {
  return (
    <View style={r.row}>
      <Text style={r.label}>{label}</Text>
      <Text style={[r.value, color && { color }]}>{value || '—'}</Text>
    </View>
  );
}

// ─── CE Progress Bar ────────────────────────────────────────────────────────
function CEProgress({ completed, required }) {
  const c = parseInt(completed) || 0;
  const r2 = parseInt(required) || 0;
  const pct = r2 > 0 ? Math.min(c / r2, 1) : 0;
  const color = pct >= 1 ? C.green : pct >= 0.5 ? C.orange : C.red;

  return (
    <View style={ce.wrap}>
      <View style={ce.header}>
        <Text style={ce.label}>CE Credits Progress</Text>
        <Text style={[ce.count, { color }]}>{c} / {r2 || '?'}</Text>
      </View>
      <View style={ce.track}>
        <View style={[ce.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function daysUntilExpiry(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const d = new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}T00:00:00`);
  if (isNaN(d)) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}

// ─── Main Screen ────────────────────────────────────────────────────────────
export default function RNScreen() {
  const { rnProfile, saveRNProfile } = useApp();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const [editVisible, setEditVisible] = useState(false);

  const days = daysUntilExpiry(rnProfile.expiration);
  const expiryColor = days === null ? C.muted : days < 30 ? C.red : days < 90 ? C.orange : C.green;
  const expiryLabel = days === null ? '—' : days < 0 ? 'Expired' : `${days}d`;

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={[s.content, isMobile && s.contentMobile]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[s.header, isMobile && s.headerMobile]}>
        <View>
          <Text style={[s.title, isMobile && s.titleMobile]}>🏥 RN License</Text>
          <Text style={s.sub}>Registered Nurse License Tracker</Text>
        </View>
        <TouchableOpacity style={s.editBtn} onPress={() => setEditVisible(true)}>
          <Text style={s.editBtnTxt}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* License Card */}
      <TouchableOpacity
        style={[s.card, isMobile && s.cardMobile]}
        onPress={() => setEditVisible(true)}
        activeOpacity={0.85}
      >
        {/* Left: license badge */}
        <View style={s.badge}>
          <Text style={s.badgeIcon}>🏥</Text>
          <Text style={s.badgeTitle}>RN</Text>
          <Text style={s.badgeSub}>{rnProfile.state || '??'}</Text>
          {rnProfile.compact && (
            <View style={s.compactTag}>
              <Text style={s.compactTxt}>COMPACT</Text>
            </View>
          )}
        </View>

        {/* Right: details */}
        <View style={s.details}>
          <InfoRow label="License #" value={rnProfile.licenseNumber} />
          <InfoRow label="Expiration" value={rnProfile.expiration} color={expiryColor} />
          <InfoRow label="State" value={rnProfile.state} />
          <View style={r.row}>
            <Text style={r.label}>Days to Expiry</Text>
            <Text style={[r.value, { color: expiryColor, fontWeight: '800' }]}>{expiryLabel}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* CE Progress */}
      <View style={s.ceCard}>
        <CEProgress completed={rnProfile.ceCredits} required={rnProfile.ceRequired} />
      </View>

      {/* Notes */}
      {!!rnProfile.notes && (
        <View style={s.notesCard}>
          <Text style={s.notesLabel}>Notes</Text>
          <Text style={s.notesText}>{rnProfile.notes}</Text>
        </View>
      )}

      {/* Empty state hint */}
      {!rnProfile.licenseNumber && (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🏥</Text>
          <Text style={s.emptyTitle}>No license info yet</Text>
          <Text style={s.emptySub}>Tap "Edit" to add your RN license details.</Text>
        </View>
      )}

      <RNEditModal
        visible={editVisible}
        profile={rnProfile}
        onSave={saveRNProfile}
        onClose={() => setEditVisible(false)}
      />
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 28 },
  contentMobile: { padding: 16 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  headerMobile: { marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '700', color: C.text },
  titleMobile: { fontSize: 20 },
  sub: { fontSize: 14, color: C.muted, marginTop: 4 },

  editBtn: { backgroundColor: C.primaryLight, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  editBtnTxt: { fontSize: 13, fontWeight: '600', color: C.primary },

  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 20,
    flexDirection: 'row',
    gap: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardMobile: { flexDirection: 'column' },

  badge: {
    width: 120,
    backgroundColor: C.primary,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  badgeIcon: { fontSize: 28 },
  badgeTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  badgeSub: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  compactTag: {
    marginTop: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  compactTxt: { fontSize: 10, fontWeight: '700', color: '#fff' },

  details: { flex: 1, justifyContent: 'center', gap: 2 },

  ceCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  notesCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  notesLabel: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 8 },
  notesText: { fontSize: 14, color: C.text, lineHeight: 20 },

  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: C.text, marginBottom: 6 },
  emptySub: { fontSize: 14, color: C.muted, textAlign: 'center' },
});

const r = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { fontSize: 13, color: C.muted, fontWeight: '500' },
  value: { fontSize: 14, fontWeight: '700', color: C.text },
});

const ce = StyleSheet.create({
  wrap: {},
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  label: { fontSize: 14, fontWeight: '600', color: C.text },
  count: { fontSize: 15, fontWeight: '800' },
  track: { height: 10, backgroundColor: C.bg, borderRadius: 6, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 6 },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: C.card, borderRadius: 20, padding: 24, width: '100%', maxWidth: 380 },
  title: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text, marginBottom: 14, backgroundColor: C.bg },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  switchLabel: { fontSize: 14, fontWeight: '600', color: C.text },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8, justifyContent: 'flex-end' },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.bg },
  cancelTxt: { color: C.muted, fontWeight: '600', fontSize: 14 },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: C.primary },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
