// src/Settings.js
// CloudOps Rota — Settings Page (extracted from App.js)
// Fixes: UserFields defined outside Settings so inputs don't lose focus on keystroke
// New: Active Directory-style user cards with search, filters, and detail panel

import React, { useState, useCallback, useRef } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────
const BLANK_FORM = {
  name: '', trigram: '', role: 'Engineer', employment_id: '',
  mobile_number: '', google_email: '', profile_picture: '',
  avatar: '', color: '', start_date: '', oncall_start_date: '', termination_date: '',
};

const ALL_PAGES = [
  { id:'dashboard',   label:'Dashboard'      },
  { id:'whocall',     label:"Who's On Call"  },
  { id:'myshift',     label:'My Shift'       },
  { id:'calendar',    label:'Calendar'       },
  { id:'rota',        label:'Rota'           },
  { id:'incidents',   label:'Incidents'      },
  { id:'timesheets',  label:'Timesheets'     },
  { id:'timekeeping', label:'Time Keeping'   },
  { id:'holidays',    label:'Holidays'       },
  { id:'swaps',       label:'Shift Swaps'    },
  { id:'upgrades',    label:'Upgrade Days'   },
  { id:'stress',      label:'Stress Score'   },
  { id:'toil',        label:'TOIL'           },
  { id:'absences',    label:'Absence / Sick' },
  { id:'overtime',    label:'Overtime'       },
  { id:'logbook',     label:'Logbook'        },
  { id:'wiki',        label:'Wiki'           },
  { id:'glossary',    label:'Glossary'       },
  { id:'contacts',    label:'Contacts'       },
  { id:'notes',       label:'Notes'          },
  { id:'documents',   label:'Documents'      },
  { id:'chat',        label:'Team Chat'      },
  { id:'reports',     label:'Reports'        },
  { id:'payroll',     label:'Payroll'        },
  { id:'payconfig',   label:'Pay Config'     },
];

const MANAGER_ONLY = new Set(['stress','payroll','payconfig']);

const SHIFT_COLORS = {
  daily:   { bg:'#1e40af', label:'Daily Shift',     text:'#bfdbfe' },
  evening: { bg:'#166534', label:'Weekday On-Call', text:'#bbf7d0' },
  weekend: { bg:'#854d0e', label:'Weekend On-Call', text:'#fef08a' },
  upgrade: { bg:'#991b1b', label:'Upgrade Day',     text:'#fecaca' },
  holiday: { bg:'#92400e', label:'Holiday',         text:'#fde68a' },
};

const TRICOLORS = ['#1d4ed8','#0e7490','#065f46','#7c3aed','#b45309','#be123c','#0369a1','#4338ca'];

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

// ── Main Settings Component ────────────────────────────────────────────────────
export default function Settings({
  users, setUsers, isManager, secureLinks, setSecureLinks, driveToken,
  profilePics, setProfilePicsState, rota, setRota, permissions, setPermissions,
  // These come from App.js closure — pass as props
  uploadProfilePicture, generateTrigramId, TRICOLORS: triColors,
  updatePasswordInRegistry, syncRegistryToDrive, getRegistry,
  getProfilePics, setProfilePics, setTimesheets, setToil,
  syncUsersFromSheet, syncUsersToSheet, driveWriteJson,
}) {
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
          <button style={HDR_BTN_SEC} onClick={()=>setShowLink(true)}>🔗 Secure Link</button>
          <button style={HDR_BTN_PRI} onClick={()=>{ setForm(BLANK_FORM); setShowAdd(true); }}>+ Add User</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:4, marginBottom:18, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:4, width:'fit-content', flexWrap:'wrap' }}>
        {[['team','👥 Team'],['permissions','🔐 Permissions'],['drive','📁 Drive']].map(([id,label])=>(
          <div key={id} onClick={()=>setSettingsTab(id)} style={{
            padding:'7px 18px', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:600,
            background:settingsTab===id?'rgba(0,194,255,0.1)':'transparent',
            color:settingsTab===id?'#00c2ff':'#64748b',
            border:settingsTab===id?'1px solid rgba(0,194,255,0.3)':'1px solid transparent',
            transition:'all 0.15s',
          }}>{label}</div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
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
