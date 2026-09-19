import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useAuth } from '../context/AuthContext';

const C = {
  primary: '#4361EE',
  bg: '#F0F4FF',
  card: '#FFFFFF',
  text: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
  danger: '#EF4444',
};

function friendlyError(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect username/email or password.';
    case 'auth/email-already-in-use':
      return 'An account with that email already exists.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again in a moment.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function SocialButton({ label, icon, onPress, disabled, note }) {
  return (
    <TouchableOpacity
      style={[s.socialBtn, disabled && s.socialBtnDisabled]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <Text style={s.socialIcon}>{icon}</Text>
      <Text style={[s.socialTxt, disabled && s.socialTxtDisabled]}>{label}</Text>
      {note ? <Text style={s.socialNote}>{note}</Text> : null}
    </TouchableOpacity>
  );
}

export default function LoginScreen() {
  const { login, signUpWithEmail, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [identifier, setIdentifier] = useState(''); // username or email
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async () => {
    setError('');
    if (mode === 'signin') {
      if (!identifier.trim() || !password) return;
      setSubmitting(true);
      try {
        await login(identifier, password);
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // signup
    if (!email.trim() || !password) return;
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await signUpWithEmail(email, password);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.card}>
        <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" />

        <Text style={s.title}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>

        <SocialButton label="Continue with Google" icon="🔵" onPress={handleGoogle} />
        <SocialButton label="Continue with Apple" icon="" note="Coming soon" disabled />

        <View style={s.dividerRow}>
          <View style={s.dividerLine} />
          <Text style={s.dividerTxt}>or</Text>
          <View style={s.dividerLine} />
        </View>

        {mode === 'signin' ? (
          <>
            <Text style={s.label}>Email or username</Text>
            <TextInput
              style={s.input}
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Email or username"
              placeholderTextColor={C.faint}
              onSubmitEditing={handleSubmit}
            />

            <Text style={s.label}>Password</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor={C.faint}
              onSubmitEditing={handleSubmit}
            />
          </>
        ) : (
          <>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={C.faint}
              onSubmitEditing={handleSubmit}
            />

            <Text style={s.label}>Password</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 6 characters"
              placeholderTextColor={C.faint}
              onSubmitEditing={handleSubmit}
            />

            <Text style={s.label}>Confirm password</Text>
            <TextInput
              style={s.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              placeholder="Re-enter password"
              placeholderTextColor={C.faint}
              onSubmitEditing={handleSubmit}
            />
          </>
        )}

        {error ? <Text style={s.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[s.button, submitting && s.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.buttonTxt}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.switchModeBtn}
          onPress={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          <Text style={s.switchModeTxt}>
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <Text style={s.switchModeLink}>{mode === 'signin' ? 'Create one' : 'Sign in'}</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
  },
  logo: { width: 160, height: 100, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text,
    backgroundColor: '#FAFAFA',
  },
  error: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: 'center' },
  button: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 22,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  socialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingVertical: 12, marginTop: 10, backgroundColor: '#fff',
  },
  socialBtnDisabled: { backgroundColor: '#F9FAFB' },
  socialIcon: { fontSize: 16, marginRight: 8 },
  socialTxt: { fontSize: 14, fontWeight: '600', color: C.text },
  socialTxtDisabled: { color: C.faint },
  socialNote: { fontSize: 11, color: C.faint, marginLeft: 8 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerTxt: { fontSize: 12, color: C.faint, marginHorizontal: 10 },
  switchModeBtn: { marginTop: 16, alignItems: 'center' },
  switchModeTxt: { fontSize: 13, color: C.muted },
  switchModeLink: { color: C.primary, fontWeight: '700' },
});
