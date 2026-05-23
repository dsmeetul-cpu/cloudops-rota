// src/Rota.js
// CloudOps Rota — improved editing: floating cell editor, sticky toolbar, floating bulk bar 23rd May 2026
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
          style={{ flex:1, padding:'7px 10px', background:locked?'rgba(245,158,11,0.12)':'rgba(255,255,255,0.04)', border:`1px solid ${locked?'rgba(245,158,11,0.45)':'rgba(255,255,255,0.09)'}`, borderRadius:8, color:locked?'#fcd34d':'#64748b', fontSize:11, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
          {locked ? '🔒 Locked' : '🔓 Lock Cell'}
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
export default function RotaPage({
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
  const [managerUnlocked, setManagerUnlocked] = useState(false);
  const [lockedCells,     setLockedCells]     = useState(new Set());
  const [showInactive,    setShowInactive]    = useState(false);

  const toggleLock  = (userId, date) => {
    const key = `${userId}::${date}`;
    setLockedCells(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const isLocked  = (userId, date) => lockedCells.has(`${userId}::${date}`);
  const canEdit   = isManager && managerUnlocked;

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
              <div>
                <div style={{ fontSize:10, color:'#475569', marginBottom:4, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>Period</div>
                <select className="select" value={weeks} onChange={e=>setWeeks(+e.target.value)} style={{ width:140 }}>
                  {[2,4,6,8,12,16,24,26,52].map(w=><option key={w} value={w}>{w} week{w>=52?' (1yr)':w>=26?' (6mo)':w>=12?' (3mo)':''}</option>)}
                </select>
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

      {/* View mode toggle */}
      <div style={{ display:'flex', gap:8, marginBottom:14, alignItems:'center' }}>
        <span style={{ fontSize:12, color:'#64748b' }}>View:</span>
        {[['compact','📋 Compact'],['hours','🕐 Timeline']].map(([m,l]) => (
          <button key={m} className={`btn btn-sm ${viewMode===m?'btn-primary':'btn-secondary'}`} onClick={()=>setViewMode(m)}>{l}</button>
        ))}
        {canEdit && <span style={{ fontSize:11, color:'rgba(255,255,255,0.2)', marginLeft:8 }}>Click cell to edit · Ctrl+click to bulk select</span>}
      </div>

      {/* ── Week Grids ─────────────────────────────────────────────────────── */}
      {weekStarts.map((ws, wi) => {
        const wdates = Array.from({length:8},(_,d) => { const dt=new Date(ws); dt.setDate(ws.getDate()+d); return dt; });
        const weekDateStr = ws.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
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
              <div className="card-title" style={{ fontSize:12, color:'#64748b', marginBottom:10 }}>Week of {weekDateStr}</div>
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
                    {visibleUsers.map(u => {
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
          <div key={wi} className="card mb-12" style={{ overflowX:'auto' }}>
            <div className="card-title" style={{ fontSize:12, color:'#64748b' }}>Week of {weekDateStr}</div>
            <table style={{ minWidth:540, borderCollapse:'separate', borderSpacing:0 }}>
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
                        style={{ textAlign:'center', fontSize:10, paddingBottom:6, color:bh?'#fca5a5':isWkd?'rgba(255,255,255,0.35)':'#94a3b8', background:isWkd?'rgba(255,255,255,0.025)':undefined, borderBottom:'1px solid rgba(255,255,255,0.08)', minWidth:68, cursor:canEdit?'pointer':'default' }}
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
                {visibleUsers.map(u => (
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
                                onClick={e => {
                                  if (!canEdit || !active) return;
                                  if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleBulk(u.id, ds); }
                                  else { setEditCell(null); openCellEditor(u.id, ds, e); }
                                }}
                                title={canEdit&&active ? `${displayCol.label||s}${bhOverlay?' + Bank Holiday':''}${upg&&!hol?' + Upgrade Day':''}${isLocked(u.id,ds)?' 🔒 Locked':''} — click to edit, Ctrl+click to bulk select` : `${displayCol.label||s}`}
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
        );
      })}

      {canEdit && bulkSelected.size === 0 && (
        <div style={{ fontSize:11, color:'#334155', marginTop:8, textAlign:'center', padding:'8px 0', letterSpacing:'0.02em' }}>
          💡 <strong style={{ color:'#475569' }}>Click</strong> cell to edit · <strong style={{ color:'#475569' }}>Ctrl+click</strong> to bulk select · <strong style={{ color:'#475569' }}>Click column header</strong> to select day · <strong style={{ color:'#475569' }}>Click name</strong> to select row
        </div>
      )}
    </div>
  );
}
