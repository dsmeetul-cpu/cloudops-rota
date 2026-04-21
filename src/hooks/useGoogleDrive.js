// src/hooks/useGoogleDrive.js
// Google Drive API integration - stores all data as JSON files in Drive

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'CloudOps-Rota';
const FILES = {
  users:         'users.json',
  rota:          'rota.json',
  holidays:      'holidays.json',
  incidents:     'incidents.json',
  timesheets:    'timesheets.json',
  upgrades:      'upgrades.json',
  wiki:          'wiki.json',
  glossary:      'glossary.json',
  contacts:      'contacts.json',
  payconfig:     'payconfig.json',
  reports:       'reports.json',
  // ── These 8 keys were missing — every save/load for them silently failed ──
  swapRequests:  'swapRequests.json',
  toil:          'toil.json',
  absences:      'absences.json',
  overtime:      'overtime.json',
  logbook:       'logbook.json',
  documents:     'documents.json',
  obsidianNotes: 'obsidianNotes.json',
  whatsappChats: 'whatsappChats.json',
  // ── Permissions (added) ──────────────────────────────────────────────────
  permissions:   'permissions.json',
};

let folderId = null;
let fileIds = {};

// ── Auth ────────────────────────────────────────────────────────────────────

export async function initGoogleAuth(clientId) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => {
      window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) reject(resp.error);
          else resolve(resp.access_token);
        },
      }).requestAccessToken();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export async function gapiLoad() {
  return new Promise((resolve) => {
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
  // ── BUG FIX: the q= parameter MUST be URL-encoded.
  // Unencoded apostrophes and spaces cause the Drive API query to fail silently,
  // so the search returns 0 results and a brand-new empty folder is created every
  // session — meaning saved files are never found on reload.
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }
  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const createData = await createRes.json();
  return createData.id;
}

async function getFileId(token, filename, parentId) {
  // ── BUG FIX: q= must be URL-encoded (same issue as getOrCreateFolder above)
  const q = encodeURIComponent(
    `name='${filename}' and '${parentId}' in parents and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
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
    if (!fileId) return null; // File doesn't exist yet
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
    if (!res.ok) {
      console.error(`Drive: write failed for "${filename}":`, res.status, result?.error?.message || result);
      return null;
    }
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
