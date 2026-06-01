import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from './src/context/AppContext';
import Sidebar from './src/components/Sidebar';
import BottomTabBar from './src/components/BottomTabBar';
import DashboardScreen from './src/screens/DashboardScreen';
import DARSScreen from './src/screens/DARSScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import CarScreen from './src/screens/CarScreen';
import RNScreen from './src/screens/RNScreen';
import WorkScreen from './src/screens/WorkScreen';
import { usePlaidLink } from './src/hooks/usePlaidLink';

function MainApp() {
  const { currentScreen, setCurrentScreen, loading } = useApp();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const { isOAuthReturn, completeOAuthReturn } = usePlaidLink();

  useEffect(() => {
    if (isOAuthReturn) {
      completeOAuthReturn(() => {
        // Clean up the oauth_state_id from the URL without reloading
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', window.location.pathname);
        }
        setCurrentScreen('accounts');
      });
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <Text style={styles.logoLine}>
          <Text style={styles.logoBlack}>Power</Text>
          <Text style={styles.logoBlue}>DARS</Text>
        </Text>
        <ActivityIndicator size="large" color="#4361EE" style={{ marginTop: 20 }} />
      </View>
    );
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case 'dars':     return <DARSScreen />;
      case 'accounts': return <AccountsScreen />;
      case 'car':      return <CarScreen />;
      case 'rn':       return <RNScreen />;
      case 'work':     return <WorkScreen />;
      default:         return <DashboardScreen />;
    }
  };

  return (
    <View style={[styles.app, isMobile && styles.appMobile]}>
      <StatusBar style="dark" />

      {/* Desktop: sidebar on the left */}
      {!isMobile && (
        <Sidebar currentScreen={currentScreen} onNavigate={setCurrentScreen} />
      )}

      {/* Main content */}
      <View style={styles.main}>
        {renderScreen()}
      </View>

      {/* Mobile: bottom tab bar */}
      {isMobile && (
        <BottomTabBar currentScreen={currentScreen} onNavigate={setCurrentScreen} />
      )}
    </View>
  );
}

export default function App() {
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const style = document.createElement('style');
      style.id = 'powerdars-no-select';
      style.textContent = [
        '* { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; }',
        'input, textarea { -webkit-user-select: text !important; user-select: text !important; }',
      ].join('\n');
      document.head.appendChild(style);
      return () => document.getElementById('powerdars-no-select')?.remove();
    }
  }, []);
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#F0F4FF',
    height: '100%',
  },
  appMobile: {
    flexDirection: 'column',
  },
  main: {
    flex: 1,
    overflow: 'hidden',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F4FF',
  },
  logoLine: { fontSize: 32, fontWeight: '800' },
  logoBlack: { color: '#1F2937' },
  logoBlue: { color: '#4361EE' },
});
