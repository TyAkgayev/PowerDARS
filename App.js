import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, useWindowDimensions, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from './src/context/AppContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import Sidebar from './src/components/Sidebar';
import BottomTabBar from './src/components/BottomTabBar';
import DashboardScreen from './src/screens/DashboardScreen';
import DARSScreen from './src/screens/DARSScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import CarScreen from './src/screens/CarScreen';
import RNScreen from './src/screens/RNScreen';
import WorkScreen from './src/screens/WorkScreen';
import SpendingScreen from './src/screens/SpendingScreen';
import LoginScreen from './src/screens/LoginScreen';
import { usePlaidLink } from './src/hooks/usePlaidLink';

function MainApp() {
  const { currentScreen, setCurrentScreen, loading } = useApp();
  const { logout } = useAuth();
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
        <Image source={require('./assets/logo.png')} style={styles.loadingLogo} resizeMode="contain" />
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
      case 'spending': return <SpendingScreen />;
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

      {/* Mobile: bottom tab bar + a small persistent logout button */}
      {isMobile && (
        <>
          <TouchableOpacity style={styles.mobileLogout} onPress={logout} activeOpacity={0.7}>
            <Text style={styles.mobileLogoutTxt}>🚪</Text>
          </TouchableOpacity>
          <BottomTabBar currentScreen={currentScreen} onNavigate={setCurrentScreen} />
        </>
      )}
    </View>
  );
}

function Gate() {
  const { user, authLoading } = useAuth();

  if (authLoading) {
    return (
      <View style={styles.loading}>
        <Image source={require('./assets/logo.png')} style={styles.loadingLogo} resizeMode="contain" />
        <ActivityIndicator size="large" color="#4361EE" style={{ marginTop: 20 }} />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
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
    <AuthProvider>
      <Gate />
    </AuthProvider>
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
  loadingLogo: { width: 240, height: 160 },
  mobileLogout: {
    position: 'absolute', top: 14, right: 14, zIndex: 20,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 4,
  },
  mobileLogoutTxt: { fontSize: 16 },
});
