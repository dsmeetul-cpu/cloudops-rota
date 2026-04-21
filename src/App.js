// src/App.js
// CloudOps Rota — Full Production Build v3
// Meetul Bhundia (MBA47) · Cloud Run Operations · 22nd April 2026

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
import {
  PERMISSION_SECTIONS, DEFAULT_PERMISSIONS, canDo, buildDefaultPerms, PermissionsManager
} from './permissions';

// ─────────────────────────────────────────────────────────────────────────────
// Google Drive auto-connects on page load using the OAuth Client ID below.
// Drive account: dsmeetul@gmail.com  |  Folder: CloudOps-Rota
// All app data is stored in this Drive. Engineers never need to connect manually.
// ─────────────────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '771489989549-di3h0cglt71ed7hmgtknksm3ks0afdtj.apps.googleusercontent.com';

// ── AUTH & DRIVE HELPERS ────────────────────────────────────────────────────
// Architecture:
//  • Manager (MBA47) connects Google Drive once. All app data lives in Drive.
//  • Non-manager users also connect Drive (read-only scope) so the app can
//    load the shared registry (users list, hashed passwords, profile pics).
//  • Passwords: stored hashed (btoa) in Drive's "auth_registry.json"
//    under { passwords: { UID: hash }, sheets_id: '' }.
//  • Google Sheets: Manager's session creates/updates "CloudOps-UserRegistry"
//    Sheet. Editing that sheet and pressing "Sync from Sheet" in Settings
//    updates the live registry.
//  • Profile pictures: uploaded as base64 data-URIs, stored in Drive's
//    "profile_pictures.json" keyed by user ID.

const hashPw = (pw) => btoa(unescape(encodeURIComponent(pw)));

// In-memory registry cache (loaded from Drive on login)
let _registry = null;
let _profilePics = {};

function getRegistry() { return _registry || { passwords: {}, sheets_id: '' }; }
function setRegistry(r) { _registry = r; }
function getProfilePics() { return _profilePics; }
function setProfilePics(p) { _profilePics = p || {}; }

function checkPassword(uid, pw) {
  const reg = getRegistry();
  if (!reg.passwords || !reg.passwords[uid]) return hashPw(uid.toLowerCase()) === hashPw(pw);
  return reg.passwords[uid] === hashPw(pw);
}

function updatePasswordInRegistry(uid, newPw) {
  const reg = getRegistry();
  if (!reg.passwords) reg.passwords = {};
  reg.passwords[uid] = hashPw(newPw);
  setRegistry({ ...reg });
  return { ...reg };
}

// ── Drive API helpers ──────────────────────────────────────────────────────
async function driveFindFile(token, name) {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name%3D'${encodeURIComponent(name)}'+and+trashed%3Dfalse&spaces=drive&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  return resp.files && resp.files.length > 0 ? resp.files[0] : null;
}

async function driveReadJson(token, fileId) {
  return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
}

async function driveWriteJson(token, name, data) {
  const body = JSON.stringify(data);
  const existing = await driveFindFile(token, name);
  if (existing) {
    return fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body
    }).then(r => r.json());
  }
  const meta = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/json' })
  }).then(r => r.json());
  return fetch(`https://www.googleapis.com/upload/drive/v3/files/${meta.id}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body
  }).then(r => r.json());
}

// ── Profile pictures ───────────────────────────────────────────────────────
async function uploadProfilePicture(driveToken, userId, file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUri = e.target.result;
      try {
        const pics = { ...getProfilePics(), [userId]: dataUri };
        setProfilePics(pics);
        await driveWriteJson(driveToken, 'profile_pictures.json', pics);
        resolve(dataUri);
      } catch (_) { resolve(dataUri); }
    };
    reader.readAsDataURL(file);
  });
}

async function loadProfilePictures(driveToken) {
  try {
    const f = await driveFindFile(driveToken, 'profile_pictures.json');
    if (f) { const p = await driveReadJson(driveToken, f.id); setProfilePics(p); return p; }
  } catch (_) {}
  return {};
}

// ── Registry sync (auth_registry.json + Google Sheet) ─────────────────────
async function syncRegistryToDrive(driveToken, registry, users) {
  if (!driveToken) return;
  try {
    await driveWriteJson(driveToken, 'auth_registry.json', registry);
    const sheetId = await syncUsersToSheet(driveToken, registry, users);
    if (sheetId && sheetId !== registry.sheets_id) {
      const updated = { ...registry, sheets_id: sheetId };
      setRegistry(updated);
      await driveWriteJson(driveToken, 'auth_registry.json', updated);
    }
  } catch (e) { console.error('Registry sync error:', e); }
}

async function syncUsersToSheet(driveToken, registry, users) {
  try {
    let sheetId = registry.sheets_id;
    if (!sheetId) {
      const createResp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: { title: 'CloudOps-UserRegistry' },
          sheets: [{ properties: { title: 'Users', sheetId: 0 } }]
        })
      }).then(r => r.json());
      sheetId = createResp.spreadsheetId;
    }
    const header = ['Username (ID)', 'Full Name', 'Role', 'Google Email', 'Mobile Number', 'Password (reset to this to unlock)', 'Avatar Initials', 'Colour'];
    const rows = [header, ...users.map(u => [
      u.id, u.name, u.role || 'Engineer',
      u.google_email || '', u.mobile_number || '',
      u.id.toLowerCase(), // default/reset password shown in plain text for manager reference
      u.avatar || '', u.color || ''
    ])];
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Users!A1:H${rows.length}?valueInputOption=RAW`,
      { method: 'PUT', headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: rows }) }
    );
    // Bold header row
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red:1,green:1,blue:1 } }, backgroundColor: { red: 0.07, green: 0.21, blue: 0.37 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } }] })
    });
    return sheetId;
  } catch (e) { console.error('Sheet sync error:', e); return registry.sheets_id || null; }
}

// Read rows back from the Sheet and apply any changes (name, email, mobile, role)
async function syncUsersFromSheet(driveToken, registry, users, setUsers) {
  if (!registry.sheets_id) return;
  try {
    const resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${registry.sheets_id}/values/Users!A2:H200`,
      { headers: { Authorization: `Bearer ${driveToken}` } }
    ).then(r => r.json());
    const rows = resp.values || [];
    const updated = users.map(u => {
      const row = rows.find(r => r[0] === u.id);
      if (!row) return u;
      return { ...u, name: row[1] || u.name, role: row[2] || u.role, google_email: row[3] || u.google_email, mobile_number: row[4] || u.mobile_number, avatar: row[6] || u.avatar, color: row[7] || u.color };
    });
    setUsers(updated);
  } catch (e) { console.error('Sync from sheet error:', e); }
}

async function loadRegistryFromDrive(driveToken) {
  try {
    const f = await driveFindFile(driveToken, 'auth_registry.json');
    if (f) { const reg = await driveReadJson(driveToken, f.id); setRegistry(reg); return reg; }
  } catch (e) { console.error('Registry load error:', e); }
  return null;
}

// Sanitise any rota from generateRota — strips Daily from Sat/Sun
function sanitiseRota(raw) {
  const out = {};
  Object.entries(raw || {}).forEach(([uid, days]) => {
    out[uid] = {};
    Object.entries(days || {}).forEach(([date, shift]) => {
      const dow = new Date(date + 'T12:00:00').getDay(); // noon avoids DST
      if (shift === 'daily' && (dow === 0 || dow === 6)) {
        out[uid][date] = 'off';
      } else {
        out[uid][date] = shift;
      }
    });
  });
  return out;
}
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
      // Use JSZip via CDN — no npm install required
      const loadJSZip = () => new Promise((resolve, reject) => {
        if (window.JSZip) { resolve(window.JSZip); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = () => resolve(window.JSZip);
        s.onerror = reject;
        document.head.appendChild(s);
      });
      try {
        const JSZip = await loadJSZip();
        const ab = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(ab);
        let text = '';
        // .docx: word/document.xml  |  .pptx: ppt/slides/*.xml  |  .xlsx: xl/sharedStrings.xml
        const targets = ext === 'docx' ? ['word/document.xml']
          : ext === 'pptx' ? Object.keys(zip.files).filter(n => n.startsWith('ppt/slides/slide') && n.endsWith('.xml'))
          : ['xl/sharedStrings.xml'];
        for (const t of targets) {
          const f = zip.file(t);
          if (f) { const xml = await f.async('text'); text += xml.replace(/<[^>]+>/g, ' ') + '\n'; }
        }
        text = text.replace(/\s+/g, ' ').trim().slice(0, 20000);
        const lines = text.split(/(?<=[.!?])\s+/).filter(Boolean);
        const html = '<p>' + lines.join('</p><p>') + '</p>';
        if (ref.current) { ref.current.innerHTML = html || `<p><em>📎 ${file.name} imported (no readable text found)</em></p>`; onChange && onChange(ref.current.innerHTML); }
      } catch {
        const msg = `<p><em>📎 Imported: <strong>${file.name}</strong></em></p><p style="color:#fcd34d">⚠ Could not extract text from this file. Try saving as .txt or .md first.</p>`;
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
function LoginScreen({ onLogin, driveToken, onConnectDrive, users, connectingDrive, driveReady }) {
  const [uid, setUid]               = useState('');
  const [pw, setPw]                 = useState('');
  const [err, setErr]               = useState('');
  const [show2FA, setShow2FA]       = useState(false);
  const [twoFACode, setTwoFACode]   = useState('');
  const [pending2FA, setPending2FA] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [forgotUid, setForgotUid]   = useState('');
  const [forgotMsg, setForgotMsg]   = useState('');
  const uidRef = useRef(null);

  useEffect(() => {
    if (driveReady && uidRef.current) uidRef.current.focus();
  }, [driveReady]);

  const handle = () => {
    const id = uid.trim().toUpperCase();
    if (!id) { setErr('Enter your username.'); return; }
    if (!driveReady) { setErr('Still loading team data — please wait or click Connect.'); return; }
    const userExists = users.find(u => u.id === id);
    if (!userExists) { setErr('Username not found. Contact your manager.'); return; }
    if (checkPassword(id, pw)) {
      setErr('');
      if (id === 'MBA47') { setPending2FA(id); setShow2FA(true); }
      else onLogin(id);
    } else {
      setErr('Incorrect password. Default is your username in lowercase (e.g. mva28).');
    }
  };

  const verify2FA = () => {
    if (twoFACode.length === 6) { onLogin(pending2FA); }
    else setErr('Enter the 6-digit code.');
  };

  const handleForgot = () => {
    const id = forgotUid.trim().toUpperCase();
    if (!users.find(u => u.id === id)) { setForgotMsg('Username not found. Contact your manager.'); return; }
    const reg = updatePasswordInRegistry(id, id.toLowerCase());
    if (driveToken) syncRegistryToDrive(driveToken, reg, users).catch(() => {});
    setForgotMsg('Password reset. Sign in with your username in lowercase.');
  };

  if (showForgot) return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">
          <div className="login-logo-icon">CR</div>
          <div className="login-title">Reset Password</div>
          <div className="login-sub">CloudOps Rota</div>
        </div>
        {forgotMsg
          ? <Alert type="info">✅ {forgotMsg}</Alert>
          : <Alert type="info">ℹ Your password resets to your username in lowercase.</Alert>}
        <FormGroup label="Your Username">
          <input className="input" placeholder="e.g. MVA28" value={forgotUid}
            onChange={e => setForgotUid(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleForgot()} autoFocus />
        </FormGroup>
        <button className="btn btn-primary" style={{ width: '100%', padding: 11 }} onClick={handleForgot}>Reset Password</button>
        <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }}
          onClick={() => { setShowForgot(false); setForgotMsg(''); setForgotUid(''); }}>← Back</button>
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

        {/* Drive status — only shown while loading or if manual connect needed */}
        {!driveReady && (
          <div style={{ marginBottom: 18, padding: '11px 14px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'rgba(59,130,246,0.04)',
            display: 'flex', alignItems: 'center', gap: 10 }}>
            {connectingDrive ? (
              <>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#fcd34d' }}>Loading team data…</span>
              </>
            ) : (
              <>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
                  Could not load automatically — click Connect
                </span>
                <button className="btn btn-primary btn-sm" onClick={onConnectDrive}
                  style={{ whiteSpace: 'nowrap', fontSize: 11 }}>🔗 Connect</button>
              </>
            )}
          </div>
        )}

        {err && <Alert type="warning" style={{ marginBottom: 14 }}>⚠ {err}</Alert>}

        {show2FA ? (
          <>
            <Alert type="info" style={{ marginBottom: 14 }}>🔐 Manager sign-in requires a 2FA code.</Alert>
            <FormGroup label="2FA Code">
              <input className="input" placeholder="6-digit code" maxLength={6} value={twoFACode}
                onChange={e => setTwoFACode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && verify2FA()} autoFocus />
            </FormGroup>
            <button className="btn btn-primary" style={{ width: '100%', padding: 12 }} onClick={verify2FA}>Verify & Sign In</button>
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }}
              onClick={() => { setShow2FA(false); setErr(''); }}>← Back</button>
          </>
        ) : (
          <>
            <FormGroup label="Username">
              <input ref={uidRef} className="input" placeholder="Your username (e.g. MVA28)"
                value={uid} onChange={e => setUid(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handle()} />
            </FormGroup>
            <FormGroup label="Password">
              <input className="input" type="password"
                placeholder={driveReady ? 'Password' : 'Waiting for team data…'}
                value={pw} onChange={e => setPw(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handle()}
                disabled={!driveReady} />
            </FormGroup>
            <button className="btn btn-primary"
              style={{ width: '100%', padding: 13, marginBottom: 10, fontSize: 15,
                opacity: driveReady ? 1 : 0.5 }}
              onClick={handle} disabled={!driveReady}>
              {driveReady ? 'Sign In' : '⏳ Loading…'}
            </button>
            <button className="btn btn-secondary btn-sm" style={{ width: '100%' }}
              onClick={() => setShowForgot(true)}>🔑 Forgot Password?</button>
            {driveReady && (
              <div style={{ marginTop: 14, padding: '8px 12px', borderRadius: 8,
                background: 'rgba(110,231,183,0.06)', border: '1px solid rgba(110,231,183,0.15)',
                display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="dot-live" />
                <span style={{ fontSize: 11, color: '#6ee7b7' }}>Team data loaded — ready to sign in</span>
              </div>
            )}
            <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.7 }}>
              Default password is your username in lowercase.<br />
              e.g. <strong style={{ color: 'var(--text-primary)' }}>MVA28</strong> → <strong style={{ color: 'var(--text-primary)' }}>mva28</strong>
            </div>
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
    { id: 'overtime',   icon: '🕐', label: 'Overtime'          },
    { id: 'logbook',    icon: '📓', label: 'Logbook'           },
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
function Dashboard({ users, rota, holidays, incidents, timesheets, swapRequests, absences, toil }) {
  const today    = new Date().toISOString().slice(0, 10);
  const onCallToday = users.filter(u => rota[u.id]?.[today] && rota[u.id][today] !== 'off');
  const openInc  = incidents.filter(i => i.status === 'Investigating');
  const totalOC  = Object.values(timesheets).flatMap(t => t).reduce((a, b) => a + (b.weekday_oncall || 0) + (b.weekend_oncall || 0), 0);
  const pendingSwaps = (swapRequests || []).filter(s => s.status === 'pending');
  const resolved = incidents.filter(i => i.status === 'Resolved').length;

  const sevCounts = { Disaster: 0, High: 0 };
  incidents.forEach(i => { if (sevCounts[i.severity] !== undefined) sevCounts[i.severity]++; });
  const sevColors = { Disaster: '#ef4444', High: '#f59e0b' };
  const sevTotal = incidents.length || 1;

  const PieChart = ({ data, colors, size = 100 }) => {
    let cumAngle = -90;
    const cx = size/2, cy = size/2, r = size/2 - 8;
    const entries = Object.entries(data).filter(([,v]) => v > 0);
    const total = entries.reduce((s,[,v]) => s+v, 0) || 1;
    const slices = entries.map(([k, v]) => {
      const pct = v / total;
      const startAngle = cumAngle;
      cumAngle += pct * 360;
      const start = { x: cx + r*Math.cos(startAngle*Math.PI/180), y: cy + r*Math.sin(startAngle*Math.PI/180) };
      const end   = { x: cx + r*Math.cos(cumAngle*Math.PI/180),   y: cy + r*Math.sin(cumAngle*Math.PI/180) };
      const large = pct > 0.5 ? 1 : 0;
      return { key: k, d: `M${cx},${cy} L${start.x},${start.y} A${r},${r},0,${large},1,${end.x},${end.y}Z`, color: colors[k], pct, v };
    });
    if (slices.length === 0) return React.createElement('svg', {width:size,height:size}, React.createElement('circle',{cx,cy,r,fill:'rgba(255,255,255,0.05)'}));
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map(s => <path key={s.key} d={s.d} fill={s.color} opacity={0.85} />)}
      </svg>
    );
  };

  const ocByUser = users.map(u => {
    const sheets = timesheets[u.id] || [];
    const wd = sheets.reduce((a,b) => a+(b.weekday_oncall||0), 0);
    const we = sheets.reduce((a,b) => a+(b.weekend_oncall||0), 0);
    return { name: u.name.split(' ')[0], wd, we, total: wd+we, user: u };
  });
  const maxOC = Math.max(...ocByUser.map(u => u.total), 1);

  const now = new Date();
  const weekTrend = Array.from({ length: 8 }, (_, i) => {
    const wStart = new Date(now); wStart.setDate(now.getDate() - (7 - i) * 7);
    const wEnd   = new Date(wStart); wEnd.setDate(wStart.getDate() + 6);
    const ws = wStart.toISOString().slice(0,10);
    const we = wEnd.toISOString().slice(0,10);
    const count = incidents.filter(inc => inc.date?.slice(0,10) >= ws && inc.date?.slice(0,10) <= we).length;
    return { label: `W-${7-i}`, count };
  });
  const maxTrend = Math.max(...weekTrend.map(w => w.count), 1);

  const statusCounts = { Investigating: openInc.length, Resolved: resolved };
  const statusColors = { Investigating: '#ef4444', Resolved: '#10b981' };
  const recentInc = [...incidents].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,5);
  const upcomingHols = (holidays || []).filter(h => h.start >= today).sort((a,b) => a.start.localeCompare(b.start)).slice(0,4);
  const thisMonth = today.slice(0,7);
  const absencesThisMonth = (absences||[]).filter(a => a.start?.startsWith(thisMonth)).length;
  const disasters = sevCounts.Disaster;

  return (
    <div>
      <PageHeader title="Manager Dashboard" sub="Cloud Run Operations · Full team visibility" />

      <div className="grid-4 mb-16">
        <StatCard label="Team Size"       value={users.length}         sub="engineers + manager"    accent="#3b82f6" icon="👥" />
        <StatCard label="Open Incidents"  value={openInc.length}       sub={`${resolved} resolved`} accent="#ef4444" icon="🚨" />
        <StatCard label="OC Hours"        value={totalOC + 'h'}        sub="All engineers total"    accent="#10b981" icon="⏱" />
        <StatCard label="Pending Swaps"   value={pendingSwaps.length}  sub="Awaiting approval"      accent="#818cf8" icon="🔁" />
      </div>

      <div className="grid-4 mb-16">
        <StatCard label="Disasters"       value={disasters}            sub="Critical severity"      accent="#ef4444" icon="🔴" />
        <StatCard label="High Severity"   value={sevCounts.High}       sub="Needs attention"        accent="#f59e0b" icon="🟠" />
        <StatCard label="Absences/Month"  value={absencesThisMonth}    sub={thisMonth}              accent="#f59e0b" icon="🏥" />
        <StatCard label="Incidents Total" value={incidents.length}     sub={`${Math.round((resolved/Math.max(incidents.length,1))*100)}% resolved`} accent="#6ee7b7" icon="📋" />
      </div>

      <div className="grid-2 mb-16">
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
          <div className="card-title">🎯 Incident Breakdown</div>
          {incidents.length === 0 ? <p className="muted-sm">No incidents logged 🎉</p> : (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>By Severity</div>
                <PieChart data={sevCounts} colors={sevColors} size={90} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                {Object.entries(sevCounts).map(([k,v]) => (
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <div style={{ width:10, height:10, borderRadius:'50%', background:sevColors[k] }} />
                      <span style={{ fontSize:12 }}>{k}</span>
                    </div>
                    <div style={{ fontFamily:'DM Mono', fontSize:12, color:sevColors[k] }}>{v} ({((v/sevTotal)*100).toFixed(0)}%)</div>
                  </div>
                ))}
                <div style={{ borderTop:'1px solid var(--border)', paddingTop:8, marginTop:6 }}>
                  <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:4 }}>By Status</div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <PieChart data={statusCounts} colors={statusColors} size={50} />
                    <div>
                      <div style={{ fontSize:11, color:'#ef4444' }}>🔴 {openInc.length} Open</div>
                      <div style={{ fontSize:11, color:'#10b981' }}>✅ {resolved} Resolved</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-title">📊 On-Call Hours per Engineer</div>
          {ocByUser.map(u => (
            <div key={u.name} style={{ marginBottom:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <Avatar user={u.user} size={18} />
                  <span style={{ fontSize:12 }}>{u.name}</span>
                </div>
                <span style={{ fontSize:11, fontFamily:'DM Mono', color:'var(--text-muted)' }}>{u.wd}h WD + {u.we}h WE = <strong style={{ color:'#6ee7b7' }}>{u.total}h</strong></span>
              </div>
              <div style={{ height:10, background:'var(--bg-card2)', borderRadius:5, overflow:'hidden', display:'flex' }}>
                <div style={{ width:`${(u.wd/maxOC)*100}%`, background:'#166534', transition:'width 0.4s' }} />
                <div style={{ width:`${(u.we/maxOC)*100}%`, background:'#854d0e', transition:'width 0.4s' }} />
              </div>
            </div>
          ))}
          <div style={{ display:'flex', gap:12, marginTop:8, fontSize:11, color:'var(--text-muted)' }}>
            <span><span style={{ background:'#166534', display:'inline-block', width:10, height:10, borderRadius:2, marginRight:4 }} />Weekday</span>
            <span><span style={{ background:'#854d0e', display:'inline-block', width:10, height:10, borderRadius:2, marginRight:4 }} />Weekend</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title">📈 Incident Trend — Last 8 Weeks</div>
          <div style={{ display:'flex', gap:4, alignItems:'flex-end', height:100 }}>
            {weekTrend.map(w => {
              const pct = (w.count / maxTrend) * 100;
              return (
                <div key={w.label} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                  <div style={{ fontSize:9, fontFamily:'DM Mono', color: w.count > 0 ? '#fcd34d' : 'var(--text-muted)' }}>{w.count || ''}</div>
                  <div style={{ width:'100%', height:70, background:'var(--bg-card2)', borderRadius:4, display:'flex', alignItems:'flex-end', overflow:'hidden' }}>
                    <div style={{ width:'100%', height:`${pct}%`, background: w.count === 0 ? 'transparent' : w.count > 3 ? '#ef4444' : '#f59e0b', transition:'height 0.4s' }} />
                  </div>
                  <div style={{ fontSize:8, color:'var(--text-muted)', textAlign:'center' }}>{w.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-title">🚨 Active Incidents</div>
          {openInc.map(i => {
            const sev = { Disaster:'#ef4444', High:'#f59e0b' }[i.severity] || '#f59e0b';
            return (
              <div key={i.id} className="row-item">
                <div style={{ width:8, height:8, borderRadius:'50%', background:sev, flexShrink:0, marginTop:4 }} />
                <div style={{ flex:1 }}>
                  <div className="name-sm">{i.alert_name || i.title}</div>
                  <div className="muted-xs">{i.severity} · {i.date} · {users.find(u=>u.id===i.assigned_to)?.name || i.assigned_to}{i.duration_hours ? ` · ${i.duration_hours}h` : ''}</div>
                </div>
                <Tag label={i.severity} type={i.severity==='Disaster'?'red':'amber'} />
              </div>
            );
          })}
          {openInc.length === 0 && <p className="muted-sm">No active incidents 🎉</p>}
        </div>

        <div className="card">
          <div className="card-title">🕐 Recent Incidents (Last 5)</div>
          <table style={{ fontSize:12 }}>
            <thead><tr><th>ID</th><th>Alert</th><th>Severity</th><th>Status</th><th>Duration</th></tr></thead>
            <tbody>
              {recentInc.map(i => {
                const sev = { Disaster:'#ef4444', High:'#f59e0b' }[i.severity] || '#f59e0b';
                return (
                  <tr key={i.id}>
                    <td style={{ fontFamily:'DM Mono', fontSize:11, color:'var(--accent)' }}>{i.id}</td>
                    <td style={{ maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{i.alert_name}</td>
                    <td><span style={{ background:sev+'25', color:sev, padding:'2px 6px', borderRadius:4, fontSize:10, fontWeight:600 }}>{i.severity}</span></td>
                    <td><Tag label={i.status} type={i.status==='Resolved'?'green':'red'} /></td>
                    <td style={{ fontFamily:'DM Mono', color:'#fcd34d' }}>{i.duration_hours ? `${i.duration_hours}h` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-title">🌴 Upcoming Holidays</div>
          {upcomingHols.length === 0 && <p className="muted-sm">No upcoming holidays</p>}
          {upcomingHols.map(h => {
            const u = users.find(x => x.id === h.userId);
            const days = Math.ceil((new Date(h.end)-new Date(h.start))/86400000)+1;
            return (
              <div key={h.id} className="flex-between row-item">
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <Avatar user={u || {avatar:'?',color:'#475569'}} size={22} />
                  <div>
                    <div className="name-sm">{u?.name}</div>
                    <div className="muted-xs">{h.start} → {h.end} ({days}d)</div>
                  </div>
                </div>
                <Tag label={h.type||'Annual Leave'} type="amber" />
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="card-title">🔁 Pending Swap Requests</div>
          {pendingSwaps.length === 0 && <p className="muted-sm">No pending swaps</p>}
          {pendingSwaps.slice(0,4).map(s => {
            const req = users.find(u => u.id === s.requesterId);
            const tgt = users.find(u => u.id === s.targetId);
            return (
              <div key={s.id} className="row-item">
                <div style={{ flex:1 }}>
                  <div className="name-sm">{req?.name} ↔ {tgt?.name}</div>
                  <div className="muted-xs">{s.reqDate} ↔ {s.tgtDate}</div>
                </div>
                <Tag label="Pending" type="amber" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-title">👥 Engineer Overview</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ minWidth: 920 }}>
            <thead>
              <tr><th>Engineer</th><th>Role</th><th>Today's Shift</th><th>OC Hours</th><th>Open Incidents</th><th>Resolved</th><th>Incident Hrs</th><th>Holidays Used</th><th>TOIL Bal</th></tr>
            </thead>
            <tbody>
              {users.map(u => {
                const sheets = timesheets[u.id] || [];
                const oc = sheets.reduce((a,b)=>a+(b.weekday_oncall||0)+(b.weekend_oncall||0),0);
                const incHrs = sheets.filter(e=>e.week&&e.week.startsWith('INC')).reduce((a,e)=>a+(e.weekday_oncall||0)+(e.weekend_oncall||0),0);
                const userInc = incidents.filter(i=>i.assigned_to===u.id);
                const openUserInc = userInc.filter(i=>i.status==='Investigating').length;
                const resolvedUserInc = userInc.filter(i=>i.status==='Resolved').length;
                const holDays = (holidays||[]).filter(h=>h.userId===u.id&&h.type==='Annual Leave').reduce((a,h)=>a+Math.ceil((new Date(h.end)-new Date(h.start))/86400000)+1,0);
                const toilBal = calcTOILBalance(sheets, toil||[], u.id);
                const todayShift = rota[u.id]?.[today];
                const col = todayShift ? (SHIFT_COLORS[todayShift]||{}) : null;
                return (
                  <tr key={u.id}>
                    <td><div style={{ display:'flex', gap:8, alignItems:'center' }}><Avatar user={u} size={24} /><div><div style={{ fontSize:12, fontWeight:500 }}>{u.name}</div><div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>{u.id}</div></div></div></td>
                    <td><Tag label={u.role||'Engineer'} type={u.role==='Manager'?'amber':'blue'} /></td>
                    <td>{col ? <span style={{ background:col.bg+'33', color:col.text, padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600 }}>{col.label}</span> : <span style={{ fontSize:11, color:'var(--text-muted)' }}>Off</span>}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#6ee7b7' }}>{oc}h</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color: openUserInc>0?'#ef4444':'var(--text-muted)' }}>{openUserInc}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#10b981' }}>{resolvedUserInc}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color: incHrs>0?'#f59e0b':'var(--text-muted)' }}>{incHrs>0?`${incHrs}h`:'—'}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12 }}>{holDays}/25d</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color: toilBal.balance>0?'#38bdf8':'#fca5a5' }}>{toilBal.balance}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Who's On Call ──────────────────────────────────────────────────────────
function OnCall({ users, rota }) {
  const today = new Date();
  const [viewMode, setViewMode] = useState('week'); // 'week' | 'month' | 'year'
  const [viewOffset, setViewOffset] = useState(0); // weeks or months offset
  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const exportIcal = (user) => {
    const content = generateICalFeed(rota[user.id] || {}, user.name);
    downloadIcal(content, `cloudops-rota-${user.id}.ics`);
  };

  const cellStyle = (s) => {
    const c = SHIFT_COLORS[s];
    if (!c) return { background: 'transparent', color: 'var(--text-muted)' };
    return { background: c.bg + '55', color: c.text, border: `1px solid ${c.bg}88` };
  };

  // Build weeks array based on viewMode
  const getWeeks = () => {
    if (viewMode === 'week') {
      const base = new Date(today);
      base.setDate(base.getDate() - ((base.getDay() + 6) % 7) + viewOffset * 7);
      return [Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(base.getDate() + i); return d; })];
    }
    if (viewMode === 'month') {
      const base = new Date(today.getFullYear(), today.getMonth() + viewOffset, 1);
      const firstDow = (base.getDay() + 6) % 7;
      const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      const weeksArr = [];
      let weekDays = [];
      for (let pre = 0; pre < firstDow; pre++) {
        const d = new Date(base); d.setDate(1 - firstDow + pre); weekDays.push(d);
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(base.getFullYear(), base.getMonth(), day);
        weekDays.push(d);
        if (weekDays.length === 7) { weeksArr.push(weekDays); weekDays = []; }
      }
      if (weekDays.length > 0) {
        while (weekDays.length < 7) { const last = weekDays[weekDays.length-1]; const d = new Date(last); d.setDate(last.getDate()+1); weekDays.push(d); }
        weeksArr.push(weekDays);
      }
      return weeksArr;
    }
    // year: show all remaining months from today
    const yearWeeks = [];
    const yearStart = new Date(today.getFullYear(), 0, 1);
    for (let m = 0; m < 12; m++) {
      const mStart = new Date(today.getFullYear() + viewOffset, m, 1);
      const firstDow = (mStart.getDay() + 6) % 7;
      const daysInMonth = new Date(mStart.getFullYear(), m + 1, 0).getDate();
      const monthWeeks = [];
      let wDays = [];
      for (let pre = 0; pre < firstDow; pre++) { const d = new Date(mStart); d.setDate(1-firstDow+pre); wDays.push(d); }
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(mStart.getFullYear(), m, day); wDays.push(d);
        if (wDays.length === 7) { monthWeeks.push(wDays); wDays = []; }
      }
      if (wDays.length > 0) { while (wDays.length < 7) { const last = wDays[wDays.length-1]; const d = new Date(last); d.setDate(last.getDate()+1); wDays.push(d); } monthWeeks.push(wDays); }
      yearWeeks.push({ month: m, year: mStart.getFullYear(), weeks: monthWeeks });
    }
    return yearWeeks;
  };

  const viewLabel = () => {
    if (viewMode === 'week') {
      const base = new Date(today); base.setDate(base.getDate() - ((base.getDay()+6)%7) + viewOffset*7);
      const end = new Date(base); end.setDate(base.getDate()+6);
      return `${base.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${end.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`;
    }
    if (viewMode === 'month') {
      const d = new Date(today.getFullYear(), today.getMonth() + viewOffset, 1);
      return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }
    return `${today.getFullYear() + viewOffset}`;
  };

  const renderWeekTable = (week, key) => (
    <div key={key} className="card" style={{ overflowX: 'auto', marginBottom: 12 }}>
      <table style={{ minWidth: 620 }}>
        <thead>
          <tr>
            <th>Engineer</th>
            {week.map((d, i) => {
              const ds = d.toISOString().slice(0,10);
              const bh = UK_BANK_HOLIDAYS.find(b => b.date === ds);
              const isToday = ds === today.toISOString().slice(0,10);
              return (
                <th key={i} style={{ textAlign:'center', fontSize:11, color: bh ? '#fca5a5' : isToday ? 'var(--accent)' : undefined }}>
                  {DAYS[i]}<br />
                  <span style={{ fontFamily:'DM Mono', fontSize:10 }}>{d.getDate()}{bh?'🔴':''}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <Avatar user={u} size={26} />
                  <div>
                    <div style={{ fontSize:12, fontWeight:500 }}>{u.name}</div>
                    <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>{u.id}</div>
                  </div>
                </div>
              </td>
              {week.map(d => {
                const ds = d.toISOString().slice(0,10);
                const s  = rota[u.id]?.[ds] || 'off';
                const c  = cellStyle(s);
                const isToday = ds === today.toISOString().slice(0,10);
                return (
                  <td key={ds} style={{ textAlign:'center', background: isToday ? 'rgba(59,130,246,0.08)' : undefined }}>
                    <div style={{ ...c, borderRadius:6, padding:'4px 6px', fontSize:10, fontWeight:600, minWidth:32, display:'inline-block' }}>
                      {s === 'off' ? '—' : (SHIFT_COLORS[s]?.label?.slice(0,4) || s)}
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

  const data = getWeeks();

  return (
    <div>
      <PageHeader title="Who's On Call" sub="Team schedule — week, month, or full year view" />
      <ShiftLegend />

      {/* View controls */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ display:'flex', gap:4 }}>
          {['week','month','year'].map(m => (
            <button key={m} className={`btn btn-sm ${viewMode===m?'btn-primary':'btn-secondary'}`}
              onClick={() => { setViewMode(m); setViewOffset(0); }}>
              {m === 'week' ? 'Week' : m === 'month' ? 'Month' : 'Full Year'}
            </button>
          ))}
        </div>
        {viewMode !== 'year' && (
          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(o => o-1)}>← Prev</button>
            <span style={{ fontSize:13, color:'var(--text-secondary)', minWidth:200, textAlign:'center' }}>{viewLabel()}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(o => o+1)}>Next →</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(0)}>Today</button>
          </div>
        )}
        {viewMode === 'year' && (
          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(o => o-1)}>← {today.getFullYear()+viewOffset-1}</button>
            <span style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', minWidth:80, textAlign:'center' }}>{today.getFullYear()+viewOffset}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(o => o+1)}>{today.getFullYear()+viewOffset+1} →</button>
          </div>
        )}
      </div>

      {/* Render based on mode */}
      {viewMode === 'week' && renderWeekTable(data[0], 'week')}
      {viewMode === 'month' && (
        <div>
          <div className="card mb-8" style={{ padding:'8px 14px', fontSize:14, fontWeight:600, color:'var(--text-primary)' }}>
            {viewLabel()}
          </div>
          {data.map((week, wi) => renderWeekTable(week, `week-${wi}`))}
        </div>
      )}
      {viewMode === 'year' && (
        <div>
          {data.map(({ month, year, weeks }) => (
            <div key={month} style={{ marginBottom: 24 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'var(--accent)', marginBottom:8, padding:'4px 0', borderBottom:'1px solid var(--border)' }}>
                📅 {MONTHS[month]} {year}
              </div>
              {weeks.map((week, wi) => renderWeekTable(week, `${month}-${wi}`))}
            </div>
          ))}
        </div>
      )}

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:8 }}>
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
    // myDate (the date needing cover) is required; targetId required; theirDate is optional
    if (!swapForm.myDate || !swapForm.targetId) return;
    setSwapRequests([...(swapRequests || []), {
      id: 'swap-' + Date.now(), requesterId: currentUser, targetId: swapForm.targetId,
      reqDate: swapForm.myDate,
      tgtDate: swapForm.theirDate || '', // optional - engineer may just need cover
      reason: swapForm.reason,
      coverOnly: !swapForm.theirDate, // flag: just needs coverage, no specific date to swap
      status: 'pending', created: new Date().toISOString().slice(0, 10)
    }]);
    setSwapModal(false); setSwapForm({ myDate: '', targetId: '', theirDate: '', reason: '' });
  };

  const cancelSwap = (swapId) => {
    if (!window.confirm('Cancel this swap request?')) return;
    setSwapRequests((swapRequests || []).filter(s => s.id !== swapId));
  };

  const mySwaps = (swapRequests || []).filter(s => s.requesterId === currentUser || s.targetId === currentUser);

  return (
    <div>
      <PageHeader title="My Shift" sub={`${user?.name} · ${user?.id}`}
        actions={<button className="btn btn-primary" onClick={() => setSwapModal(true)}>🔁 Request Cover / Swap</button>} />
      <div className="grid-2 mb-16">
        <div className="card" style={{ borderColor: todayShift && todayShift !== 'off' ? 'var(--accent)' : undefined }}>
          <div className="card-title">Today's Shift</div>
          {todayShift && todayShift !== 'off' ? (
            <div style={{ fontSize: 22, fontWeight: 600, color: SHIFT_COLORS[todayShift]?.text || 'var(--text-primary)', marginBottom: 6 }}>
              {SHIFT_COLORS[todayShift]?.label || todayShift}
            </div>
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
                <button className="btn btn-secondary btn-sm" onClick={() => { setSwapForm({ myDate: date, targetId: '', theirDate: '', reason: '' }); setSwapModal(true); }}>
                  🔁 Cover / Swap
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {mySwaps.length > 0 && (
        <div className="card mb-16">
          <div className="card-title">🔁 My Swap / Cover Requests</div>
          {mySwaps.map(s => {
            const other = users.find(u => u.id === (s.requesterId === currentUser ? s.targetId : s.requesterId));
            const isMine = s.requesterId === currentUser;
            return (
              <div key={s.id} className="flex-between row-item">
                <div style={{ flex: 1 }}>
                  <div className="name-sm">
                    {isMine ? 'You requested' : `${other?.name} requested`}
                    {s.coverOnly ? ' cover' : ' a swap'}
                  </div>
                  <div className="muted-xs">
                    📅 {s.reqDate}
                    {s.tgtDate ? ` ↔ ${s.tgtDate}` : ' (cover only)'}
                    {' · with '}{other?.name}
                  </div>
                  {s.reason && <div className="muted-xs">Reason: {s.reason}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Tag label={s.status} type={s.status === 'approved' ? 'green' : s.status === 'rejected' ? 'red' : 'amber'} />
                  {isMine && s.status === 'pending' && (
                    <button className="btn btn-danger btn-sm" onClick={() => cancelSwap(s.id)}>✕ Cancel</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {swapModal && (
        <Modal title="Request Cover or Shift Swap" onClose={() => setSwapModal(false)}>
          <Alert type="info" style={{ marginBottom: 12 }}>
            💡 Use this to request cover for a day you can't work, or to swap a shift with a colleague. "Their date" is optional — leave blank if you just need someone to cover your shift.
          </Alert>
          <FormGroup label="Date I need covered *">
            <input className="input" type="date" value={swapForm.myDate} onChange={e => setSwapForm({ ...swapForm, myDate: e.target.value })} />
          </FormGroup>
          <FormGroup label="Ask engineer *">
            <select className="select" value={swapForm.targetId} onChange={e => setSwapForm({ ...swapForm, targetId: e.target.value })}>
              <option value="">Select engineer…</option>
              {users.filter(u => u.id !== currentUser).map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Their date to swap (optional)" hint="Leave blank if you just need cover">
            <input className="input" type="date" value={swapForm.theirDate} onChange={e => setSwapForm({ ...swapForm, theirDate: e.target.value })} />
          </FormGroup>
          <FormGroup label="Reason">
            <input className="input" placeholder="e.g. Medical appointment, personal commitment" value={swapForm.reason} onChange={e => setSwapForm({ ...swapForm, reason: e.target.value })} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setSwapModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={requestSwap} disabled={!swapForm.myDate || !swapForm.targetId}>
              Submit Request
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Calendar ───────────────────────────────────────────────────────────────
function CalendarView({ users, rota, holidays, upgrades, absences }) {
  const [cur, setCur] = useState(new Date());
  const yr = cur.getFullYear(), mo = cur.getMonth();
  const first    = new Date(yr, mo, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMo = new Date(yr, mo + 1, 0).getDate();
  const cells    = [...Array(startDow).fill(null), ...Array.from({ length: daysInMo }, (_, i) => i + 1)];
  const MONTHS   = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div>
      <PageHeader title="Calendar" sub="Rota, upgrades, holidays &amp; absences"
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={() => setCur(new Date(yr, mo - 1, 1))}>← Prev</button>
          <div className="month-label">{MONTHS[mo]} {yr}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setCur(new Date())}>Today</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setCur(new Date(yr, mo + 1, 1))}>Next →</button>
        </>} />
      <ShiftLegend />
      {/* Extra legend for holidays/absences */}
      <div style={{ display:'flex', gap:12, marginBottom:10, flexWrap:'wrap', fontSize:11, color:'var(--text-muted)' }}>
        <span><span style={{ background:'#16534233', border:'1px solid #166534', display:'inline-block', width:10, height:10, borderRadius:2, marginRight:4 }} />Holiday</span>
        <span><span style={{ background:'#dc267733', border:'1px solid #dc2677', display:'inline-block', width:10, height:10, borderRadius:2, marginRight:4 }} />Sick/Absence</span>
      </div>
      <div className="cal-grid">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="cal-header">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={'e' + i} />;
          const ds  = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const bh  = UK_BANK_HOLIDAYS.find(b => b.date === ds);
          const upgs = upgrades.filter(u => u.date === ds);
          const oncalls = users.filter(u => rota[u.id]?.[ds] && rota[u.id][ds] !== 'off');
          const holsToday = (holidays||[]).filter(h => ds >= h.start && ds <= (h.end||h.start));
          const absToday  = (absences||[]).filter(a => ds >= a.start && ds <= (a.end||a.start));
          const isToday = ds === new Date().toISOString().slice(0, 10);
          return (
            <div key={ds} className={`cal-day${isToday ? ' today' : ''}`}>
              <div className="cal-day-num" style={{ color: bh ? '#fca5a5' : undefined }}>{day}{bh && ' 🔴'}</div>
              {bh && <div className="cal-event ev-red" style={{ fontSize:9 }}>{bh.name}</div>}
              {upgs.map(u => <div key={u.id} className="cal-event" style={{ background:'#991b1b55', color:'#fecaca', border:'1px solid #991b1b88', fontSize:9, padding:'1px 3px', borderRadius:3 }}>⬆ {u.name.slice(0,12)}</div>)}
              {holsToday.map(h => {
                const u = users.find(x => x.id === h.userId);
                return <div key={h.id} style={{ background:'#16534233', color:'#6ee7b7', border:'1px solid #166534', fontSize:9, padding:'1px 3px', borderRadius:3, marginTop:1 }}>🌴 {u?.name?.split(' ')[0]||h.userId}</div>;
              })}
              {absToday.map(a => {
                const u = users.find(x => x.id === a.userId);
                return <div key={a.id} style={{ background:'#dc267733', color:'#f9a8d4', border:'1px solid #dc2677', fontSize:9, padding:'1px 3px', borderRadius:3, marginTop:1 }}>🏥 {u?.name?.split(' ')[0]||a.userId}</div>;
              })}
              {oncalls.slice(0, 2).map(u => {
                const s = rota[u.id][ds];
                const c = SHIFT_COLORS[s] || {};
                return <div key={u.id} style={{ background:(c.bg||'#1e40af')+'55', color:c.text||'#bfdbfe', border:`1px solid ${(c.bg||'#1e40af')}88`, fontSize:9, padding:'1px 3px', borderRadius:3, marginTop:1 }}>{u.name.split(' ')[0]}</div>;
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
  const [editCell, setEditCell]   = useState(null);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkShift, setBulkShift] = useState('daily');
  const [swapSuggestion, setSwapSuggestion] = useState(null);
  const [viewMode, setViewMode]   = useState('compact'); // 'compact' | 'hours'
  const DAYS = ['M','T','W','T','F','S','S'];
  // managerUnlocked: global toggle — rota is read-only by default.
  // Manager must click the 🔒 unlock button in the toolbar to enable editing.
  const [managerUnlocked, setManagerUnlocked] = useState(false);

  // lockedCells: Set of "userId::date" strings — protected from Clear/Generate
  const [lockedCells, setLockedCells] = useState(new Set());
  const toggleLock  = (userId, date) => {
    const key = `${userId}::${date}`;
    setLockedCells(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const isLocked = (userId, date) => lockedCells.has(`${userId}::${date}`);

  // Editing is only allowed when the manager has explicitly unlocked
  const canEdit = isManager && managerUnlocked;

  // Shift hour definitions
  const SHIFT_HOURS = {
    daily:       { start: '10:00', end: '19:00', label: '10am – 7pm',   desc: 'Daily Shift (Mon–Fri)',             standbyHrs: 0,  workedHrs: 9  },
    evening:     { start: '19:00', end: '07:00', label: '7pm – 7am',    desc: 'Weekday On-Call (Mon–Thu)',         standbyHrs: 12, workedHrs: 0  },
    weekend:     { start: '19:00', end: '07:00', label: '7pm – 7am',    desc: 'Weekend On-Call (Fri 7pm–Mon 7am)', standbyHrs: 60, workedHrs: 0  },
    bankholiday: { start: '09:00', end: '07:00', label: '9am – 7am',    desc: 'Bank Holiday On-Call',              standbyHrs: 22, workedHrs: 0  },
    upgrade:     { start: '00:00', end: '23:59', label: 'All day',       desc: 'Upgrade Day',                      standbyHrs: 0,  workedHrs: 8  },
    holiday:     { start: '',      end: '',       label: 'Holiday',       desc: 'Annual Leave',                     standbyHrs: 0,  workedHrs: 0  },
  };

  const generate = () => {
    if (!isManager) return;
    const generated = sanitiseRota(generateRota(users, startDate, weeks));
    // Merge: for each user+date, keep existing manual entry if one exists.
    // Only fill in dates that are currently 'off' / not set.
    setRota(prev => {
      const merged = { ...generated };
      users.forEach(u => {
        const existing = prev[u.id] || {};
        const genDates = generated[u.id] || {};
        merged[u.id] = { ...genDates };
        Object.entries(existing).forEach(([date, shift]) => {
          if (shift && shift !== 'off') {
            // Manual entry wins — keep it regardless of what generate produced
            merged[u.id][date] = shift;
          }
        });      });
      return merged;
    });
    setGenerated(true);
  };

  const setCell = (userId, date, shift) => {
    if (!canEdit) return;
    const dow = new Date(date).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const safeShift = (shift === 'daily' && isWeekend) ? 'weekend' : shift;
    setRota(prev => ({ ...prev, [userId]: { ...(prev[userId] || {}), [date]: safeShift } }));
    setEditCell(null);
  };

  const deleteCell = (userId, date) => {
    if (!canEdit) return;
    const next = JSON.parse(JSON.stringify(rota));
    if (next[userId]) delete next[userId][date];
    setRota(next);
  };

  const toggleBulk = (userId, date) => {
    if (!canEdit) return;
    const key = `${userId}::${date}`;
    setBulkSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  const applyBulk = () => {
    if (!isManager) return; // Only managers can bulk edit
    const next = JSON.parse(JSON.stringify(rota));
    bulkSelected.forEach(key => {
      const [uid, date] = key.split('::');
      next[uid] = { ...(next[uid] || {}), [date]: bulkShift };
    });
    setRota(next); setBulkSelected(new Set());
  };

  const deleteBulk = () => {
    if (!isManager) return; // Only managers can bulk delete
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
  // Snap startDate to the Monday of the chosen week (fixes day offset bug)
  const weekStarts = Array.from({ length: weeks }, (_, w) => {
    const d = new Date(startDate + 'T12:00:00'); // use noon to avoid DST issues
    const dow = d.getDay(); // 0=Sun,1=Mon…6=Sat
    const toMon = (dow === 0) ? -6 : 1 - dow; // offset back to Monday
    d.setDate(d.getDate() + toMon + w * 7);
    return d;
  });

  return (
    <div>
      <PageHeader title="Rota Management" sub={isManager ? 'Generate & manage on-call schedule' : 'View on-call schedule'} />
      {isManager && (
        <div className="card mb-16">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div className="card-title" style={{ marginBottom:0 }}>⚙ Generate & Controls</div>
            {/* Global lock/unlock toggle — rota is locked by default */}
            <button
              onClick={() => setManagerUnlocked(v => !v)}
              style={{
                display:'flex', alignItems:'center', gap:6,
                background: managerUnlocked ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.12)',
                border: `1px solid ${managerUnlocked ? '#ef4444' : '#22c55e'}`,
                borderRadius:8, padding:'6px 14px', cursor:'pointer',
                color: managerUnlocked ? '#fca5a5' : '#4ade80',
                fontSize:12, fontWeight:600, transition:'all 0.2s'
              }}>
              {managerUnlocked ? '🔓 Unlocked — editing enabled' : '🔒 Locked — click to enable editing'}
            </button>
          </div>
          {!managerUnlocked && (
            <div style={{ padding:'8px 12px', background:'rgba(34,197,94,0.06)', border:'1px solid rgba(34,197,94,0.2)', borderRadius:6, fontSize:11, color:'#4ade80', marginBottom:12 }}>
              🔒 Rota is in read-only mode. Click <strong>Locked</strong> above to unlock and enable editing.
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <FormGroup label="Start Date">
              <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: 180 }} />
            </FormGroup>
            <FormGroup label="Weeks">
              <select className="select" value={weeks} onChange={e => setWeeks(+e.target.value)} style={{ width: 120 }}>
                {[2,4,6,8,12,16,24,26,52].map(w => <option key={w} value={w}>{w} week{w>=52?' (1 year)':w>=26?' (6 months)':w>=12?' (3 months)':''}</option>)}
              </select>
            </FormGroup>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="btn btn-primary" onClick={generate} disabled={!canEdit} style={{ opacity: canEdit ? 1 : 0.4 }}>🔄 Generate Rota</button>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>🔒 Keeps manual entries</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="btn btn-secondary" disabled={!canEdit} style={{ opacity: canEdit ? 1 : 0.4 }} onClick={() => {
                if (!canEdit) return;
                if (window.confirm('⚠️  Regenerate from scratch? Locked cells will be preserved, all others overwritten.')) {
                  const fresh = sanitiseRota(generateRota(users, startDate, weeks));
                  setRota(prev => {
                    const merged = { ...fresh };
                    users.forEach(u => {
                      merged[u.id] = { ...(fresh[u.id] || {}) };
                      Object.entries(prev[u.id] || {}).forEach(([date, shift]) => {
                        if (isLocked(u.id, date)) merged[u.id][date] = shift;
                      });
                    });
                    return merged;
                  });
                  setGenerated(true);
                }
              }}>↺ Force Regenerate</button>
              <div style={{ fontSize: 9, color: 'rgba(255,80,80,0.5)', textAlign: 'center' }}>⚠ Overwrites all shifts</div>
            </div>
            <button className="btn btn-danger" disabled={!canEdit} style={{ opacity: canEdit ? 1 : 0.4 }} onClick={() => {
              if (!canEdit) return;
              if (window.confirm('⚠️  Clear all rota entries? Locked cells will be preserved.')) {
                setRota(prev => {
                  const next = {};
                  users.forEach(u => {
                    next[u.id] = {};
                    Object.entries(prev[u.id] || {}).forEach(([date, shift]) => {
                      if (isLocked(u.id, date)) next[u.id][date] = shift;
                    });
                  });
                  return next;
                });
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
      {/* View mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>View:</span>
        <button className={`btn btn-sm ${viewMode === 'compact' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setViewMode('compact')}>
          📋 Compact
        </button>
        <button className={`btn btn-sm ${viewMode === 'hours' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setViewMode('hours')}>
          🕐 Hours / Timeline
        </button>
        {viewMode === 'hours' && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
            Daily: 10am–7pm · Evening OC: 7pm–7am · Weekend OC: 7pm–7am
          </span>
        )}
      </div>
      {weekStarts.map((ws, wi) => {
        // Build 8 dates so overnight shifts from day 7 into day 8 can be detected
        const wdates = Array.from({ length: 8 }, (_, d) => {
          const dt = new Date(ws); dt.setDate(ws.getDate() + d); return dt;
        });
        const hourCols = Array.from({ length: 24 }, (_, h) => h);

        // Returns true if this hour on this day is "active" for a given engineer,
        // taking into account that overnight shifts (evening/weekend 19:00–07:00)
        // started the PREVIOUS day and run until 07:00 on THIS day.
        const getHourActive = (userId, dateStr, hour) => {
          const hol  = holidays.find(h => h.userId === userId && dateStr >= h.start && dateStr <= h.end);
          const bh   = UK_BANK_HOLIDAYS.find(b => b.date === dateStr);
          const upg  = upgrades.find(up => up.date === dateStr && up.attendees?.includes(userId));
          const thisShift = hol ? 'holiday' : bh ? 'bankholiday' : upg ? 'upgrade' : (rota[userId]?.[dateStr] || 'off');

          // Hours from 07 onwards belong to THIS day's shift
          if (hour >= 7) {
            if (thisShift === 'daily')   return hour < 19 ? 'daily'   : null;
            if (thisShift === 'evening') return hour >= 19 ? 'evening' : null;
            if (thisShift === 'weekend') return hour >= 19 ? 'weekend' : null;
            if (thisShift === 'upgrade' || thisShift === 'holiday' || thisShift === 'bankholiday') return thisShift;
            return null;
          }

          // Hours 00–06 belong to an OVERNIGHT shift that started on the PREVIOUS day
          const prevDate = new Date(dateStr);
          prevDate.setDate(prevDate.getDate() - 1);
          const prevDs = prevDate.toISOString().slice(0, 10);
          const pHol = holidays.find(h => h.userId === userId && prevDs >= h.start && prevDs <= h.end);
          const pBh  = UK_BANK_HOLIDAYS.find(b => b.date === prevDs);
          const pUpg = upgrades.find(up => up.date === prevDs && up.attendees?.includes(userId));
          const prevShift = pHol ? 'holiday' : pBh ? 'bankholiday' : pUpg ? 'upgrade' : (rota[userId]?.[prevDs] || 'off');
          if (prevShift === 'evening') return 'evening';
          if (prevShift === 'weekend') return 'weekend';
          return null;
        };

        // ── Hours / Timeline view ──────────────────────────────────────────
        if (viewMode === 'hours') {
          return (
            <div key={wi} className="card mb-12">
              <div className="card-title" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                Week of {ws.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>

              {/* Hour axis header — shown once at top */}
              <div style={{ display: 'flex', marginLeft: 100, marginBottom: 2 }}>
                {hourCols.map(h => (
                  <div key={h} style={{ flex: 1, textAlign: 'center', fontSize: 7, color: 'rgba(255,255,255,0.3)', fontFamily: 'DM Mono', borderRight: h < 23 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                    {h % 3 === 0 ? String(h).padStart(2,'0') : ''}
                  </div>
                ))}
              </div>

              {wdates.slice(0, 7).map((d, di) => {
                const ds    = d.toISOString().slice(0, 10);
                const bh    = UK_BANK_HOLIDAYS.find(b => b.date === ds);
                const dow   = d.getDay();
                const isWkd = dow === 0 || dow === 6;
                const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                return (
                  <div key={ds} style={{ marginBottom: 8 }}>
                    {/* Day label row */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
                      <div style={{
                        width: 100, flexShrink: 0, paddingRight: 8,
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start'
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: bh ? '#fca5a5' : isWkd ? 'rgba(255,255,255,0.5)' : 'var(--text-secondary)' }}>
                          {DAY_NAMES[dow]} {d.getDate()} {MONTH_NAMES[d.getMonth()]}
                        </span>
                        {bh && <span style={{ fontSize: 8, color: '#fca5a5' }}>🔴 Bank Holiday</span>}
                      </div>
                      {/* Thin midnight-divider bar */}
                      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
                    </div>

                    {/* Per-engineer rows */}
                    {users.map(u => {
                      const hol   = holidays.find(h => h.userId === u.id && ds >= h.start && ds <= h.end);
                      const upg   = upgrades.find(up => up.date === ds && up.attendees?.includes(u.id));
                      const shift = hol ? 'holiday' : bh ? 'bankholiday' : upg ? 'upgrade' : (rota[u.id]?.[ds] || 'off');
                      const col   = SHIFT_COLORS[shift] || {};
                      const isEditing = editCell?.userId === u.id && editCell?.date === ds;
                      return (
                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                          <div style={{ width: 100, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, paddingRight: 8 }}>
                            <Avatar user={u} size={16} />
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 66 }}>{u.name.split(' ')[0]}</span>
                          </div>
                          <div
                            style={{ flex: 1, height: 24, borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', position: 'relative', display: 'flex', cursor: isManager ? 'pointer' : 'default', overflow: 'hidden' }}
                            onDoubleClick={() => isManager && setEditCell({ userId: u.id, date: ds })}
                            title={isManager ? 'Double-click to edit' : undefined}
                          >
                            {isEditing && isManager ? (
                              <select autoFocus className="select" style={{ fontSize: 10, padding: '2px 4px', width: '100%', height: '100%', background: 'var(--bg-card2)', border: 'none', color: 'var(--text-primary)', zIndex: 2 }}
                                defaultValue={shift}
                                onBlur={e => setCell(u.id, ds, e.target.value)}
                                onChange={e => { setCell(u.id, ds, e.target.value); }}>
                                <option value="off">Off</option>
                                {!isWkd && <option value="daily">Daily (10am–7pm)</option>}
                                {(dow >= 1 && dow <= 4) && <option value="evening">Weekday OC (7pm–7am)</option>}
                                <option value="weekend">Weekend OC (7pm–7am)</option>
                              </select>
                            ) : (
                              <>
                                {hourCols.map(h => {
                                  const activeShift = getHourActive(u.id, ds, h);
                                  const ac = activeShift ? (SHIFT_COLORS[activeShift] || col) : null;
                                  return (
                                    <div key={h}
                                      title={`${String(h).padStart(2,'0')}:00${activeShift ? ' — ' + (SHIFT_COLORS[activeShift]?.label || activeShift) : ''}`}
                                      style={{ flex: 1, background: ac ? (ac.bg || '#1e40af') + 'dd' : 'transparent', borderRight: h < 23 ? '1px solid rgba(0,0,0,0.12)' : 'none' }}
                                    />
                                  );
                                })}
                                {shift !== 'off' && (
                                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                                    <span style={{ fontSize: 9, fontWeight: 700, color: col.text || '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)', letterSpacing: 0.2 }}>
                                      {hol ? '🌴 Holiday' : bh ? '🔴 Bank Hol' : upg ? '⬆ Upgrade' : col.label}
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Hour axis footer labels */}
              <div style={{ display: 'flex', marginLeft: 100, marginTop: 4 }}>
                {hourCols.map(h => (
                  <div key={h} style={{ flex: 1, textAlign: 'center', fontSize: 7, color: 'rgba(255,255,255,0.2)', fontFamily: 'DM Mono' }}>
                    {h % 6 === 0 ? String(h).padStart(2,'0') : ''}
                  </div>
                ))}
              </div>
              {isManager && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>💡 Double-click any row to edit that shift</div>}
            </div>
          );
        }

        // ── Compact view (default) ─────────────────────────────────────────
        // Overnight shifts (evening/weekend 19:00–07:00) are shown with a "→" overflow
        // indicator on the day they start, and a "←" carry-over on the next morning.
        return (
          <div key={wi} className="card mb-12" style={{ overflowX: 'auto' }}>
            <div className="card-title" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Week of {ws.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
            <table style={{ minWidth: 540, borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 130, paddingBottom: 6 }}>Engineer</th>
                  {wdates.slice(0, 7).map((d, di) => {
                    const ds    = d.toISOString().slice(0, 10);
                    const bh    = UK_BANK_HOLIDAYS.find(b => b.date === ds);
                    const dow   = d.getDay();
                    const isWkd = dow === 0 || dow === 6;
                    const DAY_FULL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                    const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    return (
                      <th key={di} style={{
                        textAlign: 'center', fontSize: 10, paddingBottom: 6,
                        color: bh ? '#fca5a5' : isWkd ? 'rgba(255,255,255,0.35)' : 'var(--text-secondary)',
                        background: isWkd ? 'rgba(255,255,255,0.025)' : undefined,
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                        minWidth: 68,
                      }}>
                        <div style={{ fontWeight: 800, fontSize: 11 }}>{DAY_FULL[dow]}</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 10, opacity: 0.8 }}>
                          {d.getDate()} {MON_SHORT[d.getMonth()]}{bh ? ' 🔴' : ''}
                        </div>
                        <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', fontFamily: 'DM Mono', marginTop: 1 }}>
                          {bh ? '—' : isWkd ? '19:00–07:00' : dow === 5 ? '10:00 / 19:00→' : '10:00 / 19:00→'}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ paddingRight: 8, paddingTop: 3, paddingBottom: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Avatar user={u} size={24} />
                        <span style={{ fontSize: 12 }}>{u.name.split(' ')[0]}</span>
                      </div>
                    </td>
                    {wdates.slice(0, 7).map((d, di) => {
                      const ds   = d.toISOString().slice(0, 10);
                      const hol  = holidays.find(h => h.userId === u.id && ds >= h.start && ds <= h.end);
                      const bh   = UK_BANK_HOLIDAYS.find(b => b.date === ds);
                      const upg  = upgrades.find(up => up.date === ds && up.attendees?.includes(u.id));
                      const s    = hol ? 'holiday' : bh ? 'bankholiday' : upg ? 'upgrade' : (rota[u.id]?.[ds] || 'off');
                      const col  = SHIFT_COLORS[s] || {};
                      const hrs  = SHIFT_HOURS[s];
                      const key  = `${u.id}::${ds}`;
                      const isBulkSel = bulkSelected.has(key);
                      const isEditing = editCell?.userId === u.id && editCell?.date === ds;
                      const dow  = d.getDay();
                      const isWkd = dow === 0 || dow === 6;

                      // Check if this cell's shift overflows into next day (overnight)
                      const isOvernight = (s === 'evening' || s === 'weekend');

                      // Check if previous day had an overnight shift that carries into this cell's morning
                      const prevDate = new Date(d); prevDate.setDate(d.getDate() - 1);
                      const prevDs = prevDate.toISOString().slice(0, 10);
                      const prevHol = holidays.find(h => h.userId === u.id && prevDs >= h.start && prevDs <= h.end);
                      const prevBh  = UK_BANK_HOLIDAYS.find(b => b.date === prevDs);
                      const prevUpg = upgrades.find(up => up.date === prevDs && up.attendees?.includes(u.id));
                      const prevS   = prevHol ? 'holiday' : prevBh ? 'bankholiday' : prevUpg ? 'upgrade' : (rota[u.id]?.[prevDs] || 'off');
                      const hasCarryOver = (prevS === 'evening' || prevS === 'weekend') && s === 'off';
                      const prevCol = SHIFT_COLORS[prevS] || {};

                      return (
                        <td key={ds} style={{
                          textAlign: 'center', padding: '3px 2px',
                          background: isWkd ? 'rgba(255,255,255,0.02)' : undefined,
                          verticalAlign: 'top',
                        }}>
                          {isEditing && isManager ? (
                            <select autoFocus className="select" style={{ fontSize: 10, padding: '2px 4px', width: 100 }}
                              defaultValue={s} onBlur={e => setCell(u.id, ds, e.target.value)}
                              onChange={e => setCell(u.id, ds, e.target.value)}>
                              <option value="off">Off</option>
                              {!isWkd && <option value="daily">Daily (10–19)</option>}
                              {(dow >= 1 && dow <= 4) && <option value="evening">Eve OC (19→07)</option>}
                              <option value="weekend">Wknd OC (19→07)</option>
                            </select>
                          ) : (
                            <>
                              {/* Main shift badge */}
                              <div
                                onClick={() => isManager && toggleBulk(u.id, ds)}
                                onDoubleClick={() => isManager && setEditCell({ userId: u.id, date: ds })}
                                title={s !== 'off' ? `${col.label || s}${hrs ? ' · ' + hrs.label : ''}` : (isManager ? 'Double-click to assign shift' : '')}
                                style={{
                                  background: col.bg ? col.bg + '55' : 'transparent',
                                  color: col.text || 'var(--text-muted)',
                                  border: isBulkSel ? '2px solid #3b82f6' : col.bg ? `1px solid ${col.bg}88` : '1px solid transparent',
                                  borderRadius: 6, padding: '4px 4px', fontSize: 9, fontWeight: 600,
                                  cursor: isManager ? 'pointer' : 'default', userSelect: 'none', lineHeight: 1.3, minWidth: 30,
                                }}>
                                {hol ? '🌴' : bh ? '🔴' : upg ? '⬆' : s === 'off' ? '—' : col.label?.slice(0,4) || s}
                                {isOvernight && (
                                  <div style={{ fontSize: 7, color: col.text, opacity: 0.8, marginTop: 1 }}>
                                    →07:00
                                  </div>
                                )}
                              </div>
                              {/* Carry-over morning badge from previous day's overnight shift */}
                              {hasCarryOver && (
                                <div style={{
                                  marginTop: 2,
                                  background: (prevCol.bg || '#166534') + '33',
                                  color: prevCol.text || '#bbf7d0',
                                  border: `1px solid ${prevCol.bg || '#166534'}66`,
                                  borderRadius: 6, padding: '2px 4px', fontSize: 8, fontWeight: 600,
                                  lineHeight: 1.3,
                                }}>
                                  ←07:00
                                  <div style={{ fontSize: 7, opacity: 0.8 }}>cont.</div>
                                </div>
                              )}
                            </>
                          )}
                          {isManager && s !== 'off' && !isEditing && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginTop: 2 }}>
                              {canEdit && (
                                <button
                                  onClick={e => { e.stopPropagation(); toggleLock(u.id, ds); }}
                                  title={isLocked(u.id, ds) ? 'Unlock this cell' : 'Lock to protect from Clear/Generate'}
                                  style={{ background: 'none', border: 'none', fontSize: 9, cursor: 'pointer', padding: 0, color: isLocked(u.id, ds) ? '#f59e0b' : 'rgba(255,255,255,0.25)', lineHeight: 1 }}>
                                  {isLocked(u.id, ds) ? '🔒' : '🔓'}
                                </button>
                              )}
                              {!canEdit && isLocked(u.id, ds) && (
                                <span style={{ fontSize: 9, color: '#f59e0b', lineHeight: 1 }}>🔒</span>
                              )}
                              {canEdit && <button onClick={() => deleteCell(u.id, ds)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 8, cursor: 'pointer', padding: 0 }}>✕</button>}
                            </div>
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

// ── Incident Tabs (Issue | Actions | Solution) ────────────────────────────
function IncidentTabs({ form, setForm }) {
  const [activeTab, setActiveTab] = useState('issue');

  const TABS = [
    { id: 'issue',   label: '🔴 Issue',         color: '#fca5a5', border: 'rgba(239,68,68,0.4)',   bg: 'rgba(239,68,68,0.12)'   },
    { id: 'actions', label: '⚙️ Actions Taken',  color: '#fcd34d', border: 'rgba(245,158,11,0.4)',  bg: 'rgba(245,158,11,0.12)'  },
    { id: 'solution',label: '✅ Solution',        color: '#6ee7b7', border: 'rgba(16,185,129,0.4)',  bg: 'rgba(16,185,129,0.12)'  },
  ];

  const attachImages = (field, files) => {
    const readers = Array.from(files).map(f => new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(f); }));
    Promise.all(readers).then(imgs => setForm(prev => ({ ...prev, [field]: [...(prev[field]||[]), ...imgs] })));
  };
  const removeImage = (field, i) => setForm(prev => ({ ...prev, [field]: (prev[field]||[]).filter((_,j) => j !== i) }));

  const tab = TABS.find(t => t.id === activeTab);

  return (
    <div style={{ marginTop: 16 }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 16px', borderRadius: '8px 8px 0 0', border: `1px solid ${t.border}`,
              borderBottom: activeTab === t.id ? '1px solid var(--bg-card2)' : `1px solid ${t.border}`,
              background: activeTab === t.id ? t.bg : 'var(--bg-card)',
              color: activeTab === t.id ? t.color : 'var(--text-muted)',
              fontWeight: activeTab === t.id ? 700 : 400, fontSize: 12, cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
            {t.label}
            {/* Badge if content exists */}
            {(activeTab !== t.id) && (
              (t.id === 'issue' && (form.issue_desc || (form.issue_images||[]).length > 0)) ||
              (t.id === 'actions' && (form.actions_desc || form.actions_code || (form.actions_images||[]).length > 0)) ||
              (t.id === 'solution' && form.solution_desc)
            ) ? <span style={{ marginLeft: 5, background: t.color, color: '#000', borderRadius: '50%', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>✓</span> : null}
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <div style={{ border: `1px solid ${tab.border}`, borderRadius: '0 8px 8px 8px', background: tab.bg, padding: 14 }}>
        {/* Attach image button always at top */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <label style={{ cursor: 'pointer', fontSize: 12, color: 'var(--accent)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)' }}>
            📎 Attach Image
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => {
              const field = activeTab === 'issue' ? 'issue_images' : activeTab === 'actions' ? 'actions_images' : 'solution_images';
              attachImages(field, e.target.files); e.target.value = '';
            }} />
          </label>
        </div>

        {activeTab === 'issue' && (
          <>
            <RichEditor value={form.issue_desc} onChange={v => setForm(f => ({ ...f, issue_desc: v }))} placeholder="Describe the issue — what happened, what was impacted, error messages…" rows={6} />
            {(form.issue_images||[]).length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {form.issue_images.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt={`issue-${i}`} style={{ width: 110, height: 85, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                    <button onClick={() => removeImage('issue_images', i)} style={{ position: 'absolute', top: 2, right: 2, background: '#ef4444', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'actions' && (
          <>
            <RichEditor value={form.actions_desc} onChange={v => setForm(f => ({ ...f, actions_desc: v }))} placeholder="What actions were taken? Commands run, services restarted, people contacted…" rows={6} />
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Code Block / Command Output</div>
              <textarea className="input" style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, minHeight: 80, background: 'rgba(0,0,0,0.4)' }}
                placeholder="Paste commands, logs, or results here…" value={form.actions_code||''}
                onChange={e => setForm(f => ({ ...f, actions_code: e.target.value }))} />
            </div>
            {(form.actions_images||[]).length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {form.actions_images.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt={`action-${i}`} style={{ width: 110, height: 85, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                    <button onClick={() => removeImage('actions_images', i)} style={{ position: 'absolute', top: 2, right: 2, background: '#ef4444', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'solution' && (
          <>
            <RichEditor value={form.solution_desc} onChange={v => setForm(f => ({ ...f, solution_desc: v }))} placeholder="How was it resolved? Root cause, fix applied, follow-up actions required…" rows={6} />
            {(form.solution_images||[]).length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {form.solution_images.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt={`solution-${i}`} style={{ width: 110, height: 85, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                    <button onClick={() => removeImage('solution_images', i)} style={{ position: 'absolute', top: 2, right: 2, background: '#ef4444', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Incidents ──────────────────────────────────────────────────────────────
const INC_SEVERITIES = [
  { value: 'Disaster', label: '🔴 Disaster', color: '#ef4444' },
  { value: 'High',     label: '🟠 High',     color: '#f59e0b' },
];

function Incidents({ users, incidents, setIncidents, currentUser, isManager, timesheets, setTimesheets }) {
  const [showModal, setShowModal] = useState(false);
  const [viewInc, setViewInc]    = useState(null);
  const [editInc, setEditInc]    = useState(null);
  const [filter, setFilter]      = useState('all');
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(incidents);

  const EMPTY_FORM = {
    alert_name: '', vm_service: '', severity: 'Disaster', assigned_to: currentUser,
    kb_ref: '', ticket_ref: '', email_ref: '',
    issue_desc: '', issue_images: [],
    actions_desc: '', actions_images: [], actions_code: '',
    solution_desc: '',
    duration_hours: ''
  };
  const [form, setForm] = useState(EMPTY_FORM);

  const openAdd = () => { setForm({ ...EMPTY_FORM, assigned_to: currentUser }); setEditInc(null); setShowModal(true); };
  const openEdit = (inc, e) => { e.stopPropagation(); setForm({ ...inc }); setEditInc(inc.id); setShowModal(true); };

  const save = () => {
    if (!form.alert_name) return;
    // Build combined desc for backward compat display
    const combinedDesc = [
      form.issue_desc ? `<h3>🔴 Issue</h3>${form.issue_desc}` : '',
      form.actions_desc ? `<h3>⚙️ Actions Taken</h3>${form.actions_desc}${form.actions_code ? `<pre style="background:rgba(0,0,0,0.4);padding:10px;border-radius:6px;overflow:auto;font-size:12px">${form.actions_code}</pre>` : ''}` : '',
      form.solution_desc ? `<h3>✅ Solution</h3>${form.solution_desc}` : '',
    ].filter(Boolean).join('');
    if (editInc) {
      setIncidents(incidents.map(i => i.id === editInc ? { ...i, ...form, desc: combinedDesc } : i));
    } else {
      const id = 'INC-' + String(incidents.length + 1).padStart(3, '0');
      setIncidents([{ id, ...form, desc: combinedDesc, status: 'Investigating', reporter: currentUser, date: new Date().toISOString().slice(0, 16).replace('T', ' '), updates: [] }, ...incidents]);
      if (form.duration_hours && form.assigned_to && setTimesheets) {
        const incDate = new Date().toISOString().slice(0, 10);
        const dow = new Date().getDay();
        const isWE = dow === 0 || dow === 6;
        const hrs = +form.duration_hours;
        const weekLabel = `INC ${id}`;
        setTimesheets(prev => ({
          ...prev,
          [form.assigned_to]: [
            {
              week: weekLabel,
              weekday_oncall: isWE ? 0 : hrs,
              weekend_oncall: isWE ? hrs : 0,
              worked_wd: isWE ? 0 : hrs,
              worked_we: isWE ? hrs : 0,
              standby_wd: 0, standby_we: 0,
              notes: `Auto-logged: ${form.alert_name} on ${incDate} (${hrs}h)`
            },
            ...(prev[form.assigned_to] || [])
          ]
        }));
      }
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
            <option value="Disaster">🔴 Disaster</option>
            <option value="High">🟠 High</option>
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
              <th>Assigned To</th><th>Duration</th><th>KB Ref</th><th>Date</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...filtered].sort((a, b) => new Date(b.date) - new Date(a.date)).map(i => {
              const sev = INC_SEVERITIES.find(s => s.value === i.severity) || INC_SEVERITIES[0];
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
                  <td style={{ fontSize: 11, fontFamily: 'DM Mono', color: i.duration_hours ? '#fcd34d' : 'var(--text-muted)' }}>{i.duration_hours ? `${i.duration_hours}h` : '—'}</td>
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
          {/* Row 1: core fields */}
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
            <FormGroup label="Duration (Hours)" hint="Auto-added to timesheets & payroll">
              <select className="select" value={form.duration_hours} onChange={e => setForm({ ...form, duration_hours: e.target.value })}>
                <option value="">Select duration…</option>
                {[1,2,3,4,5,6,7,8,9,10,11,12].map(h => <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>)}
              </select>
            </FormGroup>
          </div>

          {/* Tabbed: Issue | Actions | Solution */}
          <IncidentTabs form={form} setForm={setForm} />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
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
            {viewInc.duration_hours && <div className="muted-xs">⏱ Duration: <span style={{ color: '#fcd34d' }}>{viewInc.duration_hours}h</span></div>}
          </div>
          {/* Structured sections */}
          {viewInc.issue_desc && (
            <div style={{ marginBottom: 12, border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: 'rgba(239,68,68,0.12)', padding: '6px 12px', fontWeight: 600, fontSize: 12, color: '#fca5a5' }}>🔴 Issue</div>
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: viewInc.issue_desc }} />
              {(viewInc.issue_images||[]).length > 0 && <div style={{ padding: '0 12px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{viewInc.issue_images.map((img,i) => <img key={i} src={img} alt="" style={{ maxWidth: 200, maxHeight: 150, borderRadius: 6, border: '1px solid var(--border)' }} />)}</div>}
            </div>
          )}
          {viewInc.actions_desc && (
            <div style={{ marginBottom: 12, border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: 'rgba(245,158,11,0.12)', padding: '6px 12px', fontWeight: 600, fontSize: 12, color: '#fcd34d' }}>⚙️ Actions Taken</div>
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: viewInc.actions_desc }} />
              {viewInc.actions_code && <pre style={{ margin: '0 12px 10px', background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: 6, fontSize: 12, overflow: 'auto', color: '#6ee7b7' }}>{viewInc.actions_code}</pre>}
              {(viewInc.actions_images||[]).length > 0 && <div style={{ padding: '0 12px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{viewInc.actions_images.map((img,i) => <img key={i} src={img} alt="" style={{ maxWidth: 200, maxHeight: 150, borderRadius: 6, border: '1px solid var(--border)' }} />)}</div>}
            </div>
          )}
          {viewInc.solution_desc && (
            <div style={{ marginBottom: 12, border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: 'rgba(16,185,129,0.12)', padding: '6px 12px', fontWeight: 600, fontSize: 12, color: '#6ee7b7' }}>✅ Solution</div>
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: viewInc.solution_desc }} />
            </div>
          )}
          {/* Fallback for old-format incidents */}
          {!viewInc.issue_desc && !viewInc.actions_desc && !viewInc.solution_desc && viewInc.desc && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: viewInc.desc || '' }} />
          )}
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
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {users.map(u => (
          <StatCard key={u.id} label={u.name?.split(' ')[0] || u.id} value={remainingDays(u.id) + ' days'} sub="Annual leave left" accent="#10b981" />
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
              const u = users.find(x => x.id === h.userId) || users.find(x => x.id?.toLowerCase() === h.userId?.toLowerCase());
              const d = h.end ? Math.ceil((new Date(h.end) - new Date(h.start)) / 86400000) + 1 : 1;
              const displayName = u?.name || h.userId || '—';
              return (
                <tr key={h.id}>
                  <td><input type="checkbox" checked={selected.has(h.id)} onChange={() => toggleOne(h.id)} /></td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar user={u || { avatar: (h.userId||'?').slice(0,2).toUpperCase(), color: '#475569' }} size={24} /><span style={{ fontSize: 12 }}>{displayName}</span></div></td>
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
    const tgtShift = swap.tgtDate ? newRota[swap.targetId]?.[swap.tgtDate] : null;
    if (reqShift) { newRota[swap.targetId] = { ...(newRota[swap.targetId]||{}), [swap.reqDate]: reqShift }; delete newRota[swap.requesterId][swap.reqDate]; }
    if (tgtShift && swap.tgtDate) { newRota[swap.requesterId] = { ...(newRota[swap.requesterId]||{}), [swap.tgtDate]: tgtShift }; delete newRota[swap.targetId][swap.tgtDate]; }
    setRota(newRota);
    setSwapRequests(all.map(s => s.id === swapId ? { ...s, status: 'approved' } : s));
  };

  const cancelRequest = (id) => {
    if (!window.confirm('Cancel this request?')) return;
    setSwapRequests(all.filter(s => s.id !== id));
  };

  const deleteOne  = (id, e) => { e.stopPropagation(); setSwapRequests(all.filter(s => s.id !== id)); };
  const deleteBulk = () => { setSwapRequests(all.filter(s => !selected.has(s.id))); clearAll(); };

  return (
    <div>
      <PageHeader title="Shift Swaps &amp; Cover Requests" sub="All shift swap and cover requests — managers approve/reject" />
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
              <th>Requester</th><th>Date Needed</th><th>Ask</th><th>Swap Date</th><th>Type</th><th>Reason</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {all.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No swap or cover requests yet</td></tr>}
            {[...all].sort((a,b) => new Date(b.created) - new Date(a.created)).map(s => {
              const req = users.find(u => u.id === s.requesterId);
              const tgt = users.find(u => u.id === s.targetId);
              const isMine = s.requesterId === currentUser;
              return (
                <tr key={s.id}>
                  {isManager && <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} /></td>}
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={req} size={22} /><span style={{ fontSize: 12 }}>{req?.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{s.reqDate}</td>
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={tgt} size={22} /><span style={{ fontSize: 12 }}>{tgt?.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{s.tgtDate || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td><Tag label={s.coverOnly ? 'Cover Only' : 'Swap'} type={s.coverOnly ? 'purple' : 'blue'} /></td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.reason || '—'}</td>
                  <td><Tag label={s.status} type={s.status==='approved'?'green':s.status==='pending'?'amber':'red'} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {isManager && s.status === 'pending' && <>
                        <button className="btn btn-success btn-sm" onClick={() => approve(s.id)}>✓</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setSwapRequests(all.map(x => x.id===s.id?{...x,status:'rejected'}:x))}>✗</button>
                      </>}
                      {isManager && <>
                        <button className="btn btn-secondary btn-sm" onClick={e => openEdit(s, e)}>✏</button>
                        <button className="btn btn-danger btn-sm" onClick={e => deleteOne(s.id, e)}>🗑</button>
                      </>}
                      {/* Engineer can cancel their own pending request */}
                      {!isManager && isMine && s.status === 'pending' && (
                        <button className="btn btn-danger btn-sm" onClick={() => cancelRequest(s.id)}>✕ Cancel</button>
                      )}
                    </div>
                  </td>
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
function UpgradeDays({ users, upgrades, setUpgrades, isManager, currentUser, timesheets, setTimesheets }) {
  const [showModal, setShowModal]   = useState(false);
  const [editId, setEditId]         = useState(null);
  const [form, setForm]             = useState({ date: '', startTime: '', name: '', desc: '' });
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeForm, setCompleteForm] = useState({ upgradeId: '', completedTime: '' });
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(upgrades);

  const openAdd  = () => { setForm({ date: '', startTime: '', name: '', desc: '' }); setEditId(null); setShowModal(true); };
  const openEdit = (up, e) => { e.stopPropagation(); setForm({ date: up.date, startTime: up.startTime || '', name: up.name, desc: up.desc || '' }); setEditId(up.id); setShowModal(true); };

  const save = () => {
    if (!form.date || !form.name || !form.startTime) return;
    if (editId) {
      setUpgrades(upgrades.map(u => u.id === editId ? { ...u, ...form } : u));
    } else {
      setUpgrades([...upgrades, { id: 'u' + Date.now(), ...form, attendees: [], engineerTimes: [] }]);
    }
    setShowModal(false);
  };

  const deleteOne  = (id, e) => { e.stopPropagation(); if (window.confirm('Delete?')) setUpgrades(upgrades.filter(u => u.id !== id)); };
  const deleteBulk = () => { if (window.confirm(`Delete ${selected.size}?`)) { setUpgrades(upgrades.filter(u => !selected.has(u.id))); clearAll(); } };

  const toggleAttend = (upgradeId, uid) => setUpgrades(upgrades.map(u =>
    u.id !== upgradeId ? u : { ...u, attendees: (u.attendees||[]).includes(uid) ? (u.attendees||[]).filter(x => x !== uid) : [...(u.attendees||[]), uid] }
  ));

  // Engineer logs their completed time
  const openComplete = (upgradeId) => {
    setCompleteForm({ upgradeId, completedTime: '' });
    setShowCompleteModal(true);
  };

  const saveCompletedTime = () => {
    if (!completeForm.completedTime) return;
    const upgrade = upgrades.find(u => u.id === completeForm.upgradeId);
    if (!upgrade) return;

    // Calculate hours between startTime and completedTime
    const [startH, startM] = (upgrade.startTime || '00:00').split(':').map(Number);
    const [endH, endM]     = completeForm.completedTime.split(':').map(Number);
    let hrs = (endH * 60 + endM - startH * 60 - startM) / 60;
    if (hrs < 0) hrs += 24; // next day
    hrs = Math.round(hrs * 4) / 4; // round to nearest 15min

    const existing = (upgrade.engineerTimes || []).filter(e => e.engineerId !== currentUser);
    const newEntry = {
      engineerId: currentUser,
      completedTime: completeForm.completedTime,
      hours: hrs,
      // Manager's time is auto-approved; engineers need manager approval
      approved: isManager ? true : false,
      submittedAt: new Date().toISOString()
    };
    setUpgrades(upgrades.map(u => u.id === completeForm.upgradeId
      ? { ...u, engineerTimes: [...existing, newEntry] }
      : u
    ));
    setShowCompleteModal(false);
    // If manager, immediately apply to timesheets
    if (isManager) applyUpgradeToTimesheet(upgrade, newEntry);
  };

  const applyUpgradeToTimesheet = (upgrade, entry) => {
    if (!setTimesheets) return;
    const dow = new Date(upgrade.date).getDay();
    const isWE = dow === 0 || dow === 6;
    const label = `UPG ${upgrade.id} ${upgrade.name.slice(0,20)}`;
    setTimesheets(prev => ({
      ...prev,
      [entry.engineerId]: [
        {
          week: label,
          weekday_oncall: isWE ? 0 : entry.hours,
          weekend_oncall: isWE ? entry.hours : 0,
          worked_wd: isWE ? 0 : entry.hours,
          worked_we: isWE ? entry.hours : 0,
          standby_wd: 0, standby_we: 0,
          notes: `Upgrade: ${upgrade.name} on ${upgrade.date} (${entry.hours}h)`,
          upgradeId: upgrade.id
        },
        ...(prev[entry.engineerId] || []).filter(e => e.upgradeId !== upgrade.id)
      ]
    }));
  };

  // Manager approves/rejects an engineer's completed time
  const approveTime = (upgradeId, engineerId, approve) => {
    const upgrade = upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return;
    const updated = (upgrade.engineerTimes || []).map(e =>
      e.engineerId === engineerId ? { ...e, approved: approve, reviewedAt: new Date().toISOString() } : e
    );
    setUpgrades(upgrades.map(u => u.id === upgradeId ? { ...u, engineerTimes: updated } : u));
    // Apply to timesheet if approved
    if (approve) {
      const entry = updated.find(e => e.engineerId === engineerId);
      if (entry) applyUpgradeToTimesheet(upgrade, entry);
    } else {
      // Remove from timesheets if rejected
      if (setTimesheets) {
        setTimesheets(prev => ({
          ...prev,
          [engineerId]: (prev[engineerId] || []).filter(e => e.upgradeId !== upgradeId)
        }));
      }
    }
  };

  return (
    <div>
      <PageHeader title="Upgrade Days" sub="Schedule and track system upgrade days — hours auto-added to payroll on approval"
        actions={<>
          {isManager && selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          {isManager && <button className="btn btn-primary" onClick={openAdd}>+ Add Upgrade Day</button>}
        </>} />

      <Alert type="info" style={{ marginBottom: 16 }}>
        ℹ Manager adds the upgrade day with date &amp; start time. Engineers log their completed time after the upgrade. Manager approves — hours are then included in payroll. Manager's own time is auto-approved.
      </Alert>

      {upgrades.length === 0 && <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No upgrade days scheduled yet</div>}

      {upgrades.map(up => {
        const myTime = (up.engineerTimes||[]).find(e => e.engineerId === currentUser);
        const pendingApprovals = (up.engineerTimes||[]).filter(e => !e.approved && !isManager);
        const approvedCount = (up.engineerTimes||[]).filter(e => e.approved).length;
        return (
          <div key={up.id} className="card mb-16">
            {/* Header */}
            <div className="flex-between mb-12">
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {isManager && <input type="checkbox" checked={selected.has(up.id)} onChange={() => toggleOne(up.id)} style={{ marginTop: 4 }} />}
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#fecaca' }}>{up.name}</div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 3 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>📅 {up.date}</span>
                    {up.startTime && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>🕐 Start: {up.startTime}</span>}
                    <span style={{ fontSize: 12, color: '#6ee7b7' }}>✅ {approvedCount} approved</span>
                    {isManager && (up.engineerTimes||[]).filter(e => !e.approved).length > 0 &&
                      <span style={{ fontSize: 12, color: '#fcd34d' }}>⏳ {(up.engineerTimes||[]).filter(e=>!e.approved).length} pending</span>}
                  </div>
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

            {/* Attendees */}
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Attendees {isManager ? '(click to toggle):' : ':'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {users.map(u => {
                const attending = (up.attendees||[]).includes(u.id);
                const eTime = (up.engineerTimes||[]).find(e => e.engineerId === u.id);
                return (
                  <div key={u.id} onClick={() => isManager && toggleAttend(up.id, u.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
                      border: `1px solid ${attending ? 'var(--accent3)' : 'var(--border)'}`,
                      background: attending ? 'rgba(16,185,129,.1)' : 'var(--bg-card2)',
                      cursor: isManager ? 'pointer' : 'default'
                    }}>
                    <Avatar user={u} size={24} />
                    <div>
                      <div style={{ fontSize: 12, color: attending ? '#6ee7b7' : 'var(--text-secondary)' }}>
                        {u.name.split(' ')[0]}{attending && ' ✓'}
                      </div>
                      {eTime && (
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: eTime.approved ? '#6ee7b7' : '#fcd34d' }}>
                          {eTime.completedTime} · {eTime.hours}h · {eTime.approved ? '✅ Approved' : '⏳ Pending'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Engineer: log my completed time */}
            {(up.attendees||[]).includes(currentUser) && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {myTime ? (
                  <div style={{ fontSize: 12, color: myTime.approved ? '#6ee7b7' : '#fcd34d' }}>
                    {myTime.approved
                      ? `✅ Your completed time: ${myTime.completedTime} (${myTime.hours}h) — Approved & added to payroll`
                      : `⏳ Your completed time: ${myTime.completedTime} (${myTime.hours}h) — Awaiting manager approval`}
                    {!myTime.approved && <button className="btn btn-secondary btn-sm" style={{ marginLeft: 10 }} onClick={() => openComplete(up.id)}>✏ Update</button>}
                  </div>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => openComplete(up.id)}>
                    🕐 Log My Completed Time
                  </button>
                )}
              </div>
            )}

            {/* Manager: approve/reject pending times */}
            {isManager && (up.engineerTimes||[]).filter(e => !e.approved).length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fcd34d', marginBottom: 8 }}>⏳ Pending Approval</div>
                {(up.engineerTimes||[]).filter(e => !e.approved).map(e => {
                  const eng = users.find(u => u.id === e.engineerId);
                  return (
                    <div key={e.engineerId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '8px 10px', background: 'rgba(252,211,77,0.08)', borderRadius: 8 }}>
                      <Avatar user={eng} size={24} />
                      <div style={{ flex: 1, fontSize: 12 }}>
                        <strong>{eng?.name}</strong> — finished at <strong>{e.completedTime}</strong> ({e.hours}h)
                      </div>
                      <button className="btn btn-success btn-sm" onClick={() => approveTime(up.id, e.engineerId, true)}>✓ Approve</button>
                      <button className="btn btn-danger btn-sm" onClick={() => approveTime(up.id, e.engineerId, false)}>✗ Reject</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Add/Edit modal (manager only) */}
      {showModal && isManager && (
        <Modal title={editId ? 'Edit Upgrade Day' : 'Add Upgrade Day'} onClose={() => setShowModal(false)}>
          <FormGroup label="Date"><input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormGroup>
          <FormGroup label="Start Time" hint="When the upgrade begins">
            <input className="input" type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} />
          </FormGroup>
          <FormGroup label="Upgrade Name"><input className="input" placeholder="e.g. Global Q3 System Upgrade" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormGroup>
          <FormGroup label="Description (optional)"><textarea className="textarea" rows={3} value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} /></FormGroup>
          {(!form.date || !form.startTime || !form.name) && <Alert type="warning" style={{ marginTop: 8 }}>⚠ Date, start time and name are required.</Alert>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update' : 'Add Upgrade Day'}</button>
          </div>
        </Modal>
      )}

      {/* Log completed time modal */}
      {showCompleteModal && (
        <Modal title="Log Completed Time" onClose={() => setShowCompleteModal(false)}>
          {(() => {
            const up = upgrades.find(u => u.id === completeForm.upgradeId);
            return (
              <>
                <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <strong>{up?.name}</strong> · Started at <strong>{up?.startTime || 'N/A'}</strong> on <strong>{up?.date}</strong>
                </div>
                <FormGroup label="Your Completed Time (when you finished)" hint="HH:MM">
                  <input className="input" type="time" value={completeForm.completedTime} onChange={e => setCompleteForm({ ...completeForm, completedTime: e.target.value })} />
                </FormGroup>
                {completeForm.completedTime && up?.startTime && (() => {
                  const [sh,sm] = up.startTime.split(':').map(Number);
                  const [eh,em] = completeForm.completedTime.split(':').map(Number);
                  let hrs = (eh*60+em - sh*60-sm)/60; if(hrs<0) hrs+=24;
                  hrs = Math.round(hrs*4)/4;
                  return <Alert type="info">⏱ Calculated duration: <strong>{hrs}h</strong> — will be submitted for manager approval{isManager ? ' (auto-approved)' : ''}.</Alert>;
                })()}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button className="btn btn-secondary" onClick={() => setShowCompleteModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveCompletedTime}>Submit</button>
                </div>
              </>
            );
          })()}
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
// ── UK TAX ENGINE (2025-26) ───────────────────────────────────────────────
const UK_TAX = {
  year: '2025-26',
  personalAllowance: 12570,
  basicRateLimit: 50270,   // personal allowance + basic rate band
  higherRateLimit: 125140,
  basicRate: 0.20,
  higherRate: 0.40,
  additionalRate: 0.45,
  niPrimaryThreshold: 12570,
  niUpperEarningsLimit: 50270,
  niRate1: 0.08,  // 8% between PT and UEL
  niRate2: 0.02,  // 2% above UEL
  studentLoanPlan2Threshold: 27295,
  studentLoanPlan2Rate: 0.09,
};

function calcUKTax(annualGross, { studentLoan = false, pensionPct = 0, taxCode = '1257L' } = {}) {
  const pension    = annualGross * (pensionPct / 100);
  const taxable    = Math.max(0, annualGross - pension);
  const t          = UK_TAX;
  const pa         = taxCode === '1257L' ? t.personalAllowance : t.personalAllowance; // extensible
  // Taper personal allowance above £100k
  const effectivePA = taxable > 100000 ? Math.max(0, pa - (taxable - 100000) / 2) : pa;

  let incomeTax = 0;
  const abovePA = Math.max(0, taxable - effectivePA);
  if (abovePA > 0) {
    const basic   = Math.min(abovePA, t.basicRateLimit - effectivePA);
    const higher  = Math.min(Math.max(0, abovePA - (t.basicRateLimit - effectivePA)), t.higherRateLimit - t.basicRateLimit);
    const addl    = Math.max(0, abovePA - (t.higherRateLimit - effectivePA));
    incomeTax = basic * t.basicRate + higher * t.higherRate + addl * t.additionalRate;
  }

  // NI (Class 1 employee)
  let ni = 0;
  if (annualGross > t.niPrimaryThreshold) {
    const band1 = Math.min(annualGross, t.niUpperEarningsLimit) - t.niPrimaryThreshold;
    const band2 = Math.max(0, annualGross - t.niUpperEarningsLimit);
    ni = band1 * t.niRate1 + band2 * t.niRate2;
  }

  const slRepay = studentLoan && annualGross > t.studentLoanPlan2Threshold
    ? (annualGross - t.studentLoanPlan2Threshold) * t.studentLoanPlan2Rate : 0;

  const totalDeductions = incomeTax + ni + slRepay + pension;
  const annualNet       = annualGross - totalDeductions;
  const eff             = annualGross > 0 ? totalDeductions / annualGross : 0;

  return {
    annualGross, annualNet, incomeTax, ni, pension, slRepay, totalDeductions,
    effectiveRate: eff,
    monthly: { gross: annualGross/12, net: annualNet/12, tax: incomeTax/12, ni: ni/12, pension: pension/12, sl: slRepay/12 },
    weekly:  { gross: annualGross/52, net: annualNet/52, tax: incomeTax/52, ni: ni/52, pension: pension/52, sl: slRepay/52 },
    daily:   { gross: annualGross/260, net: annualNet/260, tax: incomeTax/260, ni: ni/260, pension: pension/260, sl: slRepay/260 },
    hourly:  { gross: annualGross/2080, net: annualNet/2080, tax: incomeTax/2080, ni: ni/2080, pension: pension/2080, sl: slRepay/2080 },
  };
}

// ── ON-CALL PAY RULES ─────────────────────────────────────────────────────
// Weekday evening: Mon–Thu 19:00–07:00 = £5/hr standby + 1.5x hourly for worked
// Weekend:         Fri–Mon 19:00–07:00 = £5/hr standby + 1.5x hourly for worked
// TOIL: UK Working Time Regulations 1998 — overtime beyond contracted 48hr week
// accrues 1:1 TOIL. Bank holidays count as rest. Max carryover = 5 days (40h).
const ONCALL_STANDBY_RATE = 5;    // £/hr flat
const ONCALL_WORKED_MULTIPLIER = 1.5;
const TOIL_MAX_CARRYOVER_HOURS = 40; // 5 days per UK WTR
const TOIL_ACCRUAL_RATE = 1.0;       // 1:1 per UK WTR

// ── calcOncallPay ──────────────────────────────────────────────────────────
// Derives standby/worked hours directly from the ROTA (single source of truth)
// rather than relying on timesheet fields which may be incomplete.
//
// Shift hour rules:
//   daily       10:00–19:00  = 9h worked  (Mon–Fri)
//   evening     19:00–07:00  = 12h standby (Mon–Thu)
//   weekend     Fri19:00–Mon07:00 = 60h standby total (split across 3 nights)
//   bankholiday 09:00–07:00  = 22h standby
//   upgrade     approved hours at 1.5x worked rate
//
// Incident hours come from timesheets entries flagged with week starting "INC".
function calcOncallPay(timesheetEntries, hourlyRate, upgradeHrs = 0, bankHolHrs = 0,
                       rotaForUser = {}, holidays = [], bankHolidays = [], startDs = null, endDs = null) {

  // ── Derive hours from rota entries ───────────────────────────────────────
  let standbyWD = 0, workedWD = 0, standbyWE = 0, workedWE = 0;

  Object.entries(rotaForUser).forEach(([date, shift]) => {
    if (startDs && date < startDs) return;
    if (endDs   && date > endDs)   return;
    if (!shift || shift === 'off') return;

    // Skip bank holidays — counted separately below
    const isBH = bankHolidays.some(b => b.date === date);
    if (isBH) return;

    const isHol = holidays.some(h => h.userId !== undefined
      ? (date >= h.start && date <= h.end) : false);
    if (isHol) return;

    const dow = new Date(date).getDay(); // 0=Sun,1=Mon…6=Sat
    const isWeekend = dow === 0 || dow === 5 || dow === 6; // Fri/Sat/Sun = weekend OC

    if (shift === 'daily') {
      workedWD += 9; // 10:00–19:00
    } else if (shift === 'evening') {
      // Weekday OC: 19:00–07:00 = 12h standby per night
      standbyWD += 12;
    } else if (shift === 'weekend') {
      // Weekend OC: each day contributes standby hours
      // Fri: 5h (19:00–24:00), Sat: 24h, Sun: 24h, Mon morning handled as carry-over
      // Simpler: each weekend rota entry represents one day's portion
      if (dow === 5) standbyWE += 5;      // Fri 19:00–24:00
      else if (dow === 6) standbyWE += 24; // Sat full day
      else if (dow === 0) standbyWE += 24; // Sun full day
      else if (dow === 1) standbyWE += 7;  // Mon 00:00–07:00
      else standbyWE += 12; // fallback
    }
  });

  // Bank holiday standby hours — pre-calculated hours
  const bhStandby = bankHolHrs;

  // Incident hours from timesheets (entries with week starting "INC")
  let incidentHrs = 0;
  (timesheetEntries || []).filter(e => e.week && e.week.startsWith('INC')).forEach(e => {
    const hrs = (e.weekday_oncall || 0) + (e.weekend_oncall || 0) + (e.worked_wd || 0) + (e.worked_we || 0);
    incidentHrs += hrs;
    // Route to the right bucket
    const d = new Date(e.week?.replace('INC-','') || Date.now()).getDay();
    if (d === 0 || d === 5 || d === 6) workedWE += (e.weekday_oncall||0)+(e.weekend_oncall||0);
    else workedWD += (e.weekday_oncall||0)+(e.weekend_oncall||0);
  });

  const standbyPay  = (standbyWD + standbyWE + bhStandby) * ONCALL_STANDBY_RATE;
  const workedPay   = (workedWD + workedWE) * hourlyRate * ONCALL_WORKED_MULTIPLIER;
  const upgradePay  = upgradeHrs * hourlyRate * ONCALL_WORKED_MULTIPLIER;
  const bankHolPay  = bhStandby * ONCALL_STANDBY_RATE;
  const totalOncallHours = standbyWD + workedWD + standbyWE + workedWE + upgradeHrs + bhStandby;

  return {
    standbyWD: Math.round(standbyWD * 10) / 10,
    workedWD:  Math.round(workedWD  * 10) / 10,
    standbyWE: Math.round(standbyWE * 10) / 10,
    workedWE:  Math.round(workedWE  * 10) / 10,
    upgradeHrs, bankHolHrs,
    incidentHrs: Math.round(incidentHrs * 10) / 10,
    standbyPay, workedPay, upgradePay, bankHolPay,
    total: standbyPay + workedPay + upgradePay,
    totalOncallHours: Math.round(totalOncallHours * 10) / 10,
    totalStandbyHours: Math.round((standbyWD + standbyWE + bhStandby) * 10) / 10,
    totalWorkedHours:  Math.round((workedWD + workedWE + upgradeHrs) * 10) / 10,
  };
}

function calcTOILBalance(timesheetEntries, toilEntries, userId) {
  // Accrual: worked on-call hours beyond contracted hours → TOIL at 1:1 (UK WTR)
  const workedOC = (timesheetEntries || []).reduce((a, e) => a + (e.worked_wd||0) + (e.worked_we||0), 0);
  const autoToil = workedOC * TOIL_ACCRUAL_RATE;
  const manualAccrued = (toilEntries || []).filter(t => t.userId === userId && t.type === 'Accrued').reduce((a,t) => a + t.hours, 0);
  const used  = (toilEntries || []).filter(t => t.userId === userId && t.type === 'Used').reduce((a,t) => a + t.hours, 0);
  const total = autoToil + manualAccrued;
  const balance = Math.min(total - used, TOIL_MAX_CARRYOVER_HOURS); // cap at WTR max carryover
  return { autoToil, manualAccrued, total, used, balance, workedOC, cappedAt: TOIL_MAX_CARRYOVER_HOURS };
}

// ── TOIL ──────────────────────────────────────────────────────────────────
function TOIL({ users, timesheets, toil, setToil, currentUser, isManager }) {
  const manualToil = isManager ? toil : toil.filter(t => t.userId === currentUser);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ userId: currentUser, hours: '', reason: '', date: '', type: 'Used' });

  const addManual = () => {
    if (!form.hours || !form.date) return;
    setToil([...toil, { id: 't' + Date.now(), ...form, hours: +form.hours }]);
    setShowModal(false);
  };

  const visibleUsers = isManager ? users : users.filter(u => u.id === currentUser);

  return (
    <div>
      <PageHeader title="TOIL — Time Off In Lieu"
        sub="UK Working Time Regulations 1998 — 1:1 accrual on worked on-call hours · max 40h carryover"
        actions={isManager && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Manual Entry</button>} />
      <Alert type="info">🇬🇧 UK WTR: TOIL accrues at <strong>1:1</strong> for hours <em>worked</em> during on-call (standby hours do not accrue TOIL). Maximum carryover is <strong>40 hours (5 days)</strong> per the Working Time Regulations 1998.</Alert>
      <div className="grid-2 mb-16">
        {visibleUsers.map(u => {
          const b = calcTOILBalance(timesheets[u.id], toil, u.id);
          return (
            <div key={u.id} className="card">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <Avatar user={u} size={32} />
                <div>
                  <div className="name-sm">{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Worked OC: {b.workedOC}h → auto TOIL: {b.autoToil}h</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Auto (1:1 worked)</div><div style={{ fontSize: 16, fontWeight: 600, color: '#38bdf8' }}>{b.autoToil}h</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Manual</div><div style={{ fontSize: 16, fontWeight: 600, color: '#93c5fd' }}>{b.manualAccrued}h</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Used</div><div style={{ fontSize: 16, fontWeight: 600, color: '#fcd34d' }}>{b.used}h</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Balance (max {b.cappedAt}h)</div><div style={{ fontSize: 16, fontWeight: 600, color: b.balance >= 0 ? '#38bdf8' : '#fca5a5' }}>{b.balance}h</div></div>
              </div>
              {b.balance >= TOIL_MAX_CARRYOVER_HOURS && <div style={{ marginTop: 8, fontSize: 11, color: '#fcd34d' }}>⚠ At WTR carryover cap — use before year end</div>}
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
function Absence({ users, absences, setAbsences, currentUser, isManager, driveToken }) {
  const [showModal, setShowModal]   = useState(false);
  const [editId, setEditId]         = useState(null);
  const [form, setForm]             = useState({ userId: currentUser, start: '', end: '', type: 'Sick', notes: '' });
  const [sheetMsg, setSheetMsg]     = useState('');
  const [syncing, setSyncing]       = useState(false);
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(absences);
  const visible = isManager ? absences : absences.filter(a => a.userId === currentUser);

  // ── Google Sheet sync ───────────────────────────────────────────────────
  const ABSENCE_SHEET_NAME = 'CloudOps-Absences';

  const syncToSheet = async (updatedAbsences) => {
    if (!driveToken) return;
    setSyncing(true);
    try {
      // Find or create the sheet
      let sheetId = null;
      const listResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name%3D'${ABSENCE_SHEET_NAME}'+and+trashed%3Dfalse&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      ).then(r => r.json());

      if (listResp.files && listResp.files.length > 0) {
        sheetId = listResp.files[0].id;
      } else {
        const createResp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            properties: { title: ABSENCE_SHEET_NAME },
            sheets: [{ properties: { title: 'Absences', sheetId: 0 } }]
          })
        }).then(r => r.json());
        sheetId = createResp.spreadsheetId;
      }

      const header = ['ID', 'Engineer ID', 'Engineer Name', 'Type', 'Start Date', 'End Date', 'Days', 'Notes', 'Logged By'];
      const rows = [header, ...(updatedAbsences || absences).map(a => {
        const u = users.find(x => x.id === a.userId);
        const d = a.end ? Math.ceil((new Date(a.end) - new Date(a.start)) / 86400000) + 1 : 1;
        return [a.id, a.userId, u?.name || a.userId, a.type, a.start, a.end || '', d, a.notes || '', a.loggedBy || currentUser];
      })];

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Absences!A1:I${rows.length}?valueInputOption=RAW`,
        { method: 'PUT', headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: rows }) }
      );
      // Bold header
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red:1,green:1,blue:1 } }, backgroundColor: { red: 0.07, green: 0.21, blue: 0.37 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } }] })
      });
      setSheetMsg(`✅ Synced to Google Sheet "${ABSENCE_SHEET_NAME}" — ${new Date().toLocaleTimeString('en-GB')}`);
    } catch (e) {
      console.error('Absence sheet sync error:', e);
      setSheetMsg('⚠️ Drive not accessible. Data saved locally. Speak to Meetul to share the folder.');
    } finally { setSyncing(false); }
  };

  const loadFromSheet = async () => {
    if (!driveToken) { setSheetMsg('⚠️ Not connected to Google Drive.'); return; }
    setSyncing(true);
    try {
      const listResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name%3D'${ABSENCE_SHEET_NAME}'+and+trashed%3Dfalse&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      ).then(r => r.json());
      if (!listResp.files || listResp.files.length === 0) { setSheetMsg('No absence sheet found yet. Log an absence to create it.'); setSyncing(false); return; }
      const sheetId = listResp.files[0].id;
      const dataResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Absences!A2:I1000`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      ).then(r => r.json());
      const rows = dataResp.values || [];
      const loaded = rows.filter(r => r[0]).map(r => ({
        id: r[0], userId: r[1], type: r[3] || 'Sick',
        start: r[4], end: r[5] || '', notes: r[7] || '', loggedBy: r[8] || ''
      }));
      if (loaded.length > 0) {
        setAbsences(loaded);
        // ── CRITICAL FIX: also write back to absences.json so loadAllFromDrive
        // finds the data on the next page load. Without this, the Sheet and the
        // JSON file are out of sync and engineers on other machines see nothing.
        if (driveToken) {
          driveWriteJson(driveToken, 'absences.json', loaded).catch(() => {});
        }
        setSheetMsg(`✅ Loaded ${loaded.length} records from Google Sheet.`);
      } else {
        setSheetMsg('Sheet is empty.');
      }
    } catch (e) { setSheetMsg('⚠️ Could not load from sheet.'); }
    finally { setSyncing(false); }
  };

  const openAdd  = () => { setForm({ userId: currentUser, start: '', end: '', type: 'Sick', notes: '' }); setEditId(null); setShowModal(true); };
  const openEdit = (a, e) => {
    if (!isManager) { alert('Only the manager can edit absence records.'); return; }
    e.stopPropagation(); setForm({ ...a }); setEditId(a.id); setShowModal(true);
  };

  const save = () => {
    if (!form.start) return;
    let updated;
    if (editId) {
      updated = absences.map(a => a.id === editId ? { ...a, ...form } : a);
    } else {
      updated = [...absences, { id: 'abs-' + Date.now(), ...form, loggedBy: currentUser }];
    }
    setAbsences(updated);
    setShowModal(false);
    syncToSheet(updated);
  };

  const deleteOne  = (id, e) => {
    if (!isManager) { alert('Only the manager can delete absence records.'); return; }
    e.stopPropagation();
    const updated = absences.filter(a => a.id !== id);
    setAbsences(updated);
    syncToSheet(updated);
  };
  const deleteBulk = () => {
    if (!isManager) return;
    const updated = absences.filter(a => !selected.has(a.id));
    setAbsences(updated); clearAll();
    syncToSheet(updated);
  };

  return (
    <div>
      <PageHeader title="Absence &amp; Sickness" sub="Track all absences and sickness — synced to Google Sheet"
        actions={<>
          {isManager && selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          {isManager && driveToken && <button className="btn btn-secondary btn-sm" onClick={loadFromSheet} disabled={syncing}>{syncing ? '⏳' : '📥'} Load from Sheet</button>}
          {isManager && driveToken && <button className="btn btn-secondary btn-sm" onClick={() => syncToSheet()} disabled={syncing}>{syncing ? '⏳ Syncing…' : '📤 Sync to Sheet'}</button>}
          <button className="btn btn-primary" onClick={openAdd}>+ Log Absence</button>
        </>} />

      {/* Drive status */}
      {!driveToken && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#fcd34d' }}>
          ⚠️ Google Drive not connected. Absence records are saved locally only. Manager (MBA47) must be connected to Drive to sync to the Google Sheet.
        </div>
      )}
      {sheetMsg && (
        <div style={{ background: sheetMsg.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${sheetMsg.startsWith('✅') ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: sheetMsg.startsWith('✅') ? '#6ee7b7' : '#fcd34d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{sheetMsg}</span>
          <button onClick={() => setSheetMsg('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}

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
                      {isManager && <button className="btn btn-secondary btn-sm" onClick={e => openEdit(a, e)}>✏</button>}
                      {isManager && <button className="btn btn-danger btn-sm" onClick={e => deleteOne(a.id, e)}>🗑</button>}
                      {!isManager && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Manager only</span>}
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
          {driveToken && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>📊 This will be automatically synced to the <strong>{ABSENCE_SHEET_NAME}</strong> Google Sheet.</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update' : 'Log Absence'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Overtime ───────────────────────────────────────────────────────────────
function Overtime({ users, overtime, setOvertime, currentUser, isManager, driveToken }) {
  const fmtUK = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';
  const BLANK = { userId: currentUser, date: '', hours: '', reason: '', notes: '' };
  const [showModal, setShowModal]     = useState(false);
  const [form, setForm]               = useState(BLANK);
  const [editId, setEditId]           = useState(null);
  const [filterUid, setFilterUid]     = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [msg, setMsg]                 = useState('');
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [sheetMsg, setSheetMsg]       = useState('');

  const OT_SHEET_NAME = 'CloudOps-Overtime';

  const notify = (m, ms = 3000) => { setMsg(m); setTimeout(() => setMsg(''), ms); };
  const notifySheet = (m, ms = 4000) => { setSheetMsg(m); setTimeout(() => setSheetMsg(''), ms); };

  // ── Google Sheet sync ──────────────────────────────────────────────────────
  // Finds or creates CloudOps-Overtime sheet, writes all rows.
  // Also writes overtime.json so loadAllFromDrive picks it up on next load.
  const syncToSheet = async (updatedOT) => {
    if (!driveToken) return;
    setSheetSyncing(true);
    try {
      const data = updatedOT || overtime;

      // Find or create the Google Sheet
      let sheetId = null;
      const listResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name%3D'${OT_SHEET_NAME}'+and+trashed%3Dfalse&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      ).then(r => r.json());

      if (listResp.files && listResp.files.length > 0) {
        sheetId = listResp.files[0].id;
      } else {
        const createResp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            properties: { title: OT_SHEET_NAME },
            sheets: [{ properties: { title: 'Overtime', sheetId: 0 } }]
          })
        }).then(r => r.json());
        sheetId = createResp.spreadsheetId;
      }

      // Build rows
      const header = [
        'ID', 'Engineer ID', 'Engineer Name', 'Date', 'Hours',
        'Reason', 'Notes', 'Status', 'Submitted By', 'Submitted At',
        'Approved By', 'Approved At'
      ];
      const rows = [header, ...data.map(o => {
        const u = users.find(x => x.id === o.userId);
        const approver = users.find(x => x.id === o.approvedBy);
        return [
          o.id,
          o.userId,
          u?.name || o.userId,
          fmtUK(o.date),
          o.hours,
          o.reason || '',
          o.notes || '',
          o.status,
          o.submittedBy || '',
          o.submittedAt ? fmtUK(o.submittedAt.slice(0, 10)) : '',
          approver?.name || o.approvedBy || '',
          o.approvedAt ? fmtUK(o.approvedAt.slice(0, 10)) : '',
        ];
      })];

      // Write data
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Overtime!A1:L${rows.length}?valueInputOption=RAW`,
        { method: 'PUT', headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: rows }) }
      );

      // Style header row
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 },
            cell: { userEnteredFormat: {
              textFormat: { bold: true, foregroundColor: { red:1, green:1, blue:1 } },
              backgroundColor: { red: 0.07, green: 0.21, blue: 0.37 }
            }},
            fields: 'userEnteredFormat(textFormat,backgroundColor)'
          }
        }]})
      });

      // Also write back to overtime.json so loadAllFromDrive finds it on next load
      await driveWriteJson(driveToken, 'overtime.json', data).catch(() => {});

      notifySheet(`✅ Synced to Google Sheet "${OT_SHEET_NAME}" — ${new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}`);
    } catch (e) {
      console.error('Overtime sheet sync error:', e);
      notifySheet('⚠️ Could not sync to Google Sheet — data still saved to Drive JSON.');
    } finally {
      setSheetSyncing(false);
    }
  };

  // Load from Sheet — reads CloudOps-Overtime and overwrites local state + JSON
  const loadFromSheet = async () => {
    if (!driveToken) { notifySheet('⚠️ Not connected to Google Drive.'); return; }
    setSheetSyncing(true);
    try {
      const listResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name%3D'${OT_SHEET_NAME}'+and+trashed%3Dfalse&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      ).then(r => r.json());

      if (!listResp.files || listResp.files.length === 0) {
        notifySheet('No overtime sheet found yet. Log an overtime entry to create it.');
        setSheetSyncing(false);
        return;
      }

      const sheetId = listResp.files[0].id;
      const dataResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Overtime!A2:L1000`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      ).then(r => r.json());

      const rows = dataResp.values || [];
      // Parse rows back to objects — date stored as UK string dd/mm/yyyy, convert to yyyy-mm-dd
      const parseUKDate = s => {
        if (!s) return '';
        const [d, m, y] = s.split('/');
        return y && m && d ? `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}` : s;
      };
      const loaded = rows.filter(r => r[0]).map(r => ({
        id:          r[0],
        userId:      r[1],
        date:        parseUKDate(r[3]),
        hours:       parseFloat(r[4]) || 0,
        reason:      r[5] || '',
        notes:       r[6] || '',
        status:      r[7] || 'pending',
        submittedBy: r[8] || '',
        submittedAt: r[9] ? new Date(parseUKDate(r[9])).toISOString() : '',
        approvedBy:  r[10] ? users.find(u => u.name === r[10])?.id || r[10] : null,
        approvedAt:  r[11] ? new Date(parseUKDate(r[11])).toISOString() : null,
      }));

      if (loaded.length > 0) {
        setOvertime(loaded);
        // Write back to overtime.json so next load picks it up without needing Sheet
        await driveWriteJson(driveToken, 'overtime.json', loaded).catch(() => {});
        notifySheet(`✅ Loaded ${loaded.length} records from Google Sheet.`);
      } else {
        notifySheet('Sheet exists but has no data rows.');
      }
    } catch (e) {
      console.error('Load overtime from sheet error:', e);
      notifySheet('⚠️ Could not load from Google Sheet.');
    } finally {
      setSheetSyncing(false);
    }
  };

  // ── CRUD actions — all call syncToSheet after mutating state ──────────────
  const openAdd  = () => { setForm({ ...BLANK, userId: isManager ? (users[0]?.id || currentUser) : currentUser }); setEditId(null); setShowModal(true); };
  const openEdit = (ot, e) => {
    if (!isManager && ot.userId !== currentUser) return;
    e.stopPropagation();
    setForm({ userId: ot.userId, date: ot.date, hours: ot.hours, reason: ot.reason || '', notes: ot.notes || '' });
    setEditId(ot.id);
    setShowModal(true);
  };

  const save = () => {
    if (!form.date || !form.hours || parseFloat(form.hours) <= 0) { notify('⚠️ Date and hours are required.'); return; }
    const autoApprove = isManager;
    const entry = {
      id: editId || ('ot-' + Date.now()),
      userId: form.userId,
      date: form.date,
      hours: parseFloat(form.hours),
      reason: form.reason,
      notes: form.notes,
      status: autoApprove ? 'approved' : 'pending',
      submittedAt: editId ? (overtime.find(o => o.id === editId)?.submittedAt || new Date().toISOString()) : new Date().toISOString(),
      submittedBy: currentUser,
      approvedBy: autoApprove ? currentUser : null,
      approvedAt: autoApprove ? new Date().toISOString() : null,
    };
    const updated = editId ? overtime.map(o => o.id === editId ? entry : o) : [...overtime, entry];
    setOvertime(updated);
    setShowModal(false);
    notify(autoApprove ? '✅ Overtime logged and auto-approved.' : '✅ Overtime request submitted for manager approval.');
    syncToSheet(updated);
  };

  const approve = (id) => {
    if (!isManager) return;
    const updated = overtime.map(o => o.id === id ? { ...o, status: 'approved', approvedBy: currentUser, approvedAt: new Date().toISOString() } : o);
    setOvertime(updated);
    notify('✅ Overtime approved.');
    syncToSheet(updated);
  };

  const reject = (id) => {
    if (!isManager) return;
    const updated = overtime.map(o => o.id === id ? { ...o, status: 'rejected', approvedBy: currentUser, approvedAt: new Date().toISOString() } : o);
    setOvertime(updated);
    notify('❌ Overtime rejected.');
    syncToSheet(updated);
  };

  const del = (id, e) => {
    if (!isManager) { notify('⚠️ Only the manager can delete entries.'); return; }
    e.stopPropagation();
    const updated = overtime.filter(o => o.id !== id);
    setOvertime(updated);
    syncToSheet(updated);
  };

  // ── Display helpers ────────────────────────────────────────────────────────
  const visible = overtime.filter(o => {
    if (!isManager && o.userId !== currentUser) return false;
    if (filterUid !== 'all' && o.userId !== filterUid) return false;
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));

  const pending = overtime.filter(o => o.status === 'pending');
  const totalApproved = overtime.filter(o => o.status === 'approved').reduce((s, o) => s + o.hours, 0);
  const myApproved = overtime.filter(o => o.status === 'approved' && o.userId === currentUser).reduce((s, o) => s + o.hours, 0);

  const statusBadge = (s) => ({
    approved: { bg: '#14532d', color: '#e879f9', label: '✅ Approved' },
    pending:  { bg: '#7c2d12', color: '#fcd34d', label: '⏳ Pending'  },
    rejected: { bg: '#450a0a', color: '#fca5a5', label: '❌ Rejected' },
  }[s] || { bg: '#1e293b', color: '#94a3b8', label: s });

  return (
    <div>
      <PageHeader title="Overtime" sub="Submit and approve overtime hours — synced to Google Sheet and Payroll"
        actions={<div style={{ display:'flex', gap:8 }}>
          {isManager && pending.length > 0 && <div style={{ background:'#ef4444', color:'#fff', borderRadius:12, padding:'4px 12px', fontSize:12, fontWeight:600, display:'flex', alignItems:'center' }}>⏳ {pending.length} pending</div>}
          {isManager && driveToken && <button className="btn btn-secondary btn-sm" onClick={loadFromSheet} disabled={sheetSyncing}>{sheetSyncing ? '⏳' : '📥'} Load from Sheet</button>}
          {isManager && driveToken && <button className="btn btn-secondary btn-sm" onClick={() => syncToSheet()} disabled={sheetSyncing}>{sheetSyncing ? '⏳ Syncing…' : '📤 Sync to Sheet'}</button>}
          <button className="btn btn-primary" onClick={openAdd}>+ Log Overtime</button>
        </div>} />

      {/* Drive connection warning */}
      {!driveToken && (
        <Alert type="warning" style={{ marginBottom:12 }}>
          ⚠️ Google Drive not connected. Overtime records are saved locally only. Connect Drive to sync to Google Sheet.
        </Alert>
      )}

      {/* Sheet sync status */}
      {sheetMsg && <Alert type={sheetMsg.startsWith('⚠') ? 'warning' : 'info'} style={{ marginBottom:12 }}>{sheetMsg}</Alert>}
      {msg && <Alert type={msg.startsWith('⚠') ? 'warning' : 'info'} style={{ marginBottom:12 }}>{msg}</Alert>}

      {/* KPIs */}
      <div className="grid-4 mb-16">
        <StatCard label="My Approved Hours"  value={`${myApproved}h`}    sub="Approved & in payroll"   accent="#10b981" icon="✅" />
        <StatCard label="Team Total Hours"   value={`${totalApproved}h`} sub="All engineers approved"  accent="#3b82f6" icon="⏱" />
        <StatCard label="Pending Approval"   value={pending.length}      sub="Awaiting manager review"  accent="#f59e0b" icon="⏳" />
        <StatCard label="Total Requests"     value={isManager ? overtime.length : overtime.filter(o => o.userId === currentUser).length} sub="All time" accent="#818cf8" icon="📋" />
      </div>

      {/* Pending approvals panel — manager only */}
      {isManager && pending.length > 0 && (
        <div className="card mb-16" style={{ border:'1px solid rgba(251,191,36,0.3)', background:'rgba(251,191,36,0.05)' }}>
          <div className="card-title" style={{ color:'#fcd34d' }}>⏳ Pending Approvals ({pending.length})</div>
          {pending.map(o => {
            const u = users.find(x => x.id === o.userId);
            return (
              <div key={o.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid rgba(30,58,95,.3)' }}>
                <Avatar user={u || { avatar:'?', color:'#475569' }} size={32} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:500 }}>{u?.name} — <span style={{ fontFamily:'DM Mono' }}>{o.hours}h</span> on <strong>{fmtUK(o.date)}</strong></div>
                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>{o.reason || 'No reason given'} · Submitted {fmtUK(o.submittedAt?.slice(0,10))}</div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => approve(o.id)}>✅ Approve</button>
                <button className="btn btn-danger btn-sm" onClick={() => reject(o.id)}>❌ Reject</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="card mb-16" style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', padding:'12px 16px' }}>
        {isManager && (
          <select className="select" style={{ minWidth:160 }} value={filterUid} onChange={e => setFilterUid(e.target.value)}>
            <option value="all">All Engineers</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <select className="select" style={{ minWidth:140 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <div style={{ marginLeft:'auto', fontSize:12, color:'var(--text-muted)' }}>{visible.length} record{visible.length !== 1 ? 's' : ''}</div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflowX:'auto' }}>
        {visible.length === 0 ? (
          <div style={{ textAlign:'center', padding:'32px 0', color:'var(--text-muted)', fontSize:13 }}>
            No overtime records found.<br />
            <span style={{ fontSize:12 }}>Click "+ Log Overtime" to submit a request.</span>
          </div>
        ) : (
          <table style={{ minWidth:700 }}>
            <thead>
              <tr>
                <th>Engineer</th>
                <th>Date</th>
                <th>Hours</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Approved By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(o => {
                const u = users.find(x => x.id === o.userId);
                const badge = statusBadge(o.status);
                const approver = users.find(x => x.id === o.approvedBy);
                return (
                  <tr key={o.id} style={{ cursor:'pointer' }} onClick={e => openEdit(o, e)}>
                    <td><div style={{ display:'flex', gap:8, alignItems:'center' }}><Avatar user={u || { avatar:'?', color:'#475569' }} size={24} /><span style={{ fontSize:12 }}>{u?.name || o.userId}</span></div></td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12 }}>{fmtUK(o.date)}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:13, fontWeight:700, color:'#e879f9' }}>{o.hours}h</td>
                    <td style={{ fontSize:12, color:'var(--text-secondary)', maxWidth:200 }}>{o.reason || '—'}</td>
                    <td><span style={{ background:badge.bg, color:badge.color, borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:600, whiteSpace:'nowrap' }}>{badge.label}</span></td>
                    <td style={{ fontSize:11, color:'var(--text-muted)' }}>{approver ? approver.name : '—'}{o.approvedAt && <div style={{ fontSize:10 }}>{fmtUK(o.approvedAt?.slice(0,10))}</div>}</td>
                    <td>
                      <div style={{ display:'flex', gap:6 }} onClick={e => e.stopPropagation()}>
                        {isManager && o.status === 'pending' && <>
                          <button className="btn btn-primary btn-sm" onClick={() => approve(o.id)}>✅</button>
                          <button className="btn btn-danger btn-sm" onClick={() => reject(o.id)}>❌</button>
                        </>}
                        {isManager && <button className="btn btn-danger btn-sm" onClick={e => del(o.id, e)}>🗑</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <Modal title={editId ? 'Edit Overtime' : 'Log Overtime'} onClose={() => setShowModal(false)}>
          {isManager && (
            <FormGroup label="Engineer">
              <select className="select" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
              </select>
            </FormGroup>
          )}
          <FormGroup label="Date">
            <input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </FormGroup>
          <FormGroup label="Overtime Hours" hint="e.g. 2.5">
            <input className="input" type="number" min="0.5" max="24" step="0.5" placeholder="Hours worked" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} />
          </FormGroup>
          <FormGroup label="Reason">
            <input className="input" placeholder="e.g. Emergency deployment, incident response..." value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
          </FormGroup>
          <FormGroup label="Notes (optional)">
            <textarea className="input" rows={2} placeholder="Additional notes..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ resize:'vertical' }} />
          </FormGroup>
          {!isManager && (
            <Alert type="info">ℹ Your overtime request will be sent to the manager for approval before it appears in payroll.</Alert>
          )}
          {isManager && (
            <Alert type="info">✅ Manager-submitted overtime is auto-approved and immediately included in payroll.</Alert>
          )}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editId ? 'Update' : isManager ? 'Log & Approve' : 'Submit Request'}</button>
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
  const [filter, setFilter]       = useState(isManager ? 'all' : currentUser);
  const [viewEntry, setViewEntry] = useState(null);
  const [form, setForm]           = useState({ userId: currentUser, type: 'Note', date: '', summary: '', content: '', private: false });
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(logbook);

  // Engineers see their own entries + any non-private entries from the team.
  // Manager sees everything.
  const TYPES = ['Appraisal','Training','Achievement','Note','1-to-1','Feedback','Incident Report'];
  const typeColor = { Appraisal:'amber', Training:'green', Achievement:'blue', Note:'purple', '1-to-1':'amber', Feedback:'green', 'Incident Report':'red' };

  const canSee = (entry) => {
    if (isManager) return true;
    if (entry.userId === currentUser) return true;
    if (!entry.private) return true;
    return false;
  };

  const visible = logbook
    .filter(canSee)
    .filter(l => filter === 'all' ? true : l.userId === filter)
    .sort((a, b) => new Date(b.date || b.created) - new Date(a.date || a.created));

  const openAdd  = () => {
    setForm({ userId: isManager ? (users[0]?.id || currentUser) : currentUser, type: 'Note', date: new Date().toISOString().slice(0,10), summary: '', content: '', private: false });
    setEditId(null); setShowModal(true);
  };

  const openEdit = (l, e) => {
    e?.stopPropagation();
    const canEdit = l.userId === currentUser || isManager;
    if (!canEdit) { alert('You can only edit your own entries.'); return; }
    setForm({ ...l });
    setEditId(l.id);
    setShowModal(true);
  };

  const save = () => {
    if (!form.date) return;
    if (editId) {
      setLogbook(logbook.map(l => l.id === editId ? { ...l, ...form } : l));
    } else {
      setLogbook([...logbook, { id: 'log-' + Date.now(), ...form, createdBy: currentUser, created: new Date().toISOString().slice(0,10) }]);
    }
    setShowModal(false);
  };

  const deleteOne  = (id, e) => {
    e?.stopPropagation();
    const entry = logbook.find(l => l.id === id);
    if (!isManager && entry?.userId !== currentUser) { alert('You can only delete your own entries.'); return; }
    if (window.confirm('Delete entry?')) setLogbook(logbook.filter(l => l.id !== id));
  };
  const deleteBulk = () => {
    if (!isManager) return;
    if (window.confirm(`Delete ${selected.size}?`)) { setLogbook(logbook.filter(l => !selected.has(l.id))); clearAll(); }
  };

  // Detail view
  if (viewEntry) {
    const l = logbook.find(e => e.id === viewEntry);
    if (!l) { setViewEntry(null); return null; }
    const author = users.find(u => u.id === l.userId);
    const canEdit = l.userId === currentUser || isManager;
    return (
      <div>
        <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center', flexWrap:'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setViewEntry(null)}>← Back</button>
          {canEdit && <button className="btn btn-secondary btn-sm" onClick={e => { openEdit(l, e); setViewEntry(null); }}>✏ Edit</button>}
          {canEdit && <button className="btn btn-danger btn-sm" onClick={e => { deleteOne(l.id, e); setViewEntry(null); }}>🗑 Delete</button>}
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
            <Tag label={l.type} type={typeColor[l.type]||'blue'} />
            {l.private && <Tag label="🔒 Private" type="red" />}
            <span className="muted-xs">{l.date}</span>
          </div>
        </div>
        <div className="card">
          <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:14 }}>
            <Avatar user={author} size={36} />
            <div>
              <div style={{ fontWeight:600, fontSize:15 }}>{author?.name}</div>
              <div className="muted-xs">{l.date} · {l.type}</div>
            </div>
          </div>
          {l.summary && <div style={{ fontSize:16, fontWeight:600, color:'var(--text-primary)', marginBottom:12 }}>{l.summary}</div>}
          <div style={{ fontSize:14, lineHeight:1.85, color:'var(--text-secondary)' }} dangerouslySetInnerHTML={{ __html: l.content || '<em>No content</em>' }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="📓 Logbook"
        sub={isManager ? 'Record & review appraisals, training, notes for all engineers' : 'Your personal logbook — add notes, training records, achievements'}
        actions={<>
          {isManager && selected.size > 0 && <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>}
          <button className="btn btn-primary" onClick={openAdd}>+ Add Entry</button>
        </>} />

      {!isManager && (
        <Alert type="info" style={{ marginBottom:16 }}>
          📓 Add your own training, achievements, notes and feedback. Private entries are only visible to you and the manager. Non-private entries are visible to the whole team.
        </Alert>
      )}

      {/* Stats row */}
      <div className="grid-4 mb-16">
        <StatCard label="Total Entries" value={visible.length} sub="Visible to you" accent="#3b82f6" icon="📋" />
        <StatCard label="My Entries" value={logbook.filter(l => l.userId === currentUser).length} sub="Your records" accent="#10b981" icon="✍️" />
        <StatCard label="Achievements" value={logbook.filter(l => l.type === 'Achievement' && canSee(l)).length} sub="Team total" accent="#f59e0b" icon="🏆" />
        <StatCard label="Training" value={logbook.filter(l => l.type === 'Training' && canSee(l)).length} sub="Team total" accent="#818cf8" icon="📚" />
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        {isManager && (
          <select className="select" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All Engineers</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <select className="select" value={filter === currentUser && !isManager ? 'mine' : 'all'} onChange={e => {
          if (!isManager) setFilter(e.target.value === 'mine' ? currentUser : 'all');
        }} style={{ display: isManager ? 'none' : 'block' }}>
          <option value="mine">My Entries</option>
          <option value="all">All (Team)</option>
        </select>
        {isManager && selected.size > 0 && <span className="muted-xs">{selected.size} selected</span>}
      </div>

      {visible.length === 0 && (
        <div className="card" style={{ padding:32, textAlign:'center', color:'var(--text-muted)' }}>
          No logbook entries yet. Click <strong>+ Add Entry</strong> to create one.
        </div>
      )}

      {visible.map(l => {
        const u = users.find(x => x.id === l.userId);
        const canEdit = l.userId === currentUser || isManager;
        return (
          <div key={l.id} className="card mb-12" onClick={() => setViewEntry(l.id)} style={{ cursor:'pointer', transition:'border-color .15s' }}>
            <div className="flex-between mb-8">
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {isManager && <input type="checkbox" checked={selected.has(l.id)} onChange={e => { e.stopPropagation(); toggleOne(l.id); }} onClick={e => e.stopPropagation()} />}
                <Avatar user={u} size={28} />
                <div>
                  <div className="name-sm">{u?.name}</div>
                  <div className="muted-xs">{l.date}</div>
                </div>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <Tag label={l.type} type={typeColor[l.type]||'blue'} />
                {l.private && <Tag label="🔒 Private" type="red" />}
                {canEdit && <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); openEdit(l, e); }}>✏</button>}
                {canEdit && <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); deleteOne(l.id, e); }}>🗑</button>}
              </div>
            </div>
            {l.summary && <div style={{ fontWeight:500, fontSize:13, color:'var(--text-primary)', marginBottom:6 }}>{l.summary}</div>}
            <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.6 }}
              dangerouslySetInnerHTML={{ __html: (l.content||'').replace(/<[^>]+>/g,'').slice(0,200) + (l.content?.length > 200 ? '…' : '') }} />
          </div>
        );
      })}

      {showModal && (
        <Modal title={editId ? 'Edit Entry' : 'New Logbook Entry'} onClose={() => setShowModal(false)} wide>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            {isManager && (
              <FormGroup label="Engineer">
                <select className="select" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </FormGroup>
            )}
            <FormGroup label="Type">
              <select className="select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Date">
              <input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </FormGroup>
            <FormGroup label="Summary (optional)">
              <input className="input" placeholder="One-line summary" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} />
            </FormGroup>
          </div>
          <FormGroup label="Full Notes">
            <RichEditor value={form.content} onChange={v => setForm(f => ({ ...f, content: v }))} placeholder="Detailed notes, observations, feedback, training details…" rows={8} />
          </FormGroup>
          <FormGroup label="Visibility">
            <label style={{ display:'flex', gap:8, alignItems:'center', cursor:'pointer', fontSize:13 }}>
              <input type="checkbox" checked={!!form.private} onChange={e => setForm(f => ({ ...f, private: e.target.checked }))} />
              🔒 Private — only visible to me and the manager
            </label>
          </FormGroup>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!form.date}>{editId ? 'Update Entry' : 'Save Entry'}</button>
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
  const [activeTab, setActiveTab]   = useState('personal');
  const [showModal, setShowModal]   = useState(false);
  const [editId, setEditId]         = useState(null);
  const [form, setForm]             = useState({ title: '', content: '', type: 'personal', tags: '' });
  const [search, setSearch]         = useState('');
  const [viewNote, setViewNote]     = useState(null);
  const importRef                   = useRef(null);
  const exportRef                   = useRef(null);

  // Personal = only the author can see. Shared = whole team including manager.
  const personalNotes = obsidianNotes.filter(n => n.type === 'personal' && n.engineerId === currentUser);
  const sharedNotes   = obsidianNotes.filter(n => n.type === 'shared');

  const visibleNotes  = activeTab === 'personal' ? personalNotes : sharedNotes;
  const filtered      = visibleNotes.filter(n =>
    n.title?.toLowerCase().includes(search.toLowerCase()) ||
    (n.content||'').toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setForm({ title: '', content: '', type: activeTab === 'personal' ? 'personal' : 'shared', tags: '' });
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (note, e) => {
    e?.stopPropagation();
    if (note.engineerId !== currentUser && !isManager) { alert('You can only edit your own notes.'); return; }
    setForm({ title: note.title, content: note.content||'', type: note.type||'personal', tags: note.tags||'' });
    setEditId(note.id);
    setShowModal(true);
  };

  const save = () => {
    if (!form.title) return;
    if (editId) {
      setObsidianNotes(obsidianNotes.map(n => n.id === editId ? { ...n, ...form, updated: new Date().toISOString().slice(0,10) } : n));
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

  const deleteNote = (noteId, e) => {
    e?.stopPropagation();
    const note = obsidianNotes.find(n => n.id === noteId);
    if (!note) return;
    if (note.engineerId !== currentUser && !isManager) { alert('You can only delete your own notes.'); return; }
    if (window.confirm('Delete this note?')) {
      setObsidianNotes(obsidianNotes.filter(n => n.id !== noteId));
      if (viewNote?.id === noteId) setViewNote(null);
    }
  };

  // Import .md files
  const handleImport = async (e) => {
    const files = Array.from(e.target.files || []);
    const imported = [];
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      const text = await file.text();
      let content = text;
      if (ext === 'md') {
        // Convert basic markdown to HTML for the rich editor
        content = text
          .replace(/^### (.+)$/gm, '<h3>$1</h3>')
          .replace(/^## (.+)$/gm, '<h2>$1</h2>')
          .replace(/^# (.+)$/gm, '<h1>$1</h1>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/\n\n/g, '</p><p>')
          .replace(/\n/g, '<br>');
        content = '<p>' + content + '</p>';
      }
      imported.push({
        id: 'note-' + Date.now() + Math.random(),
        engineerId: currentUser,
        title: file.name.replace(/\.(md|txt)$/, ''),
        content,
        type: activeTab === 'personal' ? 'personal' : 'shared',
        tags: 'imported',
        created: new Date().toISOString().slice(0, 10),
        sourceFile: file.name
      });
    }
    if (imported.length > 0) setObsidianNotes([...obsidianNotes, ...imported]);
    e.target.value = '';
  };

  // Export visible notes as .md files (zip-like: one file per note)
  const handleExport = () => {
    filtered.forEach(note => {
      const text = (note.content || '').replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      const blob = new Blob([`# ${note.title}\n\n${text}`], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${note.title.replace(/[^a-z0-9]/gi,'_')}.md`;
      a.click();
    });
  };

  // Note detail view
  if (viewNote) {
    const note = obsidianNotes.find(n => n.id === viewNote);
    if (!note) { setViewNote(null); return null; }
    const canEdit = note.engineerId === currentUser || isManager;
    const author  = users.find(u => u.id === note.engineerId);
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setViewNote(null)}>← Back</button>
          {canEdit && <button className="btn btn-secondary btn-sm" onClick={e => { openEdit(note, e); setViewNote(null); }}>✏ Edit</button>}
          {canEdit && <button className="btn btn-danger btn-sm" onClick={e => { deleteNote(note.id, e); }}>🗑 Delete</button>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Tag label={note.type === 'personal' ? '🔒 Personal' : '🌐 Shared'} type={note.type === 'personal' ? 'red' : 'green'} />
            <span className="muted-xs">{note.created}</span>
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{note.title}</div>
          {note.tags && (
            <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {note.tags.split(',').map(t => <Tag key={t} label={t.trim()} type="purple" />)}
            </div>
          )}
          {author && note.type === 'shared' && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              ✍️ {author.name} · {note.updated ? `Updated ${note.updated}` : `Created ${note.created}`}
            </div>
          )}
          <div style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--text-secondary)' }}
            dangerouslySetInnerHTML={{ __html: note.content || '' }} />
        </div>
      </div>
    );
  }

  const TAB_STYLE = (id) => ({
    padding: '8px 20px', border: 'none', borderBottom: `2px solid ${activeTab === id ? 'var(--accent)' : 'transparent'}`,
    background: 'transparent', color: activeTab === id ? 'var(--accent)' : 'var(--text-muted)',
    fontWeight: activeTab === id ? 700 : 400, cursor: 'pointer', fontSize: 14, transition: 'all 0.15s'
  });

  const NoteCard = ({ note }) => {
    const author  = users.find(u => u.id === note.engineerId);
    const canEdit = note.engineerId === currentUser || isManager;
    const preview = (note.content || '').replace(/<[^>]+>/g, '').slice(0, 120);
    return (
      <div className="card card-sm" onClick={() => setViewNote(note.id)} style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}>
        <div className="flex-between mb-8">
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1, paddingRight: 8 }}>
            {note.type === 'shared' ? '🌐' : '🔒'} {note.title}
          </div>
          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
            {canEdit && <button className="btn btn-secondary btn-sm" onClick={e => openEdit(note, e)}>✏</button>}
            {canEdit && <button className="btn btn-danger btn-sm" onClick={e => deleteNote(note.id, e)}>🗑</button>}
          </div>
        </div>
        {note.tags && <div style={{ marginBottom: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {note.tags.split(',').filter(Boolean).map(t => <Tag key={t} label={t.trim()} type="purple" />)}
        </div>}
        <div className="muted-xs" style={{ lineHeight: 1.5 }}>{preview}{preview.length >= 120 ? '…' : ''}</div>
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
          {note.type === 'shared' && author ? <span>✍️ {author.name}</span> : <span />}
          <span>{note.updated || note.created}</span>
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader title="📝 Notes"
        sub="Personal notes are private to you · Shared notes are visible to the whole team"
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={() => importRef.current?.click()}>📥 Import</button>
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={filtered.length === 0}>📤 Export</button>
          <button className="btn btn-primary" onClick={openAdd}>+ New Note</button>
        </>} />
      <input ref={importRef} type="file" multiple accept=".md,.txt" onChange={handleImport} style={{ display: 'none' }} />

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <button style={TAB_STYLE('personal')} onClick={() => setActiveTab('personal')}>
          🔒 Personal ({personalNotes.length})
        </button>
        <button style={TAB_STYLE('shared')} onClick={() => setActiveTab('shared')}>
          🌐 Shared ({sharedNotes.length})
        </button>
      </div>

      {/* Tab description */}
      <Alert type="info" style={{ marginBottom: 16 }}>
        {activeTab === 'personal'
          ? '🔒 Personal notes are only visible to you. Nobody else can see these, not even the manager.'
          : '🌐 Shared notes are visible to everyone on the team including the manager. Anyone can add a shared note.'}
      </Alert>

      {/* Search */}
      <input className="input" placeholder="🔍 Search notes…" value={search}
        onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, width: '100%' }} />

      {/* Notes grid */}
      {filtered.length === 0
        ? <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            No {activeTab} notes yet. Click <strong>+ New Note</strong> to create one.
          </div>
        : <div className="grid-2">
            {filtered.map(note => <NoteCard key={note.id} note={note} />)}
          </div>
      }

      {/* New / Edit modal */}
      {showModal && (
        <Modal title={editId ? 'Edit Note' : 'New Note'} onClose={() => setShowModal(false)} wide>
          <FormGroup label="Title">
            <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Note title…" autoFocus />
          </FormGroup>
          <FormGroup label="Note Type">
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { val: 'personal', label: '🔒 Personal', sub: 'Only you can see this' },
                { val: 'shared',   label: '🌐 Shared',   sub: 'Whole team can see this' }
              ].map(opt => (
                <div key={opt.val} onClick={() => setForm({ ...form, type: opt.val })}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                    border: `2px solid ${form.type === opt.val ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.type === opt.val ? 'rgba(59,130,246,0.1)' : 'var(--bg-card2)'
                  }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: form.type === opt.val ? 'var(--accent)' : 'var(--text-primary)' }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.sub}</div>
                </div>
              ))}
            </div>
          </FormGroup>
          <FormGroup label="Tags" hint="comma separated">
            <input className="input" placeholder="e.g. important, runbook, learning" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
          </FormGroup>
          <FormGroup label="Content">
            <RichEditor value={form.content} onChange={v => setForm(f => ({ ...f, content: v }))} placeholder="Write your note…" rows={10} />
          </FormGroup>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!form.title}>{editId ? 'Update Note' : 'Save Note'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

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


// ── WhatsApp Team Chat ────────────────────────────────────────────────────
function WhatsAppChat({ whatsappChats, setWhatsappChats, users, currentUser, isManager, driveToken }) {
  const [selectedChat, setSelectedChat] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [showCreateChat, setShowCreateChat] = useState(false);
  const [chatForm, setChatForm] = useState({ name: '', members: [] });
  const [saveStatus, setSaveStatus] = useState('');
  const [loadingChats, setLoadingChats] = useState(false);
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);

  // ── Two-way sync: load chats from Drive JSON on mount / when Drive connects ─
  useEffect(() => {
    if (!driveToken) return;
    const loadChats = async () => {
      setLoadingChats(true);
      try {
        const f = await driveFindFile(driveToken, 'whatsappChats.json');
        if (f) {
          const data = await driveReadJson(driveToken, f.id);
          if (Array.isArray(data) && data.length > 0) {
            // Merge: keep any local messages that might be newer
            setWhatsappChats(prev => {
              if (data.length >= prev.length) return data; // Drive has more — trust Drive
              return prev;
            });
          }
        }
      } catch (e) { console.warn('Chat load from Drive:', e?.message); }
      finally { setLoadingChats(false); }
    };
    loadChats();
  }, [driveToken]); // re-runs whenever Drive token becomes available

  // Auto-select first available chat
  useEffect(() => {
    if (!selectedChat && whatsappChats.length > 0) {
      setSelectedChat(whatsappChats[0].id);
    }
  }, [whatsappChats]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedChat, whatsappChats.length, whatsappChats.map?.(c => (c.messages||[]).length).join(',')]);

  // Manual refresh from Drive
  const refreshFromDrive = async () => {
    if (!driveToken) { setSaveStatus('⚠ Drive not connected'); return; }
    setLoadingChats(true);
    setSaveStatus('⏳ Loading chats from Drive…');
    try {
      const f = await driveFindFile(driveToken, 'whatsappChats.json');
      if (f) {
        const data = await driveReadJson(driveToken, f.id);
        if (Array.isArray(data)) {
          setWhatsappChats(data);
          if (data.length > 0 && !selectedChat) setSelectedChat(data[0].id);
          setSaveStatus(`✅ Loaded ${data.length} chat(s) from Drive`);
        } else { setSaveStatus('⚠ No chats found in Drive'); }
      } else { setSaveStatus('⚠ No chat data found in Drive yet'); }
    } catch (e) { setSaveStatus('❌ Load failed: ' + (e?.message || e)); }
    setLoadingChats(false);
    setTimeout(() => setSaveStatus(''), 4000);
  };

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
    setWhatsappChats(prev => [...prev, chat]);
    setShowCreateChat(false);
    setChatForm({ name: '', members: [] });
    setSelectedChat(chat.id);
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !selectedChat) return;
    const message = {
      id: 'msg-' + Date.now(),
      sender: currentUser,
      content: newMessage.trim(),
      timestamp: new Date().toISOString()
    };
    setWhatsappChats(prev => prev.map(c =>
      c.id === selectedChat
        ? { ...c, messages: [...(c.messages || []), message] }
        : c
    ));
    setNewMessage('');
    setSaveStatus('✓ Saved');
    setTimeout(() => setSaveStatus(''), 2000);
    if (driveToken) setTimeout(() => syncToGoogleDoc(), 500);
  };

  const deleteChat = (chatId) => {
    if (window.confirm('Delete this chat?')) {
      setWhatsappChats(prev => prev.filter(c => c.id !== chatId));
      setSelectedChat(null);
    }
  };

  // Save all chats to Google Doc (creates/updates a single compact doc)
  const syncToGoogleDoc = async () => {
    if (!driveToken) {
      setSaveStatus('⚠️ Connect Drive first');
      setTimeout(() => setSaveStatus(''), 3000);
      return;
    }
    setSaveStatus('⏳ Syncing to Google Doc…');
    try {
      const DOC_NAME = 'CloudOps-TeamChat';
      // Check if doc already exists
      const listResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name%3D'${DOC_NAME}'+and+trashed%3Dfalse+and+mimeType%3D'application%2Fvnd.google-apps.document'&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      ).then(r => r.json());

      let docId = listResp.files && listResp.files.length > 0 ? listResp.files[0].id : null;

      if (!docId) {
        // Create new doc
        const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: DOC_NAME, mimeType: 'application/vnd.google-apps.document' })
        }).then(r => r.json());
        docId = createResp.id;
      }

      // Build compact plain text content
      const lines = [];
      lines.push(`CloudOps Team Chat — exported ${new Date().toLocaleString('en-GB')}`);
      lines.push('='.repeat(60));
      whatsappChats.forEach(chat => {
        lines.push(`\n=== ${chat.name} (${chat.members.length} members) ===`);
        (chat.messages || []).forEach(m => {
          const sender = users.find(u => u.id === m.sender)?.name || m.sender;
          const time = new Date(m.timestamp).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
          lines.push(`[${time}] ${sender}: ${m.content}`);
        });
        if ((chat.messages||[]).length === 0) lines.push('(no messages)');
      });
      const fullText = lines.join('\n');

      // Clear existing content and write new content via Docs API
      // First get doc to find end index
      const docResp = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
        headers: { Authorization: `Bearer ${driveToken}` }
      }).then(r => r.json());
      const endIndex = docResp.body?.content?.slice(-1)[0]?.endIndex || 1;

      const requests = [];
      if (endIndex > 1) {
        requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
      }
      requests.push({ insertText: { location: { index: 1 }, text: fullText } });

      await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      });

      setSaveStatus(`✅ Synced to Google Doc "${DOC_NAME}"`);
      setTimeout(() => setSaveStatus(''), 4000);
    } catch (e) {
      console.error('Chat doc sync error:', e);
      setSaveStatus('⚠️ Drive not accessible. Speak to Meetul.');
      setTimeout(() => setSaveStatus(''), 4000);
    }
  };

  const currentChat = whatsappChats.find(c => c.id === selectedChat);

  return (
    <div>
      <PageHeader title="💬 Team Chat" sub="Team collaboration & messaging — auto-saved to Google Doc"
        actions={<>
          {saveStatus && <span style={{ fontSize:11, color: saveStatus.startsWith('✅') ? '#6ee7b7' : saveStatus.startsWith('⚠') || saveStatus.startsWith('❌') ? '#fcd34d' : 'var(--accent)' }}>{saveStatus}</span>}
          <button className="btn btn-secondary btn-sm" onClick={refreshFromDrive} disabled={loadingChats} title="Reload chats from Google Drive">{loadingChats ? '⏳' : '🔄 Refresh'}</button>
          {isManager && <button className="btn btn-secondary btn-sm" onClick={syncToGoogleDoc}>📄 Sync to Doc</button>}
          {isManager && <button className="btn btn-primary" onClick={() => setShowCreateChat(true)}>+ New Group</button>}
        </>} />

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, height: '70vh' }}>
        {/* Chat List */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-title">Groups ({whatsappChats.length})</div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {whatsappChats.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                No chats yet. {isManager ? 'Create one above!' : 'Ask your manager to create a group.'}
              </div>
            ) : (
              whatsappChats.map(chat => {
                const lastMsg = (chat.messages||[]).slice(-1)[0];
                const lastSender = lastMsg ? users.find(u=>u.id===lastMsg.sender)?.name?.split(' ')[0] || lastMsg.sender : null;
                return (
                  <div key={chat.id} onClick={() => setSelectedChat(chat.id)}
                    style={{ padding:'10px 12px', background: selectedChat===chat.id?'var(--accent)':'transparent',
                      color: selectedChat===chat.id?'#fff':'var(--text-primary)', borderRadius:6, cursor:'pointer', marginBottom:6, fontSize:13 }}>
                    <div style={{ fontWeight:500, marginBottom:2 }}>💬 {chat.name}</div>
                    <div style={{ fontSize:11, opacity:0.75 }}>{chat.members.length} members · {(chat.messages||[]).length} msgs</div>
                    {lastMsg && <div style={{ fontSize:10, opacity:0.6, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {lastSender}: {lastMsg.content.slice(0,30)}{lastMsg.content.length>30?'…':''}
                    </div>}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Chat View */}
        {currentChat ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingBottom:12, borderBottom:'1px solid var(--border)' }}>
              <div>
                <h3 style={{ margin:'0 0 2px' }}>{currentChat.name}</h3>
                <div style={{ fontSize:11, color:'var(--text-muted)' }}>
                  {currentChat.members.map(id => users.find(u=>u.id===id)?.name?.split(' ')[0]).filter(Boolean).join(', ')}
                </div>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                {isManager && <button className="btn btn-danger btn-sm" onClick={() => deleteChat(currentChat.id)}>🗑 Delete</button>}
              </div>
            </div>

            <div style={{ overflowY:'auto', flex:1, padding:'12px', display:'flex', flexDirection:'column', gap:8 }}>
              {(currentChat.messages||[]).length === 0 ? (
                <div style={{ textAlign:'center', color:'var(--text-muted)', margin:'auto' }}>No messages yet. Start the conversation!</div>
              ) : (
                (currentChat.messages||[]).map(msg => {
                  const sender = users.find(u => u.id === msg.sender);
                  const isOwn = msg.sender === currentUser;
                  return (
                    <div key={msg.id} style={{ display:'flex', justifyContent:isOwn?'flex-end':'flex-start' }}>
                      {!isOwn && <Avatar user={sender||{avatar:'?',color:'#475569'}} size={28} style={{ marginRight:6, flexShrink:0 }} />}
                      <div style={{ maxWidth:'70%', padding:'8px 12px', borderRadius:12,
                        background: isOwn ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                        color: isOwn ? '#fff' : 'var(--text-primary)', fontSize:13 }}>
                        {!isOwn && <div style={{ fontSize:11, fontWeight:600, opacity:0.8, marginBottom:2 }}>{sender?.name}</div>}
                        <div style={{ wordBreak:'break-word' }}>{msg.content}</div>
                        <div style={{ fontSize:9, opacity:0.6, marginTop:4, textAlign:'right' }}>
                          {new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div style={{ padding:'12px', borderTop:'1px solid var(--border)', display:'flex', gap:8 }}>
              <input type="text" className="input" placeholder="Type a message… (Enter to send)"
                value={newMessage} onChange={e => setNewMessage(e.target.value)}
                onKeyDown={e => e.key==='Enter' && !e.shiftKey && sendMessage()}
                style={{ flex:1, margin:0 }} />
              <button className="btn btn-primary btn-sm" onClick={sendMessage} disabled={!newMessage.trim()}>Send</button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', textAlign:'center' }}>
            <div><div style={{ fontSize:32, marginBottom:8 }}>💬</div><div>Select a chat or create a new group</div></div>
          </div>
        )}
      </div>

      {showCreateChat && (
        <Modal title="Create Group Chat" onClose={() => setShowCreateChat(false)}>
          <FormGroup label="Group Name">
            <input className="input" placeholder="e.g. Cloud Ops Team" value={chatForm.name}
              onChange={e => setChatForm({ ...chatForm, name: e.target.value })} />
          </FormGroup>
          <FormGroup label="Add Members">
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {users.filter(u => u.id !== currentUser).map(u => (
                <label key={u.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px', cursor:'pointer' }}>
                  <input type="checkbox" checked={chatForm.members.includes(u.id)}
                    onChange={e => {
                      if (e.target.checked) setChatForm({ ...chatForm, members:[...chatForm.members, u.id] });
                      else setChatForm({ ...chatForm, members:chatForm.members.filter(id=>id!==u.id) });
                    }} />
                  <Avatar user={u} size={24} />
                  <span style={{ fontSize:13 }}>{u.name} ({u.id})</span>
                </label>
              ))}
            </div>
          </FormGroup>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button className="btn btn-secondary" onClick={() => setShowCreateChat(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={createChat} disabled={!chatForm.name||chatForm.members.length===0}>Create Group</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Insights (Manager only) ────────────────────────────────────────────────
function Insights({ users, incidents, timesheets, holidays, absences, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Insights are restricted to managers.</Alert>;
  const disasters = incidents.filter(i => i.severity === 'Disaster').length;
  const resolved = incidents.filter(i => i.status === 'Resolved').length;
  const totalOC = Object.values(timesheets).flatMap(t => t).reduce((a, b) => a + (b.weekday_oncall || 0) + (b.weekend_oncall || 0), 0);

  return (
    <div>
      <PageHeader title="Insights" sub="Team performance and operational metrics" />
      <div className="grid-4 mb-16">
        <StatCard label="Total Incidents"  value={incidents.length}  sub={disasters + ' disasters'}  accent="#ef4444" icon="🚨" />
        <StatCard label="Resolution Rate"  value={(incidents.length ? Math.round(resolved/incidents.length*100) : 0) + '%'} sub={resolved + '/' + incidents.length} accent="#10b981" icon="✅" />
        <StatCard label="Total OC Hours"   value={totalOC}           sub="All engineers"          accent="#3b82f6" icon="⏱" />
        <StatCard label="Approved Leave"   value={holidays.length}   sub="Entries"                accent="#f59e0b" icon="🌴" />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">Incident Breakdown by Engineer</div>
          <table>
            <thead><tr><th>Engineer</th><th>Total</th><th>Disasters</th><th>Resolved</th></tr></thead>
            <tbody>
              {users.map(u => {
                const inc = incidents.filter(i => i.assigned_to === u.id);
                const p   = inc.filter(i => i.severity === 'Disaster').length;
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
function Capacity({ users, rota, holidays, timesheets, incidents, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Capacity is restricted to managers.</Alert>;
  const today = new Date();
  const [planWeeks, setPlanWeeks] = useState(12);

  const weeks = Array.from({ length: planWeeks }, (_, w) => {
    const start = new Date(today);
    start.setDate(today.getDate() + w * 7 - today.getDay() + 1);
    const days = Array.from({ length: 5 }, (_, d) => { const dt = new Date(start); dt.setDate(start.getDate()+d); return dt.toISOString().slice(0,10); });
    const onLeave = users.filter(u => days.some(d => (holidays||[]).find(h => h.userId===u.id && d>=h.start && d<=h.end)));
    const available = users.length - onLeave.length;
    const openIncs = (incidents||[]).filter(i => { const id = i.date?.slice(0,10); return id >= days[0] && id <= days[4] && i.status==='Investigating'; }).length;
    return { label: `W${w+1}`, startDate: start.toISOString().slice(0,10), available, total: users.length, onLeave: onLeave.map(u=>u.name.split(' ')[0]), openIncs };
  });

  const maxAvail = users.length;

  const engineerCapacity = users.map(u => {
    const leaveWeeks = weeks.filter(w => {
      const wStart = w.startDate;
      const wEnd = new Date(wStart); wEnd.setDate(new Date(wStart).getDate()+4);
      return (holidays||[]).some(h => h.userId===u.id && h.start<=wEnd.toISOString().slice(0,10) && h.end>=wStart);
    }).length;
    const sheets = timesheets[u.id] || [];
    const totalOC = sheets.reduce((a,b)=>a+(b.weekday_oncall||0)+(b.weekend_oncall||0),0);
    const ocIncs = (incidents||[]).filter(i=>i.assigned_to===u.id).length;
    const openIncs = (incidents||[]).filter(i=>i.assigned_to===u.id&&i.status==='Investigating').length;
    const resolvedIncs = (incidents||[]).filter(i=>i.assigned_to===u.id&&i.status==='Resolved').length;
    const availPct = Math.round(((planWeeks-leaveWeeks)/planWeeks)*100);
    const incHrs = sheets.filter(e=>e.week&&e.week.startsWith('INC')).reduce((a,e)=>a+(e.weekday_oncall||0)+(e.weekend_oncall||0),0);
    return { ...u, leaveWeeks, totalOC, ocIncs, openIncs, resolvedIncs, availPct, incHrs };
  });

  // Incident distribution pie per engineer
  const incByEng = users.map(u => ({ name: u.name.split(' ')[0], count: (incidents||[]).filter(i=>i.assigned_to===u.id).length }));
  const maxIncEng = Math.max(...incByEng.map(e => e.count), 1);
  const incColors = ['#ef4444','#f59e0b','#3b82f6','#10b981','#818cf8','#ec4899','#14b8a6','#f97316'];

  // Average weekly capacity
  const avgAvail = Math.round(weeks.reduce((a,w)=>a+w.available,0)/weeks.length);
  const minAvail = Math.min(...weeks.map(w=>w.available));
  const criticalWeeks = weeks.filter(w => (w.available/maxAvail) < 0.5).length;

  return (
    <div>
      <PageHeader title="Capacity Planning" sub="Forward view of team availability, workload and risk" />

      <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center', flexWrap:'wrap' }}>
        <span style={{ fontSize:13, color:'var(--text-muted)' }}>Planning horizon:</span>
        {[4,8,12,16,26,52].map(w => (
          <button key={w} className={`btn btn-sm ${planWeeks===w?'btn-primary':'btn-secondary'}`} onClick={() => setPlanWeeks(w)}>
            {w}w{w===52?' (1yr)':w===26?' (6mo)':''}
          </button>
        ))}
      </div>

      {/* KPI row */}
      <div className="grid-4 mb-16">
        <StatCard label="Planning Weeks"  value={planWeeks}                          sub="Forward view"            accent="#3b82f6" />
        <StatCard label="Avg Available"   value={`${avgAvail}/${maxAvail}`}          sub="Engineers per week"      accent="#10b981" />
        <StatCard label="Min Available"   value={`${minAvail}/${maxAvail}`}          sub="Lowest week"             accent="#ef4444" />
        <StatCard label="Critical Weeks"  value={criticalWeeks}                      sub="< 50% capacity"          accent={criticalWeeks>0?'#ef4444':'#10b981'} />
      </div>

      {/* Availability bar chart */}
      <div className="card mb-16">
        <div className="card-title">📊 Team Availability — {planWeeks}-Week Forward View</div>
        <div style={{ overflowX:'auto' }}>
          <div style={{ display:'flex', gap:4, alignItems:'flex-end', minWidth: planWeeks * 44, paddingBottom:8 }}>
            {weeks.map(w => {
              const pct = (w.available / maxAvail) * 100;
              const color = pct > 80 ? '#10b981' : pct > 50 ? '#f59e0b' : '#ef4444';
              return (
                <div key={w.label} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4, minWidth:40 }}
                  title={`${w.label}: ${w.available}/${maxAvail} available${w.onLeave.length?'\nOn leave: '+w.onLeave.join(', '):''}${w.openIncs?'\nOpen incidents: '+w.openIncs:''}`}>
                  <div style={{ fontSize:9, fontFamily:'DM Mono', color:'var(--text-muted)', textAlign:'center' }}>{w.available}/{maxAvail}</div>
                  {w.openIncs > 0 && <div style={{ fontSize:9, color:'#ef4444' }}>🚨{w.openIncs}</div>}
                  <div style={{ width:'100%', height:80, background:'var(--bg-card2)', borderRadius:4, display:'flex', alignItems:'flex-end', overflow:'hidden' }}>
                    <div style={{ width:'100%', height:`${pct}%`, background:color, transition:'height 0.3s' }} />
                  </div>
                  <div style={{ fontSize:9, color:'var(--text-muted)', textAlign:'center' }}>{w.label}</div>
                  <div style={{ fontSize:8, color:'var(--text-muted)', textAlign:'center' }}>{w.startDate.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display:'flex', gap:16, marginTop:8, fontSize:11, color:'var(--text-muted)' }}>
          <span><span style={{ background:'#10b981', display:'inline-block', width:10, height:10, borderRadius:2, marginRight:4 }}/>&gt; 80% (Healthy)</span>
          <span><span style={{ background:'#f59e0b', display:'inline-block', width:10, height:10, borderRadius:2, marginRight:4 }}/>50–80% (Reduced)</span>
          <span><span style={{ background:'#ef4444', display:'inline-block', width:10, height:10, borderRadius:2, marginRight:4 }}/>&lt; 50% (Critical)</span>
          <span>🚨 = Open incidents</span>
        </div>
      </div>

      <div className="grid-2 mb-16">
        {/* Incident load per engineer bar chart */}
        <div className="card">
          <div className="card-title">🚨 Incident Load per Engineer</div>
          {incByEng.map((e, i) => (
            <div key={e.name} style={{ marginBottom:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                <span style={{ fontSize:12 }}>{e.name}</span>
                <span style={{ fontSize:11, fontFamily:'DM Mono', color: incColors[i % incColors.length] }}>{e.count} incident{e.count!==1?'s':''}</span>
              </div>
              <div style={{ height:8, background:'var(--bg-card2)', borderRadius:4, overflow:'hidden' }}>
                <div style={{ width:`${(e.count/maxIncEng)*100}%`, height:'100%', background: incColors[i % incColors.length], transition:'width 0.4s' }} />
              </div>
            </div>
          ))}
          {incByEng.every(e => e.count === 0) && <p className="muted-sm">No incidents assigned yet</p>}
        </div>

        {/* Per-engineer OC hours bar chart */}
        <div className="card">
          <div className="card-title">⏱ On-Call Hours per Engineer</div>
          {engineerCapacity.map((u, i) => {
            const maxH = Math.max(...engineerCapacity.map(e=>e.totalOC), 1);
            return (
              <div key={u.id} style={{ marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <Avatar user={u} size={18} />
                    <span style={{ fontSize:12 }}>{u.name.split(' ')[0]}</span>
                  </div>
                  <span style={{ fontSize:11, fontFamily:'DM Mono', color:'#6ee7b7' }}>{u.totalOC}h{u.incHrs>0?` (+${u.incHrs}h inc)`:''}</span>
                </div>
                <div style={{ height:8, background:'var(--bg-card2)', borderRadius:4, overflow:'hidden', display:'flex' }}>
                  <div style={{ width:`${((u.totalOC-u.incHrs)/maxH)*100}%`, height:'100%', background:'#166534' }} />
                  <div style={{ width:`${(u.incHrs/maxH)*100}%`, height:'100%', background:'#f59e0b' }} />
                </div>
              </div>
            );
          })}
          <div style={{ display:'flex', gap:12, marginTop:8, fontSize:11, color:'var(--text-muted)' }}>
            <span><span style={{ background:'#166534', display:'inline-block', width:10, height:10, borderRadius:2, marginRight:4 }} />Standby OC</span>
            <span><span style={{ background:'#f59e0b', display:'inline-block', width:10, height:10, borderRadius:2, marginRight:4 }} />Incident hrs</span>
          </div>
        </div>
      </div>

      {/* Weekly detail table */}
      <div className="card mb-16" style={{ overflowX:'auto' }}>
        <div className="card-title">📋 Weekly Availability Detail</div>
        <table style={{ minWidth: 500 }}>
          <thead>
            <tr><th>Week</th><th>Start Date</th><th>Available</th><th>Capacity %</th><th>On Leave</th><th>Open Incidents</th><th>Status</th></tr>
          </thead>
          <tbody>
            {weeks.map(w => {
              const pct = Math.round((w.available/maxAvail)*100);
              const statusLabel = pct > 80 ? 'Healthy' : pct > 50 ? 'Reduced' : 'Critical';
              const statusType = pct > 80 ? 'green' : pct > 50 ? 'amber' : 'red';
              return (
                <tr key={w.label}>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:'var(--accent)' }}>{w.label}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12 }}>{w.startDate}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, fontWeight:600 }}>{w.available}/{maxAvail}</td>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <div style={{ flex:1, height:6, background:'var(--bg-card2)', borderRadius:3, overflow:'hidden', minWidth:60 }}>
                        <div style={{ width:`${pct}%`, height:'100%', background:pct>80?'#10b981':pct>50?'#f59e0b':'#ef4444' }} />
                      </div>
                      <span style={{ fontSize:11, fontFamily:'DM Mono' }}>{pct}%</span>
                    </div>
                  </td>
                  <td style={{ fontSize:11, color:'var(--text-muted)' }}>{w.onLeave.join(', ') || '—'}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:w.openIncs>0?'#ef4444':'var(--text-muted)' }}>{w.openIncs || '—'}</td>
                  <td><Tag label={statusLabel} type={statusType} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Per-engineer capacity table */}
      <div className="card mb-16">
        <div className="card-title">👥 Per-Engineer Capacity ({planWeeks}w horizon)</div>
        <table style={{ overflowX:'auto', display:'block', minWidth:700 }}>
          <thead>
            <tr><th>Engineer</th><th>Leave Wks</th><th>Availability</th><th>OC Hours</th><th>Inc Hrs</th><th>Open Incs</th><th>Resolved</th><th>Avail %</th></tr>
          </thead>
          <tbody>
            {engineerCapacity.map(u => (
              <tr key={u.id}>
                <td><div style={{ display:'flex', gap:8, alignItems:'center' }}><Avatar user={u} size={22} /><span style={{ fontSize:12 }}>{u.name}</span></div></td>
                <td style={{ fontFamily:'DM Mono', fontSize:12, color: u.leaveWeeks>0?'#f59e0b':'var(--text-muted)' }}>{u.leaveWeeks}w</td>
                <td>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ width:80, height:6, background:'var(--bg-card2)', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ width:`${u.availPct}%`, height:'100%', background:u.availPct>80?'#10b981':u.availPct>50?'#f59e0b':'#ef4444' }} />
                    </div>
                    <span style={{ fontSize:11 }}>{planWeeks-u.leaveWeeks}/{planWeeks}w</span>
                  </div>
                </td>
                <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#6ee7b7' }}>{u.totalOC}h</td>
                <td style={{ fontFamily:'DM Mono', fontSize:12, color: u.incHrs>0?'#f59e0b':'var(--text-muted)' }}>{u.incHrs>0?`${u.incHrs}h`:'—'}</td>
                <td style={{ fontFamily:'DM Mono', fontSize:12, color: u.openIncs>0?'#ef4444':'var(--text-muted)' }}>{u.openIncs}</td>
                <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#10b981' }}>{u.resolvedIncs}</td>
                <td><span style={{ fontFamily:'DM Mono', fontSize:12, fontWeight:600, color:u.availPct>80?'#10b981':u.availPct>50?'#f59e0b':'#ef4444' }}>{u.availPct}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Alert>📈 Red = &lt;50% capacity, Amber = 50–80%, Green = &gt;80%. Hover over bars for week detail.</Alert>
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
function Payroll({ users, timesheets, payconfig, toil, incidents, upgrades, rota, holidays, isManager, overtime: overtimeArr }) {
  if (!isManager) return <Alert type="warning">⚠ Payroll is restricted to managers.</Alert>;

  const [showExport, setShowExport] = React.useState(false);
  const [exportStart, setExportStart] = React.useState('');
  const [exportEnd,   setExportEnd]   = React.useState('');
  const [exporting,   setExporting]   = React.useState(false);

  // Safe defaults so nothing crashes if props arrive undefined
  const safeUsers     = users     || [];
  const safeTS        = timesheets|| {};
  const safePay       = payconfig || {};
  const safeToil      = toil      || [];
  const safeUpgrades  = upgrades  || [];
  const safeOT        = overtimeArr || [];
  const safeRota      = rota      || {};
  const safeHolidays  = holidays  || [];
  const bhList        = (typeof UK_BANK_HOLIDAYS !== 'undefined') ? UK_BANK_HOLIDAYS : [];

  // ── Per-user helpers ──────────────────────────────────────────────────────
  const getUserData = (u, startDs, endDs) => {
    const p      = safePay[u.id] || { base: 2500 };
    const annual = p.annual || p.base * 12;
    const hourly = annual / 2080;

    // Filter timesheet entries to date range
    const ts = (safeTS[u.id] || []).filter(e => {
      if (!startDs || !endDs) return true;
      const w = e.weekStart || e.week || '';
      return w >= startDs && w <= endDs;
    });

    // Rota entries for this user filtered to date range
    const rotaForUser = Object.fromEntries(
      Object.entries(safeRota[u.id] || {}).filter(([date]) => {
        if (!startDs || !endDs) return true;
        return date >= startDs && date <= endDs;
      })
    );

    // Holidays for this user
    const userHols = safeHolidays.filter(h => h.userId === u.id);

    // Upgrade hours (approved only) in range
    const upgradeHrs = safeUpgrades.filter(up => {
      if (!startDs || !endDs) return true;
      return up.date >= startDs && up.date <= endDs;
    }).reduce((sum, up) => {
      const et = (up.engineerTimes || []).find(e => e.engineerId === u.id && e.approved);
      return sum + (et ? et.hours : 0);
    }, 0);

    // Bank holiday standby hours — extended weekend rules
    const bankHolHrs = (() => {
      let total = 0;
      bhList.forEach(bh => {
        if (startDs && bh.date < startDs) return;
        if (endDs   && bh.date > endDs)   return;
        const s = safeRota[u.id]?.[bh.date];
        if (!s || s === 'off') return;
        const dow = new Date(bh.date).getDay();
        const isWeekendOC = s === 'weekend' || s === 'bankholiday';
        if (isWeekendOC) {
          if (dow === 1) total += 24;
          else if (dow === 5) total += 12;
          else total += 22;
        } else { total += 22; }
      });
      return total;
    })();

    // Approved overtime hours in range
    const overtimeHrs = safeOT.filter(o =>
      o.userId === u.id && o.status === 'approved' &&
      (!startDs || o.date >= startDs) && (!endDs || o.date <= endDs)
    ).reduce((s, o) => s + (o.hours || 0), 0);

    const oc = calcOncallPay(ts, hourly, upgradeHrs, bankHolHrs, rotaForUser, userHols, bhList, startDs, endDs);
    const tb = calcTOILBalance(safeTS[u.id], safeToil, u.id);
    const incHrs = oc.incidentHrs || 0;
    return { p, annual, hourly, oc, tb, incHrs, upgradeHrs, bankHolHrs, overtimeHrs };
  };

  // ── Excel export ──────────────────────────────────────────────────────────
  const doExportExcel = async () => {
    setExporting(true);
    try {
      const loadXLSX = () => new Promise((res, rej) => {
        if (window.XLSX) { res(window.XLSX); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = () => res(window.XLSX); s.onerror = rej;
        document.head.appendChild(s);
      });
      const XLSX = await loadXLSX();

      const fmtUK    = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' }) : '';
      const fmtMonth = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { month:'long', year:'numeric' }) : '';
      const today    = fmtUK(new Date().toISOString().slice(0, 10));
      const rangeLabel = exportStart && exportEnd ? `${fmtUK(exportStart)} – ${fmtUK(exportEnd)}` : 'All time';

      // Helper: colour a range of cells in a worksheet
      const styleRange = (ws, r1, c1, r2, c2, style) => {
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            if (!ws[addr]) ws[addr] = { t: 's', v: '' };
            ws[addr].s = { ...ws[addr].s, ...style };
          }
        }
      };
      const styleRow = (ws, row, nCols, style) => styleRange(ws, row, 0, row, nCols - 1, style);

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 1 — Hours Summary (one row per engineer, totals)
      // ─────────────────────────────────────────────────────────────────────
      const s1Hdrs = [
        'Trigram', 'Full Name', 'Export Date', 'Period',
        'Standby WD (h)', 'Worked WD (h)', 'Standby WE (h)', 'Worked WE (h)',
        'Incident Hrs', 'Upgrade Hrs', 'Bank Hol Hrs', 'Overtime Hrs', 'TOIL Bal (h)',
      ];
      const s1Rows = safeUsers.map(u => {
        const { oc, tb, incHrs, upgradeHrs, bankHolHrs, overtimeHrs } = getUserData(u, exportStart, exportEnd);
        return [u.id, u.name, today, rangeLabel,
          oc.standbyWD, oc.workedWD, oc.standbyWE, oc.workedWE,
          incHrs, upgradeHrs, bankHolHrs, overtimeHrs||0, tb.balance];
      });
      const s1TotRow = ['TOTAL', `${safeUsers.length} engineers`, today, rangeLabel,
        ...Array.from({length:9}, (_,i) => s1Rows.reduce((a,r)=>a+(parseFloat(r[4+i])||0),0)), ''];
      const ws1Data = [s1Hdrs, ...s1Rows, s1TotRow];
      const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
      ws1['!cols'] = [8,24,12,18,14,13,14,13,12,12,12,13,13].map(w=>({wch:w}));
      ws1['!freeze'] = { xSplit: 2, ySplit: 1 }; // freeze name cols + header row
      // Header styling: dark navy bg, white bold text
      const H = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'0F1629'}}, alignment:{horizontal:'center',wrapText:true}, border:{bottom:{style:'medium',color:{rgb:'3B82F6'}}} };
      styleRow(ws1, 0, s1Hdrs.length, H);
      // Engineer rows: alternate light/dark
      s1Rows.forEach((_, i) => {
        const bg = i % 2 === 0 ? '0F1629' : '131D35';
        styleRow(ws1, i+1, s1Hdrs.length, { fill:{fgColor:{rgb:bg}}, font:{color:{rgb:'E2E8F0'}} });
        // Colour-code numeric cols
        for (let c = 4; c <= 11; c++) {
          const addr = XLSX.utils.encode_cell({r:i+1, c});
          if (!ws1[addr]) continue;
          const colours = ['93C5FD','93C5FD','A78BFA','A78BFA','FCD34D','818CF8','FCA5A5','6EE7B7'];
          ws1[addr].s = { ...ws1[addr].s, font:{color:{rgb:colours[c-4]}, bold: parseFloat(ws1[addr].v)>0 } };
        }
      });
      // Totals row: bold teal
      styleRow(ws1, s1Rows.length+1, s1Hdrs.length, { fill:{fgColor:{rgb:'1E3A5F'}}, font:{bold:true,color:{rgb:'6EE7B7'}}, border:{top:{style:'medium',color:{rgb:'3B82F6'}}} });

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 2 — Daily Detail (exact dates for every shift/overtime entry)
      // ─────────────────────────────────────────────────────────────────────
      const s2Hdrs = ['Trigram','Full Name','Date','Day','Shift Type','Hours','Category','Notes'];
      const SHIFT_HRS = { daily:9, evening:12, weekend:12, bankholiday:22, upgrade:8, holiday:0, off:0 };
      const SHIFT_CAT = { daily:'Daily Shift', evening:'Weekday On-Call', weekend:'Weekend On-Call', bankholiday:'Bank Holiday OC', upgrade:'Upgrade Day', holiday:'Annual Leave', off:'' };
      const s2Rows = [];

      safeUsers.forEach(u => {
        // Rota entries — exact dates
        const rotaEntries = Object.entries(safeRota[u.id]||{})
          .filter(([d,s]) => s && s !== 'off' && (!exportStart||d>=exportStart) && (!exportEnd||d<=exportEnd))
          .sort(([a],[b]) => a.localeCompare(b));
        rotaEntries.forEach(([date, shift]) => {
          const dayName = new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'});
          const hrs = SHIFT_HRS[shift] || 0;
          if (hrs > 0) s2Rows.push([u.id, u.name, fmtUK(date), dayName, SHIFT_CAT[shift]||shift, hrs, 'On-Call/Shift','']);
        });
        // Upgrade days with actual engineer-logged hours
        safeUpgrades.filter(up => up.date && (!exportStart||up.date>=exportStart) && (!exportEnd||up.date<=exportEnd)).forEach(up => {
          const et = (up.engineerTimes||[]).find(e=>e.engineerId===u.id&&e.approved);
          if (et) {
            const dayName = new Date(up.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'});
            s2Rows.push([u.id, u.name, fmtUK(up.date), dayName, 'Upgrade Day', et.hours, 'Upgrade', up.title||'']);
          }
        });
        // Approved overtime with exact dates
        safeOT.filter(o=>o.userId===u.id&&o.status==='approved'&&(!exportStart||o.date>=exportStart)&&(!exportEnd||o.date<=exportEnd))
          .sort((a,b)=>a.date.localeCompare(b.date))
          .forEach(o => {
            const dayName = new Date(o.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'});
            s2Rows.push([u.id, u.name, fmtUK(o.date), dayName, 'Overtime', o.hours, 'Overtime', o.reason||'']);
          });
        // Incidents with hours logged
        const incRows = (incidents||[]).filter(inc => inc.assigned_to===u.id && inc.hours_worked > 0
          && (!exportStart||(inc.date||'')>=exportStart) && (!exportEnd||(inc.date||'')<=exportEnd));
        incRows.forEach(inc => {
          const d = inc.date||inc.created_at||'';
          if (!d) return;
          const dayName = new Date(d.slice(0,10)+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'});
          s2Rows.push([u.id, u.name, fmtUK(d.slice(0,10)), dayName, 'Incident', inc.hours_worked||0, 'Incident', inc.title||'']);
        });
      });

      // Sort by date then name
      s2Rows.sort((a,b) => {
        const [da,db] = [a[2],b[2]].map(s => s.split('/').reverse().join(''));
        return da.localeCompare(db) || a[1].localeCompare(b[1]);
      });

      const ws2Data = [s2Hdrs, ...s2Rows];
      const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
      ws2['!cols'] = [8,22,12,12,20,8,14,28].map(w=>({wch:w}));
      ws2['!freeze'] = { xSplit: 2, ySplit: 1 };
      styleRow(ws2, 0, s2Hdrs.length, H);
      // Colour-code rows by category
      const catColours = { 'Daily Shift':'1E40AF','Weekday On-Call':'166534','Weekend On-Call':'854D0E','Bank Holiday OC':'7F1D1D','Upgrade Day':'5B21B6','Upgrade':'5B21B6','Annual Leave':'92400E','Overtime':'0F766E','Incident':'92400E' };
      const catText    = { 'Daily Shift':'BFDBFE','Weekday On-Call':'BBF7D0','Weekend On-Call':'FEF08A','Bank Holiday OC':'FCA5A5','Upgrade Day':'DDD6FE','Upgrade':'DDD6FE','Annual Leave':'FDE68A','Overtime':'99F6E4','Incident':'FDE68A' };
      s2Rows.forEach((row, i) => {
        const cat = row[6]||'';
        const bg  = catColours[row[4]] || catColours[cat] || '131D35';
        const fg  = catText[row[4]]    || catText[cat]    || 'E2E8F0';
        styleRow(ws2, i+1, s2Hdrs.length, { fill:{fgColor:{rgb:bg}}, font:{color:{rgb:fg}} });
      });

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 3 — Dashboard & Analysis (visual summary)
      // ─────────────────────────────────────────────────────────────────────
      const gt = {
        standbyWD: s1Rows.reduce((s,r)=>s+(r[4]||0),0),
        workedWD:  s1Rows.reduce((s,r)=>s+(r[5]||0),0),
        standbyWE: s1Rows.reduce((s,r)=>s+(r[6]||0),0),
        workedWE:  s1Rows.reduce((s,r)=>s+(r[7]||0),0),
        incidents: s1Rows.reduce((s,r)=>s+(r[8]||0),0),
        upgrades:  s1Rows.reduce((s,r)=>s+(r[9]||0),0),
        bankHols:  s1Rows.reduce((s,r)=>s+(r[10]||0),0),
        overtime:  s1Rows.reduce((s,r)=>s+(r[11]||0),0),
      };
      const totalHrs = Object.values(gt).reduce((a,b)=>a+b,0);
      const pct = v => totalHrs > 0 ? ((v/totalHrs)*100).toFixed(1)+'%' : '0%';
      // Build bar chart rows (ASCII-style in cells)
      const bar = v => {
        const w = totalHrs > 0 ? Math.round((v/totalHrs)*30) : 0;
        return '█'.repeat(w) + '░'.repeat(30-w);
      };

      // Collect monthly data
      const monthlyMap = {};
      s2Rows.forEach(row => {
        const rawDate = row[2]; // dd/mm/yyyy
        if (!rawDate) return;
        const [d,m,y] = rawDate.split('/');
        const mo = `${y}-${m}`;
        if (!monthlyMap[mo]) monthlyMap[mo] = { standby:0, worked:0, upgrade:0, overtime:0, incident:0, bankHol:0 };
        const hrs = parseFloat(row[5])||0;
        const cat = row[6]||'';
        if (cat==='On-Call/Shift') { const sc=row[4]||''; if (sc.includes('Standby')||sc.includes('On-Call')||sc.includes('Bank Hol')) monthlyMap[mo].standby+=hrs; else monthlyMap[mo].worked+=hrs; }
        else if (cat==='Upgrade') monthlyMap[mo].upgrade+=hrs;
        else if (cat==='Overtime') monthlyMap[mo].overtime+=hrs;
        else if (cat==='Incident') monthlyMap[mo].incident+=hrs;
      });
      const months = Object.keys(monthlyMap).sort();

      const d3 = [];

      // ── Title banner
      d3.push(['CLOUDOPS ROTA', 'HOURS DASHBOARD & ANALYSIS', '', '', '', '', '', '']);
      d3.push([`Period: ${rangeLabel}`, `Generated: ${today}`, `Engineers: ${safeUsers.length}`, `Total Hours: ${totalHrs}`, '', '', '', '']);
      d3.push(['','','','','','','','']);

      // ── KPI tiles (row 4, cols A-H)
      d3.push(['METRIC', 'HOURS', '% OF TOTAL', 'VISUAL (30 units = 100%)', '', '', '', '']);
      const kpis = [
        ['Standby Weekday',    gt.standbyWD, '93C5FD'],
        ['Worked Weekday',     gt.workedWD,  '93C5FD'],
        ['Standby Weekend',    gt.standbyWE, 'A78BFA'],
        ['Worked Weekend',     gt.workedWE,  'A78BFA'],
        ['Incident Hours',     gt.incidents, 'FCD34D'],
        ['Upgrade Hours',      gt.upgrades,  '818CF8'],
        ['Bank Holiday Hours', gt.bankHols,  'FCA5A5'],
        ['Overtime Hours',     gt.overtime,  '6EE7B7'],
        ['GRAND TOTAL',        totalHrs,     'FFFFFF'],
      ];
      kpis.forEach(([lbl, v]) => d3.push([lbl, v, pct(v), bar(v), '', '', '', '']));
      d3.push(['','','','','','','','']);

      // ── Per-engineer table
      d3.push(['ENGINEER PERFORMANCE', 'Standby WD', 'Worked WD', 'Standby WE', 'Worked WE', 'Incidents', 'Upgrades', 'Overtime', 'Total Hrs', 'TOIL']);
      const engRows = safeUsers.map(u => {
        const { oc, tb, incHrs, upgradeHrs, bankHolHrs, overtimeHrs } = getUserData(u, exportStart, exportEnd);
        const total = oc.standbyWD+oc.workedWD+oc.standbyWE+oc.workedWE+incHrs+upgradeHrs+bankHolHrs+(overtimeHrs||0);
        return [u.name, oc.standbyWD, oc.workedWD, oc.standbyWE, oc.workedWE, incHrs, upgradeHrs||0, overtimeHrs||0, total, tb.balance];
      }).sort((a,b) => b[8]-a[8]); // sort by total desc
      engRows.forEach(r => d3.push(r));
      d3.push(['','','','','','','','','','']);

      // ── Monthly trend table
      if (months.length > 0) {
        d3.push(['MONTHLY TREND', 'Standby/OC', 'Worked', 'Upgrades', 'Overtime', 'Incidents', 'Total', '']);
        months.forEach(mo => {
          const md = monthlyMap[mo];
          const rowTotal = md.standby+md.worked+md.upgrade+md.overtime+md.incident;
          const [y,m] = mo.split('-');
          const label = new Date(+y,+m-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
          d3.push([label, md.standby, md.worked, md.upgrade, md.overtime, md.incident, rowTotal, '']);
        });
        d3.push(['','','','','','','','']);
      }

      // ── Overtime detail
      const approvedOT = [...safeOT].filter(o=>o.status==='approved').sort((a,b)=>b.hours-a.hours);
      if (approvedOT.length > 0) {
        d3.push(['TOP OVERTIME ENTRIES', 'Engineer', 'Date', 'Day', 'Hours', 'Reason', '', '']);
        approvedOT.slice(0,20).forEach((o,i) => {
          const u = safeUsers.find(x=>x.id===o.userId);
          const dayName = o.date ? new Date(o.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short'}) : '';
          d3.push([i+1, u?.name||o.userId, fmtUK(o.date), dayName, o.hours, o.reason||'—', '', '']);
        });
        d3.push(['','','','','','','','']);
      }

      const ws3 = XLSX.utils.aoa_to_sheet(d3);
      ws3['!cols'] = [28,14,14,35,14,14,14,14,14,12].map(w=>({wch:w}));
      ws3['!freeze'] = { xSplit: 0, ySplit: 3 };

      // Style the dashboard sheet
      // Title rows
      styleRow(ws3, 0, 8, { font:{bold:true,sz:16,color:{rgb:'3B82F6'}}, fill:{fgColor:{rgb:'080C18'}} });
      styleRow(ws3, 1, 8, { font:{sz:10,color:{rgb:'94A3B8'}}, fill:{fgColor:{rgb:'080C18'}} });
      styleRow(ws3, 2, 8, { fill:{fgColor:{rgb:'080C18'}} });
      // KPI section header
      styleRow(ws3, 3, 8, { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'0F3460'}}, border:{bottom:{style:'medium',color:{rgb:'3B82F6'}}} });
      // KPI rows: alternating
      kpis.forEach(([, , rgb], i) => {
        const rowIdx = 4 + i;
        const bg = i % 2 === 0 ? '0F1629' : '131D35';
        styleRow(ws3, rowIdx, 4, { fill:{fgColor:{rgb:bg}}, font:{color:{rgb:'E2E8F0'}} });
        // Colour the value cell
        const valCell = XLSX.utils.encode_cell({r:rowIdx, c:1});
        if (ws3[valCell]) ws3[valCell].s = { font:{bold:true,color:{rgb:rgb}}, fill:{fgColor:{rgb:bg}}, alignment:{horizontal:'center'} };
        // Colour the bar cell
        const barCell = XLSX.utils.encode_cell({r:rowIdx, c:3});
        if (ws3[barCell]) ws3[barCell].s = { font:{color:{rgb:rgb}}, fill:{fgColor:{rgb:bg}}, alignment:{horizontal:'left'} };
        // Grand total gets special treatment
        if (i === kpis.length-1) styleRow(ws3, rowIdx, 4, { font:{bold:true,color:{rgb:'6EE7B7'}}, fill:{fgColor:{rgb:'1E3A5F'}}, border:{top:{style:'medium',color:{rgb:'3B82F6'}}} });
      });
      // Engineer section: find its rows
      let eStart = 3 + kpis.length + 2; // approximate — after KPI rows + blank
      // Find actual row by searching d3
      let engSectionRow = -1;
      d3.forEach((row, i) => { if (row[0]==='ENGINEER PERFORMANCE') engSectionRow = i; });
      if (engSectionRow >= 0) {
        styleRow(ws3, engSectionRow, 10, { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'0F3460'}}, border:{bottom:{style:'medium',color:{rgb:'3B82F6'}}} });
        engRows.forEach((_, i) => {
          const ri = engSectionRow + 1 + i;
          const bg = i % 2 === 0 ? '0F1629' : '131D35';
          styleRow(ws3, ri, 10, { fill:{fgColor:{rgb:bg}}, font:{color:{rgb:'E2E8F0'}} });
          // Highlight total column
          const totCell = XLSX.utils.encode_cell({r:ri, c:8});
          if (ws3[totCell]) ws3[totCell].s = { font:{bold:true,color:{rgb:'6EE7B7'}}, fill:{fgColor:{rgb:bg}} };
        });
      }
      // Monthly trend section
      let monthSectionRow = -1;
      d3.forEach((row, i) => { if (row[0]==='MONTHLY TREND') monthSectionRow = i; });
      if (monthSectionRow >= 0) {
        styleRow(ws3, monthSectionRow, 8, { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'0F3460'}}, border:{bottom:{style:'medium',color:{rgb:'3B82F6'}}} });
        months.forEach((_, i) => {
          const ri = monthSectionRow + 1 + i;
          const bg = i % 2 === 0 ? '0F1629' : '131D35';
          styleRow(ws3, ri, 8, { fill:{fgColor:{rgb:bg}}, font:{color:{rgb:'E2E8F0'}} });
          const totCell = XLSX.utils.encode_cell({r:ri, c:6});
          if (ws3[totCell]) ws3[totCell].s = { font:{bold:true,color:{rgb:'A78BFA'}}, fill:{fgColor:{rgb:bg}} };
        });
      }
      // OT section
      let otSectionRow = -1;
      d3.forEach((row, i) => { if (row[0]==='TOP OVERTIME ENTRIES') otSectionRow = i; });
      if (otSectionRow >= 0) {
        styleRow(ws3, otSectionRow, 8, { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'0F3460'}}, border:{bottom:{style:'medium',color:{rgb:'3B82F6'}}} });
        approvedOT.slice(0,20).forEach((_, i) => {
          const ri = otSectionRow + 1 + i;
          const bg = i % 2 === 0 ? '0F1629' : '131D35';
          styleRow(ws3, ri, 8, { fill:{fgColor:{rgb:bg}}, font:{color:{rgb:'E2E8F0'}} });
          const hrsCell = XLSX.utils.encode_cell({r:ri, c:4});
          if (ws3[hrsCell]) ws3[hrsCell].s = { font:{bold:true,color:{rgb:'6EE7B7'}}, fill:{fgColor:{rgb:bg}} };
        });
      }

      // Build workbook — 3 sheets
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws3, '📊 Dashboard');
      XLSX.utils.book_append_sheet(wb, ws1, '📋 Hours Summary');
      XLSX.utils.book_append_sheet(wb, ws2, '📅 Daily Detail');

      const fname = `CloudOps-Hours-${(exportStart||'all').replace(/-/g,'')}-${(exportEnd||'time').replace(/-/g,'')}.xlsx`;
      XLSX.writeFile(wb, fname);
      setShowExport(false);
    } finally {
      setExporting(false);
    }
  };

  // ── Summary stats (all time) ──────────────────────────────────────────────
  const totalOCPay       = safeUsers.reduce((s, u) => { const { oc } = getUserData(u); return s + oc.total; }, 0);
  const totalIncidentHrs = safeUsers.reduce((s, u) => { const { incHrs } = getUserData(u); return s + incHrs; }, 0);
  const totalUpgradeHrs  = safeUsers.reduce((s, u) => { const { upgradeHrs } = getUserData(u); return s + upgradeHrs; }, 0);
  const totalOvertimeHrs = safeUsers.reduce((s, u) => { const { overtimeHrs } = getUserData(u); return s + overtimeHrs; }, 0);
  const pendingOTCount   = safeOT.filter(o => o.status === 'pending').length;

  return (
    <div>
      <PageHeader title="Payroll" sub="On-call pay, TOIL, tax and take-home — manager only"
        actions={<button className="btn btn-primary" onClick={() => setShowExport(true)}>📥 Export to Excel</button>} />

      {/* Export date-range modal */}
      {showExport && (
        <Modal title="Export Payroll to Excel" onClose={() => setShowExport(false)}>
          <div style={{ display:'flex', flexDirection:'column', gap:16, padding:'8px 0' }}>
            <Alert type="info">Select the week/date range to export. Leave blank to export all data.</Alert>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>From (start of week)</div>
                <input type="date" className="input" value={exportStart} onChange={e => setExportStart(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>To (end of week)</div>
                <input type="date" className="input" value={exportEnd} onChange={e => setExportEnd(e.target.value)} />
              </div>
            </div>
            {/* Quick range shortcuts */}
            <div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>Quick ranges</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {[
                  ['This month', () => { const n=new Date(); const y=n.getFullYear(),m=String(n.getMonth()+1).padStart(2,'0'); setExportStart(`${y}-${m}-01`); setExportEnd(new Date(y,n.getMonth()+1,0).toISOString().slice(0,10)); }],
                  ['Last month', () => { const n=new Date(); const d=new Date(n.getFullYear(),n.getMonth(),0); const s=new Date(d.getFullYear(),d.getMonth(),1); setExportStart(s.toISOString().slice(0,10)); setExportEnd(d.toISOString().slice(0,10)); }],
                  ['Last 4 weeks', () => { const e=new Date(); const s=new Date(); s.setDate(e.getDate()-28); setExportStart(s.toISOString().slice(0,10)); setExportEnd(e.toISOString().slice(0,10)); }],
                  ['This year', () => { const y=new Date().getFullYear(); setExportStart(`${y}-01-01`); setExportEnd(`${y}-12-31`); }],
                  ['All time', () => { setExportStart(''); setExportEnd(''); }],
                ].map(([label, fn]) => (
                  <button key={label} className="btn btn-secondary btn-sm" onClick={fn}>{label}</button>
                ))}
              </div>
            </div>
            {(exportStart || exportEnd) && (
              <div style={{ fontSize:12, color:'var(--text-secondary)', background:'rgba(59,130,246,0.1)', borderRadius:8, padding:'8px 12px' }}>
                📅 Exporting: <strong>{exportStart || 'start'}</strong> → <strong>{exportEnd || 'end'}</strong>
                &nbsp;· {safeUsers.length} engineers
              </div>
            )}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
              <button className="btn btn-secondary" onClick={() => setShowExport(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doExportExcel} disabled={exporting}>
                {exporting ? '⏳ Exporting…' : '📥 Download Excel'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Summary KPIs */}
      <div className="grid-4 mb-16">
        <StatCard label="Incident Hours"   value={`${totalIncidentHrs}h`}                    sub="Auto-logged from incidents"    accent="#f59e0b" icon="🚨" />
        <StatCard label="Upgrade Hours"    value={`${totalUpgradeHrs}h`}                     sub="Approved upgrade days"         accent="#818cf8" icon="⬆" />
        <StatCard label="Overtime Hours"   value={`${totalOvertimeHrs}h`}                    sub="Approved overtime"             accent="#10b981" icon="🕐" />
        <StatCard label="Pending OT"       value={pendingOTCount}                             sub="Awaiting approval"             accent="#f59e0b" icon="⏳" />
      </div>

      {/* On-call hours summary table */}
      <div className="card mb-16" style={{ overflowX:'auto' }}>
        <div className="card-title">On-Call Hours Summary — standby · worked · incidents · upgrades · bank holidays · overtime</div>
        <table style={{ minWidth:900 }}>
          <thead>
            <tr>
              <th>Engineer</th>
              <th style={{ color:'#93c5fd' }}>Standby WD</th>
              <th style={{ color:'#93c5fd' }}>Worked WD</th>
              <th style={{ color:'#a78bfa' }}>Standby WE</th>
              <th style={{ color:'#a78bfa' }}>Worked WE</th>
              <th style={{ color:'#f59e0b' }}>Incidents</th>
              <th style={{ color:'#818cf8' }}>Upgrades</th>
              <th style={{ color:'#fca5a5' }}>Bank Hol</th>
              <th style={{ color:'#e879f9' }}>Overtime</th>
              <th>TOIL Bal.</th>
            </tr>
          </thead>
          <tbody>
            {safeUsers.map(u => {
              const { oc, tb, incHrs, upgradeHrs, bankHolHrs, overtimeHrs } = getUserData(u);
              return (
                <tr key={u.id}>
                  <td><div style={{ display:'flex', gap:8, alignItems:'center' }}><Avatar user={u} size={24} /><div><div style={{ fontSize:12 }}>{u.name}</div><div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>{u.id}</div></div></div></td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#93c5fd' }}>{oc.standbyWD}h</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#93c5fd' }}>{oc.workedWD}h</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#a78bfa' }}>{oc.standbyWE}h</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#a78bfa' }}>{oc.workedWE}h</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:incHrs>0?'#f59e0b':'var(--text-muted)' }}>{incHrs>0?`${incHrs}h`:'—'}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:upgradeHrs>0?'#818cf8':'var(--text-muted)' }}>{upgradeHrs>0?`${upgradeHrs}h`:'—'}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:bankHolHrs>0?'#fca5a5':'var(--text-muted)' }}>{bankHolHrs>0?`${bankHolHrs}h`:'—'}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:overtimeHrs>0?'#e879f9':'var(--text-muted)', fontWeight:overtimeHrs>0?700:400 }}>{overtimeHrs>0?`${overtimeHrs}h`:'—'}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:tb.balance>0?'#38bdf8':'#fca5a5' }}>{tb.balance}h</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop:10, fontSize:11, color:'var(--text-muted)' }}>
          Daily: 10am–7pm · Weekday OC: 7pm–7am · Weekend OC: Fri 7pm–Mon 7am · Bank Hol OC: 9am–7am · Overtime: manager-approved only
        </div>
      </div>

      {/* Full take-home breakdown per engineer */}
      <div className="card-title" style={{ marginBottom:12 }}>💷 Take-Home Breakdown (base + OC, after UK tax 2025-26)</div>
      <div className="grid-2 mb-16">
        {safeUsers.map(u => {
          const { p, annual, hourly, oc, tb, incHrs } = getUserData(u);
          const annualOC = oc.total * 12;
          const tx = calcUKTax(annual + annualOC, { pensionPct:p.pensionPct||0, studentLoan:p.studentLoan||false });
          return (
            <div key={u.id} className="card">
              <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10 }}>
                <Avatar user={u} size={28} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{u.name}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>
                    £{annual.toLocaleString()}/yr base · Eff. rate: {(tx.effectiveRate*100).toFixed(1)}%
                    {incHrs>0 && <span style={{ color:'#f59e0b', marginLeft:6 }}>· 🚨 {incHrs}h incident</span>}
                  </div>
                </div>
              </div>
              <div style={{ background:'rgba(30,64,175,0.1)', borderRadius:8, padding:'8px 12px', marginBottom:10, fontSize:11 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}><span style={{ color:'var(--text-muted)' }}>Annual gross (inc. OC)</span><span style={{ fontFamily:'DM Mono' }}>£{Math.round(tx.annualGross).toLocaleString()}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}><span style={{ color:'#fca5a5' }}>Income Tax</span><span style={{ fontFamily:'DM Mono', color:'#fca5a5' }}>-£{Math.round(tx.incomeTax).toLocaleString()}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}><span style={{ color:'#fcd34d' }}>National Insurance</span><span style={{ fontFamily:'DM Mono', color:'#fcd34d' }}>-£{Math.round(tx.ni).toLocaleString()}</span></div>
                {(p.pensionPct||0)>0 && <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}><span style={{ color:'#93c5fd' }}>Pension ({p.pensionPct}%)</span><span style={{ fontFamily:'DM Mono', color:'#93c5fd' }}>-£{Math.round(tx.pension).toLocaleString()}</span></div>}
                {p.studentLoan && <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}><span style={{ color:'#c4b5fd' }}>Student Loan Plan 2</span><span style={{ fontFamily:'DM Mono', color:'#c4b5fd' }}>-£{Math.round(tx.slRepay).toLocaleString()}</span></div>}
                <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px solid var(--border)', paddingTop:4, marginTop:4 }}><span style={{ fontWeight:600 }}>Annual take-home</span><span style={{ fontFamily:'DM Mono', fontWeight:700, color:'#6ee7b7' }}>£{Math.round(tx.annualNet).toLocaleString()}</span></div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, fontSize:11 }}>
                {[['Monthly','monthly'],['Weekly','weekly'],['Daily','daily'],['Hourly','hourly']].map(([label,key]) => (
                  <div key={key} style={{ background:'rgba(30,64,175,0.15)', borderRadius:6, padding:'6px 8px', textAlign:'center' }}>
                    <div style={{ color:'var(--text-muted)', marginBottom:2, fontSize:10 }}>{label}</div>
                    <div style={{ fontWeight:700, color:'#10b981', fontFamily:'DM Mono', fontSize:12 }}>£{tx[key].net.toFixed(key==='hourly'?2:0)}</div>
                    <div style={{ color:'var(--text-muted)', fontSize:9 }}>gross £{tx[key].gross.toFixed(key==='hourly'?2:0)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Pay Config (Manager only) ──────────────────────────────────────────────
function PayConfig({ users, payconfig, setPayconfig, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Pay configuration is restricted to managers.</Alert>;

  const [taxMsg, setTaxMsg]     = useState('');
  const [taxYear, setTaxYear]   = useState(UK_TAX.year);
  const [selectedUid, setSelectedUid] = useState(users[0]?.id || '');

  // Pull latest tax info (HMRC website hint — user must verify)
  const fetchLatestTax = async () => {
    setTaxMsg('⏳ Opening HMRC tax rates page — verify and update constants manually if rates have changed…');
    window.open('https://www.gov.uk/income-tax-rates', '_blank');
    window.open('https://www.gov.uk/national-insurance-rates-letters', '_blank');
    setTimeout(() => setTaxMsg(`ℹ Tax constants last updated for ${UK_TAX.year}. Update UK_TAX in App.js if HMRC rates have changed.`), 1500);
  };

  const u   = users.find(x => x.id === selectedUid);
  const p   = payconfig[selectedUid] || { annual: 30000, base: 2500, rate: 40, pensionPct: 0, studentLoan: false };
  const set = (updates) => setPayconfig({ ...payconfig, [selectedUid]: { ...p, ...updates } });

  // Salary entry mode: 'annual' (default) or 'monthly'
  const [salaryMode, setSalaryMode] = useState('annual');

  const annual  = salaryMode === 'annual' ? (p.annual || p.base * 12) : p.base * 12;
  const monthly = annual / 12;
  const hourly  = annual / 2080;
  const tx      = calcUKTax(annual, { pensionPct: p.pensionPct || 0, studentLoan: p.studentLoan || false });
  const standbyRate = ONCALL_STANDBY_RATE;
  const workedRate  = hourly * ONCALL_WORKED_MULTIPLIER;

  const fmt = (n, dp=2) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

  const handleSalaryChange = (val) => {
    const num = +val;
    if (salaryMode === 'annual') {
      set({ annual: num, base: Math.round(num / 12) });
    } else {
      set({ base: num, annual: num * 12 });
    }
  };

  return (
    <div>
      <PageHeader title="Pay Config" sub="UK tax, on-call rates and take-home calculator — manager only" />

      {/* Tax info banner */}
      <div className="card mb-16">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>🇬🇧 UK Tax Year {taxYear}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Personal Allowance: £{UK_TAX.personalAllowance.toLocaleString()} · Basic 20% to £{UK_TAX.basicRateLimit.toLocaleString()} · Higher 40% to £{UK_TAX.higherRateLimit.toLocaleString()} · Additional 45% above
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              NI: 8% (£{UK_TAX.niPrimaryThreshold.toLocaleString()}–£{UK_TAX.niUpperEarningsLimit.toLocaleString()}) · 2% above · Student Loan Plan 2: 9% above £{UK_TAX.studentLoanPlan2Threshold.toLocaleString()}
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={fetchLatestTax}>🔄 Check Latest HMRC Rates</button>
        </div>
        {taxMsg && <Alert type="info" style={{ marginTop: 10 }}>{taxMsg}</Alert>}
      </div>

      {/* Engineer selector */}
      <div className="card mb-16">
        <div className="card-title">Select Engineer</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {users.map(uu => (
            <button key={uu.id}
              className={`btn btn-sm ${selectedUid === uu.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSelectedUid(uu.id)}>
              {uu.id} — {uu.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {u && (
        <div className="grid-2 mb-16">
          {/* Left: inputs */}
          <div className="card">
            <div className="card-title">💷 Pay Settings — {u.name}</div>
            {/* Salary mode toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Salary entry:</span>
              <button className={`btn btn-sm ${salaryMode === 'annual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSalaryMode('annual')}>Yearly (default)</button>
              <button className={`btn btn-sm ${salaryMode === 'monthly' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSalaryMode('monthly')}>Monthly</button>
            </div>
            {salaryMode === 'annual' ? (
              <FormGroup label="Annual Gross Salary (£)" hint="Default — enter yearly salary">
                <input className="input" type="number" step="1000" value={p.annual || p.base * 12} onChange={e => handleSalaryChange(e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>= {fmt(monthly, 0)}/month · {fmt(hourly)}/hr</div>
              </FormGroup>
            ) : (
              <FormGroup label="Monthly Gross Base (£)">
                <input className="input" type="number" value={p.base} onChange={e => handleSalaryChange(e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>= {fmt(annual, 0)}/year · {fmt(hourly)}/hr</div>
              </FormGroup>
            )}
            <FormGroup label="Pension Contribution (%)" hint="employee">
              <input className="input" type="number" min="0" max="100" step="0.5" value={p.pensionPct||0} onChange={e => set({ pensionPct: +e.target.value })} />
            </FormGroup>
            <FormGroup label="Student Loan Plan 2">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!p.studentLoan} onChange={e => set({ studentLoan: e.target.checked })} />
                <span style={{ fontSize: 13 }}>Repaying student loan (Plan 2)</span>
              </label>
            </FormGroup>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />
            <div className="card-title" style={{ marginBottom: 8 }}>🌙 On-Call Rates</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Standby flat rate: <strong style={{ color: 'var(--text-primary)' }}>£{standbyRate}/hr</strong> (Mon–Thu &amp; Fri–Mon 19:00–07:00)</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Worked on-call: <strong style={{ color: 'var(--text-primary)' }}>{ONCALL_WORKED_MULTIPLIER}x hourly = {fmt(workedRate)}/hr</strong></div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>TOIL accrual: <strong style={{ color: 'var(--text-primary)' }}>1:1 worked hours</strong> (UK WTR 1998) · max {TOIL_MAX_CARRYOVER_HOURS}h</div>
          </div>

          {/* Right: take-home breakdown */}
          <div className="card">
            <div className="card-title">📊 Take-Home Calculator</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Annual gross: <strong>{fmt(annual, 0)}</strong> · Hourly: <strong>{fmt(hourly)}</strong></div>
              {/* Period breakdown table */}
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 0' }}>Period</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px' }}>Gross</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', color: '#fca5a5' }}>Tax</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', color: '#fcd34d' }}>NI</th>
                    {p.pensionPct > 0 && <th style={{ textAlign: 'right', padding: '4px 6px', color: '#93c5fd' }}>Pension</th>}
                    {p.studentLoan && <th style={{ textAlign: 'right', padding: '4px 6px', color: '#c4b5fd' }}>SL</th>}
                    <th style={{ textAlign: 'right', padding: '4px 6px', color: '#6ee7b7', fontWeight: 700 }}>Take Home</th>
                  </tr>
                </thead>
                <tbody>
                  {[['Monthly','monthly'],['Weekly','weekly'],['Daily','daily'],['Hourly','hourly']].map(([label, key]) => (
                    <tr key={key} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={{ padding: '5px 0', fontWeight: 500 }}>{label}</td>
                      <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'DM Mono' }}>{fmt(tx[key].gross, key==='hourly'?2:2)}</td>
                      <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'DM Mono', color: '#fca5a5' }}>-{fmt(tx[key].tax, key==='hourly'?2:2)}</td>
                      <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'DM Mono', color: '#fcd34d' }}>-{fmt(tx[key].ni, key==='hourly'?2:2)}</td>
                      {p.pensionPct > 0 && <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'DM Mono', color: '#93c5fd' }}>-{fmt(tx[key].pension, key==='hourly'?2:2)}</td>}
                      {p.studentLoan && <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'DM Mono', color: '#c4b5fd' }}>-{fmt(tx[key].sl, key==='hourly'?2:2)}</td>}
                      <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'DM Mono', fontWeight: 700, color: '#10b981' }}>{fmt(tx[key].net, key==='hourly'?2:2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ background: 'rgba(30,64,175,0.15)', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>Income Tax (annual)</span><span style={{ fontFamily: 'DM Mono', color: '#fca5a5' }}>-{fmt(tx.incomeTax, 0)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>National Insurance</span><span style={{ fontFamily: 'DM Mono', color: '#fcd34d' }}>-{fmt(tx.ni, 0)}</span></div>
              {p.pensionPct > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>Pension ({p.pensionPct}%)</span><span style={{ fontFamily: 'DM Mono', color: '#93c5fd' }}>-{fmt(tx.pension, 0)}</span></div>}
              {p.studentLoan && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>Student Loan Plan 2</span><span style={{ fontFamily: 'DM Mono', color: '#c4b5fd' }}>-{fmt(tx.slRepay, 0)}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>Effective tax rate</span><span style={{ fontFamily: 'DM Mono' }}>{(tx.effectiveRate*100).toFixed(1)}%</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}><span style={{ fontWeight: 600 }}>Annual take-home</span><span style={{ fontFamily: 'DM Mono', fontWeight: 700, color: '#6ee7b7', fontSize: 14 }}>{fmt(tx.annualNet, 0)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* All engineers rate table */}
      <div className="card">
        <div className="card-title">All Engineers — Pay Rates Overview</div>
        <table style={{ overflowX: 'auto', display: 'block' }}>
          <thead><tr><th>Engineer</th><th>Monthly Base</th><th>Hourly</th><th>Standby/hr</th><th>Worked OC/hr</th><th>Monthly Net*</th></tr></thead>
          <tbody>
            {users.map(uu => {
              const pp = payconfig[uu.id] || { base: 2500, pensionPct: 0, studentLoan: false };
              const hr = (pp.base * 12) / 2080;
              const ttx = calcUKTax(pp.base * 12, { pensionPct: pp.pensionPct||0, studentLoan: pp.studentLoan||false });
              return (
                <tr key={uu.id}>
                  <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar user={uu} size={22} /><span style={{ fontSize: 12 }}>{uu.name}</span></div></td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>£{(pp.base||0).toLocaleString()}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>£{hr.toFixed(2)}</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#93c5fd' }}>£{ONCALL_STANDBY_RATE}/hr</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#fcd34d' }}>£{(hr * ONCALL_WORKED_MULTIPLIER).toFixed(2)}/hr</td>
                  <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#6ee7b7' }}>£{ttx.monthly.net.toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>* Base salary only, before on-call. Pension/SL settings per engineer in selector above.</div>
      </div>
    </div>
  );
}


// ── Settings (Manager only, all settings here) ─────────────────────────────
function Settings({ users, setUsers, isManager, secureLinks, setSecureLinks, driveToken, profilePics, setProfilePicsState, rota, setRota, permissions, setPermissions }) {
  const BLANK_FORM = { name: '', trigram: '', role: 'Engineer', mobile_number: '', google_email: '', profile_picture: '', avatar: '', color: '' };
  const [settingsTab, setSettingsTab] = useState('team'); // 'team' | 'permissions' | 'other'
  const [showAdd, setShowAdd]         = useState(false);
  const [showLink, setShowLink]       = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [form, setForm]               = useState(BLANK_FORM);
  const [linkForm, setLinkForm]       = useState({ label: '', expiry: '', password: '' });
  const [editForm, setEditForm]       = useState(BLANK_FORM);
  const [picUploading, setPicUploading] = useState(false);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [sheetMsg, setSheetMsg]       = useState('');
  const [resetPwUid, setResetPwUid]   = useState('');
  const picInputRef = useRef(null);
  const addPicInputRef = useRef(null);

  if (!isManager) return <Alert type="warning">⚠ Settings are restricted to managers.</Alert>;

  // ── Profile picture upload helper ────────────────────────────────────────
  const handlePicUpload = async (file, uid, isEdit) => {
    if (!file) return;
    setPicUploading(true);
    try {
      const dataUri = driveToken
        ? await uploadProfilePicture(driveToken, uid, file)
        : await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(file); });
      if (isEdit) {
        setEditForm(f => ({ ...f, profile_picture: dataUri }));
      } else {
        setForm(f => ({ ...f, profile_picture: dataUri }));
      }
    } finally { setPicUploading(false); }
  };

  // ── Add engineer ─────────────────────────────────────────────────────────
  const add = async () => {
    if (!form.name) return;
    // Use manually typed trigram if provided (and not already taken), otherwise auto-generate
    let id;
    if (form.trigram && form.trigram.trim().length >= 2) {
      const candidate = form.trigram.trim().toUpperCase();
      id = users.find(u => u.id === candidate) ? generateTrigramId(form.name, users) : candidate;
    } else {
      id = generateTrigramId(form.name, users);
    }
    const color = form.color || TRICOLORS[users.length % TRICOLORS.length];
    const avatar = form.avatar || form.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
    const newUser = { id, name: form.name, role: form.role, tri: id.slice(0,3), avatar, color,
      mobile_number: form.mobile_number || '', google_email: form.google_email || '',
      profile_picture: form.profile_picture || '' };
    // Apply permissions from copy source or template if selected
    if (form._copyPermsFrom && permissions?.[form._copyPermsFrom]) {
      setPermissions(prev => ({ ...prev, [id]: JSON.parse(JSON.stringify(permissions[form._copyPermsFrom])) }));
    } else if (form._applyTemplate) {
      try {
        const templates = JSON.parse(localStorage.getItem('cr_perm_templates') || '{}');
        if (templates[form._applyTemplate]) {
          setPermissions(prev => ({ ...prev, [id]: JSON.parse(JSON.stringify(templates[form._applyTemplate])) }));
        }
      } catch {}
    }
    const updatedUsers = [...users, newUser];
    setUsers(updatedUsers);
    // Auto-extend rota for the new engineer — inherit existing date range from rota
    const existingDates = Object.values(rota).flatMap(r => Object.keys(r));
    if (existingDates.length > 0) {
      const sorted = existingDates.sort();
      const newRota = generateRota(updatedUsers, sorted[0], Math.ceil(existingDates.length / 7));
      // Merge: keep existing entries, add new engineer's generated entries
      const merged = { ...newRota };
      Object.keys(rota).forEach(uid => { merged[uid] = { ...newRota[uid], ...rota[uid] }; });
      setRota(merged);
    }
    // Initialise password in registry
    const reg = updatePasswordInRegistry(id, id.toLowerCase());
    if (driveToken) await syncRegistryToDrive(driveToken, reg, updatedUsers);
    setShowAdd(false); setForm(BLANK_FORM);
  };

  // ── Edit / save user ─────────────────────────────────────────────────────
  const saveEdit = async (userId) => {
    const newId = (editForm.trigram || userId).toUpperCase().trim();
    const idChanged = newId !== userId && newId.length >= 3;

    // Build the updated user object (id may change if trigram edited)
    const updatedUser = { ...users.find(u => u.id === userId), ...editForm, id: idChanged ? newId : userId };
    delete updatedUser.trigram; // trigram is UI-only; id is the real field
    const updatedUsers = users.map(u => u.id === userId ? updatedUser : u);
    setUsers(updatedUsers);

    if (idChanged) {
      // Remap rota entries to new id
      setRota(prev => {
        const next = { ...prev };
        if (next[userId]) { next[newId] = next[userId]; delete next[userId]; }
        return next;
      });
      // Remap holidays
      setHolidays(prev => prev.map(h => h.userId === userId ? { ...h, userId: newId } : h));
      // Remap timesheets
      setTimesheets(prev => {
        const next = { ...prev };
        if (next[userId]) { next[newId] = next[userId]; delete next[userId]; }
        return next;
      });
      // Remap toil
      setToil(prev => {
        const next = { ...prev };
        if (next[userId]) { next[newId] = next[userId]; delete next[userId]; }
        return next;
      });
      // Remap profile pics
      setProfilePics(prev => {
        const next = { ...prev };
        if (next[userId]) { next[newId] = next[userId]; delete next[userId]; }
        return next;
      });
      setProfilePicsState(prev => {
        const next = { ...prev };
        if (next[userId]) { next[newId] = next[userId]; delete next[userId]; }
        return next;
      });
      // Remap permissions to new ID
      setPermissions(prev => {
        if (!prev[userId]) return prev;
        const next = { ...prev };
        next[newId] = next[userId]; delete next[userId];
        return next;
      });
    }

    if (driveToken) {
      await syncRegistryToDrive(driveToken, getRegistry(), updatedUsers);
      if (editForm.profile_picture && editForm.profile_picture.startsWith('data:')) {
        const targetId = idChanged ? newId : userId;
        const pics = { ...getProfilePics(), [targetId]: editForm.profile_picture };
        setProfilePics(pics); setProfilePicsState(pics);
        await driveWriteJson(driveToken, 'profile_pictures.json', pics);
      }
    }
    setEditingUserId(null); setEditForm(BLANK_FORM);
  };

  const deleteUser = (userId) => {
    if (window.confirm('⚠️  Delete this engineer? Cannot be undone.')) {
      const updatedUsers = users.filter(u => u.id !== userId);
      setUsers(updatedUsers);
      // Clean up their permissions entry
      setPermissions(prev => { const n = { ...prev }; delete n[userId]; return n; });
      if (driveToken) syncRegistryToDrive(driveToken, getRegistry(), updatedUsers);
    }
  };

  const resetPassword = async (uid) => {
    const reg = updatePasswordInRegistry(uid, uid.toLowerCase());
    if (driveToken) await syncRegistryToDrive(driveToken, reg, users);
    setResetPwUid(uid);
    setTimeout(() => setResetPwUid(''), 3000);
  };

  const addLink = () => {
    if (!linkForm.label) return;
    const link = { id: 'lnk-' + Date.now(), ...linkForm, url: `https://dsmeetul-cpu.github.io/cloudops-rota?ref=${Date.now()}`, created: new Date().toISOString().slice(0,10) };
    setSecureLinks([...(secureLinks||[]), link]);
    setShowLink(false); setLinkForm({ label: '', expiry: '', password: '' });
  };

  const [sheetOpenMsg, setSheetOpenMsg] = useState('');
  const [pushMsg, setPushMsg] = useState('');

  const syncFromSheet = async () => {
    if (!driveToken) { setSheetMsg('⚠ Connect Google Drive first.'); return; }
    setSheetSyncing(true); setSheetMsg('⏳ Syncing users from Google Sheet…');
    try {
      await syncUsersFromSheet(driveToken, getRegistry(), users, setUsers);
      setSheetMsg('✅ Users synced from Google Sheet successfully.');
    } catch (e) { setSheetMsg('❌ Sync failed: ' + (e.message || e)); }
    setSheetSyncing(false);
    setTimeout(() => setSheetMsg(''), 6000);
  };

  const openSheet = async () => {
    const reg = getRegistry();
    if (reg.sheets_id) {
      const url = `https://docs.google.com/spreadsheets/d/${reg.sheets_id}`;
      window.open(url, '_blank');
      setSheetOpenMsg('✅ Opened Google Sheet in a new tab.');
    } else if (driveToken) {
      setSheetOpenMsg('⏳ Creating sheet…');
      try {
        const sheetId = await syncUsersToSheet(driveToken, getRegistry(), users);
        if (sheetId) {
          window.open(`https://docs.google.com/spreadsheets/d/${sheetId}`, '_blank');
          setSheetOpenMsg('✅ Sheet created and opened in a new tab.');
        }
      } catch (e) { setSheetOpenMsg('❌ Could not create sheet: ' + (e.message || e)); }
    } else {
      setSheetOpenMsg('⚠ No sheet yet. Connect Google Drive and push to sheet first.');
    }
    setTimeout(() => setSheetOpenMsg(''), 6000);
  };

  const pushToSheet = async () => {
    if (!driveToken) { setPushMsg('⚠ Connect Google Drive first.'); return; }
    setPushMsg('⏳ Pushing users to Google Sheet…');
    try {
      await syncRegistryToDrive(driveToken, getRegistry(), users);
      setPushMsg('✅ Users pushed to Google Sheet successfully.');
    } catch (e) { setPushMsg('❌ Push failed: ' + (e.message || e)); }
    setTimeout(() => setPushMsg(''), 6000);
  };

  // ── Shared field renderer ────────────────────────────────────────────────
  const UserFields = ({ fv, setFv, uid, isEdit }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Full Name — always shown */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Full Name *</div>
        <input className="input" placeholder="e.g. Mahir Osman" value={fv.name||''} onChange={e => setFv(f => ({...f, name: e.target.value}))} />
      </div>
      {/* Trigram / ID — shown in both Add and Edit mode */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
          Trigram ID {isEdit
            ? <span style={{ color: 'rgba(255,200,50,0.8)' }}>⚠ Changing remaps all rota, holidays &amp; timesheets</span>
            : <span style={{ color: 'rgba(255,255,255,0.3)' }}>(optional — auto-generated from name if blank)</span>}
        </div>
        <input className="input" placeholder={isEdit ? 'e.g. MAH01' : 'Auto-generated if blank'} maxLength={8}
          value={fv.trigram||''} onChange={e => setFv(f => ({...f, trigram: e.target.value.toUpperCase()}))}
          style={{ fontFamily: 'DM Mono', letterSpacing: 1 }} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Role</div>
        <select className="select" value={fv.role||'Engineer'} onChange={e => setFv(f => ({...f, role: e.target.value}))}>
          <option>Engineer</option><option>Manager</option>
        </select>
      </div>
      <input className="input" type="email" placeholder="Google Email" value={fv.google_email||''} onChange={e => setFv(f => ({...f, google_email: e.target.value}))} />
      <input className="input" type="tel" placeholder="Mobile Number" value={fv.mobile_number||''} onChange={e => setFv(f => ({...f, mobile_number: e.target.value}))} />
      <input className="input" placeholder="Avatar Initials (e.g. MB)" maxLength={3} value={fv.avatar||''} onChange={e => setFv(f => ({...f, avatar: e.target.value.toUpperCase()}))} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 80 }}>Colour</label>
        <input type="color" value={fv.color||'#1d4ed8'} onChange={e => setFv(f => ({...f, color: e.target.value}))}
          style={{ width: 36, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none', padding: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Avatar background colour</span>
      </div>
      {/* Profile picture upload */}
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Profile Picture</div>
        {fv.profile_picture && <img src={fv.profile_picture} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', marginBottom: 6, display: 'block' }} />}
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {picUploading ? '⏳ Uploading…' : '📷 Upload Photo'}
          <input type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => handlePicUpload(e.target.files[0], uid || 'new_' + Date.now(), isEdit)} />
        </label>
        {driveToken && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>Saved to Google Drive</span>}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Settings" sub="All system settings — manager only"
        actions={<div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowLink(true)}>🔗 Secure Share Link</button>
          <button className="btn btn-primary" onClick={() => { setForm(BLANK_FORM); setShowAdd(true); }}>+ Add Engineer</button>
        </div>} />

      {/* ── Settings tab bar ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['team','👥 Team & Drive'],['permissions','🔒 Permissions'],['other','🎨 Other']].map(([id, label]) => (
          <button key={id} onClick={() => setSettingsTab(id)}
            className={settingsTab === id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>
            {label}
          </button>
        ))}
      </div>

      {/* ══ TAB: TEAM & DRIVE ══ */}
      {settingsTab === 'team' && (<>

      {/* Google Drive & Sheet Panel */}
      <div className="card mb-16">
        <div className="card-title">📁 Google Drive &amp; User Registry</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div className="gd-status"><div className={driveToken ? 'dot-live' : 'dot-live'} style={{ background: driveToken ? '#22c55e' : '#ef4444' }} /> {driveToken ? 'Drive connected — all data syncs automatically' : 'Drive not connected'}</div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>All app data (users, rota, incidents, etc.) is stored in your Google Drive as JSON files. A <strong>Google Sheet "CloudOps-UserRegistry"</strong> is auto-created as the single source of truth for users. Edit the sheet and click "Sync from Sheet" to pull changes into the app.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={openSheet}>📊 Open Google Sheet</button>
          <button className="btn btn-secondary btn-sm" onClick={syncFromSheet} disabled={sheetSyncing}>{sheetSyncing ? '⏳ Syncing…' : '⬇ Sync from Sheet'}</button>
          <button className="btn btn-secondary btn-sm" onClick={pushToSheet}>⬆ Push to Sheet</button>
        </div>
        {sheetOpenMsg && <Alert type={sheetOpenMsg.startsWith('✅') ? 'info' : 'warning'} style={{ marginTop: 8 }}>{sheetOpenMsg}</Alert>}
        {sheetMsg && <Alert type={sheetMsg.startsWith('✅') ? 'info' : sheetMsg.startsWith('❌') ? 'warning' : 'info'} style={{ marginTop: 8 }}>{sheetMsg}</Alert>}
        {pushMsg && <Alert type={pushMsg.startsWith('✅') ? 'info' : 'warning'} style={{ marginTop: 8 }}>{pushMsg}</Alert>}
      </div>

      {/* Team Members */}
      <div className="card mb-16">
        <div className="card-title">Team Members ({users.length} total)</div>
        {users.map(u => {
          const pic = profilePics?.[u.id] || u.profile_picture;
          return (
          <div key={u.id}>
            {editingUserId === u.id ? (
              <div style={{ padding: '14px 0', borderBottom: '1px solid rgba(30,58,95,.4)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
                  ✎ Editing: {editForm.name || u.name}
                  <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>({u.id})</span>
                </div>
                <UserFields fv={editForm} setFv={setEditForm} uid={u.id} isEdit />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => saveEdit(u.id)}>✓ Save</button>
                  <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => { setEditingUserId(null); setEditForm(BLANK_FORM); }}>✕ Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(30,58,95,.4)' }}>
                {pic ? (
                  <img src={pic} alt={u.name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                ) : <Avatar user={u} size={36} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u.id} · {u.role}</div>
                  {u.mobile_number && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>📱 {u.mobile_number}</div>}
                  {u.google_email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>✉️ {u.google_email}</div>}
                  {resetPwUid === u.id && <div style={{ fontSize: 11, color: '#6ee7b7' }}>✅ Password reset to "{u.id.toLowerCase()}"</div>}
                {permissions?.[u.id] && <div style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:2, fontSize:10, color:'#f59e0b', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.25)', borderRadius:4, padding:'1px 6px' }}>● Custom permissions</div>}
                </div>
                <Tag label={u.role} type={u.role === 'Manager' ? 'amber' : 'blue'} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditForm({ name: u.name, trigram: u.id, role: u.role||'Engineer', mobile_number: u.mobile_number||'', google_email: u.google_email||'', profile_picture: u.profile_picture||'', avatar: u.avatar||'', color: u.color||'' }); setEditingUserId(u.id); }}>✎ Edit</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setSettingsTab('permissions')} title="Manage permissions for this engineer">🔒 Perms</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => resetPassword(u.id)} title="Reset password to default (lowercase ID)">🔑 Reset PW</button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id)}>🗑</button>
                </div>
              </div>
            )}
          </div>
          );
        })}
      </div>

      </>)}

      {/* ══ TAB: PERMISSIONS ══ */}
      {settingsTab === 'permissions' && (
        <div className="card mb-16">
          <div className="card-title" style={{ marginBottom: 6 }}>🔒 Engineer Permissions</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
            Control exactly what each engineer can&nbsp;
            <strong style={{ color: '#3b82f6' }}>read</strong>,&nbsp;
            <strong style={{ color: '#10b981' }}>write</strong>, and&nbsp;
            <strong style={{ color: '#ef4444' }}>delete</strong> across every section of the app.
            Managers always retain full access. A&nbsp;<span style={{ color: '#f59e0b' }}>●</span>&nbsp;dot
            next to an engineer means custom overrides are active.
            All permissions are saved to Google Drive automatically.
          </p>
          <PermissionsManager users={users} permissions={permissions} setPermissions={setPermissions} />
        </div>
      )}

      {/* ══ TAB: OTHER ══ */}
      {settingsTab === 'other' && (<>

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

      </>)}

      {/* ── Modals (outside tabs) ── */}
      {showAdd && (
        <Modal title="Add Engineer" onClose={() => setShowAdd(false)} wide>
          <UserFields fv={form} setFv={setForm} uid={null} isEdit={false} />
          <Alert style={{ marginTop: 12 }}>Username auto-generated from name (e.g. SAJ04). Default password = lowercase username. They can change it via My Account.</Alert>
          {/* ── Permissions on add ── */}
          <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>🔒 Initial Permissions (optional)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Copy permissions from an existing engineer</div>
                <select className="select" value={form._copyPermsFrom||''} onChange={e => setForm(f => ({...f, _copyPermsFrom: e.target.value, _applyTemplate: ''}))}>
                  <option value="">— Use {form.role||'Engineer'} role defaults —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id}){permissions?.[u.id] ? ' ★ custom' : ''}</option>)}
                </select>
              </div>
              {Object.keys((() => { try { return JSON.parse(localStorage.getItem('cr_perm_templates') || '{}'); } catch { return {}; } })()).length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Or apply a saved template</div>
                  <select className="select" value={form._applyTemplate||''} onChange={e => setForm(f => ({...f, _applyTemplate: e.target.value, _copyPermsFrom: ''}))}>
                    <option value="">— No template —</option>
                    {Object.keys((() => { try { return JSON.parse(localStorage.getItem('cr_perm_templates') || '{}'); } catch { return {}; } })()).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}
              {!form._copyPermsFrom && !form._applyTemplate && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>No selection — will use {form.role||'Engineer'} role defaults. Refine later in Settings → Permissions.</p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={add} disabled={!form.name}>Add Engineer</button>
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
function MyAccount({ currentUser, users, setUsers, driveToken, profilePics, setProfilePicsState }) {
  const user = users.find(u => u.id === currentUser);
  const [notif, setNotif]         = useState('Email + Push');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg]         = useState('');
  const [saved, setSaved]         = useState(false);
  const [picUploading, setPicUploading] = useState(false);
  const pic = profilePics?.[currentUser] || user?.profile_picture;

  const savePw = async () => {
    if (!newPw) { setPwMsg('Enter a new password.'); return; }
    if (newPw !== confirmPw) { setPwMsg('Passwords do not match.'); return; }
    if (newPw.length < 6) { setPwMsg('Password must be at least 6 characters.'); return; }
    const reg = updatePasswordInRegistry(currentUser, newPw);
    if (driveToken) await syncRegistryToDrive(driveToken, reg, users);
    setNewPw(''); setConfirmPw('');
    setPwMsg('✅ Password updated and saved to Drive.');
    setTimeout(() => setPwMsg(''), 3000);
  };

  const handlePicUpload = async (file) => {
    if (!file) return;
    setPicUploading(true);
    try {
      const dataUri = driveToken
        ? await uploadProfilePicture(driveToken, currentUser, file)
        : await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(file); });
      setUsers(users.map(u => u.id === currentUser ? { ...u, profile_picture: dataUri } : u));
      const pics = { ...getProfilePics(), [currentUser]: dataUri };
      setProfilePics(pics); if (setProfilePicsState) setProfilePicsState(pics);
    } finally { setPicUploading(false); }
  };

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div>
      <PageHeader title="My Account" />
      <div className="card" style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
          {pic
            ? <img src={pic} alt={user?.name} style={{ width: 60, height: 60, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
            : <Avatar user={user || { avatar: '?', color: '#475569' }} size={60} />}
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{user?.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{user?.id}</div>
            <Tag label={user?.role || 'Engineer'} type={user?.role === 'Manager' ? 'amber' : 'blue'} />
          </div>
        </div>

        {/* Profile picture upload */}
        <div style={{ marginBottom: 16 }}>
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {picUploading ? '⏳ Uploading…' : '📷 Change Profile Photo'}
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handlePicUpload(e.target.files[0])} />
          </label>
          {driveToken && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>Saved to Google Drive</span>}
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
  const [theme, setTheme]             = useState(() => localStorage.getItem('cr_theme') || 'dark');

  const [users, setUsers]             = useState(DEFAULT_USERS);
  const [holidays, setHolidays]       = useState(DEFAULT_HOLIDAYS);
  const [incidents, setIncidents]     = useState(DEFAULT_INCIDENTS);
  const [timesheets, setTimesheets]   = useState(DEFAULT_TIMESHEETS);
  const [upgrades, setUpgrades]       = useState(DEFAULT_UPGRADES);
  const [wiki, setWiki]               = useState(DEFAULT_WIKI);
  const [glossary, setGlossary]       = useState(DEFAULT_GLOSSARY);
  const [contacts, setContacts]       = useState(DEFAULT_CONTACTS);
  const [payconfig, setPayconfig]     = useState(DEFAULT_PAYCONFIG);
  const [rota, setRota]               = useState(() => sanitiseRota(generateRota(DEFAULT_USERS, '2026-03-30', 8)));
  const [swapRequests, setSwapRequests] = useState([]);
  const [toil, setToil]               = useState([]);
  const [absences, setAbsences]       = useState([]);
  const [overtime, setOvertime]       = useState([]);
  const [logbook, setLogbook]         = useState([]);
  const [documents, setDocuments]     = useState([]);
  const [obsidianNotes, setObsidianNotes] = useState([]);
  const [whatsappChats, setWhatsappChats] = useState([]);
  const [secureLinks, setSecureLinks] = useState([]);
  const [permissions, setPermissions]   = useState({});

  const isManager = currentUser === 'MBA47';
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [profilePics, setProfilePicsState] = useState({});
  const [driveReady, setDriveReady]         = useState(false); // true once initial Drive load done

  // ── Guards against premature writes ───────────────────────────────────────
  // driveDataLoaded: flips to true only AFTER Drive data has been read into state.
  // Until then all save() useEffects are suppressed so we never overwrite Drive
  // with the hardcoded DEFAULT_* values that initialise state on first render.
  const driveDataLoaded = useRef(false);

  // ── Post-login load progress bar ──────────────────────────────────────────
  const [loadingAfterLogin, setLoadingAfterLogin] = useState(false);
  const [loadProgress, setLoadProgress]           = useState(0);
  const [loadStatus, setLoadStatus]               = useState('');

  // ── Auto-connect Google Drive on app load ─────────────────────────────────
  // The app reads ALL data from a single shared Drive folder owned by the manager.
  // Engineers don't need their own Drive access — they use a readonly token.
  //
  // Strategy (no popup ever from this function):
  //   1. Try cached sessionStorage token first (fast, no network)
  //   2. Try GIS silent flow (works if browser has active Google session)
  //   3. If both fail → show Connect button (one click, one popup, then cached)
  //
  // CRITICAL: driveReady only becomes true when users.json ACTUALLY loaded.
  // If it stays false, Sign In stays disabled — engineer sees "Loading…" and
  // clicks Connect to trigger the manual flow. This prevents DEFAULT_USERS
  // being used for authentication.
  useEffect(() => {
    const autoConnect = async () => {
      setConnectingDrive(true);
      try {
        // Step 1: cached token
        let token = null;
        try {
          const cached = sessionStorage.getItem('gdrive_token');
          const ts = parseInt(sessionStorage.getItem('gdrive_token_ts') || '0', 10);
          if (cached && (Date.now() - ts) < 50 * 60 * 1000) token = cached;
        } catch (_) {}

        // Step 2: silent GIS — no popup, fails gracefully in incognito/no session
        if (!token) {
          token = await new Promise((resolve) => {
            const tryAuth = () => {
              try {
                window.google.accounts.oauth2.initTokenClient({
                  client_id: GOOGLE_CLIENT_ID,
                  scope: 'https://www.googleapis.com/auth/drive.readonly',
                  prompt: '',
                  callback: (resp) => {
                    if (resp?.access_token) {
                      try {
                        sessionStorage.setItem('gdrive_token', resp.access_token);
                        sessionStorage.setItem('gdrive_token_ts', String(Date.now()));
                      } catch (_) {}
                      resolve(resp.access_token);
                    } else {
                      resolve(null);
                    }
                  },
                }).requestAccessToken({ prompt: '' });
              } catch (_) { resolve(null); }
            };
            // Load GIS script if not already present
            if (window.google?.accounts) {
              tryAuth();
            } else {
              const s = document.createElement('script');
              s.src = 'https://accounts.google.com/gsi/client';
              s.onload = tryAuth;
              s.onerror = () => resolve(null);
              document.head.appendChild(s);
            }
            setTimeout(() => resolve(null), 8000); // 8s timeout
          });
        }

        if (!token) {
          // Silent auth failed — show Connect button, keep Sign In disabled
          console.log('Drive: silent auth failed, showing Connect button');
          setConnectingDrive(false);
          return; // driveReady stays false — Sign In stays disabled ✓
        }

        // Got a token — now load the actual data
        await loadDriveData(token);

      } catch (e) {
        try { sessionStorage.removeItem('gdrive_token'); sessionStorage.removeItem('gdrive_token_ts'); } catch (_) {}
        console.warn('Auto Drive connect error:', e?.message || e);
        setConnectingDrive(false);
      }
    };
    autoConnect();
  }, []);

  // ── Shared Drive data loader — used by both auto-connect and manual connect ─
  // driveReady only becomes true here, after users.json has actually loaded.
  const loadDriveData = async (token) => {
    setSyncing(true);
    try {
      await gapiLoad();
      const [reg, pics] = await Promise.all([
        loadRegistryFromDrive(token),
        loadProfilePictures(token),
      ]);
      if (reg) setRegistry(reg);
      if (pics) { setProfilePics(pics); setProfilePicsState(pics); }

      const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, overtime, logbook, documents, obsidianNotes, whatsappChats };
      const data = await loadAllFromDrive(token, defaults);

      // Only mark driveReady if users actually loaded from Drive
      // If users.json returned null (permission error, file missing) we keep
      // driveReady false so the engineer cannot log in with DEFAULT_USERS
      if (data.users == null) {
        console.warn('Drive: users.json not loaded — keeping driveReady false');
        setConnectingDrive(false);
        setSyncing(false);
        return;
      }

      if (data.users        != null) setUsers(data.users);
      if (data.holidays     != null) setHolidays(data.holidays);
      if (data.incidents    != null) setIncidents(data.incidents);
      if (data.timesheets   != null) setTimesheets(data.timesheets);
      if (data.upgrades     != null) setUpgrades(data.upgrades);
      if (data.wiki         != null) setWiki(data.wiki);
      if (data.glossary     != null) setGlossary(data.glossary);
      if (data.contacts     != null) setContacts(data.contacts);
      if (data.payconfig    != null) setPayconfig(data.payconfig);
      if (data.rota         != null) setRota(sanitiseRota(data.rota));
      if (data.swapRequests != null) setSwapRequests(data.swapRequests);
      if (data.toil         != null) setToil(data.toil);
      if (data.absences     != null) setAbsences(data.absences);
      if (data.overtime     != null) setOvertime(data.overtime);
      if (data.logbook      != null) setLogbook(data.logbook);
      if (data.documents    != null) setDocuments(data.documents);
      if (data.obsidianNotes   != null) setObsidianNotes(data.obsidianNotes);
      if (data.whatsappChats   != null) setWhatsappChats(data.whatsappChats);
      if (data.permissions     != null) setPermissions(data.permissions);

      setLastSync(new Date());
      driveDataLoaded.current = true;
      setDriveReady(true);       // ← ONLY here, after real data confirmed
      setDriveToken(token);      // ← after driveDataLoaded, safe to trigger saves
      console.log('Drive: loaded successfully, driveReady = true');
    } catch (e) {
      console.error('Drive load error:', e?.message || e);
      try { sessionStorage.removeItem('gdrive_token'); sessionStorage.removeItem('gdrive_token_ts'); } catch (_) {}
    } finally {
      setSyncing(false);
      setConnectingDrive(false);
    }
  };

  const connectDrive = async () => {
    try {
      setConnectingDrive(true);
      // Interactive flow — shows Google account picker popup (one time only)
      // Token is cached to sessionStorage so future loads are silent
      const token = await initGoogleAuth(GOOGLE_CLIENT_ID);
      try {
        sessionStorage.setItem('gdrive_token', token);
        sessionStorage.setItem('gdrive_token_ts', String(Date.now()));
      } catch (_) {}
      // Load all Drive data through the shared loader
      await loadDriveData(token);

      setLoadProgress(100); setLoadStatus('✅ All data loaded from Google Drive');
      setTimeout(() => { setLoadingAfterLogin(false); setLoadProgress(0); setLoadStatus(''); }, 1500);

      setSyncing(false);
      setConnectingDrive(false);
    } catch (e) {
      console.error('Drive connect error:', e);
      setSyncing(false);
      setConnectingDrive(false);
      // DO NOT set driveDataLoaded.current = true here — the token will be set in
      // a retry or the user will try again. We must not allow saves with defaults.
      setLoadingAfterLogin(false);
      if (currentUser === 'MBA47') {
        console.warn('Drive connect failed:', e?.message || e);
      }
    }
  };

  const save = useCallback(async (key, data) => {
    if (!driveToken) return;
    if (!driveDataLoaded.current) return;  // ← never overwrite Drive with defaults on first render
    try {
      await driveWrite(driveToken, key, data);
      setLastSync(new Date());
    } catch (e) { console.warn('Drive save failed for', key, e?.message); }
  }, [driveToken]);

  // Save all data to Drive whenever it changes (only when token present)
  // IMPORTANT: driveToken is intentionally NOT in the dependency arrays.
  // Including driveToken would cause these effects to fire when the token is first
  // set (during connectDrive/login), writing DEFAULT_* values to Drive before the
  // real data has been loaded. The save() function reads driveToken from its own
  // closure via useCallback([driveToken]) and handles the null-token guard itself.
  useEffect(() => { save('users', users); if (isManager && driveToken) syncRegistryToDrive(driveToken, getRegistry(), users).catch(() => {}); }, [users]);
  useEffect(() => { save('holidays', holidays); },         [holidays]);
  useEffect(() => { save('incidents', incidents); },       [incidents]);
  useEffect(() => { save('timesheets', timesheets); },     [timesheets]);
  useEffect(() => { save('upgrades', upgrades); },         [upgrades]);
  useEffect(() => { save('wiki', wiki); },                 [wiki]);
  useEffect(() => { save('glossary', glossary); },         [glossary]);
  useEffect(() => { save('contacts', contacts); },         [contacts]);
  useEffect(() => { save('payconfig', payconfig); },       [payconfig]);
  useEffect(() => { save('rota', rota); },                 [rota]);
  useEffect(() => { save('swapRequests', swapRequests); }, [swapRequests]);
  useEffect(() => { save('toil', toil); },                 [toil]);
  useEffect(() => { save('absences', absences); },         [absences]);
  useEffect(() => { save('overtime', overtime); },         [overtime]);
  useEffect(() => { save('logbook', logbook); },           [logbook]);
  useEffect(() => { save('documents', documents); },       [documents]);
  useEffect(() => { save('obsidianNotes', obsidianNotes); },[obsidianNotes]);
  useEffect(() => { save('whatsappChats', whatsappChats); },[whatsappChats]);
  useEffect(() => { save('permissions', permissions); },   [permissions]);

  const [manualSyncing, setManualSyncing] = useState(false);
  const [syncProgress, setSyncProgress]   = useState(0);
  const [syncStatus, setSyncStatus]       = useState('');

  const syncAllToDrive = async () => {
    if (!driveToken) { alert('Connect Google Drive first.'); return; }
    setManualSyncing(true); setSyncProgress(0); setSyncStatus('Starting sync…');
    const keys = ['users','holidays','incidents','timesheets','upgrades','wiki','glossary','contacts','payconfig','rota','swapRequests','toil','absences','overtime','logbook','documents','obsidianNotes','whatsappChats','permissions'];
    const vals  = [users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, overtime, logbook, documents, obsidianNotes, whatsappChats, permissions];
    for (let i = 0; i < keys.length; i++) {
      setSyncStatus(`Saving ${keys[i]}…`);
      setSyncProgress(Math.round(((i + 1) / keys.length) * 100));
      try { await driveWrite(driveToken, keys[i], vals[i]); } catch (e) { console.warn('sync fail', keys[i], e); }
    }
    try { await syncRegistryToDrive(driveToken, getRegistry(), users); } catch (_) {}
    setLastSync(new Date());
    setSyncProgress(100);
    setSyncStatus('✅ All data synced to Google Drive');
    setTimeout(() => { setManualSyncing(false); setSyncStatus(''); setSyncProgress(0); }, 3000);
  };

  const login = async (uid) => {
    setCurrentUser(uid);
    setPage(uid === 'MBA47' ? 'dashboard' : 'oncall');

    if (driveReady) {
      // Drive data already loaded (silent auto-connect succeeded before login)
      setLoggedIn(true);
      return;
    }

    // Drive not yet ready — show progress bar and load data before entering app
    setLoadingAfterLogin(true);
    setLoadProgress(5);
    setLoadStatus('Signing in…');
    try {
      await gapiLoad();
      setLoadProgress(12); setLoadStatus('Connecting to Google Drive…');

      // Try sessionStorage-cached token first (avoids popup when token is still valid)
      let token = null;
      try {
        const cached = sessionStorage.getItem('gdrive_token');
        const ts = parseInt(sessionStorage.getItem('gdrive_token_ts') || '0', 10);
        // Google tokens last 3600s — use cache only if < 50 min old
        if (cached && (Date.now() - ts) < 50 * 60 * 1000) token = cached;
      } catch (_) {}

      if (!token) {
        // No cached token and no silent auth attempt — proceed to the app without Drive.
        // The user will see the "Drive offline" indicator in the sidebar and can click
        // 📁 Reconnect to trigger the interactive Google popup at their own choice.
        // This guarantees the Google account chooser NEVER appears uninvited.
        setLoadProgress(100); setLoadStatus('⚠️ Drive not connected — click Reconnect inside the app');
        await new Promise(r => setTimeout(r, 1000));
        setLoadingAfterLogin(false); setLoadProgress(0); setLoadStatus('');
        setLoggedIn(true);
        return;
      }

      if (token) {
        // ── CRITICAL: DO NOT call setDriveToken(token) here yet.
        // Setting driveToken triggers all save() useEffects which would write
        // DEFAULT_* values to Drive before we've loaded the real data.
        // We set it only after all data is loaded and driveDataLoaded.current = true.
        setLoadProgress(20); setLoadStatus('Loading user registry…');
        const [reg, pics] = await Promise.all([
          loadRegistryFromDrive(token),
          loadProfilePictures(token)
        ]);
        if (reg) setRegistry(reg);
        if (pics) { setProfilePics(pics); setProfilePicsState(pics); }

        setLoadProgress(40); setLoadStatus('Loading rota & schedules…');
        const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, overtime, logbook, documents, obsidianNotes, whatsappChats };
        const data = await loadAllFromDrive(token, defaults);

        setLoadProgress(75); setLoadStatus('Applying team data…');
        if (data.users != null) setUsers(data.users);
        if (data.holidays != null) setHolidays(data.holidays);
        if (data.incidents != null) setIncidents(data.incidents);
        if (data.timesheets != null) setTimesheets(data.timesheets);
        if (data.upgrades != null) setUpgrades(data.upgrades);
        if (data.wiki != null) setWiki(data.wiki);
        if (data.glossary != null) setGlossary(data.glossary);
        if (data.contacts != null) setContacts(data.contacts);
        if (data.payconfig != null) setPayconfig(data.payconfig);
        if (data.rota != null) setRota(sanitiseRota(data.rota));
        if (data.swapRequests != null) setSwapRequests(data.swapRequests);
        if (data.toil != null) setToil(data.toil);
        if (data.absences != null) setAbsences(data.absences);
        if (data.overtime != null) setOvertime(data.overtime);
        if (data.logbook != null) setLogbook(data.logbook);
        if (data.documents != null) setDocuments(data.documents);
        if (data.obsidianNotes != null) setObsidianNotes(data.obsidianNotes);
        if (data.whatsappChats != null) setWhatsappChats(data.whatsappChats);
        if (data.permissions   != null) setPermissions(data.permissions);
        setLastSync(new Date());
        // Mark data loaded BEFORE setting token so saves don't fire with stale state
        driveDataLoaded.current = true;
        setDriveReady(true);
        setDriveToken(token); // ← safe to expose now: real data is in state
        setLoadProgress(100); setLoadStatus('✅ Ready');
        await new Promise(r => setTimeout(r, 800));
      } else {
        // No Drive token — still let user in but saves stay blocked.
        // User can manually click Connect inside the app.
        setLoadProgress(100); setLoadStatus('⚠️ Drive not connected — connect manually inside the app');
        await new Promise(r => setTimeout(r, 1200));
      }
    } catch (e) {
      console.warn('Login Drive load failed:', e?.message || e);
      // DO NOT set driveDataLoaded.current = true — saves must stay blocked.
      setLoadProgress(100); setLoadStatus('⚠️ Could not load Drive data — try reconnecting');
      await new Promise(r => setTimeout(r, 1200));
    }
    setLoadingAfterLogin(false);
    setLoadProgress(0);
    setLoadStatus('');
    setLoggedIn(true);
  };



  // ── Theme CSS injection ─────────────────────────────────────────────────
  const isDark = theme === 'dark';
  const themeVars = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; font-size: 13px; }

    ${isDark ? `
    :root {
      --bg: #0a0e1a; --bg-card: #0f1629; --bg-card2: #131d35;
      --border: rgba(30,58,95,0.6); --accent: #3b82f6; --accent2: #06b6d4; --accent3: #10b981;
      --text-primary: #f1f5f9; --text-secondary: #94a3b8; --text-muted: #475569;
      --sidebar-bg: #080c18; --sidebar-border: rgba(30,58,95,0.8);
      --topbar-bg: rgba(8,12,24,0.95); --input-bg: rgba(15,22,41,0.8);
      --shadow: 0 4px 24px rgba(0,0,0,0.4);
      --nav-text: #64748b; --nav-text-hover: #94a3b8; --nav-text-active: #f1f5f9;
      --nav-active-bg: rgba(59,130,246,0.15); --nav-section: #334155;
    }` : `
    :root {
      --bg: #f1f5f9; --bg-card: #ffffff; --bg-card2: #f8fafc;
      --border: rgba(148,163,184,0.35); --accent: #2563eb; --accent2: #0891b2; --accent3: #059669;
      --text-primary: #0f172a; --text-secondary: #334155; --text-muted: #64748b;
      --sidebar-bg: #1e293b; --sidebar-border: rgba(15,23,42,0.25);
      --topbar-bg: rgba(255,255,255,0.97); --input-bg: #ffffff;
      --shadow: 0 4px 24px rgba(0,0,0,0.08);
      --nav-text: #94a3b8; --nav-text-hover: #cbd5e1; --nav-text-active: #f1f5f9;
      --nav-active-bg: rgba(59,130,246,0.2); --nav-section: #475569;
    }`}

    /* ── Layout ── */
    .app { display: flex; height: 100vh; overflow: hidden; background: var(--bg); color: var(--text-primary); }
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
    .content { flex: 1; overflow-y: auto; padding: 16px; background: var(--bg); }
    .topbar { height: 46px; display: flex; align-items: center; gap: 10px; padding: 0 16px;
              background: var(--topbar-bg); border-bottom: 1px solid var(--border);
              position: sticky; top: 0; z-index: 50; backdrop-filter: blur(8px); }
    .topbar-title { font-size: 13px; font-weight: 600; color: var(--text-primary); flex: 1; }
    .topbar-search { width: 160px; font-size: 11px; background: var(--input-bg);
                     border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px;
                     color: var(--text-primary); outline: none; }
    .topbar-search::placeholder { color: var(--text-muted); }

    /* ── Cards ── */
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;
            padding: 14px 16px; box-shadow: var(--shadow); }
    .card.mb-8 { margin-bottom: 8px; }
    .card.mb-16 { margin-bottom: 16px; }

    /* ── Buttons ── */
    .btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px;
           border-radius: 7px; border: 1px solid var(--border); font-size: 12px; font-weight: 500;
           cursor: pointer; transition: opacity .15s; white-space: nowrap; }
    .btn:hover { opacity: .85; }
    .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn-secondary { background: var(--bg-card2); color: var(--text-secondary); border-color: var(--border); }
    .btn-danger { background: #dc2626; color: #fff; border-color: #dc2626; }
    .btn-sm { padding: 3px 8px; font-size: 11px; }

    /* ── Inputs ── */
    .input, .select, input[type=text], input[type=password], input[type=email], input[type=date], input[type=number], select, textarea {
      background: var(--input-bg); border: 1px solid var(--border); border-radius: 6px;
      padding: 6px 10px; font-size: 12px; color: var(--text-primary); outline: none;
      font-family: inherit; }
    .input:focus, .select:focus { border-color: var(--accent); }

    /* ── Tables ── */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 7px 10px; font-size: 10px; font-weight: 600;
         text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted);
         background: var(--bg-card2); border-bottom: 1px solid var(--border); }
    td { padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--text-primary); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(148,163,184,0.05); }

    /* ── Modal ── */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000;
                     display: flex; align-items: center; justify-content: center; }
    .modal { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
             padding: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.4); min-width: 320px; max-width: 90vw; max-height: 90vh; overflow-y: auto; }

    /* ── Utility ── */
    .muted-xs { font-size: 11px; color: var(--text-muted); }
    .section-title { font-size: 10px; font-weight: 700; letter-spacing: .8px;
                     text-transform: uppercase; color: var(--nav-section); padding: 12px 10px 4px;
                     ${isDark ? '' : 'color: #94a3b8;'} }
    .nav-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 7px;
                font-size: 12px; cursor: pointer; color: var(--nav-text); transition: background .12s, color .12s; }
    .nav-item:hover { background: var(--nav-active-bg); color: var(--nav-text-hover); }
    .nav-item.active { background: var(--nav-active-bg); color: var(--nav-text-active); font-weight: 600; }
    .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 600; }
    .alert { padding: 10px 14px; border-radius: 8px; font-size: 12px; }
    .alert-warning { background: rgba(234,179,8,.12); border: 1px solid rgba(234,179,8,.3); color: #ca8a04; }
    .alert-error   { background: rgba(239,68,68,.12);  border: 1px solid rgba(239,68,68,.3);  color: #dc2626; }
    .alert-success { background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.3); color: #059669; }
    hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  `;

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('cr_theme', next); } catch (_) {}
  };

  // ── NAV group icons for collapsed mode labels ───────────────────────────
  const sectionIcons = { Overview:'◈', Operations:'⚙', People:'👤', Knowledge:'📖', Communication:'💬', Reporting:'📊', Finance:'💷', Account:'🔧' }; // eslint-disable-line

  // ── Derived values ──────────────────────────────────────────────────────
  const user = users.find(u => u.id === currentUser) || null;
  const openInc = (incidents || []).filter(i => i.status === 'Investigating').length;
  const pendingSwaps = (swapRequests || []).filter(s => s.status === 'pending').length;
  const pageTitles = {
    dashboard: '📊 Dashboard', oncall: '📡 On-Call', myshift: '🗓 My Shift',
    calendar: '📅 Calendar', rota: '📋 Rota', incidents: '🚨 Incidents',
    timesheets: '⏱ Timesheets', holidays: '🌴 Holidays', swaps: '🔁 Shift Swaps',
    upgrades: '⬆ Upgrade Days', stress: '💆 Stress Score', toil: '⏰ TOIL',
    absence: '🏥 Absence', overtime: '💰 Overtime', logbook: '📔 Logbook',
    wiki: '📖 Wiki', glossary: '📚 Glossary', contacts: '📇 Contacts',
    notes: '📝 Notes', docs: '📄 Documents', whatsapp: '💬 WhatsApp',
    insights: '📈 Insights', capacity: '⚡ Capacity', reports: '📊 Weekly Reports',
    payroll: '💷 Payroll', payconfig: '⚙ Pay Config', settings: '🔧 Settings',
    myaccount: '👤 My Account',
  };

  // ── Props passed to all page components ────────────────────────────────
  const props = {
    currentUser, users, setUsers,
    holidays, setHolidays,
    incidents, setIncidents,
    timesheets, setTimesheets,
    upgrades, setUpgrades,
    wiki, setWiki,
    glossary, setGlossary,
    contacts, setContacts,
    payconfig, setPayconfig,
    rota, setRota,
    swapRequests, setSwapRequests,
    toil, setToil,
    absences, setAbsences,
    overtime, setOvertime,
    logbook, setLogbook,
    documents, setDocuments,
    obsidianNotes, setObsidianNotes,
    whatsappChats, setWhatsappChats,
    secureLinks, setSecureLinks,
    driveToken,
    searchQ,
    isManager,
    profilePics,
    user,
    permissions, setPermissions,
  };

  const renderPage = () => {
    switch (page) {
      case 'dashboard':  return isManager ? <Dashboard {...props} /> : <Alert type="warning">⚠ Dashboard restricted to managers.</Alert>;
      case 'oncall':     return <OnCall {...props} />;
      case 'myshift':    return <MyShift {...props} />;
      case 'calendar':   return <CalendarView {...props} absences={absences} />;
      case 'rota':       return <RotaPage {...props} />;
      case 'incidents':  return <Incidents {...props} timesheets={timesheets} setTimesheets={setTimesheets} />;
      case 'timesheets': return <Timesheets {...props} />;
      case 'holidays':   return <Holidays {...props} />;
      case 'swaps':      return <ShiftSwaps {...props} />;
      case 'upgrades':   return <UpgradeDays {...props} timesheets={timesheets} setTimesheets={setTimesheets} />;
      case 'stress':     return <StressScore {...props} />;
      case 'toil':       return <TOIL {...props} />;
      case 'absence':    return <Absence {...props} driveToken={driveToken} />;
      case 'overtime':   return <Overtime {...props} overtime={overtime} setOvertime={setOvertime} driveToken={driveToken} />;
      case 'logbook':    return <Logbook {...props} />;
      case 'wiki':       return <Wiki {...props} />;
      case 'glossary':   return <Glossary {...props} />;
      case 'contacts':   return <Contacts {...props} />;
      case 'notes':      return <Notes {...props} />;
      case 'docs':       return <Documents {...props} />;
      case 'whatsapp':   return <WhatsAppChat {...props} />;
      case 'insights':   return <Insights {...props} />;
      case 'capacity':   return <Capacity {...props} incidents={incidents} />;
      case 'reports':    return <WeeklyReports {...props} />;
      case 'payroll':    return <Payroll {...props} incidents={incidents} upgrades={upgrades} rota={rota} overtime={overtime} />;
      case 'payconfig':  return <PayConfig {...props} />;
      case 'settings':   return <Settings {...props} />;
      case 'myaccount':  return <MyAccount currentUser={currentUser} users={users} setUsers={setUsers} driveToken={driveToken} profilePics={profilePics} setProfilePicsState={setProfilePicsState} />;
      default: return <p className="muted-sm">Page coming soon</p>;
    }
  };

  if (!loggedIn) return (
    <>
      {loadingAfterLogin && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(10,14,26,0.92)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', zIndex: 9999, gap: 24
        }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px' }}>
            ☁️ Loading from Google Drive
          </div>
          <div style={{ width: 360, background: 'rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden', height: 14 }}>
            <div style={{
              height: '100%', borderRadius: 12,
              background: 'linear-gradient(90deg, #3b82f6, #06b6d4)',
              width: loadProgress + '%',
              transition: 'width 0.4s ease'
            }} />
          </div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: -8 }}>{loadStatus}</div>
          <div style={{ fontSize: 12, color: '#475569' }}>{loadProgress}% complete</div>
        </div>
      )}
      <LoginScreen onLogin={login} driveToken={driveToken} onConnectDrive={connectDrive} users={users} connectingDrive={connectingDrive} driveReady={driveReady} />
    </>
  );

  return (
    <>
      <style>{themeVars}</style>
      {/* Root shell — explicit inline flex, no dependency on App.css */}
      <div data-theme={theme} style={{
        display: 'flex', flexDirection: 'row', width: '100vw', height: '100vh',
        overflow: 'hidden', background: 'var(--bg)', color: 'var(--text-primary)',
        fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13,
      }}>

        {/* ── SIDEBAR ───────────────────────────────────────────────── */}
        <div style={{
          width: sidebarOpen ? 200 : 48,
          minWidth: sidebarOpen ? 200 : 48,
          maxWidth: sidebarOpen ? 200 : 48,
          flexShrink: 0, flexGrow: 0,
          display: 'flex', flexDirection: 'column',
          height: '100vh', overflow: 'hidden',
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
          transition: 'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease',
          zIndex: 100,
        }}>
          {/* Logo */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            padding: sidebarOpen ? '14px 12px 10px' : '14px 0 10px',
            justifyContent: sidebarOpen ? 'flex-start' : 'center',
            borderBottom: '1px solid var(--sidebar-border)',
          }}>
            <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,#3b82f6,#06b6d4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'#fff', flexShrink:0 }}>CR</div>
            {sidebarOpen && <div>
              <div style={{ fontSize:12, fontWeight:700, color:'#f1f5f9', lineHeight:1.2 }}>CloudOps Rota</div>
              <div style={{ fontSize:9, color:'#475569', letterSpacing:0.5 }}>CLOUD RUN OPS</div>
            </div>}
          </div>

          {/* User pill */}
          <div style={{ flexShrink: 0 }}>
            {sidebarOpen ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', margin:'6px 8px', background:'rgba(59,130,246,0.08)', borderRadius:8, border:'1px solid rgba(59,130,246,0.15)' }}>
                <Avatar user={user || { avatar:'?', color:'#475569' }} size={26} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:'#f1f5f9', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.name?.split(' ')[0]} {user?.name?.split(' ')[1]?.[0]}.</div>
                  <div style={{ fontSize:9, color:'#64748b', fontFamily:'DM Mono' }}>{currentUser} · {user?.role}</div>
                </div>
              </div>
            ) : (
              <div style={{ display:'flex', justifyContent:'center', padding:'6px 0' }}>
                <Avatar user={user || { avatar:'?', color:'#475569' }} size={26} />
              </div>
            )}
          </div>

          {/* Nav items */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {NAV.map(sec => (
              <div key={sec.section}>
                {sidebarOpen
                  ? <div style={{ fontSize:8, fontWeight:700, letterSpacing:1.5, color:'#475569', padding:'8px 12px 3px', textTransform:'uppercase' }}>{sec.section}</div>
                  : <div style={{ height:1, background:'var(--sidebar-border)', margin:'4px 6px' }} />
                }
                {sec.items.filter(i => !i.managerOnly || isManager).map(item => {
                  const isActive = page === item.id;
                  const badge = (item.badge && openInc > 0) ? openInc : (item.id === 'swaps' && pendingSwaps > 0) ? pendingSwaps : 0;
                  return (
                    <div key={item.id}
                      onClick={() => setPage(item.id)}
                      title={!sidebarOpen ? item.label : ''}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: sidebarOpen ? '5px 10px 5px 12px' : '6px 0',
                        justifyContent: sidebarOpen ? 'flex-start' : 'center',
                        cursor: 'pointer',
                        background: isActive ? 'rgba(59,130,246,0.18)' : 'transparent',
                        borderLeft: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                        margin: sidebarOpen ? '0 6px 0 0' : '1px 0',
                        borderRadius: sidebarOpen ? '0 6px 6px 0' : 0,
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(59,130,246,0.08)'; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                      <span style={{ fontSize:13, flexShrink:0, opacity: isActive ? 1 : 0.65 }}>{item.icon}</span>
                      {sidebarOpen && <span style={{ fontSize:11, color: isActive ? '#93c5fd' : '#94a3b8', fontWeight: isActive ? 600 : 400, flex:1 }}>{item.label}</span>}
                      {badge > 0 && <span style={{ background:'#ef4444', color:'#fff', borderRadius:10, padding:'1px 5px', fontSize:9, fontWeight:700, flexShrink:0 }}>{badge}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding:'8px', borderTop:'1px solid var(--sidebar-border)', flexShrink:0 }}>
            {sidebarOpen && (
              <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 4px 6px', fontSize:9, color: driveToken ? '#6ee7b7' : '#fcd34d' }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background: driveToken ? '#22c55e' : '#f59e0b', flexShrink:0 }} />
                {driveToken
                  ? (syncing ? 'Syncing…' : `Synced ${lastSync ? lastSync.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : ''}`)
                  : connectingDrive ? 'Connecting…' : 'Drive offline'}
              </div>
            )}
            {!driveToken && !connectingDrive && (
              <button style={{ width:'100%', marginBottom:4, fontSize:9, padding:'3px 0', background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.3)', borderRadius:5, color:'#fcd34d', cursor:'pointer' }} onClick={connectDrive}>
                {sidebarOpen ? '📁 Reconnect Drive' : '📁'}
              </button>
            )}
            <div style={{ display:'flex', gap:4 }}>
              <button onClick={() => setSidebarOpen(v => !v)}
                style={{ flex:1, padding:'4px 0', background:'rgba(148,163,184,0.08)', border:'1px solid var(--sidebar-border)', borderRadius:5, color:'#64748b', cursor:'pointer', fontSize:10 }}
                title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
                {sidebarOpen ? '◀' : '▶'}
              </button>
              <button onClick={() => setLoggedIn(false)}
                style={{ flex:1, padding:'4px 0', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:5, color:'#fca5a5', cursor:'pointer', fontSize:10 }}
                title="Sign Out">
                {sidebarOpen ? '⎋ Out' : '⎋'}
              </button>
            </div>
          </div>
        </div>

        {/* ── MAIN ──────────────────────────────────────────────────── */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          height: '100vh', overflow: 'hidden',
        }}>
          {/* Topbar */}
          <div style={{
            flexShrink: 0, height: 46, display: 'flex', alignItems: 'center', gap: 10,
            padding: '0 16px', zIndex: 50,
            background: 'var(--topbar-bg)', borderBottom: '1px solid var(--border)',
            backdropFilter: 'blur(8px)',
          }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', flex:1 }}>{pageTitles[page] || page}</div>
            <input placeholder="Search…" value={searchQ} onChange={e => setSearchQ(e.target.value)}
              style={{ width:160, fontSize:11, background:'var(--input-bg)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 8px', color:'var(--text-primary)', outline:'none' }} />
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono', whiteSpace:'nowrap' }}>
                {new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}
              </div>
              {driveToken && (
                <button title="Refresh from Drive" style={{ padding:'3px 7px', fontSize:11, background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-secondary)', cursor:'pointer' }}
                  onClick={async () => {
                    try {
                      setSyncing(true);
                      const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, overtime, logbook, documents, obsidianNotes, whatsappChats };
                      const data = await loadAllFromDrive(driveToken, defaults);
                      const has = v => v !== null && v !== undefined;
                      if (has(data.users))         setUsers(data.users);
                      if (has(data.holidays))      setHolidays(data.holidays);
                      if (has(data.incidents))     setIncidents(data.incidents);
                      if (has(data.timesheets))    setTimesheets(data.timesheets);
                      if (has(data.upgrades))      setUpgrades(data.upgrades);
                      if (has(data.wiki))          setWiki(data.wiki);
                      if (has(data.glossary))      setGlossary(data.glossary);
                      if (has(data.contacts))      setContacts(data.contacts);
                      if (has(data.payconfig))     setPayconfig(data.payconfig);
                      if (has(data.rota))          setRota(sanitiseRota(data.rota));
                      if (has(data.swapRequests))  setSwapRequests(data.swapRequests);
                      if (has(data.toil))          setToil(data.toil);
                      if (has(data.absences))      setAbsences(data.absences);
                      if (has(data.overtime))      setOvertime(data.overtime);
                      if (has(data.logbook))       setLogbook(data.logbook);
                      if (has(data.documents))     setDocuments(data.documents);
                      if (has(data.obsidianNotes)) setObsidianNotes(data.obsidianNotes);
                      if (has(data.whatsappChats)) setWhatsappChats(data.whatsappChats);
                      if (has(data.permissions))  setPermissions(data.permissions);
                      setLastSync(new Date());
                    } catch(e) { console.warn('Refresh failed:', e); }
                    finally { setSyncing(false); }
                  }}>🔄</button>
              )}
              {driveToken && (
                <button title="Sync all to Drive" style={{ padding:'3px 7px', fontSize:11, background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-secondary)', cursor:'pointer' }}
                  onClick={syncAllToDrive} disabled={manualSyncing}>
                  {manualSyncing ? '⏳' : '☁'}
                </button>
              )}
              <button onClick={toggleTheme} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                style={{ padding:'3px 8px', background:'rgba(148,163,184,0.1)', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', fontSize:13, lineHeight:1 }}>
                {isDark ? '☀️' : '🌙'}
              </button>
              {openInc > 0 && <div style={{ background:'#ef4444', color:'#fff', borderRadius:12, padding:'2px 8px', fontSize:10, fontWeight:600 }}>🚨 {openInc}</div>}
              <Avatar user={user || { avatar:'?', color:'#475569' }} size={26} />
            </div>
          </div>

          {/* Sync progress bar */}
          {manualSyncing && (
            <div style={{ flexShrink:0, padding:'5px 16px', background:'rgba(59,130,246,0.08)', borderBottom:'1px solid var(--border)', display:'flex', gap:12, alignItems:'center' }}>
              <span style={{ fontSize:10, color:'var(--accent)', minWidth:180 }}>{syncStatus}</span>
              <div style={{ flex:1, height:4, background:'rgba(255,255,255,0.08)', borderRadius:2, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${syncProgress}%`, background:'var(--accent)', borderRadius:2, transition:'width 0.3s' }} />
              </div>
              <span style={{ fontSize:10, fontFamily:'DM Mono', color:'var(--text-muted)' }}>{syncProgress}%</span>
            </div>
          )}

          {/* Page content */}
          <div style={{ flex:1, overflowY:'auto', padding:'16px', background:'var(--bg)' }}>
            {renderPage()}
          </div>
        </div>

      </div>
    </>
  );
}
