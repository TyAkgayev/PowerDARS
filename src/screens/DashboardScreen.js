import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Image, Modal, TextInput, useWindowDimensions,
  PanResponder, Animated, Easing,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { ICONS } from '../config/icons';
import IconView from '../components/IconView';

// ─── Colors ────────────────────────────────────────────────────────────────
const C = {
  primary: '#4361EE',
  primaryLight: '#EEF2FF',
  bg: '#F0F4FF',
  card: '#FFFFFF',
  text: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
  bills: '#EF4444',
  income: '#22C55E',
  reminder: '#F59E0B',
  personal: '#A855F7',
  other: '#3B82F6',
};

const CAT_COLOR = {
  bills: C.bills,
  income: C.income,
  reminder: C.reminder,
  personal: C.personal,
  wireless: '#0EA5E9',
  other: C.other,
};

const DAYS_SHORT = ['S','M','T','W','T','F','S'];
const DAYS_FULL  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

// ─── Helpers ────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2,'0'); }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(dateStr + 'T00:00:00');
  return Math.round((due - today) / 86400000);
}
function fmtCurrency(val) {
  if (val === undefined || val === null || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

function Sparkline({ data = [], color = '#4361EE', width = 90, height = 36 }) {
  const nums = (data || []).map(Number).filter(n => !isNaN(n));
  if (nums.length < 2) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<line x1="0" y1="${height/2}" x2="${width}" y2="${height/2}" stroke="${color}" stroke-width="2" stroke-opacity="0.35"/>` +
      `</svg>`;
    return <Image source={{ uri: 'data:image/svg+xml;base64,' + btoa(svg) }} style={{ width, height }} />;
  }
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min || 1;
  const p = 4;
  const pts = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * (width - p*2) + p;
    const y = height - p - ((v - min) / range) * (height - p*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  return <Image source={{ uri: 'data:image/svg+xml;base64,' + btoa(svg) }} style={{ width, height }} />;
}

// ─── Draggable bill chip (Bills checklist → calendar) ─────────────────────────
// Mirrors the money/expense/loan bag drag mechanism above, but one instance
// per unscheduled bill so each can be dropped on its own chosen day.
function DraggableBillChip({ bill, cellsRef, onHoverChange, onDrop }) {
  const anim = useRef(new Animated.ValueXY()).current;
  const [dragging, setDragging] = useState(false);
  const hoverRef = useRef(null);

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      anim.setValue({ x: 0, y: 0 });
      setDragging(true);
    },
    onPanResponderMove: (e, gs) => {
      anim.x.setValue(gs.dx);
      anim.y.setValue(gs.dy);
      const x = e.nativeEvent.clientX ?? gs.moveX;
      const y = e.nativeEvent.clientY ?? gs.moveY;
      let found = null;
      if (x != null && y != null && typeof document !== 'undefined') {
        const el = document.getElementById('powerdars-cal-grid');
        if (el) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            const col = Math.min(6, Math.floor((x - r.left) / (r.width / 7)));
            const row = Math.min(5, Math.floor((y - r.top) / (r.height / 6)));
            const cell = cellsRef.current[row * 7 + col];
            if (cell?.cur && cell?.str) found = cell.str;
          }
        }
      }
      if (found !== hoverRef.current) {
        hoverRef.current = found;
        onHoverChange(found);
      }
    },
    onPanResponderRelease: () => {
      const dateStr = hoverRef.current;
      if (dateStr) {
        const n = new Date(); n.setHours(0, 0, 0, 0);
        if (new Date(dateStr + 'T00:00:00') >= n) onDrop(dateStr);
      }
      hoverRef.current = null;
      onHoverChange(null);
      Animated.spring(anim, { toValue: { x: 0, y: 0 }, useNativeDriver: false, tension: 40, friction: 7 }).start();
      setDragging(false);
    },
    onPanResponderTerminate: () => {
      hoverRef.current = null;
      onHoverChange(null);
      Animated.spring(anim, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      setDragging(false);
    },
  })).current;

  return (
    <Animated.View
      style={[cal.billChip, dragging && cal.billChipDragging, { transform: anim.getTranslateTransform() }]}
      {...responder.panHandlers}
    >
      <Text style={cal.billChipIcon}>{bill.icon || '💳'}</Text>
      <Text style={cal.billChipName} numberOfLines={1}>{bill.name}</Text>
      <Text style={cal.billChipAmt}>${bill.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}</Text>
    </Animated.View>
  );
}

// ─── Calendar ────────────────────────────────────────────────────────────────
function CalendarView({ bills, accounts, darsHistory, isMobile, projectedIncome, saveProjectedIncome, projectedExpenses, saveProjectedExpenses, deferredItems, saveDeferredItems, cellsRef, billDragOverStr }) {
  const today = new Date();
  const [yr, setYr] = useState(today.getFullYear());
  const [mo, setMo] = useState(today.getMonth());
  const [incomeModal, setIncomeModal] = useState(null);
  const [incomeInput, setIncomeInput] = useState('');
  const [incomeSource, setIncomeSource] = useState('');

  // ── Drag-to-add-income refs ──────────────────────────────────────────────
  const dragAnim = useRef(new Animated.ValueXY()).current;
  const [isDragging, setIsDragging] = useState(false);
  const gridRef = useRef(null);
  const gridAbsPos = useRef(null);
  const projIncomeRef = useRef({});
  const hoverCellRef = useRef(null);
  const [dragOverStr, setDragOverStr] = useState(null);

  // ── Expense bag refs ─────────────────────────────────────────────────────
  const expenseDragAnim = useRef(new Animated.ValueXY()).current;
  const [isExpenseDragging, setIsExpenseDragging] = useState(false);
  const expenseHoverCellRef = useRef(null);
  const projExpenseRef = useRef({});
  const [expenseDragOverStr, setExpenseDragOverStr] = useState(null);
  const [expenseModal, setExpenseModal] = useState(null);
  const [expenseInput, setExpenseInput] = useState('');
  const [expenseName, setExpenseName] = useState('');

  // ── Loan bag refs ────────────────────────────────────────────────────────
  const loanDragAnim = useRef(new Animated.ValueXY()).current;
  const [isLoanDragging, setIsLoanDragging] = useState(false);
  const loanHoverCellRef = useRef(null);
  const [loanDragOverStr, setLoanDragOverStr] = useState(null);
  const [loanModal, setLoanModal] = useState(null);
  const [loanAmount, setLoanAmount] = useState('');
  const [loanDesc, setLoanDesc] = useState('');
  const [loanRepayDate, setLoanRepayDate] = useState('');

  // ── Defer system ─────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState(null);
  const [deferModal, setDeferModal] = useState(null);
  const [deferDate, setDeferDate] = useState('');
  const [deferIndefinite, setDeferIndefinite] = useState(false);

  useEffect(() => { projIncomeRef.current = projectedIncome; }, [projectedIncome]);
  useEffect(() => { projExpenseRef.current = projectedExpenses || {}; }, [projectedExpenses]);

  const onGridLayout = useCallback(() => {
    gridRef.current?.measure((fx, fy, width, height, px, py) => {
      gridAbsPos.current = { x: px, y: py, width, height };
    });
  }, []);

  const bagResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      dragAnim.setValue({ x: 0, y: 0 });
      setIsDragging(true);
      gridRef.current?.measure((fx, fy, width, height, px, py) => {
        gridAbsPos.current = { x: px, y: py, width, height };
      });
    },
    onPanResponderMove: (e, gs) => {
      dragAnim.x.setValue(gs.dx);
      dragAnim.y.setValue(gs.dy);
      // Track which cell the bag is over so release can just read the ref
      const x = e.nativeEvent.clientX ?? gs.moveX;
      const y = e.nativeEvent.clientY ?? gs.moveY;
      let found = null;
      if (x != null && y != null && typeof document !== 'undefined') {
        const el = document.getElementById('powerdars-cal-grid');
        if (el) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            const col = Math.min(6, Math.floor((x - r.left) / (r.width / 7)));
            const row = Math.min(5, Math.floor((y - r.top) / (r.height / 6)));
            const cell = cellsRef.current[row * 7 + col];
            if (cell?.cur && cell?.str) found = cell.str;
          }
        }
      }
      if (found !== hoverCellRef.current) {
        hoverCellRef.current = found;
        setDragOverStr(found);
      }
    },
    onPanResponderRelease: () => {
      const dateStr = hoverCellRef.current;
      if (dateStr) {
        const n = new Date(); n.setHours(0, 0, 0, 0);
        if (new Date(dateStr + 'T00:00:00') >= n) {
          setIncomeInput('');
          setIncomeSource('');
          setIncomeModal(dateStr);
        }
      }
      hoverCellRef.current = null;
      setDragOverStr(null);
      Animated.spring(dragAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: false, tension: 40, friction: 7 }).start();
      setIsDragging(false);
    },
    onPanResponderTerminate: () => {
      hoverCellRef.current = null;
      setDragOverStr(null);
      Animated.spring(dragAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      setIsDragging(false);
    },
  })).current;

  const expenseBagResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      expenseDragAnim.setValue({ x: 0, y: 0 });
      setIsExpenseDragging(true);
    },
    onPanResponderMove: (e, gs) => {
      expenseDragAnim.x.setValue(gs.dx);
      expenseDragAnim.y.setValue(gs.dy);
      const x = e.nativeEvent.clientX ?? gs.moveX;
      const y = e.nativeEvent.clientY ?? gs.moveY;
      let found = null;
      if (x != null && y != null && typeof document !== 'undefined') {
        const el = document.getElementById('powerdars-cal-grid');
        if (el) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            const col = Math.min(6, Math.floor((x - r.left) / (r.width / 7)));
            const row = Math.min(5, Math.floor((y - r.top) / (r.height / 6)));
            const cell = cellsRef.current[row * 7 + col];
            if (cell?.cur && cell?.str) found = cell.str;
          }
        }
      }
      if (found !== expenseHoverCellRef.current) {
        expenseHoverCellRef.current = found;
        setExpenseDragOverStr(found);
      }
    },
    onPanResponderRelease: () => {
      const dateStr = expenseHoverCellRef.current;
      if (dateStr) {
        const n = new Date(); n.setHours(0, 0, 0, 0);
        if (new Date(dateStr + 'T00:00:00') >= n) {
          setExpenseInput('');
          setExpenseName('');
          setExpenseModal(dateStr);
        }
      }
      expenseHoverCellRef.current = null;
      setExpenseDragOverStr(null);
      Animated.spring(expenseDragAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: false, tension: 40, friction: 7 }).start();
      setIsExpenseDragging(false);
    },
    onPanResponderTerminate: () => {
      expenseHoverCellRef.current = null;
      setExpenseDragOverStr(null);
      Animated.spring(expenseDragAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      setIsExpenseDragging(false);
    },
  })).current;

  const loanBagResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      loanDragAnim.setValue({ x: 0, y: 0 });
      setIsLoanDragging(true);
    },
    onPanResponderMove: (e, gs) => {
      loanDragAnim.x.setValue(gs.dx);
      loanDragAnim.y.setValue(gs.dy);
      const x = e.nativeEvent.clientX ?? gs.moveX;
      const y = e.nativeEvent.clientY ?? gs.moveY;
      let found = null;
      if (x != null && y != null && typeof document !== 'undefined') {
        const el = document.getElementById('powerdars-cal-grid');
        if (el) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            const col = Math.min(6, Math.floor((x - r.left) / (r.width / 7)));
            const row = Math.min(5, Math.floor((y - r.top) / (r.height / 6)));
            const cell = cellsRef.current[row * 7 + col];
            if (cell?.cur && cell?.str) found = cell.str;
          }
        }
      }
      if (found !== loanHoverCellRef.current) {
        loanHoverCellRef.current = found;
        setLoanDragOverStr(found);
      }
    },
    onPanResponderRelease: () => {
      const dateStr = loanHoverCellRef.current;
      if (dateStr) {
        const n = new Date(); n.setHours(0, 0, 0, 0);
        if (new Date(dateStr + 'T00:00:00') >= n) {
          setLoanAmount('');
          setLoanDesc('');
          setLoanRepayDate('');
          setLoanModal(dateStr);
        }
      }
      loanHoverCellRef.current = null;
      setLoanDragOverStr(null);
      Animated.spring(loanDragAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: false, tension: 40, friction: 7 }).start();
      setIsLoanDragging(false);
    },
    onPanResponderTerminate: () => {
      loanHoverCellRef.current = null;
      setLoanDragOverStr(null);
      Animated.spring(loanDragAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      setIsLoanDragging(false);
    },
  })).current;

  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const firstDay    = new Date(yr, mo, 1).getDay();
  const prevDays    = new Date(yr, mo, 0).getDate();

  const cells = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: prevDays - i, cur: false, str: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, cur: true, str: `${yr}-${pad(mo+1)}-${pad(d)}` });
  while (cells.length < 42) cells.push({ day: cells.length - firstDay - daysInMonth + 1, cur: false, str: null });
  cellsRef.current = cells;

  const billsByDate = useMemo(() => {
    const map = {};
    bills.forEach(b => {
      if (!b.dueDate) return;
      if (!map[b.dueDate]) map[b.dueDate] = [];
      map[b.dueDate].push(b);
    });
    return map;
  }, [bills]);

  // ── Financial projection ──────────────────────────────────────────────────
  const projection = useMemo(() => {
    const bankAccts = (accounts || []).filter(a => BANK_TYPES.includes(a.type));
    const startBalance = bankAccts.reduce((sum, acc) => {
      const pf = acc.fields?.find(f => f.type === 'currency');
      if (!pf) return sum;
      return sum + (parseFloat(getLatestValue(darsHistory || {}, acc.id, pf.id)) || 0);
    }, 0);
    if (bankAccts.length === 0) return {};

    const now = new Date(); now.setHours(0, 0, 0, 0);
    const moEnd = new Date(yr, mo + 1, 0); moEnd.setHours(0, 0, 0, 0);
    if (moEnd < now) return {}; // past month — no projection

    // Walk day-by-day from today through end of viewed month so income/bills
    // from intermediate months are included in the running balance.
    let balance = startBalance;
    const result = {};
    const iterDate = new Date(now);
    while (iterDate <= moEnd) {
      const y = iterDate.getFullYear();
      const m = iterDate.getMonth();
      const d = iterDate.getDate();
      const dateStr = `${y}-${pad(m + 1)}-${pad(d)}`;

      const incEntry = projectedIncome[dateStr];
      const incDayTotal = Array.isArray(incEntry)
        ? incEntry.reduce((s, e) => s + (parseFloat(e.amount ?? e) || 0), 0)
        : incEntry ? (parseFloat(incEntry.amount ?? incEntry) || 0) : 0;
      balance += incDayTotal;

      const expEntry = (projectedExpenses || {})[dateStr];
      const expDayTotal = Array.isArray(expEntry)
        ? expEntry.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
        : expEntry ? (parseFloat(expEntry.amount) || 0) : 0;
      balance -= expDayTotal;

      const events = billsByDate[dateStr] || [];
      const insufficient = new Set();
      for (const ev of events) {
        const amt = Math.abs(parseFloat(ev.amount) || 0);
        if (ev.category === 'income') { balance += amt; }
        else { if (balance < amt) insufficient.add(ev.id); balance -= amt; }
      }

      if (y === yr && m === mo) result[dateStr] = { balance, insufficient };
      iterDate.setDate(iterDate.getDate() + 1);
    }
    return result;
  }, [accounts, darsHistory, billsByDate, projectedIncome, projectedExpenses, yr, mo]);

  const goBack = () => { if (mo === 0) { setMo(11); setYr(y => y-1); } else setMo(m => m-1); };
  const goFwd  = () => { if (mo === 11) { setMo(0); setYr(y => y+1); } else setMo(m => m+1); };

  const dayHeaders = isMobile ? DAYS_SHORT : DAYS_FULL;

  const now = new Date(); now.setHours(0, 0, 0, 0);

  const closeIncomeModal = () => { setIncomeModal(null); setIncomeInput(''); setIncomeSource(''); };

  const handleAddIncome = () => {
    const amt = parseFloat(incomeInput);
    if (!isNaN(amt) && amt > 0) {
      const newIncome = { ...projIncomeRef.current };
      const raw = newIncome[incomeModal];
      const existing = Array.isArray(raw) ? raw
        : raw ? [{ amount: parseFloat(raw.amount ?? raw) || 0, source: raw.source || '' }]
        : [];
      newIncome[incomeModal] = [...existing, { amount: amt, source: incomeSource.trim() }];
      saveProjectedIncome(newIncome);
    }
    closeIncomeModal();
  };

  const handleDeleteIncomeEntry = (dateStr, idx) => {
    const newIncome = { ...projIncomeRef.current };
    const raw = newIncome[dateStr];
    const existing = Array.isArray(raw) ? raw
      : raw ? [{ amount: parseFloat(raw.amount ?? raw) || 0, source: raw.source || '' }]
      : [];
    const updated = existing.filter((_, i) => i !== idx);
    if (updated.length === 0) delete newIncome[dateStr];
    else newIncome[dateStr] = updated;
    saveProjectedIncome(newIncome);
  };

  // ── Expense handlers ──────────────────────────────────────────────────────
  const closeExpenseModal = () => { setExpenseModal(null); setExpenseInput(''); setExpenseName(''); };

  const handleAddExpense = () => {
    const amt = parseFloat(expenseInput);
    if (!isNaN(amt) && amt > 0) {
      const newExp = { ...projExpenseRef.current };
      const raw = newExp[expenseModal];
      const existing = Array.isArray(raw) ? raw : raw ? [raw] : [];
      newExp[expenseModal] = [...existing, { amount: amt, name: expenseName.trim() || 'Expense' }];
      saveProjectedExpenses(newExp);
    }
    closeExpenseModal();
  };

  const handleDeleteExpenseEntry = (dateStr, idx) => {
    const newExp = { ...projExpenseRef.current };
    const raw = newExp[dateStr];
    const existing = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const updated = existing.filter((_, i) => i !== idx);
    if (updated.length === 0) delete newExp[dateStr];
    else newExp[dateStr] = updated;
    saveProjectedExpenses(newExp);
  };

  // ── Loan handlers ─────────────────────────────────────────────────────────
  const closeLoanModal = () => { setLoanModal(null); setLoanAmount(''); setLoanDesc(''); setLoanRepayDate(''); };

  const handleAddLoan = () => {
    const amt = parseFloat(loanAmount);
    if (!isNaN(amt) && amt > 0 && loanModal && loanRepayDate) {
      const incomeLabel = loanDesc.trim() || 'Loan';
      const newIncome = { ...projIncomeRef.current };
      const rawInc = newIncome[loanModal];
      const existingInc = Array.isArray(rawInc) ? rawInc
        : rawInc ? [{ amount: parseFloat(rawInc.amount ?? rawInc) || 0, source: rawInc.source || '' }]
        : [];
      newIncome[loanModal] = [...existingInc, { amount: amt, source: incomeLabel }];
      saveProjectedIncome(newIncome);

      const newExp = { ...projExpenseRef.current };
      const rawExp = newExp[loanRepayDate];
      const existingExp = Array.isArray(rawExp) ? rawExp : rawExp ? [rawExp] : [];
      newExp[loanRepayDate] = [...existingExp, { amount: amt, name: `Repay: ${incomeLabel}` }];
      saveProjectedExpenses(newExp);
    }
    closeLoanModal();
  };

  // ── Defer handlers ────────────────────────────────────────────────────────
  const handleDefer = () => {
    if (!deferModal) return;
    const { entry, dateStr, entryIdx } = deferModal;
    handleDeleteExpenseEntry(dateStr, entryIdx);
    const newDeferred = [...(deferredItems || []), {
      id: Date.now().toString(),
      name: entry.name || 'Expense',
      amount: entry.amount,
      dateDeferred: dateStr,
      deferUntil: deferIndefinite ? null : deferDate,
    }];
    saveDeferredItems(newDeferred);
    setDeferModal(null);
    setDeferDate('');
    setDeferIndefinite(false);
  };

  // payDeferred handled at DashboardScreen level (state passed down)

  return (
    <View style={cal.card}>
      {/* Income injection modal */}
      <Modal visible={incomeModal !== null} transparent animationType="fade" onRequestClose={closeIncomeModal}>
        <View style={cal.incOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={closeIncomeModal} />
          <View style={cal.incBox}>
            <Text style={cal.incTitle}>Projected Income</Text>
            <Text style={cal.incDate}>{incomeModal}</Text>
            <TextInput style={cal.incInput} value={incomeInput} onChangeText={setIncomeInput}
              keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={C.faint} autoFocus />
            <TextInput style={[cal.incInput, { marginTop: 8 }]} value={incomeSource} onChangeText={setIncomeSource}
              placeholder="Source (e.g. Paycheck)" placeholderTextColor={C.faint} />
            <View style={cal.incBtns}>
              <TouchableOpacity style={cal.incCancel} onPress={closeIncomeModal}>
                <Text style={cal.incCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={cal.incSave} onPress={handleAddIncome}>
                <Text style={cal.incSaveTxt}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Expense injection modal */}
      <Modal visible={expenseModal !== null} transparent animationType="fade" onRequestClose={closeExpenseModal}>
        <View style={cal.incOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={closeExpenseModal} />
          <View style={cal.incBox}>
            <Text style={[cal.incTitle, { color: C.bills }]}>Add Expense</Text>
            <Text style={cal.incDate}>{expenseModal}</Text>
            <TextInput style={cal.incInput} value={expenseInput} onChangeText={setExpenseInput}
              keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={C.faint} autoFocus />
            <TextInput style={[cal.incInput, { marginTop: 8 }]} value={expenseName} onChangeText={setExpenseName}
              placeholder="Description (e.g. Groceries)" placeholderTextColor={C.faint} />
            <View style={cal.incBtns}>
              <TouchableOpacity style={cal.incCancel} onPress={closeExpenseModal}>
                <Text style={cal.incCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[cal.incSave, { backgroundColor: C.bills }]} onPress={handleAddExpense}>
                <Text style={cal.incSaveTxt}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Loan modal */}
      <Modal visible={loanModal !== null} transparent animationType="fade" onRequestClose={closeLoanModal}>
        <View style={cal.incOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={closeLoanModal} />
          <View style={[cal.incBox, { width: 320 }]}>
            <Text style={[cal.incTitle, { color: '#6366F1' }]}>🏦 Quick Loan</Text>
            <Text style={cal.incDate}>Income on: {loanModal}</Text>
            <TextInput style={cal.incInput} value={loanAmount} onChangeText={setLoanAmount}
              keyboardType="decimal-pad" placeholder="Amount ($)" placeholderTextColor={C.faint} autoFocus />
            <TextInput style={[cal.incInput, { marginTop: 8 }]} value={loanDesc} onChangeText={setLoanDesc}
              placeholder="Description" placeholderTextColor={C.faint} />
            <TextInput style={[cal.incInput, { marginTop: 8 }]} value={loanRepayDate} onChangeText={setLoanRepayDate}
              placeholder="Repay date (YYYY-MM-DD)" placeholderTextColor={C.faint} />
            <Text style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>A repayment expense will be added on the repay date.</Text>
            <View style={cal.incBtns}>
              <TouchableOpacity style={cal.incCancel} onPress={closeLoanModal}>
                <Text style={cal.incCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[cal.incSave, { backgroundColor: '#6366F1' }]} onPress={handleAddLoan}>
                <Text style={cal.incSaveTxt}>Add Loan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Context menu (right-click on expense chip) */}
      {contextMenu && (
        <Modal transparent visible animationType="none" onRequestClose={() => setContextMenu(null)}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setContextMenu(null)} />
          <View style={[cal.ctxMenu, { top: contextMenu.y, left: contextMenu.x }]}>
            <TouchableOpacity style={cal.ctxItem} onPress={() => { setDeferModal(contextMenu); setContextMenu(null); }}>
              <Text style={cal.ctxItemTxt}>📌 Defer this expense</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* Defer modal */}
      <Modal visible={deferModal !== null} transparent animationType="fade" onRequestClose={() => setDeferModal(null)}>
        <View style={cal.incOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setDeferModal(null)} />
          <View style={[cal.incBox, { width: 300 }]}>
            <Text style={[cal.incTitle, { color: '#EF4444' }]}>📌 Defer Expense</Text>
            <Text style={cal.incDate}>{deferModal?.entry?.name} — ${parseFloat(deferModal?.entry?.amount || 0).toFixed(2)}</Text>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 }}
              onPress={() => setDeferIndefinite(v => !v)}>
              <View style={[cal.checkbox, deferIndefinite && cal.checkboxOn]}>
                {deferIndefinite && <Text style={{ color: '#fff', fontSize: 11 }}>✓</Text>}
              </View>
              <Text style={{ fontSize: 14, color: C.text }}>Indefinite (no due date)</Text>
            </TouchableOpacity>
            {!deferIndefinite && (
              <TextInput style={[cal.incInput, { marginTop: 4 }]} value={deferDate} onChangeText={setDeferDate}
                placeholder="Defer until (YYYY-MM-DD)" placeholderTextColor={C.faint} />
            )}
            <View style={cal.incBtns}>
              <TouchableOpacity style={cal.incCancel} onPress={() => setDeferModal(null)}>
                <Text style={cal.incCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[cal.incSave, { backgroundColor: '#EF4444' }]} onPress={handleDefer}>
                <Text style={cal.incSaveTxt}>Defer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      {/* Header — zIndex:1 lifts the entire header (including the draggable bag) above the grid cells */}
      <View style={[cal.header, { zIndex: 1 }]}>
        <Text style={[cal.title, isMobile && cal.titleMobile]}>{MONTHS[mo]} {yr}</Text>
        <View style={cal.headerRight}>
          {!isMobile && (
            <TouchableOpacity style={cal.todayBtn} onPress={() => { setYr(today.getFullYear()); setMo(today.getMonth()); }}>
              <Text style={cal.todayTxt}>Today</Text>
            </TouchableOpacity>
          )}
          {!isMobile && (
            <Animated.View
              style={[cal.bagToken, isDragging && cal.bagDragging, { transform: dragAnim.getTranslateTransform() }]}
              {...bagResponder.panHandlers}
            >
              <Text style={cal.bagEmoji}>💰</Text>
            </Animated.View>
          )}
          {!isMobile && (
            <Animated.View
              style={[cal.bagToken, cal.bagTokenExpense, isExpenseDragging && cal.bagDragging, { transform: expenseDragAnim.getTranslateTransform() }]}
              {...expenseBagResponder.panHandlers}
            >
              <Text style={cal.bagEmoji}>💸</Text>
            </Animated.View>
          )}
          {!isMobile && (
            <Animated.View
              style={[cal.bagToken, cal.bagTokenLoan, isLoanDragging && cal.bagDragging, { transform: loanDragAnim.getTranslateTransform() }]}
              {...loanBagResponder.panHandlers}
            >
              <Text style={[cal.bagEmoji, { fontSize: 14 }]}>🏦</Text>
            </Animated.View>
          )}
          <TouchableOpacity style={cal.navBtn} onPress={goBack}><Text style={cal.navTxt}>‹</Text></TouchableOpacity>
          <TouchableOpacity style={cal.navBtn} onPress={goFwd}><Text style={cal.navTxt}>›</Text></TouchableOpacity>
        </View>
      </View>

      {/* Day headers */}
      <View style={cal.dayRow}>
        {dayHeaders.map((d, i) => (
          <View key={i} style={cal.dayHead}><Text style={cal.dayHeadTxt}>{d}</Text></View>
        ))}
      </View>

      {/* Grid */}
      <View ref={gridRef} nativeID="powerdars-cal-grid" onLayout={onGridLayout}>
      {Array.from({ length: 6 }, (_, wi) => (
        <View key={wi} style={cal.week}>
          {cells.slice(wi * 7, wi * 7 + 7).map((cell, di) => {
            const isToday = cell.cur && cell.day === today.getDate() && mo === today.getMonth() && yr === today.getFullYear();
            const events = cell.str ? (billsByDate[cell.str] || []) : [];
            const proj = cell.str ? projection[cell.str] : null;
            const incRaw = cell.str ? projectedIncome[cell.str] : null;
            const incEntries = incRaw == null ? []
              : Array.isArray(incRaw) ? incRaw
              : [{ amount: parseFloat(incRaw.amount ?? incRaw) || 0, source: incRaw.source || '' }];
            const incAmt = incEntries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
            const expRaw = cell.str ? (projectedExpenses || {})[cell.str] : null;
            const expEntries = expRaw == null ? []
              : Array.isArray(expRaw) ? expRaw
              : [expRaw];
            const cellDate = cell.str ? new Date(cell.str + 'T00:00:00') : null;
            const isFuture = cell.cur && cellDate && cellDate >= now;

            return (
              <View key={di} style={[cal.cell, isMobile && cal.cellMobile, isToday && cal.cellToday, cell.cur && cell.str && (cell.str === dragOverStr || cell.str === expenseDragOverStr || cell.str === loanDragOverStr || cell.str === billDragOverStr) && cal.cellDrop]}>
                {/* Day number row + projected end-of-day balance */}
                <View style={cal.dayNum}>
                  <Text style={[cal.dayTxt, isMobile && cal.dayTxtMobile, !cell.cur && cal.dayMuted, isToday && cal.dayTxtToday]}>
                    {cell.day}
                  </Text>
                  {isToday && <View style={cal.dot} />}
                  {!isMobile && proj && (
                    <Text style={[cal.projBal, { color: proj.balance >= 0 ? C.income : C.bills }]}>
                      {proj.balance < 0 ? '-' : ''}${Math.abs(proj.balance).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </Text>
                  )}
                </View>

                {/* Desktop chips */}
                {!isMobile && (() => {
                  const rows = [];
                  incEntries.forEach((entry, eidx) => {
                    const eAmt = parseFloat(entry.amount) || 0;
                    if (eAmt <= 0) return;
                    rows.push(
                      <View key={`inc-${eidx}`} style={[cal.chip, { backgroundColor: '#DCFCE7', flexDirection: 'row', alignItems: 'center' }]}>
                        <Text style={[cal.chipName, { color: C.income, flex: 1 }]} numberOfLines={1}>💰 {entry.source || 'Income'}</Text>
                        <Text style={[cal.chipAmt, { color: C.income }]}>+${eAmt.toLocaleString('en-US', { maximumFractionDigits: 0 })}</Text>
                        <TouchableOpacity onPress={() => handleDeleteIncomeEntry(cell.str, eidx)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                          <Text style={{ fontSize: 10, color: C.income, marginLeft: 4, opacity: 0.6 }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  });
                  expEntries.forEach((entry, eidx) => {
                    const eAmt = parseFloat(entry.amount) || 0;
                    if (eAmt <= 0) return;
                    rows.push(
                      <View
                        key={`exp-${eidx}`}
                        style={[cal.chip, { backgroundColor: '#FEE2E2', flexDirection: 'row', alignItems: 'center' }]}
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, entry, dateStr: cell.str, entryIdx: eidx }); }}
                      >
                        <Text style={[cal.chipName, { color: C.bills, flex: 1 }]} numberOfLines={1}>💸 {entry.name || 'Expense'}</Text>
                        <Text style={[cal.chipAmt, { color: C.bills }]}>-${eAmt.toLocaleString('en-US', { maximumFractionDigits: 0 })}</Text>
                        <TouchableOpacity onPress={() => handleDeleteExpenseEntry(cell.str, eidx)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                          <Text style={{ fontSize: 10, color: C.bills, marginLeft: 4, opacity: 0.6 }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  });
                  const slots = 3 - incEntries.length - expEntries.length;
                  events.slice(0, slots).forEach((ev, ei) => {
                    const insuf = proj?.insufficient?.has(ev.id);
                    const textCol = insuf ? C.bills : (CAT_COLOR[ev.category] || C.other);
                    const bg = insuf ? '#FEE2E2' : (ev.category === 'income' ? '#DCFCE7' : '#DCFCE7');
                    const sign = ev.category === 'income' ? '+' : '-';
                    rows.push(
                      <View key={ei} style={[cal.chip, { backgroundColor: bg }, insuf && cal.chipInsuf]}>
                        {insuf && <Text style={cal.warnTxt}>⚠ </Text>}
                        <Text style={[cal.chipName, { color: textCol }]} numberOfLines={1}>{ev.name}</Text>
                        <Text style={[cal.chipAmt, { color: textCol }]}>{sign}${Math.abs(ev.amount).toFixed(0)}</Text>
                      </View>
                    );
                  });
                  const overflow = events.length - slots;
                  if (overflow > 0) rows.push(<Text key="ov" style={cal.overflow}>+{overflow} more</Text>);
                  return rows;
                })()}

                {/* Mobile: dots */}
                {isMobile && events.length > 0 && (
                  <View style={cal.dotRow}>
                    {events.slice(0, 3).map((ev, ei) => (
                      <View key={ei} style={[cal.eventDot, {
                        backgroundColor: proj?.insufficient?.has(ev.id) ? C.bills : (CAT_COLOR[ev.category] || C.other)
                      }]} />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}
      </View>

      {/* Legend */}
      <View style={[cal.legend, isMobile && cal.legendMobile]}>
        {Object.entries(CAT_COLOR).map(([cat, col]) => (
          <View key={cat} style={cal.legendItem}>
            <View style={[cal.legendDot, { backgroundColor: col }]} />
            <Text style={cal.legendTxt}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</Text>
          </View>
        ))}
        <View style={cal.legendItem}>
          <View style={[cal.legendDot, { backgroundColor: C.bills, borderWidth: 1, borderColor: C.bills }]} />
          <Text style={cal.legendTxt}>⚠ Insufficient</Text>
        </View>
      </View>
    </View>
  );
}

const BANK_TYPES = ['checking', 'savings', 'investment'];

function getLatestValue(darsHistory, accountId, fieldId) {
  const entries = Object.values(darsHistory).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  for (const e of entries) {
    if (e.entries?.[accountId]?.[fieldId] !== undefined) return e.entries[accountId][fieldId];
  }
  return null;
}

function getSparklineData(darsHistory, accountId, fieldId) {
  return Object.values(darsHistory)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(-10)
    .map(e => e.entries?.[accountId]?.[fieldId])
    .filter(v => v !== undefined && v !== null && v !== '');
}

function AccountRow({ acc, darsHistory, color, isMobile }) {
  const pf = acc.fields?.find(f => f.type === 'currency') || acc.fields?.[0];
  const val = pf ? getLatestValue(darsHistory, acc.id, pf.id) : null;
  const spark = pf ? getSparklineData(darsHistory, acc.id, pf.id) : [];
  const isNeg = val !== null && parseFloat(val) < 0;
  return (
    <View style={[pnl.row, isMobile && pnl.rowMobile]}>
      <View style={[pnl.icon, { backgroundColor: color + '20' }]}>
        <IconView icon={acc.icon || ICONS[acc.type] || ICONS.checking} size={20} />
      </View>
      <View style={pnl.info}>
        <Text style={pnl.acctName}>{acc.name}</Text>
        {acc.lastFour && <Text style={pnl.acctSub}>•••• {acc.lastFour}</Text>}
        <Text style={[pnl.balance, isNeg && pnl.balanceNeg]}>
          {val !== null ? fmtCurrency(val) : '—'}
        </Text>
        <Text style={pnl.balanceLabel}>{pf ? pf.label : 'Balance'}</Text>
      </View>
      {!isMobile && <Sparkline data={spark} color={color} width={90} height={36} />}
    </View>
  );
}

// ─── BanksPanel ───────────────────────────────────────────────────────────────
function BanksPanel({ accounts, darsHistory, isMobile }) {
  const ACCT_COLORS = ['#3B82F6','#A855F7','#F59E0B','#22C55E','#EF4444','#06B6D4'];
  const bankAccounts = accounts.filter(a => BANK_TYPES.includes(a.type));

  const netWorth = bankAccounts.reduce((sum, acc) => {
    const pf = acc.fields?.[0];
    if (!pf) return sum;
    const val = getLatestValue(darsHistory, acc.id, pf.id);
    if (val === null) return sum;
    const n = parseFloat(val);
    return isNaN(n) ? sum : sum + n;
  }, 0);

  if (bankAccounts.length === 0) return null;

  return (
    <View style={pnl.card}>
      {bankAccounts.map((acc, idx) => (
        <AccountRow
          key={acc.id}
          acc={acc}
          darsHistory={darsHistory}
          color={acc.color || ACCT_COLORS[idx % ACCT_COLORS.length]}
          isMobile={isMobile}
        />
      ))}
      <View style={pnl.totalFooter}>
        <Text style={pnl.nwLabel}>Net Worth</Text>
        <Text style={pnl.nwValue}>{fmtCurrency(netWorth)}</Text>
      </View>
    </View>
  );
}

// ─── AccountSection ────────────────────────────────────────────────────────────
function AccountSection({ title, types, accounts, darsHistory, isMobile, footerLabel, footerColor }) {
  const ACCT_COLORS = ['#3B82F6','#A855F7','#F59E0B','#22C55E','#EF4444','#06B6D4'];
  const filtered = accounts.filter(a => types.includes(a.type));
  if (filtered.length === 0) return null;

  const total = filtered.reduce((sum, acc) => {
    const pf = acc.fields?.find(f => f.type === 'currency');
    if (!pf) return sum;
    const val = getLatestValue(darsHistory, acc.id, pf.id);
    if (val === null) return sum;
    const n = parseFloat(val);
    return isNaN(n) ? sum : sum + Math.abs(n);
  }, 0);

  return (
    <View style={pnl.card}>
      <View style={pnl.header}>
        <Text style={pnl.title}>{title}</Text>
      </View>
      {filtered.map((acc, idx) => (
        <AccountRow
          key={acc.id}
          acc={acc}
          darsHistory={darsHistory}
          color={acc.color || ACCT_COLORS[idx % ACCT_COLORS.length]}
          isMobile={isMobile}
        />
      ))}
      {footerLabel && (
        <View style={pnl.totalFooter}>
          <Text style={pnl.nwLabel}>{footerLabel}</Text>
          <Text style={[pnl.nwValue, footerColor && { color: footerColor }]}>{fmtCurrency(total)}</Text>
        </View>
      )}
    </View>
  );
}

// ─── UpcomingBills ────────────────────────────────────────────────────────────
function UpcomingBills({ bills }) {
  const sorted = useMemo(() =>
    [...bills].filter(b => b.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5),
    [bills]
  );

  const getIcon = (cat) => ICONS[cat] || ICONS.bills;

  return (
    <View style={up.card}>
      <View style={up.header}>
        <Text style={up.title}>Upcoming</Text>
        <TouchableOpacity><Text style={up.viewAll}>View all</Text></TouchableOpacity>
      </View>
      {sorted.length === 0 ? (
        <Text style={up.empty}>No upcoming bills.</Text>
      ) : (
        sorted.map(bill => {
          const days = daysUntil(bill.dueDate);
          const col = CAT_COLOR[bill.category] || C.other;
          const sign = bill.category === 'income' ? '+' : '-';
          const dueTxt = days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow'
            : days < 0 ? `${Math.abs(days)}d overdue` : `Due in ${days} days`;
          return (
            <View key={bill.id} style={up.row}>
              <View style={[up.icon, { backgroundColor: col + '18' }]}>
                <Text style={up.iconTxt}>{bill.icon || getIcon(bill.category)}</Text>
              </View>
              <View style={up.info}>
                <Text style={up.name}>{bill.name}</Text>
                <Text style={[up.due, days < 0 && { color: C.bills }]}>{dueTxt}</Text>
              </View>
              <Text style={[up.amount, { color: bill.category === 'income' ? C.income : C.bills }]}>
                {sign}${Math.abs(bill.amount || 0).toFixed(2)}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}

// ─── MonthlyBillsTracker ──────────────────────────────────────────────────────
function MonthlyBillsTracker({ bills, scheduledCreditBills = [], billPayments, onTogglePaid, unscheduledCreditBills = [], onScheduleCreditBill, cellsRef, onHoverChange, isMobile }) {
  const [billScheduleModal, setBillScheduleModal] = useState(null);
  const [billScheduleDate, setBillScheduleDate] = useState('');
  const today = new Date();
  const todayDay = today.getDate();
  const yr = today.getFullYear();
  const mo = today.getMonth();
  const yearMonth = `${yr}-${String(mo + 1).padStart(2, '0')}`;
  const monthName = MONTHS[mo];

  // Bills from the bills collection
  const collectionBills = useMemo(() =>
    bills.filter(b => b.dueDate && b.dueDate.startsWith(yearMonth)),
    [bills, yearMonth]
  );

  const monthBills = useMemo(() =>
    [...collectionBills, ...scheduledCreditBills]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [collectionBills, scheduledCreditBills]
  );

  const paidIds = useMemo(() => new Set((billPayments || {})[yearMonth] || []), [billPayments, yearMonth]);

  // Index to insert TODAY line: first bill with day >= todayDay
  const todayLineAt = useMemo(() => {
    const idx = monthBills.findIndex(b => parseInt(b.dueDate.split('-')[2], 10) >= todayDay);
    return idx === -1 ? monthBills.length : idx;
  }, [monthBills, todayDay]);

  const totalOwed = useMemo(() =>
    monthBills.filter(b => b.category !== 'income').reduce((s, b) => s + Math.abs(b.amount || 0), 0),
    [monthBills]
  );
  const paidOwed = useMemo(() =>
    monthBills.filter(b => b.category !== 'income' && paidIds.has(b.id)).reduce((s, b) => s + Math.abs(b.amount || 0), 0),
    [monthBills, paidIds]
  );
  // Count against this month's actual bills, not stale ids left in billPayments
  // from bills that no longer exist (e.g. after removing due-date auto-bills).
  const paidCount = useMemo(() =>
    monthBills.filter(b => paidIds.has(b.id)).length,
    [monthBills, paidIds]
  );

  const TodayDivider = () => (
    <View style={mbt.todayLine}>
      <View style={mbt.todayBar} />
      <Text style={mbt.todayTxt}>TODAY</Text>
      <View style={mbt.todayBar} />
    </View>
  );

  return (
    <View style={mbt.card}>
      <View style={mbt.header}>
        <Text style={mbt.title}>{monthName} Bills</Text>
        <View style={mbt.headerRight}>
          <Text style={mbt.paidCount}>{paidCount}/{monthBills.length} paid</Text>
          {totalOwed > 0 && (
            <Text style={mbt.paidAmt}>${paidOwed.toFixed(0)}/${totalOwed.toFixed(0)}</Text>
          )}
        </View>
      </View>

      {unscheduledCreditBills.length > 0 && (
        <View style={cal.billTray}>
          <Text style={cal.billTrayLabel}>📋 Bills to schedule{isMobile ? ' — tap to pick a day' : ' — drag onto a day'}</Text>
          <View style={cal.billTrayRow}>
            {unscheduledCreditBills.map(bill => (
              isMobile ? (
                <TouchableOpacity
                  key={bill.id}
                  style={cal.billChip}
                  onPress={() => { setBillScheduleDate(''); setBillScheduleModal(bill); }}
                >
                  <Text style={cal.billChipIcon}>{bill.icon || '💳'}</Text>
                  <Text style={cal.billChipName} numberOfLines={1}>{bill.name}</Text>
                  <Text style={cal.billChipAmt}>${bill.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}</Text>
                </TouchableOpacity>
              ) : (
                <DraggableBillChip
                  key={bill.id}
                  bill={bill}
                  cellsRef={cellsRef}
                  onHoverChange={onHoverChange}
                  onDrop={(dateStr) => onScheduleCreditBill(bill.accountId, dateStr, bill.amount, bill.name, bill.icon)}
                />
              )
            ))}
          </View>
        </View>
      )}

      {/* Mobile: tap-to-schedule modal (no pointer drag on touch) */}
      <Modal visible={billScheduleModal !== null} transparent animationType="fade" onRequestClose={() => setBillScheduleModal(null)}>
        <View style={cal.incOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setBillScheduleModal(null)} />
          <View style={cal.incBox}>
            <Text style={cal.incTitle}>Schedule Payment</Text>
            <Text style={cal.incDate}>{billScheduleModal?.name} — ${parseFloat(billScheduleModal?.amount || 0).toFixed(2)}</Text>
            <TextInput style={cal.incInput} value={billScheduleDate} onChangeText={setBillScheduleDate}
              placeholder="Payment date (YYYY-MM-DD)" placeholderTextColor={C.faint} autoFocus />
            <View style={cal.incBtns}>
              <TouchableOpacity style={cal.incCancel} onPress={() => setBillScheduleModal(null)}>
                <Text style={cal.incCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={cal.incSave}
                onPress={() => {
                  if (billScheduleDate.trim() && billScheduleModal) {
                    onScheduleCreditBill(billScheduleModal.accountId, billScheduleDate.trim(), billScheduleModal.amount, billScheduleModal.name, billScheduleModal.icon);
                  }
                  setBillScheduleModal(null);
                }}
              >
                <Text style={cal.incSaveTxt}>Schedule</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {monthBills.length === 0 ? (
        <>
          <TodayDivider />
          <Text style={mbt.empty}>No bills scheduled for {monthName}.</Text>
        </>
      ) : (
        <>
          {todayLineAt === 0 && <TodayDivider />}
          {monthBills.map((bill, idx) => {
            const day = parseInt(bill.dueDate.split('-')[2], 10);
            const isPast = day < todayDay;
            const isToday = day === todayDay;
            const isPaid = paidIds.has(bill.id);
            const isOverdue = isPast && !isPaid;

            return (
              <React.Fragment key={bill.id}>
                <TouchableOpacity
                  style={[mbt.billRow, isOverdue && mbt.billRowOverdue, isPaid && mbt.billRowPaid]}
                  onPress={() => onTogglePaid(bill.id, yearMonth)}
                  activeOpacity={0.7}
                >
                  <View style={[mbt.checkbox, isPaid && mbt.checkboxDone, isOverdue && mbt.checkboxOverdue]}>
                    {isPaid && <Text style={mbt.checkmark}>✓</Text>}
                  </View>
                  <View style={mbt.billInfo}>
                    <Text style={[mbt.billName, isPaid && mbt.billNameDone, isOverdue && mbt.billNameOverdue]}>
                      {bill.icon ? `${bill.icon} ` : ''}{bill.name}
                    </Text>
                    <Text style={[mbt.billDue, isOverdue && { color: C.bills }, isToday && { color: C.reminder, fontWeight: '600' }]}>
                      {isToday ? 'Due today' : isPast ? `Was due ${monthName.slice(0,3)} ${day}` : `Due ${monthName.slice(0,3)} ${day}`}
                    </Text>
                  </View>
                  <Text style={[
                    mbt.billAmt,
                    bill.category === 'income' ? { color: C.income } : { color: C.text },
                    isOverdue && { color: C.bills },
                    isPaid && { color: C.faint },
                  ]}>
                    {bill.category === 'income' ? '+' : '-'}${Math.abs(bill.amount || 0).toFixed(2)}
                  </Text>
                </TouchableOpacity>
                {idx + 1 === todayLineAt && idx + 1 < monthBills.length && <TodayDivider />}
              </React.Fragment>
            );
          })}
          {todayLineAt === monthBills.length && <TodayDivider />}
        </>
      )}
    </View>
  );
}

// ─── DeferredItem (animated shaking box) ─────────────────────────────────────
function DeferredItem({ item, onPress }) {
  const shakeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const shake = () => Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 5, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -5, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 4, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -4, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
    shake();
    const id = setInterval(shake, 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Animated.View style={[dfr.box, { transform: [{ translateX: shakeAnim }] }]}>
        <Text style={dfr.marker}>DEFERRED</Text>
        <Text style={dfr.name} numberOfLines={2}>{item.name}</Text>
        <Text style={dfr.amt}>-${parseFloat(item.amount || 0).toFixed(2)}</Text>
        {item.deferUntil && <Text style={dfr.until}>until {item.deferUntil}</Text>}
        <Text style={dfr.tapHint}>Tap to pay</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

function DeferredPanel({ deferredItems, onPay }) {
  if (!deferredItems || deferredItems.length === 0) return null;
  return (
    <View style={[pnl.card, { borderWidth: 1.5, borderColor: '#EF4444' }]}>
      <View style={pnl.header}>
        <Text style={[pnl.title, { color: '#EF4444' }]}>⚠️ Deferred Items</Text>
        <Text style={{ fontSize: 12, color: C.faint }}>{deferredItems.length} item{deferredItems.length !== 1 ? 's' : ''}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {deferredItems.map(item => (
          <DeferredItem key={item.id} item={item} onPress={() => onPay(item)} />
        ))}
      </View>
    </View>
  );
}

// ─── Countdown hook ───────────────────────────────────────────────────────────
function useCountdown(dueDate) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const update = () => {
      if (!dueDate) { setLabel(''); return; }
      const now = new Date();
      const due = new Date(dueDate + 'T23:59:59');
      const diff = due - now;
      if (diff <= 0) { setLabel('OVERDUE'); return; }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      if (days > 0) setLabel(`${days}d ${hours}h left`);
      else if (hours > 0) setLabel(`${hours}h ${mins}m left`);
      else setLabel(`${mins}m left`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [dueDate]);
  return label;
}

function TimeSensitiveTask({ task, onToggle, onDelete }) {
  const countdown = useCountdown(task.dueDate);
  const isOverdue = countdown === 'OVERDUE';
  return (
    <TouchableOpacity style={[trk.urgentBox, isOverdue && trk.urgentBoxOverdue]}
      onPress={() => onToggle(task.id, task.completed)} activeOpacity={0.8}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[trk.urgentTitle, task.completed && trk.taskDone]} numberOfLines={2}>{task.title}</Text>
        <TouchableOpacity onPress={() => onDelete(task.id)} style={trk.delBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={trk.delTxt}>×</Text>
        </TouchableOpacity>
      </View>
      {countdown ? (
        <View style={[trk.countdownBadge, isOverdue && trk.countdownOverdue]}>
          <Text style={[trk.countdownTxt, isOverdue && { color: '#fff' }]}>⏱ {countdown}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── TaskTracker ──────────────────────────────────────────────────────────────
function TaskTracker({ tasks, onToggle, onAdd, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [timeSensitive, setTimeSensitive] = useState(false);

  const fmtDue = (dateStr) => {
    if (!dateStr) return null;
    const days = daysUntil(dateStr);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return 'Overdue';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleAdd = async () => {
    if (!title.trim()) return;
    await onAdd({ title: title.trim(), dueDate: dueDate || null, timeSensitive });
    setTitle(''); setDueDate(''); setTimeSensitive(false); setShowAdd(false);
  };

  const urgentTasks = tasks.filter(t => t.timeSensitive && !t.completed);
  const regularTasks = tasks.filter(t => !t.timeSensitive || t.completed);

  return (
    <View style={[trk.card, { borderWidth: 1, borderColor: C.border }]}>
      <View style={trk.header}>
        <Text style={trk.title}>📋 Tracking</Text>
        <TouchableOpacity onPress={() => setShowAdd(v => !v)}>
          <Text style={trk.addTxt}>+ Add Item</Text>
        </TouchableOpacity>
      </View>

      {showAdd && (
        <View style={trk.addForm}>
          <TextInput style={trk.input} placeholder="Task title..." value={title}
            onChangeText={setTitle} placeholderTextColor={C.faint} />
          <TextInput style={trk.input} placeholder="Due date (YYYY-MM-DD)" value={dueDate}
            onChangeText={setDueDate} placeholderTextColor={C.faint} />
          <TouchableOpacity style={trk.tsRow} onPress={() => setTimeSensitive(v => !v)} activeOpacity={0.7}>
            <View style={[trk.checkbox, timeSensitive && trk.checkboxOn]}>
              {timeSensitive && <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>✓</Text>}
            </View>
            <Text style={[trk.tsLabel, timeSensitive && { color: '#EF4444' }]}>⚡ Time Sensitive</Text>
          </TouchableOpacity>
          <TouchableOpacity style={trk.saveBtn} onPress={handleAdd}>
            <Text style={trk.saveTxt}>Add Task</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Time-sensitive tasks at top */}
      {urgentTasks.length > 0 && (
        <View style={trk.urgentSection}>
          <Text style={trk.sectionLabel}>⚡ URGENT</Text>
          {urgentTasks.map(task => (
            <TimeSensitiveTask key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </View>
      )}

      {/* Regular tasks */}
      {regularTasks.length > 0 && (
        <View style={regularTasks.length > 0 && urgentTasks.length > 0 ? trk.regularSection : {}}>
          {urgentTasks.length > 0 && <Text style={[trk.sectionLabel, { color: C.muted }]}>TASKS</Text>}
          {regularTasks.map(task => {
            const dueLbl = fmtDue(task.dueDate);
            return (
              <TouchableOpacity key={task.id} style={trk.row}
                onPress={() => onToggle(task.id, task.completed)} activeOpacity={0.7}>
                <Text style={[trk.taskTitle, task.completed && trk.taskDone]} numberOfLines={1}>
                  {task.title}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {dueLbl && (
                    <View style={[trk.dueBadge, task.completed && trk.dueBadgeDone]}>
                      <Text style={[trk.dueTxt, task.completed && trk.dueTxtDone]}>{dueLbl}</Text>
                    </View>
                  )}
                  <TouchableOpacity onPress={() => onDelete(task.id)} style={trk.delBtn}>
                    <Text style={trk.delTxt}>×</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {tasks.length === 0 && !showAdd && (
        <Text style={trk.empty}>No tasks yet. Tap "+ Add Item" to start.</Text>
      )}
    </View>
  );
}

// ─── AddBillModal ─────────────────────────────────────────────────────────────
function AddBillModal({ visible, onClose, onSave, isMobile }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [category, setCategory] = useState('bills');
  const [icon, setIcon] = useState('');

  const CATS = ['bills','income','reminder','personal','wireless','other'];

  const handleSave = async () => {
    if (!name.trim() || !dueDate.trim()) return;
    await onSave({ name: name.trim(), amount: parseFloat(amount) || 0, dueDate: dueDate.trim(), category, icon: icon || null });
    setName(''); setAmount(''); setDueDate(''); setCategory('bills'); setIcon('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[mds.overlay, isMobile && mds.overlayMobile]}>
        <View style={[mds.box, isMobile && mds.boxMobile]}>
          <Text style={mds.title}>Add Bill / Event</Text>

          <Text style={mds.label}>Name</Text>
          <TextInput style={mds.input} placeholder="e.g. Electricity Bill" value={name}
            onChangeText={setName} placeholderTextColor={C.faint} />

          <Text style={mds.label}>Amount ($)</Text>
          <TextInput style={mds.input} placeholder="0.00" value={amount}
            onChangeText={setAmount} keyboardType="decimal-pad" placeholderTextColor={C.faint} />

          <Text style={mds.label}>Due Date (YYYY-MM-DD)</Text>
          <TextInput style={mds.input} placeholder="2024-05-15" value={dueDate}
            onChangeText={setDueDate} placeholderTextColor={C.faint} />

          <Text style={mds.label}>Category</Text>
          <View style={mds.catRow}>
            {CATS.map(cat => (
              <TouchableOpacity key={cat}
                style={[mds.catBtn, category === cat && { backgroundColor: CAT_COLOR[cat], borderColor: CAT_COLOR[cat] }]}
                onPress={() => setCategory(cat)}>
                <Text style={[mds.catTxt, category === cat && { color: '#fff' }]}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={mds.btnRow}>
            <TouchableOpacity style={mds.cancelBtn} onPress={onClose}>
              <Text style={mds.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={mds.saveBtn} onPress={handleSave}>
              <Text style={mds.saveTxt}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── DashboardScreen ──────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { accounts, bills, tasks, darsHistory, addTask, toggleTask, deleteTask, userName, projectedIncome, saveProjectedIncome, projectedExpenses, saveProjectedExpenses, deferredItems, saveDeferredItems, billPayments, saveBillPayments, creditSchedule, saveCreditSchedule } = useApp();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isNarrow = width < 1100;
  const [payDeferModal, setPayDeferModal] = useState(null);
  const [payDeferDate, setPayDeferDate] = useState('');

  // Shared with MonthlyBillsTracker so its bill chips can be dragged onto the calendar grid.
  const cellsRef = useRef([]);
  const [billDragOverStr, setBillDragOverStr] = useState(null);

  const handlePayDeferred = () => {
    if (!payDeferModal || !payDeferDate) return;
    const newDeferred = (deferredItems || []).filter(d => d.id !== payDeferModal.id);
    saveDeferredItems(newDeferred);
    const newExp = { ...(projectedExpenses || {}) };
    const raw = newExp[payDeferDate];
    const existing = Array.isArray(raw) ? raw : raw ? [raw] : [];
    newExp[payDeferDate] = [...existing, { amount: payDeferModal.amount, name: payDeferModal.name }];
    saveProjectedExpenses(newExp);
    setPayDeferModal(null);
    setPayDeferDate('');
  };

  const handleToggleBillPaid = useCallback((billId, yearMonth) => {
    const current = (billPayments || {})[yearMonth] || [];
    const updated = current.includes(billId)
      ? current.filter(id => id !== billId)
      : [...current, billId];
    saveBillPayments({ ...(billPayments || {}), [yearMonth]: updated });
  }, [billPayments, saveBillPayments]);

  // ── Account amounts due (from this month's DARS) → Bills checklist ──
  // Accounts no longer carry a due date; each month's amount due sits
  // here until it's dragged onto a calendar day to schedule the payment.
  const currentYearMonth = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const creditAmountsDue = useMemo(() => {
    const paymentRe = /due|payment|bill|premium|amount/i;
    return (accounts || [])
      .map(acc => {
        const amtField = (acc.fields || []).find(f => f.type === 'currency' && paymentRe.test(f.label));
        if (!amtField) return null;
        const raw = darsHistory?.[currentYearMonth]?.entries?.[acc.id]?.[amtField.id];
        const parsed = parseFloat(raw);
        const amount = raw === undefined || raw === '' || isNaN(parsed) ? 0 : parsed;
        return { accountId: acc.id, name: acc.name, icon: acc.icon, amount };
      })
      .filter(Boolean);
  }, [accounts, darsHistory, currentYearMonth]);

  const scheduledThisMonth = (creditSchedule || {})[currentYearMonth] || {};

  const unscheduledCreditBills = useMemo(() =>
    creditAmountsDue
      .filter(b => !scheduledThisMonth[b.accountId])
      .map(b => ({ id: `credit_${b.accountId}_${currentYearMonth}`, ...b })),
    [creditAmountsDue, scheduledThisMonth, currentYearMonth]
  );

  const scheduledCreditBills = useMemo(() =>
    creditAmountsDue
      .filter(b => scheduledThisMonth[b.accountId])
      .map(b => ({
        id: `credit_${b.accountId}_${currentYearMonth}`,
        name: b.name, icon: b.icon, amount: b.amount, category: 'bills',
        dueDate: scheduledThisMonth[b.accountId],
      })),
    [creditAmountsDue, scheduledThisMonth, currentYearMonth]
  );

  const handleScheduleCreditBill = useCallback((accountId, dateStr, amount, name) => {
    saveCreditSchedule({
      ...(creditSchedule || {}),
      [currentYearMonth]: { ...(scheduledThisMonth || {}), [accountId]: dateStr },
    });
    const newExp = { ...(projectedExpenses || {}) };
    const raw = newExp[dateStr];
    const existing = Array.isArray(raw) ? raw : raw ? [raw] : [];
    newExp[dateStr] = [...existing, { amount, name }];
    saveProjectedExpenses(newExp);
  }, [creditSchedule, scheduledThisMonth, currentYearMonth, projectedExpenses, saveProjectedExpenses, saveCreditSchedule]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const pad = isMobile ? 16 : 28;

  return (
    <ScrollView style={[s.screen, { userSelect: 'none' }]} contentContainerStyle={[s.content, { padding: pad, paddingBottom: 48 }]}>
      {/* Header */}
      <View style={[s.header, isMobile && s.headerMobile]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.greeting, isMobile && s.greetingMobile]}>{greeting}, {userName} 👋</Text>
          {!isMobile && (
            <Text style={s.subGreeting}>Take control of your day. Review your finances and stay on track.</Text>
          )}
        </View>
        <View style={s.bell}>
          <Text style={s.bellTxt}>🔔</Text>
        </View>
      </View>

      {/* Body — row on wide desktop, stacked on narrow/mobile */}
      {isMobile ? (
        // ── Mobile: full mobile layout ──
        <View style={s.colStack}>
          <CalendarView bills={bills} accounts={accounts} darsHistory={darsHistory} isMobile={true} projectedIncome={projectedIncome} saveProjectedIncome={saveProjectedIncome} projectedExpenses={projectedExpenses} saveProjectedExpenses={saveProjectedExpenses} deferredItems={deferredItems} saveDeferredItems={saveDeferredItems} cellsRef={cellsRef} billDragOverStr={billDragOverStr} />
          <MonthlyBillsTracker bills={bills} scheduledCreditBills={scheduledCreditBills} billPayments={billPayments || {}} onTogglePaid={handleToggleBillPaid} unscheduledCreditBills={unscheduledCreditBills} onScheduleCreditBill={handleScheduleCreditBill} cellsRef={cellsRef} onHoverChange={setBillDragOverStr} isMobile={isMobile} />
          <BanksPanel accounts={accounts} darsHistory={darsHistory} isMobile={true} />
          <DeferredPanel deferredItems={deferredItems} onPay={(item) => { setPayDeferModal(item); setPayDeferDate(''); }} />
          <TaskTracker tasks={tasks} onToggle={toggleTask} onAdd={addTask} onDelete={deleteTask} />
          <AccountSection title="Car" types={['car_lease','car_insurance']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Car" footerColor={C.bills} />
          <AccountSection title="Phone" types={['phone']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Phone" footerColor={C.bills} />
          <AccountSection title="Loans" types={['loan']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Loans" footerColor={C.bills} />
          <AccountSection title="Credit Cards" types={['credit']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Credit" footerColor={C.bills} />
          <AccountSection title="Other" types={['utility','subscription','other']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Other" footerColor={C.bills} />
          <UpcomingBills bills={bills} />
        </View>
      ) : isNarrow ? (
        // ── Narrow desktop: calendar full-width on top, panels stacked below ──
        <View style={s.colStack}>
          <CalendarView bills={bills} accounts={accounts} darsHistory={darsHistory} isMobile={false} projectedIncome={projectedIncome} saveProjectedIncome={saveProjectedIncome} projectedExpenses={projectedExpenses} saveProjectedExpenses={saveProjectedExpenses} deferredItems={deferredItems} saveDeferredItems={saveDeferredItems} cellsRef={cellsRef} billDragOverStr={billDragOverStr} />
          <TaskTracker tasks={tasks} onToggle={toggleTask} onAdd={addTask} onDelete={deleteTask} />
          <MonthlyBillsTracker bills={bills} scheduledCreditBills={scheduledCreditBills} billPayments={billPayments || {}} onTogglePaid={handleToggleBillPaid} unscheduledCreditBills={unscheduledCreditBills} onScheduleCreditBill={handleScheduleCreditBill} cellsRef={cellsRef} onHoverChange={setBillDragOverStr} isMobile={isMobile} />
          <BanksPanel accounts={accounts} darsHistory={darsHistory} isMobile={false} />
          <DeferredPanel deferredItems={deferredItems} onPay={(item) => { setPayDeferModal(item); setPayDeferDate(''); }} />
          <AccountSection title="Car" types={['car_lease','car_insurance']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Car" footerColor={C.bills} />
          <AccountSection title="Phone" types={['phone']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Phone" footerColor={C.bills} />
          <AccountSection title="Loans" types={['loan']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Loans" footerColor={C.bills} />
          <AccountSection title="Credit Cards" types={['credit']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Credit" footerColor={C.bills} />
          <AccountSection title="Other" types={['utility','subscription','other']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Other" footerColor={C.bills} />
          <UpcomingBills bills={bills} />
        </View>
      ) : (
        // ── Wide desktop: two-column side-by-side ──
        <View style={s.body}>
          <View style={s.left}>
            <CalendarView bills={bills} accounts={accounts} darsHistory={darsHistory} isMobile={false} projectedIncome={projectedIncome} saveProjectedIncome={saveProjectedIncome} projectedExpenses={projectedExpenses} saveProjectedExpenses={saveProjectedExpenses} deferredItems={deferredItems} saveDeferredItems={saveDeferredItems} cellsRef={cellsRef} billDragOverStr={billDragOverStr} />
            <TaskTracker tasks={tasks} onToggle={toggleTask} onAdd={addTask} onDelete={deleteTask} />
          </View>
          <View style={s.right}>
            <MonthlyBillsTracker bills={bills} scheduledCreditBills={scheduledCreditBills} billPayments={billPayments || {}} onTogglePaid={handleToggleBillPaid} unscheduledCreditBills={unscheduledCreditBills} onScheduleCreditBill={handleScheduleCreditBill} cellsRef={cellsRef} onHoverChange={setBillDragOverStr} isMobile={isMobile} />
            <BanksPanel accounts={accounts} darsHistory={darsHistory} isMobile={false} />
            <DeferredPanel deferredItems={deferredItems} onPay={(item) => { setPayDeferModal(item); setPayDeferDate(''); }} />
            <AccountSection title="Car" types={['car_lease','car_insurance']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Car" footerColor={C.bills} />
            <AccountSection title="Phone" types={['phone']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Phone" footerColor={C.bills} />
            <AccountSection title="Loans" types={['loan']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Loans" footerColor={C.bills} />
            <AccountSection title="Credit Cards" types={['credit']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Credit" footerColor={C.bills} />
            <AccountSection title="Other" types={['utility','subscription','other']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Other" footerColor={C.bills} />
            <UpcomingBills bills={bills} />
          </View>
        </View>
      )}

      {/* Pay deferred modal (dashboard level) */}
      <Modal visible={payDeferModal !== null} transparent animationType="fade" onRequestClose={() => setPayDeferModal(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setPayDeferModal(null)} />
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: 300, shadowColor: '#000', shadowOffset:{width:0,height:4}, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 }}>Schedule Payment</Text>
            <Text style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{payDeferModal?.name} — ${parseFloat(payDeferModal?.amount || 0).toFixed(2)}</Text>
            <TextInput style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.text, backgroundColor: '#FAFAFA' }}
              value={payDeferDate} onChangeText={setPayDeferDate}
              placeholder="Payment date (YYYY-MM-DD)" placeholderTextColor={C.faint} autoFocus />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity style={{ flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }} onPress={() => setPayDeferModal(null)}>
                <Text style={{ fontSize: 14, color: C.muted, fontWeight: '500' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }} onPress={handlePayDeferred}>
                <Text style={{ fontSize: 14, color: '#fff', fontWeight: '700' }}>Schedule</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: {},
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  headerMobile: { marginBottom: 16 },
  greeting: { fontSize: 26, fontWeight: '700', color: C.text },
  greetingMobile: { fontSize: 20 },
  subGreeting: { fontSize: 14, color: C.muted, marginTop: 4 },
  bell: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  bellTxt: { fontSize: 17 },
  body: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  left: { flex: 1, gap: 20 },
  right: { width: 320, gap: 20 },
  colStack: { gap: 16 },
});

const cal = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: {width:0,height:2}, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '700', color: C.text },
  titleMobile: { fontSize: 17 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  todayBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  todayTxt: { fontSize: 13, color: C.text, fontWeight: '500' },
  navBtn: { width: 30, height: 30, borderWidth: 1, borderColor: C.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  navTxt: { fontSize: 18, color: C.text, lineHeight: 22 },
  addBtn: { backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  addTxt: { fontSize: 13, color: '#fff', fontWeight: '600' },
  dayRow: { flexDirection: 'row', marginBottom: 2 },
  dayHead: { flex: 1, alignItems: 'center', paddingVertical: 5 },
  dayHeadTxt: { fontSize: 11, fontWeight: '600', color: C.faint, letterSpacing: 0.4 },
  week: { flexDirection: 'row' },
  cell: { flex: 1, minHeight: 150, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6, paddingHorizontal: 5, paddingBottom: 6 },
  cellMobile: { minHeight: 52 },
  cellToday: { borderTopWidth: 2, borderTopColor: C.primary },
  cellDrop: { backgroundColor: C.primaryLight, borderTopWidth: 2, borderTopColor: C.primary },
  dayNum: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  dayTxt: { fontSize: 14, fontWeight: '600', color: C.text },
  dayTxtMobile: { fontSize: 12 },
  dayMuted: { color: C.faint },
  dayTxtToday: { color: C.primary, fontWeight: '700' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.primary, marginLeft: 3 },
  chip: { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3, marginBottom: 3 },
  chipName: { fontSize: 12, fontWeight: '600', lineHeight: 15 },
  chipAmt: { fontSize: 12, fontWeight: '500', lineHeight: 15 },
  overflow: { fontSize: 11, color: C.faint },
  projBal: { marginLeft: 'auto', fontSize: 11, fontWeight: '700' },
  chipInsuf: { borderWidth: 1, borderColor: C.bills },
  warnTxt: { fontSize: 10, color: C.bills },
  bagToken: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DCFCE7', cursor: 'grab', zIndex: 100, elevation: 5 },
  bagTokenExpense: { backgroundColor: '#FEE2E2' },
  bagTokenLoan: { backgroundColor: '#EDE9FE' },
  bagDragging: { opacity: 0.9, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 20, cursor: 'grabbing', zIndex: 9999 },
  bagEmoji: { fontSize: 18 },
  billTray: { backgroundColor: '#FFFBEB', borderRadius: 10, borderWidth: 1, borderColor: '#FDE68A', padding: 10, marginBottom: 12 },
  billTrayLabel: { fontSize: 11, fontWeight: '700', color: '#B45309', marginBottom: 8, letterSpacing: 0.3 },
  billTrayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  billChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, cursor: 'grab', zIndex: 50 },
  billChipDragging: { opacity: 0.9, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 20, cursor: 'grabbing', zIndex: 9999 },
  billChipIcon: { fontSize: 14 },
  billChipName: { fontSize: 12, fontWeight: '600', color: C.text, maxWidth: 110 },
  billChipAmt: { fontSize: 12, fontWeight: '700', color: C.bills },
  ctxMenu: { position: 'absolute', backgroundColor: '#fff', borderRadius: 10, padding: 4, shadowColor: '#000', shadowOffset: {width:0,height:4}, shadowOpacity: 0.18, shadowRadius: 12, elevation: 12, minWidth: 180, zIndex: 9999 },
  ctxItem: { paddingHorizontal: 14, paddingVertical: 10 },
  ctxItemTxt: { fontSize: 14, color: C.text, fontWeight: '500' },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  incOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  incBox: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: 280, shadowColor: '#000', shadowOffset: {width:0,height:4}, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8 },
  incTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 2 },
  incDate: { fontSize: 12, color: C.muted, marginBottom: 12 },
  incInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: C.text, backgroundColor: '#FAFAFA' },
  incBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  incCancel: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  incCancelTxt: { fontSize: 14, color: C.muted, fontWeight: '500' },
  incSave: { flex: 1, backgroundColor: C.income, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  incSaveTxt: { fontSize: 14, color: '#fff', fontWeight: '700' },
  dotRow: { flexDirection: 'row', gap: 2, marginTop: 2 },
  eventDot: { width: 5, height: 5, borderRadius: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  legendMobile: { gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendTxt: { fontSize: 11, color: C.muted },
});

const mbt = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paidCount: { fontSize: 12, color: C.muted, fontWeight: '500' },
  paidAmt: { fontSize: 12, color: C.primary, fontWeight: '600' },
  empty: { fontSize: 13, color: C.faint, textAlign: 'center', paddingVertical: 8 },
  todayLine: { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  todayBar: { flex: 1, height: 2, backgroundColor: C.primary + '50' },
  todayTxt: { fontSize: 10, fontWeight: '800', color: C.primary, marginHorizontal: 8, letterSpacing: 1.2 },
  billRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: 10, marginBottom: 1 },
  billRowOverdue: { backgroundColor: '#FEF2F2' },
  billRowPaid: { opacity: 0.55 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 },
  checkboxDone: { backgroundColor: C.income, borderColor: C.income },
  checkboxOverdue: { borderColor: C.bills },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 14 },
  billInfo: { flex: 1 },
  billName: { fontSize: 14, fontWeight: '600', color: C.text },
  billNameDone: { textDecorationLine: 'line-through', color: C.muted },
  billNameOverdue: { color: C.bills },
  billDue: { fontSize: 11, color: C.faint, marginTop: 1 },
  billAmt: { fontSize: 14, fontWeight: '700', marginLeft: 8 },
});

const pnl = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: {width:0,height:2}, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  viewAll: { fontSize: 13, color: C.primary, fontWeight: '500' },
  empty: { fontSize: 13, color: C.faint, textAlign: 'center', paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 12 },
  rowMobile: { paddingVertical: 8 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 19 },
  info: { flex: 1 },
  acctName: { fontSize: 14, fontWeight: '600', color: C.text },
  acctSub: { fontSize: 11, color: C.faint, marginTop: 1 },
  balance: { fontSize: 18, fontWeight: '700', color: C.text, marginTop: 3 },
  balanceNeg: { color: C.bills },
  balanceLabel: { fontSize: 11, color: C.faint },
  totalFooter: { paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6', marginTop: 4 },
  nwLabel: { fontSize: 12, color: C.muted, fontWeight: '500' },
  nwValue: { fontSize: 18, fontWeight: '700', color: C.text, marginTop: 3 },
});

const up = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: {width:0,height:2}, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  viewAll: { fontSize: 13, color: C.primary, fontWeight: '500' },
  empty: { fontSize: 13, color: C.faint, textAlign: 'center', paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 17 },
  info: { flex: 1 },
  name: { fontSize: 13, fontWeight: '600', color: C.text },
  due: { fontSize: 11, color: C.faint, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '700' },
});

const trk = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: {width:0,height:2}, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  addTxt: { fontSize: 13, color: C.primary, fontWeight: '600' },
  addForm: { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 12, marginBottom: 10, gap: 8 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: C.text },
  tsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tsLabel: { fontSize: 13, color: C.muted, fontWeight: '600' },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  saveBtn: { backgroundColor: C.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },
  empty: { fontSize: 13, color: C.faint, textAlign: 'center', paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 10 },
  taskTitle: { flex: 1, fontSize: 14, color: C.text, fontWeight: '500' },
  taskDone: { textDecorationLine: 'line-through', color: C.faint },
  dueBadge: { backgroundColor: '#EEF2FF', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  dueBadgeDone: { backgroundColor: '#F3F4F6' },
  dueTxt: { fontSize: 11, color: C.primary, fontWeight: '600' },
  dueTxtDone: { color: C.faint },
  delBtn: { padding: 4 },
  delTxt: { fontSize: 18, color: C.faint, lineHeight: 20 },
  urgentSection: { marginBottom: 10 },
  regularSection: { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 10, marginTop: 4 },
  sectionLabel: { fontSize: 10, fontWeight: '800', color: '#EF4444', letterSpacing: 1, marginBottom: 8 },
  urgentBox: { backgroundColor: '#FFF7F7', borderWidth: 1.5, borderColor: '#EF4444', borderRadius: 12, padding: 12, marginBottom: 8 },
  urgentBoxOverdue: { backgroundColor: '#FEE2E2' },
  urgentTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: C.text },
  countdownBadge: { backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginTop: 6, alignSelf: 'flex-start' },
  countdownOverdue: { backgroundColor: '#EF4444' },
  countdownTxt: { fontSize: 12, fontWeight: '700', color: '#EF4444' },
});

const dfr = StyleSheet.create({
  box: { backgroundColor: '#1F2937', borderRadius: 12, padding: 12, width: 130, borderWidth: 1.5, borderColor: '#EF4444' },
  marker: { fontSize: 8, fontWeight: '800', color: '#EF4444', letterSpacing: 1.5, marginBottom: 4 },
  name: { fontSize: 13, fontWeight: '600', color: '#fff', marginBottom: 4 },
  amt: { fontSize: 15, fontWeight: '700', color: '#EF4444' },
  until: { fontSize: 10, color: '#9CA3AF', marginTop: 3 },
  tapHint: { fontSize: 9, color: '#6B7280', marginTop: 6, textAlign: 'right' },
});

const mds = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  overlayMobile: { justifyContent: 'flex-end' },
  box: { backgroundColor: C.card, borderRadius: 20, padding: 24, width: 420, maxWidth: '92%' },
  boxMobile: { width: '100%', maxWidth: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 36 },
  title: { fontSize: 19, fontWeight: '700', color: C.text, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.text, backgroundColor: '#FAFAFA' },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 6 },
  catTxt: { fontSize: 13, color: C.muted, fontWeight: '500' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancelTxt: { fontSize: 15, color: C.muted, fontWeight: '500' },
  saveBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveTxt: { fontSize: 15, color: '#fff', fontWeight: '600' },
});
