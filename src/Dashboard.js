// src/Dashboard.js
// CloudOps Rota — Manager Dashboard Component
// Meetul Bhundia (MBA47) · Cloud Run Operations · 09th May 2026

import React from 'react';

// ── Shift colour map (mirrors App.js) ─────────────────────────────────────
const SHIFT_COLORS = {
  daily:       { bg: '#1e40af', label: 'Daily Shift',     text: '#bfdbfe' },
  evening:     { bg: '#166534', label: 'Weekday On-Call', text: '#bbf7d0' },
  weekend:     { bg: '#854d0e', label: 'Weekend On-Call', text: '#fef08a' },
  upgrade:     { bg: '#991b1b', label: 'Upgrade Day',     text: '#fecaca' },
  holiday:     { bg: '#92400e', label: 'Holiday',         text: '#fde68a' },
  bankholiday: { bg: '#7f1d1d', label: 'Bank Holiday',    text: '#fca5a5' },
};

// ── TOIL constants (mirrors App.js) ───────────────────────────────────────
const TOIL_MAX_CARRYOVER_HOURS = 40; // 5 days per UK WTR
const TOIL_ACCRUAL_RATE        = 1.0; // 1:1 per UK WTR

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

function Tag({ label, type = 'blue' }) {
  return <span className={`tag tag-${type}`}>{label}</span>;
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

// ── TOIL balance helper (mirrors App.js) ──────────────────────────────────
function calcTOILBalance(timesheetEntries, toilEntries, userId) {
  const workedOC   = (timesheetEntries || []).reduce((a, e) => a + (e.worked_wd || 0) + (e.worked_we || 0), 0);
  const autoToil   = workedOC * TOIL_ACCRUAL_RATE;
  const safeEntries = Array.isArray(toilEntries) ? toilEntries : Object.values(toilEntries || {});
  const manualAccrued = safeEntries.filter(t => t.userId === userId && t.type === 'Accrued').reduce((a, t) => a + t.hours, 0);
  const used        = safeEntries.filter(t => t.userId === userId && t.type === 'Used').reduce((a, t) => a + t.hours, 0);
  const total       = autoToil + manualAccrued;
  const balance     = Math.min(total - used, TOIL_MAX_CARRYOVER_HOURS);
  return { autoToil, manualAccrued, total, used, balance, workedOC, cappedAt: TOIL_MAX_CARRYOVER_HOURS };
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard({ users, rota, holidays, incidents, timesheets, swapRequests, absences, toil }) {
  const today    = new Date().toISOString().slice(0, 10);
  const onCallToday = users.filter(u => rota[u.id]?.[today] && rota[u.id][today] !== 'off');
  const openInc  = incidents.filter(i => i.status === 'Investigating');
  const totalOC  = Object.values(timesheets).flatMap(t => t).reduce((a, b) => a + (b.weekday_oncall || 0) + (b.weekend_oncall || 0), 0);
  const pendingSwaps = (swapRequests || []).filter(s => s.status === 'pending');
  const resolved = incidents.filter(i => i.status === 'Resolved').length;

  const sevCounts = { Disaster: 0, High: 0 };
  incidents.forEach(i => { if (sevCounts[i.severity] !== undefined) sevCounts[i.severity]++; });
  const sevColors = { Disaster: '#ef4444', High: '#f59e0b' };
  const sevTotal  = incidents.length || 1;

  const PieChart = ({ data, colors, size = 100 }) => {
    let cumAngle = -90;
    const cx = size / 2, cy = size / 2, r = size / 2 - 8;
    const entries = Object.entries(data).filter(([, v]) => v > 0);
    const total   = entries.reduce((s, [, v]) => s + v, 0) || 1;
    const slices  = entries.map(([k, v]) => {
      const pct        = v / total;
      const startAngle = cumAngle;
      cumAngle        += pct * 360;
      const start = { x: cx + r * Math.cos(startAngle * Math.PI / 180), y: cy + r * Math.sin(startAngle * Math.PI / 180) };
      const end   = { x: cx + r * Math.cos(cumAngle   * Math.PI / 180), y: cy + r * Math.sin(cumAngle   * Math.PI / 180) };
      const large = pct > 0.5 ? 1 : 0;
      return { key: k, d: `M${cx},${cy} L${start.x},${start.y} A${r},${r},0,${large},1,${end.x},${end.y}Z`, color: colors[k], pct, v };
    });
    if (slices.length === 0)
      return React.createElement('svg', { width: size, height: size },
        React.createElement('circle', { cx, cy, r, fill: 'rgba(255,255,255,0.05)' }));
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map(s => <path key={s.key} d={s.d} fill={s.color} opacity={0.85} />)}
      </svg>
    );
  };

  const ocByUser = users.map(u => {
    const sheets = timesheets[u.id] || [];
    const wd     = sheets.reduce((a, b) => a + (b.weekday_oncall || 0), 0);
    const we     = sheets.reduce((a, b) => a + (b.weekend_oncall || 0), 0);
    return { name: u.name.split(' ')[0], wd, we, total: wd + we, user: u };
  });
  const maxOC = Math.max(...ocByUser.map(u => u.total), 1);

  const now = new Date();
  const weekTrend = Array.from({ length: 8 }, (_, i) => {
    const wStart = new Date(now); wStart.setDate(now.getDate() - (7 - i) * 7);
    const wEnd   = new Date(wStart); wEnd.setDate(wStart.getDate() + 6);
    const ws     = wStart.toISOString().slice(0, 10);
    const we     = wEnd.toISOString().slice(0, 10);
    const count  = incidents.filter(inc => inc.date?.slice(0, 10) >= ws && inc.date?.slice(0, 10) <= we).length;
    return { label: `W-${7 - i}`, count };
  });
  const maxTrend = Math.max(...weekTrend.map(w => w.count), 1);

  const statusCounts = { Investigating: openInc.length, Resolved: resolved };
  const statusColors = { Investigating: '#ef4444', Resolved: '#10b981' };
  const recentInc    = [...incidents].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const upcomingHols = (holidays || []).filter(h => h.start >= today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 4);
  const thisMonth         = today.slice(0, 7);
  const absencesThisMonth = (absences || []).filter(a => a.start?.startsWith(thisMonth)).length;
  const disasters         = sevCounts.Disaster;

  // ── Coverage risk — next 14 days ─────────────────────────────────────────
  // Reuses the same "zero cover / single cover" idea as the Coverage Gaps
  // view in Rota Analytics, but scoped to the next two weeks and surfaced
  // right here so a manager doesn't have to go looking for it.
  const next14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const coverageRisk = next14
    .map(ds => ({ date: ds, covering: users.filter(u => rota[u.id]?.[ds] && rota[u.id][ds] !== 'off').length }))
    .filter(d => d.covering <= 1);

  // ── Load balance / burnout risk ──────────────────────────────────────────
  // Flags anyone carrying notably more OC hours than the team average, and
  // anyone currently mid-way through a long unbroken on-call stretch. Neither
  // of these is visible from the hours bar chart alone — you'd have to do
  // the comparison yourself.
  const teamAvgOC = ocByUser.reduce((a, u) => a + u.total, 0) / Math.max(ocByUser.length, 1);
  const overloaded = ocByUser.filter(u => teamAvgOC > 0 && u.total > teamAvgOC * 1.3);

  const BURNOUT_STREAK_THRESHOLD = 4; // consecutive on-call days considered worth flagging
  const currentStreak = (userId) => {
    let streak = 0;
    const d = new Date(today + 'T12:00:00');
    // walk backward from today (inclusive) while on-call
    while (rota[userId]?.[d.toISOString().slice(0,10)] && rota[userId][d.toISOString().slice(0,10)] !== 'off') {
      streak++; d.setDate(d.getDate() - 1);
    }
    // walk forward from tomorrow while on-call
    const f = new Date(today + 'T12:00:00'); f.setDate(f.getDate() + 1);
    while (rota[userId]?.[f.toISOString().slice(0,10)] && rota[userId][f.toISOString().slice(0,10)] !== 'off') {
      streak++; f.setDate(f.getDate() + 1);
    }
    return streak;
  };
  const burnoutRisk = users
    .map(u => ({ user: u, streak: currentStreak(u.id) }))
    .filter(x => x.streak >= BURNOUT_STREAK_THRESHOLD);

  // ── TOIL at risk of being lost ───────────────────────────────────────────
  const TOIL_AT_RISK_THRESHOLD = TOIL_MAX_CARRYOVER_HOURS * 0.8; // 32h of the 40h cap
  const toilAtRisk = users
    .map(u => ({ user: u, bal: calcTOILBalance(timesheets[u.id] || [], toil || [], u.id) }))
    .filter(x => x.bal.balance >= TOIL_AT_RISK_THRESHOLD);

  const attentionCount = pendingSwaps.length + coverageRisk.length + overloaded.length + burnoutRisk.length + toilAtRisk.length;

  return (
    <div>
      <PageHeader title="Manager Dashboard" sub="Cloud Run Operations · Full team visibility" />

      {/* ── Needs Your Attention ─────────────────────────────────────────────
          One place to see everything that wants a manager decision, instead
          of scanning five separate cards to piece it together. */}
      {attentionCount > 0 && (
        <div className="card mb-16" style={{ border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.06)' }}>
          <div className="card-title" style={{ color: '#fcd34d' }}>🚦 Needs Your Attention ({attentionCount})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pendingSwaps.length > 0 && (
              <div className="row-item" style={{ fontSize: 12 }}>
                🔁 <strong>{pendingSwaps.length}</strong> swap request{pendingSwaps.length !== 1 ? 's' : ''} awaiting approval
              </div>
            )}
            {coverageRisk.length > 0 && (
              <div className="row-item" style={{ fontSize: 12 }}>
                🗓 <strong>{coverageRisk.length}</strong> day{coverageRisk.length !== 1 ? 's' : ''} with zero/single cover in the next 14 days
              </div>
            )}
            {overloaded.length > 0 && (
              <div className="row-item" style={{ fontSize: 12 }}>
                ⚖️ <strong>{overloaded.map(u => u.name).join(', ')}</strong> carrying notably more on-call load than the team average
              </div>
            )}
            {burnoutRisk.length > 0 && (
              <div className="row-item" style={{ fontSize: 12 }}>
                🔥 <strong>{burnoutRisk.map(x => x.user.name).join(', ')}</strong> on an on-call stretch of {BURNOUT_STREAK_THRESHOLD}+ consecutive days
              </div>
            )}
            {toilAtRisk.length > 0 && (
              <div className="row-item" style={{ fontSize: 12 }}>
                ⏳ <strong>{toilAtRisk.map(x => x.user.name).join(', ')}</strong> near the {TOIL_MAX_CARRYOVER_HOURS}h TOIL cap — at risk of losing accrued time
              </div>
            )}
          </div>
        </div>
      )}


      <div className="grid-4 mb-16">
        <StatCard label="Team Size"      value={users.length}        sub="engineers + manager"    accent="#3b82f6" icon="👥" />
        <StatCard label="Open Incidents" value={openInc.length}      sub={`${resolved} resolved`} accent="#ef4444" icon="🚨" />
        <StatCard label="OC Hours"       value={totalOC + 'h'}       sub="All engineers total"    accent="#10b981" icon="⏱" />
        <StatCard label="Pending Swaps"  value={pendingSwaps.length} sub="Awaiting approval"      accent="#818cf8" icon="🔁" />
      </div>

      <div className="grid-4 mb-16">
        <StatCard label="Disasters"      value={disasters}           sub="Critical severity"      accent="#ef4444" icon="🔴" />
        <StatCard label="High Severity"  value={sevCounts.High}      sub="Needs attention"        accent="#f59e0b" icon="🟠" />
        <StatCard label="Absences/Month" value={absencesThisMonth}   sub={thisMonth}              accent="#f59e0b" icon="🏥" />
        <StatCard label="Incidents Total" value={incidents.length}
          sub={`${Math.round((resolved / Math.max(incidents.length, 1)) * 100)}% resolved`}
          accent="#6ee7b7" icon="📋" />
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-title">👥 Team On-Call Today</div>
          {onCallToday.length === 0 && <p className="muted-sm">No shifts today</p>}
          {onCallToday.map(u => {
            const s   = rota[u.id][today];
            const col = SHIFT_COLORS[s] || SHIFT_COLORS.daily;
            return (
              <div className="oncall-card" key={u.id}>
                <Avatar user={u} />
                <div style={{ flex: 1 }}>
                  <div className="name-sm">{u.name}</div>
                  <div className="oncall-shift">{col.label}</div>
                </div>
                <span style={{ background: col.bg + '33', color: col.text, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{col.label}</span>
              </div>
            );
          })}
        </div>

        <div className="card">
          <div className="card-title">🎯 Incident Breakdown</div>
          {incidents.length === 0 ? <p className="muted-sm">No incidents logged 🎉</p> : (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>By Severity</div>
                <PieChart data={sevCounts} colors={sevColors} size={90} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                {Object.entries(sevCounts).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: sevColors[k] }} />
                      <span style={{ fontSize: 12 }}>{k}</span>
                    </div>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: sevColors[k] }}>{v} ({((v / sevTotal) * 100).toFixed(0)}%)</div>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>By Status</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <PieChart data={statusCounts} colors={statusColors} size={50} />
                    <div>
                      <div style={{ fontSize: 11, color: '#ef4444' }}>🔴 {openInc.length} Open</div>
                      <div style={{ fontSize: 11, color: '#10b981' }}>✅ {resolved} Resolved</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-title">📊 On-Call Hours per Engineer</div>
          {ocByUser.map(u => (
            <div key={u.name} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Avatar user={u.user} size={18} />
                  <span style={{ fontSize: 12 }}>{u.name}</span>
                </div>
                <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>
                  {u.wd}h WD + {u.we}h WE = <strong style={{ color: '#6ee7b7' }}>{u.total}h</strong>
                </span>
              </div>
              <div style={{ height: 10, background: 'var(--bg-card2)', borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${(u.wd / maxOC) * 100}%`, background: '#166534', transition: 'width 0.4s' }} />
                <div style={{ width: `${(u.we / maxOC) * 100}%`, background: '#854d0e', transition: 'width 0.4s' }} />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            <span><span style={{ background: '#166534', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 4 }} />Weekday</span>
            <span><span style={{ background: '#854d0e', display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 4 }} />Weekend</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title">📈 Incident Trend — Last 8 Weeks</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 100 }}>
            {weekTrend.map(w => {
              const pct = (w.count / maxTrend) * 100;
              return (
                <div key={w.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: w.count > 0 ? '#fcd34d' : 'var(--text-muted)' }}>{w.count || ''}</div>
                  <div style={{ width: '100%', height: 70, background: 'var(--bg-card2)', borderRadius: 4, display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
                    <div style={{ width: '100%', height: `${pct}%`, background: w.count === 0 ? 'transparent' : w.count > 3 ? '#ef4444' : '#f59e0b', transition: 'height 0.4s' }} />
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center' }}>{w.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Coverage Risk + Load Balance/Burnout ─────────────────────────── */}
      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-title">🗓 Coverage Risk — Next 14 Days</div>
          {coverageRisk.length === 0 ? (
            <p className="muted-sm">✅ Every day has at least 2 people covering</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {coverageRisk.map(d => (
                <div key={d.date} className="flex-between row-item">
                  <span style={{ fontSize: 12 }}>{d.date}</span>
                  <Tag label={d.covering === 0 ? 'Zero cover' : 'Single cover'} type={d.covering === 0 ? 'red' : 'amber'} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">⚖️ Load Balance &amp; Burnout Risk</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
            Team average: <strong style={{ color: '#6ee7b7' }}>{teamAvgOC.toFixed(1)}h</strong> on-call per engineer
          </div>
          {overloaded.length === 0 && burnoutRisk.length === 0 ? (
            <p className="muted-sm">✅ Load looks balanced, no long unbroken stretches</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {overloaded.map(u => (
                <div key={u.name} className="flex-between row-item">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Avatar user={u.user} size={20} />
                    <span style={{ fontSize: 12 }}>{u.name}</span>
                  </div>
                  <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#f59e0b' }}>{u.total}h ({Math.round((u.total / Math.max(teamAvgOC,1) - 1) * 100)}% above avg)</span>
                </div>
              ))}
              {burnoutRisk.map(x => (
                <div key={x.user.id} className="flex-between row-item">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Avatar user={x.user} size={20} />
                    <span style={{ fontSize: 12 }}>{x.user.name}</span>
                  </div>
                  <Tag label={`${x.streak}d streak`} type="red" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-title">🚨 Active Incidents</div>
          {openInc.map(i => {
            const sev = { Disaster: '#ef4444', High: '#f59e0b' }[i.severity] || '#f59e0b';
            return (
              <div key={i.id} className="row-item">
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: sev, flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <div className="name-sm">{i.alert_name || i.title}</div>
                  <div className="muted-xs">
                    {i.severity} · {i.date} · {users.find(u => u.id === i.assigned_to)?.name || i.assigned_to}
                    {i.duration_hours ? ` · ${i.duration_hours}h` : ''}
                  </div>
                </div>
                <Tag label={i.severity} type={i.severity === 'Disaster' ? 'red' : 'amber'} />
              </div>
            );
          })}
          {openInc.length === 0 && <p className="muted-sm">No active incidents 🎉</p>}
        </div>

        <div className="card">
          <div className="card-title">🕐 Recent Incidents (Last 5)</div>
          <table style={{ fontSize: 12 }}>
            <thead>
              <tr><th>ID</th><th>Alert</th><th>Severity</th><th>Status</th><th>Duration</th></tr>
            </thead>
            <tbody>
              {recentInc.map(i => {
                const sev = { Disaster: '#ef4444', High: '#f59e0b' }[i.severity] || '#f59e0b';
                return (
                  <tr key={i.id}>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--accent)' }}>{i.id}</td>
                    <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.alert_name}</td>
                    <td><span style={{ background: sev + '25', color: sev, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{i.severity}</span></td>
                    <td><Tag label={i.status} type={i.status === 'Resolved' ? 'green' : 'red'} /></td>
                    <td style={{ fontFamily: 'DM Mono', color: '#fcd34d' }}>{i.duration_hours ? `${i.duration_hours}h` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-title">🌴 Upcoming Holidays</div>
          {upcomingHols.length === 0 && <p className="muted-sm">No upcoming holidays</p>}
          {upcomingHols.map(h => {
            const u    = users.find(x => x.id === h.userId);
            const days = Math.ceil((new Date(h.end) - new Date(h.start)) / 86400000) + 1;
            return (
              <div key={h.id} className="flex-between row-item">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Avatar user={u || { avatar: '?', color: '#475569' }} size={22} />
                  <div>
                    <div className="name-sm">{u?.name}</div>
                    <div className="muted-xs">{h.start} → {h.end} ({days}d)</div>
                  </div>
                </div>
                <Tag label={h.type || 'Annual Leave'} type="amber" />
              </div>
            );
          })}
        </div>

        <div className="card">
          <div className="card-title">🔁 Pending Swap Requests</div>
          {pendingSwaps.length === 0 && <p className="muted-sm">No pending swaps</p>}
          {pendingSwaps.slice(0, 4).map(s => {
            const req = users.find(u => u.id === s.requesterId);
            const tgt = users.find(u => u.id === s.targetId);
            return (
              <div key={s.id} className="row-item">
                <div style={{ flex: 1 }}>
                  <div className="name-sm">{req?.name} ↔ {tgt?.name}</div>
                  <div className="muted-xs">{s.reqDate} ↔ {s.tgtDate}</div>
                </div>
                <Tag label="Pending" type="amber" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-title">👥 Engineer Overview</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>Engineer</th><th>Role</th><th>Today's Shift</th><th>OC Hours</th>
                <th>Open Incidents</th><th>Resolved</th><th>Incident Hrs</th>
                <th>Holidays Used</th><th>TOIL Bal</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const sheets      = timesheets[u.id] || [];
                const oc          = sheets.reduce((a, b) => a + (b.weekday_oncall || 0) + (b.weekend_oncall || 0), 0);
                const liveIncIds  = new Set((incidents || []).map(i => i.id));
                const incHrs      = sheets
                  .filter(e => e.week && e.week.startsWith('INC') && liveIncIds.has(e.week.slice(4).trim()))
                  .reduce((a, e) => a + (e.weekday_oncall || 0) + (e.weekend_oncall || 0), 0);
                const userInc        = incidents.filter(i => i.assigned_to === u.id);
                const openUserInc    = userInc.filter(i => i.status === 'Investigating').length;
                const resolvedUserInc = userInc.filter(i => i.status === 'Resolved').length;
                const holDays     = (holidays || [])
                  .filter(h => h.userId === u.id && h.type === 'Annual Leave')
                  .reduce((a, h) => a + Math.ceil((new Date(h.end) - new Date(h.start)) / 86400000) + 1, 0);
                const toilBal   = calcTOILBalance(sheets, toil || [], u.id);
                const todayShift = rota[u.id]?.[today];
                const col        = todayShift ? (SHIFT_COLORS[todayShift] || {}) : null;
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Avatar user={u} size={24} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{u.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{u.id}</div>
                        </div>
                      </div>
                    </td>
                    <td><Tag label={u.role || 'Engineer'} type={u.role === 'Manager' ? 'amber' : 'blue'} /></td>
                    <td>
                      {col
                        ? <span style={{ background: col.bg + '33', color: col.text, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{col.label}</span>
                        : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Off</span>}
                    </td>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#6ee7b7' }}>{oc}h</td>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: openUserInc > 0 ? '#ef4444' : 'var(--text-muted)' }}>{openUserInc}</td>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#10b981' }}>{resolvedUserInc}</td>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: incHrs > 0 ? '#f59e0b' : 'var(--text-muted)' }}>{incHrs > 0 ? `${incHrs}h` : '—'}</td>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{holDays}/25d</td>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: toilBal.balance >= TOIL_AT_RISK_THRESHOLD ? '#fcd34d' : toilBal.balance > 0 ? '#38bdf8' : '#fca5a5' }}>
                      {toilBal.balance}h{toilBal.balance >= TOIL_AT_RISK_THRESHOLD ? ' ⚠️' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
