import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { auth, db, USERNAME_EMAIL_DOMAIN } from '../config/firebase';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

const AuthContext = createContext(null);

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
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

  const login = useCallback(async (username, password) => {
    const cred = await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
    // Keep a lightweight top-level profile doc so server-side jobs (e.g. SMS
    // reminders) can enumerate users without needing a signed-in client.
    await setDoc(doc(db, 'users', cred.user.uid), {
      username: username.trim().toLowerCase(),
      email: cred.user.email,
      lastLoginAt: serverTimestamp(),
    }, { merge: true });
    return cred.user;
  }, []);

  const logout = useCallback(() => signOut(auth), []);

  return (
    <AuthContext.Provider value={{ user, uid: user?.uid || null, authLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
