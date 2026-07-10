// src/Rota.js
// CloudOps Rota — improved editing: floating cell editor, sticky toolbar, floating bulk bar 30th May 2026
import React, { useState, useRef, useEffect, useCallback } from 'react';

// ── Constants ────────────────────────────────────────────────────────────────
const SHIFT_COLORS = {
  daily:       { bg: '#1e40af', label: 'Daily Shift',      text: '#bfdbfe' },
  evening:     { bg: '#166534', label: 'Weekday On-Call',  text: '#bbf7d0' },
  weekend:     { bg: '#854d0e', label: 'Weekend On-Call',  text: '#fef08a' },
  upgrade:     { bg: '#991b1b', label: 'Upgrade Day',      text: '#fecaca' },
  holiday:     { bg: '#92400e', label: 'Holiday',          text: '#fde68a' },
  bankholiday: { bg: '#7f1d1d', label: 'Bank Holiday',     text: '#fca5a5' },
  inactive:    { bg: '#1e293b', label: 'Not on-call yet',  text: '#475569' },
};

const SHIFT_ABBR = {
  daily: 'D', evening: 'WD', weekend: 'WE',
  upgrade: 'UD', holiday: 'H', bankholiday: 'BH', off: '—',
};

const SHIFT_HOURS = {
  daily:       { start: '10:00', end: '19:00', label: '10am – 7pm',   desc: 'Daily Shift (Mon–Fri)',             standbyHrs: 0,  workedHrs: 9  },
  evening:     { start: '19:00', end: '07:00', label: '7pm – 7am',    desc: 'Weekday On-Call (Mon–Thu)',         standbyHrs: 12, workedHrs: 0  },
  weekend:     { start: '19:00', end: '07:00', label: '7pm – 7am',    desc: 'Weekend On-Call (Fri 7pm–Mon 7am)', standbyHrs: 60, workedHrs: 0  },
  bankholiday: { start: '09:00', end: '07:00', label: '9am – 7am',    desc: 'Bank Holiday On-Call',              standbyHrs: 22, workedHrs: 0  },
  upgrade:     { start: '00:00', end: '23:59', label: 'All day',       desc: 'Upgrade Day',                      standbyHrs: 0,  workedHrs: 8  },
  holiday:     { start: '',      end: '',       label: 'Holiday',       desc: 'Annual Leave',                     standbyHrs: 0,  workedHrs: 0  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function sanitiseRota(raw) {
  const out = {};
  Object.entries(raw || {}).forEach(([uid, days]) => {
    out[uid] = {};
    Object.entries(days || {}).forEach(([date, shift]) => {
      const dow = new Date(date + 'T12:00:00').getDay();
      out[uid][date] = (shift === 'daily' && (dow === 0 || dow === 6)) ? 'off' : shift;
    });
  });
  return out;
}

function isOnCallActive(user, dateStr) {
  if (!user) return false;
  if (user.start_date && dateStr < user.start_date) return false;
  if (user.oncall_start_date && dateStr < user.oncall_start_date) return false;
  if (user.termination_date && dateStr > user.termination_date) return false;
  return true;
}

function isEmployed(user, dateStr) {
  if (!user) return false;
  if (user.start_date && dateStr < user.start_date) return false;
  if (user.termination_date && dateStr > user.termination_date) return false;
  return true;
}

function getOnCallStatus(user, dateStr) {
  if (!user) return null;
  if (user.termination_date && dateStr > user.termination_date) return { type: 'terminated', label: 'Left', color: '#ef4444' };
  if (user.start_date && dateStr < user.start_date) return { type: 'not_started', label: 'Not started', color: '#64748b' };
  if (user.oncall_start_date && dateStr < user.oncall_start_date) return { type: 'not_ready', label: 'Not on-call yet', color: '#f59e0b' };
  return null;
}

// ── ISO week number ───────────────────────────────────────────────────────────
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - jan1) / 86400000) + 1) / 7);
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ user, size = 24 }) {
  if (!user) return <div style={{ width:size, height:size, borderRadius:'50%', background:'#1e293b' }} />;
  if (user.profile_picture) return <img src={user.profile_picture} alt="" style={{ width:size, height:size, borderRadius:'50%', objectFit:'cover' }} />;
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:user.color||'#1d4ed8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:Math.round(size*0.4), fontWeight:700, color:'#fff', flexShrink:0 }}>
      {user.avatar||user.name?.charAt(0)||'?'}
    </div>
  );
}

// ── Shift Legend ──────────────────────────────────────────────────────────────
function ShiftLegend() {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
      {[
        ['#1e40af', 'D',  'Daily Shift (9am–6pm)'],
        ['#166534', 'WD', 'Weekday On-Call (19:00–07:00)'],
        ['#854d0e', 'WE', 'Weekend On-Call (19:00–07:00)'],
        ['#991b1b', 'UD', 'Upgrade Day'],
        ['#92400e', 'H',  'Holiday'],
        ['#1e293b', '—',  'Not on-call yet'],
      ].map(([bg, abbr, label]) => (
        <div key={label} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--text-secondary)' }}>
          <div style={{ width:20, height:18, borderRadius:4, background:bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:800, color:'#fff', flexShrink:0 }}>
            {abbr}
          </div>
          {label}
        </div>
      ))}
    </div>
  );
}

// ── Readiness Banner ──────────────────────────────────────────────────────────
function ReadinessBanner({ users, startDate, weeks }) {
  const today = new Date().toISOString().slice(0,10);
  const rangeEnd = new Date(startDate);
  rangeEnd.setDate(rangeEnd.getDate() + weeks * 7);
  const rangeEndStr = rangeEnd.toISOString().slice(0,10);
  const pending    = users.filter(u => u.oncall_start_date && u.oncall_start_date >= today && u.oncall_start_date <= rangeEndStr);
  const notReady   = users.filter(u => u.oncall_start_date && u.oncall_start_date > rangeEndStr);
  const terminated = users.filter(u => u.termination_date && u.termination_date >= today && u.termination_date <= rangeEndStr);
  if (pending.length === 0 && notReady.length === 0 && terminated.length === 0) return null;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
      {pending.map(u => (
        <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.25)', borderRadius:8, padding:'8px 14px', fontSize:12 }}>
          <span>⏳</span><span><strong style={{ color:'#fcd34d' }}>{u.name}</strong> goes on-call on <strong style={{ color:'#fcd34d', fontFamily:'DM Mono' }}>{u.oncall_start_date}</strong></span>
        </div>
      ))}
      {notReady.map(u => (
        <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(100,116,139,0.08)', border:'1px solid rgba(100,116,139,0.2)', borderRadius:8, padding:'8px 14px', fontSize:12 }}>
          <span>🚫</span><span><strong style={{ color:'#94a3b8' }}>{u.name}</strong> is not on-call yet (on-call start: <strong style={{ fontFamily:'DM Mono' }}>{u.oncall_start_date || 'not set'}</strong>).</span>
        </div>
      ))}
      {terminated.map(u => (
        <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:8, padding:'8px 14px', fontSize:12 }}>
          <span>👋</span><span><strong style={{ color:'#fca5a5' }}>{u.name}</strong> leaves on <strong style={{ color:'#fca5a5', fontFamily:'DM Mono' }}>{u.termination_date}</strong></span>
        </div>
      ))}
    </div>
  );
}

// ── Floating Cell Editor Popover ──────────────────────────────────────────────
function CellEditorPopover({ cell, users, rota, holidays, UK_BANK_HOLIDAYS, upgrades,
  onSetShift, onDelete, onClose, onToggleLock, isLockedFn }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: cell.y + 12, left: cell.x });

  // Position: keep inside viewport
  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth; const vh = window.innerHeight;
    let left = cell.x; let top = cell.y + 12;
    if (left + r.width > vw - 16) left = vw - r.width - 16;
    if (top + r.height > vh - 16) top = cell.y - r.height - 8;
    if (left < 16) left = 16; if (top < 16) top = 16;
    setPos({ top, left });
  }, [cell.x, cell.y]);

  // Close on Escape
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Click outside to close
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h, true);
    return () => document.removeEventListener('mousedown', h, true);
  }, [onClose]);

  const { userId, date } = cell;
  const user = users.find(u => u.id === userId);
  const currentShift = rota[userId]?.[date] || 'off';
  const dow = new Date(date + 'T12:00:00').getDay();
  const isWeekend = dow === 0 || dow === 6;
  const locked = isLockedFn(userId, date);
  const hol = holidays.find(h => h.userId === userId && date >= h.start && date <= h.end);
  const bh  = (UK_BANK_HOLIDAYS||[]).find(b => b.date === date);
  const d   = new Date(date + 'T12:00:00');
  const dayLabel = d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'short', year:'numeric' });

  const SHIFT_OPTS = [
    { value:'off',         label:'Off / Rest',        icon:'—',   bg:'#1e293b', text:'#64748b' },
    { value:'daily',       label:'Daily Shift',        icon:'D',   bg:'#1e40af', text:'#bfdbfe', hideOn: isWeekend },
    { value:'evening',     label:'Weekday On-Call',    icon:'WD',  bg:'#166534', text:'#bbf7d0', hideOn: !(dow>=1&&dow<=4) },
    { value:'weekend',     label:'Weekend On-Call',    icon:'WE',  bg:'#854d0e', text:'#fef08a' },
    { value:'upgrade',     label:'Upgrade Day',        icon:'UD',  bg:'#991b1b', text:'#fecaca' },
    { value:'holiday',     label:'Annual Leave',       icon:'H',   bg:'#92400e', text:'#fde68a' },
    { value:'bankholiday', label:'Bank Holiday',       icon:'BH',  bg:'#7f1d1d', text:'#fca5a5' },
  ].filter(o => !o.hideOn);

  const timeHint = {
    daily: '09:00 – 19:00', evening: '19:00 – 07:00 (+1)',
    weekend: '19:00 – 07:00 (+1)', upgrade: 'All day',
    holiday: 'Annual leave', bankholiday: 'Bank holiday', off: 'Not scheduled',
  }[currentShift] || '';

  return (
    <div ref={ref} style={{
      position:'fixed', top:pos.top, left:pos.left, zIndex:9999,
      background:'#0d1424',
      border:'1px solid rgba(255,255,255,0.13)',
      borderRadius:14, padding:0, minWidth:272,
      boxShadow:'0 32px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
    }}>
      {/* ── Header ── */}
      <div style={{ padding:'13px 16px 11px', borderBottom:'1px solid rgba(255,255,255,0.07)', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <Avatar user={user} size={32} />
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0', lineHeight:1.2 }}>{user?.name}</div>
            <div style={{ fontSize:11, color:'#64748b', marginTop:2, fontFamily:'DM Mono' }}>{dayLabel}</div>
            {timeHint && currentShift !== 'off' && (
              <div style={{ fontSize:10, color:'#475569', marginTop:1 }}>⏱ {timeHint}</div>
            )}
          </div>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:18, lineHeight:1, padding:'2px 4px', borderRadius:4 }}>✕</button>
      </div>

      {/* ── Overlay indicators ── */}
      {(hol || bh) && (
        <div style={{ padding:'6px 14px', background:'rgba(245,158,11,0.07)', borderBottom:'1px solid rgba(255,255,255,0.05)', fontSize:11, color:'#fcd34d', display:'flex', gap:8, alignItems:'center' }}>
          {hol && <span>🏖 Holiday period active</span>}
          {bh  && <span>🏦 {bh.title || 'Bank Holiday'}</span>}
        </div>
      )}

      {/* ── Shift options grid ── */}
      <div style={{ padding:'12px 14px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
        {SHIFT_OPTS.map(opt => {
          const isActive = currentShift === opt.value;
          return (
            <button key={opt.value}
              onClick={() => { onSetShift(userId, date, opt.value); onClose(); }}
              style={{
                display:'flex', alignItems:'center', gap:9,
                background: isActive ? `${opt.bg}cc` : `${opt.bg}28`,
                border: `1.5px solid ${isActive ? opt.bg : `${opt.bg}55`}`,
                borderRadius:9, padding:'9px 11px', cursor:'pointer',
                color: isActive ? opt.text : 'rgba(255,255,255,0.4)',
                fontSize:12, fontWeight:600, transition:'all 0.12s',
                outline: isActive ? `2px solid ${opt.bg}66` : 'none',
                outlineOffset:1,
              }}>
              <div style={{ width:24, height:24, borderRadius:5, background:opt.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:opt.icon.length>1?8:10, fontWeight:900, color:'#fff', flexShrink:0, letterSpacing:'-0.5px' }}>
                {opt.icon}
              </div>
              <span style={{ lineHeight:1.2 }}>{opt.label}</span>
              {isActive && <span style={{ marginLeft:'auto', fontSize:14 }}>✓</span>}
            </button>
          );
        })}
      </div>

      {/* ── Actions footer ── */}
      <div style={{ padding:'10px 14px 13px', borderTop:'1px solid rgba(255,255,255,0.06)', display:'flex', gap:7 }}>
        <button onClick={() => onToggleLock(userId, date)}
          title="Prevents this cell being overwritten by Generate — manual edits can still change it"
          style={{ flex:1, padding:'7px 10px', background:locked?'rgba(245,158,11,0.12)':'rgba(255,255,255,0.04)', border:`1px solid ${locked?'rgba(245,158,11,0.45)':'rgba(255,255,255,0.09)'}`, borderRadius:8, color:locked?'#fcd34d':'#64748b', fontSize:11, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
          {locked ? '🔒 Locked from Generate' : '🔓 Lock from Generate'}
        </button>
        {currentShift !== 'off' && (
          <button onClick={() => { onDelete(userId, date); onClose(); }}
            style={{ padding:'7px 13px', background:'rgba(239,68,68,0.09)', border:'1px solid rgba(239,68,68,0.28)', borderRadius:8, color:'#fca5a5', fontSize:11, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
            🗑 Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Rota Component ───────────────────────────────────────────────────────
// ── Rota content (schedule views) ────────────────────────────────────────────
function RotaContent({
  users, rota, setRota, holidays, upgrades, swapRequests, setSwapRequests,
  isManager, UK_BANK_HOLIDAYS, generateRota, generateICalFeed, downloadIcal,
}) {
  const [startDate,       setStartDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [weeks,           setWeeks]           = useState(4);
  const [generated,       setGenerated]       = useState(true);
  const [editCell,        setEditCell]        = useState(null); // { userId, date, x, y }
  const [bulkSelected,    setBulkSelected]    = useState(new Set());
  const [bulkShift,       setBulkShift]       = useState('daily');
  const [swapSuggestion,  setSwapSuggestion]  = useState(null);
  const [viewMode,        setViewMode]        = useState('compact');
  const [calendarDate,    setCalendarDate]     = useState(() => new Date());
  const [managerUnlocked, setManagerUnlocked] = useState(false);
  const [lockedCells,     setLockedCells]     = useState(new Set());
  const [showInactive,    setShowInactive]    = useState(false);
  const [activeTab,       setActiveTab]       = useState('rota');
  const [filterUser,      setFilterUser]      = useState('all');
  const [filterShift,     setFilterShift]     = useState('all');
  const [anaReport,       setAnaReport]       = useState('heatmap');
  const [anaStart,        setAnaStart]        = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [anaEnd, setAnaEnd] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });

  const toggleLock  = (userId, date) => {
    const key = `${userId}::${date}`;
    setLockedCells(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const isLocked  = (userId, date) => lockedCells.has(`${userId}::${date}`);
  const canEdit   = isManager && managerUnlocked;

  // ── Paint mode ──────────────────────────────────────────────────────────
  // Pick a shift once, then click or drag across cells to apply it — instead
  // of opening the popover for every single cell. Right-click (or the
  // popover path when paint mode is off) still gives the detailed editor
  // for lock/clear/holiday info. Currently wired up for the Compact view.
  // NOTE: this block must come AFTER `canEdit` above — paintCell's
  // useCallback dependency array references canEdit immediately on render,
  // and referencing a const before its declaration line throws a temporal-
  // dead-zone ReferenceError. (This is what broke the last version.)
  const [paintMode,   setPaintMode]   = useState(false);
  const [paintBrush,  setPaintBrush]  = useState('daily');
  const [rotaHistory, setRotaHistory] = useState([]); // undo stack (last 25 strokes)
  const paintingRef      = useRef(false);
  const paintSkippedRef  = useRef([]);

  const PAINT_BRUSHES = [
    { id:'off',     ...SHIFT_COLORS.inactive, label:'Off / Rest' },
    { id:'daily',   ...SHIFT_COLORS.daily },
    { id:'evening', ...SHIFT_COLORS.evening },
    { id:'weekend', ...SHIFT_COLORS.weekend },
    { id:'upgrade', ...SHIFT_COLORS.upgrade },
    { id:'holiday', ...SHIFT_COLORS.holiday },
  ];

  // Mirrors CellEditorPopover's hideOn logic: a "Daily" or weekday
  // "On-Call" brush silently skips cells it doesn't apply to (weekends /
  // Fri-Sun for evening) rather than writing an out-of-taxonomy value.
  const isBrushValidForDate = (brush, dateStr) => {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    const isWeekend = dow === 0 || dow === 6;
    if (brush === 'daily')   return !isWeekend;
    if (brush === 'evening') return dow >= 1 && dow <= 4;
    return true;
  };

  const beginPaintStroke = () => {
    setRotaHistory(prev => {
      const next = [...prev, JSON.stringify(rota)];
      return next.length > 25 ? next.slice(-25) : next;
    });
  };

  const undoPaint = () => {
    setRotaHistory(prev => {
      if (prev.length === 0) return prev;
      setRota(JSON.parse(prev[prev.length - 1]));
      return prev.slice(0, -1);
    });
  };

  const paintCell = useCallback((userId, date) => {
    if (!canEdit) return;
    const user = users.find(u => u.id === userId);
    if (!isOnCallActive(user, date) && paintBrush !== 'off') { paintSkippedRef.current.push(user?.name); return; }
    if (!isBrushValidForDate(paintBrush, date)) return; // brush doesn't apply to this day — skip silently
    const dow = new Date(date + 'T12:00:00').getDay();
    const isWeekend = dow === 0 || dow === 6;
    const value = (paintBrush === 'daily' && isWeekend) ? 'weekend' : paintBrush;
    setRota(prev => {
      if (prev[userId]?.[date] === value) return prev; // no-op — avoids churn while dragging
      return { ...prev, [userId]: { ...(prev[userId]||{}), [date]: value } };
    });
  }, [canEdit, users, paintBrush, setRota]);

  const handlePaintDown = (userId, date, e) => {
    if (!paintMode || !canEdit) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleBulk(userId, date); return; } // discrete bulk-select still works
    paintingRef.current = true;
    paintSkippedRef.current = [];
    beginPaintStroke();
    paintCell(userId, date);
  };

  const handlePaintEnter = (userId, date) => {
    if (!paintMode || !paintingRef.current) return;
    paintCell(userId, date);
  };

  // End a paint stroke on mouseup anywhere on the page (not just over a
  // cell), and show ONE summary alert for any skipped not-on-call cells
  // instead of interrupting every cell of the drag with its own alert.
  useEffect(() => {
    const onUp = () => {
      if (!paintingRef.current) return;
      paintingRef.current = false;
      if (paintSkippedRef.current.length) {
        alert(`Skipped ${[...new Set(paintSkippedRef.current)].join(', ')} — not on-call active.`);
      }
      paintSkippedRef.current = [];
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const rangeStart = (() => { const d = new Date(startDate+'T12:00:00'); const dow=d.getDay(); d.setDate(d.getDate()+(dow===0?-6:1-dow)); return d.toISOString().slice(0,10); })();
  const rangeEndDate = new Date(rangeStart+'T12:00:00'); rangeEndDate.setDate(rangeEndDate.getDate()+weeks*7);
  const rangeEndStr = rangeEndDate.toISOString().slice(0,10);

  const activeUsers   = users.filter(u => {
    if (!isEmployed(u, rangeEndStr)) return false;
    if (!isEmployed(u, rangeStart) && !isEmployed(u, rangeEndStr)) return false;
    return isOnCallActive(u, rangeEndStr) || isOnCallActive(u, rangeStart);
  });
  const inactiveUsers = users.filter(u => isEmployed(u, rangeEndStr) && !activeUsers.includes(u));
  const visibleUsers  = showInactive ? [...activeUsers, ...inactiveUsers] : activeUsers;

  const generate = () => {
    if (!isManager) return;
    const onCallUsers = users.filter(u => isOnCallActive(u, startDate));
    const generated = sanitiseRota(generateRota(onCallUsers, startDate, weeks));
    setRota(prev => {
      const merged = { ...prev };
      users.forEach(u => {
        if (!isOnCallActive(u, startDate)) {
          merged[u.id] = {};
          Object.entries(prev[u.id] || {}).forEach(([date, shift]) => { if (isLocked(u.id, date)) merged[u.id][date] = shift; });
          return;
        }
        const existing = prev[u.id] || {};
        const genDates = generated[u.id] || {};
        merged[u.id] = { ...genDates };
        Object.entries(existing).forEach(([date, shift]) => { if (shift && shift !== 'off') merged[u.id][date] = shift; });
      });
      return merged;
    });
    setGenerated(true);
  };

  const setCell = useCallback((userId, date, shift) => {
    if (!canEdit) return;
    const user = users.find(u => u.id === userId);
    if (!isOnCallActive(user, date) && shift !== 'off') {
      alert(`${user?.name} is not on-call active on ${date}.`);
      return;
    }
    const dow = new Date(date + 'T12:00:00').getDay();
    const isWeekend = dow === 0 || dow === 6;
    setRota(prev => ({ ...prev, [userId]: { ...(prev[userId]||{}), [date]: (shift==='daily'&&isWeekend)?'weekend':shift } }));
  }, [canEdit, users, setRota]);

  const deleteCell = useCallback((userId, date) => {
    if (!canEdit) return;
    const next = JSON.parse(JSON.stringify(rota));
    if (next[userId]) delete next[userId][date];
    setRota(next);
  }, [canEdit, rota, setRota]);

  const openCellEditor = useCallback((userId, date, e) => {
    if (!canEdit) return;
    const user = users.find(u => u.id === userId);
    if (!isOnCallActive(user, date)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setEditCell({ userId, date, x: rect.left, y: rect.bottom });
  }, [canEdit, users]);

  const toggleBulk = (userId, date) => {
    if (!canEdit) return;
    const key = `${userId}::${date}`;
    setBulkSelected(prev => { const n = new Set(prev); n.has(key)?n.delete(key):n.add(key); return n; });
  };

  const applyBulk = () => {
    if (!isManager) return;
    const next = JSON.parse(JSON.stringify(rota));
    let blocked = [];
    bulkSelected.forEach(key => {
      const [uid, date] = key.split('::');
      const user = users.find(u => u.id === uid);
      if (!isOnCallActive(user, date) && bulkShift !== 'off') { blocked.push(user?.name); return; }
      next[uid] = { ...(next[uid]||{}), [date]: bulkShift };
    });
    setRota(next); setBulkSelected(new Set());
    if (blocked.length > 0) alert(`Skipped ${[...new Set(blocked)].join(', ')} — not on-call active.`);
  };

  const deleteBulk = () => {
    if (!isManager) return;
    const next = JSON.parse(JSON.stringify(rota));
    bulkSelected.forEach(key => { const [uid,date]=key.split('::'); if(next[uid]) delete next[uid][date]; });
    setRota(next); setBulkSelected(new Set());
  };

  // Select all cells in a date column
  const selectColumn = (dateStr) => {
    if (!canEdit) return;
    setBulkSelected(prev => {
      const n = new Set(prev);
      visibleUsers.forEach(u => { if (isOnCallActive(u, dateStr)) n.add(`${u.id}::${dateStr}`); });
      return n;
    });
  };

  // Select all cells in a user row
  const selectRow = (userId) => {
    if (!canEdit) return;
    setBulkSelected(prev => {
      const n = new Set(prev);
      weekStarts.forEach(ws => {
        Array.from({length:7},(_,d) => { const dt=new Date(ws); dt.setDate(ws.getDate()+d); return dt.toISOString().slice(0,10); })
          .forEach(ds => { if (isOnCallActive(users.find(u=>u.id===userId), ds)) n.add(`${userId}::${ds}`); });
      });
      return n;
    });
  };

  const checkConflicts = () => {
    const conflicts = [];
    holidays.filter(h => h.status==='approved').forEach(hol => {
      const d = new Date(hol.start);
      while (d <= new Date(hol.end)) {
        const ds = d.toISOString().slice(0,10);
        const shift = rota[hol.userId]?.[ds];
        if (shift && shift !== 'off') {
          const available = users.filter(u => u.id!==hol.userId && isOnCallActive(u,ds) && (!rota[u.id]?.[ds]||rota[u.id][ds]==='off'));
          conflicts.push({ userId:hol.userId, date:ds, shift, available });
        }
        d.setDate(d.getDate()+1);
      }
    });
    setSwapSuggestion(conflicts);
  };

  const applySwap = (conflict, coverId) => {
    const newRota = JSON.parse(JSON.stringify(rota));
    newRota[coverId] = { ...(newRota[coverId]||{}), [conflict.date]: conflict.shift };
    if (newRota[conflict.userId]) delete newRota[conflict.userId][conflict.date];
    setRota(newRota);
    setSwapSuggestion(prev => prev.filter(c => !(c.userId===conflict.userId && c.date===conflict.date)));
  };

  const approveSwap = (swapId) => {
    if (!isManager) return;
    const swap = (swapRequests||[]).find(s => s.id===swapId);
    if (!swap) return;
    const newRota = JSON.parse(JSON.stringify(rota));
    const reqShift = newRota[swap.requesterId]?.[swap.reqDate];
    const tgtShift = newRota[swap.targetId]?.[swap.tgtDate];
    if (reqShift) { newRota[swap.targetId]={...(newRota[swap.targetId]||{}),[swap.reqDate]:reqShift}; delete newRota[swap.requesterId][swap.reqDate]; }
    if (tgtShift) { newRota[swap.requesterId]={...(newRota[swap.requesterId]||{}),[swap.tgtDate]:tgtShift}; delete newRota[swap.targetId][swap.tgtDate]; }
    setRota(newRota);
    setSwapRequests(swapRequests.map(s => s.id===swapId ? {...s,status:'approved'} : s));
  };

  const pendingSwaps = (swapRequests||[]).filter(s => s.status==='pending');

  const weekStarts = Array.from({ length: weeks }, (_, w) => {
    const d = new Date(startDate+'T12:00:00');
    const dow = d.getDay();
    d.setDate(d.getDate()+(dow===0?-6:1-dow)+w*7);
    return d;
  });

  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div>
      {/* ── Floating Cell Editor ──────────────────────────────────────────── */}
      {editCell && canEdit && (
        <CellEditorPopover
          cell={editCell}
          users={users} rota={rota} holidays={holidays}
          UK_BANK_HOLIDAYS={UK_BANK_HOLIDAYS} upgrades={upgrades}
          onSetShift={(uid,date,shift) => { setCell(uid,date,shift); }}
          onDelete={deleteCell}
          onClose={() => setEditCell(null)}
          onToggleLock={toggleLock}
          isLockedFn={isLocked}
        />
      )}

      {/* ── Floating Bulk Action Bar ──────────────────────────────────────── */}
      {bulkSelected.size > 0 && canEdit && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          zIndex:1000, background:'#0d1424',
          border:'1px solid rgba(59,130,246,0.45)',
          borderRadius:14, padding:'12px 18px',
          display:'flex', gap:10, alignItems:'center',
          boxShadow:'0 24px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(59,130,246,0.15)',
          backdropFilter:'blur(16px)', flexWrap:'wrap',
        }}>
          <span style={{ fontSize:13, color:'#93c5fd', fontWeight:700, whiteSpace:'nowrap' }}>
            📋 {bulkSelected.size} cell{bulkSelected.size>1?'s':''} selected
          </span>
          <div style={{ width:1, height:24, background:'rgba(255,255,255,0.1)' }} />
          <select className="select" value={bulkShift} onChange={e=>setBulkShift(e.target.value)} style={{ width:165, fontSize:12 }}>
            <option value="off">— Off / Rest</option>
            <option value="daily">D  Daily Shift</option>
            <option value="evening">WD Weekday On-Call</option>
            <option value="weekend">WE Weekend On-Call</option>
            <option value="upgrade">UD Upgrade Day</option>
            <option value="holiday">H  Annual Leave</option>
            <option value="bankholiday">BH Bank Holiday</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={applyBulk}>✓ Apply to All</button>
          <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete All</button>
          <button className="btn btn-secondary btn-sm" onClick={()=>setBulkSelected(new Set())}>✕ Clear</button>
        </div>
      )}

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontWeight:700, letterSpacing:'-0.5px' }}>📅 Rota</h1>
          <div style={{ fontSize:12, color:'#64748b', marginTop:3 }}>
            {activeUsers.length} on-call engineer{activeUsers.length!==1?'s':''} active
            {inactiveUsers.length>0 && <span style={{ color:'#f59e0b', marginLeft:8 }}>· {inactiveUsers.length} not on-call yet</span>}
          </div>
        </div>
      </div>

      <ReadinessBanner users={users} startDate={startDate} weeks={weeks} />

      {/* ── Sticky Manager Toolbar ─────────────────────────────────────────── */}
      {isManager && (
        <div style={{
          position:'sticky', top:58, zIndex:40,
          background:'rgba(9,14,27,0.97)', backdropFilter:'blur(20px)',
          border:'1px solid rgba(255,255,255,0.08)',
          borderRadius:12, padding:'13px 16px', marginBottom:16,
          boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {/* Lock row */}
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:managerUnlocked?12:0, flexWrap:'wrap' }}>
            <button onClick={() => setManagerUnlocked(p=>!p)} style={{
              display:'flex', alignItems:'center', gap:7,
              background: managerUnlocked?'rgba(239,68,68,0.13)':'rgba(34,197,94,0.1)',
              border:`1.5px solid ${managerUnlocked?'#ef4444':'#22c55e'}`,
              borderRadius:9, padding:'7px 16px', cursor:'pointer',
              color: managerUnlocked?'#fca5a5':'#4ade80', fontSize:12, fontWeight:700,
            }}>
              {managerUnlocked ? '🔓 Editing enabled — click to lock' : '🔒 Locked — click to enable editing'}
            </button>
            {managerUnlocked && canEdit && (
              <span style={{ fontSize:11, color:'rgba(255,255,255,0.25)' }}>
                Click cell to edit · Shift+click rows/cols for bulk select
              </span>
            )}
            {!managerUnlocked && (
              <span style={{ fontSize:11, color:'rgba(34,197,94,0.5)' }}>Rota is read-only.</span>
            )}
          </div>

          {/* Controls row — only shown when unlocked */}
          {managerUnlocked && (
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
              <div>
                <div style={{ fontSize:10, color:'#475569', marginBottom:4, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>Start Date</div>
                <input className="input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={{ width:164 }} />
              </div>

              <div style={{ width:1, height:36, background:'rgba(255,255,255,0.07)', alignSelf:'flex-end', marginBottom:1 }} />

              {/* Generate */}
              <div style={{ display:'flex', flexDirection:'column', gap:3, alignSelf:'flex-end' }}>
                <button className="btn btn-primary btn-sm" onClick={generate} disabled={!canEdit} style={{ opacity:canEdit?1:0.4, fontSize:12, padding:'7px 14px' }}>
                  🔄 Generate Rota
                </button>
                <div style={{ fontSize:9, color:'rgba(255,255,255,0.2)', textAlign:'center' }}>Keeps manual entries</div>
              </div>

              {/* Force Regenerate */}
              <div style={{ display:'flex', flexDirection:'column', gap:3, alignSelf:'flex-end' }}>
                <button className="btn btn-secondary btn-sm" disabled={!canEdit} style={{ opacity:canEdit?1:0.4, fontSize:12, padding:'7px 14px' }} onClick={() => {
                  if (!canEdit) return;
                  if (window.confirm('⚠️ Regenerate from scratch? Locked cells preserved.')) {
                    const onCallUsers = users.filter(u => isOnCallActive(u, startDate));
                    const fresh = sanitiseRota(generateRota(onCallUsers, startDate, weeks));
                    setRota(prev => {
                      const merged = {};
                      users.forEach(u => {
                        merged[u.id] = {};
                        if (isOnCallActive(u, startDate)) Object.assign(merged[u.id], fresh[u.id]||{});
                        Object.entries(prev[u.id]||{}).forEach(([date,shift]) => { if (isLocked(u.id,date)) merged[u.id][date]=shift; });
                      });
                      return merged;
                    });
                    setGenerated(true);
                  }
                }}>↺ Force Regenerate</button>
                <div style={{ fontSize:9, color:'rgba(239,68,68,0.4)', textAlign:'center' }}>Overwrites all shifts</div>
              </div>

              <div style={{ width:1, height:36, background:'rgba(255,255,255,0.07)', alignSelf:'flex-end', marginBottom:1 }} />

              {/* Clear */}
              <button className="btn btn-danger btn-sm" disabled={!canEdit} style={{ opacity:canEdit?1:0.4, fontSize:12, padding:'7px 14px', alignSelf:'flex-end' }} onClick={() => {
                if (!canEdit) return;
                if (window.confirm('⚠️ Clear all rota entries? Locked cells preserved.')) {
                  setRota(prev => {
                    const next = {};
                    users.forEach(u => {
                      next[u.id]={};
                      Object.entries(prev[u.id]||{}).forEach(([date,shift]) => { if(isLocked(u.id,date)) next[u.id][date]=shift; });
                    });
                    return next;
                  });
                }
              }}>🗑 Clear Rota</button>

              {/* Check Conflicts */}
              <button className="btn btn-secondary btn-sm" onClick={checkConflicts} style={{ fontSize:12, padding:'7px 14px', alignSelf:'flex-end' }}>🔍 Conflicts</button>

              {/* Export */}
              <button style={{ padding:'7px 14px', background:'rgba(16,185,129,0.1)', border:'1px solid rgba(16,185,129,0.28)', borderRadius:8, color:'#34d399', fontSize:12, fontWeight:600, cursor:'pointer', alignSelf:'flex-end' }}
                onClick={() => activeUsers.forEach(u => { const ic=generateICalFeed(rota[u.id]||{},u.name); downloadIcal(ic,`rota-${u.id}.ics`); })}>
                📥 Export .ics
              </button>

              {/* Inactive toggle */}
              {inactiveUsers.length > 0 && (
                <button onClick={()=>setShowInactive(p=>!p)} style={{ padding:'7px 12px', background:showInactive?'rgba(245,158,11,0.1)':'rgba(255,255,255,0.04)', border:`1px solid ${showInactive?'rgba(245,158,11,0.3)':'rgba(255,255,255,0.08)'}`, borderRadius:8, color:showInactive?'#f59e0b':'#64748b', fontSize:11, fontWeight:600, cursor:'pointer', alignSelf:'flex-end' }}>
                  {showInactive ? `👁 Hide inactive` : `👁 +${inactiveUsers.length} inactive`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Conflict Suggestions ─────────────────────────────────────────── */}
      {swapSuggestion && swapSuggestion.length > 0 && isManager && (
        <div style={{ background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.28)', borderRadius:10, padding:'13px 16px', marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#f59e0b', marginBottom:10 }}>⚠ Holiday Conflicts — Suggested Cover</div>
          {swapSuggestion.map((c,i) => {
            const eng = users.find(u => u.id===c.userId);
            return (
              <div key={i} style={{ paddingBottom:10, borderBottom:'1px solid rgba(255,255,255,0.05)', marginBottom:10 }}>
                <div style={{ fontSize:12, color:'#94a3b8' }}>{eng?.name} is on holiday on {c.date} but has <strong>{SHIFT_COLORS[c.shift]?.label}</strong></div>
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  {c.available.length===0 && <span style={{ fontSize:11, color:'#64748b' }}>No engineers available</span>}
                  {c.available.map(a => <button key={a.id} className="btn btn-success btn-sm" onClick={()=>applySwap(c,a.id)}>✓ Assign {a.name.split(' ')[0]}</button>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {swapSuggestion && swapSuggestion.length===0 && (
        <div style={{ background:'rgba(34,197,94,0.07)', border:'1px solid rgba(34,197,94,0.18)', borderRadius:8, padding:'9px 14px', marginBottom:14, fontSize:12, color:'#4ade80' }}>✅ No holiday conflicts found.</div>
      )}

      {/* ── Pending Swap Requests ────────────────────────────────────────── */}
      {isManager && pendingSwaps.length > 0 && (
        <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:'13px 16px', marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>🔁 Pending Shift Swap Requests</div>
          {pendingSwaps.map(s => {
            const req=users.find(u=>u.id===s.requesterId); const tgt=users.find(u=>u.id===s.targetId);
            return (
              <div key={s.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', flexWrap:'wrap', gap:8 }}>
                <div>
                  <div style={{ fontSize:12 }}>{req?.name} wants to swap {s.reqDate} with {tgt?.name}'s {s.tgtDate}</div>
                  {s.reason && <div style={{ fontSize:11, color:'#64748b' }}>Reason: {s.reason}</div>}
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <button className="btn btn-success btn-sm" onClick={()=>approveSwap(s.id)}>✓ Approve</button>
                  <button className="btn btn-danger btn-sm" onClick={()=>setSwapRequests(swapRequests.map(x=>x.id===s.id?{...x,status:'rejected'}:x))}>✗ Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ShiftLegend />

      {/* ── Unified filter + view bar ──────────────────────────────────────── */}
      <div style={{ display:'flex', gap:8, marginBottom:14, alignItems:'center', flexWrap:'wrap',
        padding:'10px 14px', background:'var(--bg-card)', border:'1px solid var(--border)',
        borderRadius:10 }}>
        {/* View mode */}
        <span style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>View:</span>
        {[['compact','📋 Compact'],['hours','🕐 Timeline'],['calendar','📅 Calendar']].map(([m,l]) => (
          <button key={m} className={`btn btn-sm ${viewMode===m?'btn-primary':'btn-secondary'}`}
            onClick={()=>setViewMode(m)}>{l}</button>
        ))}
        {canEdit && viewMode === 'compact' && (
          <button className={`btn btn-sm ${paintMode?'btn-primary':'btn-secondary'}`}
            onClick={() => setPaintMode(v => !v)}
            title="Pick a shift, then click or drag across cells to apply it">
            🖌 {paintMode ? 'Paint on' : 'Paint'}
          </button>
        )}
        {viewMode==='calendar' && (
          <div style={{ display:'flex', gap:6, alignItems:'center', marginLeft:4 }}>
            <button className="btn btn-secondary btn-sm" onClick={()=>setCalendarDate(d=>{ const n=new Date(d); n.setMonth(n.getMonth()-1); return n; })}>◀</button>
            <span style={{ fontSize:13, fontWeight:600, color:'#e2e8f0', minWidth:120, textAlign:'center' }}>
              {calendarDate.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={()=>setCalendarDate(d=>{ const n=new Date(d); n.setMonth(n.getMonth()+1); return n; })}>▶</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setCalendarDate(new Date())}>Today</button>
          </div>
        )}

        <div style={{ width:1, height:22, background:'rgba(255,255,255,0.1)' }} />

        {/* Date navigation */}
        <button className="btn btn-secondary btn-sm" onClick={()=>setStartDate(d=>{
          const dt=new Date(d+'T12:00:00'); dt.setDate(dt.getDate()-7*weeks); return dt.toISOString().slice(0,10);
        })}>◀◀ {weeks}w</button>
        <button className="btn btn-secondary btn-sm" onClick={()=>setStartDate(d=>{
          const dt=new Date(d+'T12:00:00'); dt.setDate(dt.getDate()-7); return dt.toISOString().slice(0,10);
        })}>◀ Week</button>
        <button className="btn btn-secondary btn-sm" onClick={()=>{
          const d=new Date(); const dow=d.getDay()||7;
          d.setDate(d.getDate()-(dow-1));
          setStartDate(d.toISOString().slice(0,10));
        }} style={{ color:'var(--accent)', borderColor:'var(--accent)' }}>Today</button>
        <button className="btn btn-secondary btn-sm" onClick={()=>setStartDate(d=>{
          const dt=new Date(d+'T12:00:00'); dt.setDate(dt.getDate()+7); return dt.toISOString().slice(0,10);
        })}>Week ▶</button>
        <button className="btn btn-secondary btn-sm" onClick={()=>setStartDate(d=>{
          const dt=new Date(d+'T12:00:00'); dt.setDate(dt.getDate()+7*weeks); return dt.toISOString().slice(0,10);
        })}>{weeks}w ▶▶</button>

        <div style={{ width:1, height:22, background:'rgba(255,255,255,0.1)' }} />

        {/* Showing period — how far ahead the rota displays. Available to
            EVERYONE (not gated behind manager edit-unlock) since choosing
            how far ahead to look is a viewing preference, not an edit. */}
        <span style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>Showing:</span>
        <select className="select" value={weeks} onChange={e=>setWeeks(+e.target.value)}
          style={{ fontSize:11, padding:'4px 8px', width:120 }}>
          <option value={8}>8 weeks</option>
          <option value={16}>16 weeks</option>
          <option value={13}>3 months</option>
          <option value={26}>6 months</option>
          <option value={52}>1 year</option>
        </select>

        <div style={{ width:1, height:22, background:'rgba(255,255,255,0.1)' }} />

        {/* Engineer filter */}
        <select className="select" value={filterUser} onChange={e=>setFilterUser(e.target.value)}
          style={{ fontSize:11, padding:'4px 8px', width:140 }}>
          <option value="all">All Engineers</option>
          {[...activeUsers, ...inactiveUsers].map(u=>(
            <option key={u.id} value={u.id}>{u.name.split(' ')[0]} ({u.id})</option>
          ))}
        </select>

        {/* Shift type filter */}
        <select className="select" value={filterShift} onChange={e=>setFilterShift(e.target.value)}
          style={{ fontSize:11, padding:'4px 8px', width:140 }}>
          <option value="all">All Shifts</option>
          <option value="daily">Daily Shift</option>
          <option value="evening">Weekday On-Call</option>
          <option value="weekend">Weekend On-Call</option>
          <option value="upgrade">Upgrade Day</option>
          <option value="holiday">Holiday</option>
          <option value="bankholiday">Bank Holiday</option>
          <option value="off">Off / Empty</option>
        </select>

        {(filterUser !== 'all' || filterShift !== 'all') && (
          <button className="btn btn-secondary btn-sm" onClick={()=>{setFilterUser('all');setFilterShift('all');}}
            style={{ color:'#fca5a5' }}>✕ Clear filters</button>
        )}

        {canEdit && viewMode !== 'calendar' && (
          <span style={{ fontSize:10, color:'rgba(255,255,255,0.2)', marginLeft:4 }}>
            {paintMode
              ? 'Click or drag to paint · Right-click for detailed editor · Ctrl+click to bulk select'
              : 'Click cell to edit · Ctrl+click to bulk select · Try 🖌 Paint for faster multi-cell entry'}
          </span>
        )}
      </div>

      {/* ── Paint brush bar — only shown while Paint mode is on ─────────────── */}
      {canEdit && viewMode === 'compact' && paintMode && (
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:14,
          padding:'8px 14px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10 }}>
          <span style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>Brush:</span>
          {PAINT_BRUSHES.map(b => {
            const active = paintBrush === b.id;
            return (
              <button key={b.id} onClick={() => setPaintBrush(b.id)}
                style={{
                  display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:7,
                  fontSize:11, fontWeight:600, cursor:'pointer',
                  background: active ? `${b.bg}cc` : `${b.bg}28`,
                  border: `1.5px solid ${active ? b.bg : `${b.bg}55`}`,
                  color: active ? b.text : 'rgba(255,255,255,0.5)',
                }}>
                <span style={{ width:16, height:16, borderRadius:4, background:b.bg, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:8, fontWeight:900, color:'#fff' }}>
                  {SHIFT_ABBR[b.id] || '—'}
                </span>
                {b.label}
              </button>
            );
          })}
          <div style={{ width:1, height:20, background:'rgba(255,255,255,0.1)' }} />
          <button className="btn btn-secondary btn-sm" onClick={undoPaint} disabled={rotaHistory.length===0}
            style={{ opacity: rotaHistory.length===0 ? 0.4 : 1 }}
            title="Undo last paint stroke">
            ↩ Undo{rotaHistory.length>0 ? ` (${rotaHistory.length})` : ''}
          </button>
          <span style={{ fontSize:10, color:'rgba(255,255,255,0.25)' }}>Click or drag cells to apply · Right-click a cell for the detailed editor</span>
        </div>
      )}

      {/* ── Calendar View ──────────────────────────────────────────────────── */}
      {viewMode === 'calendar' && (() => {
        const today = new Date().toISOString().slice(0,10);
        const year  = calendarDate.getFullYear();
        const month = calendarDate.getMonth();
        // Build days grid: pad to start on Monday
        const firstDay = new Date(year, month, 1);
        const startDow = firstDay.getDay() || 7; // 1=Mon … 7=Sun
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const prevMonthDays = startDow - 1;
        const totalCells = Math.ceil((prevMonthDays + daysInMonth) / 7) * 7;
        const DAY_HDR = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const MON_LBL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        const cells = Array.from({length: totalCells}, (_, i) => {
          const d = new Date(year, month, 1 - prevMonthDays + i);
          return d;
        });

        return (
          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            {/* Calendar header */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', background:'rgba(255,255,255,0.04)', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
              {DAY_HDR.map((d,i) => (
                <div key={d} style={{ textAlign:'center', padding:'10px 4px', fontSize:11, fontWeight:700, color: i>=5 ? 'rgba(255,255,255,0.35)' : '#94a3b8', letterSpacing:'0.05em' }}>{d}</div>
              ))}
            </div>
            {/* Weeks */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
              {cells.map((d, i) => {
                const ds     = d.toISOString().slice(0,10);
                const inMonth= d.getMonth() === month;
                const isToday= ds === today;
                const dow    = d.getDay();
                const isWkd  = dow === 0 || dow === 6;
                const bh     = (UK_BANK_HOLIDAYS||[]).find(b=>b.date===ds);
                // Show week number on first cell of each row
                const wNum   = i % 7 === 0 ? isoWeek(d) : null;

                // Which engineers have shifts on this day?
                const shiftsToday = visibleUsers.map(u => {
                  if (!isOnCallActive(u, ds)) return null;
                  const hol = holidays.find(h=>h.userId===u.id && ds>=h.start && ds<=h.end);
                  const shift = hol ? 'holiday' : (rota[u.id]?.[ds] || 'off');
                  if (shift === 'off') return null;
                  return { user: u, shift };
                }).filter(Boolean);

                return (
                  <div key={ds} style={{
                    minHeight: 90,
                    padding: '6px 6px 4px',
                    borderRight: (i+1)%7!==0 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    background: isToday ? 'rgba(0,194,255,0.06)' : isWkd ? 'rgba(255,255,255,0.015)' : undefined,
                    opacity: inMonth ? 1 : 0.3,
                    position: 'relative',
                  }}>
                    {/* Week number badge */}
                    {wNum && (
                      <div style={{ position:'absolute', top:4, left:3, fontSize:8, color:'#334155', fontFamily:'DM Mono', fontWeight:700, letterSpacing:'0.05em' }}>
                        W{wNum}
                      </div>
                    )}
                    {/* Day number */}
                    <div style={{ textAlign:'right', fontSize:12, fontWeight: isToday?800:500,
                      color: isToday?'var(--accent)': bh?'#fca5a5': isWkd?'rgba(255,255,255,0.3)':'#94a3b8',
                      marginBottom:4, lineHeight:1 }}>
                      {d.getDate()}
                      {bh && <div style={{ fontSize:8, color:'#fca5a5', marginTop:1 }}>{bh.title?.slice(0,10)||'BH'}</div>}
                    </div>
                    {/* Shift badges */}
                    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                      {shiftsToday.slice(0,4).map(({user:u, shift}) => {
                        const col = SHIFT_COLORS[shift] || {};
                        return (
                          <div key={u.id} style={{
                            display:'flex', alignItems:'center', gap:3,
                            background: col.bg ? col.bg+'44' : 'transparent',
                            border: `1px solid ${col.bg ? col.bg+'88' : 'transparent'}`,
                            borderRadius:4, padding:'2px 4px',
                            cursor: canEdit && isOnCallActive(u, ds) ? 'pointer' : 'default',
                          }}
                          onClick={e => canEdit && isOnCallActive(u,ds) && openCellEditor(u.id, ds, e)}>
                            <div style={{ width:10, height:10, borderRadius:'50%', background:u.color||'#1d4ed8', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:6, fontWeight:800, color:'#fff' }}>
                              {u.name?.charAt(0)}
                            </div>
                            <span style={{ fontSize:8, fontWeight:700, color:col.text||'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:52 }}>
                              {SHIFT_ABBR[shift]||shift}
                            </span>
                          </div>
                        );
                      })}
                      {shiftsToday.length > 4 && (
                        <div style={{ fontSize:8, color:'#64748b', paddingLeft:2 }}>+{shiftsToday.length-4} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {viewMode !== 'calendar' && weekStarts.map((ws, wi) => {
        const wdates = Array.from({length:8},(_,d) => { const dt=new Date(ws); dt.setDate(ws.getDate()+d); return dt; });
        const weekNum     = isoWeek(ws);
        const weekDateStr = ws.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});

        // Apply engineer + shift filters
        const filteredUsers = visibleUsers.filter(u => {
          if (filterUser !== 'all' && u.id !== filterUser) return false;
          if (filterShift !== 'all') {
            // Show row only if engineer has that shift on at least one day this week
            const hasShift = wdates.slice(0,7).some(d => {
              const ds = d.toISOString().slice(0,10);
              const hol = holidays.find(h=>h.userId===u.id && ds>=h.start && ds<=h.end);
              const shift = hol ? 'holiday' : (rota[u.id]?.[ds] || 'off');
              return shift === filterShift;
            });
            if (!hasShift) return false;
          }
          return true;
        });
        if (filteredUsers.length === 0) return null;
        const hourCols = Array.from({length:24},(_,h)=>h);

        const getHourActive = (userId, dateStr, hour) => {
          const user = users.find(u=>u.id===userId);
          if (!isOnCallActive(user, dateStr)) return null;
          const hol  = holidays.find(h=>h.userId===userId && dateStr>=h.start && dateStr<=h.end);
          const bh   = (UK_BANK_HOLIDAYS||[]).find(b=>b.date===dateStr);
          const rotaEntry = rota[userId]?.[dateStr] || 'off';
          const thisShift = hol ? 'holiday' : bh ? (rotaEntry !== 'off' ? rotaEntry : 'bankholiday') : rotaEntry;
          if (hour>=7) {
            if (thisShift==='daily')   return hour<19?'daily':null;
            if (thisShift==='evening') return hour>=19?'evening':null;
            if (thisShift==='weekend') return hour>=19?'weekend':null;
            if (['upgrade','holiday','bankholiday'].includes(thisShift)) return thisShift;
            return null;
          }
          for (let back = 1; back <= 3; back++) {
            const prev = new Date(dateStr + 'T12:00:00'); prev.setDate(prev.getDate() - back);
            const prevDs = prev.toISOString().slice(0,10);
            const pHol = holidays.find(h=>h.userId===userId && prevDs>=h.start && prevDs<=h.end);
            if (pHol) continue;
            const prevEntry = rota[userId]?.[prevDs] || 'off';
            if (prevEntry === 'evening') return back === 1 ? 'evening' : null;
            if (prevEntry === 'weekend') return 'weekend';
            if (prevEntry !== 'off') break;
          }
          return null;
        };

        // ── Timeline View ─────────────────────────────────────────────────
        if (viewMode==='hours') {
          return (
            <div key={wi} className="card mb-12">
              <div className="card-title" style={{ fontSize:12, color:'#64748b', marginBottom:10 }}>Week of {weekDateStr} <span style={{ color:'#475569', fontFamily:'DM Mono' }}>W{weekNum}</span></div>
              <div style={{ display:'flex', marginLeft:100, marginBottom:2 }}>
                {hourCols.map(h=>(
                  <div key={h} style={{ flex:1, textAlign:'center', fontSize:7, color:'rgba(255,255,255,0.3)', fontFamily:'DM Mono', borderRight:h<23?'1px solid rgba(255,255,255,0.04)':'none' }}>
                    {h%3===0?String(h).padStart(2,'0'):''}
                  </div>
                ))}
              </div>
              {wdates.slice(0,7).map((d,di) => {
                const ds=d.toISOString().slice(0,10);
                const bh=(UK_BANK_HOLIDAYS||[]).find(b=>b.date===ds);
                const dow=d.getDay(); const isWkd=dow===0||dow===6;
                return (
                  <div key={ds} style={{ marginBottom:8 }}>
                    <div style={{ display:'flex', alignItems:'center', marginBottom:3 }}>
                      <div style={{ width:100, flexShrink:0, paddingRight:8 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:bh?'#fca5a5':isWkd?'rgba(255,255,255,0.5)':'#94a3b8' }}>
                          {DAY_NAMES[dow]} {d.getDate()} {MON_SHORT[d.getMonth()]}
                        </span>
                        {bh && <span style={{ fontSize:8, color:'#fca5a5', display:'block' }}>{bh.title||'Bank Holiday'}</span>}
                      </div>
                      <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.06)' }} />
                    </div>
                    {filteredUsers.map(u => {
                      const hol   = holidays.find(h=>h.userId===u.id && ds>=h.start && ds<=h.end);
                      const active= isOnCallActive(u, ds);
                      const status= getOnCallStatus(u, ds);
                      const shift = hol?'holiday':bh?'bankholiday':(rota[u.id]?.[ds]||'off');
                      const col   = active?SHIFT_COLORS[shift]||{}:SHIFT_COLORS.inactive;
                      return (
                        <div key={u.id} style={{ display:'flex', alignItems:'center', marginBottom:2 }}>
                          <div style={{ width:100, display:'flex', alignItems:'center', gap:5, flexShrink:0, paddingRight:8 }}>
                            <Avatar user={u} size={16} />
                            <span style={{ fontSize:10, color:active?'#94a3b8':'#334155', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:66 }}>{u.name.split(' ')[0]}</span>
                          </div>
                          <div style={{ flex:1, height:24, borderRadius:4, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)', position:'relative', display:'flex', cursor:canEdit&&active?'pointer':'default', overflow:'hidden' }}
                            onClick={e=>canEdit&&active&&openCellEditor(u.id,ds,e)}>
                            {!active ? (
                              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                <span style={{ fontSize:9, color:'#334155', fontStyle:'italic' }}>{status?.label||'Inactive'}</span>
                              </div>
                            ) : (
                              <>
                                {hourCols.map(h => {
                                  const as=getHourActive(u.id,ds,h);
                                  const ac=as?(SHIFT_COLORS[as]||col):null;
                                  return <div key={h} title={`${String(h).padStart(2,'0')}:00${as?' — '+(SHIFT_COLORS[as]?.label||as):''}`}
                                    style={{ flex:1, background:ac?(ac.bg||'#1e40af')+'dd':'transparent', borderRight:h<23?'1px solid rgba(0,0,0,0.12)':'none' }} />;
                                })}
                                {shift!=='off'&&<div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none', gap:4 }}>
                                  <span style={{ fontSize:9, fontWeight:700, color:col.text||'#fff', textShadow:'0 1px 3px rgba(0,0,0,0.8)' }}>
                                    {hol ? 'H — Holiday' : bh ? 'BH — Bank Hol' : SHIFT_ABBR[shift] || shift}
                                  </span>
                                </div>}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div style={{ display:'flex', marginLeft:100, marginTop:4 }}>
                {hourCols.map(h=><div key={h} style={{ flex:1, textAlign:'center', fontSize:7, color:'rgba(255,255,255,0.2)', fontFamily:'DM Mono' }}>{h%6===0?String(h).padStart(2,'0'):''}</div>)}
              </div>
              {canEdit&&<div style={{ fontSize:10, color:'#475569', marginTop:8 }}>💡 Click any row to open the shift editor</div>}
            </div>
          );
        }

        // ── Compact View ─────────────────────────────────────────────────
        return (
          <div key={wi} className="card mb-12" style={{ padding:0, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px 8px' }}>
              <div className="card-title" style={{ fontSize:12, color:'#64748b' }}>Week of {weekDateStr} <span style={{ color:'#475569', fontFamily:'DM Mono' }}>W{weekNum}</span></div>
            </div>
            <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'separate', borderSpacing:0, tableLayout:'fixed' }}>
              <colgroup>
                <col style={{ width:140 }} />
                {wdates.slice(0,7).map((_,i) => <col key={i} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ minWidth:130, paddingBottom:6 }}>Engineer</th>
                  {wdates.slice(0,7).map((d,di) => {
                    const ds=d.toISOString().slice(0,10);
                    const bh=(UK_BANK_HOLIDAYS||[]).find(b=>b.date===ds);
                    const dow=d.getDay(); const isWkd=dow===0||dow===6;
                    return (
                      <th key={di}
                        onClick={()=>canEdit&&selectColumn(ds)}
                        style={{ textAlign:'center', fontSize:10, paddingBottom:6, color:bh?'#fca5a5':isWkd?'rgba(255,255,255,0.35)':'#94a3b8', background:isWkd?'rgba(255,255,255,0.025)':undefined, borderBottom:'1px solid rgba(255,255,255,0.08)', cursor:canEdit?'pointer':'default' }}
                        title={canEdit?'Click to select entire column':undefined}>
                        <div style={{ fontWeight:800, fontSize:11 }}>{DAY_NAMES[dow]}</div>
                        <div style={{ fontFamily:'DM Mono', fontSize:10, opacity:0.8 }}>{d.getDate()} {MON_SHORT[d.getMonth()]}</div>
                        <div style={{ fontSize:8, color:'rgba(255,255,255,0.2)', fontFamily:'DM Mono', marginTop:1 }}>
                          {bh?bh.title?.slice(0,10)||'Bank Hol':isWkd?'19:00–07:00':'09:00 / 19:00→'}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.id}>
                    <td style={{ paddingRight:8, paddingTop:3, paddingBottom:3 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <Avatar user={u} size={24} />
                        <div>
                          <span style={{ fontSize:12, cursor:canEdit?'pointer':'default', color:canEdit?'#94a3b8':undefined }}
                            onClick={()=>canEdit&&selectRow(u.id)}
                            title={canEdit?'Click to select all cells this week':''}>{u.name.split(' ')[0]}</span>
                          {!activeUsers.includes(u) && (
                            <div style={{ fontSize:9, color:'#f59e0b', fontFamily:'DM Mono' }}>⏳ not on-call</div>
                          )}
                        </div>
                      </div>
                    </td>
                    {wdates.slice(0,7).map((d,di) => {
                      const ds=d.toISOString().slice(0,10);
                      const hol  = holidays.find(h=>h.userId===u.id && ds>=h.start && ds<=h.end);
                      const bh   = (UK_BANK_HOLIDAYS||[]).find(b=>b.date===ds);
                      const upg  = (upgrades||[]).find(up=>up.date===ds && up.attendees?.includes(u.id));
                      const active=isOnCallActive(u,ds);
                      const status=getOnCallStatus(u,ds);
                      const rotaShift = rota[u.id]?.[ds] || 'off';
                      const s    = hol ? 'holiday' : rotaShift;
                      const col  = active ? (SHIFT_COLORS[s]||{}) : SHIFT_COLORS.inactive;
                      const bhOverlay = bh && rotaShift !== 'off' && !hol;
                      const displayCol = (bh && rotaShift === 'off' && !hol) ? SHIFT_COLORS.bankholiday : col;
                      const key  = `${u.id}::${ds}`;
                      const isBulkSel=bulkSelected.has(key);
                      const dow=d.getDay(); const isWkd=dow===0||dow===6;
                      const isOvernight=(s==='evening'||s==='weekend');
                      const prevDate=new Date(d); prevDate.setDate(d.getDate()-1);
                      const prevDs=prevDate.toISOString().slice(0,10);
                      const prevHol=holidays.find(h=>h.userId===u.id && prevDs>=h.start && prevDs<=h.end);
                      const prevRotaShift = rota[u.id]?.[prevDs] || 'off';
                      const prevS = prevHol ? 'holiday' : prevRotaShift;
                      const currentHasNoShift = (s==='off' || (bh && rotaShift==='off') || hol);
                      const hasCarryOver = (prevS==='evening'||prevS==='weekend') && currentHasNoShift && isOnCallActive(u,prevDs);
                      const prevCol=SHIFT_COLORS[prevS]||{};
                      const isEditTarget = editCell?.userId===u.id && editCell?.date===ds;

                      return (
                        <td key={ds} style={{ textAlign:'center', padding:'3px 2px', background:isWkd?'rgba(255,255,255,0.02)':undefined, verticalAlign:'top' }}>
                          {!active && !hol && !bh && (
                            <div style={{ background:'rgba(30,41,59,0.6)', borderRadius:5, padding:'4px 4px', fontSize:9, color:'#334155', fontStyle:'italic', minWidth:30 }}>
                              {status?.type==='terminated'?'left':status?.type==='not_started'?'tbc':'—'}
                            </div>
                          )}
                          {(active || hol || bh) && (
                            <>
                              <div
                                onMouseDown={e => {
                                  if (!canEdit || !active) return;
                                  handlePaintDown(u.id, ds, e);
                                }}
                                onMouseEnter={() => { if (canEdit && active) handlePaintEnter(u.id, ds); }}
                                onClick={e => {
                                  if (!canEdit || !active) return;
                                  if (paintMode) {
                                    if (e.ctrlKey || e.metaKey || e.shiftKey) toggleBulk(u.id, ds);
                                    return; // painting is already applied on mouseDown/mouseEnter above
                                  }
                                  if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleBulk(u.id, ds); }
                                  else { setEditCell(null); openCellEditor(u.id, ds, e); }
                                }}
                                onContextMenu={e => {
                                  if (!canEdit || !active) return;
                                  e.preventDefault();
                                  setEditCell(null); openCellEditor(u.id, ds, e);
                                }}
                                title={canEdit&&active ? `${displayCol.label||s}${bhOverlay?' + Bank Holiday':''}${upg&&!hol?' + Upgrade Day':''}${isLocked(u.id,ds)?' 🔒 Locked':''} — ${paintMode ? 'click/drag to paint, right-click for detailed editor' : 'click to edit, right-click for detailed editor, Ctrl+click to bulk select'}` : `${displayCol.label||s}`}
                                style={{
                                  background: isBulkSel ? 'rgba(59,130,246,0.25)' : displayCol.bg ? displayCol.bg+'55' : 'transparent',
                                  color: displayCol.text||'#475569',
                                  border: isBulkSel ? '2px solid #3b82f6' : isEditTarget ? `2px solid #94a3b8` : displayCol.bg ? `1px solid ${displayCol.bg}88` : '1px solid transparent',
                                  borderRadius:6, padding:'4px 4px', fontSize:9, fontWeight:800,
                                  cursor:canEdit&&active?'pointer':'default', userSelect:'none',
                                  lineHeight:1.3, minWidth:30, position:'relative',
                                  transition:'border-color 0.1s, background 0.1s',
                                  boxShadow: isEditTarget ? '0 0 0 3px rgba(148,163,184,0.2)' : 'none',
                                }}>
                                {hol ? 'H' : (SHIFT_ABBR[s]||'—')}
                                {bhOverlay && (
                                  <span style={{ position:'absolute', top:-4, right:upg&&!hol?12:-4, background:'#7f1d1d', color:'#fca5a5', fontSize:7, fontWeight:800, padding:'1px 3px', borderRadius:3, lineHeight:1.2, border:'1px solid rgba(0,0,0,0.3)' }}>BH</span>
                                )}
                                {upg && !hol && (
                                  <span style={{ position:'absolute', top:-4, right:-4, background:'#991b1b', color:'#fecaca', fontSize:7, fontWeight:800, padding:'1px 3px', borderRadius:3, lineHeight:1.2, border:'1px solid rgba(0,0,0,0.3)' }}>UD</span>
                                )}
                                {isLocked(u.id,ds) && (
                                  <span style={{ position:'absolute', bottom:-3, right:-3, fontSize:7, lineHeight:1 }}>🔒</span>
                                )}
                                {isOvernight&&<div style={{ fontSize:7, color:displayCol.text, opacity:0.8, marginTop:1 }}>→07:00</div>}
                              </div>
                              {hasCarryOver&&(
                                <div style={{ marginTop:2, background:(prevCol.bg||'#166534')+'33', color:prevCol.text||'#bbf7d0', border:`1px solid ${prevCol.bg||'#166534'}66`, borderRadius:6, padding:'2px 4px', fontSize:8, fontWeight:600, lineHeight:1.3 }}>
                                  ←07:00<div style={{ fontSize:7, opacity:0.8 }}>cont.</div>
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        );
      })}

      {canEdit && bulkSelected.size === 0 && activeTab === 'rota' && (
        <div style={{ fontSize:11, color:'#334155', marginTop:8, textAlign:'center', padding:'8px 0', letterSpacing:'0.02em' }}>
          💡 <strong style={{ color:'#475569' }}>Click</strong> cell to edit · <strong style={{ color:'#475569' }}>Ctrl+click</strong> bulk select · <strong style={{ color:'#475569' }}>Click column header</strong> to select day · <strong style={{ color:'#475569' }}>Click name</strong> to select row
        </div>
      )}
    </div>
  );
}

// ── Rota Analytics ────────────────────────────────────────────────────────────
function RotaAnalytics({ users, rota, holidays, UK_BANK_HOLIDAYS, upgrades }) {
  const today = (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const [report, setReport] = React.useState('heatmap');
  const [start, setStart]   = React.useState(() => { const d=new Date(); d.setMonth(d.getMonth()-3); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  const [end, setEnd]       = React.useState(today);
  const [selUser, setSelUser] = React.useState('all');

  const activeUsers = users.filter(u => !u.termination_date || u.termination_date >= start);

  // ── Build date range ───────────────────────────────────────────────────────
  const allDates = React.useMemo(() => {
    const dates = []; const d = new Date(start+'T12:00:00');
    const e = new Date(end+'T12:00:00');
    while (d <= e) {
      dates.push(d.toISOString().slice(0,10));
      d.setDate(d.getDate()+1);
    }
    return dates;
  }, [start, end]);

  // ── Per-user, per-date shift ───────────────────────────────────────────────
  const getShift = (uid, ds) => {
    const hol = (holidays||[]).find(h=>h.userId===uid && ds>=h.start && ds<=h.end);
    if (hol) return 'holiday';
    const bh = (UK_BANK_HOLIDAYS||[]).find(b=>b.date===ds);
    const r  = rota[uid]?.[ds] || 'off';
    if (bh && r !== 'off') return r;
    if (bh) return 'bankholiday';
    return r;
  };

  // ── Aggregated stats ──────────────────────────────────────────────────────
  const SHIFT_HRS = { daily:9, evening:12, weekend:12, upgrade:8, holiday:0, bankholiday:22, off:0 };
  const stats = React.useMemo(() => {
    return activeUsers.map(u => {
      const counts = {}; const hrs = {};
      const weeklyHrs = {};
      allDates.forEach(ds => {
        const s = getShift(u.id, ds);
        counts[s] = (counts[s]||0)+1;
        hrs[s]    = (hrs[s]||0)+(SHIFT_HRS[s]||0);
        const wk  = ds.slice(0,8)+'01'; // rough week bucket
        weeklyHrs[ds.slice(0,7)] = (weeklyHrs[ds.slice(0,7)]||0)+(SHIFT_HRS[s]||0);
      });
      const totalShifts = allDates.filter(ds=>getShift(u.id,ds)!=='off').length;
      const totalHrs    = Object.values(hrs).reduce((a,b)=>a+b,0);
      return { user:u, counts, hrs, totalShifts, totalHrs, weeklyHrs };
    });
  }, [activeUsers, allDates]); // eslint-disable-line

  // ── Colour map ─────────────────────────────────────────────────────────────
  const C = { daily:'#1e40af', evening:'#166534', weekend:'#854d0e', upgrade:'#991b1b', holiday:'#92400e', bankholiday:'#7f1d1d', off:'transparent' };
  const TXT = { daily:'#bfdbfe', evening:'#bbf7d0', weekend:'#fef08a', upgrade:'#fecaca', holiday:'#fde68a', bankholiday:'#fca5a5', off:'#334155' };

  const REPORTS = [
    { id:'heatmap',      label:'🗓 Coverage Heatmap' },
    { id:'distribution', label:'📊 Shift Distribution' },
    { id:'workload',     label:'⚡ Engineer Workload' },
    { id:'trends',       label:'📈 Weekly Trends' },
    { id:'gaps',         label:'⚠️ Coverage Gaps' },
    { id:'summary',      label:'📋 Summary Table' },
  ];

  return (
    <div>
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end', padding:'12px 16px',
        background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, marginBottom:16 }}>
        <div>
          <div style={{ fontSize:10, color:'#475569', marginBottom:4, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>From</div>
          <input className="input" type="date" value={start} onChange={e=>setStart(e.target.value)} style={{ width:148 }}/>
        </div>
        <div>
          <div style={{ fontSize:10, color:'#475569', marginBottom:4, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>To</div>
          <input className="input" type="date" value={end} onChange={e=>setEnd(e.target.value)} style={{ width:148 }}/>
        </div>
        {/* Quick ranges */}
        <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
          <div style={{ fontSize:10, color:'#475569', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Quick Range</div>
          <div style={{ display:'flex', gap:4 }}>
            {[['Last 30d',30],['Last 90d',90],['Last 6mo',182],['Last year',365]].map(([lbl,days])=>(
              <button key={lbl} className="btn btn-secondary btn-sm" onClick={()=>{
                const e=new Date(); const s=new Date(); s.setDate(s.getDate()-days);
                const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                setStart(fmt(s)); setEnd(fmt(e));
              }}>{lbl}</button>
            ))}
          </div>
        </div>
        <div style={{ width:1, height:40, background:'rgba(255,255,255,0.08)' }}/>
        <div>
          <div style={{ fontSize:10, color:'#475569', marginBottom:4, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Engineer</div>
          <select className="select" value={selUser} onChange={e=>setSelUser(e.target.value)} style={{ width:160 }}>
            <option value="all">All Engineers</option>
            {activeUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div style={{ marginLeft:'auto', fontSize:11, color:'#475569', fontFamily:'DM Mono' }}>
          {allDates.length} days · {activeUsers.length} engineers
        </div>
      </div>

      {/* ── Report tabs ───────────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:4, marginBottom:16, flexWrap:'wrap', borderBottom:'1px solid var(--border)', paddingBottom:8 }}>
        {REPORTS.map(r=>(
          <button key={r.id} onClick={()=>setReport(r.id)}
            style={{ padding:'6px 14px', borderRadius:8, border:`1px solid ${report===r.id?'var(--accent)':'var(--border)'}`,
              background:report===r.id?'rgba(0,194,255,0.1)':'transparent',
              color:report===r.id?'var(--accent)':'#64748b', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Coverage Heatmap ─────────────────────────────────────────────── */}
      {report==='heatmap' && (() => {
        const usersToShow = selUser==='all' ? activeUsers : activeUsers.filter(u=>u.id===selUser);
        // Show max 90 days to keep it readable
        const showDates = allDates.length > 90 ? allDates.slice(-90) : allDates;
        const cellW = Math.max(12, Math.min(28, Math.floor((window.innerWidth - 280) / showDates.length)));
        return (
          <div className="card" style={{ overflowX:'auto' }}>
            <div style={{ marginBottom:10, fontSize:13, fontWeight:700 }}>Coverage Heatmap
              <span style={{ fontSize:11, color:'#475569', fontWeight:400, marginLeft:8 }}>
                {allDates.length > 90 ? `Showing last 90 of ${allDates.length} days` : `${allDates.length} days`}
              </span>
            </div>
            {/* Month headers */}
            <div style={{ display:'flex', marginLeft:140, marginBottom:2 }}>
              {showDates.reduce((acc,ds,i)=>{
                const m=ds.slice(0,7);
                if (!acc.length||acc[acc.length-1].m!==m) acc.push({m,start:i,count:1});
                else acc[acc.length-1].count++;
                return acc;
              },[]).map(({m,count})=>(
                <div key={m} style={{ width:count*cellW, fontSize:9, color:'#475569', fontFamily:'DM Mono', fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', paddingLeft:2 }}>
                  {new Date(m+'-01T12:00:00').toLocaleDateString('en-GB',{month:'short',year:'2-digit'})}
                </div>
              ))}
            </div>
            {/* Engineer rows */}
            {usersToShow.map(u=>(
              <div key={u.id} style={{ display:'flex', alignItems:'center', marginBottom:3 }}>
                <div style={{ width:140, display:'flex', alignItems:'center', gap:6, flexShrink:0, paddingRight:8 }}>
                  <Avatar user={u} size={18}/>
                  <span style={{ fontSize:11, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{u.name.split(' ')[0]}</span>
                </div>
                <div style={{ display:'flex', gap:1 }}>
                  {showDates.map(ds=>{
                    const s=getShift(u.id,ds);
                    const dow=new Date(ds+'T12:00:00').getDay();
                    return <div key={ds} title={`${ds} — ${s}`} style={{ width:cellW-1, height:18, background:s==='off'?(dow===0||dow===6?'rgba(255,255,255,0.03)':'rgba(255,255,255,0.06)'):C[s]||'#334155', borderRadius:2, flexShrink:0, border: ds===today?'1px solid #00c2ff':'none' }}/>;
                  })}
                </div>
              </div>
            ))}
            {/* Legend */}
            <div style={{ display:'flex', gap:10, marginTop:10, flexWrap:'wrap' }}>
              {Object.entries(C).filter(([k])=>k!=='off').map(([k,bg])=>(
                <div key={k} style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'#64748b' }}>
                  <div style={{ width:12, height:12, background:bg, borderRadius:2 }}/>
                  {SHIFT_COLORS[k]?.label||k}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Shift Distribution ───────────────────────────────────────────── */}
      {report==='distribution' && (() => {
        const usersToShow = selUser==='all' ? activeUsers : activeUsers.filter(u=>u.id===selUser);
        const shiftTypes  = ['daily','evening','weekend','upgrade','holiday','bankholiday'];
        const maxVal = Math.max(...usersToShow.map(u=>{
          const d = stats.find(s=>s.user.id===u.id); return d ? Math.max(...shiftTypes.map(t=>d.counts[t]||0)) : 0;
        }), 1);
        return (
          <div className="card">
            <div style={{ marginBottom:14, fontSize:13, fontWeight:700 }}>Shift Distribution per Engineer</div>
            {/* Legend */}
            <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
              {shiftTypes.map(t=><div key={t} style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'#64748b' }}>
                <div style={{ width:10, height:10, background:C[t], borderRadius:2 }}/>{SHIFT_COLORS[t]?.label||t}
              </div>)}
            </div>
            {usersToShow.map(u=>{
              const d=stats.find(s=>s.user.id===u.id);
              if (!d) return null;
              return (
                <div key={u.id} style={{ marginBottom:12 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                    <Avatar user={u} size={20}/>
                    <span style={{ fontSize:12, color:'#94a3b8', width:120 }}>{u.name.split(' ')[0]}</span>
                    <span style={{ fontSize:11, color:'#475569', fontFamily:'DM Mono' }}>{d.totalShifts} shifts · {d.totalHrs}h</span>
                  </div>
                  <div style={{ display:'flex', gap:2, height:20 }}>
                    {shiftTypes.map(t=>{
                      const cnt=d.counts[t]||0; if (!cnt) return null;
                      const w=Math.round((cnt/maxVal)*400);
                      return <div key={t} title={`${SHIFT_COLORS[t]?.label||t}: ${cnt} days`}
                        style={{ width:w, height:'100%', background:C[t], borderRadius:3, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', minWidth:cnt?4:0 }}>
                        {w>20&&<span style={{ fontSize:9, color:'#fff', fontWeight:700 }}>{cnt}</span>}
                      </div>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Engineer Workload ─────────────────────────────────────────────── */}
      {report==='workload' && (() => {
        const usersToShow = selUser==='all' ? activeUsers : activeUsers.filter(u=>u.id===selUser);
        const maxHrs = Math.max(...usersToShow.map(u=>stats.find(s=>s.user.id===u.id)?.totalHrs||0), 1);
        const sorted = [...usersToShow].sort((a,b)=>(stats.find(s=>s.user.id===b.id)?.totalHrs||0)-(stats.find(s=>s.user.id===a.id)?.totalHrs||0));
        return (
          <div className="card">
            <div style={{ marginBottom:14, fontSize:13, fontWeight:700 }}>Engineer On-Call Workload ({start} → {end})</div>
            <svg width="100%" height={Math.max(sorted.length*52+60, 200)} style={{ overflow:'visible' }}>
              {sorted.map((u,i)=>{
                const d=stats.find(s=>s.user.id===u.id);
                const totalH=d?.totalHrs||0;
                const barW=Math.round((totalH/maxHrs)*560);
                const y=i*52+10;
                return (
                  <g key={u.id}>
                    <text x={130} y={y+14} textAnchor="end" fontSize={11} fill="#94a3b8">{u.name.split(' ')[0]}</text>
                    {/* Total bar */}
                    <rect x={140} y={y} width={barW} height={20} rx={4} fill={u.color||'#1d4ed8'} opacity={0.7}/>
                    {/* Worked hours segment */}
                    {d && (() => {
                      const workedH=(d.hrs.daily||0)+(d.hrs.upgrade||0);
                      const workedW=Math.round((workedH/maxHrs)*560);
                      const standbyH=(d.hrs.evening||0)+(d.hrs.weekend||0)+(d.hrs.bankholiday||0);
                      const standbyW=Math.round((standbyH/maxHrs)*560);
                      return <>
                        <rect x={140} y={y} width={workedW} height={10} rx={4} fill="#166534" opacity={0.9}/>
                        <rect x={140} y={y+10} width={standbyW} height={10} rx={4} fill="#854d0e" opacity={0.9}/>
                      </>;
                    })()}
                    <text x={148+barW} y={y+14} fontSize={11} fill="#94a3b8" fontFamily="DM Mono">{totalH}h</text>
                    {/* Breakdown sub-label */}
                    {d && <text x={140} y={y+34} fontSize={9} fill="#475569">
                      {`Daily: ${d.hrs.daily||0}h  |  Standby: ${(d.hrs.evening||0)+(d.hrs.weekend||0)}h  |  Upgrades: ${d.hrs.upgrade||0}h  |  Shifts: ${d.totalShifts}`}
                    </text>}
                  </g>
                );
              })}
              <text x={140} y={sorted.length*52+50} fontSize={9} fill="#334155">■ Worked (blue)  ■ Daily (green top)  ■ Standby (amber bottom)</text>
            </svg>
          </div>
        );
      })()}

      {/* ── Weekly Trends ────────────────────────────────────────────────── */}
      {report==='trends' && (() => {
        const usersToShow = selUser==='all' ? activeUsers.slice(0,6) : activeUsers.filter(u=>u.id===selUser);
        // Build weekly buckets
        const weeks = [];
        const tmp = {}; // weekLabel → { uid: hrs }
        allDates.forEach(ds => {
          const d=new Date(ds+'T12:00:00'); const dow=(d.getDay()+6)%7; const mon=new Date(d); mon.setDate(d.getDate()-dow);
          const wk=mon.toISOString().slice(0,10);
          if (!tmp[wk]) { tmp[wk]={}; weeks.push(wk); }
          usersToShow.forEach(u => {
            const s=getShift(u.id,ds);
            tmp[wk][u.id]=(tmp[wk][u.id]||0)+(SHIFT_HRS[s]||0);
          });
        });
        const wkList=Object.keys(tmp).sort();
        const maxV=Math.max(...wkList.flatMap(w=>usersToShow.map(u=>tmp[w][u.id]||0)),1);
        const W=600; const H=200; const padL=40; const padB=30;
        const xStep=wkList.length>1?(W-padL)/(wkList.length-1):W-padL;
        const COLORS=['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6'];
        return (
          <div className="card">
            <div style={{ marginBottom:14, fontSize:13, fontWeight:700 }}>Weekly On-Call Hours Trend</div>
            <div style={{ overflowX:'auto' }}>
              <svg width={Math.max(W+padL+20, wkList.length*30+padL)} height={H+padB+40} style={{ minWidth:400 }}>
                {/* Y gridlines */}
                {[0,0.25,0.5,0.75,1].map(p=>{
                  const y=H-p*H;
                  return <g key={p}>
                    <line x1={padL} y1={y} x2={padL+W} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1}/>
                    <text x={padL-4} y={y+4} fontSize={9} fill="#475569" textAnchor="end">{Math.round(p*maxV)}h</text>
                  </g>;
                })}
                {/* Lines per user */}
                {usersToShow.map((u,ui)=>{
                  const pts=wkList.map((w,i)=>({x:padL+i*xStep, y:H-((tmp[w][u.id]||0)/maxV)*H}));
                  const path=pts.map((p,i)=>`${i===0?'M':'L'}${p.x},${p.y}`).join(' ');
                  return <g key={u.id}>
                    <path d={path} stroke={COLORS[ui%COLORS.length]} strokeWidth={2} fill="none"/>
                    {pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={3} fill={COLORS[ui%COLORS.length]}/>)}
                  </g>;
                })}
                {/* X axis labels */}
                {wkList.filter((_,i)=>i%Math.max(1,Math.floor(wkList.length/8))===0).map((w,i)=>{
                  const idx=wkList.indexOf(w);
                  return <text key={w} x={padL+idx*xStep} y={H+16} fontSize={8} fill="#475569" textAnchor="middle" transform={`rotate(-30,${padL+idx*xStep},${H+16})`}>{w.slice(5)}</text>;
                })}
                {/* Legend */}
                {usersToShow.map((u,ui)=>(
                  <g key={u.id}>
                    <rect x={padL+ui*90} y={H+padB+16} width={10} height={10} rx={2} fill={COLORS[ui%COLORS.length]}/>
                    <text x={padL+ui*90+14} y={H+padB+25} fontSize={10} fill="#94a3b8">{u.name.split(' ')[0]}</text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
        );
      })()}

      {/* ── Coverage Gaps ────────────────────────────────────────────────── */}
      {report==='gaps' && (() => {
        const gaps = allDates.filter(ds=>{
          const dow=new Date(ds+'T12:00:00').getDay();
          const bh=(UK_BANK_HOLIDAYS||[]).find(b=>b.date===ds);
          const covered=activeUsers.some(u=>{
            const s=getShift(u.id,ds); return s!=='off'&&s!=='holiday';
          });
          return !covered;
        }).slice(0,60);
        const lowCoverage=allDates.filter(ds=>{
          const count=activeUsers.filter(u=>{ const s=getShift(u.id,ds); return s!=='off'&&s!=='holiday'; }).length;
          return count===1;
        }).slice(0,60);
        return (
          <div className="card">
            <div style={{ marginBottom:14, fontSize:13, fontWeight:700 }}>Coverage Gaps Analysis</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:'#fca5a5', marginBottom:8 }}>
                  🔴 Zero Coverage ({gaps.length} days)
                </div>
                {gaps.length===0?<div style={{ fontSize:12, color:'#6ee7b7' }}>✅ No gaps found in this period</div>:
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                    {gaps.map(ds=>{
                      const d=new Date(ds+'T12:00:00');
                      return <div key={ds} style={{ background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:5, padding:'3px 8px', fontSize:11, fontFamily:'DM Mono', color:'#fca5a5' }}>
                        {d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                      </div>;
                    })}
                  </div>
                }
              </div>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:'#fcd34d', marginBottom:8 }}>
                  ⚠️ Single Cover ({lowCoverage.length} days)
                </div>
                {lowCoverage.length===0?<div style={{ fontSize:12, color:'#6ee7b7' }}>✅ No single-cover days found</div>:
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                    {lowCoverage.map(ds=>{
                      const d=new Date(ds+'T12:00:00');
                      const who=activeUsers.find(u=>getShift(u.id,ds)!=='off'&&getShift(u.id,ds)!=='holiday');
                      return <div key={ds} title={who?.name} style={{ background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.3)', borderRadius:5, padding:'3px 8px', fontSize:11, fontFamily:'DM Mono', color:'#fcd34d' }}>
                        {d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} <span style={{ fontSize:9 }}>({who?.name?.split(' ')[0]||'?'})</span>
                      </div>;
                    })}
                  </div>
                }
              </div>
            </div>
            {/* Coverage % chart */}
            <div style={{ marginTop:20 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#e2e8f0', marginBottom:10 }}>📊 Daily Coverage Count</div>
              <div style={{ display:'flex', alignItems:'flex-end', gap:1, height:80, overflowX:'auto' }}>
                {allDates.slice(-60).map(ds=>{
                  const count=activeUsers.filter(u=>{ const s=getShift(u.id,ds); return s!=='off'&&s!=='holiday'; }).length;
                  const maxC=Math.max(activeUsers.length,1);
                  const h=Math.round((count/maxC)*80);
                  const col=count===0?'#ef4444':count===1?'#f59e0b':'#22c55e';
                  return <div key={ds} title={`${ds}: ${count} engineers`} style={{ width:8, height:h||2, background:col, borderRadius:'2px 2px 0 0', flexShrink:0, opacity:0.85 }}/>;
                })}
              </div>
              <div style={{ fontSize:9, color:'#334155', marginTop:4, fontFamily:'DM Mono' }}>
                🔴 = 0 engineers  🟡 = 1 engineer  🟢 = 2+ engineers  (last 60 days shown)
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Summary Table ────────────────────────────────────────────────── */}
      {report==='summary' && (() => {
        const usersToShow = selUser==='all' ? activeUsers : activeUsers.filter(u=>u.id===selUser);
        const shiftTypes=['daily','evening','weekend','upgrade','holiday','bankholiday'];
        return (
          <div className="card" style={{ overflowX:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>Summary Report: {start} → {end}</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>{
                const rows=[['Engineer','Daily','WD OC','WE OC','Upgrade','Holiday','BH','Total Shifts','Total Hours']];
                usersToShow.forEach(u=>{
                  const d=stats.find(s=>s.user.id===u.id);
                  rows.push([u.name,...shiftTypes.map(t=>d?.counts[t]||0),d?.totalShifts||0,d?.totalHrs||0]);
                });
                const csv=rows.map(r=>r.join(',')).join('\n');
                const b=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`rota-report-${start}-${end}.csv`; a.click();
              }}>📥 Export CSV</button>
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left', padding:'8px 10px', fontSize:10, fontWeight:700, textTransform:'uppercase', color:'#475569', borderBottom:'1px solid rgba(255,255,255,0.08)', letterSpacing:'0.06em' }}>Engineer</th>
                  {shiftTypes.map(t=><th key={t} style={{ textAlign:'center', padding:'8px 6px', fontSize:10, fontWeight:700, textTransform:'uppercase', color:'#475569', borderBottom:'1px solid rgba(255,255,255,0.08)', letterSpacing:'0.06em' }}>
                    <div style={{ width:8, height:8, background:C[t], borderRadius:2, margin:'0 auto 2px' }}/>
                    {t==='daily'?'Daily':t==='evening'?'WD OC':t==='weekend'?'WE OC':t==='upgrade'?'Upg':t==='holiday'?'Hol':'BH'}
                  </th>)}
                  <th style={{ textAlign:'center', padding:'8px 6px', fontSize:10, fontWeight:700, textTransform:'uppercase', color:'#475569', borderBottom:'1px solid rgba(255,255,255,0.08)', letterSpacing:'0.06em' }}>Shifts</th>
                  <th style={{ textAlign:'center', padding:'8px 6px', fontSize:10, fontWeight:700, textTransform:'uppercase', color:'#475569', borderBottom:'1px solid rgba(255,255,255,0.08)', letterSpacing:'0.06em' }}>Hours</th>
                  <th style={{ textAlign:'center', padding:'8px 6px', fontSize:10, fontWeight:700, textTransform:'uppercase', color:'#475569', borderBottom:'1px solid rgba(255,255,255,0.08)', letterSpacing:'0.06em' }}>Distribution</th>
                </tr>
              </thead>
              <tbody>
                {usersToShow.map((u,idx)=>{
                  const d=stats.find(s=>s.user.id===u.id);
                  return (
                    <tr key={u.id} style={{ background:idx%2===0?'transparent':'rgba(255,255,255,0.015)' }}>
                      <td style={{ padding:'8px 10px', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <Avatar user={u} size={22}/>
                          <div>
                            <div style={{ fontSize:12, fontWeight:600, color:'#e2e8f0' }}>{u.name}</div>
                            <div style={{ fontSize:10, color:'#475569', fontFamily:'DM Mono' }}>{u.id}</div>
                          </div>
                        </div>
                      </td>
                      {shiftTypes.map(t=><td key={t} style={{ textAlign:'center', padding:'8px 6px', fontSize:12, color:d?.counts[t]?TXT[t]:'#334155', fontFamily:'DM Mono', fontWeight:d?.counts[t]?700:400, borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                        {d?.counts[t]||'—'}
                      </td>)}
                      <td style={{ textAlign:'center', padding:'8px 6px', fontSize:12, color:'#94a3b8', fontFamily:'DM Mono', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>{d?.totalShifts||0}</td>
                      <td style={{ textAlign:'center', padding:'8px 6px', fontSize:13, color:'var(--accent)', fontFamily:'DM Mono', fontWeight:700, borderBottom:'1px solid rgba(255,255,255,0.04)' }}>{d?.totalHrs||0}h</td>
                      <td style={{ padding:'8px 6px', borderBottom:'1px solid rgba(255,255,255,0.04)', minWidth:120 }}>
                        <div style={{ display:'flex', height:12, borderRadius:6, overflow:'hidden', gap:1 }}>
                          {d && shiftTypes.map(t=>{ const cnt=d.counts[t]||0; if(!cnt) return null;
                            return <div key={t} title={`${SHIFT_COLORS[t]?.label||t}: ${cnt}`} style={{ flex:cnt, background:C[t], minWidth:2 }}/>;
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}

// ── Bulk Entry (manager-only) ────────────────────────────────────────────────
// A form-driven alternative to clicking/painting individual cells: queue up
// (engineer, date range, shift) entries, review them as a batch, then apply
// them all in one go. Useful for entering a big block of dates at once
// (e.g. "Priya is on Daily Shift for the whole of March") without touching
// the grid at all.
const BULK_SHIFTS = [
  { id:'daily',       label:'Daily Shift' },
  { id:'evening',     label:'Weekday On-Call (Mon–Thu)' },
  { id:'weekend',     label:'Weekend On-Call' },
  { id:'upgrade',     label:'Upgrade Day' },
  { id:'holiday',     label:'Holiday' },
  { id:'bankholiday', label:'Bank Holiday' },
  { id:'off',         label:'Off / Clear' },
];

function RotaBulkEntry({ users, rota, setRota, isManager }) {
  const today = new Date().toISOString().slice(0,10);
  const [draftUser,  setDraftUser]  = useState(users[0]?.id || '');
  const [draftStart, setDraftStart] = useState(today);
  const [draftEnd,   setDraftEnd]   = useState(today);
  const [draftShift, setDraftShift] = useState('daily');
  const [queue,       setQueue]     = useState([]); // [{id, userId, start, end, shift}]
  const [applying,    setApplying]  = useState(false);
  const [result,      setResult]    = useState(null); // { appliedCount, skipped: [] } | null

  if (!isManager) {
    return (
      <div style={{ padding:40, textAlign:'center', color:'#64748b', fontSize:13 }}>
        Bulk Entry is only available to managers.
      </div>
    );
  }

  const sortedUsers = [...users].sort((a,b) => a.name.localeCompare(b.name));

  const addToQueue = () => {
    if (!draftUser || !draftStart || !draftEnd) return;
    if (draftEnd < draftStart) { alert('End date must be on or after the start date.'); return; }
    setQueue(q => [...q, { id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`, userId: draftUser, start: draftStart, end: draftEnd, shift: draftShift }]);
    setResult(null);
  };

  const removeFromQueue = (id) => setQueue(q => q.filter(r => r.id !== id));
  const clearQueue = () => { setQueue([]); setResult(null); };

  const dateRange = (start, end) => {
    const out = [];
    const d = new Date(start + 'T12:00:00');
    const last = new Date(end + 'T12:00:00');
    while (d <= last) { out.push(d.toISOString().slice(0,10)); d.setDate(d.getDate() + 1); }
    return out;
  };

  const applyQueue = () => {
    if (queue.length === 0) return;
    setApplying(true);
    const merged = JSON.parse(JSON.stringify(rota));
    const skipped = []; // { userName, date, reason }
    let appliedCount = 0;

    queue.forEach(entry => {
      const user = users.find(u => u.id === entry.userId);
      dateRange(entry.start, entry.end).forEach(dateStr => {
        const dow = new Date(dateStr + 'T12:00:00').getDay();
        const isWeekend = dow === 0 || dow === 6;

        if (!isOnCallActive(user, dateStr) && entry.shift !== 'off') {
          skipped.push({ userName: user?.name || entry.userId, date: dateStr, reason: 'not on-call active' });
          return;
        }
        // Same rule the popover uses: Weekday On-Call only applies Mon–Thu.
        if (entry.shift === 'evening' && !(dow >= 1 && dow <= 4)) {
          skipped.push({ userName: user?.name || entry.userId, date: dateStr, reason: 'Weekday On-Call doesn\u2019t apply on this day' });
          return;
        }
        // Same rule setCell() already applies: Daily Shift on a weekend
        // date becomes Weekend On-Call rather than being written as-is.
        const value = (entry.shift === 'daily' && isWeekend) ? 'weekend' : entry.shift;
        merged[entry.userId] = { ...(merged[entry.userId] || {}), [dateStr]: value };
        appliedCount++;
      });
    });

    setRota(merged);
    setResult({ appliedCount, skipped });
    setQueue([]);
    setApplying(false);
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <h1 style={{ margin:0, fontSize:22, fontWeight:700, letterSpacing:'-0.5px' }}>🗂 Bulk Entry</h1>
        <div style={{ fontSize:12, color:'#64748b', marginTop:3 }}>
          Queue up date-range entries per engineer, review them, then apply them all at once.
        </div>
      </div>

      {/* ── Draft entry form ──────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end', padding:'14px 16px',
        background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, marginBottom:14 }}>
        <div>
          <div style={{ fontSize:10, color:'#475569', marginBottom:4, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>Engineer / Manager</div>
          <select className="select" value={draftUser} onChange={e=>setDraftUser(e.target.value)} style={{ width:200 }}>
            {sortedUsers.map(u => <option key={u.id} value={u.id}>{u.name}{u.role==='Manager' ? ' (Manager)' : ''}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:10, color:'#475569', marginBottom:4, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>From</div>
          <input className="input" type="date" value={draftStart} onChange={e=>setDraftStart(e.target.value)} style={{ width:150 }} />
        </div>
        <div>
          <div style={{ fontSize:10, color:'#475569', marginBottom:4, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>To</div>
          <input className="input" type="date" value={draftEnd} onChange={e=>setDraftEnd(e.target.value)} style={{ width:150 }} />
        </div>
        <div>
          <div style={{ fontSize:10, color:'#475569', marginBottom:4, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>Shift</div>
          <select className="select" value={draftShift} onChange={e=>setDraftShift(e.target.value)} style={{ width:200 }}>
            {BULK_SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={addToQueue} style={{ padding:'8px 16px' }}>+ Add to batch</button>
      </div>

      {/* ── Queued entries ────────────────────────────────────────────────── */}
      {queue.length > 0 ? (
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, marginBottom:14, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'rgba(255,255,255,0.03)' }}>
                <th style={{ textAlign:'left', padding:'8px 12px', fontSize:11, color:'#64748b' }}>Engineer</th>
                <th style={{ textAlign:'left', padding:'8px 12px', fontSize:11, color:'#64748b' }}>Dates</th>
                <th style={{ textAlign:'left', padding:'8px 12px', fontSize:11, color:'#64748b' }}>Shift</th>
                <th style={{ padding:'8px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {queue.map(entry => {
                const user = users.find(u => u.id === entry.userId);
                const col = SHIFT_COLORS[entry.shift] || SHIFT_COLORS.inactive;
                const dayCount = dateRange(entry.start, entry.end).length;
                return (
                  <tr key={entry.id} style={{ borderTop:'1px solid var(--border)' }}>
                    <td style={{ padding:'8px 12px', fontSize:12 }}>{user?.name || entry.userId}</td>
                    <td style={{ padding:'8px 12px', fontSize:12, color:'#94a3b8' }}>{entry.start} → {entry.end} ({dayCount} day{dayCount!==1?'s':''})</td>
                    <td style={{ padding:'8px 12px' }}>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:5, background:(col.bg||'#334155')+'33', color:col.text||'#94a3b8' }}>
                        {SHIFT_ABBR[entry.shift] || entry.shift} — {BULK_SHIFTS.find(s=>s.id===entry.shift)?.label}
                      </span>
                    </td>
                    <td style={{ padding:'8px 12px', textAlign:'right' }}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>removeFromQueue(entry.id)} style={{ fontSize:10, padding:'3px 8px' }}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display:'flex', gap:8, padding:'10px 12px', borderTop:'1px solid var(--border)' }}>
            <button className="btn btn-primary btn-sm" onClick={applyQueue} disabled={applying}
              style={{ opacity: applying ? 0.6 : 1 }}>
              {applying ? 'Applying…' : `✓ Apply ${queue.length} entr${queue.length!==1?'ies':'y'}`}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={clearQueue}>🗑 Clear batch</button>
          </div>
        </div>
      ) : (
        <div style={{ padding:'20px 16px', textAlign:'center', color:'#475569', fontSize:12, border:'1px dashed var(--border)', borderRadius:10, marginBottom:14 }}>
          No entries queued yet — fill in the form above and click "Add to batch".
        </div>
      )}

      {/* ── Last apply result ─────────────────────────────────────────────── */}
      {result && (
        <div style={{ padding:'12px 16px', borderRadius:10, marginBottom:14,
          background: result.skipped.length ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)',
          border: `1px solid ${result.skipped.length ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}` }}>
          <div style={{ fontSize:12, fontWeight:700, color: result.skipped.length ? '#fcd34d' : '#4ade80', marginBottom: result.skipped.length ? 6 : 0 }}>
            ✓ Applied {result.appliedCount} day{result.appliedCount!==1?'s':''} to the rota.
          </div>
          {result.skipped.length > 0 && (
            <>
              <div style={{ fontSize:11, color:'#fcd34d', marginBottom:4 }}>Skipped {result.skipped.length} day{result.skipped.length!==1?'s':''}:</div>
              <div style={{ maxHeight:120, overflowY:'auto' }}>
                {result.skipped.map((s,i) => (
                  <div key={i} style={{ fontSize:10, color:'rgba(252,211,77,0.8)', lineHeight:1.5 }}>
                    {s.userName} — {s.date} ({s.reason})
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ fontSize:10, color:'rgba(255,255,255,0.2)' }}>
        Entries are applied against the current saved rota — reload after applying to confirm everything synced to Drive.
      </div>
    </div>
  );
}

// ── Main RotaPage with tabs ────────────────────────────────────────────────────
export default function RotaPage(props) {
  const [activeTab, setActiveTab] = React.useState('rota');
  const tabs = [
    ['rota','📅 Rota','Schedule & manage on-call shifts'],
    ['analytics','📊 Analytics','Reports, trends & coverage insights'],
    ...(props.isManager ? [['bulk','🗂 Bulk Entry','Queue up date ranges per engineer — managers only']] : []),
  ];
  return (
    <div>
      {/* ── Top tab nav ─────────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:0, marginBottom:16, borderBottom:'2px solid var(--border)' }}>
        {tabs.map(([id,label,hint])=>(
          <button key={id} onClick={()=>setActiveTab(id)} style={{
            padding:'10px 20px', border:'none', background:'none', cursor:'pointer',
            fontSize:13, fontWeight:700,
            color: activeTab===id ? 'var(--accent)' : '#64748b',
            borderBottom: activeTab===id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom:-2, transition:'all 0.15s', fontFamily:'inherit',
            display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2,
          }}>
            {label}
            <span style={{ fontSize:9, fontWeight:400, color: activeTab===id?'rgba(0,194,255,0.6)':'#334155' }}>{hint}</span>
          </button>
        ))}
      </div>
      {activeTab === 'rota'      && <RotaContent {...props} />}
      {activeTab === 'analytics' && <RotaAnalytics {...props} />}
      {activeTab === 'bulk'      && props.isManager && <RotaBulkEntry {...props} />}
    </div>
  );
}
