// src/App.js
import React, { useState, useEffect, useCallback } from 'react';
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

// ── Google OAuth Client ID ─────────────────────────────────────────────────
// Replace with your own from https://console.cloud.google.com/
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

// ── Hardcoded passwords (in production: store hashed in Drive) ────────────
const AUTH = { MBA47: 'manager123', MAH01: 'eng123', DAR02: 'eng123', MAR03: 'eng123' };

// ── Tiny UI helpers ────────────────────────────────────────────────────────
function Avatar({ user, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size > 40 ? 12 : 8,
      background: user?.color || '#1d4ed8', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size > 40 ? 14 : 11,
      fontWeight: 600, color: '#fff', flexShrink: 0
    }}>{user?.avatar || '?'}</div>
  );
}

function Tag({ label, type = 'blue' }) {
  return <span className={`tag tag-${type}`}>{label}</span>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 700 } : {}}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormGroup({ label, children }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

function Alert({ type = 'info', children }) {
  return <div className={`alert alert-${type}`}>{children}</div>;
}

// ── Login Screen ───────────────────────────────────────────────────────────
function LoginScreen({ onLogin, driveToken, onConnectDrive }) {
  const [uid, setUid] = useState('');
  const [pw, setPw]   = useState('');
  const [err, setErr] = useState('');

  const handle = () => {
    const id = uid.trim().toUpperCase();
    if (AUTH[id] && AUTH[id] === pw) onLogin(id);
    else setErr('Invalid username or password');
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
      </div>
    </div>
  );
}

// ── Navigation ─────────────────────────────────────────────────────────────
const NAV = [
  { section: 'Overview', items: [
    { id: 'dashboard', icon: '◈', label: 'Dashboard',      managerOnly: true },
    { id: 'oncall',    icon: '📡', label: "Who's On Call"  },
    { id: 'myshift',   icon: '🗓', label: 'My Shift'       },
    { id: 'calendar',  icon: '📅', label: 'Calendar'       },
  ]},
  { section: 'Operations', items: [
    { id: 'rota',      icon: '🔄', label: 'Rota'           },
    { id: 'incidents', icon: '🚨', label: 'Incidents', badge: true },
  ]},
  { section: 'People', items: [
    { id: 'timesheets', icon: '⏱', label: 'Timesheets'    },
    { id: 'holidays',   icon: '🌴', label: 'Holidays'      },
    { id: 'upgrades',   icon: '⬆', label: 'Upgrade Days'  },
    { id: 'stress',     icon: '📊', label: 'Stress Score'  },
  ]},
  { section: 'Knowledge', items: [
    { id: 'wiki',      icon: '📖', label: 'Wiki'           },
    { id: 'glossary',  icon: '📚', label: 'Glossary'       },
    { id: 'contacts',  icon: '👥', label: 'Contacts'       },
  ]},
  { section: 'Reporting', items: [
    { id: 'insights',  icon: '💡', label: 'Insights'       },
    { id: 'reports',   icon: '📋', label: 'Weekly Reports' },
  ]},
  { section: 'Finance', items: [
    { id: 'payroll',   icon: '💷', label: 'Payroll'        },
    { id: 'payconfig', icon: '⚙', label: 'Pay Config'     },
  ]},
  { section: 'Account', items: [
    { id: 'settings',  icon: '🔧', label: 'Settings'       },
    { id: 'myaccount', icon: '👤', label: 'My Account'     },
  ]},
];

// ── Pages ──────────────────────────────────────────────────────────────────

function Dashboard({ users, rota, holidays, incidents, timesheets }) {
  const today = new Date().toISOString().slice(0, 10);
  const onCallToday = users.filter(u => rota[u.id]?.[today] && rota[u.id][today] !== 'off');
  const pending     = holidays.filter(h => h.status === 'pending');
  const openInc     = incidents.filter(i => i.status === 'Investigating');
  const totalHrs    = users.map(u => timesheets[u.id]?.[0]?.hours || 0).reduce((a, b) => a + b, 0);

  return (
    <div>
      <PageHeader title="Manager Dashboard" sub="Cloud Run Operations · Full team visibility" />
      <div className="grid-4 mb-16">
        <StatCard label="Team Size"        value={users.length}     sub="engineers + manager" accent="#3b82f6" />
        <StatCard label="Pending Holidays" value={pending.length}   sub="Awaiting approval"   accent="#f59e0b" />
        <StatCard label="Open Incidents"   value={openInc.length}   sub="Active investigations" accent="#ef4444" />
        <StatCard label="Hours This Week"  value={totalHrs}         sub="Across all engineers" accent="#10b981" />
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
      </div>
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
        {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-accent" style={{ background: accent }} />
      <div className="stat-label">{label}</div>
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

function OnCall({ users, rota }) {
  const today   = new Date();
  const base    = new Date(today);
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7)); // Mon
  const week    = Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(base.getDate() + i); return d; });
  const DAYS    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const exportIcal = (user) => {
    const content = generateICalFeed(rota[user.id] || {}, user.name);
    downloadIcal(content, `cloudops-rota-${user.id}.ics`);
  };

  return (
    <div>
      <PageHeader title="Who's On Call" sub="Current week schedule — visible to all team members" />
      <Alert>📡 On-call engineers receive email notifications at shift start. Export to add to your calendar.</Alert>
      <ShiftLegend />
      <div className="card" style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th>Engineer</th>
              {week.map((d, i) => (
                <th key={i} style={{ textAlign: 'center', fontSize: 11 }}>
                  {DAYS[i]}<br />
                  <span style={{ fontFamily: 'DM Mono', color: '#475569', fontSize: 10 }}>{d.getDate()}</span>
                </th>
              ))}
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

function MyShift({ currentUser, rota, users }) {
  const user    = users.find(u => u.id === currentUser);
  const today   = new Date();
  const upcoming = [];
  for (let i = 0; i < 14; i++) {
    const d  = new Date(today); d.setDate(today.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    const s  = rota[user?.id]?.[ds];
    if (s && s !== 'off') upcoming.push({ date: ds, shift: s, day: d });
  }
  const todayShift = rota[user?.id]?.[today.toISOString().slice(0, 10)];

  const exportMine = () => {
    const content = generateICalFeed(rota[user.id] || {}, user.name);
    downloadIcal(content, `my-rota-${user.id}.ics`);
  };

  return (
    <div>
      <PageHeader title="My Shift" sub={`${user?.name} · ${user?.id}`} />
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
          <div className="card-title">Next 14 Days</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>{upcoming.length} shifts</div>
          <p className="muted-sm">Across daily, evening &amp; weekend</p>
        </div>
      </div>
      <div className="card mb-16">
        <div className="card-title">Upcoming Shifts</div>
        {upcoming.length === 0 && <p className="muted-sm">No upcoming shifts in the next 14 days</p>}
        {upcoming.map(({ date, shift, day }) => (
          <div key={date} className="flex-between row-item">
            <div>
              <div className="name-sm">{day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
              <div className="muted-xs">{SHIFTS[shift].time}</div>
            </div>
            <Tag label={SHIFTS[shift].label} type={shift === 'daily' ? 'blue' : shift === 'evening' ? 'purple' : 'pink'} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ical-btn" onClick={exportMine}>📆 Export My Shifts (.ics — Outlook, iPhone, Google)</button>
      </div>
    </div>
  );
}

function CalendarView({ users, rota, holidays, upgrades }) {
  const [cur, setCur] = useState(new Date(2026, 3, 1));
  const yr = cur.getFullYear(), mo = cur.getMonth();
  const first   = new Date(yr, mo, 1);
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

function RotaPage({ users, rota, setRota, holidays }) {
  const [startDate, setStartDate] = useState('2026-04-07');
  const [weeks, setWeeks]         = useState(4);
  const [generated, setGenerated] = useState(true);
  const DAYS = ['M','T','W','T','F','S','S'];

  const generate = () => { setRota(generateRota(users, startDate, weeks)); setGenerated(true); };

  const weekStarts = Array.from({ length: weeks }, (_, w) => {
    const d = new Date(startDate); d.setDate(d.getDate() + w * 7); return d;
  });

  return (
    <div>
      <PageHeader title="Rota Management" sub="Generate &amp; manage team on-call schedule" />
      <div className="card mb-16">
        <div className="card-title">⚙ Generate Rota</div>
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
          <button className="ical-btn" onClick={() => {
            users.forEach(u => {
              const ic = generateICalFeed(rota[u.id] || {}, u.name);
              downloadIcal(ic, `rota-${u.id}.ics`);
            });
          }}>📥 Export All (.ics)</button>
        </div>
      </div>
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
                          const s   = hol ? 'holiday' : (rota[u.id]?.[ds] || 'off');
                          return (
                            <td key={ds} style={{ textAlign: 'center', padding: '6px 4px' }}>
                              <div className={`rota-cell ${hol ? 'rota-holiday' : SHIFTS[s]?.color || 'shift-off'}`} style={{ fontSize: 10, padding: '4px 6px' }}>
                                {hol ? '🌴' : s === 'off' ? '—' : SHIFTS[s]?.label?.slice(0, 3) || s}
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

function Incidents({ users, incidents, setIncidents, currentUser }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', severity: 'P2', desc: '' });
  const SEV_COLOR = { P1: '#ef4444', P2: '#f59e0b', P3: '#3b82f6', P4: '#10b981' };

  const add = () => {
    if (!form.title) return;
    const id = 'INC-' + String(incidents.length + 1).padStart(3, '0');
    setIncidents([{ id, ...form, status: 'Investigating', reporter: currentUser, date: new Date().toISOString().slice(0, 16).replace('T', ' ') }, ...incidents]);
    setShowModal(false); setForm({ title: '', severity: 'P2', desc: '' });
  };

  return (
    <div>
      <PageHeader title="Incidents" sub="Log and track operational incidents"
        actions={<button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Log Incident</button>} />
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>Title</th><th>Severity</th><th>Status</th><th>Reporter</th><th>Date/Time</th></tr></thead>
          <tbody>
            {[...incidents].sort((a, b) => new Date(b.date) - new Date(a.date)).map(i => {
              const u = users.find(x => x.id === i.reporter);
              return (
                <tr key={i.id}>
                  <td><span style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{i.id}</span></td>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>{i.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{i.desc}</div>
                  </td>
                  <td><span style={{ background: SEV_COLOR[i.severity] + '25', color: SEV_COLOR[i.severity], padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{i.severity}</span></td>
                  <td><Tag label={i.status} type={i.status === 'Resolved' ? 'green' : i.status === 'Investigating' ? 'red' : 'blue'} /></td>
                  <td style={{ fontSize: 12 }}>{u?.name || i.reporter}</td>
                  <td style={{ fontSize: 12, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{i.date}</td>
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
          <FormGroup label="Description"><textarea className="textarea" placeholder="What happened? What actions were taken?" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Log Incident</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Timesheets({ users, timesheets, setTimesheets, currentUser, isManager, payconfig }) {
  const [activeUser, setActiveUser] = useState(currentUser);
  const [showPayroll, setShowPayroll] = useState(false);
  const user   = users.find(u => u.id === activeUser);
  const sheets = timesheets[activeUser] || [];
  const totalHrs = sheets.reduce((a, b) => a + b.hours, 0);
  const totalOC  = sheets.reduce((a, b) => a + b.oncall, 0);
  const rate  = payconfig[activeUser]?.rate || 40;
  const gross = totalHrs * rate + totalOC * rate * 0.5;
  const visibleUsers = isManager ? users : [users.find(u => u.id === currentUser)].filter(Boolean);

  return (
    <div>
      <PageHeader title="Timesheets" sub="Hours &amp; payroll tracking" />
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
          <div className="card-title">Weekly Timesheets</div>
          {isManager && <button className="btn btn-primary btn-sm" onClick={() => setShowPayroll(true)}>📄 Payroll Report</button>}
        </div>
        <table>
          <thead><tr><th>Week</th><th>Regular Hours</th><th>On-Call Hours</th><th>Notes</th></tr></thead>
          <tbody>
            {sheets.map((s, i) => (
              <tr key={i}>
                <td style={{ fontFamily: 'DM Mono', color: 'var(--accent)' }}>{s.week}</td>
                <td>{s.hours}h</td>
                <td>{s.oncall}h</td>
                <td style={{ color: 'var(--text-muted)' }}>{s.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showPayroll && (
        <Modal title={`Payroll Report — ${user?.name}`} onClose={() => setShowPayroll(false)}>
          <div style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div className="muted-xs" style={{ marginBottom: 12 }}>Rate: £{rate}/hr</div>
            <div className="payroll-row"><span>Regular ({totalHrs}h × £{rate})</span><span>£{(totalHrs * rate).toLocaleString()}</span></div>
            <div className="payroll-row"><span>On-Call ({totalOC}h × £{rate * 0.5} uplift)</span><span>£{(totalOC * rate * 0.5).toLocaleString()}</span></div>
            <div className="payroll-row total"><span>Gross Pay</span><span>£{Math.round(gross).toLocaleString()}</span></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => window.print()}>📄 Print / PDF</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Holidays({ users, holidays, setHolidays, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ start: '', end: '', note: '' });

  const add = () => {
    if (!form.start || !form.end) return;
    setHolidays([...holidays, { id: 'h' + Date.now(), userId: currentUser, ...form, status: isManager ? 'approved' : 'pending' }]);
    setShowModal(false); setForm({ start: '', end: '', note: '' });
  };
  const approve = id => setHolidays(holidays.map(h => h.id === id ? { ...h, status: 'approved' } : h));
  const reject  = id => setHolidays(holidays.map(h => h.id === id ? { ...h, status: 'rejected' } : h));
  const visible = isManager ? holidays : holidays.filter(h => h.userId === currentUser);

  return (
    <div>
      <PageHeader title="Holiday Tracker" sub="Manage leave requests and approvals"
        actions={<button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Request Holiday</button>} />
      <div className="card">
        <table>
          <thead><tr><th>Engineer</th><th>Start</th><th>End</th><th>Days</th><th>Notes</th><th>Status</th>{isManager && <th>Actions</th>}</tr></thead>
          <tbody>
            {visible.map(h => {
              const u = users.find(x => x.id === h.userId);
              const d = Math.ceil((new Date(h.end) - new Date(h.start)) / 86400000) + 1;
              return (
                <tr key={h.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar user={u || { avatar: '?', color: '#475569' }} size={24} /><span style={{ fontSize: 12 }}>{u?.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{h.start}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{h.end}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{d}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.note || '—'}</td>
                  <td><Tag label={h.status} type={h.status === 'approved' ? 'green' : h.status === 'pending' ? 'amber' : 'red'} /></td>
                  {isManager && (
                    <td>{h.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-success btn-sm" onClick={() => approve(h.id)}>✓</button>
                        <button className="btn btn-danger btn-sm"  onClick={() => reject(h.id)}>✗</button>
                      </div>
                    )}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showModal && (
        <Modal title="Request Holiday" onClose={() => setShowModal(false)}>
          <FormGroup label="Start Date"><input className="input" type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></FormGroup>
          <FormGroup label="End Date"><input className="input" type="date" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></FormGroup>
          <FormGroup label="Notes (optional)"><input className="input" placeholder="Travel, family, etc." value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></FormGroup>
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

function UpgradeDays({ users, upgrades, setUpgrades, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: '', name: '' });

  const add = () => {
    if (!form.date || !form.name) return;
    setUpgrades([...upgrades, { id: 'u' + Date.now(), ...form, attendees: [] }]);
    setShowModal(false); setForm({ date: '', name: '' });
  };
  const toggleAttend = (id, uid) => setUpgrades(upgrades.map(u =>
    u.id !== id ? u : { ...u, attendees: u.attendees.includes(uid) ? u.attendees.filter(x => x !== uid) : [...u.attendees, uid] }
  ));

  return (
    <div>
      <PageHeader title="Upgrade Days" sub="Global system upgrade events &amp; attendee management"
        actions={isManager && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Upgrade Day</button>} />
      {upgrades.map(up => (
        <div key={up.id} className="card mb-16">
          <div className="flex-between mb-12">
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{up.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono', marginTop: 2 }}>{up.date}</div>
            </div>
            <Tag label="⬆ Upgrade" type="green" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>Click to mark attendance:</div>
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
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Add</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StressScore({ users, timesheets }) {
  const scores = users.map(u => {
    const sheets = timesheets[u.id] || [];
    const hrs    = sheets.reduce((a, b) => a + b.hours, 0);
    const oc     = sheets.reduce((a, b) => a + b.oncall, 0);
    const score  = Math.min(100, Math.round((hrs / 80 * 40) + (oc / 20 * 40) + (oc > 8 ? 20 : 0)));
    return { user: u, hrs, oc, score, level: score > 75 ? 'High' : score > 50 ? 'Medium' : 'Low' };
  });
  const COLOR = { High: '#ef4444', Medium: '#f59e0b', Low: '#10b981' };

  return (
    <div>
      <PageHeader title="Stress Score" sub="Identify engineers who may need support or shift redistribution" />
      <Alert>📊 Scores are calculated from hours worked, on-call shifts, and incident involvement over the last 2 weeks.</Alert>
      {scores.map(s => (
        <div key={s.user.id} className="card mb-12">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Avatar user={s.user} size={36} />
            <div style={{ flex: 1 }}>
              <div className="flex-between" style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{s.user.name}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{s.hrs}h / {s.oc}h OC</span>
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
          {s.level === 'High' && <Alert type="warning">⚠ Consider reducing on-call load or redistributing upcoming shifts for {s.user.name.split(' ')[0]}.</Alert>}
        </div>
      ))}
    </div>
  );
}

function Wiki({ wiki, setWiki }) {
  const [sel, setSel]         = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm]       = useState({ title: '', cat: 'Operations', content: '' });

  const add = () => { if (!form.title) return; setWiki([...wiki, { id: 'w' + Date.now(), ...form }]); setShowNew(false); setForm({ title: '', cat: 'Operations', content: '' }); };

  if (sel) {
    const w = wiki.find(x => x.id === sel);
    return (
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => setSel(null)} style={{ marginBottom: 16 }}>← Back</button>
        <div className="card">
          <div className="flex-between mb-12"><div className="page-title">{w.title}</div><Tag label={w.cat} type="blue" /></div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{w.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Wiki" sub="Team knowledge base"
        actions={<button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New Article</button>} />
      {wiki.map(w => (
        <div key={w.id} className="wiki-entry" onClick={() => setSel(w.id)}>
          <div className="flex-between"><div className="wiki-title">{w.title}</div><Tag label={w.cat} type="blue" /></div>
          <div className="muted-xs" style={{ marginTop: 4 }}>{w.content.slice(0, 120)}…</div>
        </div>
      ))}
      {showNew && (
        <Modal title="New Wiki Article" onClose={() => setShowNew(false)}>
          <FormGroup label="Title"><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></FormGroup>
          <FormGroup label="Category">
            <select className="select" value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })}>
              <option>Operations</option><option>Engineering</option><option>Process</option><option>Security</option>
            </select>
          </FormGroup>
          <FormGroup label="Content"><textarea className="textarea" rows={8} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Save Article</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Glossary({ glossary, setGlossary }) {
  const [form, setForm] = useState({ term: '', def: '' });
  const add = () => { if (!form.term) return; setGlossary([...glossary, { id: 'g' + Date.now(), ...form }]); setForm({ term: '', def: '' }); };
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
      <div className="card">
        <table>
          <thead><tr><th>Term</th><th>Definition</th></tr></thead>
          <tbody>{glossary.map(g => <tr key={g.id}><td style={{ fontWeight: 600, color: 'var(--accent)', fontFamily: 'DM Mono', fontSize: 12 }}>{g.term}</td><td style={{ fontSize: 13 }}>{g.def}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Contacts({ contacts, setContacts }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', role: '', email: '', phone: '' });
  const add = () => { if (!form.name) return; setContacts([...contacts, { id: 'c' + Date.now(), ...form }]); setShowModal(false); setForm({ name: '', role: '', email: '', phone: '' }); };
  return (
    <div>
      <PageHeader title="Contacts" sub="Team &amp; external contacts"
        actions={<button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Contact</button>} />
      <div className="grid-2">
        {contacts.map(c => (
          <div key={c.id} className="card card-sm">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 13 }}>
                {c.name.split(' ').map(x => x[0]).join('').slice(0, 2)}
              </div>
              <div><div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.role}</div></div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <div>📧 {c.email}</div><div style={{ marginTop: 4 }}>📞 {c.phone}</div>
            </div>
          </div>
        ))}
      </div>
      {showModal && (
        <Modal title="Add Contact" onClose={() => setShowModal(false)}>
          <FormGroup label="Name"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormGroup>
          <FormGroup label="Role"><input className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} /></FormGroup>
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

function Insights({ users, incidents, timesheets, holidays }) {
  const p1 = incidents.filter(i => i.severity === 'P1').length;
  const resolved = incidents.filter(i => i.status === 'Resolved').length;
  const totalHrs = Object.values(timesheets).flatMap(t => t).reduce((a, b) => a + b.hours, 0);
  const totalHols = holidays.filter(h => h.status === 'approved').length;
  return (
    <div>
      <PageHeader title="Insights" sub="Team performance and operational metrics" />
      <div className="grid-4 mb-16">
        <StatCard label="Total Incidents"  value={incidents.length}                                   sub={p1 + ' P1 incidents'}   accent="#ef4444" />
        <StatCard label="Resolution Rate"  value={(incidents.length ? Math.round(resolved / incidents.length * 100) : 0) + '%'} sub={resolved + '/' + incidents.length + ' resolved'} accent="#10b981" />
        <StatCard label="Team Hours"       value={totalHrs}                                           sub="All engineers"           accent="#3b82f6" />
        <StatCard label="Approved Leave"   value={totalHols}                                          sub="Holiday bookings"        accent="#f59e0b" />
      </div>
      <div className="card">
        <div className="card-title">Incident Breakdown by Engineer</div>
        <table>
          <thead><tr><th>Engineer</th><th>Incidents</th><th>P1s</th><th>Resolved</th></tr></thead>
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
    </div>
  );
}

function WeeklyReports({ users, incidents, timesheets }) {
  const [gen, setGen] = useState(false);
  return (
    <div>
      <PageHeader title="Weekly Reports"
        actions={<button className="btn btn-primary" onClick={() => setGen(true)}>📋 Generate This Week</button>} />
      {gen && (
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Weekly Operations Report</div>
          <div className="muted-xs" style={{ marginBottom: 16, fontFamily: 'DM Mono' }}>W14 · {new Date().toLocaleDateString('en-GB')}</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>Incidents</div>
          {incidents.slice(0, 5).map(i => (
            <div key={i.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(30,58,95,.4)', fontSize: 13, color: 'var(--text-secondary)' }}>
              {i.id} — {i.title} [{i.severity}] [{i.status}]
            </div>
          ))}
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', margin: '16px 0 8px' }}>Team Hours</div>
          {users.map(u => {
            const h = timesheets[u.id]?.[0];
            return (
              <div key={u.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(30,58,95,.4)', fontSize: 13, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{u.name}</span><span style={{ fontFamily: 'DM Mono' }}>{h?.hours || 0}h + {h?.oncall || 0}h OC</span>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary btn-sm" onClick={() => window.print()}>📄 Print / PDF</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Payroll({ users, timesheets, payconfig, isManager }) {
  return (
    <div>
      <PageHeader title="Payroll" sub="Pay calculation and submission" />
      <div className="card">
        <table>
          <thead><tr><th>Engineer</th><th>Base/mo</th><th>Rate</th><th>Hrs (W14)</th><th>OC (W14)</th><th>OC Pay</th><th>Est. Monthly</th></tr></thead>
          <tbody>
            {users.filter(u => isManager || u.id === users[0]?.id).map(u => {
              const p   = payconfig[u.id] || { rate: 40, base: 2500 };
              const h   = timesheets[u.id]?.[0];
              const oc  = h?.oncall || 0;
              const ocp = oc * p.rate * 0.5;
              return (
                <tr key={u.id}>
                  <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar user={u} size={24} /><span style={{ fontSize: 12 }}>{u.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>£{p.base?.toLocaleString()}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>£{p.rate}/hr</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{h?.hours || 0}h</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{oc}h</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#6ee7b7' }}>£{ocp}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, fontWeight: 600 }}>£{(p.base + ocp).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isManager && <div style={{ marginTop: 16, display: 'flex', gap: 8 }}><button className="btn btn-primary" onClick={() => window.print()}>📤 Submit / Print</button></div>}
      </div>
    </div>
  );
}

function PayConfig({ payconfig, setPayconfig, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Pay configuration is restricted to managers.</Alert>;
  return (
    <div>
      <PageHeader title="Pay Config" sub="Configure hourly rates and pay rules" />
      <div className="card">
        <div className="card-title">Hourly Rates (£/hr)</div>
        {Object.entries(payconfig).map(([id, p]) => (
          <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(30,58,95,.4)' }}>
            <span style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'DM Mono' }}>{id}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>£</span>
              <input className="input" type="number" value={p.rate} onChange={e => setPayconfig({ ...payconfig, [id]: { ...p, rate: +e.target.value } })} style={{ width: 80, textAlign: 'right' }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/hr</span>
            </div>
          </div>
        ))}
        <Alert style={{ marginTop: 12 }}>On-call uplift: 50% of hourly rate applies to all on-call hours.</Alert>
      </div>
    </div>
  );
}

function Settings({ users, setUsers, isManager }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState({ name: '', role: 'Engineer' });

  const add = () => {
    if (!form.name) return;
    const id    = generateTrigramId(form.name, users);
    const color = TRICOLORS[users.length % TRICOLORS.length];
    setUsers([...users, { id, name: form.name, role: form.role, tri: id.slice(0, 3), avatar: form.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase(), color }]);
    setShowAdd(false); setForm({ name: '', role: 'Engineer' });
  };

  return (
    <div>
      <PageHeader title="Settings"
        actions={isManager && <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Engineer</button>} />
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
      </div>
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
          <Alert>Username auto-generated: e.g. SAJ04 (tri-gram + number)</Alert>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add}>Add Engineer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MyAccount({ currentUser, users }) {
  const user = users.find(u => u.id === currentUser);
  return (
    <div>
      <PageHeader title="My Account" />
      <div className="card" style={{ maxWidth: 500 }}>
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
          <select className="select"><option>Email + Push</option><option>Email only</option><option>Push only</option><option>None</option></select>
        </FormGroup>
        <FormGroup label="New Password"><input className="input" type="password" placeholder="Leave blank to keep current" /></FormGroup>
        <button className="btn btn-primary">Save Changes</button>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [loggedIn, setLoggedIn]     = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [page, setPage]             = useState('oncall');
  const [driveToken, setDriveToken] = useState(null);
  const [syncing, setSyncing]       = useState(false);
  const [lastSync, setLastSync]     = useState(null);

  // App state
  const [users, setUsers]           = useState(DEFAULT_USERS);
  const [holidays, setHolidays]     = useState(DEFAULT_HOLIDAYS);
  const [incidents, setIncidents]   = useState(DEFAULT_INCIDENTS);
  const [timesheets, setTimesheets] = useState(DEFAULT_TIMESHEETS);
  const [upgrades, setUpgrades]     = useState(DEFAULT_UPGRADES);
  const [wiki, setWiki]             = useState(DEFAULT_WIKI);
  const [glossary, setGlossary]     = useState(DEFAULT_GLOSSARY);
  const [contacts, setContacts]     = useState(DEFAULT_CONTACTS);
  const [payconfig, setPayconfig]   = useState(DEFAULT_PAYCONFIG);
  const [rota, setRota]             = useState(() => generateRota(DEFAULT_USERS, '2026-03-30', 6));

  const isManager = currentUser === 'MBA47';

  // Connect Google Drive
  const connectDrive = async () => {
    try {
      await gapiLoad();
      const token = await initGoogleAuth(GOOGLE_CLIENT_ID);
      setDriveToken(token);
      // Load all data from Drive
      setSyncing(true);
      const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota };
      const data = await loadAllFromDrive(token, defaults);
      if (data.users)      setUsers(data.users);
      if (data.holidays)   setHolidays(data.holidays);
      if (data.incidents)  setIncidents(data.incidents);
      if (data.timesheets) setTimesheets(data.timesheets);
      if (data.upgrades)   setUpgrades(data.upgrades);
      if (data.wiki)       setWiki(data.wiki);
      if (data.glossary)   setGlossary(data.glossary);
      if (data.contacts)   setContacts(data.contacts);
      if (data.payconfig)  setPayconfig(data.payconfig);
      if (data.rota)       setRota(data.rota);
      setLastSync(new Date());
      setSyncing(false);
    } catch (e) {
      console.error('Drive connect error:', e);
      setSyncing(false);
    }
  };

  // Auto-save to Drive when state changes
  const save = useCallback(async (key, data) => {
    if (!driveToken) return;
    await driveWrite(driveToken, key, data);
    setLastSync(new Date());
  }, [driveToken]);

  useEffect(() => { save('users', users); },      [users]);
  useEffect(() => { save('holidays', holidays); }, [holidays]);
  useEffect(() => { save('incidents', incidents); }, [incidents]);
  useEffect(() => { save('timesheets', timesheets); }, [timesheets]);
  useEffect(() => { save('upgrades', upgrades); }, [upgrades]);
  useEffect(() => { save('wiki', wiki); },         [wiki]);
  useEffect(() => { save('glossary', glossary); }, [glossary]);
  useEffect(() => { save('contacts', contacts); }, [contacts]);
  useEffect(() => { save('payconfig', payconfig); }, [payconfig]);
  useEffect(() => { save('rota', rota); },         [rota]);

  const login = (uid) => { setCurrentUser(uid); setLoggedIn(true); setPage(uid === 'MBA47' ? 'dashboard' : 'oncall'); };

  if (!loggedIn) return <LoginScreen onLogin={login} driveToken={driveToken} onConnectDrive={connectDrive} />;

  const openInc = incidents.filter(i => i.status === 'Investigating').length;

  const renderPage = () => {
    if (page === 'dashboard' && !isManager) return <Alert type="warning">⚠ Dashboard is restricted to managers.</Alert>;
    const props = { users, rota, setRota, holidays, setHolidays, incidents, setIncidents, timesheets, setTimesheets, upgrades, setUpgrades, wiki, setWiki, glossary, setGlossary, contacts, setContacts, payconfig, setPayconfig, currentUser, isManager };
    switch (page) {
      case 'dashboard':  return <Dashboard {...props} />;
      case 'oncall':     return <OnCall {...props} />;
      case 'myshift':    return <MyShift {...props} />;
      case 'calendar':   return <CalendarView {...props} />;
      case 'rota':       return <RotaPage {...props} />;
      case 'incidents':  return <Incidents {...props} />;
      case 'timesheets': return <Timesheets {...props} />;
      case 'holidays':   return <Holidays {...props} />;
      case 'upgrades':   return <UpgradeDays {...props} />;
      case 'stress':     return <StressScore {...props} />;
      case 'wiki':       return <Wiki {...props} />;
      case 'glossary':   return <Glossary {...props} />;
      case 'contacts':   return <Contacts {...props} />;
      case 'insights':   return <Insights {...props} />;
      case 'reports':    return <WeeklyReports {...props} />;
      case 'payroll':    return <Payroll {...props} />;
      case 'payconfig':  return <PayConfig {...props} />;
      case 'settings':   return <Settings users={users} setUsers={setUsers} isManager={isManager} />;
      case 'myaccount':  return <MyAccount currentUser={currentUser} users={users} />;
      default: return <p className="muted-sm">Page coming soon</p>;
    }
  };

  const user = users.find(u => u.id === currentUser);
  const pageTitle = { dashboard: 'Dashboard', oncall: "Who's On Call", myshift: 'My Shift', calendar: 'Calendar', rota: 'Rota', incidents: 'Incidents', timesheets: 'Timesheets', holidays: 'Holidays', upgrades: 'Upgrade Days', stress: 'Stress Score', wiki: 'Wiki', glossary: 'Glossary', contacts: 'Contacts', insights: 'Insights', reports: 'Weekly Reports', payroll: 'Payroll', payconfig: 'Pay Config', settings: 'Settings', myaccount: 'My Account' }[page] || page;

  return (
    <div className="app">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="logo">
          <div className="logo-icon">CR</div>
          <div><div className="logo-text">CloudOps Rota</div><div className="logo-sub">Cloud Run Operations</div></div>
        </div>
        <div className="user-pill">
          <Avatar user={user || { avatar: '?', color: '#475569' }} />
          <div className="user-info">
            <div className="user-name">{user?.name?.split(' ')[0]} {user?.name?.split(' ')[1]?.[0]}.</div>
            <div className="user-role">{currentUser} · {user?.role}</div>
          </div>
        </div>
        {NAV.map(sec => (
          <div key={sec.section}>
            <div className="nav-section">{sec.section}</div>
            {sec.items.filter(i => !i.managerOnly || isManager).map(item => (
              <div key={item.id} className={`nav-item${page === item.id ? ' active' : ''}`} onClick={() => setPage(item.id)}>
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
                {item.badge && openInc > 0 && <span className="badge">{openInc}</span>}
              </div>
            ))}
          </div>
        ))}
        <div style={{ marginTop: 'auto', padding: 16, borderTop: '1px solid var(--border)' }}>
          {driveToken ? (
            <div className="gd-status">
              <div className="dot-live" />
              <span style={{ fontSize: 11 }}>Drive synced {lastSync && lastSync.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ) : (
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginBottom: 8 }} onClick={connectDrive}>
              📁 Connect Drive
            </button>
          )}
          {syncing && <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>Syncing…</div>}
          <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setLoggedIn(false)}>Sign Out</button>
        </div>
      </div>

      {/* Main content */}
      <div className="main">
        <div className="topbar">
          <div className="topbar-title">{pageTitle}</div>
          <input className="topbar-search" placeholder="Search…" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </div>
            <Avatar user={user || { avatar: '?', color: '#475569' }} size={30} />
          </div>
        </div>
        <div className="content">{renderPage()}</div>
      </div>
    </div>
  );
}
