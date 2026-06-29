// src/Incidents.js
// CloudOps Rota — Incidents Component
// Meetul Bhundia (MBA47) · Cloud Run Operations · June 2026
//
// Features:
//  • Shared Drive-backed state (incidents array)
//  • Real-time polling every 15 s so all engineers see live updates
//  • Daily Incidents toggle (separate from payroll incidents)
//  • Whole-number hours only (1, 2, 3 … no .5 or 1.5)
//  • Manager can create/edit/delete; engineers can log their own + view all

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { driveRead } from './hooks/useGoogleDrive';

// ── Constants ────────────────────────────────────────────────────────────
const SEVERITIES = ['Disaster', 'Critical', 'High', 'Medium', 'Low'];
const STATUSES   = ['Investigating', 'Identified', 'Monitoring', 'Resolved'];
const HOURS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const SEV_COLOR = {
  Disaster: { bg: 'rgba(216,90,48,0.18)',  text: '#fca5a5', border: '#ef4444' },
  Critical: { bg: 'rgba(186,117,23,0.18)', text: '#fcd34d', border: '#f59e0b' },
  High:     { bg: 'rgba(55,138,221,0.18)', text: '#93c5fd', border: '#3b82f6' },
  Medium:   { bg: 'rgba(29,158,117,0.18)', text: '#6ee7b7', border: '#10b981' },
  Low:      { bg: 'rgba(136,135,128,0.18)',text: '#94a3b8', border: '#64748b' },
};

const STATUS_COLOR = {
  Investigating: { bg: '#7f1d1d33', text: '#fca5a5', border: '#ef4444' },
  Identified:    { bg: '#92400e33', text: '#fcd34d', border: '#f59e0b' },
  Monitoring:    { bg: '#1e3a8a33', text: '#93c5fd', border: '#3b82f6' },
  Resolved:      { bg: '#14532d33', text: '#86efac', border: '#22c55e' },
};

// Daily incident types (separate from on-call incidents that go to payroll)
const DAILY_TYPES = [
  { id: 'deployment', label: 'Deployment', icon: '🚀' },
  { id: 'service_down', label: 'Service Down', icon: '🔴' },
  { id: 'performance', label: 'Performance', icon: '📉' },
  { id: 'security', label: 'Security', icon: '🔐' },
  { id: 'data', label: 'Data Issue', icon: '🗄️' },
  { id: 'network', label: 'Network', icon: '🌐' },
  { id: 'config', label: 'Config Change', icon: '⚙️' },
  { id: 'other', label: 'Other', icon: '📌' },
];

const BLANK_INCIDENT = {
  title: '', severity: 'High', status: 'Investigating', assigned_to: '',
  date: new Date().toISOString().slice(0, 10), description: '', resolution: '',
  hours: 1, isDaily: false, dailyType: 'other',
};

// ── Shared UI ─────────────────────────────────────────────────────────────
function Avatar({ user, size = 28 }) {
  if (!user) return null;
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.3),
      background: user.color || '#1d4ed8',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.38), fontWeight: 700, color: '#fff', flexShrink: 0,
    }}>{user.avatar || user.id?.slice(0, 2)}</div>
  );
}

function SevBadge({ severity }) {
  const c = SEV_COLOR[severity] || SEV_COLOR.Low;
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{severity}</span>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.Investigating;
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{status}</span>
  );
}

function StatCard({ label, value, sub, accent = 'var(--accent)', icon }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 110, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
        {icon && <span style={{ marginRight: 4 }}>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────
export default function Incidents({
  incidents, setIncidents,
  users, currentUser, isManager,
  driveToken,
  timesheets, setTimesheets,
  addLog,
}) {
  const [view,        setView]        = useState('all');    // 'all' | 'daily' | 'oncall'
  const [showModal,   setShowModal]   = useState(false);
  const [editId,      setEditId]      = useState(null);
  const [form,        setForm]        = useState({ ...BLANK_INCIDENT });
  const [filter,      setFilter]      = useState({ status: 'all', severity: 'all', uid: 'all' });
  const [notify,      setNotify]      = useState('');
  const [lastSync,    setLastSync]    = useState(null);
  const [syncing,     setSyncing]     = useState(false);
  const pollRef = useRef(null);
  const notifyTimer = useRef(null);

  const safe = Array.isArray(incidents) ? incidents : [];

  // ── Real-time polling (every 15s) ──────────────────────────────────────
  const pollDrive = useCallback(async () => {
    if (!driveToken) return;
    try {
      setSyncing(true);
      const data = await driveRead(driveToken, 'incidents').catch(() => null);
      if (Array.isArray(data)) {
        setIncidents(data);
        setLastSync(new Date());
      }
    } catch (_) {}
    finally { setSyncing(false); }
  }, [driveToken, setIncidents]);

  useEffect(() => {
    pollDrive(); // immediate on mount
    pollRef.current = setInterval(pollDrive, 15000);
    return () => clearInterval(pollRef.current);
  }, [pollDrive]);

  // ── Notifications ──────────────────────────────────────────────────────
  const showNotify = (msg) => {
    setNotify(msg);
    clearTimeout(notifyTimer.current);
    notifyTimer.current = setTimeout(() => setNotify(''), 3500);
  };

  const currentUserObj = users.find(u => u.id === currentUser);

  // ── CRUD ───────────────────────────────────────────────────────────────
  const openAdd = () => {
    setForm({
      ...BLANK_INCIDENT,
      assigned_to: isManager ? (users[0]?.id || currentUser) : currentUser,
      isDaily: view === 'daily',
      date: new Date().toISOString().slice(0, 10),
    });
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (inc) => {
    setForm({ ...BLANK_INCIDENT, ...inc });
    setEditId(inc.id);
    setShowModal(true);
  };

  const saveIncident = () => {
    if (!form.title.trim())       { showNotify('⚠ Title is required.'); return; }
    if (!form.assigned_to)        { showNotify('⚠ Assignee is required.'); return; }
    if (!form.date)               { showNotify('⚠ Date is required.'); return; }
    if (!isManager && form.assigned_to !== currentUser) {
      showNotify('⚠ You can only log incidents for yourself.');
      return;
    }

    const entry = {
      ...form,
      id:         editId || `inc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      hours:      Number(form.hours) || 1,
      updated_at: new Date().toISOString(),
      created_at: editId ? (safe.find(i => i.id === editId)?.created_at || new Date().toISOString()) : new Date().toISOString(),
    };

    const updated = editId
      ? safe.map(i => i.id === editId ? entry : i)
      : [entry, ...safe];

    setIncidents(updated);
    setShowModal(false);
    showNotify(editId ? '✅ Incident updated.' : '✅ Incident logged.');

    addLog?.({
      section: 'incidents', level: 'info',
      action: editId ? 'Edit incident' : 'Log incident',
      detail: `${entry.severity} — "${entry.title}" assigned to ${users.find(u => u.id === entry.assigned_to)?.name || entry.assigned_to}`,
    });
  };

  const deleteIncident = (id) => {
    if (!isManager) { showNotify('⚠ Only the manager can delete incidents.'); return; }
    if (!window.confirm('Delete this incident?')) return;
    const entry = safe.find(i => i.id === id);
    setIncidents(safe.filter(i => i.id !== id));
    showNotify('🗑 Incident deleted.');
    addLog?.({
      section: 'incidents', level: 'warning',
      action: 'Delete incident',
      detail: `"${entry?.title || id}"`,
    });
  };

  const resolveIncident = (id) => {
    setIncidents(safe.map(i => i.id === id
      ? { ...i, status: 'Resolved', updated_at: new Date().toISOString() }
      : i
    ));
    showNotify('✅ Marked as Resolved.');
  };

  // ── Filter ─────────────────────────────────────────────────────────────
  const viewFiltered = safe.filter(i => {
    if (view === 'daily')  return i.isDaily === true;
    if (view === 'oncall') return !i.isDaily;
    return true;
  });

  const displayed = viewFiltered.filter(i => {
    if (filter.status   !== 'all' && i.status   !== filter.status)   return false;
    if (filter.severity !== 'all' && i.severity !== filter.severity) return false;
    if (filter.uid      !== 'all' && i.assigned_to !== filter.uid)   return false;
    return true;
  });

  const sorted = [...displayed].sort((a, b) => {
    const sevOrd = { Disaster: 0, Critical: 1, High: 2, Medium: 3, Low: 4 };
    const statusOrd = { Investigating: 0, Identified: 1, Monitoring: 2, Resolved: 3 };
    const sA = (statusOrd[a.status] ?? 9);
    const sB = (statusOrd[b.status] ?? 9);
    if (sA !== sB) return sA - sB;
    return (sevOrd[a.severity] ?? 9) - (sevOrd[b.severity] ?? 9);
  });

  // ── Stats ──────────────────────────────────────────────────────────────
  const openCount     = safe.filter(i => i.status === 'Investigating').length;
  const resolvedCount = safe.filter(i => i.status === 'Resolved').length;
  const todayStr      = new Date().toISOString().slice(0, 10);
  const todayCount    = safe.filter(i => (i.date || '').slice(0, 10) === todayStr).length;
  const dailyCount    = safe.filter(i => i.isDaily).length;

  const setF = (k, v) => setFilter(f => ({ ...f, [k]: v }));

  return (
    <div>
      {/* Notification toast */}
      {notify && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '10px 18px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', maxWidth: 320,
        }}>{notify}</div>
      )}

      {/* Header */}
      <div className="page-header">
        <div className="flex-between">
          <div>
            <div className="page-title">🚨 Incidents</div>
            <div className="page-sub">
              Log and track on-call &amp; daily incidents
              {lastSync && (
                <span style={{ marginLeft: 10, fontSize: 10, color: 'var(--text-muted)' }}>
                  {syncing ? '⏳ syncing…' : `● live · last sync ${lastSync.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`}
                </span>
              )}
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Log Incident</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Open"      value={openCount}     sub="Investigating"  accent="#ef4444" icon="🚨" />
        <StatCard label="Resolved"  value={resolvedCount} sub="Closed"         accent="#22c55e" icon="✅" />
        <StatCard label="Today"     value={todayCount}    sub="Logged today"   accent="#f59e0b" icon="📅" />
        <StatCard label="Daily"     value={dailyCount}    sub="Ops incidents"  accent="#818cf8" icon="📋" />
        <StatCard label="Total"     value={safe.length}   sub="All time"       accent="var(--accent)" icon="📊" />
      </div>

      {/* View tabs + filters */}
      <div className="card" style={{ padding: '10px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, marginRight: 8 }}>
            {[
              { id: 'all',    label: 'All' },
              { id: 'daily',  label: '📋 Daily' },
              { id: 'oncall', label: '🚨 On-Call' },
            ].map(t => (
              <button key={t.id}
                className={`btn btn-sm ${view === t.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setView(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <select className="form-input" style={{ width: 140 }} value={filter.status} onChange={e => setF('status', e.target.value)}>
            <option value="all">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="form-input" style={{ width: 120 }} value={filter.severity} onChange={e => setF('severity', e.target.value)}>
            <option value="all">All Severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="form-input" style={{ width: 150 }} value={filter.uid} onChange={e => setF('uid', e.target.value)}>
            <option value="all">All Engineers</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {(filter.status !== 'all' || filter.severity !== 'all' || filter.uid !== 'all') && (
            <button className="btn btn-secondary btn-sm" onClick={() => setFilter({ status:'all', severity:'all', uid:'all' })}>
              ✕ Clear
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
            {sorted.length} shown
          </span>
        </div>
      </div>

      {/* Incident list */}
      {sorted.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎉</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No incidents match your filters</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Log an incident using the button above.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sorted.map(inc => {
          const assignee = users.find(u => u.id === inc.assigned_to);
          const canEdit  = isManager || inc.assigned_to === currentUser;
          const dailyT   = DAILY_TYPES.find(t => t.id === inc.dailyType);
          return (
            <div key={inc.id} className="card" style={{
              borderLeft: `3px solid ${SEV_COLOR[inc.severity]?.border || '#64748b'}`,
              padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  {/* Title row */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                    {inc.isDaily && (
                      <span style={{ fontSize: 10, background: '#1e40af33', border: '1px solid #3b82f6', color: '#93c5fd', borderRadius: 5, padding: '1px 6px', fontWeight: 600 }}>
                        {dailyT?.icon || '📋'} Daily
                      </span>
                    )}
                    <SevBadge severity={inc.severity} />
                    <StatusBadge status={inc.status} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>
                      {(inc.date || inc.created_at || '').slice(0, 10)}
                    </span>
                    {!inc.isDaily && inc.hours > 0 && (
                      <span style={{ fontSize: 11, color: '#fcd34d', background: '#92400e22', border: '1px solid #f59e0b', borderRadius: 5, padding: '1px 6px' }}>
                        ⏱ {inc.hours}h
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                    {inc.title}
                  </div>

                  {inc.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.5 }}>
                      {inc.description}
                    </div>
                  )}

                  {inc.status === 'Resolved' && inc.resolution && (
                    <div style={{ fontSize: 11, color: '#86efac', background: '#14532d22', border: '1px solid #22c55e', borderRadius: 6, padding: '6px 10px', marginTop: 4 }}>
                      ✅ <strong>Resolution:</strong> {inc.resolution}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <Avatar user={assignee} size={22} />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {assignee?.name || inc.assigned_to}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexDirection: 'column' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(inc)}>✏ Edit</button>
                    {inc.status !== 'Resolved' && (
                      <button className="btn btn-sm" style={{ background: '#14532d', color: '#86efac', border: '1px solid #22c55e' }}
                        onClick={() => resolveIncident(inc.id)}>
                        ✅ Resolve
                      </button>
                    )}
                    {isManager && (
                      <button className="btn btn-danger btn-sm" onClick={() => deleteIncident(inc.id)}>🗑</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
              {editId ? '✏ Edit Incident' : '🚨 Log New Incident'}
            </div>

            {/* Daily toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button
                className={`btn btn-sm ${!form.isDaily ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setForm(f => ({ ...f, isDaily: false }))}>
                🚨 On-Call Incident
              </button>
              <button
                className={`btn btn-sm ${form.isDaily ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setForm(f => ({ ...f, isDaily: true }))}>
                📋 Daily Incident
              </button>
            </div>

            {form.isDaily && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Incident Type</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DAILY_TYPES.map(t => (
                    <button key={t.id}
                      className={`btn btn-sm ${form.dailyType === t.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setForm(f => ({ ...f, dailyType: t.id }))}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Title *</label>
                <input className="form-input" style={{ width: '100%' }} placeholder="Brief description of the incident"
                  value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Severity</label>
                <select className="form-input" style={{ width: '100%' }} value={form.severity}
                  onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                  {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Status</label>
                <select className="form-input" style={{ width: '100%' }} value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Assigned To</label>
                <select className="form-input" style={{ width: '100%' }} value={form.assigned_to}
                  onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                  disabled={!isManager}>
                  <option value="">— Select —</option>
                  {(isManager ? users : users.filter(u => u.id === currentUser)).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Date</label>
                <input type="date" className="form-input" style={{ width: '100%' }} value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>

              {/* Hours — only for on-call incidents, whole numbers only */}
              {!form.isDaily && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Hours Worked
                  </label>
                  <select className="form-input" style={{ width: '100%' }} value={form.hours}
                    onChange={e => setForm(f => ({ ...f, hours: Number(e.target.value) }))}>
                    {HOURS_OPTIONS.map(h => (
                      <option key={h} value={h}>{h} hour{h !== 1 ? 's' : ''}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                    Whole hours only · feeds into payroll
                  </div>
                </div>
              )}

              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea className="form-input" rows={3} style={{ width: '100%', resize: 'vertical' }}
                  placeholder="What happened? What was the impact?"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>

              {form.status === 'Resolved' && (
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Resolution</label>
                  <textarea className="form-input" rows={2} style={{ width: '100%', resize: 'vertical' }}
                    placeholder="How was this resolved?"
                    value={form.resolution}
                    onChange={e => setForm(f => ({ ...f, resolution: e.target.value }))} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveIncident}>
                {editId ? '✅ Save Changes' : '🚨 Log Incident'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
