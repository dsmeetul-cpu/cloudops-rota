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
  permTemplates: 'permTemplates.json',
  timekeeping:   'timekeeping.json',
  announcements: 'announcements.json',
  handoverNotes: 'handoverNotes.json',
  calendarEvents:'calendarEvents.json',
  userCalendars: 'userCalendars.json',
  // ── FIX: payrollAdjustments is fully wired up in App.js (state, save
  // effect, manual sync, load) but was missing here — every save/load for
  // it was throwing "Unknown key: payrollAdjustments" ──────────────────────
  payrollAdjustments: 'payrollAdjustments.json',
};

let folderId = null;
let fileIds = {};

// ── Conflict / concurrency tracking ──────────────────────────────────────────
// Drive's `modifiedTime` on each file lets us detect "someone else saved this
// file since I last read it" WITHOUT storing anything locally — we just ask
// Drive for the file's current metadata before we overwrite it.
let fileMeta = {}; // key -> { modifiedTime }

// Thrown when a write is about to clobber a change made by another session.
// Callers should re-read the file, merge their change on top of the latest
// version, and retry — never blind-overwrite.
export class DriveConflictError extends Error {
  constructor(key) {
    super(`Drive file for "${key}" was changed by another session since it was last read.`);
    this.name = 'DriveConflictError';
    this.key = key;
  }
}

// ── Per-key write queue ──────────────────────────────────────────────────────
// Every save() in App.js fires its own useEffect the instant state changes.
// Without a queue, two rapid edits to the SAME file produce two overlapping
// network requests, and whichever response lands last "wins" — even if it
// was the older write. That silently discards the newer data.
// This queue forces all writes to a given key to run strictly one-at-a-time,
// in the order they were requested.
let writeQueues = {};

function enqueue(key, task) {
  const prev = writeQueues[key] || Promise.resolve();
  const run = prev.then(task, task); // run task regardless of previous outcome
  // Swallow the error here so the QUEUE itself never gets stuck; the actual
  // error is still delivered to the caller via the returned promise below.
  writeQueues[key] = run.catch(() => {});
  return run;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// ── OPTIMISATION: bulk-load all file IDs in one query ────────────────────────
// One files.list request returns every file in the folder and pre-warms the
// fileIds cache, so no individual getFileId searches are needed during load.
async function bulkLoadFileIds(token, parentId) {
  let pageToken = null;
  const all     = [];
  do {
    const url = `https://www.googleapis.com/drive/v3/files`
      + `?q=${encodeURIComponent(`'${parentId}' in parents and trashed=false`)}`
      + `&fields=nextPageToken,files(id,name,modifiedTime)&pageSize=100`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.files) all.push(...data.files);
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  // Populate fileIds + fileMeta cache from filename → key lookup.
  // Recording modifiedTime here means the very first write after login
  // already has a correct baseline for the conflict check in driveWrite.
  const byName = {};
  all.forEach(f => { byName[f.name] = f; });
  Object.entries(FILES).forEach(([key, filename]) => {
    const f = byName[filename];
    if (f) {
      fileIds[key] = f.id;
      if (f.modifiedTime) fileMeta[key] = { modifiedTime: f.modifiedTime };
    }
  });
}

// ── Read / Write ─────────────────────────────────────────────────────────────

// Fetch just the metadata (id + modifiedTime) for a file, cheap and fast —
// used to check "has this changed since I last read it?" before writing.
async function getFileMeta(token, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,modifiedTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  return res.json();
}

export async function driveRead(token, key) {
  try {
    if (!folderId) folderId = await getOrCreateFolder(token);
    const filename = FILES[key];
    if (!filename) throw new Error('Unknown key: ' + key);
    let fileId = fileIds[key] || await getFileId(token, filename, folderId);
    if (!fileId) return null; // File doesn't exist yet
    fileIds[key] = fileId;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&_t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Record what version of the file we just read, so a later write can
    // detect whether someone else has changed it in the meantime.
    const meta = await getFileMeta(token, fileId).catch(() => null);
    if (meta?.modifiedTime) fileMeta[key] = { modifiedTime: meta.modifiedTime };
    return data;
  } catch (e) {
    console.error('Drive read error:', e);
    return null;
  }
}

// Single retryable write attempt. Throws on failure/conflict instead of
// swallowing the error, so callers (and the UI) know a save genuinely failed.
async function writeOnce(token, key, data, { skipConflictCheck = false } = {}) {
  if (!folderId) folderId = await getOrCreateFolder(token);
  const filename = FILES[key];
  if (!filename) throw new Error('Unknown key: ' + key);
  let fileId = fileIds[key] || await getFileId(token, filename, folderId);

  // ── Conflict check ─────────────────────────────────────────────────────
  // If we have a record of this file's last-known modifiedTime AND the live
  // Drive copy has a NEWER modifiedTime than that, another session/tab has
  // saved since we last read — overwriting now would silently discard their
  // change. Bail out with a DriveConflictError so the caller can re-read,
  // merge, and retry instead of blindly clobbering it.
  if (fileId && !skipConflictCheck && fileMeta[key]?.modifiedTime) {
    const liveMeta = await getFileMeta(token, fileId).catch(() => null);
    if (liveMeta?.modifiedTime && liveMeta.modifiedTime !== fileMeta[key].modifiedTime) {
      throw new DriveConflictError(key);
    }
  }

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
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,modifiedTime`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime';
  const method = fileId ? 'PATCH' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const result = await res.json();
  if (!res.ok) {
    const msg = result?.error?.message || res.statusText;
    console.error(`Drive: write failed for "${filename}":`, res.status, msg);
    throw new Error(`Drive write failed for ${filename}: ${msg}`);
  }
  if (result.id) fileIds[key] = result.id;
  if (result.modifiedTime) fileMeta[key] = { modifiedTime: result.modifiedTime };
  return result;
}

// Public driveWrite: queued (never overlaps another write to the same key)
// and retried with backoff on transient failures (network blips, 429s, etc).
// Throws (does not silently return null) if all retries are exhausted, so
// the UI can show the save actually failed instead of pretending it worked.
export async function driveWrite(token, key, data, opts = {}) {
  return enqueue(key, async () => {
    const maxAttempts = 3;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await writeOnce(token, key, data, opts);
      } catch (e) {
        lastErr = e;
        // Conflicts aren't transient — retrying the SAME write will just
        // conflict again. Surface immediately so the caller can merge.
        if (e instanceof DriveConflictError) throw e;
        if (attempt < maxAttempts) await sleep(500 * Math.pow(3, attempt - 1)); // 500ms, 1.5s
      }
    }
    throw lastErr;
  });
}

// ── Load all data from Drive ─────────────────────────────────────────────────
// Before: sequential for-loop  → 24 files × ~300 ms = ~7 s
// After:  1 folder list (pre-warms all IDs) + Promise.all = ~1-2 s

export async function loadAllFromDrive(token, defaults) {
  // Step 1 — ensure folder ID is resolved
  if (!folderId) folderId = await getOrCreateFolder(token);

  // Step 2 — one query fetches all file IDs and pre-warms the cache
  await bulkLoadFileIds(token, folderId);

  // Step 3 — fetch all file contents in parallel
  const keys    = Object.keys(FILES);
  const results = await Promise.all(
    keys.map(async (key) => {
      try {
        const fileId = fileIds[key];
        if (!fileId) return null; // file doesn't exist yet (first run)
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    })
  );

  // Step 4 — assemble result, falling back to defaults for missing files
  const result = {};
  keys.forEach((key, i) => {
    result[key] = results[i] !== null ? results[i] : (defaults[key] ?? null);
  });
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
