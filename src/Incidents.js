// src/Incidents.js
// CloudOps Rota — Incidents
// Meetul Bhundia (MBA47) · Cloud Run Operations · July 2026

import React, { useState, useRef } from 'react';

// ── Constants ──────────────────────────────────────────────────────────────
const SEVERITIES    = ['Disaster', 'Critical', 'High', 'Medium', 'Low'];
const STATUSES      = ['Investigating', 'Identified', 'Monitoring', 'Resolved'];
const HOURS_OPTIONS = [1,2,3,4,5,6,7,8,9,10,11,12];

const DAILY_TYPES = [
  { id:'deployment',   label:'Deployment',   icon:'🚀' },
  { id:'service_down', label:'Service Down',  icon:'🔴' },
  { id:'performance',  label:'Performance',   icon:'📉' },
  { id:'security',     label:'Security',      icon:'🔐' },
  { id:'data',         label:'Data Issue',    icon:'🗄️' },
  { id:'network',      label:'Network',       icon:'🌐' },
  { id:'config',       label:'Config Change', icon:'⚙️' },
  { id:'other',        label:'Other',         icon:'📌' },
];

const SEV = {
  Disaster:{ bg:'rgba(239,68,68,0.1)',   text:'#fca5a5', border:'#ef4444', dot:'#ef4444' },
  Critical:{ bg:'rgba(245,158,11,0.1)',  text:'#fcd34d', border:'#f59e0b', dot:'#f59e0b' },
  High:    { bg:'rgba(59,130,246,0.1)',  text:'#93c5fd', border:'#3b82f6', dot:'#3b82f6' },
  Medium:  { bg:'rgba(16,185,129,0.1)',  text:'#6ee7b7', border:'#10b981', dot:'#10b981' },
  Low:     { bg:'rgba(100,116,139,0.1)', text:'#94a3b8', border:'#64748b', dot:'#64748b' },
};
const STA = {
  Investigating:{ text:'#fca5a5', border:'#ef4444', bg:'rgba(239,68,68,0.08)'  },
  Identified:   { text:'#fcd34d', border:'#f59e0b', bg:'rgba(245,158,11,0.08)' },
  Monitoring:   { text:'#93c5fd', border:'#3b82f6', bg:'rgba(59,130,246,0.08)' },
  Resolved:     { text:'#86efac', border:'#22c55e', bg:'rgba(34,197,94,0.08)'  },
};

const BLANK = {
  title:'', severity:'High', status:'Investigating', assigned_to:'',
  date: new Date().toISOString().slice(0,10),
  hours:1, isDaily:false, dailyType:'other',
  issueContent:'', diagnosticsContent:'', resolutionContent:'',
};

const EDITOR_TABS = [
  { id:'issue',       label:'Issue',       icon:'🚨', field:'issueContent',
    hint:'Describe what happened, impact, and timeline',
    ph:'# Summary\nBrief description of the incident.\n\n## Impact\n- Services affected\n- Users impacted\n- Duration\n\n## Timeline\n- HH:MM — Alert fired\n- HH:MM — Engineer paged\n- HH:MM — Incident declared' },
  { id:'diagnostics', label:'Diagnostics', icon:'🔍', field:'diagnosticsContent',
    hint:'Investigation steps, logs, and root cause',
    ph:'## Investigation\n1. Checked dashboards\n2. Reviewed logs\n\n## Relevant Logs\n```\npaste logs here\n```\n\n## Root Cause\nWhat caused the incident.' },
  { id:'resolution',  label:'Resolution',  icon:'✅', field:'resolutionContent',
    hint:'Fix applied, follow-ups, and post-incident review',
    ph:'## Fix Applied\nWhat was done to resolve the incident.\n\n## Follow-up Actions\n- [ ] Action item 1\n- [ ] Action item 2\n\n## Post-Incident Review\nScheduled for: ' },
];

const TOOLBAR_ITEMS = [
  { label:'B',   title:'Bold',          md:['**','**'],      s:{fontWeight:800} },
  { label:'I',   title:'Italic',        md:['*','*'],        s:{fontStyle:'italic'} },
  { sep:true },
  { label:'H1',  title:'Heading 1',     md:['\n# ',''],      s:{fontSize:10,fontWeight:700} },
  { label:'H2',  title:'Heading 2',     md:['\n## ',''],     s:{fontSize:10,fontWeight:700} },
  { label:'H3',  title:'Heading 3',     md:['\n### ',''],    s:{fontSize:10,fontWeight:700} },
  { sep:true },
  { label:'``',  title:'Inline code',   md:['`','`'],        s:{fontFamily:'monospace',fontSize:11} },
  { label:'```', title:'Code block',    md:['```\n','\n```'],s:{fontFamily:'monospace',fontSize:10} },
  { sep:true },
  { label:'❝',   title:'Blockquote',   md:['\n> ',''],      s:{} },
  { label:'•',   title:'Bullet list',  md:['\n- ',''],      s:{fontSize:15} },
  { label:'1.',  title:'Numbered',     md:['\n1. ',''],      s:{} },
  { label:'──',  title:'Divider',      md:['\n---\n',''],   s:{letterSpacing:-1} },
];

// ── Markdown renderer ──────────────────────────────────────────────────────
function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function renderMd(md){
  if(!md) return '';
  let h = md
    .replace(/```(\w*)\n?([\s\S]*?)```/g,(_,l,c)=>`<pre class="ipr"${l?` data-lang="${l}"`:''}><code>${esc(c.trimEnd())}</code></pre>`)
    .replace(/`([^`]+)`/g,(_,c)=>`<code class="iic">${esc(c)}</code>`)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^### (.+)$/gm,'<h3 class="ih3">$1</h3>')
    .replace(/^## (.+)$/gm,'<h2 class="ih2">$1</h2>')
    .replace(/^# (.+)$/gm,'<h1 class="ih1">$1</h1>')
    .replace(/^---$/gm,'<hr class="ihr"/>')
    .replace(/^\[x\] (.+)$/gim,'<li class="ick done">$1</li>')
    .replace(/^\[ \] (.+)$/gim,'<li class="ick">$1</li>')
    .replace(/^[-*] (.+)$/gm,'<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm,'<li class="iol">$1</li>')
    .replace(/^> (.+)$/gm,'<blockquote class="ibq">$1</blockquote>')
    .replace(/\n\n/g,'</p><p class="ipp">')
    .replace(/\n/g,'<br/>');
  return `<p class="ipp">${h}</p>`;
}

// ── Insert at cursor ───────────────────────────────────────────────────────
function insertMd(ref, before, after, ph='text'){
  const el = ref.current; if(!el) return;
  const s=el.selectionStart, e=el.selectionEnd;
  const sel=el.value.substring(s,e)||ph;
  const nv=el.value.substring(0,s)+before+sel+after+el.value.substring(e);
  const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
  setter.call(el,nv);
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.focus();
  el.setSelectionRange(s+before.length+sel.length, s+before.length+sel.length);
}

// ── .docx extractor ────────────────────────────────────────────────────────
async function extractDocx(buf){
  const b=new Uint8Array(buf), entries=[];
  let i=0;
  while(i<b.length-30){
    if(b[i]===0x50&&b[i+1]===0x4B&&b[i+2]===0x03&&b[i+3]===0x04){
      const comp=b[i+8]|(b[i+9]<<8), cs=b[i+18]|(b[i+19]<<8)|(b[i+20]<<16)|(b[i+21]<<24);
      const nl=b[i+26]|(b[i+27]<<8), el=b[i+28]|(b[i+29]<<8);
      const name=new TextDecoder().decode(b.slice(i+30,i+30+nl));
      const off=i+30+nl+el;
      entries.push({name,comp,cs,off}); i=off+cs;
    } else i++;
  }
  const doc=entries.find(e=>e.name==='word/document.xml');
  if(!doc) throw new Error('Not a valid .docx');
  let xb=b.slice(doc.off,doc.off+doc.cs);
  if(doc.comp===8){
    const ds=new DecompressionStream('deflate-raw');
    const w=ds.writable.getWriter(), r=ds.readable.getReader();
    w.write(xb); w.close();
    const chunks=[]; let done=false;
    while(!done){const{value,done:d}=await r.read(); if(value)chunks.push(value); done=d;}
    const tot=chunks.reduce((a,c)=>a+c.length,0);
    const out=new Uint8Array(tot); let of2=0;
    for(const c of chunks){out.set(c,of2);of2+=c.length;}
    xb=out;
  }
  const xml=new TextDecoder().decode(xb), lines=[];
  const pr=/<w:p[ >][\s\S]*?<\/w:p>/g; let pm;
  while((pm=pr.exec(xml))!==null){
    const p=pm[0], sm=p.match(/w:styleId="([^"]+)"/), st=sm?sm[1]:'';
    const ts=[]; const tr=/<w:t[^>]*>([\s\S]*?)<\/w:t>/g; let tm;
    while((tm=tr.exec(p))!==null) ts.push(tm[1]);
    const l=ts.join('').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    if(!l.trim()){lines.push('');continue;}
    if(/Heading1/i.test(st)) lines.push(`# ${l}`);
    else if(/Heading2/i.test(st)) lines.push(`## ${l}`);
    else if(/Heading3/i.test(st)) lines.push(`### ${l}`);
    else lines.push(l);
  }
  return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

// ── Mini components ────────────────────────────────────────────────────────
function Avatar({user,size=28}){
  if(!user) return null;
  return <div style={{width:size,height:size,borderRadius:Math.round(size*.28),background:user.color||'#1d4ed8',display:'flex',alignItems:'center',justifyContent:'center',fontSize:Math.round(size*.38),fontWeight:700,color:'#fff',flexShrink:0}}>{user.avatar||user.id?.slice(0,2)}</div>;
}
function SevPill({s}){
  const c=SEV[s]||SEV.Low;
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,background:c.bg,border:`1px solid ${c.border}`,color:c.text,borderRadius:20,padding:'2px 9px',fontSize:10,fontWeight:700,letterSpacing:'0.3px'}}>
    <span style={{width:5,height:5,borderRadius:'50%',background:c.dot,flexShrink:0}}/>
    {s}
  </span>;
}
function StaPill({s}){
  const c=STA[s]||STA.Investigating;
  return <span style={{background:c.bg,border:`1px solid ${c.border}`,color:c.text,borderRadius:6,padding:'2px 8px',fontSize:10,fontWeight:600}}>{s}</span>;
}

// ── Rich editor ────────────────────────────────────────────────────────────
function RichEditor({value,onChange,placeholder}){
  const [prev,setPrev]=useState(false);
  const ta=useRef(null), fi=useRef(null);

  const handleFile=async(e)=>{
    const f=e.target.files?.[0]; if(!f) return; e.target.value='';
    const n=f.name.toLowerCase();
    if(n.endsWith('.md')||n.endsWith('.txt')||n.endsWith('.markdown')){
      const t=await f.text(); onChange(value?value+'\n\n'+t:t); return;
    }
    if(n.endsWith('.docx')){
      try{ const t=await extractDocx(await f.arrayBuffer()); onChange(value?value+'\n\n'+t:t); }
      catch(err){ alert('Could not parse .docx\n'+err.message); }
      return;
    }
    alert('Supported: .md  .txt  .docx');
  };

  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0,background:'#0d1117'}}>
      {/* Toolbar */}
      <div style={{
        display:'flex',alignItems:'center',gap:2,padding:'0 10px',
        height:40,background:'rgba(255,255,255,0.03)',
        borderBottom:'1px solid rgba(255,255,255,0.07)',flexShrink:0,flexWrap:'nowrap',
      }}>
        {TOOLBAR_ITEMS.map((t,i)=> t.sep
          ? <div key={i} style={{width:1,height:16,background:'rgba(255,255,255,0.1)',margin:'0 3px',flexShrink:0}}/>
          : <button key={i} title={t.title}
              onMouseDown={ev=>{ev.preventDefault();insertMd(ta,...t.md);}}
              style={{background:'transparent',border:'none',borderRadius:5,padding:'3px 7px',
                cursor:'pointer',color:'rgba(255,255,255,0.45)',flexShrink:0,
                transition:'color .1s,background .1s',...t.s,
                ':hover':{color:'white'}}}
              onMouseEnter={e=>e.currentTarget.style.color='rgba(255,255,255,0.85)'}
              onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,0.45)'}
            >{t.label}</button>
        )}
        <div style={{flex:1}}/>
        <button onClick={()=>fi.current?.click()} style={{
          display:'flex',alignItems:'center',gap:5,
          background:'rgba(59,130,246,0.12)',border:'1px solid rgba(59,130,246,0.3)',
          borderRadius:6,padding:'4px 11px',cursor:'pointer',
          color:'#60a5fa',fontSize:11,fontWeight:600,flexShrink:0,
        }}>↑ Import</button>
        <div style={{width:1,height:16,background:'rgba(255,255,255,0.08)',margin:'0 6px',flexShrink:0}}/>
        <button onClick={()=>setPrev(p=>!p)} style={{
          display:'flex',alignItems:'center',gap:5,
          background:prev?'rgba(59,130,246,0.15)':'transparent',
          border:`1px solid ${prev?'rgba(59,130,246,0.4)':'rgba(255,255,255,0.08)'}`,
          borderRadius:6,padding:'4px 11px',cursor:'pointer',
          color:prev?'#60a5fa':'rgba(255,255,255,0.4)',fontSize:11,flexShrink:0,
        }}>{prev?'✏ Edit':'◉ Preview'}</button>
        <input ref={fi} type="file" accept=".md,.txt,.markdown,.docx" style={{display:'none'}} onChange={handleFile}/>
      </div>

      {/* Content area */}
      {prev ? (
        <div className="inc-pv" style={{
          flex:1,overflowY:'auto',padding:'20px 24px',
          fontSize:13,lineHeight:1.8,color:'rgba(255,255,255,0.75)',
        }}
          dangerouslySetInnerHTML={{__html:renderMd(value)||'<em style="color:rgba(255,255,255,0.2)">Nothing to preview yet.</em>'}}
        />
      ) : (
        <textarea ref={ta} value={value} onChange={e=>onChange(e.target.value)}
          placeholder={placeholder} spellCheck={false}
          style={{
            flex:1,resize:'none',border:'none',outline:'none',
            background:'transparent',color:'rgba(255,255,255,0.82)',
            fontFamily:'"DM Mono","Fira Code","Cascadia Code",monospace',
            fontSize:12.5,lineHeight:1.85,padding:'18px 24px',
            caretColor:'var(--accent)',
          }}
        />
      )}
      <style>{`
        .inc-pv .ih1{font-size:20px;font-weight:700;color:#fff;margin:16px 0 8px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:6px}
        .inc-pv .ih2{font-size:16px;font-weight:700;color:#fff;margin:14px 0 6px}
        .inc-pv .ih3{font-size:13px;font-weight:600;color:rgba(255,255,255,0.7);margin:10px 0 4px}
        .inc-pv .ipp{margin:0 0 10px}
        .inc-pv li{margin-left:20px;list-style:disc;margin-bottom:3px;color:rgba(255,255,255,0.75)}
        .inc-pv .iol{list-style:decimal}
        .inc-pv .ick{list-style:none;margin-left:4px;padding-left:20px;position:relative}
        .inc-pv .ick::before{content:"☐";position:absolute;left:0;color:rgba(255,255,255,0.3)}
        .inc-pv .ick.done{text-decoration:line-through;color:rgba(255,255,255,0.35)}
        .inc-pv .ick.done::before{content:"☑";color:#22c55e}
        .inc-pv .ibq{border-left:3px solid var(--accent);padding:4px 14px;color:rgba(255,255,255,0.45);margin:8px 0;font-style:italic;background:rgba(59,130,246,0.06);border-radius:0 4px 4px 0}
        .inc-pv .ihr{border:none;border-top:1px solid rgba(255,255,255,0.08);margin:14px 0}
        .inc-pv pre.ipr{background:#161b22;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:10px 0}
        .inc-pv pre.ipr::before{content:attr(data-lang);display:block;font-size:9px;color:rgba(255,255,255,0.3);margin-bottom:8px;text-transform:uppercase;letter-spacing:1.5px;font-family:monospace}
        .inc-pv pre.ipr code{font-family:"DM Mono",monospace;font-size:12px;color:#e6edf3;white-space:pre}
        .inc-pv code.iic{background:#161b22;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:1px 6px;font-family:"DM Mono",monospace;font-size:12px;color:#79c0ff}
      `}</style>
    </div>
  );
}

// ── Incident card (list view) ──────────────────────────────────────────────
function IncCard({inc,users,isManager,currentUser,onEdit,onDelete,onResolve,onView}){
  const assignee=users.find(u=>u.id===inc.assigned_to);
  const canEdit=isManager||inc.assigned_to===currentUser;
  const dailyT=DAILY_TYPES.find(t=>t.id===inc.dailyType);
  const snippet=(inc.issueContent||inc.description||'').replace(/[#*`>_\-]/g,'').trim().slice(0,140);
  const sevC=SEV[inc.severity]||SEV.Low;
  const staC=STA[inc.status]||STA.Investigating;

  return (
    <div
      onClick={()=>onView(inc)}
      style={{
        background:'var(--bg-card)',border:`1px solid var(--border)`,
        borderLeft:`3px solid ${sevC.border}`,borderRadius:10,
        padding:'14px 16px', cursor:'pointer',
        transition:'transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .2s,border-color .2s',
      }}
      onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,.3)';e.currentTarget.style.borderColor=sevC.border;}}
      onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='';e.currentTarget.style.borderColor='var(--border)';}}
    >
      <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
        {/* Left: severity dot */}
        <div style={{width:8,height:8,borderRadius:'50%',background:sevC.dot,marginTop:6,flexShrink:0,boxShadow:`0 0 6px ${sevC.dot}`}}/>

        <div style={{flex:1,minWidth:0}}>
          {/* Title row */}
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:5}}>
            {inc.isDaily&&<span style={{fontSize:10,background:'rgba(99,102,241,0.12)',border:'1px solid rgba(99,102,241,0.3)',color:'#a5b4fc',borderRadius:20,padding:'1px 8px',fontWeight:600}}>{dailyT?.icon||'📋'} Daily</span>}
            <SevPill s={inc.severity}/>
            <StaPill s={inc.status}/>
            {!inc.isDaily&&inc.hours>0&&<span style={{fontSize:10,background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.25)',color:'#fcd34d',borderRadius:20,padding:'1px 8px'}}>⏱ {inc.hours}h</span>}
            {inc.diagnosticsContent&&<span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>🔍 Diag</span>}
            {inc.resolutionContent&&<span style={{fontSize:10,color:'#4ade80'}}>✓ Fixed</span>}
          </div>

          <div style={{fontSize:14,fontWeight:600,color:'var(--text-primary)',marginBottom:3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {inc.title}
          </div>

          {snippet&&<div style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.5,marginBottom:8,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
            {snippet}{snippet.length>=140?'…':''}
          </div>}

          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <Avatar user={assignee} size={18}/>
              <span style={{fontSize:11,color:'var(--text-muted)'}}>{assignee?.name||inc.assigned_to}</span>
            </div>
            <span style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>·</span>
            <span style={{fontSize:10,color:'var(--text-muted)',fontFamily:'DM Mono'}}>{(inc.date||'').slice(0,10)}</span>
            <span style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>·</span>
            <span style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>Updated {inc.updated_at?new Date(inc.updated_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'—'}</span>
          </div>
        </div>

        {/* Actions — stopPropagation so clicking buttons does not open detail view */}
        <div style={{display:'flex',gap:6,flexShrink:0,alignItems:'center'}} onClick={e=>e.stopPropagation()}>
          {canEdit&&inc.status!=='Resolved'&&(
            <button onClick={()=>onResolve(inc.id)} style={{
              background:'rgba(34,197,94,0.1)',border:'1px solid rgba(34,197,94,0.25)',
              borderRadius:7,padding:'5px 10px',cursor:'pointer',
              color:'#4ade80',fontSize:11,fontWeight:600,transition:'background .15s',
            }}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(34,197,94,0.18)';}}
              onMouseLeave={e=>{e.currentTarget.style.background='rgba(34,197,94,0.1)';}}
            >✓ Resolve</button>
          )}
          {canEdit&&(
            <button onClick={()=>onEdit(inc)} style={{
              background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',
              borderRadius:7,padding:'5px 10px',cursor:'pointer',
              color:'rgba(255,255,255,0.55)',fontSize:11,transition:'all .15s',
            }}
              onMouseEnter={e=>{e.currentTarget.style.color='white';e.currentTarget.style.borderColor='rgba(255,255,255,0.25)';}}
              onMouseLeave={e=>{e.currentTarget.style.color='rgba(255,255,255,0.55)';e.currentTarget.style.borderColor='rgba(255,255,255,0.1)';}}
            >✏ Edit</button>
          )}
          {isManager&&(
            <button onClick={()=>onDelete(inc.id)} style={{
              background:'transparent',border:'1px solid transparent',
              borderRadius:7,padding:'5px 8px',cursor:'pointer',
              color:'rgba(239,68,68,0.45)',fontSize:11,transition:'all .15s',
            }}
              onMouseEnter={e=>{e.currentTarget.style.color='#f87171';e.currentTarget.style.background='rgba(239,68,68,0.1)';e.currentTarget.style.borderColor='rgba(239,68,68,0.25)';}}
              onMouseLeave={e=>{e.currentTarget.style.color='rgba(239,68,68,0.45)';e.currentTarget.style.background='transparent';e.currentTarget.style.borderColor='transparent';}}
            >✕</button>
          )}
        </div>
      </div>
    </div>
  );
}



// ── Detail View (read-only) ────────────────────────────────────────────────
const DETAIL_TABS = [
  { id:'issue',       label:'🚨 Issue',       field:'issueContent' },
  { id:'diagnostics', label:'🔍 Diagnostics', field:'diagnosticsContent' },
  { id:'resolution',  label:'✅ Resolution',  field:'resolutionContent' },
];

function DetailView({inc, users, isManager, currentUser, onClose, onEdit, onResolve}){
  const [tab, setTab] = React.useState('issue');
  if (!inc) return null;
  const assignee = users.find(u => u.id === inc.assigned_to);
  const canEdit  = isManager || inc.assigned_to === currentUser;
  const sevC     = SEV[inc.severity] || SEV.Low;
  const staC     = STA[inc.status]   || STA.Investigating;
  const dailyT   = DAILY_TYPES.find(t => t.id === inc.dailyType);
  const activeTab = DETAIL_TABS.find(t => t.id === tab);

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:9000,
      background:'rgba(0,0,0,0.85)', backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
    }}>
      <div style={{
        width:'100%', maxWidth:900, height:'min(88vh,780px)',
        display:'flex', flexDirection:'column',
        background:'#0d1117', border:'1px solid rgba(255,255,255,0.1)',
        borderRadius:16, overflow:'hidden',
        boxShadow:'0 40px 120px rgba(0,0,0,0.8)',
        animation:'slideUpModal .25s cubic-bezier(.34,1.4,.64,1)',
      }}>

        {/* Header */}
        <div style={{
          display:'flex', alignItems:'flex-start', gap:12,
          padding:'16px 20px', flexShrink:0,
          background:'rgba(255,255,255,0.02)',
          borderBottom:'1px solid rgba(255,255,255,0.07)',
        }}>
          {/* Severity dot */}
          <div style={{width:10,height:10,borderRadius:'50%',background:sevC.dot,marginTop:6,flexShrink:0,boxShadow:`0 0 8px ${sevC.dot}`}}/>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:18, fontWeight:700, color:'#fff', marginBottom:8, lineHeight:1.3}}>
              {inc.title}
            </div>
            {/* Meta pills */}
            <div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center'}}>
              <SevPill s={inc.severity}/>
              <StaPill s={inc.status}/>
              {inc.isDaily && <span style={{fontSize:10,background:'rgba(99,102,241,0.12)',border:'1px solid rgba(99,102,241,0.3)',color:'#a5b4fc',borderRadius:20,padding:'2px 9px',fontWeight:600}}>{dailyT?.icon||'📋'} Daily — {dailyT?.label||'Other'}</span>}
              {!inc.isDaily && inc.hours > 0 && <span style={{fontSize:10,background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.25)',color:'#fcd34d',borderRadius:20,padding:'2px 9px'}}>⏱ {inc.hours}h on-call</span>}
            </div>
          </div>
          {/* Action buttons */}
          <div style={{display:'flex', gap:8, flexShrink:0, alignItems:'center'}}>
            {canEdit && inc.status !== 'Resolved' && (
              <button onClick={()=>{onResolve(inc.id); onClose();}} style={{
                background:'rgba(34,197,94,0.12)', border:'1px solid rgba(34,197,94,0.3)',
                borderRadius:8, padding:'7px 14px', cursor:'pointer',
                color:'#4ade80', fontSize:12, fontWeight:600,
              }}>✓ Resolve</button>
            )}
            {canEdit && (
              <button onClick={()=>{onClose(); setTimeout(()=>onEdit(inc),50);}} style={{
                background:'rgba(0,194,255,0.1)', border:'1px solid rgba(0,194,255,0.3)',
                borderRadius:8, padding:'7px 14px', cursor:'pointer',
                color:'var(--accent)', fontSize:12, fontWeight:600,
              }}>✏ Edit</button>
            )}
            <button onClick={onClose} style={{
              background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
              borderRadius:8, width:34, height:34, cursor:'pointer',
              color:'rgba(255,255,255,0.5)', fontSize:18,
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>✕</button>
          </div>
        </div>

        {/* Meta row */}
        <div style={{
          display:'flex', gap:0, flexShrink:0,
          background:'rgba(255,255,255,0.015)',
          borderBottom:'1px solid rgba(255,255,255,0.07)',
          overflowX:'auto',
        }}>
          {[
            { label:'Assigned To', value: assignee ? (
              <span style={{display:'flex',alignItems:'center',gap:5}}>
                <Avatar user={assignee} size={16}/>
                <span>{assignee.name}</span>
              </span>
            ) : inc.assigned_to || '—' },
            { label:'Date',       value: (inc.date||'').slice(0,10) || '—' },
            { label:'Logged',     value: inc.created_at ? new Date(inc.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—' },
            { label:'Updated',    value: inc.updated_at ? new Date(inc.updated_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—' },
            ...(!inc.isDaily ? [{ label:'Payroll Hours', value: `${inc.hours || 1}h` }] : []),
          ].map(({label, value}, i) => (
            <div key={i} style={{
              display:'flex', flexDirection:'column', justifyContent:'center',
              padding:'8px 18px', borderRight:'1px solid rgba(255,255,255,0.06)', flexShrink:0,
            }}>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:3,fontWeight:600}}>{label}</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.75)',fontWeight:500,display:'flex',alignItems:'center',gap:4}}>{value}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div style={{
          display:'flex', borderBottom:'1px solid rgba(255,255,255,0.07)',
          background:'rgba(255,255,255,0.015)', flexShrink:0,
        }}>
          {DETAIL_TABS.map(t => {
            const hasContent = !!(inc[t.field]||'').trim();
            return (
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                padding:'10px 22px', border:'none', cursor:'pointer',
                background:tab===t.id?'rgba(255,255,255,0.05)':'transparent',
                color:tab===t.id?'#fff':'rgba(255,255,255,0.35)',
                borderBottom:`2px solid ${tab===t.id?'var(--accent)':'transparent'}`,
                fontSize:13, fontWeight:tab===t.id?700:400,
                display:'flex', alignItems:'center', gap:7, transition:'all .15s',
              }}>
                {t.label}
                {hasContent && <span style={{width:6,height:6,borderRadius:'50%',background:t.id==='resolution'?'#22c55e':'var(--accent)',flexShrink:0}}/>}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{flex:1, overflowY:'auto', padding:'24px 28px', minHeight:0}}>
          {activeTab && (inc[activeTab.field]||'').trim() ? (
            <div className="inc-pv" style={{fontSize:14, lineHeight:1.8, color:'rgba(255,255,255,0.75)'}}
              dangerouslySetInnerHTML={{__html: renderMd(inc[activeTab.field])}}
            />
          ) : (
            <div style={{
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              height:'100%', gap:10, color:'rgba(255,255,255,0.2)',
            }}>
              <div style={{fontSize:36}}>
                {tab==='issue'?'📋':tab==='diagnostics'?'🔍':'✅'}
              </div>
              <div style={{fontSize:14, fontWeight:600}}>No {tab} notes yet</div>
              {canEdit && (
                <button onClick={()=>{onClose(); setTimeout(()=>onEdit(inc),50);}} style={{
                  marginTop:8, background:'rgba(0,194,255,0.1)', border:'1px solid rgba(0,194,255,0.25)',
                  borderRadius:8, padding:'7px 16px', cursor:'pointer',
                  color:'var(--accent)', fontSize:12, fontWeight:600,
                }}>✏ Add notes in editor</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────
function Modal({editId,form,setForm,onSave,onClose,users,currentUser,isManager}){
  const [tab,setTab]=useState('issue');
  const active=EDITOR_TABS.find(t=>t.id===tab);

  // Which tabs have content — show indicator
  const filled=EDITOR_TABS.reduce((a,t)=>({...a,[t.id]:!!(form[t.field]||'').trim()}),{});

  return (
    <div style={{
      position:'fixed',inset:0,zIndex:9000,
      background:'rgba(0,0,0,0.85)',
      backdropFilter:'blur(8px)',WebkitBackdropFilter:'blur(8px)',
      display:'flex',alignItems:'center',justifyContent:'center',
      padding:20,
      animation:'fadeInOverlay .2s ease',
    }}>
      <style>{`
        @keyframes fadeInOverlay{from{opacity:0}to{opacity:1}}
        @keyframes slideUpModal{from{opacity:0;transform:scale(.97) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}
      `}</style>

      <div style={{
        width:'100%',maxWidth:1080,height:'min(88vh,820px)',
        display:'flex',flexDirection:'column',
        background:'#0d1117',
        border:'1px solid rgba(255,255,255,0.1)',
        borderRadius:16,overflow:'hidden',
        boxShadow:'0 40px 120px rgba(0,0,0,0.8),0 0 0 1px rgba(255,255,255,0.04)',
        animation:'slideUpModal .28s cubic-bezier(.34,1.4,.64,1)',
      }}>

        {/* ── Header bar ────────────────────────────────────────────────── */}
        <div style={{
          display:'flex',alignItems:'center',gap:10,
          padding:'12px 16px',flexShrink:0,
          background:'rgba(255,255,255,0.02)',
          borderBottom:'1px solid rgba(255,255,255,0.07)',
        }}>
          {/* Type toggle */}
          <div style={{display:'flex',background:'rgba(255,255,255,0.05)',borderRadius:8,padding:3,gap:2,flexShrink:0}}>
            {[{v:false,label:'🚨 On-Call'},{v:true,label:'📋 Daily'}].map(({v,label})=>(
              <button key={String(v)} onClick={()=>setForm(f=>({...f,isDaily:v}))} style={{
                padding:'4px 12px',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
                background:form.isDaily===v?'rgba(255,255,255,0.1)':'transparent',
                color:form.isDaily===v?'#fff':'rgba(255,255,255,0.35)',
                transition:'all .15s',
              }}>{label}</button>
            ))}
          </div>

          {/* Title */}
          <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}
            placeholder="Incident title…"
            autoFocus
            style={{
              flex:1,background:'transparent',border:'none',outline:'none',
              fontSize:16,fontWeight:600,color:'#fff',minWidth:0,
              '::placeholder':{color:'rgba(255,255,255,0.2)'},
            }}
          />

          {/* Close */}
          <button onClick={onClose} style={{
            background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8,width:32,height:32,cursor:'pointer',
            color:'rgba(255,255,255,0.4)',fontSize:16,flexShrink:0,
            display:'flex',alignItems:'center',justifyContent:'center',
            transition:'all .15s',
          }}
            onMouseEnter={e=>{e.currentTarget.style.color='white';e.currentTarget.style.background='rgba(255,255,255,0.1)';}}
            onMouseLeave={e=>{e.currentTarget.style.color='rgba(255,255,255,0.4)';e.currentTarget.style.background='rgba(255,255,255,0.06)';}}
          >✕</button>
        </div>

        {/* ── Meta strip ────────────────────────────────────────────────── */}
        <div style={{
          display:'flex',gap:0,flexShrink:0,
          background:'rgba(255,255,255,0.015)',
          borderBottom:'1px solid rgba(255,255,255,0.07)',
          overflowX:'auto',
        }}>
          {[
            {label:'Severity', content:
              <select value={form.severity} onChange={e=>setForm(f=>({...f,severity:e.target.value}))} style={metaSel}>
                {SEVERITIES.map(s=><option key={s}>{s}</option>)}
              </select>
            },
            {label:'Status', content:
              <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={metaSel}>
                {STATUSES.map(s=><option key={s}>{s}</option>)}
              </select>
            },
            {label:'Assigned To', content:
              <select value={form.assigned_to} onChange={e=>setForm(f=>({...f,assigned_to:e.target.value}))} style={metaSel} disabled={!isManager}>
                <option value="">— pick —</option>
                {(isManager?users:users.filter(u=>u.id===currentUser)).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            },
            {label:'Date', content:
              <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={{...metaSel,colorScheme:'dark'}}/>
            },
            ...(!form.isDaily?[{label:'Hours (payroll)', content:
              <select value={form.hours} onChange={e=>setForm(f=>({...f,hours:Number(e.target.value)}))} style={metaSel}>
                {HOURS_OPTIONS.map(h=><option key={h} value={h}>{h}h</option>)}
              </select>
            }]:[{label:'Type', content:
              <select value={form.dailyType} onChange={e=>setForm(f=>({...f,dailyType:e.target.value}))} style={metaSel}>
                {DAILY_TYPES.map(t=><option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
              </select>
            }]),
          ].map(({label,content},i)=>(
            <div key={i} style={{
              display:'flex',flexDirection:'column',justifyContent:'center',
              padding:'8px 16px',borderRight:'1px solid rgba(255,255,255,0.06)',
              flexShrink:0,
            }}>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:3,fontWeight:600}}>{label}</div>
              {content}
            </div>
          ))}
        </div>

        {/* ── Two-panel body ─────────────────────────────────────────────── */}
        <div style={{flex:1,display:'flex',minHeight:0}}>

          {/* Left: tab sidebar */}
          <div style={{
            width:160,flexShrink:0,
            background:'rgba(255,255,255,0.02)',
            borderRight:'1px solid rgba(255,255,255,0.07)',
            display:'flex',flexDirection:'column',paddingTop:8,gap:2,
          }}>
            {EDITOR_TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                display:'flex',alignItems:'center',gap:8,
                padding:'9px 14px',border:'none',cursor:'pointer',
                background:tab===t.id?'rgba(255,255,255,0.07)':'transparent',
                color:tab===t.id?'#fff':'rgba(255,255,255,0.35)',
                fontSize:12,fontWeight:tab===t.id?600:400,
                textAlign:'left',width:'100%',
                borderLeft:`2px solid ${tab===t.id?'var(--accent)':'transparent'}`,
                transition:'all .15s',position:'relative',
              }}>
                <span style={{fontSize:14}}>{t.icon}</span>
                <span>{t.label}</span>
                {filled[t.id]&&<span style={{
                  position:'absolute',right:10,
                  width:6,height:6,borderRadius:'50%',
                  background:t.id==='resolution'?'#22c55e':'var(--accent)',
                }}/>}
              </button>
            ))}

            {/* Divider + hint */}
            {active&&<div style={{padding:'12px 14px 0',marginTop:'auto'}}>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.2)',lineHeight:1.5}}>{active.hint}</div>
            </div>}
          </div>

          {/* Right: editor */}
          <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
            {active&&<RichEditor key={tab} value={form[active.field]||''} onChange={v=>setForm(f=>({...f,[active.field]:v}))} placeholder={active.ph}/>}
          </div>
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div style={{
          display:'flex',alignItems:'center',justifyContent:'space-between',
          padding:'10px 16px',flexShrink:0,
          background:'rgba(255,255,255,0.02)',
          borderTop:'1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{display:'flex',gap:12,alignItems:'center'}}>
            <span style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>Markdown · ↑ Import .md / .txt / .docx · ◉ Preview</span>
            {/* Tab completion indicators */}
            <div style={{display:'flex',gap:6}}>
              {EDITOR_TABS.map(t=>(
                <div key={t.id} style={{display:'flex',alignItems:'center',gap:3,fontSize:10,color:filled[t.id]?'rgba(255,255,255,0.45)':'rgba(255,255,255,0.15)'}}>
                  <span style={{width:5,height:5,borderRadius:'50%',background:filled[t.id]?(t.id==='resolution'?'#22c55e':'var(--accent)'):'rgba(255,255,255,0.12)',flexShrink:0}}/>
                  {t.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={onClose} style={{
              background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',
              borderRadius:8,padding:'7px 16px',cursor:'pointer',
              color:'rgba(255,255,255,0.5)',fontSize:13,
            }}>Cancel</button>
            <button onClick={onSave} style={{
              background:'linear-gradient(135deg,var(--accent) 0%,color-mix(in srgb,var(--accent) 80%,#fff) 100%)',
              border:'none',borderRadius:8,padding:'7px 18px',cursor:'pointer',
              color:'#000',fontSize:13,fontWeight:700,
              boxShadow:'0 2px 12px rgba(0,194,255,0.3)',
              transition:'box-shadow .2s,transform .15s',
            }}
              onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 4px 24px rgba(0,194,255,0.5)';e.currentTarget.style.transform='translateY(-1px)';}}
              onMouseLeave={e=>{e.currentTarget.style.boxShadow='0 2px 12px rgba(0,194,255,0.3)';e.currentTarget.style.transform='';}}
            >{editId?'Save Changes':'🚨 Log Incident'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── metaSel style ──────────────────────────────────────────────────────────
const metaSel={
  background:'transparent',border:'none',outline:'none',
  color:'rgba(255,255,255,0.75)',fontSize:12,fontWeight:500,
  fontFamily:'DM Sans,sans-serif',cursor:'pointer',padding:0,
  appearance:'none',WebkitAppearance:'none',
};

// ── Main component ─────────────────────────────────────────────────────────
export default function Incidents({
  incidents, setIncidents,
  users, currentUser, isManager,
  driveToken, addLog,
}){
  const [view,setView]=useState('all');
  const [showModal,setShowModal]=useState(false);
  const [editId,setEditId]=useState(null);
  const [detailInc,setDetailInc]=useState(null);
  const [form,setForm]=useState({...BLANK});
  const [filter,setFilter]=useState({status:'all',severity:'all',uid:'all'});
  const [notify,setNotify]=useState('');
  const notifyTimer=useRef(null);

  // Drive save is handled by App.js useEffect: save('incidents', incidents)
  // We only need to call setIncidents — App.js handles the Drive write automatically.
  const safe=Array.isArray(incidents)?incidents:[];

  const toast=(msg)=>{
    setNotify(msg);
    clearTimeout(notifyTimer.current);
    notifyTimer.current=setTimeout(()=>setNotify(''),3500);
  };

  const openAdd=()=>{
    setForm({...BLANK,
      assigned_to:isManager?(users[0]?.id||currentUser):currentUser,
      isDaily:view==='daily',
      date:new Date().toISOString().slice(0,10),
    });
    setEditId(null); setShowModal(true);
  };

  const openEdit=(inc)=>{ setForm({...BLANK,...inc}); setEditId(inc.id); setShowModal(true); };

  const saveIncident=()=>{
    if(!form.title.trim()){toast('⚠ Title is required.');return;}
    if(!form.assigned_to){toast('⚠ Assignee is required.');return;}
    if(!isManager&&form.assigned_to!==currentUser){toast('⚠ You can only log incidents for yourself.');return;}
    const entry={
      ...form,
      id: editId||`inc_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      hours: Number(form.hours)||1,
      updated_at: new Date().toISOString(),
      created_at: editId?(safe.find(i=>i.id===editId)?.created_at||new Date().toISOString()):new Date().toISOString(),
    };
    // setIncidents triggers App.js useEffect → save('incidents', ...) → driveWrite
    setIncidents(editId?safe.map(i=>i.id===editId?entry:i):[entry,...safe]);
    setShowModal(false);
    toast(editId?'✅ Incident updated — saving to Drive…':'✅ Incident logged — saving to Drive…');
    addLog?.({section:'incidents',level:'info',action:editId?'Edit incident':'Log incident',detail:`${entry.severity} — "${entry.title}"`});
  };

  const deleteIncident=(id)=>{
    if(!isManager){toast('⚠ Manager only.');return;}
    if(!window.confirm('Delete this incident?')) return;
    const entry=safe.find(i=>i.id===id);
    setIncidents(safe.filter(i=>i.id!==id));
    toast('🗑 Deleted.');
    addLog?.({section:'incidents',level:'warning',action:'Delete incident',detail:`"${entry?.title||id}"`});
  };

  const resolveIncident=(id)=>{
    setIncidents(safe.map(i=>i.id===id?{...i,status:'Resolved',updated_at:new Date().toISOString()}:i));
    toast('✅ Resolved.');
  };

  // Filter + sort
  const vf=safe.filter(i=>{
    if(view==='daily') return i.isDaily===true;
    if(view==='oncall') return !i.isDaily;
    return true;
  });
  const df=vf.filter(i=>{
    if(filter.status!=='all'&&i.status!==filter.status) return false;
    if(filter.severity!=='all'&&i.severity!==filter.severity) return false;
    if(filter.uid!=='all'&&i.assigned_to!==filter.uid) return false;
    return true;
  });
  const sorted=[...df].sort((a,b)=>{
    const sO={Investigating:0,Identified:1,Monitoring:2,Resolved:3};
    const vO={Disaster:0,Critical:1,High:2,Medium:3,Low:4};
    if(sO[a.status]!==sO[b.status]) return (sO[a.status]??9)-(sO[b.status]??9);
    return (vO[a.severity]??9)-(vO[b.severity]??9);
  });

  const openC=safe.filter(i=>i.status==='Investigating').length;
  const todayS=new Date().toISOString().slice(0,10);

  return (
    <div>
      {/* Toast */}
      {notify&&(
        <div style={{
          position:'fixed',top:20,right:20,zIndex:99999,
          background:'rgba(14,21,37,0.92)',backdropFilter:'blur(20px)',
          border:'1px solid rgba(0,194,255,0.25)',borderRadius:12,
          padding:'11px 16px',fontSize:13,fontWeight:500,color:'var(--text-primary)',
          boxShadow:'0 8px 32px rgba(0,0,0,0.5)',
          animation:'slideInToast .3s cubic-bezier(.34,1.4,.64,1)',
        }}>{notify}</div>
      )}

      {/* Header */}
      <div className="page-header">
        <div className="flex-between">
          <div>
            <div className="page-title">🚨 Incidents</div>
            <div className="page-sub">On-call &amp; daily incident log · auto-saves to Drive</div>
          </div>
          <button className="btn btn-primary" onClick={openAdd} style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:16,fontWeight:300}}>+</span> Log Incident
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
        {[
          {label:'Open',    val:openC,                                                                   sub:'Investigating',color:'#ef4444',bg:'rgba(239,68,68,0.08)',  bd:'rgba(239,68,68,0.2)'},
          {label:'Resolved',val:safe.filter(i=>i.status==='Resolved').length,                            sub:'All time',    color:'#22c55e',bg:'rgba(34,197,94,0.08)', bd:'rgba(34,197,94,0.2)'},
          {label:'Today',   val:safe.filter(i=>(i.date||'').slice(0,10)===todayS).length,                sub:'Logged today',color:'#f59e0b',bg:'rgba(245,158,11,0.08)',bd:'rgba(245,158,11,0.2)'},
          {label:'Daily',   val:safe.filter(i=>i.isDaily).length,                                        sub:'Ops',         color:'#a78bfa',bg:'rgba(167,139,250,0.08)',bd:'rgba(167,139,250,0.2)'},
          {label:'Total',   val:safe.length,                                                             sub:'All incidents',color:'var(--accent)',bg:'rgba(0,194,255,0.05)',bd:'rgba(0,194,255,0.15)'},
        ].map(({label,val,sub,color,bg,bd})=>(
          <div key={label} style={{
            flex:1,minWidth:90,
            background:bg,border:`1px solid ${bd}`,borderRadius:12,
            padding:'14px 16px',
          }}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:4,fontWeight:700}}>{label}</div>
            <div style={{fontSize:28,fontWeight:700,color,lineHeight:1,marginBottom:2}}>{val}</div>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{
        display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',
        marginBottom:16,
      }}>
        {/* View pills */}
        <div style={{display:'flex',background:'rgba(255,255,255,0.04)',borderRadius:8,padding:3,gap:2}}>
          {[{id:'all',label:'All'},{id:'daily',label:'📋 Daily'},{id:'oncall',label:'🚨 On-Call'}].map(t=>(
            <button key={t.id} onClick={()=>setView(t.id)} style={{
              padding:'4px 12px',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
              background:view===t.id?'rgba(255,255,255,0.1)':'transparent',
              color:view===t.id?'#fff':'rgba(255,255,255,0.35)',
              transition:'all .15s',
            }}>{t.label}</button>
          ))}
        </div>
        <select className="form-input" style={{width:138,fontSize:12}} value={filter.status} onChange={e=>setFilter(f=>({...f,status:e.target.value}))}>
          <option value="all">All Statuses</option>
          {STATUSES.map(s=><option key={s}>{s}</option>)}
        </select>
        <select className="form-input" style={{width:120,fontSize:12}} value={filter.severity} onChange={e=>setFilter(f=>({...f,severity:e.target.value}))}>
          <option value="all">All Severities</option>
          {SEVERITIES.map(s=><option key={s}>{s}</option>)}
        </select>
        <select className="form-input" style={{width:148,fontSize:12}} value={filter.uid} onChange={e=>setFilter(f=>({...f,uid:e.target.value}))}>
          <option value="all">All Engineers</option>
          {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {(filter.status!=='all'||filter.severity!=='all'||filter.uid!=='all')&&(
          <button className="btn btn-secondary btn-sm" onClick={()=>setFilter({status:'all',severity:'all',uid:'all'})}>✕ Clear</button>
        )}
        <span style={{marginLeft:'auto',fontSize:11,color:'rgba(255,255,255,0.25)'}}>{sorted.length} incident{sorted.length!==1?'s':''}</span>
      </div>

      {/* List */}
      {sorted.length===0?(
        <div style={{
          textAlign:'center',padding:'60px 0',
          background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.06)',
          borderRadius:12,
        }}>
          <div style={{fontSize:40,marginBottom:12}}>🎉</div>
          <div style={{fontSize:15,fontWeight:600,color:'rgba(255,255,255,0.4)',marginBottom:4}}>No incidents match these filters</div>
          <div style={{fontSize:12,color:'rgba(255,255,255,0.2)'}}>All clear — use the button above to log one.</div>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {sorted.map(inc=>(
            <IncCard key={inc.id} inc={inc} users={users} isManager={isManager}
              currentUser={currentUser} onEdit={openEdit} onDelete={deleteIncident} onResolve={resolveIncident} onView={setDetailInc}/>
          ))}
        </div>
      )}

      {showModal&&(
        <Modal editId={editId} form={form} setForm={setForm}
          onSave={saveIncident} onClose={()=>setShowModal(false)}
          users={users} currentUser={currentUser} isManager={isManager}/>
      )}
      {detailInc&&(
        <DetailView
          inc={detailInc}
          users={users}
          isManager={isManager}
          currentUser={currentUser}
          onClose={()=>setDetailInc(null)}
          onEdit={(inc)=>{ setDetailInc(null); openEdit(inc); }}
          onResolve={(id)=>{ resolveIncident(id); setDetailInc(prev=>prev&&prev.id===id?{...prev,status:'Resolved'}:prev); }}
        />
      )}
    </div>
  );
}
