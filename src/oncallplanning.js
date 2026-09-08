// src/oncallplanning.js
//
// "OnCall Planning DS" — the shared cross-region on-call planning workbook.
// This is a STANDALONE module/page: it does not require any changes to
// App.js, Rota.js, or Payroll.js. It manages its own Google Drive
// connection and pulls the Rota/user data it needs directly from Drive
// (via driveRead, same as everything else in this app) rather than being
// handed them as props. Wire it in however you like later (a new nav item,
// a modal, a separate route) — until then it also works perfectly well
// opened on its own.
//
// This sheet is NOT owned by CloudOps Rota — it's a wider planning document
// covering every region/service (AP, EMEA, IND, FR, Service Controller,
// Container Farm, SaaS Messaging, PartSupplyContent, PSPresentation, SIMULIA
// Grid, Web Content, etc). CloudOps Rota only owns two columns in it:
//   - "Cloud RUN Daily UK"              (the UK team's `daily` shift trigram)
//   - "CloudRUN UK non Business Hours"  (the UK team's `evening`/`weekend` trigram)
// Together these are referred to as "GBR2" (the UK team's columns).
//
// Two ways data gets into the master workbook:
//   1. GENERATE FROM ROTA  — regenerates the two GBR2/UK columns from the
//      CloudOps rota data. Never touches any other column.
//   2. UPLOAD EXCEL        — a re-exported/updated master sheet from the wider
//      (non-UK) planning process. On upload, its values FULLY REPLACE every
//      non-UK column's cell values in the master file (per row). It never
//      touches the two GBR2/UK columns — those stay exactly what Rota
//      generated, even if the uploaded sheet has different values in them.
//
// Format & colours are never touched by either path — only `.value` is ever
// written on an existing cell; `.style` (fill/font/border/numFmt/alignment)
// is left completely alone. New rows (a week that doesn't exist in the sheet
// yet) get their style CLONED from the nearest existing row of the same
// Period type, so new rows still look right.
//
// Storage: the actual .xlsx bytes are round-tripped through Google Drive via
// driveReadBinary/driveWriteBinary (see useGoogleDrive.js) under the
// 'oncallPlanning' key — NOT reinterpreted as JSON, so nothing here can ever
// silently degrade the workbook's formatting.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import ExcelJS from 'exceljs';
import {
  driveReadBinary, driveWriteBinary, driveRead, DriveConflictError,
  initGoogleAuth, gapiLoad,
} from './hooks/useGoogleDrive';

// Default OAuth client — same one CloudOps Rota itself uses, so a person who's
// already a Test user on that OAuth consent screen doesn't need adding again.
// Override via REACT_APP_GOOGLE_CLIENT_ID if this ever needs to be a separate
// Google Cloud project.
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '771489989549-di3h0cglt71ed7hmgtknksm3ks0afdtj.apps.googleusercontent.com';

// ── Config ────────────────────────────────────────────────────────────────

// The two columns this app is allowed to generate/overwrite. Matched against
// the workbook's actual header row text (trimmed, case-insensitive), NOT by
// fixed column letter — so re-ordering columns in the sheet doesn't break
// this. If your header text ever changes, update these two strings (or set
// appSettings.oncallPlanning.ukColumns to override without a code change).
const DEFAULT_UK_COLUMNS = ['Cloud RUN Daily UK', 'CloudRUN UK non Business Hours'];

// Header row anchor columns used to identify/key every data row.
const KEY_COLUMNS = ['Month', 'Week', 'Period'];

// Which worksheet to use. Defaults to the workbook's first sheet.
const DEFAULT_SHEET_NAME = null; // null = first sheet

function ukColumnsFor(appSettings) {
  const configured = appSettings?.oncallPlanning?.ukColumns;
  return (configured && configured.length) ? configured : DEFAULT_UK_COLUMNS;
}

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

// ── Date / week helpers ──────────────────────────────────────────────────
// Timezone-safe per project convention: always parse via T12:00:00, never
// `new Date(dateStr)` directly.

function parseDs(ds) {
  return new Date(ds + 'T12:00:00');
}

// ISO-8601 week number (Mon-Sun weeks, week 1 = week containing the year's
// first Thursday). Matches the "Week" numbers shown in the planning sheet.
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
}

// Month label follows the sheet's own convention (verified against the real
// workbook): NOT simply the Monday's month — it's whichever calendar month
// contains the MAJORITY of that ISO week's 7 days. E.g. the week of Mon 31
// Aug–Sun 6 Sep 2026 is labeled "September" (6 of 7 days), and the week of
// Mon 28 Sep–Sun 4 Oct 2026 is labeled "October" (4 of 7 days) — a plain
// "month of the Monday" would get both of those wrong. A 7-day week always
// has a clear majority (no tie is possible), so no tie-break is needed.
function majorityMonthOfWeek(monday) {
  const counts = {};
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  let bestKey = null, bestCount = 0;
  Object.entries(counts).forEach(([k, c]) => { if (c > bestCount) { bestKey = k; bestCount = c; } });
  const [year, month] = bestKey.split('-').map(Number);
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long' });
}

function toDs(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Every Monday between startDs and endDs (inclusive), used to walk week-by-week.
function mondaysInRange(startDs, endDs) {
  const start = parseDs(startDs);
  const end = parseDs(endDs);
  const mondays = [];
  let d = new Date(start);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d = addDays(d, -dow); // rewind to the Monday on/before start
  while (d <= end) {
    mondays.push(new Date(d));
    d = addDays(d, 7);
  }
  return mondays;
}

// ── Rota → date/shift lookup ─────────────────────────────────────────────

// Inverts rota = { [userId]: { [dateStr]: shiftType } } into
// { [dateStr]: { [shiftType]: userId } } so "who's on X shift on date Y" is
// a single lookup instead of scanning every user for every date.
function buildDateShiftMap(rota) {
  const map = {};
  Object.entries(rota || {}).forEach(([uid, byDate]) => {
    Object.entries(byDate || {}).forEach(([ds, shift]) => {
      if (!shift || shift === 'off') return;
      if (!map[ds]) map[ds] = {};
      // If two people are somehow marked for the same shift/date (shouldn't
      // happen, but rota edits can be messy) keep the first and don't crash.
      if (!map[ds][shift]) map[ds][shift] = uid;
    });
  });
  return map;
}

// Picks the user id that covers `shiftType` on the most days within `dates`.
// A single on-call block is normally the same person every day, but this
// tolerates a mid-block swap by taking the majority rather than just day 1.
function dominantUidForShift(dateShiftMap, dates, shiftType) {
  const counts = {};
  dates.forEach(ds => {
    const uid = dateShiftMap[ds]?.[shiftType];
    if (uid) counts[uid] = (counts[uid] || 0) + 1;
  });
  let best = null, bestCount = 0;
  Object.entries(counts).forEach(([uid, c]) => {
    if (c > bestCount) { best = uid; bestCount = c; }
  });
  return best; // null if nobody was on that shift for any of these dates
}

// Builds the { month, week, period, ukDaily, ukNonBH } rows CloudOps Rota is
// responsible for, one "Week" row + one "WE" row per ISO week in range.
//   - Week row:  ukDaily = dominant `daily` uid Mon–Fri
//                ukNonBH = dominant `evening` uid Mon–Thu
//   - WE  row:   ukNonBH = dominant `weekend` uid Fri–Mon (WE has no daily column)
export function generateUKRowsFromRota(rota, users, startDs, endDs) {
  const dateShiftMap = buildDateShiftMap(rota);
  const uidToTrigram = (uid) => uid || ''; // u.id IS the trigram in this app
  const rows = [];

  mondaysInRange(startDs, endDs).forEach(monday => {
    const weekdays = [0, 1, 2, 3, 4].map(i => toDs(addDays(monday, i))); // Mon..Fri
    const wdOnCallDays = [0, 1, 2, 3].map(i => toDs(addDays(monday, i))); // Mon..Thu evenings
    const weekendDays = [4, 5, 6, 7].map(i => toDs(addDays(monday, i))); // Fri..Mon

    const week = isoWeekNumber(monday);
    const month = majorityMonthOfWeek(monday);

    const ukDaily = uidToTrigram(dominantUidForShift(dateShiftMap, weekdays, 'daily'));
    const ukWdOnCall = uidToTrigram(dominantUidForShift(dateShiftMap, wdOnCallDays, 'evening'));
    const ukWeOnCall = uidToTrigram(dominantUidForShift(dateShiftMap, weekendDays, 'weekend'));

    rows.push({ month, week, period: 'Week', ukDaily, ukNonBH: ukWdOnCall });
    rows.push({ month, week, period: 'WE',   ukDaily: '',  ukNonBH: ukWeOnCall });
  });

  return rows;
}

// ── Workbook helpers ─────────────────────────────────────────────────────

function getSheet(workbook, sheetName) {
  return sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
}

// { 'cloud run daily uk': 3, ... } — normalized header text -> column index
function buildHeaderMap(worksheet) {
  const map = {};
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    const key = norm(cell.value);
    if (key) map[key] = colNumber;
  });
  return map;
}

// 'week|period' -> row number, for every existing data row (row 2+)
function buildRowIndexMap(worksheet, headerMap) {
  const weekCol = headerMap[norm('Week')];
  const periodCol = headerMap[norm('Period')];
  const map = {};
  if (!weekCol || !periodCol) return map;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const week = row.getCell(weekCol).value;
    const period = row.getCell(periodCol).value;
    if (week == null || period == null || period === '') return;
    map[`${week}|${norm(period)}`] = rowNumber;
  });
  return map;
}

// Clones every cell's .style (fill, font, border, numFmt, alignment — NOT
// value) from templateRow onto targetRow, column by column.
function cloneRowStyle(templateRow, targetRow, colCount) {
  for (let col = 1; col <= colCount; col++) {
    const src = templateRow.getCell(col);
    targetRow.getCell(col).style = { ...src.style };
  }
}

// Finds the best template row to clone style from for a NEW row of the given
// period type ('week' or 'we') — prefers the most recently added row of the
// same period so shading/format stays consistent with the rest of the sheet.
function findTemplateRow(worksheet, headerMap, period) {
  const periodCol = headerMap[norm('Period')];
  if (!periodCol) return worksheet.getRow(2); // fallback
  let best = null;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (norm(row.getCell(periodCol).value) === norm(period)) best = row;
  });
  return best || worksheet.getRow(2);
}

// Finds an existing row matching (week, period), or creates a new one at the
// bottom of the sheet with style cloned from the nearest row of the same
// period type. Returns the ExcelJS Row object.
function findOrCreateRow(worksheet, headerMap, rowIndexMap, week, period, colCount) {
  const key = `${week}|${norm(period)}`;
  if (rowIndexMap[key]) return worksheet.getRow(rowIndexMap[key]);

  const template = findTemplateRow(worksheet, headerMap, period);
  const newRowNumber = worksheet.rowCount + 1;
  const newRow = worksheet.getRow(newRowNumber);
  cloneRowStyle(template, newRow, colCount);
  newRow.commit();
  rowIndexMap[key] = newRowNumber;
  return newRow;
}

// ── GENERATE FROM ROTA ───────────────────────────────────────────────────
// Writes ONLY the UK/GBR2 columns for the given generated rows. Every other
// cell (value AND style) in the sheet is left completely untouched.
export function applyUKGeneration(workbook, generatedRows, appSettings, sheetName = DEFAULT_SHEET_NAME) {
  const worksheet = getSheet(workbook, sheetName);
  if (!worksheet) throw new Error('OnCall Planning workbook has no worksheet to write to.');
  const headerMap = buildHeaderMap(worksheet);
  const [ukDailyHeader, ukNonBHHeader] = ukColumnsFor(appSettings);
  const ukDailyCol = headerMap[norm(ukDailyHeader)];
  const ukNonBHCol = headerMap[norm(ukNonBHHeader)];
  const monthCol = headerMap[norm('Month')];
  const weekCol = headerMap[norm('Week')];
  const periodCol = headerMap[norm('Period')];

  const missing = [];
  if (!ukDailyCol) missing.push(ukDailyHeader);
  if (!ukNonBHCol) missing.push(ukNonBHHeader);
  if (!weekCol) missing.push('Week');
  if (!periodCol) missing.push('Period');
  if (missing.length) {
    throw new Error(`OnCall Planning: couldn't find column(s) in the sheet header: ${missing.join(', ')}. Nothing was changed.`);
  }

  const colCount = worksheet.columnCount;
  const rowIndexMap = buildRowIndexMap(worksheet, headerMap);

  generatedRows.forEach(({ month, week, period, ukDaily, ukNonBH }) => {
    const row = findOrCreateRow(worksheet, headerMap, rowIndexMap, week, period, colCount);
    if (monthCol && !row.getCell(monthCol).value) row.getCell(monthCol).value = month;
    if (!row.getCell(weekCol).value) row.getCell(weekCol).value = week;
    if (!row.getCell(periodCol).value) row.getCell(periodCol).value = period;
    // Only ever set UK cells if we actually have a value — an empty string
    // from a day with nobody on rota should not blank out a value someone
    // already entered by hand for a day the Rota doesn't know about yet.
    if (ukDaily) row.getCell(ukDailyCol).value = ukDaily;
    if (ukNonBH) row.getCell(ukNonBHCol).value = ukNonBH;
    row.commit();
  });

  return worksheet;
}

// ── UPLOAD EXCEL (full replace of all non-UK columns) ────────────────────
// For every row present in the uploaded workbook, every column EXCEPT the
// UK/GBR2 columns has its value fully replaced with whatever the upload
// contains for that row+column (including blanking a cell if the upload has
// it blank — this is a full replace, not a "only fill in gaps" merge).
// Rows in the master that aren't present in the upload are left untouched.
// Columns present in the upload but not found in the master are skipped
// (never auto-added — changing sheet structure is out of scope) and
// reported back in `warnings` so they can be reconciled by hand.
export function applyUploadReplace(masterWorkbook, uploadWorkbook, appSettings, sheetName = DEFAULT_SHEET_NAME) {
  const masterWs = getSheet(masterWorkbook, sheetName);
  const uploadWs = getSheet(uploadWorkbook, sheetName);
  if (!masterWs) throw new Error('OnCall Planning workbook has no worksheet to write to.');
  if (!uploadWs) throw new Error('Uploaded file has no worksheet to read from.');

  const masterHeaderMap = buildHeaderMap(masterWs);
  const uploadHeaderMap = buildHeaderMap(uploadWs);
  const ukCols = new Set(ukColumnsFor(appSettings).map(norm));

  const weekColU = uploadHeaderMap[norm('Week')];
  const periodColU = uploadHeaderMap[norm('Period')];
  const monthColU = uploadHeaderMap[norm('Month')];
  if (!weekColU || !periodColU) {
    throw new Error('Uploaded file is missing a "Week" or "Period" column — cannot match rows. Nothing was changed.');
  }

  const colCount = masterWs.columnCount;
  const rowIndexMap = buildRowIndexMap(masterWs, masterHeaderMap);

  // Columns to actually copy: present in BOTH sheets, and not a UK column.
  const warnings = [];
  const copyCols = []; // [{ headerText, uploadCol, masterCol }]
  Object.entries(uploadHeaderMap).forEach(([headerKey, uploadCol]) => {
    if (KEY_COLUMNS.some(k => norm(k) === headerKey)) return; // Month/Week/Period are keys, not data
    if (ukCols.has(headerKey)) return; // GBR2/UK — protected, never touched by upload
    const masterCol = masterHeaderMap[headerKey];
    if (!masterCol) {
      warnings.push(`Column "${headerKey}" in the uploaded file has no matching column in the master sheet — skipped.`);
      return;
    }
    copyCols.push({ uploadCol, masterCol });
  });

  let rowsUpdated = 0, rowsCreated = 0;
  uploadWs.eachRow((uploadRow, rowNumber) => {
    if (rowNumber === 1) return; // header
    const week = uploadRow.getCell(weekColU).value;
    const period = uploadRow.getCell(periodColU).value;
    if (week == null || period == null || period === '') return;

    const key = `${week}|${norm(period)}`;
    const isNew = !rowIndexMap[key];
    const masterRow = findOrCreateRow(masterWs, masterHeaderMap, rowIndexMap, week, period, colCount);
    if (isNew) {
      rowsCreated++;
      const monthCol = masterHeaderMap[norm('Month')];
      const weekCol = masterHeaderMap[norm('Week')];
      const periodCol = masterHeaderMap[norm('Period')];
      if (monthCol && monthColU) masterRow.getCell(monthCol).value = uploadRow.getCell(monthColU).value;
      if (weekCol) masterRow.getCell(weekCol).value = week;
      if (periodCol) masterRow.getCell(periodCol).value = period;
    } else {
      rowsUpdated++;
    }

    copyCols.forEach(({ uploadCol, masterCol }) => {
      masterRow.getCell(masterCol).value = uploadRow.getCell(uploadCol).value; // value only — never .style
    });
    masterRow.commit();
  });

  return { worksheet: masterWs, warnings, rowsUpdated, rowsCreated };
}

// ── Drive I/O ─────────────────────────────────────────────────────────────

export async function loadPlanningWorkbook(driveToken) {
  const buf = await driveReadBinary(driveToken, 'oncallPlanning');
  const workbook = new ExcelJS.Workbook();
  if (buf && buf.byteLength > 0) {
    await workbook.xlsx.load(buf);
    return { workbook, isNew: false };
  }
  // No file yet — start a blank workbook with the header row this app knows
  // about. A manager should normally upload the real master sheet first;
  // this is just a safety net so "Generate from Rota" doesn't hard-fail.
  const ws = workbook.addWorksheet('Planning');
  ws.addRow(['Month', 'Week', 'Period', ...DEFAULT_UK_COLUMNS]);
  return { workbook, isNew: true };
}

export async function savePlanningWorkbook(driveToken, workbook, opts = {}) {
  const buf = await workbook.xlsx.writeBuffer();
  return driveWriteBinary(driveToken, 'oncallPlanning', buf, opts);
}

export async function loadUploadedWorkbook(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  return workbook;
}

// ── Preview (for the on-screen table) ────────────────────────────────────
// Converts an ExcelJS worksheet into plain rows/cells (value + resolved CSS
// background colour + bold flag) so the React table below can render
// something that actually LOOKS like the source sheet, without touching the
// real workbook object (this is read-only, display data).
function argbToCss(argb) {
  if (!argb || argb.length < 6) return null;
  const hex = argb.length === 8 ? argb.slice(2) : argb; // drop alpha if present
  return `#${hex}`;
}

export function buildPreview(workbook, sheetName = DEFAULT_SHEET_NAME, maxRows = 60) {
  const worksheet = getSheet(workbook, sheetName);
  if (!worksheet) return { headers: [], rows: [] };
  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell((cell) => headers.push(String(cell.value ?? '')));

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (rows.length >= maxRows) return;
    const cells = [];
    for (let col = 1; col <= headers.length; col++) {
      const cell = row.getCell(col);
      const fillArgb = cell.fill?.fgColor?.argb;
      cells.push({
        value: cell.value == null ? '' : String(cell.value),
        bg: argbToCss(fillArgb),
        bold: !!cell.font?.bold,
      });
    }
    rows.push(cells);
  });
  return { headers, rows };
}

// ── React component ──────────────────────────────────────────────────────
// Fully standalone: manages its own Google Drive sign-in and pulls rota/
// users/appSettings itself. Every prop below is OPTIONAL — pass driveToken/
// users/rota/appSettings/isManager later if you wire this into App.js's own
// state, and this component will use those instead of fetching its own
// copies. Until then, `<OnCallPlanning />` with no props at all works.

const TOKEN_KEY = 'gdrive_token';
const TOKEN_TS_KEY = 'gdrive_token_ts';
const TOKEN_TTL_MS = 50 * 60 * 1000; // matches the rest of the app's cache window

function getCachedToken() {
  try {
    const cached = sessionStorage.getItem(TOKEN_KEY);
    const ts = parseInt(sessionStorage.getItem(TOKEN_TS_KEY) || '0', 10);
    if (cached && (Date.now() - ts) < TOKEN_TTL_MS) return cached;
  } catch (_) {}
  return null;
}

export default function OnCallPlanning({
  users: usersProp, rota: rotaProp, appSettings: appSettingsProp,
  driveToken: driveTokenProp, isManager: isManagerProp,
}) {
  // ── Own Drive connection (only used if driveToken isn't passed in) ─────
  const [ownToken, setOwnToken] = useState(() => getCachedToken());
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const driveToken = driveTokenProp || ownToken;

  const connectDrive = useCallback(async () => {
    setConnecting(true);
    setConnectError('');
    try {
      await gapiLoad();
      const token = await initGoogleAuth(GOOGLE_CLIENT_ID);
      try {
        sessionStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(TOKEN_TS_KEY, String(Date.now()));
      } catch (_) {}
      setOwnToken(token);
    } catch (e) {
      console.error('Drive connect error:', e);
      setConnectError('Could not connect to Google Drive. Please try again.');
    } finally {
      setConnecting(false);
    }
  }, []);

  // ── Own rota/users/appSettings (only fetched if not passed in) ─────────
  const [ownRota, setOwnRota] = useState(null);
  const [ownUsers, setOwnUsers] = useState(null);
  const [ownAppSettings, setOwnAppSettings] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);

  const rota = rotaProp || ownRota || {};
  const users = usersProp || ownUsers || [];
  const appSettings = appSettingsProp || ownAppSettings || {};
  const isManager = isManagerProp !== undefined ? isManagerProp : true; // standalone: Drive sharing is the real access gate

  const loadOwnData = useCallback(async (token) => {
    if (rotaProp && usersProp) return; // host app already supplies these — nothing to fetch
    setDataLoading(true);
    try {
      const [r, u, s] = await Promise.all([
        rotaProp ? null : driveRead(token, 'rota'),
        usersProp ? null : driveRead(token, 'users'),
        appSettingsProp ? null : driveRead(token, 'appSettings'),
      ]);
      if (!rotaProp) setOwnRota(r || {});
      if (!usersProp) setOwnUsers(u || []);
      if (!appSettingsProp) setOwnAppSettings(s || {});
    } catch (e) {
      console.error('Could not load rota/users from Drive:', e);
    } finally {
      setDataLoading(false);
    }
  }, [rotaProp, usersProp, appSettingsProp]);

  const workbookRef = useRef(null); // the live ExcelJS.Workbook — not React state (too heavy/non-serializable to re-render on)
  const [preview, setPreview] = useState({ headers: [], rows: [] });
  const [status, setStatus] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const refreshPreview = useCallback(() => {
    if (workbookRef.current) setPreview(buildPreview(workbookRef.current));
  }, []);

  useEffect(() => {
    if (!driveToken) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadOwnData(driveToken);
        const { workbook, isNew } = await loadPlanningWorkbook(driveToken);
        if (cancelled) return;
        workbookRef.current = workbook;
        setStatus(isNew
          ? 'No planning workbook found in Drive yet — starting a blank one. Upload the master sheet or generate from Rota to begin.'
          : 'Loaded the current planning workbook from Drive.');
        setPreview(buildPreview(workbook));
      } catch (e) {
        console.error(e);
        setStatus(`Couldn't load the planning workbook: ${e.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [driveToken, loadOwnData]);

  // Saves with one automatic retry-after-reload if another session changed
  // the file since we last read it (see DriveConflictError in useGoogleDrive.js).
  const saveWithConflictRetry = useCallback(async () => {
    try {
      await savePlanningWorkbook(driveToken, workbookRef.current);
    } catch (e) {
      if (e instanceof DriveConflictError) {
        throw new Error('Someone else saved the planning workbook while you were editing it. Reload the page and try again so your change applies on top of theirs.');
      }
      throw e;
    }
  }, [driveToken]);

  const handleGenerate = useCallback(async () => {
    if (!workbookRef.current) return;
    setBusy(true);
    setWarnings([]);
    try {
      // Default range: 6 months back to 3 months forward from today, covering
      // whatever's actually in the rota. Adjust if you want a fixed cycle.
      const today = new Date();
      const startDs = toDs(addDays(today, -182));
      const endDs = toDs(addDays(today, 90));
      const generatedRows = generateUKRowsFromRota(rota, users, startDs, endDs);
      applyUKGeneration(workbookRef.current, generatedRows, appSettings);
      await saveWithConflictRetry();
      refreshPreview();
      setStatus(`Generated ${generatedRows.length} UK rows from the Rota and saved to Drive.`);
    } catch (e) {
      console.error(e);
      setStatus(`Generate failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [rota, users, appSettings, saveWithConflictRetry, refreshPreview]);

  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !workbookRef.current) return;
    setBusy(true);
    setWarnings([]);
    try {
      const uploadWb = await loadUploadedWorkbook(file);
      const { warnings: w, rowsUpdated, rowsCreated } =
        applyUploadReplace(workbookRef.current, uploadWb, appSettings);
      await saveWithConflictRetry();
      refreshPreview();
      setWarnings(w);
      setStatus(`Upload applied: ${rowsUpdated} row(s) updated, ${rowsCreated} new row(s) added. UK columns were left untouched. Saved to Drive.`);
    } catch (e) {
      console.error(e);
      setStatus(`Upload failed: ${e.message}`);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [appSettings, saveWithConflictRetry, refreshPreview]);

  const handleDownload = useCallback(async () => {
    if (!workbookRef.current) return;
    const buf = await workbookRef.current.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oncall-planning.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (!driveToken) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ margin: 0, marginBottom: 12 }}>OnCall Planning DS</h2>
        <p style={{ opacity: 0.85, marginBottom: 12 }}>
          Connect Google Drive to load the shared planning workbook.
        </p>
        <button onClick={connectDrive} disabled={connecting}>
          {connecting ? 'Connecting…' : 'Connect Google Drive'}
        </button>
        {connectError && <div style={{ marginTop: 8, color: '#c0392b', fontSize: 13 }}>{connectError}</div>}
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>OnCall Planning DS</h2>
        {isManager && (
          <>
            <button onClick={handleGenerate} disabled={busy || loading}>
              {busy ? 'Working…' : 'Generate UK columns from Rota'}
            </button>
            <button onClick={() => fileInputRef.current?.click()} disabled={busy || loading}>
              Upload Excel (replaces all non-UK columns)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleUpload}
              style={{ display: 'none' }}
            />
          </>
        )}
        <button onClick={handleDownload} disabled={loading || !workbookRef.current}>
          Download current sheet
        </button>
      </div>

      {status && <div style={{ marginBottom: 8, fontSize: 13, opacity: 0.85 }}>{status}</div>}
      {warnings.length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 13, color: '#c0392b' }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #333' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr>
                {preview.headers.map((h, i) => (
                  <th key={i} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '2px solid #333', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{
                        padding: '3px 8px',
                        background: cell.bg || 'transparent',
                        fontWeight: cell.bold ? 700 : 400,
                        whiteSpace: 'nowrap',
                        border: '1px solid #eee2',
                      }}
                    >
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
