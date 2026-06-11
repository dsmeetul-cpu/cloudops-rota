// src/permissions.js
// CloudOps Rota — Permissions System
// Meetul Bhundia (MBA47) · Cloud Run Operations

import React, { useState, useMemo } from 'react';

// ── Permission groups & sections ──────────────────────────────────────────────
// Each section declares every action that makes sense for it.
// actions: read | write | delete | approve | export | configure | manage
export const PERMISSION_GROUPS = [
  {
    id: 'navigation',
    label: 'Navigation & Views',
    icon: '🧭',
    color: '#60a5fa',
    sections: [
      { id: 'dashboard',   label: 'Dashboard',      icon: '◈',  actions: ['read'] },
      { id: 'oncall',      label: "Who's On Call",   icon: '📡', actions: ['read'] },
      { id: 'myshift',     label: 'My Shift',        icon: '🗓', actions: ['read'] },
      { id: 'calendar',    label: 'Calendar',        icon: '📅', actions: ['read'] },
      { id: 'insights',    label: 'Insights',        icon: '💡', actions: ['read'] },
      { id: 'capacity',    label: 'Capacity',        icon: '📈', actions: ['read'] },
      { id: 'stress',      label: 'Stress Score',    icon: '📊', actions: ['read'] },
    ],
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    icon: '🔄',
    color: '#34d399',
    sections: [
      { id: 'rota',        label: 'Rota',            icon: '🔄', actions: ['read', 'write', 'delete', 'approve', 'export'] },
      { id: 'swaps',       label: 'Shift Swaps',     icon: '🔁', actions: ['read', 'write', 'delete', 'approve'] },
      { id: 'upgrades',    label: 'Upgrade Days',    icon: '⬆',  actions: ['read', 'write', 'delete', 'approve', 'export'] },
    ],
  },
  {
    id: 'leave',
    label: 'Leave & Absence',
    icon: '🌴',
    color: '#a78bfa',
    sections: [
      { id: 'holidays',    label: 'Holidays',        icon: '🌴', actions: ['read', 'write', 'delete', 'approve', 'export'] },
      { id: 'absence',     label: 'Absence / Sick',  icon: '🏥', actions: ['read', 'write', 'delete', 'approve', 'export'] },
      { id: 'toil',        label: 'TOIL',            icon: '⏳', actions: ['read', 'write', 'delete', 'approve', 'export'] },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: '🚨',
    color: '#fbbf24',
    sections: [
      { id: 'incidents',   label: 'Incidents',       icon: '🚨', actions: ['read', 'write', 'delete', 'approve', 'export'] },
      { id: 'timesheets',  label: 'Timesheets',      icon: '⏱',  actions: ['read', 'write', 'delete', 'approve', 'export'] },
      { id: 'overtime',    label: 'Overtime',        icon: '🕐', actions: ['read', 'write', 'delete', 'approve', 'export'] },
    ],
  },
  {
    id: 'finance',
    label: 'Finance & Payroll',
    icon: '💷',
    color: '#f472b6',
    sections: [
      { id: 'payroll',     label: 'Payroll',         icon: '💷', actions: ['read', 'export', 'configure'] },
      { id: 'payconfig',   label: 'Pay Config',      icon: '⚙',  actions: ['read', 'write', 'configure'] },
      { id: 'payroll_adj', label: 'Payroll Adjustments', icon: '✏️', actions: ['read', 'write', 'delete', 'approve'] },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge Base',
    icon: '📖',
    color: '#6ee7b7',
    sections: [
      { id: 'wiki',        label: 'Wiki',            icon: '📖', actions: ['read', 'write', 'delete'] },
      { id: 'glossary',    label: 'Glossary',        icon: '📚', actions: ['read', 'write', 'delete'] },
      { id: 'contacts',    label: 'Contacts',        icon: '👥', actions: ['read', 'write', 'delete'] },
      { id: 'logbook',     label: 'Logbook',         icon: '📓', actions: ['read', 'write', 'delete'] },
      { id: 'docs',        label: 'Documents',       icon: '📁', actions: ['read', 'write', 'delete'] },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    icon: '💬',
    color: '#38bdf8',
    sections: [
      { id: 'notes',       label: 'Notes',           icon: '🗒️', actions: ['read', 'write', 'delete'] },
      { id: 'whatsapp',    label: 'Team Chat',       icon: '💬', actions: ['read', 'write', 'delete'] },
      { id: 'reports',     label: 'Weekly Reports',  icon: '📋', actions: ['read', 'write', 'delete', 'approve', 'export'] },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: '🔧',
    color: '#fb923c',
    sections: [
      { id: 'settings',    label: 'Settings',        icon: '🔧', actions: ['read', 'write', 'configure'] },
      { id: 'permissions', label: 'Permissions',     icon: '🔑', actions: ['read', 'write', 'manage'] },
      { id: 'users',       label: 'User Management', icon: '👤', actions: ['read', 'write', 'delete', 'manage'] },
      { id: 'drive',       label: 'Drive & Sync',    icon: '☁️', actions: ['read', 'configure', 'manage'] },
      { id: 'myaccount',   label: 'My Account',      icon: '🪪',  actions: ['read', 'write'] },
    ],
  },
];

// Flat list for backward-compat helpers
export const PERMISSION_SECTIONS = PERMISSION_GROUPS.flatMap(g => g.sections);

// ── Action metadata ───────────────────────────────────────────────────────────
export const ACTIONS = [
  { id: 'read',       label: 'Read',      color: '#60a5fa', icon: '👁'  },
  { id: 'write',      label: 'Write',     color: '#34d399', icon: '✏️'  },
  { id: 'delete',     label: 'Delete',    color: '#f87171', icon: '🗑'  },
  { id: 'approve',    label: 'Approve',   color: '#a78bfa', icon: '✅'  },
  { id: 'export',     label: 'Export',    color: '#fbbf24', icon: '⬇️'  },
  { id: 'configure',  label: 'Config',    color: '#fb923c', icon: '⚙'  },
  { id: 'manage',     label: 'Manage',    color: '#f472b6', icon: '🛡'  },
];

// ── Default permission sets ───────────────────────────────────────────────────
// Engineer: read everywhere + write/delete on personal + approve never
const ENGINEER_WRITE = [
  'incidents','timesheets','swaps','toil','absence','overtime',
  'logbook','wiki','glossary','contacts','notes','docs','whatsapp','myaccount','upgrades',
];
const ENGINEER_DELETE = ['logbook','notes','whatsapp'];

export const DEFAULT_PERMISSIONS = {
  Manager: Object.fromEntries(
    PERMISSION_SECTIONS.map(s => [
      s.id,
      Object.fromEntries(s.actions.map(a => [a, true]))
    ])
  ),
  Engineer: Object.fromEntries(
    PERMISSION_SECTIONS.map(s => [
      s.id,
      {
        ...(s.actions.includes('read')      ? { read:      true }                              : {}),
        ...(s.actions.includes('write')     ? { write:     ENGINEER_WRITE.includes(s.id) }    : {}),
        ...(s.actions.includes('delete')    ? { delete:    ENGINEER_DELETE.includes(s.id) }   : {}),
        ...(s.actions.includes('approve')   ? { approve:   false }                            : {}),
        ...(s.actions.includes('export')    ? { export:    false }                            : {}),
        ...(s.actions.includes('configure') ? { configure: false }                            : {}),
        ...(s.actions.includes('manage')    ? { manage:    false }                            : {}),
      }
    ])
  ),
};

// ── Helper functions ──────────────────────────────────────────────────────────
export function canDo(permissions, userId, userRole, section, action) {
  if (userRole === 'Manager') return true;
  const userPerms = permissions?.[userId];
  if (!userPerms) return DEFAULT_PERMISSIONS[userRole]?.[section]?.[action] ?? false;
  return userPerms[section]?.[action] ?? false;
}

export function buildDefaultPerms(role) {
  return JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.Engineer));
}

// ── PermissionsManager UI ─────────────────────────────────────────────────────
export function PermissionsManager({ users, permissions, setPermissions, permTemplates, setPermTemplates }) {
  const [selectedUser,     setSelectedUser]     = useState(null);
  const [view,             setView]             = useState('matrix');   // 'matrix' | 'templates'
  const [expandedGroups,   setExpandedGroups]   = useState({});
  const [templateName,     setTemplateName]     = useState('');
  const [copySourceId,     setCopySourceId]     = useState('');
  const [applyTemplateKey, setApplyTemplateKey] = useState('');
  const [flashMsg,         setFlashMsg]         = useState('');
  const [filterAction,     setFilterAction]     = useState('all');
  const [searchQ,          setSearchQ]          = useState('');

  const templates        = permTemplates || {};
  const persistTemplates = (t) => setPermTemplates(t);
  const flash = (msg) => { setFlashMsg(msg); setTimeout(() => setFlashMsg(''), 2500); };

  // ── Effective perms ───────────────────────────────────────────────────────
  const getEffective = (uid) => {
    const u    = users.find(x => x.id === uid);
    const base = buildDefaultPerms(u?.role || 'Engineer');
    const saved = permissions?.[uid];
    if (!saved) return base;
    const merged = { ...base };
    Object.keys(saved).forEach(sec => { merged[sec] = { ...(base[sec] || {}), ...saved[sec] }; });
    return merged;
  };

  const currentPerms = useMemo(() => selectedUser ? getEffective(selectedUser) : null, [selectedUser, permissions]);
  const hasOverrides  = (uid) => !!permissions?.[uid];

  const selectedUserObj = users.find(x => x.id === selectedUser);
  const isManager       = selectedUserObj?.role === 'Manager';

  // ── Setters ───────────────────────────────────────────────────────────────
  const setAction = (section, action, value) => {
    if (!selectedUser || isManager) return;
    setPermissions(prev => ({
      ...prev,
      [selectedUser]: {
        ...getEffective(selectedUser),
        [section]: { ...getEffective(selectedUser)[section], [action]: value },
      },
    }));
  };

  const setAllForSection = (sectionId, value) => {
    if (!selectedUser || isManager) return;
    const sec = PERMISSION_SECTIONS.find(s => s.id === sectionId);
    if (!sec) return;
    setPermissions(prev => ({
      ...prev,
      [selectedUser]: {
        ...getEffective(selectedUser),
        [sectionId]: Object.fromEntries(sec.actions.map(a => [a, value])),
      },
    }));
  };

  const setAllForGroup = (groupId, value) => {
    if (!selectedUser || isManager) return;
    const group = PERMISSION_GROUPS.find(g => g.id === groupId);
    if (!group) return;
    const current = getEffective(selectedUser);
    const updated = { ...current };
    group.sections.forEach(s => {
      updated[s.id] = Object.fromEntries(s.actions.map(a => [a, value]));
    });
    setPermissions(prev => ({ ...prev, [selectedUser]: updated }));
  };

  const setAllActions = (action, value) => {
    if (!selectedUser || isManager) return;
    const current = getEffective(selectedUser);
    const updated = {};
    PERMISSION_SECTIONS.forEach(s => {
      updated[s.id] = { ...current[s.id] };
      if (s.actions.includes(action)) updated[s.id][action] = value;
    });
    setPermissions(prev => ({ ...prev, [selectedUser]: updated }));
  };

  const resetToDefault = () => {
    if (!selectedUser) return;
    setPermissions(prev => { const n = { ...prev }; delete n[selectedUser]; return n; });
    flash('✅ Reset to role defaults');
  };

  const copyFrom = () => {
    if (!selectedUser || !copySourceId) return;
    setPermissions(prev => ({ ...prev, [selectedUser]: JSON.parse(JSON.stringify(getEffective(copySourceId))) }));
    flash(`✅ Copied from ${users.find(u => u.id === copySourceId)?.name}`);
  };

  const saveTemplate = () => {
    if (!selectedUser || !templateName.trim()) return;
    persistTemplates({ ...templates, [templateName.trim()]: JSON.parse(JSON.stringify(getEffective(selectedUser))) });
    setTemplateName('');
    flash(`✅ Template "${templateName.trim()}" saved`);
  };

  const applyTemplate = () => {
    if (!selectedUser || !applyTemplateKey) return;
    setPermissions(prev => ({ ...prev, [selectedUser]: JSON.parse(JSON.stringify(templates[applyTemplateKey])) }));
    flash(`✅ Template "${applyTemplateKey}" applied`);
  };

  const deleteTemplate = (name) => {
    const updated = { ...templates };
    delete updated[name];
    persistTemplates(updated);
    if (applyTemplateKey === name) setApplyTemplateKey('');
  };

  // ── Counts for user sidebar ───────────────────────────────────────────────
  const permSummary = (uid) => {
    const p = getEffective(uid);
    let granted = 0, total = 0;
    PERMISSION_SECTIONS.forEach(s => s.actions.forEach(a => { total++; if (p[s.id]?.[a]) granted++; }));
    return { granted, total };
  };

  // ── Filtered sections in matrix ───────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    return PERMISSION_GROUPS.map(g => ({
      ...g,
      sections: g.sections.filter(s => {
        const matchesSearch = !searchQ || s.label.toLowerCase().includes(searchQ.toLowerCase());
        const matchesAction = filterAction === 'all' || s.actions.includes(filterAction);
        return matchesSearch && matchesAction;
      }),
    })).filter(g => g.sections.length > 0);
  }, [searchQ, filterAction]);

  // ── Permission dot summary bar for a section ──────────────────────────────
  const SectionSummaryDots = ({ sectionId, actions }) => {
    const perms = currentPerms?.[sectionId] || {};
    return (
      <div style={{ display: 'flex', gap: 3 }}>
        {actions.map(a => {
          const ac = ACTIONS.find(x => x.id === a);
          const on = !!perms[a];
          return (
            <div key={a} title={`${ac?.label}: ${on ? 'Granted' : 'Denied'}`}
              style={{ width: 7, height: 7, borderRadius: '50%', background: on ? ac?.color : 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
          );
        })}
      </div>
    );
  };

  // ── Big summary stat for selected user ────────────────────────────────────
  const UserSummaryBar = () => {
    if (!selectedUser) return null;
    const p = getEffective(selectedUser);
    const actionTotals = {};
    ACTIONS.forEach(a => { actionTotals[a.id] = { granted: 0, total: 0 }; });
    PERMISSION_SECTIONS.forEach(s => {
      s.actions.forEach(a => {
        if (actionTotals[a]) {
          actionTotals[a].total++;
          if (p[s.id]?.[a]) actionTotals[a].granted++;
        }
      });
    });
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {ACTIONS.filter(a => actionTotals[a.id]?.total > 0).map(a => {
          const { granted, total } = actionTotals[a.id];
          const pct = Math.round((granted / total) * 100);
          return (
            <div key={a.id} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${a.color}25`, borderRadius: 8, padding: '8px 12px', minWidth: 80, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                <span style={{ fontSize: 11 }}>{a.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: a.color, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{a.label}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: a.color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
                {granted}<span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>/{total}</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, marginTop: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: a.color, borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── Left: engineer roster ──────────────────────────────────────────── */}
      <div style={{ width: 210, flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, paddingLeft: 4 }}>
          Team Members
        </div>
        {users.map(u => {
          const { granted, total } = permSummary(u.id);
          const pct = Math.round((granted / total) * 100);
          const isMgr = u.role === 'Manager';
          const isSelected = selectedUser === u.id;
          return (
            <div key={u.id}
              onClick={() => { setSelectedUser(u.id); setView('matrix'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                borderRadius: 10, cursor: 'pointer', marginBottom: 4,
                background: isSelected ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isSelected ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.05)'}`,
                transition: 'all 0.12s',
              }}>
              {/* Avatar */}
              <div style={{ width: 30, height: 30, borderRadius: 8, background: u.color || '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                {u.avatar || u.name?.charAt(0) || '?'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.name.split(' ')[0]} {u.name.split(' ')[1]?.[0] || ''}.
                  </span>
                  {isMgr && <span style={{ fontSize: 8, background: 'rgba(251,191,36,0.18)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 3, padding: '1px 4px', fontWeight: 700, flexShrink: 0 }}>MGR</span>}
                  {hasOverrides(u.id) && !isMgr && <div title="Custom permissions" style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'DM Mono', marginTop: 1 }}>{u.id}</div>
                {/* Mini progress bar */}
                {!isMgr && (
                  <div style={{ marginTop: 4, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: pct > 60 ? '#34d399' : pct > 30 ? '#fbbf24' : '#f87171', borderRadius: 2, transition: 'width 0.3s' }} />
                  </div>
                )}
                {isMgr && <div style={{ fontSize: 8, color: '#fbbf24', marginTop: 2 }}>Full access — all {total} perms</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Right: editor panel ────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selectedUser ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🔑</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>Select a team member</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Choose an engineer or manager from the left to manage their permissions</div>
          </div>
        ) : (() => {
          const u = users.find(x => x.id === selectedUser);
          return (
            <>
              {/* ── User header ─────────────────────────────────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: u?.color || '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {u?.avatar || u?.name?.charAt(0) || '?'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{u?.name}</span>
                    <span style={{ fontSize: 10, background: isManager ? 'rgba(251,191,36,0.15)' : 'rgba(96,165,250,0.12)', color: isManager ? '#fbbf24' : '#60a5fa', border: `1px solid ${isManager ? 'rgba(251,191,36,0.3)' : 'rgba(96,165,250,0.25)'}`, borderRadius: 5, padding: '2px 7px', fontWeight: 700 }}>
                      {u?.role || 'Engineer'}
                    </span>
                    {hasOverrides(selectedUser) && !isManager && (
                      <span style={{ fontSize: 10, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 5, padding: '2px 7px' }}>
                        ● Custom permissions
                      </span>
                    )}
                    {isManager && (
                      <span style={{ fontSize: 10, background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 5, padding: '2px 7px' }}>
                        🔒 All access — cannot be restricted
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'DM Mono' }}>{u?.id}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!isManager && (
                    <button onClick={resetToDefault}
                      style={{ padding: '6px 12px', fontSize: 11, borderRadius: 7, cursor: 'pointer', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', fontWeight: 600 }}>
                      ↺ Reset
                    </button>
                  )}
                  {flashMsg && <span style={{ fontSize: 11, color: '#6ee7b7', display: 'flex', alignItems: 'center' }}>{flashMsg}</span>}
                </div>
              </div>

              {/* ── View tabs ───────────────────────────────────────────── */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
                {[['matrix','🔒 Permissions'],['templates','📋 Templates & Copy']].map(([id, label]) => (
                  <button key={id} onClick={() => setView(id)}
                    style={{ padding: '6px 14px', fontSize: 12, borderRadius: 7, cursor: 'pointer', fontWeight: 600,
                      background: view === id ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${view === id ? 'rgba(59,130,246,0.45)' : 'rgba(255,255,255,0.08)'}`,
                      color: view === id ? '#93c5fd' : 'var(--text-secondary)' }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* ═══════════════════ MATRIX VIEW ═══════════════════ */}
              {view === 'matrix' && (
                <>
                  {/* Summary bar */}
                  <UserSummaryBar />

                  {!isManager && (
                    <>
                      {/* Filter / search row */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input placeholder="🔍 Filter sections…" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                          style={{ padding: '6px 10px', fontSize: 12, borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', outline: 'none', width: 180 }} />
                        <div style={{ display: 'flex', gap: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>Filter:</span>
                          {[{ id: 'all', label: 'All', color: 'var(--text-secondary)' }, ...ACTIONS].map(a => (
                            <button key={a.id} onClick={() => setFilterAction(a.id)}
                              style={{ padding: '4px 9px', fontSize: 10, borderRadius: 5, cursor: 'pointer', fontWeight: 700,
                                background: filterAction === a.id ? (a.color ? a.color + '22' : 'rgba(255,255,255,0.1)') : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${filterAction === a.id ? (a.color + '55' || 'rgba(255,255,255,0.25)') : 'rgba(255,255,255,0.07)'}`,
                                color: filterAction === a.id ? (a.color || 'var(--text-primary)') : 'var(--text-muted)' }}>
                              {a.icon ? `${a.icon} ${a.label}` : a.label}
                            </button>
                          ))}
                        </div>
                        {/* Bulk global toggles */}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                          <button onClick={() => { ACTIONS.forEach(a => setAllActions(a.id, true)); }}
                            style={{ padding: '4px 10px', fontSize: 10, borderRadius: 5, cursor: 'pointer', fontWeight: 700, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }}>
                            Grant All ✓
                          </button>
                          <button onClick={() => { ACTIONS.forEach(a => setAllActions(a.id, false)); }}
                            style={{ padding: '4px 10px', fontSize: 10, borderRadius: 5, cursor: 'pointer', fontWeight: 700, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
                            Revoke All ✕
                          </button>
                        </div>
                      </div>

                      {/* Permission groups */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {filteredGroups.map(group => {
                          const isExpanded = expandedGroups[group.id] !== false; // default open
                          const groupSections = group.sections;
                          const totalGranted = groupSections.reduce((s, sec) =>
                            s + sec.actions.filter(a => currentPerms?.[sec.id]?.[a]).length, 0);
                          const totalPossible = groupSections.reduce((s, sec) => s + sec.actions.length, 0);
                          const pct = totalPossible > 0 ? Math.round((totalGranted / totalPossible) * 100) : 0;

                          return (
                            <div key={group.id} style={{ border: `1px solid ${group.color}20`, borderRadius: 12, overflow: 'hidden' }}>
                              {/* Group header */}
                              <div
                                onClick={() => setExpandedGroups(prev => ({ ...prev, [group.id]: !isExpanded }))}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: `${group.color}0d`, cursor: 'pointer', userSelect: 'none' }}>
                                <span style={{ fontSize: 16 }}>{group.icon}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: group.color, flex: 1 }}>{group.label}</span>
                                {/* Group bulk buttons */}
                                <button onClick={e => { e.stopPropagation(); setAllForGroup(group.id, true); }}
                                  style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399', fontWeight: 700 }}>
                                  All ✓
                                </button>
                                <button onClick={e => { e.stopPropagation(); setAllForGroup(group.id, false); }}
                                  style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', fontWeight: 700 }}>
                                  All ✕
                                </button>
                                {/* Mini progress */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 80 }}>
                                  <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${pct}%`, background: group.color, borderRadius: 2, transition: 'width 0.3s' }} />
                                  </div>
                                  <span style={{ fontSize: 9, color: group.color, fontFamily: 'DM Mono', fontWeight: 700, minWidth: 28, textAlign: 'right' }}>{pct}%</span>
                                </div>
                                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{isExpanded ? '▲' : '▼'}</span>
                              </div>

                              {/* Section rows */}
                              {isExpanded && (
                                <div style={{ padding: '6px 8px 8px' }}>
                                  {/* Action column headers */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(7, 52px)', gap: 2, marginBottom: 4, paddingLeft: 8 }}>
                                    <div />
                                    {ACTIONS.map(a => (
                                      <div key={a.id} style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 9, fontWeight: 700, color: a.color, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{a.label}</div>
                                      </div>
                                    ))}
                                  </div>

                                  {groupSections.map((sec, si) => {
                                    const perms   = currentPerms?.[sec.id] || {};
                                    const allOn   = sec.actions.every(a => perms[a]);
                                    const someOn  = sec.actions.some(a => perms[a]);
                                    return (
                                      <div key={sec.id} style={{
                                        display: 'grid', gridTemplateColumns: '1fr repeat(7, 52px)', gap: 2,
                                        alignItems: 'center', padding: '5px 8px', borderRadius: 8, marginBottom: 2,
                                        background: si % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                                        border: `1px solid ${someOn ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'}`,
                                      }}>
                                        {/* Label */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                          <span style={{ fontSize: 13 }}>{sec.icon}</span>
                                          <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{sec.label}</span>
                                          <button onClick={() => setAllForSection(sec.id, !allOn)}
                                            title={allOn ? 'Revoke all' : 'Grant all'}
                                            style={{ marginLeft: 2, fontSize: 8, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
                                              background: allOn ? 'rgba(239,68,68,0.1)' : 'rgba(52,211,153,0.1)',
                                              border: `1px solid ${allOn ? 'rgba(239,68,68,0.25)' : 'rgba(52,211,153,0.25)'}`,
                                              color: allOn ? '#fca5a5' : '#6ee7b7', fontWeight: 700 }}>
                                            {allOn ? '✕' : '✓'}
                                          </button>
                                        </div>
                                        {/* Toggle per action */}
                                        {ACTIONS.map(a => {
                                          const supported = sec.actions.includes(a.id);
                                          const on = supported && !!perms[a.id];
                                          return (
                                            <div key={a.id} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                              {supported ? (
                                                <button onClick={() => setAction(sec.id, a.id, !on)}
                                                  title={`${on ? 'Revoke' : 'Grant'} ${a.label} for ${sec.label}`}
                                                  style={{
                                                    width: 30, height: 18, borderRadius: 9, cursor: 'pointer', border: 'none', padding: 0,
                                                    background: on ? a.color + '33' : 'rgba(255,255,255,0.06)',
                                                    outline: `1.5px solid ${on ? a.color + '70' : 'rgba(255,255,255,0.08)'}`,
                                                    display: 'flex', alignItems: 'center',
                                                    justifyContent: on ? 'flex-end' : 'flex-start',
                                                    paddingLeft: on ? 0 : 3, paddingRight: on ? 3 : 0,
                                                    transition: 'all 0.13s',
                                                  }}>
                                                  <div style={{
                                                    width: 12, height: 12, borderRadius: 6,
                                                    background: on ? a.color : 'rgba(255,255,255,0.2)',
                                                    transition: 'all 0.13s',
                                                    boxShadow: on ? `0 0 4px ${a.color}80` : 'none',
                                                  }} />
                                                </button>
                                              ) : (
                                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.08)' }}>—</span>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* Manager readonly notice */}
                  {isManager && (
                    <div style={{ padding: 20, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🛡</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>Manager — Full Access</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        Managers have all permissions across every section and cannot be restricted.
                        Individual toggles are not applicable for this role.
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ═══════════════════ TEMPLATES VIEW ═══════════════════ */}
              {view === 'templates' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* Copy from */}
                  <div style={{ padding: 16, borderRadius: 12, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.18)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>📋 Copy permissions from another engineer</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select value={copySourceId} onChange={e => setCopySourceId(e.target.value)}
                        style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'var(--input-bg, rgba(255,255,255,0.05))', color: 'var(--text-primary)', fontSize: 12 }}>
                        <option value="">— Select source engineer —</option>
                        {users.filter(uu => uu.id !== selectedUser).map(uu => (
                          <option key={uu.id} value={uu.id}>{uu.name} ({uu.id}){hasOverrides(uu.id) ? ' ★' : ''}</option>
                        ))}
                      </select>
                      <button onClick={copyFrom} disabled={!copySourceId}
                        style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(59,130,246,0.18)', border: '1px solid rgba(59,130,246,0.4)', color: '#93c5fd', opacity: copySourceId ? 1 : 0.4 }}>
                        Copy →
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>★ = has custom permissions. Overwrites {u?.name?.split(' ')[0]}'s current settings.</p>
                  </div>

                  {/* Save as template */}
                  <div style={{ padding: 16, borderRadius: 12, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>💾 Save current permissions as a template</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'var(--input-bg, rgba(255,255,255,0.05))', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
                        placeholder="Template name (e.g. Read-Only, Senior Engineer)"
                        value={templateName} onChange={e => setTemplateName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveTemplate()} />
                      <button onClick={saveTemplate} disabled={!templateName.trim()}
                        style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.18)', border: '1px solid rgba(52,211,153,0.4)', color: '#6ee7b7', opacity: templateName.trim() ? 1 : 0.4 }}>
                        Save
                      </button>
                    </div>
                  </div>

                  {/* Apply template */}
                  <div style={{ padding: 16, borderRadius: 12, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>📂 Apply a saved template</div>
                    {Object.keys(templates).length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No templates yet — configure permissions and save one above.</p>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                          <select value={applyTemplateKey} onChange={e => setApplyTemplateKey(e.target.value)}
                            style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'var(--input-bg, rgba(255,255,255,0.05))', color: 'var(--text-primary)', fontSize: 12 }}>
                            <option value="">— Select template —</option>
                            {Object.keys(templates).map(name => <option key={name} value={name}>{name}</option>)}
                          </select>
                          <button onClick={applyTemplate} disabled={!applyTemplateKey}
                            style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.4)', color: '#fcd34d', opacity: applyTemplateKey ? 1 : 0.4 }}>
                            Apply
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {Object.keys(templates).map(name => (
                            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '4px 10px' }}>
                              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{name}</span>
                              <button onClick={() => deleteTemplate(name)}
                                style={{ fontSize: 11, background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 0 }}>✕</button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                      💡 <strong style={{ color: 'var(--text-secondary)' }}>Tip:</strong> Templates are saved to Google Drive and sync automatically. When adding a new engineer in Settings → Team, you can apply a saved template immediately.
                    </p>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
