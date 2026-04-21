// src/hooks/useGoogleDrive.js
// Google Drive API integration — stores all data as JSON files in Drive
// AND mirrors every data key to a named tab in a master Google Sheet.
//
// Scope notes:
//   drive          — full read/write to all files (needed to update files not
//                    created by this app, e.g. manually-uploaded JSON files)
//   spreadsheets   — read/write Google Sheets (required for the Sheets API calls)
//
// Previously drive.file was used but that only covers files the app created
// via the API itself — it cannot PATCH manually-uploaded files, which caused
// all writes to silently fail even when the token appeared valid.
const SCOPES =
  'https://www.googleapis.com/auth/drive ' +
  'https://www.googleapis.com/auth/spreadsheets';

export { SCOPES }; // App.js silent-auth useEffect must use this same string

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
  swapRequests:  'swapRequests.json',
  toil:          'toil.json',
  absences:      'absences.json',
  overtime:      'overtime.json',
  logbook:       'logbook.json',
  documents:     'documents.json',
  obsidianNotes: 'obsidianNotes.json',
  whatsappChats: 'whatsappChats.json',
};

// Hardcoded shared folder — all JSON files and the master Sheet live here
const SHARED_FOLDER_ID = '1MLKyzsfxH3vRb1lthOlN7aLp3bltb59C';

// Name of the master Google Sheet that mirrors all JSON data
const MASTER_SHEET_NAME = 'CloudOps-Data';

// Module-level caches (reset on page reload)
let fileIds     = {};   // Drive file ID cache per key
let _sheetId    = null; // Master spreadsheet ID cache

// ── Auth ─────────────────────────────────────────────────────────────────────

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
    if (window.gapi?.client?.drive) { resolve(); return; }
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

// ── Drive file lookup ─────────────────────────────────────────────────────────

async function getFileId(token, filename) {
  const q = encodeURIComponent(
    `name='${filename}' and '${SHARED_FOLDER_ID}' in parents and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`Drive: getFileId failed for "${filename}":`, res.status, err?.error?.message || err);
    return null;
  }
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;
  console.warn(`Drive: "${filename}" not found in folder ${SHARED_FOLDER_ID}`);
  return null;
}

// ── Read / Write ──────────────────────────────────────────────────────────────

export async function driveRead(token, key) {
  try {
    const filename = FILES[key];
    if (!filename) throw new Error('Unknown key: ' + key);
    let fileId = fileIds[key] || await getFileId(token, filename);
    if (!fileId) { console.warn('Drive: file not found:', filename); return null; }
    fileIds[key] = fileId;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`Drive: read failed for "${filename}":`, res.status, err?.error?.message || err);
      // Clear cached ID in case the file was deleted and recreated
      delete fileIds[key];
      return null;
    }
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
    let fileId = fileIds[key] || await getFileId(token, filename);
    const body = JSON.stringify(data, null, 2);
    const blob = new Blob([body], { type: 'application/json' });
    const form = new FormData();
    form.append(
      'metadata',
      new Blob(
        [JSON.stringify(fileId ? { name: filename } : { name: filename, parents: [SHARED_FOLDER_ID] })],
        { type: 'application/json' }
      )
    );
    form.append('file', blob);
    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&supportsAllDrives=true`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`;
    const method = fileId ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`Drive: write failed for "${filename}":`, res.status, err?.error?.message || err);
      return null;
    }
    const result = await res.json();
    if (result.id) fileIds[key] = result.id;
    return result;
  } catch (e) {
    console.error('Drive write error:', e);
    return null;
  }
}

// ── Load all data from Drive ───────────────────────────────────────────────────

export async function loadAllFromDrive(token, defaults) {
  const result = {};
  for (const key of Object.keys(FILES)) {
    const data = await driveRead(token, key);
    result[key] = data !== null ? data : (defaults[key] ?? null);
  }
  return result;
}

// ── Master Google Sheet ───────────────────────────────────────────────────────
// All data keys are mirrored to tabs in a single "CloudOps-Data" spreadsheet
// that lives in the same shared folder. Each tab is human-readable and
// editable — use syncAllFromSheet to pull edits back into the app.

/** Find or create the master "CloudOps-Data" spreadsheet in the shared folder. */
export async function getOrCreateMasterSheet(token) {
  if (_sheetId) return _sheetId;

  // Search for existing sheet in the folder
  const q = encodeURIComponent(
    `name='${MASTER_SHEET_NAME}' and '${SHARED_FOLDER_ID}' in parents ` +
    `and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (searchRes.ok) {
    const { files } = await searchRes.json();
    if (files && files.length > 0) {
      _sheetId = files[0].id;
      console.log('Sheet: found existing master sheet', _sheetId);
      return _sheetId;
    }
  }

  // Create a new spreadsheet with a tab for every data key
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: MASTER_SHEET_NAME },
      sheets: Object.keys(FILES).map((key, i) => ({
        properties: { sheetId: i + 1, title: key },
      })),
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    console.error('Sheet: create failed:', err?.error?.message || err);
    return null;
  }
  const sheet = await createRes.json();
  _sheetId = sheet.spreadsheetId;

  // Move into the shared folder so all team members can access it
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${_sheetId}` +
    `?addParents=${SHARED_FOLDER_ID}&removeParents=root&fields=id,parents`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }
  );

  console.log('Sheet: created master sheet', _sheetId);
  return _sheetId;
}

/** Convert any data value into a 2-D array of strings suitable for a Sheet. */
function dataToRows(key, data) {
  if (data === null || data === undefined) return [['(no data)']];

  // ── Special-case structured types ──────────────────────────────────────────

  if (key === 'rota') {
    // { uid: { date: shift } }
    const rows = [['User ID', 'Date', 'Shift']];
    for (const [uid, days] of Object.entries(data)) {
      for (const [date, shift] of Object.entries(days || {})) {
        rows.push([uid, date, shift ?? '']);
      }
    }
    return rows;
  }

  if (key === 'timesheets') {
    // { uid: [{ week_start, daily_shifts, weekday_oncall, weekend_oncall, total_hours, notes }] }
    const rows = [['User ID', 'Week Start', 'Daily Shifts', 'Weekday On-Call', 'Weekend On-Call', 'Total Hours', 'Notes']];
    for (const [uid, sheets] of Object.entries(data)) {
      for (const s of (sheets || [])) {
        rows.push([
          uid,
          s.week_start       ?? '',
          s.daily_shifts     ?? 0,
          s.weekday_oncall   ?? 0,
          s.weekend_oncall   ?? 0,
          s.total_hours      ?? 0,
          s.notes            ?? '',
        ]);
      }
    }
    return rows;
  }

  if (key === 'toil') {
    // { uid: { balance, entries: [{ date, hours, type, notes }] } }
    const rows = [['User ID', 'Balance (hrs)', 'Entry Date', 'Hours', 'Type', 'Notes']];
    for (const [uid, toilData] of Object.entries(data)) {
      const balance = toilData?.balance ?? 0;
      const entries = toilData?.entries ?? [];
      if (entries.length === 0) {
        rows.push([uid, balance, '', '', '', '']);
      } else {
        for (const e of entries) {
          rows.push([uid, balance, e.date ?? '', e.hours ?? 0, e.type ?? '', e.notes ?? '']);
        }
      }
    }
    return rows;
  }

  if (key === 'payconfig') {
    // Flat config object
    const rows = [['Setting', 'Value']];
    for (const [k, v] of Object.entries(data)) {
      rows.push([k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')]);
    }
    return rows;
  }

  // ── Generic: flat array of objects ────────────────────────────────────────
  if (Array.isArray(data)) {
    if (data.length === 0) return [['(empty)']];
    const headers = Object.keys(data[0]);
    return [
      headers,
      ...data.map(item =>
        headers.map(h => {
          const v = item[h];
          return typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '');
        })
      ),
    ];
  }

  // ── Generic: plain object → key/value pairs ────────────────────────────────
  const rows = [['Key', 'Value']];
  for (const [k, v] of Object.entries(data)) {
    rows.push([k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')]);
  }
  return rows;
}

/**
 * Write one data key to its named tab in the master sheet.
 * Creates the tab if it doesn't exist yet.
 */
export async function syncKeyToSheet(token, sheetId, key, data) {
  if (!token || !sheetId) return;
  try {
    const rows = dataToRows(key, data);

    // Ensure the tab exists
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!metaRes.ok) return;
    const { sheets } = await metaRes.json();
    const tabExists = (sheets || []).some(s => s.properties.title === key);

    if (!tabExists) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: key } } }] }),
      });
    }

    // Clear the tab then write fresh data
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(key)}!A1:ZZ100000:clear`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    );
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(key)}!A1` +
      `?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }),
      }
    );

    // Bold the header row
    const tabMeta = (await (await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    )).json()).sheets?.find(s => s.properties.title === key);
    if (tabMeta) {
      const sid = tabMeta.properties.sheetId;
      const cols = rows[0].length;
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            repeatCell: {
              range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  backgroundColor: { red: 0.07, green: 0.21, blue: 0.37 },
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          }],
        }),
      });
    }
  } catch (e) {
    console.error(`Sheet: syncKeyToSheet failed for "${key}":`, e);
  }
}

/**
 * Sync ALL data keys to the master sheet in one pass.
 * Pass a progress callback (key, index, total) for UI feedback.
 */
export async function syncAllToSheet(token, sheetId, allData, onProgress) {
  const keys = Object.keys(FILES);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (onProgress) onProgress(key, i, keys.length);
    if (allData[key] !== undefined && allData[key] !== null) {
      await syncKeyToSheet(token, sheetId, key, allData[key]);
    }
  }
}

// ── User Registry Sheet (backwards-compatible, used by App.js) ───────────────
// Kept as a standalone function so App.js doesn't need refactoring.
// It writes to the master sheet's "users" tab as well as storing the sheet ID.

export async function syncUsersToMasterSheet(token, users) {
  try {
    const sheetId = await getOrCreateMasterSheet(token);
    if (!sheetId) return null;
    await syncKeyToSheet(token, sheetId, 'users', users);
    return sheetId;
  } catch (e) {
    console.error('Sheet: syncUsersToMasterSheet error:', e);
    return null;
  }
}

// ── iCal export ───────────────────────────────────────────────────────────────

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
    const label =
      shift === 'daily'   ? 'Daily On-Call (9am–6pm)'
      : shift === 'evening' ? 'Weekday Evening On-Call (7pm–7am)'
      : 'Weekend On-Call (7pm–7am)';
    const d   = date.replace(/-/g, '');
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
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
