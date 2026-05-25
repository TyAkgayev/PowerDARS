import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { db } from '../config/firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, setDoc, serverTimestamp,
} from 'firebase/firestore';

const AppContext = createContext(null);

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function AppProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [bills, setBills] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [darsHistory, setDarsHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [currentScreen, setCurrentScreen] = useState('dashboard');
  const [userName, setUserNameState] = useState('Alex');

  // Accounts listener
  useEffect(() => {
    const q = query(collection(db, 'accounts'), orderBy('order', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const accs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAccounts(accs);
      setLoading(false);
      if (accs.length === 0) setCurrentScreen('accounts');
    }, () => setLoading(false));
    return unsub;
  }, []);

  // Bills listener
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'bills'), (snap) => {
      setBills(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  // Tasks listener
  useEffect(() => {
    const q = query(collection(db, 'tasks'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  // DARS history listener
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'dars'), (snap) => {
      const hist = {};
      snap.docs.forEach(d => { hist[d.id] = { id: d.id, ...d.data() }; });
      setDarsHistory(hist);
    });
    return unsub;
  }, []);

  // Settings listener
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'app'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.userName) setUserNameState(data.userName);
      }
    });
    return unsub;
  }, []);

  // — Accounts —
  const addAccount = useCallback(async (data) => {
    await addDoc(collection(db, 'accounts'), {
      ...data,
      order: accounts.length,
      createdAt: serverTimestamp(),
    });
  }, [accounts.length]);

  const updateAccount = useCallback(async (id, updates) => {
    await updateDoc(doc(db, 'accounts', id), updates);
  }, []);

  const deleteAccount = useCallback(async (id) => {
    await deleteDoc(doc(db, 'accounts', id));
  }, []);

  // — Bills —
  const addBill = useCallback(async (data) => {
    await addDoc(collection(db, 'bills'), { ...data, createdAt: serverTimestamp() });
  }, []);

  const updateBill = useCallback(async (id, updates) => {
    await updateDoc(doc(db, 'bills', id), updates);
  }, []);

  const deleteBill = useCallback(async (id) => {
    await deleteDoc(doc(db, 'bills', id));
  }, []);

  // — Tasks —
  const addTask = useCallback(async (data) => {
    await addDoc(collection(db, 'tasks'), {
      ...data,
      completed: false,
      createdAt: serverTimestamp(),
    });
  }, []);

  const toggleTask = useCallback(async (id, current) => {
    await updateDoc(doc(db, 'tasks', id), { completed: !current });
  }, []);

  const deleteTask = useCallback(async (id) => {
    await deleteDoc(doc(db, 'tasks', id));
  }, []);

  // — DARS —
  const saveDars = useCallback(async (entries) => {
    const date = todayStr();
    await setDoc(doc(db, 'dars', date), {
      date,
      entries,
      submittedAt: serverTimestamp(),
    });
  }, []);

  const getTodaysDars = useCallback(() => darsHistory[todayStr()] || null, [darsHistory]);

  // — Settings —
  const saveUserName = useCallback(async (name) => {
    await setDoc(doc(db, 'settings', 'app'), { userName: name }, { merge: true });
  }, []);

  return (
    <AppContext.Provider value={{
      accounts, bills, tasks, darsHistory, loading,
      currentScreen, setCurrentScreen,
      userName, saveUserName,
      addAccount, updateAccount, deleteAccount,
      addBill, updateBill, deleteBill,
      addTask, toggleTask, deleteTask,
      saveDars, getTodaysDars,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
