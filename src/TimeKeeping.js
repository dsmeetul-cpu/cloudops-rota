// src/TimeKeeping.js
// CloudOps Rota — Time Keeping & Attendance
// Meetul Bhundia (MBA47) · Cloud Run Operations · 11th May 2026

import React, { useState, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI primitives
// ─────────────────────────────────────────────────────────────────────────────
function Avatar({ user, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size > 40 ? 12 : 8,
      background: user?.color || '#1d4ed8', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size > 40 ? 14 : 11,
      fontWeight: 700, color: '#fff', flexShrink: 0, letterSpacing: 0.5,
    }}>{user?.avatar || '?'}</div>
  );
}

function Tag({ label, type = 'blue' }) {
  return <span className={`tag tag-${type}`}>{label}</span>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 680 } : {}}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 20px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

function FormGroup({ label, children, hint }) {
  return (
    <div className="form-group">
      <label className="form-label">
        {label}
        {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function PageHeader({ title, sub, actions }) {
  return (
    <div className="page-header">
      <div className="flex-between">
        <div>
          <div className="page-title">{title}</div>
          {sub && <div className="page-sub">{sub}</div>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent, icon }) {
  return (
    <div className="stat-card">
      <div className="stat-accent" style={{ background: accent }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="stat-label">{label}</div>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status config
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: 'present',  label: 'Present',   icon: '✅', color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.35)'  },
  { value: 'late',     label: 'Late',      icon: '🟡', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)'  },
  { value: 'wfh',      label: 'WFH',       icon: '🏠', color: '#818cf8', bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.35)' },
  { value: 'half-day', label: 'Half Day',  icon: '🌗', color: '#38bdf8', bg: 'rgba(56,189,248,0.12)',  border: 'rgba(56,189,248,0.35)'  },
  { value: 'absent',   label: 'Absent',    icon: '❌', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.35)'   },
];

function statusCfg(val) {
  return STATUS_OPTIONS.find(s => s.value === val) || STATUS_OPTIONS[0];
}

function StatusPill({ status, small }) {
  const s = statusCfg(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: small ? 3 : 4,
      padding: small ? '2px 7px' : '4px 10px',
      borderRadius: 20, fontSize: small ? 10 : 11, fontWeight: 600,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {s.icon} {s.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const todayStr  = () => new Date().toISOString().slice(0, 10);
const nowStr    = () => new Date().toTimeString().slice(0, 5);
const fmtDate   = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtHours  = (ci, co) => {
  if (!ci || !co) return null;
  const [h1, m1] = ci.split(':').map(Number);
  const [h2, m2] = co.split(':').map(Number);
  let m = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (m < 0) m += 1440;
  return `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}m` : ''}`.trim();
};

// Week helpers — Mon–Sun
function getWeekDates(offset = 0) {
  const base = new Date();
  const dow  = (base.getDay() + 6) % 7; // 0=Mon
  base.setDate(base.getDate() - dow + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base); d.setDate(base.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// Month helpers
function getMonthDates(year, month) {
  const first    = new Date(year, month, 1);
  const last     = new Date(year, month + 1, 0);
  const startDow = (first.getDay() + 6) % 7;
  const days     = [];
  for (let pre = startDow - 1; pre >= 0; pre--) {
    const d = new Date(first); d.setDate(1 - pre);
    days.push({ date: d.toISOString().slice(0, 10), isCurrentMonth: false });
  }
  for (let d = 1; d <= last.getDate(); d++) {
    days.push({ date: new Date(year, month, d).toISOString().slice(0, 10), isCurrentMonth: true });
  }
  while (days.length % 7 !== 0) {
    const prev = new Date(days[days.length - 1].date + 'T00:00:00');
    prev.setDate(prev.getDate() + 1);
    days.push({ date: prev.toISOString().slice(0, 10), isCurrentMonth: false });
  }
  return days;
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00').getDay();
  return d === 0 || d === 6;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Engineer weekly table
// ─────────────────────────────────────────────────────────────────────────────
function WeekView({ entries, weekDates, bankHolidays = [] }) {
  const today = todayStr();
  const DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {weekDates.map((d, i) => {
              const bh      = bankHolidays.find(b => b.date === d);
              const isToday = d === today;
              const isSat   = i === 5;
              const isSun   = i === 6;
              return (
                <th key={d} style={{
                  textAlign: 'center', fontSize: 11,
                  color: isToday ? 'var(--accent)' : bh ? '#fca5a5' : (isSat || isSun) ? '#818cf8' : undefined,
                  minWidth: 100,
                }}>
                  {DAYS[i]}<br />
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10 }}>
                    {new Date(d + 'T00:00:00').getDate()} {bh ? '🔴' : ''}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            {weekDates.map((d) => {
              const entry   = entries.find(e => e.date === d);
              const isToday = d === today;
              const isBH    = bankHolidays.some(b => b.date === d);
              const isWE    = isWeekend(d);
              const hrs     = entry ? fmtHours(entry.checkIn, entry.checkOut) : null;

              if (isBH) {
                return (
                  <td key={d} style={{ textAlign: 'center', background: 'rgba(127,29,29,0.15)' }}>
                    <div style={{ fontSize: 10, color: '#fca5a5' }}>Bank Holiday</div>
                  </td>
                );
              }

              return (
                <td key={d} style={{
                  textAlign: 'center', verticalAlign: 'top', padding: '10px 8px',
                  background: isToday ? 'rgba(59,130,246,0.07)' : isWE ? 'rgba(129,140,248,0.04)' : undefined,
                }}>
                  {entry ? (
                    <div>
                      <StatusPill status={entry.status} small />
                      <div style={{ fontFamily: 'DM Mono', fontSize: 11, marginTop: 5, color: 'var(--text-secondary)' }}>
                        {entry.checkIn || '—'} → {entry.checkOut || '…'}
                      </div>
                      {hrs && <div style={{ fontSize: 10, color: '#6ee7b7', marginTop: 3 }}>{hrs}</div>}
                      {entry.confirmedByManager && (
                        <div style={{ fontSize: 9, color: '#10b981', marginTop: 3 }}>✓ Confirmed</div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: isWE ? 'var(--border)' : 'var(--text-muted)' }}>
                      {isWE ? 'Weekend' : d <= today ? '—' : ''}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Monthly calendar grid
// ─────────────────────────────────────────────────────────────────────────────
function MonthView({ entries, year, month, bankHolidays = [] }) {
  const today = todayStr();
  const days  = getMonthDates(year, month);
  const DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 2 }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', padding: '4px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {days.map(({ date, isCurrentMonth }) => {
          const entry   = entries.find(e => e.date === date);
          const isToday = date === today;
          const isBH    = bankHolidays.some(b => b.date === date);
          const isWE    = isWeekend(date);
          const s       = entry ? statusCfg(entry.status) : null;
          const isPast  = date < today;
          const hrs     = entry ? fmtHours(entry.checkIn, entry.checkOut) : null;

          return (
            <div key={date} style={{
              minHeight: 64, borderRadius: 8, padding: '6px 7px', position: 'relative',
              background: isBH ? 'rgba(127,29,29,0.2)' : isToday ? 'rgba(59,130,246,0.12)' : isWE ? 'rgba(129,140,248,0.05)' : 'var(--bg-card2)',
              border: isToday ? '1.5px solid var(--accent)' : '1px solid var(--border)',
              opacity: isCurrentMonth ? 1 : 0.35,
            }}>
              <div style={{
                fontSize: 11, fontWeight: isToday ? 700 : 400,
                color: isToday ? 'var(--accent)' : isBH ? '#fca5a5' : isWE ? '#818cf8' : 'var(--text-muted)',
                marginBottom: 3,
              }}>
                {new Date(date + 'T00:00:00').getDate()}
                {isBH && <span style={{ fontSize: 8, marginLeft: 3 }}>BH</span>}
              </div>
              {entry && s && (
                <div>
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: s.color,
                    background: s.bg, borderRadius: 4, padding: '1px 4px',
                    display: 'inline-block', marginBottom: 2,
                  }}>
                    {s.icon} {s.label}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>
                    {entry.checkIn} {entry.checkOut ? `→ ${entry.checkOut}` : ''}
                  </div>
                  {hrs && <div style={{ fontSize: 8, color: '#6ee7b7' }}>{hrs}</div>}
                </div>
              )}
              {!entry && isPast && isCurrentMonth && !isWE && !isBH && (
                <div style={{ fontSize: 9, color: 'var(--border)' }}>—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function TimeKeeping({ users, currentUser, isManager, bankHolidays = [], timekeeping, setTimekeeping }) {
  const today = todayStr();
  const now   = new Date();

  // ── View state ─────────────────────────────────────────────────────────
  const [tab,         setTab]         = useState('today');       // today | week | month
  const [weekOffset,  setWeekOffset]  = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [filterUser,  setFilterUser]  = useState('all');         // manager: filter by engineer
  const [statusFilter, setStatusFilter] = useState('all');

  // ── Log modal state ────────────────────────────────────────────────────
  const [logModal,  setLogModal]  = useState(false);
  const [editEntry, setEditEntry] = useState(null);             // entry being edited
  const [logForm,   setLogForm]   = useState({
    userId: currentUser, date: today, checkIn: '', checkOut: '', status: 'present', notes: '',
  });

  // ── Confirm modal (manager) ─────────────────────────────────────────────
  const [confirmModal, setConfirmModal] = useState(null);       // { userId, entryId }

  // ── Live clock tick for "currently checked in" display ──────────────────
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // Data helpers
  // ─────────────────────────────────────────────────────────────────────
  const userEntries = (uid) => (timekeeping[uid] || []);

  const todayEntry = (uid) => userEntries(uid).find(e => e.date === today);

  const isCheckedIn  = (uid) => { const e = todayEntry(uid); return e && e.checkIn && !e.checkOut; };
  const isCheckedOut = (uid) => { const e = todayEntry(uid); return e && e.checkIn && e.checkOut; };

  // Week dates for current view
  const weekDates = getWeekDates(weekOffset);

  // Month for current view
  const viewDate    = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const viewYear    = viewDate.getFullYear();
  const viewMonth   = viewDate.getMonth();
  const monthLabel  = viewDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Week label
  const weekStart = weekDates[0];
  const weekEnd   = weekDates[6];
  const weekLabel = `${fmtDate(weekStart)} – ${fmtDate(weekEnd)}`;

  // ─────────────────────────────────────────────────────────────────────
  // Mutations
  // ─────────────────────────────────────────────────────────────────────
  const upsertEntry = (uid, entry) => {
    setTimekeeping(prev => {
      const existing = (prev[uid] || []).filter(e => e.id !== entry.id);
      return { ...prev, [uid]: [...existing, entry].sort((a, b) => b.date.localeCompare(a.date)) };
    });
  };

  // Quick check-in
  const handleCheckIn = () => {
    const entry = todayEntry(currentUser);
    if (entry) {
      // Update existing
      upsertEntry(currentUser, { ...entry, checkIn: nowStr(), status: 'present' });
    } else {
      upsertEntry(currentUser, {
        id: `ck-${currentUser}-${Date.now()}`,
        date: today, checkIn: nowStr(), checkOut: null,
        status: 'present', notes: '', confirmedByManager: false,
      });
    }
  };

  // Quick check-out
  const handleCheckOut = () => {
    const entry = todayEntry(currentUser);
    if (!entry) return;
    upsertEntry(currentUser, { ...entry, checkOut: nowStr() });
  };

  // Save log modal
  const saveLogEntry = () => {
    if (!logForm.date || !logForm.checkIn) return;
    const uid = isManager ? logForm.userId : currentUser;
    const id  = editEntry?.id || `ck-${uid}-${Date.now()}`;
    upsertEntry(uid, {
      id, date: logForm.date, checkIn: logForm.checkIn, checkOut: logForm.checkOut || null,
      status: logForm.status, notes: logForm.notes || '',
      confirmedByManager: editEntry?.confirmedByManager || false,
    });
    setLogModal(false);
    setEditEntry(null);
  };

  const openEditEntry = (uid, entry) => {
    setLogForm({
      userId: uid, date: entry.date,
      checkIn: entry.checkIn || '', checkOut: entry.checkOut || '',
      status: entry.status, notes: entry.notes || '',
    });
    setEditEntry(entry);
    setLogModal(true);
  };

  const openNewLog = () => {
    setLogForm({ userId: currentUser, date: today, checkIn: '', checkOut: '', status: 'present', notes: '' });
    setEditEntry(null);
    setLogModal(true);
  };

  const deleteEntry = (uid, entryId) => {
    if (!window.confirm('Delete this entry?')) return;
    setTimekeeping(prev => ({ ...prev, [uid]: (prev[uid] || []).filter(e => e.id !== entryId) }));
  };

  // Manager: confirm entry
  const confirmEntry = (uid, entryId) => {
    setTimekeeping(prev => ({
      ...prev,
      [uid]: (prev[uid] || []).map(e => e.id === entryId
        ? { ...e, confirmedByManager: true, confirmedAt: new Date().toISOString() }
        : e),
    }));
    setConfirmModal(null);
  };

  // ─────────────────────────────────────────────────────────────────────
  // Derived data for stats
  // ─────────────────────────────────────────────────────────────────────
  const myEntries        = userEntries(currentUser);
  const myTodayEntry     = todayEntry(currentUser);
  const amCheckedIn      = isCheckedIn(currentUser);
  const amCheckedOut     = isCheckedOut(currentUser);

  // Manager stats
  const presentToday     = users.filter(u => todayEntry(u.id)?.status === 'present' || isCheckedIn(u.id)).length;
  const wfhToday         = users.filter(u => todayEntry(u.id)?.status === 'wfh').length;
  const absentToday      = users.filter(u => todayEntry(u.id)?.status === 'absent').length;
  const pendingConfirm   = users.flatMap(u => userEntries(u.id).filter(e => !e.confirmedByManager)).length;

  // My monthly hours
  const myMonthEntries   = myEntries.filter(e => e.date.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`));
  const myMonthHrs       = myMonthEntries.reduce((a, e) => {
    const h = fmtHours(e.checkIn, e.checkOut);
    if (!h) return a;
    const [hrs] = h.split('h');
    return a + parseFloat(hrs || 0);
  }, 0);

  // Week entries filter
  const displayedUsers = isManager
    ? (filterUser === 'all' ? users : users.filter(u => u.id === filterUser))
    : users.filter(u => u.id === currentUser);

  const allTodayEntries = users.map(u => ({ user: u, entry: todayEntry(u.id) }));

  // Status filter for manager today view
  const filteredToday = allTodayEntries.filter(({ entry }) => {
    if (statusFilter === 'all')           return true;
    if (statusFilter === 'in')            return entry && entry.checkIn && !entry.checkOut;
    if (statusFilter === 'out')           return entry && entry.checkIn && entry.checkOut;
    if (statusFilter === 'not-logged')    return !entry;
    return entry?.status === statusFilter;
  });

  // ─────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────
  const SectionTitle = ({ children }) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
      {children}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────
  // ── ENGINEER VIEW ────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────
  if (!isManager) {
    return (
      <div>
        <PageHeader
          title="Time Keeping"
          sub="Log your attendance — check in, check out, and view your history"
          actions={
            <button className="btn btn-secondary btn-sm" onClick={openNewLog}>✏ Log Manually</button>
          }
        />

        {/* ── Today's card ── */}
        <div className="card mb-16" style={{
          borderLeft: `4px solid ${amCheckedOut ? '#10b981' : amCheckedIn ? '#f59e0b' : 'var(--border)'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
              {myTodayEntry ? (
                <div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    <StatusPill status={myTodayEntry.status} />
                    {myTodayEntry.confirmedByManager && (
                      <span style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 3 }}>✓ Manager confirmed</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 1 }}>CHECK IN</div>
                      <div style={{ fontFamily: 'DM Mono', fontSize: 18, fontWeight: 700, color: '#6ee7b7' }}>
                        {myTodayEntry.checkIn || '—'}
                      </div>
                    </div>
                    {myTodayEntry.checkOut && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 1 }}>CHECK OUT</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 18, fontWeight: 700, color: '#fcd34d' }}>
                          {myTodayEntry.checkOut}
                        </div>
                      </div>
                    )}
                    {fmtHours(myTodayEntry.checkIn, myTodayEntry.checkOut) && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 1 }}>DURATION</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>
                          {fmtHours(myTodayEntry.checkIn, myTodayEntry.checkOut)}
                        </div>
                      </div>
                    )}
                  </div>
                  {myTodayEntry.notes && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>📝 {myTodayEntry.notes}</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>You haven't checked in today yet.</div>
              )}
            </div>

            {/* Check-in / Check-out buttons */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              {!amCheckedIn && !amCheckedOut && (
                <button className="btn btn-primary" style={{ fontSize: 15, padding: '10px 20px' }} onClick={handleCheckIn}>
                  ✅ Check In {nowStr()}
                </button>
              )}
              {amCheckedIn && (
                <>
                  <div style={{ fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4, padding: '10px 14px', background: 'rgba(245,158,11,0.1)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.3)' }}>
                    🟡 Checked in since {myTodayEntry.checkIn}
                  </div>
                  <button className="btn btn-secondary" style={{ fontSize: 15, padding: '10px 20px' }} onClick={handleCheckOut}>
                    🔴 Check Out {nowStr()}
                  </button>
                </>
              )}
              {amCheckedOut && (
                <button className="btn btn-secondary btn-sm" onClick={() => openEditEntry(currentUser, myTodayEntry)}>✏ Edit</button>
              )}
            </div>
          </div>
        </div>

        {/* ── View tabs ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {[{ id: 'week', label: '📅 Weekly View' }, { id: 'month', label: '📆 Monthly View' }].map(t => (
            <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Weekly view ── */}
        {tab === 'week' && (
          <div className="card">
            {/* Nav */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(o => o - 1)}>← Prev Week</button>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' }}>
                {weekLabel}
                {weekOffset !== 0 && (
                  <button className="btn btn-secondary btn-sm" style={{ marginLeft: 10 }} onClick={() => setWeekOffset(0)}>Today</button>
                )}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(o => o + 1)}>Next Week →</button>
            </div>

            <WeekView entries={myEntries} weekDates={weekDates} bankHolidays={bankHolidays} />

            {/* Week summary */}
            <div style={{ display: 'flex', gap: 12, marginTop: 14, padding: '10px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              {STATUS_OPTIONS.map(s => {
                const count = weekDates.filter(d => myEntries.find(e => e.date === d)?.status === s.value).length;
                return count > 0 ? (
                  <div key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <span style={{ color: s.color }}>{s.icon}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{s.label}:</span>
                    <span style={{ fontWeight: 600 }}>{count}</span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* ── Monthly view ── */}
        {tab === 'month' && (
          <div>
            {/* Nav + summary */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setMonthOffset(o => o - 1)}>← Prev</button>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{monthLabel}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {myMonthEntries.length} days logged · ≈{Math.round(myMonthHrs)}h total
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setMonthOffset(o => o + 1)}>Next →</button>
            </div>

            {/* Status summary pills */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {STATUS_OPTIONS.map(s => {
                const count = myMonthEntries.filter(e => e.status === s.value).length;
                return count > 0 ? (
                  <div key={s.value} style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600 }}>
                    {s.icon} {s.label}: {count}
                  </div>
                ) : null;
              })}
            </div>

            <div className="card">
              <MonthView entries={myEntries} year={viewYear} month={viewMonth} bankHolidays={bankHolidays} />
            </div>

            {/* Entry list for the month */}
            {myMonthEntries.length > 0 && (
              <div className="card" style={{ marginTop: 12 }}>
                <SectionTitle>All Entries — {monthLabel}</SectionTitle>
                <table>
                  <thead>
                    <tr><th>Date</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Duration</th><th>Confirmed</th><th></th></tr>
                  </thead>
                  <tbody>
                    {myMonthEntries.map(e => (
                      <tr key={e.id}>
                        <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{fmtDate(e.date)}</td>
                        <td><StatusPill status={e.status} small /></td>
                        <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#6ee7b7' }}>{e.checkIn || '—'}</td>
                        <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#fcd34d' }}>{e.checkOut || '—'}</td>
                        <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#a78bfa' }}>{fmtHours(e.checkIn, e.checkOut) || '—'}</td>
                        <td>{e.confirmedByManager ? <Tag label="✓ Confirmed" type="green" /> : <Tag label="Pending" type="amber" />}</td>
                        <td>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditEntry(currentUser, e)}>✏</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Log entry modal ── */}
        {logModal && (
          <Modal title={editEntry ? 'Edit Attendance Entry' : 'Log Attendance'} onClose={() => setLogModal(false)}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormGroup label="Date">
                <input className="input" type="date" max={today} value={logForm.date}
                  onChange={e => setLogForm(f => ({ ...f, date: e.target.value }))} />
              </FormGroup>
              <FormGroup label="Status">
                <select className="select" value={logForm.status} onChange={e => setLogForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
                </select>
              </FormGroup>
              <FormGroup label="Check In Time">
                <input className="input" type="time" value={logForm.checkIn}
                  onChange={e => setLogForm(f => ({ ...f, checkIn: e.target.value }))} />
              </FormGroup>
              <FormGroup label="Check Out Time" hint="leave blank if still in">
                <input className="input" type="time" value={logForm.checkOut}
                  onChange={e => setLogForm(f => ({ ...f, checkOut: e.target.value }))} />
              </FormGroup>
            </div>
            {logForm.checkIn && logForm.checkOut && (
              <div style={{ fontSize: 12, color: '#a78bfa', marginBottom: 12, fontFamily: 'DM Mono' }}>
                ⏱ Duration: {fmtHours(logForm.checkIn, logForm.checkOut)}
              </div>
            )}
            <FormGroup label="Notes (optional)">
              <textarea className="textarea" rows={2} placeholder="Any notes about this session…"
                value={logForm.notes} onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))} />
            </FormGroup>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => setLogModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveLogEntry} disabled={!logForm.date || !logForm.checkIn}>
                {editEntry ? 'Update Entry' : 'Save Entry'}
              </button>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // ── MANAGER VIEW ─────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Time Keeping"
        sub="Team attendance — confirm entries, view individual and team history"
        actions={
          <button className="btn btn-primary" onClick={() => {
            setLogForm({ userId: currentUser, date: today, checkIn: '', checkOut: '', status: 'present', notes: '' });
            setEditEntry(null); setLogModal(true);
          }}>+ Log Entry</button>
        }
      />

      {/* ── Stat cards ── */}
      <div className="grid-4 mb-16">
        <StatCard label="Present Today"     value={presentToday}    sub="checked in"       accent="#10b981" icon="✅" />
        <StatCard label="WFH Today"         value={wfhToday}        sub="working remotely" accent="#818cf8" icon="🏠" />
        <StatCard label="Absent Today"      value={absentToday}     sub="not in"           accent="#ef4444" icon="❌" />
        <StatCard label="Pending Confirm"   value={pendingConfirm}  sub="awaiting review"  accent="#f59e0b" icon="⏳" />
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { id: 'today', label: "📍 Today's Attendance" },
          { id: 'week',  label: '📅 Weekly View' },
          { id: 'month', label: '📆 Monthly View' },
        ].map(t => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}

        {/* Engineer filter (week + month) */}
        {(tab === 'week' || tab === 'month') && (
          <select className="select" value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{ width: 180, marginLeft: 'auto' }}>
            <option value="all">All Engineers</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}

        {/* Status filter (today) */}
        {tab === 'today' && (
          <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 160, marginLeft: 'auto' }}>
            <option value="all">All ({users.length})</option>
            <option value="in">Checked In</option>
            <option value="out">Checked Out</option>
            <option value="not-logged">Not Logged</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
          </select>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TODAY VIEW
      ══════════════════════════════════════════════════════════════════ */}
      {tab === 'today' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {filteredToday.map(({ user: u, entry }) => {
            const checkedIn  = entry && entry.checkIn && !entry.checkOut;
            const checkedOut = entry && entry.checkIn && entry.checkOut;
            const s          = entry ? statusCfg(entry.status) : null;
            const hrs        = entry ? fmtHours(entry.checkIn, entry.checkOut) : null;

            return (
              <div key={u.id} style={{
                background: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px',
                border: `1px solid ${checkedIn ? 'rgba(245,158,11,0.4)' : checkedOut ? 'rgba(16,185,129,0.35)' : 'var(--border)'}`,
                borderLeft: `4px solid ${s ? s.color : 'var(--border)'}`,
              }}>
                {/* User row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Avatar user={u} size={36} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u.id}</div>
                    </div>
                  </div>
                  {entry ? <StatusPill status={entry.status} small /> : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not logged</span>}
                </div>

                {/* Times */}
                {entry ? (
                  <div>
                    <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 1 }}>IN</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 16, fontWeight: 700, color: '#6ee7b7' }}>{entry.checkIn || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 1 }}>OUT</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 16, fontWeight: 700, color: entry.checkOut ? '#fcd34d' : 'var(--text-muted)' }}>
                          {entry.checkOut || (checkedIn ? '…' : '—')}
                        </div>
                      </div>
                      {hrs && (
                        <div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 1 }}>TOTAL</div>
                          <div style={{ fontFamily: 'DM Mono', fontSize: 16, fontWeight: 700, color: '#a78bfa' }}>{hrs}</div>
                        </div>
                      )}
                    </div>
                    {entry.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>📝 {entry.notes}</div>}
                    {/* Confirm / edit row */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {!entry.confirmedByManager ? (
                        <button className="btn btn-success btn-sm" onClick={() => confirmEntry(u.id, entry.id)}>✓ Confirm</button>
                      ) : (
                        <span style={{ fontSize: 11, color: '#10b981' }}>✓ Confirmed {entry.confirmedAt ? new Date(entry.confirmedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      )}
                      <button className="btn btn-secondary btn-sm" onClick={() => openEditEntry(u.id, entry)}>✏</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteEntry(u.id, entry.id)}>🗑</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>No attendance logged for today.</div>
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                      setLogForm({ userId: u.id, date: today, checkIn: '', checkOut: '', status: 'present', notes: '' });
                      setEditEntry(null); setLogModal(true);
                    }}>+ Log for {u.name.split(' ')[0]}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          WEEKLY VIEW
      ══════════════════════════════════════════════════════════════════ */}
      {tab === 'week' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(o => o - 1)}>← Prev Week</button>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' }}>
              {weekLabel}
              {weekOffset !== 0 && <button className="btn btn-secondary btn-sm" style={{ marginLeft: 10 }} onClick={() => setWeekOffset(0)}>This Week</button>}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(o => o + 1)}>Next Week →</button>
          </div>

          {displayedUsers.map(u => (
            <div key={u.id} className="card mb-12">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Avatar user={u} size={30} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {STATUS_OPTIONS.map(s => {
                    const count = weekDates.filter(d => userEntries(u.id).find(e => e.date === d)?.status === s.value).length;
                    return count > 0 ? (
                      <span key={s.value} style={{ fontSize: 10, color: s.color, background: s.bg, padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>
                        {s.icon} {count}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
              <WeekView entries={userEntries(u.id)} weekDates={weekDates} bankHolidays={bankHolidays} />
            </div>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MONTHLY VIEW
      ══════════════════════════════════════════════════════════════════ */}
      {tab === 'month' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setMonthOffset(o => o - 1)}>← Prev</button>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{monthLabel}</div>
            <button className="btn btn-secondary btn-sm" onClick={() => setMonthOffset(o => o + 1)}>Next →</button>
          </div>

          {displayedUsers.map(u => {
            const uEntries      = userEntries(u.id);
            const uMonthEntries = uEntries.filter(e => e.date.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`));
            const uHrs          = uMonthEntries.reduce((a, e) => {
              const h = fmtHours(e.checkIn, e.checkOut);
              if (!h) return a;
              return a + parseFloat(h.split('h')[0] || 0);
            }, 0);
            const uPending = uMonthEntries.filter(e => !e.confirmedByManager).length;

            return (
              <div key={u.id} className="card mb-16">
                {/* Engineer header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Avatar user={u} size={32} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {uMonthEntries.length} days · ≈{Math.round(uHrs)}h
                        {uPending > 0 && <span style={{ color: '#f59e0b', marginLeft: 8 }}>· ⏳ {uPending} unconfirmed</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {STATUS_OPTIONS.map(s => {
                      const count = uMonthEntries.filter(e => e.status === s.value).length;
                      return count > 0 ? (
                        <span key={s.value} style={{ fontSize: 10, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                          {s.icon} {s.label}: {count}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>

                <MonthView entries={uEntries} year={viewYear} month={viewMonth} bankHolidays={bankHolidays} />

                {/* Confirm all / entry table */}
                {uMonthEntries.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Entries</div>
                      {uPending > 0 && (
                        <button className="btn btn-success btn-sm" onClick={() => {
                          uMonthEntries.filter(e => !e.confirmedByManager).forEach(e => confirmEntry(u.id, e.id));
                        }}>✓ Confirm All ({uPending})</button>
                      )}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ fontSize: 12 }}>
                        <thead>
                          <tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Duration</th><th>Notes</th><th>Confirmed</th><th></th></tr>
                        </thead>
                        <tbody>
                          {uMonthEntries.sort((a, b) => a.date.localeCompare(b.date)).map(e => (
                            <tr key={e.id}>
                              <td style={{ fontFamily: 'DM Mono', fontSize: 11 }}>{fmtDate(e.date)}</td>
                              <td><StatusPill status={e.status} small /></td>
                              <td style={{ fontFamily: 'DM Mono', color: '#6ee7b7' }}>{e.checkIn || '—'}</td>
                              <td style={{ fontFamily: 'DM Mono', color: '#fcd34d' }}>{e.checkOut || '—'}</td>
                              <td style={{ fontFamily: 'DM Mono', color: '#a78bfa' }}>{fmtHours(e.checkIn, e.checkOut) || '—'}</td>
                              <td style={{ color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.notes || '—'}</td>
                              <td>
                                {e.confirmedByManager
                                  ? <Tag label="✓ Confirmed" type="green" />
                                  : <button className="btn btn-success btn-sm" onClick={() => confirmEntry(u.id, e.id)}>✓</button>}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button className="btn btn-secondary btn-sm" onClick={() => openEditEntry(u.id, e)}>✏</button>
                                  <button className="btn btn-danger btn-sm" onClick={() => deleteEntry(u.id, e.id)}>🗑</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Log / Edit modal ── */}
      {logModal && (
        <Modal title={editEntry ? 'Edit Attendance Entry' : 'Log Attendance'} onClose={() => setLogModal(false)}>
          {isManager && !editEntry && (
            <FormGroup label="Engineer">
              <select className="select" value={logForm.userId} onChange={e => setLogForm(f => ({ ...f, userId: e.target.value }))}>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </FormGroup>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormGroup label="Date">
              <input className="input" type="date" value={logForm.date}
                onChange={e => setLogForm(f => ({ ...f, date: e.target.value }))} />
            </FormGroup>
            <FormGroup label="Status">
              <select className="select" value={logForm.status} onChange={e => setLogForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Check In Time">
              <input className="input" type="time" value={logForm.checkIn}
                onChange={e => setLogForm(f => ({ ...f, checkIn: e.target.value }))} />
            </FormGroup>
            <FormGroup label="Check Out Time" hint="optional">
              <input className="input" type="time" value={logForm.checkOut}
                onChange={e => setLogForm(f => ({ ...f, checkOut: e.target.value }))} />
            </FormGroup>
          </div>
          {logForm.checkIn && logForm.checkOut && (
            <div style={{ fontSize: 12, color: '#a78bfa', marginBottom: 10, fontFamily: 'DM Mono' }}>
              ⏱ Duration: {fmtHours(logForm.checkIn, logForm.checkOut)}
            </div>
          )}
          <FormGroup label="Notes (optional)">
            <textarea className="textarea" rows={2} placeholder="Any notes…"
              value={logForm.notes} onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setLogModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveLogEntry} disabled={!logForm.date || !logForm.checkIn}>
              {editEntry ? 'Update Entry' : 'Save Entry'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
