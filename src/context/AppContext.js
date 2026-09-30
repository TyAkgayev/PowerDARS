import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, setDoc, serverTimestamp,
} from 'firebase/firestore';

const AppContext = createContext(null);

const EMPTY_LICENSE_CHECK = {
  licenseStatus: null, registrationStatus: null, registrationExpiration: null, licensePoints: null,
  tickets: [], status: null, error: null, checkedAt: null,
};

const EMPTY_INSURANCE_CHECK = { insuranceStatus: null, status: null, error: null, checkedAt: null };

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Used until the user picks a display name in Settings (saveUserName) —
// prefer their real name from Google/Apple sign-in, else their email/username.
function deriveDefaultName(user) {
  if (!user) return 'there';
  if (user.displayName) return user.displayName.split(' ')[0];
  if (user.email) {
    const local = user.email.split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return 'there';
}

export function AppProvider({ children }) {
  const { uid, user } = useAuth();
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
  const [userNameOverride, setUserNameOverride] = useState(null);
  const userName = userNameOverride || deriveDefaultName(user);
  const [cars, setCars] = useState([]);
  const [licenseCheck, setLicenseCheck] = useState(EMPTY_LICENSE_CHECK);
  const [insuranceCheck, setInsuranceCheck] = useState(EMPTY_INSURANCE_CHECK);
  const [rnProfile, setRNProfile] = useState({ licenseNumber: '', expiration: '', state: '', compact: false, notes: '' });
  const [workSchedule, setWorkSchedule] = useState({});
  const [projectedExpenses, setProjectedExpenses] = useState({});
  const [deferredItems, setDeferredItems] = useState([]);
  const [billPayments, setBillPayments] = useState({});
  const [plaidLinkedIds, setPlaidLinkedIds] = useState(new Set());
  const [plaidBalances, setPlaidBalances] = useState({});
  const [creditSchedule, setCreditSchedule] = useState({});
  const [categories, setCategories] = useState([]);
  const [accountReports, setAccountReports] = useState({});

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

  // Categories listener — field templates shared by every account of that
  // category (see addCategory below).
  useEffect(() => {
    if (!uid) return;
    const q = query(uCol('categories'), orderBy('order', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [uid]);

  // Account reports listener — the "latest known state" doc per account that
  // a future daily agent will write field values into (see the Car screen's
  // licenseStatus/insuranceStatus agents for the same pattern). Nothing
  // writes here yet; the DAR screen just reads whatever's present.
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uCol('accountReports'), (snap) => {
      const reports = {};
      snap.docs.forEach(d => { reports[d.id] = { id: d.id, ...d.data() }; });
      setAccountReports(reports);
    });
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

  // Bank balance history listener — the old monthly "dars" collection now
  // only holds bank balances (via updateBankBalance below), used for the
  // Dashboard's balance sparklines.
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
      setUserNameOverride(snap.exists() ? (snap.data().userName || null) : null);
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

  // License status check results listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('licenseStatus', 'latest'), (snap) => {
      setLicenseCheck(snap.exists() ? snap.data() : EMPTY_LICENSE_CHECK);
    });
    return unsub;
  }, [uid]);

  // Insurance status check results listener
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(uDoc('insuranceStatus', 'latest'), (snap) => {
      setInsuranceCheck(snap.exists() ? snap.data() : EMPTY_INSURANCE_CHECK);
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

  // Reset the visible screen whenever the signed-in user changes, so
  // switching accounts doesn't leave you on a screen from the last session.
  useEffect(() => {
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

  // — Categories — a category is a reusable field template (e.g. "Credit
  // Card" -> Balance, Amount Due, APR, ...); accounts pick a category
  // instead of defining their own fields, so every account of that category
  // shares a schema a future daily agent can populate.
  const addCategory = useCallback(async (data) => {
    await addDoc(uCol('categories'), {
      ...data,
      order: categories.length,
      createdAt: serverTimestamp(),
    });
  }, [uid, categories.length]);

  const updateCategory = useCallback(async (id, updates) => {
    await updateDoc(uDoc('categories', id), updates);
  }, [uid]);

  const deleteCategory = useCallback(async (id) => {
    await deleteDoc(uDoc('categories', id));
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

  // Bank balances are edited straight from the dashboard. This merges into
  // the current month's dars doc (kept only for bank-balance history/
  // sparklines now that the monthly DARS sheet itself is gone).
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
      categories, addCategory, updateCategory, deleteCategory,
      accountReports,
      addBill, updateBill, deleteBill,
      addTask, toggleTask, deleteTask,
      updateBankBalance,
      cars, addCar, updateCar, deleteCar,
      licenseCheck,
      insuranceCheck,
      rnProfile, saveRNProfile,
      workSchedule, setWorkShift, deleteWorkShift,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
