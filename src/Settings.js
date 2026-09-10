// src/Settings.js
// ─────────────────────────────────────────────────────────────────────────────
// Universal Settings Page — manager only.
// Merged from two divergent copies:
//   - the Configuration page (schedule/pay/timekeeping/etc, persisted as
//     cloudops_settings.json)
//   - the Team page (Active Directory-style engineer account management,
//     permissions, Drive/registry sync — previously a separate Settings.js
//     that had drifted apart from this one)
// Persisted to Google Drive as cloudops_settings.json (config) and via the
// user registry (team/permissions) — see each tab for specifics.
//
// Tabs:
//  👥 Team          — engineer accounts, AD-style search/filter/detail view
//  🔐 Permissions   — per-user page access overrides
//  📁 Drive         — registry/sheet sync, secure share links
//  ⚙️ Configuration — Schedule, Pay & Rates, Pay Config, Access Control,
//                     Timekeeping, Holidays, TOIL, Overtime, Incidents,
//                     Notifications, Stress Score, Shift Reminders

import React, { useState, useCallback } from 'react';

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
    autoAccrual:        true,
    maxBalanceDays:     0,     // 0 = no limit
    expiryMonths:       0,     // 0 = no expiry
    bhAutoToil:         false,
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


// ── Team/AD constants ──────────────────────────────────────────────────────
const BLANK_FORM = {
  name: '', trigram: '', role: 'Engineer', employment_id: '',
  mobile_number: '', google_email: '', profile_picture: '',
  avatar: '', color: '', start_date: '', oncall_start_date: '', termination_date: '',
};

const TRICOLORS = ['#1d4ed8','#0e7490','#065f46','#7c3aed','#b45309','#be123c','#0369a1','#4338ca'];

// ── Shared page list (Access Control tab + per-user Permissions tab) ────────
// Single source of truth for every page id App.js actually routes to.
// ALL_PAGES and MANAGER_ONLY below are both derived from this — previously
// the Permissions tab had its own separate, drifted list (wrong ids like
// "whocall"/"absences"/"documents"/"chat" instead of "oncall"/"absence"/
// "docs"/"whatsapp", and missing announcements/shiftreminders/insights/
// capacity/settings/logs/myaccount entirely). Fixed by deriving both from
// this one list, so they can't drift apart again.
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
const ALL_PAGES = Object.entries(PAGE_LABELS).map(([id, label]) => ({ id, label }));
// Pages that default to hidden-from-engineers in DEFAULT_SETTINGS.access.pageAccess
// below are treated as manager-only for the per-user Permissions tab's defaults too.
const MANAGER_ONLY = new Set(
  Object.entries(DEFAULT_SETTINGS.access.pageAccess).filter(([, v]) => v === false).map(([id]) => id)
);

// ── Stable UserFields component (defined OUTSIDE Settings to preserve focus) ─
// Previously defined inside Settings, causing React to treat it as a new
// component type on every keystroke re-render — unmounting inputs and losing focus.
function UserFields({ fv, setFv, uid, isEdit, picUploading, onPicUpload, driveToken }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

      {/* ── Identity ──────────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div>
          <label style={LBL}>Full Name *</label>
          <input className="input" placeholder="e.g. Mahir Osman"
            value={fv.name||''} onChange={e => setFv(f => ({...f, name: e.target.value}))} />
        </div>
        <div>
          <label style={LBL}>
            Trigram / ID&nbsp;
            {isEdit
              ? <span style={{ color:'#fcd34d', fontWeight:400 }}>⚠ Changing remaps all data</span>
              : <span style={{ color:'#475569', fontWeight:400 }}>Auto-generated if blank</span>}
          </label>
          <input className="input" placeholder={isEdit ? 'e.g. MAH01' : 'Auto-generated'} maxLength={8}
            value={fv.trigram||''} onChange={e => setFv(f => ({...f, trigram: e.target.value.toUpperCase()}))}
            style={{ fontFamily:'DM Mono', letterSpacing:1 }} />
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div>
          <label style={LBL}>Role</label>
          <select className="select" value={fv.role||'Engineer'}
            onChange={e => setFv(f => ({...f, role: e.target.value}))}>
            <option>Engineer</option><option>Manager</option>
          </select>
        </div>
        <div>
          <label style={LBL}>Avatar Initials</label>
          <input className="input" placeholder="e.g. MB" maxLength={3}
            value={fv.avatar||''} onChange={e => setFv(f => ({...f, avatar: e.target.value.toUpperCase()}))} />
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div>
          <label style={LBL}>Google Email</label>
          <input className="input" type="email" placeholder="user@gmail.com"
            value={fv.google_email||''} onChange={e => setFv(f => ({...f, google_email: e.target.value}))} />
        </div>
        <div>
          <label style={LBL}>Mobile Number</label>
          <input className="input" type="tel" placeholder="+44 7700 000000"
            value={fv.mobile_number||''} onChange={e => setFv(f => ({...f, mobile_number: e.target.value}))} />
        </div>
      </div>

      {/* ── Payroll ───────────────────────────────────────────────────────── */}
      <div>
        <label style={LBL}>Employment ID <span style={{ color:'#475569', fontWeight:400 }}>(Payroll / HR reference)</span></label>
        <input className="input" placeholder="e.g. EMP-00123"
          value={fv.employment_id||''} onChange={e => setFv(f => ({...f, employment_id: e.target.value}))}
          style={{ fontFamily:'DM Mono', letterSpacing:1 }} />
      </div>

      {/* ── Dates ─────────────────────────────────────────────────────────── */}
      <div style={{ background:'rgba(0,194,255,0.05)', border:'1px solid rgba(0,194,255,0.15)', borderRadius:8, padding:'12px 14px' }}>
        <div style={{ fontSize:11, color:'#00c2ff', fontWeight:700, marginBottom:10, textTransform:'uppercase', letterSpacing:'0.5px' }}>
          📅 Employment & On-Call Dates
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
          <div>
            <label style={LBL}>Start Date</label>
            <input className="input" type="date"
              value={fv.start_date||''} onChange={e => setFv(f => ({...f, start_date: e.target.value}))} />
            <div style={{ fontSize:10, color:'#475569', marginTop:2 }}>When they join</div>
          </div>
          <div>
            <label style={LBL}>On-Call Start Date</label>
            <input className="input" type="date"
              value={fv.oncall_start_date||''} onChange={e => setFv(f => ({...f, oncall_start_date: e.target.value}))} />
            <div style={{ fontSize:10, color:'#f59e0b', marginTop:2 }}>⚠ Not in rota until this date</div>
          </div>
          <div>
            <label style={LBL}>Termination Date</label>
            <input className="input" type="date"
              value={fv.termination_date||''} onChange={e => setFv(f => ({...f, termination_date: e.target.value}))} />
            <div style={{ fontSize:10, color:'#ef4444', marginTop:2 }}>Removed from rota after</div>
          </div>
        </div>
      </div>

      {/* ── Appearance ────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <label style={{ ...LBL, marginBottom:0 }}>Avatar Colour</label>
        <input type="color" value={fv.color||'#1d4ed8'}
          onChange={e => setFv(f => ({...f, color: e.target.value}))}
          style={{ width:36, height:28, border:'none', borderRadius:4, cursor:'pointer', padding:0 }} />
        <span style={{ fontSize:11, color:'#475569' }}>Background colour for avatar initials</span>
      </div>

      {/* ── Profile picture ───────────────────────────────────────────────── */}
      <div>
        <label style={LBL}>Profile Picture</label>
        {fv.profile_picture && (
          <img src={fv.profile_picture} alt="" style={{ width:48, height:48, borderRadius:8, objectFit:'cover', marginBottom:6, display:'block' }} />
        )}
        <label className="btn btn-secondary btn-sm" style={{ cursor:'pointer', display:'inline-flex', alignItems:'center', gap:4 }}>
          {picUploading ? '⏳ Uploading…' : '📷 Upload Photo'}
          <input type="file" accept="image/*" style={{ display:'none' }}
            onChange={e => onPicUpload && onPicUpload(e.target.files[0], uid || 'new_' + Date.now(), isEdit)} />
        </label>
        {driveToken && <span style={{ fontSize:11, color:'#475569', marginLeft:8 }}>Saved to Drive</span>}
      </div>
    </div>
  );
}

// ── AD-style user card ─────────────────────────────────────────────────────────
function UserCard({ user, profilePic, isSelected, onClick }) {
  const today = new Date().toISOString().slice(0,10);
  const isTerminated = user.termination_date && today > user.termination_date;
  const notStarted   = user.start_date && today < user.start_date;
  const notOnCall    = user.oncall_start_date && today < user.oncall_start_date;
  const status = isTerminated ? { label:'Left', color:'#ef4444', bg:'rgba(239,68,68,0.12)' }
               : notStarted   ? { label:'Joining', color:'#94a3b8', bg:'rgba(148,163,184,0.1)' }
               : notOnCall    ? { label:'Onboarding', color:'#f59e0b', bg:'rgba(245,158,11,0.1)' }
               : { label:'Active', color:'#22c55e', bg:'rgba(34,197,94,0.1)' };

  return (
    <div onClick={onClick} style={{
      background: isSelected ? 'rgba(0,194,255,0.08)' : 'rgba(255,255,255,0.03)',
      border: `1.5px solid ${isSelected ? 'rgba(0,194,255,0.4)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius:10, padding:'12px 14px', cursor:'pointer',
      transition:'all 0.15s', display:'flex', alignItems:'center', gap:12,
    }}>
      {/* Avatar */}
      <div style={{ position:'relative', flexShrink:0 }}>
        {profilePic
          ? <img src={profilePic} alt="" style={{ width:44, height:44, borderRadius:'50%', objectFit:'cover', border:'2px solid rgba(255,255,255,0.1)' }} />
          : <div style={{ width:44, height:44, borderRadius:'50%', background:user.color||'#1d4ed8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:700, color:'#fff', border:'2px solid rgba(255,255,255,0.1)' }}>
              {user.avatar||user.name?.charAt(0)||'?'}
            </div>
        }
        {/* Status dot */}
        <div style={{ position:'absolute', bottom:0, right:0, width:12, height:12, borderRadius:'50%', background:status.color, border:'2px solid #0f172a', boxShadow:`0 0 6px ${status.color}` }} />
      </div>

      {/* Info */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {user.name}
        </div>
        <div style={{ fontSize:11, color:'#64748b', fontFamily:'DM Mono', marginTop:1 }}>
          {user.id} · {user.role||'Engineer'}
        </div>
        {user.employment_id && (
          <div style={{ fontSize:10, color:'#475569', fontFamily:'DM Mono', marginTop:1 }}>EMP: {user.employment_id}</div>
        )}
      </div>

      {/* Status badge */}
      <div style={{ flexShrink:0 }}>
        <span style={{ fontSize:10, fontWeight:700, color:status.color, background:status.bg, padding:'2px 8px', borderRadius:10, border:`1px solid ${status.color}33` }}>
          {status.label}
        </span>
      </div>
    </div>
  );
}

// ── AD-style detail panel ──────────────────────────────────────────────────────
function UserDetail({ user, profilePic, onEdit, onDelete, onResetPw, resetPwDone, isManager }) {
  if (!user) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:300, color:'#334155', gap:10 }}>
      <div style={{ fontSize:40 }}>👤</div>
      <div style={{ fontSize:14, fontWeight:600 }}>Select a user to view details</div>
      <div style={{ fontSize:12 }}>Click any card on the left</div>
    </div>
  );

  const today = new Date().toISOString().slice(0,10);
  const isTerminated = user.termination_date && today > user.termination_date;
  const notStarted   = user.start_date && today < user.start_date;
  const notOnCall    = user.oncall_start_date && today < user.oncall_start_date;
  const statusLabel  = isTerminated ? 'Left' : notStarted ? 'Joining' : notOnCall ? 'Onboarding' : 'Active';
  const statusColor  = isTerminated ? '#ef4444' : notStarted ? '#94a3b8' : notOnCall ? '#f59e0b' : '#22c55e';

  const Field = ({ icon, label, value, mono }) => value ? (
    <div style={{ display:'flex', gap:10, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize:16, flexShrink:0, width:22 }}>{icon}</span>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:10, color:'#475569', marginBottom:1, textTransform:'uppercase', letterSpacing:'0.4px' }}>{label}</div>
        <div style={{ fontSize:12, color:mono?'#93c5fd':'#e2e8f0', fontFamily:mono?'DM Mono':'inherit' }}>{value}</div>
      </div>
    </div>
  ) : null;

  return (
    <div style={{ padding:'0 4px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20, paddingBottom:16, borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ position:'relative' }}>
          {profilePic
            ? <img src={profilePic} alt="" style={{ width:64, height:64, borderRadius:'50%', objectFit:'cover', border:'2px solid rgba(255,255,255,0.12)' }} />
            : <div style={{ width:64, height:64, borderRadius:'50%', background:user.color||'#1d4ed8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, fontWeight:700, color:'#fff', border:'2px solid rgba(255,255,255,0.12)' }}>
                {user.avatar||user.name?.charAt(0)||'?'}
              </div>
          }
          <div style={{ position:'absolute', bottom:2, right:2, width:14, height:14, borderRadius:'50%', background:statusColor, border:'2px solid #0f172a', boxShadow:`0 0 8px ${statusColor}` }} />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:18, fontWeight:700 }}>{user.name}</div>
          <div style={{ fontSize:12, color:'#64748b', fontFamily:'DM Mono', marginTop:2 }}>{user.id}</div>
          <div style={{ marginTop:4 }}>
            <span style={{ fontSize:11, fontWeight:700, color:statusColor, background:`${statusColor}18`, padding:'2px 10px', borderRadius:10, border:`1px solid ${statusColor}33` }}>
              {statusLabel}
            </span>
            <span style={{ marginLeft:8, fontSize:11, color:'#64748b', background:'rgba(255,255,255,0.05)', padding:'2px 10px', borderRadius:10, border:'1px solid rgba(255,255,255,0.08)' }}>
              {user.role||'Engineer'}
            </span>
          </div>
        </div>
      </div>

      {/* Fields */}
      <div style={{ marginBottom:16 }}>
        <Field icon="🪪" label="Trigram / ID"         value={user.id}             mono />
        <Field icon="💼" label="Employment ID"         value={user.employment_id}  mono />
        <Field icon="✉️" label="Google Email"           value={user.google_email}       />
        <Field icon="📱" label="Mobile"                value={user.mobile_number}      />
        <Field icon="📅" label="Start Date"            value={user.start_date}    mono />
        <Field icon="📡" label="On-Call Start"         value={user.oncall_start_date} mono />
        <Field icon="🚪" label="Termination Date"      value={user.termination_date}  mono />
      </div>

      {resetPwDone && (
        <div style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', borderRadius:7, padding:'7px 12px', fontSize:12, color:'#22c55e', marginBottom:10 }}>
          ✅ Password reset to "{user.id.toLowerCase()}"
        </div>
      )}

      {/* Actions */}
      {isManager && (
        <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
          <button onClick={onEdit} style={{ ...ABTN, background:'rgba(0,194,255,0.1)', color:'#00c2ff', borderColor:'rgba(0,194,255,0.3)' }}>
            ✎ Edit Profile
          </button>
          <button onClick={onResetPw} style={{ ...ABTN, background:'rgba(245,158,11,0.08)', color:'#fcd34d', borderColor:'rgba(245,158,11,0.25)' }}>
            🔑 Reset Password
          </button>
          <button onClick={onDelete} style={{ ...ABTN, background:'rgba(239,68,68,0.08)', color:'#fca5a5', borderColor:'rgba(239,68,68,0.25)' }}>
            🗑 Delete User
          </button>
        </div>
      )}
    </div>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────────
const LBL = { display:'block', fontSize:11, color:'#64748b', marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.4px' };
const ABTN = { width:'100%', padding:'9px 14px', border:'1px solid', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', textAlign:'left' };

// ── Main Settings component ────────────────────────────────────────────────────
export default function SettingsPage({
  // Configuration props
  settings, setSettings,
  payconfig, setPayconfig,
  // Team/AD + shared props
  users, setUsers, isManager, driveToken,
  secureLinks, setSecureLinks,
  profilePics, setProfilePicsState, getProfilePics, setProfilePics,
  rota, setRota, permissions, setPermissions,
  uploadProfilePicture, generateTrigramId, TRICOLORS: triColors,
  updatePasswordInRegistry, syncRegistryToDrive, getRegistry,
  setTimesheets, setToil, syncUsersFromSheet, syncUsersToSheet,
  driveWriteJson,
}) {
  // ── Configuration state ──────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState(null);

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

  // ── Team/AD + Permissions + Drive state ──────────────────────────────────
  const [showAdd,        setShowAdd]        = useState(false);
  const [showLink,       setShowLink]       = useState(false);
  const [editingUserId,  setEditingUserId]  = useState(null);
  const [form,           setForm]           = useState(BLANK_FORM);
  const [editForm,       setEditForm]       = useState(BLANK_FORM);
  const [linkForm,       setLinkForm]       = useState({ label:'', expiry:'', password:'' });
  const [picUploading,   setPicUploading]   = useState(false);
  const [sheetSyncing,   setSheetSyncing]   = useState(false);
  const [sheetMsg,       setSheetMsg]       = useState('');
  const [sheetOpenMsg,   setSheetOpenMsg]   = useState('');
  const [pushMsg,        setPushMsg]        = useState('');
  const [resetPwUid,     setResetPwUid]     = useState('');
  const [settingsTab,    setSettingsTab]    = useState('team');
  // AD view state
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [search,         setSearch]         = useState('');
  const [filterRole,     setFilterRole]     = useState('all');
  const [filterStatus,   setFilterStatus]   = useState('all');


  // ── Permissions helpers ───────────────────────────────────────────────────
  const safePerms  = permissions || {};
  const defaultPerms = useCallback((role) => {
    const p = {};
    ALL_PAGES.forEach(pg => { p[pg.id] = role === 'Manager' ? true : !MANAGER_ONLY.has(pg.id); });
    return p;
  }, []);
  const getPerms     = useCallback((uid) => safePerms[uid] || defaultPerms(users.find(u=>u.id===uid)?.role||'Engineer'), [safePerms, users, defaultPerms]);
  const setUserPerm  = (uid, pageId, val) => {
    const updated = { ...safePerms, [uid]: { ...getPerms(uid), [pageId]: val } };
    setPermissions(updated);
    if (driveToken && driveWriteJson) driveWriteJson(driveToken, 'permissions.json', updated).catch(()=>{});
  };
  const setAllPerms  = (uid, val) => {
    const p = {}; ALL_PAGES.forEach(pg => { p[pg.id] = val; });
    const updated = { ...safePerms, [uid]: p };
    setPermissions(updated);
    if (driveToken && driveWriteJson) driveWriteJson(driveToken, 'permissions.json', updated).catch(()=>{});
  };
  const applyTemplate = (uid) => {
    const role = users.find(u=>u.id===uid)?.role||'Engineer';
    const updated = { ...safePerms, [uid]: defaultPerms(role) };
    setPermissions(updated);
    if (driveToken && driveWriteJson) driveWriteJson(driveToken, 'permissions.json', updated).catch(()=>{});
  };


  if (!isManager) return (
    <div style={{ padding:32, color:'#94a3b8', textAlign:'center' }}>
      <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
      <div style={{ fontSize:16, fontWeight:600 }}>Settings are restricted to managers.</div>
    </div>
  );

  // ── Profile picture upload ─────────────────────────────────────────────────
  const handlePicUpload = async (file, uid, isEdit) => {
    if (!file) return;
    setPicUploading(true);
    try {
      const dataUri = (driveToken && uploadProfilePicture)
        ? await uploadProfilePicture(driveToken, uid, file)
        : await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(file); });
      if (isEdit) setEditForm(f => ({...f, profile_picture: dataUri}));
      else        setForm(f => ({...f, profile_picture: dataUri}));
    } finally { setPicUploading(false); }
  };

  // ── Add engineer ───────────────────────────────────────────────────────────
  const add = async () => {
    if (!form.name) return;
    let id;
    if (form.trigram && form.trigram.trim().length >= 2) {
      const cand = form.trigram.trim().toUpperCase();
      id = users.find(u=>u.id===cand) ? generateTrigramId(form.name, users) : cand;
    } else {
      id = generateTrigramId(form.name, users);
    }
    const colors = triColors || TRICOLORS;
    const color  = form.color || colors[users.length % colors.length];
    const avatar = form.avatar || form.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
    const newUser = {
      id, name:form.name, role:form.role, tri:id.slice(0,3), avatar, color,
      mobile_number:form.mobile_number||'', google_email:form.google_email||'',
      employment_id:form.employment_id||'', start_date:form.start_date||'',
      oncall_start_date:form.oncall_start_date||'', termination_date:form.termination_date||'',
      profile_picture:form.profile_picture||'',
    };
    const updatedUsers = [...users, newUser];
    setUsers(updatedUsers);
    if (updatePasswordInRegistry && syncRegistryToDrive && getRegistry) {
      const reg = updatePasswordInRegistry(id, id.toLowerCase());
      if (driveToken) await syncRegistryToDrive(driveToken, reg, updatedUsers);
    }
    setShowAdd(false); setForm(BLANK_FORM);
    setSelectedUserId(id); // auto-select newly added user
  };

  // ── Save edit ──────────────────────────────────────────────────────────────
  const saveEdit = async (userId) => {
    const newId = (editForm.trigram || userId).toUpperCase().trim();
    const idChanged = newId !== userId && newId.length >= 3;
    const updatedUser = { ...users.find(u=>u.id===userId), ...editForm, id: idChanged ? newId : userId };
    delete updatedUser.trigram;
    const updatedUsers = users.map(u => u.id===userId ? updatedUser : u);
    setUsers(updatedUsers);

    if (idChanged) {
      setRota(prev => { const n={...prev}; if(n[userId]){n[newId]=n[userId];delete n[userId];} return n; });
      if (setTimesheets) setTimesheets(prev => { const n={...prev}; if(n[userId]){n[newId]=n[userId];delete n[userId];} return n; });
      if (setToil) setToil(prev => { const a=Array.isArray(prev)?prev:Object.values(prev); return a.map(t=>t.userId===userId?{...t,userId:newId}:t); });
      if (setProfilePics) setProfilePics(prev => { const n={...prev}; if(n[userId]){n[newId]=n[userId];delete n[userId];} return n; });
      if (setProfilePicsState) setProfilePicsState(prev => { const n={...prev}; if(n[userId]){n[newId]=n[userId];delete n[userId];} return n; });
    }

    if (driveToken && syncRegistryToDrive && getRegistry) {
      await syncRegistryToDrive(driveToken, getRegistry(), updatedUsers);
      if (editForm.profile_picture?.startsWith('data:')) {
        const targetId = idChanged ? newId : userId;
        const pics = { ...(getProfilePics?.() || {}), [targetId]: editForm.profile_picture };
        if (setProfilePics) setProfilePics(pics);
        if (setProfilePicsState) setProfilePicsState(pics);
        if (driveWriteJson) await driveWriteJson(driveToken, 'profile_pictures.json', pics);
      }
    }
    setEditingUserId(null); setEditForm(BLANK_FORM);
    setSelectedUserId(idChanged ? newId : userId);
  };

  const deleteUser = (userId) => {
    if (!window.confirm('⚠️ Delete this user? Cannot be undone.')) return;
    setUsers(users.filter(u => u.id !== userId));
    if (driveToken && syncRegistryToDrive && getRegistry) syncRegistryToDrive(driveToken, getRegistry(), users.filter(u=>u.id!==userId));
    setSelectedUserId(null);
  };

  const resetPassword = async (uid) => {
    if (!updatePasswordInRegistry || !syncRegistryToDrive || !getRegistry) return;
    const reg = updatePasswordInRegistry(uid, uid.toLowerCase());
    if (driveToken) await syncRegistryToDrive(driveToken, reg, users);
    setResetPwUid(uid);
    setTimeout(()=>setResetPwUid(''), 4000);
  };

  const addLink = () => {
    if (!linkForm.label) return;
    const link = { id:'lnk-'+Date.now(), ...linkForm, url:`https://dsmeetul-cpu.github.io/cloudops-rota?ref=${Date.now()}`, created:new Date().toISOString().slice(0,10) };
    setSecureLinks([...(secureLinks||[]), link]);
    setShowLink(false); setLinkForm({label:'',expiry:'',password:''});
  };

  const syncFromSheet = async () => {
    if (!driveToken) { setSheetMsg('⚠ Connect Google Drive first.'); return; }
    setSheetSyncing(true); setSheetMsg('⏳ Syncing from Google Sheet…');
    try {
      if (syncUsersFromSheet) await syncUsersFromSheet(driveToken, getRegistry(), users, setUsers);
      setSheetMsg('✅ Synced from Google Sheet.');
    } catch(e) { setSheetMsg('❌ Sync failed: '+(e.message||e)); }
    setSheetSyncing(false);
    setTimeout(()=>setSheetMsg(''), 6000);
  };

  const openSheet = async () => {
    const reg = getRegistry?.() || {};
    if (reg.sheets_id) {
      window.open(`https://docs.google.com/spreadsheets/d/${reg.sheets_id}`,'_blank');
      setSheetOpenMsg('✅ Opened in new tab.');
    } else if (driveToken && syncUsersToSheet) {
      setSheetOpenMsg('⏳ Creating sheet…');
      try {
        const sid = await syncUsersToSheet(driveToken, reg, users);
        if (sid) { window.open(`https://docs.google.com/spreadsheets/d/${sid}`,'_blank'); setSheetOpenMsg('✅ Sheet created.'); }
      } catch(e) { setSheetOpenMsg('❌ '+e.message); }
    } else { setSheetOpenMsg('⚠ Connect Google Drive first.'); }
    setTimeout(()=>setSheetOpenMsg(''),6000);
  };

  const pushToSheet = async () => {
    if (!driveToken) { setPushMsg('⚠ Connect Google Drive first.'); return; }
    setPushMsg('⏳ Pushing…');
    try {
      if (syncRegistryToDrive && getRegistry) await syncRegistryToDrive(driveToken, getRegistry(), users);
      setPushMsg('✅ Pushed to Google Sheet.');
    } catch(e) { setPushMsg('❌ '+e.message); }
    setTimeout(()=>setPushMsg(''),6000);
  };

  // ── AD view filtering ──────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0,10);
  const filteredUsers = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q) || (u.employment_id||'').toLowerCase().includes(q) || (u.google_email||'').toLowerCase().includes(q);
    const matchRole = filterRole === 'all' || (u.role||'Engineer') === filterRole;
    const isTerminated = u.termination_date && today > u.termination_date;
    const notStarted   = u.start_date && today < u.start_date;
    const notOnCall    = u.oncall_start_date && today < u.oncall_start_date;
    const statusKey    = isTerminated ? 'left' : notStarted ? 'joining' : notOnCall ? 'onboarding' : 'active';
    const matchStatus  = filterStatus === 'all' || filterStatus === statusKey;
    return matchSearch && matchRole && matchStatus;
  });

  const selectedUser = users.find(u => u.id === selectedUserId);
  const isEditingSelected = editingUserId === selectedUserId;

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontWeight:700, letterSpacing:'-0.5px' }}>⚙️ Settings</h1>
          <div style={{ fontSize:12, color:'#64748b', marginTop:3 }}>Manager only · {users.length} team members</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {settingsTab==='team' && (<>
            <button style={HDR_BTN_SEC} onClick={()=>setShowLink(true)}>🔗 Secure Link</button>
            <button style={HDR_BTN_PRI} onClick={()=>{ setForm(BLANK_FORM); setShowAdd(true); }}>+ Add User</button>
          </>)}
          {settingsTab==='config' && (
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? '⏳ Saving…' : saved ? '✅ Saved' : '💾 Save to Drive'}
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:4, marginBottom:18, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:4, width:'fit-content', flexWrap:'wrap' }}>
        {[['team','👥 Team'],['permissions','🔐 Permissions'],['drive','📁 Drive'],['config','⚙️ Configuration']].map(([id,label])=>(
          <div key={id} onClick={()=>setSettingsTab(id)} style={{
            padding:'7px 18px', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:600,
            background:settingsTab===id?'rgba(0,194,255,0.1)':'transparent',
            color:settingsTab===id?'#00c2ff':'#64748b',
            border:settingsTab===id?'1px solid rgba(0,194,255,0.3)':'1px solid transparent',
            transition:'all 0.15s',
          }}>{label}</div>
        ))}
      </div>

      {settingsTab==='config' && error && (
        <div style={{ marginBottom:14, padding:'10px 14px', background:'rgba(239,68,68,0.10)', border:'1px solid rgba(239,68,68,0.30)', borderRadius:8, fontSize:12, color:'#fca5a5' }}>⚠️ {error}</div>
      )}

      {/* TAB: TEAM — Active Directory style                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {settingsTab==='team' && (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(300px,420px) 1fr', gap:16, alignItems:'start' }}>

          {/* Left: user list */}
          <div>
            {/* Search + filters */}
            <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
              <input placeholder="🔍 Search name, ID, email…"
                value={search} onChange={e=>setSearch(e.target.value)}
                style={{ flex:1, minWidth:140, padding:'7px 12px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#e2e8f0', fontSize:12, outline:'none' }} />
              <select value={filterRole} onChange={e=>setFilterRole(e.target.value)}
                style={SEL}>
                <option value="all">All Roles</option>
                <option value="Engineer">Engineer</option>
                <option value="Manager">Manager</option>
              </select>
              <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
                style={SEL}>
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="onboarding">Onboarding</option>
                <option value="joining">Joining</option>
                <option value="left">Left</option>
              </select>
            </div>

            {/* Stats bar */}
            <div style={{ display:'flex', gap:8, marginBottom:10, fontSize:11 }}>
              {[
                { label:`${users.filter(u=>!(u.termination_date&&today>u.termination_date)&&!(u.oncall_start_date&&today<u.oncall_start_date)&&!(u.start_date&&today<u.start_date)).length} Active`, color:'#22c55e' },
                { label:`${users.filter(u=>u.oncall_start_date&&today<u.oncall_start_date).length} Onboarding`, color:'#f59e0b' },
                { label:`${users.filter(u=>u.termination_date&&today>u.termination_date).length} Left`, color:'#ef4444' },
              ].map(s=>(
                <span key={s.label} style={{ color:s.color, background:`${s.color}12`, padding:'2px 9px', borderRadius:10, border:`1px solid ${s.color}25` }}>{s.label}</span>
              ))}
            </div>

            {/* User cards */}
            <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:'calc(100vh - 300px)', overflowY:'auto', paddingRight:4 }}>
              {filteredUsers.length === 0 && (
                <div style={{ textAlign:'center', padding:'32px 0', color:'#334155' }}>
                  <div style={{ fontSize:28, marginBottom:6 }}>🔍</div>
                  <div style={{ fontSize:13 }}>No users match your filters</div>
                </div>
              )}
              {filteredUsers.map(u => (
                <UserCard key={u.id} user={u} profilePic={profilePics?.[u.id]||u.profile_picture}
                  isSelected={selectedUserId===u.id}
                  onClick={()=>{ setSelectedUserId(u.id); setEditingUserId(null); setEditForm(BLANK_FORM); }} />
              ))}
            </div>
          </div>

          {/* Right: detail / edit panel */}
          <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:20, minHeight:320, position:'sticky', top:20 }}>
            {isEditingSelected && selectedUser ? (
              <>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                  <div style={{ fontSize:14, fontWeight:700 }}>✎ Editing: {editForm.name||selectedUser.name}</div>
                  <button onClick={()=>{setEditingUserId(null);setEditForm(BLANK_FORM);}}
                    style={{ background:'none', border:'none', color:'#64748b', fontSize:20, cursor:'pointer' }}>✕</button>
                </div>
                <UserFields
                  fv={editForm} setFv={setEditForm}
                  uid={selectedUser.id} isEdit
                  picUploading={picUploading}
                  onPicUpload={handlePicUpload}
                  driveToken={driveToken}
                />
                <div style={{ display:'flex', gap:8, marginTop:14 }}>
                  <button onClick={()=>saveEdit(selectedUser.id)}
                    style={{ flex:1, padding:'10px', background:'#00c2ff', color:'#000', border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' }}>
                    ✓ Save Changes
                  </button>
                  <button onClick={()=>{setEditingUserId(null);setEditForm(BLANK_FORM);}}
                    style={{ padding:'10px 16px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#64748b', fontSize:13, cursor:'pointer' }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <UserDetail
                user={selectedUser}
                profilePic={selectedUser ? (profilePics?.[selectedUser.id]||selectedUser.profile_picture) : null}
                isManager={isManager}
                resetPwDone={resetPwUid===selectedUserId}
                onEdit={()=>{
                  if (!selectedUser) return;
                  setEditForm({ name:selectedUser.name, trigram:selectedUser.id, role:selectedUser.role||'Engineer',
                    employment_id:selectedUser.employment_id||'', start_date:selectedUser.start_date||'',
                    oncall_start_date:selectedUser.oncall_start_date||'', termination_date:selectedUser.termination_date||'',
                    mobile_number:selectedUser.mobile_number||'', google_email:selectedUser.google_email||'',
                    profile_picture:selectedUser.profile_picture||'', avatar:selectedUser.avatar||'', color:selectedUser.color||'' });
                  setEditingUserId(selectedUser.id);
                }}
                onDelete={()=>selectedUser && deleteUser(selectedUser.id)}
                onResetPw={()=>selectedUser && resetPassword(selectedUser.id)}
              />
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: PERMISSIONS                                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {settingsTab==='permissions' && (
        <>
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}>
            <button onClick={()=>{ const u={}; users.forEach(x=>{u[x.id]=defaultPerms(x.role||'Engineer');}); setPermissions(u); if(driveToken&&driveWriteJson)driveWriteJson(driveToken,'permissions.json',u).catch(()=>{}); }}
              style={{ padding:'6px 14px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#94a3b8', fontSize:12, cursor:'pointer' }}>
              ↺ Reset All to Defaults
            </button>
          </div>
          {users.map(u => {
            const perms = getPerms(u.id);
            const enabledCount = ALL_PAGES.filter(pg=>perms[pg.id]).length;
            const isAllOn  = enabledCount===ALL_PAGES.length;
            const isAllOff = enabledCount===0;
            return (
              <div key={u.id} style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:'14px 16px', marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:8 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    {profilePics?.[u.id]||u.profile_picture
                      ? <img src={profilePics?.[u.id]||u.profile_picture} alt="" style={{ width:32, height:32, borderRadius:'50%', objectFit:'cover' }} />
                      : <div style={{ width:32, height:32, borderRadius:'50%', background:u.color||'#1d4ed8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff' }}>{u.avatar||u.name?.charAt(0)}</div>
                    }
                    <div>
                      <div style={{ fontWeight:700, fontSize:13 }}>{u.name}</div>
                      <div style={{ fontSize:11, color:'#64748b', fontFamily:'DM Mono' }}>{u.id} · {u.role||'Engineer'} · {enabledCount}/{ALL_PAGES.length} pages</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button style={PBTN} disabled={isAllOn}  onClick={()=>setAllPerms(u.id,true)}>All On</button>
                    <button style={PBTN} disabled={isAllOff} onClick={()=>setAllPerms(u.id,false)}>All Off</button>
                    <button style={PBTN} onClick={()=>applyTemplate(u.id)}>↺ Default</button>
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(165px,1fr))', gap:5 }}>
                  {ALL_PAGES.map(pg => {
                    const enabled = perms[pg.id] !== false;
                    return (
                      <label key={pg.id} onClick={()=>setUserPerm(u.id,pg.id,!enabled)}
                        style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 8px', borderRadius:6, cursor:'pointer',
                          background:enabled?'rgba(0,194,255,0.06)':'rgba(255,255,255,0.02)',
                          border:`1px solid ${enabled?'rgba(0,194,255,0.2)':'rgba(255,255,255,0.06)'}`,
                          fontSize:12, transition:'all 0.12s', userSelect:'none' }}>
                        <div style={{ width:14, height:14, borderRadius:4, flexShrink:0, border:'1.5px solid', borderColor:enabled?'#00c2ff':'#334155',
                          background:enabled?'#00c2ff':'transparent', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {enabled&&<span style={{ fontSize:9, color:'#000', fontWeight:800 }}>✓</span>}
                        </div>
                        <span style={{ color:enabled?'#e2e8f0':'#475569', flex:1 }}>{pg.label}</span>
                        {MANAGER_ONLY.has(pg.id)&&<span style={{ fontSize:9, color:'#f59e0b' }}>mgr</span>}
                      </label>
                    );
                  })}
                </div>
                {/* Coverage bar */}
                <div style={{ height:3, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden', marginTop:10 }}>
                  <div style={{ height:'100%', width:`${(enabledCount/ALL_PAGES.length)*100}%`, background:'#00c2ff', borderRadius:3, transition:'width 0.3s' }} />
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: DRIVE                                                           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {settingsTab==='drive' && (
        <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:'18px 20px', maxWidth:640 }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>📁 Google Drive & User Registry</div>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:12 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:driveToken?'#22c55e':'#ef4444', boxShadow:`0 0 6px ${driveToken?'#22c55e':'#ef4444'}` }} />
            <span style={{ fontSize:12, color:driveToken?'#22c55e':'#ef4444' }}>{driveToken?'Google Drive connected':'Not connected'}</span>
          </div>
          <p style={{ fontSize:12, color:'#64748b', marginBottom:14, lineHeight:1.6 }}>
            All app data is stored in Google Drive as JSON files. A Google Sheet <strong>"CloudOps-UserRegistry"</strong> is auto-created as the single source of truth for users.
          </p>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
            <button style={DRIVE_BTN} onClick={openSheet}>📊 Open Sheet</button>
            <button style={DRIVE_BTN} onClick={syncFromSheet} disabled={sheetSyncing}>{sheetSyncing?'⏳ Syncing…':'⬇ Sync from Sheet'}</button>
            <button style={DRIVE_BTN} onClick={pushToSheet}>⬆ Push to Sheet</button>
          </div>
          {[sheetOpenMsg, sheetMsg, pushMsg].filter(Boolean).map((m,i) => (
            <div key={i} style={{ padding:'7px 12px', borderRadius:7, fontSize:12, marginBottom:6, color:m.startsWith('✅')?'#22c55e':m.startsWith('❌')?'#ef4444':'#f59e0b', background:m.startsWith('✅')?'rgba(34,197,94,0.08)':'rgba(245,158,11,0.08)', border:`1px solid ${m.startsWith('✅')?'rgba(34,197,94,0.2)':'rgba(245,158,11,0.2)'}` }}>{m}</div>
          ))}

          {/* Secure links */}
          {(secureLinks||[]).length>0 && (
            <div style={{ marginTop:16 }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>🔗 Secure Share Links</div>
              {secureLinks.map(l => (
                <div key={l.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', gap:10, flexWrap:'wrap' }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{l.label}</div>
                    <div style={{ fontSize:10, color:'#64748b', fontFamily:'DM Mono' }}>{l.url}</div>
                    {l.expiry&&<div style={{ fontSize:10, color:'#f59e0b' }}>Expires {l.expiry}</div>}
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={()=>navigator.clipboard?.writeText(l.url)} style={DRIVE_BTN}>📋 Copy</button>
                    <button onClick={()=>setSecureLinks((secureLinks||[]).filter(x=>x.id!==l.id))} style={{ ...DRIVE_BTN, color:'#ef4444', borderColor:'rgba(239,68,68,0.25)' }}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: CONFIGURATION                                                    */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {settingsTab==='config' && (
        <div>
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
        <Row label="Maximum balance" hint="TOIL balance cap — set to 0 for no limit">
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <NumberInput value={S.toil?.maxBalanceDays ?? 0} onChange={v => upd('toil.maxBalanceDays', Math.max(0, v))} min={0} suffix="days"/>
            {(S.toil?.maxBalanceDays === 0 || !S.toil?.maxBalanceDays) && (
              <span style={{ fontSize:11, color:'#6ee7b7', fontFamily:'DM Mono' }}>No limit</span>
            )}
          </div>
        </Row>
        <Row label="TOIL expiry" hint="Unused TOIL expires after this many months — set to 0 for no expiry">
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <NumberInput value={S.toil?.expiryMonths ?? 0} onChange={v => upd('toil.expiryMonths', Math.max(0, v))} min={0} suffix="months"/>
            {(S.toil?.expiryMonths === 0 || !S.toil?.expiryMonths) && (
              <span style={{ fontSize:11, color:'#6ee7b7', fontFamily:'DM Mono' }}>No expiry</span>
            )}
          </div>
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
      )}

      {/* ── Add user slide-in modal ─────────────────────────────────────────── */}
      {showAdd && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e=>{if(e.target===e.currentTarget)setShowAdd(false);}}>
          <div style={{ background:'#0f172a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:14, padding:28, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 25px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <div style={{ fontSize:16, fontWeight:700 }}>+ Add Team Member</div>
              <button onClick={()=>setShowAdd(false)} style={{ background:'none', border:'none', color:'#64748b', fontSize:20, cursor:'pointer' }}>✕</button>
            </div>
            <UserFields fv={form} setFv={setForm} uid={null} isEdit={false}
              picUploading={picUploading} onPicUpload={handlePicUpload} driveToken={driveToken} />
            <div style={{ display:'flex', gap:8, marginTop:16 }}>
              <button onClick={add} disabled={!form.name}
                style={{ flex:1, padding:'10px', background:'#00c2ff', color:'#000', border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer', opacity:form.name?1:0.5 }}>
                ✓ Create User
              </button>
              <button onClick={()=>setShowAdd(false)}
                style={{ padding:'10px 18px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#64748b', fontSize:13, cursor:'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Secure link modal ───────────────────────────────────────────────── */}
      {showLink && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e=>{if(e.target===e.currentTarget)setShowLink(false);}}>
          <div style={{ background:'#0f172a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:14, padding:28, width:'100%', maxWidth:400, boxShadow:'0 25px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <div style={{ fontSize:16, fontWeight:700 }}>🔗 Create Secure Share Link</div>
              <button onClick={()=>setShowLink(false)} style={{ background:'none', border:'none', color:'#64748b', fontSize:20, cursor:'pointer' }}>✕</button>
            </div>
            {[['Label','text','label','e.g. External Rota View'],['Expiry Date','date','expiry',''],['Password (optional)','password','password','']].map(([lbl,type,key,ph])=>(
              <div key={key} style={{ marginBottom:12 }}>
                <label style={LBL}>{lbl}</label>
                <input className="input" type={type} placeholder={ph} value={linkForm[key]}
                  onChange={e=>setLinkForm({...linkForm,[key]:e.target.value})} />
              </div>
            ))}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 }}>
              <button onClick={()=>setShowLink(false)} style={{ padding:'8px 18px', background:'transparent', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#64748b', cursor:'pointer', fontSize:13 }}>Cancel</button>
              <button onClick={addLink} style={{ padding:'8px 22px', background:'#00c2ff', color:'#000', border:'none', borderRadius:7, fontWeight:700, fontSize:13, cursor:'pointer' }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Button style constants ────────────────────────────────────────────────────
const HDR_BTN_PRI = { padding:'9px 20px', background:'#00c2ff', color:'#000', border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer', boxShadow:'0 0 14px rgba(0,194,255,0.3)' };
const HDR_BTN_SEC = { padding:'8px 16px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#94a3b8', fontWeight:600, fontSize:13, cursor:'pointer' };
const SEL  = { background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#e2e8f0', padding:'6px 10px', fontSize:11 };
const PBTN = { padding:'4px 10px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#94a3b8', fontSize:11, cursor:'pointer' };
const DRIVE_BTN = { padding:'6px 12px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#94a3b8', fontSize:12, cursor:'pointer' };
