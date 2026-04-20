// src/hooks/useGoogleDrive.js
// Google Drive API integration - stores all data as JSON files in Drive

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'CloudOps-Rota';
const FILES = {
  users: 'users.json',
  rota: 'rota.json',
  holidays: 'holidays.json',
  incidents: 'incidents.json',
  timesheets: 'timesheets.json',
  upgrades: 'upgrades.json',
  wiki: 'wiki.json',
  glossary: 'glossary.json',
  contacts: 'contacts.json',
  payconfig: 'payconfig.json',
  reports: 'reports.json',
};

let folderId = null;
let fileIds = {};

// ── Auth ────────────────────────────────────────────────────────────────────

// Cache the GSI script load so it is only injected into the DOM once.
// Without this, every call to initGoogleAuth appended a new <script> tag,
// which caused multiple account-chooser popups and race conditions.
let _gsiLoadPromise = null;
function loadGsi() {
  if (_gsiLoadPromise) return _gsiLoadPromise;
  _gsiLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = (e) => { _gsiLoadPromise = null; reject(e); };
    document.head.appendChild(script);
  });
  return _gsiLoadPromise;
}

/**
 * initGoogleAuth(clientId, options?)
 *
 * options.prompt:
 *   ''       - default interactive flow; shows account chooser (original behaviour)
 *   'none'   - silent/invisible attempt; rejects immediately with 'interaction_required'
 *              if the user has no active Google session. NEVER shows a popup.
 *
 * App.js autoConnect() calls with { prompt: 'none' } on page load so users
 * with an active Google session connect automatically. If that fails, the
 * manual Connect button calls with no options (interactive flow, shows chooser).
 */
export async function initGoogleAuth(clientId, options = {}) {
  await loadGsi();
  return new Promise((resolve, reject) => {
    const promptValue = options.prompt ?? '';
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt: promptValue,
      callback: (resp) => {
        if (resp.error) reject(resp.error);
        else resolve(resp.access_token);
      },
    });
    client.requestAccessToken({ prompt: promptValue });
  });
}

export async function gapiLoad() {
  return new Promise((resolve) => {
    if (window.gapi?.client) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
      window.gapi.load('client', async () => {
        await window.gapi.client.init({
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        resolve();
      });
    };
    document.head.appendChild(script);
  });
}

// ── Folder helpers ───────────────────────────────────────────────────────────

async function getOrCreateFolder(token) {
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const createData = await createRes.json();
  return createData.id;
}

async function getFileId(token, filename, parentId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${filename}' and '${parentId}' in parents and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

// ── Read / Write ─────────────────────────────────────────────────────────────

export async function driveRead(token, key) {
  try {
    if (!folderId) folderId = await getOrCreateFolder(token);
    const filename = FILES[key];
    if (!filename) throw new Error('Unknown key: ' + key);
    let fileId = fileIds[key] || await getFileId(token, filename, folderId);
    if (!fileId) return null;
    fileIds[key] = fileId;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('Drive read error:', e);
    return null;
  }
}

export async function driveWrite(token, key, data) {
  try {
    if (!folderId) folderId = await getOrCreateFolder(token);
    const filename = FILES[key];
    if (!filename) throw new Error('Unknown key: ' + key);
    let fileId = fileIds[key] || await getFileId(token, filename, folderId);
    const body = JSON.stringify(data, null, 2);
    const blob = new Blob([body], { type: 'application/json' });
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(
      fileId
        ? { name: filename }
        : { name: filename, parents: [folderId] }
    )], { type: 'application/json' }));
    form.append('file', blob);
    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const method = fileId ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const result = await res.json();
    if (result.id) fileIds[key] = result.id;
    return result;
  } catch (e) {
    console.error('Drive write error:', e);
    return null;
  }
}

// ── Load all data from Drive ─────────────────────────────────────────────────

export async function loadAllFromDrive(token, defaults) {
  const result = {};
  for (const key of Object.keys(FILES)) {
    const data = await driveRead(token, key);
    result[key] = data !== null ? data : (defaults[key] ?? null);
  }
  return result;
}

// ── iCal export ──────────────────────────────────────────────────────────────

export function generateICalFeed(shifts, userName) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CloudOps Rota//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:CloudOps On-Call — ${userName}`,
    'X-WR-TIMEZONE:Europe/London',
  ];
  for (const [date, shift] of Object.entries(shifts)) {
    if (shift === 'off') continue;
    const label = shift === 'daily' ? 'Daily On-Call (9am–6pm)'
      : shift === 'evening' ? 'Weekday Evening On-Call (7pm–7am)'
      : 'Weekend On-Call (7pm–7am)';
    const d = date.replace(/-/g, '');
    const uid = `${d}-${shift}-${userName.replace(/\s/g, '')}@cloudops-rota`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${d}`,
      `SUMMARY:${label}`,
      `DESCRIPTION:CloudOps Rota — ${userName}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcal(icalContent, filename = 'cloudops-rota.ics') {
  const blob = new Blob([icalContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
