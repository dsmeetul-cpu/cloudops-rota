// src/OnCall.js
// CloudOps Rota — Who's On Call Component
// Meetul Bhundia (MBA47) · Cloud Run Operations · 09th May 2026

import React, { useState } from 'react';
import { generateICalFeed, downloadIcal } from './hooks/useGoogleDrive';
import { UK_BANK_HOLIDAYS } from './utils/defaults';

// ── Shift colour map (mirrors App.js) ─────────────────────────────────────
const SHIFT_COLORS = {
  daily:       { bg: '#1e40af', label: 'Daily Shift',     text: '#bfdbfe' },
  evening:     { bg: '#166534', label: 'Weekday On-Call', text: '#bbf7d0' },
  weekend:     { bg: '#854d0e', label: 'Weekend On-Call', text: '#fef08a' },
  upgrade:     { bg: '#991b1b', label: 'Upgrade Day',     text: '#fecaca' },
  holiday:     { bg: '#92400e', label: 'Holiday',         text: '#fde68a' },
  bankholiday: { bg: '#7f1d1d', label: 'Bank Holiday',    text: '#fca5a5' },
};

// ── Shared UI primitives ───────────────────────────────────────────────────
function Avatar({ user, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size > 40 ? 12 : 8,
      background: user?.color || '#1d4ed8', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size > 40 ? 14 : 11,
      fontWeight: 700, color: '#fff', flexShrink: 0, letterSpacing: 0.5,
    }}>{user?.avatar || '?'}</div>
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

function ShiftLegend() {
  return (
    <div className="shift-legend">
      <div className="legend-item"><div className="legend-dot" style={{ background: '#1e40af' }} />Daily Shift (9am–6pm)</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#166534' }} />Weekday On-Call</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#854d0e' }} />Weekend On-Call</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#991b1b' }} />Upgrade Day</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#92400e' }} />Holiday</div>
      <div className="legend-item"><div className="legend-dot" style={{ background: '#7f1d1d' }} />Bank Holiday</div>
    </div>
  );
}

// ── Who's On Call ──────────────────────────────────────────────────────────
export default function OnCall({ users, rota }) {
  const today = new Date();
  const [viewMode,   setViewMode]   = useState('week'); // 'week' | 'month' | 'year'
  const [viewOffset, setViewOffset] = useState(0);      // weeks or months offset

  const DAYS   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const exportIcal = (user) => {
    const content = generateICalFeed(rota[user.id] || {}, user.name);
    downloadIcal(content, `cloudops-rota-${user.id}.ics`);
  };

  const cellStyle = (s) => {
    const c = SHIFT_COLORS[s];
    if (!c) return { background: 'transparent', color: 'var(--text-muted)' };
    return { background: c.bg + '55', color: c.text, border: `1px solid ${c.bg}88` };
  };

  // Build weeks array based on viewMode
  const getWeeks = () => {
    if (viewMode === 'week') {
      const base = new Date(today);
      base.setDate(base.getDate() - ((base.getDay() + 6) % 7) + viewOffset * 7);
      return [Array.from({ length: 7 }, (_, i) => {
        const d = new Date(base); d.setDate(base.getDate() + i); return d;
      })];
    }

    if (viewMode === 'month') {
      const base       = new Date(today.getFullYear(), today.getMonth() + viewOffset, 1);
      const firstDow   = (base.getDay() + 6) % 7;
      const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      const weeksArr   = [];
      let weekDays     = [];

      for (let pre = 0; pre < firstDow; pre++) {
        const d = new Date(base); d.setDate(1 - firstDow + pre); weekDays.push(d);
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(base.getFullYear(), base.getMonth(), day);
        weekDays.push(d);
        if (weekDays.length === 7) { weeksArr.push(weekDays); weekDays = []; }
      }
      if (weekDays.length > 0) {
        while (weekDays.length < 7) {
          const last = weekDays[weekDays.length - 1];
          const d = new Date(last); d.setDate(last.getDate() + 1); weekDays.push(d);
        }
        weeksArr.push(weekDays);
      }
      return weeksArr;
    }

    // year: show all months in the offset year
    const yearWeeks = [];
    for (let m = 0; m < 12; m++) {
      const mStart     = new Date(today.getFullYear() + viewOffset, m, 1);
      const firstDow   = (mStart.getDay() + 6) % 7;
      const daysInMonth = new Date(mStart.getFullYear(), m + 1, 0).getDate();
      const monthWeeks = [];
      let wDays        = [];

      for (let pre = 0; pre < firstDow; pre++) {
        const d = new Date(mStart); d.setDate(1 - firstDow + pre); wDays.push(d);
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(mStart.getFullYear(), m, day); wDays.push(d);
        if (wDays.length === 7) { monthWeeks.push(wDays); wDays = []; }
      }
      if (wDays.length > 0) {
        while (wDays.length < 7) {
          const last = wDays[wDays.length - 1];
          const d = new Date(last); d.setDate(last.getDate() + 1); wDays.push(d);
        }
        monthWeeks.push(wDays);
      }
      yearWeeks.push({ month: m, year: mStart.getFullYear(), weeks: monthWeeks });
    }
    return yearWeeks;
  };

  const viewLabel = () => {
    if (viewMode === 'week') {
      const base = new Date(today);
      base.setDate(base.getDate() - ((base.getDay() + 6) % 7) + viewOffset * 7);
      const end = new Date(base); end.setDate(base.getDate() + 6);
      return `${base.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    if (viewMode === 'month') {
      const d = new Date(today.getFullYear(), today.getMonth() + viewOffset, 1);
      return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }
    return `${today.getFullYear() + viewOffset}`;
  };

  const renderWeekTable = (week, key) => (
    <div key={key} className="card" style={{ overflowX: 'auto', marginBottom: 12 }}>
      <table style={{ minWidth: 620 }}>
        <thead>
          <tr>
            <th>Engineer</th>
            {week.map((d, i) => {
              const ds      = d.toISOString().slice(0, 10);
              const bh      = UK_BANK_HOLIDAYS.find(b => b.date === ds);
              const isToday = ds === today.toISOString().slice(0, 10);
              return (
                <th key={i} style={{ textAlign: 'center', fontSize: 11, color: bh ? '#fca5a5' : isToday ? 'var(--accent)' : undefined }}>
                  {DAYS[i]}<br />
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10 }}>{d.getDate()}{bh ? '🔴' : ''}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar user={u} size={26} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u.id}</div>
                  </div>
                </div>
              </td>
              {week.map(d => {
                const ds      = d.toISOString().slice(0, 10);
                const s       = rota[u.id]?.[ds] || 'off';
                const c       = cellStyle(s);
                const isToday = ds === today.toISOString().slice(0, 10);
                return (
                  <td key={ds} style={{ textAlign: 'center', background: isToday ? 'rgba(59,130,246,0.08)' : undefined }}>
                    <div style={{ ...c, borderRadius: 6, padding: '4px 6px', fontSize: 10, fontWeight: 600, minWidth: 32, display: 'inline-block' }}>
                      {s === 'off' ? '—' : (SHIFT_COLORS[s]?.label?.slice(0, 4) || s)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const data = getWeeks();

  return (
    <div>
      <PageHeader title="Who's On Call" sub="Team schedule — week, month, or full year view" />
      <ShiftLegend />

      {/* View controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['week', 'month', 'year'].map(m => (
            <button key={m} className={`btn btn-sm ${viewMode === m ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setViewMode(m); setViewOffset(0); }}>
              {m === 'week' ? 'Week' : m === 'month' ? 'Month' : 'Full Year'}
            </button>
          ))}
        </div>
        {viewMode !== 'year' && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(o => o - 1)}>← Prev</button>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 200, textAlign: 'center' }}>{viewLabel()}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(o => o + 1)}>Next →</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(0)}>Today</button>
          </div>
        )}
        {viewMode === 'year' && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(o => o - 1)}>← {today.getFullYear() + viewOffset - 1}</button>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 80, textAlign: 'center' }}>{today.getFullYear() + viewOffset}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewOffset(o => o + 1)}>{today.getFullYear() + viewOffset + 1} →</button>
          </div>
        )}
      </div>

      {/* Render based on mode */}
      {viewMode === 'week' && renderWeekTable(data[0], 'week')}
      {viewMode === 'month' && (
        <div>
          <div className="card mb-8" style={{ padding: '8px 14px', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {viewLabel()}
          </div>
          {data.map((week, wi) => renderWeekTable(week, `week-${wi}`))}
        </div>
      )}
      {viewMode === 'year' && (
        <div>
          {data.map(({ month, year, weeks }) => (
            <div key={month} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)', marginBottom: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                📅 {MONTHS[month]} {year}
              </div>
              {weeks.map((week, wi) => renderWeekTable(week, `${month}-${wi}`))}
            </div>
          ))}
        </div>
      )}

      {/* iCal export buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {users.map(u => (
          <button key={u.id} className="ical-btn" onClick={() => exportIcal(u)}>
            📆 Export {u.name.split(' ')[0]}'s Rota (.ics)
          </button>
        ))}
      </div>
    </div>
  );
}
