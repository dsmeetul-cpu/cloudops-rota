// src/App.js
// CloudOps Rota — Full Production Build v2
// Meetul Bhundia (MBA47) · Cloud Run Operations · 24th June 2026

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import {
  initGoogleAuth, gapiLoad, loadAllFromDrive, driveWrite, driveRead,
  generateICalFeed, downloadIcal
} from './hooks/useGoogleDrive';
import {
  DEFAULT_USERS, DEFAULT_HOLIDAYS, DEFAULT_INCIDENTS, DEFAULT_TIMESHEETS,
  DEFAULT_UPGRADES, DEFAULT_WIKI, DEFAULT_GLOSSARY, DEFAULT_CONTACTS,
  DEFAULT_PAYCONFIG, SHIFTS, UK_BANK_HOLIDAYS, generateRota,
  generateTrigramId, TRICOLORS
} from './utils/defaults';
import TimeKeeping from './TimeKeeping';
import TOIL from './TOIL';
import RotaPage from './Rota';
import SettingsPage from './Settings';
import Wiki from './Wiki';
import Announcements, { AnnouncementBanners } from './Announcements';
import ShiftReminders, { ShiftReminderBanner } from './ShiftReminders';
import CalendarPage from './Calendar';
import Dashboard from './Dashboard';
import OnCall from './OnCall';
import Incidents from './Incidents';
import Logs, { createLogWriter } from './Logs';
import UpgradeDays from './UpgradeDays';
import Holidays from './Holidays';
import Payroll from './Payroll';

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
const APP_FOLDER_NAME = 'CloudOps-Rota';
let _appFolderIdCache = null;

async function getAppFolderId(token) {
  if (_appFolderIdCache) return _appFolderIdCache;
  const q = encodeURIComponent(`name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  if (resp.files && resp.files.length > 0) {
    _appFolderIdCache = resp.files[0].id;
    return _appFolderIdCache;
  }
  return null; // folder created by useGoogleDrive on first driveWrite
}

// Find a file by name, searching inside the app folder first (then root fallback)
// ── Module-level file-ID cache (avoids repeated search queries) ─────────────
const _fileIdCache = {};

async function driveFindFile(token, name, parentId) {
  const pid = parentId || await getAppFolderId(token);
  const cacheKey = `${pid}/${name}`;
  if (_fileIdCache[cacheKey]) return { id: _fileIdCache[cacheKey], name };
  const q = pid
    ? encodeURIComponent(`name='${name}' and '${pid}' in parents and trashed=false`)
    : encodeURIComponent(`name='${name}' and trashed=false`);
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  const file = resp.files && resp.files.length > 0 ? resp.files[0] : null;
  if (file) _fileIdCache[cacheKey] = file.id;
  return file;
}

// Find or create a subfolder inside the app folder
async function driveGetOrCreateSubfolder(token, folderName) {
  const parentId = await getAppFolderId(token);
  const q = parentId
    ? encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`)
    : encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  if (searchResp.files && searchResp.files.length > 0) return searchResp.files[0].id;
  // Create it
  const body = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
  return createResp.id;
}

async function driveReadJson(token, fileId) {
  // Cache-bust: without _t Google CDN can serve a stale response for up to 60s
  return fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&_t=${Date.now()}`,
    { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' } }
  ).then(r => r.json());
}

// Write a JSON file into the app folder (or a specific parent folder)
async function driveWriteJson(token, name, data, parentId) {
  const body = JSON.stringify(data);
  const pid  = parentId || await getAppFolderId(token);
  const cacheKey = `${pid}/${name}`;

  // Use cached file ID if available to skip the search round-trip
  let fileId = _fileIdCache[cacheKey] || null;
  if (!fileId) {
    const existing = await driveFindFile(token, name, pid);
    fileId = existing?.id || null;
  }

  if (fileId) {
    const result = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    }).then(r => r.json());
    // If PATCH fails (file deleted externally), clear cache and retry as new
    if (result.error) {
      delete _fileIdCache[cacheKey];
      fileId = null;
    } else {
      _fileIdCache[cacheKey] = result.id || fileId;
      return result;
    }
  }

  // Create new file
  const meta = { name, mimeType: 'application/json', ...(pid ? { parents: [pid] } : {}) };
  const created = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  }).then(r => r.json());
  if (created.id) _fileIdCache[cacheKey] = created.id;
  return fetch(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  }).then(r => r.json());
}

// Delete a file from Drive by its file ID
async function driveDeleteFile(token, fileId) {
  return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Upload a binary Blob to Drive (used for Excel exports)
async function driveUploadBlob(token, name, blob, parentId) {
  const pid = parentId || await getAppFolderId(token);
  const existing = await driveFindFile(token, name, pid);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(
    existing ? { name } : { name, parents: pid ? [pid] : [] }
  )], { type: 'application/json' }));
  form.append('file', blob);
  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  return fetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
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

// ── Rich Text / Word-style ribbon editor ─────────────────────────────────────
function RichEditor({ value, onChange, placeholder = 'Start typing…', rows = 8, fullPage = false }) {
  const ref     = useRef(null);
  const fileRef = useRef(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findVal,  setFindVal]  = useState('');
  const [replVal,  setReplVal]  = useState('');

  const exec = (cmd, val = null) => { document.execCommand(cmd, false, val); ref.current?.focus(); };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'md' || ext === 'txt') {
      const text = await file.text();
      let html = text
        .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
        .replace(/`(.+?)`/g,'<code style="background:rgba(0,0,0,0.4);padding:2px 5px;border-radius:4px;font-family:DM Mono,monospace">$1</code>')
        .replace(/^- (.+)$/gm,'<li>$1</li>').replace(/(<li>.*<\/li>)/gs,'<ul>$1</ul>')
        .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');
      html = '<p>' + html + '</p>';
      if (ref.current) { ref.current.innerHTML = html; onChange?.(html); }
    } else if (ext === 'csv') {
      const text = await file.text();
      const csvRows = text.trim().split('\n').map(r => r.split(','));
      let html = '<table border="1" style="border-collapse:collapse;width:100%">';
      csvRows.forEach((r,i) => { html += '<tr>'; r.forEach(c => { html += i===0?`<th style="padding:4px 8px;background:#1e3a5f">${c.trim()}</th>`:`<td style="padding:4px 8px">${c.trim()}</td>`; }); html += '</tr>'; });
      html += '</table>';
      if (ref.current) { ref.current.innerHTML = html; onChange?.(html); }
    } else if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
      const loadJSZip = () => new Promise((res,rej) => {
        if (window.JSZip){res(window.JSZip);return;}
        const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload=()=>res(window.JSZip); s.onerror=rej; document.head.appendChild(s);
      });
      try {
        const JSZip=await loadJSZip(); const ab=await file.arrayBuffer(); const zip=await JSZip.loadAsync(ab);
        let text='';
        const targets=ext==='docx'?['word/document.xml']:ext==='pptx'?Object.keys(zip.files).filter(n=>n.startsWith('ppt/slides/slide')&&n.endsWith('.xml')):['xl/sharedStrings.xml'];
        for(const t of targets){const f=zip.file(t);if(f){text+=(await f.async('text')).replace(/<[^>]+>/g,' ')+'\n';}}
        text=text.replace(/\s+/g,' ').trim().slice(0,20000);
        const html='<p>'+text.split(/(?<=[.!?])\s+/).filter(Boolean).join('</p><p>')+'</p>';
        if(ref.current){ref.current.innerHTML=html||`<p><em>📎 ${file.name} imported</em></p>`;onChange?.(ref.current.innerHTML);}
      } catch {
        const msg=`<p><em>📎 ${file.name}</em></p><p style="color:#fcd34d">⚠ Could not extract text.</p>`;
        if(ref.current){ref.current.innerHTML=msg;onChange?.(msg);}
      }
    } else {
      const text=await file.text().catch(()=>'[Binary file]');
      const html=`<p><em>📎 ${file.name}</em></p><pre style="font-size:11px;overflow:auto">${text.slice(0,3000)}</pre>`;
      if(ref.current){ref.current.innerHTML=html;onChange?.(html);}
    }
    e.target.value='';
  };

  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || ''; }, []); // eslint-disable-line

  const insertTable = () => exec('insertHTML', `<table border="1" style="border-collapse:collapse;width:100%;margin:8px 0"><tr><th style="padding:6px 10px;background:#1e3a5f;min-width:80px">Header 1</th><th style="padding:6px 10px;background:#1e3a5f">Header 2</th><th style="padding:6px 10px;background:#1e3a5f">Header 3</th></tr><tr><td style="padding:6px 10px">Cell</td><td style="padding:6px 10px">Cell</td><td style="padding:6px 10px">Cell</td></tr><tr><td style="padding:6px 10px">Cell</td><td style="padding:6px 10px">Cell</td><td style="padding:6px 10px">Cell</td></tr></table><p></p>`);

  const insertCodeBlock = () => exec('insertHTML', `<pre style="background:rgba(0,0,0,0.55);padding:14px 16px;border-radius:8px;overflow:auto;font-size:12px;font-family:DM Mono,Courier New,monospace;color:#6ee7b7;margin:10px 0;border:1px solid rgba(110,231,183,0.2)">// paste your code here</pre><p></p>`);

  const insertCallout = (type='info') => {
    const s={info:['rgba(0,194,255,0.1)','rgba(0,194,255,0.3)','#7dd3fc','ℹ️'],warning:['rgba(245,158,11,0.1)','rgba(245,158,11,0.3)','#fcd34d','⚠️'],success:['rgba(16,185,129,0.1)','rgba(16,185,129,0.3)','#6ee7b7','✅'],danger:['rgba(239,68,68,0.1)','rgba(239,68,68,0.3)','#fca5a5','🔴']};
    const [bg,border,color,icon]=s[type]||s.info;
    exec('insertHTML',`<div style="background:${bg};border-left:4px solid ${border};padding:12px 16px;border-radius:0 8px 8px 0;margin:10px 0;color:${color}">${icon} <strong>Note:</strong> Add your callout text here.</div><p></p>`);
  };

  const insertLink = () => {
    const url=prompt('Enter URL:'); const text=prompt('Link text (blank to wrap selection):');
    if(url&&text) exec('insertHTML',`<a href="${url}" target="_blank" style="color:var(--accent)">${text}</a>`);
    else if(url) exec('createLink',url);
  };

  const insertHR = () => exec('insertHTML','<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:18px 0"/><p></p>');
  const insertInlineCode = () => exec('insertHTML',`<code style="background:rgba(0,0,0,0.4);padding:2px 6px;border-radius:4px;font-family:DM Mono,monospace;font-size:.9em;color:#6ee7b7"> code </code>`);

  const doFind = () => {
    if(!findVal||!ref.current) return;
    ref.current.innerHTML = ref.current.innerHTML.replace(new RegExp(findVal.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),m=>`<mark style="background:#fbbf24;color:#000">${m}</mark>`);
    onChange?.(ref.current.innerHTML);
  };
  const doReplace = () => {
    if(!findVal||!ref.current) return;
    ref.current.innerHTML = ref.current.innerHTML.replace(new RegExp(findVal.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),replVal);
    onChange?.(ref.current.innerHTML);
  };

  const minH = fullPage ? '55vh' : rows * 22;
  const TB = (extra={}) => ({ padding:'4px 8px', borderRadius:5, border:'1px solid var(--border)', background:'var(--bg-card2)', color:'var(--text-primary)', cursor:'pointer', fontSize:12, display:'inline-flex', alignItems:'center', gap:4, whiteSpace:'nowrap', lineHeight:1.3, ...extra });
  const SEP = <div style={{ width:1, background:'var(--border)', margin:'0 4px', alignSelf:'stretch' }} />;

  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', background:'var(--bg-card2)', display:'flex', flexDirection:'column' }}>
      {/* ── Row 1: Paragraph styles, font, size, character formatting ─────── */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:3, padding:'7px 10px 4px', borderBottom:'1px solid rgba(255,255,255,0.05)', background:'var(--bg-card)', alignItems:'center' }}>
        <select onChange={e=>{exec('formatBlock',e.target.value);e.target.value='';}} defaultValue=""
          style={{...TB(),padding:'4px 6px',fontSize:11,minWidth:115}}>
          <option value="" disabled>¶ Paragraph Style</option>
          <option value="p">Normal Text</option>
          <option value="h1">Heading 1</option><option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option><option value="h4">Heading 4</option>
          <option value="h5">Heading 5</option>
          <option value="pre">Code Block</option><option value="blockquote">Block Quote</option>
        </select>
        <select onChange={e=>{exec('fontName',e.target.value);e.target.value='';}} defaultValue=""
          style={{...TB(),padding:'4px 6px',fontSize:11,minWidth:100}}>
          <option value="" disabled>Font</option>
          {['Arial','Georgia','Courier New','Verdana','Times New Roman','Trebuchet MS','DM Sans','system-ui'].map(f=><option key={f} value={f}>{f}</option>)}
        </select>
        <select onChange={e=>exec('fontSize',e.target.value)} defaultValue=""
          style={{...TB(),padding:'4px 6px',fontSize:11,width:60}}>
          <option value="" disabled>Size</option>
          {[1,2,3,4,5,6,7].map(s=><option key={s} value={s}>{[8,10,12,14,18,24,36][s-1]}pt</option>)}
        </select>
        {SEP}
        <button onMouseDown={e=>{e.preventDefault();exec('bold')}}          style={{...TB(),fontWeight:700,minWidth:30}}>B</button>
        <button onMouseDown={e=>{e.preventDefault();exec('italic')}}        style={{...TB(),fontStyle:'italic',minWidth:30}}>I</button>
        <button onMouseDown={e=>{e.preventDefault();exec('underline')}}     style={{...TB(),textDecoration:'underline',minWidth:30}}>U</button>
        <button onMouseDown={e=>{e.preventDefault();exec('strikeThrough')}} style={{...TB(),minWidth:30}}>S̶</button>
        <button onMouseDown={e=>{e.preventDefault();exec('superscript')}}   style={{...TB(),fontSize:10,minWidth:28}}>x²</button>
        <button onMouseDown={e=>{e.preventDefault();exec('subscript')}}     style={{...TB(),fontSize:10,minWidth:28}}>x₂</button>
        {SEP}
        <div style={{display:'flex',alignItems:'center',gap:3}}>
          <span style={{fontSize:10,color:'var(--text-muted)',fontWeight:700}}>A</span>
          <input type="color" defaultValue="#ffffff" onChange={e=>exec('foreColor',e.target.value)} title="Text colour" style={{width:22,height:22,border:'1px solid var(--border)',borderRadius:4,cursor:'pointer',padding:1}}/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:3}}>
          <span style={{fontSize:10,color:'var(--text-muted)',fontWeight:700}}>BG</span>
          <input type="color" defaultValue="#1e3a5f" onChange={e=>exec('hiliteColor',e.target.value)} title="Highlight colour" style={{width:22,height:22,border:'1px solid var(--border)',borderRadius:4,cursor:'pointer',padding:1}}/>
        </div>
        {SEP}
        {[['justifyLeft','⬛▫▫','Left'],['justifyCenter','▫⬛▫','Centre'],['justifyRight','▫▫⬛','Right'],['justifyFull','⬛⬛⬛','Justify']].map(([cmd,icon,tip])=>(
          <button key={cmd} onMouseDown={e=>{e.preventDefault();exec(cmd);}} title={tip} style={{...TB(),fontSize:9,minWidth:28}}>{icon}</button>
        ))}
        {SEP}
        <button onMouseDown={e=>{e.preventDefault();exec('undo');}}         title="Undo" style={{...TB(),fontSize:14}}>↩</button>
        <button onMouseDown={e=>{e.preventDefault();exec('redo');}}         title="Redo" style={{...TB(),fontSize:14}}>↪</button>
        <button onMouseDown={e=>{e.preventDefault();exec('removeFormat');}} title="Clear formatting" style={{...TB(),color:'var(--text-muted)'}}>✕ Fmt</button>
      </div>

      {/* ── Row 2: Lists, inserts, callouts, find ─────────────────────────── */}
      <div style={{display:'flex',flexWrap:'wrap',gap:3,padding:'4px 10px 6px',borderBottom:'1px solid var(--border)',background:'var(--bg-card)',alignItems:'center'}}>
        <button onMouseDown={e=>{e.preventDefault();exec('insertUnorderedList');}} style={TB()}>• Bullet List</button>
        <button onMouseDown={e=>{e.preventDefault();exec('insertOrderedList');}}   style={TB()}>1. Numbered</button>
        <button onMouseDown={e=>{e.preventDefault();exec('indent');}}    style={TB()}>→ Indent</button>
        <button onMouseDown={e=>{e.preventDefault();exec('outdent');}}   style={TB()}>← Outdent</button>
        {SEP}
        <button onMouseDown={e=>{e.preventDefault();insertTable();}}      style={{...TB(),color:'var(--accent)'}}>⊞ Table</button>
        <button onMouseDown={e=>{e.preventDefault();insertLink();}}       style={{...TB(),color:'var(--accent)'}}>🔗 Link</button>
        <button onMouseDown={e=>{e.preventDefault();insertHR();}}         style={{...TB(),color:'var(--text-muted)'}}>─ Rule</button>
        <button onMouseDown={e=>{e.preventDefault();insertInlineCode();}} style={{...TB(),fontFamily:'DM Mono,monospace',color:'#6ee7b7',fontSize:11}}>{`<>`} Code</button>
        <button onMouseDown={e=>{e.preventDefault();insertCodeBlock();}}  style={{...TB(),fontFamily:'DM Mono,monospace',color:'#6ee7b7'}}>{`{}`} Code Block</button>
        {SEP}
        <button onMouseDown={e=>{e.preventDefault();insertCallout('info');}}    style={{...TB(),color:'#7dd3fc',fontSize:11}}>ℹ️ Info</button>
        <button onMouseDown={e=>{e.preventDefault();insertCallout('warning');}} style={{...TB(),color:'#fcd34d',fontSize:11}}>⚠️ Warning</button>
        <button onMouseDown={e=>{e.preventDefault();insertCallout('success');}} style={{...TB(),color:'#6ee7b7',fontSize:11}}>✅ Note</button>
        <button onMouseDown={e=>{e.preventDefault();insertCallout('danger');}}  style={{...TB(),color:'#fca5a5',fontSize:11}}>🔴 Alert</button>
        {SEP}
        <label style={{...TB(),color:'var(--accent)',cursor:'pointer'}}>
          📎 Import
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.docx,.pptx,.xlsx,.html" onChange={handleImport} style={{display:'none'}}/>
        </label>
        <button onMouseDown={e=>{e.preventDefault();setFindOpen(p=>!p);}} style={{...TB(),color:findOpen?'var(--accent)':'var(--text-muted)'}}>🔍 Find</button>
      </div>

      {/* ── Find & Replace ─────────────────────────────────────────────────── */}
      {findOpen && (
        <div style={{display:'flex',gap:6,padding:'6px 10px',borderBottom:'1px solid var(--border)',background:'rgba(0,0,0,0.2)',alignItems:'center',flexWrap:'wrap'}}>
          <input value={findVal} onChange={e=>setFindVal(e.target.value)} placeholder="Find…"
            style={{padding:'4px 8px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg-card2)',color:'var(--text-primary)',fontSize:12,width:160}}/>
          <input value={replVal} onChange={e=>setReplVal(e.target.value)} placeholder="Replace with…"
            style={{padding:'4px 8px',borderRadius:5,border:'1px solid var(--border)',background:'var(--bg-card2)',color:'var(--text-primary)',fontSize:12,width:160}}/>
          <button onClick={doFind}    style={{...TB(),color:'var(--accent)'}}>Find & Highlight</button>
          <button onClick={doReplace} style={{...TB(),color:'#fcd34d'}}>Replace All</button>
          <button onClick={()=>setFindOpen(false)} style={{...TB(),color:'var(--text-muted)'}}>✕</button>
        </div>
      )}

      {/* ── Editable area ─────────────────────────────────────────────────── */}
      <div ref={ref} contentEditable suppressContentEditableWarning
        onInput={()=>onChange?.(ref.current.innerHTML)}
        data-placeholder={placeholder}
        style={{ minHeight:minH, padding:fullPage?'28px 36px':'14px 16px', outline:'none', fontSize:14,
          color:'var(--text-primary)', lineHeight:1.85, caretColor:'var(--accent)', flex:1,
          fontFamily:'Georgia,"Times New Roman",serif' }}/>
      <style>{`
        [contenteditable] h1{font-size:1.9em;font-weight:800;margin:.5em 0 .3em}
        [contenteditable] h2{font-size:1.5em;font-weight:700;margin:.5em 0 .3em}
        [contenteditable] h3{font-size:1.2em;font-weight:700;margin:.5em 0 .25em}
        [contenteditable] h4{font-size:1.05em;font-weight:700;margin:.4em 0 .2em}
        [contenteditable] blockquote{border-left:4px solid var(--accent);margin:8px 0;padding:6px 14px;background:rgba(0,194,255,0.05);border-radius:0 6px 6px 0;font-style:italic}
        [contenteditable] pre{background:rgba(0,0,0,0.55);padding:14px 16px;border-radius:8px;font-family:'DM Mono',monospace;font-size:12px;color:#6ee7b7;overflow:auto;margin:8px 0}
        [contenteditable] code{background:rgba(0,0,0,0.4);padding:2px 5px;border-radius:4px;font-family:'DM Mono',monospace;font-size:.9em;color:#6ee7b7}
        [contenteditable] table{border-collapse:collapse;width:100%;margin:8px 0}
        [contenteditable] td,[contenteditable] th{border:1px solid rgba(255,255,255,0.12);padding:6px 10px;font-size:13px}
        [contenteditable] th{background:#1e3a5f;font-weight:700}
        [contenteditable] ul,[contenteditable] ol{padding-left:1.5em;margin:.4em 0}
        [contenteditable] a{color:var(--accent)}
        [contenteditable]:empty:before{content:attr(data-placeholder);color:var(--text-muted);pointer-events:none}
        [contenteditable] hr{border:none;border-top:1px solid rgba(255,255,255,0.15);margin:18px 0}
      `}</style>
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
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const boxStyle = fullscreen
    ? { position: 'fixed', inset: 0, margin: 0, width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', borderRadius: 0, display: 'flex', flexDirection: 'column' }
    : wide ? { width: 720 } : {};

  return (
    <div className="modal-overlay" style={fullscreen ? { padding: 0, alignItems: 'stretch' } : {}}
      onClick={e => !fullscreen && e.target === e.currentTarget && onClose()}>
      <div className="modal" style={boxStyle}>
        <div className="modal-header" style={{ padding: fullscreen ? '14px 24px' : undefined, borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 10 }}>
          <div className="modal-title" style={{ fontSize: fullscreen ? 16 : 15 }}>{title}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {fullscreen && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Esc to close</span>}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={{ padding: fullscreen ? '24px 28px 32px' : '0 20px 20px', flex: 1, overflowY: 'auto' }}>{children}</div>
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
      setErr('Incorrect password. Please try again or use Forgot Password to reset.');
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
    setForgotMsg('Password has been reset. Please contact your manager for your new password.');
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
          ? <Alert type="success">✅ {forgotMsg}</Alert>
          : <Alert type="info">ℹ Enter your username and your password will be reset. Contact your manager to receive the new one.</Alert>}
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
    { id: 'timesheets',   icon: '⏱', label: 'Timesheets'                      },
    { id: 'timekeeping',  icon: '🕒', label: 'Time Keeping' },
    { id: 'holidays',     icon: '🌴', label: 'Holidays' },
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
    { id: 'whatsapp',       icon: '💬', label: 'Team Chat'         },
    { id: 'announcements',  icon: '📢', label: 'Announcements'     },
    { id: 'shiftreminders', icon: '🔔', label: 'Shift Reminders'   },
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
    { id: 'logs',      icon: '📋', label: 'Activity Logs',  managerOnly: true },
    { id: 'myaccount', icon: '👤', label: 'My Account'      },
  ]},
];

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

// CalendarView moved to src/Calendar.js

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

  // Engineers can only see pay details for their own timesheet
  const canSeePay = isManager || activeUser === currentUser;

  const thStyle = {
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'DM Mono, monospace',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
  };

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
        {canSeePay
          ? <StatCard label="Est. OC Pay" value={'£' + Math.round(grossOC).toLocaleString()} sub="Before tax" accent="#10b981" />
          : <StatCard label="Est. OC Pay" value="—" sub="Managers only" accent="#4a6080" />}
      </div>
      <div className="card">
        <div className="flex-between mb-12">
          <div className="card-title">On-Call Hours — {user?.name}</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ background: 'var(--bg-card2)' }}>
              <th style={{ width: 32, padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                <input type="checkbox" checked={selected.size === sheets.length && sheets.length > 0} onChange={() => { if (selected.size === sheets.length) clearAll(); else sheets.forEach((_, i) => { if (!selected.has(i)) toggleOne(i); }); }} />
              </th>
              <th style={thStyle}>Week</th>
              <th style={thStyle}>Weekday OC Hrs</th>
              <th style={thStyle}>Weekend OC Hrs</th>
              {canSeePay && <th style={thStyle}>Weekday Pay</th>}
              {canSeePay && <th style={thStyle}>Weekend Pay</th>}
              <th style={{...thStyle, width: '35%'}}>Notes</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sheets.length === 0 && (
              <tr><td colSpan={canSeePay ? 8 : 6} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No entries yet</td></tr>
            )}
            {sheets.map((s, idx) => {
              const wdPay = (s.weekday_oncall || 0) * rate * 0.5;
              const wePay = (s.weekend_oncall || 0) * rate * 0.75;
              return (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}><input type="checkbox" checked={selected.has(idx)} onChange={() => toggleOne(idx)} /></td>
                  <td style={{ padding: '8px 12px', fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{s.week}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'DM Mono', fontSize: 12, textAlign: 'center' }}>{s.weekday_oncall || 0}h</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'DM Mono', fontSize: 12, textAlign: 'center' }}>{s.weekend_oncall || 0}h</td>
                  {canSeePay && <td style={{ padding: '8px 12px', fontFamily: 'DM Mono', fontSize: 12, color: '#6ee7b7' }}>£{wdPay.toFixed(2)}</td>}
                  {canSeePay && <td style={{ padding: '8px 12px', fontFamily: 'DM Mono', fontSize: 12, color: '#fcd34d' }}>£{wePay.toFixed(2)}</td>}
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.notes || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
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


// ── Shift Swaps ────────────────────────────────────────────────────────────
function ShiftSwaps({ users, swapRequests, setSwapRequests, rota, setRota, currentUser, isManager, driveToken }) {
  const all = Array.isArray(swapRequests) ? swapRequests : [];
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(all);
  const [editId,    setEditId]    = useState(null);
  const [editForm,  setEditForm]  = useState({});
  const [showNew,   setShowNew]   = useState(false);
  const [filter,    setFilter]    = useState('all');
  const [newForm,   setNewForm]   = useState({
    type: 'swap', requesterId: currentUser, targetId: '',
    reqDate: '', tgtDate: '', reason: '', urgent: false,
  });

  const persist = (next) => {
    setSwapRequests(next);
    if (driveToken) driveWriteJson(driveToken, 'swapRequests.json', next).catch(()=>{});
  };

  const submitRequest = () => {
    if (!newForm.reqDate || !newForm.requesterId) return;
    if (newForm.type === 'swap' && !newForm.targetId) return;
    const req = {
      id: 'swap-' + Date.now(), type: newForm.type,
      requesterId: newForm.requesterId, targetId: newForm.targetId || null,
      reqDate: newForm.reqDate, tgtDate: newForm.tgtDate || null,
      reason: newForm.reason, urgent: newForm.urgent,
      status: 'pending', created: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(), coverOnly: newForm.type === 'cover', managerNote: '',
    };
    persist([req, ...all]);
    setShowNew(false);
    setNewForm({ type:'swap', requesterId:currentUser, targetId:'', reqDate:'', tgtDate:'', reason:'', urgent:false });
  };

  const openEdit = (s, e) => { e.stopPropagation(); setEditForm({ ...s }); setEditId(s.id); };
  const saveEdit = () => { persist(all.map(s => s.id === editId ? { ...s, ...editForm } : s)); setEditId(null); };

  const approve = (swapId) => {
    if (!isManager) return;
    const swap = all.find(s => s.id === swapId);
    if (!swap) return;
    const newRota = JSON.parse(JSON.stringify(rota));
    const reqShift = newRota[swap.requesterId]?.[swap.reqDate];
    const tgtShift = swap.tgtDate ? newRota[swap.targetId]?.[swap.tgtDate] : null;
    if (reqShift && swap.targetId) {
      newRota[swap.targetId] = { ...(newRota[swap.targetId]||{}), [swap.reqDate]: reqShift };
      delete newRota[swap.requesterId][swap.reqDate];
    }
    if (tgtShift && swap.tgtDate) {
      newRota[swap.requesterId] = { ...(newRota[swap.requesterId]||{}), [swap.tgtDate]: tgtShift };
      delete newRota[swap.targetId][swap.tgtDate];
    }
    setRota(newRota);
    persist(all.map(s => s.id === swapId ? { ...s, status:'approved', approvedAt:new Date().toISOString() } : s));
  };

  const reject   = (id) => persist(all.map(s => s.id===id ? { ...s, status:'rejected' } : s));
  const cancel   = (id) => { if (window.confirm('Cancel this request?')) persist(all.filter(s => s.id!==id)); };
  const deleteOne  = (id, e) => { e.stopPropagation(); persist(all.filter(s => s.id!==id)); };
  const deleteBulk = () => { persist(all.filter(s => !selected.has(s.id))); clearAll(); };

  const uName = id => users.find(u=>u.id===id)?.name || id || '—';
  const uObj  = id => users.find(u=>u.id===id);
  const shiftOnDate = (uid, date) => rota?.[uid]?.[date] || '—';
  const visible = all.filter(s => filter === 'all' ? true : s.status === filter);

  return (
    <div>
      <PageHeader
        title="Shift Swaps &amp; Cover Requests"
        sub="Request and manage shift swaps or cover — both engineers and managers can raise requests"
        actions={<button className="btn btn-primary" onClick={()=>setShowNew(true)}>+ New Request</button>}
      />
      <div className="grid-4 mb-16">
        <StatCard label="Pending"  value={all.filter(s=>s.status==='pending').length}  sub="Awaiting manager" accent="#f59e0b" />
        <StatCard label="Approved" value={all.filter(s=>s.status==='approved').length} sub="Rota updated"     accent="#10b981" />
        <StatCard label="Rejected" value={all.filter(s=>s.status==='rejected').length} sub="Not approved"     accent="#ef4444" />
        <StatCard label="Total"    value={all.length}                                   sub="All time"         accent="#818cf8" />
      </div>
      <div className="flex-between mb-12">
        <div className="tab-bar" style={{ marginBottom:0 }}>
          {['all','pending','approved','rejected'].map(f => (
            <button key={f} className={`btn ${filter===f?'btn-primary':'btn-secondary'}`}
              onClick={()=>setFilter(f)} style={{ textTransform:'capitalize' }}>
              {f} ({f==='all' ? all.length : all.filter(s=>s.status===f).length})
            </button>
          ))}
        </div>
        {isManager && selected.size > 0 && (
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-success btn-sm" onClick={()=>{ selected.forEach(id=>approve(id)); clearAll(); }}>✓ Approve {selected.size}</button>
            <button className="btn btn-danger  btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>
            <button className="btn btn-secondary btn-sm" onClick={clearAll}>✕ Clear</button>
          </div>
        )}
      </div>
      <div className="card" style={{ overflowX:'auto' }}>
        <table>
          <thead>
            <tr>
              {isManager && <th style={{ width:32 }}><input type="checkbox" checked={selected.size===all.length&&all.length>0} onChange={toggleAll} /></th>}
              <th>Requester</th><th>Their Date</th><th>Shift</th><th>Type</th>
              <th>Cover / Swap With</th><th>Their Date</th><th>Shift</th>
              <th>Reason</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={11} style={{ textAlign:'center', color:'var(--text-muted)', padding:28 }}>
                {filter==='all' ? 'No requests yet — click "+ New Request" to raise one.' : `No ${filter} requests.`}
              </td></tr>
            )}
            {[...visible].sort((a,b)=>new Date(b.createdAt||b.created)-new Date(a.createdAt||a.created)).map(s => {
              const isMine = s.requesterId === currentUser;
              const reqShift = shiftOnDate(s.requesterId, s.reqDate);
              const tgtShift = s.targetId && s.tgtDate ? shiftOnDate(s.targetId, s.tgtDate) : '—';
              return (
                <tr key={s.id} style={{ background: s.urgent ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
                  {isManager && <td><input type="checkbox" checked={selected.has(s.id)} onChange={()=>toggleOne(s.id)} /></td>}
                  <td>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <Avatar user={uObj(s.requesterId)} size={22} />
                      <span style={{ fontSize:12 }}>{uName(s.requesterId)}</span>
                      {s.urgent && <span style={{ fontSize:10 }}>🔴</span>}
                    </div>
                  </td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12, color:'var(--accent)' }}>{s.reqDate}</td>
                  <td><Tag label={reqShift} type={reqShift==='daily'?'blue':reqShift==='weekend'?'purple':'gray'} /></td>
                  <td><Tag label={s.coverOnly||s.type==='cover'?'Cover Only':'Swap'} type={s.coverOnly||s.type==='cover'?'purple':'blue'} /></td>
                  <td>
                    {s.targetId
                      ? <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                          <Avatar user={uObj(s.targetId)} size={22} />
                          <span style={{ fontSize:12 }}>{uName(s.targetId)}</span>
                        </div>
                      : <span style={{ color:'var(--text-muted)', fontSize:12 }}>Any volunteer</span>}
                  </td>
                  <td style={{ fontFamily:'DM Mono', fontSize:12 }}>{s.tgtDate||'—'}</td>
                  <td><Tag label={tgtShift} type={tgtShift==='daily'?'blue':tgtShift==='weekend'?'purple':'gray'} /></td>
                  <td style={{ fontSize:11, color:'var(--text-muted)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.reason||'—'}</td>
                  <td>
                    <Tag label={s.status} type={s.status==='approved'?'green':s.status==='pending'?'amber':'red'} />
                    {s.managerNote && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>💬 {s.managerNote}</div>}
                  </td>
                  <td>
                    <div style={{ display:'flex', gap:4 }}>
                      {isManager && s.status==='pending' && <>
                        <button className="btn btn-success btn-sm" onClick={()=>approve(s.id)} title="Approve">✓</button>
                        <button className="btn btn-danger  btn-sm" onClick={()=>reject(s.id)}  title="Reject">✗</button>
                      </>}
                      {isManager && <>
                        <button className="btn btn-secondary btn-sm" onClick={e=>openEdit(s,e)}>✏</button>
                        <button className="btn btn-danger    btn-sm" onClick={e=>deleteOne(s.id,e)}>🗑</button>
                      </>}
                      {!isManager && isMine && s.status==='pending' && (
                        <button className="btn btn-danger btn-sm" onClick={()=>cancel(s.id)}>✕</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showNew && (
        <Modal title="+ New Swap / Cover Request" onClose={()=>setShowNew(false)}>
          <FormGroup label="Request Type">
            <div style={{ display:'flex', gap:8 }}>
              {[{val:'swap',label:'🔄 Shift Swap',desc:'Exchange shifts with another engineer'},{val:'cover',label:'🙋 Cover Request',desc:'Ask someone to cover — no swap needed'}].map(opt=>(
                <div key={opt.val} onClick={()=>setNewForm(f=>({...f,type:opt.val}))}
                  style={{ flex:1, padding:'10px 12px', borderRadius:8, cursor:'pointer',
                    border:`2px solid ${newForm.type===opt.val?'var(--accent)':'var(--border)'}`,
                    background:newForm.type===opt.val?'rgba(0,194,255,0.07)':'var(--bg-card2)' }}>
                  <div style={{ fontWeight:600, fontSize:13, color:newForm.type===opt.val?'var(--accent)':'var(--text-primary)' }}>{opt.label}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{opt.desc}</div>
                </div>
              ))}
            </div>
          </FormGroup>
          {isManager && (
            <FormGroup label="Requester (raising on behalf of)">
              <select className="select" value={newForm.requesterId} onChange={e=>setNewForm(f=>({...f,requesterId:e.target.value}))}>
                {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </FormGroup>
          )}
          <FormGroup label={newForm.type==='swap'?'Their Date to Swap Away':'Date Needing Cover'}>
            <input type="date" className="input" value={newForm.reqDate} onChange={e=>setNewForm(f=>({...f,reqDate:e.target.value}))} />
            {newForm.reqDate && newForm.requesterId && (
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
                Current shift: <strong style={{ color:'var(--accent)' }}>{shiftOnDate(newForm.requesterId, newForm.reqDate)}</strong>
              </div>
            )}
          </FormGroup>
          <FormGroup label={newForm.type==='swap'?'Swap With':'Preferred Cover Engineer (optional)'}>
            <select className="select" value={newForm.targetId} onChange={e=>setNewForm(f=>({...f,targetId:e.target.value}))}>
              <option value="">— Any volunteer —</option>
              {users.filter(u=>u.id!==newForm.requesterId).map(u=>(
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </FormGroup>
          {newForm.type==='swap' && newForm.targetId && (
            <FormGroup label="Their Date to Swap Back (leave blank for cover only)">
              <input type="date" className="input" value={newForm.tgtDate} onChange={e=>setNewForm(f=>({...f,tgtDate:e.target.value}))} />
              {newForm.tgtDate && newForm.targetId && (
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
                  {uName(newForm.targetId)}'s shift: <strong style={{ color:'var(--accent)' }}>{shiftOnDate(newForm.targetId, newForm.tgtDate)}</strong>
                </div>
              )}
            </FormGroup>
          )}
          <FormGroup label="Reason">
            <textarea className="textarea" rows={3} placeholder="Why are you requesting this?"
              value={newForm.reason} onChange={e=>setNewForm(f=>({...f,reason:e.target.value}))} style={{ minHeight:70 }} />
          </FormGroup>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer', marginBottom:14 }}>
            <input type="checkbox" checked={newForm.urgent} onChange={e=>setNewForm(f=>({...f,urgent:e.target.checked}))} />
            <span>🔴 Mark as urgent</span>
          </label>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button className="btn btn-secondary" onClick={()=>setShowNew(false)}>Cancel</button>
            <button className="btn btn-primary"
              disabled={!newForm.reqDate || (newForm.type==='swap' && !newForm.targetId)}
              onClick={submitRequest}>Submit Request</button>
          </div>
        </Modal>
      )}

      {editId && (
        <Modal title="Edit Swap Request" onClose={()=>setEditId(null)}>
          <FormGroup label="Status">
            <select className="select" value={editForm.status} onChange={e=>setEditForm({...editForm,status:e.target.value})}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </FormGroup>
          <FormGroup label="Reason"><input className="input" value={editForm.reason||''} onChange={e=>setEditForm({...editForm,reason:e.target.value})} /></FormGroup>
          <FormGroup label="Manager Note">
            <input className="input" placeholder="Optional note shown to engineer…"
              value={editForm.managerNote||''} onChange={e=>setEditForm({...editForm,managerNote:e.target.value})} />
          </FormGroup>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button className="btn btn-secondary" onClick={()=>setEditId(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEdit}>Update</button>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ── Stress Score (Manager only) ────────────────────────────────────────────
function StressScore({ users, timesheets, incidents, holidays, overtime, isManager }) {
  if (!isManager) return <Alert type="warning">⚠ Stress Score is restricted to managers.</Alert>;

  const safeInc = Array.isArray(incidents) ? incidents : [];
  const safeHols = Array.isArray(holidays) ? holidays : [];
  const safeOT  = Array.isArray(overtime)  ? overtime  : [];
  const today   = new Date().toISOString().slice(0, 10);
  // Rolling 90 days
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const scores = users.map(u => {
    const sheets = timesheets[u.id] || [];
    // Rolling 90-day timesheet entries (use weekStart if available)
    const recentSheets = sheets.filter(s => !s.weekStart || s.weekStart >= since90);
    const wd  = recentSheets.reduce((a, b) => a + (b.weekday_oncall || 0), 0);
    const we  = recentSheets.reduce((a, b) => a + (b.weekend_oncall || 0), 0);
    // Incidents in last 90 days
    const inc = safeInc.filter(i => i.assigned_to === u.id && (i.date || i.created_at || '') >= since90).length;
    // Open (unresolved) incidents — higher weight
    const openInc = safeInc.filter(i => i.assigned_to === u.id && i.status === 'Investigating').length;
    // Pending OT requests (stress indicator — unpaid hours awaiting approval)
    const pendingOT = safeOT.filter(o => o.userId === u.id && o.status === 'pending').length;
    // Holiday deficit: if user has taken < 5 days in last 90 days → indicator
    const holDays = safeHols.filter(h => h.userId === u.id && h.type === 'Annual Leave'
      && (h.start || '') >= since90).reduce((a, h) =>
        a + Math.ceil((new Date(h.end) - new Date(h.start)) / 86400000) + 1, 0);
    const holScore = Math.max(0, 5 - holDays) * 4; // 0–20 pts for not taking leave

    // Weighted score out of 100:
    // WD on-call hrs (90d): max 40h → 25pts
    // WE on-call hrs (90d): max 30h → 35pts
    // Recent incidents:     max 8   → 20pts
    // Open incidents:       max 3   → 15pts
    // Pending OT:           max 5   → 5pts (extra)
    const wdPts   = Math.min(25, (wd / 40) * 25);
    const wePts   = Math.min(35, (we / 30) * 35);
    const incPts  = Math.min(20, inc * 2.5);
    const openPts = Math.min(15, openInc * 5);
    const otPts   = Math.min(5, pendingOT);
    const score   = Math.round(wdPts + wePts + incPts + openPts + otPts + holScore);
    const capped  = Math.min(100, score);
    const level   = capped >= 70 ? 'High' : capped >= 40 ? 'Medium' : 'Low';
    return { user: u, wd, we, inc, openInc, pendingOT, holDays, score: capped, level };
  }).sort((a, b) => b.score - a.score);

  const COLOR = { High: '#ef4444', Medium: '#f59e0b', Low: '#10b981' };
  const highCount = scores.filter(s => s.level === 'High').length;

  return (
    <div>
      <PageHeader title="🧠 Stress Score" sub="Rolling 90-day wellbeing indicator — based on on-call hours, incidents, leave and overtime" />
      <Alert type="info" style={{ marginBottom: 16 }}>
        📊 Factors: weekday OC hours (25pts), weekend OC hours (35pts), recent incidents (20pts), open incidents (15pts), leave deficit (20pts). Updated live from timesheets.
      </Alert>
      {highCount > 0 && (
        <Alert type="warning" style={{ marginBottom: 16 }}>
          ⚠ {highCount} engineer{highCount > 1 ? 's are' : ' is'} in the High stress band. Consider redistributing on-call load or scheduling leave.
        </Alert>
      )}
      <div className="grid-4 mb-16">
        <StatCard label="High Risk"   value={scores.filter(s=>s.level==='High').length}   sub="Score ≥ 70"  accent="#ef4444" icon="🔴" />
        <StatCard label="Medium Risk" value={scores.filter(s=>s.level==='Medium').length} sub="Score 40–69" accent="#f59e0b" icon="🟡" />
        <StatCard label="Low Risk"    value={scores.filter(s=>s.level==='Low').length}    sub="Score < 40"  accent="#10b981" icon="🟢" />
        <StatCard label="Team Average" value={scores.length ? Math.round(scores.reduce((a,s)=>a+s.score,0)/scores.length) : 0} sub="/100" accent="#818cf8" icon="📊" />
      </div>
      {scores.map(s => (
        <div key={s.user.id} className="card mb-12">
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
            <Avatar user={s.user} size={40} />
            <div style={{ flex:1 }}>
              <div className="flex-between" style={{ marginBottom:6 }}>
                <div style={{ fontSize:14, fontWeight:600 }}>{s.user.name}</div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <Tag label={s.level} type={s.level==='High'?'red':s.level==='Medium'?'amber':'green'} />
                  <span style={{ fontFamily:'DM Mono', fontWeight:700, fontSize:18, color:COLOR[s.level] }}>{s.score}</span>
                  <span style={{ fontSize:11, color:'var(--text-muted)' }}>/100</span>
                </div>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width:s.score+'%', background:COLOR[s.level] }} />
              </div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginTop:8 }}>
            {[
              { label:'WD OC (90d)',  val:`${s.wd}h`,           color:'#93c5fd' },
              { label:'WE OC (90d)',  val:`${s.we}h`,           color:'#a78bfa' },
              { label:'Incidents',    val:s.inc,                 color:'#f59e0b' },
              { label:'Open Inc',     val:s.openInc,            color:s.openInc>0?'#ef4444':'var(--text-muted)' },
              { label:'Leave (90d)',  val:`${s.holDays}d`,      color:s.holDays<3?'#ef4444':'#10b981' },
            ].map(item => (
              <div key={item.label} style={{ background:'rgba(30,58,95,0.3)', borderRadius:6, padding:'6px 8px', textAlign:'center' }}>
                <div style={{ fontSize:9, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:3 }}>{item.label}</div>
                <div style={{ fontFamily:'DM Mono', fontWeight:700, fontSize:13, color:item.color }}>{item.val}</div>
              </div>
            ))}
          </div>
          {s.level==='High' && <Alert type="warning" style={{ marginTop:10 }}>⚠ Consider redistributing on-call load or arranging leave for {s.user.name.split(' ')[0]}.</Alert>}
          {s.pendingOT > 0 && <Alert type="info" style={{ marginTop:6 }}>⏳ {s.pendingOT} overtime request{s.pendingOT>1?'s':''} pending approval — may be working unpaid hours.</Alert>}
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
                       rotaForUser = {}, holidays = [], bankHolidays = [], startDs = null, endDs = null,
                       liveIncidentIds = null) {
  // liveIncidentIds: Set of incident IDs that still exist. If provided, INC timesheet
  // entries whose incident has been deleted are excluded from the calculation.

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
  // Only count entries whose incident still exists in the live incidents list.
  // IMPORTANT: these hours are tracked separately in incidentHrs and must NOT
  // also be added to workedWD/workedWE — doing so would double-count them in
  // workedPay and show e.g. 6h for a 3h incident.
  let incidentHrs = 0;
  (timesheetEntries || [])
    .filter(e => {
      if (!e.week || !e.week.startsWith('INC')) return false;
      const incId = e.week.slice(4).trim();
      if (liveIncidentIds && !liveIncidentIds.has(incId)) return false;
      return true;
    })
    .forEach(e => {
      // Sum all hour fields but deduplicate: worked_wd mirrors weekday_oncall, so
      // prefer worked_wd+worked_we when present, otherwise fall back to oncall fields.
      const hasWorked = (e.worked_wd || 0) + (e.worked_we || 0) > 0;
      const hrs = hasWorked
        ? (e.worked_wd || 0) + (e.worked_we || 0)
        : (e.weekday_oncall || 0) + (e.weekend_oncall || 0);
      incidentHrs += hrs;
      // Do NOT add to workedWD/workedWE — incident pay is charged via incidentHrs
    });

  const standbyPay  = (standbyWD + standbyWE + bhStandby) * ONCALL_STANDBY_RATE;
  const workedPay   = (workedWD + workedWE) * hourlyRate * ONCALL_WORKED_MULTIPLIER;
  const incidentPay = incidentHrs * hourlyRate * ONCALL_WORKED_MULTIPLIER;
  const upgradePay  = upgradeHrs * hourlyRate * ONCALL_WORKED_MULTIPLIER;
  const bankHolPay  = bhStandby * ONCALL_STANDBY_RATE;
  const totalOncallHours = standbyWD + workedWD + standbyWE + workedWE + incidentHrs + upgradeHrs + bhStandby;

  return {
    standbyWD: Math.round(standbyWD * 10) / 10,
    workedWD:  Math.round(workedWD  * 10) / 10,
    standbyWE: Math.round(standbyWE * 10) / 10,
    workedWE:  Math.round(workedWE  * 10) / 10,
    upgradeHrs, bankHolHrs,
    incidentHrs: Math.round(incidentHrs * 10) / 10,
    standbyPay, workedPay, incidentPay, upgradePay, bankHolPay,
    total: standbyPay + workedPay + incidentPay + upgradePay,
    totalOncallHours: Math.round(totalOncallHours * 10) / 10,
    totalStandbyHours: Math.round((standbyWD + standbyWE + bhStandby) * 10) / 10,
    totalWorkedHours:  Math.round((workedWD + workedWE + upgradeHrs) * 10) / 10,
  };
}

function calcTOILBalance(timesheetEntries, toilEntries, userId) {
  // Accrual: worked on-call hours beyond contracted hours → TOIL at 1:1 (UK WTR)
  const workedOC = (timesheetEntries || []).reduce((a, e) => a + (e.worked_wd||0) + (e.worked_we||0), 0);
  const autoToil = workedOC * TOIL_ACCRUAL_RATE;
  // Guard: toilEntries must be an array — it can be corrupted to a plain object if
  // the user-ID remap code ran on a previous version. Recover with Object.values().
  const safeEntries = Array.isArray(toilEntries) ? toilEntries : Object.values(toilEntries || {});
  const manualAccrued = safeEntries.filter(t => t.userId === userId && t.type === 'Accrued').reduce((a,t) => a + t.hours, 0);
  const used  = safeEntries.filter(t => t.userId === userId && t.type === 'Used').reduce((a,t) => a + t.hours, 0);
  const total = autoToil + manualAccrued;
  const balance = Math.min(total - used, TOIL_MAX_CARRYOVER_HOURS); // cap at WTR max carryover
  return { autoToil, manualAccrued, total, used, balance, workedOC, cappedAt: TOIL_MAX_CARRYOVER_HOURS };
}

// ── TOIL ──────────────────────────────────────────────────────────────────
// TOIL component moved to src/TOIL.js — imported at top of file

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
function Overtime({ users, overtime: overtimeProp, setOvertime, currentUser, isManager, driveToken }) {
  // Guard against overtime being undefined or non-array (e.g. loaded as object from corrupted Drive file)
  const overtime = Array.isArray(overtimeProp) ? overtimeProp : [];

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
function Notes({ obsidianNotes: notesProp, setObsidianNotes, users, currentUser, isManager }) {
  const obsidianNotes = Array.isArray(notesProp) ? notesProp : [];

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab,   setActiveTab]  = useState('personal');
  const [showModal,   setShowModal]  = useState(false);
  const [editId,      setEditId]     = useState(null);
  const [form,        setForm]       = useState({ title:'', content:'', type:'personal', tags:'' });
  const [search,      setSearch]     = useState('');
  const [viewNote,    setViewNote]   = useState(null);
  const [splitView,   setSplitView]  = useState(false);   // edit + preview side-by-side
  const [sidebarTab,  setSidebarTab] = useState('files'); // 'files' | 'tags' | 'backlinks'
  const [tagFilter,   setTagFilter]  = useState('');
  const importRef = useRef(null);

  // ── Filtered data ──────────────────────────────────────────────────────────
  const personalNotes = obsidianNotes.filter(n => n.type==='personal' && n.engineerId===currentUser);
  const sharedNotes   = obsidianNotes.filter(n => n.type==='shared');
  const visibleNotes  = activeTab==='personal' ? personalNotes : sharedNotes;
  const allTags = [...new Set(obsidianNotes.flatMap(n => (n.tags||'').split(',').map(t=>t.trim()).filter(Boolean)))].sort();
  const filtered = visibleNotes.filter(n => {
    const matchSearch = !search || n.title?.toLowerCase().includes(search.toLowerCase()) || (n.content||'').toLowerCase().includes(search.toLowerCase());
    const matchTag = !tagFilter || (n.tags||'').split(',').map(t=>t.trim()).includes(tagFilter);
    return matchSearch && matchTag;
  });

  // ── Word / char count ──────────────────────────────────────────────────────
  const wordCount = (html) => (html||'').replace(/<[^>]+>/g,'').trim().split(/\s+/).filter(Boolean).length;
  const charCount = (html) => (html||'').replace(/<[^>]+>/g,'').length;

  // ── Backlinks: notes that mention the current note title ──────────────────
  const backlinks = (note) => obsidianNotes.filter(n =>
    n.id !== note.id && (n.content||'').includes(note.title)
  );

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const openAdd = () => {
    setForm({ title:'', content:'', type: activeTab==='personal' ? 'personal' : 'shared', tags:'' });
    setEditId(null); setShowModal(true);
  };
  const openEdit = (note, e) => {
    e?.stopPropagation();
    if (note.engineerId !== currentUser && !isManager) { alert('You can only edit your own notes.'); return; }
    setForm({ title:note.title, content:note.content||'', type:note.type||'personal', tags:note.tags||'' });
    setEditId(note.id); setShowModal(true);
  };
  const save = () => {
    if (!form.title) return;
    if (editId) {
      setObsidianNotes(obsidianNotes.map(n => n.id===editId ? { ...n, ...form, updated:new Date().toISOString().slice(0,10) } : n));
    } else {
      setObsidianNotes([...obsidianNotes, { id:'note-'+Date.now(), engineerId:currentUser, ...form, created:new Date().toISOString().slice(0,10) }]);
    }
    setShowModal(false);
  };
  const deleteNote = (noteId, e) => {
    e?.stopPropagation();
    const note = obsidianNotes.find(n=>n.id===noteId);
    if (!note) return;
    if (note.engineerId !== currentUser && !isManager) { alert('You can only delete your own notes.'); return; }
    if (window.confirm('Delete this note?')) {
      setObsidianNotes(obsidianNotes.filter(n=>n.id!==noteId));
      if (viewNote === noteId) setViewNote(null);
    }
  };

  // ── Import .md / .txt ──────────────────────────────────────────────────────
  const handleImport = async (e) => {
    const files = Array.from(e.target.files||[]);
    const imported = [];
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      const text = await file.text();
      let content = text;
      if (ext==='md') {
        content = text
          .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
          .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
          .replace(/`(.+?)`/g,'<code>$1</code>').replace(/^- (.+)$/gm,'<li>$1</li>')
          .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');
        content = '<p>' + content + '</p>';
      }
      imported.push({ id:'note-'+Date.now()+Math.random(), engineerId:currentUser, title:file.name.replace(/\.(md|txt)$/,''),
        content, type:activeTab==='personal'?'personal':'shared', tags:'imported', created:new Date().toISOString().slice(0,10), sourceFile:file.name });
    }
    if (imported.length>0) setObsidianNotes([...obsidianNotes, ...imported]);
    e.target.value='';
  };

  // ── Export .md ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    filtered.forEach(note => {
      const text = (note.content||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      const blob = new Blob([`# ${note.title}\n\nTags: ${note.tags||''}\nCreated: ${note.created}\n\n${text}`], { type:'text/markdown' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `${note.title.replace(/[^a-z0-9]/gi,'_')}.md`; a.click();
    });
  };

  // ── Note detail / reading view (fullscreen) ───────────────────────────────
  if (viewNote) {
    const note = obsidianNotes.find(n=>n.id===viewNote);
    if (!note) { setViewNote(null); return null; }
    const canEdit = note.engineerId===currentUser || isManager;
    const author  = users.find(u=>u.id===note.engineerId);
    const bl = backlinks(note);
    const wc = wordCount(note.content); const cc = charCount(note.content);
    return (
      <div style={{ position:'fixed', inset:0, zIndex:600, background:'var(--bg)', display:'flex', flexDirection:'column' }}>
        {/* ── Top bar ── */}
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 20px',
          borderBottom:'1px solid var(--border)', background:'var(--bg-card)', flexShrink:0 }}>
          <button className="btn btn-secondary btn-sm" onClick={()=>setViewNote(null)}>← Back</button>
          {canEdit && <button className="btn btn-secondary btn-sm" onClick={e=>{openEdit(note,e);setViewNote(null);}}>✏ Edit</button>}
          {canEdit && <button className="btn btn-danger btn-sm" onClick={e=>deleteNote(note.id,e)}>🗑</button>}
          <div style={{ flex:1 }} />
          <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>{wc} words · {cc} chars</span>
          <Tag label={note.type==='personal'?'🔒 Personal':'🌐 Shared'} type={note.type==='personal'?'red':'green'} />
          <span style={{ fontSize:10, color:'var(--text-muted)' }}>Esc to go back</span>
          <button className="modal-close" onClick={()=>setViewNote(null)}>✕</button>
        </div>

        {/* ── Body (reading pane + backlinks) ── */}
        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
          {/* Reading pane */}
          <div style={{ flex:1, overflowY:'auto', padding:'40px 60px', maxWidth:900, margin:'0 auto', width:'100%' }}>
            <h1 style={{ fontFamily:'Syne,sans-serif', fontSize:30, fontWeight:800,
              color:'var(--text-primary)', marginBottom:14, letterSpacing:'-0.5px', lineHeight:1.2 }}>{note.title}</h1>
            {note.tags && (
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
                {note.tags.split(',').filter(Boolean).map(t=><Tag key={t} label={t.trim()} type="purple" />)}
              </div>
            )}
            {author && (
              <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:28, display:'flex', gap:14 }}>
                <span>✍️ {author.name}</span>
                <span>{note.updated ? `Updated ${note.updated}` : `Created ${note.created}`}</span>
              </div>
            )}
            <div style={{ fontSize:15, lineHeight:2, color:'var(--text-secondary)', fontFamily:'Georgia, serif' }}
              dangerouslySetInnerHTML={{ __html: note.content||'' }} />
          </div>

          {/* Backlinks sidebar */}
          {bl.length > 0 && (
            <div style={{ width:220, borderLeft:'1px solid var(--border)', background:'var(--sidebar-bg)',
              display:'flex', flexDirection:'column', overflow:'hidden', flexShrink:0 }}>
              <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--sidebar-border)',
                fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.5px' }}>
                🔗 Backlinks ({bl.length})
              </div>
              <div style={{ flex:1, overflowY:'auto', padding:'8px' }}>
                {bl.map(b=>(
                  <div key={b.id} onClick={()=>setViewNote(b.id)}
                    style={{ fontSize:12, color:'var(--accent)', cursor:'pointer', padding:'5px 6px',
                      borderRadius:5, marginBottom:2 }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(0,194,255,0.08)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    📄 {b.title}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main list view ─────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', gap:0, height:'calc(100vh - 160px)', minHeight:500,
      border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', background:'var(--bg-card)' }}>
      <input ref={importRef} type="file" multiple accept=".md,.txt" onChange={handleImport} style={{ display:'none' }} />

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div style={{ width:220, borderRight:'1px solid var(--sidebar-border)', background:'var(--sidebar-bg)',
        display:'flex', flexDirection:'column', overflow:'hidden', flexShrink:0 }}>

        {/* Vault header */}
        <div style={{ padding:'12px 12px 8px', borderBottom:'1px solid var(--sidebar-border)' }}>
          <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, fontSize:13,
            color:'var(--text-primary)', letterSpacing:'-0.2px', marginBottom:6 }}>📓 CloudOps Vault</div>
          <input className="input" placeholder="🔍 Search…" value={search}
            onChange={e=>setSearch(e.target.value)}
            style={{ fontSize:11, padding:'4px 8px', background:'rgba(255,255,255,0.05)' }} />
        </div>

        {/* Sidebar tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--sidebar-border)' }}>
          {[['files','📄'],['tags','🏷'],['backlinks','🔗']].map(([id,icon])=>(
            <button key={id} onClick={()=>setSidebarTab(id)}
              style={{ flex:1, padding:'6px 0', background:'transparent', border:'none', cursor:'pointer',
                fontSize:14, color:sidebarTab===id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom:`2px solid ${sidebarTab===id ? 'var(--accent)' : 'transparent'}` }}>
              {icon}
            </button>
          ))}
        </div>

        {/* Sidebar content */}
        <div style={{ flex:1, overflowY:'auto', padding:'6px' }}>
          {sidebarTab==='files' && (
            <>
              {/* Personal folder */}
              <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase',
                letterSpacing:'0.5px', padding:'8px 6px 4px', display:'flex', justifyContent:'space-between' }}>
                <span>🔒 Personal ({personalNotes.length})</span>
              </div>
              {personalNotes.filter(n=>!search||(n.title||'').toLowerCase().includes(search.toLowerCase())).map(n=>(
                <div key={n.id} onClick={()=>setViewNote(n.id)}
                  style={{ fontSize:12, padding:'4px 8px', borderRadius:5, cursor:'pointer',
                    color: viewNote===n.id ? 'var(--accent)' : 'var(--nav-text)',
                    background: viewNote===n.id ? 'var(--nav-active-bg)' : 'transparent',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:1 }}>
                  📄 {n.title}
                </div>
              ))}
              <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase',
                letterSpacing:'0.5px', padding:'10px 6px 4px' }}>
                🌐 Shared ({sharedNotes.length})
              </div>
              {sharedNotes.filter(n=>!search||(n.title||'').toLowerCase().includes(search.toLowerCase())).map(n=>(
                <div key={n.id} onClick={()=>setViewNote(n.id)}
                  style={{ fontSize:12, padding:'4px 8px', borderRadius:5, cursor:'pointer',
                    color: viewNote===n.id ? 'var(--accent)' : 'var(--nav-text)',
                    background: viewNote===n.id ? 'var(--nav-active-bg)' : 'transparent',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:1 }}>
                  📄 {n.title}
                </div>
              ))}
            </>
          )}
          {sidebarTab==='tags' && (
            <>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase',
                letterSpacing:'0.5px', padding:'8px 6px 6px' }}>All Tags</div>
              {allTags.length===0
                ? <div style={{ fontSize:11, color:'var(--text-muted)', padding:'4px 8px' }}>No tags yet</div>
                : allTags.map(tag=>{
                    const count = obsidianNotes.filter(n=>(n.tags||'').split(',').map(t=>t.trim()).includes(tag)).length;
                    return (
                      <div key={tag} onClick={()=>setTagFilter(tagFilter===tag ? '' : tag)}
                        style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                          fontSize:12, padding:'4px 8px', borderRadius:5, cursor:'pointer', marginBottom:1,
                          background: tagFilter===tag ? 'var(--nav-active-bg)' : 'transparent',
                          color: tagFilter===tag ? 'var(--accent)' : 'var(--nav-text)' }}>
                        <span>🏷 {tag}</span>
                        <span style={{ fontSize:10, fontFamily:'DM Mono', color:'var(--text-muted)' }}>{count}</span>
                      </div>
                    );
                  })}
            </>
          )}
          {sidebarTab==='backlinks' && (
            <div style={{ fontSize:11, color:'var(--text-muted)', padding:'8px 8px' }}>
              Open a note to see its backlinks
            </div>
          )}
        </div>

        {/* Sidebar footer stats */}
        <div style={{ padding:'8px 10px', borderTop:'1px solid var(--sidebar-border)',
          fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>
          {obsidianNotes.length} notes · {allTags.length} tags
        </div>
      </div>

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px',
          borderBottom:'1px solid var(--border)', background:'var(--bg-card2)', flexShrink:0, flexWrap:'wrap' }}>

          {/* Tab bar */}
          <div style={{ display:'flex', gap:0 }}>
            {[['personal','🔒 Personal'],['shared','🌐 Shared']].map(([id,label])=>(
              <button key={id} onClick={()=>{ setActiveTab(id); setTagFilter(''); }}
                style={{ padding:'5px 14px', border:'none', cursor:'pointer', fontSize:12, fontWeight:500,
                  background: activeTab===id ? 'var(--bg-card)' : 'transparent',
                  color: activeTab===id ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom:`2px solid ${activeTab===id ? 'var(--accent)' : 'transparent'}` }}>
                {label} ({(id==='personal'?personalNotes:sharedNotes).length})
              </button>
            ))}
          </div>
          <div style={{ flex:1 }} />
          {tagFilter && (
            <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:11,
              background:'rgba(168,85,247,0.1)', border:'1px solid rgba(168,85,247,0.3)',
              borderRadius:5, padding:'2px 8px', color:'#d8b4fe' }}>
              🏷 {tagFilter}
              <button onClick={()=>setTagFilter('')} style={{ background:'transparent', border:'none',
                cursor:'pointer', color:'#d8b4fe', fontSize:13, lineHeight:1 }}>✕</button>
            </div>
          )}
          <button className="btn btn-secondary btn-sm" onClick={()=>importRef.current?.click()}>📥 Import .md</button>
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={filtered.length===0}>📤 Export</button>
          <button className="btn btn-primary" onClick={openAdd}>+ New Note</button>
        </div>

        {/* Notes grid */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px' }}>
          {filtered.length===0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              height:'100%', color:'var(--text-muted)', textAlign:'center', gap:12 }}>
              <div style={{ fontSize:48 }}>📓</div>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:16 }}>
                {search || tagFilter ? 'No notes match your filter' : `No ${activeTab} notes yet`}
              </div>
              {!search && !tagFilter && <button className="btn btn-primary" onClick={openAdd}>+ Create your first note</button>}
            </div>
          ) : (
            <div className="grid-2">
              {filtered.map(note => {
                const author  = users.find(u=>u.id===note.engineerId);
                const canEdit = note.engineerId===currentUser || isManager;
                const preview = (note.content||'').replace(/<[^>]+>/g,'').slice(0,100);
                const wc = wordCount(note.content);
                return (
                  <div key={note.id} className="card card-sm" onClick={()=>setViewNote(note.id)}
                    style={{ cursor:'pointer' }}>
                    <div className="flex-between mb-8">
                      <div style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)', flex:1, paddingRight:8,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        📄 {note.title}
                      </div>
                      <div style={{ display:'flex', gap:4, flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                        {canEdit && <button className="btn btn-secondary btn-sm" onClick={e=>openEdit(note,e)}>✏</button>}
                        {canEdit && <button className="btn btn-danger btn-sm" onClick={e=>deleteNote(note.id,e)}>🗑</button>}
                      </div>
                    </div>
                    {note.tags && (
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
                        {note.tags.split(',').filter(Boolean).map(t=>(
                          <span key={t} onClick={e=>{e.stopPropagation();setTagFilter(t.trim());}}
                            className="tag tag-purple" style={{ cursor:'pointer' }}>
                            {t.trim()}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="muted-xs" style={{ lineHeight:1.5 }}>{preview}{preview.length>=100?'…':''}</div>
                    <div style={{ marginTop:8, display:'flex', justifyContent:'space-between',
                      fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>
                      <span>{note.type==='shared' && author ? `✍️ ${author.name.split(' ')[0]}` : ''}</span>
                      <span>{wc}w · {note.updated||note.created}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── New / Edit modal ──────────────────────────────────────────────── */}
      {showModal && (
        <Modal title={editId ? '✏ Edit Note' : '📄 New Note'} onClose={()=>setShowModal(false)} fullscreen>
          <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
              <FormGroup label="Title" style={{ gridColumn: '1 / 3' }}>
                <input className="input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}
                  placeholder="Note title…" autoFocus style={{ fontSize: 16, fontWeight: 600 }} />
              </FormGroup>
              <FormGroup label="Tags" hint="comma-separated">
                <input className="input" placeholder="e.g. runbook, incident, k8s"
                  value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})} />
              </FormGroup>
            </div>
            <FormGroup label="Visibility">
              <div style={{ display:'flex', gap:8, marginBottom: 14 }}>
                {[{val:'personal',label:'🔒 Personal',sub:'Only you'},{val:'shared',label:'🌐 Shared',sub:'Whole team'}].map(opt=>(
                  <div key={opt.val} onClick={()=>setForm({...form,type:opt.val})}
                    style={{ flex:1, padding:'10px 14px', borderRadius:8, cursor:'pointer',
                      border:`2px solid ${form.type===opt.val?'var(--accent)':'var(--border)'}`,
                      background:form.type===opt.val?'rgba(0,194,255,0.07)':'var(--bg-card2)' }}>
                    <div style={{ fontWeight:600, fontSize:13, color:form.type===opt.val?'var(--accent)':'var(--text-primary)' }}>{opt.label}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{opt.sub}</div>
                  </div>
                ))}
              </div>
            </FormGroup>
            <div style={{ flex: 1, minHeight: 0 }}>
              <RichEditor value={form.content} onChange={v=>setForm(f=>({...f,content:v}))}
                placeholder="Start writing… supports **bold**, *italic*, headings, tables, code blocks, callouts" fullPage />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'DM Mono' }}>
                {wordCount(form.content)} words · {charCount(form.content)} chars
              </span>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-secondary" onClick={()=>setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={!form.title}>
                  {editId ? 'Update Note' : 'Save Note'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Slack-style Team Chat ─────────────────────────────────────────────────
function WhatsAppChat({ whatsappChats, setWhatsappChats, users, currentUser, isManager, driveToken }) {
  /* ── Slack-style Team Chat ─────────────────────────────────────────────
     Data shape (stored in whatsappChats array):
     {
       id, type: 'channel'|'dm', name, topic?, members: [uid],
       createdBy, created, pinned: [msgId],
       messages: [{ id, sender, content, timestamp, edited?,
                    reactions: {emoji: [uid]}, thread: [{…same}], deleted? }]
     }
  ─────────────────────────────────────────────────────────────────────── */
  const [selectedChat,  setSelectedChat]  = useState(null);
  const [threadOpen,    setThreadOpen]    = useState(null);
  const [draft,         setDraft]         = useState('');
  const [threadDraft,   setThreadDraft]   = useState('');
  const [showNew,       setShowNew]       = useState(false);
  const [newForm,       setNewForm]       = useState({ type:'channel', name:'', topic:'', members:[] });
  const [search,        setSearch]        = useState('');
  const [editMsgId,     setEditMsgId]     = useState(null);
  const [editContent,   setEditContent]   = useState('');
  const [emojiPicker,   setEmojiPicker]   = useState(null);
  const [saveStatus,    setSaveStatus]    = useState('');
  const [loadingChats,  setLoadingChats]  = useState(false);
  const [showPinned,    setShowPinned]    = useState(false);
  const [onlineUsers,   setOnlineUsers]   = useState([currentUser]); // presence: uids seen recently
  const POLL_INTERVAL_MS   = 8000;   // poll Drive every 8 s for near-real-time
  const PRESENCE_WRITE_MS  = 60000;  // write heartbeat every 60 s
  const PRESENCE_ONLINE_MS = 180000; // online = seen within 3 min
  // ── Notification state ──────────────────────────────────────────────────
  const [toasts,        setToasts]        = useState([]);   // [{id,title,body,chatId}]
  const [notifPerm,     setNotifPerm]     = useState(typeof Notification !== 'undefined' ? Notification.permission : 'default');
  const [totalUnread,   setTotalUnread]   = useState(0);
  const seenMsgIds     = useRef(new Set());   // tracks which message IDs we've already notified
  const originalTitle  = useRef(document.title);
  const titleInterval  = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);

  const EMOJIS = ['👍','❤️','😂','🔥','✅','⚡','👀','🎉','😮','🙏','💡','⚠️'];

  // ── Request notification permission on mount ───────────────────────────
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(p => setNotifPerm(p));
    }
    // Seed seenMsgIds with all existing messages so we don't notify on first load
    whatsappChats.forEach(c => {
      (c.messages||[]).forEach(m => seenMsgIds.current.add(m.id));
      (c.messages||[]).forEach(m => (m.thread||[]).forEach(r => seenMsgIds.current.add(r.id)));
    });
    return () => {
      clearInterval(titleInterval.current);
      document.title = originalTitle.current;
    };
  }, []); // eslint-disable-line

  // ── Watch for new messages and fire notifications ──────────────────────
  useEffect(() => {
    let newUnread = 0;
    whatsappChats.forEach(chat => {
      const isMember = chat.members?.includes(currentUser) || chat.type === 'channel';
      if (!isMember) return;
      (chat.messages||[]).forEach(msg => {
        if (msg.sender === currentUser) return;  // don't notify own messages
        if (msg.deleted) return;
        if (seenMsgIds.current.has(msg.id)) {
          // Already known — count as unread only if not in active chat
          if (chat.id !== selectedChat) newUnread++;
          return;
        }
        // New message we haven't seen
        seenMsgIds.current.add(msg.id);
        if (chat.id === selectedChat) return;  // in view, no notification needed
        newUnread++;
        const senderName = users.find(u=>u.id===msg.sender)?.name || msg.sender;
        const channelName = chat.type === 'channel' ? `#${chat.name}` : senderName;
        const preview = (msg.content||'').replace(/<[^>]+>/g,'').slice(0,60);
        // Browser notification
        if (notifPerm === 'granted') {
          try {
            const n = new Notification(`${senderName} in ${channelName}`, {
              body: preview,
              icon: '/favicon.ico',
              tag: msg.id,
              silent: false,
            });
            n.onclick = () => { window.focus(); setSelectedChat(chat.id); n.close(); };
          } catch(e) { /* incognito or blocked */ }
        }
        // In-app toast
        const toastId = 'toast-' + msg.id;
        setToasts(prev => [...prev.slice(-4), { id:toastId, chatId:chat.id, channel:channelName, sender:senderName, body:preview }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toastId)), 6000);
      });
    });
    setTotalUnread(newUnread);
  }, [whatsappChats]); // eslint-disable-line

  // ── Flashing tab title when there are unread messages ─────────────────
  useEffect(() => {
    clearInterval(titleInterval.current);
    if (totalUnread > 0) {
      let flash = false;
      titleInterval.current = setInterval(() => {
        document.title = flash
          ? `(${totalUnread}) 💬 ${originalTitle.current}`
          : originalTitle.current;
        flash = !flash;
      }, 1500);
    } else {
      document.title = originalTitle.current;
    }
    return () => clearInterval(titleInterval.current);
  }, [totalUnread]);

  // ── Mark as read when switching to a chat ─────────────────────────────
  const selectChat = (chatId) => {
    setSelectedChat(chatId);
    setThreadOpen(null);
    setSearch('');
    // Mark all messages in this chat as seen
    const chat = whatsappChats.find(c=>c.id===chatId);
    if (chat) {
      (chat.messages||[]).forEach(m => {
        seenMsgIds.current.add(m.id);
        (m.thread||[]).forEach(r => seenMsgIds.current.add(r.id));
      });
    }
  };


  // ── Load from Drive on mount ────────────────────────────────────────────
  const lastRevRef = useRef(0);
  useEffect(() => {
    if (!driveToken) return;
    (async () => {
      setLoadingChats(true);
      try {
        const f = await driveFindFile(driveToken, 'whatsappChats.json');
        if (f) {
          const raw  = await driveReadJson(driveToken, f.id);
          const data = raw?.chats ?? (Array.isArray(raw) ? raw : null);
          const rev  = raw?._rev ?? 0;
          if (data && data.length > 0) {
            setWhatsappChats(data);
            lastRevRef.current = rev;
          }
        }
      } catch(e) { console.warn('Chat load:', e?.message); }
      finally { setLoadingChats(false); }
    })();
  }, [driveToken]); // eslint-disable-line

  // ── Write presence heartbeat to Drive ─────────────────────────────────────
  const writePresence = useCallback(async () => {
    if (!driveToken) return;
    try {
      const existing = await driveFindFile(driveToken, 'presence.json').catch(() => null);
      let presence = {};
      if (existing) {
        try { presence = await driveReadJson(driveToken, existing.id); } catch (_) {}
      }
      presence[currentUser] = new Date().toISOString();
      await driveWriteJson(driveToken, 'presence.json', presence);
      // Compute online users from all timestamps
      const now = Date.now();
      const online = Object.entries(presence)
        .filter(([, ts]) => now - new Date(ts).getTime() < PRESENCE_ONLINE_MS)
        .map(([uid]) => uid);
      setOnlineUsers(online.length > 0 ? online : [currentUser]);
    } catch (_) {}
  }, [driveToken, currentUser, PRESENCE_ONLINE_MS]);

  // Write presence on mount + every 60 s
  useEffect(() => {
    if (!driveToken) return;
    writePresence();
    const presenceTimer = setInterval(writePresence, PRESENCE_WRITE_MS);
    return () => clearInterval(presenceTimer);
  }, [driveToken, writePresence, PRESENCE_WRITE_MS]);

  // ── Poll Drive for new messages every 8 s (near-real-time) ────────────────
  useEffect(() => {
    if (!driveToken) return;
    const pollTimer = setInterval(async () => {
      try {
        const f = await driveFindFile(driveToken, 'whatsappChats.json');
        if (f) {
          const raw  = await driveReadJson(driveToken, f.id);
          const rev  = raw?._rev ?? 0;
          const data = raw?.chats ?? (Array.isArray(raw) ? raw : null);
          // Only update state if Drive has a newer revision — avoids unnecessary re-renders
          if (data && rev > lastRevRef.current) {
            lastRevRef.current = rev;
            setWhatsappChats(data);
          }
        }
        // Also read presence
        const pf = await driveFindFile(driveToken, 'presence.json').catch(() => null);
        if (pf) {
          const presence = await driveReadJson(driveToken, pf.id).catch(() => ({}));
          const now = Date.now();
          const online = Object.entries(presence)
            .filter(([, ts]) => now - new Date(ts).getTime() < PRESENCE_ONLINE_MS)
            .map(([uid]) => uid);
          setOnlineUsers(online.length > 0 ? online : [currentUser]);
        }
      } catch (_) {}
    }, POLL_INTERVAL_MS);
    return () => clearInterval(pollTimer);
  }, [driveToken, currentUser, POLL_INTERVAL_MS, PRESENCE_ONLINE_MS]);

  // Auto-select first channel
  useEffect(() => {
    if (!selectedChat && whatsappChats.length > 0)
      selectChat(whatsappChats[0].id);
  }, [whatsappChats.length]); // eslint-disable-line

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior:'smooth' });
  }, [selectedChat, (whatsappChats.find(c=>c.id===selectedChat)?.messages||[]).length]);

  // Persist to Drive after every change
  // _rev is a monotonic timestamp — pollers on other clients use it to detect stale state
  const persist = (next) => {
    const withRev = next.map ? next : next; // already an array
    const payload = { _rev: Date.now(), chats: Array.isArray(next) ? next : next.chats };
    setWhatsappChats(Array.isArray(next) ? next : next.chats);
    if (driveToken) {
      driveWriteJson(driveToken, 'whatsappChats.json', payload)
        .catch(e => console.warn('Chat save:', e));
    }
  };

  const status = (msg, ms=3500) => { setSaveStatus(msg); setTimeout(()=>setSaveStatus(''), ms); };

  // ── Channel / DM helpers ────────────────────────────────────────────────
  const channels = whatsappChats.filter(c => c.type==='channel');
  const dms       = whatsappChats.filter(c => c.type==='dm' && c.members.includes(currentUser));
  const current   = whatsappChats.find(c=>c.id===selectedChat);

  // unread count: messages since last visit (approximate — count since last seen)
  const unread = (chat) => (chat.messages||[]).filter(m => m.sender !== currentUser && !m.deleted).length;

  const createNew = () => {
    if (newForm.type==='channel' && !newForm.name.trim()) return;
    const id   = 'chat-' + Date.now();
    const chat = {
      id,
      type:      newForm.type,
      name:      newForm.type==='channel'
                   ? newForm.name.trim().toLowerCase().replace(/\s+/g,'-')
                   : users.find(u=>newForm.members[0]===u.id)?.name || 'DM',
      topic:     newForm.topic,
      createdBy: currentUser,
      created:   new Date().toISOString().slice(0,10),
      members:   [...new Set([...newForm.members, currentUser])],
      pinned:    [],
      messages:  [],
    };
    persist([...whatsappChats, chat]);
    setSelectedChat(id);
    setShowNew(false);
    setNewForm({ type:'channel', name:'', topic:'', members:[] });
  };

  // ── Message actions ─────────────────────────────────────────────────────
  const sendMsg = (isThread=false) => {
    const text = isThread ? threadDraft : draft;
    if (!text.trim() || !selectedChat) return;
    const msg = {
      id:        'msg-' + Date.now(),
      sender:    currentUser,
      content:   text.trim(),
      timestamp: new Date().toISOString(),
      reactions: {},
      thread:    [],
    };
    const next = whatsappChats.map(c => {
      if (c.id !== selectedChat) return c;
      if (isThread && threadOpen) {
        return { ...c, messages: c.messages.map(m =>
          m.id === threadOpen
            ? { ...m, thread: [...(m.thread||[]), msg] }
            : m
        )};
      }
      return { ...c, messages: [...(c.messages||[]), msg] };
    });
    persist(next);
    isThread ? setThreadDraft('') : setDraft('');
  };

  const deleteMsg = (msgId) => {
    if (!window.confirm('Delete this message?')) return;
    const next = whatsappChats.map(c =>
      c.id !== selectedChat ? c : {
        ...c,
        messages: c.messages.map(m =>
          m.id === msgId ? { ...m, deleted:true, content:'[message deleted]' } : m
        )
      }
    );
    persist(next);
  };

  const saveEdit = (msgId) => {
    if (!editContent.trim()) return;
    const next = whatsappChats.map(c =>
      c.id !== selectedChat ? c : {
        ...c,
        messages: c.messages.map(m =>
          m.id === msgId ? { ...m, content:editContent.trim(), edited:true } : m
        )
      }
    );
    persist(next);
    setEditMsgId(null);
  };

  const toggleReaction = (msgId, emoji) => {
    const next = whatsappChats.map(c => {
      if (c.id !== selectedChat) return c;
      return { ...c, messages: c.messages.map(m => {
        if (m.id !== msgId) return m;
        const reactions = { ...(m.reactions||{}) };
        const who = reactions[emoji] || [];
        reactions[emoji] = who.includes(currentUser)
          ? who.filter(u=>u!==currentUser)
          : [...who, currentUser];
        if (reactions[emoji].length === 0) delete reactions[emoji];
        return { ...m, reactions };
      })};
    });
    persist(next);
    setEmojiPicker(null);
  };

  const togglePin = (msgId) => {
    const next = whatsappChats.map(c => {
      if (c.id !== selectedChat) return c;
      const pinned = (c.pinned||[]).includes(msgId)
        ? c.pinned.filter(id=>id!==msgId)
        : [...(c.pinned||[]), msgId];
      return { ...c, pinned };
    });
    persist(next);
  };

  // ── Filtered messages for search ────────────────────────────────────────
  const visibleMsgs = (current?.messages||[]).filter(m =>
    !search || m.content?.toLowerCase().includes(search.toLowerCase())
  );

  const pinnedMsgs = (current?.messages||[]).filter(m =>
    (current?.pinned||[]).includes(m.id)
  );

  // ── Avatar/name helper ──────────────────────────────────────────────────
  const u = (uid) => users.find(x=>x.id===uid);
  const name = (uid) => u(uid)?.name || uid;

  // ── Render single message ───────────────────────────────────────────────
  const MsgBubble = ({ msg, inThread=false }) => {
    const sender    = u(msg.sender);
    const isOwn     = msg.sender === currentUser;
    const canEdit   = isOwn && !msg.deleted;
    const canDelete = (isOwn || isManager) && !msg.deleted;
    const isPinned  = (current?.pinned||[]).includes(msg.id);
    const threadCount = (msg.thread||[]).length;

    return (
      <div key={msg.id} style={{ display:'flex', gap:10, padding:'4px 0',
        background: isPinned ? 'rgba(0,194,255,0.04)' : 'transparent',
        borderLeft: isPinned ? '2px solid var(--accent)' : '2px solid transparent',
        paddingLeft: isPinned ? 8 : 0,
        opacity: msg.deleted ? 0.45 : 1 }}
        className="chat-msg">
        <Avatar user={sender||{avatar:'?',color:'#475569'}} size={32} style={{ flexShrink:0, marginTop:2 }} />
        <div style={{ flex:1, minWidth:0 }}>
          {/* Header row */}
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:2 }}>
            <span style={{ fontWeight:600, fontSize:13, color: isOwn ? 'var(--accent)' : 'var(--text-primary)' }}>
              {name(msg.sender)}
            </span>
            <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>
              {new Date(msg.timestamp).toLocaleString('en-GB',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
            </span>
            {msg.edited && <span style={{ fontSize:9, color:'var(--text-muted)' }}>(edited)</span>}
            {isPinned  && <span style={{ fontSize:9, color:'var(--accent)' }}>📌 pinned</span>}
          </div>

          {/* Content or edit input */}
          {editMsgId === msg.id ? (
            <div style={{ display:'flex', gap:6, marginBottom:4 }}>
              <input className="input" value={editContent}
                onChange={e=>setEditContent(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') saveEdit(msg.id); if(e.key==='Escape') setEditMsgId(null); }}
                style={{ flex:1, fontSize:13, padding:'4px 8px' }} autoFocus />
              <button className="btn btn-primary btn-sm" onClick={()=>saveEdit(msg.id)}>Save</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setEditMsgId(null)}>✕</button>
            </div>
          ) : (
            <div style={{ fontSize:13, color:'var(--text-primary)', lineHeight:1.5,
              wordBreak:'break-word', whiteSpace:'pre-wrap' }}>
              {(msg.content||'').split(/(@\w+)/g).map((part,i) =>
                part.startsWith('@')
                  ? <span key={i} style={{ color:'var(--accent)', fontWeight:600 }}>{part}</span>
                  : part
              )}
            </div>
          )}

          {/* Reactions row */}
          {Object.keys(msg.reactions||{}).length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:4 }}>
              {Object.entries(msg.reactions||{}).map(([emoji, who]) => (
                <button key={emoji} onClick={()=>toggleReaction(msg.id,emoji)}
                  style={{ display:'flex', alignItems:'center', gap:3, padding:'2px 7px',
                    borderRadius:12, border:'1px solid', fontSize:12, cursor:'pointer',
                    background: who.includes(currentUser) ? 'rgba(0,194,255,0.15)' : 'var(--bg-card2)',
                    borderColor: who.includes(currentUser) ? 'var(--accent)' : 'var(--border)',
                    color: who.includes(currentUser) ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  <span>{emoji}</span>
                  <span style={{ fontFamily:'DM Mono', fontSize:11 }}>{who.length}</span>
                </button>
              ))}
            </div>
          )}

          {/* Actions row: emoji, reply, edit, pin, delete */}
          {!msg.deleted && (
            <div className="chat-actions" style={{ display:'flex', gap:4, marginTop:4,
              opacity:0, transition:'opacity 0.15s' }}>
              <div style={{ position:'relative' }}>
                <button className="btn btn-secondary btn-sm" style={{ fontSize:11, padding:'2px 7px' }}
                  onClick={()=>setEmojiPicker(emojiPicker===msg.id ? null : msg.id)} title="React">😊</button>
                {emojiPicker===msg.id && (
                  <div style={{ position:'absolute', bottom:'100%', left:0, zIndex:200,
                    background:'var(--bg-card)', border:'1px solid var(--border)',
                    borderRadius:8, padding:6, display:'flex', flexWrap:'wrap', gap:3, width:180,
                    boxShadow:'0 8px 24px rgba(0,0,0,0.4)' }}>
                    {EMOJIS.map(e=>(
                      <button key={e} onClick={()=>toggleReaction(msg.id,e)}
                        style={{ fontSize:16, background:'transparent', border:'none', cursor:'pointer',
                          padding:'2px 3px', borderRadius:4, transition:'background 0.1s' }}
                        onMouseEnter={ev=>ev.target.style.background='rgba(255,255,255,0.1)'}
                        onMouseLeave={ev=>ev.target.style.background='transparent'}>
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!inThread && <button className="btn btn-secondary btn-sm" style={{ fontSize:11 }}
                onClick={()=>setThreadOpen(threadOpen===msg.id ? null : msg.id)} title="Reply in thread">
                💬{threadCount>0?` ${threadCount}`:''}
              </button>}
              {canEdit   && <button className="btn btn-secondary btn-sm" style={{ fontSize:11 }}
                onClick={()=>{ setEditMsgId(msg.id); setEditContent(msg.content); }} title="Edit">✏</button>}
              {isManager && <button className="btn btn-secondary btn-sm" style={{ fontSize:11 }}
                onClick={()=>togglePin(msg.id)} title={isPinned?'Unpin':'Pin'}>📌</button>}
              {canDelete && <button className="btn btn-danger btn-sm" style={{ fontSize:11 }}
                onClick={()=>deleteMsg(msg.id)} title="Delete">🗑</button>}
            </div>
          )}

          {/* Thread preview */}
          {!inThread && threadCount > 0 && threadOpen !== msg.id && (
            <button onClick={()=>setThreadOpen(msg.id)}
              style={{ marginTop:4, display:'flex', alignItems:'center', gap:6, fontSize:11,
                color:'var(--accent)', background:'rgba(0,194,255,0.06)', border:'1px solid rgba(0,194,255,0.15)',
                borderRadius:6, padding:'3px 10px', cursor:'pointer' }}>
              💬 {threadCount} {threadCount===1?'reply':'replies'} →
              <span style={{ color:'var(--text-muted)' }}>
                {[...new Set((msg.thread||[]).map(t=>name(t.sender)))].slice(0,3).join(', ')}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  };

  // ── Sidebar channel / DM row ────────────────────────────────────────────
  const SidebarRow = ({ chat }) => {
    const lastMsg   = (chat.messages||[]).filter(m=>!m.deleted).slice(-1)[0];
    const unreadCnt = (chat.messages||[]).filter(m =>
      m.sender !== currentUser && !m.deleted && !seenMsgIds.current.has(m.id)
    ).length;
    const isActive  = selectedChat === chat.id;
    const isDM      = chat.type === 'dm';
    const dmOther   = isDM ? chat.members.find(m=>m!==currentUser) : null;
    const dmUser    = dmOther ? u(dmOther) : null;

    return (
      <div onClick={()=>{ selectChat(chat.id); }}
        style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px',
          borderRadius:6, cursor:'pointer', marginBottom:1,
          background: isActive ? 'var(--nav-active-bg)' : 'transparent',
          color: isActive ? 'var(--accent)' : 'var(--nav-text)' }}>
        {isDM
          ? <Avatar user={dmUser||{avatar:'?',color:'#475569'}} size={20} />
          : <span style={{ fontSize:13, color:'var(--text-muted)', width:16, textAlign:'center' }}>#</span>}
        <span style={{ flex:1, fontSize:13, fontWeight: unreadCnt>0 ? 600 : 400,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {isDM ? (dmUser?.name || dmOther) : chat.name}
        </span>
        {unreadCnt > 0 && !isActive && (
          <span style={{ fontSize:9, fontFamily:'DM Mono', background:'var(--accent)',
            color:'#000', borderRadius:10, padding:'1px 5px', fontWeight:700 }}>
            {unreadCnt > 99 ? '99+' : unreadCnt}
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ position:'relative' }}>
      {/* ── In-app toast notifications ──────────────────────────────────── */}
      <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999,
        display:'flex', flexDirection:'column', gap:10, pointerEvents:'none' }}>
        {toasts.map(toast => (
          <div key={toast.id}
            onClick={()=>{ selectChat(toast.chatId); setToasts(prev=>prev.filter(t=>t.id!==toast.id)); }}
            className="cro-toast cro-toast-info"
            style={{ cursor:'pointer', pointerEvents:'all' }}>
            <div className="cro-toast-icon">💬</div>
            <div className="cro-toast-body">
              <div className="cro-toast-title">{toast.channel}</div>
              <div className="cro-toast-msg" style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:2 }}>
                {toast.sender}
              </div>
              <div className="cro-toast-msg">
                {toast.body}{toast.body.length >= 60 ? '…' : ''}
              </div>
              <div style={{ fontSize:9, color:'var(--text-muted)', marginTop:5, fontFamily:'DM Mono', letterSpacing:'0.5px' }}>
                TAP TO OPEN
              </div>
            </div>
          </div>
        ))}
      </div>

    <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:0,
      height:'calc(100vh - 160px)', minHeight:500, border:'1px solid var(--border)',
      borderRadius:12, overflow:'hidden', background:'var(--bg-card)' }}>

      {/* ── Left sidebar ───────────────────────────────────────────────── */}
      <div style={{ background:'var(--sidebar-bg)', borderRight:'1px solid var(--sidebar-border)',
        display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Workspace header */}
        <div style={{ padding:'14px 12px 10px', borderBottom:'1px solid var(--sidebar-border)' }}>
          <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, fontSize:14,
            color:'var(--text-primary)', letterSpacing:'-0.3px' }}>☁ CloudOps</div>
          <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono',
            display:'flex', alignItems:'center', gap:4, marginTop:2 }}>
            <div className="dot-live" style={{ width:6, height:6 }} />
            {onlineUsers.length} {onlineUsers.length === 1 ? 'member' : 'members'} online
            <span style={{ opacity:0.5, marginLeft:2 }}>· live</span>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding:'8px 10px', borderBottom:'1px solid var(--sidebar-border)' }}>
          <input className="input" placeholder="🔍 Search messages…" value={search}
            onChange={e=>setSearch(e.target.value)}
            style={{ fontSize:11, padding:'5px 8px', background:'rgba(255,255,255,0.05)' }} />
        </div>

        {/* Channels */}
        <div style={{ flex:1, overflowY:'auto', padding:'8px 6px' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)',
            textTransform:'uppercase', letterSpacing:'0.8px', padding:'4px 6px 6px',
            display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span>Channels</span>
            {isManager && <button onClick={()=>{setShowNew(true);setNewForm({type:'channel',name:'',topic:'',members:users.map(u=>u.id)});}}
              style={{ background:'transparent', border:'none', color:'var(--text-muted)',
                cursor:'pointer', fontSize:14, lineHeight:1 }} title="New channel">+</button>}
          </div>
          {channels.map(c => <SidebarRow key={c.id} chat={c} />)}

          <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)',
            textTransform:'uppercase', letterSpacing:'0.8px', padding:'12px 6px 6px',
            display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span>Direct Messages</span>
            <button onClick={()=>{setShowNew(true);setNewForm({type:'dm',name:'',topic:'',members:[]});}}
              style={{ background:'transparent', border:'none', color:'var(--text-muted)',
                cursor:'pointer', fontSize:14, lineHeight:1 }} title="New DM">+</button>
          </div>
          {dms.map(c => <SidebarRow key={c.id} chat={c} />)}
          {dms.length === 0 && (
            <div style={{ fontSize:11, color:'var(--text-muted)', padding:'4px 8px' }}>No DMs yet</div>
          )}
        </div>

        {/* Drive + notifications status */}
        <div style={{ padding:'8px 10px', borderTop:'1px solid var(--sidebar-border)', flexShrink:0 }}>
          <div style={{ fontSize:10, color: driveToken ? '#6ee7b7' : 'var(--text-muted)',
            display:'flex', alignItems:'center', gap:5, fontFamily:'DM Mono', marginBottom:5 }}>
            <div style={{ width:5, height:5, borderRadius:'50%',
              background: driveToken?'#22c55e':'#6b7280', flexShrink:0 }} />
            {driveToken ? 'Auto-saving to Drive' : 'Drive offline'}
          </div>
          {notifPerm === 'default' && (
            <button onClick={()=>Notification.requestPermission().then(p=>setNotifPerm(p))}
              style={{ width:'100%', padding:'4px 8px', fontSize:10, background:'rgba(0,194,255,0.08)',
                border:'1px solid rgba(0,194,255,0.2)', borderRadius:5, cursor:'pointer',
                color:'var(--accent)', fontFamily:'DM Mono' }}>
              🔔 Enable notifications
            </button>
          )}
          {notifPerm === 'granted' && (
            <div style={{ fontSize:10, color:'#6ee7b7', fontFamily:'DM Mono',
              display:'flex', alignItems:'center', gap:4 }}>
              🔔 Notifications on
              {totalUnread > 0 && <span style={{ background:'#ef4444', color:'#fff',
                borderRadius:10, padding:'0 5px', fontSize:9, fontWeight:700 }}>
                {totalUnread}
              </span>}
            </div>
          )}
          {notifPerm === 'denied' && (
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>
              🔕 Notifications blocked in browser
            </div>
          )}
        </div>
      </div>

      {/* ── Main area ──────────────────────────────────────────────────── */}
      {current ? (
        <div style={{ display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--bg)' }}>

          {/* Channel header */}
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)',
            display:'flex', alignItems:'center', gap:12, flexShrink:0,
            background:'var(--bg-card)', minHeight:52 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:14, color:'var(--text-primary)' }}>
                {current.type==='channel' ? `#${current.name}` : `@ ${current.name}`}
              </div>
              {current.topic && <div style={{ fontSize:11, color:'var(--text-muted)',
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {current.topic}
              </div>}
              <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>
                {current.members.length} members ·&nbsp;
                {current.members.map(id=>name(id).split(' ')[0]).join(', ')}
              </div>
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              {saveStatus && <span style={{ fontSize:10, fontFamily:'DM Mono',
                color: saveStatus.startsWith('✅')?'#6ee7b7':saveStatus.startsWith('❌')?'#fca5a5':'var(--accent)' }}>
                {saveStatus}
              </span>}
              <button className="btn btn-secondary btn-sm" style={{ fontSize:11 }}
                onClick={()=>setShowPinned(v=>!v)} title="Pinned messages">
                📌 {(current.pinned||[]).length}
              </button>
              {isManager && <button className="btn btn-danger btn-sm" style={{ fontSize:11 }}
                onClick={()=>{ if(window.confirm('Delete this channel?'))
                  persist(whatsappChats.filter(c=>c.id!==selectedChat)); setSelectedChat(null); }}>
                🗑
              </button>}
            </div>
          </div>

          {/* Pinned panel */}
          {showPinned && pinnedMsgs.length > 0 && (
            <div style={{ padding:'8px 16px', background:'rgba(0,194,255,0.05)',
              borderBottom:'1px solid rgba(0,194,255,0.15)', maxHeight:140, overflowY:'auto' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--accent)',
                textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:6 }}>
                📌 Pinned Messages
              </div>
              {pinnedMsgs.map(m=>(
                <div key={m.id} style={{ fontSize:12, color:'var(--text-secondary)',
                  padding:'3px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                  <strong>{name(m.sender)}</strong>: {m.content?.slice(0,80)}{m.content?.length>80?'…':''}
                </div>
              ))}
            </div>
          )}

          {/* Main messages + optional thread panel */}
          <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

            {/* Messages list */}
            <div style={{ flex:1, overflowY:'auto', padding:'12px 16px',
              display:'flex', flexDirection:'column', gap:2 }}>
              {visibleMsgs.length === 0 && (
                <div style={{ margin:'auto', textAlign:'center', color:'var(--text-muted)' }}>
                  <div style={{ fontSize:36, marginBottom:8 }}>
                    {current.type==='channel' ? '#️⃣' : '💬'}
                  </div>
                  {search
                    ? `No messages match "${search}"`
                    : `This is the start of #${current.name}`}
                </div>
              )}
              {visibleMsgs.map(msg => <MsgBubble key={msg.id} msg={msg} />)}
              <div ref={messagesEndRef} />
            </div>

            {/* Thread panel */}
            {threadOpen && (() => {
              const parent = (current.messages||[]).find(m=>m.id===threadOpen);
              if (!parent) return null;
              return (
                <div style={{ width:320, borderLeft:'1px solid var(--border)',
                  display:'flex', flexDirection:'column', background:'var(--bg-card)',
                  overflow:'hidden', flexShrink:0 }}>
                  <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)',
                    display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontWeight:700, fontSize:13, color:'var(--text-primary)' }}>💬 Thread</span>
                    <button onClick={()=>setThreadOpen(null)}
                      style={{ background:'transparent', border:'none', color:'var(--text-muted)',
                        cursor:'pointer', fontSize:16 }}>✕</button>
                  </div>
                  {/* Parent msg */}
                  <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)',
                    background:'rgba(0,194,255,0.03)' }}>
                    <MsgBubble msg={parent} inThread={true} />
                  </div>
                  {/* Thread replies */}
                  <div style={{ flex:1, overflowY:'auto', padding:'8px 14px', display:'flex',
                    flexDirection:'column', gap:6 }}>
                    {(parent.thread||[]).length === 0
                      ? <div style={{ color:'var(--text-muted)', fontSize:12, margin:'auto' }}>No replies yet</div>
                      : (parent.thread||[]).map(r => <MsgBubble key={r.id} msg={r} inThread={true} />)}
                  </div>
                  {/* Thread input */}
                  <div style={{ padding:'10px 14px', borderTop:'1px solid var(--border)' }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <input ref={inputRef} className="input" placeholder="Reply…"
                        value={threadDraft} onChange={e=>setThreadDraft(e.target.value)}
                        onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendMsg(true)}
                        style={{ flex:1, fontSize:12, padding:'6px 10px' }} />
                      <button className="btn btn-primary btn-sm"
                        onClick={()=>sendMsg(true)} disabled={!threadDraft.trim()}>↵</button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Main input bar */}
          <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)',
            background:'var(--bg-card)', flexShrink:0 }}>
            {/* @mention autocomplete (simplified) */}
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              <Avatar user={u(currentUser)||{avatar:'?',color:'#475569'}} size={28} style={{ flexShrink:0 }} />
              <div style={{ flex:1, position:'relative' }}>
                <textarea className="textarea"
                  placeholder={`Message ${current.type==='channel'?`#${current.name}`:name(current.members.find(m=>m!==currentUser)||'')} — @ to mention`}
                  value={draft} onChange={e=>setDraft(e.target.value)}
                  onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMsg(); }}}
                  style={{ minHeight:40, maxHeight:120, resize:'none', fontSize:13, padding:'8px 12px',
                    lineHeight:1.5, paddingRight:90 }} />
                <div style={{ position:'absolute', right:8, bottom:8, display:'flex', gap:4 }}>
                  {/* Quick emoji insert */}
                  {['👍','🔥','✅'].map(e=>(
                    <button key={e} onClick={()=>setDraft(d=>d+e)}
                      style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:14 }}>{e}</button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" onClick={()=>sendMsg()} disabled={!draft.trim()}
                style={{ padding:'8px 16px', flexShrink:0 }}>
                Send ↵
              </button>
            </div>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4, paddingLeft:36 }}>
              <kbd style={{ background:'rgba(255,255,255,0.08)', borderRadius:3, padding:'1px 4px', fontSize:9 }}>Enter</kbd> to send · <kbd style={{ background:'rgba(255,255,255,0.08)', borderRadius:3, padding:'1px 4px', fontSize:9 }}>Shift+Enter</kbd> for new line · <kbd style={{ background:'rgba(255,255,255,0.08)', borderRadius:3, padding:'1px 4px', fontSize:9 }}>@</kbd> to mention
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
          color:'var(--text-muted)', flexDirection:'column', gap:12 }}>
          <div style={{ fontSize:48 }}>☁</div>
          <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:16 }}>CloudOps Chat</div>
          <div style={{ fontSize:13 }}>Select a channel or start a DM</div>
          {isManager && <button className="btn btn-primary"
            onClick={()=>setShowNew(true)}>+ Create Channel</button>}
        </div>
      )}

      {/* ── New channel / DM modal ───────────────────────────────────── */}
      {showNew && (
        <Modal title={newForm.type==='channel' ? '# New Channel' : '💬 New Direct Message'}
          onClose={()=>setShowNew(false)}>
          <FormGroup label="Type">
            <div style={{ display:'flex', gap:8 }}>
              {['channel','dm'].map(t=>(
                <button key={t} className={`btn ${newForm.type===t?'btn-primary':'btn-secondary'}`}
                  onClick={()=>setNewForm(f=>({...f,type:t}))}>
                  {t==='channel'?'# Channel':'💬 Direct Message'}
                </button>
              ))}
            </div>
          </FormGroup>
          {newForm.type==='channel' && <>
            <FormGroup label="Channel Name">
              <input className="input" placeholder="e.g. incidents-live"
                value={newForm.name} onChange={e=>setNewForm(f=>({...f,name:e.target.value}))} />
            </FormGroup>
            <FormGroup label="Topic (optional)">
              <input className="input" placeholder="What's this channel for?"
                value={newForm.topic} onChange={e=>setNewForm(f=>({...f,topic:e.target.value}))} />
            </FormGroup>
            <FormGroup label="Members">
              <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:180, overflowY:'auto' }}>
                {users.map(uu=>(
                  <label key={uu.id} style={{ display:'flex', alignItems:'center', gap:8,
                    padding:'5px 6px', cursor:'pointer', borderRadius:6 }}>
                    <input type="checkbox"
                      checked={newForm.members.includes(uu.id)}
                      onChange={e=>setNewForm(f=>({...f, members:
                        e.target.checked ? [...f.members,uu.id] : f.members.filter(id=>id!==uu.id)}))} />
                    <Avatar user={uu} size={22} />
                    <span style={{ fontSize:13 }}>{uu.name}</span>
                  </label>
                ))}
              </div>
            </FormGroup>
          </>}
          {newForm.type==='dm' && (
            <FormGroup label="Send to">
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {users.filter(uu=>uu.id!==currentUser).map(uu=>(
                  <label key={uu.id} style={{ display:'flex', alignItems:'center', gap:8,
                    padding:'5px 6px', cursor:'pointer', borderRadius:6 }}>
                    <input type="radio" name="dm-target"
                      checked={newForm.members[0]===uu.id}
                      onChange={()=>setNewForm(f=>({...f,members:[uu.id]}))} />
                    <Avatar user={uu} size={22} />
                    <span style={{ fontSize:13 }}>{uu.name}</span>
                  </label>
                ))}
              </div>
            </FormGroup>
          )}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button className="btn btn-secondary" onClick={()=>setShowNew(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={createNew}
              disabled={newForm.type==='channel' ? !newForm.name.trim() : newForm.members.length===0}>
              {newForm.type==='channel' ? 'Create Channel' : 'Start DM'}
            </button>
          </div>
        </Modal>
      )}
    </div>
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
    const liveIds = new Set((incidents||[]).map(i=>i.id));
    const incHrs = sheets.filter(e=>e.week&&e.week.startsWith('INC')&&liveIds.has(e.week.slice(4).trim())).reduce((a,e)=>a+(e.weekday_oncall||0)+(e.weekend_oncall||0),0);
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

// ── PayrollReports ─────────────────────────────────────────────────────────
function PayrollReports({ users, timesheets, incidents, upgrades, overtime, toil, rota, holidays,
                          payconfig, allCycles, cycleStart, cycleEnd, getUserData, fmtD }) {

  const [view,          setView]          = React.useState('overview');
  const [selCycleStart, setSelCycleStart] = React.useState(cycleStart);
  const [selCycleEnd,   setSelCycleEnd]   = React.useState(cycleEnd);
  const [engFilter,     setEngFilter]     = React.useState('all');
  const [chartLoaded,   setChartLoaded]   = React.useState(false);
  const chartRefs = React.useRef({});

  React.useEffect(() => {
    if (window.Chart) { setChartLoaded(true); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    s.onload = () => setChartLoaded(true);
    document.head.appendChild(s);
  }, []);

  const visUsers  = engFilter === 'all' ? users : users.filter(u => u.id === engFilter);

  const cycleData = React.useMemo(() => visUsers.map(u => ({ u, ...getUserData(u, selCycleStart, selCycleEnd) })),
    [visUsers, selCycleStart, selCycleEnd, getUserData]);

  const totals = React.useMemo(() => ({
    standbyWD: cycleData.reduce((a,r)=>a+(r.oc.standbyWD||0),0),
    workedWD:  cycleData.reduce((a,r)=>a+(r.oc.workedWD||0),0),
    standbyWE: cycleData.reduce((a,r)=>a+(r.oc.standbyWE||0),0),
    workedWE:  cycleData.reduce((a,r)=>a+(r.oc.workedWE||0),0),
    incidents: cycleData.reduce((a,r)=>a+(r.incHrs||0),0),
    upgrades:  cycleData.reduce((a,r)=>a+(r.upgradeHrs||0),0),
    bankHol:   cycleData.reduce((a,r)=>a+(r.bankHolHrs||0),0),
    overtime:  cycleData.reduce((a,r)=>a+(r.overtimeHrs||0),0),
    toil:      cycleData.reduce((a,r)=>a+(r.tb?.balance||0),0),
  }), [cycleData]);

  const totalHrs = totals.standbyWD+totals.workedWD+totals.standbyWE+totals.workedWE+totals.incidents+totals.upgrades+totals.bankHol+totals.overtime;

  const trendCycles = React.useMemo(() => allCycles.slice(0,4).reverse(), [allCycles]);
  const trendData   = React.useMemo(() => trendCycles.map(c => {
    const rows = users.map(u => getUserData(u, c.start, c.end));
    return {
      label:     c.label.split(' (')[0],
      standby:   rows.reduce((a,r)=>a+(r.oc.standbyWD||0)+(r.oc.standbyWE||0)+(r.bankHolHrs||0),0),
      incidents: rows.reduce((a,r)=>a+(r.incHrs||0),0),
      overtime:  rows.reduce((a,r)=>a+(r.overtimeHrs||0),0),
      upgrades:  rows.reduce((a,r)=>a+(r.upgradeHrs||0),0),
    };
  }), [trendCycles, users, getUserData]);

  const mkChart = React.useCallback((id, config) => {
    if (!window.Chart) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (chartRefs.current[id]) { try { chartRefs.current[id].destroy(); } catch(e){} }
    chartRefs.current[id] = new window.Chart(el, config);
  }, []);

  React.useEffect(() => {
    if (!chartLoaded) return;
    const grid = 'rgba(148,163,184,0.1)';
    const tick = '#64748b';
    const base = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: ctx=>`${ctx.raw}h` } } } };

    if (view === 'overview') {
      mkChart('rpt-mix',{ type:'doughnut',
        data:{ labels:['Standby WD','Worked WD','Standby WE','Worked WE','Incidents','Upgrades','Bank Hol','Overtime'],
          datasets:[{ data:[totals.standbyWD,totals.workedWD,totals.standbyWE,totals.workedWE,totals.incidents,totals.upgrades,totals.bankHol,totals.overtime],
            backgroundColor:['#93C5FD','#60A5FA','#A78BFA','#818CF8','#FCD34D','#6EE7B7','#FCA5A5','#F472B6'], borderWidth:0 }] },
        options:{ ...base, cutout:'60%', plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:ctx=>`${ctx.label}: ${ctx.raw}h` } } } } });

      mkChart('rpt-eng',{ type:'bar',
        data:{ labels:cycleData.map(r=>r.u.name.split(' ')[0]),
          datasets:[{ data:cycleData.map(r=>Math.round(((r.oc.standbyWD||0)+(r.oc.workedWD||0)+(r.oc.standbyWE||0)+(r.oc.workedWE||0)+(r.incHrs||0)+(r.upgradeHrs||0)+(r.bankHolHrs||0)+(r.overtimeHrs||0))*10)/10),
            backgroundColor:cycleData.map(r=>r.u.color||'#378ADD'), borderRadius:4, borderWidth:0 }] },
        options:{ ...base, indexAxis:'y', scales:{ x:{ grid:{ color:grid }, ticks:{ color:tick, font:{ size:11 } } }, y:{ grid:{ display:false }, ticks:{ color:tick, font:{ size:11 } } } } } });

      mkChart('rpt-stack',{ type:'bar',
        data:{ labels:cycleData.map(r=>r.u.name.split(' ').map((w,i)=>i===0?w:w[0]+'.').join(' ')),
          datasets:[
            { label:'Standby WD', data:cycleData.map(r=>r.oc.standbyWD||0), backgroundColor:'#93C5FD', borderWidth:0 },
            { label:'Standby WE', data:cycleData.map(r=>r.oc.standbyWE||0), backgroundColor:'#A78BFA', borderWidth:0 },
            { label:'Worked WD',  data:cycleData.map(r=>r.oc.workedWD||0),  backgroundColor:'#60A5FA', borderWidth:0 },
            { label:'Incidents',  data:cycleData.map(r=>r.incHrs||0),        backgroundColor:'#FCD34D', borderWidth:0 },
            { label:'Overtime',   data:cycleData.map(r=>r.overtimeHrs||0),   backgroundColor:'#F472B6', borderWidth:0 },
            { label:'Upgrades',   data:cycleData.map(r=>r.upgradeHrs||0),    backgroundColor:'#6EE7B7', borderWidth:0 },
            { label:'Bank Hol',   data:cycleData.map(r=>r.bankHolHrs||0),    backgroundColor:'#FCA5A5', borderWidth:0 },
          ] },
        options:{ ...base, indexAxis:'y',
          plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:ctx=>`${ctx.dataset.label}: ${ctx.raw}h` } } },
          scales:{ x:{ stacked:true, grid:{ color:grid }, ticks:{ color:tick, font:{ size:11 } } }, y:{ stacked:true, grid:{ display:false }, ticks:{ color:tick, font:{ size:11 } } } } } });
    }

    if (view === 'trend') {
      mkChart('rpt-trend',{ type:'line',
        data:{ labels:trendData.map(d=>d.label),
          datasets:[
            { label:'Standby',   data:trendData.map(d=>d.standby),   borderColor:'#93C5FD', backgroundColor:'rgba(147,197,253,.1)', fill:true,  tension:.35, borderWidth:2, pointRadius:4 },
            { label:'Incidents', data:trendData.map(d=>d.incidents),  borderColor:'#FCD34D', borderDash:[5,4], fill:false, tension:.35, borderWidth:2, pointRadius:4 },
            { label:'Overtime',  data:trendData.map(d=>d.overtime),   borderColor:'#F472B6', fill:false, tension:.35, borderWidth:2, pointRadius:4 },
            { label:'Upgrades',  data:trendData.map(d=>d.upgrades),   borderColor:'#6EE7B7', fill:false, tension:.35, borderWidth:2, pointRadius:4 },
          ] },
        options:{ ...base, scales:{ x:{ grid:{ color:grid }, ticks:{ color:tick } }, y:{ grid:{ color:grid }, ticks:{ color:tick, callback:v=>v+'h' } } } } });

      mkChart('rpt-eng-trend',{ type:'line',
        data:{ labels:trendData.map(d=>d.label),
          datasets:users.map(u=>({
            label:u.name.split(' ')[0],
            data:trendCycles.map(c=>{ const d=getUserData(u,c.start,c.end); return Math.round(((d.oc.standbyWD||0)+(d.oc.standbyWE||0)+(d.incHrs||0)+(d.overtimeHrs||0))*10)/10; }),
            borderColor:u.color||'#94a3b8', fill:false, tension:.35, borderWidth:1.5, pointRadius:3,
          })) },
        options:{ ...base, scales:{ x:{ grid:{ color:grid }, ticks:{ color:tick } }, y:{ grid:{ color:grid }, ticks:{ color:tick, callback:v=>v+'h' } } } } });
    }

    if (view === 'incidents') {
      const fi = engFilter==='all' ? (Array.isArray(incidents)?incidents:[]) : (Array.isArray(incidents)?incidents:[]).filter(i=>i.assigned_to===engFilter);
      const bySev = {};
      fi.forEach(i=>{ bySev[i.severity||'Unknown']=(bySev[i.severity||'Unknown']||0)+1; });
      const sevKeys   = Object.keys(bySev);
      const sevColors = { Disaster:'#D85A30', Critical:'#BA7517', High:'#378ADD', Medium:'#1D9E75', Low:'#888780', Unknown:'#888780' };
      mkChart('rpt-inc-sev',{ type:'doughnut',
        data:{ labels:sevKeys, datasets:[{ data:sevKeys.map(k=>bySev[k]), backgroundColor:sevKeys.map(k=>sevColors[k]||'#888780'), borderWidth:0 }] },
        options:{ ...base, cutout:'55%', plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:ctx=>`${ctx.label}: ${ctx.raw}` } } } } });
      mkChart('rpt-inc-eng',{ type:'bar',
        data:{ labels:users.map(u=>u.name.split(' ')[0]),
          datasets:[{ data:users.map(u=>fi.filter(i=>i.assigned_to===u.id).length), backgroundColor:users.map(u=>u.color||'#378ADD'), borderRadius:4, borderWidth:0 }] },
        options:{ ...base, indexAxis:'y', scales:{ x:{ grid:{ color:grid }, ticks:{ color:tick, stepSize:1 } }, y:{ grid:{ display:false }, ticks:{ color:tick } } } } });
    }
  }, [chartLoaded, view, cycleData, totals, trendData, trendCycles, users, engFilter, incidents, mkChart, getUserData]);

  const fmt = n => Math.round((n||0)*10)/10;
  const SEV_PILL = { Disaster:['rgba(216,90,48,0.2)','#fca5a5'], Critical:['rgba(186,117,23,0.2)','#fcd34d'], High:['rgba(55,138,221,0.2)','#93c5fd'], Medium:['rgba(29,158,117,0.2)','#6ee7b7'], Low:['rgba(136,135,128,0.2)','#94a3b8'] };
  const selLabel = allCycles.find(c=>c.start===selCycleStart)?.label?.split(' (')[0] || selCycleStart;

  const card  = { background:'rgba(15,22,41,0.6)', border:'1px solid rgba(148,163,184,0.1)', borderRadius:10, padding:16, marginBottom:14 };
  const kpiG  = { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:18 };
  const kpiC  = { background:'rgba(15,22,41,0.6)', border:'1px solid rgba(148,163,184,0.1)', borderRadius:8, padding:'12px 14px' };
  const g2    = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 };
  const tblS  = { width:'100%', fontSize:12, borderCollapse:'collapse' };
  const thS   = { textAlign:'left', fontWeight:500, fontSize:11, color:'var(--text-muted)', padding:'4px 8px', borderBottom:'1px solid rgba(148,163,184,0.12)' };
  const tdS   = { padding:'7px 8px', borderBottom:'1px solid rgba(148,163,184,0.08)', color:'var(--text-primary)' };
  const tdNum = { padding:'7px 8px', borderBottom:'1px solid rgba(148,163,184,0.08)', textAlign:'right', fontFamily:'DM Mono,monospace', fontSize:11 };
  const leg   = { display:'flex', flexWrap:'wrap', gap:10, marginBottom:10, fontSize:11, color:'var(--text-muted)' };
  const dot   = bg => ({ width:10, height:10, borderRadius:2, background:bg, display:'inline-block', marginRight:4 });
  const pillS = (bg,fg) => ({ display:'inline-block', fontSize:10, padding:'2px 7px', borderRadius:10, background:bg, color:fg, fontWeight:600 });

  const KPI = ({ label, val, color }) => (
    <div style={kpiC}>
      <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:700, color:color||'var(--text-primary)', lineHeight:1 }}>{val}</div>
    </div>
  );

  const ChartCard = ({ title, sub, legend, height, id }) => (
    <div style={card}>
      <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom:3 }}>{title}</div>
      <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:10 }}>{sub}</div>
      {legend && <div style={leg}>{legend.map(([l,c])=><span key={l} style={{ display:'flex', alignItems:'center' }}><span style={dot(c)}/>{l}</span>)}</div>}
      <div style={{ position:'relative', height:height||220 }}><canvas id={id}/></div>
    </div>
  );

  const renderOverview = () => (
    <>
      <div style={kpiG}>
        <KPI label="Standby total"  val={`${fmt(totals.standbyWD+totals.standbyWE+totals.bankHol)}h`} color="#93c5fd"/>
        <KPI label="Incident hours" val={`${fmt(totals.incidents)}h`} color="#fcd34d"/>
        <KPI label="Upgrade hours"  val={`${fmt(totals.upgrades)}h`}  color="#6ee7b7"/>
        <KPI label="Overtime"       val={`${fmt(totals.overtime)}h`}  color="#f472b6"/>
        <KPI label="TOIL balance"   val={`${fmt(totals.toil)}h`}      color="#a78bfa"/>
        <KPI label="Total hrs"      val={`${fmt(totalHrs)}h`}/>
      </div>
      <div style={g2}>
        <ChartCard title="Hours mix" sub={`${selLabel} — all categories`} id="rpt-mix" height={200}
          legend={[['Standby WD','#93C5FD'],['Standby WE','#A78BFA'],['Incidents','#FCD34D'],['Overtime','#F472B6'],['Upgrades','#6EE7B7'],['Bank Hol','#FCA5A5']]}/>
        <ChartCard title="Hours by engineer" sub="Total on-call hours this cycle" id="rpt-eng" height={Math.max(160,visUsers.length*40+60)}/>
      </div>
      <ChartCard title="Category breakdown" sub="Stacked hours per category per engineer" id="rpt-stack" height={Math.max(180,visUsers.length*46+60)}
        legend={[['Standby WD','#93C5FD'],['Standby WE','#A78BFA'],['Worked WD','#60A5FA'],['Incidents','#FCD34D'],['Overtime','#F472B6'],['Upgrades','#6EE7B7'],['Bank Hol','#FCA5A5']]}/>
    </>
  );

  const renderEngineers = () => {
    const maxT = Math.max(...cycleData.map(r=>fmt((r.oc.standbyWD||0)+(r.oc.workedWD||0)+(r.oc.standbyWE||0)+(r.oc.workedWE||0)+(r.incHrs||0)+(r.upgradeHrs||0)+(r.bankHolHrs||0)+(r.overtimeHrs||0))),1);
    return (
      <div style={card}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom:3 }}>Engineer breakdown — {selLabel}</div>
        <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:12 }}>Full breakdown per team member</div>
        <div style={{ overflowX:'auto' }}>
          <table style={tblS}>
            <thead><tr>
              {['Engineer','Standby WD','Standby WE','Worked WD','Incidents','Overtime','TOIL','Total'].map(h=>(
                <th key={h} style={{ ...thS, textAlign:h==='Engineer'?'left':'right' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {cycleData.map(({ u, oc, incHrs, upgradeHrs, bankHolHrs, overtimeHrs, tb }) => {
                const total = fmt((oc.standbyWD||0)+(oc.workedWD||0)+(oc.standbyWE||0)+(oc.workedWE||0)+(incHrs||0)+(upgradeHrs||0)+(bankHolHrs||0)+(overtimeHrs||0));
                const barW  = Math.round(total/maxT*70);
                const ini   = u.name.split(' ').map(w=>w[0]).join('').slice(0,2);
                return (
                  <React.Fragment key={u.id}>
                    <tr>
                      <td style={tdS}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:28, height:28, borderRadius:'50%', background:`${u.color||'#1d4ed8'}22`, border:`1.5px solid ${u.color||'#1d4ed8'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:u.color||'#1d4ed8', flexShrink:0 }}>{ini}</div>
                          <div><div style={{ fontSize:12, fontWeight:500 }}>{u.name}</div><div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono,monospace' }}>{u.id}</div></div>
                        </div>
                      </td>
                      <td style={tdNum}>{oc.standbyWD||0}h</td>
                      <td style={tdNum}>{oc.standbyWE||0}h</td>
                      <td style={tdNum}>{oc.workedWD||0}h</td>
                      <td style={{ ...tdNum, color:incHrs>0?'#fcd34d':'var(--text-muted)' }}>{incHrs>0?`${incHrs}h`:'—'}</td>
                      <td style={{ ...tdNum, color:overtimeHrs>0?'#f472b6':'var(--text-muted)' }}>{overtimeHrs>0?`${overtimeHrs}h`:'—'}</td>
                      <td style={{ ...tdNum, color:(tb?.balance||0)>0?'#38bdf8':'var(--text-muted)' }}>{tb?.balance||0}h</td>
                      <td style={tdNum}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6 }}>
                          <span style={{ fontWeight:700 }}>{total}h</span>
                          <div style={{ width:70, height:6, background:'rgba(148,163,184,0.15)', borderRadius:3 }}>
                            <div style={{ width:barW, height:6, borderRadius:3, background:u.color||'#378ADD' }}/>
                          </div>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={8} style={{ padding:'2px 8px 10px 44px', borderBottom:'1px solid rgba(148,163,184,0.08)', fontSize:11 }}>
                        {[incHrs>0     && <span key="i" style={pillS('rgba(252,211,77,0.15)','#fcd34d')}>{incHrs}h incidents</span>,
                          overtimeHrs>0 && <span key="o" style={pillS('rgba(244,114,182,0.15)','#f472b6')}>{overtimeHrs}h overtime</span>,
                          (tb?.balance||0)>0 && <span key="t" style={pillS('rgba(56,189,248,0.15)','#38bdf8')}>{tb.balance}h TOIL</span>,
                          upgradeHrs>0  && <span key="u" style={pillS('rgba(110,231,183,0.15)','#6ee7b7')}>{upgradeHrs}h upgrades</span>,
                          bankHolHrs>0  && <span key="b" style={pillS('rgba(252,165,165,0.15)','#fca5a5')}>{bankHolHrs}h bank hol</span>,
                        ].filter(Boolean).map((el,i,a)=>[el,i<a.length-1&&<span key={`s${i}`}> </span>]).flat().filter(Boolean)}
                        {[incHrs,overtimeHrs,tb?.balance,upgradeHrs,bankHolHrs].every(v=>!v) && <span style={{ color:'var(--text-muted)' }}>No flagged items</span>}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderTrend = () => (
    <>
      <div style={kpiG}>
        <KPI label="Avg standby / cycle"   val={`${fmt(trendData.reduce((a,d)=>a+d.standby,0)/Math.max(trendData.length,1))}h`}   color="#93c5fd"/>
        <KPI label="Avg incidents / cycle" val={`${fmt(trendData.reduce((a,d)=>a+d.incidents,0)/Math.max(trendData.length,1))}h`} color="#fcd34d"/>
        <KPI label="Avg overtime / cycle"  val={`${fmt(trendData.reduce((a,d)=>a+d.overtime,0)/Math.max(trendData.length,1))}h`}  color="#f472b6"/>
        <KPI label="Cycles tracked"        val={trendData.length}/>
      </div>
      <ChartCard title={`Hours trend — last ${trendData.length} cycles`} sub="Standby, incidents, overtime and upgrades" id="rpt-trend" height={260}
        legend={[['Standby','#93C5FD'],['Incidents','#FCD34D'],['Overtime','#F472B6'],['Upgrades','#6EE7B7']]}/>
      <ChartCard title="Per-engineer trend" sub="Total on-call hours per engineer across cycles" id="rpt-eng-trend" height={280}/>
    </>
  );

  const renderIncidents = () => {
    const safeInc = Array.isArray(incidents) ? incidents : [];
    const fi      = engFilter==='all' ? safeInc : safeInc.filter(i=>i.assigned_to===engFilter);
    const sevOrd  = { Disaster:0, Critical:1, High:2, Medium:3, Low:4 };
    const sorted  = [...fi].sort((a,b)=>(sevOrd[a.severity]??9)-(sevOrd[b.severity]??9));
    const bySev   = {};
    fi.forEach(i=>{ bySev[i.severity||'Unknown']=(bySev[i.severity||'Unknown']||0)+1; });
    const totIncHrs = fi.reduce((a,i)=>a+(i.hours_worked||0),0);
    return (
      <>
        <div style={kpiG}>
          <KPI label="Disasters"          val={bySev.Disaster||0} color="#fca5a5"/>
          <KPI label="Critical"           val={bySev.Critical||0} color="#fcd34d"/>
          <KPI label="High"               val={bySev.High||0}     color="#93c5fd"/>
          <KPI label="Total incident hrs" val={`${totIncHrs}h`}   color="#6ee7b7"/>
        </div>
        <div style={g2}>
          <ChartCard title="Incidents by engineer" sub="Total count assigned" id="rpt-inc-eng" height={Math.max(140,users.length*38+50)}/>
          <ChartCard title="Severity distribution" sub="All incidents logged" id="rpt-inc-sev" height={200}
            legend={Object.keys(bySev).map(k=>[`${k}: ${bySev[k]}`, SEV_PILL[k]?.[1]||'#888'])}/>
        </div>
        <div style={card}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom:3 }}>Incident log</div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:12 }}>{sorted.length} incidents — sorted by severity</div>
          <div style={{ overflowX:'auto' }}>
            <table style={tblS}>
              <thead><tr>
                {['Date','Severity','Title','Assignee','Hours','Status'].map(h=>(
                  <th key={h} style={{ ...thS, textAlign:h==='Hours'?'right':'left' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {sorted.map(inc => {
                  const eng = users.find(u=>u.id===inc.assigned_to);
                  const [bg,fg] = SEV_PILL[inc.severity]||['rgba(136,135,128,0.15)','#94a3b8'];
                  const d = (inc.date||inc.created_at||'').slice(0,10);
                  return (
                    <tr key={inc.id}>
                      <td style={{ ...tdS, fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{d?fmtD(d):'—'}</td>
                      <td style={tdS}><span style={pillS(bg,fg)}>{inc.severity||'Unknown'}</span></td>
                      <td style={{ ...tdS, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inc.title||'—'}</td>
                      <td style={{ ...tdS, fontSize:11 }}>{eng?.name?.split(' ')[0]||inc.assigned_to||'—'}</td>
                      <td style={{ ...tdNum, color:(inc.hours_worked||0)>0?'#fcd34d':'var(--text-muted)' }}>{(inc.hours_worked||0)>0?`${inc.hours_worked}h`:'—'}</td>
                      <td style={tdS}><span style={{ fontSize:11, color:inc.status==='resolved'||inc.status==='Resolved'?'#6ee7b7':'#fcd34d' }}>{inc.status||'—'}</span></td>
                    </tr>
                  );
                })}
                {sorted.length===0 && <tr><td colSpan={6} style={{ ...tdS, textAlign:'center', color:'var(--text-muted)', padding:'24px 0' }}>No incidents found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'14px 0', borderBottom:'1px solid rgba(148,163,184,0.15)', marginBottom:16 }}>
        <span style={{ fontSize:12, color:'var(--text-muted)' }}>View</span>
        <div style={{ display:'flex', border:'1px solid rgba(148,163,184,0.2)', borderRadius:6, overflow:'hidden' }}>
          {[['overview','Overview'],['engineers','By engineer'],['trend','Trend'],['incidents','Incidents']].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{ fontSize:12, padding:'5px 12px', border:'none', borderRight:'1px solid rgba(148,163,184,0.15)',
              background:view===v?'rgba(59,130,246,0.15)':'transparent', color:view===v?'#60a5fa':'var(--text-secondary)',
              cursor:'pointer', fontWeight:view===v?600:400 }}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize:12, color:'var(--text-muted)', marginLeft:8 }}>Cycle</span>
        <select className="input" style={{ fontSize:12, padding:'5px 8px', minWidth:220, fontFamily:'DM Mono,monospace' }}
          value={selCycleStart} onChange={e=>{ const c=allCycles.find(c=>c.start===e.target.value); if(c){setSelCycleStart(c.start);setSelCycleEnd(c.end);} }}>
          {allCycles.map(c=><option key={c.start} value={c.start}>{c.start===cycleStart?'▶ ':''}{c.label}</option>)}
        </select>
        <span style={{ fontSize:12, color:'var(--text-muted)', marginLeft:8 }}>Engineer</span>
        <select className="input" style={{ fontSize:12, padding:'5px 8px' }} value={engFilter} onChange={e=>setEngFilter(e.target.value)}>
          <option value="all">All engineers</option>
          {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      {view==='overview'  && renderOverview()}
      {view==='engineers' && renderEngineers()}
      {view==='trend'     && renderTrend()}
      {view==='incidents' && renderIncidents()}
    </div>
  );
}

// ── Pay Config (Manager only) ──────────────────────────────────────────────
function PayConfig({ users, payconfig, setPayconfig, isManager, timesheets, overtime, rota, holidays }) {
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

  // ── On-call earnings (from timesheets + rota + bank holidays) ─────────────
  const bhList     = (typeof UK_BANK_HOLIDAYS !== 'undefined') ? UK_BANK_HOLIDAYS : [];
  const safeRota   = rota     || {};
  const safeHols   = Array.isArray(holidays) ? holidays : [];
  const safeOT     = Array.isArray(overtime)  ? overtime  : [];
  const safeTS     = timesheets || {};

  const userSheets  = safeTS[selectedUid] || [];
  const userHols    = safeHols.filter(h => h.userId === selectedUid);
  const upgradeHrs  = 0; // simplified — no upgrade days in this view
  const bankHolHrs  = (() => {
    let total = 0;
    bhList.forEach(bh => {
      const s = safeRota[selectedUid]?.[bh.date];
      if (!s || s === 'off') return;
      const dow = new Date(bh.date).getDay();
      if (s === 'weekend' || s === 'bankholiday') {
        total += dow === 1 ? 24 : dow === 5 ? 12 : 22;
      } else { total += 22; }
    });
    return total;
  })();
  const oc = (typeof calcOncallPay === 'function')
    ? calcOncallPay(userSheets, hourly, upgradeHrs, bankHolHrs, safeRota[selectedUid] || {}, userHols, bhList)
    : { total: 0, standbyWD: 0, workedWD: 0, standbyWE: 0, workedWE: 0 };
  const approvedOT = safeOT.filter(o => o.userId === selectedUid && o.status === 'approved')
    .reduce((s, o) => s + (o.hours || 0), 0);
  const otPay = approvedOT * hourly * ONCALL_WORKED_MULTIPLIER;

  // Annualised: multiply monthly on-call by 12 for tax calc
  const annualOC  = oc.total * 12;
  const annualOT  = otPay; // overtime is as-logged, not annualised
  const annualBH  = (bhList.length > 0 ? bankHolHrs : 0) * ONCALL_STANDBY_RATE;
  const totalGross = annual + annualOC + annualOT + annualBH;

  const tx          = calcUKTax(annual,     { pensionPct: p.pensionPct || 0, studentLoan: p.studentLoan || false });
  const txWithOC    = calcUKTax(totalGross, { pensionPct: p.pensionPct || 0, studentLoan: p.studentLoan || false });

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
            <div className="card-title">📊 Full Take-Home Calculator</div>

            {/* Earnings breakdown */}
            <div style={{ background:'rgba(30,64,175,0.08)', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8 }}>Annual Earnings</div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ color:'var(--text-muted)' }}>Base salary</span>
                <span style={{ fontFamily:'DM Mono' }}>{fmt(annual, 0)}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ color:'#93c5fd' }}>On-call pay (annualised)</span>
                <span style={{ fontFamily:'DM Mono', color:'#93c5fd' }}>+{fmt(annualOC, 0)}</span>
              </div>
              {annualOT > 0 && <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ color:'#e879f9' }}>Approved overtime ({approvedOT}h × {ONCALL_WORKED_MULTIPLIER}x)</span>
                <span style={{ fontFamily:'DM Mono', color:'#e879f9' }}>+{fmt(annualOT, 0)}</span>
              </div>}
              {annualBH > 0 && <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ color:'#fca5a5' }}>Bank holiday standby</span>
                <span style={{ fontFamily:'DM Mono', color:'#fca5a5' }}>+{fmt(annualBH, 0)}</span>
              </div>}
              <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px solid var(--border)', paddingTop:6, marginTop:4 }}>
                <span style={{ fontWeight:600 }}>Total annual gross</span>
                <span style={{ fontFamily:'DM Mono', fontWeight:700, color:'var(--text-primary)' }}>{fmt(totalGross, 0)}</span>
              </div>
            </div>

            {/* Deductions */}
            <div style={{ background:'rgba(30,64,175,0.15)', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8 }}>Deductions (inc. on-call)</div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ color:'#fca5a5' }}>Income Tax</span><span style={{ fontFamily:'DM Mono', color:'#fca5a5' }}>-{fmt(txWithOC.incomeTax, 0)}</span></div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ color:'#fcd34d' }}>National Insurance</span><span style={{ fontFamily:'DM Mono', color:'#fcd34d' }}>-{fmt(txWithOC.ni, 0)}</span></div>
              {(p.pensionPct||0)>0 && <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ color:'#93c5fd' }}>Pension ({p.pensionPct}%)</span><span style={{ fontFamily:'DM Mono', color:'#93c5fd' }}>-{fmt(txWithOC.pension, 0)}</span></div>}
              {p.studentLoan && <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ color:'#c4b5fd' }}>Student Loan Plan 2</span><span style={{ fontFamily:'DM Mono', color:'#c4b5fd' }}>-{fmt(txWithOC.slRepay, 0)}</span></div>}
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ color:'var(--text-muted)' }}>Effective rate</span><span style={{ fontFamily:'DM Mono' }}>{(txWithOC.effectiveRate*100).toFixed(1)}%</span></div>
              <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px solid var(--border)', paddingTop:6, marginTop:4 }}>
                <span style={{ fontWeight:700 }}>Annual take-home (full)</span>
                <span style={{ fontFamily:'DM Mono', fontWeight:700, color:'#6ee7b7', fontSize:15 }}>{fmt(txWithOC.annualNet, 0)}</span>
              </div>
            </div>

            {/* Period table — base only vs full */}
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>Monthly comparison: base only vs base + on-call</div>
            <table style={{ width:'100%', fontSize:12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left' }}>Period</th>
                  <th style={{ textAlign:'right', color:'var(--text-muted)' }}>Base net</th>
                  <th style={{ textAlign:'right', color:'#6ee7b7' }}>Full net</th>
                  <th style={{ textAlign:'right', color:'#93c5fd' }}>OC uplift</th>
                </tr>
              </thead>
              <tbody>
                {[['Monthly',1/12],['Weekly',1/52],['Daily',1/260]].map(([label, frac]) => (
                  <tr key={label} style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding:'4px 0' }}>{label}</td>
                    <td style={{ textAlign:'right', fontFamily:'DM Mono', color:'var(--text-muted)' }}>{fmt(txWithOC.annualNet * frac - (annualOC+annualOT+annualBH) * (1 - txWithOC.effectiveRate) * frac, 0)}</td>
                    <td style={{ textAlign:'right', fontFamily:'DM Mono', fontWeight:700, color:'#6ee7b7' }}>{fmt(txWithOC.annualNet * frac, 0)}</td>
                    <td style={{ textAlign:'right', fontFamily:'DM Mono', color:'#93c5fd' }}>+{fmt((annualOC+annualOT+annualBH) * (1 - txWithOC.effectiveRate) * frac, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* On-call detail */}
            {(oc.standbyWD > 0 || oc.workedWD > 0 || oc.standbyWE > 0 || oc.workedWE > 0) && (
              <div style={{ marginTop:12, background:'rgba(0,194,255,0.06)', borderRadius:8, padding:'8px 12px', fontSize:11 }}>
                <div style={{ fontWeight:600, color:'var(--text-secondary)', marginBottom:6 }}>On-call breakdown (this month × 12)</div>
                {[
                  ['Standby WD', oc.standbyWD, '#93c5fd'],
                  ['Worked WD',  oc.workedWD,  '#93c5fd'],
                  ['Standby WE', oc.standbyWE, '#a78bfa'],
                  ['Worked WE',  oc.workedWE,  '#a78bfa'],
                  bankHolHrs > 0 && ['Bank Hol standby', bankHolHrs, '#fca5a5'],
                  approvedOT > 0 && ['Overtime', approvedOT, '#e879f9'],
                ].filter(Boolean).map(([label, hrs, color]) => hrs > 0 && (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                    <span style={{ color:'var(--text-muted)' }}>{label}</span>
                    <span style={{ fontFamily:'DM Mono', color }}>{hrs}h</span>
                  </div>
                ))}
              </div>
            )}
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


// Settings component moved to src/Settings.js

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
  const [payrollAdjustments, setPayrollAdjustments] = useState([]);
  const [logbook, setLogbook]         = useState([]);
  const [documents, setDocuments]     = useState([]);
  const [timekeeping, setTimekeeping] = useState({});
  const [announcements, setAnnouncements] = useState([]);
  const [handoverNotes, setHandoverNotes] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [userCalendars,  setUserCalendars]  = useState([]);
  const [dismissedReminders, setDismissedReminders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cr_dismissed_reminders') || '[]'); } catch (_) { return []; }
  });
  const [obsidianNotes, setObsidianNotes] = useState([]);
  const [whatsappChats, setWhatsappChats] = useState([]);
  const [secureLinks, setSecureLinks] = useState([]);
  const [permissions,    setPermissions]    = useState({});
  const [permTemplates,  setPermTemplates]  = useState({});

  const isManager = currentUser === 'MBA47';

  // ── Activity log writer (writes to CRO_LOGS on Drive) ─────────────────────
  // Pass addLog as a prop to any page component that should emit log entries.
  // Signature: addLog({ action, section, detail, level?, uid?, user? })
  const addLog = React.useCallback(
    createLogWriter(driveToken, currentUser, users),
    [driveToken, currentUser, users] // eslint-disable-line
  );
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

      const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, overtime, logbook, documents, obsidianNotes, whatsappChats, payrollAdjustments };
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
      if (data.toil         != null) setToil(Array.isArray(data.toil) ? data.toil : Object.values(data.toil));
      if (data.absences     != null) setAbsences(data.absences);
      if (data.overtime     != null) setOvertime(data.overtime);
      if (data.payrollAdjustments != null) setPayrollAdjustments(data.payrollAdjustments);
      if (data.logbook      != null) setLogbook(data.logbook);
      if (data.documents    != null) setDocuments(data.documents);
      if (data.timekeeping  != null) setTimekeeping(data.timekeeping);
      if (data.announcements!= null) setAnnouncements(data.announcements);
      if (data.handoverNotes!= null) setHandoverNotes(data.handoverNotes);
      if (data.calendarEvents != null) setCalendarEvents(data.calendarEvents);
      if (data.userCalendars  != null) setUserCalendars(data.userCalendars);
      if (data.obsidianNotes   != null) {
        // Guard: recover from old engineer-keyed bug where it was saved as {uid:[…]}
        const rawNotes = data.obsidianNotes;
        setObsidianNotes(Array.isArray(rawNotes)
          ? rawNotes
          : Object.values(rawNotes).flat().filter(n => n && typeof n === 'object'));
      }
      if (data.whatsappChats != null) { const wc = data.whatsappChats; setWhatsappChats(wc?.chats ?? (Array.isArray(wc) ? wc : [])); }
      if (data.permissions     != null) setPermissions(data.permissions);
      if (data.permTemplates   != null) setPermTemplates(data.permTemplates);
      setDriveReady(true);
      // ── CRITICAL FIX ──────────────────────────────────────────────────────
      // driveDataLoaded.current MUST be set before setDriveToken() fires.
      // Setting driveToken triggers all save() useEffects. Without this flag
      // every save() call bounces off the guard at line 5449 and nothing is
      // ever written to Drive when the auto-connect path is used.
      driveDataLoaded.current = true;
      setDriveToken(token);      // ← safe now: ref is true, real data is in state
      console.log('Drive: loaded successfully, driveReady = true, saves unblocked');
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
      setSyncing(true);
      const own = {
        users:'manager', rota:'manager', payconfig:'manager',
        holidays:'shared', incidents:'shared', upgrades:'shared', wiki:'shared',
        glossary:'shared', contacts:'shared', swapRequests:'shared', absences:'shared',
        logbook:'shared', documents:'shared', whatsappChats:'shared',
        obsidianNotes:'shared',   // ← was 'engineer': notes is a flat array not keyed by uid
        timesheets:'engineer', overtime:'engineer',
        toil:'shared',   // ← flat array keyed by record id, NOT by uid
      }[key] || 'shared';

      if (own === 'manager' && !isManager) { setSyncing(false); return; }

      if (own === 'engineer') {
        // ── Per-user scoped save ─────────────────────────────────────────────
        // Engineers only write their own slice to avoid overwriting each other.
        // Managers write ALL slices — they modify entries for other engineers
        // (via incidents and upgrade days) and must persist those changes.
        // We always read Drive first and merge so we never lose entries that
        // were added by another session since this user loaded the page.
        const driveVal = await driveRead(driveToken, key).catch(() => null);
        const drive = driveVal || {};
        let merged;
        if (isManager) {
          // Manager: merge all local user slices into Drive, local wins per-user
          // Drive retains any user slices not present in local state
          merged = { ...drive };
          Object.keys(data || {}).forEach(uid => {
            merged[uid] = (data || {})[uid];
          });
        } else {
          // Engineer: only update own slice
          merged = { ...drive, [currentUser]: (data || {})[currentUser] };
        }
        await driveWrite(driveToken, key, merged);
      } else {
        // ── Shared / manager keys ─────────────────────────────────────────
        // Write local data as the authoritative source.
        // We deliberately do NOT merge back from Drive here because merging
        // causes deletions to be reversed: a deleted item has no local ID,
        // so the merge would re-add it from Drive on the very next save.
        // For a small team tool all writes go through the same React state,
        // so the local array is always the correct truth after any add/edit/delete.
        await driveWrite(driveToken, key, data);
      }
      setLastSync(new Date());
    } catch (e) { console.warn('Drive save failed for', key, e?.message); }
    finally { setSyncing(false); }
  }, [driveToken, isManager, currentUser]);

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
  useEffect(() => { save('payrollAdjustments', payrollAdjustments); }, [payrollAdjustments]);
  useEffect(() => { save('logbook', logbook); },           [logbook]);
  useEffect(() => { save('documents', documents); },       [documents]);
  useEffect(() => { save('timekeeping', timekeeping); },   [timekeeping]);
  useEffect(() => { save('announcements', announcements); }, [announcements]);
  useEffect(() => { save('handoverNotes', handoverNotes); }, [handoverNotes]);
  useEffect(() => { save('calendarEvents', calendarEvents); }, [calendarEvents]);
  useEffect(() => { save('userCalendars',  userCalendars);  }, [userCalendars]);
  useEffect(() => {
    try { localStorage.setItem('cr_dismissed_reminders', JSON.stringify(dismissedReminders)); } catch (_) {}
  }, [dismissedReminders]);
  useEffect(() => { save('obsidianNotes', obsidianNotes); },[obsidianNotes]);
  useEffect(() => { save('whatsappChats', whatsappChats); },[whatsappChats]);
  useEffect(() => { save('permissions',   permissions);   },[permissions]);
  useEffect(() => { save('permTemplates', permTemplates); },[permTemplates]);

  const [manualSyncing, setManualSyncing] = useState(false);
  const [syncProgress, setSyncProgress]   = useState(0);
  const [syncStatus, setSyncStatus]       = useState('');

  // ── Drive ownership map ─────────────────────────────────────────────────
  // manager  = only manager may overwrite this file
  // engineer = only the caller's own uid-slice is written; other users untouched
  // shared   = anyone may write, but we upsert by record id so nobody stomps
  //            on another person's records
  const DRIVE_OWNERSHIP = {
    users:         'manager',
    rota:          'manager',
    payconfig:     'manager',
    permissions:   'manager',
    permTemplates: 'manager',
    payrollAdjustments: 'manager',
    holidays:      'shared',
    incidents:     'shared',
    upgrades:      'shared',
    wiki:          'shared',
    glossary:      'shared',
    contacts:      'shared',
    swapRequests:  'shared',
    absences:      'shared',
    logbook:       'shared',
    documents:     'shared',
    whatsappChats: 'shared',
    timesheets:    'engineer',
    overtime:      'engineer',
    toil:          'shared',   // flat array keyed by record id — NOT by uid
    obsidianNotes: 'shared',   // flat array keyed by note id — NOT by uid
  };

  // Safe write — respects ownership so no caller can clobber data they don't own
  const ownedWrite = async (key, localVal) => {
    const own = DRIVE_OWNERSHIP[key] || 'shared';

    // Manager-only keys: engineers skip entirely
    if (own === 'manager' && !isManager) return;

    // Engineer-owned keys: manager writes all slices, engineer writes only own slice
    if (own === 'engineer') {
      const driveVal = await driveRead(driveToken, key).catch(() => null);
      const drive = driveVal || {};
      let merged;
      if (isManager) {
        merged = { ...drive };
        Object.keys(localVal || {}).forEach(uid => { merged[uid] = (localVal || {})[uid]; });
      } else {
        merged = { ...drive, [currentUser]: (localVal || {})[currentUser] };
      }
      await driveWrite(driveToken, key, merged);
      return;
    }

    // Shared keys: upsert by record id (arrays) or shallow-merge (objects)
    if (own === 'shared') {
      const driveVal = await driveRead(driveToken, key).catch(() => null);
      if (!driveVal) { await driveWrite(driveToken, key, localVal); return; }
      if (Array.isArray(driveVal) && Array.isArray(localVal)) {
        const localIds = new Set(localVal.map(r => r.id).filter(Boolean));
        const merged = [...driveVal.filter(r => !localIds.has(r.id)), ...localVal];
        await driveWrite(driveToken, key, merged);
      } else if (typeof driveVal === 'object' && typeof localVal === 'object') {
        await driveWrite(driveToken, key, { ...driveVal, ...localVal });
      } else {
        await driveWrite(driveToken, key, localVal);
      }
      return;
    }

    // Fallback
    await driveWrite(driveToken, key, localVal);
  };

  const syncAllToDrive = async () => {
    if (!driveToken) { alert('Connect Google Drive first.'); return; }
    setManualSyncing(true); setSyncProgress(0);
    setSyncStatus(isManager ? 'Starting full sync…' : 'Syncing your data safely…');

    const allKeys = ['users','holidays','incidents','timesheets','upgrades','wiki','glossary',
                     'contacts','payconfig','rota','swapRequests','toil','absences','overtime',
                     'logbook','documents','obsidianNotes','whatsappChats','permissions','permTemplates',
                     'payrollAdjustments'];
    const vals = { users, holidays, incidents, timesheets, upgrades, wiki, glossary,
                   contacts, payconfig, rota, swapRequests, toil, absences, overtime,
                   logbook, documents, obsidianNotes, whatsappChats, permissions, permTemplates,
                   payrollAdjustments };

    // Engineers only touch shared + their own engineer-owned keys
    // Managers sync everything
    const syncKeys = isManager
      ? allKeys
      : allKeys.filter(k => (DRIVE_OWNERSHIP[k] === 'shared' || DRIVE_OWNERSHIP[k] === 'engineer'));

    for (let i = 0; i < syncKeys.length; i++) {
      const key = syncKeys[i];
      setSyncStatus(`Saving ${key}…`);
      setSyncProgress(Math.round(((i + 1) / syncKeys.length) * 100));
      try { await ownedWrite(key, vals[key]); } catch (e) { console.warn('sync fail', key, e); }
    }

    if (isManager) {
      try { await syncRegistryToDrive(driveToken, getRegistry(), users); } catch (_) {}
    }

    setLastSync(new Date());
    setSyncProgress(100);
    setSyncStatus(isManager ? '✅ Full sync complete' : '✅ Your data synced safely');
    setTimeout(() => { setManualSyncing(false); setSyncStatus(''); setSyncProgress(0); }, 3000);
  };

  const login = async (uid) => {
    setCurrentUser(uid);
    setPage(uid === 'MBA47' ? 'dashboard' : 'oncall');

    // Log the login event (fire-and-forget — non-blocking)
    if (driveToken) {
      createLogWriter(driveToken, uid, users)({
        section: 'auth', level: 'info',
        action: 'User login',
        detail: `${users.find(u => u.id === uid)?.name || uid} signed in`,
      }).catch(() => {});
    }

    if (driveReady) {
      // Drive data already loaded (silent auto-connect succeeded before login).
      // ── CRITICAL FIX: driveDataLoaded.current was never set on this path. ──
      // Auto-connect calls loadDriveData() which now sets the ref, but if the
      // ref was still false when the user reaches this branch saves stay blocked
      // forever. Force it true here as a belt-and-braces guard.
      driveDataLoaded.current = true;
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
        const defaults = { users, holidays, incidents, timesheets, upgrades, wiki, glossary, contacts, payconfig, rota, swapRequests, toil, absences, overtime, logbook, documents, obsidianNotes, whatsappChats, payrollAdjustments };
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
        if (data.toil != null) setToil(Array.isArray(data.toil) ? data.toil : Object.values(data.toil));
        if (data.absences != null) setAbsences(data.absences);
        if (data.overtime != null) setOvertime(data.overtime);
        if (data.payrollAdjustments != null) setPayrollAdjustments(data.payrollAdjustments);
        if (data.logbook != null) setLogbook(data.logbook);
        if (data.documents != null) setDocuments(data.documents);
        if (data.timekeeping != null) setTimekeeping(data.timekeeping);
        if (data.announcements != null) setAnnouncements(data.announcements);
        if (data.handoverNotes != null) setHandoverNotes(data.handoverNotes);
        if (data.calendarEvents != null) setCalendarEvents(data.calendarEvents);
      if (data.userCalendars  != null) setUserCalendars(data.userCalendars);
        if (data.obsidianNotes != null) setObsidianNotes(data.obsidianNotes);
        if (data.whatsappChats != null) { const wc = data.whatsappChats; setWhatsappChats(wc?.chats ?? (Array.isArray(wc) ? wc : [])); }
        if (data.permissions   != null) setPermissions(data.permissions);
        if (data.permTemplates != null) setPermTemplates(data.permTemplates);
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
  const isV2   = theme === 'v2';

  // Only :root variable swaps stay in JS — all static CSS is in App.css
  const themeVars = isV2 ? `
    :root {
      /* ── New GUI 2026v2 — Neumorphic Minimalism ── */
      --bg:              #e8ecf0;
      --bg-card:         #edf0f4;
      --bg-card2:        #e2e6ea;
      --border:          rgba(255,255,255,0.85);
      --border-inner:    rgba(163,177,198,0.45);
      --accent:          #5b6af0;
      --accent-dim:      rgba(91,106,240,0.12);
      --accent-glow:     rgba(91,106,240,0.28);
      --accent2:         #06c9a0;
      --accent3:         #f97316;
      --text-primary:    #1e2533;
      --text-secondary:  #4a5568;
      --text-muted:      #8896a8;
      --input-bg:        #e8ecf0;
      --sidebar-bg:      #dde1e7;
      --sidebar-border:  rgba(163,177,198,0.3);
      --topbar-bg:       rgba(232,236,240,0.94);
      --shadow-card:     6px 6px 14px rgba(163,177,198,0.6), -6px -6px 14px rgba(255,255,255,0.9);
      --shadow-inset:    inset 3px 3px 7px rgba(163,177,198,0.5), inset -3px -3px 7px rgba(255,255,255,0.8);
      --shadow-btn:      4px 4px 10px rgba(163,177,198,0.5), -3px -3px 8px rgba(255,255,255,0.85);
      --shadow-btn-pressed: inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255,0.8);
      --nav-text:        #7a8899;
      --nav-text-hover:  #4a5568;
      --nav-text-active: #5b6af0;
      --nav-active-bg:   rgba(91,106,240,0.1);
      --nav-section:     #8896a8;
      --radius-card:     18px;
      --radius-btn:      12px;
      --radius-input:    10px;
      --font-body:       'Plus Jakarta Sans', 'DM Sans', system-ui, sans-serif;
    }
  ` : isDark ? `
    :root {
      --bg: #080d17; --bg-card: #0e1525; --bg-card2: #131c2e;
      --border: #1e2d45; --accent: #00c2ff;
      --accent-dim: rgba(0,194,255,0.12); --accent-glow: rgba(0,194,255,0.25);
      --text-primary: #e8f0fe; --text-secondary: #8fa8c8; --text-muted: #4a6080;
      --input-bg: #0c1420; --sidebar-bg: #060b14; --sidebar-border: #141f30;
      --topbar-bg: rgba(8,13,23,0.92); --shadow-card: 0 2px 12px rgba(0,0,0,0.4);
      --nav-text: #4a6080; --nav-text-hover: #8fa8c8; --nav-text-active: #00c2ff;
      --nav-active-bg: rgba(0,194,255,0.08); --nav-section: #2a3d55;
      --radius-card: 10px; --radius-btn: 7px; --radius-input: 6px;
      --font-body: 'DM Sans', system-ui, sans-serif;
    }
  ` : `
    :root {
      --bg: #f1f5f9; --bg-card: #ffffff; --bg-card2: #f8fafc;
      --border: rgba(148,163,184,0.35); --accent: #2563eb;
      --accent-dim: rgba(37,99,235,0.1); --accent-glow: rgba(37,99,235,0.2);
      --text-primary: #0f172a; --text-secondary: #334155; --text-muted: #64748b;
      --input-bg: #ffffff; --sidebar-bg: #1e293b; --sidebar-border: rgba(15,23,42,0.25);
      --topbar-bg: rgba(255,255,255,0.97); --shadow-card: 0 2px 12px rgba(0,0,0,0.08);
      --nav-text: #94a3b8; --nav-text-hover: #cbd5e1; --nav-text-active: #f1f5f9;
      --nav-active-bg: rgba(59,130,246,0.2); --nav-section: #475569;
      --radius-card: 10px; --radius-btn: 7px; --radius-input: 6px;
      --font-body: 'DM Sans', system-ui, sans-serif;
    }
  `;

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'v2' : 'dark';
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
    payrollAdjustments, setPayrollAdjustments,
    logbook, setLogbook,
    documents, setDocuments,
    obsidianNotes, setObsidianNotes,
    whatsappChats, setWhatsappChats,
    secureLinks, setSecureLinks,
    permissions, setPermissions,
    permTemplates, setPermTemplates,
    driveToken,
    searchQ,
    isManager,
    profilePics,
    user,
    addLog,
  };

  const renderPage = () => {
    switch (page) {
      case 'dashboard':  return isManager ? <Dashboard {...props} /> : <Alert type="warning">⚠ Dashboard restricted to managers.</Alert>;
      case 'oncall':     return <OnCall {...props} />;
      case 'myshift':    return <MyShift {...props} />;
      case 'calendar':   return <CalendarPage users={users} rota={rota} holidays={holidays} upgrades={upgrades} absences={absences} incidents={incidents} UK_BANK_HOLIDAYS={UK_BANK_HOLIDAYS} currentUser={currentUser} isManager={isManager} calendarEvents={calendarEvents} setCalendarEvents={setCalendarEvents} userCalendars={userCalendars} setUserCalendars={setUserCalendars} />;
      case 'rota':       return <RotaPage users={users} rota={rota} setRota={setRota} holidays={holidays} upgrades={upgrades} swapRequests={swapRequests} setSwapRequests={setSwapRequests} isManager={isManager} UK_BANK_HOLIDAYS={UK_BANK_HOLIDAYS} generateRota={generateRota} generateICalFeed={generateICalFeed} downloadIcal={downloadIcal} />;
      case 'incidents':  return <Incidents {...props} timesheets={timesheets} setTimesheets={setTimesheets} addLog={addLog} />;
      case 'timesheets': return <Timesheets {...props} />;
      case 'timekeeping': return <TimeKeeping users={users} holidays={holidays} currentUser={currentUser} isManager={isManager} bankHolidays={UK_BANK_HOLIDAYS} timekeeping={timekeeping} setTimekeeping={setTimekeeping} driveToken={driveToken} />;
      case 'holidays':   return <Holidays {...props} />;
      case 'logs':       return <Logs isManager={isManager} driveToken={driveToken} users={users} currentUser={currentUser} />;
      case 'swaps':      return <ShiftSwaps {...props} driveToken={driveToken} />;
      case 'upgrades':   return <UpgradeDays {...props} timesheets={timesheets} setTimesheets={setTimesheets} />;
      case 'stress':     return <StressScore {...props} overtime={overtime} holidays={holidays} />;
      case 'toil':       return <TOIL users={users} timesheets={timesheets} toil={toil} setToil={setToil} currentUser={currentUser} isManager={isManager} />;
      case 'absence':    return <Absence {...props} driveToken={driveToken} />;
      case 'overtime':   return <Overtime {...props} overtime={overtime} setOvertime={setOvertime} driveToken={driveToken} />;
      case 'logbook':    return <Logbook {...props} />;
      case 'wiki':       return <Wiki wiki={wiki} setWiki={setWiki} driveToken={driveToken} currentUser={currentUser} isManager={isManager} />;
      case 'glossary':   return <Glossary {...props} />;
      case 'contacts':   return <Contacts {...props} />;
      case 'notes':      return <Notes {...props} />;
      case 'docs':       return <Documents {...props} />;
      case 'announcements':  return <Announcements announcements={announcements} setAnnouncements={setAnnouncements} currentUser={currentUser} isManager={isManager} users={users} />;
      case 'shiftreminders': return <ShiftReminders rota={rota} users={users} incidents={incidents} currentUser={currentUser} isManager={isManager} handoverNotes={handoverNotes} setHandoverNotes={setHandoverNotes} />;
      case 'whatsapp':   return <WhatsAppChat {...props} />;
      case 'insights':   return <Insights {...props} />;
      case 'capacity':   return <Capacity {...props} incidents={incidents} />;
      case 'reports':    return <WeeklyReports {...props} />;
      case 'payroll':    return <Payroll {...props} incidents={incidents} upgrades={upgrades} rota={rota} overtime={overtime} driveToken={driveToken} payrollAdjustments={payrollAdjustments} setPayrollAdjustments={setPayrollAdjustments} />;
      case 'payconfig':  return <PayConfig {...props} timesheets={timesheets} overtime={overtime} rota={rota} holidays={holidays} />;
      case 'settings':   return <SettingsPage
        users={users} setUsers={setUsers}
        isManager={isManager}
        secureLinks={secureLinks} setSecureLinks={setSecureLinks}
        driveToken={driveToken}
        profilePics={profilePics} setProfilePicsState={setProfilePicsState}
        rota={rota} setRota={setRota}
        permissions={permissions} setPermissions={setPermissions}
        permTemplates={permTemplates} setPermTemplates={setPermTemplates}
        uploadProfilePicture={uploadProfilePicture}
        generateTrigramId={generateTrigramId}
        TRICOLORS={TRICOLORS}
        updatePasswordInRegistry={updatePasswordInRegistry}
        syncRegistryToDrive={syncRegistryToDrive}
        getRegistry={getRegistry}
        getProfilePics={getProfilePics}
        setProfilePics={setProfilePics}
        setTimesheets={setTimesheets}
        setToil={setToil}
        syncUsersFromSheet={syncUsersFromSheet}
        syncUsersToSheet={syncUsersToSheet}
        driveWriteJson={driveWriteJson}
      />;
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
      {isV2 && <link rel="preconnect" href="https://fonts.googleapis.com" />}
      {isV2 && <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />}
      {/* Root shell — explicit inline flex, no dependency on App.css */}
      <div data-theme={theme} className={isV2 ? 'theme-v2' : ''} style={{
        display: 'flex', flexDirection: 'row', width: '100vw', height: '100vh',
        overflow: 'hidden', background: 'var(--bg)', color: 'var(--text-primary)',
        fontFamily: isV2 ? 'var(--font-body)' : "'DM Sans', system-ui, sans-serif", fontSize: 13,
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
                  const annUnread = item.id === 'announcements'
                    ? (announcements || []).filter(a => {
                        const today = new Date().toISOString().slice(0,10);
                        if (a.expiresAt && today > a.expiresAt) return false;
                        if (a.targetRole === 'manager') return false;
                        return !(a.readBy || []).includes(currentUser);
                      }).length
                    : 0;
                  const badge = (item.badge && openInc > 0) ? openInc : (item.id === 'swaps' && pendingSwaps > 0) ? pendingSwaps : annUnread > 0 ? annUnread : 0;
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
            <input placeholder="🔍  Search…" value={searchQ} onChange={e => setSearchQ(e.target.value)}
              className="search-input"
              style={{ width:160, fontSize:11 }} />
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono', whiteSpace:'nowrap', letterSpacing:'0.3px' }}>
                {new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}
              </div>
              {driveToken && (
                <button title="Refresh from Drive" className="btn btn-secondary btn-sm"
                  style={{ padding:'4px 9px', fontSize:11, gap:4 }}
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
                      if (has(data.toil))          setToil(Array.isArray(data.toil) ? data.toil : Object.values(data.toil));
                      if (has(data.absences))      setAbsences(data.absences);
                      if (has(data.overtime))      setOvertime(data.overtime);
                      if (has(data.logbook))       setLogbook(data.logbook);
                      if (has(data.documents))     setDocuments(data.documents);
                      if (has(data.obsidianNotes)) setObsidianNotes(data.obsidianNotes);
                      if (has(data.whatsappChats)) { const wc = data.whatsappChats; setWhatsappChats(wc?.chats ?? (Array.isArray(wc) ? wc : [])); }
                      if (has(data.permissions))   setPermissions(data.permissions);
                      if (has(data.permTemplates)) setPermTemplates(data.permTemplates);
                      setLastSync(new Date());
                    } catch(e) { console.warn('Refresh failed:', e); }
                    finally { setSyncing(false); }
                  }}
                  title="Pull latest data from Drive">
                  🔄
                </button>
              )}
              {driveToken && (
                <button className="btn btn-secondary btn-sm"
                  title={isManager
                    ? 'Manager sync — saves all data to Drive (full)'
                    : 'Engineer sync — saves only your records (safe merge)'}
                  style={{ padding:'4px 9px', fontSize:11 }}
                  onClick={syncAllToDrive} disabled={manualSyncing}>
                  {manualSyncing ? <span className="spinner spinner-sm" /> : '☁️'}
                </button>
              )}
              <button onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to Light' : theme === 'light' ? 'Switch to New GUI 2026v2' : 'Switch to Dark'}
                className="btn btn-secondary btn-sm"
                style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px',
                  ...(isV2 ? { background:'rgba(91,106,240,0.12)', borderColor:'rgba(91,106,240,0.35)', color:'#5b6af0' } : {}) }}>
                {theme === 'dark' ? '☀️' : theme === 'light' ? '✦' : '🌙'}
                <span style={{ fontSize:10, letterSpacing:'-0.2px' }}>
                  {theme === 'dark' ? 'Light' : theme === 'light' ? 'New GUI' : 'Dark'}
                </span>
              </button>
              {openInc > 0 && (
                <div className="badge" onClick={() => setPage('incidents')}
                  style={{ background:'rgba(239,68,68,0.15)', color:'#fca5a5', border:'1px solid rgba(239,68,68,0.3)',
                    cursor:'pointer', borderRadius:20, padding:'3px 9px', fontSize:10, fontWeight:700,
                    transition:'all 0.15s', boxShadow:'0 0 12px rgba(239,68,68,0.2)' }}>
                  🚨 {openInc}
                </div>
              )}
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
            {/* ── Global banners: announcements + shift reminders ── */}
            <AnnouncementBanners
              announcements={announcements}
              currentUser={currentUser}
              onDismiss={(id) => setAnnouncements(prev => prev.map(a => a.id===id ? {...a, readBy:[...(a.readBy||[]),currentUser]} : a))}
            />
            <ShiftReminderBanner
              rota={rota}
              currentUser={currentUser}
              incidents={incidents}
              dismissed={dismissedReminders}
              onDismiss={(key) => setDismissedReminders(prev => [...prev, key])}
            />
            {renderPage()}
          </div>
        </div>

      </div>
    </>
  );
}
