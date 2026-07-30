// src/Logs.js
// CloudOps Rota — Activity Logs & Login Diagnostics
//
// Extracted out of App.js into its own file. Two jobs:
//   1. A structured, append-only event log (auth attempts, and anything else
//      that calls addLog()), written to Drive as events_log.json, viewable
//      across every device/user on the manager's "Activity Logs" page.
//   2. A login-issue breakdown that's reusable from BOTH that manager page
//      AND a button right on the login screen — so someone who can't get in
//      (or the manager helping them remotely) can see exactly why, without
//      needing to already be logged in.
//
// Self-contained Drive helpers (same pattern as Payroll.js/Dashboard.js) —
// deliberately no dependency on App.js, to avoid a circular import.

import React, { useState, useEffect, useCallback } from 'react';

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
  const uploadResult = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }).then(r => r.json());
  if (uploadResult.error) throw new Error(uploadResult.error.message || 'Drive write failed');
  return uploadResult;
}

const LOG_FILE = 'events_log.json';
const MAX_LOG_ENTRIES = 1500; // oldest entries drop off past this so the file doesn't grow forever

// ── Lightweight device fingerprint ───────────────────────────────────────────
// Just enough to tell "which computer" apart in a breakdown — no tracking,
// no IP, nothing beyond what the browser already exposes to the page anyway.
export function deviceLabel() {
  try {
    const ua = navigator.userAgent || '';
    const isMobile = /Mobile|Android|iPhone/i.test(ua);
    let browser = 'Unknown browser';
    if (ua.includes('Edg/'))          browser = 'Edge';
    else if (ua.includes('OPR/'))     browser = 'Opera';
    else if (ua.includes('Chrome/'))  browser = 'Chrome';
    else if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Safari/'))  browser = 'Safari';
    let os = 'Unknown OS';
    if (ua.includes('Windows'))                        os = 'Windows';
    else if (ua.includes('Mac OS'))                     os = 'macOS';
    else if (ua.includes('Android'))                    os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Linux'))                      os = 'Linux';
    return `${browser} · ${os}${isMobile ? ' · mobile' : ''}`;
  } catch (_) { return 'Unknown device'; }
}

// ── Write a log entry ─────────────────────────────────────────────────────────
// Signature: createLogWriter(driveToken, uid, users)({ action, section, detail, level?, uid?, user? })
// Fire-and-forget by convention at every call site (.catch(()=>{})) — a log
// write failing should never block or break the action being logged.
// NOTE: this is a best-effort append (read-modify-write, not queued/retried
// like the main app data in useGoogleDrive.js) — acceptable here because
// losing an occasional log line under heavy concurrent write pressure is a
// much lower-stakes failure than losing real rota/incident data would be.
export function createLogWriter(driveToken, uid, users) {
  return async (entry) => {
    if (!driveToken) return;
    const effectiveUid = entry.uid || uid || null;
    const user = (users || []).find(u => u.id === effectiveUid);
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      uid: effectiveUid,
      userName: entry.user || user?.name || effectiveUid || 'Unknown',
      section: entry.section || 'general',
      level: entry.level || 'info', // 'info' | 'warn' | 'error'
      action: entry.action || '',
      detail: entry.detail || '',
      device: deviceLabel(),
    };
    let list = [];
    try {
      const file = await driveFindFile(driveToken, LOG_FILE);
      if (file?.id) {
        const data = await driveReadJson(driveToken, file.id);
        if (Array.isArray(data)) list = data;
      }
    } catch (_) { /* start fresh if the read fails — better to log than to throw */ }
    const next = [...list, record].slice(-MAX_LOG_ENTRIES);
    await driveWriteJson(driveToken, LOG_FILE, next);
  };
}

// ── Read all logs ─────────────────────────────────────────────────────────────
// Usable with ONLY a Drive token — deliberately does not require the person
// to already be logged into the app, since the whole point of the login-page
// button is to work when logging in is exactly the thing that's broken.
export async function readLogs(driveToken) {
  if (!driveToken) return [];
  try {
    const file = await driveFindFile(driveToken, LOG_FILE);
    if (!file?.id) return [];
    const data = await driveReadJson(driveToken, file.id);
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}

// ── Login issue breakdown ─────────────────────────────────────────────────────
// Reusable component: the manager's full Activity Logs page AND the login
// screen's diagnostics button both render this against the same log data.
export function LoginIssuesBreakdown({ logs, highlightUid }) {
  const authLogs = (logs || []).filter(l => l.section === 'auth');
  const successes = authLogs.filter(l => l.level === 'info');
  const failures  = authLogs.filter(l => l.level !== 'info');

  const byReason = {};
  failures.forEach(l => { byReason[l.action] = (byReason[l.action] || 0) + 1; });
  const reasonRows = Object.entries(byReason).sort((a, b) => b[1] - a[1]);

  const byUser = {};
  failures.forEach(l => { const k = l.userName || l.uid || 'Unknown'; byUser[k] = (byUser[k] || 0) + 1; });
  const userRows = Object.entries(byUser).sort((a, b) => b[1] - a[1]);

  const byDevice = {};
  failures.forEach(l => { const k = l.device || 'Unknown device'; byDevice[k] = (byDevice[k] || 0) + 1; });
  const deviceRows = Object.entries(byDevice).sort((a, b) => b[1] - a[1]);

  const recentFailures = failures
    .slice().sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 25);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          ['Login attempts', authLogs.length, '#38bdf8'],
          ['Successful',     successes.length, '#22c55e'],
          ['Failed',         failures.length,  failures.length > 0 ? '#ef4444' : '#22c55e'],
        ].map(([label, val, color]) => (
          <div key={label} style={{ flex: '1 1 140px', padding: '12px 14px', borderRadius: 10, background: 'var(--bg-card, #161b22)', border: '1px solid var(--border, #30363d)' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'DM Mono, monospace' }}>{val}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {failures.length === 0 ? (
        <div style={{ padding: '18px 16px', textAlign: 'center', color: '#22c55e', fontSize: 13, border: '1px dashed var(--border, #30363d)', borderRadius: 10 }}>
          ✅ No failed login attempts recorded.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-card, #161b22)', border: '1px solid var(--border, #30363d)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #8b949e)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>By reason</div>
            {reasonRows.map(([reason, count]) => (
              <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                <span style={{ color: '#f87171' }}>{reason}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-card, #161b22)', border: '1px solid var(--border, #30363d)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #8b949e)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>By engineer</div>
            {userRows.map(([u, count]) => (
              <div key={u} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                <span style={{ color: u === highlightUid ? '#fbbf24' : 'var(--text-secondary, #c9d1d9)', fontWeight: u === highlightUid ? 700 : 400 }}>{u}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-card, #161b22)', border: '1px solid var(--border, #30363d)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #8b949e)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>By device</div>
            {deviceRows.map(([d, count]) => (
              <div key={d} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary, #c9d1d9)' }}>{d}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentFailures.length > 0 && (
        <div style={{ borderRadius: 10, border: '1px solid var(--border, #30363d)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #8b949e)', textTransform: 'uppercase', letterSpacing: 1, background: 'rgba(255,255,255,0.03)' }}>
            Recent failed attempts
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 14px', fontSize: 10, color: 'var(--text-muted, #8b949e)' }}>Time</th>
                <th style={{ textAlign: 'left', padding: '6px 14px', fontSize: 10, color: 'var(--text-muted, #8b949e)' }}>User</th>
                <th style={{ textAlign: 'left', padding: '6px 14px', fontSize: 10, color: 'var(--text-muted, #8b949e)' }}>Reason</th>
                <th style={{ textAlign: 'left', padding: '6px 14px', fontSize: 10, color: 'var(--text-muted, #8b949e)' }}>Device</th>
              </tr>
            </thead>
            <tbody>
              {recentFailures.map(l => (
                <tr key={l.id}>
                  <td style={{ padding: '6px 14px', fontSize: 11, fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>
                    {l.timestamp ? new Date(l.timestamp).toLocaleString('en-GB') : '—'}
                  </td>
                  <td style={{ padding: '6px 14px', fontSize: 12 }}>{l.userName || l.uid || '—'}</td>
                  <td style={{ padding: '6px 14px', fontSize: 12, color: '#f87171' }}>{l.action}{l.detail ? ` — ${l.detail}` : ''}</td>
                  <td style={{ padding: '6px 14px', fontSize: 11, color: 'var(--text-muted, #8b949e)' }}>{l.device || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Full Activity Logs page (manager-only) ────────────────────────────────────
export default function Logs({ isManager, driveToken, users, currentUser }) {
  const [logs, setLogs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [section, setSection]   = useState('all'); // 'all' | 'auth' | 'general' | ...
  const [level, setLevel]       = useState('all');  // 'all' | 'info' | 'warn' | 'error'
  const [view, setView]         = useState('issues'); // 'issues' | 'all'

  const load = useCallback(async () => {
    setLoading(true);
    const data = await readLogs(driveToken);
    setLogs(data);
    setLoading(false);
  }, [driveToken]);

  useEffect(() => { load(); }, [load]);

  if (!isManager) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Activity Logs are only available to managers.
      </div>
    );
  }

  const sections = ['all', ...new Set(logs.map(l => l.section).filter(Boolean))];
  const filtered = logs
    .filter(l => section === 'all' || l.section === section)
    .filter(l => level === 'all' || l.level === level)
    .slice().sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>📋 Activity Logs</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
            Every recorded event across all users and devices — {logs.length} total entries.
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? '⏳ Loading…' : '🔄 Refresh'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button className={`btn btn-sm ${view === 'issues' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('issues')}>🔑 Login Issues</button>
        <button className={`btn btn-sm ${view === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('all')}>📄 All Events</button>
      </div>

      {view === 'issues' ? (
        <LoginIssuesBreakdown logs={logs} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <select className="select" value={section} onChange={e => setSection(e.target.value)} style={{ width: 160 }}>
              {sections.map(s => <option key={s} value={s}>{s === 'all' ? 'All sections' : s}</option>)}
            </select>
            <select className="select" value={level} onChange={e => setLevel(e.target.value)} style={{ width: 140 }}>
              <option value="all">All levels</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Time</th><th>User</th><th>Section</th><th>Level</th><th>Action</th><th>Detail</th><th>Device</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 12, whiteSpace: 'nowrap' }}>{l.timestamp ? new Date(l.timestamp).toLocaleString('en-GB') : '—'}</td>
                    <td>{l.userName || l.uid || '—'}</td>
                    <td>{l.section}</td>
                    <td style={{ color: l.level === 'error' ? '#ef4444' : l.level === 'warn' ? '#f59e0b' : '#22c55e', fontWeight: 700 }}>{l.level}</td>
                    <td>{l.action}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{l.detail}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.device}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No events match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
