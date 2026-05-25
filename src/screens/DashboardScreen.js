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

// ─── Calendar ────────────────────────────────────────────────────────────────
function CalendarView({ bills, accounts, darsHistory, isMobile }) {
  const today = new Date();
  const [yr, setYr] = useState(today.getFullYear());
  const [mo, setMo] = useState(today.getMonth());
  const [projectedIncome, setProjectedIncome] = useState({});
  const [incomeModal, setIncomeModal] = useState(null);
  const [incomeInput, setIncomeInput] = useState('');
  const [incomeSource, setIncomeSource] = useState('');

  // ── Drag-to-add-income refs ──────────────────────────────────────────────
  const dragAnim = useRef(new Animated.ValueXY()).current;
  const [isDragging, setIsDragging] = useState(false);
  const gridRef = useRef(null);
  const gridAbsPos = useRef(null);
  const cellsRef = useRef([]);
  const projIncomeRef = useRef({});

  useEffect(() => { projIncomeRef.current = projectedIncome; }, [projectedIncome]);

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
    onPanResponderMove: Animated.event(
      [null, { dx: dragAnim.x, dy: dragAnim.y }],
      { useNativeDriver: false }
    ),
    onPanResponderRelease: (e, gs) => {
      const ne = e.nativeEvent;
      // clientX/clientY are viewport-relative, matching measure()'s px/py (getBoundingClientRect)
      const dropX = ne.clientX ?? ne.changedTouches?.[0]?.clientX ?? gs.moveX;
      const dropY = ne.clientY ?? ne.changedTouches?.[0]?.clientY ?? gs.moveY;
      const doHitTest = (grid) => {
        if (!grid || dropX == null || dropY == null) return;
        if (dropX >= grid.x && dropX <= grid.x + grid.width
            && dropY >= grid.y && dropY <= grid.y + grid.height) {
          const col = Math.min(6, Math.floor((dropX - grid.x) / (grid.width / 7)));
          const row = Math.min(5, Math.floor((dropY - grid.y) / (grid.height / 6)));
          const cell = cellsRef.current[row * 7 + col];
          if (cell?.cur && cell?.str) {
            const n = new Date(); n.setHours(0, 0, 0, 0);
            if (new Date(cell.str + 'T00:00:00') >= n) {
              const existing = projIncomeRef.current[cell.str];
              setIncomeInput(existing ? String(existing.amount ?? existing) : '');
              setIncomeSource(existing?.source || '');
              setIncomeModal(cell.str);
            }
          }
        }
      };
      if (gridRef.current) {
        gridRef.current.measure((fx, fy, w, h, px, py) => {
          gridAbsPos.current = { x: px, y: py, width: w, height: h };
          doHitTest(gridAbsPos.current);
        });
      } else {
        doHitTest(gridAbsPos.current);
      }
      Animated.spring(dragAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: false, tension: 40, friction: 7 }).start();
      setIsDragging(false);
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      setIsDragging(false);
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

  const accountEventsByDate = useMemo(() => {
    const parseDayNum = (val) => {
      if (!val) return NaN;
      const s = String(val);
      if (s.includes('-')) { const parts = s.split('-'); return parseInt(parts[parts.length - 1], 10); }
      return parseInt(s, 10);
    };
    const map = {};
    const daysInMo = new Date(yr, mo + 1, 0).getDate();
    (accounts || []).forEach(acc => {
      (acc.fields || []).filter(f => f.type === 'date').forEach(field => {
        const raw = field.value || getLatestValue(darsHistory || {}, acc.id, field.id);
        const dayNum = parseDayNum(raw);
        if (isNaN(dayNum) || dayNum < 1 || dayNum > daysInMo) return;
        const dateStr = `${yr}-${pad(mo + 1)}-${pad(dayNum)}`;
        if (!map[dateStr]) map[dateStr] = [];
        const paymentRe = /due|payment|bill|premium|amount/i;
        const amtField = (acc.fields || []).find(f => f.type === 'currency' && paymentRe.test(f.label))
          || (acc.fields || []).find(f => f.type === 'currency');
        const amount = amtField ? parseFloat(getLatestValue(darsHistory || {}, acc.id, amtField.id)) || 0 : 0;
        map[dateStr].push({ id: acc.id + '_' + field.id, name: acc.name, category: 'bills', amount, icon: acc.icon });
      });
    });
    return map;
  }, [accounts, darsHistory, yr, mo]);

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
    const moStart = new Date(yr, mo, 1);
    const projFrom = moStart > now ? moStart : now;
    const daysInMo = new Date(yr, mo + 1, 0).getDate();

    let balance = startBalance;
    const result = {};

    for (let d = 1; d <= daysInMo; d++) {
      const dateStr = `${yr}-${pad(mo + 1)}-${pad(d)}`;
      const date = new Date(yr, mo, d); date.setHours(0, 0, 0, 0);
      if (date < projFrom) continue;

      const incEntry = projectedIncome[dateStr];
      balance += incEntry ? (parseFloat(incEntry.amount ?? incEntry) || 0) : 0;

      const events = [
        ...(billsByDate[dateStr] || []),
        ...(accountEventsByDate[dateStr] || []),
      ];
      const insufficient = new Set();
      for (const ev of events) {
        const amt = Math.abs(parseFloat(ev.amount) || 0);
        if (ev.category === 'income') { balance += amt; }
        else { if (balance < amt) insufficient.add(ev.id); balance -= amt; }
      }
      result[dateStr] = { balance, insufficient };
    }
    return result;
  }, [accounts, darsHistory, billsByDate, accountEventsByDate, projectedIncome, yr, mo]);

  const goBack = () => { if (mo === 0) { setMo(11); setYr(y => y-1); } else setMo(m => m-1); };
  const goFwd  = () => { if (mo === 11) { setMo(0); setYr(y => y+1); } else setMo(m => m+1); };

  const dayHeaders = isMobile ? DAYS_SHORT : DAYS_FULL;

  const now = new Date(); now.setHours(0, 0, 0, 0);

  const handleAddIncome = () => {
    const amt = parseFloat(incomeInput);
    if (!isNaN(amt) && amt > 0) {
      setProjectedIncome(prev => ({ ...prev, [incomeModal]: { amount: amt, source: incomeSource.trim() } }));
    } else {
      setProjectedIncome(prev => { const n = { ...prev }; delete n[incomeModal]; return n; });
    }
    setIncomeModal(null); setIncomeInput(''); setIncomeSource('');
  };

  return (
    <View style={cal.card}>
      {/* Income injection modal */}
      <Modal visible={incomeModal !== null} transparent animationType="fade"
        onRequestClose={() => { setIncomeModal(null); setIncomeInput(''); setIncomeSource(''); }}>
        <TouchableOpacity style={cal.incOverlay} activeOpacity={1}
          onPress={() => { setIncomeModal(null); setIncomeInput(''); setIncomeSource(''); }}>
          <View style={cal.incBox}>
            <Text style={cal.incTitle}>Projected Income</Text>
            <Text style={cal.incDate}>{incomeModal}</Text>
            <TextInput style={cal.incInput} value={incomeInput} onChangeText={setIncomeInput}
              keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={C.faint} autoFocus />
            <TextInput style={[cal.incInput, { marginTop: 8 }]} value={incomeSource} onChangeText={setIncomeSource}
              placeholder="Source (e.g. Paycheck)" placeholderTextColor={C.faint} />
            <View style={cal.incBtns}>
              <TouchableOpacity style={cal.incCancel} onPress={() => { setIncomeModal(null); setIncomeInput(''); setIncomeSource(''); }}>
                <Text style={cal.incCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={cal.incSave} onPress={handleAddIncome}>
                <Text style={cal.incSaveTxt}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      <View style={cal.header}>
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
      <View ref={gridRef} onLayout={onGridLayout}>
      {Array.from({ length: 6 }, (_, wi) => (
        <View key={wi} style={cal.week}>
          {cells.slice(wi * 7, wi * 7 + 7).map((cell, di) => {
            const isToday = cell.cur && cell.day === today.getDate() && mo === today.getMonth() && yr === today.getFullYear();
            const events = cell.str ? [...(billsByDate[cell.str] || []), ...(accountEventsByDate[cell.str] || [])] : [];
            const proj = cell.str ? projection[cell.str] : null;
            const incEntry = cell.str ? projectedIncome[cell.str] : null;
            const incAmt = incEntry ? (parseFloat(incEntry.amount ?? incEntry) || 0) : 0;
            const incSource = incEntry?.source || '';
            const cellDate = cell.str ? new Date(cell.str + 'T00:00:00') : null;
            const isFuture = cell.cur && cellDate && cellDate >= now;

            return (
              <View key={di} style={[cal.cell, isMobile && cal.cellMobile, isToday && cal.cellToday]}>
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
                  if (incAmt > 0) rows.push(
                    <TouchableOpacity key="inc" style={[cal.chip, { backgroundColor: '#DCFCE7' }]}
                      onPress={() => { setIncomeInput(String(incAmt)); setIncomeSource(incSource); setIncomeModal(cell.str); }}>
                      <Text style={[cal.chipName, { color: C.income }]} numberOfLines={1}>💰 Income</Text>
                      <Text style={[cal.chipAmt, { color: C.income }]}>+${incAmt.toLocaleString('en-US', { maximumFractionDigits: 0 })}</Text>
                    </TouchableOpacity>
                  );
                  const slots = 3 - (incAmt > 0 ? 1 : 0);
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

// ─── TaskTracker ──────────────────────────────────────────────────────────────
function TaskTracker({ tasks, onToggle, onAdd, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');

  const spinAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: false })
    ).start();
  }, []);
  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

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
    await onAdd({ title: title.trim(), dueDate: dueDate || null });
    setTitle(''); setDueDate(''); setShowAdd(false);
  };

  return (
    <View style={trk.card}>
      <View style={trk.header}>
        <Text style={trk.title}>Tracking</Text>
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
          <TouchableOpacity style={trk.saveBtn} onPress={handleAdd}>
            <Text style={trk.saveTxt}>Add Task</Text>
          </TouchableOpacity>
        </View>
      )}

      {tasks.length === 0 && !showAdd && (
        <Text style={trk.empty}>No tasks yet. Tap "+ Add Item" to start.</Text>
      )}

      {tasks.map(task => {
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
              <Animated.View style={[trk.spinnerWrap, { transform: [{ rotate: spin }] }]}>
                <IconView icon={ICONS.spinner} size={18} />
              </Animated.View>
            </View>
          </TouchableOpacity>
        );
      })}
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
  const { accounts, bills, tasks, darsHistory, addTask, toggleTask, deleteTask, userName } = useApp();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

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

      {/* Body — row on desktop, column on mobile */}
      {isMobile ? (
        // ── Mobile: Calendar → Banks → Tasks → Car → Phone → Loans → Credit Cards → Upcoming ──
        <View style={s.colStack}>
          <CalendarView bills={bills} accounts={accounts} darsHistory={darsHistory} isMobile={true} />
          <BanksPanel accounts={accounts} darsHistory={darsHistory} isMobile={true} />
          <TaskTracker tasks={tasks} onToggle={toggleTask} onAdd={addTask} onDelete={deleteTask} />
          <AccountSection title="Car" types={['car_lease','car_insurance']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Car" footerColor={C.bills} />
          <AccountSection title="Phone" types={['phone']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Phone" footerColor={C.bills} />
          <AccountSection title="Loans" types={['loan']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Loans" footerColor={C.bills} />
          <AccountSection title="Credit Cards" types={['credit']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Credit" footerColor={C.bills} />
          <AccountSection title="Other" types={['utility','subscription','other']} accounts={accounts} darsHistory={darsHistory} isMobile={true} footerLabel="Total Other" footerColor={C.bills} />
          <UpcomingBills bills={bills} />
        </View>
      ) : (
        // ── Desktop: two-column ──
        <View style={s.body}>
          <View style={s.left}>
            <CalendarView bills={bills} accounts={accounts} darsHistory={darsHistory} isMobile={false} />
            <TaskTracker tasks={tasks} onToggle={toggleTask} onAdd={addTask} onDelete={deleteTask} />
          </View>
          <View style={s.right}>
            <BanksPanel accounts={accounts} darsHistory={darsHistory} isMobile={false} />
            <AccountSection title="Car" types={['car_lease','car_insurance']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Car" footerColor={C.bills} />
            <AccountSection title="Phone" types={['phone']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Phone" footerColor={C.bills} />
            <AccountSection title="Loans" types={['loan']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Loans" footerColor={C.bills} />
            <AccountSection title="Credit Cards" types={['credit']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Credit" footerColor={C.bills} />
            <AccountSection title="Other" types={['utility','subscription','other']} accounts={accounts} darsHistory={darsHistory} isMobile={false} footerLabel="Total Other" footerColor={C.bills} />
            <UpcomingBills bills={bills} />
          </View>
        </View>
      )}

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
  bagToken: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DCFCE7', cursor: 'grab' },
  bagDragging: { opacity: 0.85, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 10, cursor: 'grabbing', zIndex: 999 },
  bagEmoji: { fontSize: 18 },
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
  saveBtn: { backgroundColor: C.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },
  empty: { fontSize: 13, color: C.faint, textAlign: 'center', paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 10 },
  taskTitle: { flex: 1, fontSize: 14, color: C.text, fontWeight: '500' },
  spinnerWrap: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  taskDone: { textDecorationLine: 'line-through', color: C.faint },
  dueBadge: { backgroundColor: '#EEF2FF', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  dueBadgeDone: { backgroundColor: '#F3F4F6' },
  dueTxt: { fontSize: 11, color: C.primary, fontWeight: '600' },
  dueTxtDone: { color: C.faint },
  delBtn: { padding: 4 },
  delTxt: { fontSize: 18, color: C.faint, lineHeight: 20 },
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
