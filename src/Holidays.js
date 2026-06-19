// src/Holidays.js
// CloudOps Rota — Holiday Tracker (extracted from App.js)
// Inspired by WhoIsOff.com — full team visibility, leave calendar, analytics.
// Engineers: submit requests. Manager: approve/reject + manual override.

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────
const ANNUAL_ALLOWANCE = 25; // standard UK days

// ── Pro-rata allowance ────────────────────────────────────────────────────────
// Holiday year is 1 Jan – 31 Dec.
// If a user joins mid-year, their allowance is prorated from their start date
// to 31 Dec of that year. Rounded to nearest 0.5 day (standard UK practice).
// For subsequent years they get the full ANNUAL_ALLOWANCE.
function calcProRataAllowance(startDateStr, targetYear) {
  if (!startDateStr) return ANNUAL_ALLOWANCE;

  const start     = new Date(startDateStr + 'T12:00:00');
  const joinYear  = start.getFullYear();

  // If the engineer joined before or in a previous year, full allowance
  if (joinYear < targetYear) return ANNUAL_ALLOWANCE;

  // If they haven't joined yet (future start year), 0
  if (joinYear > targetYear) return 0;

  // Same year — prorate from start date to 31 Dec inclusive
  const yearEnd       = new Date(targetYear, 11, 31, 12, 0, 0);
  const yearStart     = new Date(targetYear, 0, 1,  12, 0, 0);
  const totalDays     = Math.round((yearEnd - yearStart) / 86400000) + 1; // 365 or 366
  const remainingDays = Math.round((yearEnd - start)     / 86400000) + 1;
  const raw           = (remainingDays / totalDays) * ANNUAL_ALLOWANCE;

  // Round to nearest 0.5
  return Math.round(raw * 2) / 2;
}

// Returns the effective allowance for a user in the current holiday year
function getUserAllowance(user) {
  const year = new Date().getFullYear();
  return calcProRataAllowance(user?.start_date, year);
}

const LEAVE_TYPES = [
  { value: 'Annual Leave',        color: '#10b981', icon: '🌴' },
  { value: 'Sick Leave',          color: '#ef4444', icon: '🤒' },
  { value: 'Compassionate Leave', color: '#8b5cf6', icon: '💜' },
  { value: 'Study Leave',         color: '#3b82f6', icon: '📚' },
  { value: 'Unpaid Leave',        color: '#6b7280', icon: '⏸' },
  { value: 'Maternity/Paternity', color: '#f59e0b', icon: '👶' },
  { value: 'Other',               color: '#64748b', icon: '📋' },
];

const LEAVE_STATUSES = ['pending', 'approved', 'rejected'];

// ── Theme tokens ──────────────────────────────────────────────────────────────
const T = {
  bg:        'var(--bg, #080e1a)',
  bgCard:    'var(--bg-card, rgba(255,255,255,0.03))',
  bgCard2:   'var(--bg-card2, rgba(255,255,255,0.055))',
  border:    'var(--border, rgba(255,255,255,0.08))',
  borderHi:  'rgba(255,255,255,0.13)',
  accent:    'var(--accent, #00c2ff)',
  textPri:   'var(--text-primary, #e2e8f0)',
  textSec:   'var(--text-secondary, #94a3b8)',
  textMuted: 'var(--text-muted, #475569)',
  green:     '#22c55e',
  amber:     '#f59e0b',
  red:       '#ef4444',
  blue:      '#60a5fa',
  purple:    '#a78bfa',
  mono:      "'DM Mono', monospace",
};

// ── Utility ───────────────────────────────────────────────────────────────────
function countDays(start, end) {
  if (!start || !end) return 1;
  const ms = new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00');
  return Math.max(Math.round(ms / 86400000) + 1, 1);
}

function countWorkdays(start, end) {
  if (!start || !end) return 1;
  let count = 0;
  const cur = new Date(start + 'T12:00:00');
  const fin = new Date(end   + 'T12:00:00');
  while (cur <= fin) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(count, 1);
}

function fmtDate(ds) {
  if (!ds) return '—';
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateShort(ds) {
  if (!ds) return '—';
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getLeaveType(value) {
  return LEAVE_TYPES.find(t => t.value === value) || LEAVE_TYPES[LEAVE_TYPES.length - 1];
}

function isOnLeaveToday(h) {
  const t = todayStr();
  return h.status === 'approved' && h.start <= t && h.end >= t;
}

function isUpcoming(h) {
  return h.status === 'approved' && h.start > todayStr();
}

// ── Shared UI primitives ──────────────────────────────────────────────────────
function Avatar({ user, size = 28 }) {
  if (!user) return <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />;
  if (user.profile_picture)
    return <img src={user.profile_picture} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: user.color || '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.38), fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {user.avatar || user.name?.charAt(0) || '?'}
    </div>
  );
}

function LeavePill({ type, size = 'sm' }) {
  const lt = getLeaveType(type);
  const pad = size === 'sm' ? '2px 8px' : '4px 12px';
  return (
    <span style={{ background: lt.color + '20', color: lt.color, border: `1px solid ${lt.color}40`, padding: pad, borderRadius: 5, fontSize: size === 'sm' ? 11 : 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {lt.icon} {type}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    approved: { color: T.green,  label: '✓ Approved' },
    rejected: { color: T.red,    label: '✗ Rejected' },
    pending:  { color: T.amber,  label: '⏳ Pending'  },
  };
  const { color, label } = cfg[status] || cfg.pending;
  return (
    <span style={{ background: color + '18', color, border: `1px solid ${color}35`, padding: '2px 9px', borderRadius: 5, fontSize: 11, fontWeight: 700 }}>
      {label}
    </span>
  );
}

function Modal({ title, subtitle, onClose, children, wide }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#0c1628', border: `1px solid ${T.borderHi}`, borderRadius: 16, padding: '26px 30px', width: '100%', maxWidth: wide ? 680 : 500, boxShadow: '0 32px 80px rgba(0,0,0,0.7)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.07)', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textSec, fontSize: 14, cursor: 'pointer', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', gap: 6 }}>
        {label}
        {hint && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: T.textMuted, opacity: 0.7 }}>({hint})</span>}
      </div>
      {children}
    </div>
  );
}

const IS = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`,
  borderRadius: 8, color: T.textPri, fontSize: 13, outline: 'none',
};

function KpiCard({ label, value, sub, color, icon, delta }) {
  return (
    <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px 18px', flex: 1, minWidth: 130 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
        {icon && <span style={{ fontSize: 16, opacity: 0.7 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color: color || T.textPri, fontFamily: T.mono, letterSpacing: '-1px', lineHeight: 1 }}>{value}</div>
      {sub    && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 5 }}>{sub}</div>}
      {delta  && <div style={{ fontSize: 10, color: delta > 0 ? T.green : T.red, marginTop: 3, fontWeight: 700 }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)} vs last month</div>}
    </div>
  );
}

function ProgressBar({ pct, color, height = 6 }) {
  return (
    <div style={{ height, background: 'rgba(255,255,255,0.07)', borderRadius: height, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(Math.max(pct, 0), 100)}%`, background: color, borderRadius: height, transition: 'width 0.4s cubic-bezier(.4,0,.2,1)' }} />
    </div>
  );
}

function EmptyState({ icon, msg, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '52px 20px', color: T.textMuted }}>
      <div style={{ fontSize: 38, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.textSec }}>{msg}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Month-strip calendar (WhoIsOff-style) ─────────────────────────────────────
function TeamCalendar({ users, holidays, year, month }) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const days     = [];
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));

  const todayStr_ = todayStr();

  const getLeaveForDay = (userId, d) => {
    const ds = d.toISOString().slice(0, 10);
    return holidays.find(h =>
      h.userId === userId &&
      h.status === 'approved' &&
      h.start <= ds && h.end >= ds
    );
  };

  const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

  const cellW = 28;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: users.length > 0 ? (120 + days.length * cellW) : 400 }}>
        <thead>
          <tr>
            <th style={{ width: 120, padding: '8px 12px', textAlign: 'left', fontSize: 11, color: T.textMuted, fontWeight: 700, background: 'rgba(255,255,255,0.02)', position: 'sticky', left: 0, zIndex: 2 }}>
              Engineer
            </th>
            {days.map(d => {
              const ds = d.toISOString().slice(0, 10);
              const isToday = ds === todayStr_;
              const weekend = isWeekend(d);
              return (
                <th key={ds} style={{ width: cellW, minWidth: cellW, padding: '4px 0', textAlign: 'center', background: isToday ? 'rgba(0,194,255,0.08)' : weekend ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.02)', borderLeft: `1px solid rgba(255,255,255,0.04)` }}>
                  <div style={{ fontSize: 9, color: isToday ? 'var(--accent)' : T.textMuted, fontWeight: isToday ? 800 : 500 }}>
                    {d.toLocaleDateString('en-GB', { weekday: 'narrow' })}
                  </div>
                  <div style={{ fontSize: 10, color: isToday ? 'var(--accent)' : weekend ? T.textMuted : T.textSec, fontWeight: isToday ? 800 : 600 }}>
                    {d.getDate()}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {users.map((u, ri) => (
            <tr key={u.id} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
              <td style={{ padding: '5px 12px', position: 'sticky', left: 0, background: ri % 2 === 0 ? '#080e1a' : '#0a1020', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Avatar user={u} size={22} />
                  <span style={{ fontSize: 11, color: T.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>{u.name.split(' ')[0]}</span>
                </div>
              </td>
              {days.map(d => {
                const ds = d.toISOString().slice(0, 10);
                const leave = getLeaveForDay(u.id, d);
                const isToday = ds === todayStr_;
                const weekend = isWeekend(d);
                const lt = leave ? getLeaveType(leave.type) : null;

                // Determine if this is first or last day of a leave run
                const prevDs = new Date(d); prevDs.setDate(prevDs.getDate() - 1);
                const nextDs = new Date(d); nextDs.setDate(nextDs.getDate() + 1);
                const prevLeave = leave ? getLeaveForDay(u.id, prevDs) : null;
                const nextLeave = leave ? getLeaveForDay(u.id, nextDs) : null;
                const isFirst = leave && (!prevLeave || prevLeave.id !== leave.id);
                const isLast  = leave && (!nextLeave || nextLeave.id !== leave.id);

                return (
                  <td key={ds} title={leave ? `${u.name}: ${leave.type}` : undefined}
                    style={{
                      width: cellW, minWidth: cellW, height: 34, padding: 0,
                      borderLeft: `1px solid rgba(255,255,255,0.04)`,
                      background: isToday ? 'rgba(0,194,255,0.05)' : weekend ? 'rgba(255,255,255,0.01)' : 'transparent',
                    }}>
                    {leave && (
                      <div style={{
                        height: 22, margin: '6px 0',
                        background: lt.color + '30',
                        borderTop: `2px solid ${lt.color}`,
                        borderBottom: `2px solid ${lt.color}`,
                        borderLeft:  isFirst ? `2px solid ${lt.color}` : 'none',
                        borderRight: isLast  ? `2px solid ${lt.color}` : 'none',
                        borderRadius: isFirst && isLast ? 4 : isFirst ? '4px 0 0 4px' : isLast ? '0 4px 4px 0' : 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9,
                      }}>
                        {isFirst && <span style={{ color: lt.color, opacity: 0.85 }}>{lt.icon}</span>}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── SVG bar chart (leave by type) ─────────────────────────────────────────────
function TypeBarChart({ data }) {
  // data: [{ type, days, color }]
  if (!data || data.length === 0) return <EmptyState icon="📊" msg="No leave data" />;
  const max = Math.max(...data.map(d => d.days), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map(d => (
        <div key={d.type}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: T.textSec }}>{getLeaveType(d.type).icon} {d.type}</span>
            <span style={{ fontSize: 11, fontFamily: T.mono, color: d.color, fontWeight: 700 }}>{d.days}d</span>
          </div>
          <ProgressBar pct={(d.days / max) * 100} color={d.color} height={7} />
        </div>
      ))}
    </div>
  );
}

// ── Monthly trend (SVG line) ───────────────────────────────────────────────────
function MonthlyTrendChart({ data, color = '#10b981' }) {
  // data: [{ label, value }]
  if (!data || data.length < 2) return <EmptyState icon="📈" msg="Not enough data" />;
  const max  = Math.max(...data.map(d => d.value), 1);
  const W = 420, H = 80;
  const pts  = data.map((d, i) => ({
    x: (i / (data.length - 1)) * (W - 40) + 20,
    y: H - 10 - (d.value / max) * (H - 20),
    ...d,
  }));
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  const fill = path + ` L ${pts[pts.length-1].x},${H} L ${pts[0].x},${H} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="mtg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#mtg)" />
      <path d={path} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={color} />
          <text x={p.x} y={H} textAnchor="middle" fontSize={8} fill={T.textMuted} fontFamily="DM Sans,sans-serif">{p.label}</text>
          {p.value > 0 && (
            <text x={p.x} y={p.y - 6} textAnchor="middle" fontSize={8} fill={color} fontFamily={T.mono}>{p.value}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

// ── Who's off today / this week strip ────────────────────────────────────────
function WhosOffStrip({ users, holidays }) {
  const today  = todayStr();
  const weekEnd = (() => { const d = new Date(today); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })();

  const offToday = holidays.filter(h => h.status === 'approved' && h.start <= today && h.end >= today);
  const offWeek  = holidays.filter(h => h.status === 'approved' && h.start <= weekEnd && h.end >= today && !offToday.find(o => o.id === h.id));

  const renderEntry = (h) => {
    const u  = users.find(x => x.id === h.userId);
    const lt = getLeaveType(h.type);
    return (
      <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: lt.color + '10', border: `1px solid ${lt.color}25`, borderRadius: 8 }}>
        <Avatar user={u} size={26} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.textPri }}>{u?.name || h.userId}</div>
          <div style={{ fontSize: 10, color: lt.color }}>{lt.icon} {h.type} · back {fmtDateShort(h.end)}</div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>🗓 Off Today</div>
        {offToday.length === 0
          ? <div style={{ fontSize: 12, color: T.textMuted, padding: '6px 0' }}>Everyone in today 👍</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{offToday.map(renderEntry)}</div>
        }
      </div>
      {offWeek.length > 0 && (
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>📅 Later This Week</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{offWeek.map(renderEntry)}</div>
        </div>
      )}
    </div>
  );
}

// ── Engineer leave card (dashboard overview) ──────────────────────────────────
function EngineerLeaveCard({ user, holidays, isManager, onAddForUser }) {
  const approved    = holidays.filter(h => h.userId === user.id && h.status === 'approved');
  const annual      = approved.filter(h => h.type === 'Annual Leave');
  const usedDays    = annual.reduce((s, h) => s + countWorkdays(h.start, h.end), 0);
  const allowance   = getUserAllowance(user);
  const remaining   = Math.max(allowance - usedDays, 0);
  const pct         = (usedDays / Math.max(allowance, 1)) * 100;
  const isProRata   = allowance < ANNUAL_ALLOWANCE;
  const color = remaining < 5 ? T.amber : remaining < 10 ? T.blue : '#10b981';

  const pending  = holidays.filter(h => h.userId === user.id && h.status === 'pending').length;
  const onLeave  = approved.some(h => isOnLeaveToday(h));
  const upcoming = approved.filter(h => isUpcoming(h)).slice(0, 1)[0];

  return (
    <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative' }}>
          <Avatar user={user} size={36} />
          {onLeave && (
            <div style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: '#10b981', border: '2px solid #080e1a' }} title="On leave today" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
          <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{user.id}</div>
        </div>
        {pending > 0 && (
          <span style={{ background: T.amber + '18', color: T.amber, border: `1px solid ${T.amber}35`, padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700 }}>{pending} pending</span>
        )}
        {onLeave && (
          <span style={{ background: '#10b98118', color: '#10b981', border: '1px solid #10b98135', padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700 }}>On Leave</span>
        )}
      </div>

      {/* Leave bar */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 10 }}>
          <span style={{ color: T.textMuted, display: 'flex', alignItems: 'center', gap: 5 }}>
            Annual Leave
            {isProRata && (
              <span title={`Pro-rata from ${fmtDate(user.start_date)}`} style={{ background: 'rgba(0,194,255,0.12)', color: T.accent, border: '1px solid rgba(0,194,255,0.25)', padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 700 }}>
                PRO-RATA
              </span>
            )}
          </span>
          <span style={{ fontFamily: T.mono, color, fontWeight: 700 }}>{usedDays}/{allowance}d used · <span style={{ color }}>{remaining}d left</span></span>
        </div>
        <ProgressBar pct={pct} color={color} height={7} />
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: `1px solid ${T.border}` }}>
        {[
          { l: 'Used',   v: `${usedDays}d`,  c: '#10b981' },
          { l: 'Left',   v: `${remaining}d`, c: color },
          { l: isProRata ? `of ${allowance}d` : 'Taken', v: isProRata ? `${ANNUAL_ALLOWANCE}d FTE` : annual.length, c: T.blue },
        ].map((s, i) => (
          <div key={s.l} style={{ padding: '9px 0', textAlign: 'center', borderRight: i < 2 ? `1px solid ${T.border}` : 'none' }}>
            <div style={{ fontSize: 9, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>{s.l}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.c, fontFamily: T.mono }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Next leave */}
      {upcoming && (
        <div style={{ padding: '8px 16px', borderTop: `1px solid ${T.border}`, background: 'rgba(16,185,129,0.04)' }}>
          <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 2 }}>Next leave</div>
          <div style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>
            {getLeaveType(upcoming.type).icon} {fmtDateShort(upcoming.start)} – {fmtDateShort(upcoming.end)} · {countWorkdays(upcoming.start, upcoming.end)}d
          </div>
        </div>
      )}

      {/* Manager action */}
      {isManager && (
        <button onClick={() => onAddForUser(user.id)}
          style={{ width: '100%', padding: '8px', background: 'transparent', border: 'none', borderTop: `1px solid ${T.border}`, color: T.textMuted, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
          + Add Leave for {user.name.split(' ')[0]}
        </button>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function Holidays({ users, holidays, setHolidays, currentUser, isManager }) {
  const safeHolidays = useMemo(() => Array.isArray(holidays) ? holidays : [], [holidays]);

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeTab,    setActiveTab]    = useState('dashboard');
  const [showModal,    setShowModal]    = useState(false);
  const [showReject,   setShowReject]   = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editId,       setEditId]       = useState(null);
  const [form,         setForm]         = useState({ userId: isManager ? (users[0]?.id || '') : currentUser, start: '', end: '', type: 'Annual Leave', note: '', status: isManager ? 'approved' : 'pending' });

  // Calendar navigation
  const now = new Date();
  const [calYear,  setCalYear]  = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  // List/history filters
  const [filterUser,   setFilterUser]   = useState('all');
  const [filterType,   setFilterType]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [listSort,     setListSort]     = useState('start_desc');
  const [searchQ,      setSearchQ]      = useState('');

  // ── Derived data ──────────────────────────────────────────────────────────
  const myHolidays = useMemo(() => safeHolidays.filter(h => h.userId === currentUser), [safeHolidays, currentUser]);
  const pending    = useMemo(() => safeHolidays.filter(h => h.status === 'pending'), [safeHolidays]);

  const usedAnnualDays = useCallback((userId) => {
    return safeHolidays
      .filter(h => h.userId === userId && h.type === 'Annual Leave' && h.status === 'approved')
      .reduce((s, h) => s + countWorkdays(h.start, h.end), 0);
  }, [safeHolidays]);

  const remainingDays = useCallback((userId) => {
    const user = users.find(u => u.id === userId);
    return Math.max(getUserAllowance(user) - usedAnnualDays(userId), 0);
  }, [usedAnnualDays, users]);

  // Total team days off (approved)
  const totalTeamDays = useMemo(() =>
    safeHolidays.filter(h => h.status === 'approved').reduce((s, h) => s + countWorkdays(h.start, h.end), 0),
    [safeHolidays]
  );

  // Leave by type for analytics
  const byType = useMemo(() => {
    const map = {};
    safeHolidays.filter(h => h.status === 'approved').forEach(h => {
      map[h.type] = (map[h.type] || 0) + countWorkdays(h.start, h.end);
    });
    return LEAVE_TYPES.map(lt => ({ type: lt.value, days: map[lt.value] || 0, color: lt.color })).filter(d => d.days > 0);
  }, [safeHolidays]);

  // Monthly trend (last 6 months)
  const monthlyTrend = useMemo(() => {
    const result = [];
    for (let m = 5; m >= 0; m--) {
      const d   = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const days = safeHolidays
        .filter(h => h.status === 'approved' && (h.start || '').startsWith(key))
        .reduce((s, h) => s + countWorkdays(h.start, h.end), 0);
      result.push({ label: d.toLocaleDateString('en-GB', { month: 'short' }), value: days });
    }
    return result;
  }, [safeHolidays]); // eslint-disable-line

  // Filtered list (History tab)
  const filteredList = useMemo(() => {
    let rows = safeHolidays
      .filter(h => isManager || h.userId === currentUser)
      .filter(h => filterUser   === 'all' || h.userId === filterUser)
      .filter(h => filterType   === 'all' || h.type   === filterType)
      .filter(h => filterStatus === 'all' || h.status === filterStatus)
      .filter(h => {
        if (!searchQ) return true;
        const u = users.find(x => x.id === h.userId);
        return (u?.name || '').toLowerCase().includes(searchQ.toLowerCase()) ||
               (h.note || '').toLowerCase().includes(searchQ.toLowerCase()) ||
               (h.type || '').toLowerCase().includes(searchQ.toLowerCase());
      });
    switch (listSort) {
      case 'start_asc':  rows = rows.slice().sort((a,b) => (a.start||'').localeCompare(b.start||'')); break;
      case 'start_desc': rows = rows.slice().sort((a,b) => (b.start||'').localeCompare(a.start||'')); break;
      case 'days_desc':  rows = rows.slice().sort((a,b) => countDays(b.start,b.end) - countDays(a.start,a.end)); break;
      default: break;
    }
    return rows;
  }, [safeHolidays, isManager, currentUser, filterUser, filterType, filterStatus, listSort, searchQ, users]);

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const openAdd = useCallback((prefillUserId) => {
    setForm({
      userId: prefillUserId || (isManager ? (users[0]?.id || '') : currentUser),
      start: '', end: '', type: 'Annual Leave', note: '',
      status: isManager ? 'approved' : 'pending',
    });
    setEditId(null);
    setShowModal(true);
  }, [isManager, users, currentUser]);

  const openEdit = useCallback((h) => {
    setForm({ userId: h.userId, start: h.start, end: h.end, type: h.type, note: h.note || '', status: h.status });
    setEditId(h.id);
    setShowModal(true);
  }, []);

  const save = useCallback(() => {
    if (!form.start || !form.end || !form.userId) return;
    const entry = {
      id:          editId || 'h' + Date.now(),
      userId:      form.userId,
      start:       form.start,
      end:         form.end,
      type:        form.type,
      note:        form.note,
      status:      form.status,
      submittedAt: new Date().toISOString(),
      submittedBy: currentUser,
    };
    setHolidays(editId ? safeHolidays.map(h => h.id === editId ? { ...h, ...entry } : h) : [...safeHolidays, entry]);
    setShowModal(false);
  }, [form, editId, safeHolidays, setHolidays, currentUser]);

  const approve = useCallback(id =>
    setHolidays(safeHolidays.map(h => h.id === id ? { ...h, status: 'approved', approvedBy: currentUser, approvedAt: new Date().toISOString() } : h)),
    [safeHolidays, setHolidays, currentUser]
  );

  const reject = useCallback((id, reason = '') => {
    setHolidays(safeHolidays.map(h => h.id === id ? { ...h, status: 'rejected', rejectedBy: currentUser, rejectedAt: new Date().toISOString(), rejectReason: reason } : h));
    setShowReject(null);
    setRejectReason('');
  }, [safeHolidays, setHolidays, currentUser]);

  const deleteEntry = useCallback(id => {
    if (window.confirm('Delete this leave record?')) setHolidays(safeHolidays.filter(h => h.id !== id));
  }, [safeHolidays, setHolidays]);

  const cancelRequest = useCallback(id =>
    setHolidays(safeHolidays.map(h => h.id === id ? { ...h, status: 'cancelled' } : h)),
    [safeHolidays, setHolidays]
  );

  // Preview: workdays for current form
  const previewWorkdays = useMemo(() => {
    if (!form.start || !form.end) return null;
    const wd  = countWorkdays(form.start, form.end);
    const rem = remainingDays(form.userId);
    const formUser   = users.find(u => u.id === form.userId);
    const allowance  = getUserAllowance(formUser);
    const isProRata  = allowance < ANNUAL_ALLOWANCE;
    return { wd, rem, afterRem: Math.max(rem - wd, 0), allowance, isProRata };
  }, [form.start, form.end, form.userId, remainingDays, users]);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'calendar',  label: 'Calendar' },
    { id: 'requests',  label: `Requests${pending.length > 0 ? ` · ${pending.length}` : ''}`, badge: pending.length > 0 },
    { id: 'list',      label: 'All Leave' },
    { id: 'analytics', label: 'Analytics' },
  ];

  const visibleUsers = isManager ? users : users.filter(u => u.id === currentUser);

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: T.textPri }}>

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🌴</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' }}>Holiday Tracker</h1>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{ANNUAL_ALLOWANCE} days annual allowance · Pro-rata for new starters · UK working days</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isManager && (
            <button onClick={() => openAdd()}
              style={{ padding: '9px 20px', background: '#10b981', color: '#000', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: '0 0 18px rgba(16,185,129,0.3)' }}>
              📅 Request Leave
            </button>
          )}
          {isManager && (
            <button onClick={() => openAdd()}
              style={{ padding: '9px 20px', background: '#10b981', color: '#000', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: '0 0 18px rgba(16,185,129,0.3)' }}>
              + Add Leave
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 22, borderBottom: `1px solid ${T.border}` }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '9px 18px 10px', borderRadius: '8px 8px 0 0', cursor: 'pointer',
            fontSize: 13, fontWeight: 700, background: 'transparent', border: 'none',
            borderBottom: activeTab === t.id ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === t.id ? '#10b981' : T.textSec,
            transition: 'all 0.15s', position: 'relative',
          }}>
            {t.label}
            {t.badge && <span style={{ position: 'absolute', top: 5, right: 4, width: 7, height: 7, borderRadius: '50%', background: T.amber }} />}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* DASHBOARD TAB                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'dashboard' && (
        <div>
          {/* KPI row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            <KpiCard label="On Leave Today"  value={safeHolidays.filter(h => h.status==='approved' && isOnLeaveToday(h)).length} color="#10b981" icon="🌴" sub="approved leave" />
            <KpiCard label="Pending"         value={pending.length} color={pending.length > 0 ? T.amber : T.textMuted} icon="⏳" sub="awaiting approval" />
            <KpiCard label="Team Days Used"  value={`${totalTeamDays}d`} color={T.blue} icon="📅" sub="approved, all time" />
            {!isManager && (
              <KpiCard label="Your Leave Left" value={`${remainingDays(currentUser)}d`} color={remainingDays(currentUser) < 5 ? T.amber : '#10b981'} icon="✈️" sub={`of ${getUserAllowance(users.find(u=>u.id===currentUser))}d allowance${getUserAllowance(users.find(u=>u.id===currentUser)) < ANNUAL_ALLOWANCE ? ' (pro-rata)' : ''}`} />
            )}
            {isManager && (
              <KpiCard label="Avg Days Left" value={`${Math.round(users.reduce((s,u) => s + remainingDays(u.id), 0) / Math.max(users.length, 1))}d`} color="#10b981" icon="📊" sub="across team" />
            )}
          </div>

          {/* Who's off strip */}
          <WhosOffStrip users={users} holidays={safeHolidays} />

          {/* Engineer cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {visibleUsers.map(u => (
              <EngineerLeaveCard
                key={u.id}
                user={u}
                holidays={safeHolidays.filter(h => h.userId === u.id)}
                isManager={isManager}
                onAddForUser={(uid) => openAdd(uid)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* CALENDAR TAB (WhoIsOff-style strip)                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'calendar' && (
        <div>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <button onClick={() => { const d = new Date(calYear, calMonth - 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()); }}
              style={{ padding: '6px 14px', background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 7, color: T.textSec, cursor: 'pointer', fontSize: 14 }}>←</button>
            <div style={{ fontSize: 16, fontWeight: 700, minWidth: 160, textAlign: 'center' }}>
              {new Date(calYear, calMonth, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </div>
            <button onClick={() => { const d = new Date(calYear, calMonth + 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()); }}
              style={{ padding: '6px 14px', background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 7, color: T.textSec, cursor: 'pointer', fontSize: 14 }}>→</button>
            <button onClick={() => { setCalYear(now.getFullYear()); setCalMonth(now.getMonth()); }}
              style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 7, color: '#10b981', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Today</button>

            {/* Legend */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {LEAVE_TYPES.slice(0, 4).map(lt => (
                <div key={lt.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: T.textSec }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: lt.color }} />{lt.value}
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden', padding: '10px 0' }}>
            <TeamCalendar users={visibleUsers} holidays={safeHolidays} year={calYear} month={calMonth} />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* REQUESTS TAB                                                         */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'requests' && (
        <div>
          {/* Engineer: my pending requests */}
          {!isManager && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textSec, marginBottom: 12 }}>My Leave Requests</div>
              {myHolidays.length === 0
                ? <EmptyState icon="📭" msg="No leave requests yet" sub='Use "Request Leave" to submit a request for approval.' />
                : myHolidays.map(h => <LeaveRequestCard key={h.id} holiday={h} users={users} isManager={false} onCancel={() => cancelRequest(h.id)} onEdit={() => openEdit(h)} fmtDate={fmtDate} />)
              }
            </>
          )}

          {/* Manager: all pending */}
          {isManager && (
            <>
              {pending.length === 0
                ? <EmptyState icon="✅" msg="No pending requests" sub="All leave requests have been actioned." />
                : (
                  <>
                    <div style={{ fontSize: 13, color: T.textSec, fontWeight: 600, marginBottom: 14 }}>
                      {pending.length} request{pending.length !== 1 ? 's' : ''} awaiting approval
                    </div>
                    {pending.map(h => (
                      <LeaveRequestCard key={h.id} holiday={h} users={users} isManager={true}
                        onApprove={() => approve(h.id)}
                        onReject={() => { setShowReject(h.id); setRejectReason(''); }}
                        onEdit={() => openEdit(h)}
                        onDelete={() => deleteEntry(h.id)}
                        fmtDate={fmtDate} />
                    ))}
                  </>
                )
              }
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ALL LEAVE (list) TAB                                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'list' && (
        <div>
          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16, background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px' }}>
            <input placeholder="🔍 Search name, type, note…" value={searchQ} onChange={e => setSearchQ(e.target.value)}
              style={{ ...IS, width: 200, padding: '6px 10px', fontSize: 12 }} />
            {isManager && (
              <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{ ...IS, width: 160, padding: '6px 10px', fontSize: 12 }}>
                <option value="all">All Engineers</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...IS, width: 170, padding: '6px 10px', fontSize: 12 }}>
              <option value="all">All Types</option>
              {LEAVE_TYPES.map(lt => <option key={lt.value} value={lt.value}>{lt.icon} {lt.value}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...IS, width: 140, padding: '6px 10px', fontSize: 12 }}>
              <option value="all">All Statuses</option>
              {LEAVE_STATUSES.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
            </select>
            <select value={listSort} onChange={e => setListSort(e.target.value)} style={{ ...IS, width: 160, padding: '6px 10px', fontSize: 12 }}>
              <option value="start_desc">Start (newest)</option>
              <option value="start_asc">Start (oldest)</option>
              <option value="days_desc">Days (most)</option>
            </select>
            <div style={{ marginLeft: 'auto', fontSize: 12, color: T.textMuted, fontFamily: T.mono }}>{filteredList.length} entries</div>
          </div>

          {filteredList.length === 0
            ? <EmptyState icon="🗂" msg="No leave records match filters" />
            : (
              <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                      {['Engineer','Type','Start','End','Days','Status','Notes','Approved By',''].map(h => (
                        <th key={h} style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}`, fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredList.map(h => {
                      const u        = users.find(x => x.id === h.userId);
                      const approver = users.find(x => x.id === (h.approvedBy || h.rejectedBy));
                      const wd       = countWorkdays(h.start, h.end);
                      return (
                        <tr key={h.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                          <td style={{ padding: '9px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              <Avatar user={u} size={22} />
                              <span style={{ fontSize: 12 }}>{u?.name || h.userId}</span>
                            </div>
                          </td>
                          <td style={{ padding: '9px 12px' }}><LeavePill type={h.type} /></td>
                          <td style={{ padding: '9px 12px', fontFamily: T.mono, fontSize: 11, color: T.textSec }}>{fmtDate(h.start)}</td>
                          <td style={{ padding: '9px 12px', fontFamily: T.mono, fontSize: 11, color: T.textSec }}>{fmtDate(h.end)}</td>
                          <td style={{ padding: '9px 12px', fontFamily: T.mono, fontSize: 12, color: '#10b981', fontWeight: 700 }}>{wd}d</td>
                          <td style={{ padding: '9px 12px' }}><StatusBadge status={h.status} /></td>
                          <td style={{ padding: '9px 12px', fontSize: 11, color: T.textMuted, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.note || '—'}</td>
                          <td style={{ padding: '9px 12px', fontSize: 11, color: T.textMuted }}>
                            {approver?.name || h.approvedBy || '—'}
                            {h.rejectReason && <div style={{ fontSize: 10, color: T.red }}>{h.rejectReason}</div>}
                          </td>
                          <td style={{ padding: '9px 12px' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {isManager && <button onClick={() => openEdit(h)} style={{ padding: '3px 8px', background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 5, color: T.textSec, fontSize: 11, cursor: 'pointer' }}>✏</button>}
                              {(isManager || h.userId === currentUser) && <button onClick={() => deleteEntry(h.id)} style={{ padding: '3px 8px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 5, color: T.red, fontSize: 11, cursor: 'pointer' }}>🗑</button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ANALYTICS TAB (Power BI style)                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'analytics' && (
        <div>
          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Total Days Taken',    value: `${totalTeamDays}d`,   color: '#10b981', icon: '✈️',  sub: 'approved, all time' },
              { label: 'Annual Leave Days',   value: `${safeHolidays.filter(h=>h.status==='approved'&&h.type==='Annual Leave').reduce((s,h)=>s+countWorkdays(h.start,h.end),0)}d`, color: T.blue, icon: '🌴', sub: 'of all approved leave' },
              { label: 'Sick Days',           value: `${safeHolidays.filter(h=>h.status==='approved'&&h.type==='Sick Leave').reduce((s,h)=>s+countWorkdays(h.start,h.end),0)}d`,   color: T.red, icon: '🤒', sub: 'approved sick leave' },
              { label: 'Avg Days/Engineer',   value: `${users.length > 0 ? Math.round(totalTeamDays / users.length) : 0}d`, color: T.purple, icon: '👤', sub: 'mean usage' },
              { label: 'Pending Requests',    value: pending.length, color: pending.length > 0 ? T.amber : T.textMuted, icon: '⏳', sub: 'awaiting action' },
              { label: 'Team Compliance',     value: `${Math.round(users.filter(u => safeHolidays.some(h => h.userId===u.id && h.status==='approved')).length / Math.max(users.length,1) * 100)}%`, color: '#10b981', icon: '✅', sub: 'engineers with leave taken' },
            ].map(kpi => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </div>

          {/* 2-col charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>

            {/* Leave by type */}
            <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Leave by Type</div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 16 }}>Working days taken per leave category</div>
              <TypeBarChart data={byType} />
            </div>

            {/* Monthly trend */}
            <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Monthly Leave Trend</div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 16 }}>Approved leave days — last 6 months</div>
              <MonthlyTrendChart data={monthlyTrend} color="#10b981" />
            </div>

          </div>

          {/* Per-engineer allowance chart */}
          <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Annual Leave Allowance Usage</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 16 }}>Used vs remaining per engineer (working days)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {users
                .map(u => ({ u, used: usedAnnualDays(u.id), rem: remainingDays(u.id), allowance: getUserAllowance(u) }))
                .sort((a, b) => b.used - a.used)
                .map(({ u, used, rem, allowance }) => {
                  const pct   = (used / Math.max(allowance, 1)) * 100;
                  const color = rem < 5 ? T.amber : rem < 10 ? T.blue : '#10b981';
                  const isProRata = allowance < ANNUAL_ALLOWANCE;
                  return (
                    <div key={u.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                        <Avatar user={u} size={20} />
                        <span style={{ fontSize: 12, flex: 1, color: T.textSec }}>
                          {u.name}
                          {isProRata && <span title={`Pro-rata from ${fmtDate(u.start_date)}`} style={{ marginLeft: 6, background: 'rgba(0,194,255,0.1)', color: T.accent, border: '1px solid rgba(0,194,255,0.2)', padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 700 }}>PRO-RATA</span>}
                        </span>
                        <span style={{ fontSize: 11, fontFamily: T.mono, color: T.textMuted }}>{used}d used</span>
                        <span style={{ fontSize: 11, fontFamily: T.mono, color, fontWeight: 700 }}>{rem}d left of {allowance}d</span>
                      </div>
                      <ProgressBar pct={pct} color={color} height={7} />
                    </div>
                  );
                })
              }
            </div>
          </div>

          {/* Detailed data table */}
          <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Team Summary Table</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 14 }}>Full leave breakdown per engineer</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                    {['Engineer', 'Annual Used', 'Remaining', 'Sick Days', 'Other Days', 'Total Days', 'Allowance %', 'Status'].map(h => (
                      <th key={h} style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}`, fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: h === 'Engineer' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const allowance = getUserAllowance(u);
                    const isProRata = allowance < ANNUAL_ALLOWANCE;
                    const ual  = usedAnnualDays(u.id);
                    const rem  = remainingDays(u.id);
                    const sick = safeHolidays.filter(h=>h.userId===u.id&&h.status==='approved'&&h.type==='Sick Leave').reduce((s,h)=>s+countWorkdays(h.start,h.end),0);
                    const other= safeHolidays.filter(h=>h.userId===u.id&&h.status==='approved'&&h.type!=='Annual Leave'&&h.type!=='Sick Leave').reduce((s,h)=>s+countWorkdays(h.start,h.end),0);
                    const total= safeHolidays.filter(h=>h.userId===u.id&&h.status==='approved').reduce((s,h)=>s+countWorkdays(h.start,h.end),0);
                    const pct  = Math.round((ual / Math.max(allowance, 1)) * 100);
                    const color = rem < 5 ? T.amber : rem < 10 ? T.blue : '#10b981';
                    const status = rem <= 0 ? { l: 'Exhausted', c: T.red } : rem < 5 ? { l: 'Low', c: T.amber } : { l: 'OK', c: '#10b981' };
                    return (
                      <tr key={u.id} style={{ borderBottom: 'rgba(255,255,255,0.04) 1px solid' }}>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Avatar user={u} size={24} />
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {u.name}
                                {isProRata && <span title={`Pro-rata from ${fmtDate(u.start_date)}`} style={{ background: 'rgba(0,194,255,0.1)', color: T.accent, border: '1px solid rgba(0,194,255,0.2)', padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 700 }}>PRO-RATA</span>}
                              </div>
                              <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{u.id}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 12, color: T.textSec }}>{ual}d</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 13, color, fontWeight: 800 }}>{rem}d</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 12, color: sick > 5 ? T.red : T.textSec }}>{sick}d</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 12, color: T.textSec }}>{other}d</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 12, color: T.blue, fontWeight: 700 }}>{total}d</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                            <div style={{ width: 44, height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(pct,100)}%`, background: color, borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textMuted }}>{pct}%</span>
                          </div>
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                          <span style={{ fontSize: 10, color: status.c, fontWeight: 700, background: `${status.c}18`, padding: '2px 8px', borderRadius: 4 }}>{status.l}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* REJECT MODAL                                                          */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showReject && (
        <Modal title="Reject Leave Request" subtitle="A reason helps the engineer understand." onClose={() => setShowReject(null)}>
          <Field label="Reason (optional)">
            <input autoFocus type="text" value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && reject(showReject, rejectReason)}
              placeholder="e.g. Insufficient cover on that date"
              style={IS} />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => setShowReject(null)}
              style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8, color: T.textSec, cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={() => reject(showReject, rejectReason)}
              style={{ padding: '8px 22px', background: 'rgba(239,68,68,0.13)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: T.red, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ✗ Reject
            </button>
          </div>
        </Modal>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ADD / EDIT MODAL                                                      */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <Modal
          title={editId ? 'Edit Leave Record' : isManager ? 'Add Leave' : 'Request Leave'}
          subtitle={!isManager && !editId ? 'Your request will be sent to the manager for approval.' : 'Pre-approved leave is added directly to the team calendar.'}
          onClose={() => setShowModal(false)}>

          {isManager && (
            <Field label="Engineer">
              <select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })} style={IS}>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
              </select>
            </Field>
          )}

          <Field label="Leave Type">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
              {LEAVE_TYPES.map(lt => (
                <div key={lt.value} onClick={() => setForm({ ...form, type: lt.value })}
                  style={{ padding: '8px 6px', textAlign: 'center', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                    background: form.type === lt.value ? lt.color + '20' : 'rgba(255,255,255,0.03)',
                    border: `1.5px solid ${form.type === lt.value ? lt.color + '80' : T.border}`,
                    color: form.type === lt.value ? lt.color : T.textMuted, transition: 'all 0.15s' }}>
                  <div style={{ fontSize: 16, marginBottom: 3 }}>{lt.icon}</div>
                  <div style={{ fontSize: 10, lineHeight: 1.2 }}>{lt.value}</div>
                </div>
              ))}
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Start Date">
              <input type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} style={IS} />
            </Field>
            <Field label="End Date">
              <input type="date" value={form.end} min={form.start} onChange={e => setForm({ ...form, end: e.target.value })} style={IS} />
            </Field>
          </div>

          {/* Preview */}
          {previewWorkdays && (
            <div style={{ background: previewWorkdays.wd > previewWorkdays.rem && form.type === 'Annual Leave' ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.07)', border: `1px solid ${previewWorkdays.wd > previewWorkdays.rem && form.type === 'Annual Leave' ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.2)'}`, borderRadius: 8, padding: '9px 12px', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: T.textSec }}>
                {previewWorkdays.wd} working day{previewWorkdays.wd !== 1 ? 's' : ''}
              </span>
              {form.type === 'Annual Leave' && (
                <span style={{ color: previewWorkdays.wd > previewWorkdays.rem ? T.amber : '#10b981', marginLeft: 8, fontWeight: 700 }}>
                  · {previewWorkdays.rem}d remaining of {previewWorkdays.allowance}d{previewWorkdays.isProRata ? ' (pro-rata)' : ''} → {previewWorkdays.afterRem}d after
                  {previewWorkdays.wd > previewWorkdays.rem && ' ⚠ Exceeds allowance'}
                </span>
              )}
            </div>
          )}

          <Field label="Notes (optional)">
            <input type="text" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
              placeholder="e.g. Pre-approved by HR, medical appointment…" style={IS} />
          </Field>

          {isManager && (
            <Field label="Status">
              <div style={{ display: 'flex', gap: 8 }}>
                {['approved', 'pending'].map(s => (
                  <div key={s} onClick={() => setForm({ ...form, status: s })}
                    style={{ flex: 1, padding: '8px', textAlign: 'center', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      background: form.status === s ? (s === 'approved' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)') : 'rgba(255,255,255,0.03)',
                      border: `1.5px solid ${form.status === s ? (s === 'approved' ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)') : T.border}`,
                      color: form.status === s ? (s === 'approved' ? T.green : T.amber) : T.textMuted, transition: 'all 0.15s' }}>
                    {s === 'approved' ? '✓ Approved' : '⏳ Pending'}
                  </div>
                ))}
              </div>
            </Field>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={() => setShowModal(false)}
              style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8, color: T.textSec, cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={save} disabled={!form.start || !form.end}
              style={{ padding: '8px 22px', background: '#10b981', color: '#000', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: (!form.start || !form.end) ? 0.45 : 1 }}>
              {editId ? 'Save Changes' : isManager ? 'Add Leave' : 'Submit Request'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Leave request card ────────────────────────────────────────────────────────
function LeaveRequestCard({ holiday: h, users, isManager, onApprove, onReject, onCancel, onEdit, onDelete, fmtDate }) {
  const u   = users.find(x => x.id === h.userId);
  const lt  = getLeaveType(h.type);
  const wd  = countWorkdays(h.start, h.end);
  const scol = h.status === 'approved' ? '#22c55e' : h.status === 'rejected' ? '#ef4444' : '#f59e0b';
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${scol}22`, borderRadius: 12, padding: '16px 20px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar user={u} size={36} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{u?.name || h.userId}</div>
            <div style={{ fontSize: 11, color: '#64748b', fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
              {fmtDate(h.start)} – {fmtDate(h.end)} · {wd} working day{wd !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <LeavePill type={h.type} />
          <StatusBadge status={h.status} />
          {isManager && h.status === 'pending' && (
            <>
              <button onClick={onApprove} style={{ padding: '5px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 7, color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ Approve</button>
              <button onClick={onReject}  style={{ padding: '5px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)', borderRadius: 7, color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✗ Reject</button>
            </>
          )}
          {isManager && <button onClick={onEdit}   style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>✏</button>}
          {isManager && <button onClick={onDelete} style={{ padding: '5px 10px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 7, color: '#ef4444', fontSize: 12, cursor: 'pointer' }}>🗑</button>}
          {!isManager && h.status === 'pending' && <button onClick={onCancel} style={{ padding: '5px 12px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, color: '#ef4444', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>Cancel</button>}
        </div>
      </div>
      {h.note && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#64748b', fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', borderRadius: 6, padding: '6px 10px' }}>"{h.note}"</div>
      )}
      {h.rejectReason && <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444', fontWeight: 600 }}>Rejection reason: {h.rejectReason}</div>}
    </div>
  );
}
