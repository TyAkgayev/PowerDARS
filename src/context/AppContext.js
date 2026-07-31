import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../config/firebase';
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
  const [creditSchedule, setCreditSchedule] = useState({});
  const darsRedirectChecked = useRef(false);

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

  // Projected income listener
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'projectedIncome'), (snap) => {
      if (snap.exists()) setProjectedIncome(snap.data().entries || {});
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

  // Cars listener
  useEffect(() => {
    const q = query(collection(db, 'cars'), orderBy('order', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setCars(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  // Driver profile listener
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'driverProfile'), (snap) => {
      if (snap.exists()) setDriverProfile(snap.data());
    });
    return unsub;
  }, []);

  // Work schedule listener
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'workSchedule'), (snap) => {
      const sched = {};
      snap.docs.forEach(d => { sched[d.id] = { id: d.id, ...d.data() }; });
      setWorkSchedule(sched);
    });
    return unsub;
  }, []);

  // RN profile listener
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'rnProfile'), (snap) => {
      if (snap.exists()) setRNProfile(snap.data());
    });
    return unsub;
  }, []);

  // Projected expenses listener
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'projectedExpenses'), (snap) => {
      if (snap.exists()) setProjectedExpenses(snap.data().entries || {});
    });
    return unsub;
  }, []);

  // Deferred items listener
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'deferredItems'), (snap) => {
      if (snap.exists()) setDeferredItems(snap.data().items || []);
    });
    return unsub;
  }, []);

  // Bill payments listener
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'billPayments'), (snap) => {
      if (snap.exists()) setBillPayments(snap.data().payments || {});
    });
    return unsub;
  }, []);

  // Credit card monthly-due schedule listener — populated when a bill is
  // dragged from the checklist onto a calendar day
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'creditSchedule'), (snap) => {
      if (snap.exists()) setCreditSchedule(snap.data().schedule || {});
    });
    return unsub;
  }, []);

  // Accounts no longer have due dates — every payment is scheduled manually,
  // so strip any leftover due-day fields from older accounts.
  useEffect(() => {
    accounts.forEach(acc => {
      if ((acc.fields || []).some(f => f.type === 'date')) {
        updateDoc(doc(db, 'accounts', acc.id), {
          fields: acc.fields.filter(f => f.type !== 'date'),
        });
      }
    });
  }, [accounts]);

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

  // — Cars —
  const addCar = useCallback(async (data) => {
    await addDoc(collection(db, 'cars'), { ...data, order: cars.length, createdAt: serverTimestamp() });
  }, [cars.length]);

  const updateCar = useCallback(async (id, updates) => {
    await updateDoc(doc(db, 'cars', id), updates);
  }, []);

  const deleteCar = useCallback(async (id) => {
    await deleteDoc(doc(db, 'cars', id));
  }, []);

  const saveDriverProfile = useCallback(async (data) => {
    await setDoc(doc(db, 'settings', 'driverProfile'), data, { merge: true });
  }, []);

  const saveRNProfile = useCallback(async (data) => {
    await setDoc(doc(db, 'settings', 'rnProfile'), data, { merge: true });
  }, []);

  // — Work Schedule —
  const setWorkShift = useCallback(async (dateStr, shift, location) => {
    await setDoc(doc(db, 'workSchedule', dateStr), { date: dateStr, shift, location: location || '' });
  }, []);

  const deleteWorkShift = useCallback(async (dateStr) => {
    await deleteDoc(doc(db, 'workSchedule', dateStr));
  }, []);

  // — DARS — filled out once per month, keyed by "YYYY-MM". Defaults to the
  // current month but can target any month, so next month's bills can be
  // planned ahead of time from within DARS.
  const saveDars = useCallback(async (entries, monthStr) => {
    const date = monthStr || currentMonthStr();
    await setDoc(doc(db, 'dars', date), {
      date,
      entries,
      submittedAt: serverTimestamp(),
    });
  }, []);

  const getCurrentMonthDars = useCallback(() => darsHistory[currentMonthStr()] || null, [darsHistory]);

  // Bank balances are edited straight from the dashboard rather than through
  // the monthly DARS form. This merges into the same month's dars doc (so
  // history/sparklines keep working) but never touches submittedAt, which is
  // what marks the monthly DARS itself as done.
  const updateBankBalance = useCallback(async (accountId, fieldId, value) => {
    const date = currentMonthStr();
    await setDoc(doc(db, 'dars', date), {
      date,
      entries: { [accountId]: { [fieldId]: value } },
    }, { merge: true });
  }, []);

  // — Credit card payment scheduling — dragging a bill from the checklist
  // onto a calendar day records which date it was scheduled for
  const saveCreditSchedule = useCallback(async (schedule) => {
    await setDoc(doc(db, 'settings', 'creditSchedule'), { schedule });
  }, []);

  // — Projected Income —
  const saveProjectedIncome = useCallback(async (entries) => {
    await setDoc(doc(db, 'settings', 'projectedIncome'), { entries });
  }, []);

  const saveProjectedExpenses = useCallback(async (entries) => {
    await setDoc(doc(db, 'settings', 'projectedExpenses'), { entries });
  }, []);

  const saveDeferredItems = useCallback(async (items) => {
    await setDoc(doc(db, 'settings', 'deferredItems'), { items });
  }, []);

  const saveBillPayments = useCallback(async (payments) => {
    await setDoc(doc(db, 'settings', 'billPayments'), { payments });
  }, []);

  // — Settings —
  const saveUserName = useCallback(async (name) => {
    await setDoc(doc(db, 'settings', 'app'), { userName: name }, { merge: true });
  }, []);

  return (
    <AppContext.Provider value={{
      accounts, bills, tasks, darsHistory, loading,
      projectedIncome, saveProjectedIncome,
      projectedExpenses, saveProjectedExpenses,
      deferredItems, saveDeferredItems,
      billPayments, saveBillPayments,
      creditSchedule, saveCreditSchedule,
      currentScreen, setCurrentScreen,
      userName, saveUserName,
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
