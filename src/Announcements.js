// src/Announcements.js
// CloudOps Rota — Broadcast Announcements
// Manager: create / edit / delete / pin announcements with type, priority, expiry
// Engineer: see unread banners on app load; mark as read; view archive

import React, { useState, useMemo } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPES = {
  info:        { label: 'Info',        icon: 'ℹ',  color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.3)'  },
  warning:     { label: 'Warning',     icon: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)'  },
  critical:    { label: 'Critical',    icon: '🚨', color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.35)'  },
  maintenance: { label: 'Maintenance', icon: '🔧', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)' },
  policy:      { label: 'Policy',      icon: '📋', color: '#34d399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.3)'  },
  holiday:     { label: 'Holiday',     icon: '🌴', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.3)'  },
};

function fmtDate(ds) {
  if (!ds) return '—';
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const BLANK = { title: '', body: '', type: 'info', priority: 'normal', expiresAt: '', pinned: false, targetRole: 'all' };

// ── Banner component (rendered globally in App shell for engineers) ─────────────
export function AnnouncementBanners({ announcements, currentUser, onDismiss }) {
  const today = new Date().toISOString().slice(0, 10);
  const active = (announcements || [])
    .filter(a => {
      if (a.expiresAt && today > a.expiresAt) return false;
      if (a.targetRole === 'manager') return false;
      const readBy = a.readBy || [];
      return !readBy.includes(currentUser);
    })
    .sort((a, b) => {
      const prio = { critical: 0, warning: 1, normal: 2 };
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (prio[a.priority] ?? 2) - (prio[b.priority] ?? 2);
    })
    .slice(0, 5); // max 5 banners at once

  if (active.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
      {active.map(ann => {
        const t = TYPES[ann.type] || TYPES.info;
        return (
          <div key={ann.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 16px',
            background: t.bg, border: `1px solid ${t.border}`, borderRadius: 10,
            animation: 'slideDown 0.25s ease',
          }}>
            <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{t.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.color }}>{ann.title}</span>
                {ann.pinned && <span style={{ fontSize: 9, color: t.color, background: `${t.color}20`, padding: '1px 6px', borderRadius: 4, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pinned</span>}
                {ann.priority === 'critical' && <span style={{ fontSize: 9, color: '#ef4444', background: 'rgba(239,68,68,0.15)', padding: '1px 6px', borderRadius: 4, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', border: '1px solid rgba(239,68,68,0.3)' }}>Action Required</span>}
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>{fmtDateTime(ann.createdAt)}</span>
              </div>
              {ann.body && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{ann.body}</div>}
              {ann.expiresAt && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>Expires {fmtDate(ann.expiresAt)}</div>}
            </div>
            <button onClick={() => onDismiss(ann.id)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 18, cursor: 'pointer', lineHeight: 1, flexShrink: 0, padding: '0 2px', transition: 'color 0.15s' }}
              title="Dismiss"
              onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.8)'}
              onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.4)'}>
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Modal component ────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 28, width: '100%', maxWidth: wide ? 640 : 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const IS = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'inherit' };
const LBL = { display: 'block', fontSize: 11, color: '#64748b', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' };

// ── Main Announcements Component ───────────────────────────────────────────────
export default function Announcements({ announcements, setAnnouncements, currentUser, isManager, users }) {
  const [showModal,  setShowModal]  = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [form,       setForm]       = useState(BLANK);
  const [activeTab,  setActiveTab]  = useState(isManager ? 'manage' : 'feed');
  const [filterType, setFilterType] = useState('all');

  const safe = useMemo(() => Array.isArray(announcements) ? announcements : [], [announcements]);
  const today = new Date().toISOString().slice(0, 10);

  // Active = not expired and target matches
  const activeAnns = safe.filter(a => !a.expiresAt || today <= a.expiresAt);
  const expiredAnns = safe.filter(a => a.expiresAt && today > a.expiresAt);

  // Engineer feed — what they can see
  const myFeed = safe.filter(a => {
    if (a.targetRole === 'manager') return false;
    return !a.expiresAt || today <= a.expiresAt;
  }).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const openNew = () => {
    setForm({ ...BLANK });
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (ann) => {
    setForm({ title: ann.title, body: ann.body, type: ann.type, priority: ann.priority, expiresAt: ann.expiresAt || '', pinned: ann.pinned || false, targetRole: ann.targetRole || 'all' });
    setEditId(ann.id);
    setShowModal(true);
  };

  const save = () => {
    if (!form.title.trim()) return;
    if (editId) {
      setAnnouncements(safe.map(a => a.id === editId ? { ...a, ...form, updatedAt: new Date().toISOString() } : a));
    } else {
      setAnnouncements([{
        id: 'ann-' + Date.now(),
        ...form,
        createdBy: currentUser,
        createdAt: new Date().toISOString(),
        readBy: [],
      }, ...safe]);
    }
    setShowModal(false);
  };

  const deleteAnn = (id) => {
    if (!window.confirm('Delete this announcement?')) return;
    setAnnouncements(safe.filter(a => a.id !== id));
  };

  const togglePin = (id) => {
    setAnnouncements(safe.map(a => a.id === id ? { ...a, pinned: !a.pinned } : a));
  };

  const dismissForMe = (id) => {
    setAnnouncements(safe.map(a => a.id === id ? { ...a, readBy: [...(a.readBy || []), currentUser] } : a));
  };

  const markAllRead = () => {
    setAnnouncements(safe.map(a => ({ ...a, readBy: [...new Set([...(a.readBy || []), currentUser])] })));
  };

  const filtered = activeTab === 'manage'
    ? safe.filter(a => filterType === 'all' || a.type === filterType)
    : myFeed.filter(a => filterType === 'all' || a.type === filterType);

  const unreadCount = myFeed.filter(a => !(a.readBy || []).includes(currentUser)).length;

  const tabs = [
    ...(isManager ? [{ id: 'manage', label: `📢 Manage (${safe.length})` }] : []),
    { id: 'feed',   label: `📬 My Feed${unreadCount > 0 ? ` (${unreadCount} new)` : ''}` },
    { id: 'archive', label: `📁 Archive (${expiredAnns.length})` },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px' }}>📢 Announcements</h1>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
            {activeAnns.length} active · {expiredAnns.length} expired · broadcasts to all engineers
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unreadCount > 0 && !isManager && (
            <button onClick={markAllRead} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              ✓ Mark all read
            </button>
          )}
          {isManager && (
            <button onClick={openNew} style={{ padding: '9px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 0 14px rgba(0,194,255,0.3)' }}>
              + New Announcement
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 4, width: 'fit-content', flexWrap: 'wrap' }}>
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

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', ...Object.keys(TYPES)].map(type => {
          const t = TYPES[type];
          const isActive = filterType === type;
          return (
            <div key={type} onClick={() => setFilterType(type)} style={{
              padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: isActive ? (t?.bg || 'rgba(0,194,255,0.1)') : 'rgba(255,255,255,0.03)',
              color: isActive ? (t?.color || '#00c2ff') : '#475569',
              border: `1px solid ${isActive ? (t?.border || 'rgba(0,194,255,0.3)') : 'rgba(255,255,255,0.06)'}`,
              transition: 'all 0.12s',
            }}>
              {t ? `${t.icon} ${t.label}` : '☰ All'}
            </div>
          );
        })}
      </div>

      {/* ── MANAGER MANAGE TAB ─────────────────────────────────────────────── */}
      {activeTab === 'manage' && isManager && (
        <div>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#334155' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No announcements yet</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>Create one to broadcast to your team</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(ann => {
                const t = TYPES[ann.type] || TYPES.info;
                const isExpired = ann.expiresAt && today > ann.expiresAt;
                const readCount = (ann.readBy || []).length;
                const totalEng = users.filter(u => !u.isManager).length;
                return (
                  <div key={ann.id} style={{
                    background: 'rgba(255,255,255,0.03)', border: `1px solid ${isExpired ? 'rgba(255,255,255,0.05)' : t.border}`,
                    borderRadius: 12, padding: '16px 18px', opacity: isExpired ? 0.55 : 1,
                    transition: 'opacity 0.15s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      {/* Icon */}
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, border: `1px solid ${t.border}` }}>
                        {t.icon}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{ann.title}</span>
                          <span style={{ fontSize: 10, color: t.color, background: t.bg, padding: '1px 7px', borderRadius: 4, fontWeight: 700 }}>{t.label}</span>
                          {ann.pinned && <span style={{ fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '1px 7px', borderRadius: 4, fontWeight: 700 }}>📌 Pinned</span>}
                          {ann.priority === 'critical' && <span style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 7px', borderRadius: 4, fontWeight: 700 }}>🚨 Critical</span>}
                          {isExpired && <span style={{ fontSize: 10, color: '#475569', background: 'rgba(255,255,255,0.05)', padding: '1px 7px', borderRadius: 4 }}>Expired</span>}
                          {ann.targetRole === 'engineer' && <span style={{ fontSize: 10, color: '#94a3b8', background: 'rgba(255,255,255,0.05)', padding: '1px 7px', borderRadius: 4 }}>Engineers only</span>}
                        </div>
                        {ann.body && <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{ann.body}</div>}
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#475569', flexWrap: 'wrap' }}>
                          <span>📅 {fmtDateTime(ann.createdAt)}</span>
                          {ann.expiresAt && <span>⏰ Expires {fmtDate(ann.expiresAt)}</span>}
                          <span style={{ color: readCount > 0 ? '#22c55e' : '#475569' }}>👁 {readCount}/{totalEng} read</span>
                          {ann.updatedAt && <span>✏ Updated {fmtDateTime(ann.updatedAt)}</span>}
                        </div>

                        {/* Read-by list */}
                        {readCount > 0 && (
                          <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {(ann.readBy || []).map(uid => {
                              const u = users.find(x => x.id === uid);
                              return u ? (
                                <span key={uid} style={{ fontSize: 10, color: '#22c55e', background: 'rgba(34,197,94,0.08)', padding: '1px 7px', borderRadius: 10, border: '1px solid rgba(34,197,94,0.2)' }}>
                                  ✓ {u.name.split(' ')[0]}
                                </span>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                        <button onClick={() => togglePin(ann.id)} title={ann.pinned ? 'Unpin' : 'Pin to top'}
                          style={{ padding: '5px 10px', background: ann.pinned ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.05)', border: `1px solid ${ann.pinned ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 6, color: ann.pinned ? '#f59e0b' : '#64748b', fontSize: 12, cursor: 'pointer' }}>
                          {ann.pinned ? '📌' : '📍'}
                        </button>
                        <button onClick={() => openEdit(ann)}
                          style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
                          ✏ Edit
                        </button>
                        <button onClick={() => deleteAnn(ann.id)}
                          style={{ padding: '5px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#ef4444', fontSize: 12, cursor: 'pointer' }}>
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ENGINEER FEED TAB ─────────────────────────────────────────────── */}
      {activeTab === 'feed' && (
        <div>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#334155' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>All caught up!</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>No active announcements</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(ann => {
                const t = TYPES[ann.type] || TYPES.info;
                const isRead = (ann.readBy || []).includes(currentUser);
                return (
                  <div key={ann.id} style={{
                    background: isRead ? 'rgba(255,255,255,0.02)' : t.bg,
                    border: `1px solid ${isRead ? 'rgba(255,255,255,0.06)' : t.border}`,
                    borderRadius: 12, padding: '16px 18px',
                    opacity: isRead ? 0.6 : 1, transition: 'all 0.2s',
                  }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 22, flexShrink: 0 }}>{t.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: isRead ? '#94a3b8' : '#e2e8f0' }}>{ann.title}</span>
                          {!isRead && <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, display: 'inline-block', flexShrink: 0 }} />}
                          {ann.pinned && <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>📌 Pinned</span>}
                        </div>
                        {ann.body && <div style={{ fontSize: 12, color: isRead ? '#475569' : 'rgba(255,255,255,0.75)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ann.body}</div>}
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#475569', marginTop: 6, flexWrap: 'wrap' }}>
                          <span>{fmtDateTime(ann.createdAt)}</span>
                          {ann.expiresAt && <span>⏰ Expires {fmtDate(ann.expiresAt)}</span>}
                        </div>
                      </div>
                      {!isRead && (
                        <button onClick={() => dismissForMe(ann.id)}
                          style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#94a3b8', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>
                          ✓ Mark read
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ARCHIVE TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'archive' && (
        <div>
          {expiredAnns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#334155', fontSize: 13 }}>No expired announcements.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: 0.65 }}>
              {expiredAnns.map(ann => {
                const t = TYPES[ann.type] || TYPES.info;
                return (
                  <div key={ann.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 16 }}>{t.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>{ann.title}</div>
                      <div style={{ fontSize: 10, color: '#334155', fontFamily: 'DM Mono' }}>Expired {fmtDate(ann.expiresAt)} · Created {fmtDateTime(ann.createdAt)}</div>
                    </div>
                    {isManager && (
                      <button onClick={() => deleteAnn(ann.id)}
                        style={{ padding: '3px 8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 5, color: '#ef4444', fontSize: 11, cursor: 'pointer' }}>
                        🗑
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Create / Edit Modal ──────────────────────────────────────────── */}
      {showModal && (
        <Modal title={editId ? '✏ Edit Announcement' : '📢 New Announcement'} onClose={() => setShowModal(false)} wide>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={LBL}>Title *</label>
              <input style={IS} placeholder="e.g. System maintenance this Friday 10pm–2am"
                value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={LBL}>Type</label>
                <select style={IS} value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
                  {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={LBL}>Priority</label>
                <select style={IS} value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))}>
                  <option value="normal">Normal</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical — Action Required</option>
                </select>
              </div>
              <div>
                <label style={LBL}>Target</label>
                <select style={IS} value={form.targetRole} onChange={e => setForm(f => ({...f, targetRole: e.target.value}))}>
                  <option value="all">Everyone</option>
                  <option value="engineer">Engineers only</option>
                  <option value="manager">Managers only</option>
                </select>
              </div>
            </div>

            <div>
              <label style={LBL}>Message</label>
              <textarea style={{ ...IS, resize: 'vertical' }} rows={4}
                placeholder="Full announcement text…"
                value={form.body} onChange={e => setForm(f => ({...f, body: e.target.value}))} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={LBL}>Expires On (optional)</label>
                <input style={IS} type="date" value={form.expiresAt} onChange={e => setForm(f => ({...f, expiresAt: e.target.value}))} />
                <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>Leave blank for no expiry</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <div onClick={() => setForm(f => ({...f, pinned: !f.pinned}))}
                    style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${form.pinned ? '#f59e0b' : 'rgba(255,255,255,0.2)'}`, background: form.pinned ? 'rgba(245,158,11,0.15)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                    {form.pinned && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 800 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>📌 Pin to top of feed</span>
                </label>
              </div>
            </div>

            {/* Preview */}
            {form.title && (
              <div style={{ background: (TYPES[form.type]||TYPES.info).bg, border: `1px solid ${(TYPES[form.type]||TYPES.info).border}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Preview</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18 }}>{(TYPES[form.type]||TYPES.info).icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: (TYPES[form.type]||TYPES.info).color }}>{form.title}</div>
                    {form.body && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{form.body}</div>}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 18px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#64748b', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={save} disabled={!form.title.trim()}
                style={{ padding: '8px 22px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: form.title.trim() ? 1 : 0.5 }}>
                {editId ? '✓ Save Changes' : '📢 Publish'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
