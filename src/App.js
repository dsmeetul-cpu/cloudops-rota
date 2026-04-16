// src/App.js
// CloudOps Rota — Full Production Build v2
// Meetul Bhundia (MBA47) · Cloud Run Operations · 11th April 2026

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

// ─────────────────────────────────────────────────────────────────────────────
// Google Drive auto-connects on page load using the OAuth Client ID below.
// Drive account: dsmeetul@gmail.com  |  Folder: CloudOps-Rota
// All app data is stored in this Drive. Engineers never need to connect manually.
// ─────────────────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

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
  const [showHelp, setShowHelp]     = useState(false);

  const handle = () => {
    const id = uid.trim().toUpperCase();
    if (!id) { setErr('Please enter your username.'); return; }
    const userExists = users.find(u => u.id === id);
    if (!userExists) { setErr('Username not found. Contact your manager if you need access.'); return; }
    if (checkPassword(id, pw)) {
      setErr('');
      if (id === 'MBA47') { setPending2FA(id); setShow2FA(true); }
      else onLogin(id);
    } else {
      setErr('Incorrect password. If the Drive indicator above is not green, wait a moment for it to connect, then try again. Use Forgot Password if needed.');
    }
  };

  const verify2FA = () => {
    if (twoFACode.length === 6) { onLogin(pending2FA); }
    else setErr('Enter a 6-digit code.');
  };

  const handleForgot = () => {
    const id = forgotUid.trim().toUpperCase();
    const userExists = users.find(u => u.id === id);
    if (!userExists) { setForgotMsg('Username not found. Please contact your manager.'); return; }
    const reg = updatePasswordInRegistry(id, id.toLowerCase());
    if (driveToken) syncRegistryToDrive(driveToken, reg, users).catch(() => {});
    setForgotMsg(`Password for ${id} has been reset. Sign in with your username in lowercase, then update it in My Account.`);
  };

  if (showHelp) return (
    <div className="login-screen">
      <div className="login-box" style={{ maxWidth: 500 }}>
        <div className="login-logo">
          <div className="login-logo-icon">CR</div>
          <div className="login-title">Sign-In Help</div>
          <div className="login-sub">CloudOps Rota</div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
          <p><strong style={{ color: 'var(--text-primary)' }}>🔑 Default password</strong><br />Your initial password is your username in lowercase. You can change it inside the app under My Account.</p>
          <p><strong style={{ color: 'var(--text-primary)' }}>🌐 Drive connection</strong><br />Google Drive connects automatically when you open the app. Wait for the green indicator before signing in if you have a custom password — it needs Drive to load your credentials.</p>
          <p><strong style={{ color: 'var(--text-primary)' }}>❓ Still can't log in?</strong><br />Use <strong>Forgot Password?</strong> below, or ask your manager to reset your password in Settings.</p>
        </div>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowHelp(false)}>← Back to Sign In</button>
      </div>
    </div>
  );

  if (showForgot) return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">
          <div className="login-logo-icon">CR</div>
          <div className="login-title">Reset Password</div>
          <div className="login-sub">CloudOps Rota</div>
        </div>
        {forgotMsg
          ? <Alert type="info">ℹ {forgotMsg}</Alert>
          : <Alert type="info">ℹ Enter your username and your password will be reset to the default.</Alert>}
        <FormGroup label="Username">
          <input className="input" placeholder="Your username" value={forgotUid}
            onChange={e => setForgotUid(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleForgot()} autoFocus />
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

        {/* Drive status */}
        <div style={{ marginBottom: 16, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(59,130,246,0.05)', display: 'flex', alignItems: 'center', gap: 10 }}>
          {driveToken ? (
            <>
              <div className="dot-live" />
              <span style={{ fontSize: 12, color: '#6ee7b7' }}>Google Drive connected — team data loaded ✓</span>
            </>
          ) : connectingDrive ? (
            <>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
              <span style={{ fontSize: 12, color: '#fcd34d' }}>Connecting to Google Drive…</span>
            </>
          ) : (
            <>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6b7280' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Drive connecting in background…</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={onConnectDrive} style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                📁 Connect
              </button>
            </>
          )}
        </div>

        {err && <Alert type="warning" style={{ marginBottom: 12 }}>⚠ {err}</Alert>}

        {!show2FA ? (
          <>
            <FormGroup label="Username">
              <input className="input" placeholder="Enter your username" value={uid}
                onChange={e => setUid(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handle()} autoFocus />
            </FormGroup>
            <FormGroup label="Password">
              <input className="input" type="password" placeholder="Password" value={pw}
                onChange={e => setPw(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handle()} />
            </FormGroup>
            <button className="btn btn-primary" style={{ width: '100%', padding: 11, marginBottom: 8 }} onClick={handle}>
              Sign In
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setShowForgot(true)}>🔑 Forgot Password?</button>
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setShowHelp(true)}>❓ Help</button>
            </div>
          </>
        ) : (
          <>
            <Alert type="info">🔐 Two-factor authentication required for manager access.</Alert>
            <FormGroup label="2FA Code">
              <input className="input" placeholder="6-digit code" maxLength={6} value={twoFACode}
                onChange={e => setTwoFACode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && verify2FA()} autoFocus />
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
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color: toilBal.balance>0?'#6ee7b7':'#fca5a5' }}>{toilBal.balance}h</td>
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

  // Shift hour definitions
  const SHIFT_HOURS = {
    daily:   { start: '10:00', end: '19:00', label: '10am – 7pm',   desc: 'Daily Shift (Mon–Fri)' },
    evening: { start: '19:00', end: '07:00', label: '7pm – 7am',    desc: 'Weekday Evening OC (Mon–Thu)' },
    weekend: { start: '19:00', end: '07:00', label: '7pm – 7am',    desc: 'Weekend OC (Fri–Mon)' },
    upgrade: { start: '00:00', end: '23:59', label: 'All day',       desc: 'Upgrade Day' },
    holiday: { start: '',      end: '',      label: 'Holiday',        desc: 'Annual Leave' },
    bankholiday: { start: '', end: '',       label: 'Bank Holiday',   desc: 'Public Holiday' },
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
        });
      });
      return merged;
    });
    setGenerated(true);
  };

  const setCell = (userId, date, shift) => {
    if (!isManager) return;
    const dow = new Date(date).getDay();
    const isWeekend = dow === 0 || dow === 6;
    // Daily shift is Mon–Fri only; prevent setting it on weekends
    const safeShift = (shift === 'daily' && isWeekend) ? 'weekend' : shift;
    setRota(prev => ({ ...prev, [userId]: { ...(prev[userId] || {}), [date]: safeShift } }));
    setEditCell(null);
  };

  const deleteCell = (userId, date) => {
    if (!isManager) return; // Only managers can delete
    const next = JSON.parse(JSON.stringify(rota));
    if (next[userId]) delete next[userId][date];
    setRota(next);
  };

  const toggleBulk = (userId, date) => {
    if (!isManager) return; // Only managers can bulk edit
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
          <div className="card-title">⚙ Generate & Controls</div>
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
              <button className="btn btn-primary" onClick={generate}>🔄 Generate Rota</button>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>🔒 Keeps manual entries</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="btn btn-secondary" onClick={() => {
                if (window.confirm('⚠️  Regenerate from scratch? All manually-set shifts will be overwritten.')) {
                  setRota(sanitiseRota(generateRota(users, startDate, weeks)));
                  setGenerated(true);
                }
              }}>↺ Force Regenerate</button>
              <div style={{ fontSize: 9, color: 'rgba(255,80,80,0.5)', textAlign: 'center' }}>⚠ Overwrites all shifts</div>
            </div>
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
                          {bh ? '—' : isWkd ? '19:00→07:00' : dow >= 1 && dow <= 4 ? '10:00 / 19:00→' : '→07:00'}
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
                                  borderRadius: 6, padding: '3px 4px', fontSize: 9, fontWeight: 600,
                                  cursor: isManager ? 'pointer' : 'default', userSelect: 'none', lineHeight: 1.4, minWidth: 30,
                                }}>
                                {hol ? '🌴' : bh ? '🔴' : upg ? '⬆' : s === 'off' ? '—' : col.label?.slice(0,4) || s}
                                {s !== 'off' && !hol && !bh && !upg && hrs?.label && (
                                  <div style={{ fontSize: 8, opacity: 0.75, fontWeight: 400, marginTop: 1 }}>{hrs.label}</div>
                                )}
                                {/* Overnight overflow indicator */}
                                {isOvernight && (
                                  <div style={{ fontSize: 7, color: col.text, opacity: 0.8, marginTop: 1, letterSpacing: 0.3 }}>
                                    →07:00 next day
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
                                  ←00:00–07:00
                                  <div style={{ fontSize: 7, opacity: 0.8 }}>{prevCol.label?.slice(0,4)} cont.</div>
                                </div>
                              )}
                            </>
                          )}
                          {isManager && s !== 'off' && !isEditing && (
                            <button onClick={() => deleteCell(u.id, ds)} style={{ display: 'block', margin: '1px auto 0', background: 'none', border: 'none', color: '#ef4444', fontSize: 8, cursor: 'pointer', padding: 0 }}>✕</button>
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

function calcOncallPay(timesheetEntries, hourlyRate) {
  // Each entry may have: standby_wd, worked_wd, standby_we, worked_we (hours)
  let standbyWD = 0, workedWD = 0, standbyWE = 0, workedWE = 0;
  (timesheetEntries || []).forEach(e => {
    standbyWD += e.standby_wd || 0;
    workedWD  += e.worked_wd  || 0;
    standbyWE += e.standby_we || 0;
    workedWE  += e.worked_we  || 0;
  });
  const standbyPay = (standbyWD + standbyWE) * ONCALL_STANDBY_RATE;
  const workedPay  = (workedWD + workedWE) * hourlyRate * ONCALL_WORKED_MULTIPLIER;
  const totalOncallHours = standbyWD + workedWD + standbyWE + workedWE;
  return { standbyWD, workedWD, standbyWE, workedWE, standbyPay, workedPay,
    total: standbyPay + workedPay, totalOncallHours,
    totalStandbyHours: standbyWD + standbyWE, totalWorkedHours: workedWD + workedWE };
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
                <div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Auto (1:1 worked)</div><div style={{ fontSize: 16, fontWeight: 600, color: '#6ee7b7' }}>{b.autoToil}h</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Manual</div><div style={{ fontSize: 16, fontWeight: 600, color: '#93c5fd' }}>{b.manualAccrued}h</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Used</div><div style={{ fontSize: 16, fontWeight: 600, color: '#fcd34d' }}>{b.used}h</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Balance (max {b.cappedAt}h)</div><div style={{ fontSize: 16, fontWeight: 600, color: b.balance >= 0 ? '#6ee7b7' : '#fca5a5' }}>{b.balance}h</div></div>
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
        sub={isManager ? 'Record &amp; review appraisals, training, notes for all engineers' : 'Your personal logbook — add notes, training records, achievements'}
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
function Payroll({ users, timesheets, payconfig, toil, incidents, upgrades, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Payroll is restricted to managers.</Alert>;

  const exportCSV = () => {
    const exportDate = new Date().toISOString().slice(0, 10);
    const rows = [['Trigram', 'Full Name', 'Export Date', 'Standby Hrs Worked', 'OC Hrs Worked', 'Incident Hrs', 'TOIL Balance (hrs)', 'Upgrade Hours']];
    users.forEach(u => {
      const p      = payconfig[u.id] || { rate: 40, base: 2500 };
      const annual = p.annual || p.base * 12;
      const hourly = annual / 2080;
      const oc     = calcOncallPay(timesheets[u.id], hourly);
      const tb     = calcTOILBalance(timesheets[u.id], toil, u.id);
      const incHrs = (timesheets[u.id]||[]).filter(e=>e.week&&e.week.startsWith('INC')).reduce((a,e)=>a+(e.weekday_oncall||0)+(e.weekend_oncall||0),0);
      const upgradeHrs = (upgrades||[]).reduce((sum, up) => {
        const et = (up.engineerTimes||[]).find(e => e.engineerId === u.id && e.approved);
        return sum + (et ? et.hours : 0);
      }, 0);
      rows.push([u.id, u.name, exportDate, oc.totalStandbyHours, oc.totalWorkedHours, incHrs, tb.balance, upgradeHrs]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `cloudops-payroll-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  };

  // Summary stats
  const totalPayroll = users.reduce((sum, u) => {
    const p = payconfig[u.id] || { base: 2500 };
    return sum + (p.annual || p.base * 12);
  }, 0);
  const totalOCPay = users.reduce((sum, u) => {
    const p = payconfig[u.id] || { base: 2500 };
    const hourly = (p.annual || p.base*12) / 2080;
    return sum + calcOncallPay(timesheets[u.id], hourly).total;
  }, 0);
  const totalIncidentHrs = Object.values(timesheets).flatMap(t=>t||[]).filter(e=>e.week&&e.week.startsWith('INC')).reduce((a,e)=>a+(e.weekday_oncall||0)+(e.weekend_oncall||0),0);

  return (
    <div>
      <PageHeader title="Payroll" sub="On-call pay, TOIL, tax and take-home — manager only"
        actions={<button className="btn btn-primary" onClick={exportCSV}>📥 Export CSV</button>} />

      {/* Summary KPIs */}
      <div className="grid-4 mb-16">
        <StatCard label="Total Payroll" value={`£${Math.round(totalPayroll/1000)}k/yr`} sub="Base salaries combined" accent="#3b82f6" icon="💷" />
        <StatCard label="Total OC Pay" value={`£${Math.round(totalOCPay)}`} sub="All engineers" accent="#10b981" icon="🌙" />
        <StatCard label="Incident Hours" value={`${totalIncidentHrs}h`} sub="Auto-logged from incidents" accent="#f59e0b" icon="🚨" />
        <StatCard label="Engineers" value={users.length} sub="On payroll" accent="#818cf8" icon="👥" />
      </div>

      {/* On-call pay table */}
      <div className="card mb-16" style={{ overflowX: 'auto' }}>
        <div className="card-title">On-Call Pay Summary (standby + worked + incident hours)</div>
        <table style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>Engineer</th>
              <th>Annual Salary</th>
              <th>Standby WD (h)</th><th>Worked WD (h)</th>
              <th>Standby WE (h)</th><th>Worked WE (h)</th>
              <th style={{ color: '#f59e0b' }}>Incident Hrs</th>
              <th style={{ color: '#93c5fd' }}>Standby Pay</th>
              <th style={{ color: '#fcd34d' }}>Worked Pay</th>
              <th style={{ color: '#6ee7b7' }}>Total OC Pay</th>
              <th>TOIL Balance</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const p      = payconfig[u.id] || { rate: 40, base: 2500 };
              const annual = p.annual || p.base * 12;
              const hourly = annual / 2080;
              const oc     = calcOncallPay(timesheets[u.id], hourly);
              const tb     = calcTOILBalance(timesheets[u.id], toil, u.id);
              const incHrs = (timesheets[u.id]||[]).filter(e=>e.week&&e.week.startsWith('INC')).reduce((a,e)=>a+(e.weekday_oncall||0)+(e.weekend_oncall||0),0);
              return (
                <tr key={u.id}>
                  <td><div style={{ display:'flex', gap:8, alignItems:'center' }}><Avatar user={u} size={24} /><div><div style={{ fontSize:12 }}>{u.name}</div><div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>{u.id} · £{hourly.toFixed(2)}/hr</div></div></div></td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:'var(--text-secondary)' }}>£{annual.toLocaleString()}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12 }}>{oc.standbyWD}h</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12 }}>{oc.workedWD}h</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12 }}>{oc.standbyWE}h</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12 }}>{oc.workedWE}h</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color: incHrs>0?'#f59e0b':'var(--text-muted)' }}>{incHrs>0?`${incHrs}h`:'—'}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#93c5fd' }}>£{oc.standbyPay.toFixed(2)}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#fcd34d' }}>£{oc.workedPay.toFixed(2)}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, fontWeight:700, color:'#6ee7b7' }}>£{oc.total.toFixed(2)}</td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:tb.balance>0?'#6ee7b7':'#fca5a5' }}>{tb.balance}h</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop:10, fontSize:11, color:'var(--text-muted)' }}>
          Standby: £{ONCALL_STANDBY_RATE}/hr flat · Worked: {ONCALL_WORKED_MULTIPLIER}x hourly · TOIL: UK WTR 1:1 · max {TOIL_MAX_CARRYOVER_HOURS}h · 🚨 Incident hours auto-logged from Incidents page
        </div>
      </div>

      {/* Full take-home breakdown per engineer */}
      <div className="card-title" style={{ marginBottom:12 }}>💷 Take-Home Breakdown (base + OC, after UK tax 2025-26)</div>
      <div className="grid-2 mb-16">
        {users.map(u => {
          const p      = payconfig[u.id] || { base: 2500 };
          const annual = p.annual || p.base * 12;
          const hourly = annual / 2080;
          const oc     = calcOncallPay(timesheets[u.id], hourly);
          const annualOC   = oc.total * 12;
          const tx = calcUKTax(annual + annualOC, { pensionPct:p.pensionPct||0, studentLoan:p.studentLoan||false });
          const incHrs = (timesheets[u.id]||[]).filter(e=>e.week&&e.week.startsWith('INC')).reduce((a,e)=>a+(e.weekday_oncall||0)+(e.weekend_oncall||0),0);
          return (
            <div key={u.id} className="card">
              <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10 }}>
                <Avatar user={u} size={28} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{u.name}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>
                    £{annual.toLocaleString()}/yr base · Eff. rate: {(tx.effectiveRate*100).toFixed(1)}%
                    {incHrs>0 && <span style={{ color:'#f59e0b', marginLeft:6 }}>· 🚨 {incHrs}h incident hrs</span>}
                  </div>
                </div>
              </div>
              {/* Tax breakdown summary */}
              <div style={{ background:'rgba(30,64,175,0.1)', borderRadius:8, padding:'8px 12px', marginBottom:10, fontSize:11 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ color:'var(--text-muted)' }}>Annual gross (inc. OC)</span>
                  <span style={{ fontFamily:'DM Mono' }}>£{Math.round(tx.annualGross).toLocaleString()}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ color:'#fca5a5' }}>Income Tax</span>
                  <span style={{ fontFamily:'DM Mono', color:'#fca5a5' }}>-£{Math.round(tx.incomeTax).toLocaleString()}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ color:'#fcd34d' }}>National Insurance</span>
                  <span style={{ fontFamily:'DM Mono', color:'#fcd34d' }}>-£{Math.round(tx.ni).toLocaleString()}</span>
                </div>
                {(p.pensionPct||0) > 0 && <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ color:'#93c5fd' }}>Pension ({p.pensionPct}%)</span>
                  <span style={{ fontFamily:'DM Mono', color:'#93c5fd' }}>-£{Math.round(tx.pension).toLocaleString()}</span>
                </div>}
                {p.studentLoan && <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ color:'#c4b5fd' }}>Student Loan Plan 2</span>
                  <span style={{ fontFamily:'DM Mono', color:'#c4b5fd' }}>-£{Math.round(tx.slRepay).toLocaleString()}</span>
                </div>}
                <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px solid var(--border)', paddingTop:4, marginTop:4 }}>
                  <span style={{ fontWeight:600 }}>Annual take-home</span>
                  <span style={{ fontFamily:'DM Mono', fontWeight:700, color:'#6ee7b7' }}>£{Math.round(tx.annualNet).toLocaleString()}</span>
                </div>
              </div>
              {/* Period grid */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, fontSize:11 }}>
                {[['Monthly','monthly'],['Weekly','weekly'],['Daily','daily'],['Hourly','hourly']].map(([label,key]) => (
                  <div key={key} style={{ background:'rgba(30,64,175,0.15)', borderRadius:6, padding:'6px 8px', textAlign:'center' }}>
                    <div style={{ color:'var(--text-muted)', marginBottom:2, fontSize:10 }}>{label}</div>
                    <div style={{ fontWeight:700, color:'#6ee7b7', fontFamily:'DM Mono', fontSize:12 }}>£{tx[key].net.toFixed(key==='hourly'?2:0)}</div>
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
                      <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'DM Mono', fontWeight: 700, color: '#6ee7b7' }}>{fmt(tx[key].net, key==='hourly'?2:2)}</td>
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
function Settings({ users, setUsers, isManager, secureLinks, setSecureLinks, driveToken, profilePics, setProfilePicsState, rota, setRota }) {
  const BLANK_FORM = { name: '', trigram: '', role: 'Engineer', mobile_number: '', google_email: '', profile_picture: '', avatar: '', color: '' };
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
    const id    = generateTrigramId(form.name, users);
    const color = form.color || TRICOLORS[users.length % TRICOLORS.length];
    const avatar = form.avatar || form.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
    const newUser = { id, name: form.name, role: form.role, tri: id.slice(0,3), avatar, color,
      mobile_number: form.mobile_number || '', google_email: form.google_email || '',
      profile_picture: form.profile_picture || '' };
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
      {/* Name — always shown; label differs for add vs edit */}
      <div>
        {isEdit && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Full Name</div>}
        <input className="input" placeholder="Full Name *" value={fv.name||''} onChange={e => setFv(f => ({...f, name: e.target.value}))} />
      </div>
      {/* Trigram / ID — only shown in edit mode */}
      {isEdit && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
            Trigram ID <span style={{ color: 'rgba(255,200,50,0.8)' }}>⚠ Changing this remaps all rota, holidays &amp; timesheets</span>
          </div>
          <input className="input" placeholder="e.g. MBA47" maxLength={8}
            value={fv.trigram||''} onChange={e => setFv(f => ({...f, trigram: e.target.value.toUpperCase()}))}
            style={{ fontFamily: 'DM Mono', letterSpacing: 1 }} />
        </div>
      )}
      <select className="select" value={fv.role||'Engineer'} onChange={e => setFv(f => ({...f, role: e.target.value}))}>
        <option>Engineer</option><option>Manager</option>
      </select>
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
                </div>
                <Tag label={u.role} type={u.role === 'Manager' ? 'amber' : 'blue'} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditForm({ name: u.name, trigram: u.id, role: u.role||'Engineer', mobile_number: u.mobile_number||'', google_email: u.google_email||'', profile_picture: u.profile_picture||'', avatar: u.avatar||'', color: u.color||'' }); setEditingUserId(u.id); }}>✎ Edit</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => resetPassword(u.id)} title="Reset password to default (lowercase ID)">🔑 Reset PW</button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id)}>🗑</button>
                </div>
              </div>
            )}
          </div>
          );
        })}
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

      {showAdd && (
        <Modal title="Add Engineer" onClose={() => setShowAdd(false)} wide>
          <UserFields fv={form} setFv={setForm} uid={null} isEdit={false} />
          <Alert style={{ marginTop: 12 }}>Username auto-generated from name (e.g. SAJ04). Default password = lowercase username. They can change it via My Account.</Alert>
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
  const [logbook, setLogbook]         = useState([]);
  const [documents, setDocuments]     = useState([]);
  const [obsidianNotes, setObsidianNotes] = useState([]);
  const [whatsappChats, setWhatsappChats] = useState([]);
  const [secureLinks, setSecureLinks] = useState([]);

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
  // Uses a silent token request (prompt:none) so users never see a Google popup.
  // If silent auth fails (no active session) the indicator shows grey and they
  // can manually click "Connect" which triggers the interactive flow.
  useEffect(() => {
    const autoConnect = async () => {
      try {
        await gapiLoad();
        // initGoogleAuth must pass prompt:'none' for silent re-auth.
        // If the user has no active Google session this throws — we catch it silently.
        const token = await initGoogleAuth(GOOGLE_CLIENT_ID, { prompt: 'none' });
        if (token) {
          setDriveToken(token);
          setSyncing(true);
          const [reg, pics] = await Promise.all([
            loadRegistryFromDrive(token),
            loadProfilePictures(token)
          ]);
          if (reg) setRegistry(reg);
          if (pics) { setProfilePics(pics); setProfilePicsState(pics); }
          const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, logbook, documents, obsidianNotes, whatsappChats };
          const data = await loadAllFromDrive(token, defaults);
          if (data.users)         setUsers(data.users);
          if (data.holidays)      setHolidays(data.holidays);
          if (data.incidents)     setIncidents(data.incidents);
          if (data.timesheets)    setTimesheets(data.timesheets);
          if (data.upgrades)      setUpgrades(data.upgrades);
          if (data.wiki)          setWiki(data.wiki);
          if (data.glossary)      setGlossary(data.glossary);
          if (data.contacts)      setContacts(data.contacts);
          if (data.payconfig)     setPayconfig(data.payconfig);
          if (data.rota)          setRota(sanitiseRota(data.rota));
          if (data.swapRequests)  setSwapRequests(data.swapRequests);
          if (data.toil)          setToil(data.toil);
          if (data.absences)      setAbsences(data.absences);
          if (data.logbook)       setLogbook(data.logbook);
          if (data.documents)     setDocuments(data.documents);
          if (data.obsidianNotes) setObsidianNotes(data.obsidianNotes);
          // Team Chat: load from Drive JSON (whatsappChats.json) for two-way sync
          if (data.whatsappChats && Array.isArray(data.whatsappChats)) setWhatsappChats(data.whatsappChats);
          setLastSync(new Date());
          driveDataLoaded.current = true;  // ← unlock saves AFTER data is in state
          setDriveReady(true);
        } else {
          // No token from silent auth — allow saves with current (default) data
          driveDataLoaded.current = true;
        }
      } catch (e) {
        // Silent fail — no active Google session or prompt:none not supported
        // User can manually click Connect to trigger the interactive flow
        if (e?.error !== 'interaction_required' && e?.error !== 'login_required') {
          console.warn('Auto Drive connect:', e?.message || e);
        }
        driveDataLoaded.current = true; // unblock saves even on error
      } finally {
        setSyncing(false);
        setConnectingDrive(false);
      }
    };
    autoConnect();
  }, []);

  const connectDrive = async () => {
    try {
      setConnectingDrive(true);
      await gapiLoad();
      const token = await initGoogleAuth(GOOGLE_CLIENT_ID);
      setDriveToken(token);
      setSyncing(true);

      // Show progress bar during load
      setLoadingAfterLogin(true);
      setLoadProgress(5);
      setLoadStatus('Connecting to Google Drive…');

      // Always load the auth registry + profile pictures first (all users need this)
      setLoadProgress(15); setLoadStatus('Loading user registry…');
      const [reg, pics] = await Promise.all([
        loadRegistryFromDrive(token),
        loadProfilePictures(token)
      ]);
      if (reg) setRegistry(reg);
      if (pics) { setProfilePics(pics); setProfilePicsState(pics); }

      // Load all app data from Drive with progress steps
      setLoadProgress(30); setLoadStatus('Loading rota & schedules…');
      const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, logbook, documents, obsidianNotes, whatsappChats };
      const data = await loadAllFromDrive(token, defaults);

      setLoadProgress(65); setLoadStatus('Applying team data…');
      if (data.users)         setUsers(data.users);
      if (data.holidays)      setHolidays(data.holidays);
      if (data.incidents)     setIncidents(data.incidents);
      if (data.timesheets)    setTimesheets(data.timesheets);
      if (data.upgrades)      setUpgrades(data.upgrades);
      if (data.wiki)          setWiki(data.wiki);
      if (data.glossary)      setGlossary(data.glossary);
      if (data.contacts)      setContacts(data.contacts);
      if (data.payconfig)     setPayconfig(data.payconfig);
      if (data.rota)          setRota(sanitiseRota(data.rota));
      if (data.swapRequests)  setSwapRequests(data.swapRequests);
      if (data.toil)          setToil(data.toil);
      if (data.absences)      setAbsences(data.absences);
      if (data.logbook)       setLogbook(data.logbook);
      if (data.documents)     setDocuments(data.documents);
      if (data.obsidianNotes) setObsidianNotes(data.obsidianNotes);
      if (data.whatsappChats) setWhatsappChats(data.whatsappChats);

      setLoadProgress(95); setLoadStatus('Finalising…');
      setLastSync(new Date());
      driveDataLoaded.current = true;  // ← unlock saves AFTER data is in state
      setDriveReady(true);

      setLoadProgress(100); setLoadStatus('✅ All data loaded from Google Drive');
      setTimeout(() => { setLoadingAfterLogin(false); setLoadProgress(0); setLoadStatus(''); }, 1500);

      setSyncing(false);
      setConnectingDrive(false);
    } catch (e) {
      console.error('Drive connect error:', e);
      setSyncing(false);
      setConnectingDrive(false);
      driveDataLoaded.current = true; // unblock saves even on error
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
  useEffect(() => { save('users', users); if (isManager && driveToken) syncRegistryToDrive(driveToken, getRegistry(), users).catch(() => {}); }, [users, driveToken]);
  useEffect(() => { save('holidays', holidays); },         [holidays, driveToken]);
  useEffect(() => { save('incidents', incidents); },       [incidents, driveToken]);
  useEffect(() => { save('timesheets', timesheets); },     [timesheets, driveToken]);
  useEffect(() => { save('upgrades', upgrades); },         [upgrades, driveToken]);
  useEffect(() => { save('wiki', wiki); },                 [wiki, driveToken]);
  useEffect(() => { save('glossary', glossary); },         [glossary, driveToken]);
  useEffect(() => { save('contacts', contacts); },         [contacts, driveToken]);
  useEffect(() => { save('payconfig', payconfig); },       [payconfig, driveToken]);
  useEffect(() => { save('rota', rota); },                 [rota, driveToken]);
  useEffect(() => { save('swapRequests', swapRequests); }, [swapRequests, driveToken]);
  useEffect(() => { save('toil', toil); },                 [toil, driveToken]);
  useEffect(() => { save('absences', absences); },         [absences, driveToken]);
  useEffect(() => { save('logbook', logbook); },           [logbook, driveToken]);
  useEffect(() => { save('documents', documents); },       [documents, driveToken]);
  useEffect(() => { save('obsidianNotes', obsidianNotes); },[obsidianNotes, driveToken]);
  useEffect(() => { save('whatsappChats', whatsappChats); },[whatsappChats, driveToken]);

  const [manualSyncing, setManualSyncing] = useState(false);
  const [syncProgress, setSyncProgress]   = useState(0);
  const [syncStatus, setSyncStatus]       = useState('');

  const syncAllToDrive = async () => {
    if (!driveToken) { alert('Connect Google Drive first.'); return; }
    setManualSyncing(true); setSyncProgress(0); setSyncStatus('Starting sync…');
    const keys = ['users','holidays','incidents','timesheets','upgrades','wiki','glossary','contacts','payconfig','rota','swapRequests','toil','absences','logbook','documents','obsidianNotes','whatsappChats'];
    const vals  = [users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, logbook, documents, obsidianNotes, whatsappChats];
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
      const token = await initGoogleAuth(GOOGLE_CLIENT_ID, { prompt: 'none' }).catch(() =>
        initGoogleAuth(GOOGLE_CLIENT_ID)
      );
      if (token) {
        setDriveToken(token);
        setLoadProgress(20); setLoadStatus('Loading user registry…');
        const [reg, pics] = await Promise.all([
          loadRegistryFromDrive(token),
          loadProfilePictures(token)
        ]);
        if (reg) setRegistry(reg);
        if (pics) { setProfilePics(pics); setProfilePicsState(pics); }

        setLoadProgress(40); setLoadStatus('Loading rota & schedules…');
        const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, logbook, documents, obsidianNotes, whatsappChats };
        const data = await loadAllFromDrive(token, defaults);

        setLoadProgress(75); setLoadStatus('Applying team data…');
        if (data.users)         setUsers(data.users);
        if (data.holidays)      setHolidays(data.holidays);
        if (data.incidents)     setIncidents(data.incidents);
        if (data.timesheets)    setTimesheets(data.timesheets);
        if (data.upgrades)      setUpgrades(data.upgrades);
        if (data.wiki)          setWiki(data.wiki);
        if (data.glossary)      setGlossary(data.glossary);
        if (data.contacts)      setContacts(data.contacts);
        if (data.payconfig)     setPayconfig(data.payconfig);
        if (data.rota)          setRota(sanitiseRota(data.rota));
        if (data.swapRequests)  setSwapRequests(data.swapRequests);
        if (data.toil)          setToil(data.toil);
        if (data.absences)      setAbsences(data.absences);
        if (data.logbook)       setLogbook(data.logbook);
        if (data.documents)     setDocuments(data.documents);
        if (data.obsidianNotes) setObsidianNotes(data.obsidianNotes);
        if (data.whatsappChats) setWhatsappChats(data.whatsappChats);
        setLastSync(new Date());
        driveDataLoaded.current = true;
        setDriveReady(true);
        setLoadProgress(100); setLoadStatus('✅ Ready');
        await new Promise(r => setTimeout(r, 800));
      } else {
        // No Drive token — still let user in, saves will be blocked until manual connect
        driveDataLoaded.current = true;
        setLoadProgress(100); setLoadStatus('⚠️ Drive not connected — data may not be saved');
        await new Promise(r => setTimeout(r, 1200));
      }
    } catch (e) {
      console.warn('Login Drive load failed:', e?.message || e);
      driveDataLoaded.current = true;
      setLoadProgress(100); setLoadStatus('⚠️ Could not load Drive data');
      await new Promise(r => setTimeout(r, 1200));
    }
    setLoadingAfterLogin(false);
    setLoadProgress(0);
    setLoadStatus('');
    setLoggedIn(true);
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

  const openInc   = incidents.filter(i => i.status === 'Investigating').length;
  const pendingSwaps = swapRequests.filter(s => s.status === 'pending').length;

  const props = {
    users, setUsers, rota, setRota, holidays, setHolidays,
    incidents, setIncidents, timesheets, setTimesheets,
    upgrades, setUpgrades, wiki, setWiki, glossary, setGlossary,
    contacts, setContacts, payconfig, setPayconfig,
    currentUser, isManager, swapRequests, setSwapRequests,
    toil, setToil, absences, setAbsences, logbook, setLogbook,
    documents, setDocuments, secureLinks, setSecureLinks,
    obsidianNotes, setObsidianNotes, whatsappChats, setWhatsappChats,
    driveToken, profilePics, setProfilePicsState
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
      case 'payroll':    return <Payroll {...props} incidents={incidents} upgrades={upgrades} />;
      case 'payconfig':  return <PayConfig {...props} />;
      case 'settings':   return <Settings {...props} />;
      case 'myaccount':  return <MyAccount currentUser={currentUser} users={users} setUsers={setUsers} driveToken={driveToken} profilePics={profilePics} setProfilePicsState={setProfilePicsState} />;
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
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {NAV.map(sec => (
            <div key={sec.section}>
              {sidebarOpen && <div className="nav-section" style={{ fontSize: 9, padding: '4px 12px 2px', letterSpacing: 1 }}>{sec.section}</div>}
              {sec.items.filter(i => !i.managerOnly || isManager).map(item => (
                <div key={item.id}
                  className={`nav-item${page === item.id ? ' active' : ''}`}
                  onClick={() => setPage(item.id)}
                  title={item.label}
                  style={{ padding: sidebarOpen ? '5px 12px' : '6px', minHeight: 30 }}>
                  <span className="nav-icon" style={{ fontSize: 14 }}>{item.icon}</span>
                  {sidebarOpen && <span style={{ fontSize: 12 }}>{item.label}</span>}
                  {item.badge && openInc > 0 && <span className="badge">{openInc}</span>}
                  {item.id === 'swaps' && pendingSwaps > 0 && <span className="badge">{pendingSwaps}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          {driveToken ? (
            sidebarOpen && (
              <div className="gd-status" style={{ marginBottom: 6 }}>
                <div className="dot-live" />
                <span style={{ fontSize: 10 }}>
                  {syncing ? 'Syncing…' : `Synced ${lastSync ? lastSync.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}`}
                </span>
              </div>
            )
          ) : (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: '#fcd34d' }}>{connectingDrive ? '⏳ Connecting…' : '⚠ Drive offline'}</div>
              {!connectingDrive && <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 3, fontSize: 10 }} onClick={connectDrive}>📁 Reconnect</button>}
            </div>
          )}
          <button className="btn btn-secondary btn-sm" style={{ width: '100%', fontSize: 11, padding: '4px 8px' }} onClick={() => { setLoggedIn(false); }}>
            {sidebarOpen ? '⎋ Sign Out' : '⎋'}
          </button>
        </div>
      </div>
      <div className="main">
        <div className="topbar">
          <button className="btn btn-secondary btn-sm" onClick={() => setSidebarOpen(!sidebarOpen)} style={{ padding: '4px 10px' }}>{sidebarOpen ? '◀' : '▶'}</button>
          <div className="topbar-title">{pageTitles[page] || page}</div>
          <input className="topbar-search" placeholder="Search…" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
            {/* Refresh data from Drive */}
            {driveToken && (
              <button title="Refresh data from Google Drive" className="btn btn-secondary btn-sm" style={{ padding: '3px 8px' }}
                onClick={async () => {
                  try {
                    setSyncing(true);
                    const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, logbook, documents, obsidianNotes, whatsappChats };
                    const data = await loadAllFromDrive(driveToken, defaults);
                    if (data.users)         setUsers(data.users);
                    if (data.holidays)      setHolidays(data.holidays);
                    if (data.incidents)     setIncidents(data.incidents);
                    if (data.timesheets)    setTimesheets(data.timesheets);
                    if (data.upgrades)      setUpgrades(data.upgrades);
                    if (data.wiki)          setWiki(data.wiki);
                    if (data.glossary)      setGlossary(data.glossary);
                    if (data.contacts)      setContacts(data.contacts);
                    if (data.payconfig)     setPayconfig(data.payconfig);
                    if (data.rota)          setRota(sanitiseRota(data.rota));
                    if (data.swapRequests)  setSwapRequests(data.swapRequests);
                    if (data.toil)          setToil(data.toil);
                    if (data.absences)      setAbsences(data.absences);
                    if (data.logbook)       setLogbook(data.logbook);
                    if (data.documents)     setDocuments(data.documents);
                    if (data.obsidianNotes) setObsidianNotes(data.obsidianNotes);
                    if (data.whatsappChats) setWhatsappChats(data.whatsappChats);
                    setLastSync(new Date());
                  } catch(e) { console.warn('Refresh failed:', e); }
                  finally { setSyncing(false); }
                }}>🔄</button>
            )}
            {/* Manual sync to Drive */}
            {driveToken && (
              <button title="Sync all data to Google Drive" className="btn btn-secondary btn-sm" style={{ padding: '3px 8px', fontSize: 11 }}
                onClick={syncAllToDrive} disabled={manualSyncing}>
                {manualSyncing ? '⏳' : '☁'}
              </button>
            )}
            {openInc > 0 && <div style={{ background: '#ef4444', color: '#fff', borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>🚨 {openInc}</div>}
            <Avatar user={user || { avatar: '?', color: '#475569' }} size={28} />
          </div>
        </div>
        {/* Manual sync progress bar */}
        {manualSyncing && (
          <div style={{ padding: '6px 16px', background: 'rgba(59,130,246,0.1)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--accent)', minWidth: 180 }}>{syncStatus}</span>
            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${syncProgress}%`, background: 'var(--accent)', borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{syncProgress}%</span>
          </div>
        )}
        <div className="content">{renderPage()}</div>
      </div>
    </div>
  );
}
