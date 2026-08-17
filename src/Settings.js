// src/Settings.js
// ─────────────────────────────────────────────────────────────────────────────
// Universal Settings Page — manager only.
// Controls every configurable aspect of the CloudOps application.
// Persisted to Google Drive as cloudops_settings.json
//
// Sections:
//  1. Schedule Config    — shift hours, WD/WE times, cutover dates
//  2. Pay & Rates        — standby rate, worked multiplier, pay cycle
//  3. Pay Config         — per-engineer rates (replaces standalone Pay Config page)
//  4. Access Control     — page visibility per role, manager PIN
//  5. Timekeeping        — late thresholds, grace period, clock-in reminders
//  6. Holidays           — entitlement, carry-over, approval rules
//  7. TOIL               — auto-accrual, cap, expiry
//  8. Overtime           — threshold, multiplier
//  9. Incidents          — severity levels, TOIL for callouts
// 10. Notifications      — triggers, advance times, channels
// 11. Stress Score       — weighting per shift type
// 12. Shift Reminders    — lead times
// 13. Team               — engineer list summary (read-only here, edit in Settings>Users)

import React, { useState, useCallback, useEffect } from 'react';

// ── Default schedule configs ─────────────────────────────────────────────────
export const DEFAULT_SCHEDULE_V1 = {
  id:             'v1',
  label:          'Original (pre W35)',
  effectiveFrom:  '2026-01-01',
  effectiveTo:    '2026-08-23',
  dailyStart:     '09:00',
  dailyEnd:       '18:00',
  wdStart:        '19:00',
  wdEnd:          '07:00',
  wdHoursPerNight: 12,
  wdNights:       ['Mon','Tue','Wed','Thu'],     // days with evening entry
  weStart:        '19:00',                       // Fri start
  weFriHrs:       5,
  weSatHrs:       24,
  weSunHrs:       24,
  weMonHrs:       7,
  weTotal:        60,
  bhMonHrs:       31,   // 24h BH day + 7h Tue handover
  bhFriHrs:       17,   // 07:00–24:00
  bhMidweekHrs:   22,
};

export const DEFAULT_SCHEDULE_V2 = {
  id:             'v2',
  label:          'Current (W35, 24 Aug 2026+)',
  effectiveFrom:  '2026-08-24',
  effectiveTo:    null,                          // active / no end date
  dailyStart:     '09:00',
  dailyEnd:       '18:00',
  wdStart:        '18:00',
  wdEnd:          '09:00',
  wdHoursPerNight: 15,
  wdNights:       ['Mon','Tue','Wed','Thu'],     // Thu entry covers Thu18→Fri09
  weStart:        '18:00',                       // Fri start
  weFriHrs:       6,
  weSatHrs:       24,
  weSunHrs:       24,
  weMonHrs:       9,
  weTotal:        63,
  bhMonHrs:       33,   // 24h BH day + 9h Tue handover
  bhFriHrs:       15,   // 09:00–24:00
  bhMidweekHrs:   24,
};

// ── Default settings object ──────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  schedules: [DEFAULT_SCHEDULE_V1, DEFAULT_SCHEDULE_V2],

  pay: {
    standbyRate:       5,      // £/hr pay code 1164
    workedMultiplier:  1.5,    // × hourly rate pay code 2011
    cycleStartDay:     10,     // 10th of each month
  },

  timekeeping: {
    lateThresholdMins:  10,    // mins past shift start before "late" fires
    gracePeriodMins:    5,     // soft grace before notification
    reminderMins60:     true,  // 60-min shift-start reminder
    reminderMins10:     true,  // 10-min late warning
  },

  holidays: {
    annualEntitlement:  25,    // days
    carryOverDays:      5,
    requiresApproval:   true,
    blackoutDates:      [],    // ISO date strings — dates when holiday cannot be taken
  },

  toil: {
    autoAccrual:        true,  // accrue 1h TOIL per 1h incident/upgrade worked
    maxBalanceDays:     10,
    expiryMonths:       12,    // TOIL expires after this many months
    bhAutoToil:         false, // BH standby generates TOIL automatically?
  },

  overtime: {
    weeklyThresholdHrs: 40,
    multiplier:         1.5,
  },

  incidents: {
    severities:         ['Critical','High','Medium','Low'],
    toilForCallout:     true,  // worked incident hours accrue TOIL
    escalationMins:     15,    // mins before auto-escalate
  },

  notifications: {
    rotaReminderHrs:    24,    // hours before shift
    shiftSoonMins:      60,    // mins before shift → "starting soon"
    lateWarningMins:    10,    // mins past start → "you haven't clocked in"
    enableToastOS:      true,  // Windows/OS notifications
    enableInApp:        true,  // in-app banner queue
    triggers: {
      upgradeReminder:  true,
      incidentOpen:     true,
      holidayPending:   true,
      swapPending:      true,
      onCallGap:        true,
      payrollDeadline:  true,
      payslipReady:     true,
      shiftReminder:    true,
      lateWarning:      true,
    },
  },

  stressScore: {
    weights: {
      evening:     2,
      weekend:     3,
      bankholiday: 4,
      upgrade:     5,
      incident:    6,
      daily:       1,
    },
    highThreshold:  20,   // score above this = high stress flag
    criticalThreshold: 35,
  },

  shiftReminders: {
    leadTimeHrs: 24,      // default reminder lead time
    channels: ['inapp','os'],
  },

  access: {
    managerPin:         '',   // set by manager on first use
    pageAccess: {
      // true = visible to engineers, false = manager only
      dashboard:       false,
      oncall:          true,
      myshift:         true,
      calendar:        true,
      rota:            true,
      incidents:       true,
      timesheets:      true,
      timekeeping:     true,
      holidays:        true,
      swaps:           true,
      upgrades:        true,
      stress:          false,
      toil:            true,
      absence:         true,
      overtime:        true,
      logbook:         true,
      wiki:            true,
      glossary:        true,
      contacts:        true,
      notes:           true,
      docs:            true,
      whatsapp:        true,
      announcements:   true,
      shiftreminders:  true,
      insights:        false,
      capacity:        false,
      reports:         false,
      payroll:         false,
      payconfig:       false,
      settings:        false,
      logs:            false,
      myaccount:       true,
    },
    payConfigAccess: 'manager', // 'manager' | 'self' | 'all'
  },
};

// ── Utility: get active schedule for a given date ────────────────────────────
export function getScheduleForDate(settings, dateStr) {
  const schedules = (settings?.schedules || [DEFAULT_SCHEDULE_V1, DEFAULT_SCHEDULE_V2])
    .slice()
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  let active = schedules[0];
  for (const s of schedules) {
    if (dateStr >= s.effectiveFrom) active = s;
  }
  return active;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionCard({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 18px', background: 'var(--bg-card2)', border: 'none',
        cursor: 'pointer', textAlign: 'left',
      }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: '18px 20px', background: 'var(--bg-card)', borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
      <div style={{ width: 220, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
      <div onClick={() => onChange(!value)} style={{
        width: 42, height: 24, borderRadius: 12, padding: 2,
        background: value ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
        transition: 'background 0.2s', cursor: 'pointer', flexShrink: 0,
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: 10, background: '#fff',
          transform: value ? 'translateX(18px)' : 'translateX(0)',
          transition: 'transform 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }}/>
      </div>
      {label && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>}
    </label>
  );
}

function NumberInput({ value, onChange, min, max, step = 1, suffix }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input type="number" className="input" value={value} min={min} max={max} step={step}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ width: 90, textAlign: 'right', fontFamily: 'DM Mono, monospace' }}/>
      {suffix && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{suffix}</span>}
    </div>
  );
}

function TimeInput({ value, onChange }) {
  return (
    <input type="time" className="input" value={value}
      onChange={e => onChange(e.target.value)}
      style={{ width: 110, fontFamily: 'DM Mono, monospace' }}/>
  );
}

// ── Schedule Version Card ─────────────────────────────────────────────────────
function ScheduleVersionCard({ schedule, onChange, onDelete, canDelete }) {
  const S = schedule;
  const upd = (field, val) => onChange({ ...S, [field]: val });

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 12,
      background: !S.effectiveTo ? 'rgba(79,195,247,0.05)' : 'var(--bg-card2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: !S.effectiveTo ? 'var(--accent)' : 'var(--text-primary)' }}>
            {!S.effectiveTo ? '✅ ' : ''}{S.label}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-muted)', marginTop: 2 }}>
            {S.effectiveFrom} → {S.effectiveTo || 'present'}
          </div>
        </div>
        {canDelete && (
          <button className="btn btn-danger btn-sm" onClick={onDelete}>Remove</button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Dates */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Effective From</div>
          <input type="date" className="input" value={S.effectiveFrom} onChange={e => upd('effectiveFrom', e.target.value)} style={{ width: '100%' }}/>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Effective To (blank = active)</div>
          <input type="date" className="input" value={S.effectiveTo || ''} onChange={e => upd('effectiveTo', e.target.value || null)} style={{ width: '100%' }}/>
        </div>

        {/* Daily OC */}
        <div style={{ gridColumn: '1/-1', borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#90caf9', marginBottom: 8, textTransform: 'uppercase' }}>Daily On-Call (not paid)</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Start</div><TimeInput value={S.dailyStart} onChange={v => upd('dailyStart', v)}/></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>End</div><TimeInput value={S.dailyEnd} onChange={v => upd('dailyEnd', v)}/></div>
          </div>
        </div>

        {/* WD nights */}
        <div style={{ gridColumn: '1/-1', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#bbf7d0', marginBottom: 8, textTransform: 'uppercase' }}>Weekday On-Call (paid)</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Start (evening)</div><TimeInput value={S.wdStart} onChange={v => upd('wdStart', v)}/></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>End (next morning)</div><TimeInput value={S.wdEnd} onChange={v => upd('wdEnd', v)}/></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Hours/night</div><NumberInput value={S.wdHoursPerNight} onChange={v => upd('wdHoursPerNight', v)} min={1} max={24} suffix="h"/></div>
          </div>
        </div>

        {/* WE block */}
        <div style={{ gridColumn: '1/-1', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fef08a', marginBottom: 8, textTransform: 'uppercase' }}>Weekend On-Call — Fri 18:00 → Mon handover (paid)</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Fri start</div><TimeInput value={S.weStart} onChange={v => upd('weStart', v)}/></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Fri hours</div><NumberInput value={S.weFriHrs} onChange={v => upd('weFriHrs', v)} min={1} max={24} suffix="h"/></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Sat</div><NumberInput value={S.weSatHrs} onChange={v => upd('weSatHrs', v)} min={1} max={24} suffix="h"/></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Sun</div><NumberInput value={S.weSunHrs} onChange={v => upd('weSunHrs', v)} min={1} max={24} suffix="h"/></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Mon handover</div><NumberInput value={S.weMonHrs} onChange={v => upd('weMonHrs', v)} min={1} max={24} suffix="h"/></div>
            <div style={{ padding: '6px 12px', background: 'rgba(79,195,247,0.10)', borderRadius: 8, fontSize: 12, fontFamily: 'DM Mono', color: 'var(--accent)' }}>
              Total: {(S.weFriHrs||0)+(S.weSatHrs||0)+(S.weSunHrs||0)+(S.weMonHrs||0)}h
            </div>
          </div>
        </div>

        {/* BH rules */}
        <div style={{ gridColumn: '1/-1', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fca5a5', marginBottom: 8, textTransform: 'uppercase' }}>Bank Holiday Hours</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>BH Monday (WE block)</div><NumberInput value={S.bhMonHrs} onChange={v => upd('bhMonHrs', v)} min={1} max={48} suffix="h"/></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>BH Friday (WE/WD)</div><NumberInput value={S.bhFriHrs} onChange={v => upd('bhFriHrs', v)} min={1} max={24} suffix="h"/></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>BH midweek (WD)</div><NumberInput value={S.bhMidweekHrs} onChange={v => upd('bhMidweekHrs', v)} min={1} max={24} suffix="h"/></div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
            BH Monday = WE engineer covers full 24h day + Tuesday handover = {S.bhMonHrs}h total (e.g. 24 + {S.weMonHrs} = {24+S.weMonHrs}h).
            BH Friday = WE/WD engineer starts at {S.dailyEnd} instead of {S.weStart} = {S.bhFriHrs}h.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Settings component ────────────────────────────────────────────────────
export default function SettingsPage({
  settings, setSettings,
  users, setUsers,
  payconfig, setPayconfig,
  isManager, driveToken,
  // legacy props still passed from App.js
  permissions, setPermissions,
  driveWriteJson,
}) {
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState(null);
  const [activeSection, setActiveSection] = useState('schedule');

  const S = settings || DEFAULT_SETTINGS;
  const upd = useCallback((path, value) => {
    setSettings(prev => {
      const next = JSON.parse(JSON.stringify(prev || DEFAULT_SETTINGS));
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  }, [setSettings]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      if (driveToken && driveWriteJson) {
        await driveWriteJson(driveToken, 'cloudops_settings.json', settings);
      }
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch(e) { setError('Could not save to Drive: ' + e.message); }
    setSaving(false);
  };

  if (!isManager) return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
      🔒 Settings are only accessible to managers.
    </div>
  );

  const PAGE_LABELS = {
    dashboard:'Dashboard', oncall:"Who's On Call", myshift:'My Shift',
    calendar:'Calendar', rota:'Rota', incidents:'Incidents',
    timesheets:'Timesheets', timekeeping:'Time Keeping', holidays:'Holidays',
    swaps:'Shift Swaps', upgrades:'Upgrade Days', stress:'Stress Score',
    toil:'TOIL', absence:'Absence/Sick', overtime:'Overtime', logbook:'Logbook',
    wiki:'Wiki', glossary:'Glossary', contacts:'Contacts', notes:'Notes',
    docs:'Documents', whatsapp:'Team Chat', announcements:'Announcements',
    shiftreminders:'Shift Reminders', insights:'Insights', capacity:'Capacity',
    reports:'Weekly Reports', payroll:'Payroll', payconfig:'Pay Config',
    settings:'Settings', logs:'Activity Logs', myaccount:'My Account',
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:10 }}>
        <div>
          <h1 style={{ fontSize:21, fontWeight:800, fontFamily:'Syne,sans-serif', margin:0 }}>⚙️ Settings</h1>
          <div style={{ fontSize:12, color:'var(--text-muted)', fontFamily:'DM Mono', marginTop:3 }}>
            Manager only · changes take effect immediately · saved to Google Drive
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '⏳ Saving…' : saved ? '✅ Saved' : '💾 Save to Drive'}
          </button>
        </div>
      </div>

      {error && <div style={{ marginBottom:14, padding:'10px 14px', background:'rgba(239,68,68,0.10)', border:'1px solid rgba(239,68,68,0.30)', borderRadius:8, fontSize:12, color:'#fca5a5' }}>⚠️ {error}</div>}

      {/* ── 1. Schedule Config ─────────────────────────────────────────────── */}
      <SectionCard title="Schedule Configuration" icon="📅" defaultOpen={true}>
        <div style={{ marginBottom:14, padding:'10px 14px', background:'rgba(79,195,247,0.08)', border:'1px solid rgba(79,195,247,0.25)', borderRadius:8, fontSize:12, color:'#7dd3fc', lineHeight:1.6 }}>
          <strong>How versioning works:</strong> Each schedule has an effective date range. Payroll picks the correct version for each date automatically — historical data always uses the rate that was active when the shift was worked. Add a new version when hours change; never edit past versions.
        </div>

        {(S.schedules || []).map((sched, i) => (
          <ScheduleVersionCard key={sched.id || i}
            schedule={sched}
            onChange={updated => {
              const next = [...S.schedules];
              next[i] = updated;
              upd('schedules', next);
            }}
            onDelete={() => {
              if (!window.confirm(`Remove schedule "${sched.label}"? This cannot be undone.`)) return;
              upd('schedules', S.schedules.filter((_, j) => j !== i));
            }}
            canDelete={S.schedules.length > 1 && !!sched.effectiveTo}
          />
        ))}

        <button className="btn btn-secondary btn-sm" style={{ marginTop:8 }} onClick={() => {
          const last = S.schedules[S.schedules.length - 1];
          const newSched = {
            ...DEFAULT_SCHEDULE_V2,
            id: 'v' + (S.schedules.length + 1),
            label: 'New Schedule',
            effectiveFrom: last?.effectiveTo
              ? (() => { const d = new Date(last.effectiveTo + 'T12:00:00'); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); })()
              : new Date().toISOString().slice(0,10),
            effectiveTo: null,
          };
          // Close previous schedule
          const updated = S.schedules.map((s, i) =>
            i === S.schedules.length - 1 && !s.effectiveTo
              ? { ...s, effectiveTo: (() => { const d = new Date(newSched.effectiveFrom+'T12:00:00'); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })() }
              : s
          );
          upd('schedules', [...updated, newSched]);
        }}>➕ Add new schedule version</button>
      </SectionCard>

      {/* ── 2. Pay & Rates ────────────────────────────────────────────────── */}
      <SectionCard title="Pay & Rates" icon="💷">
        <Row label="Standby rate" hint="Pay code 1164 — applied to all WD, WE and BH standby hours">
          <NumberInput value={S.pay?.standbyRate ?? 5} onChange={v => upd('pay.standbyRate', v)} min={0} step={0.5} suffix="£/hr"/>
        </Row>
        <Row label="Worked multiplier" hint="Pay code 2011 — applied to incidents, upgrades, overtime">
          <NumberInput value={S.pay?.workedMultiplier ?? 1.5} onChange={v => upd('pay.workedMultiplier', v)} min={1} step={0.25} suffix="× hourly rate"/>
        </Row>
        <Row label="Pay cycle start day" hint="Day of month when a new pay cycle begins">
          <NumberInput value={S.pay?.cycleStartDay ?? 10} onChange={v => upd('pay.cycleStartDay', Math.min(28, Math.max(1, v)))} min={1} max={28} suffix="th of month"/>
        </Row>
      </SectionCard>

      {/* ── 3. Pay Config per engineer ────────────────────────────────────── */}
      <SectionCard title="Pay Config — Per Engineer" icon="👤">
        <div style={{ marginBottom:12, fontSize:12, color:'var(--text-muted)' }}>
          Access control for this section is set under Access Control below.
        </div>
        <Row label="Who can view pay config" hint="Which users can see salary/rate information">
          <select className="select" value={S.access?.payConfigAccess ?? 'manager'}
            onChange={e => upd('access.payConfigAccess', e.target.value)} style={{ width:200 }}>
            <option value="manager">Managers only</option>
            <option value="self">Own record only (engineers)</option>
            <option value="all">All engineers</option>
          </select>
        </Row>
        <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'var(--bg-card2)' }}>
                {['Engineer','Trigram','Annual Salary','Hourly Rate','Base','Pension %','Student Loan'].map(h => (
                  <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase', color:'var(--text-muted)', borderBottom:'1px solid var(--border)', letterSpacing:'0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(users||[]).map((u, i) => {
                const p = (payconfig||{})[u.id] || { annual:30000, rate:40, base:2500, pensionPct:0, studentLoan:false };
                const setP = updates => setPayconfig(prev => ({ ...prev, [u.id]: { ...p, ...updates } }));
                return (
                  <tr key={u.id} style={{ background:i%2===0?'transparent':'rgba(255,255,255,0.015)', borderBottom:'1px solid var(--border)' }}>
                    <td style={{ padding:'6px 12px', fontWeight:600, color:'var(--text-primary)' }}>{u.name}</td>
                    <td style={{ padding:'6px 12px', fontFamily:'DM Mono', color:'var(--accent)', fontSize:11 }}>{u.id}</td>
                    <td style={{ padding:'4px 8px' }}>
                      <input type="number" className="input" value={p.annual} min={0} step={1000}
                        onChange={e => setP({ annual: parseFloat(e.target.value)||0 })}
                        style={{ width:110, fontFamily:'DM Mono', padding:'3px 8px', fontSize:12 }}/>
                    </td>
                    <td style={{ padding:'4px 8px' }}>
                      <input type="number" className="input" value={p.rate} min={0} step={0.5}
                        onChange={e => setP({ rate: parseFloat(e.target.value)||0 })}
                        style={{ width:80, fontFamily:'DM Mono', padding:'3px 8px', fontSize:12 }}/>
                    </td>
                    <td style={{ padding:'4px 8px' }}>
                      <input type="number" className="input" value={p.base} min={0} step={100}
                        onChange={e => setP({ base: parseFloat(e.target.value)||0 })}
                        style={{ width:90, fontFamily:'DM Mono', padding:'3px 8px', fontSize:12 }}/>
                    </td>
                    <td style={{ padding:'4px 8px' }}>
                      <input type="number" className="input" value={p.pensionPct||0} min={0} max={100} step={0.5}
                        onChange={e => setP({ pensionPct: parseFloat(e.target.value)||0 })}
                        style={{ width:70, fontFamily:'DM Mono', padding:'3px 8px', fontSize:12 }}/>
                    </td>
                    <td style={{ padding:'6px 12px' }}>
                      <Toggle value={!!p.studentLoan} onChange={v => setP({ studentLoan: v })}/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* ── 4. Access Control ────────────────────────────────────────────── */}
      <SectionCard title="Access Control" icon="🔒">
        <Row label="Manager PIN" hint="Required to unlock rota editing. Leave blank to disable PIN requirement.">
          <input type="password" className="input" value={S.access?.managerPin ?? ''}
            onChange={e => upd('access.managerPin', e.target.value)}
            style={{ width:160, fontFamily:'DM Mono' }} placeholder="Set PIN…" autoComplete="new-password"/>
        </Row>
        <Row label="Pay Config access" hint="Who can view pay/salary information">
          <select className="select" value={S.access?.payConfigAccess ?? 'manager'}
            onChange={e => upd('access.payConfigAccess', e.target.value)} style={{ width:200 }}>
            <option value="manager">Managers only</option>
            <option value="self">Own record only</option>
            <option value="all">All engineers</option>
          </select>
        </Row>

        <div style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)', marginBottom:8, marginTop:16, textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Page visibility — engineers see these pages:
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:8 }}>
          {Object.entries(PAGE_LABELS).map(([id, label]) => (
            <label key={id} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'6px 10px', background:'var(--bg-card2)', borderRadius:8, border:'1px solid var(--border)' }}>
              <Toggle value={!!(S.access?.pageAccess?.[id])} onChange={v => upd(`access.pageAccess.${id}`, v)}/>
              <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{label}</span>
            </label>
          ))}
        </div>
        <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:10 }}>
          Pages not ticked are manager-only. Engineers will not see them in the navigation.
        </div>
      </SectionCard>

      {/* ── 5. Timekeeping ───────────────────────────────────────────────── */}
      <SectionCard title="Timekeeping" icon="🕒">
        <Row label="Late threshold" hint="Minutes past shift start before an engineer is marked late">
          <NumberInput value={S.timekeeping?.lateThresholdMins ?? 10} onChange={v => upd('timekeeping.lateThresholdMins', v)} min={1} max={60} suffix="mins"/>
        </Row>
        <Row label="Grace period" hint="Soft warning period before the late notification fires">
          <NumberInput value={S.timekeeping?.gracePeriodMins ?? 5} onChange={v => upd('timekeeping.gracePeriodMins', v)} min={0} max={30} suffix="mins"/>
        </Row>
        <Row label="60-min reminder" hint="Notify engineer 60 minutes before shift start">
          <Toggle value={!!S.timekeeping?.reminderMins60} onChange={v => upd('timekeeping.reminderMins60', v)} label="Enabled"/>
        </Row>
        <Row label="Late warning" hint="Notify if no clock-in 10 mins past start">
          <Toggle value={!!S.timekeeping?.reminderMins10} onChange={v => upd('timekeeping.reminderMins10', v)} label="Enabled"/>
        </Row>
      </SectionCard>

      {/* ── 6. Holidays ──────────────────────────────────────────────────── */}
      <SectionCard title="Holidays" icon="🌴">
        <Row label="Annual entitlement" hint="Default days per year for all engineers">
          <NumberInput value={S.holidays?.annualEntitlement ?? 25} onChange={v => upd('holidays.annualEntitlement', v)} min={0} max={365} suffix="days"/>
        </Row>
        <Row label="Carry-over" hint="Maximum days that roll over to the next year">
          <NumberInput value={S.holidays?.carryOverDays ?? 5} onChange={v => upd('holidays.carryOverDays', v)} min={0} max={25} suffix="days"/>
        </Row>
        <Row label="Manager approval required" hint="Holiday requests require manager sign-off before confirmed">
          <Toggle value={!!S.holidays?.requiresApproval} onChange={v => upd('holidays.requiresApproval', v)} label="Required"/>
        </Row>
      </SectionCard>

      {/* ── 7. TOIL ──────────────────────────────────────────────────────── */}
      <SectionCard title="TOIL" icon="⏳">
        <Row label="Auto-accrual" hint="Automatically accrue 1h TOIL per 1h worked in incidents / upgrade days">
          <Toggle value={!!S.toil?.autoAccrual} onChange={v => upd('toil.autoAccrual', v)} label="Enabled"/>
        </Row>
        <Row label="BH standby generates TOIL" hint="Being on standby over a Bank Holiday automatically accrues TOIL">
          <Toggle value={!!S.toil?.bhAutoToil} onChange={v => upd('toil.bhAutoToil', v)} label="Enabled"/>
        </Row>
        <Row label="Maximum balance" hint="TOIL balance cannot exceed this — excess must be used or lost">
          <NumberInput value={S.toil?.maxBalanceDays ?? 10} onChange={v => upd('toil.maxBalanceDays', v)} min={0} max={30} suffix="days"/>
        </Row>
        <Row label="TOIL expiry" hint="Unused TOIL expires after this many months">
          <NumberInput value={S.toil?.expiryMonths ?? 12} onChange={v => upd('toil.expiryMonths', v)} min={0} max={36} suffix="months"/>
        </Row>
      </SectionCard>

      {/* ── 8. Overtime ──────────────────────────────────────────────────── */}
      <SectionCard title="Overtime" icon="🕐">
        <Row label="Weekly threshold" hint="Hours per week beyond which overtime applies">
          <NumberInput value={S.overtime?.weeklyThresholdHrs ?? 40} onChange={v => upd('overtime.weeklyThresholdHrs', v)} min={0} max={60} suffix="h/week"/>
        </Row>
        <Row label="OT multiplier" hint="Overtime pay multiplier">
          <NumberInput value={S.overtime?.multiplier ?? 1.5} onChange={v => upd('overtime.multiplier', v)} min={1} step={0.25} suffix="×"/>
        </Row>
      </SectionCard>

      {/* ── 9. Incidents ─────────────────────────────────────────────────── */}
      <SectionCard title="Incidents" icon="🚨">
        <Row label="TOIL for callouts" hint="Hours worked during an incident callout accrue TOIL">
          <Toggle value={!!S.incidents?.toilForCallout} onChange={v => upd('incidents.toilForCallout', v)} label="Enabled"/>
        </Row>
        <Row label="Escalation threshold" hint="Minutes before an unresolved incident auto-escalates">
          <NumberInput value={S.incidents?.escalationMins ?? 15} onChange={v => upd('incidents.escalationMins', v)} min={5} max={120} suffix="mins"/>
        </Row>
        <Row label="Severity levels" hint="Comma-separated list of severity levels (highest first)">
          <input className="input" value={(S.incidents?.severities || []).join(', ')}
            onChange={e => upd('incidents.severities', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}/>
        </Row>
      </SectionCard>

      {/* ── 10. Notifications ────────────────────────────────────────────── */}
      <SectionCard title="Notifications" icon="🔔">
        <Row label="OS desktop notifications" hint="Windows/macOS Action Centre toasts when PWA is installed">
          <Toggle value={!!S.notifications?.enableToastOS} onChange={v => upd('notifications.enableToastOS', v)} label="Enabled"/>
        </Row>
        <Row label="In-app notifications" hint="Bell icon banner queue inside the app">
          <Toggle value={!!S.notifications?.enableInApp} onChange={v => upd('notifications.enableInApp', v)} label="Enabled"/>
        </Row>
        <Row label="Rota reminder" hint="Hours before shift to send on-call reminder">
          <NumberInput value={S.notifications?.rotaReminderHrs ?? 24} onChange={v => upd('notifications.rotaReminderHrs', v)} min={1} max={72} suffix="h before"/>
        </Row>
        <Row label="Shift soon warning" hint="Minutes before shift start to send 'starting soon' notification">
          <NumberInput value={S.notifications?.shiftSoonMins ?? 60} onChange={v => upd('notifications.shiftSoonMins', v)} min={5} max={120} suffix="mins before"/>
        </Row>
        <Row label="Late warning" hint="Minutes past shift start with no clock-in before warning fires">
          <NumberInput value={S.notifications?.lateWarningMins ?? 10} onChange={v => upd('notifications.lateWarningMins', v)} min={1} max={60} suffix="mins after start"/>
        </Row>

        <div style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)', margin:'16px 0 8px', textTransform:'uppercase', letterSpacing:'0.06em' }}>Notification triggers</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:8 }}>
          {Object.entries(S.notifications?.triggers || {}).map(([key, val]) => {
            const labels = { upgradeReminder:'Upgrade reminders', incidentOpen:'Open incidents', holidayPending:'Holiday approvals', swapPending:'Swap requests', onCallGap:'On-call gaps', payrollDeadline:'Payroll deadline', payslipReady:'Payslip ready', shiftReminder:'Shift reminders', lateWarning:'Late warnings' };
            return (
              <label key={key} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background:'var(--bg-card2)', borderRadius:8, border:'1px solid var(--border)', cursor:'pointer' }}>
                <Toggle value={!!val} onChange={v => upd(`notifications.triggers.${key}`, v)}/>
                <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{labels[key] || key}</span>
              </label>
            );
          })}
        </div>
      </SectionCard>

      {/* ── 11. Stress Score ─────────────────────────────────────────────── */}
      <SectionCard title="Stress Score Weights" icon="📊">
        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14 }}>
          Each shift type contributes a number of stress points per day. Engineers above the high threshold are flagged.
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:10, marginBottom:16 }}>
          {Object.entries(S.stressScore?.weights || {}).map(([type, weight]) => (
            <div key={type} style={{ padding:'10px 12px', background:'var(--bg-card2)', borderRadius:8, border:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', marginBottom:6 }}>{type}</div>
              <NumberInput value={weight} onChange={v => upd(`stressScore.weights.${type}`, v)} min={0} max={20} suffix="pts/day"/>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
          <Row label="High stress threshold" hint="Score above this → amber flag">
            <NumberInput value={S.stressScore?.highThreshold ?? 20} onChange={v => upd('stressScore.highThreshold', v)} min={0} suffix="pts"/>
          </Row>
          <Row label="Critical threshold" hint="Score above this → red flag">
            <NumberInput value={S.stressScore?.criticalThreshold ?? 35} onChange={v => upd('stressScore.criticalThreshold', v)} min={0} suffix="pts"/>
          </Row>
        </div>
      </SectionCard>

      {/* ── 12. Shift Reminders ──────────────────────────────────────────── */}
      <SectionCard title="Shift Reminders" icon="🔔">
        <Row label="Default reminder lead time" hint="How far in advance to remind engineers about their upcoming shift">
          <NumberInput value={S.shiftReminders?.leadTimeHrs ?? 24} onChange={v => upd('shiftReminders.leadTimeHrs', v)} min={1} max={168} suffix="hours"/>
        </Row>
        <Row label="Notification channels" hint="Where reminders are sent">
          <div style={{ display:'flex', gap:10 }}>
            <Toggle value={(S.shiftReminders?.channels||[]).includes('inapp')}
              onChange={v => upd('shiftReminders.channels', v ? [...(S.shiftReminders?.channels||[]).filter(c=>c!=='inapp'),'inapp'] : (S.shiftReminders?.channels||[]).filter(c=>c!=='inapp'))}
              label="In-app"/>
            <Toggle value={(S.shiftReminders?.channels||[]).includes('os')}
              onChange={v => upd('shiftReminders.channels', v ? [...(S.shiftReminders?.channels||[]).filter(c=>c!=='os'),'os'] : (S.shiftReminders?.channels||[]).filter(c=>c!=='os'))}
              label="OS desktop"/>
          </div>
        </Row>
      </SectionCard>

      {/* Bottom save */}
      <div style={{ marginTop:20, display:'flex', justifyContent:'flex-end', gap:8 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '⏳ Saving…' : saved ? '✅ Saved to Drive' : '💾 Save all settings'}
        </button>
      </div>
    </div>
  );
}
