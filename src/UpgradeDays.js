// src/UpgradeDays.js
// CloudOps Rota — Upgrade Days Component
// Meetul Bhundia (MBA47) · Cloud Run Operations · 23rd May 2026

import React, { useState } from 'react';

// ── Shared UI primitives ───────────────────────────────────────────────────
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
      <div className="modal" style={wide ? { width: 720 } : {}}>
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

function Alert({ type = 'info', children, style }) {
  const colors = { info: '#1d4ed8', warning: '#92400e', success: '#166534', error: '#991b1b' };
  return (
    <div style={{ background: colors[type] + '33', border: `1px solid ${colors[type]}66`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', ...style }}>
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

function useBulkSelect(items) {
  const [selected, setSelected] = useState(new Set());
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => prev.size === items.length ? new Set() : new Set(items.map(i => i.id)));
  const clearAll  = () => setSelected(new Set());
  return { selected, toggleOne, toggleAll, clearAll };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function upgradeStatus(up) {
  const today = new Date().toISOString().slice(0, 10);
  if (up.date > today) return 'upcoming';
  if (up.date === today) return 'today';
  return 'past';
}

function statusBadge(status) {
  const map = {
    upcoming: { label: 'Upcoming',   bg: '#1e40af55', color: '#bfdbfe', icon: '📅' },
    today:    { label: 'Today',      bg: '#16653455', color: '#6ee7b7', icon: '⚡' },
    past:     { label: 'Completed',  bg: '#37415155', color: '#9ca3af', icon: '✅' },
  };
  const s = map[status] || map.upcoming;
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {s.icon} {s.label}
    </span>
  );
}

// ── UpgradeDays ────────────────────────────────────────────────────────────
export default function UpgradeDays({ users, upgrades, setUpgrades, isManager, currentUser, timesheets, setTimesheets, setRota }) {
  const [showModal,         setShowModal]         = useState(false);
  const [editId,            setEditId]            = useState(null);
  const [form,              setForm]              = useState({ date: '', startTime: '', name: '', desc: '' });
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeForm,      setCompleteForm]      = useState({ upgradeId: '', completedTime: '' });
  const [filter,            setFilter]            = useState('all');
  const [search,            setSearch]            = useState('');
  const { selected, toggleOne, clearAll } = useBulkSelect(upgrades);

  const today = new Date().toISOString().slice(0, 10);

  // ── Derived counts for stat cards ─────────────────────────────────────
  const upcoming      = upgrades.filter(u => u.date >= today);
  const past          = upgrades.filter(u => u.date < today);
  const pendingAll    = upgrades.flatMap(u => (u.engineerTimes || []).filter(e => !e.approved));
  const totalHrsApproved = upgrades.flatMap(u => (u.engineerTimes || []).filter(e => e.approved)).reduce((a, e) => a + (e.hours || 0), 0);

  // ── Filter logic ───────────────────────────────────────────────────────
  const FILTERS = [
    { id: 'all',      label: 'All',              count: upgrades.length },
    { id: 'upcoming', label: 'Upcoming',         count: upcoming.length },
    { id: 'today',    label: 'Today',            count: upgrades.filter(u => u.date === today).length },
    { id: 'past',     label: 'Past',             count: past.length },
    { id: 'pending',  label: 'Pending Approval', count: pendingAll.length },
    { id: 'mine',     label: 'My Upgrades',      count: upgrades.filter(u => (u.attendees || []).includes(currentUser)).length },
  ];

  const filtered = upgrades
    .filter(u => {
      const status = upgradeStatus(u);
      if (filter === 'upcoming') return u.date >= today;
      if (filter === 'today')    return u.date === today;
      if (filter === 'past')     return u.date < today;
      if (filter === 'pending')  return (u.engineerTimes || []).some(e => !e.approved);
      if (filter === 'mine')     return (u.attendees || []).includes(currentUser);
      return true;
    })
    .filter(u => !search || u.name.toLowerCase().includes(search.toLowerCase()) || (u.desc || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      // Upcoming first (ascending), past last (descending)
      if (a.date >= today && b.date >= today) return a.date.localeCompare(b.date);
      if (a.date < today  && b.date < today)  return b.date.localeCompare(a.date);
      return a.date >= today ? -1 : 1;
    });

  // ── CRUD actions ───────────────────────────────────────────────────────
  const openAdd  = () => { setForm({ date: '', startTime: '', name: '', desc: '' }); setEditId(null); setShowModal(true); };
  const openEdit = (up, e) => { e.stopPropagation(); setForm({ date: up.date, startTime: up.startTime || '', name: up.name, desc: up.desc || '' }); setEditId(up.id); setShowModal(true); };

  const save = () => {
    if (!form.date || !form.name || !form.startTime) return;
    if (editId) {
      const existing = upgrades.find(u => u.id === editId);
      // If the date changed, move all attendees' rota 'upgrade' entries to the new date
      if (setRota && existing && existing.date !== form.date && (existing.attendees || []).length > 0) {
        setRota(prev => {
          const next = { ...prev };
          (existing.attendees || []).forEach(uid => {
            // Remove from old date
            if (next[uid]?.[existing.date] === 'upgrade') {
              next[uid] = { ...next[uid] };
              delete next[uid][existing.date];
            }
            // Apply to new date
            next[uid] = { ...(next[uid] || {}), [form.date]: 'upgrade' };
          });
          return next;
        });
      }
      setUpgrades(upgrades.map(u => u.id === editId ? { ...u, ...form } : u));
    } else {
      setUpgrades([...upgrades, { id: 'u' + Date.now(), ...form, attendees: [], engineerTimes: [] }]);
    }
    setShowModal(false);
  };

  const deleteOne  = (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this upgrade day?')) return;
    const upgrade = upgrades.find(u => u.id === id);
    // Remove 'upgrade' rota entries for all attendees on this date
    if (setRota && upgrade && (upgrade.attendees || []).length > 0) {
      setRota(prev => {
        const next = { ...prev };
        (upgrade.attendees || []).forEach(uid => {
          if (next[uid]?.[upgrade.date] === 'upgrade') {
            next[uid] = { ...next[uid] };
            delete next[uid][upgrade.date];
          }
        });
        return next;
      });
    }
    setUpgrades(upgrades.filter(u => u.id !== id));
  };
  const deleteBulk = () => {
    if (!window.confirm(`Delete ${selected.size} upgrade days?`)) return;
    const toDelete = upgrades.filter(u => selected.has(u.id));
    // Remove 'upgrade' rota entries for all attendees of all deleted upgrade days
    if (setRota && toDelete.length > 0) {
      setRota(prev => {
        const next = { ...prev };
        toDelete.forEach(upgrade => {
          (upgrade.attendees || []).forEach(uid => {
            if (next[uid]?.[upgrade.date] === 'upgrade') {
              next[uid] = { ...next[uid] };
              delete next[uid][upgrade.date];
            }
          });
        });
        return next;
      });
    }
    setUpgrades(upgrades.filter(u => !selected.has(u.id)));
    clearAll();
  };

  const toggleAttend = (upgradeId, uid) => {
    const upgrade    = upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return;
    const isAttending = (upgrade.attendees || []).includes(uid);

    setUpgrades(upgrades.map(u =>
      u.id !== upgradeId ? u : {
        ...u, attendees: isAttending
          ? (u.attendees || []).filter(x => x !== uid)
          : [...(u.attendees || []), uid],
      }
    ));

    // ── Sync rota ────────────────────────────────────────────────────────
    // Adding attendee  → mark their rota cell as 'upgrade' for the upgrade date
    // Removing attendee → clear the 'upgrade' shift (only if it is still 'upgrade',
    //   so we never accidentally wipe a manually-set shift that differs)
    if (setRota) {
      setRota(prev => {
        const userRota = { ...(prev[uid] || {}) };
        if (isAttending) {
          // Removing: only clear if it was set to 'upgrade' by this system
          if (userRota[upgrade.date] === 'upgrade') delete userRota[upgrade.date];
        } else {
          // Adding: stamp as 'upgrade'
          userRota[upgrade.date] = 'upgrade';
        }
        return { ...prev, [uid]: userRota };
      });
    }
  };

  const openComplete = (upgradeId) => { setCompleteForm({ upgradeId, completedTime: '' }); setShowCompleteModal(true); };

  const saveCompletedTime = () => {
    if (!completeForm.completedTime) return;
    const upgrade = upgrades.find(u => u.id === completeForm.upgradeId);
    if (!upgrade) return;
    const [startH, startM] = (upgrade.startTime || '00:00').split(':').map(Number);
    const [endH,   endM]   = completeForm.completedTime.split(':').map(Number);
    let hrs = (endH * 60 + endM - startH * 60 - startM) / 60;
    if (hrs < 0) hrs += 24;
    hrs = Math.round(hrs * 4) / 4;
    const existing = (upgrade.engineerTimes || []).filter(e => e.engineerId !== currentUser);
    const newEntry = {
      engineerId:    currentUser,
      completedTime: completeForm.completedTime,
      hours:         hrs,
      approved:      isManager,
      submittedAt:   new Date().toISOString(),
    };
    setUpgrades(upgrades.map(u => u.id === completeForm.upgradeId ? { ...u, engineerTimes: [...existing, newEntry] } : u));
    setShowCompleteModal(false);
    if (isManager) applyUpgradeToTimesheet(upgrade, newEntry);
  };

  const applyUpgradeToTimesheet = (upgrade, entry) => {
    if (!setTimesheets) return;
    const dow   = new Date(upgrade.date).getDay();
    const isWE  = dow === 0 || dow === 6;
    const label = `UPG ${upgrade.id} ${upgrade.name.slice(0, 20)}`;
    setTimesheets(prev => ({
      ...prev,
      [entry.engineerId]: [
        {
          week:           label,
          weekday_oncall: isWE ? 0 : entry.hours,
          weekend_oncall: isWE ? entry.hours : 0,
          worked_wd:      isWE ? 0 : entry.hours,
          worked_we:      isWE ? entry.hours : 0,
          standby_wd: 0, standby_we: 0,
          notes:    `Upgrade: ${upgrade.name} on ${upgrade.date} (${entry.hours}h)`,
          upgradeId: upgrade.id,
        },
        ...(prev[entry.engineerId] || []).filter(e => e.upgradeId !== upgrade.id),
      ],
    }));
  };

  const approveTime = (upgradeId, engineerId, approve) => {
    const upgrade = upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return;
    const updated = (upgrade.engineerTimes || []).map(e =>
      e.engineerId === engineerId ? { ...e, approved: approve, reviewedAt: new Date().toISOString() } : e
    );
    setUpgrades(upgrades.map(u => u.id === upgradeId ? { ...u, engineerTimes: updated } : u));
    if (approve) {
      const entry = updated.find(e => e.engineerId === engineerId);
      if (entry) applyUpgradeToTimesheet(upgrade, entry);
    } else {
      if (setTimesheets) {
        setTimesheets(prev => ({
          ...prev,
          [engineerId]: (prev[engineerId] || []).filter(e => e.upgradeId !== upgradeId),
        }));
      }
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Upgrade Days"
        sub="Schedule and track system upgrade days — hours auto-added to payroll on approval"
        actions={<>
          {isManager && selected.size > 0 && (
            <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>
          )}
          {isManager && (
            <button className="btn btn-primary" onClick={openAdd}>+ Add Upgrade Day</button>
          )}
        </>}
      />

      {/* Stat Cards */}
      <div className="grid-4 mb-16">
        <StatCard label="Total"           value={upgrades.length}   sub="all time"               accent="#991b1b" icon="⬆" />
        <StatCard label="Upcoming"        value={upcoming.length}   sub="scheduled ahead"        accent="#1e40af" icon="📅" />
        <StatCard label="Pending Approval" value={pendingAll.length} sub="engineer times awaiting" accent="#f59e0b" icon="⏳" />
        <StatCard label="Hours Approved"  value={totalHrsApproved + 'h'} sub="added to payroll"  accent="#166534" icon="✅" />
      </div>

      {/* Workflow hint */}
      <Alert type="info" style={{ marginBottom: 16 }}>
        ℹ <strong>Workflow:</strong> Manager adds upgrade day → Engineers attend &amp; log completed time → Manager approves → Hours added to payroll automatically. Manager's own time is auto-approved.
      </Alert>

      {/* Filter tabs + search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.id}
              className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(f.id)}
              style={{ position: 'relative' }}>
              {f.label}
              {f.count > 0 && (
                <span style={{
                  marginLeft: 6, background: filter === f.id ? 'rgba(255,255,255,0.25)' : 'var(--bg-card)',
                  color: filter === f.id ? '#fff' : 'var(--text-muted)',
                  borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700,
                }}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <input
          className="input"
          placeholder="🔍 Search upgrades…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 200, marginLeft: 'auto' }}
        />
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⬆</div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {upgrades.length === 0 ? 'No upgrade days scheduled yet' : 'No upgrade days match this filter'}
          </div>
          {isManager && upgrades.length === 0 && (
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={openAdd}>+ Add First Upgrade Day</button>
          )}
        </div>
      )}

      {/* Upgrade Day Cards */}
      {filtered.map(up => {
        const status         = upgradeStatus(up);
        const myTime         = (up.engineerTimes || []).find(e => e.engineerId === currentUser);
        const approvedTimes  = (up.engineerTimes || []).filter(e => e.approved);
        const pendingTimes   = (up.engineerTimes || []).filter(e => !e.approved);
        const totalHrs       = approvedTimes.reduce((a, e) => a + (e.hours || 0), 0);
        const iAmAttending   = (up.attendees || []).includes(currentUser);

        return (
          <div key={up.id} className="card mb-16" style={{
            borderLeft: `4px solid ${status === 'today' ? '#10b981' : status === 'upcoming' ? '#1d4ed8' : '#374151'}`,
          }}>

            {/* ── Card Header ─────────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1 }}>
                {isManager && (
                  <input type="checkbox" checked={selected.has(up.id)} onChange={() => toggleOne(up.id)} style={{ marginTop: 5, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                    {statusBadge(status)}
                    <span style={{ background: '#991b1b55', color: '#fecaca', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                      ⬆ Upgrade Day
                    </span>
                    {pendingTimes.length > 0 && isManager && (
                      <span style={{ background: 'rgba(245,158,11,0.2)', color: '#fcd34d', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                        ⏳ {pendingTimes.length} Pending
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fecaca', marginBottom: 4 }}>{up.name}</div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono', display: 'flex', alignItems: 'center', gap: 4 }}>
                      📅 {new Date(up.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    {up.startTime && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono', display: 'flex', alignItems: 'center', gap: 4 }}>
                        🕐 Start: {up.startTime}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: 4 }}>
                      👥 {(up.attendees || []).length} attending
                    </span>
                    {totalHrs > 0 && (
                      <span style={{ fontSize: 12, color: '#6ee7b7', fontFamily: 'DM Mono' }}>
                        ✅ {totalHrs}h approved
                      </span>
                    )}
                  </div>
                  {up.desc && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, padding: '6px 10px', background: 'var(--bg-card2)', borderRadius: 6, borderLeft: '3px solid var(--border)' }}>
                      {up.desc}
                    </div>
                  )}
                </div>
              </div>
              {isManager && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-secondary btn-sm" onClick={e => openEdit(up, e)} title="Edit">✏</button>
                  <button className="btn btn-danger btn-sm"    onClick={e => deleteOne(up.id, e)} title="Delete">🗑</button>
                </div>
              )}
            </div>

            {/* ── Attendees Grid ──────────────────────────────────── */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Attendees {isManager ? '— click to toggle' : ''}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                {users.map(u => {
                  const attending = (up.attendees || []).includes(u.id);
                  const eTime     = (up.engineerTimes || []).find(e => e.engineerId === u.id);
                  return (
                    <div key={u.id}
                      onClick={() => isManager && toggleAttend(up.id, u.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                        border: `1px solid ${attending ? (eTime?.approved ? '#10b981' : eTime ? '#f59e0b' : 'var(--accent3)') : 'var(--border)'}`,
                        background: attending ? (eTime?.approved ? 'rgba(16,185,129,.1)' : eTime ? 'rgba(245,158,11,.08)' : 'rgba(0,194,255,.07)') : 'var(--bg-card2)',
                        cursor: isManager ? 'pointer' : 'default',
                        transition: 'all 0.15s',
                      }}>
                      <Avatar user={u} size={26} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: attending ? '#e2e8f0' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {u.name.split(' ')[0]}
                          {attending && !eTime && <span style={{ color: 'var(--accent)', fontSize: 10 }}>✓</span>}
                        </div>
                        {eTime ? (
                          <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: eTime.approved ? '#6ee7b7' : '#fcd34d', marginTop: 1 }}>
                            {eTime.completedTime} · {eTime.hours}h · {eTime.approved ? '✅' : '⏳'}
                          </div>
                        ) : attending ? (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>No time logged</div>
                        ) : (
                          <div style={{ fontSize: 10, color: 'var(--border)', marginTop: 1 }}>Not attending</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Engineer: Log My Time ────────────────────────────── */}
            {iAmAttending && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                {myTime ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
                    padding: '10px 14px', borderRadius: 8,
                    background: myTime.approved ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.08)',
                    border: `1px solid ${myTime.approved ? '#10b981' : '#f59e0b'}44`,
                  }}>
                    <div style={{ fontSize: 12, color: myTime.approved ? '#6ee7b7' : '#fcd34d' }}>
                      {myTime.approved
                        ? `✅ Your time: finished at ${myTime.completedTime} — ${myTime.hours}h approved & added to payroll`
                        : `⏳ Your time: finished at ${myTime.completedTime} — ${myTime.hours}h awaiting manager approval`}
                    </div>
                    {!myTime.approved && (
                      <button className="btn btn-secondary btn-sm" onClick={() => openComplete(up.id)}>✏ Update</button>
                    )}
                  </div>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => openComplete(up.id)}>
                    🕐 Log My Completed Time
                  </button>
                )}
              </div>
            )}

            {/* ── Manager: Pending Approvals ───────────────────────── */}
            {isManager && pendingTimes.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#fcd34d', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  ⏳ Pending Approval — {pendingTimes.length} submission{pendingTimes.length > 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pendingTimes.map(e => {
                    const eng = users.find(u => u.id === e.engineerId);
                    return (
                      <div key={e.engineerId} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        background: 'rgba(252,211,77,0.08)', borderRadius: 8,
                        border: '1px solid rgba(252,211,77,0.2)',
                      }}>
                        <Avatar user={eng} size={28} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{eng?.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>
                            Finished at <strong style={{ color: 'var(--text-secondary)' }}>{e.completedTime}</strong>
                            {' · '}
                            <strong style={{ color: '#fcd34d' }}>{e.hours}h</strong>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-success btn-sm" onClick={() => approveTime(up.id, e.engineerId, true)}>✓ Approve</button>
                          <button className="btn btn-danger  btn-sm" onClick={() => approveTime(up.id, e.engineerId, false)}>✗ Reject</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Add / Edit Modal ─────────────────────────────────────────────── */}
      {showModal && isManager && (
        <Modal title={editId ? 'Edit Upgrade Day' : 'Add Upgrade Day'} onClose={() => setShowModal(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormGroup label="Date">
              <input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </FormGroup>
            <FormGroup label="Start Time" hint="When the upgrade begins">
              <input className="input" type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} />
            </FormGroup>
          </div>
          <FormGroup label="Upgrade Name">
            <input className="input" placeholder="e.g. Global Q3 System Upgrade" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </FormGroup>
          <FormGroup label="Description (optional)">
            <textarea className="textarea" rows={3} placeholder="Brief description of what will be upgraded…" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} />
          </FormGroup>
          {(!form.date || !form.startTime || !form.name) && (
            <Alert type="warning" style={{ marginTop: 8 }}>⚠ Date, start time and name are all required.</Alert>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!form.date || !form.startTime || !form.name}>
              {editId ? 'Update Upgrade Day' : 'Add Upgrade Day'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Log Completed Time Modal ─────────────────────────────────────── */}
      {showCompleteModal && (() => {
        const up = upgrades.find(u => u.id === completeForm.upgradeId);
        let preview = null;
        if (completeForm.completedTime && up?.startTime) {
          const [sh, sm] = up.startTime.split(':').map(Number);
          const [eh, em] = completeForm.completedTime.split(':').map(Number);
          let hrs = (eh * 60 + em - sh * 60 - sm) / 60;
          if (hrs < 0) hrs += 24;
          preview = Math.round(hrs * 4) / 4;
        }
        return (
          <Modal title="Log My Completed Time" onClose={() => setShowCompleteModal(false)}>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(153,27,27,0.15)', border: '1px solid rgba(153,27,27,0.3)', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fecaca', marginBottom: 2 }}>{up?.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>
                📅 {up?.date} · 🕐 Started at {up?.startTime || 'N/A'}
              </div>
            </div>
            <FormGroup label="Your Finish Time" hint="HH:MM — when you completed the upgrade">
              <input className="input" type="time" value={completeForm.completedTime}
                onChange={e => setCompleteForm({ ...completeForm, completedTime: e.target.value })} />
            </FormGroup>
            {preview !== null && (
              <Alert type="info" style={{ marginBottom: 8 }}>
                ⏱ Calculated duration: <strong>{preview}h</strong>
                {isManager ? ' — will be auto-approved.' : ' — will be submitted for manager approval.'}
              </Alert>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => setShowCompleteModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCompletedTime} disabled={!completeForm.completedTime}>
                Submit Time
              </button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
