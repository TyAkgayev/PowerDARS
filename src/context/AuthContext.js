import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { auth, db, USERNAME_EMAIL_DOMAIN } from '../config/firebase';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, OAuthProvider, signOut,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

const AuthContext = createContext(null);

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

// The sign-in field accepts either a plain username (for accounts created
// the original way, e.g. "takgayev") or a full email address.
function resolveEmail(input) {
  const trimmed = input.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : usernameToEmail(trimmed);
}

// Keep a lightweight top-level profile doc for every account so server-side
// jobs (e.g. SMS reminders) can enumerate users without needing a signed-in
// client. Called after every successful sign-in/sign-up, regardless of method.
async function upsertProfile(user, extra = {}) {
  await setDoc(doc(db, 'users', user.uid), {
    email: user.email,
    lastLoginAt: serverTimestamp(),
    ...extra,
  }, { merge: true });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  const login = useCallback(async (usernameOrEmail, password) => {
    const cred = await signInWithEmailAndPassword(auth, resolveEmail(usernameOrEmail), password);
    await upsertProfile(cred.user);
    return cred.user;
  }, []);

  const signUpWithEmail = useCallback(async (email, password) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    await upsertProfile(cred.user, { createdAt: serverTimestamp() });
    return cred.user;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    await upsertProfile(cred.user, { createdAt: serverTimestamp() });
    return cred.user;
  }, []);

  // Wired up and ready, but the "apple.com" provider isn't enabled on the
  // Firebase project yet — that requires Services ID / Team ID / Key ID /
  // private key from an Apple Developer account, which only the app owner
  // can generate. The UI keeps this button disabled until then.
  const loginWithApple = useCallback(async () => {
    const cred = await signInWithPopup(auth, new OAuthProvider('apple.com'));
    await upsertProfile(cred.user, { createdAt: serverTimestamp() });
    return cred.user;
  }, []);

  const logout = useCallback(() => signOut(auth), []);

  return (
    <AuthContext.Provider value={{
      user, uid: user?.uid || null, authLoading,
      login, signUpWithEmail, loginWithGoogle, loginWithApple, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
