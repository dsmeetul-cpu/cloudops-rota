// src/permissions.js
// CloudOps Rota — Permissions System
// Meetul Bhundia (MBA47) · Cloud Run Operations

import React, { useState } from 'react';

// ── Section definitions ─────────────────────────────────────────────────────
// Every navigable section of the app with the actions that are meaningful for it.
// read   = can view / load the page
// write  = can add or edit records
// delete = can remove records
export const PERMISSION_SECTIONS = [
  { id: 'dashboard',  label: 'Dashboard',        icon: '◈',  actions: ['read'] },
  { id: 'oncall',     label: "Who's On Call",     icon: '📡', actions: ['read'] },
  { id: 'myshift',    label: 'My Shift',          icon: '🗓', actions: ['read'] },
  { id: 'calendar',   label: 'Calendar',          icon: '📅', actions: ['read'] },
  { id: 'rota',       label: 'Rota',              icon: '🔄', actions: ['read', 'write'] },
  { id: 'incidents',  label: 'Incidents',         icon: '🚨', actions: ['read', 'write', 'delete'] },
  { id: 'timesheets', label: 'Timesheets',        icon: '⏱', actions: ['read', 'write', 'delete'] },
  { id: 'holidays',   label: 'Holidays',          icon: '🌴', actions: ['read', 'write', 'delete'] },
  { id: 'swaps',      label: 'Shift Swaps',       icon: '🔁', actions: ['read', 'write', 'delete'] },
  { id: 'upgrades',   label: 'Upgrade Days',      icon: '⬆', actions: ['read', 'write', 'delete'] },
  { id: 'stress',     label: 'Stress Score',      icon: '📊', actions: ['read'] },
  { id: 'toil',       label: 'TOIL',              icon: '⏳', actions: ['read', 'write', 'delete'] },
  { id: 'absence',    label: 'Absence / Sick',    icon: '🏥', actions: ['read', 'write', 'delete'] },
  { id: 'overtime',   label: 'Overtime',          icon: '🕐', actions: ['read', 'write', 'delete'] },
  { id: 'logbook',    label: 'Logbook',           icon: '📓', actions: ['read', 'write', 'delete'] },
  { id: 'wiki',       label: 'Wiki',              icon: '📖', actions: ['read', 'write', 'delete'] },
  { id: 'glossary',   label: 'Glossary',          icon: '📚', actions: ['read', 'write', 'delete'] },
  { id: 'contacts',   label: 'Contacts',          icon: '👥', actions: ['read', 'write', 'delete'] },
  { id: 'notes',      label: 'Notes',             icon: '🗒️', actions: ['read', 'write', 'delete'] },
  { id: 'docs',       label: 'Documents',         icon: '📁', actions: ['read', 'write', 'delete'] },
  { id: 'whatsapp',   label: 'Team Chat',         icon: '💬', actions: ['read', 'write', 'delete'] },
  { id: 'insights',   label: 'Insights',          icon: '💡', actions: ['read'] },
  { id: 'capacity',   label: 'Capacity',          icon: '📈', actions: ['read'] },
  { id: 'reports',    label: 'Weekly Reports',    icon: '📋', actions: ['read', 'write', 'delete'] },
  { id: 'payroll',    label: 'Payroll',           icon: '💷', actions: ['read'] },
  { id: 'payconfig',  label: 'Pay Config',        icon: '⚙',  actions: ['read', 'write'] },
  { id: 'settings',   label: 'Settings',          icon: '🔧', actions: ['read', 'write', 'delete'] },
  { id: 'myaccount',  label: 'My Account',        icon: '👤', actions: ['read', 'write'] },
];

// ── Default permission sets ─────────────────────────────────────────────────
// Manager gets everything. Engineer gets read-everywhere + write on
// operational sections + delete on personal content only.
const ENGINEER_WRITE_SECTIONS = [
  'incidents','timesheets','swaps','toil','absence','overtime',
  'logbook','wiki','glossary','contacts','notes','docs',
  'whatsapp','myaccount','upgrades',
];
const ENGINEER_DELETE_SECTIONS = ['logbook','notes','whatsapp'];

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
        ...(s.actions.includes('read')   ? { read:   true }                                    : {}),
        ...(s.actions.includes('write')  ? { write:  ENGINEER_WRITE_SECTIONS.includes(s.id) }  : {}),
        ...(s.actions.includes('delete') ? { delete: ENGINEER_DELETE_SECTIONS.includes(s.id) } : {}),
      }
    ])
  ),
};

// ── Helper functions ────────────────────────────────────────────────────────

/**
 * Check whether a user can perform an action on a section.
 * Falls back to role default when no per-user override exists.
 *
 * @param {object} permissions  - The full permissions state object { [uid]: { [section]: { read, write, delete } } }
 * @param {string} userId       - The current user's ID
 * @param {string} userRole     - 'Manager' | 'Engineer'
 * @param {string} section      - A section id from PERMISSION_SECTIONS
 * @param {string} action       - 'read' | 'write' | 'delete'
 * @returns {boolean}
 */
export function canDo(permissions, userId, userRole, section, action) {
  // Managers always have full access — cannot be restricted
  if (userRole === 'Manager') return true;
  const userPerms = permissions?.[userId];
  if (!userPerms) {
    return DEFAULT_PERMISSIONS[userRole]?.[section]?.[action] ?? false;
  }
  return userPerms[section]?.[action] ?? false;
}

/**
 * Build a deep-cloned default permission set for a given role.
 * @param {string} role - 'Manager' | 'Engineer'
 * @returns {object}
 */
export function buildDefaultPerms(role) {
  const base = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.Engineer;
  return JSON.parse(JSON.stringify(base));
}

// ── PermissionsManager component ───────────────────────────────────────────
/**
 * Full permission management UI.
 * Rendered inside the Settings page under the "Permissions" tab.
 *
 * Props:
 *   users        - array of user objects
 *   permissions  - { [uid]: { [sectionId]: { read, write, delete } } }
 *   setPermissions - state setter
 */
export function PermissionsManager({ users, permissions, setPermissions }) {
  const [selectedUser, setSelectedUser]       = useState(null);
  const [tab, setTab]                         = useState('matrix'); // 'matrix' | 'templates'
  const [templateName, setTemplateName]       = useState('');
  const [copySourceId, setCopySourceId]       = useState('');
  const [applyTemplateKey, setApplyTemplateKey] = useState('');
  const [flashMsg, setFlashMsg]               = useState('');

  // ── Template storage (localStorage — not Drive, intentionally lightweight) ─
  const loadTemplates = () => {
    try { return JSON.parse(localStorage.getItem('cr_perm_templates') || '{}'); } catch { return {}; }
  };
  const [templates, setTemplates] = useState(loadTemplates);

  const persistTemplates = (t) => {
    setTemplates(t);
    try { localStorage.setItem('cr_perm_templates', JSON.stringify(t)); } catch {}
  };

  const flash = (msg) => { setFlashMsg(msg); setTimeout(() => setFlashMsg(''), 2500); };

  // ── Effective permissions for selected user ─────────────────────────────
  const getEffective = (uid) => {
    const u    = users.find(x => x.id === uid);
    const base = buildDefaultPerms(u?.role || 'Engineer');
    const saved = permissions?.[uid];
    if (!saved) return base;
    const merged = { ...base };
    Object.keys(saved).forEach(sec => {
      merged[sec] = { ...(base[sec] || {}), ...saved[sec] };
    });
    return merged;
  };

  const currentPerms = selectedUser ? getEffective(selectedUser) : null;
  const hasOverrides = (uid) => !!permissions?.[uid];

  // ── Setters ─────────────────────────────────────────────────────────────
  const setAction = (section, action, value) => {
    if (!selectedUser) return;
    setPermissions(prev => ({
      ...prev,
      [selectedUser]: {
        ...getEffective(selectedUser),
        [section]: { ...getEffective(selectedUser)[section], [action]: value },
      },
    }));
  };

  const setAllForSection = (section, value) => {
    if (!selectedUser) return;
    const sec = PERMISSION_SECTIONS.find(s => s.id === section);
    if (!sec) return;
    setPermissions(prev => ({
      ...prev,
      [selectedUser]: {
        ...getEffective(selectedUser),
        [section]: Object.fromEntries(sec.actions.map(a => [a, value])),
      },
    }));
  };

  const setAllActions = (action, value) => {
    if (!selectedUser) return;
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
    if (!selectedUser || !copySourceId || copySourceId === selectedUser) return;
    setPermissions(prev => ({
      ...prev,
      [selectedUser]: JSON.parse(JSON.stringify(getEffective(copySourceId))),
    }));
    flash(`✅ Copied from ${users.find(u => u.id === copySourceId)?.name}`);
  };

  const saveTemplate = () => {
    if (!selectedUser || !templateName.trim()) return;
    const updated = { ...templates, [templateName.trim()]: JSON.parse(JSON.stringify(getEffective(selectedUser))) };
    persistTemplates(updated);
    setTemplateName('');
    flash(`✅ Template "${templateName.trim()}" saved`);
  };

  const applyTemplate = () => {
    if (!selectedUser || !applyTemplateKey || !templates[applyTemplateKey]) return;
    setPermissions(prev => ({
      ...prev,
      [selectedUser]: JSON.parse(JSON.stringify(templates[applyTemplateKey])),
    }));
    flash(`✅ Template "${applyTemplateKey}" applied`);
  };

  const deleteTemplate = (name) => {
    const updated = { ...templates };
    delete updated[name];
    persistTemplates(updated);
    if (applyTemplateKey === name) setApplyTemplateKey('');
  };

  // ── Colours ─────────────────────────────────────────────────────────────
  const ACTION_COLORS  = { read: '#3b82f6', write: '#10b981', delete: '#ef4444' };
  const ACTION_LABELS  = { read: 'Read',    write: 'Write',   delete: 'Delete'  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

      {/* ── Left: engineer list ─────────────────────────────────────────── */}
      <div style={{ width: 196, flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, paddingLeft: 4 }}>
          Select Engineer
        </div>
        {users.map(u => (
          <div key={u.id}
            onClick={() => { setSelectedUser(u.id); setTab('matrix'); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
              borderRadius: 8, cursor: 'pointer', marginBottom: 3,
              background: selectedUser === u.id ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${selectedUser === u.id ? 'rgba(59,130,246,0.4)' : 'transparent'}`,
              transition: 'background 0.12s',
            }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: u.color || '#1d4ed8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>{u.avatar || '?'}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.name.split(' ')[0]} {u.name.split(' ')[1]?.[0] || ''}.
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u.id} · {u.role || 'Eng'}</div>
            </div>
            {hasOverrides(u.id) && (
              <div title="Custom permissions active" style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
            )}
          </div>
        ))}
      </div>

      {/* ── Right: editor ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selectedUser ? (
          <div style={{ padding: '50px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            ← Select an engineer to manage their permissions
          </div>
        ) : (() => {
          const u = users.find(x => x.id === selectedUser);
          return (
            <>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: u?.color || '#1d4ed8',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {u?.avatar || '?'}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{u?.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u?.id} · {u?.role || 'Engineer'}</div>
                </div>
                {hasOverrides(selectedUser) && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(245,158,11,0.15)',
                    color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '3px 9px' }}>
                    ● Custom permissions active
                  </span>
                )}
              </div>

              {/* Sub-tab bar */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 14, alignItems: 'center' }}>
                {[['matrix','🔒 Matrix'],['templates','📋 Templates & Copy']].map(([id, label]) => (
                  <button key={id} onClick={() => setTab(id)}
                    style={{
                      padding: '4px 12px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                      background: tab === id ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${tab === id ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      color: tab === id ? '#93c5fd' : 'var(--text-secondary)',
                    }}>
                    {label}
                  </button>
                ))}
                <button onClick={resetToDefault}
                  style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
                  ↺ Reset to defaults
                </button>
                {flashMsg && <span style={{ fontSize: 11, color: '#6ee7b7', marginLeft: 6 }}>{flashMsg}</span>}
              </div>

              {/* ════════════════ MATRIX TAB ════════════════ */}
              {tab === 'matrix' && (
                <>
                  {/* Column headers + bulk toggles */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 86px 86px 86px', gap: 4, marginBottom: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 10 }}>Section</div>
                    {['read','write','delete'].map(action => (
                      <div key={action} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: ACTION_COLORS[action],
                          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                          {ACTION_LABELS[action]}
                        </div>
                        <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                          <button onClick={() => setAllActions(action, true)} title={`Grant all ${action}`}
                            style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                              background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
                              color: '#6ee7b7' }}>All ✓</button>
                          <button onClick={() => setAllActions(action, false)} title={`Revoke all ${action}`}
                            style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                              color: '#fca5a5' }}>All ✕</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Permission rows */}
                  {PERMISSION_SECTIONS.map(sec => {
                    const perms  = currentPerms?.[sec.id] || {};
                    const allOn  = sec.actions.every(a  => perms[a]);
                    return (
                      <div key={sec.id}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 86px 86px 86px', gap: 4,
                          marginBottom: 3, alignItems: 'center',
                          background: 'rgba(255,255,255,0.02)', borderRadius: 8,
                          padding: '5px 8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                        {/* Section label + row all-toggle */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ fontSize: 13, flexShrink: 0 }}>{sec.icon}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{sec.label}</span>
                          <button onClick={() => setAllForSection(sec.id, !allOn)}
                            title={allOn ? 'Revoke all for this section' : 'Grant all for this section'}
                            style={{ marginLeft: 4, fontSize: 9, padding: '1px 6px', borderRadius: 4, cursor: 'pointer',
                              background: allOn ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                              border: `1px solid ${allOn ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
                              color: allOn ? '#fca5a5' : '#6ee7b7' }}>
                            {allOn ? '✕ All' : '✓ All'}
                          </button>
                        </div>
                        {/* Toggle pills */}
                        {['read','write','delete'].map(action => {
                          const supported = sec.actions.includes(action);
                          const on = supported && !!perms[action];
                          return (
                            <div key={action} style={{ display: 'flex', justifyContent: 'center' }}>
                              {supported ? (
                                <button onClick={() => setAction(sec.id, action, !on)}
                                  title={`${on ? 'Revoke' : 'Grant'} ${action} for ${sec.label}`}
                                  style={{
                                    width: 52, height: 26, borderRadius: 13, cursor: 'pointer',
                                    background: on ? `${ACTION_COLORS[action]}33` : 'rgba(255,255,255,0.05)',
                                    border: `1px solid ${on ? ACTION_COLORS[action] + '66' : 'rgba(255,255,255,0.1)'}`,
                                    display: 'flex', alignItems: 'center',
                                    justifyContent: on ? 'flex-end' : 'flex-start',
                                    padding: '0 4px', transition: 'all 0.15s',
                                  }}>
                                  <div style={{
                                    width: 18, height: 18, borderRadius: 9, transition: 'all 0.15s',
                                    background: on ? ACTION_COLORS[action] : 'rgba(255,255,255,0.2)',
                                  }} />
                                </button>
                              ) : (
                                <div style={{ width: 52, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.1)' }}>—</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              )}

              {/* ════════════════ TEMPLATES & COPY TAB ════════════════ */}
              {tab === 'templates' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* Copy from another engineer */}
                  <div style={{ padding: 14, borderRadius: 10, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
                      📋 Copy permissions from another engineer
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 12 }}
                        value={copySourceId} onChange={e => setCopySourceId(e.target.value)}>
                        <option value="">— Select source engineer —</option>
                        {users.filter(uu => uu.id !== selectedUser).map(uu => (
                          <option key={uu.id} value={uu.id}>
                            {uu.name} ({uu.id}){hasOverrides(uu.id) ? ' ★' : ''}
                          </option>
                        ))}
                      </select>
                      <button onClick={copyFrom} disabled={!copySourceId}
                        style={{ padding: '7px 16px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                          background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', color: '#93c5fd',
                          opacity: copySourceId ? 1 : 0.4 }}>
                        Copy →
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                      ★ = has custom permissions set. This will overwrite {u?.name?.split(' ')[0]}'s current permissions.
                    </p>
                  </div>

                  {/* Save as template */}
                  <div style={{ padding: 14, borderRadius: 10, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
                      💾 Save current permissions as a template
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
                        placeholder="Template name (e.g. Read-Only, Senior Engineer)"
                        value={templateName}
                        onChange={e => setTemplateName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveTemplate()} />
                      <button onClick={saveTemplate} disabled={!templateName.trim()}
                        style={{ padding: '7px 16px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                          background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', color: '#6ee7b7',
                          opacity: templateName.trim() ? 1 : 0.4 }}>
                        Save
                      </button>
                    </div>
                  </div>

                  {/* Apply a saved template */}
                  <div style={{ padding: 14, borderRadius: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
                      📂 Apply a saved template
                    </div>
                    {Object.keys(templates).length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        No templates yet — configure permissions above and save one.
                      </p>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                          <select
                            style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 12 }}
                            value={applyTemplateKey} onChange={e => setApplyTemplateKey(e.target.value)}>
                            <option value="">— Select template —</option>
                            {Object.keys(templates).map(name => <option key={name} value={name}>{name}</option>)}
                          </select>
                          <button onClick={applyTemplate} disabled={!applyTemplateKey}
                            style={{ padding: '7px 16px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                              background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: '#fcd34d',
                              opacity: applyTemplateKey ? 1 : 0.4 }}>
                            Apply
                          </button>
                        </div>
                        {/* Template chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {Object.keys(templates).map(name => (
                            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 5,
                              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: 6, padding: '3px 8px' }}>
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{name}</span>
                              <button onClick={() => deleteTemplate(name)}
                                style={{ fontSize: 11, background: 'none', border: 'none', color: '#fca5a5',
                                  cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Tip */}
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                      💡 <strong style={{ color: 'var(--text-secondary)' }}>Tip:</strong> When you add a new engineer in Settings → Team & Drive,
                      you can copy from an existing engineer or apply a saved template directly in the Add Engineer modal —
                      no need to come back here to set them up from scratch.
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
