// src/ShiftReminders.js
// CloudOps Rota — Shift Reminders
// Shows engineers their upcoming shifts (within 24h) with open incidents and handover context
// Manager sees team-wide upcoming shift overview and can add handover notes

import React, { useState, useMemo } from 'react';

// ── Helpers ───────────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function tomorrowStr() { return addDays(todayStr(), 1); }
function londonTimeStr() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}
function fmtDate(ds) {
  if (!ds) return '—';
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const SHIFT_META = {
  daily:   { label: 'Daily Shift',           time: '09:00–18:00', icon: '☀️',  color: '#60a5fa', desc: 'Standard weekday on-site shift. Covers 9am–6pm.' },
  evening: { label: 'Weekday On-Call',        time: '19:00–07:00', icon: '🌙',  color: '#4ade80', desc: 'Weekday evening on-call. Active 7pm until 7am next day.' },
  weekend: { label: 'Weekend On-Call',        time: 'Fri 19:00 → Tue 07:00', icon: '🏖', color: '#fb923c', desc: 'Full weekend on-call. Starts Friday 7pm, ends following Tuesday 7am.' },
  bankholiday: { label: 'Bank Holiday Cover', time: '09:00–07:00', icon: '🏛',  color: '#a78bfa', desc: 'Bank holiday on-call coverage.' },
};

// Check if a shift is "upcoming" — starts within the next 24h or is ongoing
function isUpcomingShift(shift, dateStr) {
  if (!shift || shift === 'off') return false;
  const today = todayStr();
  const tomorrow = tomorrowStr();
  const now = parseInt(londonTimeStr().replace(':', ''), 10);

  if (dateStr === tomorrow) return true; // any shift tomorrow = upcoming
  if (dateStr === today) {
    // Today's shift — check if it hasn't started yet or is active
    if (shift === 'daily')   return now < 1800; // before 6pm
    if (shift === 'evening') return now < 2400;
    if (shift === 'weekend') return now < 2400;
  }
  return false;
}

// ── Shift Reminder Card ────────────────────────────────────────────────────────
function ReminderCard({ user, shift, date, incidents, handoverNotes, onAddNote, isManager, currentUser, isMine }) {
  const meta    = SHIFT_META[shift] || SHIFT_META.daily;
  const openInc = (incidents || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
  const p1p2    = openInc.filter(i => ['P1','P2','critical','high'].includes(i.priority || i.severity));
  const myNotes = (handoverNotes || []).filter(n => n.shiftDate === date && n.userId === user.id);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteText,     setNoteText]     = useState('');

  const isToday    = date === todayStr();
  const isTomorrow = date === tomorrowStr();
  const urgency    = p1p2.length > 0 ? 'critical' : openInc.length > 2 ? 'warn' : 'ok';

  return (
    <div style={{
      background: isMine ? `${meta.color}08` : 'rgba(255,255,255,0.03)',
      border: `1.5px solid ${isMine ? meta.color + '35' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 14, padding: '18px 20px', position: 'relative', overflow: 'hidden',
    }}>
      {/* Accent strip */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: meta.color, opacity: 0.6 }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `${meta.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, border: `1px solid ${meta.color}30` }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px' }}>{meta.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: `${meta.color}18`, padding: '2px 8px', borderRadius: 6, border: `1px solid ${meta.color}30`, fontFamily: 'DM Mono' }}>{meta.time}</span>
            {isToday    && <span style={{ fontSize: 10, fontWeight: 700, color: '#00c2ff', background: 'rgba(0,194,255,0.1)', padding: '2px 8px', borderRadius: 6 }}>Today</span>}
            {isTomorrow && <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: 6 }}>Tomorrow</span>}
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(date)}</div>
          {isMine && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, lineHeight: 1.4 }}>{meta.desc}</div>}
          {!isMine && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: user.color || '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff' }}>{user.name.charAt(0)}</div>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>{user.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Open incidents section */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
          🚨 Open Incidents ({openInc.length})
          {p1p2.length > 0 && <span style={{ marginLeft: 6, color: '#ef4444', background: 'rgba(239,68,68,0.12)', padding: '1px 6px', borderRadius: 4 }}>{p1p2.length} P1/P2</span>}
        </div>
        {openInc.length === 0 ? (
          <div style={{ fontSize: 12, color: '#22c55e', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 7, padding: '7px 12px' }}>
            ✅ No open incidents — clean handover
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {openInc.slice(0, 5).map(inc => {
              const sev = inc.priority || inc.severity || 'P3';
              const sevColor = ['P1','critical'].includes(sev) ? '#ef4444' : ['P2','high'].includes(sev) ? '#f59e0b' : ['P3','medium'].includes(sev) ? '#60a5fa' : '#475569';
              return (
                <div key={inc.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', background: `${sevColor}0a`, border: `1px solid ${sevColor}25`, borderRadius: 7 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: sevColor, background: `${sevColor}18`, padding: '1px 6px', borderRadius: 4, flexShrink: 0, fontFamily: 'DM Mono', marginTop: 1 }}>{sev}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.title}</div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                      {inc.status && <span style={{ marginRight: 8 }}>Status: {inc.status}</span>}
                      {inc.assigned_to && <span>Assigned: {inc.assigned_to}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {openInc.length > 5 && <div style={{ fontSize: 11, color: '#475569', paddingLeft: 4 }}>+ {openInc.length - 5} more incidents…</div>}
          </div>
        )}
      </div>

      {/* Handover notes */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            📝 Handover Notes
          </div>
          {(isMine || isManager) && (
            <button onClick={() => setShowNoteForm(p => !p)}
              style={{ padding: '3px 10px', background: 'rgba(0,194,255,0.08)', border: '1px solid rgba(0,194,255,0.25)', borderRadius: 5, color: '#00c2ff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
              {showNoteForm ? '✕ Cancel' : '+ Add Note'}
            </button>
          )}
        </div>

        {showNoteForm && (
          <div style={{ marginBottom: 10 }}>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3}
              placeholder="e.g. DB migration running — monitor query times. Escalation contact: John on +44 7700 000000"
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#e2e8f0', fontSize: 12, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowNoteForm(false); setNoteText(''); }}
                style={{ padding: '5px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#64748b', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { if (noteText.trim()) { onAddNote({ id: 'n'+Date.now(), userId: user.id, shiftDate: date, text: noteText, by: currentUser, at: new Date().toISOString() }); setNoteText(''); setShowNoteForm(false); }}}
                style={{ padding: '5px 14px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Save Note
              </button>
            </div>
          </div>
        )}

        {myNotes.length === 0 && !showNoteForm ? (
          <div style={{ fontSize: 12, color: '#334155', fontStyle: 'italic' }}>No handover notes yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {myNotes.map(n => (
              <div key={n.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 7, padding: '8px 12px' }}>
                <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.5 }}>{n.text}</div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>— {n.by} · {fmtDateTime(n.at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Notification Banner (used in App shell) ───────────────────────────────────
export function ShiftReminderBanner({ rota, currentUser, incidents, onDismiss, dismissed }) {
  const today    = todayStr();
  const tomorrow = tomorrowStr();
  const upcoming = [];

  [today, tomorrow].forEach(date => {
    const shift = rota?.[currentUser]?.[date];
    if (shift && shift !== 'off' && isUpcomingShift(shift, date)) {
      upcoming.push({ date, shift });
    }
  });

  const visible = upcoming.filter(s => !dismissed?.includes(`${currentUser}-${s.date}-${s.shift}`));
  if (visible.length === 0) return null;

  const meta = SHIFT_META[visible[0].shift] || SHIFT_META.daily;
  const openInc = (incidents || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
  const p1p2 = openInc.filter(i => ['P1','P2','critical','high'].includes(i.priority || i.severity));

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 16px',
      background: `${meta.color}10`, border: `1px solid ${meta.color}35`, borderRadius: 10,
      marginBottom: 14, animation: 'slideDown 0.25s ease',
    }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>{meta.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: meta.color, marginBottom: 2 }}>
          {visible[0].date === today ? 'Shift active now' : 'Shift reminder — tomorrow'}: {meta.label} ({meta.time})
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          {p1p2.length > 0
            ? <span style={{ color: '#ef4444' }}>🚨 {p1p2.length} P1/P2 incident{p1p2.length > 1 ? 's' : ''} open · </span>
            : openInc.length > 0
              ? <span>{openInc.length} open incident{openInc.length > 1 ? 's' : ''} · </span>
              : <span style={{ color: '#22c55e' }}>✅ No open incidents · </span>
          }
          Go to <strong>Time Keeping → Shift Reminders</strong> for full handover notes.
        </div>
      </div>
      <button onClick={() => onDismiss?.(`${currentUser}-${visible[0].date}-${visible[0].shift}`)}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>
        ✕
      </button>
    </div>
  );
}

// ── Main ShiftReminders Component ─────────────────────────────────────────────
export default function ShiftReminders({ rota, users, incidents, currentUser, isManager, handoverNotes, setHandoverNotes }) {
  const [viewUser,   setViewUser]   = useState(currentUser);
  const [lookAhead,  setLookAhead]  = useState(7); // days to look ahead

  const engineers = useMemo(() => users.filter(u => !u.isManager), [users]);
  const today     = todayStr();

  // Build upcoming shifts for a user over the next N days
  const getUpcomingShifts = (userId) => {
    const shifts = [];
    for (let i = 0; i <= lookAhead; i++) {
      const date  = addDays(today, i);
      const shift = rota?.[userId]?.[date];
      if (shift && shift !== 'off') {
        shifts.push({ date, shift });
      }
    }
    return shifts;
  };

  // For manager: all engineers' upcoming shifts
  const teamShifts = useMemo(() => {
    return engineers.flatMap(u =>
      getUpcomingShifts(u.id).map(s => ({ ...s, user: u }))
    ).sort((a, b) => a.date.localeCompare(b.date));
  }, [engineers, rota, lookAhead, today]); // eslint-disable-line

  // For engineer: their own upcoming shifts
  const myShifts = getUpcomingShifts(currentUser);

  const addNote = (note) => {
    setHandoverNotes(prev => [...(prev || []), note]);
  };

  const openInc  = (incidents || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
  const safeNotes = handoverNotes || [];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px' }}>🔔 Shift Reminders</h1>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
            Upcoming shifts · open incidents · handover notes
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>Look ahead:</span>
          <select value={lookAhead} onChange={e => setLookAhead(+e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', padding: '5px 10px', fontSize: 12 }}>
            {[3,5,7,14].map(n => <option key={n} value={n}>{n} days</option>)}
          </select>
        </div>
      </div>

      {/* ── Open incidents summary bar ─────────────────────────────────────── */}
      {openInc.length > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 16px', background: openInc.filter(i=>['P1','P2','critical','high'].includes(i.priority||i.severity)).length>0?'rgba(239,68,68,0.08)':'rgba(245,158,11,0.06)', border: `1px solid ${openInc.filter(i=>['P1','P2','critical','high'].includes(i.priority||i.severity)).length>0?'rgba(239,68,68,0.25)':'rgba(245,158,11,0.2)'}`, borderRadius: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18 }}>🚨</span>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 13, color: '#fca5a5' }}>{openInc.length} open incident{openInc.length>1?'s':''}</strong>
            {openInc.filter(i=>['P1','P2','critical','high'].includes(i.priority||i.severity)).length>0 &&
              <span style={{ color: '#ef4444', marginLeft: 8, fontSize: 12 }}>— including {openInc.filter(i=>['P1','P2','critical','high'].includes(i.priority||i.severity)).length} P1/P2</span>
            }
            <span style={{ color: '#64748b', marginLeft: 8, fontSize: 12 }}>Incoming on-call engineers should be aware of these before their shift starts.</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {openInc.slice(0,3).map(inc => {
              const sev = inc.priority || inc.severity || 'P3';
              const sevColor = ['P1','critical'].includes(sev)?'#ef4444':['P2','high'].includes(sev)?'#f59e0b':'#60a5fa';
              return <span key={inc.id} style={{ fontSize: 10, fontWeight: 700, color: sevColor, background: `${sevColor}15`, padding: '2px 8px', borderRadius: 4, border: `1px solid ${sevColor}25`, fontFamily: 'DM Mono' }}>{sev}: {inc.title?.slice(0,20)}{inc.title?.length>20?'…':''}</span>;
            })}
          </div>
        </div>
      )}

      {/* ── Manager: team view ──────────────────────────────────────────────── */}
      {isManager && (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, letterSpacing: '-0.3px' }}>
            Team Upcoming Shifts — Next {lookAhead} Days
          </div>
          {teamShifts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#334155' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📅</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No shifts in the next {lookAhead} days</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              {teamShifts.map(({ date, shift, user }) => (
                <ReminderCard key={`${user.id}-${date}`}
                  user={user} shift={shift} date={date}
                  incidents={openInc} handoverNotes={safeNotes}
                  onAddNote={addNote} isManager={isManager}
                  currentUser={currentUser} isMine={false} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Engineer: my upcoming shifts ────────────────────────────────────── */}
      {!isManager && (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, letterSpacing: '-0.3px' }}>
            Your Upcoming Shifts
          </div>
          {myShifts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#334155' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No shifts in the next {lookAhead} days</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>Check back closer to your next scheduled on-call</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {myShifts.map(({ date, shift }) => (
                <ReminderCard key={date}
                  user={users.find(u => u.id === currentUser) || { id: currentUser, name: currentUser }}
                  shift={shift} date={date}
                  incidents={openInc} handoverNotes={safeNotes}
                  onAddNote={addNote} isManager={isManager}
                  currentUser={currentUser} isMine />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
