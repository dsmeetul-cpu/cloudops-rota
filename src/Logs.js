// src/Logs.js
// CloudOps Rota — Activity Log Viewer (Manager Only)
// Meetul Bhundia (MBA47) · Cloud Run Operations · June 2026
//
// Logs are written to the CRO_LOGS folder in Google Drive.
// Each log entry: { id, timestamp, user, uid, action, section, detail, level }
// Levels: 'info' | 'warning' | 'error' | 'success'
// Only the Manager (isManager === true) can view this page.

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Drive helpers (mirror App.js pattern) ─────────────────────────────────
const LOG_FOLDER_NAME = 'CRO_LOGS';
const LOG_FILE_NAME   = 'activity_log.json';
let _logFolderIdCache = null;
let _logFileIdCache   = null;

async function getLogFolderId(token) {
  if (_logFolderIdCache) return _logFolderIdCache;
  const q = encodeURIComponent(
    `name='${LOG_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());

  if (resp.files && resp.files.length > 0) {
    _logFolderIdCache = resp.files[0].id;
    return _logFolderIdCache;
  }

  // Create CRO_LOGS folder
  const created = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: LOG_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  }).then(r => r.json());

  _logFolderIdCache = created.id;
  return _logFolderIdCache;
}

async function findLogFile(token, folderId) {
  if (_logFileIdCache) return _logFileIdCache;
  const q = encodeURIComponent(
    `name='${LOG_FILE_NAME}' and '${folderId}' in parents and trashed=false`
  );
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  if (resp.files && resp.files.length > 0) {
    _logFileIdCache = resp.files[0].id;
    return _logFileIdCache;
  }
  return null;
}

export async function readLogsFromDrive(token) {
  try {
    const folderId = await getLogFolderId(token);
    const fileId   = await findLogFile(token, folderId);
    if (!fileId) return [];
    const data = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&_t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' } }
    ).then(r => r.json());
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('CRO_LOGS read failed:', e?.message);
    return [];
  }
}

export async function writeLogsToDrive(token, logs) {
  try {
    const folderId = await getLogFolderId(token);
    const body     = JSON.stringify(logs);
    let fileId     = await findLogFile(token, folderId);

    if (fileId) {
      const result = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }
      ).then(r => r.json());
      if (result.error) {
        _logFileIdCache = null;
        fileId = null;
      }
    }

    if (!fileId) {
      const meta = { name: LOG_FILE_NAME, mimeType: 'application/json', parents: [folderId] };
      const created = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      }).then(r => r.json());
      _logFileIdCache = created.id;
      await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }
      );
    }
  } catch (e) {
    console.warn('CRO_LOGS write failed:', e?.message);
  }
}

// ── Public API: write a single log entry ──────────────────────────────────
// Call this from App.js / other components via the addLog prop.
// addLog({ action, section, detail, level?, uid?, user? })
export function createLogWriter(token, currentUser, users) {
  return async function addLog({ action, section, detail, level = 'info', uid, user: userName }) {
    if (!token) return;
    try {
      const existingLogs = await readLogsFromDrive(token);
      const u = users?.find(x => x.id === (uid || currentUser));
      const entry = {
        id:        `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        uid:       uid || currentUser,
        user:      userName || u?.name || uid || currentUser,
        section,
        action,
        detail,
        level,
      };
      const updated = [entry, ...existingLogs].slice(0, 2000); // keep last 2000
      await writeLogsToDrive(token, updated);
    } catch (e) {
      console.warn('addLog failed:', e?.message);
    }
  };
}

// ── Colours ───────────────────────────────────────────────────────────────
const LEVEL_STYLE = {
  info:    { bg: '#1e40af22', border: '#3b82f6', text: '#93c5fd', icon: 'ℹ️' },
  success: { bg: '#16653422', border: '#22c55e', text: '#86efac', icon: '✅' },
  warning: { bg: '#92400e22', border: '#f59e0b', text: '#fcd34d', icon: '⚠️' },
  error:   { bg: '#7f1d1d22', border: '#ef4444', text: '#fca5a5', icon: '🚨' },
};

const SECTION_ICONS = {
  incidents: '🚨', holidays: '🌴', rota: '🔄', payroll: '💷', settings: '🔧',
  users: '👤', login: '🔐', logout: '🚪', wiki: '📖', toil: '⏳',
  upgrades: '⬆', timesheets: '⏱', overtime: '🕐', absence: '🏥',
  announcements: '📢', calendar: '📅', logs: '📋', auth: '🔑', drive: '☁️',
};

function LevelBadge({ level }) {
  const s = LEVEL_STYLE[level] || LEVEL_STYLE.info;
  return (
    <span style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.text,
      borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 600,
    }}>
      {s.icon} {level.toUpperCase()}
    </span>
  );
}

// ── Logs Component ─────────────────────────────────────────────────────────
export default function Logs({ isManager, driveToken, users, currentUser }) {
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [filter,    setFilter]    = useState({ level: 'all', section: 'all', uid: 'all', search: '' });
  const [page,      setPage]      = useState(0);
  const PAGE_SIZE = 50;
  const pollRef = useRef(null);

  const loadLogs = useCallback(async () => {
    if (!driveToken) return;
    setLoading(true);
    try {
      const data = await readLogsFromDrive(driveToken);
      setLogs(data);
    } catch (_) {}
    setLoading(false);
  }, [driveToken]);

  useEffect(() => {
    loadLogs();
    // Poll every 30s
    pollRef.current = setInterval(loadLogs, 30000);
    return () => clearInterval(pollRef.current);
  }, [loadLogs]);

  if (!isManager) {
    return (
      <div className="alert alert-warning">
        ⚠ Activity Logs are restricted to the Manager.
      </div>
    );
  }

  // ── Filter ──────────────────────────────────────────────────────────────
  const allSections = [...new Set(logs.map(l => l.section).filter(Boolean))].sort();
  const allLevels   = ['info', 'success', 'warning', 'error'];

  const filtered = logs.filter(l => {
    if (filter.level   !== 'all' && l.level   !== filter.level)   return false;
    if (filter.section !== 'all' && l.section !== filter.section) return false;
    if (filter.uid     !== 'all' && l.uid     !== filter.uid)     return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      if (!(
        l.action?.toLowerCase().includes(q) ||
        l.detail?.toLowerCase().includes(q) ||
        l.user?.toLowerCase().includes(q)   ||
        l.section?.toLowerCase().includes(q)
      )) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const setF = (k, v) => { setFilter(f => ({ ...f, [k]: v })); setPage(0); };

  const exportCsv = () => {
    const rows = [
      ['Timestamp', 'User', 'UID', 'Section', 'Action', 'Detail', 'Level'],
      ...filtered.map(l => [
        l.timestamp, l.user, l.uid, l.section, l.action,
        (l.detail || '').replace(/,/g, ';'), l.level,
      ]),
    ];
    const csv  = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url;
    a.download = `CRO_LOGS_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="flex-between">
          <div>
            <div className="page-title">📋 Activity Logs</div>
            <div className="page-sub">
              Audit trail stored in <code style={{ fontSize: 11, color: 'var(--accent)' }}>CRO_LOGS/activity_log.json</code> on Google Drive · Manager only
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={loadLogs} disabled={loading}>
              {loading ? '⏳ Loading…' : '🔄 Refresh'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!filtered.length}>
              ⬇ Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {allLevels.map(lv => {
          const s = LEVEL_STYLE[lv];
          const count = logs.filter(l => l.level === lv).length;
          return (
            <div key={lv} onClick={() => setF('level', filter.level === lv ? 'all' : lv)}
              className="card" style={{
                padding: '10px 16px', cursor: 'pointer', minWidth: 90, textAlign: 'center',
                border: `1px solid ${filter.level === lv ? s.border : 'var(--border)'}`,
                opacity: count === 0 ? 0.4 : 1,
              }}>
              <div style={{ fontSize: 18 }}>{s.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.text }}>{count}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{lv}</div>
            </div>
          );
        })}
        <div className="card" style={{ padding: '10px 16px', minWidth: 90, textAlign: 'center' }}>
          <div style={{ fontSize: 18 }}>📋</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{logs.length}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="form-input"
            style={{ width: 200 }}
            placeholder="🔍 Search action / detail / user…"
            value={filter.search}
            onChange={e => setF('search', e.target.value)}
          />
          <select className="form-input" style={{ width: 130 }} value={filter.level} onChange={e => setF('level', e.target.value)}>
            <option value="all">All Levels</option>
            {allLevels.map(lv => <option key={lv} value={lv}>{lv.toUpperCase()}</option>)}
          </select>
          <select className="form-input" style={{ width: 150 }} value={filter.section} onChange={e => setF('section', e.target.value)}>
            <option value="all">All Sections</option>
            {allSections.map(s => <option key={s} value={s}>{(SECTION_ICONS[s] || '📌')} {s}</option>)}
          </select>
          <select className="form-input" style={{ width: 160 }} value={filter.uid} onChange={e => setF('uid', e.target.value)}>
            <option value="all">All Engineers</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {(filter.level !== 'all' || filter.section !== 'all' || filter.uid !== 'all' || filter.search) && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setFilter({ level:'all', section:'all', uid:'all', search:'' }); setPage(0); }}>
              ✕ Clear
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {filtered.length} entries
          </span>
        </div>
      </div>

      {/* Log table */}
      {!driveToken && (
        <div className="alert alert-warning">⚠ Drive not connected — logs require Google Drive.</div>
      )}
      {driveToken && loading && logs.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>⏳ Loading logs from Drive…</div>
      )}
      {driveToken && !loading && logs.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>No logs yet</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Activity logs will appear here as the team uses the app.
          </div>
        </div>
      )}

      {paged.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 700, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 140 }}>Timestamp</th>
                <th style={{ width: 90  }}>User</th>
                <th style={{ width: 80  }}>Section</th>
                <th style={{ width: 80  }}>Level</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(log => {
                const s = LEVEL_STYLE[log.level] || LEVEL_STYLE.info;
                const dt = log.timestamp ? new Date(log.timestamp) : null;
                const dtStr = dt
                  ? dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' }) +
                    ' ' + dt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
                  : '—';
                const u = users.find(x => x.id === log.uid);
                return (
                  <tr key={log.id} style={{ borderLeft: `3px solid ${s.border}` }}>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {dtStr}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {u && (
                          <div style={{
                            width: 22, height: 22, borderRadius: 6,
                            background: u.color || '#1d4ed8',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
                          }}>{u.avatar || u.id?.slice(0,2)}</div>
                        )}
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>{log.user || log.uid}</div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{log.uid}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        {SECTION_ICONS[log.section] || '📌'} {log.section || '—'}
                      </span>
                    </td>
                    <td><LevelBadge level={log.level || 'info'} /></td>
                    <td style={{ fontWeight: 500 }}>{log.action || '—'}</td>
                    <td style={{ color: 'var(--text-muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.detail || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0}>← Prev</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page {page+1} of {totalPages}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.min(totalPages-1, p+1))} disabled={page === totalPages-1}>Next →</button>
        </div>
      )}
    </div>
  );
}
