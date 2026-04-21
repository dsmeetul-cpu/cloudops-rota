// src/hooks/useGoogleDrive.js
// Google Drive API integration - stores all data as JSON files in Drive
//
// ── KEY ARCHITECTURE DECISION ────────────────────────────────────────────────
// All app data lives in ONE shared folder owned by dsmeetul@gmail.com.
// The folder ID is hardcoded — reads ALWAYS come from this folder regardless
// of which Google account the engineer authenticates with.
// The folder must be shared as "Anyone with the link → Viewer" in Drive.
// Only the manager (MBA47) needs write access — engineers are read-only.
// ─────────────────────────────────────────────────────────────────────────────

const SCOPES = 'https://www.googleapis.com/auth/drive.file';

// ── Hardcoded shared folder — NEVER search for or create this ────────────────
// To find this ID: open the folder in Google Drive, copy the ID from the URL.
// URL format: https://drive.google.com/drive/folders/FOLDER_ID_HERE
const SHARED_FOLDER_ID = '1MLKyzsfxH3vRb1lthOlN7aLp3bltb59C';

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

// Cache file IDs so we don't re-query Drive on every read/write
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

// ── File ID lookup — always inside the hardcoded shared folder ───────────────
// getOrCreateFolder() has been intentionally removed.
// We never search for a folder by name — that would find the engineer's own
// Drive (which is empty) instead of the manager's shared folder.

async function getFileId(token, filename) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${filename}' and '${SHARED_FOLDER_ID}' in parents and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

// ── Read / Write ─────────────────────────────────────────────────────────────

export async function driveRead(token, key) {
  try {
    const filename = FILES[key];
    if (!filename) throw new Error('Unknown key: ' + key);
    // Always look inside the shared folder — never the engineer's own Drive
    let fileId = fileIds[key] || await getFileId(token, filename);
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
    const filename = FILES[key];
    if (!filename) throw new Error('Unknown key: ' + key);
    // Always write to the shared folder — never the engineer's own Drive
    let fileId = fileIds[key] || await getFileId(token, filename);
    const body = JSON.stringify(data, null, 2);
    const blob = new Blob([body], { type: 'application/json' });
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(
      fileId
        ? { name: filename }
        : { name: filename, parents: [SHARED_FOLDER_ID] }
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
