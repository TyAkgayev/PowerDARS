import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

const NAV = [
  { id: 'dashboard', label: 'Dash',     icon: '⊞' },
  { id: 'dars',      label: 'DARS',     icon: '📋' },
  { id: 'accounts',  label: 'Accounts', icon: '🏦' },
  { id: 'car',       label: 'Car',      icon: '🚗' },
  { id: 'rn',        label: 'RN',       icon: '🏥' },
  { id: 'work',      label: 'Work',     icon: '💼' },
];

export default function BottomTabBar({ currentScreen, onNavigate }) {
  return (
    <View style={styles.bar}>
      {NAV.map(item => {
        const active = currentScreen === item.id;
        return (
          <TouchableOpacity
            key={item.id}
            style={styles.tab}
            onPress={() => onNavigate(item.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.icon, active && styles.iconActive]}>{item.icon}</Text>
            <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
            {active && <View style={styles.activeDot} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  icon: { fontSize: 22, color: '#9CA3AF' },
  iconActive: { color: '#4361EE' },
  label: { fontSize: 11, color: '#9CA3AF', fontWeight: '500' },
  labelActive: { color: '#4361EE', fontWeight: '700' },
  activeDot: {
    position: 'absolute',
    top: -10,
    width: 28,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#4361EE',
  },
});
