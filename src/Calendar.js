// src/Calendar.js 06th May 2026
// CloudOps Rota — Outlook-style Calendar
// Views: Month · Week · Day · Agenda
// Named calendars: create, colour-code, share or keep private
// Manager: private events + all calendar management
// Engineer: read-only view of shared/team calendars only

import React, { useState, useMemo, useCallback } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────
const DAYS_SHORT  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAYS_LONG   = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT= ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Default system calendars — always present
const DEFAULT_CALENDARS = [
  { id:'sys-rota',     name:'On-Call Rota',   color:'#166534', visibility:'team',    editable:false, icon:'📡' },
  { id:'sys-holidays', name:'Holidays',        color:'#92400e', visibility:'team',    editable:false, icon:'🌴' },
  { id:'sys-bh',       name:'Bank Holidays',   color:'#7f1d1d', visibility:'team',    editable:false, icon:'🏛' },
  { id:'sys-absences', name:'Absences',        color:'#0e7490', visibility:'team',    editable:false, icon:'🏥' },
  { id:'sys-upgrades', name:'Upgrades',        color:'#991b1b', visibility:'team',    editable:false, icon:'⬆' },
];

const CALENDAR_COLORS = [
  '#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#10b981',
  '#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899',
  '#64748b','#0ea5e9','#14b8a6','#d946ef',
];

const PRIVATE_CATEGORIES = [
  { id:'family',    label:'Family Emergency',    icon:'👨‍👩‍👦', color:'#ef4444' },
  { id:'sick',      label:'Sick',                icon:'🤒',  color:'#f97316' },
  { id:'doctor',    label:'Doctor Appointment',  icon:'🏥',  color:'#06b6d4' },
  { id:'dental',    label:'Dental Appointment',  icon:'🦷',  color:'#06b6d4' },
  { id:'car',       label:'Car Issue',           icon:'🚗',  color:'#8b5cf6' },
  { id:'personal',  label:'Personal Appointment',icon:'📌',  color:'#ec4899' },
  { id:'wfh',       label:'Working from Home',   icon:'🏠',  color:'#3b82f6' },
  { id:'travel',    label:'Travel',              icon:'✈️',  color:'#0ea5e9' },
  { id:'training',  label:'Training',            icon:'📚',  color:'#10b981' },
  { id:'meeting',   label:'Meeting',             icon:'🗓',  color:'#f59e0b' },
  { id:'other',     label:'Other',               icon:'📝',  color:'#6b7280' },
];

const TEAM_CATEGORIES = [
  { id:'team_meeting', label:'Team Meeting',     icon:'👥',  color:'#6366f1' },
  { id:'maintenance',  label:'Maintenance',      icon:'🔧',  color:'#a78bfa' },
  { id:'release',      label:'Release',          icon:'🚀',  color:'#10b981' },
  { id:'deadline',     label:'Deadline',         icon:'⏰',  color:'#ef4444' },
  { id:'review',       label:'Review',           icon:'📋',  color:'#f59e0b' },
];

const SHIFT_COLORS = {
  daily:       { bg:'#1e40af', text:'#bfdbfe', label:'Daily Shift'       },
  evening:     { bg:'#166534', text:'#bbf7d0', label:'Weekday On-Call'   },
  weekend:     { bg:'#854d0e', text:'#fef08a', label:'Weekend On-Call'   },
  bankholiday: { bg:'#7f1d1d', text:'#fca5a5', label:'Bank Holiday'      },
  upgrade:     { bg:'#991b1b', text:'#fecaca', label:'Upgrade'           },
};

// ── Date helpers ──────────────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }
function dateStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function addDays(ds, n) { const d=new Date(ds+'T12:00:00'); d.setDate(d.getDate()+n); return dateStr(d); }
function weekStart(ds) { const d=new Date(ds+'T12:00:00'); const dow=d.getDay(); d.setDate(d.getDate()+(dow===0?-6:1-dow)); return dateStr(d); }
function daysInMonth(y,m) { return new Date(y,m+1,0).getDate(); }
function parseTimeToMins(t) { if(!t)return 0; const [h,m]=t.split(':').map(Number); return h*60+(m||0); }
function minsToTime(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }
function fmtDateLong(ds) { const d=new Date(ds+'T12:00:00'); return d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
function fmtDateShort(ds) { const d=new Date(ds+'T12:00:00'); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}); }

const HOURS = Array.from({length:24},(_,i)=>i);
const BLANK_EVENT = { title:'', calendarId:'', category:'meeting', date:todayStr(), startTime:'09:00', endTime:'10:00', allDay:false, notes:'', isPrivate:false, targetUser:'' };
const BLANK_CAL   = { name:'', color:'#3b82f6', visibility:'team', description:'' };

// ── Inline Modal ──────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:'#0f172a',border:'1px solid rgba(255,255,255,0.1)',borderRadius:14,padding:28,width:'100%',maxWidth:wide?640:490,maxHeight:'92vh',overflowY:'auto',boxShadow:'0 25px 60px rgba(0,0,0,0.6)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <div style={{fontSize:16,fontWeight:700}}>{title}</div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#64748b',fontSize:20,cursor:'pointer'}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const IS  = {width:'100%',boxSizing:'border-box',padding:'8px 12px',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#e2e8f0',fontSize:13,outline:'none',fontFamily:'inherit'};
const LBL = {display:'block',fontSize:11,color:'#64748b',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.4px'};

// ── Visibility badge ──────────────────────────────────────────────────────────
const VIS_META = {
  private: { label:'Private',     icon:'🔒', color:'#f59e0b', desc:'Only visible to you (manager)' },
  team:    { label:'Team',        icon:'👥', color:'#22c55e', desc:'Visible to all team members'   },
  shared:  { label:'Shared',      icon:'🔗', color:'#60a5fa', desc:'Visible to selected engineers' },
};

// ── Event pill ────────────────────────────────────────────────────────────────
function EventPill({ event, onClick, compact, calColor }) {
  const cat  = [...PRIVATE_CATEGORIES,...TEAM_CATEGORIES].find(c=>c.id===event.category);
  const sCol = event.shiftType ? SHIFT_COLORS[event.shiftType] : null;
  const col  = sCol ? sCol.text : calColor || cat?.color || '#a5b4fc';
  const bg   = sCol ? sCol.bg+'88' : (calColor || cat?.color || '#6366f1')+'33';
  const bdr  = sCol ? sCol.bg+'aa' : (calColor || cat?.color || '#6366f1')+'66';

  return (
    <div onClick={e=>{e.stopPropagation();onClick&&onClick(event);}}
      title={event.title}
      style={{background:bg,border:`1px solid ${bdr}`,borderLeft:`3px solid ${col}`,borderRadius:compact?3:4,
        padding:compact?'1px 4px':'3px 7px',fontSize:compact?9:10,fontWeight:600,color:col,cursor:'pointer',
        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:1,lineHeight:1.4,
        transition:'filter 0.1s',display:'flex',alignItems:'center',gap:3}}
      onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.2)'}
      onMouseLeave={e=>e.currentTarget.style.filter=''}>
      {cat?.icon && <span style={{fontSize:compact?8:10,flexShrink:0}}>{cat.icon}</span>}
      <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{event.title}</span>
      {event.startTime && !event.allDay && !compact && <span style={{opacity:0.7,marginLeft:'auto',flexShrink:0,fontFamily:'DM Mono'}}>{event.startTime}</span>}
    </div>
  );
}

// ── Calendar sidebar panel ────────────────────────────────────────────────────
function CalendarSidebar({ allCals, enabledCals, setEnabledCals, isManager, onAddCal, onEditCal, onDeleteCal }) {
  const [collapsed, setCollapsed] = useState({ system:false, custom:false });

  const sysCals    = DEFAULT_CALENDARS;
  const customCals = allCals.filter(c=>!c.isSystem);

  const toggle = (id) => setEnabledCals(prev =>
    prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]
  );

  const SidebarGroup = ({ title, items, key2 }) => (
    <div style={{marginBottom:12}}>
      <div onClick={()=>setCollapsed(p=>({...p,[key2]:!p[key2]}))}
        style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 0',cursor:'pointer',marginBottom:4}}>
        <span style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.6px'}}>{title}</span>
        <span style={{fontSize:10,color:'#475569'}}>{collapsed[key2]?'▶':'▼'}</span>
      </div>
      {!collapsed[key2] && items.map(cal=>{
        const vm   = VIS_META[cal.visibility] || VIS_META.team;
        const isOn = enabledCals.includes(cal.id);
        return (
          <div key={cal.id} style={{display:'flex',alignItems:'center',gap:7,padding:'4px 2px',borderRadius:6,marginBottom:1,
            background:'transparent',transition:'background 0.1s',cursor:'pointer'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            {/* Colour checkbox */}
            <div onClick={()=>toggle(cal.id)}
              style={{width:14,height:14,borderRadius:3,background:isOn?cal.color:'transparent',border:`2px solid ${cal.color}`,flexShrink:0,cursor:'pointer',transition:'all 0.12s',display:'flex',alignItems:'center',justifyContent:'center'}}>
              {isOn && <span style={{fontSize:8,color:'#fff',fontWeight:900,lineHeight:1}}>✓</span>}
            </div>
            {/* Name */}
            <div style={{flex:1,minWidth:0}} onClick={()=>toggle(cal.id)}>
              <div style={{fontSize:12,fontWeight:500,color:isOn?'var(--text-primary)':'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',transition:'color 0.12s'}}>
                {cal.icon||'📅'} {cal.name}
              </div>
              <div style={{fontSize:9,color:'#334155',display:'flex',alignItems:'center',gap:3}}>
                <span>{vm.icon}</span><span>{vm.label}</span>
              </div>
            </div>
            {/* Edit/delete for custom cals */}
            {isManager && !cal.isSystem && cal.editable!==false && (
              <div style={{display:'flex',gap:3,flexShrink:0,opacity:0,transition:'opacity 0.1s'}}
                onMouseEnter={e=>e.currentTarget.style.opacity=1}
                onMouseLeave={e=>e.currentTarget.style.opacity=0}
                onClick={e=>e.stopPropagation()}>
                <button onClick={()=>onEditCal(cal)} title="Edit calendar"
                  style={{background:'none',border:'none',color:'#64748b',fontSize:11,cursor:'pointer',padding:'1px 3px',borderRadius:3}}>✏</button>
                <button onClick={()=>onDeleteCal(cal.id)} title="Delete calendar"
                  style={{background:'none',border:'none',color:'#ef4444',fontSize:11,cursor:'pointer',padding:'1px 3px',borderRadius:3}}>✕</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{width:200,flexShrink:0,borderRight:'1px solid var(--border)',padding:'12px 10px',display:'flex',flexDirection:'column',gap:0,overflowY:'auto',background:'rgba(255,255,255,0.01)'}}>
      {/* Add calendar button */}
      {isManager && (
        <button onClick={onAddCal}
          style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'7px 10px',background:'rgba(0,194,255,0.07)',border:'1px solid rgba(0,194,255,0.2)',borderRadius:7,color:'var(--accent)',fontSize:12,fontWeight:700,cursor:'pointer',marginBottom:16,transition:'background 0.15s'}}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(0,194,255,0.12)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(0,194,255,0.07)'}>
          <span style={{fontSize:16,lineHeight:1}}>+</span> Add Calendar
        </button>
      )}

      <SidebarGroup title="System" items={sysCals} key2="system" />
      {customCals.length > 0 && <SidebarGroup title="My Calendars" items={customCals} key2="custom" />}

      {/* Legend */}
      <div style={{marginTop:'auto',paddingTop:12,borderTop:'1px solid rgba(255,255,255,0.05)'}}>
        {Object.entries(VIS_META).map(([k,v])=>(
          <div key={k} style={{display:'flex',alignItems:'center',gap:5,fontSize:10,color:'#334155',marginBottom:3}}>
            <span>{v.icon}</span><span>{v.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Calendar Component ───────────────────────────────────────────────────
export default function Calendar({
  users, rota, holidays, upgrades, absences, incidents,
  UK_BANK_HOLIDAYS, currentUser, isManager,
  calendarEvents, setCalendarEvents,
  userCalendars, setUserCalendars,
}) {
  const [view,        setView]        = useState('month');
  const [cur,         setCur]         = useState(() => { const d=new Date(); d.setDate(1); return d; });
  const [curDay,      setCurDay]      = useState(todayStr());
  const [showModal,   setShowModal]   = useState(false);
  const [editEvent,   setEditEvent]   = useState(null);
  const [form,        setForm]        = useState(BLANK_EVENT);
  const [selected,    setSelected]    = useState(null);
  const [filterUser,  setFilterUser]  = useState('all');
  // Calendar management
  const [showCalModal, setShowCalModal] = useState(false);
  const [editCal,      setEditCal]     = useState(null);
  const [calForm,      setCalForm]     = useState(BLANK_CAL);
  // Which calendars are enabled (visible) — default all on
  const allCustomCals = useMemo(()=>Array.isArray(userCalendars)?userCalendars:[], [userCalendars]);
  const allCalIds     = useMemo(()=>[...DEFAULT_CALENDARS.map(c=>c.id),...allCustomCals.map(c=>c.id)],[allCustomCals]);
  const [enabledCals, setEnabledCals] = useState(allCalIds);
  // Keep enabledCals in sync when new calendars are added
  React.useEffect(()=>{
    setEnabledCals(prev=>{
      const newIds=allCalIds.filter(id=>!prev.includes(id));
      return newIds.length>0?[...prev,...newIds]:prev;
    });
  },[allCalIds]);

  const safe  = useMemo(()=>Array.isArray(calendarEvents)?calendarEvents:[], [calendarEvents]);
  const yr    = cur.getFullYear();
  const mo    = cur.getMonth();
  const today = todayStr();
  const bh    = useMemo(()=>(UK_BANK_HOLIDAYS||[]).map(b=>b.date||b),[UK_BANK_HOLIDAYS]);

  // Resolve calendar colour for an event
  const getCalColor = useCallback((ev) => {
    if (ev.shiftType) return SHIFT_COLORS[ev.shiftType]?.text;
    if (ev.calendarId) {
      const cal = allCustomCals.find(c=>c.id===ev.calendarId);
      return cal?.color;
    }
    const cat = [...PRIVATE_CATEGORIES,...TEAM_CATEGORIES].find(c=>c.id===ev.category);
    return cat?.color;
  },[allCustomCals]);

  // Check if a calendar is visible
  const calVisible = useCallback((calId) => enabledCals.includes(calId), [enabledCals]);

  // ── Get all events for a date ─────────────────────────────────────────────
  const getEventsForDate = useCallback((ds, userId) => {
    const events = [];

    if (calVisible('sys-bh')) {
      const bhEntry = (UK_BANK_HOLIDAYS||[]).find(b=>(b.date||b)===ds);
      if (bhEntry) events.push({ id:'bh-'+ds, title:bhEntry.name||bhEntry.title||'Bank Holiday', type:'bankholiday', date:ds, allDay:true, shiftType:'bankholiday', isSystem:true, calendarId:'sys-bh' });
    }

    if (calVisible('sys-rota')) {
      const targets = userId ? [users.find(u=>u.id===userId)].filter(Boolean) : users;
      targets.forEach(u => {
        const s = rota?.[u.id]?.[ds];
        if (s && s !== 'off') {
          events.push({ id:`rota-${u.id}-${ds}`, title:`${u.name.split(' ')[0]} — ${SHIFT_COLORS[s]?.label||s}`, type:'rota', date:ds, allDay:false, shiftType:s, userId:u.id, isSystem:true, calendarId:'sys-rota',
            startTime: s==='daily'?'09:00':'19:00', endTime: s==='daily'?'18:00':'07:00' });
        }
      });
    }

    if (calVisible('sys-holidays')) {
      (holidays||[]).filter(h=>ds>=h.start&&ds<=(h.end||h.start)&&(userId?h.userId===userId:true)).forEach(h=>{
        const u=users.find(x=>x.id===h.userId);
        events.push({ id:'hol-'+h.id+'-'+ds, title:`🌴 ${u?.name?.split(' ')[0]||h.userId} — Holiday`, type:'holiday', date:ds, allDay:true, isSystem:true, calendarId:'sys-holidays' });
      });
    }

    if (calVisible('sys-absences')) {
      (absences||[]).filter(a=>ds>=a.start&&ds<=(a.end||a.start)&&(userId?a.userId===userId:true)).forEach(a=>{
        const u=users.find(x=>x.id===a.userId);
        events.push({ id:'abs-'+a.id+'-'+ds, title:`🏥 ${u?.name?.split(' ')[0]||a.userId} — Absent`, type:'absence', date:ds, allDay:true, isSystem:true, calendarId:'sys-absences' });
      });
    }

    if (calVisible('sys-upgrades')) {
      (upgrades||[]).filter(u=>u.date===ds).forEach(u=>{
        events.push({ id:'upg-'+u.id, title:`⬆ ${u.name||u.title||'Upgrade'}`, type:'upgrade', date:ds, allDay:false, shiftType:'upgrade', isSystem:true, calendarId:'sys-upgrades', startTime:'22:00', endTime:'06:00' });
      });
    }

    // Custom events
    safe.filter(e=>e.date===ds).forEach(e=>{
      if (e.isPrivate && !isManager) return;
      if (filterUser !== 'all' && e.targetUser && e.targetUser !== filterUser) return;
      // Check calendar visibility
      if (e.calendarId) {
        const cal = allCustomCals.find(c=>c.id===e.calendarId);
        if (cal && !calVisible(cal.id)) return;
        if (cal && cal.visibility==='private' && !isManager) return;
      }
      events.push(e);
    });

    return events;
  }, [rota, holidays, absences, upgrades, safe, users, UK_BANK_HOLIDAYS, isManager, filterUser, calVisible, allCustomCals]);

  // ── Calendar CRUD ─────────────────────────────────────────────────────────
  const saveCal = () => {
    if (!calForm.name.trim()) return;
    if (editCal) {
      setUserCalendars(allCustomCals.map(c=>c.id===editCal.id?{...c,...calForm}:c));
    } else {
      const newCal = { id:'cal-'+Date.now(), ...calForm, createdBy:currentUser, createdAt:new Date().toISOString() };
      setUserCalendars([...allCustomCals, newCal]);
    }
    setShowCalModal(false); setEditCal(null); setCalForm(BLANK_CAL);
  };

  const deleteCal = (id) => {
    if (!window.confirm('Delete this calendar? Events in it will also be deleted.')) return;
    setUserCalendars(allCustomCals.filter(c=>c.id!==id));
    setCalendarEvents(safe.filter(e=>e.calendarId!==id));
    setEnabledCals(p=>p.filter(x=>x!==id));
  };

  const openEditCal = (cal) => {
    setCalForm({ name:cal.name, color:cal.color, visibility:cal.visibility, description:cal.description||'' });
    setEditCal(cal);
    setShowCalModal(true);
  };

  // ── Event CRUD ────────────────────────────────────────────────────────────
  const saveEvent = () => {
    if (!form.title.trim() || !form.date) return;
    const ev = { ...form, id:editEvent?.id||'ev-'+Date.now(), createdBy:currentUser, createdAt:editEvent?.createdAt||new Date().toISOString() };
    if (editEvent) setCalendarEvents(safe.map(e=>e.id===editEvent.id?ev:e));
    else setCalendarEvents([...safe, ev]);
    setShowModal(false); setEditEvent(null); setForm(BLANK_EVENT);
  };

  const deleteEvent = (id) => {
    if (!window.confirm('Delete this event?')) return;
    setCalendarEvents(safe.filter(e=>e.id!==id));
    setSelected(null);
  };

  const openNew = (date, prefill={}) => {
    const defaultCalId = allCustomCals.find(c=>c.visibility!=='private'||isManager)?.id || '';
    setForm({...BLANK_EVENT, date:date||todayStr(), calendarId:defaultCalId, ...prefill});
    setEditEvent(null); setShowModal(true);
  };

  const openEditEvent = (ev) => {
    setForm({...ev}); setEditEvent(ev); setShowModal(true); setSelected(null);
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToday = () => { const d=new Date(); d.setDate(1); setCur(d); setCurDay(todayStr()); };
  const goPrev = () => {
    if (view==='month') setCur(new Date(yr,mo-1,1));
    else if (view==='week') setCurDay(addDays(curDay,-7));
    else setCurDay(addDays(curDay,-1));
  };
  const goNext = () => {
    if (view==='month') setCur(new Date(yr,mo+1,1));
    else if (view==='week') setCurDay(addDays(curDay,7));
    else setCurDay(addDays(curDay,1));
  };
  const navLabel = () => {
    if (view==='month') return `${MONTHS[mo]} ${yr}`;
    if (view==='week')  { const ws=weekStart(curDay); return `${fmtDateShort(ws)} – ${fmtDateShort(addDays(ws,6))} ${new Date(ws+'T12:00:00').getFullYear()}`; }
    if (view==='day')   return fmtDateLong(curDay);
    return 'Agenda';
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MONTH VIEW
  // ══════════════════════════════════════════════════════════════════════════
  const MonthView = () => {
    const first   = new Date(yr,mo,1);
    const startDow= (first.getDay()+6)%7;
    const dim     = daysInMonth(yr,mo);
    const cells   = [...Array(startDow).fill(null),...Array.from({length:dim},(_,i)=>i+1)];
    while (cells.length%7!==0) cells.push(null);

    return (
      <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',background:'var(--bg-card2)',borderBottom:'1px solid var(--border)'}}>
          {DAYS_SHORT.map((d,i)=>(
            <div key={d} style={{padding:'8px 4px',textAlign:'center',fontSize:11,fontWeight:700,fontFamily:'DM Mono',color:i>=5?'#f59e0b':'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>{d}</div>
          ))}
        </div>
        <div style={{flex:1,display:'grid',gridTemplateColumns:'repeat(7,1fr)',gridAutoRows:'1fr',gap:1,background:'var(--border)',overflow:'auto'}}>
          {cells.map((day,i)=>{
            if (!day) return <div key={'e'+i} style={{background:'var(--bg)',opacity:0.3}} />;
            const ds   = `${yr}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isT  = ds===today;
            const isBH = bh.includes(ds);
            const isWE = new Date(ds+'T12:00:00').getDay()===0||new Date(ds+'T12:00:00').getDay()===6;
            const evs  = getEventsForDate(ds,filterUser==='all'?null:filterUser);
            return (
              <div key={ds} onClick={()=>isManager&&openNew(ds)}
                style={{background:isT?'rgba(0,194,255,0.06)':isBH?'rgba(127,29,29,0.12)':isWE?'rgba(255,255,255,0.01)':'var(--bg-card)',padding:'5px 6px',cursor:isManager?'pointer':'default',minHeight:90,position:'relative',transition:'background 0.1s'}}
                onMouseEnter={e=>{if(isManager)e.currentTarget.style.background=isT?'rgba(0,194,255,0.1)':'rgba(255,255,255,0.03)';}}
                onMouseLeave={e=>{e.currentTarget.style.background=isT?'rgba(0,194,255,0.06)':isBH?'rgba(127,29,29,0.12)':isWE?'rgba(255,255,255,0.01)':'var(--bg-card)';}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
                  <div style={{width:22,height:22,borderRadius:'50%',background:isT?'var(--accent)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:isT?800:600,color:isT?'#000':isBH?'#fca5a5':isWE?'#64748b':'var(--text-secondary)',fontFamily:'DM Mono'}}>{day}</div>
                  {isBH&&<div style={{fontSize:8,color:'#fca5a5',maxWidth:58,textAlign:'right',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(UK_BANK_HOLIDAYS||[]).find(b=>(b.date||b)===ds)?.name?.slice(0,10)||'BH'}</div>}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:1,overflow:'hidden',maxHeight:60}}>
                  {evs.slice(0,4).map(ev=><EventPill key={ev.id} event={ev} compact onClick={()=>setSelected(ev)} calColor={getCalColor(ev)} />)}
                  {evs.length>4&&<div style={{fontSize:9,color:'var(--text-muted)',paddingLeft:2}}>+{evs.length-4} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════════════
  // WEEK VIEW
  // ══════════════════════════════════════════════════════════════════════════
  const WeekView = () => {
    const ws      = weekStart(curDay);
    const weekDays= Array.from({length:7},(_,i)=>addDays(ws,i));
    const timeCol = 52;
    return (
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:`${timeCol}px repeat(7,1fr)`,borderBottom:'1px solid var(--border)',background:'var(--bg-card2)',flexShrink:0}}>
          <div style={{padding:'8px',borderRight:'1px solid var(--border)'}} />
          {weekDays.map(ds=>{
            const d=new Date(ds+'T12:00:00'); const isT=ds===today; const isBH=bh.includes(ds); const isWE=d.getDay()===0||d.getDay()===6;
            return (
              <div key={ds} style={{padding:'8px 4px',textAlign:'center',borderRight:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>{setCurDay(ds);setView('day');}}>
                <div style={{fontSize:10,color:isBH?'#fca5a5':isWE?'#f59e0b':'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.4px'}}>{DAYS_SHORT[d.getDay()===0?6:d.getDay()-1]}</div>
                <div style={{width:26,height:26,borderRadius:'50%',background:isT?'var(--accent)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',margin:'2px auto 0',fontSize:13,fontWeight:isT?800:600,color:isT?'#000':isWE?'#94a3b8':'var(--text-primary)',fontFamily:'DM Mono'}}>{d.getDate()}</div>
                {isBH&&<div style={{fontSize:8,color:'#fca5a5',marginTop:1}}>{(UK_BANK_HOLIDAYS||[]).find(b=>(b.date||b)===ds)?.name?.slice(0,8)||'BH'}</div>}
              </div>
            );
          })}
        </div>
        {/* All-day row */}
        <div style={{display:'grid',gridTemplateColumns:`${timeCol}px repeat(7,1fr)`,borderBottom:'1px solid var(--border)',background:'rgba(255,255,255,0.02)',flexShrink:0,minHeight:32}}>
          <div style={{padding:'6px 4px',fontSize:9,color:'var(--text-muted)',textAlign:'right',borderRight:'1px solid var(--border)',lineHeight:1.2}}>ALL<br/>DAY</div>
          {weekDays.map(ds=>{
            const allDay=getEventsForDate(ds,filterUser==='all'?null:filterUser).filter(e=>e.allDay);
            return (<div key={ds} style={{borderRight:'1px solid var(--border)',padding:'3px 3px',overflow:'hidden'}}>{allDay.map(ev=><EventPill key={ev.id} event={ev} compact onClick={()=>setSelected(ev)} calColor={getCalColor(ev)} />)}</div>);
          })}
        </div>
        {/* Hourly */}
        <div style={{flex:1,overflowY:'auto'}}>
          <div style={{display:'grid',gridTemplateColumns:`${timeCol}px repeat(7,1fr)`,position:'relative'}}>
            <div>{HOURS.map(h=>(<div key={h} style={{height:48,borderBottom:'1px solid rgba(255,255,255,0.04)',borderRight:'1px solid var(--border)',display:'flex',alignItems:'flex-start',padding:'2px 6px',justifyContent:'flex-end'}}><span style={{fontSize:9,color:'var(--text-muted)',fontFamily:'DM Mono',marginTop:-6}}>{h===0?'':String(h).padStart(2,'0')+':00'}</span></div>))}</div>
            {weekDays.map(ds=>{
              const isCurDay=ds===curDay;
              const evs=getEventsForDate(ds,filterUser==='all'?null:filterUser).filter(e=>!e.allDay&&e.startTime);
              return (
                <div key={ds} style={{position:'relative',borderRight:'1px solid var(--border)',background:isCurDay?'rgba(0,194,255,0.025)':'transparent'}}
                  onClick={e=>{if(isManager&&e.target===e.currentTarget){const rect=e.currentTarget.getBoundingClientRect();const h=Math.floor((e.clientY-rect.top)/48);openNew(ds,{startTime:minsToTime(h*60),endTime:minsToTime(h*60+60)});}}}>
                  {HOURS.map(h=><div key={h} style={{height:48,borderBottom:'1px solid rgba(255,255,255,0.04)',cursor:isManager?'pointer':'default'}} />)}
                  {evs.map(ev=>{
                    const sM=parseTimeToMins(ev.startTime); const eM=parseTimeToMins(ev.endTime)||(sM+60); const adj=eM<=sM?eM+1440:eM;
                    const col=getCalColor(ev)||'#a5b4fc';
                    return (
                      <div key={ev.id} onClick={e=>{e.stopPropagation();setSelected(ev);}}
                        style={{position:'absolute',top:(sM/60)*48,left:2,right:2,height:Math.max(((adj-sM)/60)*48-2,20),background:`${col}44`,border:`1px solid ${col}44`,borderLeft:`3px solid ${col}`,borderRadius:4,padding:'2px 5px',overflow:'hidden',cursor:'pointer',zIndex:2,transition:'filter 0.1s'}}
                        onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.2)'}
                        onMouseLeave={e=>e.currentTarget.style.filter=''}>
                        <div style={{fontSize:9,fontWeight:700,color:col,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ev.title}</div>
                        {(((adj-sM)/60)*48)>22&&<div style={{fontSize:8,color:`${col}cc`,fontFamily:'DM Mono'}}>{ev.startTime}–{ev.endTime}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════════════
  // DAY VIEW
  // ══════════════════════════════════════════════════════════════════════════
  const DayView = () => {
    const allDay=getEventsForDate(curDay,filterUser==='all'?null:filterUser).filter(e=>e.allDay);
    const timed =getEventsForDate(curDay,filterUser==='all'?null:filterUser).filter(e=>!e.allDay&&e.startTime);
    const now=new Date(); const nowMins=now.getHours()*60+now.getMinutes(); const isT=curDay===today;
    return (
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {allDay.length>0&&(<div style={{padding:'8px 16px',borderBottom:'1px solid var(--border)',background:'rgba(255,255,255,0.02)',flexShrink:0}}>
          <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:5,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.5px'}}>All Day</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>{allDay.map(ev=><EventPill key={ev.id} event={ev} onClick={()=>setSelected(ev)} calColor={getCalColor(ev)} />)}</div>
        </div>)}
        <div style={{flex:1,overflowY:'auto'}}>
          <div style={{display:'grid',gridTemplateColumns:'52px 1fr',position:'relative'}}>
            <div>{HOURS.map(h=>(<div key={h} style={{height:56,borderBottom:'1px solid rgba(255,255,255,0.04)',borderRight:'1px solid var(--border)',display:'flex',alignItems:'flex-start',padding:'2px 8px',justifyContent:'flex-end'}}><span style={{fontSize:10,color:'var(--text-muted)',fontFamily:'DM Mono',marginTop:-7}}>{h===0?'':String(h).padStart(2,'0')+':00'}</span></div>))}</div>
            <div style={{position:'relative'}} onClick={e=>{if(isManager&&e.target===e.currentTarget){const rect=e.currentTarget.getBoundingClientRect();const h=Math.floor((e.clientY-rect.top)/56);openNew(curDay,{startTime:minsToTime(h*60),endTime:minsToTime(h*60+60)});}}}>
              {HOURS.map(h=><div key={h} style={{height:56,borderBottom:'1px solid rgba(255,255,255,0.04)',cursor:isManager?'pointer':'default'}} />)}
              {isT&&<div style={{position:'absolute',top:`${(nowMins/60)*56}px`,left:0,right:0,height:2,background:'var(--accent)',zIndex:10,boxShadow:'0 0 6px var(--accent)'}}><div style={{position:'absolute',left:-5,top:-4,width:10,height:10,borderRadius:'50%',background:'var(--accent)'}} /></div>}
              {timed.map((ev,idx)=>{
                const sM=parseTimeToMins(ev.startTime); const eM=parseTimeToMins(ev.endTime)||(sM+60); const adj=eM<=sM?eM+1440:eM;
                const col=getCalColor(ev)||'#a5b4fc';
                return (
                  <div key={ev.id} onClick={e=>{e.stopPropagation();setSelected(ev);}}
                    style={{position:'absolute',top:(sM/60)*56,left:idx%2===0?4:'52%',right:2,width:idx%2===0?'calc(50% - 6px)':'47%',height:Math.max(((adj-sM)/60)*56-3,24),background:`${col}44`,border:`1px solid ${col}33`,borderLeft:`4px solid ${col}`,borderRadius:5,padding:'4px 8px',overflow:'hidden',cursor:'pointer',zIndex:2,boxShadow:'0 2px 8px rgba(0,0,0,0.2)',transition:'filter 0.1s'}}
                    onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.2)'}
                    onMouseLeave={e=>e.currentTarget.style.filter=''}>
                    <div style={{fontSize:11,fontWeight:700,color:col,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{[...PRIVATE_CATEGORIES,...TEAM_CATEGORIES].find(c=>c.id===ev.category)?.icon} {ev.title}</div>
                    <div style={{fontSize:10,color:`${col}cc`,fontFamily:'DM Mono',marginTop:2}}>{ev.startTime} – {ev.endTime}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════════════
  // AGENDA VIEW
  // ══════════════════════════════════════════════════════════════════════════
  const AgendaView = () => {
    const days=Array.from({length:30},(_,i)=>addDays(today,i));
    const grouped=days.map(ds=>({date:ds,events:getEventsForDate(ds,filterUser==='all'?null:filterUser)})).filter(g=>g.events.length>0);
    return (
      <div style={{flex:1,overflowY:'auto',padding:'0 4px'}}>
        {grouped.length===0?(<div style={{textAlign:'center',padding:'48px 0',color:'var(--text-muted)'}}><div style={{fontSize:36,marginBottom:8}}>📅</div><div style={{fontSize:14,fontWeight:600}}>No events in the next 30 days</div></div>)
        :grouped.map(({date:ds,events:evs})=>{
          const d=new Date(ds+'T12:00:00'); const isT=ds===today; const isBH=bh.includes(ds);
          return (
            <div key={ds} style={{display:'flex',gap:16,marginBottom:16}}>
              <div style={{width:56,flexShrink:0,textAlign:'center',paddingTop:3}}>
                <div style={{fontSize:9,color:isBH?'#fca5a5':'var(--text-muted)',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.5px'}}>{DAYS_SHORT[d.getDay()===0?6:d.getDay()-1]}</div>
                <div style={{width:32,height:32,borderRadius:'50%',background:isT?'var(--accent)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',margin:'2px auto',fontSize:16,fontWeight:800,color:isT?'#000':isBH?'#fca5a5':'var(--text-primary)',fontFamily:'DM Mono'}}>{d.getDate()}</div>
                <div style={{fontSize:9,color:'var(--text-muted)'}}>{MONTHS_SHORT[d.getMonth()]}</div>
              </div>
              <div style={{flex:1,display:'flex',flexDirection:'column',gap:5}}>
                {evs.map(ev=>{
                  const cat=[...PRIVATE_CATEGORIES,...TEAM_CATEGORIES].find(c=>c.id===ev.category);
                  const col=getCalColor(ev)||'#a5b4fc';
                  return (
                    <div key={ev.id} onClick={()=>setSelected(ev)}
                      style={{display:'flex',gap:10,alignItems:'center',padding:'9px 14px',background:`${col}18`,border:`1px solid ${col}22`,borderLeft:`3px solid ${col}`,borderRadius:7,cursor:'pointer',transition:'filter 0.1s'}}
                      onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.15)'}
                      onMouseLeave={e=>e.currentTarget.style.filter=''}>
                      <span style={{fontSize:14,flexShrink:0}}>{cat?.icon||'📅'}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:col,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ev.title}</div>
                        <div style={{fontSize:11,color:'var(--text-muted)',marginTop:1,fontFamily:'DM Mono'}}>
                          {ev.allDay?'All day':`${ev.startTime||''}${ev.endTime?` – ${ev.endTime}`:''}`}
                          {ev.isPrivate&&<span style={{color:'#f59e0b',marginLeft:8}}>🔒 Private</span>}
                          {ev.calendarId&&allCustomCals.find(c=>c.id===ev.calendarId)&&<span style={{marginLeft:8,color:allCustomCals.find(c=>c.id===ev.calendarId)?.color}}>● {allCustomCals.find(c=>c.id===ev.calendarId)?.name}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 80px)'}}>
      {/* Toolbar */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0 12px',flexWrap:'wrap',flexShrink:0}}>
        <button onClick={goToday} style={{padding:'6px 14px',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:7,color:'var(--text-secondary)',fontSize:12,fontWeight:600,cursor:'pointer'}}>Today</button>
        <button onClick={goPrev} style={{width:30,height:30,borderRadius:6,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',color:'var(--text-secondary)',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>‹</button>
        <button onClick={goNext} style={{width:30,height:30,borderRadius:6,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',color:'var(--text-secondary)',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>›</button>
        <span style={{fontSize:16,fontWeight:700,fontFamily:'DM Mono',color:'var(--text-primary)',letterSpacing:'-0.3px',minWidth:220}}>{navLabel()}</span>
        <div style={{display:'flex',gap:6,marginLeft:'auto',flexWrap:'wrap',alignItems:'center'}}>
          <select value={filterUser} onChange={e=>setFilterUser(e.target.value)} style={{...IS,width:'auto',padding:'5px 10px',fontSize:11}}>
            <option value="all">All Engineers</option>
            {users.filter(u=>!u.isManager).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <div style={{display:'flex',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:8,padding:3,gap:2}}>
            {[['month','Month'],['week','Week'],['day','Day'],['agenda','Agenda']].map(([v,l])=>(
              <div key={v} onClick={()=>setView(v)} style={{padding:'5px 12px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,background:view===v?'rgba(0,194,255,0.12)':'transparent',color:view===v?'var(--accent)':'var(--text-muted)',border:view===v?'1px solid rgba(0,194,255,0.3)':'1px solid transparent',transition:'all 0.12s'}}>{l}</div>
            ))}
          </div>
          {isManager&&(<button onClick={()=>openNew(view==='day'?curDay:today)} style={{padding:'7px 16px',background:'var(--accent)',color:'#000',border:'none',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',boxShadow:'0 0 12px rgba(0,194,255,0.25)',display:'flex',alignItems:'center',gap:5}}>+ Event</button>)}
        </div>
      </div>

      {/* Main area: sidebar + calendar */}
      <div style={{flex:1,display:'flex',overflow:'hidden',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:12}}>
        {/* Calendar sidebar */}
        <CalendarSidebar
          allCals={[...DEFAULT_CALENDARS,...allCustomCals]}
          enabledCals={enabledCals}
          setEnabledCals={setEnabledCals}
          isManager={isManager}
          onAddCal={()=>{setCalForm(BLANK_CAL);setEditCal(null);setShowCalModal(true);}}
          onEditCal={openEditCal}
          onDeleteCal={deleteCal}
        />

        {/* Calendar view */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          {view==='month'  && <MonthView />}
          {view==='week'   && <WeekView />}
          {view==='day'    && <DayView />}
          {view==='agenda' && <div style={{flex:1,overflowY:'auto',padding:16}}><AgendaView /></div>}
        </div>
      </div>

      {/* Event detail popup */}
      {selected&&(
        <div style={{position:'fixed',inset:0,zIndex:900,display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={()=>setSelected(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#0f172a',border:'1px solid rgba(255,255,255,0.12)',borderRadius:14,padding:24,width:380,maxHeight:'80vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.6)'}}>
            {(()=>{
              const cat=[...PRIVATE_CATEGORIES,...TEAM_CATEGORIES].find(c=>c.id===selected.category);
              const col=getCalColor(selected)||'#a5b4fc';
              const calEntry=allCustomCals.find(c=>c.id===selected.calendarId);
              return (<>
                <div style={{display:'flex',alignItems:'flex-start',gap:12,marginBottom:16}}>
                  <div style={{width:40,height:40,borderRadius:10,background:`${col}20`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0,border:`1px solid ${col}33`}}>{cat?.icon||'📅'}</div>
                  <div style={{flex:1}}><div style={{fontSize:16,fontWeight:700,color:col,marginBottom:3}}>{selected.title}</div>{selected.isPrivate&&<span style={{fontSize:10,color:'#f59e0b',background:'rgba(245,158,11,0.1)',padding:'1px 7px',borderRadius:4,fontWeight:700}}>🔒 Private</span>}</div>
                  <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',color:'#64748b',fontSize:20,cursor:'pointer'}}>✕</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8,fontSize:12,color:'var(--text-secondary)'}}>
                  <div style={{display:'flex',gap:8}}><span style={{color:'var(--text-muted)',minWidth:70}}>📅 Date</span><span style={{fontFamily:'DM Mono'}}>{fmtDateLong(selected.date)}</span></div>
                  {!selected.allDay&&selected.startTime&&<div style={{display:'flex',gap:8}}><span style={{color:'var(--text-muted)',minWidth:70}}>⏰ Time</span><span style={{fontFamily:'DM Mono'}}>{selected.startTime}{selected.endTime?' – '+selected.endTime:''}</span></div>}
                  {selected.allDay&&<div style={{display:'flex',gap:8}}><span style={{color:'var(--text-muted)',minWidth:70}}>⏰ Time</span><span>All day</span></div>}
                  {cat&&<div style={{display:'flex',gap:8}}><span style={{color:'var(--text-muted)',minWidth:70}}>🏷 Type</span><span style={{color:col}}>{cat.icon} {cat.label}</span></div>}
                  {calEntry&&<div style={{display:'flex',gap:8}}><span style={{color:'var(--text-muted)',minWidth:70}}>📅 Calendar</span><span style={{color:calEntry.color,display:'flex',alignItems:'center',gap:4}}><span style={{width:8,height:8,borderRadius:'50%',background:calEntry.color,display:'inline-block'}} />{calEntry.name} · {VIS_META[calEntry.visibility]?.icon} {VIS_META[calEntry.visibility]?.label}</span></div>}
                  {selected.notes&&<div style={{display:'flex',gap:8,alignItems:'flex-start'}}><span style={{color:'var(--text-muted)',minWidth:70}}>📝 Notes</span><span style={{color:'var(--text-secondary)',lineHeight:1.5}}>{selected.notes}</span></div>}
                </div>
                {isManager&&!selected.isSystem&&(
                  <div style={{display:'flex',gap:8,marginTop:16}}>
                    <button onClick={()=>openEditEvent(selected)} style={{flex:1,padding:'8px',background:'rgba(0,194,255,0.08)',border:'1px solid rgba(0,194,255,0.25)',borderRadius:7,color:'var(--accent)',fontSize:12,fontWeight:700,cursor:'pointer'}}>✏ Edit</button>
                    <button onClick={()=>deleteEvent(selected.id)} style={{flex:1,padding:'8px',background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',borderRadius:7,color:'#ef4444',fontSize:12,fontWeight:700,cursor:'pointer'}}>🗑 Delete</button>
                  </div>
                )}
              </>);
            })()}
          </div>
        </div>
      )}

      {/* Create/Edit event modal */}
      {showModal&&(
        <Modal title={editEvent?'✏ Edit Event':'+ New Event'} onClose={()=>{setShowModal(false);setEditEvent(null);setForm(BLANK_EVENT);}} wide>
          <div style={{display:'flex',flexDirection:'column',gap:13}}>
            <div><label style={LBL}>Title *</label><input style={IS} placeholder="Event title…" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} autoFocus /></div>
            <div style={{display:'flex',gap:8}}>
              {[false,true].map(priv=>(
                <div key={String(priv)} onClick={()=>setForm(f=>({...f,isPrivate:priv,category:priv?'personal':'meeting'}))}
                  style={{flex:1,padding:'9px 8px',textAlign:'center',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:700,background:form.isPrivate===priv?(priv?'rgba(245,158,11,0.12)':'rgba(0,194,255,0.1)'):'rgba(255,255,255,0.03)',border:`1.5px solid ${form.isPrivate===priv?(priv?'rgba(245,158,11,0.4)':'rgba(0,194,255,0.35)'):'rgba(255,255,255,0.07)'}`,color:form.isPrivate===priv?(priv?'#f59e0b':'var(--accent)'):'#64748b',transition:'all 0.15s'}}>
                  {priv?'🔒 Private (Manager Only)':'👥 Team Event'}
                </div>
              ))}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div>
                <label style={LBL}>Calendar</label>
                <select style={IS} value={form.calendarId} onChange={e=>setForm(f=>({...f,calendarId:e.target.value}))}>
                  <option value="">No calendar</option>
                  {allCustomCals.filter(c=>isManager||c.visibility!=='private').map(c=>(
                    <option key={c.id} value={c.id}>{VIS_META[c.visibility]?.icon} {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={LBL}>Category</label>
                <select style={IS} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                  <optgroup label="Private (Manager Only)">{PRIVATE_CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</optgroup>
                  <optgroup label="Team Events">{TEAM_CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</optgroup>
                </select>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={LBL}>Date *</label><input style={IS} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} /></div>
              <div style={{display:'flex',alignItems:'flex-end',paddingBottom:2}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                  <div onClick={()=>setForm(f=>({...f,allDay:!f.allDay}))} style={{width:18,height:18,borderRadius:4,border:`2px solid ${form.allDay?'var(--accent)':'rgba(255,255,255,0.2)'}`,background:form.allDay?'rgba(0,194,255,0.15)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
                    {form.allDay&&<span style={{fontSize:10,color:'var(--accent)',fontWeight:800}}>✓</span>}
                  </div>
                  All Day
                </label>
              </div>
            </div>
            {!form.allDay&&(
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><label style={LBL}>Start Time</label><input style={IS} type="time" value={form.startTime} onChange={e=>setForm(f=>({...f,startTime:e.target.value}))} /></div>
                <div><label style={LBL}>End Time</label><input style={IS} type="time" value={form.endTime} onChange={e=>setForm(f=>({...f,endTime:e.target.value}))} /></div>
              </div>
            )}
            {!form.isPrivate&&(
              <div><label style={LBL}>Assign to Engineer (optional)</label>
                <select style={IS} value={form.targetUser} onChange={e=>setForm(f=>({...f,targetUser:e.target.value}))}>
                  <option value="">All team</option>
                  {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
            <div><label style={LBL}>Notes</label><textarea style={{...IS,resize:'vertical'}} rows={3} placeholder="Additional details…" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
            {form.title&&(
              <div style={{padding:'8px 12px',background:'rgba(255,255,255,0.03)',borderRadius:8,border:'1px solid rgba(255,255,255,0.07)',display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:16}}>{[...PRIVATE_CATEGORIES,...TEAM_CATEGORIES].find(c=>c.id===form.category)?.icon||'📅'}</span>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:allCustomCals.find(c=>c.id===form.calendarId)?.color||[...PRIVATE_CATEGORIES,...TEAM_CATEGORIES].find(c=>c.id===form.category)?.color||'#a5b4fc'}}>{form.title}</div>
                  <div style={{fontSize:10,color:'var(--text-muted)',fontFamily:'DM Mono'}}>{form.date}{!form.allDay&&form.startTime?' · '+form.startTime+(form.endTime?' – '+form.endTime:''):' · All day'}{form.isPrivate?' · 🔒':''}{form.calendarId&&allCustomCals.find(c=>c.id===form.calendarId)?' · 📅 '+allCustomCals.find(c=>c.id===form.calendarId)?.name:''}</div>
                </div>
              </div>
            )}
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',paddingTop:4}}>
              <button onClick={()=>{setShowModal(false);setEditEvent(null);setForm(BLANK_EVENT);}} style={{padding:'8px 18px',background:'transparent',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#64748b',cursor:'pointer',fontSize:13}}>Cancel</button>
              <button onClick={saveEvent} disabled={!form.title.trim()||!form.date} style={{padding:'8px 22px',background:'var(--accent)',color:'#000',border:'none',borderRadius:7,fontWeight:700,fontSize:13,cursor:'pointer',opacity:form.title.trim()&&form.date?1:0.5}}>
                {editEvent?'✓ Save Changes':'+ Add Event'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create/Edit calendar modal */}
      {showCalModal&&(
        <Modal title={editCal?'✏ Edit Calendar':'+ New Calendar'} onClose={()=>{setShowCalModal(false);setEditCal(null);setCalForm(BLANK_CAL);}}>
          <div style={{display:'flex',flexDirection:'column',gap:13}}>
            <div><label style={LBL}>Calendar Name *</label><input style={IS} placeholder="e.g. Personal, Team Events, On-Call Cover…" value={calForm.name} onChange={e=>setCalForm(f=>({...f,name:e.target.value}))} autoFocus /></div>
            <div><label style={LBL}>Description</label><textarea style={{...IS,resize:'vertical'}} rows={2} placeholder="What is this calendar for?" value={calForm.description} onChange={e=>setCalForm(f=>({...f,description:e.target.value}))} /></div>
            {/* Visibility */}
            <div>
              <label style={LBL}>Visibility</label>
              <div style={{display:'flex',gap:8}}>
                {Object.entries(VIS_META).map(([k,v])=>(
                  <div key={k} onClick={()=>setCalForm(f=>({...f,visibility:k}))}
                    style={{flex:1,padding:'10px 8px',textAlign:'center',borderRadius:9,cursor:'pointer',
                      background:calForm.visibility===k?`${v.color}18`:'rgba(255,255,255,0.03)',
                      border:`1.5px solid ${calForm.visibility===k?v.color+'55':'rgba(255,255,255,0.07)'}`,
                      transition:'all 0.15s'}}>
                    <div style={{fontSize:18,marginBottom:3}}>{v.icon}</div>
                    <div style={{fontSize:12,fontWeight:700,color:calForm.visibility===k?v.color:'#64748b'}}>{v.label}</div>
                    <div style={{fontSize:10,color:'#475569',marginTop:2,lineHeight:1.3}}>{v.desc}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Colour picker */}
            <div>
              <label style={LBL}>Colour</label>
              <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:4}}>
                {CALENDAR_COLORS.map(c=>(
                  <div key={c} onClick={()=>setCalForm(f=>({...f,color:c}))}
                    style={{width:26,height:26,borderRadius:6,background:c,cursor:'pointer',border:`2px solid ${calForm.color===c?'#fff':'transparent'}`,boxShadow:calForm.color===c?`0 0 0 2px ${c}`:'none',transition:'all 0.12s',transform:calForm.color===c?'scale(1.15)':'scale(1)'}} />
                ))}
              </div>
            </div>
            {/* Preview */}
            {calForm.name&&(
              <div style={{padding:'10px 14px',background:`${calForm.color}15`,border:`1px solid ${calForm.color}35`,borderLeft:`4px solid ${calForm.color}`,borderRadius:8,display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:12,height:12,borderRadius:3,background:calForm.color,flexShrink:0}} />
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:calForm.color}}>{calForm.name}</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:1}}>{VIS_META[calForm.visibility]?.icon} {VIS_META[calForm.visibility]?.label} · {calForm.description||'No description'}</div>
                </div>
              </div>
            )}
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',paddingTop:4}}>
              <button onClick={()=>{setShowCalModal(false);setEditCal(null);setCalForm(BLANK_CAL);}} style={{padding:'8px 18px',background:'transparent',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#64748b',cursor:'pointer',fontSize:13}}>Cancel</button>
              <button onClick={saveCal} disabled={!calForm.name.trim()} style={{padding:'8px 22px',background:'var(--accent)',color:'#000',border:'none',borderRadius:7,fontWeight:700,fontSize:13,cursor:'pointer',opacity:calForm.name.trim()?1:0.5}}>
                {editCal?'✓ Save Changes':'+ Create Calendar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
