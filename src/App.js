// src/App.js
// CloudOps Rota — Full Production Build
// Meetul Bhundia (MBA47) · Cloud Run Operations · April 2026

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import {
  initGoogleAuth, gapiLoad, loadAllFromDrive, driveWrite,
  generateICalFeed, downloadIcal
} from './hooks/useGoogleDrive';
import {
  DEFAULT_USERS, DEFAULT_HOLIDAYS, DEFAULT_INCIDENTS, DEFAULT_TIMESHEETS,
  DEFAULT_UPGRADES, DEFAULT_WIKI, DEFAULT_GLOSSARY, DEFAULT_CONTACTS,
  DEFAULT_PAYCONFIG, SHIFTS, UK_BANK_HOLIDAYS, generateRota,
  generateTrigramId, TRICOLORS
} from './utils/defaults';

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

// ── Auth (extend as engineers are added) ──────────────────────────────────
const AUTH = { MBA47: 'manager123', MAH01: 'eng123', DAR02: 'eng123', MAR03: 'eng123' };

// ── Rich Text Editor (lightweight, no deps) ───────────────────────────────
function RichEditor({ value, onChange, placeholder = 'Start typing…', rows = 8 }) {
  const ref = useRef(null);

  const exec = (cmd, val = null) => { document.execCommand(cmd, false, val); ref.current.focus(); };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        ref.current.innerText = ev.target.result;
        onChange(ref.current.innerHTML);
      } else {
        ref.current.innerHTML = `<p><em>Imported: ${file.name}</em></p><pre>${ev.target.result.slice(0, 2000)}</pre>`;
        onChange(ref.current.innerHTML);
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
    }
  }, []);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card2)' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
        {[
          { cmd: 'bold', label: 'B', style: { fontWeight: 700 } },
          { cmd: 'italic', label: 'I', style: { fontStyle: 'italic' } },
          { cmd: 'underline', label: 'U', style: { textDecoration: 'underline' } },
          { cmd: 'strikeThrough', label: 'S̶', style: {} },
        ].map(b => (
          <button key={b.cmd} onMouseDown={e => { e.preventDefault(); exec(b.cmd); }}
            style={{ ...b.style, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}>
            {b.label}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        {[
          { cmd: 'insertUnorderedList', label: '• List' },
          { cmd: 'insertOrderedList', label: '1. List' },
          { cmd: 'formatBlock', val: 'H2', label: 'H2' },
          { cmd: 'formatBlock', val: 'H3', label: 'H3' },
          { cmd: 'formatBlock', val: 'P', label: '¶' },
        ].map(b => (
          <button key={b.cmd + b.label} onMouseDown={e => { e.preventDefault(); exec(b.cmd, b.val || null); }}
            style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}>
            {b.label}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        {[
          { cmd: 'justifyLeft', label: '⬅' },
          { cmd: 'justifyCenter', label: '↔' },
          { cmd: 'justifyRight', label: '➡' },
        ].map(b => (
          <button key={b.cmd} onMouseDown={e => { e.preventDefault(); exec(b.cmd); }}
            style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}>
            {b.label}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        <select onChange={e => exec('foreColor', e.target.value)} defaultValue=""
          style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer' }}>
          <option value="" disabled>🎨 Color</option>
          <option value="#ffffff">White</option>
          <option value="#fca5a5">Red</option>
          <option value="#6ee7b7">Green</option>
          <option value="#93c5fd">Blue</option>
          <option value="#fcd34d">Yellow</option>
          <option value="#c4b5fd">Purple</option>
        </select>
        <select onChange={e => exec('fontSize', e.target.value)} defaultValue=""
          style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer' }}>
          <option value="" disabled>Size</option>
          {[1,2,3,4,5,6,7].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        <label style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          📎 Import
          <input type="file" accept=".txt,.md,.csv" onChange={handleImport} style={{ display: 'none' }} />
        </label>
        <button onMouseDown={e => { e.preventDefault(); exec('removeFormat'); }}
          style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>
          Clear fmt
        </button>
      </div>
      {/* Editable area */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange && onChange(ref.current.innerHTML)}
        data-placeholder={placeholder}
        style={{
          minHeight: rows * 22, padding: '12px 14px', outline: 'none',
          fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7,
          caretColor: 'var(--accent)'
        }}
      />
    </div>
  );
}

// ── UI Helpers ─────────────────────────────────────────────────────────────
function Avatar({ user, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size > 40 ? 12 : 8,
      background: user?.color || '#1d4ed8', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size > 40 ? 14 : 11,
      fontWeight: 700, color: '#fff', flexShrink: 0, letterSpacing: 0.5
    }}>{user?.avatar || '?'}</div>
  );
}

function Tag({ label, type = 'blue' }) {
  return <span className={`tag tag-${type}`}>{label}</span>;
}

function Modal({ title, onClose, children, wide, fullscreen }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={fullscreen ? { width: '95vw', maxWidth: 1100, maxHeight: '90vh', overflowY: 'auto' } : wide ? { width: 720 } : {}}>
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
      <label className="form-label">{label}{hint && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>({hint})</span>}</label>
      {children}
    </div>
  );
}

function Alert({ type = 'info', children, style }) {
  return <div className={`alert alert-${type}`} style={style}>{children}</div>;
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

function ShiftLegend() {
  return (
    <div className="shift-legend">
      <div className="legend-item"><div className="legend-dot" style={{ background: '#3b82f6' }} />Daily (9am–6pm)</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#818cf8' }} />Evening (7pm–7am)</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#ec4899' }} />Weekend (7pm–7am)</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#f59e0b' }} />Holiday</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#ef4444' }} />Bank Holiday</div>
    </div>
  );
}

// ── Login Screen ───────────────────────────────────────────────────────────
function LoginScreen({ onLogin, driveToken, onConnectDrive }) {
  const [uid, setUid] = useState('');
  const [pw, setPw]   = useState('');
  const [err, setErr] = useState('');
  const [show2FA, setShow2FA] = useState(false);
  const [twoFACode, setTwoFACode] = useState('');
  const [pending2FA, setPending2FA] = useState('');

  const handle = () => {
    const id = uid.trim().toUpperCase();
    if (AUTH[id] && AUTH[id] === pw) {
      // Manager gets 2FA prompt
      if (id === 'MBA47') { setPending2FA(id); setShow2FA(true); }
      else onLogin(id);
    } else setErr('Invalid username or password');
  };

  const verify2FA = () => {
    // Demo: accept any 6-digit code
    if (twoFACode.length === 6) onLogin(pending2FA);
    else setErr('Invalid 2FA code — enter any 6 digits for demo');
  };

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">
          <div className="login-logo-icon">CR</div>
          <div className="login-title">CloudOps Rota</div>
          <div className="login-sub">Cloud Run Operations Team</div>
        </div>

        {!driveToken && (
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            <strong>📁 Connect Google Drive</strong> to load and save all team data.
            <br />
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={onConnectDrive}>
              Connect Google Drive
            </button>
          </div>
        )}
        {driveToken && (
          <div className="gd-status" style={{ marginBottom: 16 }}>
            <div className="dot-live" /> Google Drive connected
          </div>
        )}

        {err && <Alert type="warning">⚠ {err}</Alert>}

        {!show2FA ? (
          <>
            <FormGroup label="Username (Tri-gram)">
              <input className="input" placeholder="e.g. MBA47"
                value={uid} onChange={e => setUid(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handle()} />
            </FormGroup>
            <FormGroup label="Password">
              <input className="input" type="password" placeholder="Password"
                value={pw} onChange={e => setPw(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handle()} />
            </FormGroup>
            <button className="btn btn-primary" style={{ width: '100%', padding: 11 }} onClick={handle}>
              Sign In
            </button>
            <div className="demo-hint">
              <strong>Demo credentials:</strong><br />
              MBA47 / manager123 &nbsp;|&nbsp; MAH01 / eng123
            </div>
          </>
        ) : (
          <>
            <Alert type="info">🔐 Two-factor authentication required for manager access. Enter your 6-digit code.</Alert>
            <FormGroup label="2FA Code">
              <input className="input" placeholder="6-digit code" maxLength={6}
                value={twoFACode} onChange={e => setTwoFACode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && verify2FA()} autoFocus />
            </FormGroup>
            <button className="btn btn-primary" style={{ width: '100%', padding: 11 }} onClick={verify2FA}>
              Verify & Sign In
            </button>
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => { setShow2FA(false); setErr(''); }}>
              ← Back
            </button>
            <div className="demo-hint">Demo: enter any 6 digits</div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Navigation ─────────────────────────────────────────────────────────────
const NAV = [
  { section: 'Overview', items: [
    { id: 'dashboard', icon: '◈', label: 'Dashboard',       managerOnly: true },
    { id: 'oncall',    icon: '📡', label: "Who's On Call"   },
    { id: 'myshift',   icon: '🗓', label: 'My Shift'        },
    { id: 'calendar',  icon: '📅', label: 'Calendar'        },
  ]},
  { section: 'Operations', items: [
    { id: 'rota',      icon: '🔄', label: 'Rota'            },
    { id: 'incidents', icon: '🚨', label: 'Incidents', badge: true },
  ]},
  { section: 'People', items: [
    { id: 'timesheets', icon: '⏱', label: 'Timesheets'     },
    { id: 'holidays',   icon: '🌴', label: 'Holidays'       },
    { id: 'swaps',      icon: '🔁', label: 'Shift Swaps'    },
    { id: 'upgrades',   icon: '⬆', label: 'Upgrade Days'   },
    { id: 'stress',     icon: '📊', label: 'Stress Score'   },
    { id: 'toil',       icon: '⏳', label: 'TOIL'           },
    { id: 'absence',    icon: '🏥', label: 'Absence / Sick' },
    { id: 'logbook',    icon: '📓', label: 'Logbook'        },
  ]},
  { section: 'Knowledge', items: [
    { id: 'wiki',      icon: '📖', label: 'Wiki'            },
    { id: 'glossary',  icon: '📚', label: 'Glossary'        },
    { id: 'contacts',  icon: '👥', label: 'Contacts'        },
    { id: 'docs',      icon: '📁', label: 'Documents'       },
  ]},
  { section: 'Reporting', items: [
    { id: 'insights',  icon: '💡', label: 'Insights'        },
    { id: 'capacity',  icon: '📈', label: 'Capacity'        },
    { id: 'reports',   icon: '📋', label: 'Weekly Reports'  },
  ]},
  { section: 'Finance', items: [
    { id: 'payroll',   icon: '💷', label: 'Payroll'         },
    { id: 'payconfig', icon: '⚙', label: 'Pay Config'      },
  ]},
  { section: 'Account', items: [
    { id: 'settings',  icon: '🔧', label: 'Settings'        },
    { id: 'myaccount', icon: '👤', label: 'My Account'      },
  ]},
];

// ── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ users, rota, holidays, incidents, timesheets, swapRequests }) {
  const today     = new Date().toISOString().slice(0, 10);
  const onCallToday = users.filter(u => rota[u.id]?.[today] && rota[u.id][today] !== 'off');
  const pending   = holidays.filter(h => h.status === 'pending');
  const openInc   = incidents.filter(i => i.status === 'Investigating');
  const totalHrs  = users.map(u => timesheets[u.id]?.[0]?.hours || 0).reduce((a, b) => a + b, 0);
  const pendingSwaps = (swapRequests || []).filter(s => s.status === 'pending');

  return (
    <div>
      <PageHeader title="Manager Dashboard" sub="Cloud Run Operations · Full team visibility" />
      <div className="grid-4 mb-16">
        <StatCard label="Team Size"        value={users.length}       sub="engineers + manager"      accent="#3b82f6" icon="👥" />
        <StatCard label="Pending Holidays" value={pending.length}     sub="Awaiting approval"        accent="#f59e0b" icon="🌴" />
        <StatCard label="Open Incidents"   value={openInc.length}     sub="Active investigations"    accent="#ef4444" icon="🚨" />
        <StatCard label="Hours This Week"  value={totalHrs}           sub="Across all engineers"     accent="#10b981" icon="⏱" />
      </div>
      <div className="grid-4 mb-16">
        <StatCard label="Pending Swaps"   value={pendingSwaps.length} sub="Awaiting approval"        accent="#818cf8" icon="🔁" />
        <StatCard label="Engineers"       value={users.filter(u=>u.role==='Engineer').length} sub={`of 6 max`} accent="#06b6d4" icon="🧑‍💻" />
        <StatCard label="Resolved Inc."   value={incidents.filter(i=>i.status==='Resolved').length} sub="This period" accent="#10b981" icon="✅" />
        <StatCard label="Approved Leave"  value={holidays.filter(h=>h.status==='approved').length} sub="Holiday bookings" accent="#f59e0b" icon="✈️" />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">👥 Team On-Call Today</div>
          {onCallToday.length === 0 && <p className="muted-sm">No shifts today</p>}
          {onCallToday.map(u => {
            const s = rota[u.id][today];
            return (
              <div className="oncall-card" key={u.id}>
                <Avatar user={u} />
                <div style={{ flex: 1 }}>
                  <div className="name-sm">{u.name}</div>
                  <div className="oncall-shift">{SHIFTS[s]?.label} · {SHIFTS[s]?.time}</div>
                </div>
                <Tag label={SHIFTS[s]?.label} type={s === 'daily' ? 'blue' : s === 'evening' ? 'purple' : 'pink'} />
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="card-title">🌴 Holiday Requests</div>
          {pending.length === 0 && <p className="muted-sm">No pending requests</p>}
          {pending.map(h => {
            const u = users.find(x => x.id === h.userId);
            return (
              <div key={h.id} className="row-item">
                <Avatar user={u || { avatar: '?', color: '#475569' }} size={28} />
                <div style={{ flex: 1 }}>
                  <div className="name-sm">{u?.name}</div>
                  <div className="muted-xs">{h.start} → {h.end}</div>
                </div>
                <Tag label="Pending" type="amber" />
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="card-title">🚨 Active Incidents</div>
          {openInc.map(i => (
            <div key={i.id} className="row-item">
              <div className={`inc-dot sev-${i.severity.toLowerCase()}`} />
              <div>
                <div className="name-sm">{i.title}</div>
                <div className="muted-xs">{i.severity} · {i.date} · {i.reporter}</div>
              </div>
            </div>
          ))}
          {openInc.length === 0 && <p className="muted-sm">No active incidents 🎉</p>}
        </div>
        <div className="card">
          <div className="card-title">📊 Weekly Hours</div>
          {users.map(u => {
            const hrs = timesheets[u.id]?.[0]?.hours || 0;
            const pct = Math.min(100, (hrs / 45) * 100);
            return (
              <div key={u.id} style={{ marginBottom: 12 }}>
                <div className="flex-between" style={{ marginBottom: 4 }}>
                  <span className="muted-xs">{u.name}</span>
                  <span style={{ fontSize: 12, fontFamily: 'DM Mono', color: hrs > 42 ? '#fcd34d' : '#6ee7b7' }}>{hrs}h</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: pct + '%', background: hrs > 42 ? '#f59e0b' : '#10b981' }} />
                </div>
              </div>
            );
          })}
        </div>
        {pendingSwaps.length > 0 && (
          <div className="card">
            <div className="card-title">🔁 Pending Swap Requests</div>
            {pendingSwaps.slice(0, 5).map(s => {
              const req = users.find(u => u.id === s.requesterId);
              const tgt = users.find(u => u.id === s.targetId);
              return (
                <div key={s.id} className="row-item">
                  <div style={{ flex: 1 }}>
                    <div className="name-sm">{req?.name} ↔ {tgt?.name}</div>
                    <div className="muted-xs">{s.reqDate} ↔ {s.tgtDate}</div>
                  </div>
                  <Tag label="Pending" type="amber" />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Who's On Call ──────────────────────────────────────────────────────────
function OnCall({ users, rota }) {
  const today   = new Date();
  const base    = new Date(today);
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  const week    = Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(base.getDate() + i); return d; });
  const DAYS    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const exportIcal = (user) => {
    const content = generateICalFeed(rota[user.id] || {}, user.name);
    downloadIcal(content, `cloudops-rota-${user.id}.ics`);
  };

  return (
    <div>
      <PageHeader title="Who's On Call" sub="Current week schedule — visible to all team members" />
      <Alert>📡 On-call engineers receive notifications at shift start. Export your calendar using the buttons below.</Alert>
      <ShiftLegend />
      <div className="card" style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th>Engineer</th>
              {week.map((d, i) => {
                const ds = d.toISOString().slice(0, 10);
                const bh = UK_BANK_HOLIDAYS.find(b => b.date === ds);
                return (
                  <th key={i} style={{ textAlign: 'center', fontSize: 11, color: bh ? '#fca5a5' : undefined }}>
                    {DAYS[i]}<br />
                    <span style={{ fontFamily: 'DM Mono', color: '#475569', fontSize: 10 }}>{d.getDate()}{bh ? '🔴' : ''}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar user={u} size={26} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{u.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u.id}</div>
                    </div>
                  </div>
                </td>
                {week.map(d => {
                  const ds = d.toISOString().slice(0, 10);
                  const s  = rota[u.id]?.[ds] || 'off';
                  return (
                    <td key={ds} style={{ textAlign: 'center' }}>
                      <div className={`rota-cell ${SHIFTS[s]?.color || 'shift-off'}`}>
                        {s === 'off' ? '—' : SHIFTS[s]?.label?.slice(0, 3)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {users.map(u => (
          <button key={u.id} className="ical-btn" onClick={() => exportIcal(u)}>
            📆 Export {u.name.split(' ')[0]}'s Rota (.ics)
          </button>
        ))}
      </div>
    </div>
  );
}

// ── My Shift ───────────────────────────────────────────────────────────────
function MyShift({ currentUser, rota, users, swapRequests, setSwapRequests }) {
  const user    = users.find(u => u.id === currentUser);
  const today   = new Date();
  const upcoming = [];
  for (let i = 0; i < 28; i++) {
    const d  = new Date(today); d.setDate(today.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    const s  = rota[user?.id]?.[ds];
    if (s && s !== 'off') upcoming.push({ date: ds, shift: s, day: d });
  }
  const todayShift = rota[user?.id]?.[today.toISOString().slice(0, 10)];
  const [swapModal, setSwapModal] = useState(false);
  const [swapForm, setSwapForm]   = useState({ myDate: '', targetId: '', theirDate: '', reason: '' });

  const requestSwap = () => {
    if (!swapForm.myDate || !swapForm.targetId || !swapForm.theirDate) return;
    const newSwap = {
      id: 'swap-' + Date.now(),
      requesterId: currentUser,
      targetId: swapForm.targetId,
      reqDate: swapForm.myDate,
      tgtDate: swapForm.theirDate,
      reason: swapForm.reason,
      status: 'pending',
      created: new Date().toISOString().slice(0,10)
    };
    setSwapRequests([...(swapRequests || []), newSwap]);
    setSwapModal(false);
    setSwapForm({ myDate: '', targetId: '', theirDate: '', reason: '' });
  };

  const exportMine = () => {
    const content = generateICalFeed(rota[user.id] || {}, user.name);
    downloadIcal(content, `my-rota-${user.id}.ics`);
  };

  const mySwaps = (swapRequests || []).filter(s => s.requesterId === currentUser || s.targetId === currentUser);

  return (
    <div>
      <PageHeader title="My Shift" sub={`${user?.name} · ${user?.id}`}
        actions={<button className="btn btn-primary" onClick={() => setSwapModal(true)}>🔁 Request Swap</button>} />
      <div className="grid-2 mb-16">
        <div className="card" style={{ borderColor: todayShift && todayShift !== 'off' ? 'var(--accent)' : undefined }}>
          <div className="card-title">Today's Shift</div>
          {todayShift && todayShift !== 'off' ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{SHIFTS[todayShift].label}</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{SHIFTS[todayShift].time}</div>
              <Tag label="Active Shift" type={todayShift === 'daily' ? 'blue' : todayShift === 'evening' ? 'purple' : 'pink'} />
            </>
          ) : (
            <p className="muted-sm">No shift today — enjoy your time off!</p>
          )}
        </div>
        <div className="card">
          <div className="card-title">Next 28 Days</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>{upcoming.length} shifts</div>
          <p className="muted-sm">Across daily, evening &amp; weekend</p>
        </div>
      </div>
      <div className="card mb-16">
        <div className="card-title">Upcoming Shifts (Next 28 Days)</div>
        {upcoming.length === 0 && <p className="muted-sm">No upcoming shifts</p>}
        {upcoming.map(({ date, shift, day }) => (
          <div key={date} className="flex-between row-item">
            <div>
              <div className="name-sm">{day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
              <div className="muted-xs">{SHIFTS[shift].time}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Tag label={SHIFTS[shift].label} type={shift === 'daily' ? 'blue' : shift === 'evening' ? 'purple' : 'pink'} />
              <button className="btn btn-secondary btn-sm" onClick={() => { setSwapForm({ ...swapForm, myDate: date }); setSwapModal(true); }}>Swap</button>
            </div>
          </div>
        ))}
      </div>
      {mySwaps.length > 0 && (
        <div className="card mb-16">
          <div className="card-title">🔁 My Swap Requests</div>
          {mySwaps.map(s => {
            const other = users.find(u => u.id === (s.requesterId === currentUser ? s.targetId : s.requesterId));
            return (
              <div key={s.id} className="flex-between row-item">
                <div>
                  <div className="name-sm">{s.requesterId === currentUser ? 'You requested' : `${other?.name} requested`}</div>
                  <div className="muted-xs">{s.reqDate} ↔ {s.tgtDate} with {other?.name}</div>
                  {s.reason && <div className="muted-xs">Reason: {s.reason}</div>}
                </div>
                <Tag label={s.status} type={s.status === 'approved' ? 'green' : s.status === 'rejected' ? 'red' : 'amber'} />
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ical-btn" onClick={exportMine}>📆 Export My Shifts (.ics — Outlook, iPhone, Google)</button>
      </div>

      {swapModal && (
        <Modal title="Request Shift Swap" onClose={() => setSwapModal(false)}>
          <FormGroup label="My Shift Date">
            <input className="input" type="date" value={swapForm.myDate} onChange={e => setSwapForm({ ...swapForm, myDate: e.target.value })} />
          </FormGroup>
          <FormGroup label="Swap With">
            <select className="select" value={swapForm.targetId} onChange={e => setSwapForm({ ...swapForm, targetId: e.target.value })}>
              <option value="">Select engineer…</option>
              {users.filter(u => u.id !== currentUser).map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Their Shift Date">
            <input className="input" type="date" value={swapForm.theirDate} onChange={e => setSwapForm({ ...swapForm, theirDate: e.target.value })} />
          </FormGroup>
          <FormGroup label="Reason (optional)">
            <input className="input" placeholder="e.g. Medical appointment" value={swapForm.reason} onChange={e => setSwapForm({ ...swapForm, reason: e.target.value })} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setSwapModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={requestSwap}>Submit Swap Request</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Calendar ───────────────────────────────────────────────────────────────
function CalendarView({ users, rota, holidays, upgrades }) {
  const [cur, setCur] = useState(new Date());
  const yr = cur.getFullYear(), mo = cur.getMonth();
  const first    = new Date(yr, mo, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMo = new Date(yr, mo + 1, 0).getDate();
  const cells    = [...Array(startDow).fill(null), ...Array.from({ length: daysInMo }, (_, i) => i + 1)];
  const MONTHS   = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div>
      <PageHeader
        title="Calendar"
        sub="Rota, holidays, upgrades &amp; UK bank holidays"
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={() => setCur(new Date(yr, mo - 1, 1))}>← Prev</button>
          <div className="month-label">{MONTHS[mo]} {yr}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setCur(new Date())}>Today</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setCur(new Date(yr, mo + 1, 1))}>Next →</button>
        </>}
      />
      <ShiftLegend />
      <div className="cal-grid">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="cal-header">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={'e' + i} />;
          const ds  = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const bh  = UK_BANK_HOLIDAYS.find(b => b.date === ds);
          const hols = holidays.filter(h => ds >= h.start && ds <= h.end && h.status === 'approved');
          const upgs = upgrades.filter(u => u.date === ds);
          const oncalls = users.filter(u => rota[u.id]?.[ds] && rota[u.id][ds] !== 'off');
          const isToday = ds === new Date().toISOString().slice(0, 10);
          return (
            <div key={ds} className={`cal-day${isToday ? ' today' : ''}`}>
              <div className="cal-day-num" style={{ color: bh ? '#fca5a5' : undefined }}>{day}{bh && ' 🔴'}</div>
              {bh && <div className="cal-event ev-red">{bh.name}</div>}
              {upgs.map(u => <div key={u.id} className="cal-event ev-green">⬆ {u.name.split(' ').slice(0,2).join(' ')}</div>)}
              {hols.map(h => { const u = users.find(x => x.id === h.userId); return <div key={h.id} className="cal-event ev-amber">🌴 {u?.name?.split(' ')[0]}</div>; })}
              {oncalls.slice(0, 2).map(u => {
                const s = rota[u.id][ds];
                return <div key={u.id} className={`cal-event ${s === 'daily' ? 'ev-blue' : s === 'evening' ? 'ev-purple' : 'ev-pink'}`}>{u.name.split(' ')[0]}</div>;
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Rota Page ──────────────────────────────────────────────────────────────
function RotaPage({ users, rota, setRota, holidays, swapRequests, setSwapRequests, isManager }) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weeks, setWeeks]         = useState(4);
  const [generated, setGenerated] = useState(true);
  const [swapSuggestion, setSwapSuggestion] = useState(null);
  const DAYS = ['M','T','W','T','F','S','S'];

  const generate = () => { setRota(generateRota(users, startDate, weeks)); setGenerated(true); };

  // Check for holiday conflicts and suggest swaps
  const checkConflicts = () => {
    const conflicts = [];
    holidays.filter(h => h.status === 'approved').forEach(hol => {
      const d = new Date(hol.start);
      while (d <= new Date(hol.end)) {
        const ds = d.toISOString().slice(0,10);
        const shift = rota[hol.userId]?.[ds];
        if (shift && shift !== 'off') {
          const available = users.filter(u => u.id !== hol.userId && (!rota[u.id]?.[ds] || rota[u.id][ds] === 'off'));
          conflicts.push({ userId: hol.userId, date: ds, shift, available });
        }
        d.setDate(d.getDate() + 1);
      }
    });
    if (conflicts.length > 0) setSwapSuggestion(conflicts);
    else setSwapSuggestion([]);
  };

  const applySwap = (conflict, coverId) => {
    const newRota = JSON.parse(JSON.stringify(rota));
    newRota[coverId] = { ...(newRota[coverId] || {}), [conflict.date]: conflict.shift };
    if (newRota[conflict.userId]) delete newRota[conflict.userId][conflict.date];
    setRota(newRota);
    setSwapSuggestion(prev => prev.filter(c => !(c.userId === conflict.userId && c.date === conflict.date)));
  };

  const approveSwap = (swapId) => {
    const swap = (swapRequests || []).find(s => s.id === swapId);
    if (!swap) return;
    const newRota = JSON.parse(JSON.stringify(rota));
    const reqShift = newRota[swap.requesterId]?.[swap.reqDate];
    const tgtShift = newRota[swap.targetId]?.[swap.tgtDate];
    if (reqShift) { newRota[swap.targetId] = { ...(newRota[swap.targetId]||{}), [swap.reqDate]: reqShift }; delete newRota[swap.requesterId][swap.reqDate]; }
    if (tgtShift) { newRota[swap.requesterId] = { ...(newRota[swap.requesterId]||{}), [swap.tgtDate]: tgtShift }; delete newRota[swap.targetId][swap.tgtDate]; }
    setRota(newRota);
    setSwapRequests(swapRequests.map(s => s.id === swapId ? { ...s, status: 'approved' } : s));
  };

  const weekStarts = Array.from({ length: weeks }, (_, w) => {
    const d = new Date(startDate); d.setDate(d.getDate() + w * 7); return d;
  });

  const pendingSwaps = (swapRequests || []).filter(s => s.status === 'pending');

  return (
    <div>
      <PageHeader title="Rota Management" sub="Generate &amp; manage team on-call schedule" />

      {/* Conflict checker */}
      <div className="card mb-16">
        <div className="card-title">⚙ Generate &amp; Check</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <FormGroup label="Start Date">
            <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: 180 }} />
          </FormGroup>
          <FormGroup label="Weeks">
            <select className="select" value={weeks} onChange={e => setWeeks(+e.target.value)} style={{ width: 120 }}>
              {[2,4,6,8,12].map(w => <option key={w}>{w}</option>)}
            </select>
          </FormGroup>
          <button className="btn btn-primary" onClick={generate}>🔄 Generate Rota</button>
          <button className="btn btn-secondary" onClick={checkConflicts}>🔍 Check Holiday Conflicts</button>
          <button className="ical-btn" onClick={() => {
            users.forEach(u => {
              const ic = generateICalFeed(rota[u.id] || {}, u.name);
              downloadIcal(ic, `rota-${u.id}.ics`);
            });
          }}>📥 Export All (.ics)</button>
        </div>
      </div>

      {/* Conflict suggestions */}
      {swapSuggestion && swapSuggestion.length > 0 && (
        <div className="card mb-16" style={{ borderColor: '#f59e0b' }}>
          <div className="card-title" style={{ color: '#f59e0b' }}>⚠ Holiday Conflicts — Suggested Cover</div>
          {swapSuggestion.map((c, i) => {
            const eng = users.find(u => u.id === c.userId);
            return (
              <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="name-sm">{eng?.name} is on holiday on {c.date} but scheduled for {SHIFTS[c.shift]?.label}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {c.available.length === 0 && <span className="muted-xs">No available engineers for cover</span>}
                  {c.available.map(a => (
                    <button key={a.id} className="btn btn-success btn-sm" onClick={() => applySwap(c, a.id)}>
                      ✓ Assign {a.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {swapSuggestion && swapSuggestion.length === 0 && (
        <Alert type="info" style={{ marginBottom: 16 }}>✅ No holiday conflicts found in current rota.</Alert>
      )}

      {/* Pending swap requests (manager only) */}
      {isManager && pendingSwaps.length > 0 && (
        <div className="card mb-16">
          <div className="card-title">🔁 Pending Shift Swap Requests</div>
          {pendingSwaps.map(s => {
            const req = users.find(u => u.id === s.requesterId);
            const tgt = users.find(u => u.id === s.targetId);
            return (
              <div key={s.id} className="flex-between row-item">
                <div>
                  <div className="name-sm">{req?.name} wants to swap {s.reqDate} with {tgt?.name}'s {s.tgtDate}</div>
                  {s.reason && <div className="muted-xs">Reason: {s.reason}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-success btn-sm" onClick={() => approveSwap(s.id)}>✓ Approve</button>
                  <button className="btn btn-danger btn-sm" onClick={() => setSwapRequests(swapRequests.map(x => x.id === s.id ? { ...x, status: 'rejected' } : x))}>✗ Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {generated && (
        <>
          <ShiftLegend />
          {weekStarts.map((ws, wi) => {
            const wdates = Array.from({ length: 7 }, (_, d) => { const dt = new Date(ws); dt.setDate(ws.getDate() + d); return dt; });
            return (
              <div key={wi} className="card mb-12" style={{ overflowX: 'auto' }}>
                <div className="card-title" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Week of {ws.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                <table style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 130 }}>Engineer</th>
                      {wdates.map((d, di) => {
                        const ds = d.toISOString().slice(0, 10);
                        const bh = UK_BANK_HOLIDAYS.find(b => b.date === ds);
                        return <th key={di} style={{ textAlign: 'center', fontSize: 10, color: bh ? '#fca5a5' : undefined }}>{DAYS[di]}<br /><span style={{ fontFamily: 'DM Mono', fontSize: 9 }}>{d.getDate()}{bh && '🔴'}</span></th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Avatar user={u} size={24} /><span style={{ fontSize: 12 }}>{u.name.split(' ')[0]}</span></div></td>
                        {wdates.map(d => {
                          const ds  = d.toISOString().slice(0, 10);
                          const hol = holidays.find(h => h.userId === u.id && ds >= h.start && ds <= h.end && h.status === 'approved');
                          const bh  = UK_BANK_HOLIDAYS.find(b => b.date === ds);
                          const s   = hol ? 'holiday' : bh ? 'bankholiday' : (rota[u.id]?.[ds] || 'off');
                          return (
                            <td key={ds} style={{ textAlign: 'center', padding: '6px 4px' }}>
                              <div className={`rota-cell ${hol ? 'rota-holiday' : bh ? 'rota-bh' : SHIFTS[s]?.color || 'shift-off'}`} style={{ fontSize: 10, padding: '4px 6px' }}>
                                {hol ? '🌴' : bh ? '🔴' : s === 'off' ? '—' : SHIFTS[s]?.label?.slice(0, 3) || s}
                              </div>
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
        </>
      )}
    </div>
  );
}

// ── Incidents ──────────────────────────────────────────────────────────────
function Incidents({ users, incidents, setIncidents, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [viewInc, setViewInc]   = useState(null);
  const [form, setForm] = useState({ title: '', severity: 'P2', desc: '', assignee: '' });
  const [filter, setFilter] = useState('all');
  const SEV_COLOR = { P1: '#ef4444', P2: '#f59e0b', P3: '#3b82f6', P4: '#10b981' };

  const add = () => {
    if (!form.title) return;
    const id = 'INC-' + String(incidents.length + 1).padStart(3, '0');
    setIncidents([{ id, ...form, status: 'Investigating', reporter: currentUser, date: new Date().toISOString().slice(0, 16).replace('T', ' '), updates: [] }, ...incidents]);
    setShowModal(false); setForm({ title: '', severity: 'P2', desc: '', assignee: '' });
  };

  const resolve = (id) => setIncidents(incidents.map(i => i.id === id ? { ...i, status: 'Resolved', resolvedAt: new Date().toISOString().slice(0,16).replace('T',' ') } : i));

  const filtered = filter === 'all' ? incidents : incidents.filter(i => i.status === filter || i.severity === filter);

  return (
    <div>
      <PageHeader title="Incidents" sub="Log and track operational incidents"
        actions={<>
          <select className="select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 140 }}>
            <option value="all">All</option>
            <option value="Investigating">Investigating</option>
            <option value="Resolved">Resolved</option>
            <option value="P1">P1 Only</option>
            <option value="P2">P2 Only</option>
          </select>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Log Incident</button>
        </>} />
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>Title</th><th>Severity</th><th>Status</th><th>Assignee</th><th>Reporter</th><th>Date/Time</th><th>Actions</th></tr></thead>
          <tbody>
            {[...filtered].sort((a, b) => new Date(b.date) - new Date(a.date)).map(i => {
              const u   = users.find(x => x.id === i.reporter);
              const asg = users.find(x => x.id === i.assignee);
              return (
                <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setViewInc(i)}>
                  <td><span style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{i.id}</span></td>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>{i.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{(i.desc||'').slice(0,60)}{i.desc?.length > 60 ? '…' : ''}</div>
                  </td>
                  <td><span style={{ background: SEV_COLOR[i.severity] + '25', color: SEV_COLOR[i.severity], padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{i.severity}</span></td>
                  <td><Tag label={i.status} type={i.status === 'Resolved' ? 'green' : i.status === 'Investigating' ? 'red' : 'blue'} /></td>
                  <td style={{ fontSize: 12 }}>{asg?.name || '—'}</td>
                  <td style={{ fontSize: 12 }}>{u?.name || i.reporter}</td>
                  <td style={{ fontSize: 12, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{i.date}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {i.status !== 'Resolved' && (
                      <button className="btn btn-success btn-sm" onClick={() => resolve(i.id)}>Resolve</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title="Log New Incident" onClose={() => setShowModal(false)}>
          <FormGroup label="Title"><input className="input" placeholder="Brief incident description" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></FormGroup>
          <FormGroup label="Severity">
            <select className="select" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
              <option>P1</option><option>P2</option><option>P3</option><option>P4</option>
            </select>
          </FormGroup>
          <FormGroup label="Assign To">
            <select className="select" value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Description">
            <RichEditor value={form.desc} onChange={v => setForm({ ...form, desc: v })} placeholder="What happened? What actions were taken?" rows={6} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Log Incident</button>
          </div>
        </Modal>
      )}

      {viewInc && (
        <Modal title={`${viewInc.id} — ${viewInc.title}`} onClose={() => setViewInc(null)} wide>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Tag label={viewInc.severity} type="red" />
            <Tag label={viewInc.status} type={viewInc.status === 'Resolved' ? 'green' : 'red'} />
            <span className="muted-xs">{viewInc.date}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 16 }} dangerouslySetInnerHTML={{ __html: viewInc.desc || viewInc.description || '' }} />
          {viewInc.resolvedAt && <div className="muted-xs">Resolved: {viewInc.resolvedAt}</div>}
        </Modal>
      )}
    </div>
  );
}

// ── Timesheets ─────────────────────────────────────────────────────────────
function Timesheets({ users, timesheets, setTimesheets, currentUser, isManager, payconfig }) {
  const [activeUser, setActiveUser] = useState(currentUser);
  const [showPayroll, setShowPayroll] = useState(false);
  const [addModal, setAddModal]     = useState(false);
  const [form, setForm]             = useState({ week: '', hours: '', oncall: '', notes: '' });

  const user   = users.find(u => u.id === activeUser);
  const sheets = timesheets[activeUser] || [];
  const totalHrs = sheets.reduce((a, b) => a + b.hours, 0);
  const totalOC  = sheets.reduce((a, b) => a + b.oncall, 0);
  const rate  = payconfig[activeUser]?.rate || 40;
  const base  = payconfig[activeUser]?.base || 2500;
  const gross = totalHrs * rate + totalOC * rate * 0.5;
  const visibleUsers = isManager ? users : [users.find(u => u.id === currentUser)].filter(Boolean);

  const addEntry = () => {
    if (!form.week) return;
    const updated = { ...timesheets, [activeUser]: [{ week: form.week, hours: +form.hours, oncall: +form.oncall, notes: form.notes }, ...(timesheets[activeUser] || [])] };
    setTimesheets(updated);
    setAddModal(false); setForm({ week: '', hours: '', oncall: '', notes: '' });
  };

  return (
    <div>
      <PageHeader title="Timesheets" sub="Hours &amp; payroll tracking"
        actions={<>
          <button className="btn btn-secondary" onClick={() => setAddModal(true)}>+ Add Entry</button>
          {isManager && <button className="btn btn-primary" onClick={() => setShowPayroll(true)}>📄 Payroll Report</button>}
        </>} />
      <div className="tab-bar">
        {visibleUsers.map(u => (
          <div key={u.id} className={`tab${activeUser === u.id ? ' active' : ''}`} onClick={() => setActiveUser(u.id)}>
            {u.name.split(' ')[0]}
          </div>
        ))}
      </div>
      <div className="grid-3 mb-16">
        <StatCard label="Total Hours"  value={totalHrs + 'h'} sub="This period"        accent="#3b82f6" />
        <StatCard label="On-Call Hrs"  value={totalOC + 'h'}  sub="+50% rate"           accent="#6366f1" />
        <StatCard label="Est. Gross"   value={'£' + Math.round(gross).toLocaleString()} sub="Before tax" accent="#10b981" />
      </div>
      <div className="card">
        <div className="flex-between mb-12">
          <div className="card-title">Weekly Timesheets — {user?.name}</div>
        </div>
        <table>
          <thead><tr><th>Week</th><th>Regular Hours</th><th>On-Call Hours</th><th>Regular Pay</th><th>OC Pay</th><th>Notes</th></tr></thead>
          <tbody>
            {sheets.map((s, i) => {
              const regPay = s.hours * rate;
              const ocPay  = s.oncall * rate * 0.5;
              return (
                <tr key={i}>
                  <td style={{ fontFamily: 'DM Mono', color: 'var(--accent)' }}>{s.week}</td>
                  <td>{s.hours}h</td>
                  <td>{s.oncall}h</td>
                  <td style={{ fontFamily: 'DM Mono', color: '#6ee7b7' }}>£{regPay.toLocaleString()}</td>
                  <td style={{ fontFamily: 'DM Mono', color: '#c4b5fd' }}>£{ocPay}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{s.notes || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {addModal && (
        <Modal title="Add Timesheet Entry" onClose={() => setAddModal(false)}>
          <FormGroup label="Week (e.g. W14 2026)"><input className="input" placeholder="W14 2026" value={form.week} onChange={e => setForm({ ...form, week: e.target.value })} /></FormGroup>
          <FormGroup label="Regular Hours"><input className="input" type="number" min="0" max="80" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} /></FormGroup>
          <FormGroup label="On-Call Hours"><input className="input" type="number" min="0" max="80" value={form.oncall} onChange={e => setForm({ ...form, oncall: e.target.value })} /></FormGroup>
          <FormGroup label="Notes"><input className="input" placeholder="Optional notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setAddModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={addEntry}>Add Entry</button>
          </div>
        </Modal>
      )}

      {showPayroll && (
        <Modal title={`Payroll Report — ${user?.name}`} onClose={() => setShowPayroll(false)}>
          <div style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div className="muted-xs" style={{ marginBottom: 12 }}>Base: £{base?.toLocaleString()}/mo · Rate: £{rate}/hr · OC Rate: £{(rate*0.5)}/hr</div>
            <div className="payroll-row"><span>Base Monthly Salary</span><span>£{base?.toLocaleString()}</span></div>
            <div className="payroll-row"><span>Regular ({totalHrs}h × £{rate})</span><span>£{(totalHrs * rate).toLocaleString()}</span></div>
            <div className="payroll-row"><span>On-Call ({totalOC}h × £{rate * 0.5} uplift)</span><span>£{(totalOC * rate * 0.5).toLocaleString()}</span></div>
            <div className="payroll-row total"><span>Gross Pay</span><span>£{Math.round(gross).toLocaleString()}</span></div>
          </div>
          <button className="btn btn-primary" onClick={() => window.print()}>📄 Print / PDF</button>
        </Modal>
      )}
    </div>
  );
}

// ── Holidays ───────────────────────────────────────────────────────────────
function Holidays({ users, holidays, setHolidays, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ start: '', end: '', type: 'Annual Leave', note: '' });
  const [filter, setFilter] = useState('all');

  const leaveTypes = ['Annual Leave', 'Sick Leave', 'Compassionate Leave', 'Study Leave', 'Unpaid Leave', 'Other'];

  const remainingDays = (userId) => {
    const allowance = 25;
    const used = holidays.filter(h => h.userId === userId && h.status === 'approved' && h.type === 'Annual Leave')
      .reduce((acc, h) => acc + Math.ceil((new Date(h.end) - new Date(h.start)) / 86400000) + 1, 0);
    return allowance - used;
  };

  const add = () => {
    if (!form.start || !form.end) return;
    setHolidays([...holidays, { id: 'h' + Date.now(), userId: currentUser, ...form, status: isManager ? 'approved' : 'pending' }]);
    setShowModal(false); setForm({ start: '', end: '', type: 'Annual Leave', note: '' });
  };
  const approve = id => setHolidays(holidays.map(h => h.id === id ? { ...h, status: 'approved' } : h));
  const reject  = id => setHolidays(holidays.map(h => h.id === id ? { ...h, status: 'rejected' } : h));
  const remove  = id => setHolidays(holidays.filter(h => h.id !== id));

  const visible = isManager
    ? (filter === 'all' ? holidays : holidays.filter(h => h.status === filter))
    : holidays.filter(h => h.userId === currentUser);

  const myUser = users.find(u => u.id === currentUser);
  const myRemaining = remainingDays(currentUser);

  return (
    <div>
      <PageHeader title="Holiday Tracker" sub="Manage leave requests and approvals"
        actions={<>
          {isManager && (
            <select className="select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 140 }}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          )}
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Request Holiday</button>
        </>} />

      <div className="grid-4 mb-16">
        <StatCard label="My Remaining" value={myRemaining + ' days'} sub="Annual leave left" accent="#10b981" />
        <StatCard label="Pending"   value={holidays.filter(h=>h.status==='pending').length}  sub="Awaiting approval" accent="#f59e0b" />
        <StatCard label="Approved"  value={holidays.filter(h=>h.status==='approved').length} sub="Confirmed"         accent="#3b82f6" />
        <StatCard label="Rejected"  value={holidays.filter(h=>h.status==='rejected').length} sub="Declined"          accent="#ef4444" />
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Engineer</th><th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Notes</th><th>Status</th>{isManager && <th>Actions</th>}</tr></thead>
          <tbody>
            {visible.map(h => {
              const u = users.find(x => x.id === h.userId);
              const d = Math.ceil((new Date(h.end) - new Date(h.start)) / 86400000) + 1;
              return (
                <tr key={h.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar user={u || { avatar: '?', color: '#475569' }} size={24} /><span style={{ fontSize: 12 }}>{u?.name}</span></div></td>
                  <td style={{ fontSize: 12 }}>{h.type || 'Annual Leave'}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{h.start}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{h.end}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{d}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.note || '—'}</td>
                  <td><Tag label={h.status} type={h.status === 'approved' ? 'green' : h.status === 'pending' ? 'amber' : 'red'} /></td>
                  {isManager && (
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {h.status === 'pending' && <>
                          <button className="btn btn-success btn-sm" onClick={() => approve(h.id)}>✓</button>
                          <button className="btn btn-danger btn-sm"  onClick={() => reject(h.id)}>✗</button>
                        </>}
                        <button className="btn btn-secondary btn-sm" onClick={() => remove(h.id)}>🗑</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title="Request Holiday" onClose={() => setShowModal(false)}>
          <FormGroup label="Leave Type">
            <select className="select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {leaveTypes.map(t => <option key={t}>{t}</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Start Date"><input className="input" type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></FormGroup>
          <FormGroup label="End Date"><input className="input" type="date" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></FormGroup>
          <FormGroup label="Notes (optional)"><input className="input" placeholder="Travel, family, etc." value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></FormGroup>
          {myRemaining <= 5 && form.type === 'Annual Leave' && <Alert type="warning">⚠ You have only {myRemaining} annual leave days remaining.</Alert>}
          {isManager && <Alert>As manager, your holiday is auto-approved.</Alert>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>{isManager ? 'Add Holiday' : 'Submit Request'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Shift Swaps ────────────────────────────────────────────────────────────
function ShiftSwaps({ users, swapRequests, setSwapRequests, rota, setRota, currentUser, isManager }) {
  const all = swapRequests || [];

  const approve = (swapId) => {
    const swap = all.find(s => s.id === swapId);
    if (!swap) return;
    const newRota = JSON.parse(JSON.stringify(rota));
    const reqShift = newRota[swap.requesterId]?.[swap.reqDate];
    const tgtShift = newRota[swap.targetId]?.[swap.tgtDate];
    if (reqShift) { newRota[swap.targetId] = { ...(newRota[swap.targetId]||{}), [swap.reqDate]: reqShift }; delete newRota[swap.requesterId][swap.reqDate]; }
    if (tgtShift) { newRota[swap.requesterId] = { ...(newRota[swap.requesterId]||{}), [swap.tgtDate]: tgtShift }; delete newRota[swap.targetId][swap.tgtDate]; }
    setRota(newRota);
    setSwapRequests(all.map(s => s.id === swapId ? { ...s, status: 'approved' } : s));
  };

  return (
    <div>
      <PageHeader title="Shift Swaps" sub="View and manage all shift swap requests" />
      <div className="grid-3 mb-16">
        <StatCard label="Pending"  value={all.filter(s=>s.status==='pending').length}  sub="Awaiting decision" accent="#f59e0b" />
        <StatCard label="Approved" value={all.filter(s=>s.status==='approved').length} sub="Completed swaps"   accent="#10b981" />
        <StatCard label="Rejected" value={all.filter(s=>s.status==='rejected').length} sub="Declined"          accent="#ef4444" />
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Requester</th><th>Their Date</th><th>Target</th><th>Their Date</th><th>Reason</th><th>Status</th><th>Created</th>{isManager && <th>Actions</th>}</tr></thead>
          <tbody>
            {all.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No swap requests yet</td></tr>}
            {[...all].sort((a,b) => new Date(b.created) - new Date(a.created)).map(s => {
              const req = users.find(u => u.id === s.requesterId);
              const tgt = users.find(u => u.id === s.targetId);
              return (
                <tr key={s.id}>
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={req} size={22} /><span style={{ fontSize: 12 }}>{req?.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{s.reqDate}</td>
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={tgt} size={22} /><span style={{ fontSize: 12 }}>{tgt?.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{s.tgtDate}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.reason || '—'}</td>
                  <td><Tag label={s.status} type={s.status==='approved'?'green':s.status==='pending'?'amber':'red'} /></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text-muted)' }}>{s.created}</td>
                  {isManager && (
                    <td>
                      {s.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-success btn-sm" onClick={() => approve(s.id)}>✓ Approve</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setSwapRequests(all.map(x => x.id===s.id?{...x,status:'rejected'}:x))}>✗ Reject</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Upgrade Days ───────────────────────────────────────────────────────────
function UpgradeDays({ users, upgrades, setUpgrades, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: '', name: '', desc: '' });

  const add = () => {
    if (!form.date || !form.name) return;
    setUpgrades([...upgrades, { id: 'u' + Date.now(), ...form, attendees: [] }]);
    setShowModal(false); setForm({ date: '', name: '', desc: '' });
  };
  const toggleAttend = (id, uid) => setUpgrades(upgrades.map(u =>
    u.id !== id ? u : { ...u, attendees: u.attendees.includes(uid) ? u.attendees.filter(x => x !== uid) : [...u.attendees, uid] }
  ));

  return (
    <div>
      <PageHeader title="Upgrade Days" sub="Global system upgrade events &amp; attendee management"
        actions={isManager && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Upgrade Day</button>} />
      {upgrades.length === 0 && <Alert>No upgrade days scheduled. {isManager ? 'Add one above.' : 'Check back later.'}</Alert>}
      {upgrades.map(up => (
        <div key={up.id} className="card mb-16">
          <div className="flex-between mb-12">
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{up.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono', marginTop: 2 }}>{up.date}</div>
              {up.desc && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{up.desc}</div>}
            </div>
            <Tag label="⬆ Upgrade" type="green" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>Click to toggle attendance:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {users.map(u => {
              const attending = up.attendees.includes(u.id);
              return (
                <div key={u.id} onClick={() => toggleAttend(up.id, u.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
                  border: `1px solid ${attending ? 'var(--accent3)' : 'var(--border)'}`,
                  background: attending ? 'rgba(16,185,129,.1)' : 'var(--bg-card2)', cursor: 'pointer'
                }}>
                  <Avatar user={u} size={24} />
                  <span style={{ fontSize: 12, color: attending ? '#6ee7b7' : 'var(--text-secondary)' }}>{u.name.split(' ')[0]}</span>
                  {attending && <span style={{ color: '#6ee7b7', fontSize: 12 }}>✓</span>}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>{up.attendees.length} of {users.length} attending</div>
        </div>
      ))}
      {showModal && (
        <Modal title="Add Upgrade Day" onClose={() => setShowModal(false)}>
          <FormGroup label="Date"><input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormGroup>
          <FormGroup label="Upgrade Name"><input className="input" placeholder="e.g. Global Q3 System Upgrade" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormGroup>
          <FormGroup label="Description"><textarea className="textarea" rows={3} placeholder="Details about this upgrade" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Add</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Stress Score ───────────────────────────────────────────────────────────
function StressScore({ users, timesheets, incidents }) {
  const scores = users.map(u => {
    const sheets = timesheets[u.id] || [];
    const hrs    = sheets.reduce((a, b) => a + b.hours, 0);
    const oc     = sheets.reduce((a, b) => a + b.oncall, 0);
    const inc    = incidents.filter(i => i.reporter === u.id).length;
    const score  = Math.min(100, Math.round((hrs / 80 * 35) + (oc / 20 * 35) + (inc * 5) + (oc > 8 ? 15 : 0)));
    return { user: u, hrs, oc, inc, score, level: score > 75 ? 'High' : score > 50 ? 'Medium' : 'Low' };
  }).sort((a,b) => b.score - a.score);
  const COLOR = { High: '#ef4444', Medium: '#f59e0b', Low: '#10b981' };

  return (
    <div>
      <PageHeader title="Stress Score" sub="Identify engineers who may need support or shift redistribution" />
      <Alert>📊 Scores factor in: hours worked, on-call shifts, incident load. Updated in real time from timesheets.</Alert>
      {scores.map(s => (
        <div key={s.user.id} className="card mb-12">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Avatar user={s.user} size={36} />
            <div style={{ flex: 1 }}>
              <div className="flex-between" style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{s.user.name}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{s.hrs}h reg · {s.oc}h OC · {s.inc} inc</span>
                  <Tag label={s.level} type={s.level === 'High' ? 'red' : s.level === 'Medium' ? 'amber' : 'green'} />
                </div>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: s.score + '%', background: COLOR[s.level] }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>Stress Score</span><span style={{ fontFamily: 'DM Mono' }}>{s.score}/100</span>
              </div>
            </div>
          </div>
          {s.level === 'High' && <Alert type="warning">⚠ Consider reducing on-call load or redistributing shifts for {s.user.name.split(' ')[0]}.</Alert>}
        </div>
      ))}
    </div>
  );
}

// ── TOIL ───────────────────────────────────────────────────────────────────
function TOIL({ users, toil, setToil, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState({ userId: currentUser, hours: '', reason: '', date: '', type: 'Accrued' });
  const visible = isManager ? toil : toil.filter(t => t.userId === currentUser);

  const add = () => {
    if (!form.hours || !form.date) return;
    setToil([...toil, { id: 't' + Date.now(), ...form, hours: +form.hours }]);
    setShowModal(false); setForm({ userId: currentUser, hours: '', reason: '', date: '', type: 'Accrued' });
  };

  const byUser = (uid) => {
    const acc = toil.filter(t => t.userId === uid && t.type === 'Accrued').reduce((a,b) => a + b.hours, 0);
    const used = toil.filter(t => t.userId === uid && t.type === 'Used').reduce((a,b) => a + b.hours, 0);
    return { accrued: acc, used, balance: acc - used };
  };

  return (
    <div>
      <PageHeader title="Time Off In Lieu (TOIL)" sub="Track and manage TOIL accrual and usage"
        actions={<button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add TOIL Entry</button>} />
      <div className="grid-2 mb-16">
        {users.map(u => {
          const b = byUser(u.id);
          return (
            <div key={u.id} className="card">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <Avatar user={u} size={32} />
                <div className="name-sm">{u.name}</div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Accrued</div><div style={{ fontSize: 18, fontWeight: 600, color: '#6ee7b7' }}>{b.accrued}h</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Used</div><div style={{ fontSize: 18, fontWeight: 600, color: '#fcd34d' }}>{b.used}h</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Balance</div><div style={{ fontSize: 18, fontWeight: 600, color: b.balance >= 0 ? '#6ee7b7' : '#fca5a5' }}>{b.balance}h</div></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Engineer</th><th>Date</th><th>Type</th><th>Hours</th><th>Reason</th></tr></thead>
          <tbody>
            {visible.map(t => {
              const u = users.find(x => x.id === t.userId);
              return (
                <tr key={t.id}>
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={u} size={22} /><span style={{ fontSize: 12 }}>{u?.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{t.date}</td>
                  <td><Tag label={t.type} type={t.type === 'Accrued' ? 'green' : 'amber'} /></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{t.hours}h</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.reason || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showModal && (
        <Modal title="Add TOIL Entry" onClose={() => setShowModal(false)}>
          {isManager && <FormGroup label="Engineer">
            <select className="select" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </FormGroup>}
          <FormGroup label="Date"><input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormGroup>
          <FormGroup label="Type">
            <select className="select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option>Accrued</option><option>Used</option>
            </select>
          </FormGroup>
          <FormGroup label="Hours"><input className="input" type="number" min="0.5" step="0.5" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} /></FormGroup>
          <FormGroup label="Reason"><input className="input" placeholder="e.g. Worked bank holiday" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Add Entry</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Absence / Sickness ─────────────────────────────────────────────────────
function Absence({ users, absences, setAbsences, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ userId: currentUser, start: '', end: '', type: 'Sick', notes: '' });
  const visible = isManager ? absences : absences.filter(a => a.userId === currentUser);

  const add = () => {
    if (!form.start) return;
    setAbsences([...absences, { id: 'abs-' + Date.now(), ...form }]);
    setShowModal(false); setForm({ userId: currentUser, start: '', end: '', type: 'Sick', notes: '' });
  };

  return (
    <div>
      <PageHeader title="Absence &amp; Sickness" sub="Track all absences, sickness and lateness"
        actions={<button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Log Absence</button>} />
      <div className="grid-3 mb-16">
        <StatCard label="Total Records" value={absences.length} sub="All engineers" accent="#ef4444" />
        <StatCard label="Sick Days" value={absences.filter(a=>a.type==='Sick').length} sub="Sickness records" accent="#f59e0b" />
        <StatCard label="Unauthorised" value={absences.filter(a=>a.type==='Unauthorised').length} sub="Flagged absences" accent="#ef4444" />
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Engineer</th><th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Notes</th></tr></thead>
          <tbody>
            {visible.map(a => {
              const u = users.find(x => x.id === a.userId);
              const d = a.end ? Math.ceil((new Date(a.end) - new Date(a.start)) / 86400000) + 1 : 1;
              return (
                <tr key={a.id}>
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={u} size={22} /><span style={{ fontSize: 12 }}>{u?.name}</span></div></td>
                  <td><Tag label={a.type} type={a.type==='Sick'?'red':a.type==='Unauthorised'?'red':'amber'} /></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{a.start}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{a.end || '—'}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{d}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.notes || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showModal && (
        <Modal title="Log Absence" onClose={() => setShowModal(false)}>
          {isManager && <FormGroup label="Engineer">
            <select className="select" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </FormGroup>}
          <FormGroup label="Type">
            <select className="select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option>Sick</option><option>Lateness</option><option>Unauthorised</option><option>Other</option>
            </select>
          </FormGroup>
          <FormGroup label="Start Date"><input className="input" type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></FormGroup>
          <FormGroup label="End Date (optional)"><input className="input" type="date" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></FormGroup>
          <FormGroup label="Notes"><textarea className="textarea" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Log Absence</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Logbook ────────────────────────────────────────────────────────────────
function Logbook({ users, logbook, setLogbook, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ userId: '', type: 'Appraisal', date: '', summary: '', content: '' });
  const [filter, setFilter] = useState('all');
  const visible = isManager ? (filter === 'all' ? logbook : logbook.filter(l => l.userId === filter)) : logbook.filter(l => l.userId === currentUser);

  const add = () => {
    if (!form.userId || !form.date) return;
    setLogbook([...logbook, { id: 'log-' + Date.now(), ...form, createdBy: currentUser, created: new Date().toISOString().slice(0,10) }]);
    setShowModal(false); setForm({ userId: '', type: 'Appraisal', date: '', summary: '', content: '' });
  };

  return (
    <div>
      <PageHeader title="Logbook" sub="Record appraisals, training, achievements &amp; notes"
        actions={isManager && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Entry</button>} />
      {isManager && (
        <div style={{ marginBottom: 16 }}>
          <select className="select" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All Engineers</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}
      {visible.map(l => {
        const u = users.find(x => x.id === l.userId);
        const typeColor = { Appraisal: 'blue', Training: 'green', Achievement: 'amber', Note: 'purple' };
        return (
          <div key={l.id} className="card mb-12">
            <div className="flex-between mb-8">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Avatar user={u} size={28} />
                <div>
                  <div className="name-sm">{u?.name}</div>
                  <div className="muted-xs">{l.date}</div>
                </div>
              </div>
              <Tag label={l.type} type={typeColor[l.type] || 'blue'} />
            </div>
            {l.summary && <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>{l.summary}</div>}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: l.content }} />
          </div>
        );
      })}
      {visible.length === 0 && <Alert>No logbook entries yet.</Alert>}
      {showModal && (
        <Modal title="Add Logbook Entry" onClose={() => setShowModal(false)} wide>
          <FormGroup label="Engineer">
            <select className="select" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
              <option value="">Select engineer…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Type">
            <select className="select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option>Appraisal</option><option>Training</option><option>Achievement</option><option>Note</option>
            </select>
          </FormGroup>
          <FormGroup label="Date"><input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormGroup>
          <FormGroup label="Summary"><input className="input" placeholder="Brief summary" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></FormGroup>
          <FormGroup label="Full Notes">
            <RichEditor value={form.content} onChange={v => setForm({ ...form, content: v })} placeholder="Detailed notes, observations, feedback…" rows={8} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Save Entry</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Wiki ───────────────────────────────────────────────────────────────────
function Wiki({ wiki, setWiki }) {
  const [sel, setSel]         = useState(null);
  const [editing, setEditing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch]   = useState('');
  const [form, setForm]       = useState({ title: '', cat: 'Operations', content: '' });

  const add = () => {
    if (!form.title) return;
    if (editing && sel) {
      setWiki(wiki.map(w => w.id === sel ? { ...w, ...form } : w));
      setEditing(false); setSel(null);
    } else {
      setWiki([...wiki, { id: 'w' + Date.now(), ...form }]);
    }
    setShowNew(false); setForm({ title: '', cat: 'Operations', content: '' });
  };

  const filtered = wiki.filter(w => w.title.toLowerCase().includes(search.toLowerCase()) || w.content.toLowerCase().includes(search.toLowerCase()));

  if (sel && !editing) {
    const w = wiki.find(x => x.id === sel);
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setSel(null)}>← Back</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setForm({ title: w.title, cat: w.cat, content: w.content }); setEditing(true); setShowNew(true); }}>✏ Edit</button>
          <button className="btn btn-danger btn-sm" onClick={() => { setWiki(wiki.filter(x => x.id !== sel)); setSel(null); }}>🗑 Delete</button>
        </div>
        <div className="card">
          <div className="flex-between mb-12"><div className="page-title">{w.title}</div><Tag label={w.cat} type="blue" /></div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: w.content }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Wiki" sub="Team knowledge base"
        actions={<button className="btn btn-primary" onClick={() => { setEditing(false); setShowNew(true); }}>+ New Article</button>} />
      <input className="input" placeholder="🔍 Search wiki…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, width: '100%' }} />
      {filtered.map(w => (
        <div key={w.id} className="wiki-entry" onClick={() => setSel(w.id)}>
          <div className="flex-between"><div className="wiki-title">{w.title}</div><Tag label={w.cat} type="blue" /></div>
          <div className="muted-xs" style={{ marginTop: 4 }}>{w.content.replace(/<[^>]+>/g, '').slice(0, 120)}…</div>
        </div>
      ))}
      {showNew && (
        <Modal title={editing ? 'Edit Article' : 'New Wiki Article'} onClose={() => { setShowNew(false); setEditing(false); }} wide>
          <FormGroup label="Title"><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></FormGroup>
          <FormGroup label="Category">
            <select className="select" value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })}>
              <option>Operations</option><option>Engineering</option><option>Process</option><option>Security</option><option>Runbooks</option>
            </select>
          </FormGroup>
          <FormGroup label="Content">
            <RichEditor value={form.content} onChange={v => setForm({ ...form, content: v })} rows={10} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => { setShowNew(false); setEditing(false); }}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>{editing ? 'Update' : 'Save Article'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Glossary ───────────────────────────────────────────────────────────────
function Glossary({ glossary, setGlossary }) {
  const [form, setForm] = useState({ term: '', def: '' });
  const [search, setSearch] = useState('');
  const add = () => { if (!form.term) return; setGlossary([...glossary, { id: 'g' + Date.now(), ...form }]); setForm({ term: '', def: '' }); };
  const filtered = glossary.filter(g => g.term.toLowerCase().includes(search.toLowerCase()) || g.def.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <PageHeader title="Glossary" sub="Team terminology reference" />
      <div className="card mb-16">
        <div className="card-title">Add Term</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Term" value={form.term} onChange={e => setForm({ ...form, term: e.target.value })} style={{ width: 160 }} />
          <input className="input" placeholder="Definition" value={form.def} onChange={e => setForm({ ...form, def: e.target.value })} />
          <button className="btn btn-primary" onClick={add}>Add</button>
        </div>
      </div>
      <input className="input" placeholder="🔍 Search terms…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, width: '100%' }} />
      <div className="card">
        <table>
          <thead><tr><th>Term</th><th>Definition</th><th></th></tr></thead>
          <tbody>{filtered.sort((a,b) => a.term.localeCompare(b.term)).map(g => (
            <tr key={g.id}>
              <td style={{ fontWeight: 600, color: 'var(--accent)', fontFamily: 'DM Mono', fontSize: 12 }}>{g.term}</td>
              <td style={{ fontSize: 13 }}>{g.def}</td>
              <td><button className="btn btn-danger btn-sm" onClick={() => setGlossary(glossary.filter(x => x.id !== g.id))}>🗑</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── Contacts ───────────────────────────────────────────────────────────────
function Contacts({ contacts, setContacts }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', role: '', email: '', phone: '', team: '' });
  const [search, setSearch] = useState('');
  const add = () => { if (!form.name) return; setContacts([...contacts, { id: 'c' + Date.now(), ...form }]); setShowModal(false); setForm({ name: '', role: '', email: '', phone: '', team: '' }); };
  const filtered = contacts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.role.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <PageHeader title="Contacts" sub="Team &amp; external contacts"
        actions={<button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Contact</button>} />
      <input className="input" placeholder="🔍 Search contacts…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, width: '100%' }} />
      <div className="grid-2">
        {filtered.map(c => (
          <div key={c.id} className="card card-sm">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13 }}>
                {c.name.split(' ').map(x => x[0]).join('').slice(0, 2)}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.role}{c.team ? ` · ${c.team}` : ''}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <div>📧 <a href={`mailto:${c.email}`} style={{ color: 'var(--accent)' }}>{c.email}</a></div>
              <div style={{ marginTop: 4 }}>📞 {c.phone}</div>
            </div>
          </div>
        ))}
      </div>
      {showModal && (
        <Modal title="Add Contact" onClose={() => setShowModal(false)}>
          <FormGroup label="Name"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormGroup>
          <FormGroup label="Role"><input className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} /></FormGroup>
          <FormGroup label="Team / Department"><input className="input" value={form.team} onChange={e => setForm({ ...form, team: e.target.value })} /></FormGroup>
          <FormGroup label="Email"><input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></FormGroup>
          <FormGroup label="Phone"><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Add Contact</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────
function Documents({ documents, setDocuments, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState({ title: '', category: 'General', content: '', tags: '' });
  const [search, setSearch]       = useState('');
  const [view, setView]           = useState(null);

  const add = () => {
    if (!form.title) return;
    setDocuments([...documents, { id: 'doc-' + Date.now(), ...form, created: new Date().toISOString().slice(0,10) }]);
    setShowModal(false); setForm({ title: '', category: 'General', content: '', tags: '' });
  };

  const filtered = documents.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    (d.tags||'').toLowerCase().includes(search.toLowerCase())
  );

  if (view) {
    const d = documents.find(x => x.id === view);
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setView(null)}>← Back</button>
          {isManager && <button className="btn btn-danger btn-sm" onClick={() => { setDocuments(documents.filter(x => x.id !== view)); setView(null); }}>🗑 Delete</button>}
        </div>
        <div className="card">
          <div className="flex-between mb-12">
            <div className="page-title">{d.title}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Tag label={d.category} type="blue" />
              <span className="muted-xs">{d.created}</span>
            </div>
          </div>
          {d.tags && <div style={{ marginBottom: 12 }}>{d.tags.split(',').map(t => <Tag key={t} label={t.trim()} type="purple" />)}</div>}
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: d.content }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Documents" sub="Secure document storage"
        actions={<button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Document</button>} />
      <input className="input" placeholder="🔍 Search documents…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, width: '100%' }} />
      <div className="grid-2">
        {filtered.map(d => (
          <div key={d.id} className="card card-sm" style={{ cursor: 'pointer' }} onClick={() => setView(d.id)}>
            <div className="flex-between mb-8">
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>📄 {d.title}</div>
              <Tag label={d.category} type="blue" />
            </div>
            <div className="muted-xs">{d.content.replace(/<[^>]+>/g, '').slice(0, 100)}…</div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>{d.created}</div>
          </div>
        ))}
      </div>
      {showModal && (
        <Modal title="New Document" onClose={() => setShowModal(false)} wide>
          <FormGroup label="Title"><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></FormGroup>
          <FormGroup label="Category">
            <select className="select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              <option>General</option><option>Policy</option><option>Runbook</option><option>SLA</option><option>Contract</option><option>Training</option>
            </select>
          </FormGroup>
          <FormGroup label="Tags" hint="comma separated">
            <input className="input" placeholder="e.g. security, onboarding, aws" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
          </FormGroup>
          <FormGroup label="Content">
            <RichEditor value={form.content} onChange={v => setForm({ ...form, content: v })} rows={10} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Save Document</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Insights ───────────────────────────────────────────────────────────────
function Insights({ users, incidents, timesheets, holidays, absences }) {
  const p1 = incidents.filter(i => i.severity === 'P1').length;
  const resolved = incidents.filter(i => i.status === 'Resolved').length;
  const totalHrs = Object.values(timesheets).flatMap(t => t).reduce((a, b) => a + b.hours, 0);
  const totalHols = holidays.filter(h => h.status === 'approved').length;

  return (
    <div>
      <PageHeader title="Insights" sub="Team performance and operational metrics" />
      <div className="grid-4 mb-16">
        <StatCard label="Total Incidents"  value={incidents.length}    sub={p1 + ' P1 incidents'}    accent="#ef4444" icon="🚨" />
        <StatCard label="Resolution Rate"  value={(incidents.length ? Math.round(resolved/incidents.length*100) : 0) + '%'} sub={resolved+'/'+incidents.length+' resolved'} accent="#10b981" icon="✅" />
        <StatCard label="Team Hours"       value={totalHrs}            sub="All engineers"            accent="#3b82f6" icon="⏱" />
        <StatCard label="Approved Leave"   value={totalHols}           sub="Holiday bookings"         accent="#f59e0b" icon="🌴" />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">Incident Breakdown by Engineer</div>
          <table>
            <thead><tr><th>Engineer</th><th>Total</th><th>P1s</th><th>Resolved</th></tr></thead>
            <tbody>
              {users.map(u => {
                const inc = incidents.filter(i => i.reporter === u.id);
                const p   = inc.filter(i => i.severity === 'P1').length;
                const r   = inc.filter(i => i.status === 'Resolved').length;
                return (
                  <tr key={u.id}>
                    <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar user={u} size={24} />{u.name}</div></td>
                    <td style={{ fontFamily: 'DM Mono' }}>{inc.length}</td>
                    <td style={{ fontFamily: 'DM Mono', color: p > 0 ? '#fca5a5' : 'var(--text-muted)' }}>{p}</td>
                    <td style={{ fontFamily: 'DM Mono', color: '#6ee7b7' }}>{r}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-title">Hours vs On-Call by Engineer</div>
          {users.map(u => {
            const sheets = timesheets[u.id] || [];
            const hrs = sheets.reduce((a,b) => a+b.hours,0);
            const oc  = sheets.reduce((a,b) => a+b.oncall,0);
            return (
              <div key={u.id} style={{ marginBottom: 14 }}>
                <div className="flex-between" style={{ marginBottom: 4 }}>
                  <span className="muted-xs">{u.name}</span>
                  <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{hrs}h reg / {oc}h OC</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: Math.min(100,(hrs/80)*100)+'%', background: '#3b82f6' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Capacity ───────────────────────────────────────────────────────────────
function Capacity({ users, rota, holidays, timesheets }) {
  const today = new Date();
  const weeks = Array.from({ length: 8 }, (_, w) => {
    const start = new Date(today); start.setDate(today.getDate() + w * 7 - today.getDay() + 1);
    const days  = Array.from({ length: 5 }, (_, d) => { const dt = new Date(start); dt.setDate(start.getDate()+d); return dt.toISOString().slice(0,10); });
    const available = users.filter(u => !days.some(d => holidays.find(h => h.userId===u.id && d>=h.start && d<=h.end && h.status==='approved'))).length;
    return { label: `W${w+1}`, start: start.toISOString().slice(0,10), available, total: users.length };
  });

  return (
    <div>
      <PageHeader title="Capacity Planning" sub="8-week forward view of team availability" />
      <div className="card mb-16">
        <div className="card-title">Team Availability (Next 8 Weeks)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {weeks.map(w => {
            const pct = (w.available / w.total) * 100;
            return (
              <div key={w.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1, minWidth: 60 }}>
                <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{w.available}/{w.total}</div>
                <div style={{ width: '100%', height: 80, background: 'var(--bg-card2)', borderRadius: 6, display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
                  <div style={{ width: '100%', height: pct + '%', background: pct > 80 ? '#10b981' : pct > 50 ? '#f59e0b' : '#ef4444', transition: 'height 0.3s' }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{w.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{w.start}</div>
              </div>
            );
          })}
        </div>
      </div>
      <Alert>📈 Capacity factors in approved holidays. Red = low capacity (&lt;50%), Amber = medium, Green = good.</Alert>
    </div>
  );
}

// ── Weekly Reports ─────────────────────────────────────────────────────────
function WeeklyReports({ users, incidents, timesheets, holidays }) {
  const [gen, setGen] = useState(false);
  const [weekNote, setWeekNote] = useState('');
  const now = new Date();
  const weekNum = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 604800000);

  return (
    <div>
      <PageHeader title="Weekly Reports"
        actions={<button className="btn btn-primary" onClick={() => setGen(true)}>📋 Generate This Week</button>} />
      {gen && (
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Weekly Operations Report</div>
          <div className="muted-xs" style={{ marginBottom: 16, fontFamily: 'DM Mono' }}>W{weekNum} · {now.toLocaleDateString('en-GB')}</div>

          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>📊 Summary Stats</div>
          <div className="grid-4 mb-16">
            <StatCard label="Incidents"    value={incidents.filter(i=>i.status==='Investigating').length} sub="Open"     accent="#ef4444" />
            <StatCard label="Resolved"     value={incidents.filter(i=>i.status==='Resolved').length}     sub="Closed"   accent="#10b981" />
            <StatCard label="Team Hours"   value={Object.values(timesheets).flatMap(t=>t).filter((_,i)=>i<users.length).reduce((a,b)=>a+(b.hours||0),0)} sub="This week" accent="#3b82f6" />
            <StatCard label="On Leave"     value={holidays.filter(h=>h.status==='approved').length}       sub="Approved" accent="#f59e0b" />
          </div>

          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>🚨 Incidents</div>
          {incidents.slice(0, 8).map(i => (
            <div key={i.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(30,58,95,.4)', fontSize: 13, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{i.id} — {i.title}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Tag label={i.severity} type="red" />
                <Tag label={i.status}   type={i.status==='Resolved'?'green':'red'} />
              </div>
            </div>
          ))}

          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', margin: '16px 0 8px' }}>⏱ Team Hours</div>
          {users.map(u => {
            const h = timesheets[u.id]?.[0];
            return (
              <div key={u.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(30,58,95,.4)', fontSize: 13, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar user={u} size={22} />{u.name}</div>
                <span style={{ fontFamily: 'DM Mono' }}>{h?.hours || 0}h + {h?.oncall || 0}h OC</span>
              </div>
            );
          })}

          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', margin: '16px 0 8px' }}>📝 Manager Notes</div>
          <RichEditor value={weekNote} onChange={setWeekNote} placeholder="Add this week's notes, highlights, action items…" rows={5} />

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary btn-sm" onClick={() => window.print()}>📄 Print / PDF</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Payroll ────────────────────────────────────────────────────────────────
function Payroll({ users, timesheets, payconfig, isManager }) {
  return (
    <div>
      <PageHeader title="Payroll" sub="Pay calculation and submission" />
      <div className="card">
        <table>
          <thead><tr><th>Engineer</th><th>Base/mo</th><th>Rate</th><th>Hrs</th><th>OC Hrs</th><th>Reg Pay</th><th>OC Pay</th><th>Est. Monthly</th></tr></thead>
          <tbody>
            {users.filter(u => isManager || u.id === users[0]?.id).map(u => {
              const p   = payconfig[u.id] || { rate: 40, base: 2500 };
              const h   = timesheets[u.id]?.[0];
              const oc  = h?.oncall || 0;
              const hrs = h?.hours  || 0;
              const ocp = oc * p.rate * 0.5;
              const reg = hrs * p.rate;
              return (
                <tr key={u.id}>
                  <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar user={u} size={24} /><span style={{ fontSize: 12 }}>{u.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>£{(p.base||0).toLocaleString()}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>£{p.rate}/hr</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{hrs}h</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{oc}h</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#6ee7b7' }}>£{reg.toLocaleString()}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#c4b5fd' }}>£{ocp}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, fontWeight: 600 }}>£{((p.base||0) + ocp).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isManager && <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => window.print()}>📤 Submit / Print</button>
        </div>}
      </div>
    </div>
  );
}

// ── Pay Config ─────────────────────────────────────────────────────────────
function PayConfig({ payconfig, setPayconfig, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Pay configuration is restricted to managers.</Alert>;
  return (
    <div>
      <PageHeader title="Pay Config" sub="Configure rates and pay rules" />
      <div className="card">
        <div className="card-title">Engineer Pay Rates</div>
        <table>
          <thead><tr><th>Engineer</th><th>Base (£/mo)</th><th>Rate (£/hr)</th><th>OC Rate</th></tr></thead>
          <tbody>
            {Object.entries(payconfig).map(([id, p]) => (
              <tr key={id}>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{id}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>£</span>
                    <input className="input" type="number" value={p.base||2500} onChange={e => setPayconfig({ ...payconfig, [id]: { ...p, base: +e.target.value } })} style={{ width: 100 }} />
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>£</span>
                    <input className="input" type="number" value={p.rate} onChange={e => setPayconfig({ ...payconfig, [id]: { ...p, rate: +e.target.value } })} style={{ width: 80 }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/hr</span>
                  </div>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>£{((p.rate||40)*0.5).toFixed(2)}/hr (+50%)</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Alert style={{ marginTop: 12 }}>On-call uplift: 50% of hourly rate applies automatically to all on-call hours.</Alert>
      </div>
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────
function Settings({ users, setUsers, isManager, secureLinks, setSecureLinks }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [form, setForm]       = useState({ name: '', role: 'Engineer' });
  const [linkForm, setLinkForm] = useState({ label: '', expiry: '', password: '' });

  const add = () => {
    if (!form.name || users.length >= 6) return;
    const id    = generateTrigramId(form.name, users);
    const color = TRICOLORS[users.length % TRICOLORS.length];
    setUsers([...users, { id, name: form.name, role: form.role, tri: id.slice(0, 3), avatar: form.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase(), color }]);
    setShowAdd(false); setForm({ name: '', role: 'Engineer' });
  };

  const addLink = () => {
    if (!linkForm.label) return;
    const link = { id: 'lnk-' + Date.now(), ...linkForm, url: `https://dsmeetul-cpu.github.io/cloudops-rota?ref=${Date.now()}`, created: new Date().toISOString().slice(0,10) };
    setSecureLinks([...(secureLinks||[]), link]);
    setShowLink(false); setLinkForm({ label: '', expiry: '', password: '' });
  };

  return (
    <div>
      <PageHeader title="Settings"
        actions={isManager && <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowLink(true)}>🔗 Secure Share Link</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Engineer</button>
        </div>} />

      <div className="card mb-16">
        <div className="card-title">Team Members ({users.length}/6 max)</div>
        {users.map(u => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(30,58,95,.4)' }}>
            <Avatar user={u} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{u.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u.id} · {u.role}</div>
            </div>
            <Tag label={u.role} type={u.role === 'Manager' ? 'amber' : 'blue'} />
          </div>
        ))}
        {users.length >= 6 && <Alert type="warning" style={{ marginTop: 12 }}>Maximum 6 engineers reached.</Alert>}
      </div>

      {(secureLinks||[]).length > 0 && (
        <div className="card mb-16">
          <div className="card-title">🔗 Secure Share Links</div>
          {secureLinks.map(l => (
            <div key={l.id} className="flex-between row-item">
              <div>
                <div className="name-sm">{l.label}</div>
                <div className="muted-xs">{l.url} · Expires: {l.expiry || 'Never'}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(l.url)}>📋 Copy</button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">Google Drive Integration</div>
        <div className="gd-status"><div className="dot-live" /> All data auto-synced to Google Drive → <code style={{ fontSize: 11, color: 'var(--accent)' }}>CloudOps-Rota/</code></div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '12px 0' }}>Data is saved as JSON files in your personal Google Drive. Only authorised users with the correct credentials can access this app.</p>
      </div>

      {showAdd && (
        <Modal title="Add Engineer" onClose={() => setShowAdd(false)}>
          <FormGroup label="Full Name"><input className="input" placeholder="e.g. Sarah Johnson" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormGroup>
          <FormGroup label="Role">
            <select className="select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option>Engineer</option><option>Manager</option>
            </select>
          </FormGroup>
          <Alert>Username auto-generated: e.g. SAJ04 (tri-gram + number). Add their password to the AUTH object in App.js and redeploy.</Alert>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Add Engineer</button>
          </div>
        </Modal>
      )}

      {showLink && (
        <Modal title="Create Secure Share Link" onClose={() => setShowLink(false)}>
          <FormGroup label="Label"><input className="input" placeholder="e.g. External Rota View" value={linkForm.label} onChange={e => setLinkForm({ ...linkForm, label: e.target.value })} /></FormGroup>
          <FormGroup label="Expiry Date (optional)"><input className="input" type="date" value={linkForm.expiry} onChange={e => setLinkForm({ ...linkForm, expiry: e.target.value })} /></FormGroup>
          <FormGroup label="Password (optional)"><input className="input" type="password" placeholder="Optional link password" value={linkForm.password} onChange={e => setLinkForm({ ...linkForm, password: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowLink(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={addLink}>Create Link</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── My Account ─────────────────────────────────────────────────────────────
function MyAccount({ currentUser, users }) {
  const user = users.find(u => u.id === currentUser);
  const [notif, setNotif] = useState('Email + Push');
  const [saved, setSaved] = useState(false);

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div>
      <PageHeader title="My Account" />
      <div className="card" style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
          <Avatar user={user || { avatar: '?', color: '#475569' }} size={60} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{user?.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{user?.id}</div>
            <Tag label={user?.role || 'Engineer'} type={user?.role === 'Manager' ? 'amber' : 'blue'} />
          </div>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
        <FormGroup label="Display Name"><input className="input" defaultValue={user?.name} /></FormGroup>
        <FormGroup label="Notifications">
          <select className="select" value={notif} onChange={e => setNotif(e.target.value)}>
            <option>Email + Push</option><option>Email only</option><option>Push only</option><option>None</option>
          </select>
        </FormGroup>
        <FormGroup label="New Password" hint="leave blank to keep current"><input className="input" type="password" placeholder="New password" /></FormGroup>
        <FormGroup label="Confirm Password"><input className="input" type="password" placeholder="Confirm new password" /></FormGroup>
        <button className="btn btn-primary" onClick={save}>{saved ? '✅ Saved!' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [loggedIn, setLoggedIn]       = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [page, setPage]               = useState('oncall');
  const [driveToken, setDriveToken]   = useState(null);
  const [syncing, setSyncing]         = useState(false);
  const [lastSync, setLastSync]       = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQ, setSearchQ]         = useState('');

  // Core state
  const [users, setUsers]             = useState(DEFAULT_USERS);
  const [holidays, setHolidays]       = useState(DEFAULT_HOLIDAYS);
  const [incidents, setIncidents]     = useState(DEFAULT_INCIDENTS);
  const [timesheets, setTimesheets]   = useState(DEFAULT_TIMESHEETS);
  const [upgrades, setUpgrades]       = useState(DEFAULT_UPGRADES);
  const [wiki, setWiki]               = useState(DEFAULT_WIKI);
  const [glossary, setGlossary]       = useState(DEFAULT_GLOSSARY);
  const [contacts, setContacts]       = useState(DEFAULT_CONTACTS);
  const [payconfig, setPayconfig]     = useState(DEFAULT_PAYCONFIG);
  const [rota, setRota]               = useState(() => generateRota(DEFAULT_USERS, '2026-03-30', 8));

  // Extended state (new features)
  const [swapRequests, setSwapRequests] = useState([]);
  const [toil, setToil]               = useState([]);
  const [absences, setAbsences]       = useState([]);
  const [logbook, setLogbook]         = useState([]);
  const [documents, setDocuments]     = useState([]);
  const [secureLinks, setSecureLinks] = useState([]);

  const isManager = currentUser === 'MBA47';

  // Connect Google Drive
  const connectDrive = async () => {
    try {
      await gapiLoad();
      const token = await initGoogleAuth(GOOGLE_CLIENT_ID);
      setDriveToken(token);
      setSyncing(true);
      const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, logbook, documents };
      const data = await loadAllFromDrive(token, defaults);
      if (data.users)        setUsers(data.users);
      if (data.holidays)     setHolidays(data.holidays);
      if (data.incidents)    setIncidents(data.incidents);
      if (data.timesheets)   setTimesheets(data.timesheets);
      if (data.upgrades)     setUpgrades(data.upgrades);
      if (data.wiki)         setWiki(data.wiki);
      if (data.glossary)     setGlossary(data.glossary);
      if (data.contacts)     setContacts(data.contacts);
      if (data.payconfig)    setPayconfig(data.payconfig);
      if (data.rota)         setRota(data.rota);
      if (data.swapRequests) setSwapRequests(data.swapRequests);
      if (data.toil)         setToil(data.toil);
      if (data.absences)     setAbsences(data.absences);
      if (data.logbook)      setLogbook(data.logbook);
      if (data.documents)    setDocuments(data.documents);
      setLastSync(new Date());
      setSyncing(false);
    } catch (e) {
      console.error('Drive connect error:', e);
      setSyncing(false);
    }
  };

  const save = useCallback(async (key, data) => {
    if (!driveToken) return;
    await driveWrite(driveToken, key, data);
    setLastSync(new Date());
  }, [driveToken]);

  useEffect(() => { save('users', users); },           [users]);
  useEffect(() => { save('holidays', holidays); },     [holidays]);
  useEffect(() => { save('incidents', incidents); },   [incidents]);
  useEffect(() => { save('timesheets', timesheets); }, [timesheets]);
  useEffect(() => { save('upgrades', upgrades); },     [upgrades]);
  useEffect(() => { save('wiki', wiki); },             [wiki]);
  useEffect(() => { save('glossary', glossary); },     [glossary]);
  useEffect(() => { save('contacts', contacts); },     [contacts]);
  useEffect(() => { save('payconfig', payconfig); },   [payconfig]);
  useEffect(() => { save('rota', rota); },             [rota]);
  useEffect(() => { save('swapRequests', swapRequests); }, [swapRequests]);
  useEffect(() => { save('toil', toil); },             [toil]);
  useEffect(() => { save('absences', absences); },     [absences]);
  useEffect(() => { save('logbook', logbook); },       [logbook]);
  useEffect(() => { save('documents', documents); },   [documents]);

  const login = (uid) => {
    setCurrentUser(uid);
    setLoggedIn(true);
    setPage(uid === 'MBA47' ? 'dashboard' : 'oncall');
  };

  if (!loggedIn) return <LoginScreen onLogin={login} driveToken={driveToken} onConnectDrive={connectDrive} />;

  const openInc = incidents.filter(i => i.status === 'Investigating').length;
  const pendingSwaps = swapRequests.filter(s => s.status === 'pending').length;

  const props = {
    users, rota, setRota, holidays, setHolidays,
    incidents, setIncidents, timesheets, setTimesheets,
    upgrades, setUpgrades, wiki, setWiki, glossary, setGlossary,
    contacts, setContacts, payconfig, setPayconfig,
    currentUser, isManager, swapRequests, setSwapRequests,
    toil, setToil, absences, setAbsences, logbook, setLogbook,
    documents, setDocuments, secureLinks, setSecureLinks
  };

  const renderPage = () => {
    if (page === 'dashboard' && !isManager) return <Alert type="warning">⚠ Dashboard is restricted to managers.</Alert>;
    switch (page) {
      case 'dashboard':  return <Dashboard {...props} />;
      case 'oncall':     return <OnCall {...props} />;
      case 'myshift':    return <MyShift {...props} />;
      case 'calendar':   return <CalendarView {...props} />;
      case 'rota':       return <RotaPage {...props} />;
      case 'incidents':  return <Incidents {...props} />;
      case 'timesheets': return <Timesheets {...props} />;
      case 'holidays':   return <Holidays {...props} />;
      case 'swaps':      return <ShiftSwaps {...props} />;
      case 'upgrades':   return <UpgradeDays {...props} />;
      case 'stress':     return <StressScore {...props} />;
      case 'toil':       return <TOIL {...props} />;
      case 'absence':    return <Absence {...props} />;
      case 'logbook':    return <Logbook {...props} />;
      case 'wiki':       return <Wiki {...props} />;
      case 'glossary':   return <Glossary {...props} />;
      case 'contacts':   return <Contacts {...props} />;
      case 'docs':       return <Documents {...props} />;
      case 'insights':   return <Insights {...props} />;
      case 'capacity':   return <Capacity {...props} />;
      case 'reports':    return <WeeklyReports {...props} />;
      case 'payroll':    return <Payroll {...props} />;
      case 'payconfig':  return <PayConfig {...props} />;
      case 'settings':   return <Settings {...props} />;
      case 'myaccount':  return <MyAccount currentUser={currentUser} users={users} />;
      default: return <p className="muted-sm">Page coming soon</p>;
    }
  };

  const user = users.find(u => u.id === currentUser);
  const pageTitles = {
    dashboard: 'Dashboard', oncall: "Who's On Call", myshift: 'My Shift', calendar: 'Calendar',
    rota: 'Rota', incidents: 'Incidents', timesheets: 'Timesheets', holidays: 'Holidays',
    swaps: 'Shift Swaps', upgrades: 'Upgrade Days', stress: 'Stress Score', toil: 'TOIL',
    absence: 'Absence & Sick', logbook: 'Logbook', wiki: 'Wiki', glossary: 'Glossary',
    contacts: 'Contacts', docs: 'Documents', insights: 'Insights', capacity: 'Capacity',
    reports: 'Weekly Reports', payroll: 'Payroll', payconfig: 'Pay Config',
    settings: 'Settings', myaccount: 'My Account'
  };

  return (
    <div className="app">
      {/* Sidebar */}
      <div className={`sidebar${sidebarOpen ? '' : ' collapsed'}`}>
        <div className="logo">
          <div className="logo-icon">CR</div>
          {sidebarOpen && <div>
            <div className="logo-text">CloudOps Rota</div>
            <div className="logo-sub">Cloud Run Operations</div>
          </div>}
        </div>
        {sidebarOpen && (
          <div className="user-pill">
            <Avatar user={user || { avatar: '?', color: '#475569' }} />
            <div className="user-info">
              <div className="user-name">{user?.name?.split(' ')[0]} {user?.name?.split(' ')[1]?.[0]}.</div>
              <div className="user-role">{currentUser} · {user?.role}</div>
            </div>
          </div>
        )}
        {NAV.map(sec => (
          <div key={sec.section}>
            {sidebarOpen && <div className="nav-section">{sec.section}</div>}
            {sec.items.filter(i => !i.managerOnly || isManager).map(item => (
              <div key={item.id} className={`nav-item${page === item.id ? ' active' : ''}`} onClick={() => setPage(item.id)} title={item.label}>
                <span className="nav-icon">{item.icon}</span>
                {sidebarOpen && <span>{item.label}</span>}
                {item.badge && openInc > 0 && <span className="badge">{openInc}</span>}
                {item.id === 'swaps' && pendingSwaps > 0 && <span className="badge">{pendingSwaps}</span>}
              </div>
            ))}
          </div>
        ))}
        <div style={{ marginTop: 'auto', padding: 12, borderTop: '1px solid var(--border)' }}>
          {driveToken ? (
            sidebarOpen && <div className="gd-status">
              <div className="dot-live" />
              <span style={{ fontSize: 11 }}>Synced {lastSync && lastSync.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ) : (
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginBottom: 8 }} onClick={connectDrive}>
              {sidebarOpen ? '📁 Connect Drive' : '📁'}
            </button>
          )}
          {syncing && sidebarOpen && <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>Syncing…</div>}
          <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setLoggedIn(false)}>
            {sidebarOpen ? 'Sign Out' : '⎋'}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="main">
        <div className="topbar">
          <button className="btn btn-secondary btn-sm" onClick={() => setSidebarOpen(!sidebarOpen)} style={{ padding: '4px 10px' }}>
            {sidebarOpen ? '◀' : '▶'}
          </button>
          <div className="topbar-title">{pageTitles[page] || page}</div>
          <input className="topbar-search" placeholder="Search…" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
            {openInc > 0 && <div style={{ background: '#ef4444', color: '#fff', borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>🚨 {openInc}</div>}
            <Avatar user={user || { avatar: '?', color: '#475569' }} size={30} />
          </div>
        </div>
        <div className="content">{renderPage()}</div>
      </div>
    </div>
  );
}
