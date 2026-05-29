import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, Modal,
  TouchableOpacity, StyleSheet, useWindowDimensions, Image,
} from 'react-native';
import { useApp } from '../context/AppContext';

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

// ─── Driver Profile Edit Modal ──────────────────────────────────────────────
function ProfileModal({ visible, profile, onSave, onClose }) {
  const [form, setForm] = useState({
    points: profile.points || '',
    tickets: profile.tickets || '',
    courts: profile.courts || '',
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={m.overlay} onPress={onClose} activeOpacity={1}>
        <TouchableOpacity activeOpacity={1} style={m.box}>
          <Text style={m.title}>Driver Profile</Text>

          <Text style={m.label}>Points on License</Text>
          <TextInput
            style={m.input}
            value={form.points}
            onChangeText={v => set('points', v)}
            placeholder="0"
            placeholderTextColor={C.faint}
            keyboardType="number-pad"
            autoFocus
          />

          <Text style={m.label}>Tickets</Text>
          <TextInput
            style={m.input}
            value={form.tickets}
            onChangeText={v => set('tickets', v)}
            placeholder="0"
            placeholderTextColor={C.faint}
            keyboardType="number-pad"
          />

          <Text style={m.label}>Courts</Text>
          <TextInput
            style={m.input}
            value={form.courts}
            onChangeText={v => set('courts', v)}
            placeholder="0"
            placeholderTextColor={C.faint}
            keyboardType="number-pad"
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

// ─── Main Screen ────────────────────────────────────────────────────────────
export default function CarScreen() {
  const { cars, addCar, updateCar, deleteCar, driverProfile, saveDriverProfile } = useApp();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [showProfileModal, setShowProfileModal] = useState(false);
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

  const pt = parseInt(driverProfile.points) || 0;
  const tk = parseInt(driverProfile.tickets) || 0;
  const ct = parseInt(driverProfile.courts) || 0;

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
        <TouchableOpacity style={s.profileBtn} onPress={() => setShowProfileModal(true)}>
          <Text style={s.profileBtnTxt}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      {/* Driver Profile Card */}
      <TouchableOpacity
        style={[s.profileCard, isMobile && s.profileCardMobile]}
        onPress={() => setShowProfileModal(true)}
        activeOpacity={0.85}
      >
        {/* License Image Placeholder */}
        <View style={s.licenseBox}>
          <Text style={s.licenseIcon}>🪪</Text>
          <Text style={s.licensePlaceholder}>Driver's License</Text>
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={[s.stat, { borderColor: pt > 0 ? C.orange : C.border }]}>
            <Text style={[s.statNum, pt > 0 && { color: C.orange }]}>{pt}</Text>
            <Text style={s.statLabel}>Points</Text>
          </View>
          <View style={[s.stat, { borderColor: tk > 0 ? C.red : C.border }]}>
            <Text style={[s.statNum, tk > 0 && { color: C.red }]}>{tk}</Text>
            <Text style={s.statLabel}>Tickets</Text>
          </View>
          <View style={[s.stat, { borderColor: ct > 0 ? C.red : C.border }]}>
            <Text style={[s.statNum, ct > 0 && { color: C.red }]}>{ct}</Text>
            <Text style={s.statLabel}>Courts</Text>
          </View>
        </View>
      </TouchableOpacity>

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

      {/* Driver Profile Modal */}
      <ProfileModal
        visible={showProfileModal}
        profile={driverProfile}
        onSave={saveDriverProfile}
        onClose={() => setShowProfileModal(false)}
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

  profileBtn: {
    backgroundColor: C.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  profileBtnTxt: { fontSize: 13, fontWeight: '600', color: C.primary },

  profileCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  profileCardMobile: { flexDirection: 'column', gap: 16 },

  licenseBox: {
    width: 160,
    height: 100,
    backgroundColor: C.primaryLight,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  licenseIcon: { fontSize: 32 },
  licensePlaceholder: { fontSize: 11, color: C.muted, fontWeight: '500' },

  statsRow: { flexDirection: 'row', gap: 16, flex: 1, flexWrap: 'wrap' },
  stat: {
    flex: 1,
    minWidth: 80,
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    alignItems: 'center',
  },
  statNum: { fontSize: 28, fontWeight: '800', color: C.text },
  statLabel: { fontSize: 12, color: C.muted, fontWeight: '600', marginTop: 4 },

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
