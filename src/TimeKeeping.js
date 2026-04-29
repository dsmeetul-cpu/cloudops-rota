// src/TimeKeeping.js
// CloudOps Rota — Time Keeping / RTO Compliance Tracker
// Manager: full dashboard, confirm check-ins, export to Excel
// Engineer: check in (office/WFH), see own week view only

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';

// ── Constants ────────────────────────────────────────────────────────────────
const RTO_DAYS_REQUIRED = 3;
const START_TIME        = '09:00';
const END_TIME          = '18:00';
const GRACE_LATE_WARN   = 15; // mins: amber
const GRACE_LATE_LATE   = 20; // mins: red
const STREAK_THRESHOLD  = 3;  // consecutive late arrivals = pattern alert

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseTime(str) {
  if (!str) return null;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}
function minsToStr(mins) {
  if (mins == null) return '—';
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function lateStatus(arrivalStr) {
  const arr = parseTime(arrivalStr);
  const start = parseTime(START_TIME);
  if (arr == null) return null;
  const diff = arr - start;
  if (diff <= 0)                 return { status: 'ontime',  label: 'On Time',    color: '#22c55e', diff };
  if (diff <= GRACE_LATE_WARN)   return { status: 'early',   label: `+${diff}m`,  color: '#22c55e', diff }; // within grace
  if (diff <= GRACE_LATE_LATE)   return { status: 'warn',    label: `+${diff}m`,  color: '#f59e0b', diff }; // amber grace
  return                                { status: 'late',    label: `+${diff}m`,  color: '#ef4444', diff }; // over grace
}
function isWeekday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() >= 1 && d.getDay() <= 5;
}
function isBankHoliday(dateStr, bankHolidays) {
  return (bankHolidays || []).some(bh => (bh.date || bh) === dateStr);
}
function isOnHoliday(dateStr, userId, holidays) {
  return (holidays || []).some(h => h.userId === userId && h.status === 'approved' && dateStr >= h.startDate && dateStr <= h.endDate);
}
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
function shortDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function getWeeksFrom(startDate, count = 13) {
  // Get 'count' weeks starting from the Monday of startDate's week
  const ws = getWeekStart(startDate);
  return Array.from({ length: count }, (_, i) => addDays(ws, i * 7));
}
function getAllWeekdays(weekStart) {
  return Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ── MiniBar chart ─────────────────────────────────────────────────────────────
function MiniBar({ value, max, color, height = 36, width = 22, label }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'DM Mono', fontWeight: 600 }}>{label}</div>
      <div style={{ width, height, background: 'rgba(255,255,255,0.05)', borderRadius: 4, display: 'flex', alignItems: 'flex-end', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ width: '100%', height: `${pct * 100}%`, background: color, borderRadius: '3px 3px 0 0', transition: 'height 0.4s ease' }} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'DM Mono' }}>{value}</div>
    </div>
  );
}

// ── Donut chart ───────────────────────────────────────────────────────────────
function Donut({ pct, color, size = 64, label, sub }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(pct / 100, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={6} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s ease' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size < 70 ? 12 : 15, fontWeight: 700, color, fontFamily: 'DM Mono' }}>
          {Math.round(pct)}%
        </div>
      </div>
      {label && <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', maxWidth: size + 20 }}>{label}</div>}
      {sub   && <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center' }}>{sub}</div>}
    </div>
  );
}

// ── HeatMap cell ──────────────────────────────────────────────────────────────
function HeatCell({ record, bankHol, holiday, isToday, isFuture }) {
  let bg = 'rgba(255,255,255,0.03)';
  let title = 'No data';
  if (holiday)   { bg = 'rgba(139,92,246,0.18)'; title = 'Holiday'; }
  else if (bankHol) { bg = 'rgba(99,102,241,0.25)'; title = 'Bank Holiday'; }
  else if (isFuture) { bg = 'rgba(255,255,255,0.02)'; title = 'Future'; }
  else if (record) {
    if (record.type === 'office') {
      const s = lateStatus(record.arrival);
      if (!s || s.status === 'ontime' || s.status === 'early') { bg = 'rgba(34,197,94,0.25)'; title = `In: ${record.arrival}`; }
      else if (s.status === 'warn')  { bg = 'rgba(245,158,11,0.3)'; title = `Late: ${record.arrival}`; }
      else                           { bg = 'rgba(239,68,68,0.3)';  title = `Late: ${record.arrival}`; }
    } else if (record.type === 'wfh')    { bg = 'rgba(59,130,246,0.2)'; title = 'WFH'; }
    else if (record.type === 'absent')   { bg = 'rgba(239,68,68,0.15)'; title = 'Absent/Sick'; }
  }
  return (
    <div title={title} style={{
      width: 18, height: 18, borderRadius: 3, background: bg,
      border: isToday ? '1.5px solid #00c2ff' : '1px solid rgba(255,255,255,0.05)',
      cursor: 'pointer', transition: 'transform 0.1s',
    }} />
  );
}

// ── Excel export helper (manager only) ───────────────────────────────────────
async function exportAttendanceExcel(engineers, timekeeping, bankHolidays, holidays, exportFrom, exportTo) {
  const XLSX = window.XLSX;
  if (!XLSX) { alert('XLSX library not loaded'); return; }

  const bh = (bankHolidays || []).map(b => b.date || b);
  const fmtDate = ds => new Date(ds+'T12:00:00').toLocaleDateString('en-GB');
  const rangeLabel = exportFrom || exportTo
    ? `${exportFrom ? fmtDate(exportFrom) : 'Start'} – ${exportTo ? fmtDate(exportTo) : 'End'}`
    : 'All dates';

  const hdrs = ['Employment ID','Trigram','Full Name','Date','Day','Type','Arrival','Departure','Hours Worked','Late Status','Confirmed by Manager','Notes'];
  const rows = [];
  engineers.forEach(u => {
    const recs = (timekeeping || {})[u.id] || {};
    Object.keys(recs).sort().forEach(d => {
      if (exportFrom && d < exportFrom) return;
      if (exportTo   && d > exportTo)   return;
      const rec = recs[d];
      const day = new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'});
      const isBH = isBankHoliday(d, bh);
      const isHol= isOnHoliday(d, u.id, holidays);
      const ls   = rec.type === 'office' ? lateStatus(rec.arrival) : null;
      const hrs  = rec.type === 'office' && rec.arrival && rec.departure
        ? ((parseTime(rec.departure) - parseTime(rec.arrival)) / 60).toFixed(1)
        : '';
      rows.push([
        u.employment_id || '—', u.id, u.name, fmtDate(d), day,
        isBH ? 'Bank Holiday' : isHol ? 'Holiday' : rec.type || '—',
        rec.arrival || '—', rec.departure || '—', hrs ? `${hrs}h` : '—',
        ls ? ls.label : rec.type === 'wfh' ? 'WFH' : rec.type === 'absent' ? 'Absent' : '—',
        rec.confirmedBy ? `✓ ${rec.confirmedBy}` : '—',
        rec.note || '',
      ]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet([hdrs, ...rows]);
  ws['!cols'] = [14,8,22,12,12,10,8,10,10,14,18,24].map(w=>({wch:w}));
  ws['!freeze'] = { xSplit: 3, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '📋 Attendance');
  const fname = `CloudOps-Attendance-${(exportFrom||'all').replace(/-/g,'')}-${(exportTo||'now').replace(/-/g,'')}.xlsx`;
  XLSX.writeFile(wb, fname);
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TimeKeeping({
  users, holidays, currentUser, isManager,
  bankHolidays,
  timekeeping, setTimekeeping,
  driveToken,
}) {
  const [tab,           setTab]           = useState(isManager ? 'dashboard' : 'checkin');
  const [selectedUser,  setSelectedUser]  = useState(null);
  const [selectedWeek,  setSelectedWeek]  = useState(getWeekStart(todayStr()));
  const [showLogModal,  setShowLogModal]  = useState(false);
  const [logDate,       setLogDate]       = useState(todayStr());
  const [logUser,       setLogUser]       = useState('');
  const [logType,       setLogType]       = useState('office');
  const [logArrival,    setLogArrival]    = useState('09:00');
  const [logDeparture,  setLogDeparture]  = useState('18:00');
  const [logNote,       setLogNote]       = useState('');
  const [saving,        setSaving]        = useState(false);
  const [filterUser,    setFilterUser]    = useState('all');
  const [alertFilter,   setAlertFilter]   = useState('all');
  const [viewMonth,     setViewMonth]     = useState(todayStr().slice(0,7));
  // Export modal state
  const [showExport,    setShowExport]    = useState(false);
  const [exportFrom,    setExportFrom]    = useState('');
  const [exportTo,      setExportTo]      = useState('');
  const [exporting,     setExporting]     = useState(false);
  // Engineer check-in state
  const [checkInType,   setCheckInType]   = useState('office');
  const [checkInNote,   setCheckInNote]   = useState('');
  const [checkInSaving, setCheckInSaving] = useState(false);
  const [checkInMsg,    setCheckInMsg]    = useState('');

  const engineers = useMemo(() => (users || []).filter(u => !u.isManager), [users]);
  const me = useMemo(() => (users || []).find(u => u.id === currentUser), [users, currentUser]);
  const bh = useMemo(() => (bankHolidays || []).map(b => b.date || b), [bankHolidays]);
  const tk = timekeeping || {};

  // ── Engineer: today's check-in status ───────────────────────────────────────
  const myTodayRec = tk[currentUser]?.[todayStr()];
  const hasCheckedIn = !!myTodayRec;

  const doCheckIn = async () => {
    if (hasCheckedIn && !window.confirm('You already checked in today — overwrite?')) return;
    setCheckInSaving(true);
    const now = new Date();
    const arrival = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const updated = {
      ...tk,
      [currentUser]: {
        ...(tk[currentUser] || {}),
        [todayStr()]: {
          type: checkInType,
          arrival: checkInType === 'office' ? arrival : undefined,
          note: checkInNote || undefined,
          checkedInAt: now.toISOString(),
          confirmedBy: null,
        },
      },
    };
    setTimekeeping(updated);
    setCheckInMsg(`✅ Checked in at ${arrival} — ${checkInType === 'office' ? '🏢 In Office' : '🏠 WFH'}`);
    setCheckInSaving(false);
    setTimeout(() => setCheckInMsg(''), 6000);
  };

  const confirmCheckIn = (userId, date) => {
    const rec = (tk[userId] || {})[date];
    if (!rec) return;
    const updated = { ...tk, [userId]: { ...(tk[userId] || {}), [date]: { ...rec, confirmedBy: currentUser, confirmedAt: new Date().toISOString() } } };
    setTimekeeping(updated);
  };

  const unconfirmCheckIn = (userId, date) => {
    const rec = (tk[userId] || {})[date];
    if (!rec) return;
    const { confirmedBy, confirmedAt, ...rest } = rec;
    const updated = { ...tk, [userId]: { ...(tk[userId] || {}), [date]: rest } };
    setTimekeeping(updated);
  };

  // ── Derive stats per user for date range ────────────────────────────────────
  const getUserStats = useCallback((userId, startDate, endDate) => {
    const records = tk[userId] || {};
    let officeDays = 0, wfhDays = 0, absentDays = 0, bankHolCount = 0, holidayCount = 0;
    let lateArrivals = [], onTimeDays = 0, totalWorkdays = 0;
    let lateStreak = 0, maxLateStreak = 0;
    const daily = [];

    let cur = startDate;
    while (cur <= endDate) {
      if (isWeekday(cur)) {
        const isBH  = isBankHoliday(cur, bh);
        const isHol = isOnHoliday(cur, userId, holidays);
        const isFut = cur > todayStr();
        if (isBH)        { bankHolCount++; officeDays++; daily.push({ date: cur, type: 'bankHoliday' }); }
        else if (isHol)  { holidayCount++; daily.push({ date: cur, type: 'holiday' }); }
        else if (isFut)  { daily.push({ date: cur, type: 'future' }); }
        else {
          totalWorkdays++;
          const rec = records[cur];
          if (rec) {
            if (rec.type === 'office') {
              officeDays++;
              const ls = lateStatus(rec.arrival);
              if (ls && ls.status === 'late') {
                lateArrivals.push({ date: cur, ...ls, arrival: rec.arrival });
                lateStreak++;
                if (lateStreak > maxLateStreak) maxLateStreak = lateStreak;
              } else { onTimeDays++; lateStreak = 0; }
              daily.push({ date: cur, type: 'office', arrival: rec.arrival, departure: rec.departure, lateStatus: ls });
            } else if (rec.type === 'wfh')    { wfhDays++;    lateStreak = 0; daily.push({ date: cur, type: 'wfh' }); }
            else if (rec.type === 'absent')   { absentDays++; lateStreak = 0; daily.push({ date: cur, type: 'absent', note: rec.note }); }
          } else { daily.push({ date: cur, type: 'missing' }); lateStreak = 0; }
        }
      }
      cur = addDays(cur, 1);
    }

    const rtoCompliance = totalWorkdays > 0
      ? Math.round((officeDays / (totalWorkdays + bankHolCount - holidayCount)) * 100)
      : 0;

    return { officeDays, wfhDays, absentDays, bankHolCount, holidayCount, totalWorkdays,
      lateArrivals, onTimeDays, maxLateStreak, rtoCompliance, daily };
  }, [tk, bh, holidays]);

  // ── Current week stats per user ─────────────────────────────────────────────
  const weekEnd = addDays(selectedWeek, 4);
  const allStats = useMemo(() =>
    engineers.map(u => ({ user: u, stats: getUserStats(u.id, selectedWeek, weekEnd) })),
    [engineers, getUserStats, selectedWeek, weekEnd]);

  // ── Month stats ─────────────────────────────────────────────────────────────
  const monthStats = useMemo(() => {
    const [y, m] = viewMonth.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2,'0')}-01`;
    const end   = new Date(y, m, 0).toISOString().slice(0,10);
    return engineers.map(u => ({ user: u, stats: getUserStats(u.id, start, end) }));
  }, [engineers, getUserStats, viewMonth]);

  // ── Late-arrival pattern alerts ─────────────────────────────────────────────
  const patternAlerts = useMemo(() => {
    const thirtyDaysAgo = addDays(todayStr(), -30);
    return engineers.map(u => {
      const s = getUserStats(u.id, thirtyDaysAgo, todayStr());
      // Look for consecutive late runs
      const recs = (tk[u.id] || {});
      let streak = 0, maxStreak = 0, lastDate = null;
      Object.keys(recs).sort().forEach(d => {
        if (d < thirtyDaysAgo) return;
        const r = recs[d];
        if (r?.type === 'office') {
          const ls = lateStatus(r.arrival);
          if (ls?.status === 'late') { streak++; if (streak > maxStreak) { maxStreak = streak; lastDate = d; } }
          else streak = 0;
        }
      });
      return { user: u, lateCount: s.lateArrivals.length, maxStreak, lastDate,
        rtoCompliance: s.rtoCompliance,
        hasPattern: maxStreak >= STREAK_THRESHOLD || s.lateArrivals.length >= 5 };
    }).filter(a => a.lateCount > 0 || a.maxStreak > 0);
  }, [engineers, getUserStats, tk]);

  // ── Save a record ────────────────────────────────────────────────────────────
  const saveRecord = async () => {
    if (!logUser || !logDate) return;
    setSaving(true);
    const updated = {
      ...tk,
      [logUser]: {
        ...(tk[logUser] || {}),
        [logDate]: {
          type: logType,
          arrival:   logType === 'office' ? logArrival   : undefined,
          departure: logType === 'office' ? logDeparture : undefined,
          note:      logNote || undefined,
          loggedBy:  currentUser,
          loggedAt:  new Date().toISOString(),
        },
      },
    };
    setTimekeeping(updated);
    setShowLogModal(false);
    setLogNote('');
    setSaving(false);
  };

  const deleteRecord = (userId, date) => {
    if (!window.confirm(`Delete record for ${formatDate(date)}?`)) return;
    const updated = { ...tk, [userId]: { ...(tk[userId] || {}) } };
    delete updated[userId][date];
    setTimekeeping(updated);
  };

  const openLog = (userId, date) => {
    const rec = (tk[userId] || {})[date];
    setLogUser(userId);
    setLogDate(date);
    setLogType(rec?.type || 'office');
    setLogArrival(rec?.arrival || '09:00');
    setLogDeparture(rec?.departure || '18:00');
    setLogNote(rec?.note || '');
    setShowLogModal(true);
  };

  // ── 13-week heat map data ────────────────────────────────────────────────────
  const heatWeeks = useMemo(() => getWeeksFrom(addDays(todayStr(), -77), 14), []);

  // ── Colours ──────────────────────────────────────────────────────────────────
  const ACCENT   = '#00c2ff';
  const GREEN    = '#22c55e';
  const AMBER    = '#f59e0b';
  const RED      = '#ef4444';
  const PURPLE   = '#a78bfa';
  const BLUE     = '#60a5fa';
  const MUTED    = '#475569';

  const tabCfg = isManager
    ? [
        { id: 'dashboard', icon: '◈',  label: 'Dashboard' },
        { id: 'checkins',  icon: '✅',  label: `Check-Ins${Object.values(tk).flatMap(u=>Object.entries(u)).filter(([d,r])=>d===todayStr()&&!r.confirmedBy).length > 0 ? ` (${Object.values(tk).flatMap(u=>Object.entries(u)).filter(([d,r])=>d===todayStr()&&!r.confirmedBy).length})` : ''}` },
        { id: 'weekly',    icon: '📅',  label: 'Weekly View' },
        { id: 'monthly',   icon: '📆',  label: 'Monthly' },
        { id: 'heatmap',   icon: '🔥',  label: 'Heat Map' },
        { id: 'alerts',    icon: '🚨',  label: `Alerts${patternAlerts.filter(a=>a.hasPattern).length > 0 ? ` (${patternAlerts.filter(a=>a.hasPattern).length})` : ''}` },
        { id: 'log',       icon: '📋',  label: 'Attendance Log' },
      ]
    : [
        { id: 'checkin',   icon: '✅',  label: 'Check In' },
        { id: 'myweek',    icon: '📅',  label: 'My Week' },
      ];

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px' }}>
            🕒 Time Keeping
          </h1>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, fontFamily: 'DM Mono' }}>
            RTO Policy: {RTO_DAYS_REQUIRED} days/week in office · Start {START_TIME} · Grace {GRACE_LATE_WARN}–{GRACE_LATE_LATE} min
          </div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {isManager && (
            <>
              <button onClick={() => setShowExport(true)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', background:'rgba(16,185,129,0.12)', color:'#34d399', border:'1px solid rgba(16,185,129,0.3)', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' }}>
                📥 Export Excel
              </button>
              <button
                onClick={() => { setLogUser(engineers[0]?.id || ''); setLogDate(todayStr()); setLogType('office'); setLogArrival('09:00'); setLogDeparture('18:00'); setLogNote(''); setShowLogModal(true); }}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 20px', background: ACCENT, color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: `0 0 14px rgba(0,194,255,0.3)` }}>
                + Log Attendance
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 4, width: 'fit-content', flexWrap: 'wrap' }}>
        {tabCfg.map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '7px 16px', borderRadius: 7, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
            background: tab === t.id ? 'rgba(0,194,255,0.1)' : 'transparent',
            color: tab === t.id ? ACCENT : '#64748b',
            border: tab === t.id ? '1px solid rgba(0,194,255,0.3)' : '1px solid transparent',
            transition: 'all 0.15s',
          }}>
            <span>{t.icon}</span><span>{t.label}</span>
          </div>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: ENGINEER CHECK-IN                                              */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'checkin' && (
        <div style={{ maxWidth: 480 }}>
          <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:24 }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:4 }}>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {me?.name?.split(' ')[0] || 'there'} 👋</div>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:20 }}>{new Date().toLocaleDateString('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>

            {hasCheckedIn ? (
              <div style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', borderRadius:10, padding:'16px 18px', marginBottom:16 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#22c55e', marginBottom:6 }}>
                  {myTodayRec.type === 'office' ? '🏢 In Office' : '🏠 Working from Home'}
                </div>
                <div style={{ fontSize:12, color:'#64748b', fontFamily:'DM Mono' }}>
                  Checked in {myTodayRec.arrival ? `at ${myTodayRec.arrival}` : 'today'}
                  {myTodayRec.confirmedBy && <span style={{ color:'#22c55e', marginLeft:8 }}>· ✓ Confirmed by manager</span>}
                  {!myTodayRec.confirmedBy && <span style={{ color:'#f59e0b', marginLeft:8 }}>· Pending manager confirmation</span>}
                </div>
                {myTodayRec.note && <div style={{ fontSize:11, color:'#475569', marginTop:4 }}>Note: {myTodayRec.note}</div>}
              </div>
            ) : (
              <div style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:10, padding:'12px 16px', marginBottom:16, fontSize:12, color:'#f59e0b' }}>
                ⏳ You haven't checked in today yet.
              </div>
            )}

            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:8, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px' }}>Where are you working today?</div>
              <div style={{ display:'flex', gap:8 }}>
                {[['office','🏢 In Office','#22c55e'],['wfh','🏠 WFH','#60a5fa']].map(([v,l,c]) => (
                  <div key={v} onClick={() => setCheckInType(v)}
                    style={{ flex:1, padding:'12px 0', textAlign:'center', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700,
                      background: checkInType===v ? `rgba(${v==='office'?'34,197,94':'96,165,250'},0.15)` : 'rgba(255,255,255,0.03)',
                      border: `1.5px solid ${checkInType===v ? c : 'rgba(255,255,255,0.08)'}`,
                      color: checkInType===v ? c : '#64748b', transition:'all 0.15s' }}>
                    {l}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:5, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px' }}>Note (optional)</div>
              <input type="text" value={checkInNote} onChange={e=>setCheckInNote(e.target.value)}
                placeholder="e.g. Working on project X, client site visit…"
                style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#e2e8f0', fontSize:13, outline:'none' }} />
            </div>

            {checkInMsg && (
              <div style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', borderRadius:7, padding:'8px 12px', fontSize:12, color:'#22c55e', marginBottom:12 }}>
                {checkInMsg}
              </div>
            )}

            <button onClick={doCheckIn} disabled={checkInSaving}
              style={{ width:'100%', padding:'12px 0', background:ACCENT, color:'#000', border:'none', borderRadius:8, fontWeight:800, fontSize:14, cursor:'pointer', boxShadow:`0 0 18px rgba(0,194,255,0.25)` }}>
              {checkInSaving ? '⏳ Saving…' : hasCheckedIn ? '↩ Update Check-In' : `✓ Check In — ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`}
            </button>
          </div>

          {/* My recent week */}
          <div style={{ marginTop:16, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:10, color:'#94a3b8' }}>This week</div>
            <div style={{ display:'flex', gap:6 }}>
              {getAllWeekdays(getWeekStart(todayStr())).map(d => {
                const rec  = (tk[currentUser] || {})[d];
                const isBH = isBankHoliday(d, bh);
                const isT  = d === todayStr();
                const isFut= d > todayStr();
                let icon = '—', color = '#334155';
                if (isBH)              { icon = '🏛'; color = '#a78bfa'; }
                else if (isFut)        { icon = '·'; color = '#334155'; }
                else if (rec?.type==='office') { icon='🏢'; color='#22c55e'; }
                else if (rec?.type==='wfh')    { icon='🏠'; color='#60a5fa'; }
                else if (rec?.type==='absent') { icon='🤒'; color='#ef4444'; }
                return (
                  <div key={d} style={{ flex:1, textAlign:'center', padding:'8px 4px', borderRadius:7,
                    background: isT ? 'rgba(0,194,255,0.08)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isT ? 'rgba(0,194,255,0.25)' : 'rgba(255,255,255,0.05)'}` }}>
                    <div style={{ fontSize:9, color:'#475569', marginBottom:3, fontFamily:'DM Mono' }}>
                      {new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short'})}
                    </div>
                    <div style={{ fontSize:16 }}>{icon}</div>
                    {rec?.confirmedBy && <div style={{ fontSize:8, color:'#22c55e', marginTop:2 }}>✓</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: ENGINEER MY WEEK (read-only own data)                         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'myweek' && (
        <div>
          <div style={{ fontSize:13, color:'#64748b', marginBottom:14 }}>Your attendance for the current week. Contact your manager to correct any errors.</div>
          <div style={{ display:'flex', gap:6 }}>
            {getAllWeekdays(getWeekStart(todayStr())).map(d => {
              const rec  = (tk[currentUser] || {})[d];
              const isBH = isBankHoliday(d, bh);
              const isT  = d === todayStr();
              const isFut= d > todayStr();
              let typeLbl='No data', typeColor='#334155', typeIcon='—';
              if (isBH)              { typeLbl='Bank Holiday'; typeColor='#a78bfa'; typeIcon='🏛'; }
              else if (isOnHoliday(d,currentUser,holidays)) { typeLbl='Holiday'; typeColor='#c4b5fd'; typeIcon='🌴'; }
              else if (isFut)        { typeLbl='Future'; typeColor='#334155'; typeIcon='·'; }
              else if (rec?.type==='office') { typeLbl=rec.arrival?`In at ${rec.arrival}`:'In Office'; typeColor='#22c55e'; typeIcon='🏢'; }
              else if (rec?.type==='wfh')    { typeLbl='WFH'; typeColor='#60a5fa'; typeIcon='🏠'; }
              else if (rec?.type==='absent') { typeLbl='Absent'; typeColor='#ef4444'; typeIcon='🤒'; }
              return (
                <div key={d} style={{ flex:1, borderRadius:10, background: isT?'rgba(0,194,255,0.06)':'rgba(255,255,255,0.02)', border:`1.5px solid ${isT?'rgba(0,194,255,0.25)':'rgba(255,255,255,0.06)'}`, padding:'14px 10px', textAlign:'center' }}>
                  <div style={{ fontSize:11, color:isT?ACCENT:'#64748b', fontWeight:600, marginBottom:4 }}>
                    {new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})}
                  </div>
                  <div style={{ fontSize:24, marginBottom:6 }}>{typeIcon}</div>
                  <div style={{ fontSize:11, color:typeColor, fontWeight:600 }}>{typeLbl}</div>
                  {rec?.confirmedBy
                    ? <div style={{ fontSize:10, color:'#22c55e', marginTop:4 }}>✓ Confirmed</div>
                    : rec && !isBH && <div style={{ fontSize:10, color:'#f59e0b', marginTop:4 }}>Pending</div>
                  }
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: MANAGER CHECK-INS CONFIRMATION                                */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'checkins' && isManager && (
        <div>
          <div style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>
            Engineers who have self-reported their attendance today. Confirm or edit their check-in time.
          </div>
          {engineers.map(u => {
            const dayKeys = Object.keys(tk[u.id]||{}).sort().reverse().slice(0,5);
            return (
              <div key={u.id} style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:'14px 18px', marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                  <div style={{ width:32, height:32, borderRadius:'50%', background:'rgba(0,194,255,0.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color:ACCENT }}>{u.name.charAt(0)}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{u.name}</div>
                    <div style={{ fontSize:10, color:'#64748b', fontFamily:'DM Mono' }}>{u.id}</div>
                  </div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {dayKeys.map(d => {
                    const rec = (tk[u.id]||{})[d];
                    const ls  = rec?.type==='office' ? lateStatus(rec.arrival) : null;
                    return (
                      <div key={d} style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(255,255,255,0.02)', borderRadius:7, padding:'8px 12px' }}>
                        <div style={{ fontSize:11, color:'#64748b', fontFamily:'DM Mono', minWidth:80 }}>{shortDate(d)}</div>
                        <div style={{ flex:1, display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:13 }}>{rec?.type==='office'?'🏢':rec?.type==='wfh'?'🏠':'🤒'}</span>
                          {rec?.arrival && <span style={{ fontSize:11, fontFamily:'DM Mono', color:ls?.color||'#94a3b8' }}>{rec.arrival}</span>}
                          {ls?.status==='late' && <span style={{ fontSize:10, color:'#ef4444', fontWeight:700 }}>+{ls.diff}m late</span>}
                          {rec?.note && <span style={{ fontSize:10, color:'#475569' }}>"{rec.note}"</span>}
                        </div>
                        {rec?.confirmedBy
                          ? <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ fontSize:11, color:'#22c55e', fontWeight:600 }}>✓ Confirmed</span>
                              <button onClick={() => unconfirmCheckIn(u.id, d)} style={{ padding:'2px 8px', background:'transparent', border:'1px solid rgba(239,68,68,0.3)', borderRadius:5, color:'#ef4444', fontSize:10, cursor:'pointer' }}>Undo</button>
                            </div>
                          : <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <button onClick={() => confirmCheckIn(u.id, d)} style={{ padding:'4px 12px', background:'rgba(34,197,94,0.12)', border:'1px solid rgba(34,197,94,0.3)', borderRadius:6, color:'#22c55e', fontSize:11, fontWeight:700, cursor:'pointer' }}>✓ Confirm</button>
                              <button onClick={() => openLog(u.id, d)} style={{ padding:'4px 10px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:6, color:'#94a3b8', fontSize:11, cursor:'pointer' }}>✏ Edit</button>
                            </div>
                        }
                      </div>
                    );
                  })}
                  {dayKeys.length === 0 && <div style={{ fontSize:12, color:'#334155' }}>No check-ins recorded.</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: DASHBOARD                                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'dashboard' && (() => {
        const thirtyAgo = addDays(todayStr(), -29);
        const allS = engineers.map(u => ({ user: u, s: getUserStats(u.id, thirtyAgo, todayStr()) }));
        const avgCompliance = allS.length > 0 ? Math.round(allS.reduce((a,b) => a + b.s.rtoCompliance, 0) / allS.length) : 0;
        const totalLate     = allS.reduce((a,b) => a + b.s.lateArrivals.length, 0);
        const nonCompliant  = allS.filter(a => a.s.rtoCompliance < 60).length;
        const patternCount  = patternAlerts.filter(p => p.hasPattern).length;

        return (
          <div>
            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Avg RTO Compliance', value: `${avgCompliance}%`, sub: 'Last 30 days', color: avgCompliance >= 80 ? GREEN : avgCompliance >= 60 ? AMBER : RED, icon: '🏢' },
                { label: 'Late Arrivals',       value: totalLate,           sub: 'Last 30 days', color: totalLate > 10 ? RED : totalLate > 5 ? AMBER : GREEN,              icon: '⏰' },
                { label: 'Non-Compliant',       value: nonCompliant,        sub: '< 60% RTO',   color: nonCompliant > 0 ? RED : GREEN,                                     icon: '⚠️' },
                { label: 'Active Patterns',     value: patternCount,        sub: `≥${STREAK_THRESHOLD} consecutive late`, color: patternCount > 0 ? AMBER : GREEN,         icon: '📊' },
              ].map(k => (
                <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{k.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: k.color, fontFamily: 'DM Mono', lineHeight: 1 }}>{k.value}</div>
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{k.sub}</div>
                    </div>
                    <span style={{ fontSize: 22 }}>{k.icon}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Per-engineer compliance donut grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
              {allS.map(({ user: u, s }) => {
                const compColor = s.rtoCompliance >= 80 ? GREEN : s.rtoCompliance >= 60 ? AMBER : RED;
                return (
                  <div key={u.id} onClick={() => { setSelectedUser(u.id); setTab('log'); }}
                    style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${compColor}22`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.055)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: `${compColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: compColor, border: `1.5px solid ${compColor}55` }}>
                        {u.name.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                        <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'DM Mono' }}>{u.id}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Donut pct={s.rtoCompliance} color={compColor} size={56} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: '#64748b' }}>Office</span>
                          <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: GREEN }}>{s.officeDays}d</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: '#64748b' }}>WFH</span>
                          <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: BLUE }}>{s.wfhDays}d</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, color: '#64748b' }}>Late</span>
                          <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: s.lateArrivals.length > 0 ? RED : GREEN }}>{s.lateArrivals.length}</span>
                        </div>
                      </div>
                    </div>
                    {s.lateArrivals.length >= STREAK_THRESHOLD && (
                      <div style={{ marginTop: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 5, padding: '4px 8px', fontSize: 10, color: RED }}>
                        ⚠ {s.lateArrivals.length} late arrivals — pattern detected
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Weekly bar chart — office vs WFH for current week */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>📊 This Week — Office vs WFH by Engineer</div>
              <div style={{ display: 'flex', gap: 20, overflowX: 'auto', paddingBottom: 8 }}>
                {allStats.map(({ user: u, stats: s }) => (
                  <div key={u.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 60 }}>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
                      <MiniBar value={s.officeDays} max={5} color={GREEN} height={48} width={20} label="🏢" />
                      <MiniBar value={s.wfhDays}   max={5} color={BLUE}  height={48} width={20} label="🏠" />
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', maxWidth: 60 }}>{u.name.split(' ')[0]}</div>
                    {s.officeDays < RTO_DAYS_REQUIRED && s.totalWorkdays >= 5 && (
                      <div style={{ fontSize: 9, color: RED, fontWeight: 700 }}>⚠ RTO</div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: '#64748b' }}>
                <span><span style={{ color: GREEN }}>●</span> Office ({RTO_DAYS_REQUIRED}d required)</span>
                <span><span style={{ color: BLUE }}>●</span> WFH</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: WEEKLY VIEW                                                    */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'weekly' && (
        <div>
          {/* Week navigator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button onClick={() => setSelectedWeek(addDays(selectedWeek, -7))} style={navBtnStyle}>‹ Prev</button>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'DM Mono', minWidth: 200, textAlign: 'center' }}>
              {shortDate(selectedWeek)} – {shortDate(addDays(selectedWeek, 4))}
            </div>
            <button onClick={() => setSelectedWeek(addDays(selectedWeek, 7))} style={navBtnStyle}>Next ›</button>
            {selectedWeek !== getWeekStart(todayStr()) && (
              <button onClick={() => setSelectedWeek(getWeekStart(todayStr()))} style={{ ...navBtnStyle, color: ACCENT, borderColor: `${ACCENT}44` }}>↩ This Week</button>
            )}
          </div>

          {/* Weekday columns grid */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px', minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={thS}>Engineer</th>
                  {getAllWeekdays(selectedWeek).map(d => {
                    const isBH  = isBankHoliday(d, bh);
                    const isT   = d === todayStr();
                    return (
                      <th key={d} style={{ ...thS, background: isBH ? 'rgba(99,102,241,0.15)' : isT ? 'rgba(0,194,255,0.08)' : 'rgba(255,255,255,0.03)', color: isT ? ACCENT : isBH ? PURPLE : '#94a3b8', border: isT ? `1px solid ${ACCENT}44` : thS.border }}>
                        {new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}
                        <div style={{ fontSize: 10, fontWeight: 400, fontFamily: 'DM Mono', opacity: 0.75 }}>{shortDate(d)}</div>
                        {isBH && <div style={{ fontSize: 9, color: PURPLE }}>Bank Hol</div>}
                      </th>
                    );
                  })}
                  <th style={thS}>RTO</th>
                  <th style={thS}>Late</th>
                </tr>
              </thead>
              <tbody>
                {engineers.map(u => {
                  const days = getAllWeekdays(selectedWeek);
                  const s    = getUserStats(u.id, selectedWeek, addDays(selectedWeek, 4));
                  const rtoOk = s.officeDays >= RTO_DAYS_REQUIRED;
                  return (
                    <tr key={u.id} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
                      <td style={{ ...tdS, fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,194,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: ACCENT }}>
                            {u.name.charAt(0)}
                          </div>
                          <div>
                            <div style={{ fontSize: 12 }}>{u.name.split(' ')[0]}</div>
                            <div style={{ fontSize: 10, color: '#475569', fontFamily: 'DM Mono' }}>{u.id}</div>
                          </div>
                        </div>
                      </td>
                      {days.map(d => {
                        const rec   = (tk[u.id] || {})[d];
                        const isBH  = isBankHoliday(d, bh);
                        const isHol = isOnHoliday(d, u.id, holidays);
                        const isFut = d > todayStr();
                        let cell;
                        if (isBH)  cell = <span title="Bank Holiday" style={{ fontSize: 11, color: PURPLE }}>🏛 BH</span>;
                        else if (isHol) cell = <span title="Holiday" style={{ fontSize: 11, color: '#a78bfa' }}>🌴</span>;
                        else if (isFut) cell = <span style={{ color: '#334155', fontSize: 11 }}>—</span>;
                        else if (rec?.type === 'office') {
                          const ls = lateStatus(rec.arrival);
                          cell = (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                              <span style={{ fontSize: 11, color: GREEN }}>🏢</span>
                              <span style={{ fontSize: 10, fontFamily: 'DM Mono', color: ls?.color || GREEN }}>{rec.arrival}</span>
                              {ls?.status === 'late' && <span style={{ fontSize: 9, color: RED, fontWeight: 700 }}>+{ls.diff}m</span>}
                            </div>
                          );
                        } else if (rec?.type === 'wfh')   cell = <span style={{ fontSize: 11, color: BLUE }}>🏠 WFH</span>;
                        else if (rec?.type === 'absent')  cell = <span style={{ fontSize: 11, color: RED }}>🤒 Abs</span>;
                        else cell = (
                          <button onClick={() => openLog(u.id, d)} style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 5, padding: '3px 7px', fontSize: 10, color: '#475569', cursor: 'pointer' }}>+ Log</button>
                        );
                        return (
                          <td key={d} onClick={!isBH && !isHol && !isFut ? () => openLog(u.id, d) : undefined}
                            style={{ ...tdS, textAlign: 'center', cursor: (!isBH && !isHol && !isFut) ? 'pointer' : 'default',
                              background: isBH ? 'rgba(99,102,241,0.07)' : 'transparent' }}>
                            {cell}
                          </td>
                        );
                      })}
                      <td style={{ ...tdS, textAlign: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'DM Mono', color: rtoOk ? GREEN : s.totalWorkdays < 5 ? AMBER : RED }}>
                          {s.officeDays}/{RTO_DAYS_REQUIRED}
                        </span>
                        {!rtoOk && s.totalWorkdays >= 5 && <div style={{ fontSize: 9, color: RED }}>⚠ RTO</div>}
                      </td>
                      <td style={{ ...tdS, textAlign: 'center' }}>
                        <span style={{ fontSize: 12, fontFamily: 'DM Mono', color: s.lateArrivals.length > 0 ? RED : GREEN }}>
                          {s.lateArrivals.length > 0 ? `${s.lateArrivals.length}×` : '✓'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: '#475569', flexWrap: 'wrap' }}>
            {[['🏢', 'In Office', GREEN], ['🏠', 'WFH', BLUE], ['🤒', 'Absent/Sick', RED], ['🏛', 'Bank Holiday', PURPLE], ['🌴', 'Holiday', '#a78bfa']].map(([ic, lb, c]) => (
              <span key={lb}>{ic} <span style={{ color: c }}>{lb}</span></span>
            ))}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: MONTHLY                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'monthly' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button onClick={() => {
              const [y, m] = viewMonth.split('-').map(Number);
              const prev = m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`;
              setViewMonth(prev);
            }} style={navBtnStyle}>‹ Prev</button>
            <div style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>
              {new Date(viewMonth + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </div>
            <button onClick={() => {
              const [y, m] = viewMonth.split('-').map(Number);
              const next = m === 12 ? `${y+1}-01` : `${y}-${String(m+1).padStart(2,'0')}`;
              setViewMonth(next);
            }} style={navBtnStyle}>Next ›</button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={thS}>Engineer</th>
                  <th style={thS}>Office Days</th>
                  <th style={thS}>WFH Days</th>
                  <th style={thS}>Absent</th>
                  <th style={thS}>Bank Hols</th>
                  <th style={thS}>Holidays</th>
                  <th style={thS}>Late</th>
                  <th style={thS}>RTO %</th>
                  <th style={thS}>Status</th>
                </tr>
              </thead>
              <tbody>
                {monthStats.map(({ user: u, stats: s }) => {
                  const compColor = s.rtoCompliance >= 80 ? GREEN : s.rtoCompliance >= 60 ? AMBER : RED;
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={tdS}><div style={{ display:'flex', alignItems:'center', gap:8 }}><div style={{ width:24, height:24, borderRadius:'50%', background:'rgba(0,194,255,0.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:ACCENT }}>{u.name.charAt(0)}</div><span style={{fontSize:12}}>{u.name}</span></div></td>
                      <td style={{ ...tdS, textAlign:'center', fontFamily:'DM Mono', color:GREEN }}>{s.officeDays}</td>
                      <td style={{ ...tdS, textAlign:'center', fontFamily:'DM Mono', color:BLUE }}>{s.wfhDays}</td>
                      <td style={{ ...tdS, textAlign:'center', fontFamily:'DM Mono', color:s.absentDays>0?RED:'#475569' }}>{s.absentDays || '—'}</td>
                      <td style={{ ...tdS, textAlign:'center', fontFamily:'DM Mono', color:PURPLE }}>{s.bankHolCount || '—'}</td>
                      <td style={{ ...tdS, textAlign:'center', fontFamily:'DM Mono', color:'#a78bfa' }}>{s.holidayCount || '—'}</td>
                      <td style={{ ...tdS, textAlign:'center', fontFamily:'DM Mono', color:s.lateArrivals.length>0?RED:GREEN }}>{s.lateArrivals.length > 0 ? s.lateArrivals.length : '✓'}</td>
                      <td style={{ ...tdS, textAlign:'center' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ flex:1, height:6, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${s.rtoCompliance}%`, background:compColor, borderRadius:3, transition:'width 0.4s' }} />
                          </div>
                          <span style={{ fontSize:11, fontFamily:'DM Mono', color:compColor, minWidth:32 }}>{s.rtoCompliance}%</span>
                        </div>
                      </td>
                      <td style={{ ...tdS, textAlign:'center' }}>
                        <span style={{ fontSize:11, fontWeight:700, color:compColor, background:`${compColor}15`, padding:'2px 8px', borderRadius:4 }}>
                          {s.rtoCompliance >= 80 ? '✓ Met' : s.rtoCompliance >= 60 ? '⚠ Low' : '✗ Breach'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Monthly comparison bars */}
          <div style={{ marginTop: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Office Days Distribution</div>
            <div style={{ display: 'flex', gap: 24, overflowX: 'auto' }}>
              {monthStats.map(({ user: u, stats: s }) => {
                const [y, m] = viewMonth.split('-').map(Number);
                const daysInMonth = new Date(y, m, 0).getDate();
                const workdays = Array.from({ length: daysInMonth }, (_, i) => {
                  const d = `${viewMonth}-${String(i+1).padStart(2,'0')}`;
                  const dow = new Date(d+'T12:00:00').getDay();
                  return dow >= 1 && dow <= 5 && !isBankHoliday(d, bh) && !isOnHoliday(d, u.id, holidays);
                }).filter(Boolean).length;
                const needed = Math.ceil(workdays * RTO_DAYS_REQUIRED / 5);
                return (
                  <div key={u.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, minWidth:70 }}>
                    <MiniBar value={s.officeDays} max={Math.max(workdays, 1)} color={s.officeDays >= needed ? GREEN : RED} height={60} width={28} label="" />
                    {needed > 0 && (
                      <div style={{ fontSize:9, color:'#475569', fontFamily:'DM Mono', textAlign:'center' }}>
                        need {needed}d
                      </div>
                    )}
                    <div style={{ fontSize:10, color:'#94a3b8', textAlign:'center' }}>{u.name.split(' ')[0]}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: HEAT MAP                                                       */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'heatmap' && (
        <div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
            14-week attendance heat map. Each column = 1 week (Mon → Fri), each row = 1 engineer.
          </div>
          {/* Week labels */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 6, marginLeft: 140 }}>
            {heatWeeks.map(ws => (
              <div key={ws} style={{ display:'flex', flexDirection:'column', gap:1, width:18*5+4*4 }}>
                <div style={{ fontSize: 9, color: '#475569', fontFamily: 'DM Mono', textAlign:'center', whiteSpace:'nowrap' }}>
                  {shortDate(ws)}
                </div>
              </div>
            ))}
          </div>
          {/* Engineer rows */}
          {(filterUser === 'all' ? engineers : engineers.filter(e => e.id === filterUser)).map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 130, fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {u.name}
              </div>
              {heatWeeks.map(ws => (
                <div key={ws} style={{ display: 'flex', gap: 2 }}>
                  {getAllWeekdays(ws).map(d => {
                    const rec   = (tk[u.id] || {})[d];
                    const isBH  = isBankHoliday(d, bh);
                    const isHol = isOnHoliday(d, u.id, holidays);
                    const isFut = d > todayStr();
                    return (
                      <HeatCell key={d} record={rec} bankHol={isBH} holiday={isHol} isToday={d===todayStr()} isFuture={isFut} />
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap', fontSize: 11, color: '#64748b', alignItems: 'center' }}>
            {[
              { bg:'rgba(34,197,94,0.25)',  label:'In office (on time)' },
              { bg:'rgba(245,158,11,0.3)',  label:'In office (late warn)' },
              { bg:'rgba(239,68,68,0.3)',   label:'In office (late)' },
              { bg:'rgba(59,130,246,0.2)',  label:'WFH' },
              { bg:'rgba(99,102,241,0.25)', label:'Bank Holiday' },
              { bg:'rgba(139,92,246,0.18)', label:'Holiday' },
              { bg:'rgba(255,255,255,0.03)', label:'No data' },
            ].map(l => (
              <span key={l.label} style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:12, height:12, borderRadius:2, background:l.bg, display:'inline-block', border:'1px solid rgba(255,255,255,0.08)' }} />
                {l.label}
              </span>
            ))}
          </div>
          {/* Filter */}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>Filter:</span>
            <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', padding: '4px 10px', fontSize: 12 }}>
              <option value="all">All engineers</option>
              {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: ALERTS                                                         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'alerts' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {['all','pattern','lateonly','rto'].map(f => (
              <div key={f} onClick={() => setAlertFilter(f)}
                style={{ padding:'5px 14px', borderRadius:6, fontSize:12, cursor:'pointer', fontWeight:600,
                  background: alertFilter===f ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${alertFilter===f ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.07)'}`,
                  color: alertFilter===f ? RED : '#64748b' }}>
                {{ all:'All', pattern:'🔁 Pattern', lateonly:'⏰ Late', rto:'🏢 RTO Breach' }[f]}
              </div>
            ))}
          </div>
          {patternAlerts.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 0', color:'#475569' }}>
              <div style={{ fontSize:40, marginBottom:10 }}>✅</div>
              <div style={{ fontSize:14, fontWeight:600 }}>No attendance alerts — team is on track.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {patternAlerts
                .filter(a => alertFilter === 'all' ? true : alertFilter === 'pattern' ? a.hasPattern : alertFilter === 'lateonly' ? a.lateCount > 0 : a.rtoCompliance < 60)
                .map(a => {
                  const thirtyAgo = addDays(todayStr(), -29);
                  const s = getUserStats(a.user.id, thirtyAgo, todayStr());
                  const compColor = a.rtoCompliance >= 80 ? GREEN : a.rtoCompliance >= 60 ? AMBER : RED;
                  return (
                    <div key={a.user.id} style={{ background: a.hasPattern ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)', border: `1px solid ${a.hasPattern ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.2)'}`, borderRadius: 10, padding: '14px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: RED, border: '1.5px solid rgba(239,68,68,0.3)' }}>{a.user.name.charAt(0)}</div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>{a.user.name}</div>
                            <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'DM Mono' }}>{a.user.id}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {a.lateCount > 0 && <span style={{ background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:5, padding:'3px 9px', fontSize:11, color:RED, fontWeight:700 }}>⏰ {a.lateCount} late arrivals (30d)</span>}
                          {a.maxStreak >= STREAK_THRESHOLD && <span style={{ background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:5, padding:'3px 9px', fontSize:11, color:RED, fontWeight:700 }}>🔁 {a.maxStreak}× consecutive late</span>}
                          {a.rtoCompliance < 60 && <span style={{ background:`${compColor}18`, border:`1px solid ${compColor}44`, borderRadius:5, padding:'3px 9px', fontSize:11, color:compColor, fontWeight:700 }}>🏢 RTO {a.rtoCompliance}%</span>}
                        </div>
                      </div>
                      {/* Late arrival timeline */}
                      {s.lateArrivals.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Recent late arrivals:</div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {s.lateArrivals.slice(-8).map(la => (
                              <span key={la.date} style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:5, padding:'2px 8px', fontSize:10, fontFamily:'DM Mono', color:la.color }}>
                                {shortDate(la.date)} {la.arrival} ({la.label})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: ATTENDANCE LOG                                                 */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'log' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={selectedUser || 'all'} onChange={e => setSelectedUser(e.target.value === 'all' ? null : e.target.value)}
              style={selStyle}>
              <option value="all">All Engineers</option>
              {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="month" value={viewMonth} onChange={e => setViewMonth(e.target.value)} style={selStyle} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={thS}>Engineer</th>
                  <th style={thS}>Date</th>
                  <th style={thS}>Type</th>
                  <th style={thS}>Arrival</th>
                  <th style={thS}>Departure</th>
                  <th style={thS}>Hours</th>
                  <th style={thS}>Status</th>
                  <th style={thS}>Note</th>
                  <th style={thS}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(selectedUser ? [engineers.find(u => u.id === selectedUser)].filter(Boolean) : engineers).flatMap(u => {
                  const [y, m] = viewMonth.split('-').map(Number);
                  const start = `${viewMonth}-01`;
                  const end   = new Date(y, m, 0).toISOString().slice(0, 10);
                  const recs  = tk[u.id] || {};
                  return Object.keys(recs)
                    .filter(d => d >= start && d <= end)
                    .sort().reverse()
                    .map(d => {
                      const rec = recs[d];
                      const ls  = rec.type === 'office' ? lateStatus(rec.arrival) : null;
                      const hrs = rec.type === 'office' && rec.arrival && rec.departure
                        ? ((parseTime(rec.departure) - parseTime(rec.arrival)) / 60).toFixed(1)
                        : null;
                      return (
                        <tr key={`${u.id}-${d}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={tdS}><span style={{ fontSize: 12 }}>{u.name}</span></td>
                          <td style={{ ...tdS, fontFamily: 'DM Mono', fontSize: 11, color: '#94a3b8', whiteSpace:'nowrap' }}>{formatDate(d)}</td>
                          <td style={{ ...tdS, textAlign: 'center' }}>
                            <span style={{ fontSize: 12 }}>
                              {rec.type === 'office' ? '🏢' : rec.type === 'wfh' ? '🏠' : '🤒'}
                              <span style={{ fontSize: 10, color: '#64748b', marginLeft: 3 }}>{rec.type}</span>
                            </span>
                          </td>
                          <td style={{ ...tdS, fontFamily:'DM Mono', fontSize:11, textAlign:'center', color: ls?.color || '#64748b' }}>{rec.arrival || '—'}</td>
                          <td style={{ ...tdS, fontFamily:'DM Mono', fontSize:11, textAlign:'center', color:'#64748b' }}>{rec.departure || '—'}</td>
                          <td style={{ ...tdS, fontFamily:'DM Mono', fontSize:11, textAlign:'center', color: hrs && Number(hrs) < 7 ? AMBER : GREEN }}>{hrs ? `${hrs}h` : '—'}</td>
                          <td style={{ ...tdS, textAlign: 'center' }}>
                            {ls ? (
                              <span style={{ fontSize: 10, fontWeight: 700, color: ls.color, background: `${ls.color}15`, padding:'2px 7px', borderRadius:4 }}>{ls.label}</span>
                            ) : rec.type === 'wfh' ? <span style={{ fontSize: 10, color: BLUE }}>WFH</span>
                              : rec.type === 'absent' ? <span style={{ fontSize: 10, color: RED }}>Absent</span> : '—'}
                          </td>
                          <td style={{ ...tdS, fontSize: 11, color: '#64748b' }}>{rec.note || '—'}</td>
                          <td style={{ ...tdS, textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent:'center' }}>
                              <button onClick={() => openLog(u.id, d)} style={actBtnStyle}>✏</button>
                              <button onClick={() => deleteRecord(u.id, d)} style={{ ...actBtnStyle, color: RED, borderColor: `${RED}33` }}>🗑</button>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* EXPORT EXCEL MODAL (manager only)                                  */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {showExport && isManager && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => { if (e.target===e.currentTarget) setShowExport(false); }}>
          <div style={{ background:'#0f172a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:14, padding:28, width:'100%', maxWidth:440, boxShadow:'0 25px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <div style={{ fontSize:16, fontWeight:700 }}>📥 Export Attendance to Excel</div>
              <button onClick={()=>setShowExport(false)} style={{ background:'none', border:'none', color:'#64748b', fontSize:20, cursor:'pointer' }}>✕</button>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:5, fontWeight:600 }}>From</div>
                  <input type="date" value={exportFrom} onChange={e=>setExportFrom(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:5, fontWeight:600 }}>To</div>
                  <input type="date" value={exportTo} onChange={e=>setExportTo(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {[
                  ['This week', () => { const ws=getWeekStart(todayStr()); setExportFrom(ws); setExportTo(addDays(ws,4)); }],
                  ['This month', () => { const [y,m]=todayStr().slice(0,7).split('-'); setExportFrom(`${y}-${m}-01`); setExportTo(new Date(y,m,0).toISOString().slice(0,10)); }],
                  ['Last 30 days', () => { setExportFrom(addDays(todayStr(),-29)); setExportTo(todayStr()); }],
                  ['All time', () => { setExportFrom(''); setExportTo(''); }],
                ].map(([l,fn]) => (
                  <button key={l} onClick={fn} style={{ padding:'4px 12px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#94a3b8', fontSize:11, cursor:'pointer' }}>{l}</button>
                ))}
              </div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
                <button onClick={()=>setShowExport(false)} style={{ padding:'8px 18px', background:'transparent', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#64748b', cursor:'pointer', fontSize:13 }}>Cancel</button>
                <button onClick={async ()=>{ setExporting(true); await exportAttendanceExcel(engineers,tk,bankHolidays,holidays,exportFrom,exportTo); setExporting(false); setShowExport(false); }}
                  disabled={exporting}
                  style={{ padding:'8px 22px', background:ACCENT, color:'#000', border:'none', borderRadius:7, fontWeight:700, fontSize:13, cursor:'pointer' }}>
                  {exporting ? '⏳ Exporting…' : '📥 Download Excel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* LOG ATTENDANCE MODAL                                                */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {showLogModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => { if (e.target === e.currentTarget) setShowLogModal(false); }}>
          <div style={{ background:'#0f172a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:14, padding:28, width:'100%', maxWidth:460, boxShadow:'0 25px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <div style={{ fontSize:16, fontWeight:700 }}>🕒 Log Attendance</div>
              <button onClick={() => setShowLogModal(false)} style={{ background:'none', border:'none', color:'#64748b', fontSize:20, cursor:'pointer', lineHeight:1 }}>✕</button>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={lblStyle}>Engineer</label>
                <select value={logUser} onChange={e => setLogUser(e.target.value)} style={inputStyle}>
                  <option value="">Select engineer…</option>
                  {engineers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
                </select>
              </div>
              <div>
                <label style={lblStyle}>Date</label>
                <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={lblStyle}>Type</label>
                <div style={{ display:'flex', gap:8 }}>
                  {[['office','🏢 In Office',GREEN],['wfh','🏠 WFH',BLUE],['absent','🤒 Absent',RED]].map(([v,l,c]) => (
                    <div key={v} onClick={() => setLogType(v)}
                      style={{ flex:1, padding:'8px 0', textAlign:'center', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:600,
                        background: logType===v ? `${c}18` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${logType===v ? `${c}55` : 'rgba(255,255,255,0.08)'}`,
                        color: logType===v ? c : '#64748b', transition:'all 0.15s' }}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>
              {logType === 'office' && (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div>
                      <label style={lblStyle}>Arrival Time</label>
                      <input type="time" value={logArrival} onChange={e => setLogArrival(e.target.value)} style={inputStyle} />
                      {logArrival && (() => {
                        const ls = lateStatus(logArrival);
                        if (!ls) return null;
                        return (
                          <div style={{ fontSize:11, color:ls.color, marginTop:4, fontWeight:600 }}>
                            {ls.status==='ontime'||ls.status==='early' ? '✓ On time' : ls.status==='warn' ? `⚠ Grace period (+${ls.diff}m)` : `✗ Late (+${ls.diff}m over grace)`}
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <label style={lblStyle}>Departure Time</label>
                      <input type="time" value={logDeparture} onChange={e => setLogDeparture(e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                </>
              )}
              <div>
                <label style={lblStyle}>Note (optional)</label>
                <input type="text" value={logNote} onChange={e => setLogNote(e.target.value)} placeholder="e.g. Client visit, early finish approved…" style={inputStyle} />
              </div>
              {/* Existing record warning */}
              {logUser && logDate && (tk[logUser] || {})[logDate] && (
                <div style={{ background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.25)', borderRadius:7, padding:'8px 12px', fontSize:12, color:AMBER }}>
                  ⚠ A record already exists for this date — saving will overwrite it.
                </div>
              )}
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
                <button onClick={() => setShowLogModal(false)} style={{ padding:'8px 18px', background:'transparent', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#64748b', cursor:'pointer', fontSize:13 }}>Cancel</button>
                <button onClick={saveRecord} disabled={!logUser || !logDate || saving}
                  style={{ padding:'8px 22px', background:ACCENT, color:'#000', border:'none', borderRadius:7, fontWeight:700, fontSize:13, cursor:'pointer', opacity:(!logUser||!logDate)?0.5:1 }}>
                  {saving ? 'Saving…' : '✓ Save Record'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline style constants ────────────────────────────────────────────────────
const thS = {
  padding: '8px 12px', background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)', fontSize: 11,
  fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
  letterSpacing: '0.5px', whiteSpace: 'nowrap', textAlign: 'left',
};
const tdS = {
  padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
  fontSize: 12, verticalAlign: 'middle',
};
const navBtnStyle = {
  padding: '6px 14px', background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6,
  color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
const selStyle = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6, color: '#e2e8f0', padding: '6px 12px', fontSize: 12,
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 7, color: '#e2e8f0', fontSize: 13, outline: 'none',
};
const lblStyle = {
  display: 'block', fontSize: 11, color: '#64748b', marginBottom: 5,
  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
};
const actBtnStyle = {
  padding: '3px 8px', background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5,
  cursor: 'pointer', fontSize: 12, color: '#94a3b8',
};
