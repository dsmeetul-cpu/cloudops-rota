// src/TOIL.js
// CloudOps Rota — TOIL (Time Off In Lieu) Manager — Enhanced v2
// UK WTR 1998: 1:1 accrual on worked on-call hours. Max 40h carryover.

import React, { useState, useMemo, useCallback } from 'react';

const TOIL_MAX_CARRYOVER = 40;

// ── Theme tokens ──────────────────────────────────────────────────────────────
const T = {
  bg:        '#080e1a',
  bgCard:    'rgba(255,255,255,0.03)',
  bgCard2:   'rgba(255,255,255,0.055)',
  border:    'rgba(255,255,255,0.07)',
  borderHi:  'rgba(255,255,255,0.13)',
  accent:    '#00c2ff',
  accentDim: 'rgba(0,194,255,0.12)',
  accentBrd: 'rgba(0,194,255,0.35)',
  green:     '#22c55e',
  amber:     '#f59e0b',
  red:       '#ef4444',
  purple:    '#a78bfa',
  textPri:   '#e2e8f0',
  textSec:   '#94a3b8',
  textMuted: '#475569',
  mono:      "'DM Mono', monospace",
};

// ── Shared UI helpers ─────────────────────────────────────────────────────────
function Avatar({ user, size = 28 }) {
  if (!user) return <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />;
  if (user.profile_picture)
    return <img src={user.profile_picture} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: user.color || '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.4), fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {user.avatar || user.name?.charAt(0) || '?'}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children, wide }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#0c1628', border: `1px solid ${T.borderHi}`, borderRadius: 16, padding: '28px 32px', width: '100%', maxWidth: wide ? 660 : 480, boxShadow: '0 32px 80px rgba(0,0,0,0.7)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.textPri }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textSec, fontSize: 14, cursor: 'pointer', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Tag({ label, type }) {
  const cols = {
    green:  ['rgba(34,197,94,0.13)',  '#22c55e'],
    amber:  ['rgba(245,158,11,0.13)', '#f59e0b'],
    red:    ['rgba(239,68,68,0.13)',  '#ef4444'],
    blue:   ['rgba(96,165,250,0.13)', '#60a5fa'],
    purple: ['rgba(167,139,250,0.13)','#a78bfa'],
    cyan:   ['rgba(0,194,255,0.13)',  '#00c2ff'],
  };
  const [bg, color] = cols[type] || cols.blue;
  return <span style={{ background: bg, color, padding: '2px 9px', borderRadius: 5, fontSize: 11, fontWeight: 700, letterSpacing: '0.2px' }}>{label}</span>;
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{children}</div>;
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

const IS = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.border}`,
  borderRadius: 8, color: T.textPri, fontSize: 13, outline: 'none',
  transition: 'border-color 0.15s',
};

// Thin progress bar
function ProgressBar({ pct, color, height = 6 }) {
  return (
    <div style={{ height, background: 'rgba(255,255,255,0.06)', borderRadius: height, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: height, transition: 'width 0.5s cubic-bezier(.4,0,.2,1)' }} />
    </div>
  );
}

// Stat chip for summary row
function StatChip({ label, value, color, sub }) {
  return (
    <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 16px', flex: 1, minWidth: 100 }}>
      <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || T.textPri, fontFamily: T.mono }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// Simple inline sparkline (SVG bars)
function MiniBar({ values, color = T.accent, height = 28 }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values, 1);
  const w = 7, gap = 3;
  const total = values.length * w + (values.length - 1) * gap;
  return (
    <svg width={total} height={height} style={{ display: 'block' }}>
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * height);
        return (
          <rect key={i} x={i * (w + gap)} y={height - bh} width={w} height={bh}
            fill={color} rx={2} opacity={0.75} />
        );
      })}
    </svg>
  );
}

// ── TOIL balance calculator ───────────────────────────────────────────────────
function calcTOILBalance(timesheetEntries, toilEntries, userId) {
  const ts   = Array.isArray(timesheetEntries) ? timesheetEntries : [];
  const toil = Array.isArray(toilEntries)      ? toilEntries      : Object.values(toilEntries || {});

  const workedOC = ts.reduce((a, t) => a + (t.worked_wd || 0) + (t.worked_we || 0), 0);
  const autoToil = Math.round(workedOC * 10) / 10;

  const manualAccrued = toil
    .filter(t => t.userId === userId && t.type === 'Accrued' && t.status === 'approved')
    .reduce((a, t) => a + (+t.hours || 0), 0);

  const used = toil
    .filter(t => t.userId === userId && t.type === 'Used' && t.status === 'approved')
    .reduce((a, t) => a + (+t.hours || 0), 0);

  const totalAccrued = autoToil + manualAccrued;
  const balance = Math.min(Math.max(totalAccrued - used, 0), TOIL_MAX_CARRYOVER);

  return {
    workedOC:      Math.round(workedOC      * 10) / 10,
    autoToil:      Math.round(autoToil      * 10) / 10,
    manualAccrued: Math.round(manualAccrued * 10) / 10,
    used:          Math.round(used          * 10) / 10,
    totalAccrued:  Math.round(totalAccrued  * 10) / 10,
    balance:       Math.round(balance       * 10) / 10,
    cappedAt:      TOIL_MAX_CARRYOVER,
  };
}

// ── Colour helpers ─────────────────────────────────────────────────────────────
function balanceColor(balance) {
  if (balance >= TOIL_MAX_CARRYOVER) return T.amber;
  if (balance > 20) return T.green;
  if (balance > 0)  return T.accent;
  return '#fca5a5';
}

// ── Bar chart primitive (SVG, horizontal) ────────────────────────────────────
function HBarChart({ data, height = 220 }) {
  // data: [{ label, accrued, used, balance }]
  if (!data || data.length === 0) return <EmptyState icon="📊" msg="No data to chart" />;
  const maxVal = Math.max(...data.flatMap(d => [d.accrued, d.used, TOIL_MAX_CARRYOVER]), 1);
  const rowH = 40, padL = 90, padR = 20, barH = 12, gap = 4;
  const svgH = data.length * rowH + 20;
  const chartW = 420;

  return (
    <svg width="100%" viewBox={`0 0 ${padL + chartW + padR} ${svgH}`} style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const y = i * rowH + 8;
        const accW = (d.accrued / maxVal) * chartW;
        const useW = (d.used    / maxVal) * chartW;
        return (
          <g key={d.label}>
            <text x={padL - 8} y={y + barH + 2} textAnchor="end" fontSize={10} fill={T.textSec} fontFamily="DM Sans,sans-serif">{d.label}</text>
            {/* accrued */}
            <rect x={padL} y={y} width={Math.max(accW, 2)} height={barH} fill={T.accent} rx={3} opacity={0.85} />
            <text x={padL + accW + 4} y={y + barH - 1} fontSize={9} fill={T.accent} fontFamily={T.mono}>{d.accrued}h</text>
            {/* used */}
            <rect x={padL} y={y + barH + gap} width={Math.max(useW, 2)} height={barH} fill={T.amber} rx={3} opacity={0.75} />
            <text x={padL + useW + 4} y={y + barH * 2 + gap - 1} fontSize={9} fill={T.amber} fontFamily={T.mono}>{d.used}h</text>
          </g>
        );
      })}
      {/* cap line */}
      {(() => {
        const cx = padL + (TOIL_MAX_CARRYOVER / maxVal) * chartW;
        return (
          <g>
            <line x1={cx} y1={0} x2={cx} y2={svgH - 10} stroke={T.red} strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
            <text x={cx + 3} y={10} fontSize={9} fill={T.red} opacity={0.7} fontFamily="DM Sans,sans-serif">40h cap</text>
          </g>
        );
      })()}
    </svg>
  );
}

// Monthly trend line chart (SVG)
function LineChart({ months, values, color = T.accent, height = 80, width = 320 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - (v / max) * (height - 12) - 6;
    return [x, y];
  });
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]},${p[1]}`).join(' ');
  const fill = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]},${p[1]}`).join(' ')
    + ` L ${pts[pts.length-1][0]},${height} L ${pts[0][0]},${height} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#lg)" />
      <path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={3} fill={color} />
          <text x={x} y={height - 1} textAnchor="middle" fontSize={8} fill={T.textMuted} fontFamily="DM Sans,sans-serif">
            {months[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

// Donut chart
function Donut({ used, balance, size = 100 }) {
  const total = Math.max(used + balance, 0.1);
  const r = 38, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  const usedPct  = used    / total;
  const balPct   = balance / total;
  const usedDash = usedPct  * circ;
  const balDash  = balPct   * circ;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {/* track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={14} />
      {/* balance arc */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.accent} strokeWidth={14}
        strokeDasharray={`${balDash} ${circ - balDash}`}
        strokeDashoffset={circ * 0.25} strokeLinecap="round" />
      {/* used arc */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.amber} strokeWidth={14}
        strokeDasharray={`${usedDash} ${circ - usedDash}`}
        strokeDashoffset={circ * 0.25 - balDash} strokeLinecap="round" opacity={0.7} />
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize={14} fontWeight={800} fill={T.textPri} fontFamily="DM Mono,monospace">{balance}h</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize={8} fill={T.textMuted} fontFamily="DM Sans,sans-serif">balance</text>
    </svg>
  );
}

function EmptyState({ icon, msg, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 20px', color: T.textMuted }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.textSec }}>{msg}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function TOIL({ users, timesheets, toil, setToil, currentUser, isManager }) {
  const safeTimesheets = useMemo(() => {
    if (!timesheets || typeof timesheets !== 'object' || Array.isArray(timesheets)) return {};
    return timesheets;
  }, [timesheets]);

  const safeToil = useMemo(() =>
    Array.isArray(toil) ? toil : Object.values(toil || {}),
    [toil]
  );

  const [showModal,    setShowModal]    = useState(false);
  const [showReject,   setShowReject]   = useState(null); // entry id
  const [rejectReason, setRejectReason] = useState('');
  const [editId,       setEditId]       = useState(null);
  const [form,         setForm]         = useState({ userId: currentUser, hours: '', reason: '', date: '', type: 'Used', note: '' });
  const [activeTab,    setActiveTab]    = useState('overview');
  const [filterUser,   setFilterUser]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType,   setFilterType]   = useState('all');
  const [historySort,  setHistorySort]  = useState('date_desc');
  const [expandCard,   setExpandCard]   = useState(null); // userId

  const visibleUsers = isManager ? users : users.filter(u => u.id === currentUser);

  const pendingRequests = safeToil.filter(t => t.status === 'pending');
  const myRequests      = safeToil.filter(t => t.userId === currentUser);

  // ── Pre-compute all balances ────────────────────────────────────────────────
  const allBalances = useMemo(() =>
    visibleUsers.map(u => ({ u, b: calcTOILBalance(safeTimesheets[u.id], safeToil, u.id) })),
    [visibleUsers, safeTimesheets, safeToil]
  );

  // ── Summary stats (manager dashboard) ──────────────────────────────────────
  const summaryStats = useMemo(() => {
    if (!isManager) return null;
    const totalBalance  = allBalances.reduce((s, { b }) => s + b.balance, 0);
    const totalAccrued  = allBalances.reduce((s, { b }) => s + b.totalAccrued, 0);
    const totalUsed     = allBalances.reduce((s, { b }) => s + b.used, 0);
    const atCap         = allBalances.filter(({ b }) => b.balance >= TOIL_MAX_CARRYOVER).length;
    const zeroBalance   = allBalances.filter(({ b }) => b.balance === 0).length;
    return { totalBalance, totalAccrued, totalUsed, atCap, zeroBalance };
  }, [allBalances, isManager]);

  // ── Month-by-month usage for analytics (last 6 months) ─────────────────────
  const monthlyTrend = useMemo(() => {
    const now   = new Date();
    const months = [];
    const accrued = [], used = [];
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push(d.toLocaleDateString('en-GB', { month: 'short' }));
      accrued.push(
        safeToil.filter(t => t.status === 'approved' && t.type === 'Accrued' && (t.date || '').startsWith(key))
          .reduce((s, t) => s + (+t.hours || 0), 0)
      );
      used.push(
        safeToil.filter(t => t.status === 'approved' && t.type === 'Used' && (t.date || '').startsWith(key))
          .reduce((s, t) => s + (+t.hours || 0), 0)
      );
    }
    return { months, accrued, used };
  }, [safeToil]);

  // ── Per-engineer bar chart data ─────────────────────────────────────────────
  const barChartData = useMemo(() =>
    allBalances.map(({ u, b }) => ({
      label: u.name.split(' ')[0],
      accrued: b.totalAccrued,
      used: b.used,
      balance: b.balance,
    })),
    [allBalances]
  );

  // ── WTR compliance: % of team with balance > 0 ─────────────────────────────
  const wtrCompliance = useMemo(() => {
    if (!isManager || allBalances.length === 0) return null;
    const withBalance = allBalances.filter(({ b }) => b.balance > 0).length;
    return Math.round((withBalance / allBalances.length) * 100);
  }, [allBalances, isManager]);

  // ── Modal helpers ───────────────────────────────────────────────────────────
  const openBook = useCallback(() => {
    setForm({ userId: currentUser, hours: '', reason: '', date: '', type: 'Used', note: '' });
    setEditId(null);
    setShowModal(true);
  }, [currentUser]);

  const openManual = useCallback((prefill = {}) => {
    setForm({ userId: prefill.userId || currentUser, hours: prefill.hours || '', reason: prefill.reason || '', date: prefill.date || '', type: prefill.type || 'Accrued', note: prefill.note || '' });
    setEditId(prefill.id || null);
    setShowModal(true);
  }, [currentUser]);

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const save = useCallback(() => {
    if (!form.hours || !form.date) return;
    const entry = {
      id:          editId || 't' + Date.now(),
      userId:      form.userId,
      type:        form.type,
      hours:       +form.hours,
      date:        form.date,
      reason:      form.reason,
      note:        form.note,
      status:      isManager ? 'approved' : 'pending',
      requestedAt: new Date().toISOString(),
      requestedBy: currentUser,
    };
    setToil(editId ? safeToil.map(t => t.id === editId ? { ...t, ...entry } : t) : [...safeToil, entry]);
    setShowModal(false);
  }, [form, editId, isManager, currentUser, safeToil, setToil]);

  const approve = useCallback(id =>
    setToil(safeToil.map(t => t.id === id ? { ...t, status: 'approved', approvedBy: currentUser, approvedAt: new Date().toISOString() } : t)),
    [safeToil, setToil, currentUser]
  );

  const reject = useCallback((id, reason = '') => {
    setToil(safeToil.map(t => t.id === id ? { ...t, status: 'rejected', rejectedBy: currentUser, rejectedAt: new Date().toISOString(), rejectReason: reason } : t));
    setShowReject(null);
    setRejectReason('');
  }, [safeToil, setToil, currentUser]);

  const deleteEntry = useCallback(id => {
    if (window.confirm('Delete this TOIL entry?')) setToil(safeToil.filter(t => t.id !== id));
  }, [safeToil, setToil]);

  const fmtDate = ds => ds ? new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  // ── History filter + sort ────────────────────────────────────────────────────
  const filteredHistory = useMemo(() => {
    let rows = safeToil
      .filter(t => isManager || t.userId === currentUser)
      .filter(t => filterUser   === 'all' || t.userId   === filterUser)
      .filter(t => filterStatus === 'all' || t.status   === filterStatus)
      .filter(t => filterType   === 'all' || t.type     === filterType);
    switch (historySort) {
      case 'date_asc':  rows = rows.slice().sort((a,b) => (a.date||'').localeCompare(b.date||'')); break;
      case 'date_desc': rows = rows.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')); break;
      case 'hours_desc':rows = rows.slice().sort((a,b) => (+b.hours||0) - (+a.hours||0)); break;
      default: break;
    }
    return rows;
  }, [safeToil, isManager, currentUser, filterUser, filterStatus, filterType, historySort]);

  const tabs = [
    { id: 'overview',  label: 'Overview' },
    { id: 'requests',  label: `Requests${pendingRequests.length > 0 ? ` · ${pendingRequests.length}` : ''}`, badge: pendingRequests.length > 0 },
    { id: 'history',   label: 'History' },
    { id: 'analytics', label: 'Analytics' },
  ];

  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: T.textPri }}>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: T.accentDim, border: `1px solid ${T.accentBrd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⏳</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' }}>TOIL Manager</h1>
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>UK WTR 1998 · 1:1 accrual · {TOIL_MAX_CARRYOVER}h cap</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isManager && (
            <button onClick={() => openManual()}
              style={{ padding: '8px 16px', background: T.bgCard2, border: `1px solid ${T.borderHi}`, borderRadius: 9, color: T.textSec, fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>＋</span> Manual Entry
            </button>
          )}
          <button onClick={openBook}
            style={{ padding: '9px 20px', background: T.accent, color: '#000', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: `0 0 18px rgba(0,194,255,0.3)`, display: 'flex', alignItems: 'center', gap: 6 }}>
            📅 Book TOIL
          </button>
        </div>
      </div>

      {/* ── Manager summary strip ───────────────────────────────────────────── */}
      {isManager && summaryStats && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <StatChip label="Team Balance"  value={`${summaryStats.totalBalance}h`}  color={T.accent} sub={`${allBalances.length} engineers`} />
          <StatChip label="Total Accrued" value={`${summaryStats.totalAccrued}h`}  color={T.green} />
          <StatChip label="Total Used"    value={`${summaryStats.totalUsed}h`}     color={T.amber} />
          <StatChip label="At Cap"        value={summaryStats.atCap}               color={summaryStats.atCap > 0 ? T.amber : T.textMuted} sub="need to use TOIL" />
          <StatChip label="Pending"       value={pendingRequests.length}           color={pendingRequests.length > 0 ? T.purple : T.textMuted} sub="awaiting approval" />
        </div>
      )}

      {/* ── WTR info bar ────────────────────────────────────────────────────── */}
      <div style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: 9, padding: '9px 14px', fontSize: 12, color: '#93c5fd', marginBottom: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span>🇬🇧</span>
        <span>
          <strong>UK WTR 1998:</strong> TOIL accrues at <strong>1:1</strong> for hours <em>actively worked</em> during on-call.
          Standby-only hours do not accrue TOIL. Maximum carryover is <strong>{TOIL_MAX_CARRYOVER}h (5 days)</strong>.
        </span>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 22, borderBottom: `1px solid ${T.border}`, paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '9px 18px 10px', borderRadius: '8px 8px 0 0', cursor: 'pointer',
            fontSize: 13, fontWeight: 700, background: 'transparent', border: 'none',
            borderBottom: activeTab === t.id ? `2px solid ${T.accent}` : '2px solid transparent',
            color: activeTab === t.id ? T.accent : T.textSec,
            transition: 'all 0.15s', position: 'relative',
          }}>
            {t.label}
            {t.badge && (
              <span style={{ position: 'absolute', top: 5, right: 4, width: 7, height: 7, borderRadius: '50%', background: T.amber }} />
            )}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: OVERVIEW                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {allBalances.map(({ u, b }) => {
            const pct    = TOIL_MAX_CARRYOVER > 0 ? (b.balance / TOIL_MAX_CARRYOVER) * 100 : 0;
            const color  = balanceColor(b.balance);
            const myPend = safeToil.filter(t => t.userId === u.id && t.status === 'pending').length;
            const isExpanded = expandCard === u.id;

            return (
              <div key={u.id} style={{ background: T.bgCard, border: `1px solid ${color}20`, borderRadius: 14, overflow: 'hidden', transition: 'box-shadow 0.2s' }}>
                {/* Card header */}
                <div style={{ padding: '16px 18px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar user={u} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{u.id}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {myPend > 0 && <Tag label={`${myPend} pending`} type="amber" />}
                    {b.balance >= TOIL_MAX_CARRYOVER && <Tag label="At cap" type="amber" />}
                  </div>
                </div>

                {/* Main stats */}
                <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <Donut used={b.used} balance={b.balance} size={80} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Balance vs cap</div>
                    <ProgressBar pct={pct} color={color} height={7} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, fontFamily: T.mono }}>
                      <span style={{ color }}>{b.balance}h</span>
                      <span style={{ color: T.textMuted }}>{TOIL_MAX_CARRYOVER}h cap</span>
                    </div>
                  </div>
                </div>

                {/* Stat row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0, borderTop: `1px solid ${T.border}` }}>
                  {[
                    { l: 'Auto (1:1)', v: `${b.autoToil}h`, c: T.accent },
                    { l: 'Manual',     v: `${b.manualAccrued}h`, c: '#93c5fd' },
                    { l: 'Used',       v: `${b.used}h`, c: T.amber },
                  ].map((s, i) => (
                    <div key={s.l} style={{ padding: '10px 0', textAlign: 'center', borderRight: i < 2 ? `1px solid ${T.border}` : 'none' }}>
                      <div style={{ fontSize: 9, color: T.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{s.l}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: s.c, fontFamily: T.mono }}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* Expand toggle */}
                <button onClick={() => setExpandCard(isExpanded ? null : u.id)}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderTop: `1px solid ${T.border}`, padding: '7px', cursor: 'pointer', color: T.textMuted, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  {isExpanded ? '▲ Less' : '▼ Details'}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ padding: '10px 18px 14px', borderTop: `1px solid ${T.border}`, background: 'rgba(0,0,0,0.15)' }}>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>Accrual breakdown</div>
                    <div style={{ fontSize: 12, color: T.textSec, marginBottom: 4, fontFamily: T.mono }}>
                      {b.workedOC}h worked on-call → {b.autoToil}h TOIL (1:1)
                    </div>
                    <div style={{ fontSize: 12, color: T.textSec, marginBottom: 10, fontFamily: T.mono }}>
                      {b.manualAccrued}h manually added by manager
                    </div>
                    {b.balance >= TOIL_MAX_CARRYOVER && (
                      <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: T.amber, marginBottom: 8 }}>
                        ⚠ At WTR carryover cap — TOIL should be used before year end
                      </div>
                    )}
                    {isManager && (
                      <button onClick={() => openManual({ userId: u.id })}
                        style={{ width: '100%', padding: '6px 0', background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 7, color: T.textSec, fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
                        + Add Entry for {u.name.split(' ')[0]}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: REQUESTS                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'requests' && (
        <div>
          {/* Engineer: my requests */}
          {!isManager && (
            <>
              {myRequests.length === 0
                ? <EmptyState icon="📭" msg="No requests yet" sub="Use the Book TOIL button to submit a request." />
                : myRequests.map(t => (
                    <RequestCard key={t.id} entry={t} users={users} isManager={false}
                      onDelete={() => deleteEntry(t.id)} fmtDate={fmtDate} />
                  ))
              }
            </>
          )}

          {/* Manager: pending */}
          {isManager && (
            <>
              {pendingRequests.length === 0
                ? <EmptyState icon="✅" msg="All clear" sub="No TOIL requests awaiting approval." />
                : (
                  <>
                    <div style={{ fontSize: 13, color: T.textSec, marginBottom: 14, fontWeight: 600 }}>
                      {pendingRequests.length} request{pendingRequests.length !== 1 ? 's' : ''} awaiting approval
                    </div>
                    {pendingRequests.map(t => (
                      <RequestCard key={t.id} entry={t} users={users} isManager={true}
                        onApprove={() => approve(t.id)}
                        onReject={() => { setShowReject(t.id); setRejectReason(''); }}
                        onDelete={() => deleteEntry(t.id)}
                        fmtDate={fmtDate} />
                    ))}
                  </>
                )
              }
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: HISTORY                                                         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'history' && (
        <div>
          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px' }}>
            {isManager && (
              <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{ ...IS, width: 160, padding: '6px 10px', fontSize: 12 }}>
                <option value="all">All Engineers</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...IS, width: 140, padding: '6px 10px', fontSize: 12 }}>
              <option value="all">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...IS, width: 140, padding: '6px 10px', fontSize: 12 }}>
              <option value="all">All Types</option>
              <option value="Accrued">Accrued</option>
              <option value="Used">Used</option>
            </select>
            <select value={historySort} onChange={e => setHistorySort(e.target.value)} style={{ ...IS, width: 160, padding: '6px 10px', fontSize: 12 }}>
              <option value="date_desc">Date (newest)</option>
              <option value="date_asc">Date (oldest)</option>
              <option value="hours_desc">Hours (most)</option>
            </select>
            <div style={{ marginLeft: 'auto', fontSize: 12, color: T.textMuted, fontFamily: T.mono }}>
              {filteredHistory.length} entries
            </div>
          </div>

          {filteredHistory.length === 0
            ? <EmptyState icon="🗂" msg="No entries match filters" />
            : (
              <div style={{ overflowX: 'auto', borderRadius: 10, border: `1px solid ${T.border}` }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                      {['Engineer', 'Date', 'Type', 'Hours', 'Status', 'Reason', 'Approved By', ''].map(h => (
                        <th key={h} style={{ padding: '9px 12px', borderBottom: `1px solid ${T.border}`, fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map(t => {
                      const u        = users.find(x => x.id === t.userId);
                      const approver = users.find(x => x.id === (t.approvedBy || t.rejectedBy));
                      return (
                        <tr key={t.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                          <td style={{ padding: '9px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              <Avatar user={u} size={22} />
                              <span style={{ fontSize: 12 }}>{u?.name || t.userId}</span>
                            </div>
                          </td>
                          <td style={{ padding: '9px 12px', fontFamily: T.mono, fontSize: 11, color: T.textSec, whiteSpace: 'nowrap' }}>{fmtDate(t.date)}</td>
                          <td style={{ padding: '9px 12px' }}><Tag label={t.type} type={t.type === 'Accrued' ? 'cyan' : 'amber'} /></td>
                          <td style={{ padding: '9px 12px', fontFamily: T.mono, fontSize: 13, color: T.accent, fontWeight: 800 }}>{t.hours}h</td>
                          <td style={{ padding: '9px 12px' }}>
                            <Tag label={t.status === 'approved' ? '✓ Approved' : t.status === 'rejected' ? '✗ Rejected' : '⏳ Pending'}
                              type={t.status === 'approved' ? 'green' : t.status === 'rejected' ? 'red' : 'amber'} />
                          </td>
                          <td style={{ padding: '9px 12px', fontSize: 11, color: T.textMuted, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.reason || t.note || '—'}</td>
                          <td style={{ padding: '9px 12px', fontSize: 11, color: T.textMuted }}>
                            {approver?.name || t.approvedBy || '—'}
                            {t.rejectReason && <div style={{ fontSize: 10, color: T.red }}>{t.rejectReason}</div>}
                          </td>
                          <td style={{ padding: '9px 12px' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {isManager && (
                                <button onClick={() => openManual(t)}
                                  style={{ padding: '3px 8px', background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 5, color: T.textSec, fontSize: 11, cursor: 'pointer' }}>✏</button>
                              )}
                              {(isManager || t.userId === currentUser) && (
                                <button onClick={() => deleteEntry(t.id)}
                                  style={{ padding: '3px 8px', background: 'rgba(239,68,68,0.07)', border: `1px solid rgba(239,68,68,0.18)`, borderRadius: 5, color: T.red, fontSize: 11, cursor: 'pointer' }}>🗑</button>
                              )}
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

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: ANALYTICS (Power BI style)                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'analytics' && (
        <div>

          {/* ── KPI strip ─────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 20 }}>
            {[
              {
                label: 'Total TOIL Accrued',
                value: `${allBalances.reduce((s, { b }) => s + b.totalAccrued, 0).toFixed(1)}h`,
                color: T.accent,
                sub: 'all time',
                spark: allBalances.map(({ b }) => b.totalAccrued),
              },
              {
                label: 'Total Used',
                value: `${allBalances.reduce((s, { b }) => s + b.used, 0).toFixed(1)}h`,
                color: T.amber,
                sub: 'all time',
                spark: allBalances.map(({ b }) => b.used),
              },
              {
                label: 'Outstanding Balance',
                value: `${allBalances.reduce((s, { b }) => s + b.balance, 0).toFixed(1)}h`,
                color: T.green,
                sub: `across ${allBalances.length} engineers`,
                spark: allBalances.map(({ b }) => b.balance),
              },
              {
                label: 'Avg Balance / Eng',
                value: allBalances.length > 0
                  ? `${(allBalances.reduce((s, { b }) => s + b.balance, 0) / allBalances.length).toFixed(1)}h`
                  : '—',
                color: '#93c5fd',
                sub: 'mean',
                spark: null,
              },
              {
                label: 'WTR Utilisation',
                value: wtrCompliance != null ? `${wtrCompliance}%` : '—',
                color: wtrCompliance >= 80 ? T.green : wtrCompliance >= 50 ? T.amber : T.red,
                sub: 'engineers with balance > 0',
                spark: null,
              },
              {
                label: 'Pending Requests',
                value: pendingRequests.length,
                color: pendingRequests.length > 0 ? T.purple : T.textMuted,
                sub: 'awaiting approval',
                spark: null,
              },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{kpi.label}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: kpi.color, fontFamily: T.mono, letterSpacing: '-1px' }}>{kpi.value}</div>
                <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>{kpi.sub}</div>
                {kpi.spark && <div style={{ marginTop: 8 }}><MiniBar values={kpi.spark} color={kpi.color} /></div>}
              </div>
            ))}
          </div>

          {/* ── 2-col charts ─────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginBottom: 16 }}>

            {/* Balance by engineer — horizontal bars */}
            <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>TOIL by Engineer</div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 14 }}>Accrued vs used hours</div>
              <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: T.textSec }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: T.accent }} /> Accrued
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: T.textSec }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: T.amber }} /> Used
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: T.textSec }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: T.red, opacity: 0.6 }} /> 40h cap
                </div>
              </div>
              <HBarChart data={barChartData} />
            </div>

            {/* Monthly trend */}
            <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Monthly Trend</div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 14 }}>Manual accrual entries over last 6 months</div>
              <div style={{ fontSize: 11, color: T.accent, marginBottom: 8 }}>Accrued</div>
              <LineChart months={monthlyTrend.months} values={monthlyTrend.accrued} color={T.accent} />
              <div style={{ fontSize: 11, color: T.amber, marginTop: 14, marginBottom: 8 }}>Used</div>
              <LineChart months={monthlyTrend.months} values={monthlyTrend.used} color={T.amber} />
            </div>

          </div>

          {/* ── Balance distribution + WTR compliance ─────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginBottom: 16 }}>

            {/* Per-engineer balance progress bars */}
            <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Balance Distribution</div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 16 }}>Each engineer vs 40h cap</div>
              {allBalances.length === 0
                ? <EmptyState icon="📊" msg="No data" />
                : allBalances
                    .slice().sort((a, b) => b.b.balance - a.b.balance)
                    .map(({ u, b }) => {
                      const color = balanceColor(b.balance);
                      const pct   = (b.balance / TOIL_MAX_CARRYOVER) * 100;
                      return (
                        <div key={u.id} style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                              <Avatar user={u} size={18} />
                              <span style={{ fontSize: 12, color: T.textSec }}>{u.name.split(' ')[0]}</span>
                            </div>
                            <span style={{ fontSize: 11, fontFamily: T.mono, color, fontWeight: 700 }}>{b.balance}h</span>
                          </div>
                          <ProgressBar pct={pct} color={color} height={6} />
                        </div>
                      );
                    })
              }
            </div>

            {/* WTR compliance + cap warnings */}
            <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>WTR Compliance</div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 16 }}>Warnings & status per engineer</div>

              {/* Big gauge */}
              {wtrCompliance != null && (
                <div style={{ textAlign: 'center', marginBottom: 18 }}>
                  <div style={{ fontSize: 48, fontWeight: 900, fontFamily: T.mono, color: wtrCompliance >= 80 ? T.green : wtrCompliance >= 50 ? T.amber : T.red, letterSpacing: '-2px' }}>
                    {wtrCompliance}%
                  </div>
                  <div style={{ fontSize: 12, color: T.textMuted }}>engineers with active TOIL balance</div>
                  <ProgressBar pct={wtrCompliance} color={wtrCompliance >= 80 ? T.green : T.amber} height={8} />
                </div>
              )}

              {/* Compliance table */}
              {allBalances.map(({ u, b }) => {
                const atCap    = b.balance >= TOIL_MAX_CARRYOVER;
                const noneEver = b.totalAccrued === 0;
                const status   = atCap ? { label: 'At Cap', color: T.amber } : noneEver ? { label: 'No Accrual', color: T.textMuted } : { label: 'OK', color: T.green };
                return (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
                    <Avatar user={u} size={20} />
                    <span style={{ fontSize: 12, flex: 1, color: T.textSec }}>{u.name}</span>
                    <span style={{ fontSize: 10, color: status.color, fontWeight: 700, background: `${status.color}18`, padding: '2px 8px', borderRadius: 4 }}>{status.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Detailed data table ────────────────────────────────────────── */}
          <div style={{ background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Engineer Detail Table</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 14 }}>Full TOIL breakdown per engineer</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    {['Engineer', 'Worked OC', 'Auto TOIL', 'Manual', 'Total Accrued', 'Used', 'Balance', 'Cap %', 'Status'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', borderBottom: `1px solid ${T.border}`, fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: h === 'Engineer' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allBalances.map(({ u, b }) => {
                    const pct    = Math.round((b.balance / TOIL_MAX_CARRYOVER) * 100);
                    const color  = balanceColor(b.balance);
                    const status = b.balance >= TOIL_MAX_CARRYOVER ? { l: 'At Cap', c: T.amber } : b.balance === 0 ? { l: 'Empty', c: T.textMuted } : { l: 'Active', c: T.green };
                    return (
                      <tr key={u.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Avatar user={u} size={24} />
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700 }}>{u.name}</div>
                              <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{u.id}</div>
                            </div>
                          </div>
                        </td>
                        {[b.workedOC, b.autoToil, b.manualAccrued, b.totalAccrued, b.used].map((v, i) => (
                          <td key={i} style={{ padding: '9px 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 12, color: T.textSec }}>{v}h</td>
                        ))}
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 13, color, fontWeight: 800 }}>{b.balance}h</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                            <div style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 2 }} />
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

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* REJECT MODAL                                                         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {showReject && (
        <Modal title="Reject Request" subtitle="Provide a reason for the engineer." onClose={() => setShowReject(null)}>
          <Field label="Reason (optional)">
            <input
              autoFocus
              type="text"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && reject(showReject, rejectReason)}
              placeholder="e.g. Insufficient cover on that date"
              style={IS}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => setShowReject(null)}
              style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8, color: T.textSec, cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={() => reject(showReject, rejectReason)}
              style={{ padding: '8px 22px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: T.red, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ✗ Reject
            </button>
          </div>
        </Modal>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* BOOKING / MANUAL ENTRY MODAL                                         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <Modal
          title={editId ? 'Edit TOIL Entry' : isManager ? 'Add TOIL Entry' : 'Book TOIL'}
          subtitle={!isManager ? 'Your request will be sent to the manager for approval.' : undefined}
          onClose={() => setShowModal(false)}>

          {isManager && (
            <Field label="Engineer">
              <select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })} style={IS}>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
              </select>
            </Field>
          )}

          <Field label="Type">
            <div style={{ display: 'flex', gap: 8 }}>
              {(isManager ? ['Accrued', 'Used'] : ['Used']).map(v => (
                <div key={v} onClick={() => setForm({ ...form, type: v })}
                  style={{
                    flex: 1, padding: '9px 0', textAlign: 'center', borderRadius: 8, cursor: 'pointer',
                    fontSize: 13, fontWeight: 700,
                    background: form.type === v ? T.accentDim : T.bgCard,
                    border: `1.5px solid ${form.type === v ? T.accentBrd : T.border}`,
                    color: form.type === v ? T.accent : T.textMuted,
                    transition: 'all 0.15s',
                  }}>
                  {v === 'Used' ? '📅 Use TOIL' : '⬆ Accrue'}
                </div>
              ))}
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Date">
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={IS} />
            </Field>
            <Field label="Hours">
              <input type="number" min="0.5" step="0.5" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} style={IS} />
            </Field>
          </div>

          <Field label="Reason">
            <input type="text" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. Weekend on-call, extended incident response…" style={IS} />
          </Field>

          {/* Live balance preview */}
          {form.type === 'Used' && form.hours && (() => {
            const uid = form.userId || currentUser;
            const cur = calcTOILBalance(safeTimesheets[uid], safeToil, uid);
            const after = Math.max(cur.balance - (+form.hours || 0), 0);
            return (
              <div style={{ background: 'rgba(0,194,255,0.07)', border: `1px solid ${T.accentBrd}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#93c5fd', marginBottom: 4 }}>
                Current balance: <strong>{cur.balance}h</strong> → after booking: <strong style={{ color: T.accent }}>{Math.round(after * 10) / 10}h</strong>
              </div>
            );
          })()}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={() => setShowModal(false)}
              style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 8, color: T.textSec, cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={save} disabled={!form.hours || !form.date}
              style={{ padding: '8px 22px', background: T.accent, color: '#000', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: (!form.hours || !form.date) ? 0.45 : 1 }}>
              {editId ? 'Save Changes' : isManager ? 'Add Entry' : 'Submit Request'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Request card ──────────────────────────────────────────────────────────────
function RequestCard({ entry, users, isManager, onApprove, onReject, onDelete, fmtDate }) {
  const u = users.find(x => x.id === entry.userId);
  const statusColor = entry.status === 'approved' ? T.green : entry.status === 'rejected' ? T.red : T.amber;
  return (
    <div style={{ background: T.bgCard, border: `1px solid ${statusColor}25`, borderRadius: 12, padding: '16px 20px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar user={u} size={34} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{u?.name || entry.userId}</div>
            <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
              {entry.type} · {entry.hours}h · {fmtDate(entry.date)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ background: `${statusColor}18`, color: statusColor, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: `1px solid ${statusColor}35` }}>
            {entry.status === 'approved' ? '✓ Approved' : entry.status === 'rejected' ? '✗ Rejected' : '⏳ Pending'}
          </span>
          {isManager && entry.status === 'pending' && (
            <>
              <button onClick={onApprove} style={{ padding: '5px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 7, color: T.green, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ Approve</button>
              <button onClick={onReject}  style={{ padding: '5px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, color: T.red,   fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✗ Reject</button>
            </>
          )}
          {(isManager || entry.status === 'pending') && (
            <button onClick={onDelete} style={{ padding: '5px 10px', background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 7, color: T.textMuted, fontSize: 12, cursor: 'pointer' }}>🗑</button>
          )}
        </div>
      </div>
      {(entry.reason || entry.note) && (
        <div style={{ marginTop: 10, fontSize: 12, color: T.textMuted, fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', borderRadius: 6, padding: '6px 10px' }}>
          "{entry.reason || entry.note}"
        </div>
      )}
      {entry.rejectReason && (
        <div style={{ marginTop: 6, fontSize: 11, color: T.red, fontWeight: 600 }}>Rejection reason: {entry.rejectReason}</div>
      )}
    </div>
  );
}
