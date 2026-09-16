import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, setDoc, serverTimestamp,
} from 'firebase/firestore';

const AppContext = createContext(null);

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function AppProvider({ children }) {
  const { uid } = useAuth();
  // Every collection/doc lives under users/{uid}/... so each account's data
  // is fully isolated from every other account.
  const uCol = useCallback((...segments) => collection(db, 'users', uid, ...segments), [uid]);
  const uDoc = useCallback((...segments) => doc(db, 'users', uid, ...segments), [uid]);

  const [accounts, setAccounts] = useState([]);
  const [bills, setBills] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [darsHistory, setDarsHistory] = useState({});
  const [projectedIncome, setProjectedIncome] = useState({});
  const [loading, setLoading] = useState(true);
  const [currentScreen, setCurrentScreen] = useState('dashboard');
  const [userName, setUserNameState] = useState('Tymur');
  const [cars, setCars] = useState([]);
  const [driverProfile, setDriverProfile] = useState({ points: '', tickets: '', courts: '' });
  const [rnProfile, setRNProfile] = useState({ licenseNumber: '', expiration: '', state: '', compact: false, notes: '' });
  const [workSchedule, setWorkSchedule] = useState({});
  const [projectedExpenses, setProjectedExpenses] = useState({});
  const [deferredItems, setDeferredItems] = useState([]);
  const [billPayments, setBillPayments] = useState({});
  const [plaidLinkedIds, setPlaidLinkedIds] = useState(new Set());
  const [plaidBalances, setPlaidBalances] = useState({});
  const [creditSchedule, setCreditSchedule] = useState({});
  const darsRedirectChecked = useRef(false);

  // Accounts listener
  useEffect(() => {
    if (!uid) return;
    const q = query(uCol('accounts'), orderBy('order', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const accs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAccounts(accs);
      setLoading(false);
      if (accs.length === 0) setCurrentScreen('accounts');
    }, () => setLoading(false));
    return unsub;
  }, [uid]);

  // Bills listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uCol('bills'), (snap) => {
      setBills(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [uid]);

  // Tasks listener
  useEffect(() => {
    if (!uid) return;
    const q = query(uCol('tasks'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [uid]);

  // DARS history listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uCol('dars'), (snap) => {
      const hist = {};
      snap.docs.forEach(d => { hist[d.id] = { id: d.id, ...d.data() }; });
      setDarsHistory(hist);
    });
    return unsub;
  }, [uid]);

  // Projected income listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('settings', 'projectedIncome'), (snap) => {
      if (snap.exists()) setProjectedIncome(snap.data().entries || {});
    });
    return unsub;
  }, [uid]);

  // Settings listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('settings', 'app'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.userName) setUserNameState(data.userName);
      }
    });
    return unsub;
  }, [uid]);

  // Cars listener
  useEffect(() => {
    if (!uid) return;
    const q = query(uCol('cars'), orderBy('order', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setCars(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [uid]);

  // Driver profile listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('settings', 'driverProfile'), (snap) => {
      if (snap.exists()) setDriverProfile(snap.data());
    });
    return unsub;
  }, [uid]);

  // Work schedule listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uCol('workSchedule'), (snap) => {
      const sched = {};
      snap.docs.forEach(d => { sched[d.id] = { id: d.id, ...d.data() }; });
      setWorkSchedule(sched);
    });
    return unsub;
  }, [uid]);

  // RN profile listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('settings', 'rnProfile'), (snap) => {
      if (snap.exists()) setRNProfile(snap.data());
    });
    return unsub;
  }, [uid]);

  // Projected expenses listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('settings', 'projectedExpenses'), (snap) => {
      if (snap.exists()) setProjectedExpenses(snap.data().entries || {});
    });
    return unsub;
  }, [uid]);

  // Deferred items listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('settings', 'deferredItems'), (snap) => {
      if (snap.exists()) setDeferredItems(snap.data().items || []);
    });
    return unsub;
  }, [uid]);

  // Bill payments listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('settings', 'billPayments'), (snap) => {
      if (snap.exists()) setBillPayments(snap.data().payments || {});
    });
    return unsub;
  }, [uid]);

  // Plaid linked accounts listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uCol('plaidItems'), (snap) => {
      setPlaidLinkedIds(new Set(snap.docs.map(d => d.id)));
    });
    return unsub;
  }, [uid]);

  // Plaid live balances listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('settings', 'plaidBalances'), (snap) => {
      if (snap.exists()) setPlaidBalances(snap.data().balances || {});
    });
    return unsub;
  }, [uid]);

  // Credit card monthly-due schedule listener — populated when a bill is
  // dragged from the checklist onto a calendar day
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('settings', 'creditSchedule'), (snap) => {
      if (snap.exists()) setCreditSchedule(snap.data().schedule || {});
    });
    return unsub;
  }, [uid]);

  // Accounts no longer have due dates — every payment is scheduled manually,
  // so strip any leftover due-day fields from older accounts.
  useEffect(() => {
    if (!uid) return;
    accounts.forEach(acc => {
      if ((acc.fields || []).some(f => f.type === 'date')) {
        updateDoc(uDoc('accounts', acc.id), {
          fields: acc.fields.filter(f => f.type !== 'date'),
        });
      }
    });
  }, [uid, accounts]);

  // DARS is filled out once a month now (not daily) — send the user there
  // on the first login of a new month if this month's sheet isn't done yet.
  // Bank balances can be updated from the dashboard at any time and merge into
  // this same month's doc without setting submittedAt, so submittedAt (not mere
  // doc existence) is what tracks whether the monthly DARS itself is done.
  useEffect(() => {
    if (loading || darsRedirectChecked.current) return;
    if (accounts.length === 0) return;
    darsRedirectChecked.current = true;
    if (!darsHistory[currentMonthStr()]?.submittedAt) setCurrentScreen('dars');
  }, [loading, accounts, darsHistory]);

  // Reset per-account UI state (and re-arm the DARS redirect check) whenever
  // the signed-in user changes, so switching accounts doesn't leak state.
  useEffect(() => {
    darsRedirectChecked.current = false;
    setCurrentScreen('dashboard');
  }, [uid]);

  // — Accounts —
  const addAccount = useCallback(async (data) => {
    await addDoc(uCol('accounts'), {
      ...data,
      order: accounts.length,
      createdAt: serverTimestamp(),
    });
  }, [uid, accounts.length]);

  const updateAccount = useCallback(async (id, updates) => {
    await updateDoc(uDoc('accounts', id), updates);
  }, [uid]);

  const deleteAccount = useCallback(async (id) => {
    await deleteDoc(uDoc('accounts', id));
  }, [uid]);

  // — Bills —
  const addBill = useCallback(async (data) => {
    await addDoc(uCol('bills'), { ...data, createdAt: serverTimestamp() });
  }, [uid]);

  const updateBill = useCallback(async (id, updates) => {
    await updateDoc(uDoc('bills', id), updates);
  }, [uid]);

  const deleteBill = useCallback(async (id) => {
    await deleteDoc(uDoc('bills', id));
  }, [uid]);

  // — Tasks —
  const addTask = useCallback(async (data) => {
    await addDoc(uCol('tasks'), {
      ...data,
      completed: false,
      createdAt: serverTimestamp(),
    });
  }, [uid]);

  const toggleTask = useCallback(async (id, current) => {
    await updateDoc(uDoc('tasks', id), { completed: !current });
  }, [uid]);

  const deleteTask = useCallback(async (id) => {
    await deleteDoc(uDoc('tasks', id));
  }, [uid]);

  // — Cars —
  const addCar = useCallback(async (data) => {
    await addDoc(uCol('cars'), { ...data, order: cars.length, createdAt: serverTimestamp() });
  }, [uid, cars.length]);

  const updateCar = useCallback(async (id, updates) => {
    await updateDoc(uDoc('cars', id), updates);
  }, [uid]);

  const deleteCar = useCallback(async (id) => {
    await deleteDoc(uDoc('cars', id));
  }, [uid]);

  const saveDriverProfile = useCallback(async (data) => {
    await setDoc(uDoc('settings', 'driverProfile'), data, { merge: true });
  }, [uid]);

  const saveRNProfile = useCallback(async (data) => {
    await setDoc(uDoc('settings', 'rnProfile'), data, { merge: true });
  }, [uid]);

  // — Work Schedule —
  const setWorkShift = useCallback(async (dateStr, shift, location) => {
    await setDoc(uDoc('workSchedule', dateStr), { date: dateStr, shift, location: location || '' });
  }, [uid]);

  const deleteWorkShift = useCallback(async (dateStr) => {
    await deleteDoc(uDoc('workSchedule', dateStr));
  }, [uid]);

  // — DARS — filled out once per month, keyed by "YYYY-MM". Defaults to the
  // current month but can target any month, so next month's bills can be
  // planned ahead of time from within DARS.
  const saveDars = useCallback(async (entries, monthStr) => {
    const date = monthStr || currentMonthStr();
    await setDoc(uDoc('dars', date), {
      date,
      entries,
      submittedAt: serverTimestamp(),
    });
  }, [uid]);

  const getCurrentMonthDars = useCallback(() => darsHistory[currentMonthStr()] || null, [darsHistory]);

  // Bank balances are edited straight from the dashboard rather than through
  // the monthly DARS form. This merges into the same month's dars doc (so
  // history/sparklines keep working) but never touches submittedAt, which is
  // what marks the monthly DARS itself as done.
  const updateBankBalance = useCallback(async (accountId, fieldId, value) => {
    const date = currentMonthStr();
    await setDoc(uDoc('dars', date), {
      date,
      entries: { [accountId]: { [fieldId]: value } },
    }, { merge: true });
  }, [uid]);

  // — Credit card payment scheduling — dragging a bill from the checklist
  // onto a calendar day records which date it was scheduled for
  const saveCreditSchedule = useCallback(async (schedule) => {
    await setDoc(uDoc('settings', 'creditSchedule'), { schedule });
  }, [uid]);

  // — Projected Income —
  const saveProjectedIncome = useCallback(async (entries) => {
    await setDoc(uDoc('settings', 'projectedIncome'), { entries });
  }, [uid]);

  const saveProjectedExpenses = useCallback(async (entries) => {
    await setDoc(uDoc('settings', 'projectedExpenses'), { entries });
  }, [uid]);

  const saveDeferredItems = useCallback(async (items) => {
    await setDoc(uDoc('settings', 'deferredItems'), { items });
  }, [uid]);

  const saveBillPayments = useCallback(async (payments) => {
    await setDoc(uDoc('settings', 'billPayments'), { payments });
  }, [uid]);

  // — Settings —
  const saveUserName = useCallback(async (name) => {
    await setDoc(uDoc('settings', 'app'), { userName: name }, { merge: true });
  }, [uid]);

  // Phone number lives on the top-level users/{uid} profile doc (not the
  // settings subcollection) so the shift-reminder Cloud Function can look it
  // up — and reverse-lookup which user texted in — without needing a
  // signed-in client.
  const savePhoneNumber = useCallback(async (phone) => {
    await setDoc(doc(db, 'users', uid), { phoneNumber: phone }, { merge: true });
  }, [uid]);

  return (
    <AppContext.Provider value={{
      accounts, bills, tasks, darsHistory, loading,
      projectedIncome, saveProjectedIncome,
      projectedExpenses, saveProjectedExpenses,
      deferredItems, saveDeferredItems,
      billPayments, saveBillPayments,
      plaidLinkedIds, plaidBalances,
      creditSchedule, saveCreditSchedule,
      currentScreen, setCurrentScreen,
      userName, saveUserName, savePhoneNumber,
      addAccount, updateAccount, deleteAccount,
      addBill, updateBill, deleteBill,
      addTask, toggleTask, deleteTask,
      saveDars, getCurrentMonthDars, updateBankBalance,
      cars, addCar, updateCar, deleteCar,
      driverProfile, saveDriverProfile,
      rnProfile, saveRNProfile,
      workSchedule, setWorkShift, deleteWorkShift,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
