// src/Payroll.js
// CloudOps Rota — Payroll component (extracted from App.js)
// Manager-only payroll calculations, Excel export, cycle management

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { UK_BANK_HOLIDAYS } from './utils/defaults';

// ── On-call pay constants ─────────────────────────────────────────────────────
const ONCALL_STANDBY_RATE      = 5;    // £/hr flat
const ONCALL_WORKED_MULTIPLIER = 1.5;  // 1.5× hourly for active on-call hours
const TOIL_ACCRUAL_RATE        = 1.0;  // 1:1 per UK WTR

// ── Drive helpers (self-contained copies — no App.js dependency) ──────────────
const APP_FOLDER_NAME = 'CloudOps-Rota';
let _appFolderIdCache = null;
const _fileIdCache = {};

async function getAppFolderId(token) {
  if (_appFolderIdCache) return _appFolderIdCache;
  const q = encodeURIComponent(`name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  if (resp.files && resp.files.length > 0) { _appFolderIdCache = resp.files[0].id; return _appFolderIdCache; }
  return null;
}
async function driveFindFile(token, name, parentId) {
  const pid = parentId || await getAppFolderId(token);
  const cacheKey = `${pid}/${name}`;
  if (_fileIdCache[cacheKey]) return { id: _fileIdCache[cacheKey], name };
  const q = pid
    ? encodeURIComponent(`name='${name}' and '${pid}' in parents and trashed=false`)
    : encodeURIComponent(`name='${name}' and trashed=false`);
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  const file = resp.files && resp.files.length > 0 ? resp.files[0] : null;
  if (file) _fileIdCache[cacheKey] = file.id;
  return file;
}
async function driveGetOrCreateSubfolder(token, folderName) {
  const parentId = await getAppFolderId(token);
  const q = parentId
    ? encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`)
    : encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  if (searchResp.files && searchResp.files.length > 0) return searchResp.files[0].id;
  const body = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
  return createResp.id;
}
async function driveReadJson(token, fileId) {
  return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&_t=${Date.now()}`,
    { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' } }).then(r => r.json());
}
async function driveWriteJson(token, name, data, parentId) {
  const body = JSON.stringify(data);
  const pid  = parentId || await getAppFolderId(token);
  const cacheKey = `${pid}/${name}`;
  let fileId = _fileIdCache[cacheKey] || null;
  if (!fileId) { const existing = await driveFindFile(token, name, pid); fileId = existing?.id || null; }
  if (fileId) {
    const result = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }).then(r => r.json());
    if (result.error) { delete _fileIdCache[cacheKey]; fileId = null; }
    else { _fileIdCache[cacheKey] = result.id || fileId; return result; }
  }
  const meta = { name, mimeType: 'application/json', ...(pid ? { parents: [pid] } : {}) };
  const created = await fetch('https://www.googleapis.com/drive/v3/files',
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }).then(r => r.json());
  if (created.id) _fileIdCache[cacheKey] = created.id;
  return fetch(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }).then(r => r.json());
}
async function driveDeleteFile(token, fileId) {
  return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}
async function driveUploadBlob(token, name, blob, parentId) {
  const pid = parentId || await getAppFolderId(token);
  const existing = await driveFindFile(token, name, pid);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(existing ? { name } : { name, parents: pid ? [pid] : [] })], { type: 'application/json' }));
  form.append('file', blob);
  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  return fetch(url, { method: existing ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }).then(r => r.json());
}

// ── Shared UI primitives ──────────────────────────────────────────────────────
function Alert({ type = 'info', children, style }) {
  const colours = { info: ['rgba(0,194,255,0.08)','rgba(0,194,255,0.22)','#7dd3fc'], success: ['rgba(16,185,129,0.08)','rgba(16,185,129,0.22)','#6ee7b7'], warning: ['rgba(245,158,11,0.08)','rgba(245,158,11,0.22)','#fcd34d'], danger: ['rgba(239,68,68,0.08)','rgba(239,68,68,0.22)','#fca5a5'] };
  const [bg, border, color] = colours[type] || colours.info;
  return <div className={`alert alert-${type}`} style={{ background: bg, border: `1px solid ${border}`, color, ...style }}>{children}</div>;
}
function PageHeader({ title, sub, actions }) {
  return (
    <div className="page-header">
      <div className="flex-between">
        <div><div className="page-title">{title}</div>{sub && <div className="page-sub">{sub}</div>}</div>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </div>
  );
}
function StatCard({ label, value, sub, accent, icon }) {
  return (
    <div className="stat-card">
      {accent && <div className="stat-accent" style={{ background: accent }} />}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{icon ? <span style={{ marginRight: 6 }}>{icon}</span> : null}{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
function Avatar({ user, size = 32 }) {
  if (!user) return <div style={{ width: size, height: size, borderRadius: '50%', background: '#1e293b' }} />;
  if (user.profile_picture) return <img src={user.profile_picture} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: user.color || '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.4), fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {user.avatar || user.name?.charAt(0) || '?'}
    </div>
  );
}

// ── calcOncallPay ─────────────────────────────────────────────────────────────
export function calcOncallPay(timesheetEntries, hourlyRate, upgradeHrs = 0, bankHolHrs = 0,
                       rotaForUser = {}, holidays = [], bankHolidays = [], startDs = null, endDs = null,
                       liveIncidentIds = null) {
  let standbyWD = 0, workedWD = 0, standbyWE = 0, workedWE = 0;
  Object.entries(rotaForUser).forEach(([date, shift]) => {
    if (startDs && date < startDs) return;
    if (endDs   && date > endDs)   return;
    if (!shift || shift === 'off') return;
    const isBH = bankHolidays.some(b => b.date === date);
    if (isBH) return;
    const isHol = holidays.some(h => h.userId !== undefined ? (date >= h.start && date <= h.end) : false);
    if (isHol) return;
    const dow = new Date(date).getDay();
    const isWeekend = dow === 0 || dow === 5 || dow === 6;
    if (shift === 'daily')   { workedWD += 9; }
    else if (shift === 'evening') { standbyWD += 12; }
    else if (shift === 'weekend') {
      if (dow === 5) standbyWE += 5;
      else if (dow === 6) standbyWE += 24;
      else if (dow === 0) standbyWE += 24;
      else if (dow === 1) standbyWE += 7;
      else standbyWE += 12;
    }
  });
  const bhStandby = bankHolHrs;
  let incidentHrs = 0;
  (timesheetEntries || [])
    .filter(e => {
      if (!e.week || !e.week.startsWith('INC')) return false;
      const incId = e.week.slice(4).trim();
      if (liveIncidentIds && !liveIncidentIds.has(incId)) return false;
      // ── FIX: filter by the entry's stored date, not by the INC string ──
      // Previously e.week ("INC MBA47-xxx") was compared to date strings,
      // always failing the <= endDs check and silently dropping all incidents.
      if (startDs || endDs) {
        const entryDate = e.date || '';
        if (entryDate) return (!startDs || entryDate >= startDs) && (!endDs || entryDate <= endDs);
        // No date on entry → always include (backward compatibility)
      }
      return true;
    })
    .forEach(e => {
      // ── FIX: prefer worked_wd+worked_we (set by Incidents.js fix) over
      // weekday_oncall+weekend_oncall (used by the old double-count buggy path)
      const hasWorked = (e.worked_wd || 0) + (e.worked_we || 0) > 0;
      const hrs = hasWorked
        ? (e.worked_wd || 0) + (e.worked_we || 0)
        : (e.weekday_oncall || 0) + (e.weekend_oncall || 0);
      incidentHrs += hrs;
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

// ── calcTOILBalance ───────────────────────────────────────────────────────────
export function calcTOILBalance(timesheetEntries, toilEntries, userId) {
  const ts   = Array.isArray(timesheetEntries) ? timesheetEntries : [];
  const safe = Array.isArray(toilEntries) ? toilEntries : Object.values(toilEntries || {});
  const workedOC      = ts.reduce((a, e) => a + (e.worked_wd||0) + (e.worked_we||0) + (e.upgradeHrs||0), 0);
  const autoToil      = Math.round(workedOC * 10) / 10;
  const manualAccrued = safe.filter(t => t.userId===userId && t.type==='Accrued' && t.status==='approved').reduce((a,t)=>a+(+t.hours||0),0);
  const used          = safe.filter(t => t.userId===userId && t.type==='Used'    && t.status==='approved').reduce((a,t)=>a+(+t.hours||0),0);
  const totalAccrued  = autoToil + manualAccrued;
  const balance       = Math.min(Math.max(totalAccrued - used, 0), TOIL_MAX_CARRYOVER);
  return {
    workedOC:      Math.round(workedOC      * 10) / 10,
    autoToil:      Math.round(autoToil      * 10) / 10,
    manualAccrued: Math.round(manualAccrued * 10) / 10,
    used:          Math.round(used          * 10) / 10,
    totalAccrued:  Math.round(totalAccrued  * 10) / 10,
    accrued:       Math.round(totalAccrued  * 10) / 10,
    total:         Math.round(totalAccrued  * 10) / 10,
    balance:       Math.round(balance       * 10) / 10,
    cappedAt:      TOIL_MAX_CARRYOVER,
  };
}

// ── Payroll helpers — 11th-cycle date utils ────────────────────────────────

// Returns the 10th of the previous month and 9th of the current month (the payroll cycle)
function payrollCycleDates() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(); // 0-indexed
  // If today is on or before the 9th, we're still in the previous cycle
  const cycleMonth = now.getDate() <= 9 ? m - 1 : m;
  const cycleYear  = cycleMonth < 0 ? y - 1 : y;
  const cm         = ((cycleMonth % 12) + 12) % 12;
  const cycleStart = `${cycleYear}-${String(cm + 1).padStart(2,'0')}-10`;
  // End = 9th of the following month
  const endMonth   = cm + 1 >= 12 ? 0 : cm + 1;
  const endYear    = cm + 1 >= 12 ? cycleYear + 1 : cycleYear;
  const cycleEnd   = `${endYear}-${String(endMonth + 1).padStart(2,'0')}-09`;
  return { cycleStart, cycleEnd };
}

// Calculate the Nth business working day of a month
// Returns a Date for the Nth business day (Mon–Fri, excl. UK bank holidays)
function nthBusinessDay(year, month, n, bhDates = []) {
  const bhSet = new Set(bhDates);
  let count = 0, d = new Date(year, month, 1);
  while (count < n) {
    const dow = d.getDay();
    const ds  = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !bhSet.has(ds)) count++;
    if (count < n) d.setDate(d.getDate() + 1);
  }
  return d;
}

// ── Payroll (Manager only) ─────────────────────────────────────────────────
function Payroll({ users, timesheets, setTimesheets, payconfig, toil, incidents, upgrades, rota, holidays, isManager, overtime: overtimeArr, driveToken }) {
  const [tab,         setTab]         = useState('overview');  // 'overview' | 'takehome' | 'log'
  const [showExport, setShowExport]   = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [exportLogs,  setExportLogs]  = useState([]);
  const [logMsg,      setLogMsg]      = useState('');
  const [deletingLog, setDeletingLog] = useState(null);
  const [autoExportBanner, setAutoExportBanner] = useState(null);

  // Default date range = current payroll cycle (11th prev → 10th curr)
  const { cycleStart, cycleEnd } = useMemo(payrollCycleDates, []);
  const [exportStart, setExportStart] = useState(cycleStart);
  const [exportEnd,   setExportEnd]   = useState(cycleEnd);

  // Safe defaults so nothing crashes if props arrive undefined
  const safeUsers     = users     || [];
  const safeTS        = timesheets|| {};
  const safePay       = payconfig || {};
  const safeToil      = Array.isArray(toil) ? toil : Object.values(toil || {});
  const safeUpgrades  = upgrades  || [];
  const safeOT        = Array.isArray(overtimeArr) ? overtimeArr : [];
  const safeRota      = rota      || {};
  const safeHolidays  = Array.isArray(holidays) ? holidays : [];
  const safeInc       = Array.isArray(incidents) ? incidents : [];
  const bhList        = (typeof UK_BANK_HOLIDAYS !== 'undefined') ? UK_BANK_HOLIDAYS : [];

  // Load export logs from Drive on mount — MUST be before early return
  useEffect(() => {
    if (!driveToken || !isManager) return;
    (async () => {
      try {
        const folderId = await driveGetOrCreateSubfolder(driveToken, 'CloudOps-Payroll-Exports');
        const existing = await driveFindFile(driveToken, 'export_log.json', folderId);
        if (existing) {
          const data = await driveReadJson(driveToken, existing.id);
          if (Array.isArray(data)) setExportLogs(data.slice(0, 12));
        }
      } catch(e) { console.warn('Payroll: could not load export log', e); }
    })();
  }, [driveToken, isManager]); // eslint-disable-line

  // Auto-export check: is today the 11th business day of the month?
  useEffect(() => {
    if (!driveToken || !isManager) return;
    const now  = new Date();
    const bhDates = (typeof UK_BANK_HOLIDAYS !== 'undefined') ? UK_BANK_HOLIDAYS.map(h => h.date) : [];
    const deadline = nthBusinessDay(now.getFullYear(), now.getMonth(), 11, bhDates);
    const todayDs  = now.toISOString().slice(0, 10);
    const deadlineDs = deadline.toISOString().slice(0, 10);
    // Check if today is on or past the deadline, and we haven't exported this cycle yet
    if (todayDs >= deadlineDs) {
      const alreadyExported = exportLogs.some(l => {
        if (!l.rangeEnd || l.rangeEnd === 'all') return false;
        return l.rangeEnd >= cycleStart && l.rangeEnd <= cycleEnd;
      });
      if (!alreadyExported) {
        setAutoExportBanner({
          deadline: deadlineDs,
          isPast: todayDs > deadlineDs,
          isToday: todayDs === deadlineDs,
        });
      } else {
        setAutoExportBanner(null);
      }
    }
  }, [exportLogs, driveToken, isManager, cycleStart, cycleEnd]); // eslint-disable-line

  // Guard AFTER all hooks
  if (!isManager) return <Alert type="warning">⚠ Payroll is restricted to managers.</Alert>;

  // ── Per-user helpers ──────────────────────────────────────────────────────
  const getUserData = (u, startDs, endDs) => {
    const p      = safePay[u.id] || { base: 2500 };
    const annual = p.annual || p.base * 12;
    const hourly = annual / 2080;

    // Filter timesheet entries to the payroll date range.
    // ── FIX: INC entries use a non-date week key ("INC MBA47-xxx") which
    // always fails w <= endDs ("I" > "2" in ASCII), silently dropping every
    // incident from payroll. Use the entry's stored date field instead.
    const ts = (safeTS[u.id] || []).filter(e => {
      if (!startDs || !endDs) return true;
      const w = e.weekStart || e.week || '';
      if (w.startsWith('INC')) {
        const d = e.date || '';
        if (!d) return true; // no date on old entries → always include
        return d >= startDs && d <= endDs;
      }
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
        const dow = new Date(bh.date + 'T12:00:00').getDay();

        // Check if the engineer has a rota shift directly on this BH date
        let s = safeRota[u.id]?.[bh.date];

        // If no direct entry, check if a weekend on-call started earlier and still runs
        // Weekend OC: Fri 7pm → Mon/Tue 7am — so Mon BH inside a Fri WE shift counts
        if (!s || s === 'off') {
          // Look back up to 3 days for a 'weekend' shift that would still be active
          for (let back = 1; back <= 3; back++) {
            const prev = new Date(bh.date + 'T12:00:00');
            prev.setDate(prev.getDate() - back);
            const prevDs = prev.toISOString().slice(0,10);
            const prevShift = safeRota[u.id]?.[prevDs];
            if (prevShift === 'weekend' || prevShift === 'evening') {
              s = prevShift; // carry the shift type for hours calculation
              break;
            }
          }
        }

        if (!s || s === 'off') return;

        const isWeekendOC = s === 'weekend' || s === 'bankholiday';
        if (isWeekendOC) {
          // Mon BH = full 24h continuation of weekend OC (Fri 7pm → Tue 7am)
          if (dow === 1) total += 24;
          // Fri BH = 12h (7pm start only)
          else if (dow === 5) total += 12;
          else total += 22;
        } else {
          total += 22; // evening / daily on-call on bank holiday
        }
      });
      return total;
    })();

    // Approved overtime hours in range
    const overtimeHrs = safeOT.filter(o =>
      o.userId === u.id && o.status === 'approved' &&
      (!startDs || o.date >= startDs) && (!endDs || o.date <= endDs)
    ).reduce((s, o) => s + (o.hours || 0), 0);

    // Build a Set of live incident IDs so calcOncallPay can exclude orphaned INC timesheet entries
    const liveIncidentIds = new Set((Array.isArray(incidents) ? incidents : []).map(i => i.id));

    const oc = calcOncallPay(ts, hourly, upgradeHrs, bankHolHrs, rotaForUser, userHols, bhList, startDs, endDs, liveIncidentIds);
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
        'Employment ID', 'Trigram', 'Full Name', 'Export Date', 'Period',
        'Standby WD (h)', 'Worked WD (h)', 'Standby WE (h)', 'Worked WE (h)',
        'Incident Hrs', 'Upgrade Hrs', 'Bank Hol Hrs', 'Overtime Hrs', 'TOIL Bal (h)',
      ];
      const s1Rows = safeUsers.map(u => {
        const { oc, tb, incHrs, upgradeHrs, bankHolHrs, overtimeHrs } = getUserData(u, exportStart, exportEnd);
        return [u.employment_id||'—', u.id, u.name, today, rangeLabel,
          oc.standbyWD, oc.workedWD, oc.standbyWE, oc.workedWE,
          incHrs, upgradeHrs, bankHolHrs, overtimeHrs||0, tb.balance];
      });
      const s1TotRow = ['', 'TOTAL', `${safeUsers.length} engineers`, today, rangeLabel,
        ...Array.from({length:9}, (_,i) => s1Rows.reduce((a,r)=>a+(parseFloat(r[5+i])||0),0)), ''];
      const ws1Data = [s1Hdrs, ...s1Rows, s1TotRow];
      const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
      ws1['!cols'] = [14,8,24,12,18,14,13,14,13,12,12,12,13,13].map(w=>({wch:w}));
      ws1['!freeze'] = { xSplit: 3, ySplit: 1 };
      // Header styling: dark navy bg, white bold text
      const H = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'0F1629'}}, alignment:{horizontal:'center',wrapText:true}, border:{bottom:{style:'medium',color:{rgb:'3B82F6'}}} };
      styleRow(ws1, 0, s1Hdrs.length, H);
      // Engineer rows: alternate light/dark
      s1Rows.forEach((_, i) => {
        const bg = i % 2 === 0 ? '0F1629' : '131D35';
        styleRow(ws1, i+1, s1Hdrs.length, { fill:{fgColor:{rgb:bg}}, font:{color:{rgb:'E2E8F0'}} });
        // Colour-code numeric cols (now start at col 5)
        for (let c = 5; c <= 12; c++) {
          const addr = XLSX.utils.encode_cell({r:i+1, c});
          if (!ws1[addr]) continue;
          const colours = ['93C5FD','93C5FD','A78BFA','A78BFA','FCD34D','818CF8','FCA5A5','6EE7B7'];
          ws1[addr].s = { ...ws1[addr].s, font:{color:{rgb:colours[c-5]}, bold: parseFloat(ws1[addr].v)>0 } };
        }
      });
      // Totals row: bold teal
      styleRow(ws1, s1Rows.length+1, s1Hdrs.length, { fill:{fgColor:{rgb:'1E3A5F'}}, font:{bold:true,color:{rgb:'6EE7B7'}}, border:{top:{style:'medium',color:{rgb:'3B82F6'}}} });

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 2 — Daily Detail (exact dates for every shift/overtime entry)
      // ─────────────────────────────────────────────────────────────────────
      const s2Hdrs = ['Employment ID','Trigram','Full Name','Date','Day','Shift Type','Hours','Category','Notes'];
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
          if (hrs > 0) s2Rows.push([u.employment_id||'—', u.id, u.name, fmtUK(date), dayName, SHIFT_CAT[shift]||shift, hrs, 'On-Call/Shift','']);
        });
        // Upgrade days with actual engineer-logged hours
        safeUpgrades.filter(up => up.date && (!exportStart||up.date>=exportStart) && (!exportEnd||up.date<=exportEnd)).forEach(up => {
          const et = (up.engineerTimes||[]).find(e=>e.engineerId===u.id&&e.approved);
          if (et) {
            const dayName = new Date(up.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'});
            s2Rows.push([u.employment_id||'—', u.id, u.name, fmtUK(up.date), dayName, 'Upgrade Day', et.hours, 'Upgrade', up.title||'']);
          }
        });
        // Approved overtime with exact dates
        safeOT.filter(o=>o.userId===u.id&&o.status==='approved'&&(!exportStart||o.date>=exportStart)&&(!exportEnd||o.date<=exportEnd))
          .sort((a,b)=>a.date.localeCompare(b.date))
          .forEach(o => {
            const dayName = new Date(o.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'});
            s2Rows.push([u.employment_id||'—', u.id, u.name, fmtUK(o.date), dayName, 'Overtime', o.hours, 'Overtime', o.reason||'']);
          });
        // Incidents with hours logged
        const incRows = (incidents||[]).filter(inc => inc.assigned_to===u.id && inc.hours_worked > 0
          && (!exportStart||(inc.date||'')>=exportStart) && (!exportEnd||(inc.date||'')<=exportEnd));
        incRows.forEach(inc => {
          const d = inc.date||inc.created_at||'';
          if (!d) return;
          const dayName = new Date(d.slice(0,10)+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'});
          s2Rows.push([u.employment_id||'—', u.id, u.name, fmtUK(d.slice(0,10)), dayName, 'Incident', inc.hours_worked||0, 'Incident', inc.title||'']);
        });
      });

      // Sort by date then name
      s2Rows.sort((a,b) => {
        const [da,db] = [a[3],b[3]].map(s => s.split('/').reverse().join(''));
        return da.localeCompare(db) || a[1].localeCompare(b[1]);
      });

      const ws2Data = [s2Hdrs, ...s2Rows];
      const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
      ws2['!cols'] = [14,8,22,12,12,20,8,14,28].map(w=>({wch:w}));
      ws2['!freeze'] = { xSplit: 3, ySplit: 1 };
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
      // s1Rows layout: [employment_id(0), trigram(1), name(2), exportDate(3), period(4),
      //   standbyWD(5), workedWD(6), standbyWE(7), workedWE(8),
      //   incHrs(9), upgradeHrs(10), bankHolHrs(11), overtimeHrs(12), toilBal(13)]
      const gt = {
        standbyWD: s1Rows.reduce((s,r)=>s+(r[5]||0),0),
        workedWD:  s1Rows.reduce((s,r)=>s+(r[6]||0),0),
        standbyWE: s1Rows.reduce((s,r)=>s+(r[7]||0),0),
        workedWE:  s1Rows.reduce((s,r)=>s+(r[8]||0),0),
        incidents: s1Rows.reduce((s,r)=>s+(r[9]||0),0),
        upgrades:  s1Rows.reduce((s,r)=>s+(r[10]||0),0),
        bankHols:  s1Rows.reduce((s,r)=>s+(r[11]||0),0),
        overtime:  s1Rows.reduce((s,r)=>s+(r[12]||0),0),
      };
      const totalHrs = Object.values(gt).reduce((a,b)=>a+b,0);
      const pct = v => totalHrs > 0 ? ((v/totalHrs)*100).toFixed(1)+'%' : '0%';
      // Build bar chart rows (ASCII-style in cells)
      const bar = v => {
        const w = totalHrs > 0 ? Math.round((v/totalHrs)*30) : 0;
        return '█'.repeat(w) + '░'.repeat(30-w);
      };

      // Collect monthly data
      // s2Rows layout: [employment_id(0), trigram(1), name(2), date(3), day(4),
      //                 shiftType(5), hours(6), category(7), notes(8)]
      const monthlyMap = {};
      s2Rows.forEach(row => {
        const rawDate = row[3]; // dd/mm/yyyy  ← Date is at index 3
        if (!rawDate) return;
        const [d,m,y] = rawDate.split('/');
        const mo = `${y}-${m}`;
        if (!monthlyMap[mo]) monthlyMap[mo] = { standby:0, worked:0, upgrade:0, overtime:0, incident:0, bankHol:0 };
        const hrs = parseFloat(row[6])||0;  // Hours at index 6
        const cat = row[7]||'';             // Category at index 7
        if (cat==='On-Call/Shift') { const sc=row[5]||''; if (sc.includes('Standby')||sc.includes('On-Call')||sc.includes('Bank Hol')) monthlyMap[mo].standby+=hrs; else monthlyMap[mo].worked+=hrs; }
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

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 4 — Standby & Worked Hours for Payroll
      // Standby WD + Standby WE + Bank Hol     = Hours on Standby Shifts @ £5/hr <1164>
      // Incidents + Overtime + Upgrade day hrs  = Hours Worked on Standby @ 1.5× <2011>
      // ─────────────────────────────────────────────────────────────────────
      const STANDBY_RATE = 5;    // £5 per standby hour  (pay code 1164)
      const WORKED_MULT  = 1.5;  // 1.5× basic hourly rate (pay code 2011)

      const s4Hdrs = [
        'Employment ID',
        'Trigram',
        'Full Name',
        'Period',
        'Hours on Standby Shifts @ £5 per hour <1164>',
        'Hours Worked while on Standby Shift @ 1.5 times Basic hourly rate <2011>',
      ];

      const s4Rows = safeUsers.map(u => {
        const { oc, incHrs, upgradeHrs, bankHolHrs, overtimeHrs } = getUserData(u, exportStart, exportEnd);
        const standbyTotal = (oc.standbyWD || 0) + (oc.standbyWE || 0) + (bankHolHrs || 0);
        const workedTotal  = (incHrs || 0) + (overtimeHrs || 0) + (upgradeHrs || 0);
        return [
          u.employment_id || '—',
          u.id,
          u.name,
          rangeLabel,
          standbyTotal,
          workedTotal,
        ];
      });

      // Totals row
      const s4TotRow = ['', 'TOTAL', `${safeUsers.length} engineers`, rangeLabel,
        +s4Rows.reduce((a,r) => a + (parseFloat(r[4]) || 0), 0).toFixed(1),
        +s4Rows.reduce((a,r) => a + (parseFloat(r[5]) || 0), 0).toFixed(1),
      ];

      const ws4Data = [s4Hdrs, ...s4Rows, s4TotRow];
      const ws4     = XLSX.utils.aoa_to_sheet(ws4Data);
      ws4['!cols']  = [14, 8, 22, 20, 46, 52].map(w => ({wch:w}));
      ws4['!freeze']= { xSplit: 3, ySplit: 1 };

      const H4 = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'0F1629'}}, alignment:{horizontal:'center',wrapText:true}, border:{bottom:{style:'medium',color:{rgb:'10B981'}}} };
      styleRow(ws4, 0, s4Hdrs.length, H4);

      const standbyColour = { fill:{fgColor:{rgb:'064E3B'}}, font:{color:{rgb:'6EE7B7'},bold:true} };
      const workedColour  = { fill:{fgColor:{rgb:'78350F'}}, font:{color:{rgb:'FCD34D'},bold:true} };

      s4Rows.forEach((_, i) => {
        const bg = i % 2 === 0 ? '0F1629' : '111827';
        styleRow(ws4, i+1, s4Hdrs.length, { fill:{fgColor:{rgb:bg}}, font:{color:{rgb:'E2E8F0'}} });
        // Standby hours — col 4
        const sAddr = XLSX.utils.encode_cell({r:i+1, c:4});
        if (ws4[sAddr]) ws4[sAddr].s = standbyColour;
        // Worked hours — col 5
        const wAddr = XLSX.utils.encode_cell({r:i+1, c:5});
        if (ws4[wAddr]) ws4[wAddr].s = workedColour;
      });
      styleRow(ws4, s4Rows.length+1, s4Hdrs.length, { fill:{fgColor:{rgb:'1E3A5F'}}, font:{bold:true,color:{rgb:'6EE7B7'}}, border:{top:{style:'medium',color:{rgb:'10B981'}}} });

      // ─────────────────────────────────────────────────────────────────────
      // Build workbook — 4 sheets
      // ─────────────────────────────────────────────────────────────────────
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws3, '📊 Dashboard');
      XLSX.utils.book_append_sheet(wb, ws1, '📋 Hours Summary');
      XLSX.utils.book_append_sheet(wb, ws4, 'Standby & Worked Hours Payroll');
      XLSX.utils.book_append_sheet(wb, ws2, '📅 Daily Detail');

      const fname = `CloudOps-Hours-${(exportStart||'all').replace(/-/g,'')}-${(exportEnd||'time').replace(/-/g,'')}.xlsx`;

      // ── Write to file and also upload to Drive ───────────────────────────────
      const wbBuf = XLSX.write(wb, { bookType:'xlsx', type:'array' });
      XLSX.writeFile(wb, fname);

      // Build log entry
      const logEntry = {
        id:           'exp-' + Date.now(),
        exportedAt:   new Date().toISOString(),
        exportedBy:   safeUsers[0]?.id || 'manager',
        filename:     fname,
        rangeStart:   exportStart || 'all',
        rangeEnd:     exportEnd   || 'all',
        engineerCount: safeUsers.length,
        totalHrs:     s1Rows.reduce((a,r)=>a+(parseFloat(r[5])||0)+(parseFloat(r[6])||0)+(parseFloat(r[7])||0)+(parseFloat(r[8])||0),0),
        driveFileId:  null, // filled in below if Drive upload succeeds
      };

      // Cap logs at 12 (drop oldest)
      const updatedLogs = [logEntry, ...exportLogs].slice(0, 12);

      if (driveToken) {
        try {
          const folderId = await driveGetOrCreateSubfolder(driveToken, 'CloudOps-Payroll-Exports');
          // Upload the .xlsx file to Drive
          const xlsxBlob = new Blob([wbBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const uploaded = await driveUploadBlob(driveToken, fname, xlsxBlob, folderId).catch(() => null);
          if (uploaded?.id) updatedLogs[0].driveFileId = uploaded.id;
          // Save the log JSON
          await driveWriteJson(driveToken, 'export_log.json', updatedLogs, folderId);
          setLogMsg(`✅ Exported & saved to Drive — CloudOps-Rota/CloudOps-Payroll-Exports/${fname}`);
        } catch(e) { console.warn('Payroll export Drive save failed:', e); setLogMsg('⚠ Downloaded locally — Drive save failed.'); }
      }
      setExportLogs(updatedLogs);
      setShowExport(false);
      setTab('log'); // Switch to log tab to show the new entry
    } finally {
      setExporting(false);
    }
  };

  // ── Delete a single log entry (and its Drive file) ────────────────────────
  const deleteLogEntry = async (logId) => {
    setDeletingLog(logId);
    try {
      const entry = exportLogs.find(l => l.id === logId);
      if (entry?.driveFileId && driveToken) {
        await driveDeleteFile(driveToken, entry.driveFileId).catch(() => {});
      }
      const updatedLogs = exportLogs.filter(l => l.id !== logId);
      setExportLogs(updatedLogs);
      if (driveToken) {
        const folderId = await driveGetOrCreateSubfolder(driveToken, 'CloudOps-Payroll-Exports');
        await driveWriteJson(driveToken, 'export_log.json', updatedLogs, folderId);
      }
      setLogMsg('🗑 Log entry deleted.');
      setTimeout(() => setLogMsg(''), 4000);
    } catch(e) { console.warn('Delete log entry failed:', e); }
    finally { setDeletingLog(null); }
  };

  // ── Clear all log entries ─────────────────────────────────────────────────
  const clearAllLogs = async () => {
    if (!window.confirm('Delete all export logs and their Drive files? This cannot be undone.')) return;
    setDeletingLog('all');
    try {
      if (driveToken) {
        await Promise.allSettled(
          exportLogs.filter(l => l.driveFileId).map(l => driveDeleteFile(driveToken, l.driveFileId))
        );
        const folderId = await driveGetOrCreateSubfolder(driveToken, 'CloudOps-Payroll-Exports');
        await driveWriteJson(driveToken, 'export_log.json', [], folderId);
      }
      setExportLogs([]);
      setLogMsg('🗑 All logs cleared.');
      setTimeout(() => setLogMsg(''), 4000);
    } catch(e) { console.warn('Clear all logs failed:', e); }
    finally { setDeletingLog(null); }
  };

  // ── Summary stats (current payroll cycle) ────────────────────────────────
  const totalOCPay       = safeUsers.reduce((s, u) => { const { oc } = getUserData(u, cycleStart, cycleEnd); return s + oc.total; }, 0);
  const totalIncidentHrs = safeUsers.reduce((s, u) => { const { incHrs } = getUserData(u, cycleStart, cycleEnd); return s + incHrs; }, 0);
  const totalUpgradeHrs  = safeUsers.reduce((s, u) => { const { upgradeHrs } = getUserData(u, cycleStart, cycleEnd); return s + upgradeHrs; }, 0);
  const totalOvertimeHrs = safeUsers.reduce((s, u) => { const { overtimeHrs } = getUserData(u, cycleStart, cycleEnd); return s + overtimeHrs; }, 0);
  const pendingOTCount   = safeOT.filter(o => o.status === 'pending').length;

  // ── Recalc: purge orphaned INC timesheet entries not linked to any live incident ──
  const [recalcMsg, setRecalcMsg] = useState('');
  const recalcPayroll = () => {
    const liveIds = new Set(safeInc.map(i => i.id));
    let removed = 0;
    setTimesheets(prev => {
      const updated = {};
      Object.entries(prev || {}).forEach(([uid, entries]) => {
        const before = (entries || []).length;
        updated[uid] = (entries || []).filter(e => {
          if (!e.week || !e.week.startsWith('INC')) return true;
          return liveIds.has(e.week.slice(4).trim());
        });
        removed += before - updated[uid].length;
      });
      return updated;
    });
    const msg = removed > 0
      ? `✅ Removed ${removed} orphaned incident entr${removed === 1 ? 'y' : 'ies'} — figures updated.`
      : '✅ All incident entries match live incidents — nothing to remove.';
    setRecalcMsg(msg);
    setTimeout(() => setRecalcMsg(''), 6000);
  };

  // ── Cycle label helper ─────────────────────────────────────────────────────
  const fmtD = ds => ds ? new Date(ds + 'T12:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const cycleLabel = `${fmtD(cycleStart)} – ${fmtD(cycleEnd)}`;

  // ── All available payroll cycles from Jan 2026 onwards ────────────────────
  const allCycles = useMemo(() => {
    const cycles = [];
    const now = new Date();
    // Go from Jan 2026 up to 12 months in the future
    let y = 2026, m = 0; // Jan 2026
    while (y < now.getFullYear() + 2 || (y === now.getFullYear() + 1 && m <= now.getMonth())) {
      const cm   = m;
      const cy   = y;
      const endM = cm + 1 >= 12 ? 0 : cm + 1;
      const endY = cm + 1 >= 12 ? cy + 1 : cy;
      const start = `${cy}-${String(cm + 1).padStart(2,'0')}-10`;
      const end   = `${endY}-${String(endM + 1).padStart(2,'0')}-09`;
      const label = new Date(cy, cm, 10).toLocaleDateString('en-GB',{month:'long',year:'numeric'}) + ` (10 ${String(cm+1).padStart(2,'0')} – 09 ${String(endM+1).padStart(2,'0')})`;
      cycles.push({ start, end, label });
      m++; if (m >= 12) { m = 0; y++; }
    }
    return cycles.reverse(); // most recent first
  }, []);

  // Which cycle is currently selected in the overview tab
  const [viewCycleStart, setViewCycleStart] = useState(cycleStart);
  const [viewCycleEnd,   setViewCycleEnd]   = useState(cycleEnd);
  const viewCycleLabel = `${fmtD(viewCycleStart)} – ${fmtD(viewCycleEnd)}`;

  const tabIcons = { overview: '📋', takehome: '💷', reports: '📊', log: '📁' };

  return (
    <div>
      <PageHeader title="Payroll" sub={`Cycle: ${cycleLabel} · manager only`}
        actions={<div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary btn-sm" onClick={recalcPayroll}
            title="Cross-check incident timesheet entries against live incidents and remove orphans">
            ♻ Recalc
          </button>
          <button className="btn btn-primary" onClick={() => setShowExport(true)}>📥 Export to Excel</button>
        </div>} />

      {/* Auto-export deadline banner */}
      {autoExportBanner && (
        <div style={{ background: autoExportBanner.isPast ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
          border: `1px solid ${autoExportBanner.isPast ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'}`,
          borderRadius:8, padding:'10px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:12, fontSize:13 }}>
          <span style={{ fontSize:20 }}>{autoExportBanner.isPast ? '🚨' : '⚠️'}</span>
          <div style={{ flex:1 }}>
            <strong style={{ color: autoExportBanner.isPast ? '#fca5a5' : '#fcd34d' }}>
              {autoExportBanner.isPast ? 'Payroll submission overdue!' : 'Payroll due today!'}
            </strong>
            <span style={{ color:'var(--text-secondary)', marginLeft:8, fontSize:12 }}>
              The 11th business day deadline {autoExportBanner.isPast ? `was ${fmtD(autoExportBanner.deadline)}` : 'is today'} — export to Excel and submit to payroll.
            </span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowExport(true)}>📥 Export Now</button>
        </div>
      )}

      {recalcMsg && <Alert type="success" style={{ marginBottom:12 }}>{recalcMsg}</Alert>}
      {logMsg    && <Alert type="success" style={{ marginBottom:12 }}>{logMsg}</Alert>}

      {/* KPI bar — always visible */}
      <div className="grid-4 mb-16">
        <StatCard label="Incident Hours"   value={`${totalIncidentHrs}h`} sub="Auto-logged from incidents"  accent="#f59e0b" icon="🚨" />
        <StatCard label="Upgrade Hours"    value={`${totalUpgradeHrs}h`}  sub="Approved upgrade days"       accent="#818cf8" icon="⬆" />
        <StatCard label="Overtime Hours"   value={`${totalOvertimeHrs}h`} sub="Approved overtime"           accent="#10b981" icon="🕐" />
        <StatCard label="Pending OT"       value={pendingOTCount}          sub="Awaiting approval"           accent="#f59e0b" icon="⏳" />
      </div>

      {/* ── Pill-style tab buttons ─────────────────────────────────────────── */}
      <div className="payroll-tab-bar">
        {[
          { id:'overview', label:'Hours Summary' },
          { id:'takehome', label:'Take-Home' },
          { id:'reports',  label:'Reports' },
          { id:'log',      label:'Export Log', badge: exportLogs.length || null },
        ].map(({ id, label, badge }) => (
          <div key={id} className={`payroll-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            <span>{tabIcons[id]}</span>
            <span>{label}</span>
            {badge != null && <span className="tab-badge">{badge}</span>}
          </div>
        ))}
      </div>

      {/* ── TAB: Overview ─────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="card mb-16" style={{ overflowX:'auto' }}>
          {/* Cycle selector */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div className="card-title" style={{ marginBottom:0 }}>On-Call Hours</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'DM Mono', background:'rgba(0,194,255,0.07)', border:'1px solid rgba(0,194,255,0.15)', borderRadius:5, padding:'2px 8px' }}>
                {viewCycleLabel}
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <label style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'DM Mono', whiteSpace:'nowrap' }}>Cycle:</label>
              <select className="input" style={{ fontSize:12, padding:'5px 10px', minWidth:260, fontFamily:'DM Mono' }}
                value={viewCycleStart}
                onChange={e => {
                  const c = allCycles.find(c => c.start === e.target.value);
                  if (c) { setViewCycleStart(c.start); setViewCycleEnd(c.end); }
                }}>
                {allCycles.map(c => (
                  <option key={c.start} value={c.start}
                    style={{ background:'var(--bg-card)', color:'var(--text-primary)' }}>
                    {c.start === cycleStart ? `▶ ` : ''}{c.label}
                  </option>
                ))}
              </select>
              {viewCycleStart !== cycleStart && (
                <button className="btn btn-secondary btn-sm" onClick={() => { setViewCycleStart(cycleStart); setViewCycleEnd(cycleEnd); }}>
                  ↩ Current
                </button>
              )}
            </div>
          </div>
          <table style={{ minWidth:950, tableLayout:'fixed', width:'100%' }}>
            <colgroup>
              <col style={{ width:200 }} /><col style={{ width:90 }} /><col style={{ width:90 }} />
              <col style={{ width:90 }} /><col style={{ width:90 }} /><col style={{ width:80 }} />
              <col style={{ width:80 }} /><col style={{ width:80 }} /><col style={{ width:80 }} />
              <col style={{ width:75 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign:'left' }}>Engineer</th>
                <th style={{ textAlign:'right', color:'#93c5fd' }}>Standby WD</th>
                <th style={{ textAlign:'right', color:'#93c5fd' }}>Worked WD</th>
                <th style={{ textAlign:'right', color:'#a78bfa' }}>Standby WE</th>
                <th style={{ textAlign:'right', color:'#a78bfa' }}>Worked WE</th>
                <th style={{ textAlign:'right', color:'#f59e0b' }}>Incidents</th>
                <th style={{ textAlign:'right', color:'#818cf8' }}>Upgrades</th>
                <th style={{ textAlign:'right', color:'#fca5a5' }}>Bank Hol</th>
                <th style={{ textAlign:'right', color:'#e879f9' }}>Overtime</th>
                <th style={{ textAlign:'right' }}>TOIL Bal.</th>
              </tr>
            </thead>
            <tbody>
              {safeUsers.map(u => {
                const { oc, tb, incHrs, upgradeHrs, bankHolHrs, overtimeHrs } = getUserData(u, viewCycleStart, viewCycleEnd);
                return (
                  <tr key={u.id}>
                    <td><div style={{ display:'flex', gap:8, alignItems:'center' }}><Avatar user={u} size={24} /><div><div style={{ fontSize:12 }}>{u.name}</div><div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono' }}>{u.id}</div></div></div></td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#93c5fd', textAlign:'right' }}>{oc.standbyWD}h</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#93c5fd', textAlign:'right' }}>{oc.workedWD}h</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#a78bfa', textAlign:'right' }}>{oc.standbyWE}h</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:'#a78bfa', textAlign:'right' }}>{oc.workedWE}h</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:incHrs>0?'#f59e0b':'var(--text-muted)', textAlign:'right' }}>{incHrs>0?`${incHrs}h`:'—'}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:upgradeHrs>0?'#818cf8':'var(--text-muted)', textAlign:'right' }}>{upgradeHrs>0?`${upgradeHrs}h`:'—'}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:bankHolHrs>0?'#fca5a5':'var(--text-muted)', textAlign:'right' }}>{bankHolHrs>0?`${bankHolHrs}h`:'—'}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:overtimeHrs>0?'#e879f9':'var(--text-muted)', fontWeight:overtimeHrs>0?700:400, textAlign:'right' }}>{overtimeHrs>0?`${overtimeHrs}h`:'—'}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:12, color:tb.balance>0?'#38bdf8':'#fca5a5', textAlign:'right' }}>{tb.balance}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop:10, fontSize:11, color:'var(--text-muted)' }}>
            Daily: 10am–7pm · Weekday OC: 7pm–7am · Weekend OC: Fri 7pm–Mon 7am · Bank Hol OC: 9am–7am · Overtime: manager-approved only
          </div>
        </div>
      )}

      {/* ── TAB: Take-Home ────────────────────────────────────────────────── */}
      {tab === 'takehome' && (
        <>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14 }}>
            💷 Estimated take-home after UK Income Tax, National Insurance (2025-26), pension and student loan. Based on annualised on-call pay.
          </div>
          <div className="grid-2 mb-16">
            {safeUsers.map(u => {
              const { p, annual, oc, incHrs } = getUserData(u, cycleStart, cycleEnd);
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
        </>
      )}

      {/* ── TAB: Reports (PowerBI-style) ──────────────────────────────────── */}
      {tab === 'reports' && (
        <PayrollReports
          users={safeUsers}
          timesheets={safeTS}
          incidents={safeInc}
          upgrades={safeUpgrades}
          overtime={safeOT}
          toil={safeToil}
          rota={safeRota}
          holidays={safeHolidays}
          payconfig={safePay}
          allCycles={allCycles}
          cycleStart={cycleStart}
          cycleEnd={cycleEnd}
          getUserData={getUserData}
          bhList={bhList}
          fmtD={fmtD}
        />
      )}

      {/* ── TAB: Export Log ───────────────────────────────────────────────── */}
      {tab === 'log' && (
        <div className="card mb-16">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div className="card-title">📁 Payroll Export Log</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'DM Mono' }}>
                {exportLogs.length}/12 entries · Files saved to Drive
              </span>
              {exportLogs.length > 0 && (
                <button className="btn btn-danger btn-sm" onClick={clearAllLogs} disabled={deletingLog === 'all'}>
                  {deletingLog === 'all' ? '⏳…' : '🗑 Clear All'}
                </button>
              )}
            </div>
          </div>
          {exportLogs.length === 0 ? (
            <div style={{ color:'var(--text-muted)', fontSize:13, padding:'24px 0', textAlign:'center' }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
              No exports yet. Each Excel export is automatically logged here and saved to
              <code style={{ margin:'0 4px' }}>CloudOps-Rota/CloudOps-Payroll-Exports/</code> in Google Drive.
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%' }}>
                <thead>
                  <tr>
                    <th>Date / Time</th>
                    <th>File Name</th>
                    <th>Period</th>
                    <th style={{ textAlign:'center' }}>Engineers</th>
                    <th style={{ textAlign:'right' }}>Total Hrs</th>
                    <th style={{ textAlign:'center' }}>Drive</th>
                    <th style={{ textAlign:'center' }}>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {exportLogs.map(log => (
                    <tr key={log.id}>
                      <td style={{ fontFamily:'DM Mono', fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                        {new Date(log.exportedAt).toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}
                      </td>
                      <td style={{ fontFamily:'DM Mono', fontSize:11, color:'#93c5fd' }}>{log.filename}</td>
                      <td style={{ fontSize:11, whiteSpace:'nowrap' }}>
                        {log.rangeStart === 'all' ? 'All time' : `${fmtD(log.rangeStart)} → ${fmtD(log.rangeEnd)}`}
                      </td>
                      <td style={{ textAlign:'center', fontFamily:'DM Mono', fontSize:12 }}>{log.engineerCount}</td>
                      <td style={{ textAlign:'right', fontFamily:'DM Mono', fontSize:12, color:'#6ee7b7' }}>{Math.round(log.totalHrs)}h</td>
                      <td style={{ textAlign:'center' }}>
                        {log.driveFileId
                          ? <span title="Saved in Google Drive" style={{ fontSize:16 }}>✅</span>
                          : <span title="No Drive file" style={{ fontSize:14, color:'var(--text-muted)' }}>—</span>
                        }
                      </td>
                      <td style={{ textAlign:'center' }}>
                        <button className="btn btn-danger btn-sm"
                          onClick={() => deleteLogEntry(log.id)}
                          disabled={deletingLog === log.id}
                          title="Delete this log entry and its Drive file">
                          {deletingLog === log.id ? '⏳' : '🗑'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop:10, fontSize:11, color:'var(--text-muted)' }}>
                Deleting an entry also permanently removes the .xlsx file from Google Drive.
                Max 12 entries stored — oldest are auto-removed on each new export.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Export date-range modal */}
      {showExport && (
        <Modal title="Export Payroll to Excel" onClose={() => setShowExport(false)}>
          <div style={{ display:'flex', flexDirection:'column', gap:16, padding:'8px 0' }}>
            <Alert type="info">
              📅 Current payroll cycle: <strong>{cycleLabel}</strong>.
              Dates default to the 11th of the previous month → 10th of the current month.
            </Alert>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>From (11th of prev. month)</div>
                <input type="date" className="input" value={exportStart} onChange={e => setExportStart(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>To (10th of curr. month)</div>
                <input type="date" className="input" value={exportEnd} onChange={e => setExportEnd(e.target.value)} />
              </div>
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>Quick ranges</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {[
                  ['Current cycle', () => { setExportStart(cycleStart); setExportEnd(cycleEnd); }],
                  ['Prev. cycle', () => {
                    const n=new Date(); const y=n.getFullYear(), m=n.getMonth();
                    const pc = m - 2; const pcy = pc < 0 ? y-1 : y; const pcm = ((pc%12)+12)%12;
                    setExportStart(`${pcy}-${String(pcm+1).padStart(2,'0')}-10`);
                    const endM = pcm+1>=12?0:pcm+1; const endY = pcm+1>=12?pcy+1:pcy;
                    setExportEnd(`${endY}-${String(endM+1).padStart(2,'0')}-09`);
                  }],
                  ['Last 4 weeks', () => { const e=new Date(); const s=new Date(); s.setDate(e.getDate()-28); setExportStart(s.toISOString().slice(0,10)); setExportEnd(e.toISOString().slice(0,10)); }],
                  ['This year',    () => { const y=new Date().getFullYear(); setExportStart(`${y}-01-11`); setExportEnd(`${y}-12-10`); }],
                  ['All time',     () => { setExportStart(''); setExportEnd(''); }],
                ].map(([label, fn]) => (
                  <button key={label} className="btn btn-secondary btn-sm" onClick={fn}>{label}</button>
                ))}
              </div>
            </div>
            {(exportStart || exportEnd) && (
              <div style={{ fontSize:12, color:'var(--text-secondary)', background:'rgba(59,130,246,0.1)', borderRadius:8, padding:'8px 12px' }}>
                📅 Exporting: <strong>{exportStart ? fmtD(exportStart) : 'start'}</strong> → <strong>{exportEnd ? fmtD(exportEnd) : 'end'}</strong>
                &nbsp;· {safeUsers.length} engineers · File will be saved to Google Drive automatically.
              </div>
            )}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
              <button className="btn btn-secondary" onClick={() => setShowExport(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doExportExcel} disabled={exporting}>
                {exporting ? '⏳ Exporting…' : '📥 Download & Save to Drive'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ── PayrollReports — PowerBI-style reporting component ────────────────────────
// Receives pre-computed getUserData from Payroll so all calc logic is shared.
function PayrollReports({ users, timesheets, incidents, upgrades, overtime, toil, rota, holidays,
                          payconfig, allCycles, cycleStart, cycleEnd, getUserData, bhList, fmtD }) {

  const [view,          setView]          = useState('overview');   // overview | engineers | trend | incidents
  const [selCycleStart, setSelCycleStart] = useState(cycleStart);
  const [selCycleEnd,   setSelCycleEnd]   = useState(cycleEnd);
  const [engFilter,     setEngFilter]     = useState('all');
  const [chartLoaded,   setChartLoaded]   = useState(false);
  const chartRefs = React.useRef({});

  // Load Chart.js once
  React.useEffect(() => {
    if (window.Chart) { setChartLoaded(true); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    s.onload = () => setChartLoaded(true);
    document.head.appendChild(s);
  }, []);

  const visUsers = engFilter === 'all' ? users : users.filter(u => u.id === engFilter);

  // Aggregate data for selected cycle + engineer filter
  const cycleData = React.useMemo(() => {
    return visUsers.map(u => {
      const d = getUserData(u, selCycleStart, selCycleEnd);
      return { u, ...d };
    });
  }, [visUsers, selCycleStart, selCycleEnd, getUserData]);

  const totals = React.useMemo(() => ({
    standbyWD:  cycleData.reduce((a,r)=>a+(r.oc.standbyWD||0),0),
    workedWD:   cycleData.reduce((a,r)=>a+(r.oc.workedWD||0),0),
    standbyWE:  cycleData.reduce((a,r)=>a+(r.oc.standbyWE||0),0),
    workedWE:   cycleData.reduce((a,r)=>a+(r.oc.workedWE||0),0),
    incidents:  cycleData.reduce((a,r)=>a+(r.incHrs||0),0),
    upgrades:   cycleData.reduce((a,r)=>a+(r.upgradeHrs||0),0),
    bankHol:    cycleData.reduce((a,r)=>a+(r.bankHolHrs||0),0),
    overtime:   cycleData.reduce((a,r)=>a+(r.overtimeHrs||0),0),
    toil:       cycleData.reduce((a,r)=>a+(r.tb?.balance||0),0),
  }), [cycleData]);

  const totalHrs = totals.standbyWD + totals.workedWD + totals.standbyWE + totals.workedWE +
                   totals.incidents + totals.upgrades + totals.bankHol + totals.overtime;

  // Build last 4 cycles of data for trend view
  const trendCycles = React.useMemo(() => allCycles.slice(0, 4).reverse(), [allCycles]);
  const trendData   = React.useMemo(() => trendCycles.map(c => {
    const rows = users.map(u => getUserData(u, c.start, c.end));
    return {
      label: c.label.split(' (')[0],
      standby: rows.reduce((a,r)=>a+(r.oc.standbyWD||0)+(r.oc.standbyWE||0)+(r.bankHolHrs||0),0),
      incidents: rows.reduce((a,r)=>a+(r.incHrs||0),0),
      overtime:  rows.reduce((a,r)=>a+(r.overtimeHrs||0),0),
      upgrades:  rows.reduce((a,r)=>a+(r.upgradeHrs||0),0),
    };
  }), [trendCycles, users, getUserData]);

  // Destroy + recreate a chart
  const mkChart = React.useCallback((id, config) => {
    if (!window.Chart) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (chartRefs.current[id]) { try { chartRefs.current[id].destroy(); } catch(e){} }
    chartRefs.current[id] = new window.Chart(el, config);
  }, []);

  // Draw charts whenever view / data changes
  React.useEffect(() => {
    if (!chartLoaded) return;
    const COLORS = {
      standbyWD:'#93C5FD', workedWD:'#60A5FA', standbyWE:'#A78BFA', workedWE:'#818CF8',
      incidents:'#FCD34D', upgrades:'#6EE7B7', bankHol:'#FCA5A5', overtime:'#F472B6',
    };
    const gridColor = 'rgba(148,163,184,0.1)';
    const tickColor = '#64748b';
    const baseOpts  = { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: ctx=>`${ctx.raw}h` } } } };

    if (view === 'overview') {
      // Doughnut — hours mix
      const mixLabels  = ['Standby WD','Worked WD','Standby WE','Worked WE','Incidents','Upgrades','Bank Hol','Overtime'];
      const mixData    = [totals.standbyWD,totals.workedWD,totals.standbyWE,totals.workedWE,totals.incidents,totals.upgrades,totals.bankHol,totals.overtime];
      const mixColors  = ['#93C5FD','#60A5FA','#A78BFA','#818CF8','#FCD34D','#6EE7B7','#FCA5A5','#F472B6'];
      mkChart('rpt-mix',{ type:'doughnut', data:{ labels:mixLabels, datasets:[{ data:mixData, backgroundColor:mixColors, borderWidth:0 }] },
        options:{ ...baseOpts, cutout:'60%', plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:ctx=>`${ctx.label}: ${ctx.raw}h` } } } } });

      // Horizontal bar — total per engineer
      const engLabels = cycleData.map(r=>r.u.name.split(' ')[0]);
      const engTotals = cycleData.map(r=>Math.round(((r.oc.standbyWD||0)+(r.oc.workedWD||0)+(r.oc.standbyWE||0)+(r.oc.workedWE||0)+(r.incHrs||0)+(r.upgradeHrs||0)+(r.bankHolHrs||0)+(r.overtimeHrs||0))*10)/10);
      const engBgColors = cycleData.map(r=>r.u.color||'#378ADD');
      mkChart('rpt-eng',{ type:'bar', data:{ labels:engLabels, datasets:[{ data:engTotals, backgroundColor:engBgColors, borderRadius:4, borderWidth:0 }] },
        options:{ ...baseOpts, indexAxis:'y', scales:{ x:{ grid:{ color:gridColor }, ticks:{ color:tickColor, font:{ size:11 } } }, y:{ grid:{ display:false }, ticks:{ color:tickColor, font:{ size:11 } } } } } });

      // Stacked bar — category breakdown
      mkChart('rpt-stack',{ type:'bar',
        data:{ labels:cycleData.map(r=>r.u.name.split(' ').map((w,i)=>i===0?w:w[0]+'.').join(' ')),
          datasets:[
            { label:'Standby WD', data:cycleData.map(r=>r.oc.standbyWD||0), backgroundColor:COLORS.standbyWD, borderWidth:0 },
            { label:'Standby WE', data:cycleData.map(r=>r.oc.standbyWE||0), backgroundColor:COLORS.standbyWE, borderWidth:0 },
            { label:'Worked WD',  data:cycleData.map(r=>r.oc.workedWD||0),  backgroundColor:COLORS.workedWD,  borderWidth:0 },
            { label:'Incidents',  data:cycleData.map(r=>r.incHrs||0),        backgroundColor:COLORS.incidents, borderWidth:0 },
            { label:'Overtime',   data:cycleData.map(r=>r.overtimeHrs||0),   backgroundColor:COLORS.overtime,  borderWidth:0 },
            { label:'Upgrades',   data:cycleData.map(r=>r.upgradeHrs||0),    backgroundColor:COLORS.upgrades,  borderWidth:0 },
            { label:'Bank Hol',   data:cycleData.map(r=>r.bankHolHrs||0),    backgroundColor:COLORS.bankHol,   borderWidth:0 },
          ]
        },
        options:{ ...baseOpts, indexAxis:'y',
          plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:ctx=>`${ctx.dataset.label}: ${ctx.raw}h` } } },
          scales:{ x:{ stacked:true, grid:{ color:gridColor }, ticks:{ color:tickColor, font:{ size:11 } } },
                   y:{ stacked:true, grid:{ display:false }, ticks:{ color:tickColor, font:{ size:11 } } } } } });
    }

    if (view === 'trend') {
      mkChart('rpt-trend',{ type:'line',
        data:{ labels: trendData.map(d=>d.label),
          datasets:[
            { label:'Standby',   data:trendData.map(d=>d.standby),   borderColor:'#93C5FD', backgroundColor:'rgba(147,197,253,.1)', fill:true,  tension:.35, borderWidth:2, pointRadius:4 },
            { label:'Incidents', data:trendData.map(d=>d.incidents),  borderColor:'#FCD34D', borderDash:[5,4],                        fill:false, tension:.35, borderWidth:2, pointRadius:4 },
            { label:'Overtime',  data:trendData.map(d=>d.overtime),   borderColor:'#F472B6',                                          fill:false, tension:.35, borderWidth:2, pointRadius:4 },
            { label:'Upgrades',  data:trendData.map(d=>d.upgrades),   borderColor:'#6EE7B7',                                          fill:false, tension:.35, borderWidth:2, pointRadius:4 },
          ]
        },
        options:{ ...baseOpts, scales:{ x:{ grid:{ color:gridColor }, ticks:{ color:tickColor } }, y:{ grid:{ color:gridColor }, ticks:{ color:tickColor, callback:v=>v+'h' } } } } });

      // Per-engineer trend lines
      mkChart('rpt-eng-trend',{ type:'line',
        data:{ labels: trendData.map(d=>d.label),
          datasets: users.map(u=>({
            label: u.name.split(' ')[0],
            data: trendCycles.map(c=>{ const d=getUserData(u,c.start,c.end); return Math.round(((d.oc.standbyWD||0)+(d.oc.standbyWE||0)+(d.incHrs||0)+(d.overtimeHrs||0))*10)/10; }),
            borderColor: u.color||'#94a3b8', fill:false, tension:.35, borderWidth:1.5, pointRadius:3,
          }))
        },
        options:{ ...baseOpts, scales:{ x:{ grid:{ color:gridColor }, ticks:{ color:tickColor } }, y:{ grid:{ color:gridColor }, ticks:{ color:tickColor, callback:v=>v+'h' } } } } });
    }

    if (view === 'incidents') {
      const safeInc = Array.isArray(incidents) ? incidents : [];
      const filteredInc = engFilter==='all' ? safeInc : safeInc.filter(i=>i.assigned_to===engFilter);

      const bySev = {};
      filteredInc.forEach(i=>{ bySev[i.severity||'Unknown']=(bySev[i.severity||'Unknown']||0)+1; });
      const sevKeys   = Object.keys(bySev).sort();
      const sevColors = { Disaster:'#D85A30', Critical:'#BA7517', High:'#378ADD', Medium:'#1D9E75', Low:'#888780', Unknown:'#888780' };

      mkChart('rpt-inc-sev',{ type:'doughnut',
        data:{ labels:sevKeys, datasets:[{ data:sevKeys.map(k=>bySev[k]), backgroundColor:sevKeys.map(k=>sevColors[k]||'#888780'), borderWidth:0 }] },
        options:{ ...baseOpts, cutout:'55%', plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:ctx=>`${ctx.label}: ${ctx.raw}` } } } } });

      const engIncCounts = users.map(u=>filteredInc.filter(i=>i.assigned_to===u.id).length);
      mkChart('rpt-inc-eng',{ type:'bar',
        data:{ labels:users.map(u=>u.name.split(' ')[0]), datasets:[{ data:engIncCounts, backgroundColor:users.map(u=>u.color||'#378ADD'), borderRadius:4, borderWidth:0 }] },
        options:{ ...baseOpts, indexAxis:'y', scales:{ x:{ grid:{ color:gridColor }, ticks:{ color:tickColor, stepSize:1 } }, y:{ grid:{ display:false }, ticks:{ color:tickColor } } } } });
    }
  }, [chartLoaded, view, cycleData, totals, trendData, trendCycles, users, engFilter, incidents, mkChart, getUserData]);

  // ── Styles (inline to stay self-contained) ─────────────────────────────────
  const S = {
    toolbar:   { display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'12px 0 14px', borderBottom:'1px solid rgba(148,163,184,0.15)', marginBottom:16 },
    tbLabel:   { fontSize:12, color:'var(--text-muted)', whiteSpace:'nowrap' },
    seg:       { display:'flex', border:'1px solid rgba(148,163,184,0.2)', borderRadius:6, overflow:'hidden' },
    segBtn:    (active) => ({ fontSize:12, padding:'5px 12px', border:'none', borderRight:'1px solid rgba(148,163,184,0.15)',
                              background: active ? 'rgba(59,130,246,0.15)' : 'transparent',
                              color: active ? '#60a5fa' : 'var(--text-secondary)', cursor:'pointer', fontWeight: active?600:400 }),
    kpis:      { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:18 },
    kpi:       { background:'rgba(15,22,41,0.6)', border:'1px solid rgba(148,163,184,0.1)', borderRadius:8, padding:'12px 14px' },
    kpiLabel:  { fontSize:11, color:'var(--text-muted)', marginBottom:4 },
    kpiVal:    (color) => ({ fontSize:22, fontWeight:700, color: color||'var(--text-primary)', lineHeight:1 }),
    kpiSub:    { fontSize:11, color:'var(--text-muted)', marginTop:3 },
    grid2:     { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 },
    grid1:     { display:'grid', gridTemplateColumns:'1fr', gap:14, marginBottom:14 },
    card:      { background:'rgba(15,22,41,0.6)', border:'1px solid rgba(148,163,184,0.1)', borderRadius:10, padding:16 },
    cTitle:    { fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom:3 },
    cSub:      { fontSize:11, color:'var(--text-muted)', marginBottom:12 },
    legend:    { display:'flex', flexWrap:'wrap', gap:10, marginBottom:10, fontSize:11, color:'var(--text-muted)' },
    legendDot: (bg) => ({ width:10, height:10, borderRadius:2, background:bg, flexShrink:0, display:'inline-block', marginRight:4 }),
    tbl:       { width:'100%', fontSize:12, borderCollapse:'collapse' },
    th:        { textAlign:'left', fontWeight:500, fontSize:11, color:'var(--text-muted)', padding:'4px 8px', borderBottom:'1px solid rgba(148,163,184,0.12)' },
    td:        { padding:'7px 8px', borderBottom:'1px solid rgba(148,163,184,0.08)', color:'var(--text-primary)' },
    tdNum:     { padding:'7px 8px', borderBottom:'1px solid rgba(148,163,184,0.08)', textAlign:'right', fontFamily:'DM Mono, monospace', fontSize:11 },
    pill:      (bg, color) => ({ display:'inline-block', fontSize:10, padding:'2px 7px', borderRadius:10, background:bg, color, fontWeight:600 }),
    trendBadge:(up) => ({ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:4,
                          background: up ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                          color: up ? '#10b981' : '#ef4444' }),
  };

  const SEV_COLORS = { Disaster:['rgba(216,90,48,0.2)','#fca5a5'], Critical:['rgba(186,117,23,0.2)','#fcd34d'], High:['rgba(55,138,221,0.2)','#93c5fd'], Medium:['rgba(29,158,117,0.2)','#6ee7b7'], Low:['rgba(136,135,128,0.2)','#94a3b8'] };

  const fmt  = n => Math.round((n||0)*10)/10;
  const pct  = (a,b) => b===0?'—':Math.round(a/b*100)+'%';
  const delta = (cur,prev) => prev===0?null:Math.round((cur-prev)/prev*100);

  // ── Prev cycle for deltas ──────────────────────────────────────────────────
  const prevCycle = allCycles[allCycles.findIndex(c=>c.start===selCycleStart)+1];
  const prevData  = React.useMemo(() => {
    if (!prevCycle) return null;
    return { standby: users.reduce((a,u)=>{ const d=getUserData(u,prevCycle.start,prevCycle.end); return a+(d.oc.standbyWD||0)+(d.oc.standbyWE||0); },0),
             incidents: users.reduce((a,u)=>{ const d=getUserData(u,prevCycle.start,prevCycle.end); return a+(d.incHrs||0); },0) };
  }, [prevCycle, users, getUserData]);

  const selCycleLabel = allCycles.find(c=>c.start===selCycleStart)?.label?.split(' (')[0] || selCycleStart;

  // ── OVERVIEW ───────────────────────────────────────────────────────────────
  const renderOverview = () => {
    const standbyTotal = fmt(totals.standbyWD+totals.standbyWE+totals.bankHol);
    const dStandby = prevData ? delta(standbyTotal, prevData.standby) : null;
    const dInc     = prevData ? delta(totals.incidents, prevData.incidents) : null;
    return (
      <>
        <div style={S.kpis}>
          {[
            { label:'Total standby hrs', val:`${standbyTotal}h`, color:'#93c5fd', delta:dStandby, deltaInvert:false },
            { label:'Incident hours',    val:`${fmt(totals.incidents)}h`, color:'#fcd34d', delta:dInc, deltaInvert:true },
            { label:'Upgrade hours',     val:`${fmt(totals.upgrades)}h`, color:'#6ee7b7' },
            { label:'Overtime',          val:`${fmt(totals.overtime)}h`, color:'#f472b6' },
            { label:'TOIL balance',      val:`${fmt(totals.toil)}h`, color:'#a78bfa' },
            { label:'Total on-call hrs', val:`${fmt(totalHrs)}h`, color:'var(--text-primary)', sub:`${visUsers.length} engineers` },
          ].map(({ label, val, color, delta: d, deltaInvert, sub }) => (
            <div key={label} style={S.kpi}>
              <div style={S.kpiLabel}>{label}</div>
              <div style={S.kpiVal(color)}>{val}</div>
              {d !== null && d !== undefined ? (
                <div style={{ marginTop:3 }}>
                  <span style={S.trendBadge(deltaInvert ? d<=0 : d>=0)}>{d>=0?'+':''}{d}% vs prev</span>
                </div>
              ) : sub ? <div style={S.kpiSub}>{sub}</div> : <div style={{ height:16 }}/>}
            </div>
          ))}
        </div>

        <div style={S.grid2}>
          <div style={S.card}>
            <div style={S.cTitle}>Hours mix</div>
            <div style={S.cSub}>{selCycleLabel} — all categories</div>
            <div style={S.legend}>
              {[['Standby WD','#93C5FD'],['Standby WE','#A78BFA'],['Incidents','#FCD34D'],['Overtime','#F472B6'],['Upgrades','#6EE7B7'],['Bank Hol','#FCA5A5']].map(([l,c])=>(
                <span key={l} style={{ display:'flex', alignItems:'center' }}><span style={S.legendDot(c)}/>{l}</span>
              ))}
            </div>
            <div style={{ position:'relative', height:200 }}>
              <canvas id="rpt-mix" role="img" aria-label="Doughnut chart of payroll hours by category"/>
            </div>
          </div>
          <div style={S.card}>
            <div style={S.cTitle}>Hours by engineer</div>
            <div style={S.cSub}>Total on-call hours this cycle</div>
            <div style={{ position:'relative', height:Math.max(160, visUsers.length*40+60) }}>
              <canvas id="rpt-eng" role="img" aria-label="Horizontal bar chart of hours per engineer"/>
            </div>
          </div>
        </div>

        <div style={S.grid1}>
          <div style={S.card}>
            <div style={S.cTitle}>Category breakdown — all engineers</div>
            <div style={S.cSub}>Stacked hours per category per engineer</div>
            <div style={S.legend}>
              {[['Standby WD','#93C5FD'],['Standby WE','#A78BFA'],['Worked WD','#60A5FA'],['Incidents','#FCD34D'],['Overtime','#F472B6'],['Upgrades','#6EE7B7'],['Bank Hol','#FCA5A5']].map(([l,c])=>(
                <span key={l} style={{ display:'flex', alignItems:'center' }}><span style={S.legendDot(c)}/>{l}</span>
              ))}
            </div>
            <div style={{ position:'relative', height:Math.max(180, visUsers.length*46+60) }}>
              <canvas id="rpt-stack" role="img" aria-label="Stacked bar chart of category hours per engineer"/>
            </div>
          </div>
        </div>
      </>
    );
  };

  // ── ENGINEERS ──────────────────────────────────────────────────────────────
  const renderEngineers = () => {
    const maxTotal = Math.max(...cycleData.map(r=>fmt((r.oc.standbyWD||0)+(r.oc.workedWD||0)+(r.oc.standbyWE||0)+(r.oc.workedWE||0)+(r.incHrs||0)+(r.upgradeHrs||0)+(r.bankHolHrs||0)+(r.overtimeHrs||0))), 1);
    return (
      <div style={S.card}>
        <div style={S.cTitle}>Engineer breakdown — {selCycleLabel}</div>
        <div style={S.cSub}>Full breakdown per team member with flags</div>
        <div style={{ overflowX:'auto' }}>
          <table style={S.tbl}>
            <thead>
              <tr>
                {['Engineer','Standby WD','Standby WE','Worked WD','Incidents','Overtime','TOIL bal.','Total'].map(h=>(
                  <th key={h} style={{ ...S.th, textAlign: h==='Engineer'?'left':'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cycleData.map(({ u, oc, incHrs, upgradeHrs, bankHolHrs, overtimeHrs, tb }) => {
                const total = fmt((oc.standbyWD||0)+(oc.workedWD||0)+(oc.standbyWE||0)+(oc.workedWE||0)+(incHrs||0)+(upgradeHrs||0)+(bankHolHrs||0)+(overtimeHrs||0));
                const barW  = Math.round(total/maxTotal*70);
                const initials = u.name.split(' ').map(w=>w[0]).join('').slice(0,2);
                return (
                  <React.Fragment key={u.id}>
                    <tr>
                      <td style={S.td}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:28, height:28, borderRadius:'50%', background:`${u.color||'#1d4ed8'}22`, border:`1.5px solid ${u.color||'#1d4ed8'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:u.color||'#1d4ed8', flexShrink:0 }}>{initials}</div>
                          <div>
                            <div style={{ fontSize:12, fontWeight:500 }}>{u.name}</div>
                            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'DM Mono, monospace' }}>{u.id}</div>
                          </div>
                        </div>
                      </td>
                      <td style={S.tdNum}>{oc.standbyWD||0}h</td>
                      <td style={S.tdNum}>{oc.standbyWE||0}h</td>
                      <td style={S.tdNum}>{oc.workedWD||0}h</td>
                      <td style={{ ...S.tdNum, color: incHrs>0?'#fcd34d':'var(--text-muted)' }}>{incHrs>0?`${incHrs}h`:'—'}</td>
                      <td style={{ ...S.tdNum, color: overtimeHrs>0?'#f472b6':'var(--text-muted)' }}>{overtimeHrs>0?`${overtimeHrs}h`:'—'}</td>
                      <td style={{ ...S.tdNum, color: (tb?.balance||0)>0?'#38bdf8':'var(--text-muted)' }}>{tb?.balance||0}h</td>
                      <td style={S.tdNum}>
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
                        {[
                          incHrs>0     && <span key="inc"  style={S.pill('rgba(252,211,77,0.15)','#fcd34d')}>{incHrs}h incidents</span>,
                          overtimeHrs>0 && <span key="ot"  style={S.pill('rgba(244,114,182,0.15)','#f472b6')}>{overtimeHrs}h overtime</span>,
                          (tb?.balance||0)>0 && <span key="toil" style={S.pill('rgba(56,189,248,0.15)','#38bdf8')}>{tb.balance}h TOIL</span>,
                          upgradeHrs>0  && <span key="upg" style={S.pill('rgba(110,231,183,0.15)','#6ee7b7')}>{upgradeHrs}h upgrades</span>,
                          bankHolHrs>0  && <span key="bh"  style={S.pill('rgba(252,165,165,0.15)','#fca5a5')}>{bankHolHrs}h bank hol</span>,
                        ].filter(Boolean).reduce((acc,el,i)=>[...acc,i?<span key={`sp${i}`} style={{ margin:'0 4px' }}></span>:null,el],[]).filter(Boolean)}
                        {[incHrs,overtimeHrs,tb?.balance,upgradeHrs,bankHolHrs].every(v=>!v) && (
                          <span style={{ color:'var(--text-muted)' }}>No flagged items this cycle</span>
                        )}
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

  // ── TREND ──────────────────────────────────────────────────────────────────
  const renderTrend = () => {
    const avgStandby  = fmt(trendData.reduce((a,d)=>a+d.standby,0)/Math.max(trendData.length,1));
    const avgInc      = fmt(trendData.reduce((a,d)=>a+d.incidents,0)/Math.max(trendData.length,1));
    const avgOT       = fmt(trendData.reduce((a,d)=>a+d.overtime,0)/Math.max(trendData.length,1));
    return (
      <>
        <div style={S.kpis}>
          {[
            { label:'Avg standby / cycle', val:`${avgStandby}h`, color:'#93c5fd' },
            { label:'Avg incidents / cycle', val:`${avgInc}h`, color:'#fcd34d' },
            { label:'Avg overtime / cycle', val:`${avgOT}h`, color:'#f472b6' },
            { label:'Cycles tracked', val:`${trendData.length}`, color:'var(--text-primary)' },
          ].map(({ label, val, color }) => (
            <div key={label} style={S.kpi}>
              <div style={S.kpiLabel}>{label}</div>
              <div style={S.kpiVal(color)}>{val}</div>
            </div>
          ))}
        </div>
        <div style={S.grid1}>
          <div style={S.card}>
            <div style={S.cTitle}>Hours trend — last {trendData.length} cycles</div>
            <div style={S.cSub}>Standby, incidents and overtime by payroll cycle</div>
            <div style={S.legend}>
              {[['Standby','#93C5FD'],['Incidents','#FCD34D'],['Overtime','#F472B6'],['Upgrades','#6EE7B7']].map(([l,c])=>(
                <span key={l} style={{ display:'flex', alignItems:'center' }}><span style={S.legendDot(c)}/>{l}</span>
              ))}
            </div>
            <div style={{ position:'relative', height:260 }}>
              <canvas id="rpt-trend" role="img" aria-label="Line chart of payroll hours across cycles"/>
            </div>
          </div>
        </div>
        <div style={S.grid1}>
          <div style={S.card}>
            <div style={S.cTitle}>Per-engineer trend</div>
            <div style={S.cSub}>Total on-call hours per engineer across all tracked cycles</div>
            <div style={{ position:'relative', height:280 }}>
              <canvas id="rpt-eng-trend" role="img" aria-label="Multi-line chart of per-engineer hours across cycles"/>
            </div>
          </div>
        </div>
      </>
    );
  };

  // ── INCIDENTS ──────────────────────────────────────────────────────────────
  const renderIncidents = () => {
    const safeInc   = Array.isArray(incidents) ? incidents : [];
    const filteredInc = engFilter==='all' ? safeInc : safeInc.filter(i=>i.assigned_to===engFilter);
    const sevOrder  = { Disaster:0, Critical:1, High:2, Medium:3, Low:4 };
    const sorted    = [...filteredInc].sort((a,b)=>(sevOrder[a.severity]??9)-(sevOrder[b.severity]??9));
    const bySev     = {};
    filteredInc.forEach(i=>{ bySev[i.severity||'Unknown']=(bySev[i.severity||'Unknown']||0)+1; });
    const totIncHrs = filteredInc.reduce((a,i)=>a+(i.hours_worked||0),0);

    return (
      <>
        <div style={S.kpis}>
          {[
            { label:'Disasters',        val: bySev.Disaster||0,  color:'#fca5a5' },
            { label:'Critical',         val: bySev.Critical||0,  color:'#fcd34d' },
            { label:'High',             val: bySev.High||0,      color:'#93c5fd' },
            { label:'Total incident hrs', val:`${totIncHrs}h`,   color:'#6ee7b7' },
          ].map(({ label, val, color }) => (
            <div key={label} style={S.kpi}>
              <div style={S.kpiLabel}>{label}</div>
              <div style={S.kpiVal(color)}>{val}</div>
            </div>
          ))}
        </div>

        <div style={S.grid2}>
          <div style={S.card}>
            <div style={S.cTitle}>Incidents by engineer</div>
            <div style={S.cSub}>Total count assigned</div>
            <div style={{ position:'relative', height:Math.max(140, users.length*38+50) }}>
              <canvas id="rpt-inc-eng" role="img" aria-label="Bar chart of incident count by engineer"/>
            </div>
          </div>
          <div style={S.card}>
            <div style={S.cTitle}>Severity distribution</div>
            <div style={S.cSub}>All incidents logged</div>
            <div style={S.legend}>
              {Object.keys(bySev).map(k=>(
                <span key={k} style={{ display:'flex', alignItems:'center' }}><span style={S.legendDot(SEV_COLORS[k]?.[1]||'#888')}/>{k}: {bySev[k]}</span>
              ))}
            </div>
            <div style={{ position:'relative', height:180 }}>
              <canvas id="rpt-inc-sev" role="img" aria-label="Pie chart of incident severity distribution"/>
            </div>
          </div>
        </div>

        <div style={S.grid1}>
          <div style={S.card}>
            <div style={S.cTitle}>Incident log</div>
            <div style={S.cSub}>{sorted.length} incidents — sorted by severity</div>
            <div style={{ overflowX:'auto' }}>
              <table style={S.tbl}>
                <thead>
                  <tr>
                    {['Date','Severity','Title','Assignee','Hours','Status'].map(h=>(
                      <th key={h} style={{ ...S.th, textAlign:h==='Hours'?'right':'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(inc => {
                    const eng = users.find(u=>u.id===inc.assigned_to);
                    const [bg, fg] = SEV_COLORS[inc.severity]||['rgba(136,135,128,0.15)','#94a3b8'];
                    const statusColor = inc.status==='resolved'||inc.status==='Resolved' ? '#6ee7b7' : '#fcd34d';
                    const d = (inc.date||inc.created_at||'').slice(0,10);
                    return (
                      <tr key={inc.id}>
                        <td style={{ ...S.td, fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{d ? fmtD(d) : '—'}</td>
                        <td style={S.td}><span style={S.pill(bg, fg)}>{inc.severity||'Unknown'}</span></td>
                        <td style={{ ...S.td, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inc.title||'—'}</td>
                        <td style={{ ...S.td, fontSize:11 }}>{eng?.name?.split(' ')[0]||inc.assigned_to||'—'}</td>
                        <td style={{ ...S.tdNum, color:(inc.hours_worked||0)>0?'#fcd34d':'var(--text-muted)' }}>{(inc.hours_worked||0)>0?`${inc.hours_worked}h`:'—'}</td>
                        <td style={S.td}><span style={{ fontSize:11, color:statusColor }}>{inc.status||'—'}</span></td>
                      </tr>
                    );
                  })}
                  {sorted.length===0 && (
                    <tr><td colSpan={6} style={{ ...S.td, textAlign:'center', color:'var(--text-muted)', padding:'24px 0' }}>No incidents found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <span style={S.tbLabel}>View</span>
        <div style={S.seg}>
          {[['overview','Overview'],['engineers','By engineer'],['trend','Trend'],['incidents','Incidents']].map(([v,l])=>(
            <button key={v} style={S.segBtn(view===v)} onClick={()=>setView(v)}>{l}</button>
          ))}
        </div>

        <span style={{ ...S.tbLabel, marginLeft:8 }}>Cycle</span>
        <select className="input" style={{ fontSize:12, padding:'5px 8px', minWidth:220, fontFamily:'DM Mono, monospace' }}
          value={selCycleStart}
          onChange={e => {
            const c = allCycles.find(c=>c.start===e.target.value);
            if (c) { setSelCycleStart(c.start); setSelCycleEnd(c.end); }
          }}>
          {allCycles.map(c=>(
            <option key={c.start} value={c.start}>{c.start===cycleStart?'▶ ':''}{c.label}</option>
          ))}
        </select>

        <span style={{ ...S.tbLabel, marginLeft:8 }}>Engineer</span>
        <select className="input" style={{ fontSize:12, padding:'5px 8px' }}
          value={engFilter} onChange={e=>setEngFilter(e.target.value)}>
          <option value="all">All engineers</option>
          {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {/* View content */}
      {view==='overview'   && renderOverview()}
      {view==='engineers'  && renderEngineers()}
      {view==='trend'      && renderTrend()}
      {view==='incidents'  && renderIncidents()}
    </div>
  );
}


export default Payroll;
