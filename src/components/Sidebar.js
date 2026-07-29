import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { db } from '../config/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
  { id: 'dars',      label: 'DARS',      icon: '📋' },
  { id: 'accounts',  label: 'Accounts',  icon: '🏦' },
  { id: 'car',       label: 'Car',        icon: '🚗' },
  { id: 'rn',        label: 'RN License', icon: '🏥' },
  { id: 'work',      label: 'Work',       icon: '💼' },
];

const FALLBACK = { text: 'Small steps today create peace tomorrow.', author: null };

function useDailyQuote() {
  const [quote, setQuote] = useState(FALLBACK);

  useEffect(() => {
    const cacheKey = 'powersync_quote_' + new Date().toISOString().slice(0, 10);
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem(cacheKey) : null;
    if (cached) { try { setQuote(JSON.parse(cached)); return; } catch {} }

    fetch('https://us-central1-dars-4e5d0.cloudfunctions.net/getDailyQuote')
      .then(r => r.json())
      .then(data => {
        if (data?.text) {
          setQuote(data);
          if (typeof localStorage !== 'undefined') localStorage.setItem(cacheKey, JSON.stringify(data));
        }
      })
      .catch(() => {});
  }, []);

  return quote;
}

function useFavoriteQuotes(currentQuote) {
  const [favorites, setFavorites] = useState([]);
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'favoriteQuotes'))
      .then(snap => {
        const favs = snap.exists() ? (snap.data().quotes || []) : [];
        setFavorites(favs);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setStarred(favorites.some(f => f.text === currentQuote.text));
  }, [favorites, currentQuote]);

  const toggleStar = useCallback(async () => {
    let updated;
    if (starred) {
      updated = favorites.filter(f => f.text !== currentQuote.text);
    } else {
      updated = [{ ...currentQuote, savedAt: new Date().toISOString() }, ...favorites];
    }
    setFavorites(updated);
    setStarred(!starred);
    await setDoc(doc(db, 'settings', 'favoriteQuotes'), { quotes: updated });
  }, [starred, favorites, currentQuote]);

  return { starred, toggleStar, favorites };
}

export default function Sidebar({ currentScreen, onNavigate }) {
  const quote = useDailyQuote();
  const { starred, toggleStar } = useFavoriteQuotes(quote);

  return (
    <View style={styles.sidebar}>
      <View style={styles.logo}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logoImg}
          resizeMode="contain"
        />
        <Text style={styles.logoBlack}>Power</Text>
        <Text style={styles.logoBlue}>Sync</Text>
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
        <View style={styles.bottomHeader}>
          <Text style={styles.bottomIcon}>✨</Text>
          <TouchableOpacity onPress={toggleStar} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.star, starred && styles.starFilled]}>
              {starred ? '★' : '☆'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.bottomSub}>"{quote.text}"</Text>
        {quote.author && <Text style={styles.bottomAuthor}>— {quote.author}</Text>}
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
  logoImg: { width: 48, height: 48, marginRight: 8 },
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
  bottomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  bottomIcon: { fontSize: 22 },
  star: { fontSize: 22, color: '#D1D5DB' },
  starFilled: { color: '#F59E0B' },
  bottomSub: { fontSize: 12, color: '#6B7280', lineHeight: 17, fontStyle: 'italic' },
  bottomAuthor: { fontSize: 11, color: '#9CA3AF', marginTop: 6, fontWeight: '600' },
});
