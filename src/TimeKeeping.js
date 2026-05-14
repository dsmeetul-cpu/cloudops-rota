// src/TimeKeeping.js
// CloudOps Rota — Time Keeping & Attendance
// Fixed: blank screen after check-in (tab init), restored all manager tabs
// (Dashboard, Heat Map, Alerts, Log + Excel export), holidays prop, unconfirm

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { driveWrite, driveRead } from './hooks/useGoogleDrive';

// ── Constants ─────────────────────────────────────────────────────────────────
const RTO_DAYS_REQUIRED = 3;
const START_TIME        = '09:00';
const GRACE_LATE_WARN   = 15; // mins → amber
const GRACE_LATE_LATE   = 20; // mins → red
const STREAK_THRESHOLD  = 3;  // consecutive lates = pattern

function DriveStatus({ token, saving }) {
  if (!token) return (
    <span style={{ fontSize: 11, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
      ⚠ Not connected to Drive
    </span>
  );
  return (
    <span style={{ fontSize: 11, color: saving ? '#f59e0b' : '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
      {saving ? '⏳ Saving…' : '☁ Saved'}
    </span>
  );
}

// ── Device detection ─────────────────────────────────────────────────────────
function detectDevice() {
  const ua = navigator.userAgent || '';
  const w  = window.innerWidth  || 0;
  const isTablet  = /iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile  = !isTablet && (/Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || w < 768);
  if (isTablet) return 'tablet';
  if (isMobile) return 'mobile';
  return 'desktop';
}
const DEVICE_META = {
  desktop: { icon: '💻', label: 'Desktop / Laptop', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)'  },
  mobile:  { icon: '📱', label: 'Mobile Phone',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
  tablet:  { icon: '📟', label: 'Tablet',           color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.3)'  },
};
function DevicePill({ device, small }) {
  if (!device) return <span style={{ color: 'var(--text-muted)', fontSize: small ? 10 : 11 }}>—</span>;
  const m = DEVICE_META[device] || DEVICE_META.desktop;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: small ? 3 : 4,
      padding: small ? '2px 6px' : '3px 9px',
      borderRadius: 20, fontSize: small ? 10 : 11, fontWeight: 600,
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
    }} title={m.label}>
      {m.icon} {small ? '' : m.label}
    </span>
  );
}

// ── Status config ─────────────────────────────────────────────────────────────
// Core statuses always available to all users
const CORE_STATUSES = [
  { value: 'office',      label: 'Office',       icon: '🏢', color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.35)',  core: true },
  { value: 'wfh',         label: 'WFH',          icon: '🏠', color: '#818cf8', bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.35)', core: true },
  { value: 'bank-holiday',label: 'Bank Holiday', icon: '🔴', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)',  core: true },
];
// Backward-compat map: old status values → new ones for existing Drive records
const LEGACY_STATUS_MAP = {
  present:   'office',
  late:      'office',
  'half-day':'office',
  absent:    'office',
};
function normStatus(val) {
  return LEGACY_STATUS_MAP[val] || val || 'office';
}
// Build full status list from core + manager extras
function buildStatusOptions(extraStatuses = []) {
  return [...CORE_STATUSES, ...(extraStatuses || [])];
}
function statusCfg(val, extraStatuses = []) {
  const all = buildStatusOptions(extraStatuses);
  return all.find(s => s.value === normStatus(val)) || CORE_STATUSES[0];
}
function StatusPill({ status, extraStatuses, small }) {
  const s = statusCfg(status, extraStatuses);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: small ? 3 : 4,
      padding: small ? '2px 7px' : '4px 10px',
      borderRadius: 20, fontSize: small ? 10 : 11, fontWeight: 600,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {s.icon} {s.label}
    </span>
  );
}

// ── Time / date helpers ───────────────────────────────────────────────────────
function parseTime(str) {
  if (!str) return null;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}
function computeLateStatus(checkIn) {
  const arr   = parseTime(checkIn);
  const start = parseTime(START_TIME);
  if (arr == null) return null;
  const diff = arr - start;
  if (diff <= 0)               return { status: 'ontime', label: 'On Time',   color: '#22c55e', diff };
  if (diff <= GRACE_LATE_WARN) return { status: 'early',  label: `+${diff}m`, color: '#22c55e', diff };
  if (diff <= GRACE_LATE_LATE) return { status: 'warn',   label: `+${diff}m`, color: '#f59e0b', diff };
  return                              { status: 'late',   label: `+${diff}m`, color: '#ef4444', diff };
}
function isWeekday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00').getDay();
  return d >= 1 && d <= 5;
}
function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00').getDay();
  return d === 0 || d === 6;
}
function isBankHoliday(dateStr, bh) {
  return (bh || []).some(b => (b.date || b) === dateStr);
}
function isOnHoliday(dateStr, userId, holidays) {
  return (holidays || []).some(h =>
    h.userId === userId && h.status === 'approved' &&
    dateStr >= h.startDate && dateStr <= h.endDate
  );
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function getWeekStart(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
function getWeeksFrom(startDate, count = 14) {
  const ws = getWeekStart(startDate);
  return Array.from({ length: count }, (_, i) => addDays(ws, i * 7));
}
function getAllWeekdays(weekStart) {
  return Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtHours(ci, co) {
  if (!ci || !co) return null;
  const [h1, m1] = ci.split(':').map(Number);
  const [h2, m2] = co.split(':').map(Number);
  let m = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (m < 0) m += 1440;
  return `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}m` : ''}`;
}
// London-timezone helpers (handles GMT/BST automatically)
function londonNow() {
  const now   = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const p = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  return new Date(`${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`);
}
function londonTodayStr() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const p = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  return `${p.year}-${p.month}-${p.day}`;
}
function londonTimeStr() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// ── Week/month grid helpers ───────────────────────────────────────────────────
function getWeekDates(offset = 0) {
  const base = new Date();
  const dow  = (base.getDay() + 6) % 7;
  base.setDate(base.getDate() - dow + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base); d.setDate(base.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}
function getMonthDates(year, month) {
  const first    = new Date(year, month, 1);
  const last     = new Date(year, month + 1, 0);
  const startDow = (first.getDay() + 6) % 7;
  const days     = [];
  for (let pre = startDow - 1; pre >= 0; pre--) {
    const d = new Date(first); d.setDate(1 - pre);
    days.push({ date: d.toISOString().slice(0, 10), isCurrentMonth: false });
  }
  for (let d = 1; d <= last.getDate(); d++)
    days.push({ date: new Date(year, month, d).toISOString().slice(0, 10), isCurrentMonth: true });
  while (days.length % 7 !== 0) {
    const prev = new Date(days[days.length - 1].date + 'T00:00:00');
    prev.setDate(prev.getDate() + 1);
    days.push({ date: prev.toISOString().slice(0, 10), isCurrentMonth: false });
  }
  return days;
}

// ── Data normaliser (old obj format → new array format) ───────────────────────
function normaliseEntries(uid, data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  // Old format: { [date]: { type, arrival, departure, note, confirmedBy, … } }
  return Object.entries(data).map(([date, v]) => {
    if (!v || typeof v !== 'object') return null;
    const checkIn  = v.checkIn  || v.arrival   || null;
    const checkOut = v.checkOut || v.departure  || null;
    let status = v.status;
    if (!status) {
      if (v.type === 'office') status = 'office';
      else status = v.type || 'office';
    }
    return {
      id:                 v.id || `ck-${uid}-${date}`,
      date,
      checkIn,
      checkOut,
      status:             normStatus(status),
      notes:              v.notes || v.note || '',
      confirmedByManager: !!(v.confirmedByManager || v.confirmedBy),
      confirmedAt:        v.confirmedAt || null,
      device:             v.device             || null,
      checkOutDevice:     v.checkOutDevice     || null,
    };
  }).filter(Boolean);
}

// ── UI primitives ─────────────────────────────────────────────────────────────
function Avatar({ user, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size > 40 ? 12 : 8,
      background: user?.color || '#1d4ed8', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size > 40 ? 14 : 11,
      fontWeight: 700, color: '#fff', flexShrink: 0, letterSpacing: 0.5,
    }}>
      {user?.avatar || (user?.id || '?').slice(0, 2).toUpperCase()}
    </div>
  );
}
function Tag({ label, type = 'blue' }) {
  const palette = {
    green: { bg: 'rgba(16,185,129,0.15)',  color: '#10b981', border: 'rgba(16,185,129,0.3)'  },
    amber: { bg: 'rgba(245,158,11,0.15)',  color: '#f59e0b', border: 'rgba(245,158,11,0.3)'  },
    red:   { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444', border: 'rgba(239,68,68,0.3)'   },
    blue:  { bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa', border: 'rgba(59,130,246,0.3)'  },
  };
  const c = palette[type] || palette.blue;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 12,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {label}
    </span>
  );
}
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 700 } : {}}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 20px 20px' }}>{children}</div>
      </div>
    </div>
  );
}
function FormGroup({ label, children, hint }) {
  return (
    <div className="form-group">
      <label className="form-label">
        {label}
        {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>({hint})</span>}
      </label>
      {children}
    </div>
  );
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

// ── Mini bar chart ────────────────────────────────────────────────────────────
function MiniBar({ value, max, color, height = 36, width = 22, label }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
      <div style={{ width, height, background: 'rgba(255,255,255,0.05)', borderRadius: 4,
        display: 'flex', alignItems: 'flex-end', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ width: '100%', height: `${pct * 100}%`, background: color,
          borderRadius: '3px 3px 0 0', transition: 'height 0.4s ease' }} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'DM Mono' }}>{value}</div>
    </div>
  );
}

// ── Donut chart ───────────────────────────────────────────────────────────────
function Donut({ pct, color, size = 64, label }) {
  const r    = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(pct / 100, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={6} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s ease' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: size < 70 ? 12 : 15, fontWeight: 700, color, fontFamily: 'DM Mono' }}>
          {Math.round(pct)}%
        </div>
      </div>
      {label && <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', maxWidth: size + 20 }}>{label}</div>}
    </div>
  );
}

// ── Heat map cell ─────────────────────────────────────────────────────────────
function HeatCell({ entry, bankHol, holiday, isToday, isFuture }) {
  let bg    = 'rgba(255,255,255,0.03)';
  let title = 'No data';
  if (holiday)       { bg = 'rgba(139,92,246,0.18)';  title = 'Holiday'; }
  else if (bankHol)  { bg = 'rgba(99,102,241,0.25)';  title = 'Bank Holiday'; }
  else if (isFuture) { bg = 'rgba(255,255,255,0.02)'; title = 'Future'; }
  else if (entry) {
    if (entry.status === 'office' || entry.status === 'wfh') {
      const ls = computeLateStatus(entry.checkIn);
      if (!ls || ls.status === 'ontime' || ls.status === 'early') { bg = 'rgba(34,197,94,0.28)'; title = `In: ${entry.checkIn || '?'}`; }
      else if (ls.status === 'warn') { bg = 'rgba(245,158,11,0.35)'; title = `Grace: ${entry.checkIn}`; }
      else                           { bg = 'rgba(239,68,68,0.3)';   title = `Late: ${entry.checkIn}`; }
    } else if (entry.status === 'late')   { bg = 'rgba(239,68,68,0.3)';   title = `Late: ${entry.checkIn || '?'}`; }
    else if (entry.status === 'wfh')    { bg = 'rgba(59,130,246,0.22)'; title = 'WFH'; }
    else if (entry.status === 'absent') { bg = 'rgba(239,68,68,0.15)'; title = 'Absent'; }
  }
  return (
    <div title={title} style={{
      width: 18, height: 18, borderRadius: 3, background: bg,
      border: isToday ? '1.5px solid #00c2ff' : '1px solid rgba(255,255,255,0.05)',
      cursor: 'pointer',
    }} />
  );
}

// ── WeekView sub-component ────────────────────────────────────────────────────
function WeekView({ entries, weekDates, bankHolidays = [] }) {
  const today = londonTodayStr();
  const DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {weekDates.map((d, i) => {
              const bh      = bankHolidays.find(b => (b.date || b) === d);
              const isToday = d === today;
              const isWE    = i >= 5;
              return (
                <th key={d} style={{ textAlign: 'center', fontSize: 11, minWidth: 100,
                  color: isToday ? 'var(--accent)' : bh ? '#fca5a5' : isWE ? '#818cf8' : undefined }}>
                  {DAYS[i]}<br />
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10 }}>
                    {new Date(d + 'T00:00:00').getDate()} {bh ? '🔴' : ''}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            {weekDates.map(d => {
              const entry   = entries.find(e => e.date === d);
              const isToday = d === today;
              const isBH    = bankHolidays.some(b => (b.date || b) === d);
              const isWE    = isWeekend(d);
              const hrs     = entry ? fmtHours(entry.checkIn, entry.checkOut) : null;
              if (isBH) return (
                <td key={d} style={{ textAlign: 'center', background: 'rgba(127,29,29,0.15)' }}>
                  <div style={{ fontSize: 10, color: '#fca5a5' }}>Bank Holiday</div>
                </td>
              );
              return (
                <td key={d} style={{ textAlign: 'center', verticalAlign: 'top', padding: '10px 8px',
                  background: isToday ? 'rgba(59,130,246,0.07)' : isWE ? 'rgba(129,140,248,0.04)' : undefined }}>
                  {entry ? (
                    <div>
                      <StatusPill status={entry.status} small />
                      <div style={{ fontFamily: 'DM Mono', fontSize: 11, marginTop: 5, color: 'var(--text-secondary)' }}>
                        {entry.checkIn || '—'} → {entry.checkOut || '…'}
                      </div>
                      {hrs && <div style={{ fontSize: 10, color: '#6ee7b7', marginTop: 3 }}>{hrs}</div>}
                      {entry.confirmedByManager && <div style={{ fontSize: 9, color: '#10b981', marginTop: 3 }}>✓ Confirmed</div>}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: isWE ? 'var(--border)' : 'var(--text-muted)' }}>
                      {isWE ? 'Weekend' : d <= today ? '—' : ''}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── MonthView sub-component ───────────────────────────────────────────────────
function MonthView({ entries, year, month, bankHolidays = [] }) {
  const today = londonTodayStr();
  const days  = getMonthDates(year, month);
  const DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 2 }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600,
            color: 'var(--text-muted)', padding: '4px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {days.map(({ date, isCurrentMonth }) => {
          const entry   = entries.find(e => e.date === date);
          const isToday = date === today;
          const isBH    = bankHolidays.some(b => (b.date || b) === date);
          const isWE    = isWeekend(date);
          const s       = entry ? statusCfg(entry.status) : null;
          const hrs     = entry ? fmtHours(entry.checkIn, entry.checkOut) : null;
          return (
            <div key={date} style={{
              minHeight: 64, borderRadius: 8, padding: '6px 7px',
              background: isBH ? 'rgba(127,29,29,0.2)' : isToday ? 'rgba(59,130,246,0.12)'
                : isWE ? 'rgba(129,140,248,0.05)' : 'var(--bg-card2)',
              border: isToday ? '1.5px solid var(--accent)' : '1px solid var(--border)',
              opacity: isCurrentMonth ? 1 : 0.35,
            }}>
              <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, marginBottom: 3,
                color: isToday ? 'var(--accent)' : isBH ? '#fca5a5' : isWE ? '#818cf8' : 'var(--text-muted)' }}>
                {new Date(date + 'T00:00:00').getDate()}
                {isBH && <span style={{ fontSize: 8, marginLeft: 3 }}>BH</span>}
              </div>
              {entry && s && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: s.color, background: s.bg,
                    borderRadius: 4, padding: '1px 4px', display: 'inline-block', marginBottom: 2 }}>
                    {s.icon} {s.label}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>
                    {entry.checkIn} {entry.checkOut ? `→ ${entry.checkOut}` : ''}
                  </div>
                  {hrs && <div style={{ fontSize: 8, color: '#6ee7b7' }}>{hrs}</div>}
                </div>
              )}
              {!entry && date < today && isCurrentMonth && !isWE && !isBH && (
                <div style={{ fontSize: 9, color: 'var(--border)' }}>—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Excel export (manager only) ───────────────────────────────────────────────
async function exportAttendanceExcel(users, timekeeping, bankHolidays, holidays, from, to) {
  const XLSX = window.XLSX;
  if (!XLSX) { alert('XLSX library not loaded — make sure the SheetJS CDN script is included.'); return; }
  const bh  = (bankHolidays || []).map(b => b.date || b);
  const fmt = ds => new Date(ds + 'T12:00:00').toLocaleDateString('en-GB');
  const hdrs = ['ID', 'Name', 'Date', 'Day', 'Status', 'Check In', 'Check Out', 'Hours', 'Late Status', 'Check-In Device', 'Check-Out Device', 'Confirmed', 'Notes'];
  const rows = [];
  (users || []).forEach(u => {
    const entries = normaliseEntries(u.id, (timekeeping || {})[u.id])
      .filter(e => e.date && (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    entries.forEach(e => {
      const day  = new Date(e.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' });
      const isBH = isBankHoliday(e.date, bh);
      const isH  = isOnHoliday(e.date, u.id, holidays);
      const ls   = e.checkIn ? computeLateStatus(e.checkIn) : null;
      const hrs  = fmtHours(e.checkIn, e.checkOut) || '';
      rows.push([
        u.id, u.name, fmt(e.date), day,
        isBH ? 'Bank Holiday' : isH ? 'Holiday' : (e.status || '—'),
        e.checkIn || '—', e.checkOut || '—', hrs,
        ls ? ls.label : (e.status === 'wfh' ? 'WFH' : e.status === 'absent' ? 'Absent' : '—'),
        e.device          ? (DEVICE_META[e.device]?.label          || e.device)          : '—',
        e.checkOutDevice  ? (DEVICE_META[e.checkOutDevice]?.label  || e.checkOutDevice)  : '—',
        e.confirmedByManager ? '✓' : '—',
        e.notes || '',
      ]);
    });
  });
  const ws = XLSX.utils.aoa_to_sheet([hdrs, ...rows]);
  ws['!cols'] = [10, 22, 12, 12, 12, 9, 10, 8, 12, 18, 18, 10, 28].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
  XLSX.writeFile(wb, `CloudOps-Attendance-${(from || 'all').replace(/-/g, '')}-${(to || 'now').replace(/-/g, '')}.xlsx`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════════════════════
export default function TimeKeeping({
  users        = [],
  holidays     = [],
  currentUser,
  isManager,
  bankHolidays = [],
  timekeeping,
  setTimekeeping,
  driveToken,
  extraStatuses    = [],   // manager-defined custom check-in types (persisted by parent)
  setExtraStatuses,        // setter passed from App.js (saves to Drive via payconfig or dedicated key)
}) {
  // ── Real-time clock — declared FIRST so useMemo deps below are valid ───────
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Derive live time — recomputed every second via clockTick dependency
  const today    = useMemo(() => londonTodayStr(), [clockTick]); // clockTick intentional
  const now      = useMemo(() => londonNow(),      [clockTick]); // clockTick intentional
  const liveTime = useMemo(() => londonTimeStr(),  [clockTick]); // clockTick intentional

  // ── View state ──────────────────────────────────────────────────────────────
  const [tab,          setTab]          = useState(isManager ? 'today' : 'week');
  const [weekOffset,   setWeekOffset]   = useState(0);
  const [monthOffset,  setMonthOffset]  = useState(0);
  const [filterUser,   setFilterUser]   = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [alertFilter,  setAlertFilter]  = useState('all');

  // ── Log modal ────────────────────────────────────────────────────────────────
  const [logModal,   setLogModal]   = useState(false);
  const [editEntry,  setEditEntry]  = useState(null);
  const [logForm,    setLogForm]    = useState({
    userId: currentUser, date: '', checkIn: '', checkOut: '', status: 'office', notes: '',
  });

  // ── Manager: add custom status type ───────────────────────────────────────
  const [showAddStatus, setShowAddStatus] = useState(false);
  const [newStatusForm, setNewStatusForm] = useState({ label: '', icon: '📌', color: '#60a5fa' });

  // ── Export modal ────────────────────────────────────────────────────────────
  const [showExport, setShowExport] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo,   setExportTo]   = useState('');
  const [exporting,  setExporting]  = useState(false);

  // ── Drive save (queued to prevent race conditions) ─────────────────────────
  const saveInProgress = useRef(false);
  const pendingSave    = useRef(null);
  const [isSaving, setIsSaving] = useState(false);

  const persistToDrive = useCallback(async (newData) => {
    if (!driveToken) return;
    if (saveInProgress.current) { pendingSave.current = newData; return; }
    saveInProgress.current = true;
    setIsSaving(true);
    try {
      await driveWrite(driveToken, 'timekeeping', newData);
    } catch (e) {
      console.warn('TimeKeeping: Drive write failed', e?.message || e);
    } finally {
      saveInProgress.current = false;
      setIsSaving(false);
      if (pendingSave.current) {
        const next = pendingSave.current;
        pendingSave.current = null;
        persistToDrive(next);
      }
    }
  }, [driveToken]);

  // ── Initial load from Drive on mount ──────────────────────────────────────
  // Fires once as soon as driveToken is available. Does NOT rely on App.js
  // having already loaded the data — engineers see their history immediately.
  const didInitialLoad = useRef(false);
  useEffect(() => {
    if (!driveToken || didInitialLoad.current) return;
    didInitialLoad.current = true;
    (async () => {
      try {
        const data = await driveRead(driveToken, 'timekeeping');
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          setTimekeeping(prev => {
            if (JSON.stringify(data) === JSON.stringify(prev)) return prev;
            // Merge: prefer Drive, but keep any local entries not yet in Drive
            const merged = { ...data };
            Object.keys(prev || {}).forEach(uid => {
              const localArr = normaliseEntries(uid, prev[uid]);
              const driveArr = normaliseEntries(uid, data[uid] || []);
              const driveIds = new Set(driveArr.map(e => e.id));
              const extras   = localArr.filter(e => !driveIds.has(e.id));
              if (extras.length > 0) merged[uid] = [...driveArr, ...extras];
            });
            return merged;
          });
        }
      } catch (e) {
        console.warn('TimeKeeping: initial Drive load failed', e?.message || e);
      }
    })();
  }, [driveToken, setTimekeeping]);

  // ── Live poll every 15 s — near-real-time sync across all browsers ─────────
  useEffect(() => {
    if (!driveToken) return;
    const poll = async () => {
      if (saveInProgress.current) return; // skip during in-flight writes
      try {
        const fresh = await driveRead(driveToken, 'timekeeping');
        if (fresh && typeof fresh === 'object') {
          setTimekeeping(prev => {
            if (JSON.stringify(fresh) === JSON.stringify(prev)) return prev;
            return fresh;
          });
        }
      } catch (e) {
        console.warn('TimeKeeping: poll failed', e?.message || e);
      }
    };
    const t = setInterval(poll, 15_000);
    return () => clearInterval(t);
  }, [driveToken, setTimekeeping]);

  // ── Data helpers ─────────────────────────────────────────────────────────────
  const userEntries  = useCallback((uid) => normaliseEntries(uid, (timekeeping || {})[uid]), [timekeeping]);
  const todayEntry   = useCallback((uid) => userEntries(uid).find(e => e.date === today), [userEntries, today]);
  const isCheckedIn  = useCallback((uid) => { const e = todayEntry(uid); return !!(e && e.checkIn && !e.checkOut); }, [todayEntry]);
  const isCheckedOut = useCallback((uid) => { const e = todayEntry(uid); return !!(e && e.checkIn && e.checkOut); }, [todayEntry]);

  // ── Week / month derived values ─────────────────────────────────────────────
  const weekDates  = getWeekDates(weekOffset);
  const weekStart  = weekDates[0];
  const weekEnd    = weekDates[6];
  const weekLabel  = `${fmtDate(weekStart)} – ${fmtDate(weekEnd)}`;
  const viewDate   = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const viewYear   = viewDate.getFullYear();
  const viewMonth  = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // bank holidays as plain date strings
  const bh = useMemo(() => (bankHolidays || []).map(b => b.date || b), [bankHolidays]);

  // ── getUserStats — RTO compliance, late arrivals, streaks ──────────────────
  const getUserStats = useCallback((userId, startDate, endDate) => {
    const entries = userEntries(userId);
    let officeDays = 0, wfhDays = 0, absentDays = 0, bankHolCount = 0, holidayCount = 0;
    let lateArrivals = [], onTimeDays = 0, totalWorkdays = 0;
    let lateStreak = 0, maxLateStreak = 0;

    let cur = startDate;
    while (cur <= endDate) {
      if (isWeekday(cur)) {
        const isBH  = isBankHoliday(cur, bh);
        const isHol = isOnHoliday(cur, userId, holidays);
        if (isBH)        { bankHolCount++; officeDays++; }
        else if (isHol)  { holidayCount++; }
        else if (cur <= today) {
          totalWorkdays++;
          const rec = entries.find(e => e.date === cur);
          if (rec) {
            const isOfficeStat = rec.status === 'office';
            const isLateStatus = false; // late is now computed from checkIn time, not a status
            if (isOfficeStat || isLateStatus) {
              officeDays++;
              const ls = computeLateStatus(rec.checkIn);
              const actuallyLate = isLateStatus || (ls && ls.status === 'late');
              if (actuallyLate) {
                lateArrivals.push({ date: cur, checkIn: rec.checkIn, label: ls ? ls.label : 'Late', color: '#ef4444' });
                lateStreak++;
                if (lateStreak > maxLateStreak) maxLateStreak = lateStreak;
              } else { onTimeDays++; lateStreak = 0; }
            } else if (rec.status === 'wfh')    { wfhDays++;    lateStreak = 0; }
            else if (rec.status === 'absent')   { absentDays++; lateStreak = 0; }
          } else { lateStreak = 0; }
        }
      }
      cur = addDays(cur, 1);
    }

    const workdaysExHol = Math.max(totalWorkdays - holidayCount, 0);
    const rtoCompliance = workdaysExHol > 0 ? Math.round((officeDays / workdaysExHol) * 100) : 0;
    return { officeDays, wfhDays, absentDays, bankHolCount, holidayCount, totalWorkdays,
      lateArrivals, onTimeDays, maxLateStreak, rtoCompliance };
  }, [userEntries, bh, holidays, today]);

  // ── Pattern alerts (last 30 days) ───────────────────────────────────────────
  const patternAlerts = useMemo(() => {
    const thirtyAgo = addDays(today, -30);
    return (users || []).map(u => {
      const s = getUserStats(u.id, thirtyAgo, today);
      let streak = 0, maxStreak = 0;
      userEntries(u.id)
        .filter(e => e.date >= thirtyAgo && e.date <= today)
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .forEach(e => {
          const isLate = e.status === 'late' || (e.checkIn && computeLateStatus(e.checkIn)?.status === 'late');
          if (isLate) { streak++; if (streak > maxStreak) maxStreak = streak; }
          else streak = 0;
        });
      return {
        user: u, lateCount: s.lateArrivals.length, lateArrivals: s.lateArrivals,
        maxStreak, rtoCompliance: s.rtoCompliance, wfhDays: s.wfhDays,
        hasPattern: maxStreak >= STREAK_THRESHOLD || s.lateArrivals.length >= 5,
      };
    }).filter(a => a.lateCount > 0 || a.maxStreak > 0);
  }, [users, getUserStats, userEntries, today]);

  // ── 13-week heat-map weeks ──────────────────────────────────────────────────
  const heatWeeks = useMemo(() => getWeeksFrom(addDays(today, -77), 14), [today]);

  // ── Engineers list ──────────────────────────────────────────────────────────
  const engineers = useMemo(() => (users || []).filter(u => !u.isManager), [users]);

  // ── This-week RTO stats per engineer (for dashboard) ───────────────────────
  const curWeekStart = getWeekStart(today);
  const weekStats = useMemo(() =>
    engineers.map(u => ({ user: u, stats: getUserStats(u.id, curWeekStart, addDays(curWeekStart, 4)) })),
    [engineers, getUserStats, curWeekStart]);

  // ── Derived counts for stat cards ──────────────────────────────────────────
  const presentToday   = (users || []).filter(u => { const e = todayEntry(u.id); return e && e.status === 'office'; }).length;
  const wfhToday       = (users || []).filter(u => todayEntry(u.id)?.status === 'wfh').length;
  const absentToday    = (users || []).filter(u => todayEntry(u.id)?.status === 'absent').length;
  const pendingConfirm = (users || []).flatMap(u => userEntries(u.id).filter(e => !e.confirmedByManager)).length;

  // ── My monthly entries + hours (engineer view) ──────────────────────────────
  const myEntries      = userEntries(currentUser);
  const myTodayEntry   = todayEntry(currentUser);
  const amCheckedIn    = isCheckedIn(currentUser);
  const amCheckedOut   = isCheckedOut(currentUser);
  const myMonthPfx     = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
  const myMonthEntries = myEntries.filter(e => e.date && e.date.startsWith(myMonthPfx));
  const myMonthHrs     = myMonthEntries.reduce((a, e) => {
    const h = fmtHours(e.checkIn, e.checkOut);
    return h ? a + parseFloat(h.split('h')[0] || 0) : a;
  }, 0);

  // ── Displayed users (manager week/month filter) ─────────────────────────────
  const displayedUsers = isManager
    ? (filterUser === 'all' ? (users || []) : (users || []).filter(u => u.id === filterUser))
    : (users || []).filter(u => u.id === currentUser);

  // ── Today view data ─────────────────────────────────────────────────────────
  const allTodayEntries = (users || []).map(u => ({ user: u, entry: todayEntry(u.id) }));
  const filteredToday   = allTodayEntries.filter(({ entry }) => {
    if (statusFilter === 'all')        return true;
    if (statusFilter === 'in')         return entry && entry.checkIn && !entry.checkOut;
    if (statusFilter === 'out')        return entry && entry.checkIn && entry.checkOut;
    if (statusFilter === 'not-logged') return !entry;
    return entry?.status === statusFilter;
  });

  // ── Full log (all entries, all users, date desc) ────────────────────────────
  const allEntriesLog = useMemo(() =>
    (users || []).flatMap(u => userEntries(u.id).map(e => ({ ...e, user: u })))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [users, userEntries]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const upsertEntry = (uid, entry) => {
    setTimekeeping(prev => {
      const existing = normaliseEntries(uid, prev[uid]).filter(e => e.id !== entry.id);
      const updated  = { ...prev, [uid]: [...existing, entry].sort((a, b) => (b.date || '').localeCompare(a.date || '')) };
      persistToDrive(updated);
      return updated;
    });
  };

  const handleCheckIn = () => {
    const entry  = todayEntry(currentUser);
    const time   = londonTimeStr();   // fresh call — mutation, not display
    const device = detectDevice();
    if (entry) {
      upsertEntry(currentUser, { ...entry, checkIn: time, status: 'office', device });
    } else {
      upsertEntry(currentUser, {
        id: `ck-${currentUser}-${Date.now()}`,
        date: today, checkIn: time, checkOut: null,
        status: 'office', notes: '', confirmedByManager: false,
        device,
      });
    }
  };

  const handleCheckOut = () => {
    const entry = todayEntry(currentUser);
    if (!entry) return;
    upsertEntry(currentUser, { ...entry, checkOut: londonTimeStr(), checkOutDevice: detectDevice() });
  };

  const saveLogEntry = () => {
    if (!logForm.date || !logForm.checkIn) return;
    const uid = isManager ? (logForm.userId || currentUser) : currentUser;
    const id  = editEntry?.id || `ck-${uid}-${Date.now()}`;
    upsertEntry(uid, {
      id, date: logForm.date,
      checkIn: logForm.checkIn, checkOut: logForm.checkOut || null,
      status: logForm.status, notes: logForm.notes || '',
      confirmedByManager: editEntry?.confirmedByManager || false,
      confirmedAt: editEntry?.confirmedAt || null,
      // preserve device on edit; stamp current device on new manual entries
      device: editEntry?.device || detectDevice(),
      checkOutDevice: editEntry?.checkOutDevice || null,
    });
    setLogModal(false);
    setEditEntry(null);
  };

  const openEditEntry = (uid, entry) => {
    setLogForm({ userId: uid, date: entry.date, checkIn: entry.checkIn || '',
      checkOut: entry.checkOut || '', status: entry.status, notes: entry.notes || '' });
    setEditEntry(entry);
    setLogModal(true);
  };

  const openNewLog = (uid) => {
    setLogForm({ userId: uid || currentUser, date: today, checkIn: '', checkOut: '', status: 'office', notes: '' });
    setEditEntry(null);
    setLogModal(true);
  };

  const deleteEntry = (uid, entryId) => {
    if (!window.confirm('Delete this attendance entry?')) return;
    setTimekeeping(prev => {
      const updated = { ...prev, [uid]: normaliseEntries(uid, prev[uid]).filter(e => e.id !== entryId) };
      persistToDrive(updated);
      return updated;
    });
  };

  const confirmEntry = (uid, entryId) => {
    setTimekeeping(prev => {
      const updated = {
        ...prev,
        [uid]: normaliseEntries(uid, prev[uid]).map(e =>
          e.id === entryId ? { ...e, confirmedByManager: true, confirmedAt: new Date().toISOString() } : e
        ),
      };
      persistToDrive(updated);
      return updated;
    });
  };

  const unconfirmEntry = (uid, entryId) => {
    setTimekeeping(prev => {
      const updated = {
        ...prev,
        [uid]: normaliseEntries(uid, prev[uid]).map(e =>
          e.id === entryId ? { ...e, confirmedByManager: false, confirmedAt: null } : e
        ),
      };
      persistToDrive(updated);
      return updated;
    });
  };

  // ── Shared log modal JSX ────────────────────────────────────────────────────
  const renderLogModal = () => (
    <Modal
      title={editEntry ? 'Edit Attendance Entry' : 'Log Attendance'}
      onClose={() => { setLogModal(false); setEditEntry(null); }}
      wide={isManager}
    >
      {isManager && !editEntry && (
        <FormGroup label="Engineer">
          <select className="select" value={logForm.userId}
            onChange={e => setLogForm(f => ({ ...f, userId: e.target.value }))}>
            <option value="">Select engineer…</option>
            {(users || []).map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
          </select>
        </FormGroup>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormGroup label="Date">
          <input className="input" type="date" max={today} value={logForm.date}
            onChange={e => setLogForm(f => ({ ...f, date: e.target.value }))} />
        </FormGroup>
        <FormGroup label="Status">
          <select className="select" value={logForm.status}
            onChange={e => setLogForm(f => ({ ...f, status: e.target.value }))}>
            {buildStatusOptions(extraStatuses).map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
          </select>
        </FormGroup>
        <FormGroup label="Check In Time">
          <input className="input" type="time" value={logForm.checkIn}
            onChange={e => setLogForm(f => ({ ...f, checkIn: e.target.value }))} />
        </FormGroup>
        <FormGroup label="Check Out Time" hint="optional">
          <input className="input" type="time" value={logForm.checkOut}
            onChange={e => setLogForm(f => ({ ...f, checkOut: e.target.value }))} />
        </FormGroup>
      </div>
      {logForm.checkIn && logForm.checkOut && (
        <div style={{ fontSize: 12, color: '#a78bfa', marginBottom: 10, fontFamily: 'DM Mono' }}>
          ⏱ Duration: {fmtHours(logForm.checkIn, logForm.checkOut)}
        </div>
      )}
      <FormGroup label="Notes (optional)">
        <textarea className="textarea" rows={2} placeholder="Any notes about this entry…"
          value={logForm.notes} onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))} />
      </FormGroup>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={() => { setLogModal(false); setEditEntry(null); }}>Cancel</button>
        <button className="btn btn-primary" onClick={saveLogEntry}
          disabled={!logForm.date || !logForm.checkIn || (isManager && !editEntry && !logForm.userId)}>
          {editEntry ? 'Update Entry' : 'Save Entry'}
        </button>
      </div>
    </Modal>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ENGINEER VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isManager) {
    return (
      <div>
        <PageHeader
          title="Time Keeping"
          sub="Check in and check out to log your attendance"
          actions={<DriveStatus token={driveToken} saving={isSaving} />}
        />

        {/* Today card */}
        <div className="card mb-16" style={{
          borderLeft: `4px solid ${amCheckedOut ? '#10b981' : amCheckedIn ? '#f59e0b' : 'var(--border)'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                &nbsp;·&nbsp;
                <span style={{ fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{liveTime} London</span>
              </div>
              {myTodayEntry ? (
                <div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    <StatusPill status={myTodayEntry.status} />
                    {myTodayEntry.confirmedByManager && (
                      <span style={{ fontSize: 11, color: '#10b981' }}>✓ Manager confirmed</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 1 }}>CHECK IN</div>
                      <div style={{ fontFamily: 'DM Mono', fontSize: 18, fontWeight: 700, color: '#6ee7b7' }}>
                        {myTodayEntry.checkIn || '—'}
                      </div>
                    </div>
                    {myTodayEntry.checkOut && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 1 }}>CHECK OUT</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 18, fontWeight: 700, color: '#fcd34d' }}>
                          {myTodayEntry.checkOut}
                        </div>
                      </div>
                    )}
                    {fmtHours(myTodayEntry.checkIn, myTodayEntry.checkOut) && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 1 }}>DURATION</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>
                          {fmtHours(myTodayEntry.checkIn, myTodayEntry.checkOut)}
                        </div>
                      </div>
                    )}
                  </div>
                  {myTodayEntry.notes && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>📝 {myTodayEntry.notes}</div>
                  )}
                  {/* Device that was used to check in */}
                  {myTodayEntry.device && (
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                      Logged via <DevicePill device={myTodayEntry.device} />
                      {myTodayEntry.checkOutDevice && myTodayEntry.checkOutDevice !== myTodayEntry.device && (
                        <> · checked out via <DevicePill device={myTodayEntry.checkOutDevice} /></>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>You haven't checked in yet today.</div>
              )}
            </div>

            {/* Check-in / check-out buttons */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {!amCheckedIn && !amCheckedOut && (
                <button className="btn btn-primary" style={{ fontSize: 15, padding: '10px 20px' }} onClick={handleCheckIn}>
                  ✅ Check In {liveTime}
                </button>
              )}
              {amCheckedIn && (
                <>
                  <div style={{ fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4,
                    padding: '10px 14px', background: 'rgba(245,158,11,0.1)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.3)' }}>
                    🟡 Checked in since {myTodayEntry.checkIn}
                  </div>
                  <button className="btn btn-secondary" style={{ fontSize: 15, padding: '10px 20px' }} onClick={handleCheckOut}>
                    🔴 Check Out {liveTime}
                  </button>
                </>
              )}
              {amCheckedOut && (
                <button className="btn btn-secondary btn-sm" onClick={() => openEditEntry(currentUser, myTodayEntry)}>✏ Edit Today</button>
              )}
            </div>
          </div>
        </div>

        {/* Tab bar — week / month only (no 'today' tab; today card is always shown above) */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {[{ id: 'week', label: '📅 Weekly View' }, { id: 'month', label: '📆 Monthly View' }].map(t => (
            <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {/* Weekly */}
        {tab === 'week' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(o => o - 1)}>← Prev Week</button>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' }}>
                {weekLabel}
                {weekOffset !== 0 && (
                  <button className="btn btn-secondary btn-sm" style={{ marginLeft: 10 }} onClick={() => setWeekOffset(0)}>Today</button>
                )}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(o => o + 1)}>Next Week →</button>
            </div>
            <WeekView entries={myEntries} weekDates={weekDates} bankHolidays={bankHolidays} />
            <div style={{ display: 'flex', gap: 12, marginTop: 14, padding: '10px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              {buildStatusOptions(extraStatuses).map(s => {
                const count = weekDates.filter(d => myEntries.find(e => e.date === d)?.status === s.value).length;
                return count > 0 ? (
                  <div key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <span style={{ color: s.color }}>{s.icon}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{s.label}:</span>
                    <span style={{ fontWeight: 600 }}>{count}</span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Monthly */}
        {tab === 'month' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setMonthOffset(o => o - 1)}>← Prev</button>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{monthLabel}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {myMonthEntries.length} days · ≈{Math.round(myMonthHrs)}h total
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setMonthOffset(o => o + 1)}>Next →</button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {buildStatusOptions(extraStatuses).map(s => {
                const count = myMonthEntries.filter(e => e.status === s.value).length;
                return count > 0 ? (
                  <div key={s.value} style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`,
                    borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600 }}>
                    {s.icon} {s.label}: {count}
                  </div>
                ) : null;
              })}
            </div>
            <div className="card"><MonthView entries={myEntries} year={viewYear} month={viewMonth} bankHolidays={bankHolidays} /></div>
            {myMonthEntries.length > 0 && (
              <div className="card" style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                  All Entries — {monthLabel}
                </div>
                <table>
                  <thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Duration</th><th>Device</th><th>Confirmed</th><th></th></tr></thead>
                  <tbody>
                    {myMonthEntries.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => (
                      <tr key={e.id}>
                        <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{fmtDate(e.date)}</td>
                        <td><StatusPill status={e.status} small /></td>
                        <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#6ee7b7' }}>{e.checkIn || '—'}</td>
                        <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#fcd34d' }}>{e.checkOut || '—'}</td>
                        <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#a78bfa' }}>{fmtHours(e.checkIn, e.checkOut) || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {e.device
                              ? <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                  <span style={{ fontSize: 10 }}>In</span><DevicePill device={e.device} small />
                                </div>
                              : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                            {e.checkOutDevice && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                <span style={{ fontSize: 10 }}>Out</span><DevicePill device={e.checkOutDevice} small />
                              </div>
                            )}
                          </div>
                        </td>
                        <td>{e.confirmedByManager ? <Tag label="✓ Confirmed" type="green" /> : <Tag label="Pending" type="amber" />}</td>
                        <td>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditEntry(currentUser, e)}>✏</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {logModal && renderLogModal()}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MANAGER VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  const mgTabs = [
    { id: 'today',     label: "📍 Today" },
    { id: 'dashboard', label: '◈ Dashboard' },
    { id: 'week',      label: '📅 Weekly' },
    { id: 'month',     label: '📆 Monthly' },
    { id: 'heatmap',   label: '🔥 Heat Map' },
    { id: 'alerts',    label: `🚨 Alerts${patternAlerts.filter(a => a.hasPattern).length > 0 ? ` (${patternAlerts.filter(a => a.hasPattern).length})` : ''}` },
    { id: 'log',       label: '📋 Log' },
  ];

  return (
    <div>
      <PageHeader
        title="Time Keeping"
        sub="Team attendance — confirm entries, view history, track RTO compliance"
        actions={
          <>
            <DriveStatus token={driveToken} saving={isSaving} />
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAddStatus(true)}>⚙ Check-in Types</button>
            <button className="btn btn-secondary" onClick={() => setShowExport(true)}>📥 Export Excel</button>
            <button className="btn btn-primary" onClick={() => openNewLog(null)}>+ Log Entry</button>
          </>
        }
      />

      {/* Stat cards */}
      <div className="grid-4 mb-16">
        <StatCard label="Present Today"   value={presentToday}   sub="in office / hybrid" accent="#10b981" icon="✅" />
        <StatCard label="WFH Today"       value={wfhToday}       sub="working remotely"   accent="#818cf8" icon="🏠" />
        <StatCard label="Absent Today"    value={absentToday}    sub="unaccounted"        accent="#ef4444" icon="❌" />
        <StatCard label="Pending Confirm" value={pendingConfirm} sub="awaiting review"    accent="#f59e0b" icon="⏳" />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {mgTabs.map(t => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        {(tab === 'week' || tab === 'month') && (
          <select className="select" value={filterUser} onChange={e => setFilterUser(e.target.value)}
            style={{ width: 180, marginLeft: 'auto' }}>
            <option value="all">All Engineers</option>
            {(users || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {tab === 'today' && (
          <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ width: 164, marginLeft: 'auto' }}>
            <option value="all">All ({(users || []).length})</option>
            <option value="in">Checked In</option>
            <option value="out">Checked Out</option>
            <option value="not-logged">Not Logged</option>
            {buildStatusOptions(extraStatuses).map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
          </select>
        )}
      </div>

      {/* ══ TODAY ══ */}
      {tab === 'today' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {filteredToday.map(({ user: u, entry }) => {
            const checkedIn  = entry && entry.checkIn && !entry.checkOut;
            const checkedOut = entry && entry.checkIn && entry.checkOut;
            const s          = entry ? statusCfg(entry.status) : null;
            const hrs        = entry ? fmtHours(entry.checkIn, entry.checkOut) : null;
            return (
              <div key={u.id} style={{
                background: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px',
                border: `1px solid ${checkedIn ? 'rgba(245,158,11,0.4)' : checkedOut ? 'rgba(16,185,129,0.35)' : 'var(--border)'}`,
                borderLeft: `4px solid ${s ? s.color : 'var(--border)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Avatar user={u} size={36} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u.id}</div>
                    </div>
                  </div>
                  {entry
                    ? <StatusPill status={entry.status} small />
                    : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not logged</span>}
                </div>
                {entry ? (
                  <div>
                    <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 1 }}>IN</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 16, fontWeight: 700, color: '#6ee7b7' }}>{entry.checkIn || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 1 }}>OUT</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 16, fontWeight: 700, color: entry.checkOut ? '#fcd34d' : 'var(--text-muted)' }}>
                          {entry.checkOut || (checkedIn ? '…' : '—')}
                        </div>
                      </div>
                      {hrs && (
                        <div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 1 }}>TOTAL</div>
                          <div style={{ fontFamily: 'DM Mono', fontSize: 16, fontWeight: 700, color: '#a78bfa' }}>{hrs}</div>
                        </div>
                      )}
                    </div>
                    {entry.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>📝 {entry.notes}</div>}
                    {/* Device row */}
                    {(entry.device || entry.checkOutDevice) && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                        {entry.device && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                            In: <DevicePill device={entry.device} small />
                          </div>
                        )}
                        {entry.checkOutDevice && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                            Out: <DevicePill device={entry.checkOutDevice} small />
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {!entry.confirmedByManager
                        ? <button className="btn btn-success btn-sm" onClick={() => confirmEntry(u.id, entry.id)}>✓ Confirm</button>
                        : <button className="btn btn-secondary btn-sm" onClick={() => unconfirmEntry(u.id, entry.id)} title="Click to un-confirm">✓ Confirmed</button>}
                      <button className="btn btn-secondary btn-sm" onClick={() => openEditEntry(u.id, entry)}>✏</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteEntry(u.id, entry.id)}>🗑</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>No attendance logged for today.</div>
                    <button className="btn btn-secondary btn-sm" onClick={() => openNewLog(u.id)}>+ Log for {u.name.split(' ')[0]}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══ DASHBOARD ══ */}
      {tab === 'dashboard' && (
        <div>
          {/* This-week RTO per engineer */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            This Week — RTO Compliance ({curWeekStart} → {addDays(curWeekStart, 4)})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 24 }}>
            {weekStats.map(({ user: u, stats: s }) => {
              const rtoOk = s.officeDays >= RTO_DAYS_REQUIRED;
              return (
                <div key={u.id} className="card" style={{ borderLeft: `3px solid ${rtoOk ? '#10b981' : '#ef4444'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Avatar user={u} size={32} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{u.id}</div>
                      </div>
                    </div>
                    <Donut pct={s.rtoCompliance} color={rtoOk ? '#22c55e' : '#ef4444'} size={52} label="RTO" />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <MiniBar value={s.officeDays}        max={5} color="#22c55e" label="Office" />
                    <MiniBar value={s.wfhDays}           max={5} color="#60a5fa" label="WFH" />
                    <MiniBar value={s.absentDays}        max={5} color="#ef4444" label="Absent" />
                    <MiniBar value={s.lateArrivals.length} max={5} color="#f59e0b" label="Late" />
                  </div>
                  {!rtoOk && (
                    <div style={{ marginTop: 10, fontSize: 11, color: '#fca5a5',
                      background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '5px 10px',
                      border: '1px solid rgba(239,68,68,0.2)' }}>
                      ⚠ {s.officeDays}/{RTO_DAYS_REQUIRED} office days — below RTO threshold
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Today at a glance */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Today at a Glance
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
            {allTodayEntries.map(({ user: u, entry }) => {
              const s = entry ? statusCfg(entry.status) : null;
              return (
                <div key={u.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px',
                  background: s ? s.bg : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${s ? s.border : 'var(--border)'}`,
                  borderRadius: 10, fontSize: 12, fontWeight: 600,
                  color: s ? s.color : 'var(--text-muted)',
                }}>
                  <Avatar user={u} size={22} />
                  {u.name.split(' ')[0]}
                  {s ? <span>{s.icon}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  {entry?.checkIn && <span style={{ fontFamily: 'DM Mono', fontSize: 10, opacity: 0.8 }}>{entry.checkIn}</span>}
                  {entry?.device && <span title={DEVICE_META[entry.device]?.label || entry.device} style={{ fontSize: 13 }}>{DEVICE_META[entry.device]?.icon}</span>}
                </div>
              );
            })}
          </div>

          {/* Device breakdown (today) */}
          {(() => {
            const todayCounts = { desktop: 0, mobile: 0, tablet: 0, unknown: 0 };
            allTodayEntries.forEach(({ entry }) => {
              if (!entry) return;
              if (entry.device && todayCounts[entry.device] !== undefined) todayCounts[entry.device]++;
              else if (entry.device) todayCounts.unknown++;
            });
            const total = todayCounts.desktop + todayCounts.mobile + todayCounts.tablet + todayCounts.unknown;
            if (total === 0) return null;
            return (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                  Check-In Device Breakdown — Today
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {Object.entries(todayCounts).map(([type, count]) => {
                    if (count === 0) return null;
                    const m   = DEVICE_META[type] || { icon: '❓', label: 'Unknown', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.25)' };
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={type} style={{
                        padding: '12px 18px', borderRadius: 12, minWidth: 120, textAlign: 'center',
                        background: m.bg, border: `1px solid ${m.border}`,
                      }}>
                        <div style={{ fontSize: 28, marginBottom: 4 }}>{m.icon}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: m.color, fontFamily: 'DM Mono' }}>{count}</div>
                        <div style={{ fontSize: 11, color: m.color, fontWeight: 600, marginBottom: 2 }}>{m.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{pct}% of logged</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ══ WEEKLY ══ */}
      {tab === 'week' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(o => o - 1)}>← Prev Week</button>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' }}>
              {weekLabel}
              {weekOffset !== 0 && <button className="btn btn-secondary btn-sm" style={{ marginLeft: 10 }} onClick={() => setWeekOffset(0)}>This Week</button>}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setWeekOffset(o => o + 1)}>Next Week →</button>
          </div>
          {displayedUsers.map(u => (
            <div key={u.id} className="card mb-12">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Avatar user={u} size={30} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {buildStatusOptions(extraStatuses).map(s => {
                    const count = weekDates.filter(d => userEntries(u.id).find(e => e.date === d)?.status === s.value).length;
                    return count > 0 ? (
                      <span key={s.value} style={{ fontSize: 10, color: s.color, background: s.bg,
                        padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>{s.icon} {count}</span>
                    ) : null;
                  })}
                </div>
              </div>
              <WeekView entries={userEntries(u.id)} weekDates={weekDates} bankHolidays={bankHolidays} />
            </div>
          ))}
        </div>
      )}

      {/* ══ MONTHLY ══ */}
      {tab === 'month' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setMonthOffset(o => o - 1)}>← Prev</button>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{monthLabel}</div>
            <button className="btn btn-secondary btn-sm" onClick={() => setMonthOffset(o => o + 1)}>Next →</button>
          </div>
          {displayedUsers.map(u => {
            const uEntries      = userEntries(u.id);
            const uMonthPfx     = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
            const uMonthEntries = uEntries.filter(e => e.date && e.date.startsWith(uMonthPfx));
            const uHrs          = uMonthEntries.reduce((a, e) => { const h = fmtHours(e.checkIn, e.checkOut); return h ? a + parseFloat(h.split('h')[0] || 0) : a; }, 0);
            const uPending      = uMonthEntries.filter(e => !e.confirmedByManager).length;
            return (
              <div key={u.id} className="card mb-16">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Avatar user={u} size={32} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {uMonthEntries.length} days · ≈{Math.round(uHrs)}h
                        {uPending > 0 && <span style={{ color: '#f59e0b', marginLeft: 8 }}>· ⏳ {uPending} unconfirmed</span>}
                      </div>
                    </div>
                  </div>
                  {uPending > 0 && (
                    <button className="btn btn-success btn-sm"
                      onClick={() => uMonthEntries.filter(e => !e.confirmedByManager).forEach(e => confirmEntry(u.id, e.id))}>
                      ✓ Confirm All ({uPending})
                    </button>
                  )}
                </div>
                <MonthView entries={uEntries} year={viewYear} month={viewMonth} bankHolidays={bankHolidays} />
                {uMonthEntries.length > 0 && (
                  <div style={{ marginTop: 14, overflowX: 'auto' }}>
                    <table style={{ fontSize: 12 }}>
                      <thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Duration</th><th>Device</th><th>Notes</th><th>Confirmed</th><th></th></tr></thead>
                      <tbody>
                        {uMonthEntries.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => (
                          <tr key={e.id}>
                            <td style={{ fontFamily: 'DM Mono', fontSize: 11 }}>{fmtDate(e.date)}</td>
                            <td><StatusPill status={e.status} small /></td>
                            <td style={{ fontFamily: 'DM Mono', color: '#6ee7b7' }}>{e.checkIn || '—'}</td>
                            <td style={{ fontFamily: 'DM Mono', color: '#fcd34d' }}>{e.checkOut || '—'}</td>
                            <td style={{ fontFamily: 'DM Mono', color: '#a78bfa' }}>{fmtHours(e.checkIn, e.checkOut) || '—'}</td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {e.device
                                  ? <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                      <span style={{ fontSize: 10 }}>In</span><DevicePill device={e.device} small />
                                    </div>
                                  : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                                {e.checkOutDevice && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                    <span style={{ fontSize: 10 }}>Out</span><DevicePill device={e.checkOutDevice} small />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td style={{ color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.notes || '—'}</td>
                            <td>{e.confirmedByManager
                              ? <Tag label="✓ Confirmed" type="green" />
                              : <button className="btn btn-success btn-sm" onClick={() => confirmEntry(u.id, e.id)}>✓</button>}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-secondary btn-sm" onClick={() => openEditEntry(u.id, e)}>✏</button>
                                <button className="btn btn-danger btn-sm" onClick={() => deleteEntry(u.id, e.id)}>🗑</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══ HEAT MAP ══ */}
      {tab === 'heatmap' && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            13-Week Attendance Heat Map
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              ['rgba(34,197,94,0.28)',   'On Time'],
              ['rgba(245,158,11,0.35)',  'Grace Period'],
              ['rgba(239,68,68,0.3)',    'Late'],
              ['rgba(59,130,246,0.22)', 'WFH'],
              ['rgba(139,92,246,0.18)', 'Holiday'],
              ['rgba(99,102,241,0.25)', 'Bank Hol'],
              ['rgba(255,255,255,0.03)','No Data'],
            ].map(([c, l]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l}</span>
              </div>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', minWidth: 150, paddingRight: 14 }}>Engineer</th>
                  {heatWeeks.map(ws =>
                    getAllWeekdays(ws).map((d, di) => (
                      <th key={d} style={{ padding: '2px 1px', minWidth: 22, textAlign: 'center', fontSize: 9, color: 'var(--text-muted)' }}>
                        {di === 0 ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {engineers.map(u => (
                  <tr key={u.id}>
                    <td style={{ paddingRight: 14, paddingBottom: 4 }}>
                      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                        <Avatar user={u} size={22} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{u.name}</span>
                      </div>
                    </td>
                    {heatWeeks.map(ws =>
                      getAllWeekdays(ws).map(d => (
                        <td key={d} style={{ padding: '2px 1px' }}>
                          <HeatCell
                            entry={userEntries(u.id).find(e => e.date === d)}
                            bankHol={isBankHoliday(d, bh)}
                            holiday={isOnHoliday(d, u.id, holidays)}
                            isToday={d === today}
                            isFuture={d > today}
                          />
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ ALERTS ══ */}
      {tab === 'alerts' && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Late Arrival Patterns — Last 30 Days
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {[['all', 'All'], ['pattern', '⚠ Pattern Only'], ['late', 'Has Late Arrivals']].map(([v, l]) => (
              <button key={v} className={`btn btn-sm ${alertFilter === v ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAlertFilter(v)}>{l}</button>
            ))}
          </div>
          {patternAlerts.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No late patterns detected</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>All engineers are arriving on time this month</div>
            </div>
          )}
          {patternAlerts
            .filter(a => alertFilter === 'all' ? true : alertFilter === 'pattern' ? a.hasPattern : a.lateCount > 0)
            .map(a => (
              <div key={a.user.id} className="card mb-12"
                style={{ borderLeft: `3px solid ${a.hasPattern ? '#ef4444' : '#f59e0b'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Avatar user={a.user} size={36} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{a.user.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.user.id}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                    {[
                      ['Late Arrivals', a.lateCount, a.lateCount >= 5 ? '#ef4444' : '#f59e0b'],
                      ['Max Streak',   a.maxStreak,  a.maxStreak >= STREAK_THRESHOLD ? '#ef4444' : '#f59e0b'],
                      ['RTO',          `${a.rtoCompliance}%`, a.rtoCompliance >= 60 ? '#22c55e' : '#ef4444'],
                    ].map(([lbl, val, col]) => (
                      <div key={lbl} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{lbl}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: col, fontFamily: 'DM Mono' }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {a.hasPattern && (
                  <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, color: '#fca5a5' }}>
                    ⚠️ {a.maxStreak >= STREAK_THRESHOLD
                      ? `${a.maxStreak} consecutive late arrivals — pattern flag`
                      : `${a.lateCount} late arrivals this month — above threshold`}
                  </div>
                )}
                {a.lateArrivals.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                      Late dates
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {a.lateArrivals.map(l => (
                        <span key={l.date} style={{ fontSize: 11, fontFamily: 'DM Mono', background: 'rgba(239,68,68,0.1)',
                          border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '3px 8px', color: '#fca5a5' }}>
                          {fmtDate(l.date)} {l.checkIn || ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {/* ══ LOG ══ */}
      {tab === 'log' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Full Attendance Log ({allEntriesLog.filter(e => filterUser === 'all' || e.user.id === filterUser).length} entries)
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="select" value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{ width: 160 }}>
                <option value="all">All Engineers</option>
                {(users || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowExport(true)}>📥 Excel</button>
            </div>
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Engineer</th><th>Date</th><th>Status</th>
                  <th>In</th><th>Out</th><th>Duration</th><th>Late</th>
                  <th>Device</th><th>Notes</th><th>Confirmed</th><th></th>
                </tr>
              </thead>
              <tbody>
                {allEntriesLog
                  .filter(e => filterUser === 'all' || e.user.id === filterUser)
                  .map(e => {
                    const ls = e.checkIn ? computeLateStatus(e.checkIn) : null;
                    return (
                      <tr key={e.id}>
                        <td>
                          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                            <Avatar user={e.user} size={22} />
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{e.user.name}</span>
                          </div>
                        </td>
                        <td style={{ fontFamily: 'DM Mono', fontSize: 11 }}>{fmtDate(e.date)}</td>
                        <td><StatusPill status={e.status} small /></td>
                        <td style={{ fontFamily: 'DM Mono', color: '#6ee7b7', fontSize: 12 }}>{e.checkIn || '—'}</td>
                        <td style={{ fontFamily: 'DM Mono', color: '#fcd34d', fontSize: 12 }}>{e.checkOut || '—'}</td>
                        <td style={{ fontFamily: 'DM Mono', color: '#a78bfa', fontSize: 12 }}>{fmtHours(e.checkIn, e.checkOut) || '—'}</td>
                        <td>
                          {ls && (ls.status === 'warn' || ls.status === 'late')
                            ? <span style={{ fontSize: 11, color: ls.color, fontFamily: 'DM Mono', fontWeight: 600 }}>{ls.label}</span>
                            : ls ? <span style={{ fontSize: 11, color: '#22c55e' }}>✓</span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {e.device
                              ? <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                                  <span style={{ fontSize: 10 }}>In</span> <DevicePill device={e.device} small />
                                </div>
                              : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                            {e.checkOutDevice && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                                <span style={{ fontSize: 10 }}>Out</span> <DevicePill device={e.checkOutDevice} small />
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.notes || '—'}
                        </td>
                        <td>
                          {e.confirmedByManager
                            ? <Tag label="✓" type="green" />
                            : <button className="btn btn-success btn-sm" onClick={() => confirmEntry(e.user.id, e.id)}>✓</button>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => openEditEntry(e.user.id, e)}>✏</button>
                            <button className="btn btn-danger btn-sm" onClick={() => deleteEntry(e.user.id, e.id)}>🗑</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Log modal ── */}
      {logModal && renderLogModal()}

      {/* ── Export modal ── */}
      {showExport && (
        <Modal title="📥 Export Attendance to Excel" onClose={() => setShowExport(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <FormGroup label="From">
              <input className="input" type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} />
            </FormGroup>
            <FormGroup label="To">
              <input className="input" type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} />
            </FormGroup>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
            {[
              ['This week',     () => { const ws = getWeekStart(today); setExportFrom(ws); setExportTo(addDays(ws, 4)); }],
              ['This month',    () => { const [y,m] = today.slice(0,7).split('-'); setExportFrom(`${y}-${m}-01`); setExportTo(new Date(y, m, 0).toISOString().slice(0, 10)); }],
              ['Last 30 days',  () => { setExportFrom(addDays(today, -29)); setExportTo(today); }],
              ['All time',      () => { setExportFrom(''); setExportTo(''); }],
            ].map(([l, fn]) => (
              <button key={l} className="btn btn-secondary btn-sm" onClick={fn}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setShowExport(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={exporting} onClick={async () => {
              setExporting(true);
              await exportAttendanceExcel(users || [], timekeeping || {}, bankHolidays || [], holidays || [], exportFrom, exportTo);
              setExporting(false);
              setShowExport(false);
            }}>
              {exporting ? '⏳ Exporting…' : '📥 Download Excel'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Check-in Types modal (manager only) ── */}
      {showAddStatus && (
        <Modal title="⚙ Check-in Types" onClose={() => setShowAddStatus(false)} wide>
          {/* Core types — read only */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Core Types (always available)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CORE_STATUSES.map(s => (
                <div key={s.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8 }}>
                  <span>{s.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{s.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· locked</span>
                </div>
              ))}
            </div>
          </div>

          {/* Custom types */}
          {(extraStatuses || []).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Custom Types</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(extraStatuses || []).map((s, i) => (
                  <div key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', background: s.bg || 'rgba(255,255,255,0.04)',
                    border: `1px solid ${s.border || 'rgba(255,255,255,0.1)'}`, borderRadius: 8 }}>
                    <span style={{ fontSize: 18 }}>{s.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: s.color, flex: 1 }}>{s.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{s.value}</span>
                    <button className="btn btn-danger btn-sm" onClick={() => {
                      const next = (extraStatuses || []).filter((_, j) => j !== i);
                      setExtraStatuses && setExtraStatuses(next);
                    }}>🗑 Remove</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new custom type */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Add Custom Type</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'flex-end' }}>
              <FormGroup label="Label">
                <input className="input" placeholder="e.g. Client Site" value={newStatusForm.label}
                  onChange={e => setNewStatusForm(f => ({ ...f, label: e.target.value }))} />
              </FormGroup>
              <FormGroup label="Icon">
                <input className="input" style={{ width: 60, textAlign: 'center', fontSize: 18 }}
                  placeholder="📌" maxLength={2} value={newStatusForm.icon}
                  onChange={e => setNewStatusForm(f => ({ ...f, icon: e.target.value }))} />
              </FormGroup>
              <FormGroup label="Colour">
                <input type="color" style={{ width: 60, height: 38, borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', padding: 2 }}
                  value={newStatusForm.color}
                  onChange={e => setNewStatusForm(f => ({ ...f, color: e.target.value }))} />
              </FormGroup>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowAddStatus(false)}>Close</button>
              <button className="btn btn-primary"
                disabled={!newStatusForm.label.trim()}
                onClick={() => {
                  if (!newStatusForm.label.trim()) return;
                  const slug = newStatusForm.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                  const newEntry = {
                    value:  slug,
                    label:  newStatusForm.label.trim(),
                    icon:   newStatusForm.icon || '📌',
                    color:  newStatusForm.color,
                    bg:     `${newStatusForm.color}20`,
                    border: `${newStatusForm.color}50`,
                    core:   false,
                  };
                  setExtraStatuses && setExtraStatuses([...(extraStatuses || []), newEntry]);
                  setNewStatusForm({ label: '', icon: '📌', color: '#60a5fa' });
                }}>
                + Add Type
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
