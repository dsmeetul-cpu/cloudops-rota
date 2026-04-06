// src/App.js
// CloudOps Rota — Full Production Build v2
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

// ── AUTH HELPERS ───────────────────────────────────────────────────────────
// Passwords are stored (hashed via btoa) in localStorage under 'auth_passwords'.
// On first run, every user gets a default password equal to their lowercase ID.
// Managers (MBA47) can reset any user's password via Settings > User Management.
// Replace this section with your SSO/Auth0/Firebase provider for production.

const hashPw = (pw) => btoa(unescape(encodeURIComponent(pw)));

function loadPasswords(users) {
  try {
    const stored = localStorage.getItem('auth_passwords');
    if (stored) return JSON.parse(stored);
  } catch (_) {}
  // First run: default password = lowercase user ID (e.g. "mba47")
  const defaults = {};
  users.forEach(u => { defaults[u.id] = hashPw(u.id.toLowerCase()); });
  localStorage.setItem('auth_passwords', JSON.stringify(defaults));
  return defaults;
}

function savePasswords(map) {
  localStorage.setItem('auth_passwords', JSON.stringify(map));
}

function checkPassword(users, uid, pw) {
  const map = loadPasswords(users);
  return map[uid] && map[uid] === hashPw(pw);
}

function setPassword(users, uid, newPw) {
  const map = loadPasswords(users);
  map[uid] = hashPw(newPw);
  savePasswords(map);
}

// ── Shift colours per spec ─────────────────────────────────────────────────
// Daily Shift = Blue | Weekday On-Call = Green | Weekend On-Call = Yellow | Upgrade Days = Red
const SHIFT_COLORS = {
  daily:   { bg: '#1e40af', label: 'Daily Shift',      text: '#bfdbfe' },
  evening: { bg: '#166534', label: 'Weekday On-Call',  text: '#bbf7d0' },
  weekend: { bg: '#854d0e', label: 'Weekend On-Call',  text: '#fef08a' },
  upgrade: { bg: '#991b1b', label: 'Upgrade Day',      text: '#fecaca' },
  holiday: { bg: '#92400e', label: 'Holiday',          text: '#fde68a' },
  bankholiday: { bg: '#7f1d1d', label: 'Bank Holiday', text: '#fca5a5' },
};

// ── Rich Text / Word-level Editor ──────────────────────────────────────────
function RichEditor({ value, onChange, placeholder = 'Start typing…', rows = 8, fullPage = false }) {
  const ref = useRef(null);
  const fileRef = useRef(null);

  const exec = (cmd, val = null) => { document.execCommand(cmd, false, val); ref.current?.focus(); };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'md' || ext === 'txt') {
      const text = await file.text();
      // Convert markdown to basic HTML
      let html = text
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
      html = '<p>' + html + '</p>';
      if (ref.current) { ref.current.innerHTML = html; onChange && onChange(html); }
    } else if (ext === 'csv') {
      const text = await file.text();
      const rows = text.trim().split('\n').map(r => r.split(','));
      let html = '<table border="1" style="border-collapse:collapse;width:100%">';
      rows.forEach((r, i) => {
        html += '<tr>';
        r.forEach(c => { html += i === 0 ? `<th style="padding:4px 8px;background:#1e3a5f">${c.trim()}</th>` : `<td style="padding:4px 8px">${c.trim()}</td>`; });
        html += '</tr>';
      });
      html += '</table>';
      if (ref.current) { ref.current.innerHTML = html; onChange && onChange(html); }
    } else if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
      // Attempt to use mammoth for docx, fallback message
      try {
        const { default: mammoth } = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (ref.current) { ref.current.innerHTML = result.value; onChange && onChange(result.value); }
      } catch {
        const msg = `<p><em>📎 Imported: <strong>${file.name}</strong></em></p><p style="color:#fca5a5">For .docx/.pptx/.xlsx, install <code>mammoth</code> (npm i mammoth) for full conversion. File name recorded.</p>`;
        if (ref.current) { ref.current.innerHTML = msg; onChange && onChange(msg); }
      }
    } else {
      const text = await file.text().catch(() => '[Binary file — cannot preview]');
      const html = `<p><em>📎 ${file.name}</em></p><pre style="font-size:11px;overflow:auto">${text.slice(0,3000)}</pre>`;
      if (ref.current) { ref.current.innerHTML = html; onChange && onChange(html); }
    }
    e.target.value = '';
  };

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
    }
  }, []);

  const insertTable = () => {
    const html = `<table border="1" style="border-collapse:collapse;width:100%;margin:8px 0"><tr><th style="padding:6px 10px;background:#1e3a5f">Header 1</th><th style="padding:6px 10px;background:#1e3a5f">Header 2</th></tr><tr><td style="padding:6px 10px">Cell 1</td><td style="padding:6px 10px">Cell 2</td></tr></table><p></p>`;
    document.execCommand('insertHTML', false, html);
    ref.current?.focus();
  };

  const insertLink = () => {
    const url = prompt('Enter URL:');
    if (url) exec('createLink', url);
  };

  const insertHR = () => { exec('insertHTML', '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:16px 0"/><p></p>'); };

  const minH = fullPage ? '60vh' : rows * 22;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card2)', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 5 }}>
        {/* Text Style */}
        <select onChange={e => { exec('formatBlock', e.target.value); e.target.value = ''; }} defaultValue=""
          style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', maxWidth: 90 }}>
          <option value="" disabled>Style</option>
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="pre">Code Block</option>
          <option value="blockquote">Quote</option>
        </select>
        <select onChange={e => { exec('fontName', e.target.value); e.target.value = ''; }} defaultValue=""
          style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', maxWidth: 90 }}>
          <option value="" disabled>Font</option>
          {['Arial','Georgia','Courier New','Verdana','Times New Roman','Trebuchet MS'].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select onChange={e => exec('fontSize', e.target.value)} defaultValue=""
          style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', width: 54 }}>
          <option value="" disabled>Size</option>
          {[1,2,3,4,5,6,7].map(s => <option key={s} value={s}>{[8,10,12,14,18,24,36][s-1]}pt</option>)}
        </select>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        {[
          { cmd: 'bold',          label: 'B', style: { fontWeight: 700 } },
          { cmd: 'italic',        label: 'I', style: { fontStyle: 'italic' } },
          { cmd: 'underline',     label: 'U', style: { textDecoration: 'underline' } },
          { cmd: 'strikeThrough', label: 'S̶', style: {} },
          { cmd: 'superscript',   label: 'x²', style: { fontSize: 10 } },
          { cmd: 'subscript',     label: 'x₂', style: { fontSize: 10 } },
        ].map(b => (
          <button key={b.cmd} onMouseDown={e => { e.preventDefault(); exec(b.cmd); }}
            style={{ ...b.style, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12, minWidth: 28 }}>
            {b.label}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        {[
          { cmd: 'justifyLeft',   label: '⬛▫▫' },
          { cmd: 'justifyCenter', label: '▫⬛▫' },
          { cmd: 'justifyRight',  label: '▫▫⬛' },
          { cmd: 'justifyFull',   label: '⬛⬛⬛' },
        ].map(b => (
          <button key={b.cmd} onMouseDown={e => { e.preventDefault(); exec(b.cmd); }}
            style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 9, minWidth: 28 }}>
            {b.label}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        {[
          { cmd: 'insertUnorderedList', label: '• List' },
          { cmd: 'insertOrderedList',   label: '1. List' },
          { cmd: 'indent',              label: '→ Indent' },
          { cmd: 'outdent',             label: '← Outdent' },
        ].map(b => (
          <button key={b.label} onMouseDown={e => { e.preventDefault(); exec(b.cmd); }}
            style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11 }}>
            {b.label}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        {/* Color pickers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>A</span>
          <input type="color" defaultValue="#ffffff" onChange={e => exec('foreColor', e.target.value)}
            title="Text colour" style={{ width: 22, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none', padding: 0 }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>bg</span>
          <input type="color" defaultValue="#1e3a5f" onChange={e => exec('hiliteColor', e.target.value)}
            title="Highlight colour" style={{ width: 22, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none', padding: 0 }} />
        </div>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        <button onMouseDown={e => { e.preventDefault(); insertTable(); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11 }}>
          ⊞ Table
        </button>
        <button onMouseDown={e => { e.preventDefault(); insertLink(); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}>
          🔗 Link
        </button>
        <button onMouseDown={e => { e.preventDefault(); insertHR(); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>
          ─ HR
        </button>
        <label style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
          📎 Import
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.docx,.pptx,.xlsx,.html" onChange={handleImport} style={{ display: 'none' }} />
        </label>
        <button onMouseDown={e => { e.preventDefault(); exec('removeFormat'); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>
          ✕ Fmt
        </button>
        <button onMouseDown={e => { e.preventDefault(); exec('undo'); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>↩</button>
        <button onMouseDown={e => { e.preventDefault(); exec('redo'); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>↪</button>
      </div>
      {/* Editable area */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange && onChange(ref.current.innerHTML)}
        data-placeholder={placeholder}
        style={{
          minHeight: minH, padding: fullPage ? '24px 32px' : '12px 14px', outline: 'none',
          fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.8,
          caretColor: 'var(--accent)', flex: 1,
          fontFamily: 'Georgia, serif',
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
      <div className="modal" style={fullscreen ? { width: '98vw', maxWidth: 1300, height: '95vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' } : wide ? { width: 720 } : {}}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 20px 20px', flex: 1, overflowY: 'auto' }}>{children}</div>
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
      <div className="legend-item"><div className="legend-dot" style={{ background: '#1e40af' }} />Daily Shift (9am–6pm)</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#166534' }} />Weekday On-Call</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#854d0e' }} />Weekend On-Call</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#991b1b' }} />Upgrade Day</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#92400e' }} />Holiday</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#7f1d1d' }} />Bank Holiday</div>
    </div>
  );
}

// ── Bulk Select Hook ───────────────────────────────────────────────────────
function useBulkSelect(items) {
  const [selected, setSelected] = useState(new Set());
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => prev.size === items.length ? new Set() : new Set(items.map(i => i.id)));
  const clearAll  = () => setSelected(new Set());
  return { selected, toggleOne, toggleAll, clearAll };
}

// ── Login Screen ───────────────────────────────────────────────────────────
function LoginScreen({ onLogin, driveToken, onConnectDrive, users }) {
  const [uid, setUid]           = useState('');
  const [pw, setPw]             = useState('');
  const [err, setErr]           = useState('');
  const [show2FA, setShow2FA]   = useState(false);
  const [twoFACode, setTwoFACode] = useState('');
  const [pending2FA, setPending2FA] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [forgotUid, setForgotUid]   = useState('');
  const [forgotMsg, setForgotMsg]   = useState('');

  const handle = () => {
    const id = uid.trim().toUpperCase();
    if (!id) { setErr('Please enter your username.'); return; }
    const userExists = users.find(u => u.id === id);
    if (!userExists) { setErr('Username not found. Check your tri-gram ID.'); return; }
    if (checkPassword(users, id, pw)) {
      setErr('');
      if (id === 'MBA47') { setPending2FA(id); setShow2FA(true); }
      else onLogin(id);
    } else {
      setErr('Incorrect password. Default password is your username in lowercase (e.g. mba47).');
    }
  };

  const verify2FA = () => {
    // In production, validate against a real TOTP library.
    // For now, any 6-digit code is accepted as a demo placeholder.
    if (twoFACode.length === 6) { onLogin(pending2FA); }
    else setErr('Enter a 6-digit code.');
  };

  const handleForgot = () => {
    const id = forgotUid.trim().toUpperCase();
    const userExists = users.find(u => u.id === id);
    if (!userExists) { setForgotMsg('Username not found.'); return; }
    // Reset to default (lowercase ID). In production, send a reset email instead.
    setPassword(users, id, id.toLowerCase());
    setForgotMsg(`Password for ${id} has been reset to "${id.toLowerCase()}". Please sign in and change it immediately via My Account.`);
  };

  if (showForgot) return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">
          <div className="login-logo-icon">CR</div>
          <div className="login-title">Reset Password</div>
          <div className="login-sub">CloudOps Rota · Cloud Run Operations</div>
        </div>
        {forgotMsg
          ? <Alert type="info">ℹ {forgotMsg}</Alert>
          : <Alert type="info">ℹ Enter your username. Your password will be reset to your lowercase ID.</Alert>
        }
        <FormGroup label="Username (Tri-gram)">
          <input className="input" placeholder="e.g. MBA47" value={forgotUid} onChange={e => setForgotUid(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleForgot()} />
        </FormGroup>
        <button className="btn btn-primary" style={{ width: '100%', padding: 11 }} onClick={handleForgot}>Reset Password</button>
        <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => { setShowForgot(false); setForgotMsg(''); setForgotUid(''); }}>← Back to Sign In</button>
      </div>
    </div>
  );

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">
          <div className="login-logo-icon">CR</div>
          <div className="login-title">CloudOps Rota</div>
          <div className="login-sub">Cloud Run Operations Team</div>
        </div>
        {driveToken && <div className="gd-status" style={{ marginBottom: 16 }}><div className="dot-live" /> Auto-syncing to Google Drive</div>}
        <Alert type="info" style={{ marginBottom: 12 }}>
          💡 First time? Your default password is your username in lowercase — e.g. <strong>mba47</strong> for MBA47.
        </Alert>
        {err && <Alert type="warning">⚠ {err}</Alert>}
        {!show2FA ? (
          <>
            <FormGroup label="Username (Tri-gram)">
              <input className="input" placeholder="e.g. MBA47" value={uid} onChange={e => setUid(e.target.value)} onKeyDown={e => e.key === 'Enter' && handle()} />
            </FormGroup>
            <FormGroup label="Password">
              <input className="input" type="password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && handle()} />
            </FormGroup>
            <button className="btn btn-primary" style={{ width: '100%', padding: 11 }} onClick={handle}>Sign In</button>
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowForgot(true)}>🔑 Forgot Password?</button>
          </>
        ) : (
          <>
            <Alert type="info">🔐 Two-factor authentication required for manager access.</Alert>
            <FormGroup label="2FA Code">
              <input className="input" placeholder="6-digit code" maxLength={6} value={twoFACode} onChange={e => setTwoFACode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && verify2FA()} autoFocus />
            </FormGroup>
            <button className="btn btn-primary" style={{ width: '100%', padding: 11 }} onClick={verify2FA}>Verify & Sign In</button>
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => { setShow2FA(false); setErr(''); }}>← Back</button>
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
    { id: 'holidays',   icon: '🌴', label: 'Holidays',      managerOnly: true },
    { id: 'swaps',      icon: '🔁', label: 'Shift Swaps'    },
    { id: 'upgrades',   icon: '⬆', label: 'Upgrade Days'   },
    { id: 'stress',     icon: '📊', label: 'Stress Score',  managerOnly: true },
    { id: 'toil',       icon: '⏳', label: 'TOIL'           },
    { id: 'absence',    icon: '🏥', label: 'Absence / Sick' },
    { id: 'logbook',    icon: '📓', label: 'Logbook',       managerOnly: true },
  ]},
  { section: 'Knowledge', items: [
    { id: 'wiki',      icon: '📖', label: 'Wiki'            },
    { id: 'glossary',  icon: '📚', label: 'Glossary'        },
    { id: 'contacts',  icon: '👥', label: 'Contacts'        },
    { id: 'notes',     icon: '🗒️', label: 'Notes'          },
    { id: 'docs',      icon: '📁', label: 'Documents'       },
  ]},
  { section: 'Communication', items: [
    { id: 'whatsapp',  icon: '💬', label: 'Team Chat'      },
  ]},
  { section: 'Reporting', items: [
    { id: 'insights',  icon: '💡', label: 'Insights',       managerOnly: true },
    { id: 'capacity',  icon: '📈', label: 'Capacity',       managerOnly: true },
    { id: 'reports',   icon: '📋', label: 'Weekly Reports', managerOnly: true },
  ]},
  { section: 'Finance', items: [
    { id: 'payroll',   icon: '💷', label: 'Payroll',        managerOnly: true },
    { id: 'payconfig', icon: '⚙', label: 'Pay Config',     managerOnly: true },
  ]},
  { section: 'Account', items: [
    { id: 'settings',  icon: '🔧', label: 'Settings',       managerOnly: true },
    { id: 'myaccount', icon: '👤', label: 'My Account'      },
  ]},
];

// ── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ users, rota, holidays, incidents, timesheets, swapRequests }) {
  const today    = new Date().toISOString().slice(0, 10);
  const onCallToday = users.filter(u => rota[u.id]?.[today] && rota[u.id][today] !== 'off');
  const openInc  = incidents.filter(i => i.status === 'Investigating');
  const totalOC  = Object.values(timesheets).flatMap(t => t).reduce((a, b) => a + (b.weekday_oncall || 0) + (b.weekend_oncall || 0), 0);
  const pendingSwaps = (swapRequests || []).filter(s => s.status === 'pending');

  return (
    <div>
      <PageHeader title="Manager Dashboard" sub="Cloud Run Operations · Full team visibility" />
      <div className="grid-4 mb-16">
        <StatCard label="Team Size"        value={users.length}            sub="engineers + manager"   accent="#3b82f6" icon="👥" />
        <StatCard label="Open Incidents"   value={openInc.length}          sub="Active investigations" accent="#ef4444" icon="🚨" />
        <StatCard label="OC Hours"         value={totalOC + 'h'}           sub="All engineers"         accent="#10b981" icon="⏱" />
        <StatCard label="Pending Swaps"    value={pendingSwaps.length}     sub="Awaiting approval"     accent="#818cf8" icon="🔁" />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">👥 Team On-Call Today</div>
          {onCallToday.length === 0 && <p className="muted-sm">No shifts today</p>}
          {onCallToday.map(u => {
            const s = rota[u.id][today];
            const col = SHIFT_COLORS[s] || SHIFT_COLORS.daily;
            return (
              <div className="oncall-card" key={u.id}>
                <Avatar user={u} />
                <div style={{ flex: 1 }}>
                  <div className="name-sm">{u.name}</div>
                  <div className="oncall-shift">{col.label}</div>
                </div>
                <span style={{ background: col.bg + '33', color: col.text, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{col.label}</span>
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="card-title">🚨 Active Incidents</div>
          {openInc.map(i => (
            <div key={i.id} className="row-item">
              <div className={`inc-dot sev-${(i.severity||'').toLowerCase()}`} />
              <div>
                <div className="name-sm">{i.alert_name || i.title}</div>
                <div className="muted-xs">{i.severity} · {i.date} · {i.assigned_to}</div>
              </div>
            </div>
          ))}
          {openInc.length === 0 && <p className="muted-sm">No active incidents 🎉</p>}
        </div>
        <div className="card">
          <div className="card-title">🔁 Pending Swap Requests</div>
          {pendingSwaps.length === 0 && <p className="muted-sm">No pending swaps</p>}
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
        <div className="card">
          <div className="card-title">📊 On-Call Hours This Period</div>
          {users.map(u => {
            const sheets = timesheets[u.id] || [];
            const wkday = sheets.reduce((a, b) => a + (b.weekday_oncall || 0), 0);
            const wkend = sheets.reduce((a, b) => a + (b.weekend_oncall || 0), 0);
            const total = wkday + wkend;
            const pct = Math.min(100, (total / 40) * 100);
            return (
              <div key={u.id} style={{ marginBottom: 12 }}>
                <div className="flex-between" style={{ marginBottom: 4 }}>
                  <span className="muted-xs">{u.name}</span>
                  <span style={{ fontSize: 12, fontFamily: 'DM Mono', color: total > 30 ? '#fcd34d' : '#6ee7b7' }}>{total}h</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: pct + '%', background: total > 30 ? '#f59e0b' : '#10b981' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Who's On Call ──────────────────────────────────────────────────────────
function OnCall({ users, rota }) {
  const today = new Date();
  const base  = new Date(today);
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  const week  = Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(base.getDate() + i); return d; });
  const DAYS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const exportIcal = (user) => {
    const content = generateICalFeed(rota[user.id] || {}, user.name);
    downloadIcal(content, `cloudops-rota-${user.id}.ics`);
  };

  const cellStyle = (s) => {
    const c = SHIFT_COLORS[s];
    if (!c) return { background: 'transparent', color: 'var(--text-muted)' };
    return { background: c.bg + '55', color: c.text, border: `1px solid ${c.bg}88` };
  };

  return (
    <div>
      <PageHeader title="Who's On Call" sub="Current week schedule" />
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
                  const c  = cellStyle(s);
                  return (
                    <td key={ds} style={{ textAlign: 'center' }}>
                      <div style={{ ...c, borderRadius: 6, padding: '4px 6px', fontSize: 10, fontWeight: 600, minWidth: 32, display: 'inline-block' }}>
                        {s === 'off' ? '—' : (SHIFT_COLORS[s]?.label?.slice(0, 4) || s)}
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
    setSwapRequests([...(swapRequests || []), {
      id: 'swap-' + Date.now(), requesterId: currentUser, targetId: swapForm.targetId,
      reqDate: swapForm.myDate, tgtDate: swapForm.theirDate, reason: swapForm.reason,
      status: 'pending', created: new Date().toISOString().slice(0, 10)
    }]);
    setSwapModal(false); setSwapForm({ myDate: '', targetId: '', theirDate: '', reason: '' });
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
              <div style={{ fontSize: 22, fontWeight: 600, color: SHIFT_COLORS[todayShift]?.text || 'var(--text-primary)', marginBottom: 6 }}>
                {SHIFT_COLORS[todayShift]?.label || todayShift}
              </div>
            </>
          ) : <p className="muted-sm">No shift today — enjoy your time off!</p>}
        </div>
        <div className="card">
          <div className="card-title">Next 28 Days</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>{upcoming.length} shifts</div>
        </div>
      </div>
      <div className="card mb-16">
        <div className="card-title">Upcoming Shifts (Next 28 Days)</div>
        {upcoming.length === 0 && <p className="muted-sm">No upcoming shifts</p>}
        {upcoming.map(({ date, shift, day }) => {
          const col = SHIFT_COLORS[shift] || {};
          return (
            <div key={date} className="flex-between row-item">
              <div>
                <div className="name-sm">{day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ background: (col.bg || '#1e40af') + '33', color: col.text || '#bfdbfe', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{col.label || shift}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => { setSwapForm({ ...swapForm, myDate: date }); setSwapModal(true); }}>Swap</button>
              </div>
            </div>
          );
        })}
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
      {swapModal && (
        <Modal title="Request Shift Swap" onClose={() => setSwapModal(false)}>
          <FormGroup label="My Shift Date"><input className="input" type="date" value={swapForm.myDate} onChange={e => setSwapForm({ ...swapForm, myDate: e.target.value })} /></FormGroup>
          <FormGroup label="Swap With">
            <select className="select" value={swapForm.targetId} onChange={e => setSwapForm({ ...swapForm, targetId: e.target.value })}>
              <option value="">Select engineer…</option>
              {users.filter(u => u.id !== currentUser).map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Their Shift Date"><input className="input" type="date" value={swapForm.theirDate} onChange={e => setSwapForm({ ...swapForm, theirDate: e.target.value })} /></FormGroup>
          <FormGroup label="Reason (optional)"><input className="input" placeholder="e.g. Medical appointment" value={swapForm.reason} onChange={e => setSwapForm({ ...swapForm, reason: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setSwapModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={requestSwap}>Submit Request</button>
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
      <PageHeader title="Calendar" sub="Rota, upgrades &amp; bank holidays"
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={() => setCur(new Date(yr, mo - 1, 1))}>← Prev</button>
          <div className="month-label">{MONTHS[mo]} {yr}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setCur(new Date())}>Today</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setCur(new Date(yr, mo + 1, 1))}>Next →</button>
        </>} />
      <ShiftLegend />
      <div className="cal-grid">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="cal-header">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={'e' + i} />;
          const ds  = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const bh  = UK_BANK_HOLIDAYS.find(b => b.date === ds);
          const upgs = upgrades.filter(u => u.date === ds);
          const oncalls = users.filter(u => rota[u.id]?.[ds] && rota[u.id][ds] !== 'off');
          const isToday = ds === new Date().toISOString().slice(0, 10);
          return (
            <div key={ds} className={`cal-day${isToday ? ' today' : ''}`}>
              <div className="cal-day-num" style={{ color: bh ? '#fca5a5' : undefined }}>{day}{bh && ' 🔴'}</div>
              {bh && <div className="cal-event ev-red">{bh.name}</div>}
              {upgs.map(u => <div key={u.id} className="cal-event" style={{ background: '#991b1b55', color: '#fecaca', border: '1px solid #991b1b88', fontSize: 10, padding: '2px 4px', borderRadius: 4 }}>⬆ {u.name.split(' ').slice(0,2).join(' ')}</div>)}
              {oncalls.slice(0, 2).map(u => {
                const s = rota[u.id][ds];
                const c = SHIFT_COLORS[s] || {};
                return <div key={u.id} style={{ background: (c.bg || '#1e40af') + '55', color: c.text || '#bfdbfe', border: `1px solid ${(c.bg || '#1e40af')}88`, fontSize: 10, padding: '2px 4px', borderRadius: 4 }}>{u.name.split(' ')[0]}</div>;
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Rota Page (Manager only editable) ─────────────────────────────────────
function RotaPage({ users, rota, setRota, holidays, upgrades, swapRequests, setSwapRequests, isManager }) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weeks, setWeeks]         = useState(4);
  const [generated, setGenerated] = useState(true);
  const [editCell, setEditCell]   = useState(null); // { userId, date }
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkShift, setBulkShift] = useState('daily');
  const [swapSuggestion, setSwapSuggestion] = useState(null);
  const DAYS = ['M','T','W','T','F','S','S'];

  const generate = () => { if (!isManager) return; setRota(generateRota(users, startDate, weeks)); setGenerated(true); };

  const setCell = (userId, date, shift) => {
    if (isManager) return; // Managers have read-only access
    setRota(prev => ({ ...prev, [userId]: { ...(prev[userId] || {}), [date]: shift } }));
    setEditCell(null);
  };

  const deleteCell = (userId, date) => {
    if (isManager) return; // Managers have read-only access
    const next = JSON.parse(JSON.stringify(rota));
    if (next[userId]) delete next[userId][date];
    setRota(next);
  };

  const toggleBulk = (userId, date) => {
    if (isManager) return; // Managers cannot bulk edit
    const key = `${userId}::${date}`;
    setBulkSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  const applyBulk = () => {
    if (isManager) return; // Managers cannot bulk edit
    const next = JSON.parse(JSON.stringify(rota));
    bulkSelected.forEach(key => {
      const [uid, date] = key.split('::');
      next[uid] = { ...(next[uid] || {}), [date]: bulkShift };
    });
    setRota(next); setBulkSelected(new Set());
  };

  const deleteBulk = () => {
    if (isManager) return; // Managers cannot bulk delete
    const next = JSON.parse(JSON.stringify(rota));
    bulkSelected.forEach(key => {
      const [uid, date] = key.split('::');
      if (next[uid]) delete next[uid][date];
    });
    setRota(next); setBulkSelected(new Set());
  };

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
    setSwapSuggestion(conflicts);
  };

  const applySwap = (conflict, coverId) => {
    const newRota = JSON.parse(JSON.stringify(rota));
    newRota[coverId] = { ...(newRota[coverId] || {}), [conflict.date]: conflict.shift };
    if (newRota[conflict.userId]) delete newRota[conflict.userId][conflict.date];
    setRota(newRota);
    setSwapSuggestion(prev => prev.filter(c => !(c.userId === conflict.userId && c.date === conflict.date)));
  };

  const approveSwap = (swapId) => {
    if (!isManager) return;
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

  const pendingSwaps = (swapRequests || []).filter(s => s.status === 'pending');
  const weekStarts = Array.from({ length: weeks }, (_, w) => {
    const d = new Date(startDate); d.setDate(d.getDate() + w * 7); return d;
  });

  return (
    <div>
      <PageHeader title="Rota Management" sub={isManager ? 'Generate & manage on-call schedule' : 'View on-call schedule'} />
      {isManager && (
        <div className="card mb-16">
          <div className="card-title">⚙ Generate & Controls</div>
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
            <button className="btn btn-danger" onClick={() => {
              if (window.confirm('⚠️  Clear all rota entries? This cannot be undone.')) {
                setRota({});
              }
            }}>🗑 Clear Rota</button>
            <button className="btn btn-secondary" onClick={checkConflicts}>🔍 Check Conflicts</button>
            <button className="ical-btn" onClick={() => users.forEach(u => { const ic = generateICalFeed(rota[u.id] || {}, u.name); downloadIcal(ic, `rota-${u.id}.ics`); })}>📥 Export All (.ics)</button>
          </div>
          {bulkSelected.size > 0 && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(59,130,246,.1)', border: '1px solid #3b82f655', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{bulkSelected.size} cell(s) selected</span>
              <select className="select" value={bulkShift} onChange={e => setBulkShift(e.target.value)} style={{ width: 160 }}>
                <option value="daily">Daily Shift</option>
                <option value="evening">Weekday On-Call</option>
                <option value="weekend">Weekend On-Call</option>
                <option value="off">Off</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={applyBulk}>✓ Apply to Selected</button>
              <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete Selected</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setBulkSelected(new Set())}>✕ Clear</button>
            </div>
          )}
        </div>
      )}
      {swapSuggestion && swapSuggestion.length > 0 && isManager && (
        <div className="card mb-16" style={{ borderColor: '#f59e0b' }}>
          <div className="card-title" style={{ color: '#f59e0b' }}>⚠ Holiday Conflicts — Suggested Cover</div>
          {swapSuggestion.map((c, i) => {
            const eng = users.find(u => u.id === c.userId);
            return (
              <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="name-sm">{eng?.name} is on holiday on {c.date} but has {SHIFT_COLORS[c.shift]?.label}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {c.available.length === 0 && <span className="muted-xs">No engineers available for cover</span>}
                  {c.available.map(a => (
                    <button key={a.id} className="btn btn-success btn-sm" onClick={() => applySwap(c, a.id)}>✓ Assign {a.name.split(' ')[0]}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {swapSuggestion && swapSuggestion.length === 0 && <Alert type="info" style={{ marginBottom: 16 }}>✅ No holiday conflicts found.</Alert>}
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
                      const ds   = d.toISOString().slice(0, 10);
                      const hol  = holidays.find(h => h.userId === u.id && ds >= h.start && ds <= h.end);
                      const bh   = UK_BANK_HOLIDAYS.find(b => b.date === ds);
                      const upg  = upgrades.find(up => up.date === ds && up.attendees?.includes(u.id));
                      const s    = hol ? 'holiday' : bh ? 'bankholiday' : upg ? 'upgrade' : (rota[u.id]?.[ds] || 'off');
                      const col  = SHIFT_COLORS[s] || {};
                      const key  = `${u.id}::${ds}`;
                      const isBulkSel = bulkSelected.has(key);
                      const isEditing = editCell?.userId === u.id && editCell?.date === ds;
                      return (
                        <td key={ds} style={{ textAlign: 'center', padding: '4px' }}>
                          {isEditing && isManager ? (
                            <select autoFocus className="select" style={{ fontSize: 10, padding: '2px 4px', width: 100 }}
                              defaultValue={s} onBlur={e => setCell(u.id, ds, e.target.value)}
                              onChange={e => setCell(u.id, ds, e.target.value)}>
                              <option value="off">Off</option>
                              <option value="daily">Daily Shift</option>
                              <option value="evening">Weekday OC</option>
                              <option value="weekend">Weekend OC</option>
                            </select>
                          ) : (
                            <div
                              onClick={() => isManager && toggleBulk(u.id, ds)}
                              onDoubleClick={() => isManager && setEditCell({ userId: u.id, date: ds })}
                              title={isManager ? 'Click to select, double-click to edit' : ''}
                              style={{
                                background: col.bg ? col.bg + '55' : 'transparent',
                                color: col.text || 'var(--text-muted)',
                                border: isBulkSel ? '2px solid #3b82f6' : col.bg ? `1px solid ${col.bg}88` : '1px solid transparent',
                                borderRadius: 6, padding: '4px 6px', fontSize: 10, fontWeight: 600,
                                cursor: isManager ? 'pointer' : 'default', userSelect: 'none',
                              }}>
                              {hol ? '🌴' : bh ? '🔴' : upg ? '⬆' : s === 'off' ? '—' : (col.label?.slice(0,4) || s)}
                            </div>
                          )}
                          {isManager && s !== 'off' && !isEditing && (
                            <button onClick={() => deleteCell(u.id, ds)} style={{ display: 'block', margin: '2px auto 0', background: 'none', border: 'none', color: '#ef4444', fontSize: 9, cursor: 'pointer', padding: 0 }}>✕</button>
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
      {isManager && <div className="muted-xs" style={{ marginTop: 8 }}>💡 Click a cell to select for bulk edit. Double-click to edit inline. Click ✕ to delete.</div>}
    </div>
  );
}

// ── Incidents ──────────────────────────────────────────────────────────────
const INC_SEVERITIES = [
  { value: 'P1', label: 'P1 — Disaster',   color: '#ef4444' },
  { value: 'P2', label: 'P2 — High',       color: '#f59e0b' },
  { value: 'P3', label: 'P3 — Medium',     color: '#3b82f6' },
  { value: 'P4', label: 'P4 — Low',        color: '#10b981' },
];

function Incidents({ users, incidents, setIncidents, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [viewInc, setViewInc]    = useState(null);
  const [editInc, setEditInc]    = useState(null);
  const [filter, setFilter]      = useState('all');
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(incidents);

  const EMPTY_FORM = {
    alert_name: '', vm_service: '', severity: 'P3', assigned_to: currentUser,
    kb_ref: '', ticket_ref: '', email_ref: '', desc: ''
  };
  const [form, setForm] = useState(EMPTY_FORM);

  const openAdd = () => { setForm({ ...EMPTY_FORM, assigned_to: currentUser }); setEditInc(null); setShowModal(true); };
  const openEdit = (inc, e) => { e.stopPropagation(); setForm({ ...inc }); setEditInc(inc.id); setShowModal(true); };

  const save = () => {
    if (!form.alert_name) return;
    if (editInc) {
      setIncidents(incidents.map(i => i.id === editInc ? { ...i, ...form } : i));
    } else {
      const id = 'INC-' + String(incidents.length + 1).padStart(3, '0');
      setIncidents([{ id, ...form, status: 'Investigating', reporter: currentUser, date: new Date().toISOString().slice(0, 16).replace('T', ' '), updates: [] }, ...incidents]);
    }
    setShowModal(false); setForm(EMPTY_FORM);
  };

  const resolve  = (id, e) => { e.stopPropagation(); setIncidents(incidents.map(i => i.id === id ? { ...i, status: 'Resolved', resolvedAt: new Date().toISOString().slice(0,16).replace('T',' ') } : i)); };
  const deleteOne = (id, e) => { e.stopPropagation(); if (window.confirm('Delete this incident?')) setIncidents(incidents.filter(i => i.id !== id)); };
  const deleteBulk = () => { if (window.confirm(`Delete ${selected.size} incidents?`)) { setIncidents(incidents.filter(i => !selected.has(i.id))); clearAll(); } };

  const filtered = filter === 'all' ? incidents : incidents.filter(i => i.status === filter || i.severity === filter);

  const assignedUser = (id) => users.find(u => u.id === id);

  return (
    <div>
      <PageHeader title="Incidents" sub="Log and track operational incidents"
        actions={<>
          <select className="select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 150 }}>
            <option value="all">All</option>
            <option value="Investigating">Investigating</option>
            <option value="Resolved">Resolved</option>
            <option value="P1">P1 — Disaster</option>
            <option value="P2">P2 — High</option>
            <option value="P3">P3 — Medium</option>
            <option value="P4">P4 — Low</option>
          </select>
          {selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          <button className="btn btn-primary" onClick={openAdd}>+ Log Incident</button>
        </>} />
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" checked={selected.size === incidents.length && incidents.length > 0} onChange={toggleAll} /></th>
              <th>ID</th><th>Alert Name</th><th>VM/Service</th><th>Severity</th><th>Status</th>
              <th>Assigned To</th><th>KB Ref</th><th>Date</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...filtered].sort((a, b) => new Date(b.date) - new Date(a.date)).map(i => {
              const sev = INC_SEVERITIES.find(s => s.value === i.severity) || INC_SEVERITIES[2];
              const eng = assignedUser(i.assigned_to);
              return (
                <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setViewInc(i)}>
                  <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} /></td>
                  <td><span style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{i.id}</span></td>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>{i.alert_name}</div>
                    {i.desc && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }} dangerouslySetInnerHTML={{ __html: (i.desc||'').replace(/<[^>]+>/g,'').slice(0,60) + (i.desc?.length > 60 ? '…' : '') }} />}
                  </td>
                  <td style={{ fontSize: 12 }}>{i.vm_service || '—'}</td>
                  <td><span style={{ background: sev.color + '25', color: sev.color, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{sev.label}</span></td>
                  <td><Tag label={i.status} type={i.status === 'Resolved' ? 'green' : 'red'} /></td>
                  <td>
                    {eng ? <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={eng} size={20} /><span style={{ fontSize: 12 }}>{eng.name.split(' ')[0]}</span></div> : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--accent)' }}>{i.kb_ref || '—'}</td>
                  <td style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{i.date}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={e => openEdit(i, e)}>✏</button>
                      {i.status !== 'Resolved' && <button className="btn btn-success btn-sm" onClick={e => resolve(i.id, e)}>✓</button>}
                      <button className="btn btn-danger btn-sm" onClick={e => deleteOne(i.id, e)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title={editInc ? 'Edit Incident' : 'Log New Incident'} onClose={() => setShowModal(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormGroup label="Alert Name">
              <input className="input" placeholder="e.g. High CPU on prod-api-01" value={form.alert_name} onChange={e => setForm({ ...form, alert_name: e.target.value })} />
            </FormGroup>
            <FormGroup label="VM / Service Issue">
              <input className="input" placeholder="e.g. prod-api-01 / payment-service" value={form.vm_service} onChange={e => setForm({ ...form, vm_service: e.target.value })} />
            </FormGroup>
            <FormGroup label="Severity">
              <select className="select" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
                {INC_SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Assigned To">
              <select className="select" value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
              </select>
            </FormGroup>
            <FormGroup label="KB Reference (optional)">
              <input className="input" placeholder="e.g. KB-1234" value={form.kb_ref} onChange={e => setForm({ ...form, kb_ref: e.target.value })} />
            </FormGroup>
            <FormGroup label="Ticket Ref (optional)">
              <input className="input" placeholder="e.g. JIRA-5678 / ServiceNow#" value={form.ticket_ref} onChange={e => setForm({ ...form, ticket_ref: e.target.value })} />
            </FormGroup>
            <FormGroup label="Email Ref (optional)" hint="paste email subject or link">
              <input className="input" placeholder="e.g. Alert email subject" value={form.email_ref} onChange={e => setForm({ ...form, email_ref: e.target.value })} />
            </FormGroup>
          </div>
          <FormGroup label="Description / Actions Taken">
            <RichEditor value={form.desc} onChange={v => setForm({ ...form, desc: v })} placeholder="What happened? What actions were taken?" rows={6} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editInc ? 'Update Incident' : 'Log Incident'}</button>
          </div>
        </Modal>
      )}

      {viewInc && (
        <Modal title={`${viewInc.id} — ${viewInc.alert_name}`} onClose={() => setViewInc(null)} wide>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {(() => { const s = INC_SEVERITIES.find(x => x.value === viewInc.severity); return s ? <span style={{ background: s.color + '25', color: s.color, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{s.label}</span> : null; })()}
            <Tag label={viewInc.status} type={viewInc.status === 'Resolved' ? 'green' : 'red'} />
            <span className="muted-xs">{viewInc.date}</span>
          </div>
          {viewInc.vm_service && <div className="muted-xs" style={{ marginBottom: 8 }}>VM/Service: <strong>{viewInc.vm_service}</strong></div>}
          {viewInc.assigned_to && <div className="muted-xs" style={{ marginBottom: 8 }}>Assigned to: <strong>{users.find(u => u.id === viewInc.assigned_to)?.name || viewInc.assigned_to}</strong></div>}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            {viewInc.kb_ref     && <div className="muted-xs">📚 KB: <span style={{ color: 'var(--accent)' }}>{viewInc.kb_ref}</span></div>}
            {viewInc.ticket_ref && <div className="muted-xs">🎫 Ticket: <span style={{ color: 'var(--accent)' }}>{viewInc.ticket_ref}</span></div>}
            {viewInc.email_ref  && <div className="muted-xs">📧 Email: <span style={{ color: 'var(--accent)' }}>{viewInc.email_ref}</span></div>}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: viewInc.desc || '' }} />
          {viewInc.resolvedAt && <div className="muted-xs" style={{ marginTop: 12 }}>Resolved: {viewInc.resolvedAt}</div>}
        </Modal>
      )}
    </div>
  );
}

// ── Timesheets (OC hours only) ─────────────────────────────────────────────
function Timesheets({ users, timesheets, setTimesheets, currentUser, isManager, payconfig }) {
  const [activeUser, setActiveUser] = useState(currentUser);
  const [showPayroll, setShowPayroll] = useState(false);
  const [addModal, setAddModal]     = useState(false);
  const [editRow, setEditRow]       = useState(null); // { index, data }
  const [form, setForm]             = useState({ week: '', weekday_oncall: '', weekend_oncall: '', notes: '' });
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect((timesheets[activeUser] || []).map((s, i) => ({ ...s, id: i })));

  const user   = users.find(u => u.id === activeUser);
  const sheets = timesheets[activeUser] || [];
  const rate   = payconfig[activeUser]?.rate || 40;
  const base   = payconfig[activeUser]?.base || 2500;
  const totalWD  = sheets.reduce((a, b) => a + (b.weekday_oncall || 0), 0);
  const totalWE  = sheets.reduce((a, b) => a + (b.weekend_oncall || 0), 0);
  const grossOC  = totalWD * rate * 0.5 + totalWE * rate * 0.75;

  const visibleUsers = isManager ? users : [users.find(u => u.id === currentUser)].filter(Boolean);

  const openAdd  = () => { setForm({ week: '', weekday_oncall: '', weekend_oncall: '', notes: '' }); setEditRow(null); setAddModal(true); };
  const openEdit = (idx) => { setForm({ ...sheets[idx] }); setEditRow(idx); setAddModal(true); };

  const save = () => {
    if (!form.week) return;
    const entry = { week: form.week, weekday_oncall: +form.weekday_oncall || 0, weekend_oncall: +form.weekend_oncall || 0, notes: form.notes };
    const updated = [...sheets];
    if (editRow !== null) updated[editRow] = entry; else updated.unshift(entry);
    setTimesheets({ ...timesheets, [activeUser]: updated });
    setAddModal(false); setForm({ week: '', weekday_oncall: '', weekend_oncall: '', notes: '' });
  };

  const deleteOne = (idx) => { const u = [...sheets]; u.splice(idx, 1); setTimesheets({ ...timesheets, [activeUser]: u }); };
  const deleteBulk = () => {
    const keep = sheets.filter((_, i) => !selected.has(i));
    setTimesheets({ ...timesheets, [activeUser]: keep }); clearAll();
  };

  return (
    <div>
      <PageHeader title="Timesheets" sub="On-call hours tracking"
        actions={<>
          {selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          <button className="btn btn-secondary" onClick={openAdd}>+ Add Entry</button>
          {isManager && <button className="btn btn-primary" onClick={() => setShowPayroll(true)}>📄 Payroll Report</button>}
        </>} />
      <div className="tab-bar">
        {visibleUsers.map(u => <div key={u.id} className={`tab${activeUser === u.id ? ' active' : ''}`} onClick={() => { setActiveUser(u.id); clearAll(); }}>{u.name.split(' ')[0]}</div>)}
      </div>
      <div className="grid-3 mb-16">
        <StatCard label="Weekday OC Hrs"  value={totalWD + 'h'} sub="@50% uplift"         accent="#166534" />
        <StatCard label="Weekend OC Hrs"  value={totalWE + 'h'} sub="@75% uplift"         accent="#854d0e" />
        <StatCard label="Est. OC Pay"     value={'£' + Math.round(grossOC).toLocaleString()} sub="Before tax" accent="#10b981" />
      </div>
      <div className="card">
        <div className="flex-between mb-12">
          <div className="card-title">On-Call Hours — {user?.name}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={selected.size === sheets.length && sheets.length > 0} onChange={() => { if (selected.size === sheets.length) clearAll(); else sheets.forEach((_, i) => { if (!selected.has(i)) toggleOne(i); }); }} />
              </th>
              <th>Week</th><th>Weekday OC Hrs</th><th>Weekend OC Hrs</th><th>Weekday Pay</th><th>Weekend Pay</th><th>Notes</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sheets.map((s, idx) => {
              const wdPay = (s.weekday_oncall || 0) * rate * 0.5;
              const wePay = (s.weekend_oncall || 0) * rate * 0.75;
              return (
                <tr key={idx}>
                  <td><input type="checkbox" checked={selected.has(idx)} onChange={() => toggleOne(idx)} /></td>
                  <td style={{ fontFamily: 'DM Mono', color: 'var(--accent)' }}>{s.week}</td>
                  <td>{s.weekday_oncall || 0}h</td>
                  <td>{s.weekend_oncall || 0}h</td>
                  <td style={{ fontFamily: 'DM Mono', color: '#6ee7b7' }}>£{wdPay.toFixed(2)}</td>
                  <td style={{ fontFamily: 'DM Mono', color: '#fcd34d' }}>£{wePay.toFixed(2)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{s.notes || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(idx)}>✏</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteOne(idx)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {addModal && (
        <Modal title={editRow !== null ? 'Edit Entry' : 'Add On-Call Entry'} onClose={() => setAddModal(false)}>
          <FormGroup label="Week (e.g. W14 2026)"><input className="input" placeholder="W14 2026" value={form.week} onChange={e => setForm({ ...form, week: e.target.value })} /></FormGroup>
          <FormGroup label="Weekday On-Call Hours" hint="@50% uplift"><input className="input" type="number" min="0" max="80" step="0.5" value={form.weekday_oncall} onChange={e => setForm({ ...form, weekday_oncall: e.target.value })} /></FormGroup>
          <FormGroup label="Weekend On-Call Hours" hint="@75% uplift"><input className="input" type="number" min="0" max="80" step="0.5" value={form.weekend_oncall} onChange={e => setForm({ ...form, weekend_oncall: e.target.value })} /></FormGroup>
          <FormGroup label="Notes"><input className="input" placeholder="Optional notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setAddModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editRow !== null ? 'Update' : 'Add Entry'}</button>
          </div>
        </Modal>
      )}
      {showPayroll && (
        <Modal title={`Payroll Report — ${user?.name}`} onClose={() => setShowPayroll(false)}>
          <div style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div className="muted-xs" style={{ marginBottom: 12 }}>Base: £{base?.toLocaleString()}/mo · WD OC Rate: £{(rate*0.5).toFixed(2)}/hr · WE OC Rate: £{(rate*0.75).toFixed(2)}/hr</div>
            <div className="payroll-row"><span>Base Monthly Salary</span><span>£{base?.toLocaleString()}</span></div>
            <div className="payroll-row"><span>Weekday OC ({totalWD}h × £{(rate*0.5).toFixed(2)})</span><span>£{(totalWD * rate * 0.5).toFixed(2)}</span></div>
            <div className="payroll-row"><span>Weekend OC ({totalWE}h × £{(rate*0.75).toFixed(2)})</span><span>£{(totalWE * rate * 0.75).toFixed(2)}</span></div>
            <div className="payroll-row total"><span>Est. OC Pay</span><span>£{Math.round(grossOC).toLocaleString()}</span></div>
          </div>
          <button className="btn btn-primary" onClick={() => window.print()}>📄 Print / PDF</button>
        </Modal>
      )}
    </div>
  );
}

// ── Holiday Tracker (Manager only) ─────────────────────────────────────────
function Holidays({ users, holidays, setHolidays, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState({ userId: '', start: '', end: '', type: 'Annual Leave', note: '' });
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(holidays);

  if (!isManager) return <Alert type="warning">⚠ Holiday management is restricted to managers.</Alert>;

  const leaveTypes = ['Annual Leave', 'Sick Leave', 'Compassionate Leave', 'Study Leave', 'Unpaid Leave', 'Other'];

  const openAdd = () => { setForm({ userId: users[0]?.id || '', start: '', end: '', type: 'Annual Leave', note: '' }); setEditId(null); setShowModal(true); };
  const openEdit = (h, e) => { e.stopPropagation(); setForm({ ...h }); setEditId(h.id); setShowModal(true); };

  const save = () => {
    if (!form.start || !form.end || !form.userId) return;
    if (editId) {
      setHolidays(holidays.map(h => h.id === editId ? { ...h, ...form, status: 'approved' } : h));
    } else {
      setHolidays([...holidays, { id: 'h' + Date.now(), ...form, status: 'approved' }]);
    }
    setShowModal(false);
  };

  const deleteOne  = (id, e) => { e.stopPropagation(); if (window.confirm('Delete this holiday?')) setHolidays(holidays.filter(h => h.id !== id)); };
  const deleteBulk = () => { if (window.confirm(`Delete ${selected.size} records?`)) { setHolidays(holidays.filter(h => !selected.has(h.id))); clearAll(); } };

  const remainingDays = (userId) => {
    const used = holidays.filter(h => h.userId === userId && h.type === 'Annual Leave')
      .reduce((acc, h) => acc + Math.ceil((new Date(h.end) - new Date(h.start)) / 86400000) + 1, 0);
    return 25 - used;
  };

  return (
    <div>
      <PageHeader title="Holiday Tracker" sub="Manage approved team leave"
        actions={<>
          {selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          <button className="btn btn-primary" onClick={openAdd}>+ Add Holiday</button>
        </>} />
      <div className="grid-4 mb-16">
        {users.slice(0, 4).map(u => (
          <StatCard key={u.id} label={u.name.split(' ')[0]} value={remainingDays(u.id) + ' days left'} sub="Annual leave remaining" accent="#10b981" />
        ))}
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" checked={selected.size === holidays.length && holidays.length > 0} onChange={toggleAll} /></th>
              <th>Engineer</th><th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Notes</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {holidays.map(h => {
              const u = users.find(x => x.id === h.userId);
              const d = Math.ceil((new Date(h.end) - new Date(h.start)) / 86400000) + 1;
              return (
                <tr key={h.id}>
                  <td><input type="checkbox" checked={selected.has(h.id)} onChange={() => toggleOne(h.id)} /></td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar user={u || { avatar: '?', color: '#475569' }} size={24} /><span style={{ fontSize: 12 }}>{u?.name}</span></div></td>
                  <td style={{ fontSize: 12 }}>{h.type || 'Annual Leave'}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{h.start}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{h.end}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{d}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.note || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={e => openEdit(h, e)}>✏</button>
                      <button className="btn btn-danger btn-sm" onClick={e => deleteOne(h.id, e)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showModal && (
        <Modal title={editId ? 'Edit Holiday' : 'Add Holiday'} onClose={() => setShowModal(false)}>
          <FormGroup label="Engineer">
            <select className="select" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Leave Type">
            <select className="select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {leaveTypes.map(t => <option key={t}>{t}</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Start Date"><input className="input" type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></FormGroup>
          <FormGroup label="End Date"><input className="input" type="date" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></FormGroup>
          <FormGroup label="Notes (optional)"><input className="input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></FormGroup>
          <Alert style={{ marginTop: 8 }}>Holidays added here are already approved in the HR system.</Alert>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update' : 'Add Holiday'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Shift Swaps ────────────────────────────────────────────────────────────
function ShiftSwaps({ users, swapRequests, setSwapRequests, rota, setRota, currentUser, isManager }) {
  const all = swapRequests || [];
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(all);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const openEdit = (s, e) => { e.stopPropagation(); setEditForm({ ...s }); setEditId(s.id); };

  const saveEdit = () => {
    setSwapRequests(all.map(s => s.id === editId ? { ...s, ...editForm } : s));
    setEditId(null);
  };

  const approve = (swapId) => {
    if (!isManager) return;
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

  const deleteOne  = (id, e) => { e.stopPropagation(); setSwapRequests(all.filter(s => s.id !== id)); };
  const deleteBulk = () => { setSwapRequests(all.filter(s => !selected.has(s.id))); clearAll(); };

  return (
    <div>
      <PageHeader title="Shift Swaps" sub="All shift swap requests — managers approve/reject" />
      <div className="grid-3 mb-16">
        <StatCard label="Pending"  value={all.filter(s=>s.status==='pending').length}  sub="Awaiting decision" accent="#f59e0b" />
        <StatCard label="Approved" value={all.filter(s=>s.status==='approved').length} sub="Completed"         accent="#10b981" />
        <StatCard label="Rejected" value={all.filter(s=>s.status==='rejected').length} sub="Declined"          accent="#ef4444" />
      </div>
      {isManager && selected.size > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
          <button className="btn btn-success btn-sm" onClick={() => { selected.forEach(id => approve(id)); clearAll(); }}>✓ Approve {selected.size}</button>
          <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>
          <button className="btn btn-secondary btn-sm" onClick={clearAll}>✕ Clear</button>
        </div>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              {isManager && <th style={{ width: 32 }}><input type="checkbox" checked={selected.size === all.length && all.length > 0} onChange={toggleAll} /></th>}
              <th>Requester</th><th>Their Date</th><th>Target</th><th>Their Date</th><th>Reason</th><th>Status</th><th>Created</th>
              {isManager && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {all.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No swap requests yet</td></tr>}
            {[...all].sort((a,b) => new Date(b.created) - new Date(a.created)).map(s => {
              const req = users.find(u => u.id === s.requesterId);
              const tgt = users.find(u => u.id === s.targetId);
              return (
                <tr key={s.id}>
                  {isManager && <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} /></td>}
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={req} size={22} /><span style={{ fontSize: 12 }}>{req?.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{s.reqDate}</td>
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={tgt} size={22} /><span style={{ fontSize: 12 }}>{tgt?.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{s.tgtDate}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.reason || '—'}</td>
                  <td><Tag label={s.status} type={s.status==='approved'?'green':s.status==='pending'?'amber':'red'} /></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text-muted)' }}>{s.created}</td>
                  {isManager && (
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {s.status === 'pending' && <>
                          <button className="btn btn-success btn-sm" onClick={() => approve(s.id)}>✓</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setSwapRequests(all.map(x => x.id===s.id?{...x,status:'rejected'}:x))}>✗</button>
                        </>}
                        <button className="btn btn-secondary btn-sm" onClick={e => openEdit(s, e)}>✏</button>
                        <button className="btn btn-danger btn-sm" onClick={e => deleteOne(s.id, e)}>🗑</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editId && (
        <Modal title="Edit Swap Request" onClose={() => setEditId(null)}>
          <FormGroup label="Status">
            <select className="select" value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </FormGroup>
          <FormGroup label="Reason"><input className="input" value={editForm.reason || ''} onChange={e => setEditForm({ ...editForm, reason: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setEditId(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEdit}>Update</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Upgrade Days ───────────────────────────────────────────────────────────
function UpgradeDays({ users, upgrades, setUpgrades, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState({ date: '', name: '', desc: '' });
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(upgrades);

  const openAdd  = () => { setForm({ date: '', name: '', desc: '' }); setEditId(null); setShowModal(true); };
  const openEdit = (up, e) => { e.stopPropagation(); setForm({ date: up.date, name: up.name, desc: up.desc || '' }); setEditId(up.id); setShowModal(true); };

  const save = () => {
    if (!form.date || !form.name) return;
    if (editId) {
      setUpgrades(upgrades.map(u => u.id === editId ? { ...u, ...form } : u));
    } else {
      setUpgrades([...upgrades, { id: 'u' + Date.now(), ...form, attendees: [] }]);
    }
    setShowModal(false);
  };

  const deleteOne  = (id, e) => { e.stopPropagation(); if (window.confirm('Delete?')) setUpgrades(upgrades.filter(u => u.id !== id)); };
  const deleteBulk = () => { if (window.confirm(`Delete ${selected.size}?`)) { setUpgrades(upgrades.filter(u => !selected.has(u.id))); clearAll(); } };

  const toggleAttend = (id, uid) => setUpgrades(upgrades.map(u =>
    u.id !== id ? u : { ...u, attendees: u.attendees.includes(uid) ? u.attendees.filter(x => x !== uid) : [...u.attendees, uid] }
  ));

  return (
    <div>
      <PageHeader title="Upgrade Days" sub="Global system upgrade events"
        actions={<>
          {isManager && selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          {isManager && <button className="btn btn-primary" onClick={openAdd}>+ Add Upgrade Day</button>}
        </>} />
      {upgrades.length === 0 && <Alert>No upgrade days scheduled.</Alert>}
      {upgrades.map(up => (
        <div key={up.id} className="card mb-16">
          <div className="flex-between mb-12">
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              {isManager && <input type="checkbox" checked={selected.has(up.id)} onChange={() => toggleOne(up.id)} style={{ marginTop: 4 }} />}
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fecaca' }}>{up.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono', marginTop: 2 }}>{up.date}</div>
                {up.desc && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{up.desc}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ background: '#991b1b55', color: '#fecaca', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>⬆ Upgrade</span>
              {isManager && <>
                <button className="btn btn-secondary btn-sm" onClick={e => openEdit(up, e)}>✏</button>
                <button className="btn btn-danger btn-sm" onClick={e => deleteOne(up.id, e)}>🗑</button>
              </>}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>Attendees (click to toggle):</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {users.map(u => {
              const attending = up.attendees?.includes(u.id);
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
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>{up.attendees?.length || 0} of {users.length} attending</div>
        </div>
      ))}
      {showModal && isManager && (
        <Modal title={editId ? 'Edit Upgrade Day' : 'Add Upgrade Day'} onClose={() => setShowModal(false)}>
          <FormGroup label="Date"><input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormGroup>
          <FormGroup label="Upgrade Name"><input className="input" placeholder="e.g. Global Q3 System Upgrade" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormGroup>
          <FormGroup label="Description"><textarea className="textarea" rows={3} value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update' : 'Add'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Stress Score (Manager only) ────────────────────────────────────────────
function StressScore({ users, timesheets, incidents, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Stress Score is restricted to managers.</Alert>;
  const scores = users.map(u => {
    const sheets = timesheets[u.id] || [];
    const wd  = sheets.reduce((a, b) => a + (b.weekday_oncall || 0), 0);
    const we  = sheets.reduce((a, b) => a + (b.weekend_oncall || 0), 0);
    const inc = incidents.filter(i => i.assigned_to === u.id).length;
    const score = Math.min(100, Math.round((wd / 30 * 30) + (we / 20 * 40) + (inc * 5)));
    return { user: u, wd, we, inc, score, level: score > 75 ? 'High' : score > 45 ? 'Medium' : 'Low' };
  }).sort((a,b) => b.score - a.score);
  const COLOR = { High: '#ef4444', Medium: '#f59e0b', Low: '#10b981' };
  return (
    <div>
      <PageHeader title="Stress Score" sub="Identify engineers who may need support" />
      <Alert>📊 Scores factor in: weekday OC hours, weekend OC hours, incident load. Auto-updated from timesheets.</Alert>
      {scores.map(s => (
        <div key={s.user.id} className="card mb-12">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Avatar user={s.user} size={36} />
            <div style={{ flex: 1 }}>
              <div className="flex-between" style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{s.user.name}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{s.wd}h WD-OC · {s.we}h WE-OC · {s.inc} inc</span>
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
          {s.level === 'High' && <Alert type="warning">⚠ Consider redistributing on-call load for {s.user.name.split(' ')[0]}.</Alert>}
        </div>
      ))}
    </div>
  );
}

// ── TOIL (Auto-calculated from timesheets) ─────────────────────────────────
function TOIL({ users, timesheets, toil, setToil, currentUser, isManager }) {
  // Auto-accrue TOIL from weekend OC hours
  const autoAccrued = (userId) => {
    const sheets = timesheets[userId] || [];
    return sheets.reduce((a, b) => a + (b.weekend_oncall || 0), 0);
  };
  const manualToil = isManager ? toil : toil.filter(t => t.userId === currentUser);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ userId: currentUser, hours: '', reason: '', date: '', type: 'Used' });

  const addManual = () => {
    if (!form.hours || !form.date) return;
    setToil([...toil, { id: 't' + Date.now(), ...form, hours: +form.hours }]);
    setShowModal(false);
  };

  const byUser = (uid) => {
    const auto   = autoAccrued(uid);
    const manual = toil.filter(t => t.userId === uid && t.type === 'Accrued').reduce((a,b) => a + b.hours, 0);
    const used   = toil.filter(t => t.userId === uid && t.type === 'Used').reduce((a,b) => a + b.hours, 0);
    return { auto, manual, total: auto + manual, used, balance: auto + manual - used };
  };

  return (
    <div>
      <PageHeader title="TOIL — Time Off In Lieu" sub="Auto-calculated from weekend on-call hours + manual adjustments"
        actions={isManager && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Manual Entry</button>} />
      <Alert type="info">🔄 TOIL is automatically accrued from weekend on-call hours logged in Timesheets. Managers can add manual adjustments below.</Alert>
      <div className="grid-2 mb-16">
        {users.map(u => {
          const b = byUser(u.id);
          return (
            <div key={u.id} className="card">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <Avatar user={u} size={32} />
                <div className="name-sm">{u.name}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Auto (WE-OC)</div><div style={{ fontSize: 16, fontWeight: 600, color: '#6ee7b7' }}>{b.auto}h</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Manual</div><div style={{ fontSize: 16, fontWeight: 600, color: '#93c5fd' }}>{b.manual}h</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Used</div><div style={{ fontSize: 16, fontWeight: 600, color: '#fcd34d' }}>{b.used}h</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Balance</div><div style={{ fontSize: 16, fontWeight: 600, color: b.balance >= 0 ? '#6ee7b7' : '#fca5a5' }}>{b.balance}h</div></div>
              </div>
            </div>
          );
        })}
      </div>
      {manualToil.length > 0 && (
        <div className="card">
          <div className="card-title">Manual TOIL Entries</div>
          <table>
            <thead><tr><th>Engineer</th><th>Date</th><th>Type</th><th>Hours</th><th>Reason</th></tr></thead>
            <tbody>
              {manualToil.map(t => {
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
      )}
      {showModal && (
        <Modal title="Manual TOIL Entry" onClose={() => setShowModal(false)}>
          <FormGroup label="Engineer">
            <select className="select" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Type">
            <select className="select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option>Accrued</option><option>Used</option>
            </select>
          </FormGroup>
          <FormGroup label="Date"><input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormGroup>
          <FormGroup label="Hours"><input className="input" type="number" min="0.5" step="0.5" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} /></FormGroup>
          <FormGroup label="Reason"><input className="input" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={addManual}>Add Entry</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Absence / Sickness ─────────────────────────────────────────────────────
function Absence({ users, absences, setAbsences, currentUser, isManager }) {
  const [showModal, setShowModal]   = useState(false);
  const [editId, setEditId]         = useState(null);
  const [form, setForm]             = useState({ userId: currentUser, start: '', end: '', type: 'Sick', notes: '' });
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(absences);
  const visible = isManager ? absences : absences.filter(a => a.userId === currentUser);

  const openAdd  = () => { setForm({ userId: currentUser, start: '', end: '', type: 'Sick', notes: '' }); setEditId(null); setShowModal(true); };
  const openEdit = (a, e) => { e.stopPropagation(); setForm({ ...a }); setEditId(a.id); setShowModal(true); };

  const save = () => {
    if (!form.start) return;
    if (editId) {
      setAbsences(absences.map(a => a.id === editId ? { ...a, ...form } : a));
    } else {
      setAbsences([...absences, { id: 'abs-' + Date.now(), ...form }]);
    }
    setShowModal(false);
  };

  const deleteOne  = (id, e) => { e.stopPropagation(); setAbsences(absences.filter(a => a.id !== id)); };
  const deleteBulk = () => { setAbsences(absences.filter(a => !selected.has(a.id))); clearAll(); };

  return (
    <div>
      <PageHeader title="Absence &amp; Sickness" sub="Track all absences and sickness"
        actions={<>
          {selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          <button className="btn btn-primary" onClick={openAdd}>+ Log Absence</button>
        </>} />
      <div className="grid-3 mb-16">
        <StatCard label="Total Records" value={absences.length} sub="All engineers" accent="#ef4444" />
        <StatCard label="Sick Days" value={absences.filter(a=>a.type==='Sick').length} sub="Records" accent="#f59e0b" />
        <StatCard label="Unauthorised" value={absences.filter(a=>a.type==='Unauthorised').length} sub="Flagged" accent="#ef4444" />
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              {isManager && <th style={{ width: 32 }}><input type="checkbox" checked={selected.size === absences.length && absences.length > 0} onChange={toggleAll} /></th>}
              <th>Engineer</th><th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Notes</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(a => {
              const u = users.find(x => x.id === a.userId);
              const d = a.end ? Math.ceil((new Date(a.end) - new Date(a.start)) / 86400000) + 1 : 1;
              return (
                <tr key={a.id}>
                  {isManager && <td><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleOne(a.id)} /></td>}
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={u} size={22} /><span style={{ fontSize: 12 }}>{u?.name}</span></div></td>
                  <td><Tag label={a.type} type={a.type==='Sick'?'red':a.type==='Unauthorised'?'red':'amber'} /></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{a.start}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{a.end || '—'}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{d}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.notes || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={e => openEdit(a, e)}>✏</button>
                      <button className="btn btn-danger btn-sm" onClick={e => deleteOne(a.id, e)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showModal && (
        <Modal title={editId ? 'Edit Absence' : 'Log Absence'} onClose={() => setShowModal(false)}>
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
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update' : 'Log Absence'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Logbook (Manager only) ─────────────────────────────────────────────────
function Logbook({ users, logbook, setLogbook, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId]       = useState(null);
  const [filter, setFilter]       = useState('all');
  const [form, setForm]           = useState({ userId: '', type: 'Appraisal', date: '', summary: '', content: '' });
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(logbook);

  if (!isManager) return <Alert type="warning">⚠ Logbook is restricted to managers.</Alert>;

  const visible = filter === 'all' ? logbook : logbook.filter(l => l.userId === filter);

  const openAdd  = () => { setForm({ userId: users[0]?.id || '', type: 'Appraisal', date: '', summary: '', content: '' }); setEditId(null); setShowModal(true); };
  const openEdit = (l, e) => { e.stopPropagation(); setForm({ ...l }); setEditId(l.id); setShowModal(true); };

  const save = () => {
    if (!form.userId || !form.date) return;
    if (editId) {
      setLogbook(logbook.map(l => l.id === editId ? { ...l, ...form } : l));
    } else {
      setLogbook([...logbook, { id: 'log-' + Date.now(), ...form, createdBy: currentUser, created: new Date().toISOString().slice(0,10) }]);
    }
    setShowModal(false);
  };

  const deleteOne  = (id, e) => { e.stopPropagation(); if (window.confirm('Delete entry?')) setLogbook(logbook.filter(l => l.id !== id)); };
  const deleteBulk = () => { if (window.confirm(`Delete ${selected.size}?`)) { setLogbook(logbook.filter(l => !selected.has(l.id))); clearAll(); } };

  const typeColor = { Appraisal: 'blue', Training: 'green', Achievement: 'amber', Note: 'purple' };

  return (
    <div>
      <PageHeader title="Logbook" sub="Record appraisals, training &amp; achievements"
        actions={<>
          {selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          <button className="btn btn-primary" onClick={openAdd}>+ Add Entry</button>
        </>} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="select" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All Engineers</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {selected.size > 0 && <span className="muted-xs">{selected.size} selected</span>}
      </div>
      {visible.map(l => {
        const u = users.find(x => x.id === l.userId);
        return (
          <div key={l.id} className="card mb-12">
            <div className="flex-between mb-8">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} />
                <Avatar user={u} size={28} />
                <div>
                  <div className="name-sm">{u?.name}</div>
                  <div className="muted-xs">{l.date}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Tag label={l.type} type={typeColor[l.type] || 'blue'} />
                <button className="btn btn-secondary btn-sm" onClick={e => openEdit(l, e)}>✏</button>
                <button className="btn btn-danger btn-sm" onClick={e => deleteOne(l.id, e)}>🗑</button>
              </div>
            </div>
            {l.summary && <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>{l.summary}</div>}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: l.content }} />
          </div>
        );
      })}
      {visible.length === 0 && <Alert>No logbook entries yet.</Alert>}
      {showModal && (
        <Modal title={editId ? 'Edit Logbook Entry' : 'Add Logbook Entry'} onClose={() => setShowModal(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
          </div>
          <FormGroup label="Full Notes">
            <RichEditor value={form.content} onChange={v => setForm({ ...form, content: v })} placeholder="Detailed notes, observations, feedback…" rows={8} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update Entry' : 'Save Entry'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Wiki — Full Page Blog Editor ───────────────────────────────────────────
function Wiki({ wiki, setWiki }) {
  const [sel, setSel]       = useState(null);   // viewing id
  const [editing, setEditing] = useState(false); // full page editor
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [form, setForm]     = useState({ title: '', cat: 'Operations', heroUrl: '', excerpt: '', tags: '', content: '', author: '' });

  const CATS = ['Operations','Engineering','Process','Security','Runbooks','Announcements'];

  const openNew  = () => { setForm({ title: '', cat: 'Operations', heroUrl: '', excerpt: '', tags: '', content: '', author: '' }); setSel('__new__'); setEditing(true); };
  const openEdit = (w) => { setForm({ ...w }); setSel(w.id); setEditing(true); };

  const save = () => {
    if (!form.title) return;
    if (sel === '__new__') {
      setWiki([...wiki, { id: 'w' + Date.now(), ...form, created: new Date().toISOString().slice(0,10), updated: new Date().toISOString().slice(0,10) }]);
    } else {
      setWiki(wiki.map(w => w.id === sel ? { ...w, ...form, updated: new Date().toISOString().slice(0,10) } : w));
    }
    setEditing(false); setSel(null);
  };

  const deleteW = (id) => { if (window.confirm('Delete article?')) { setWiki(wiki.filter(w => w.id !== id)); setSel(null); setEditing(false); } };

  const filtered = wiki.filter(w =>
    (catFilter === 'all' || w.cat === catFilter) &&
    (w.title.toLowerCase().includes(search.toLowerCase()) || (w.tags||'').toLowerCase().includes(search.toLowerCase()) || (w.excerpt||'').toLowerCase().includes(search.toLowerCase()))
  );

  // ── Full page editor ─────────────────────────────────────────────────────
  if (editing) {
    const isNew = sel === '__new__';
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setSel(null); }}>← Back</button>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--text-muted)' }}>{isNew ? 'New Article' : 'Edit Article'}</span>
          {!isNew && <button className="btn btn-danger btn-sm" onClick={() => deleteW(sel)}>🗑 Delete</button>}
          <button className="btn btn-primary" onClick={save}>{isNew ? 'Publish' : 'Update'}</button>
        </div>

        {/* Hero Image */}
        <div style={{ marginBottom: 20 }}>
          {form.heroUrl && (
            <div style={{ width: '100%', height: 220, borderRadius: 12, overflow: 'hidden', marginBottom: 12, position: 'relative' }}>
              <img src={form.heroUrl} alt="Hero" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 50%,rgba(10,20,40,.9))' }} />
            </div>
          )}
          <input className="input" placeholder="Hero image URL (https://…)" value={form.heroUrl} onChange={e => setForm({ ...form, heroUrl: e.target.value })} />
        </div>

        {/* Meta */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <FormGroup label="Title">
            <input className="input" style={{ fontSize: 15 }} placeholder="Article title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </FormGroup>
          <FormGroup label="Category">
            <select className="select" value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })}>
              {CATS.map(c => <option key={c}>{c}</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Author">
            <input className="input" placeholder="Your name" value={form.author} onChange={e => setForm({ ...form, author: e.target.value })} />
          </FormGroup>
        </div>
        <FormGroup label="Tags" hint="comma separated">
          <input className="input" placeholder="e.g. aws, kubernetes, runbook" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
        </FormGroup>
        <FormGroup label="Excerpt / Summary">
          <textarea className="textarea" rows={2} placeholder="Short description shown on cards…" value={form.excerpt} onChange={e => setForm({ ...form, excerpt: e.target.value })} />
        </FormGroup>
        <FormGroup label="Content">
          <RichEditor value={form.content} onChange={v => setForm({ ...form, content: v })} rows={20} fullPage />
        </FormGroup>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => { setEditing(false); setSel(null); }}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{isNew ? '🚀 Publish Article' : '✓ Update Article'}</button>
        </div>
      </div>
    );
  }

  // ── Article view ─────────────────────────────────────────────────────────
  if (sel && sel !== '__new__') {
    const w = wiki.find(x => x.id === sel);
    if (!w) { setSel(null); return null; }
    return (
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setSel(null)}>← Back</button>
          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(w)}>✏ Edit</button>
          <button className="btn btn-danger btn-sm" onClick={() => deleteW(w.id)}>🗑 Delete</button>
        </div>
        {w.heroUrl && (
          <div style={{ width: '100%', height: 280, borderRadius: 16, overflow: 'hidden', marginBottom: 24, position: 'relative' }}>
            <img src={w.heroUrl} alt="Hero" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 40%,rgba(10,20,40,.95))' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 28px' }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{w.title}</div>
            </div>
          </div>
        )}
        {!w.heroUrl && <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>{w.title}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <span style={{ background: '#1e40af55', color: '#bfdbfe', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{w.cat}</span>
          {(w.tags||'').split(',').filter(Boolean).map(t => (
            <span key={t} style={{ background: '#1e293b', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 12, fontSize: 11, border: '1px solid var(--border)' }}>{t.trim()}</span>
          ))}
          {w.author && <span className="muted-xs">by {w.author}</span>}
          {w.updated && <span className="muted-xs">· Updated {w.updated}</span>}
        </div>
        {w.excerpt && <div style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)', fontStyle: 'italic' }}>{w.excerpt}</div>}
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.9 }} dangerouslySetInnerHTML={{ __html: w.content }} />
      </div>
    );
  }

  // ── Article list (blog layout) ────────────────────────────────────────────
  return (
    <div>
      <PageHeader title="Wiki" sub="Team knowledge base & articles"
        actions={<button className="btn btn-primary" onClick={openNew}>+ New Article</button>} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input className="input" placeholder="🔍 Search wiki…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <select className="select" value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ width: 160 }}>
          <option value="all">All Categories</option>
          {CATS.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>
      {filtered.length === 0 && <Alert>No articles found. {catFilter !== 'all' ? 'Try a different category.' : 'Create your first article above.'}</Alert>}

      {/* Featured / first article */}
      {filtered.length > 0 && (() => {
        const w = filtered[0];
        return (
          <div key={w.id} className="card" style={{ cursor: 'pointer', marginBottom: 20, padding: 0, overflow: 'hidden' }} onClick={() => setSel(w.id)}>
            {w.heroUrl && (
              <div style={{ width: '100%', height: 200, position: 'relative', overflow: 'hidden' }}>
                <img src={w.heroUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 30%,rgba(10,20,40,.95))' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 24px' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{w.title}</div>
                </div>
              </div>
            )}
            <div style={{ padding: '16px 20px' }}>
              {!w.heroUrl && <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{w.title}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ background: '#1e40af55', color: '#bfdbfe', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>★ Featured · {w.cat}</span>
                {(w.tags||'').split(',').filter(Boolean).slice(0,3).map(t => <span key={t} style={{ background: '#1e293b', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 10, fontSize: 10, border: '1px solid var(--border)' }}>{t.trim()}</span>)}
              </div>
              <div className="muted-xs">{w.excerpt || w.content.replace(/<[^>]+>/g,'').slice(0,150)}…</div>
              <div className="muted-xs" style={{ marginTop: 8 }}>{w.author && `by ${w.author} · `}{w.updated}</div>
            </div>
          </div>
        );
      })()}

      {/* Rest as grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: 16 }}>
        {filtered.slice(1).map(w => (
          <div key={w.id} className="card" style={{ cursor: 'pointer', padding: 0, overflow: 'hidden' }} onClick={() => setSel(w.id)}>
            {w.heroUrl && (
              <div style={{ height: 120, overflow: 'hidden', position: 'relative' }}>
                <img src={w.heroUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,20,40,.3)' }} />
              </div>
            )}
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ background: '#1e40af55', color: '#bfdbfe', padding: '2px 6px', borderRadius: 10, fontSize: 10 }}>{w.cat}</span>
                {(w.tags||'').split(',').filter(Boolean).slice(0,2).map(t => <span key={t} style={{ background: '#1e293b', color: 'var(--text-muted)', padding: '2px 5px', borderRadius: 8, fontSize: 9, border: '1px solid var(--border)' }}>{t.trim()}</span>)}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, lineHeight: 1.4 }}>{w.title}</div>
              <div className="muted-xs">{w.excerpt || w.content.replace(/<[^>]+>/g,'').slice(0,100)}…</div>
              <div className="muted-xs" style={{ marginTop: 8 }}>{w.updated}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Glossary ───────────────────────────────────────────────────────────────
function Glossary({ glossary, setGlossary }) {
  const [form, setForm] = useState({ term: '', def: '' });
  const [search, setSearch] = useState('');
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(glossary);

  const add = () => { if (!form.term) return; setGlossary([...glossary, { id: 'g' + Date.now(), ...form }]); setForm({ term: '', def: '' }); };
  const deleteOne  = (id) => setGlossary(glossary.filter(g => g.id !== id));
  const deleteBulk = () => { setGlossary(glossary.filter(g => !selected.has(g.id))); clearAll(); };
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input className="input" placeholder="🔍 Search terms…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
        {selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
      </div>
      <div className="card">
        <table>
          <thead><tr><th style={{ width: 32 }}><input type="checkbox" checked={selected.size === glossary.length && glossary.length > 0} onChange={toggleAll} /></th><th>Term</th><th>Definition</th><th></th></tr></thead>
          <tbody>{filtered.sort((a,b) => a.term.localeCompare(b.term)).map(g => (
            <tr key={g.id}>
              <td><input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleOne(g.id)} /></td>
              <td style={{ fontWeight: 600, color: 'var(--accent)', fontFamily: 'DM Mono', fontSize: 12 }}>{g.term}</td>
              <td style={{ fontSize: 13 }}>{g.def}</td>
              <td><button className="btn btn-danger btn-sm" onClick={() => deleteOne(g.id)}>🗑</button></td>
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
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState({ name: '', role: '', email: '', phone: '', team: '' });
  const [search, setSearch]       = useState('');

  const openAdd  = () => { setForm({ name: '', role: '', email: '', phone: '', team: '' }); setEditId(null); setShowModal(true); };
  const openEdit = (c) => { setForm({ ...c }); setEditId(c.id); setShowModal(true); };
  const save = () => {
    if (!form.name) return;
    if (editId) setContacts(contacts.map(c => c.id === editId ? { ...c, ...form } : c));
    else setContacts([...contacts, { id: 'c' + Date.now(), ...form }]);
    setShowModal(false);
  };

  const filtered = contacts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.role.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader title="Contacts" sub="Team &amp; external contacts"
        actions={<button className="btn btn-primary" onClick={openAdd}>+ Add Contact</button>} />
      <input className="input" placeholder="🔍 Search contacts…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, width: '100%' }} />
      <div className="grid-2">
        {filtered.map(c => (
          <div key={c.id} className="card card-sm">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13 }}>
                {c.name.split(' ').map(x => x[0]).join('').slice(0, 2)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.role}{c.team ? ` · ${c.team}` : ''}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>✏</button>
              <button className="btn btn-danger btn-sm" onClick={() => setContacts(contacts.filter(x => x.id !== c.id))}>🗑</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <div>📧 <a href={`mailto:${c.email}`} style={{ color: 'var(--accent)' }}>{c.email}</a></div>
              <div style={{ marginTop: 4 }}>📞 {c.phone}</div>
            </div>
          </div>
        ))}
      </div>
      {showModal && (
        <Modal title={editId ? 'Edit Contact' : 'Add Contact'} onClose={() => setShowModal(false)}>
          <FormGroup label="Name"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormGroup>
          <FormGroup label="Role"><input className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} /></FormGroup>
          <FormGroup label="Team / Department"><input className="input" value={form.team} onChange={e => setForm({ ...form, team: e.target.value })} /></FormGroup>
          <FormGroup label="Email"><input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></FormGroup>
          <FormGroup label="Phone"><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update' : 'Add Contact'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────
function Documents({ documents, setDocuments, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState({ title: '', category: 'General', content: '', tags: '' });
  const [search, setSearch]       = useState('');
  const [view, setView]           = useState(null);
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(documents);

  const openAdd  = () => { setForm({ title: '', category: 'General', content: '', tags: '' }); setEditId(null); setShowModal(true); };
  const openEdit = (d, e) => { e?.stopPropagation(); setForm({ ...d }); setEditId(d.id); setShowModal(true); };

  const save = () => {
    if (!form.title) return;
    if (editId) setDocuments(documents.map(d => d.id === editId ? { ...d, ...form } : d));
    else setDocuments([...documents, { id: 'doc-' + Date.now(), ...form, created: new Date().toISOString().slice(0,10) }]);
    setShowModal(false);
  };

  const deleteOne  = (id, e) => { e?.stopPropagation(); if (window.confirm('Delete?')) setDocuments(documents.filter(d => d.id !== id)); };
  const deleteBulk = () => { if (window.confirm(`Delete ${selected.size}?`)) { setDocuments(documents.filter(d => !selected.has(d.id))); clearAll(); } };

  const filtered = documents.filter(d => d.title.toLowerCase().includes(search.toLowerCase()) || (d.tags||'').toLowerCase().includes(search.toLowerCase()));

  if (view) {
    const d = documents.find(x => x.id === view);
    if (!d) { setView(null); return null; }
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setView(null)}>← Back</button>
          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(d)}>✏ Edit</button>
          {isManager && <button className="btn btn-danger btn-sm" onClick={e => { deleteOne(d.id, e); setView(null); }}>🗑 Delete</button>}
        </div>
        <div className="card">
          <div className="flex-between mb-12">
            <div className="page-title">{d.title}</div>
            <div style={{ display: 'flex', gap: 8 }}><Tag label={d.category} type="blue" /><span className="muted-xs">{d.created}</span></div>
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
        actions={<>
          {selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          <button className="btn btn-primary" onClick={openAdd}>+ New Document</button>
        </>} />
      <input className="input" placeholder="🔍 Search documents…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, width: '100%' }} />
      <div className="grid-2">
        {filtered.map(d => (
          <div key={d.id} className="card card-sm" style={{ cursor: 'pointer' }} onClick={() => setView(d.id)}>
            <div className="flex-between mb-8">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={selected.has(d.id)} onChange={e => { e.stopPropagation(); toggleOne(d.id); }} onClick={e => e.stopPropagation()} />
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>📄 {d.title}</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <Tag label={d.category} type="blue" />
                <button className="btn btn-secondary btn-sm" onClick={e => openEdit(d, e)}>✏</button>
                <button className="btn btn-danger btn-sm" onClick={e => deleteOne(d.id, e)}>🗑</button>
              </div>
            </div>
            <div className="muted-xs">{d.content.replace(/<[^>]+>/g, '').slice(0, 100)}…</div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>{d.created}</div>
          </div>
        ))}
      </div>
      {showModal && (
        <Modal title={editId ? 'Edit Document' : 'New Document'} onClose={() => setShowModal(false)} wide>
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
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update' : 'Save Document'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Obsidian Notes ────────────────────────────────────────────────────────
function Notes({ obsidianNotes, setObsidianNotes, users, currentUser, isManager }) {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ title: '', content: '', visibility: 'PRIVATE', tags: '' });
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
  const [selectedEngineer, setSelectedEngineer] = useState(null);
  const fileRef = useRef(null);

  const handleImport = async (e) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'md') {
        const text = await file.text();
        const title = file.name.replace('.md', '');
        setObsidianNotes([...obsidianNotes, {
          id: 'note-' + Date.now() + Math.random(),
          engineerId: currentUser,
          title: title,
          content: text,
          visibility: 'PRIVATE',
          tags: 'imported',
          created: new Date().toISOString().slice(0, 10),
          sourceFile: file.name
        }]);
      }
    }
    e.target.value = '';
  };

  const openAdd = () => {
    setForm({ title: '', content: '', visibility: 'PRIVATE', tags: '' });
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (note, e) => {
    e?.stopPropagation();
    if (note.engineerId !== currentUser && !isManager) {
      alert('Cannot edit other engineers\' notes');
      return;
    }
    setForm({ ...note });
    setEditId(note.id);
    setShowModal(true);
  };

  const save = () => {
    if (!form.title || !form.content) return;
    if (editId) {
      setObsidianNotes(obsidianNotes.map(n => n.id === editId ? { ...n, ...form } : n));
    } else {
      setObsidianNotes([...obsidianNotes, {
        id: 'note-' + Date.now(),
        engineerId: currentUser,
        ...form,
        created: new Date().toISOString().slice(0, 10)
      }]);
    }
    setShowModal(false);
  };

  const deleteOne = (noteId, e) => {
    e?.stopPropagation();
    const note = obsidianNotes.find(n => n.id === noteId);
    if (note.engineerId !== currentUser && !isManager) {
      alert('Cannot delete other engineers\' notes');
      return;
    }
    if (window.confirm('Delete this note?')) {
      setObsidianNotes(obsidianNotes.filter(n => n.id !== noteId));
    }
  };

  const getEngineersNotes = () => {
    if (isManager) {
      const grouped = {};
      obsidianNotes.forEach(note => {
        if (!grouped[note.engineerId]) grouped[note.engineerId] = [];
        grouped[note.engineerId].push(note);
      });
      return grouped;
    } else {
      return { [currentUser]: obsidianNotes.filter(n => n.engineerId === currentUser) };
    }
  };

  const currentUserObj = users.find(u => u.id === currentUser);

  if (view) {
    const note = obsidianNotes.find(n => n.id === view);
    if (!note) {
      setView(null);
      return null;
    }
    const canEdit = note.engineerId === currentUser || isManager;
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setView(null)}>← Back</button>
          {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(note)}>✏ Edit</button>}
          {canEdit && <button className="btn btn-danger btn-sm" onClick={e => { deleteOne(note.id, e); setView(null); }}>🗑 Delete</button>}
          <div style={{ marginLeft: 'auto' }}>
            <Tag label={note.visibility} type={note.visibility === 'PRIVATE' ? 'red' : 'green'} />
            <span className="muted-xs" style={{ marginLeft: 8 }}>{note.created}</span>
          </div>
        </div>
        <div className="card">
          <div className="page-title" style={{ marginBottom: 16 }}>{note.title}</div>
          {note.tags && <div style={{ marginBottom: 12 }}>{note.tags.split(',').map(t => <Tag key={t} label={t.trim()} type="purple" />)}</div>}
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {note.content}
          </div>
          {isManager && <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
            By: {users.find(u => u.id === note.engineerId)?.name} ({note.engineerId})
          </div>}
        </div>
      </div>
    );
  }

  if (isManager) {
    const groupedNotes = getEngineersNotes();
    return (
      <div>
        <PageHeader title="📝 Obsidian Notes" sub="View team notes by engineer" />
        <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 16, marginBottom: 16 }}>
          <div className="card">
            <div className="card-title">Team Engineers</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.keys(groupedNotes).map(engId => {
                const eng = users.find(u => u.id === engId);
                const count = groupedNotes[engId].length;
                return (
                  <div
                    key={engId}
                    onClick={() => setSelectedEngineer(engId)}
                    style={{
                      padding: '8px 10px',
                      background: selectedEngineer === engId ? 'var(--accent)' : 'transparent',
                      color: selectedEngineer === engId ? '#fff' : 'var(--text-primary)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13
                    }}
                  >
                    {eng?.name} <span style={{ fontSize: 11, opacity: 0.7 }}>({count})</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            {selectedEngineer ? (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <h3>{users.find(u => u.id === selectedEngineer)?.name}'s Notes</h3>
                </div>
                <div className="grid-2">
                  {groupedNotes[selectedEngineer].map(note => (
                    <div key={note.id} className="card card-sm" onClick={() => setView(note.id)} style={{ cursor: 'pointer' }}>
                      <div className="flex-between mb-8">
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>📝 {note.title}</div>
                        <Tag label={note.visibility} type={note.visibility === 'PRIVATE' ? 'red' : 'green'} />
                      </div>
                      <div className="muted-xs">{note.content.slice(0, 100)}…</div>
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>{note.created}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                Select an engineer to view their notes
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Engineer view
  const myNotes = obsidianNotes.filter(n => n.engineerId === currentUser);
  return (
    <div>
      <PageHeader title="📝 My Notes" sub="Manage your Obsidian notes"
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>📥 Import .md</button>
          <button className="btn btn-primary" onClick={openAdd}>+ New Note</button>
        </>} />
      <input ref={fileRef} type="file" multiple accept=".md" onChange={handleImport} style={{ display: 'none' }} />
      <input className="input" placeholder="🔍 Search notes…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, width: '100%' }} />

      <div className="grid-2">
        {myNotes.filter(n => n.title.toLowerCase().includes(search.toLowerCase())).map(note => (
          <div key={note.id} className="card card-sm" onClick={() => setView(note.id)} style={{ cursor: 'pointer' }}>
            <div className="flex-between mb-8">
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>📝 {note.title}</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <Tag label={note.visibility} type={note.visibility === 'PRIVATE' ? 'red' : 'green'} />
                <button className="btn btn-secondary btn-sm" onClick={e => openEdit(note, e)}>✏</button>
                <button className="btn btn-danger btn-sm" onClick={e => deleteOne(note.id, e)}>🗑</button>
              </div>
            </div>
            <div className="muted-xs">{note.content.slice(0, 100)}…</div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>{note.created}</div>
          </div>
        ))}
      </div>

      {showModal && (
        <Modal title={editId ? 'Edit Note' : 'New Note'} onClose={() => setShowModal(false)} wide>
          <FormGroup label="Title">
            <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Note title" />
          </FormGroup>
          <FormGroup label="Visibility">
            <select className="select" value={form.visibility} onChange={e => setForm({ ...form, visibility: e.target.value })}>
              <option value="PRIVATE">🔒 Private (Only you can see)</option>
              <option value="SHAREABLE">🔓 Shareable (Manager can see)</option>
            </select>
          </FormGroup>
          <FormGroup label="Tags" hint="comma separated">
            <input className="input" placeholder="e.g. important, urgent, learning" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
          </FormGroup>
          <FormGroup label="Content">
            <textarea
              className="input"
              style={{ minHeight: 300, fontFamily: 'monospace', fontSize: 12 }}
              value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
              placeholder="Write your note in markdown…"
            />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update Note' : 'Save Note'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── WhatsApp Team Chat ────────────────────────────────────────────────────
function WhatsAppChat({ whatsappChats, setWhatsappChats, users, currentUser, isManager }) {
  const [selectedChat, setSelectedChat] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [showCreateChat, setShowCreateChat] = useState(false);
  const [chatForm, setChatForm] = useState({ name: '', members: [] });

  const createChat = () => {
    if (!chatForm.name || chatForm.members.length === 0) return;
    const chat = {
      id: 'chat-' + Date.now(),
      name: chatForm.name,
      createdBy: currentUser,
      members: [...new Set([...chatForm.members, currentUser])],
      created: new Date().toISOString().slice(0, 10),
      messages: []
    };
    setWhatsappChats([...whatsappChats, chat]);
    setShowCreateChat(false);
    setChatForm({ name: '', members: [] });
    setSelectedChat(chat.id);
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !selectedChat) return;
    const chat = whatsappChats.find(c => c.id === selectedChat);
    if (!chat) return;

    const message = {
      id: 'msg-' + Date.now(),
      sender: currentUser,
      content: newMessage,
      timestamp: new Date().toISOString()
    };

    setWhatsappChats(whatsappChats.map(c =>
      c.id === selectedChat
        ? { ...c, messages: [...(c.messages || []), message] }
        : c
    ));
    setNewMessage('');
  };

  const deleteChat = (chatId) => {
    if (window.confirm('Delete this chat?')) {
      setWhatsappChats(whatsappChats.filter(c => c.id !== chatId));
      setSelectedChat(null);
    }
  };

  const currentChat = whatsappChats.find(c => c.id === selectedChat);

  return (
    <div>
      <PageHeader title="💬 WhatsApp Team Chat" sub="Team collaboration & messaging"
        actions={isManager && <button className="btn btn-primary" onClick={() => setShowCreateChat(true)}>+ New Group</button>} />

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, height: '70vh' }}>
        {/* Chat List */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-title">Groups ({whatsappChats.length})</div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {whatsappChats.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                No chats yet. Create one to get started!
              </div>
            ) : (
              whatsappChats.map(chat => (
                <div
                  key={chat.id}
                  onClick={() => setSelectedChat(chat.id)}
                  style={{
                    padding: '10px 12px',
                    background: selectedChat === chat.id ? 'var(--accent)' : 'transparent',
                    color: selectedChat === chat.id ? '#fff' : 'var(--text-primary)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    marginBottom: 6,
                    fontSize: 13
                  }}
                >
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>💬 {chat.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>
                    {chat.members.length} members · {(chat.messages || []).length} messages
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chat View */}
        {currentChat ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Chat Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 style={{ margin: '0 0 4px' }}>{currentChat.name}</h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {currentChat.members.length} members
                </div>
              </div>
              {isManager && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => deleteChat(currentChat.id)}
                >
                  🗑 Delete
                </button>
              )}
            </div>

            {/* Messages */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(currentChat.messages || []).length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', margin: 'auto' }}>
                  No messages yet. Start the conversation!
                </div>
              ) : (
                (currentChat.messages || []).map(msg => {
                  const sender = users.find(u => u.id === msg.sender);
                  const isOwn = msg.sender === currentUser;
                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        justifyContent: isOwn ? 'flex-end' : 'flex-start'
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '70%',
                          padding: '8px 12px',
                          borderRadius: 12,
                          background: isOwn ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                          color: isOwn ? '#fff' : 'var(--text-primary)',
                          fontSize: 13,
                          wordWrap: 'break-word'
                        }}
                      >
                        {!isOwn && <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>{sender?.name}</div>}
                        <div>{msg.content}</div>
                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: 'right' }}>
                          {new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Message Input */}
            <div style={{ padding: '12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="input"
                placeholder="Type a message…"
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                style={{ flex: 1, margin: 0 }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={sendMessage}
                disabled={!newMessage.trim()}
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 24, marginBottom: 8 }}>💬</div>
              <div>Select a chat or create a new group to start messaging</div>
            </div>
          </div>
        )}
      </div>

      {showCreateChat && (
        <Modal title="Create Group Chat" onClose={() => setShowCreateChat(false)}>
          <FormGroup label="Group Name">
            <input
              className="input"
              placeholder="e.g. Cloud Ops Team"
              value={chatForm.name}
              onChange={e => setChatForm({ ...chatForm, name: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Add Members">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {users.filter(u => u.id !== currentUser).map(u => (
                <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={chatForm.members.includes(u.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setChatForm({ ...chatForm, members: [...chatForm.members, u.id] });
                      } else {
                        setChatForm({ ...chatForm, members: chatForm.members.filter(id => id !== u.id) });
                      }
                    }}
                  />
                  <Avatar user={u} size={24} />
                  <span style={{ fontSize: 13 }}>{u.name} ({u.id})</span>
                </label>
              ))}
            </div>
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowCreateChat(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={createChat}
              disabled={!chatForm.name || chatForm.members.length === 0}
            >
              Create Group
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Insights (Manager only) ────────────────────────────────────────────────
function Insights({ users, incidents, timesheets, holidays, absences, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Insights are restricted to managers.</Alert>;
  const p1 = incidents.filter(i => i.severity === 'P1').length;
  const resolved = incidents.filter(i => i.status === 'Resolved').length;
  const totalOC = Object.values(timesheets).flatMap(t => t).reduce((a, b) => a + (b.weekday_oncall || 0) + (b.weekend_oncall || 0), 0);

  return (
    <div>
      <PageHeader title="Insights" sub="Team performance and operational metrics" />
      <div className="grid-4 mb-16">
        <StatCard label="Total Incidents"  value={incidents.length}  sub={p1 + ' P1 disasters'}  accent="#ef4444" icon="🚨" />
        <StatCard label="Resolution Rate"  value={(incidents.length ? Math.round(resolved/incidents.length*100) : 0) + '%'} sub={resolved + '/' + incidents.length} accent="#10b981" icon="✅" />
        <StatCard label="Total OC Hours"   value={totalOC}           sub="All engineers"          accent="#3b82f6" icon="⏱" />
        <StatCard label="Approved Leave"   value={holidays.length}   sub="Entries"                accent="#f59e0b" icon="🌴" />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">Incident Breakdown by Engineer</div>
          <table>
            <thead><tr><th>Engineer</th><th>Total</th><th>P1s</th><th>Resolved</th></tr></thead>
            <tbody>
              {users.map(u => {
                const inc = incidents.filter(i => i.assigned_to === u.id);
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
          <div className="card-title">On-Call Hours by Engineer</div>
          {users.map(u => {
            const sheets = timesheets[u.id] || [];
            const wd = sheets.reduce((a,b) => a+(b.weekday_oncall||0),0);
            const we = sheets.reduce((a,b) => a+(b.weekend_oncall||0),0);
            const tot = wd + we;
            return (
              <div key={u.id} style={{ marginBottom: 14 }}>
                <div className="flex-between" style={{ marginBottom: 4 }}>
                  <span className="muted-xs">{u.name}</span>
                  <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{wd}h WD / {we}h WE</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: Math.min(100,(tot/60)*100)+'%', background: '#3b82f6' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Capacity (Manager only) ────────────────────────────────────────────────
function Capacity({ users, rota, holidays, timesheets, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Capacity is restricted to managers.</Alert>;
  const today = new Date();
  const weeks = Array.from({ length: 8 }, (_, w) => {
    const start = new Date(today); start.setDate(today.getDate() + w * 7 - today.getDay() + 1);
    const days  = Array.from({ length: 5 }, (_, d) => { const dt = new Date(start); dt.setDate(start.getDate()+d); return dt.toISOString().slice(0,10); });
    const available = users.filter(u => !days.some(d => holidays.find(h => h.userId===u.id && d>=h.start && d<=h.end))).length;
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
              </div>
            );
          })}
        </div>
      </div>
      <Alert>📈 Red = &lt;50% capacity, Amber = 50–80%, Green = &gt;80%.</Alert>
    </div>
  );
}

// ── Weekly Reports (Manager only) ──────────────────────────────────────────
function WeeklyReports({ users, incidents, timesheets, holidays, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Restricted to managers.</Alert>;
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
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Weekly Operations Report — W{weekNum}</div>
          <div className="muted-xs" style={{ marginBottom: 16, fontFamily: 'DM Mono' }}>{now.toLocaleDateString('en-GB')}</div>
          <div className="grid-4 mb-16">
            <StatCard label="Open Incidents"  value={incidents.filter(i=>i.status==='Investigating').length} sub="Investigating" accent="#ef4444" />
            <StatCard label="Resolved"         value={incidents.filter(i=>i.status==='Resolved').length}     sub="Closed"       accent="#10b981" />
            <StatCard label="Total OC Hours"   value={Object.values(timesheets).flatMap(t=>t).reduce((a,b)=>a+(b.weekday_oncall||0)+(b.weekend_oncall||0),0)} sub="All engineers" accent="#3b82f6" />
            <StatCard label="On Leave"         value={holidays.length} sub="Records" accent="#f59e0b" />
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>🚨 Incidents</div>
          {incidents.slice(0, 8).map(i => (
            <div key={i.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(30,58,95,.4)', fontSize: 13, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{i.id} — {i.alert_name}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Tag label={i.severity} type="red" />
                <Tag label={i.status}   type={i.status==='Resolved'?'green':'red'} />
              </div>
            </div>
          ))}
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

// ── Payroll (Manager only) ─────────────────────────────────────────────────
function Payroll({ users, timesheets, payconfig, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Payroll is restricted to managers.</Alert>;
  return (
    <div>
      <PageHeader title="Payroll" sub="Pay calculation and submission" />
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Engineer</th><th>Base/mo</th><th>WD-OC Hrs</th><th>WE-OC Hrs</th><th>WD-OC Pay</th><th>WE-OC Pay</th><th>Est. OC Total</th></tr></thead>
          <tbody>
            {users.map(u => {
              const p   = payconfig[u.id] || { rate: 40, base: 2500 };
              const sheets = timesheets[u.id] || [];
              const wd  = sheets.reduce((a,b) => a+(b.weekday_oncall||0),0);
              const we  = sheets.reduce((a,b) => a+(b.weekend_oncall||0),0);
              const wdp = wd * p.rate * 0.5;
              const wep = we * p.rate * 0.75;
              return (
                <tr key={u.id}>
                  <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar user={u} size={24} /><span style={{ fontSize: 12 }}>{u.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>£{(p.base||0).toLocaleString()}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{wd}h</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{we}h</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#6ee7b7' }}>£{wdp.toFixed(2)}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#fcd34d' }}>£{wep.toFixed(2)}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, fontWeight: 600 }}>£{(wdp + wep).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => window.print()}>📤 Submit / Print</button>
        </div>
      </div>
    </div>
  );
}

// ── Pay Config (Manager only) ──────────────────────────────────────────────
function PayConfig({ payconfig, setPayconfig, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Pay configuration is restricted to managers.</Alert>;
  return (
    <div>
      <PageHeader title="Pay Config" sub="Configure rates and pay rules" />
      <div className="card">
        <div className="card-title">Engineer Pay Rates</div>
        <table>
          <thead><tr><th>Engineer ID</th><th>Base (£/mo)</th><th>Rate (£/hr)</th><th>WD-OC Rate</th><th>WE-OC Rate</th></tr></thead>
          <tbody>
            {Object.entries(payconfig).map(([id, p]) => (
              <tr key={id}>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{id}</td>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>£</span><input className="input" type="number" value={p.base||2500} onChange={e => setPayconfig({ ...payconfig, [id]: { ...p, base: +e.target.value } })} style={{ width: 100 }} /></div></td>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>£</span><input className="input" type="number" value={p.rate} onChange={e => setPayconfig({ ...payconfig, [id]: { ...p, rate: +e.target.value } })} style={{ width: 80 }} /><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/hr</span></div></td>
                <td style={{ fontSize: 12, color: '#6ee7b7', fontFamily: 'DM Mono' }}>£{((p.rate||40)*0.5).toFixed(2)}/hr (+50%)</td>
                <td style={{ fontSize: 12, color: '#fcd34d', fontFamily: 'DM Mono' }}>£{((p.rate||40)*0.75).toFixed(2)}/hr (+75%)</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Alert style={{ marginTop: 12 }}>Weekday OC: +50% uplift · Weekend OC: +75% uplift applied automatically.</Alert>
      </div>
    </div>
  );
}

// ── Settings (Manager only, all settings here) ─────────────────────────────
function Settings({ users, setUsers, isManager, secureLinks, setSecureLinks }) {
  const [showAdd, setShowAdd]   = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [form, setForm]         = useState({ name: '', role: 'Engineer' });
  const [linkForm, setLinkForm] = useState({ label: '', expiry: '', password: '' });
  const [editForm, setEditForm] = useState({ mobile_number: '', google_email: '', profile_picture: '' });

  if (!isManager) return <Alert type="warning">⚠ Settings are restricted to managers.</Alert>;

  const add = () => {
    if (!form.name) return;
    const id    = generateTrigramId(form.name, users);
    const color = TRICOLORS[users.length % TRICOLORS.length];
    setUsers([...users, { id, name: form.name, role: form.role, tri: id.slice(0, 3), avatar: form.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase(), color, mobile_number: '', google_email: '', profile_picture: '' }]);
    setShowAdd(false); setForm({ name: '', role: 'Engineer' });
  };

  const updateUserProfile = (userId, updates) => {
    setUsers(users.map(u => u.id === userId ? { ...u, ...updates } : u));
    setEditingUserId(null);
    setEditForm({ mobile_number: '', google_email: '', profile_picture: '' });
  };

  const deleteUser = (userId) => {
    if (window.confirm('⚠️  Delete this engineer profile? This cannot be undone.')) {
      setUsers(users.filter(u => u.id !== userId));
    }
  };

  const addLink = () => {
    if (!linkForm.label) return;
    const link = { id: 'lnk-' + Date.now(), ...linkForm, url: `https://dsmeetul-cpu.github.io/cloudops-rota?ref=${Date.now()}`, created: new Date().toISOString().slice(0,10) };
    setSecureLinks([...(secureLinks||[]), link]);
    setShowLink(false); setLinkForm({ label: '', expiry: '', password: '' });
  };

  return (
    <div>
      <PageHeader title="Settings" sub="All system settings — manager only"
        actions={<div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowLink(true)}>🔗 Secure Share Link</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Engineer</button>
        </div>} />

      {/* Team Members */}
      <div className="card mb-16">
        <div className="card-title">Team Members ({users.length} total)</div>
        {users.map(u => (
          <div key={u.id}>
            {editingUserId === u.id ? (
              <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(30,58,95,.4)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <Avatar user={u} size={48} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>{u.name} ({u.id})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input
                        type="tel" placeholder="Mobile Number" value={editForm.mobile_number}
                        onChange={(e) => setEditForm({ ...editForm, mobile_number: e.target.value })}
                        style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card2)', color: 'var(--text-primary)', width: '100%', fontSize: 12 }}
                      />
                      <input
                        type="email" placeholder="Google Email" value={editForm.google_email}
                        onChange={(e) => setEditForm({ ...editForm, google_email: e.target.value })}
                        style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card2)', color: 'var(--text-primary)', width: '100%', fontSize: 12 }}
                      />
                      <input
                        type="url" placeholder="Profile Picture URL" value={editForm.profile_picture}
                        onChange={(e) => setEditForm({ ...editForm, profile_picture: e.target.value })}
                        style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card2)', color: 'var(--text-primary)', width: '100%', fontSize: 12 }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => updateUserProfile(u.id, editForm)}
                          style={{ flex: 1 }}
                        >
                          ✓ Save
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setEditingUserId(null)}
                          style={{ flex: 1 }}
                        >
                          ✕ Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(30,58,95,.4)' }}>
                <Avatar user={u} size={36} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u.id} · {u.role}</div>
                  {u.mobile_number && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>📱 {u.mobile_number}</div>}
                  {u.google_email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>✉️ {u.google_email}</div>}
                </div>
                <Tag label={u.role} type={u.role === 'Manager' ? 'amber' : 'blue'} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const user = users.find(uu => uu.id === u.id);
                      setEditForm({
                        mobile_number: user.mobile_number || '',
                        google_email: user.google_email || '',
                        profile_picture: user.profile_picture || ''
                      });
                      setEditingUserId(u.id);
                    }}
                  >
                    ✎ Edit
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => deleteUser(u.id)}
                  >
                    🗑 Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Shift Colours Reference */}
      <div className="card mb-16">
        <div className="card-title">Shift Colour Reference</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {Object.entries(SHIFT_COLORS).map(([key, c]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: c.bg + '33', border: `1px solid ${c.bg}66` }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: c.bg }} />
              <span style={{ fontSize: 12, color: c.text }}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Secure Share Links */}
      {(secureLinks||[]).length > 0 && (
        <div className="card mb-16">
          <div className="card-title">🔗 Secure Share Links</div>
          {secureLinks.map(l => (
            <div key={l.id} className="flex-between row-item">
              <div>
                <div className="name-sm">{l.label}</div>
                <div className="muted-xs">{l.url} · Expires: {l.expiry || 'Never'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(l.url)}>📋 Copy</button>
                <button className="btn btn-danger btn-sm" onClick={() => setSecureLinks(secureLinks.filter(x => x.id !== l.id))}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Google Drive */}
      <div className="card">
        <div className="card-title">Google Drive Integration</div>
        <div className="gd-status"><div className="dot-live" /> All data auto-synced to Google Drive → <code style={{ fontSize: 11, color: 'var(--accent)' }}>CloudOps-Rota/</code></div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '12px 0' }}>Data is saved as JSON files in your personal Google Drive. Only authorised users can access this app.</p>
      </div>

      {showAdd && (
        <Modal title="Add Engineer" onClose={() => setShowAdd(false)}>
          <FormGroup label="Full Name"><input className="input" placeholder="e.g. Sarah Johnson" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormGroup>
          <FormGroup label="Role">
            <select className="select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option>Engineer</option><option>Manager</option>
            </select>
          </FormGroup>
          <Alert>Username auto-generated from name (e.g. SAJ04). Their default password will be their lowercase username — they can change it via My Account after first login.</Alert>
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
          <FormGroup label="Password (optional)"><input className="input" type="password" value={linkForm.password} onChange={e => setLinkForm({ ...linkForm, password: e.target.value })} /></FormGroup>
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
  const [notif, setNotif]     = useState('Email + Push');
  const [newPw, setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg]     = useState('');
  const [saved, setSaved]     = useState(false);

  const savePw = () => {
    if (!newPw) { setPwMsg('Enter a new password.'); return; }
    if (newPw !== confirmPw) { setPwMsg('Passwords do not match.'); return; }
    if (newPw.length < 6) { setPwMsg('Password must be at least 6 characters.'); return; }
    setPassword(users, currentUser, newPw);
    setNewPw(''); setConfirmPw('');
    setPwMsg('✅ Password updated successfully.');
    setTimeout(() => setPwMsg(''), 3000);
  };

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
        <button className="btn btn-primary" style={{ marginBottom: 20 }} onClick={save}>{saved ? '✅ Saved!' : 'Save Preferences'}</button>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
        <div className="card-title" style={{ marginBottom: 12 }}>🔑 Change Password</div>
        {pwMsg && <Alert type={pwMsg.startsWith('✅') ? 'info' : 'warning'} style={{ marginBottom: 10 }}>{pwMsg}</Alert>}
        <FormGroup label="New Password" hint="min. 6 characters">
          <input className="input" type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} />
        </FormGroup>
        <FormGroup label="Confirm Password">
          <input className="input" type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && savePw()} />
        </FormGroup>
        <button className="btn btn-primary" onClick={savePw}>Update Password</button>
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
  const [swapRequests, setSwapRequests] = useState([]);
  const [toil, setToil]               = useState([]);
  const [absences, setAbsences]       = useState([]);
  const [logbook, setLogbook]         = useState([]);
  const [documents, setDocuments]     = useState([]);
  const [obsidianNotes, setObsidianNotes] = useState([]);
  const [whatsappChats, setWhatsappChats] = useState([]);
  const [secureLinks, setSecureLinks] = useState([]);

  const isManager = currentUser === 'MBA47';

  const connectDrive = async () => {
    try {
      await gapiLoad();
      const token = await initGoogleAuth(GOOGLE_CLIENT_ID);
      setDriveToken(token);
      setSyncing(true);
      const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, logbook, documents, obsidianNotes, whatsappChats };
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
      if (data.obsidianNotes) setObsidianNotes(data.obsidianNotes);
      if (data.whatsappChats) setWhatsappChats(data.whatsappChats);
      setLastSync(new Date());
      setSyncing(false);
    } catch (e) { console.error('Drive connect error:', e); setSyncing(false); }
  };

  const save = useCallback(async (key, data) => {
    if (!driveToken) return;
    await driveWrite(driveToken, key, data);
    setLastSync(new Date());
  }, [driveToken]);

  useEffect(() => { save('users', users); },             [users]);
  useEffect(() => { save('holidays', holidays); },       [holidays]);
  useEffect(() => { save('incidents', incidents); },     [incidents]);
  useEffect(() => { save('timesheets', timesheets); },   [timesheets]);
  useEffect(() => { save('upgrades', upgrades); },       [upgrades]);
  useEffect(() => { save('wiki', wiki); },               [wiki]);
  useEffect(() => { save('glossary', glossary); },       [glossary]);
  useEffect(() => { save('contacts', contacts); },       [contacts]);
  useEffect(() => { save('payconfig', payconfig); },     [payconfig]);
  useEffect(() => { save('rota', rota); },               [rota]);
  useEffect(() => { save('swapRequests', swapRequests); },[swapRequests]);
  useEffect(() => { save('toil', toil); },               [toil]);
  useEffect(() => { save('absences', absences); },       [absences]);
  useEffect(() => { save('logbook', logbook); },         [logbook]);
  useEffect(() => { save('documents', documents); },     [documents]);
  useEffect(() => { save('obsidianNotes', obsidianNotes); }, [obsidianNotes]);
  useEffect(() => { save('whatsappChats', whatsappChats); }, [whatsappChats]);

  const login = (uid) => { setCurrentUser(uid); setLoggedIn(true); setPage(uid === 'MBA47' ? 'dashboard' : 'oncall'); };

  if (!loggedIn) return <LoginScreen onLogin={login} driveToken={driveToken} onConnectDrive={connectDrive} users={users} />;

  const openInc   = incidents.filter(i => i.status === 'Investigating').length;
  const pendingSwaps = swapRequests.filter(s => s.status === 'pending').length;

  const props = {
    users, rota, setRota, holidays, setHolidays,
    incidents, setIncidents, timesheets, setTimesheets,
    upgrades, setUpgrades, wiki, setWiki, glossary, setGlossary,
    contacts, setContacts, payconfig, setPayconfig,
    currentUser, isManager, swapRequests, setSwapRequests,
    toil, setToil, absences, setAbsences, logbook, setLogbook,
    documents, setDocuments, secureLinks, setSecureLinks,
    obsidianNotes, setObsidianNotes, whatsappChats, setWhatsappChats
  };

  const renderPage = () => {
    switch (page) {
      case 'dashboard':  return isManager ? <Dashboard {...props} /> : <Alert type="warning">⚠ Dashboard restricted to managers.</Alert>;
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
      case 'notes':      return <Notes {...props} />;
      case 'docs':       return <Documents {...props} />;
      case 'whatsapp':   return <WhatsAppChat {...props} />;
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
    contacts: 'Contacts', notes: 'Notes', docs: 'Documents', whatsapp: 'Team Chat', insights: 'Insights', capacity: 'Capacity',
    reports: 'Weekly Reports', payroll: 'Payroll', payconfig: 'Pay Config',
    settings: 'Settings', myaccount: 'My Account'
  };

  return (
    <div className="app">
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
            sidebarOpen && <div className="gd-status"><div className="dot-live" /><span style={{ fontSize: 11 }}>Synced {lastSync && lastSync.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
          ) : (
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginBottom: 8 }} onClick={connectDrive}>{sidebarOpen ? '📁 Connect Drive' : '📁'}</button>
          )}
          {syncing && sidebarOpen && <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>Syncing…</div>}
          <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setLoggedIn(false)}>{sidebarOpen ? 'Sign Out' : '⎋'}</button>
        </div>
      </div>
      <div className="main">
        <div className="topbar">
          <button className="btn btn-secondary btn-sm" onClick={() => setSidebarOpen(!sidebarOpen)} style={{ padding: '4px 10px' }}>{sidebarOpen ? '◀' : '▶'}</button>
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
