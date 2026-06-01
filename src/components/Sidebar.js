import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '⊞' },
  { id: 'dars',      label: 'DARS',      icon: '📋' },
  { id: 'accounts',  label: 'Accounts',  icon: '🏦' },
  { id: 'car',       label: 'Car',        icon: '🚗' },
  { id: 'rn',        label: 'RN License', icon: '🏥' },
  { id: 'work',      label: 'Work',       icon: '💼' },
];

export default function Sidebar({ currentScreen, onNavigate }) {
  return (
    <View style={styles.sidebar}>
      <View style={styles.logo}>
        <Text style={styles.logoIcon}>⚡</Text>
        <Text style={styles.logoBlack}>Power</Text>
        <Text style={styles.logoBlue}>DARS</Text>
      </View>

      <View style={styles.nav}>
        {NAV.map(item => {
          const active = currentScreen === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.navItem, active && styles.navItemActive]}
              onPress={() => onNavigate(item.id)}
              activeOpacity={0.7}
            >
              <Text style={styles.navIcon}>{item.icon}</Text>
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.bottomCard}>
        <Text style={styles.bottomIcon}>✨</Text>
        <Text style={styles.bottomTitle}>Stay in control</Text>
        <Text style={styles.bottomSub}>Small steps today create peace tomorrow.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 220,
    backgroundColor: '#F5F7FF',
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 36,
    paddingLeft: 8,
  },
  logoIcon: { fontSize: 22, marginRight: 6 },
  logoBlack: { fontSize: 20, fontWeight: '700', color: '#1F2937' },
  logoBlue: { fontSize: 20, fontWeight: '700', color: '#4361EE' },
  nav: { flex: 1 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  navItemActive: { backgroundColor: '#EEF2FF' },
  navIcon: { fontSize: 17, marginRight: 10 },
  navLabel: { fontSize: 15, fontWeight: '500', color: '#6B7280' },
  navLabelActive: { color: '#4361EE', fontWeight: '600' },
  bottomCard: {
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    padding: 16,
  },
  bottomIcon: { fontSize: 22, marginBottom: 8 },
  bottomTitle: { fontSize: 14, fontWeight: '700', color: '#1F2937', marginBottom: 4 },
  bottomSub: { fontSize: 12, color: '#6B7280', lineHeight: 17 },
});
