// src/Rota.js
// CloudOps Rota — Rota Page (extracted from App.js)
// New: respects user.start_date, user.oncall_start_date, user.termination_date
// Engineers are excluded from rota generation until oncall_start_date is reached.

import React, { useState } from 'react';

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

// Short abbreviations for compact cell display
const SHIFT_ABBR = {
  daily:       'D',
  evening:     'WD',
  weekend:     'WE',
  upgrade:     'UD',
  holiday:     'H',
  bankholiday: 'BH',
  off:         '—',
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

// Returns true if the engineer should appear on-call for a given date
function isOnCallActive(user, dateStr) {
  if (!user) return false;
  const d = dateStr;
  // Must have started employment
  if (user.start_date && d < user.start_date) return false;
  // Must have reached on-call start date
  if (user.oncall_start_date && d < user.oncall_start_date) return false;
  // Must not be terminated
  if (user.termination_date && d > user.termination_date) return false;
  return true;
}

// Returns true if user is employed on a date (but not necessarily on-call)
function isEmployed(user, dateStr) {
  if (!user) return false;
  if (user.start_date && dateStr < user.start_date) return false;
  if (user.termination_date && dateStr > user.termination_date) return false;
  return true;
}

// Status badge for an engineer on a given date
function getOnCallStatus(user, dateStr) {
  if (!user) return null;
  if (user.termination_date && dateStr > user.termination_date) return { type: 'terminated', label: 'Left', color: '#ef4444' };
  if (user.start_date && dateStr < user.start_date) return { type: 'not_started', label: 'Not started', color: '#64748b' };
  if (user.oncall_start_date && dateStr < user.oncall_start_date) return { type: 'not_ready', label: 'Not on-call yet', color: '#f59e0b' };
  return null; // active
}

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

// ── Inline Avatar ─────────────────────────────────────────────────────────────
function Avatar({ user, size = 24 }) {
  if (!user) return <div style={{ width:size, height:size, borderRadius:'50%', background:'#1e293b' }} />;
  if (user.profile_picture) return <img src={user.profile_picture} alt="" style={{ width:size, height:size, borderRadius:'50%', objectFit:'cover' }} />;
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:user.color||'#1d4ed8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:Math.round(size*0.4), fontWeight:700, color:'#fff', flexShrink:0 }}>
      {user.avatar||user.name?.charAt(0)||'?'}
    </div>
  );
}

// ── On-call readiness banner ──────────────────────────────────────────────────
function ReadinessBanner({ users, startDate, weeks }) {
  // Find engineers who will become on-call active within the viewed date range
  const today = new Date().toISOString().slice(0,10);
  const rangeEnd = new Date(startDate);
  rangeEnd.setDate(rangeEnd.getDate() + weeks * 7);
  const rangeEndStr = rangeEnd.toISOString().slice(0,10);

  const pending = users.filter(u => {
    if (!u.oncall_start_date) return false;
    return u.oncall_start_date >= today && u.oncall_start_date <= rangeEndStr;
  });
  const notReady = users.filter(u => {
    if (!u.oncall_start_date) return false;
    return u.oncall_start_date > rangeEndStr;
  });
  const terminated = users.filter(u => u.termination_date && u.termination_date >= today && u.termination_date <= rangeEndStr);

  if (pending.length === 0 && notReady.length === 0 && terminated.length === 0) return null;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
      {pending.map(u => (
        <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.25)', borderRadius:8, padding:'8px 14px', fontSize:12 }}>
          <span style={{ fontSize:18 }}>⏳</span>
          <span><strong style={{ color:'#fcd34d' }}>{u.name}</strong> goes on-call on <strong style={{ color:'#fcd34d', fontFamily:'DM Mono' }}>{u.oncall_start_date}</strong> — they will appear in the rota from that date.</span>
        </div>
      ))}
      {notReady.map(u => (
        <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(100,116,139,0.08)', border:'1px solid rgba(100,116,139,0.2)', borderRadius:8, padding:'8px 14px', fontSize:12 }}>
          <span style={{ fontSize:18 }}>🚫</span>
          <span><strong style={{ color:'#94a3b8' }}>{u.name}</strong> is not on-call yet (on-call start: <strong style={{ fontFamily:'DM Mono' }}>{u.oncall_start_date || 'not set'}</strong>). Set their on-call start date in Settings.</span>
        </div>
      ))}
      {terminated.map(u => (
        <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:8, padding:'8px 14px', fontSize:12 }}>
          <span style={{ fontSize:18 }}>👋</span>
          <span><strong style={{ color:'#fca5a5' }}>{u.name}</strong> leaves on <strong style={{ color:'#fca5a5', fontFamily:'DM Mono' }}>{u.termination_date}</strong> — they will be removed from the rota after that date.</span>
        </div>
      ))}
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
  const [editCell,        setEditCell]        = useState(null);
  const [bulkSelected,    setBulkSelected]    = useState(new Set());
  const [bulkShift,       setBulkShift]       = useState('daily');
  const [swapSuggestion,  setSwapSuggestion]  = useState(null);
  const [viewMode,        setViewMode]        = useState('compact');
  const [managerUnlocked, setManagerUnlocked] = useState(false);
  const [lockedCells,     setLockedCells]     = useState(new Set());
  const [showInactive,    setShowInactive]    = useState(false); // toggle inactive users

  const DAYS = ['M','T','W','T','F','S','S'];

  const toggleLock  = (userId, date) => {
    const key = `${userId}::${date}`;
    setLockedCells(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const isLocked  = (userId, date) => lockedCells.has(`${userId}::${date}`);
  const canEdit   = isManager && managerUnlocked;

  // ── Filter: only show engineers who are employed at some point in the viewed range
  const rangeStart = (() => { const d = new Date(startDate+'T12:00:00'); const dow=d.getDay(); d.setDate(d.getDate()+(dow===0?-6:1-dow)); return d.toISOString().slice(0,10); })();
  const rangeEndDate = new Date(rangeStart+'T12:00:00'); rangeEndDate.setDate(rangeEndDate.getDate()+weeks*7);
  const rangeEndStr = rangeEndDate.toISOString().slice(0,10);

  // Active = on-call active at some point in range; inactive = employed but not on-call yet
  const activeUsers   = users.filter(u => {
    if (!isEmployed(u, rangeEndStr)) return false; // left before range
    if (!isEmployed(u, rangeStart) && !isEmployed(u, rangeEndStr)) return false;
    return isOnCallActive(u, rangeEndStr) || isOnCallActive(u, rangeStart);
  });
  const inactiveUsers = users.filter(u => isEmployed(u, rangeEndStr) && !activeUsers.includes(u));
  const visibleUsers  = showInactive ? [...activeUsers, ...inactiveUsers] : activeUsers;

  // ── Generate (only for on-call-active engineers) ───────────────────────────
  const generate = () => {
    if (!isManager) return;
    // Only pass users who are on-call active
    const onCallUsers = users.filter(u => isOnCallActive(u, startDate));
    const generated = sanitiseRota(generateRota(onCallUsers, startDate, weeks));
    setRota(prev => {
      const merged = { ...prev };
      // Initialise empty objects for ALL users (so inactive users have no shifts)
      users.forEach(u => {
        if (!isOnCallActive(u, startDate)) {
          // Clear any auto-generated shifts for inactive engineers, keep manual ones only
          merged[u.id] = {};
          Object.entries(prev[u.id] || {}).forEach(([date, shift]) => {
            if (isLocked(u.id, date)) merged[u.id][date] = shift;
          });
          return;
        }
        const existing = prev[u.id] || {};
        const genDates = generated[u.id] || {};
        merged[u.id] = { ...genDates };
        Object.entries(existing).forEach(([date, shift]) => {
          if (shift && shift !== 'off') merged[u.id][date] = shift;
        });
      });
      return merged;
    });
    setGenerated(true);
  };

  const setCell = (userId, date, shift) => {
    if (!canEdit) return;
    // Prevent assigning on-call shifts to inactive engineers
    const user = users.find(u => u.id === userId);
    if (!isOnCallActive(user, date) && shift !== 'off') {
      alert(`${user?.name} is not on-call active on ${date}.\nCheck their on-call start date and termination date in Settings.`);
      return;
    }
    const dow = new Date(date).getDay();
    const isWeekend = dow === 0 || dow === 6;
    setRota(prev => ({ ...prev, [userId]: { ...(prev[userId]||{}), [date]: (shift==='daily'&&isWeekend)?'weekend':shift } }));
    setEditCell(null);
  };

  const deleteCell = (userId, date) => {
    if (!canEdit) return;
    const next = JSON.parse(JSON.stringify(rota));
    if (next[userId]) delete next[userId][date];
    setRota(next);
  };

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
    if (blocked.length > 0) alert(`Skipped ${[...new Set(blocked)].join(', ')} — not on-call active on selected dates.`);
  };

  const deleteBulk = () => {
    if (!isManager) return;
    const next = JSON.parse(JSON.stringify(rota));
    bulkSelected.forEach(key => { const [uid,date]=key.split('::'); if(next[uid]) delete next[uid][date]; });
    setRota(next); setBulkSelected(new Set());
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

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontWeight:700, letterSpacing:'-0.5px' }}>📅 Rota</h1>
          <div style={{ fontSize:12, color:'#64748b', marginTop:3 }}>
            {activeUsers.length} on-call engineer{activeUsers.length!==1?'s':''} active
            {inactiveUsers.length>0 && <span style={{ color:'#f59e0b', marginLeft:8 }}>· {inactiveUsers.length} not on-call yet</span>}
          </div>
        </div>
      </div>

      {/* Readiness banners */}
      <ReadinessBanner users={users} startDate={startDate} weeks={weeks} />

      {/* ── Manager toolbar ─────────────────────────────────────────────────── */}
      {isManager && (
        <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:'14px 16px', marginBottom:16 }}>
          {/* Lock toggle */}
          <div style={{ marginBottom:12 }}>
            <button onClick={() => setManagerUnlocked(p=>!p)} style={{
              display:'flex', alignItems:'center', gap:6,
              background: managerUnlocked?'rgba(239,68,68,0.15)':'rgba(34,197,94,0.12)',
              border:`1px solid ${managerUnlocked?'#ef4444':'#22c55e'}`,
              borderRadius:8, padding:'6px 14px', cursor:'pointer',
              color: managerUnlocked?'#fca5a5':'#4ade80', fontSize:12, fontWeight:600,
            }}>
              {managerUnlocked ? '🔓 Unlocked — editing enabled' : '🔒 Locked — click to enable editing'}
            </button>
            {!managerUnlocked && (
              <div style={{ marginTop:6, fontSize:11, color:'#4ade80', opacity:0.7 }}>
                🔒 Rota is read-only. Click the button above to unlock editing.
              </div>
            )}
          </div>

          {/* Controls row */}
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
            <div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:4, fontWeight:600 }}>Start Date</div>
              <input className="input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={{ width:180 }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:4, fontWeight:600 }}>Weeks</div>
              <select className="select" value={weeks} onChange={e=>setWeeks(+e.target.value)} style={{ width:130 }}>
                {[2,4,6,8,12,16,24,26,52].map(w=><option key={w} value={w}>{w} week{w>=52?' (1yr)':w>=26?' (6mo)':w>=12?' (3mo)':''}</option>)}
              </select>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <button className="btn btn-primary" onClick={generate} disabled={!canEdit} style={{ opacity:canEdit?1:0.4 }}>🔄 Generate Rota</button>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', textAlign:'center' }}>🔒 Keeps manual entries</div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <button className="btn btn-secondary" disabled={!canEdit} style={{ opacity:canEdit?1:0.4 }} onClick={() => {
                if (!canEdit) return;
                if (window.confirm('⚠️ Regenerate from scratch? Locked cells preserved, all others overwritten.')) {
                  const onCallUsers = users.filter(u => isOnCallActive(u, startDate));
                  const fresh = sanitiseRota(generateRota(onCallUsers, startDate, weeks));
                  setRota(prev => {
                    const merged = {};
                    users.forEach(u => {
                      merged[u.id] = {};
                      if (isOnCallActive(u, startDate)) {
                        Object.assign(merged[u.id], fresh[u.id]||{});
                      }
                      Object.entries(prev[u.id]||{}).forEach(([date,shift]) => {
                        if (isLocked(u.id,date)) merged[u.id][date]=shift;
                      });
                    });
                    return merged;
                  });
                  setGenerated(true);
                }
              }}>↺ Force Regenerate</button>
              <div style={{ fontSize:9, color:'rgba(255,80,80,0.5)', textAlign:'center' }}>⚠ Overwrites all shifts</div>
            </div>
            <button className="btn btn-danger" disabled={!canEdit} style={{ opacity:canEdit?1:0.4 }} onClick={() => {
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
            <button className="btn btn-secondary" onClick={checkConflicts}>🔍 Check Conflicts</button>
            <button style={{ padding:'6px 14px', background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.3)', borderRadius:7, color:'#34d399', fontSize:12, fontWeight:600, cursor:'pointer' }}
              onClick={() => activeUsers.forEach(u => { const ic=generateICalFeed(rota[u.id]||{},u.name); downloadIcal(ic,`rota-${u.id}.ics`); })}>
              📥 Export All (.ics)
            </button>
          </div>

          {/* Inactive toggle */}
          {inactiveUsers.length > 0 && (
            <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8 }}>
              <button onClick={()=>setShowInactive(p=>!p)}
                style={{ padding:'4px 12px', background:showInactive?'rgba(245,158,11,0.12)':'rgba(255,255,255,0.04)', border:`1px solid ${showInactive?'rgba(245,158,11,0.35)':'rgba(255,255,255,0.08)'}`, borderRadius:6, color:showInactive?'#f59e0b':'#64748b', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                {showInactive ? '👁 Hiding inactive' : `👁 Show inactive (${inactiveUsers.length})`}
              </button>
              <span style={{ fontSize:11, color:'#475569' }}>Inactive = employed but on-call start date not yet reached</span>
            </div>
          )}

          {/* Bulk panel */}
          {bulkSelected.size > 0 && (
            <div style={{ marginTop:12, padding:'10px 14px', background:'rgba(59,130,246,.1)', border:'1px solid rgba(59,130,246,.35)', borderRadius:8, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontSize:12, color:'#93c5fd' }}>{bulkSelected.size} cell{bulkSelected.size>1?'s':''} selected</span>
              <select className="select" value={bulkShift} onChange={e=>setBulkShift(e.target.value)} style={{ width:160 }}>
                <option value="daily">Daily Shift</option>
                <option value="evening">Weekday On-Call</option>
                <option value="weekend">Weekend On-Call</option>
                <option value="off">Off</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={applyBulk}>✓ Apply to Selected</button>
              <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete Selected</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setBulkSelected(new Set())}>✕ Clear</button>
            </div>
          )}
        </div>
      )}

      {/* Conflict suggestions */}
      {swapSuggestion && swapSuggestion.length > 0 && isManager && (
        <div style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.3)', borderRadius:10, padding:'14px 16px', marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#f59e0b', marginBottom:10 }}>⚠ Holiday Conflicts — Suggested Cover</div>
          {swapSuggestion.map((c,i) => {
            const eng = users.find(u => u.id===c.userId);
            return (
              <div key={i} style={{ paddingBottom:10, borderBottom:'1px solid rgba(255,255,255,0.06)', marginBottom:10 }}>
                <div style={{ fontSize:12, color:'#94a3b8' }}>{eng?.name} is on holiday on {c.date} but has <strong>{SHIFT_COLORS[c.shift]?.label}</strong></div>
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  {c.available.length===0 && <span style={{ fontSize:11, color:'#64748b' }}>No on-call engineers available for cover</span>}
                  {c.available.map(a => <button key={a.id} className="btn btn-success btn-sm" onClick={()=>applySwap(c,a.id)}>✓ Assign {a.name.split(' ')[0]}</button>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {swapSuggestion && swapSuggestion.length===0 && (
        <div style={{ background:'rgba(34,197,94,0.08)', border:'1px solid rgba(34,197,94,0.2)', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#4ade80' }}>✅ No holiday conflicts found.</div>
      )}

      {/* Pending swaps */}
      {isManager && pendingSwaps.length > 0 && (
        <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:'14px 16px', marginBottom:16 }}>
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
      <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center' }}>
        <span style={{ fontSize:12, color:'#64748b' }}>View:</span>
        {[['compact','📋 Compact'],['hours','🕐 Timeline']].map(([m,l]) => (
          <button key={m} className={`btn btn-sm ${viewMode===m?'btn-primary':'btn-secondary'}`} onClick={()=>setViewMode(m)}>{l}</button>
        ))}
        {viewMode==='hours' && <span style={{ fontSize:11, color:'#64748b', marginLeft:4 }}>Daily: 10am–7pm · Evening OC: 7pm–7am · Weekend OC: 7pm–7am</span>}
      </div>

      {/* ── Week grids ─────────────────────────────────────────────────────── */}
      {weekStarts.map((ws, wi) => {
        const wdates = Array.from({length:8},(_,d) => { const dt=new Date(ws); dt.setDate(ws.getDate()+d); return dt; });
        const weekDateStr = ws.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
        const hourCols = Array.from({length:24},(_,h)=>h);
        const DAY_NAMES  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const MON_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        const getHourActive = (userId, dateStr, hour) => {
          const user = users.find(u=>u.id===userId);
          if (!isOnCallActive(user, dateStr)) return null;
          const hol  = holidays.find(h=>h.userId===userId && dateStr>=h.start && dateStr<=h.end);
          const bh   = (UK_BANK_HOLIDAYS||[]).find(b=>b.date===dateStr);
          const upg  = (upgrades||[]).find(up=>up.date===dateStr && up.attendees?.includes(userId));
          // upgrade is an overlay — use on-call shift for timeline colour, not 'upgrade'
          const thisShift = hol?'holiday':bh?'bankholiday':(rota[userId]?.[dateStr]||'off');
          if (hour>=7) {
            if (thisShift==='daily')   return hour<19?'daily':null;
            if (thisShift==='evening') return hour>=19?'evening':null;
            if (thisShift==='weekend') return hour>=19?'weekend':null;
            if (['upgrade','holiday','bankholiday'].includes(thisShift)) return thisShift;
            return null;
          }
          const prevDate=new Date(dateStr); prevDate.setDate(prevDate.getDate()-1);
          const prevDs=prevDate.toISOString().slice(0,10);
          const pHol=holidays.find(h=>h.userId===userId && prevDs>=h.start && prevDs<=h.end);
          const pBh=(UK_BANK_HOLIDAYS||[]).find(b=>b.date===prevDs);
          const pUpg=(upgrades||[]).find(up=>up.date===prevDs && up.attendees?.includes(userId));
          const prevShift=pHol?'holiday':pBh?'bankholiday':(rota[userId]?.[prevDs]||'off');
          if (prevShift==='evening') return 'evening';
          if (prevShift==='weekend') return 'weekend';
          return null;
        };

        // ── Timeline view ─────────────────────────────────────────────────
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
                      const upg   = (upgrades||[]).find(up=>up.date===ds && up.attendees?.includes(u.id));
                      const active= isOnCallActive(u, ds);
                      const status= getOnCallStatus(u, ds);
                      // Upgrade overlays on-call — don't replace it
                      const shift = hol?'holiday':bh?'bankholiday':(rota[u.id]?.[ds]||'off');
                      const col   = active?SHIFT_COLORS[shift]||{}:SHIFT_COLORS.inactive;
                      const isEditing=editCell?.userId===u.id && editCell?.date===ds;
                      return (
                        <div key={u.id} style={{ display:'flex', alignItems:'center', marginBottom:2 }}>
                          <div style={{ width:100, display:'flex', alignItems:'center', gap:5, flexShrink:0, paddingRight:8 }}>
                            <Avatar user={u} size={16} />
                            <span style={{ fontSize:10, color:active?'#94a3b8':'#334155', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:66 }}>{u.name.split(' ')[0]}</span>
                          </div>
                          <div style={{ flex:1, height:24, borderRadius:4, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)', position:'relative', display:'flex', cursor:canEdit&&active?'pointer':'default', overflow:'hidden' }}
                            onDoubleClick={()=>canEdit&&active&&setEditCell({userId:u.id,date:ds})}>
                            {isEditing&&canEdit ? (
                              <select autoFocus className="select" style={{ fontSize:10, padding:'2px 4px', width:'100%', height:'100%', background:'var(--bg-card2)', border:'none', color:'var(--text-primary)', zIndex:2 }}
                                defaultValue={shift}
                                onChange={e=>setCell(u.id,ds,e.target.value)}
                                onBlur={e=>setCell(u.id,ds,e.target.value)}>
                                <option value="off">Off</option>
                                {!isWkd&&<option value="daily">Daily (10am–7pm)</option>}
                                {(dow>=1&&dow<=4)&&<option value="evening">Weekday OC (7pm–7am)</option>}
                                <option value="weekend">Weekend OC (7pm–7am)</option>
                              </select>
                            ) : !active ? (
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
                                  {upg && !hol && (
                                    <span style={{ fontSize:8, fontWeight:800, color:'#fecaca', background:'rgba(153,27,27,0.85)', padding:'1px 4px', borderRadius:3, textShadow:'none' }}>UD</span>
                                  )}
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
              {canEdit&&<div style={{ fontSize:10, color:'#475569', marginTop:8 }}>💡 Double-click any row to edit that shift</div>}
            </div>
          );
        }

        // ── Compact view ─────────────────────────────────────────────────
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
                      <th key={di} style={{ textAlign:'center', fontSize:10, paddingBottom:6, color:bh?'#fca5a5':isWkd?'rgba(255,255,255,0.35)':'#94a3b8', background:isWkd?'rgba(255,255,255,0.025)':undefined, borderBottom:'1px solid rgba(255,255,255,0.08)', minWidth:68 }}>
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
                          <span style={{ fontSize:12 }}>{u.name.split(' ')[0]}</span>
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
                      // On-call shift independent of upgrade — upgrade overlays on top
                      const onCallShift = hol?'holiday':bh?'bankholiday':(rota[u.id]?.[ds]||'off');
                      const s    = onCallShift; // used for colour/style
                      const col  = active?SHIFT_COLORS[s]||{}:SHIFT_COLORS.inactive;
                      const key  = `${u.id}::${ds}`;
                      const isBulkSel=bulkSelected.has(key);
                      const isEditing=editCell?.userId===u.id && editCell?.date===ds;
                      const dow=d.getDay(); const isWkd=dow===0||dow===6;
                      const isOvernight=(s==='evening'||s==='weekend');
                      const prevDate=new Date(d); prevDate.setDate(d.getDate()-1);
                      const prevDs=prevDate.toISOString().slice(0,10);
                      const prevHol=holidays.find(h=>h.userId===u.id && prevDs>=h.start && prevDs<=h.end);
                      const prevBh=(UK_BANK_HOLIDAYS||[]).find(b=>b.date===prevDs);
                      const prevUpg=(upgrades||[]).find(up=>up.date===prevDs && up.attendees?.includes(u.id));
                      const prevS=prevHol?'holiday':prevBh?'bankholiday':(rota[u.id]?.[prevDs]||'off');
                      const hasCarryOver=(prevS==='evening'||prevS==='weekend') && s==='off' && isOnCallActive(u,prevDs);
                      const prevCol=SHIFT_COLORS[prevS]||{};

                      return (
                        <td key={ds} style={{ textAlign:'center', padding:'3px 2px', background:isWkd?'rgba(255,255,255,0.02)':undefined, verticalAlign:'top' }}>
                          {/* Inactive state */}
                          {!active && !hol && !bh && (
                            <div style={{ background:'rgba(30,41,59,0.6)', borderRadius:5, padding:'4px 4px', fontSize:9, color:'#334155', fontStyle:'italic', minWidth:30 }}>
                              {status?.type==='terminated'?'left':status?.type==='not_started'?'tbc':'—'}
                            </div>
                          )}
                          {/* Active state */}
                          {(active || hol || bh) && (
                            <>
                              {isEditing&&canEdit ? (
                                <select autoFocus className="select" style={{ fontSize:10, padding:'2px 4px', width:100 }}
                                  defaultValue={s} onBlur={e=>setCell(u.id,ds,e.target.value)} onChange={e=>setCell(u.id,ds,e.target.value)}>
                                  <option value="off">Off</option>
                                  {!isWkd&&<option value="daily">Daily (10–19)</option>}
                                  {(dow>=1&&dow<=4)&&<option value="evening">Eve OC (19→07)</option>}
                                  <option value="weekend">Wknd OC (19→07)</option>
                                </select>
                              ) : (
                                <>
                                  <div onClick={()=>canEdit&&active&&toggleBulk(u.id,ds)}
                                    onDoubleClick={()=>canEdit&&active&&setEditCell({userId:u.id,date:ds})}
                                    title={s!=='off'?`${col.label||s}${upg?' + Upgrade':''}`:canEdit?'Double-click to assign':''}
                                    style={{ background:col.bg?col.bg+'55':'transparent', color:col.text||'#475569', border:isBulkSel?'2px solid #3b82f6':col.bg?`1px solid ${col.bg}88`:'1px solid transparent', borderRadius:6, padding:'4px 4px', fontSize:9, fontWeight:800, cursor:canEdit&&active?'pointer':'default', userSelect:'none', lineHeight:1.3, minWidth:30, position:'relative' }}>
                                    {hol ? 'H' : bh ? 'BH' : (SHIFT_ABBR[s]||'—')}
                                    {upg && !hol && (
                                      <span style={{ position:'absolute', top:-4, right:-4, background:'#991b1b', color:'#fecaca', fontSize:7, fontWeight:800, padding:'1px 3px', borderRadius:3, lineHeight:1.2, border:'1px solid rgba(0,0,0,0.3)' }}>UD</span>
                                    )}
                                    {isOvernight&&<div style={{ fontSize:7, color:col.text, opacity:0.8, marginTop:1 }}>→07:00</div>}
                                  </div>
                                  {hasCarryOver&&(
                                    <div style={{ marginTop:2, background:(prevCol.bg||'#166534')+'33', color:prevCol.text||'#bbf7d0', border:`1px solid ${prevCol.bg||'#166534'}66`, borderRadius:6, padding:'2px 4px', fontSize:8, fontWeight:600, lineHeight:1.3 }}>
                                      ←07:00<div style={{ fontSize:7, opacity:0.8 }}>cont.</div>
                                    </div>
                                  )}
                                </>
                              )}
                              {canEdit&&s!=='off'&&!isEditing&&active&&(
                                <div style={{ display:'flex', justifyContent:'center', gap:3, marginTop:2 }}>
                                  <button onClick={e=>{e.stopPropagation();toggleLock(u.id,ds);}} title={isLocked(u.id,ds)?'Unlock':'Lock from Clear/Generate'}
                                    style={{ background:'none', border:'none', fontSize:9, cursor:'pointer', padding:0, color:isLocked(u.id,ds)?'#f59e0b':'rgba(255,255,255,0.25)', lineHeight:1 }}>
                                    {isLocked(u.id,ds)?'🔒':'🔓'}
                                  </button>
                                  <button onClick={()=>deleteCell(u.id,ds)} style={{ background:'none', border:'none', color:'#ef4444', fontSize:8, cursor:'pointer', padding:0 }}>✕</button>
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
      {canEdit&&<div style={{ fontSize:11, color:'#475569', marginTop:8 }}>💡 Click a cell to select for bulk edit · Double-click to edit inline · Click ✕ to delete</div>}
    </div>
  );
}
