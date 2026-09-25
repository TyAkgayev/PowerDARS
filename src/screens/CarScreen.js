import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TextInput, Modal,
  TouchableOpacity, StyleSheet, useWindowDimensions, Image, ActivityIndicator,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { authedFetch } from '../utils/api';
import { enableCourtReminders, checkCourtRemindersEnabled } from '../utils/pushNotifications';

const CHECK_LICENSE_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/checkLicenseStatus';
const POLL_LICENSE_STATUS_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/pollLicenseStatus';
const SEND_TEST_NOTIFICATION_URL = 'https://us-central1-dars-4e5d0.cloudfunctions.net/sendTestNotification';
const TEST_NOTIFICATION_DELAY_SECONDS = 15;
const POLL_INTERVAL_MS = 4000;

const CAR_IMAGES = {
  bmw:    require('../../assets/bmw.jpg'),
  nissan: require('../../assets/nissan.jpg'),
};

function resolveCarImage(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes('bmw'))    return CAR_IMAGES.bmw;
  if (lower.includes('nissan')) return CAR_IMAGES.nissan;
  return null;
}

function licenseStatusColor(status) {
  if (!status) return '#4361EE';
  const s = status.toLowerCase();
  if (s.includes('valid') || s.includes('active')) return '#22C55E';
  if (s.includes('suspend') || s.includes('revoke') || s.includes('expire')) return '#EF4444';
  return '#F59E0B';
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
  green: '#22C55E',
  red: '#EF4444',
  orange: '#F59E0B',
};

// ─── Car Modal (Add / Edit) ─────────────────────────────────────────────────
function CarModal({ visible, car, onSave, onDelete, onClose }) {
  const isEdit = !!car;
  const [form, setForm] = useState(
    car ? { name: car.name || '', leases: car.leases || '', mileages: car.mileages || '', allowed: car.allowed || '' }
        : { name: '', leases: '', mileages: '', allowed: '' }
  );

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave(form);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={m.overlay} onPress={onClose} activeOpacity={1}>
        <TouchableOpacity activeOpacity={1} style={m.box}>
          <Text style={m.title}>{isEdit ? 'Edit Car' : 'Add Car'}</Text>

          <Text style={m.label}>Car Name / Make</Text>
          <TextInput
            style={m.input}
            value={form.name}
            onChangeText={v => set('name', v)}
            placeholder="e.g. BMW, Nissan"
            placeholderTextColor={C.faint}
            autoFocus
          />

          <Text style={m.label}>Monthly Lease ($)</Text>
          <TextInput
            style={m.input}
            value={form.leases}
            onChangeText={v => set('leases', v)}
            placeholder="e.g. 450"
            placeholderTextColor={C.faint}
            keyboardType="decimal-pad"
          />

          <Text style={m.label}>Current Mileage</Text>
          <TextInput
            style={m.input}
            value={form.mileages}
            onChangeText={v => set('mileages', v)}
            placeholder="e.g. 24500"
            placeholderTextColor={C.faint}
            keyboardType="number-pad"
          />

          <Text style={m.label}>Mileage Allowed / Year</Text>
          <TextInput
            style={m.input}
            value={form.allowed}
            onChangeText={v => set('allowed', v)}
            placeholder="e.g. 36000"
            placeholderTextColor={C.faint}
            keyboardType="number-pad"
          />

          <View style={m.actions}>
            {isEdit && (
              <TouchableOpacity style={m.deleteBtn} onPress={() => { onDelete(); onClose(); }}>
                <Text style={m.deleteTxt}>Delete</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
              <Text style={m.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={m.saveBtn} onPress={handleSave}>
              <Text style={m.saveTxt}>{isEdit ? 'Save' : 'Add'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Car Card ──────────────────────────────────────────────────────────────
const CAR_COLORS = ['#4361EE', '#A855F7', '#F59E0B', '#22C55E', '#EF4444', '#06B6D4'];

function CarCard({ car, index, onPress }) {
  const color = CAR_COLORS[index % CAR_COLORS.length];
  const initials = (car.name || '?').slice(0, 3).toUpperCase();
  const carImage = resolveCarImage(car.name);

  const fmtMiles = val => {
    const n = parseInt(val);
    if (isNaN(n)) return '—';
    return n.toLocaleString() + ' mi';
  };
  const fmtLease = val => {
    const n = parseFloat(val);
    if (isNaN(n)) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 }) + '/mo';
  };

  return (
    <TouchableOpacity style={cc.card} onPress={onPress} activeOpacity={0.85}>
      {carImage ? (
        <Image source={carImage} style={cc.carImage} resizeMode="cover" />
      ) : (
        <View style={[cc.avatar, { backgroundColor: color }]}>
          <Text style={cc.avatarTxt}>🚗</Text>
          <Text style={cc.avatarLabel}>{initials}</Text>
        </View>
      )}
      <Text style={cc.name}>{car.name || 'Car'}</Text>

      <View style={cc.divider} />

      <View style={cc.row}>
        <Text style={cc.rowLabel}>Leases</Text>
        <Text style={[cc.rowValue, { color }]}>{fmtLease(car.leases)}</Text>
      </View>
      <View style={cc.row}>
        <Text style={cc.rowLabel}>Mileages</Text>
        <Text style={cc.rowValue}>{fmtMiles(car.mileages)}</Text>
      </View>
      <View style={cc.row}>
        <Text style={cc.rowLabel}>/allowed</Text>
        <Text style={cc.rowValue}>{fmtMiles(car.allowed)}</Text>
      </View>

      <TouchableOpacity style={cc.editBtn} onPress={onPress}>
        <Text style={cc.editTxt}>Edit</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Shiny Connector ────────────────────────────────────────────────────────
function CarConnector() {
  return (
    <View style={cn.wrap}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={cn.bar}>
          <View style={cn.highlight} />
          <View style={cn.glint} />
        </View>
      ))}
    </View>
  );
}

const cn = StyleSheet.create({
  wrap: {
    width: 200,
    alignSelf: 'stretch',
    flexDirection: 'column',
    justifyContent: 'space-around',
    paddingVertical: 48,
  },
  bar: {
    height: 14,
    backgroundColor: '#2563EB',
    borderRadius: 7,
    overflow: 'hidden',
    shadowColor: '#4361EE',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  highlight: {
    position: 'absolute',
    top: 3,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 2,
  },
  glint: {
    position: 'absolute',
    top: 3,
    left: '28%',
    width: '18%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 2,
  },
});

// ─── License Status Card ────────────────────────────────────────────────────
function fmtCheckedAt(checkedAt) {
  if (!checkedAt) return null;
  const d = checkedAt.toDate ? checkedAt.toDate() : new Date(checkedAt);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// "2027-03-10" -> "03-10-27". Plain string manipulation (not Date parsing) so
// there's no UTC-vs-local timezone shift risk; falls back to the raw value
// if the agent ever returns something other than ISO YYYY-MM-DD.
function fmtHearingDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return dateStr;
  const [, yyyy, mm, dd] = m;
  return `${mm}-${dd}-${yyyy.slice(2)}`;
}

function DMVStatusCard({ licenseCheck, isMobile }) {
  const [checking, setChecking] = useState(false);
  const [triggerError, setTriggerError] = useState(null);
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // The agent can take a while (real login flow), so we don't block the
  // button's request on it — start the run, then poll for the outcome.
  const pollUntilDone = useCallback((runId) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await authedFetch(`${POLL_LICENSE_STATUS_URL}?runId=${encodeURIComponent(runId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Check failed');
        if (data.status === 'completed' || data.status === 'failed') {
          stopPolling();
          setChecking(false);
          if (data.status === 'failed') setTriggerError(data.error || 'Check failed');
        }
      } catch (e) {
        stopPolling();
        setChecking(false);
        setTriggerError(e.message);
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const handleCheck = useCallback(async () => {
    setChecking(true);
    setTriggerError(null);
    try {
      const res = await authedFetch(CHECK_LICENSE_STATUS_URL, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start check');
      pollUntilDone(data.runId);
    } catch (e) {
      setChecking(false);
      setTriggerError(e.message);
    }
  }, [pollUntilDone]);

  // Resume polling if a check was already in flight (e.g. page refresh).
  useEffect(() => {
    if (licenseCheck?.status === 'running' && licenseCheck?.runId && !pollRef.current) {
      setChecking(true);
      pollUntilDone(licenseCheck.runId);
    }
    return stopPolling;
  }, [licenseCheck?.status, licenseCheck?.runId, pollUntilDone, stopPolling]);

  const checkedAtLabel = fmtCheckedAt(licenseCheck?.checkedAt);
  const licenseStat = licenseCheck?.licenseStatus;
  const regStat = licenseCheck?.registrationStatus;
  const regExp = licenseCheck?.registrationExpiration;
  const points = licenseCheck?.licensePoints;
  const hasChecked = !!licenseCheck?.checkedAt;
  const ticketsCount = licenseCheck?.tickets?.length || 0;
  const hasAnyData = !!licenseStat || !!regStat || ticketsCount > 0;

  return (
    <View style={[tt.card, isMobile && tt.cardMobile]}>
      <View style={tt.header}>
        <View style={tt.headerText}>
          <Text style={tt.title}>🪪 DMV Status</Text>
          <Text style={tt.sub}>
            {checking
              ? 'Checking…'
              : (checkedAtLabel ? `Last checked ${checkedAtLabel}` : 'Not checked yet')}
            {!checking && ' · auto-checks every morning at 7am'}
          </Text>
        </View>
        <TouchableOpacity style={tt.checkBtn} onPress={handleCheck} disabled={checking}>
          {checking
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={tt.checkBtnTxt}>Check Now</Text>}
        </TouchableOpacity>
      </View>

      <View style={tt.tilesGrid}>
        <StatusPanel label="LICENSE" value={licenseStat} />
        <StatusPanel label="REGISTRATION" value={regStat} sub={regExp ? `Exp ${fmtHearingDate(regExp)}` : null} />
        <StatusPanel label="POINTS" value={typeof points === 'number' ? String(points) : null} />
        <StatusPanel label="COURTS" value={hasChecked ? String(ticketsCount) : null} alert={ticketsCount > 0} />
        <StatusPanel label="INSURANCE" placeholder />
        <StatusPanel label="LEASE" placeholder />
        <StatusPanel label="BRIDGES & TUNNELS" placeholder />
        <StatusPanel label="DOF PAYMENT PLAN" placeholder />
      </View>

      {(triggerError || licenseCheck?.status === 'failed') && (
        <Text style={tt.error}>
          {triggerError || licenseCheck?.error || 'Something went wrong checking DMV status.'}
        </Text>
      )}

      {!hasAnyData && !checking && !triggerError && licenseCheck?.status !== 'failed' && (
        <Text style={tt.empty}>Tap "Check Now" to verify license, registration, and open tickets.</Text>
      )}
    </View>
  );
}

// ─── Courts Card ─────────────────────────────────────────────────────────────
function CourtsCard({ licenseCheck, isMobile }) {
  const [notifyState, setNotifyState] = useState('idle'); // idle | loading | enabled | error
  const [notifyError, setNotifyError] = useState(null);
  const [testState, setTestState] = useState('idle'); // idle | loading | sent | error
  const [testSecondsLeft, setTestSecondsLeft] = useState(0);

  // Notification permission (and the saved token) persist across reloads even
  // though this component's state doesn't — check on mount so the button
  // reflects reality instead of always resetting to "Enable Court Reminders".
  useEffect(() => {
    let cancelled = false;
    checkCourtRemindersEnabled().then((enabled) => {
      if (!cancelled && enabled) setNotifyState('enabled');
    });
    return () => { cancelled = true; };
  }, []);

  const handleEnableReminders = useCallback(async () => {
    setNotifyState('loading');
    setNotifyError(null);
    try {
      await enableCourtReminders();
      setNotifyState('enabled');
    } catch (e) {
      setNotifyState('error');
      setNotifyError(e.message);
    }
  }, []);

  const handleSendTest = useCallback(async () => {
    setTestState('loading');
    setTestSecondsLeft(TEST_NOTIFICATION_DELAY_SECONDS);
    const countdown = setInterval(() => {
      setTestSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    try {
      const res = await authedFetch(SEND_TEST_NOTIFICATION_URL, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send test notification');
      setTestState('sent');
    } catch (e) {
      setTestState('error');
      setNotifyError(e.message);
    } finally {
      clearInterval(countdown);
      setTestSecondsLeft(0);
    }
  }, []);

  const rawTickets = licenseCheck?.tickets || [];
  const tickets = useMemo(() => {
    const hearingTime = (t) => {
      const ms = t.hearingDate ? new Date(t.hearingDate).getTime() : NaN;
      return isNaN(ms) ? Infinity : ms;
    };
    return [...rawTickets].sort((a, b) => hearingTime(a) - hearingTime(b));
  }, [rawTickets]);

  return (
    <View style={[tt.card, isMobile && tt.cardMobile]}>
      <View style={tt.ticketsHeadingRow}>
        <Text style={tt.ticketsHeading}>Courts</Text>
        <TouchableOpacity
          style={tt.notifyBtn}
          onPress={handleEnableReminders}
          disabled={notifyState === 'loading' || notifyState === 'enabled'}
        >
          {notifyState === 'loading'
            ? <ActivityIndicator color={C.primary} size="small" />
            : <Text style={tt.notifyBtnTxt}>
                {notifyState === 'enabled' ? '🔔 Reminders on' : '🔔 Enable Court Reminders'}
              </Text>}
        </TouchableOpacity>
        {notifyState === 'enabled' && (
          <TouchableOpacity
            style={tt.notifyBtn}
            onPress={handleSendTest}
            disabled={testState === 'loading'}
          >
            <Text style={tt.notifyBtnTxt}>
              {testState === 'loading'
                ? `Sending in ${testSecondsLeft}s… close the app now`
                : (testState === 'sent' ? '✅ Sent' : 'Send Test Notification')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {(notifyState === 'error' || testState === 'error') && <Text style={tt.error}>{notifyError}</Text>}
      {tickets.length === 0 ? (
        <Text style={tt.empty}>No open tickets found.</Text>
      ) : (
        <View style={tt.list}>
          {tickets.map((t, i) => (
            <View key={t.ticketNumber || i} style={tt.pillRow}>
              <View style={{ flex: 1 }}>
                <Text style={tt.rowTitle}>{t.ticketNumber ? `#${t.ticketNumber}` : (t.raw || 'Ticket')}</Text>
                {!!t.violationCharge && <Text style={tt.rowMeta}>{t.violationCharge}</Text>}
                {!!t.hearingDate && <Text style={tt.rowHearing}>Hearing: {fmtHearingDate(t.hearingDate)}</Text>}
              </View>
              {!!t.violationPoints && <Text style={tt.rowAmount}>{t.violationPoints} pts</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// Small square status tile used in the DMV Status grid. `alert` overrides the
// text-based color heuristic for numeric fields (Points, Courts) where
// "Valid"/"Suspended" keyword matching doesn't apply — true=red, false=green.
function StatusPanel({ label, value, sub, placeholder, alert }) {
  if (placeholder || value == null) {
    return (
      <View style={[tt.tile, tt.tilePlaceholder]}>
        <Text style={tt.tileLabelMuted}>{label}</Text>
        <Text style={tt.tileValueMuted}>{placeholder ? 'N/A' : '—'}</Text>
      </View>
    );
  }
  const color = alert !== undefined ? (alert ? '#EF4444' : '#22C55E') : licenseStatusColor(value);
  return (
    <View style={[tt.tile, { backgroundColor: `${color}1A`, borderColor: color }]}>
      <Text style={[tt.tileLabel, { color }]}>{label}</Text>
      <Text style={[tt.tileValue, { color }]}>{value}</Text>
      {!!sub && <Text style={[tt.tileSub, { color }]}>{sub}</Text>}
    </View>
  );
}

const tt = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 20,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardMobile: { padding: 16 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 16, gap: 12, flexWrap: 'wrap',
  },
  headerText: { flex: 1, minWidth: 120 },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  sub: { fontSize: 12, color: C.muted, marginTop: 4 },
  checkBtn: {
    backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10,
    minWidth: 96, alignItems: 'center', flexShrink: 0,
  },
  checkBtnTxt: { color: '#fff', fontWeight: '600', fontSize: 13 },
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  tile: {
    width: 100, minHeight: 76,
    borderWidth: 2, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', padding: 8,
  },
  tileLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' },
  tileValue: { fontSize: 15, fontWeight: '800', marginTop: 3, textAlign: 'center' },
  tileSub: { fontSize: 9, fontWeight: '600', marginTop: 2, textAlign: 'center', opacity: 0.85 },
  tilePlaceholder: { backgroundColor: C.bg, borderColor: C.border, borderStyle: 'dashed' },
  tileLabelMuted: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: C.faint, textAlign: 'center' },
  tileValueMuted: { fontSize: 13, fontWeight: '700', color: C.faint, marginTop: 3 },
  error: { fontSize: 13, color: C.red, marginBottom: 10 },
  empty: { fontSize: 13, color: C.muted, paddingVertical: 8 },
  ticketsHeadingRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10, gap: 10, flexWrap: 'wrap',
  },
  ticketsHeading: { fontSize: 15, fontWeight: '700', color: C.text },
  notifyBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: C.primaryLight },
  notifyBtnTxt: { fontSize: 12, fontWeight: '600', color: C.primary },
  list: { gap: 10 },
  pillRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: C.border, borderRadius: 28, paddingVertical: 14, paddingHorizontal: 20,
  },
  rowTitle: { fontSize: 14, fontWeight: '600', color: C.text },
  rowMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  rowHearing: { fontSize: 12, color: C.orange, fontWeight: '600', marginTop: 2 },
  rowAmount: { fontSize: 13, fontWeight: '700', color: C.text },
});

// ─── Main Screen ────────────────────────────────────────────────────────────
export default function CarScreen() {
  const { cars, addCar, updateCar, deleteCar, licenseCheck } = useApp();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editCar, setEditCar] = useState(null);

  const handleAddCar = useCallback((form) => {
    addCar(form);
  }, [addCar]);

  const handleUpdateCar = useCallback((form) => {
    if (editCar) updateCar(editCar.id, form);
  }, [editCar, updateCar]);

  const handleDeleteCar = useCallback(() => {
    if (editCar) deleteCar(editCar.id);
    setEditCar(null);
  }, [editCar, deleteCar]);

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={[s.content, isMobile && s.contentMobile]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[s.header, isMobile && s.headerMobile]}>
        <View>
          <Text style={[s.title, isMobile && s.titleMobile]}>🚗 Car</Text>
          <Text style={s.sub}>License & Vehicle Tracker</Text>
        </View>
      </View>

      {/* License Status */}
      <DMVStatusCard licenseCheck={licenseCheck} isMobile={isMobile} />

      {/* Courts */}
      <CourtsCard licenseCheck={licenseCheck} isMobile={isMobile} />

      {/* My Cars Header */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>My Cars</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => setAddModalVisible(true)}>
          <Text style={s.addBtnTxt}>+ Add Car</Text>
        </TouchableOpacity>
      </View>

      {/* Cars Grid */}
      {cars.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🚗</Text>
          <Text style={s.emptyTitle}>No cars yet</Text>
          <Text style={s.emptySub}>Tap "Add Car" to add your first vehicle.</Text>
        </View>
      ) : (
        <View style={[s.carsGrid, isMobile && s.carsGridMobile]}>
          {cars.map((car, i) => (
            <React.Fragment key={car.id}>
              <View style={[s.cardWrapper, isMobile && s.cardWrapperMobile]}>
                <CarCard
                  car={car}
                  index={i}
                  onPress={() => setEditCar(car)}
                />
              </View>
              {i < cars.length - 1 && !isMobile && <CarConnector />}
            </React.Fragment>
          ))}
        </View>
      )}

      {/* Add Car Modal */}
      <CarModal
        visible={addModalVisible}
        car={null}
        onSave={handleAddCar}
        onDelete={() => {}}
        onClose={() => setAddModalVisible(false)}
      />

      {/* Edit Car Modal */}
      {editCar && (
        <CarModal
          visible={true}
          car={editCar}
          onSave={handleUpdateCar}
          onDelete={handleDeleteCar}
          onClose={() => setEditCar(null)}
        />
      )}

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

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  addBtn: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  addBtnTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },

  carsGrid: { flexDirection: 'row', justifyContent: 'center', alignItems: 'stretch', flexWrap: 'wrap' },
  carsGridMobile: { flexDirection: 'column', alignItems: 'stretch' },
  cardWrapper: { width: 550 },
  cardWrapperMobile: { width: '100%' },

  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: C.text, marginBottom: 6 },
  emptySub: { fontSize: 14, color: C.muted, textAlign: 'center' },
});

const cc = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    overflow: 'hidden',
    paddingBottom: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  carImage: {
    width: '100%',
    height: 280,
    marginBottom: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    gap: 2,
    marginHorizontal: 18,
    marginTop: 18,
  },
  avatarTxt: { fontSize: 22 },
  avatarLabel: { fontSize: 10, color: '#fff', fontWeight: '700' },
  name: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 12, paddingHorizontal: 18 },
  divider: { height: 1, backgroundColor: C.border, marginBottom: 12, marginHorizontal: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 18 },
  rowLabel: { fontSize: 13, color: C.muted, fontWeight: '500' },
  rowValue: { fontSize: 13, fontWeight: '700', color: C.text },
  editBtn: {
    marginTop: 12,
    marginHorizontal: 18,
    marginBottom: 18,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.primaryLight,
    alignItems: 'center',
  },
  editTxt: { fontSize: 13, fontWeight: '600', color: C.primary },
});

const m = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  box: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 380,
  },
  title: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: C.text,
    marginBottom: 14,
    backgroundColor: C.bg,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8, justifyContent: 'flex-end' },
  deleteBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FEE2E2', marginRight: 'auto' },
  deleteTxt: { color: C.red, fontWeight: '600', fontSize: 14 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.bg },
  cancelTxt: { color: C.muted, fontWeight: '600', fontSize: 14 },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: C.primary },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
