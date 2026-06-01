import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, useWindowDimensions, Modal,
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
};

const SHIFTS = [
  { id: '8am-8pm',   label: '8am – 8pm',   start: 8,  color: '#3B82F6' },
  { id: '8pm-8am',   label: '8pm – 8am',   start: 20, color: '#8B5CF6' },
  { id: '3pm-11pm',  label: '3pm – 11pm',  start: 15, color: '#F59E0B' },
  { id: '7am-3pm',   label: '7am – 3pm',   start: 7,  color: '#22C55E' },
  { id: '11pm-7am',  label: '11pm – 7am',  start: 23, color: '#EF4444' },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

function pad(n) { return String(n).padStart(2, '0'); }

function dateStr(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function getShiftById(id) {
  return SHIFTS.find(s => s.id === id);
}

// ─── Phone Settings Modal ────────────────────────────────────────────────────
function PhoneModal({ visible, currentPhone, onSave, onClose }) {
  const [phone, setPhone] = useState(currentPhone || '');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={m.overlay} onPress={onClose} activeOpacity={1}>
        <TouchableOpacity activeOpacity={1} style={m.box}>
          <Text style={m.title}>SMS Reminder Phone</Text>
          <Text style={m.desc}>Enter your phone number to receive a text 12 hours before each shift.</Text>
          <TextInput
            style={m.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 (555) 000-0000"
            placeholderTextColor={C.faint}
            keyboardType="phone-pad"
            autoFocus
          />
          <View style={m.actions}>
            <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
              <Text style={m.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={m.saveBtn} onPress={() => { onSave(phone); onClose(); }}>
              <Text style={m.saveTxt}>Save</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Calendar Day Cell ───────────────────────────────────────────────────────
function DayCell({ day, year, month, entry, activeShift, location, onPress, onDelete, isMobile }) {
  const shift = entry ? getShiftById(entry.shift) : null;
  const isEmpty = !entry;
  const isClickable = !!activeShift;

  return (
    <TouchableOpacity
      style={[
        dc.cell,
        isMobile && dc.cellMobile,
        isClickable && isEmpty && dc.cellClickable,
        !day && dc.cellEmpty,
      ]}
      onPress={() => day && onPress(day)}
      activeOpacity={day ? 0.7 : 1}
      disabled={!day}
    >
      {day ? (
        <>
          <Text style={[dc.dayNum, shift && { color: shift.color }]}>{day}</Text>
          {shift && (
            <View style={[dc.shiftTag, { backgroundColor: shift.color + '20', borderColor: shift.color }]}>
              <Text style={[dc.shiftTxt, { color: shift.color }]} numberOfLines={1}>
                {shift.label}
              </Text>
              {entry.location ? (
                <Text style={[dc.locTxt, { color: shift.color }]} numberOfLines={1}>
                  📍 {entry.location}
                </Text>
              ) : null}
              <TouchableOpacity style={dc.xBtn} onPress={() => onDelete(day)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={[dc.xTxt, { color: shift.color }]}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          {isClickable && isEmpty && (
            <Text style={dc.addHint}>+</Text>
          )}
        </>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function WorkScreen() {
  const { workSchedule, setWorkShift, deleteWorkShift, saveUserName, userName } = useApp();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [activeShift, setActiveShift] = useState(null);
  const [location, setLocation] = useState('');
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const handleDayPress = useCallback((day) => {
    if (!activeShift) return;
    const ds = dateStr(year, month, day);
    setWorkShift(ds, activeShift, location);
  }, [activeShift, location, year, month, setWorkShift]);

  const handleDelete = useCallback((day) => {
    const ds = dateStr(year, month, day);
    deleteWorkShift(ds);
  }, [year, month, deleteWorkShift]);

  const handleSavePhone = useCallback((phone) => {
    setPhoneNumber(phone);
    // Save to Firebase settings
    const { db } = require('../config/firebase');
    const { doc, setDoc } = require('firebase/firestore');
    setDoc(doc(db, 'settings', 'app'), { phoneNumber: phone }, { merge: true });
  }, []);

  // Build calendar grid: array of {day or null}
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Shift counts for the month
  const monthEntries = Object.values(workSchedule).filter(e => {
    const [y, mo] = e.date.split('-').map(Number);
    return y === year && mo === month + 1;
  });

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, isMobile && s.contentMobile]} showsVerticalScrollIndicator={false}>

      {/* Header */}
      <View style={[s.header, isMobile && s.headerMobile]}>
        <View>
          <Text style={[s.title, isMobile && s.titleMobile]}>💼 Work Schedule</Text>
          <Text style={s.sub}>{monthEntries.length} shift{monthEntries.length !== 1 ? 's' : ''} this month</Text>
        </View>
        <TouchableOpacity style={s.phoneBtn} onPress={() => setShowPhoneModal(true)}>
          <Text style={s.phoneBtnTxt}>📱 SMS Reminders</Text>
        </TouchableOpacity>
      </View>

      {/* Location + Month Nav */}
      <View style={[s.controlRow, isMobile && s.controlRowMobile]}>
        <View style={s.locationWrap}>
          <Text style={s.locationLabel}>📍 Location</Text>
          <TextInput
            style={s.locationInput}
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Main Hospital, Floor 3"
            placeholderTextColor={C.faint}
          />
        </View>
        <View style={s.monthNav}>
          <TouchableOpacity style={s.navBtn} onPress={prevMonth}>
            <Text style={s.navBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.monthLabel}>{MONTHS[month]} {year}</Text>
          <TouchableOpacity style={s.navBtn} onPress={nextMonth}>
            <Text style={s.navBtnTxt}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Shift Selector */}
      <View style={s.shiftRow}>
        <Text style={s.shiftPickLabel}>Select shift to apply:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shiftScrollContent}>
          {SHIFTS.map(shift => {
            const active = activeShift === shift.id;
            return (
              <TouchableOpacity
                key={shift.id}
                style={[s.shiftChip, { borderColor: shift.color }, active && { backgroundColor: shift.color }]}
                onPress={() => setActiveShift(active ? null : shift.id)}
                activeOpacity={0.8}
              >
                <Text style={[s.shiftChipTxt, { color: active ? '#fff' : shift.color }]}>
                  {shift.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      {activeShift && (
        <Text style={s.hint}>Tap any day to assign <Text style={{ fontWeight: '700', color: getShiftById(activeShift)?.color }}>{getShiftById(activeShift)?.label}</Text></Text>
      )}

      {/* Calendar */}
      <View style={s.calCard}>
        {/* Day headers */}
        <View style={s.dayHeaders}>
          {DAYS.map(d => (
            <View key={d} style={s.dayHeaderCell}>
              <Text style={s.dayHeaderTxt}>{isMobile ? d[0] : d}</Text>
            </View>
          ))}
        </View>

        {/* Grid */}
        <View style={s.grid}>
          {cells.map((day, i) => {
            const ds = day ? dateStr(year, month, day) : null;
            const entry = ds ? workSchedule[ds] : null;
            return (
              <View key={i} style={[s.cellWrapper, isMobile && s.cellWrapperMobile]}>
                <DayCell
                  day={day}
                  year={year}
                  month={month}
                  entry={entry}
                  activeShift={activeShift}
                  location={location}
                  onPress={handleDayPress}
                  onDelete={handleDelete}
                  isMobile={isMobile}
                />
              </View>
            );
          })}
        </View>
      </View>

      {/* Legend */}
      <View style={s.legend}>
        {SHIFTS.map(shift => (
          <View key={shift.id} style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: shift.color }]} />
            <Text style={s.legendTxt}>{shift.label}</Text>
          </View>
        ))}
      </View>

      <PhoneModal
        visible={showPhoneModal}
        currentPhone={phoneNumber}
        onSave={handleSavePhone}
        onClose={() => setShowPhoneModal(false)}
      />
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 28 },
  contentMobile: { padding: 12 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  headerMobile: { marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '700', color: C.text },
  titleMobile: { fontSize: 20 },
  sub: { fontSize: 13, color: C.muted, marginTop: 3 },

  phoneBtn: { backgroundColor: C.primaryLight, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  phoneBtnTxt: { fontSize: 13, fontWeight: '600', color: C.primary },

  controlRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-end', marginBottom: 18 },
  controlRowMobile: { flexDirection: 'column', gap: 12 },

  locationWrap: { flex: 1 },
  locationLabel: { fontSize: 12, fontWeight: '600', color: C.muted, marginBottom: 6 },
  locationInput: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: C.text, backgroundColor: C.card,
  },

  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  navBtnTxt: { fontSize: 20, color: C.primary, fontWeight: '700', lineHeight: 24 },
  monthLabel: { fontSize: 16, fontWeight: '700', color: C.text, minWidth: 140, textAlign: 'center' },

  shiftRow: { marginBottom: 8 },
  shiftPickLabel: { fontSize: 12, fontWeight: '600', color: C.muted, marginBottom: 8 },
  shiftScrollContent: { gap: 8, paddingBottom: 4 },
  shiftChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 2, backgroundColor: C.card,
  },
  shiftChipTxt: { fontSize: 13, fontWeight: '600' },

  hint: { fontSize: 12, color: C.muted, marginBottom: 14, fontStyle: 'italic' },

  calCard: {
    backgroundColor: C.card, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
    marginBottom: 20,
  },

  dayHeaders: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.primaryLight },
  dayHeaderCell: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  dayHeaderTxt: { fontSize: 12, fontWeight: '700', color: C.primary },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellWrapper: { width: '14.2857%', borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.border },
  cellWrapperMobile: {},

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { fontSize: 12, color: C.muted },
});

const dc = StyleSheet.create({
  cell: { minHeight: 90, padding: 6 },
  cellMobile: { minHeight: 60 },
  cellEmpty: { backgroundColor: 'transparent' },
  cellClickable: { backgroundColor: '#F0F4FF' },
  dayNum: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 4 },
  shiftTag: {
    borderRadius: 6, borderWidth: 1, padding: 4, gap: 2,
    position: 'relative',
  },
  shiftTxt: { fontSize: 10, fontWeight: '700' },
  locTxt: { fontSize: 9, fontWeight: '500' },
  xBtn: { position: 'absolute', top: 2, right: 2 },
  xTxt: { fontSize: 10, fontWeight: '700' },
  addHint: { fontSize: 18, color: C.primary, textAlign: 'center', marginTop: 4, opacity: 0.4 },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: C.card, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
  title: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 8 },
  desc: { fontSize: 13, color: C.muted, marginBottom: 18, lineHeight: 19 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.text, marginBottom: 16, backgroundColor: C.bg },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.bg },
  cancelTxt: { color: C.muted, fontWeight: '600', fontSize: 14 },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: C.primary },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
