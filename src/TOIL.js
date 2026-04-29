// src/TOIL.js
// CloudOps Rota — TOIL (Time Off In Lieu) Manager
// Engineers can book TOIL; manager approves/rejects. Manager can add manual entries directly.
// UK WTR 1998: 1:1 accrual on worked on-call hours. Max 40h carryover.

import React, { useState, useMemo } from 'react';

const TOIL_MAX_CARRYOVER = 40;

// ── Shared UI helpers (inline, no external import needed) ────────────────────
function Avatar({ user, size = 28 }) {
  if (!user) return <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />;
  if (user.profile_picture) return <img src={user.profile_picture} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: user.color || '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.4), fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {user.avatar || user.name?.charAt(0) || '?'}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 25px 60px rgba(0,0,0,0.6)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Tag({ label, type }) {
  const cols = { green: ['rgba(34,197,94,0.15)','#22c55e'], amber: ['rgba(245,158,11,0.15)','#f59e0b'], red: ['rgba(239,68,68,0.15)','#ef4444'], blue: ['rgba(96,165,250,0.15)','#60a5fa'], purple: ['rgba(167,139,250,0.15)','#a78bfa'] };
  const [bg, color] = cols[type] || cols.blue;
  return <span style={{ background: bg, color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{label}</span>;
}

function Input({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      {children}
    </div>
  );
}

const IS = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#e2e8f0', fontSize: 13, outline: 'none' };

// ── TOIL balance calculator ────────────────────────────────────────────────────
function calcTOILBalance(timesheets, toilEntries, userId) {
  const ts     = Array.isArray(timesheets) ? timesheets : [];
  const toil   = Array.isArray(toilEntries) ? toilEntries : Object.values(toilEntries || {});
  const userTs = ts; // timesheets[uid] is already per-user
  const workedOC     = userTs.reduce((a, t) => a + (t.weekend_oncall || 0), 0);
  const autoToil     = Math.min(workedOC, TOIL_MAX_CARRYOVER);
  const manualAccrued= toil.filter(t => t.userId === userId && t.type === 'Accrued' && t.status === 'approved').reduce((a,t) => a + (+t.hours||0), 0);
  const used         = toil.filter(t => t.userId === userId && t.type === 'Used'    && t.status === 'approved').reduce((a,t) => a + (+t.hours||0), 0);
  const balance      = Math.min(autoToil + manualAccrued - used, TOIL_MAX_CARRYOVER);
  return { workedOC, autoToil, manualAccrued, used, balance, cappedAt: TOIL_MAX_CARRYOVER };
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function TOIL({ users, timesheets, toil, setToil, currentUser, isManager }) {
  const safeToil = useMemo(() => Array.isArray(toil) ? toil : Object.values(toil || {}), [toil]);

  const [showModal,   setShowModal]   = useState(false);
  const [editId,      setEditId]      = useState(null);
  const [form,        setForm]        = useState({ userId: currentUser, hours: '', reason: '', date: '', type: 'Used', note: '' });
  const [activeTab,   setActiveTab]   = useState('overview'); // 'overview' | 'requests' | 'history'
  const [filterUser,  setFilterUser]  = useState('all');

  const visibleUsers = isManager ? users : users.filter(u => u.id === currentUser);

  // ── Pending requests (awaiting manager approval) ─────────────────────────
  const pendingRequests = safeToil.filter(t => t.status === 'pending');
  const myRequests      = safeToil.filter(t => t.userId === currentUser);

  // ── Open booking modal ───────────────────────────────────────────────────
  const openBook = () => {
    setForm({ userId: currentUser, hours: '', reason: '', date: '', type: 'Used', note: '' });
    setEditId(null);
    setShowModal(true);
  };
  const openManual = (prefill = {}) => {
    setForm({ userId: prefill.userId || currentUser, hours: prefill.hours || '', reason: prefill.reason || '', date: prefill.date || '', type: prefill.type || 'Accrued', note: prefill.note || '' });
    setEditId(prefill.id || null);
    setShowModal(true);
  };

  // ── Save entry ────────────────────────────────────────────────────────────
  const save = () => {
    if (!form.hours || !form.date) return;
    const entry = {
      id:        editId || 't' + Date.now(),
      userId:    form.userId,
      type:      form.type,
      hours:     +form.hours,
      date:      form.date,
      reason:    form.reason,
      note:      form.note,
      // Manager entries are auto-approved; engineer bookings go to pending
      status:    isManager ? 'approved' : 'pending',
      requestedAt: new Date().toISOString(),
      requestedBy: currentUser,
    };
    if (editId) {
      setToil(safeToil.map(t => t.id === editId ? { ...t, ...entry } : t));
    } else {
      setToil([...safeToil, entry]);
    }
    setShowModal(false);
  };

  // ── Approve / reject ──────────────────────────────────────────────────────
  const approve = (id) => setToil(safeToil.map(t => t.id === id ? { ...t, status: 'approved', approvedBy: currentUser, approvedAt: new Date().toISOString() } : t));
  const reject  = (id, reason = '') => setToil(safeToil.map(t => t.id === id ? { ...t, status: 'rejected', rejectedBy: currentUser, rejectedAt: new Date().toISOString(), rejectReason: reason } : t));
  const deleteEntry = (id) => { if (window.confirm('Delete this TOIL entry?')) setToil(safeToil.filter(t => t.id !== id)); };

  const fmtDate = ds => ds ? new Date(ds+'T12:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';

  const tabs = [
    { id: 'overview',  label: '📊 Overview' },
    { id: 'requests',  label: `📋 Requests${pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}` },
    { id: 'history',   label: '📁 History' },
  ];

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px' }}>⏳ TOIL — Time Off In Lieu</h1>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
            UK WTR 1998 · 1:1 accrual on worked on-call hours · Max {TOIL_MAX_CARRYOVER}h carryover
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isManager && (
            <button onClick={() => openManual()} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              + Manual Entry
            </button>
          )}
          <button onClick={openBook}
            style={{ padding: '9px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 0 14px rgba(0,194,255,0.3)' }}>
            {isManager ? '+ Book TOIL' : '📅 Book TOIL'}
          </button>
        </div>
      </div>

      {/* UK WTR info banner */}
      <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, padding: '10px 16px', fontSize: 12, color: '#93c5fd', marginBottom: 18, display: 'flex', gap: 8 }}>
        <span>🇬🇧</span>
        <span><strong>UK WTR:</strong> TOIL accrues at <strong>1:1</strong> for hours <em>worked</em> during on-call (standby hours do not accrue TOIL). Maximum carryover is <strong>{TOIL_MAX_CARRYOVER} hours (5 days)</strong> per the Working Time Regulations 1998.</span>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 4, width: 'fit-content', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <div key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '7px 16px', borderRadius: 7, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            background: activeTab === t.id ? 'rgba(0,194,255,0.1)' : 'transparent',
            color: activeTab === t.id ? '#00c2ff' : '#64748b',
            border: activeTab === t.id ? '1px solid rgba(0,194,255,0.3)' : '1px solid transparent',
            transition: 'all 0.15s',
          }}>{t.label}</div>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: OVERVIEW — balances per engineer                               */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {visibleUsers.map(u => {
            const b = calcTOILBalance(timesheets[u.id], safeToil, u.id);
            const pct = TOIL_MAX_CARRYOVER > 0 ? Math.min(Math.max(b.balance / TOIL_MAX_CARRYOVER, 0), 1) * 100 : 0;
            const color = b.balance >= TOIL_MAX_CARRYOVER ? '#f59e0b' : b.balance > 0 ? '#38bdf8' : '#fca5a5';
            const myPending = safeToil.filter(t => t.userId === u.id && t.status === 'pending').length;
            return (
              <div key={u.id} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}22`, borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <Avatar user={u} size={34} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'DM Mono' }}>{u.id}</div>
                  </div>
                  {myPending > 0 && (
                    <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                      {myPending} pending
                    </span>
                  )}
                </div>
                {/* Balance bar */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: '#64748b' }}>
                    <span>Balance</span>
                    <span style={{ fontFamily: 'DM Mono', fontWeight: 700, color }}>{b.balance}h / {TOIL_MAX_CARRYOVER}h cap</span>
                  </div>
                  <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.4s' }} />
                  </div>
                </div>
                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {[
                    { l: 'Auto (1:1)', v: `${b.autoToil}h`, c: '#38bdf8' },
                    { l: 'Manual',     v: `${b.manualAccrued}h`, c: '#93c5fd' },
                    { l: 'Used',       v: `${b.used}h`, c: '#fcd34d' },
                    { l: 'Balance',    v: `${b.balance}h`, c: color },
                  ].map(s => (
                    <div key={s.l} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>{s.l}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: s.c, fontFamily: 'DM Mono' }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {b.balance >= TOIL_MAX_CARRYOVER && (
                  <div style={{ marginTop: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#f59e0b' }}>
                    ⚠ At WTR carryover cap — use before year end
                  </div>
                )}
                {isManager && (
                  <button onClick={() => openManual({ userId: u.id })} style={{ marginTop: 12, width: '100%', padding: '6px 0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#64748b', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                    + Add Entry for {u.name.split(' ')[0]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: REQUESTS — pending bookings for manager to approve             */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'requests' && (
        <div>
          {/* My own requests (engineer view) */}
          {!isManager && myRequests.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#94a3b8' }}>My TOIL Requests</div>
              {myRequests.map(t => (
                <RequestCard key={t.id} entry={t} users={users} isManager={false} onDelete={() => deleteEntry(t.id)} fmtDate={fmtDate} />
              ))}
            </div>
          )}

          {/* Manager: all pending */}
          {isManager && (
            <>
              {pendingRequests.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>No pending TOIL requests.</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>{pendingRequests.length} request{pendingRequests.length > 1 ? 's' : ''} awaiting your approval</div>
                  {pendingRequests.map(t => (
                    <RequestCard key={t.id} entry={t} users={users} isManager={true}
                      onApprove={() => approve(t.id)}
                      onReject={() => { const r = window.prompt('Reason for rejection (optional):') || ''; reject(t.id, r); }}
                      onDelete={() => deleteEntry(t.id)}
                      fmtDate={fmtDate} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: HISTORY — all entries                                          */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'history' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {isManager && (
              <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
                style={{ ...IS, width: 180, padding: '6px 10px', fontSize: 12 }}>
                <option value="all">All Engineers</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                  {['Engineer','Date','Type','Hours','Status','Reason','Approved By','Actions'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {safeToil
                  .filter(t => filterUser === 'all' || t.userId === filterUser)
                  .filter(t => isManager || t.userId === currentUser)
                  .sort((a,b) => (b.date||'').localeCompare(a.date||''))
                  .map(t => {
                    const u = users.find(x => x.id === t.userId);
                    const approver = users.find(x => x.id === t.approvedBy);
                    return (
                      <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <Avatar user={u} size={24} />
                            <span style={{ fontSize: 12 }}>{u?.name || t.userId}</span>
                          </div>
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: 'DM Mono', fontSize: 11, color: '#94a3b8', whiteSpace:'nowrap' }}>{fmtDate(t.date)}</td>
                        <td style={{ padding: '9px 12px' }}><Tag label={t.type} type={t.type === 'Accrued' ? 'blue' : 'amber'} /></td>
                        <td style={{ padding: '9px 12px', fontFamily: 'DM Mono', fontSize: 12, color: '#38bdf8', fontWeight: 700 }}>{t.hours}h</td>
                        <td style={{ padding: '9px 12px' }}>
                          <Tag label={t.status === 'approved' ? '✓ Approved' : t.status === 'rejected' ? '✗ Rejected' : '⏳ Pending'}
                            type={t.status === 'approved' ? 'green' : t.status === 'rejected' ? 'red' : 'amber'} />
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: 11, color: '#64748b', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.reason || t.note || '—'}</td>
                        <td style={{ padding: '9px 12px', fontSize: 11, color: '#64748b' }}>
                          {approver ? approver.name : t.approvedBy ? t.approvedBy : '—'}
                          {t.rejectReason && <div style={{ fontSize: 10, color: '#ef4444' }}>{t.rejectReason}</div>}
                        </td>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {isManager && <button onClick={() => openManual(t)} style={{ padding: '3px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>✏</button>}
                            {(isManager || t.userId === currentUser) && (
                              <button onClick={() => deleteEntry(t.id)} style={{ padding: '3px 8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 5, color: '#ef4444', fontSize: 11, cursor: 'pointer' }}>🗑</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* BOOKING / MANUAL ENTRY MODAL                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <Modal title={isManager ? 'TOIL Entry' : '📅 Book TOIL'} onClose={() => setShowModal(false)}>
          {!isManager && (
            <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 7, padding: '8px 12px', fontSize: 12, color: '#93c5fd', marginBottom: 14 }}>
              ℹ Your request will be sent to the manager for approval before it's applied to your balance.
            </div>
          )}
          {isManager && (
            <Input label="Engineer">
              <select value={form.userId} onChange={e => setForm({...form, userId: e.target.value})} style={IS}>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
              </select>
            </Input>
          )}
          <Input label="Type">
            <div style={{ display: 'flex', gap: 8 }}>
              {(isManager ? ['Accrued','Used'] : ['Used']).map(v => (
                <div key={v} onClick={() => setForm({...form, type: v})}
                  style={{ flex: 1, padding: '9px 0', textAlign: 'center', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                    background: form.type === v ? 'rgba(0,194,255,0.12)' : 'rgba(255,255,255,0.03)',
                    border: `1.5px solid ${form.type === v ? 'rgba(0,194,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    color: form.type === v ? '#00c2ff' : '#64748b', transition: 'all 0.15s' }}>
                  {v === 'Used' ? '📅 Use TOIL' : '⬆ Accrue TOIL'}
                </div>
              ))}
            </div>
          </Input>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Date">
              <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} style={IS} />
            </Input>
            <Input label="Hours">
              <input type="number" min="0.5" step="0.5" value={form.hours} onChange={e => setForm({...form, hours: e.target.value})} style={IS} />
            </Input>
          </div>
          <Input label="Reason">
            <input type="text" value={form.reason} onChange={e => setForm({...form, reason: e.target.value})
            } placeholder="e.g. Worked weekend on-call, extended incident…" style={IS} />
          </Input>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => setShowModal(false)} style={{ padding: '8px 18px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#64748b', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button onClick={save} disabled={!form.hours || !form.date}
              style={{ padding: '8px 22px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: (!form.hours || !form.date) ? 0.5 : 1 }}>
              {isManager ? 'Save Entry' : 'Submit Request'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Request card (used in both manager and engineer views) ────────────────────
function RequestCard({ entry, users, isManager, onApprove, onReject, onDelete, fmtDate }) {
  const u = users.find(x => x.id === entry.userId);
  const statusColor = entry.status === 'approved' ? '#22c55e' : entry.status === 'rejected' ? '#ef4444' : '#f59e0b';
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${statusColor}22`, borderRadius: 10, padding: '14px 18px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar user={u} size={32} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{u?.name || entry.userId}</div>
            <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'DM Mono' }}>
              {entry.type} · {entry.hours}h · {fmtDate(entry.date)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ background: `${statusColor}18`, color: statusColor, padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700, border: `1px solid ${statusColor}33` }}>
            {entry.status === 'approved' ? '✓ Approved' : entry.status === 'rejected' ? '✗ Rejected' : '⏳ Pending'}
          </span>
          {isManager && entry.status === 'pending' && (
            <>
              <button onClick={onApprove} style={{ padding: '5px 14px', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ Approve</button>
              <button onClick={onReject}  style={{ padding: '5px 14px', background: 'rgba(239,68,68,0.1)',  border: '1px solid rgba(239,68,68,0.3)',  borderRadius: 6, color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✗ Reject</button>
            </>
          )}
          {(isManager || entry.status === 'pending') && (
            <button onClick={onDelete} style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#64748b', fontSize: 12, cursor: 'pointer' }}>🗑</button>
          )}
        </div>
      </div>
      {(entry.reason || entry.note) && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>"{entry.reason || entry.note}"</div>
      )}
      {entry.rejectReason && <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>Rejection reason: {entry.rejectReason}</div>}
    </div>
  );
}
