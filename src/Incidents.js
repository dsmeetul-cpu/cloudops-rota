// src/Incidents.js
// CloudOps Rota — Incidents Component
// Meetul Bhundia (MBA47) · Cloud Run Operations · 2nd June 2026

import React, { useState, useRef, useEffect } from 'react';

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

function Modal({ title, onClose, children, wide, fullscreen }) {
  // Escape key closes
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const boxStyle = fullscreen
    ? {
        position: 'fixed', inset: 0, margin: 0, width: '100vw', height: '100vh',
        maxWidth: '100vw', maxHeight: '100vh', borderRadius: 0,
        display: 'flex', flexDirection: 'column',
      }
    : wide ? { width: 760 } : {};

  return (
    <div className="modal-overlay" style={fullscreen ? { padding: 0, alignItems: 'stretch' } : {}}
      onClick={e => !fullscreen && e.target === e.currentTarget && onClose()}>
      <div className="modal" style={boxStyle}>
        <div className="modal-header" style={{
          padding: fullscreen ? '14px 20px' : undefined,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          background: 'var(--bg-card)',
          position: 'sticky', top: 0, zIndex: 10,
        }}>
          <div className="modal-title" style={{ fontSize: fullscreen ? 16 : 15 }}>{title}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {fullscreen && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Press Esc to close</span>
            )}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={{
          padding: fullscreen ? '20px 28px 28px' : '0 20px 20px',
          flex: 1, overflowY: 'auto',
        }}>{children}</div>
      </div>
    </div>
  );
}

function FormGroup({ label, children, hint }) {
  return (
    <div className="form-group">
      <label className="form-label">
        {label}
        {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>({hint})</span>}
      </label>
      {children}
    </div>
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

// ── Bulk-select hook ───────────────────────────────────────────────────────
function useBulkSelect(items) {
  const [selected, setSelected] = useState(new Set());
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => prev.size === items.length ? new Set() : new Set(items.map(i => i.id)));
  const clearAll  = () => setSelected(new Set());
  return { selected, toggleOne, toggleAll, clearAll };
}

// ── Rich text editor — Word-style ribbon ──────────────────────────────────
function RichEditor({ value, onChange, placeholder = 'Start typing…', rows = 8, fullPage = false }) {
  const ref     = useRef(null);
  const fileRef = useRef(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findVal,  setFindVal]  = useState('');
  const [replVal,  setReplVal]  = useState('');

  const exec = (cmd, val = null) => { document.execCommand(cmd, false, val); ref.current?.focus(); };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'md' || ext === 'txt') {
      const text = await file.text();
      let html = text
        .replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,0.4);padding:2px 5px;border-radius:4px;font-family:DM Mono,monospace">$1</code>')
        .replace(/^- (.+)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
        .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
      html = '<p>' + html + '</p>';
      if (ref.current) { ref.current.innerHTML = html; onChange?.(html); }
    } else if (ext === 'csv') {
      const text = await file.text();
      const rows = text.trim().split('\n').map(r => r.split(','));
      let html = '<table border="1" style="border-collapse:collapse;width:100%">';
      rows.forEach((r, i) => { html += '<tr>'; r.forEach(c => { html += i === 0 ? `<th style="padding:4px 8px;background:#1e3a5f">${c.trim()}</th>` : `<td style="padding:4px 8px">${c.trim()}</td>`; }); html += '</tr>'; });
      html += '</table>';
      if (ref.current) { ref.current.innerHTML = html; onChange?.(html); }
    } else if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
      const loadJSZip = () => new Promise((res, rej) => {
        if (window.JSZip) { res(window.JSZip); return; }
        const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = () => res(window.JSZip); s.onerror = rej; document.head.appendChild(s);
      });
      try {
        const JSZip = await loadJSZip(); const ab = await file.arrayBuffer(); const zip = await JSZip.loadAsync(ab);
        let text = ''; const targets = ext === 'docx' ? ['word/document.xml'] : ext === 'pptx' ? Object.keys(zip.files).filter(n => n.startsWith('ppt/slides/slide') && n.endsWith('.xml')) : ['xl/sharedStrings.xml'];
        for (const t of targets) { const f = zip.file(t); if (f) { text += (await f.async('text')).replace(/<[^>]+>/g, ' ') + '\n'; } }
        text = text.replace(/\s+/g, ' ').trim().slice(0, 20000);
        const html = '<p>' + text.split(/(?<=[.!?])\s+/).filter(Boolean).join('</p><p>') + '</p>';
        if (ref.current) { ref.current.innerHTML = html || `<p><em>📎 ${file.name} imported</em></p>`; onChange?.(ref.current.innerHTML); }
      } catch { const msg = `<p><em>📎 ${file.name}</em></p><p style="color:#fcd34d">⚠ Could not extract text.</p>`; if (ref.current) { ref.current.innerHTML = msg; onChange?.(msg); } }
    } else {
      const text = await file.text().catch(() => '[Binary file]');
      const html = `<p><em>📎 ${file.name}</em></p><pre style="font-size:11px;overflow:auto">${text.slice(0, 3000)}</pre>`;
      if (ref.current) { ref.current.innerHTML = html; onChange?.(html); }
    }
    e.target.value = '';
  };

  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || ''; }, []); // eslint-disable-line

  const insertTable = () => {
    exec('insertHTML', `<table border="1" style="border-collapse:collapse;width:100%;margin:8px 0"><tr><th style="padding:6px 10px;background:#1e3a5f;min-width:80px">Header 1</th><th style="padding:6px 10px;background:#1e3a5f;min-width:80px">Header 2</th><th style="padding:6px 10px;background:#1e3a5f;min-width:80px">Header 3</th></tr><tr><td style="padding:6px 10px">Cell</td><td style="padding:6px 10px">Cell</td><td style="padding:6px 10px">Cell</td></tr><tr><td style="padding:6px 10px">Cell</td><td style="padding:6px 10px">Cell</td><td style="padding:6px 10px">Cell</td></tr></table><p></p>`);
  };

  const insertCodeBlock = () => {
    exec('insertHTML', `<pre style="background:rgba(0,0,0,0.55);padding:14px 16px;border-radius:8px;overflow:auto;font-size:12px;font-family:DM Mono,Courier New,monospace;color:#6ee7b7;margin:10px 0;border:1px solid rgba(110,231,183,0.2)">// paste your code here</pre><p></p>`);
  };

  const insertCallout = (type = 'info') => {
    const styles = {
      info:    ['rgba(0,194,255,0.1)', 'rgba(0,194,255,0.3)', '#7dd3fc', 'ℹ️'],
      warning: ['rgba(245,158,11,0.1)', 'rgba(245,158,11,0.3)', '#fcd34d', '⚠️'],
      success: ['rgba(16,185,129,0.1)', 'rgba(16,185,129,0.3)', '#6ee7b7', '✅'],
      danger:  ['rgba(239,68,68,0.1)', 'rgba(239,68,68,0.3)', '#fca5a5', '🔴'],
    };
    const [bg, border, color, icon] = styles[type] || styles.info;
    exec('insertHTML', `<div style="background:${bg};border-left:4px solid ${border};padding:12px 16px;border-radius:0 8px 8px 0;margin:10px 0;color:${color}">${icon} <strong>Note:</strong> Add your callout text here.</div><p></p>`);
  };

  const insertLink = () => {
    const url  = prompt('Enter URL:');
    const text = prompt('Link text (leave blank to wrap selection):');
    if (url && text) exec('insertHTML', `<a href="${url}" target="_blank" style="color:var(--accent)">${text}</a>`);
    else if (url) exec('createLink', url);
  };

  const insertHR = () => exec('insertHTML', '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:18px 0"/><p></p>');

  const insertInlineCode = () => exec('insertHTML', `<code style="background:rgba(0,0,0,0.4);padding:2px 6px;border-radius:4px;font-family:DM Mono,monospace;font-size:0.9em;color:#6ee7b7"> code </code>`);

  const doFind = () => {
    if (!findVal) return;
    const body = ref.current;
    if (!body) return;
    // Simple highlight via innerHTML replace (non-destructive for plain finds)
    const html = body.innerHTML.replace(
      new RegExp(findVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      m => `<mark style="background:#fbbf24;color:#000">${m}</mark>`
    );
    body.innerHTML = html;
    onChange?.(body.innerHTML);
  };
  const doReplace = () => {
    if (!findVal) return;
    const body = ref.current;
    if (!body) return;
    const html = body.innerHTML.replace(
      new RegExp(findVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replVal
    );
    body.innerHTML = html; onChange?.(body.innerHTML);
  };

  const minH = fullPage ? '55vh' : rows * 22;

  // ── Shared button style ──────────────────────────────────────────────────
  const TB = (extra = {}) => ({
    padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)',
    background: 'var(--bg-card2)', color: 'var(--text-primary)',
    cursor: 'pointer', fontSize: 12, display: 'inline-flex',
    alignItems: 'center', gap: 4, whiteSpace: 'nowrap', lineHeight: 1.3,
    ...extra,
  });
  const SEP = <div style={{ width: 1, background: 'var(--border)', margin: '0 4px', alignSelf: 'stretch' }} />;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card2)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Row 1: Paragraph styles, font, size, character formatting ───────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '7px 10px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'var(--bg-card)', alignItems: 'center' }}>
        {/* Styles */}
        <select onChange={e => { exec('formatBlock', e.target.value); e.target.value = ''; }} defaultValue=""
          style={{ ...TB(), padding: '4px 6px', fontSize: 11, minWidth: 110 }}>
          <option value="" disabled>¶ Paragraph Style</option>
          <option value="p">Normal Text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="h5">Heading 5</option>
          <option value="pre">Code Block</option>
          <option value="blockquote">Block Quote</option>
        </select>
        {/* Font */}
        <select onChange={e => { exec('fontName', e.target.value); e.target.value = ''; }} defaultValue=""
          style={{ ...TB(), padding: '4px 6px', fontSize: 11, minWidth: 100 }}>
          <option value="" disabled>Font</option>
          {['Arial', 'Georgia', 'Courier New', 'Verdana', 'Times New Roman', 'Trebuchet MS', 'DM Sans', 'system-ui'].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        {/* Size */}
        <select onChange={e => exec('fontSize', e.target.value)} defaultValue=""
          style={{ ...TB(), padding: '4px 6px', fontSize: 11, width: 60 }}>
          <option value="" disabled>Size</option>
          {[1,2,3,4,5,6,7].map(s => <option key={s} value={s}>{[8,10,12,14,18,24,36][s-1]}pt</option>)}
        </select>
        {SEP}
        {/* Bold, Italic, Underline, Strikethrough */}
        <button onMouseDown={e=>{e.preventDefault();exec('bold')}}          style={{...TB(),fontWeight:700,minWidth:30}}>B</button>
        <button onMouseDown={e=>{e.preventDefault();exec('italic')}}        style={{...TB(),fontStyle:'italic',minWidth:30}}>I</button>
        <button onMouseDown={e=>{e.preventDefault();exec('underline')}}     style={{...TB(),textDecoration:'underline',minWidth:30}}>U</button>
        <button onMouseDown={e=>{e.preventDefault();exec('strikeThrough')}} style={{...TB(),minWidth:30}}>S̶</button>
        <button onMouseDown={e=>{e.preventDefault();exec('superscript')}}   style={{...TB(),fontSize:10,minWidth:28}}>x²</button>
        <button onMouseDown={e=>{e.preventDefault();exec('subscript')}}     style={{...TB(),fontSize:10,minWidth:28}}>x₂</button>
        {SEP}
        {/* Colour pickers */}
        <div style={{ display:'flex', alignItems:'center', gap:3 }}>
          <span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700 }}>A</span>
          <input type="color" defaultValue="#ffffff" onChange={e=>exec('foreColor',e.target.value)} title="Text colour"
            style={{ width:22, height:22, border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', padding:1 }} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:3 }}>
          <span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700 }}>BG</span>
          <input type="color" defaultValue="#1e3a5f" onChange={e=>exec('hiliteColor',e.target.value)} title="Highlight colour"
            style={{ width:22, height:22, border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', padding:1 }} />
        </div>
        {SEP}
        {/* Alignment */}
        {[['justifyLeft','⬛▫▫','Left'],['justifyCenter','▫⬛▫','Centre'],['justifyRight','▫▫⬛','Right'],['justifyFull','⬛⬛⬛','Justify']].map(([cmd,icon,tip]) => (
          <button key={cmd} onMouseDown={e=>{e.preventDefault();exec(cmd)}} title={tip}
            style={{...TB(),fontSize:9,minWidth:28}}>{icon}</button>
        ))}
        {SEP}
        {/* Undo / Redo */}
        <button onMouseDown={e=>{e.preventDefault();exec('undo')}} title="Undo (Ctrl+Z)" style={{...TB(),fontSize:14}}>↩</button>
        <button onMouseDown={e=>{e.preventDefault();exec('redo')}} title="Redo (Ctrl+Y)" style={{...TB(),fontSize:14}}>↪</button>
        <button onMouseDown={e=>{e.preventDefault();exec('removeFormat')}} title="Clear Formatting"
          style={{...TB(),color:'var(--text-muted)'}}>✕ Fmt</button>
      </div>

      {/* ── Row 2: Lists, Insert, Find ───────────────────────────────────────── */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:3, padding:'4px 10px 6px', borderBottom:'1px solid var(--border)', background:'var(--bg-card)', alignItems:'center' }}>
        {/* Lists & indent */}
        <button onMouseDown={e=>{e.preventDefault();exec('insertUnorderedList')}} style={TB()}>• Bullet List</button>
        <button onMouseDown={e=>{e.preventDefault();exec('insertOrderedList')}}   style={TB()}>1. Numbered</button>
        <button onMouseDown={e=>{e.preventDefault();exec('indent')}}    title="Increase indent" style={TB()}>→ Indent</button>
        <button onMouseDown={e=>{e.preventDefault();exec('outdent')}}   title="Decrease indent" style={TB()}>← Outdent</button>
        {SEP}
        {/* Insert blocks */}
        <button onMouseDown={e=>{e.preventDefault();insertTable()}}     style={{...TB(),color:'var(--accent)'}}>⊞ Table</button>
        <button onMouseDown={e=>{e.preventDefault();insertLink()}}      style={{...TB(),color:'var(--accent)'}}>🔗 Link</button>
        <button onMouseDown={e=>{e.preventDefault();insertHR()}}        style={{...TB(),color:'var(--text-muted)'}}>─ Rule</button>
        <button onMouseDown={e=>{e.preventDefault();insertInlineCode()}} style={{...TB(),fontFamily:'DM Mono,monospace',color:'#6ee7b7',fontSize:11}}>{`<>`} Inline Code</button>
        <button onMouseDown={e=>{e.preventDefault();insertCodeBlock()}} style={{...TB(),fontFamily:'DM Mono,monospace',color:'#6ee7b7'}}>{`{}`} Code Block</button>
        {SEP}
        {/* Callouts */}
        <button onMouseDown={e=>{e.preventDefault();insertCallout('info')}}    style={{...TB(),color:'#7dd3fc',fontSize:11}}>ℹ️ Info</button>
        <button onMouseDown={e=>{e.preventDefault();insertCallout('warning')}} style={{...TB(),color:'#fcd34d',fontSize:11}}>⚠️ Warning</button>
        <button onMouseDown={e=>{e.preventDefault();insertCallout('success')}} style={{...TB(),color:'#6ee7b7',fontSize:11}}>✅ Note</button>
        <button onMouseDown={e=>{e.preventDefault();insertCallout('danger')}}  style={{...TB(),color:'#fca5a5',fontSize:11}}>🔴 Alert</button>
        {SEP}
        {/* Import */}
        <label style={{ ...TB(), color:'var(--accent)', cursor:'pointer' }}>
          📎 Import
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.docx,.pptx,.xlsx,.html" onChange={handleImport} style={{ display:'none' }} />
        </label>
        {/* Find & Replace toggle */}
        <button onMouseDown={e=>{e.preventDefault();setFindOpen(p=>!p)}}
          style={{...TB(),color: findOpen?'var(--accent)':'var(--text-muted)'}}>
          🔍 Find
        </button>
      </div>

      {/* ── Find & Replace bar ────────────────────────────────────────────────── */}
      {findOpen && (
        <div style={{ display:'flex', gap:6, padding:'6px 10px', borderBottom:'1px solid var(--border)', background:'rgba(0,0,0,0.2)', alignItems:'center', flexWrap:'wrap' }}>
          <input value={findVal} onChange={e=>setFindVal(e.target.value)} placeholder="Find…"
            style={{ padding:'4px 8px', borderRadius:5, border:'1px solid var(--border)', background:'var(--bg-card2)', color:'var(--text-primary)', fontSize:12, width:160 }} />
          <input value={replVal} onChange={e=>setReplVal(e.target.value)} placeholder="Replace with…"
            style={{ padding:'4px 8px', borderRadius:5, border:'1px solid var(--border)', background:'var(--bg-card2)', color:'var(--text-primary)', fontSize:12, width:160 }} />
          <button onClick={doFind}    style={{...TB(),color:'var(--accent)'}}>Find & Highlight</button>
          <button onClick={doReplace} style={{...TB(),color:'#fcd34d'}}>Replace All</button>
          <button onClick={()=>setFindOpen(false)} style={{...TB(),color:'var(--text-muted)'}}>✕</button>
        </div>
      )}

      {/* ── Editable content area ─────────────────────────────────────────────── */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange?.(ref.current.innerHTML)}
        data-placeholder={placeholder}
        style={{
          minHeight: minH, padding: fullPage ? '28px 36px' : '14px 16px',
          outline: 'none', fontSize: 14, color: 'var(--text-primary)',
          lineHeight: 1.85, caretColor: 'var(--accent)', flex: 1,
          fontFamily: 'Georgia, "Times New Roman", serif',
          // Style embedded elements
        }}
      />
      <style>{`
        [contenteditable] h1{font-size:1.9em;font-weight:800;margin:.5em 0 .3em}
        [contenteditable] h2{font-size:1.5em;font-weight:700;margin:.5em 0 .3em}
        [contenteditable] h3{font-size:1.2em;font-weight:700;margin:.5em 0 .25em}
        [contenteditable] h4{font-size:1.05em;font-weight:700;margin:.4em 0 .2em}
        [contenteditable] blockquote{border-left:4px solid var(--accent);margin:8px 0;padding:6px 14px;background:rgba(0,194,255,0.05);border-radius:0 6px 6px 0;font-style:italic}
        [contenteditable] pre{background:rgba(0,0,0,0.55);padding:14px 16px;border-radius:8px;font-family:'DM Mono',monospace;font-size:12px;color:#6ee7b7;overflow:auto;margin:8px 0}
        [contenteditable] code{background:rgba(0,0,0,0.4);padding:2px 5px;border-radius:4px;font-family:'DM Mono',monospace;font-size:.9em;color:#6ee7b7}
        [contenteditable] table{border-collapse:collapse;width:100%;margin:8px 0}
        [contenteditable] td,[contenteditable] th{border:1px solid rgba(255,255,255,0.12);padding:6px 10px;font-size:13px}
        [contenteditable] th{background:#1e3a5f;font-weight:700}
        [contenteditable] ul,[contenteditable] ol{padding-left:1.5em;margin:.4em 0}
        [contenteditable] a{color:var(--accent)}
        [contenteditable]:empty:before{content:attr(data-placeholder);color:var(--text-muted);pointer-events:none}
        [contenteditable] hr{border:none;border-top:1px solid rgba(255,255,255,0.15);margin:18px 0}
      `}</style>
    </div>
  );
}


// ── Incident severity options ──────────────────────────────────────────────
const INC_SEVERITIES = [
  { value: 'Disaster', label: '🔴 Disaster', color: '#ef4444' },
  { value: 'High',     label: '🟠 High',     color: '#f59e0b' },
];

// ── Incident Tabs (Issue | Actions | Solution) ────────────────────────────
function IncidentTabs({ form, setForm }) {
  const [activeTab, setActiveTab] = useState('issue');

  const TABS = [
    { id: 'issue',    label: '🔴 Issue',        color: '#fca5a5', border: 'rgba(239,68,68,0.4)',   bg: 'rgba(239,68,68,0.12)'  },
    { id: 'actions',  label: '⚙️ Actions Taken', color: '#fcd34d', border: 'rgba(245,158,11,0.4)',  bg: 'rgba(245,158,11,0.12)' },
    { id: 'solution', label: '✅ Solution',       color: '#6ee7b7', border: 'rgba(16,185,129,0.4)', bg: 'rgba(16,185,129,0.12)' },
  ];

  const attachImages = (field, files) => {
    const readers = Array.from(files).map(f => new Promise(res => {
      const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(f);
    }));
    Promise.all(readers).then(imgs => setForm(prev => ({ ...prev, [field]: [...(prev[field] || []), ...imgs] })));
  };
  const removeImage = (field, i) => setForm(prev => ({ ...prev, [field]: (prev[field] || []).filter((_, j) => j !== i) }));

  const tab = TABS.find(t => t.id === activeTab);

  return (
    <div style={{ marginTop: 16 }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 16px', borderRadius: '8px 8px 0 0', border: `1px solid ${t.border}`,
              borderBottom: activeTab === t.id ? '1px solid var(--bg-card2)' : `1px solid ${t.border}`,
              background: activeTab === t.id ? t.bg : 'var(--bg-card)',
              color: activeTab === t.id ? t.color : 'var(--text-muted)',
              fontWeight: activeTab === t.id ? 700 : 400, fontSize: 12, cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
            {t.label}
            {(activeTab !== t.id) && (
              (t.id === 'issue'    && (form.issue_desc    || (form.issue_images   || []).length > 0)) ||
              (t.id === 'actions'  && (form.actions_desc  || form.actions_code || (form.actions_images || []).length > 0)) ||
              (t.id === 'solution' && form.solution_desc)
            ) ? <span style={{ marginLeft: 5, background: t.color, color: '#000', borderRadius: '50%', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>✓</span> : null}
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <div style={{ border: `1px solid ${tab.border}`, borderRadius: '0 8px 8px 8px', background: tab.bg, padding: 14 }}>
        {/* Attach image button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <label style={{ cursor: 'pointer', fontSize: 12, color: 'var(--accent)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)' }}>
            📎 Attach Image
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => {
              const field = activeTab === 'issue' ? 'issue_images' : activeTab === 'actions' ? 'actions_images' : 'solution_images';
              attachImages(field, e.target.files); e.target.value = '';
            }} />
          </label>
        </div>

        {activeTab === 'issue' && (
          <>
            <RichEditor value={form.issue_desc} onChange={v => setForm(f => ({ ...f, issue_desc: v }))}
              placeholder="Describe the issue — what happened, what was impacted, error messages…" rows={6} />
            {(form.issue_images || []).length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {form.issue_images.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt={`issue-${i}`} style={{ width: 110, height: 85, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                    <button onClick={() => removeImage('issue_images', i)} style={{ position: 'absolute', top: 2, right: 2, background: '#ef4444', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'actions' && (
          <>
            <RichEditor value={form.actions_desc} onChange={v => setForm(f => ({ ...f, actions_desc: v }))}
              placeholder="What actions were taken? Commands run, services restarted, people contacted…" rows={6} />
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Code Block / Command Output</div>
              <textarea className="input" style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, minHeight: 80, background: 'rgba(0,0,0,0.4)' }}
                placeholder="Paste commands, logs, or results here…" value={form.actions_code || ''}
                onChange={e => setForm(f => ({ ...f, actions_code: e.target.value }))} />
            </div>
            {(form.actions_images || []).length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {form.actions_images.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt={`action-${i}`} style={{ width: 110, height: 85, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                    <button onClick={() => removeImage('actions_images', i)} style={{ position: 'absolute', top: 2, right: 2, background: '#ef4444', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'solution' && (
          <>
            <RichEditor value={form.solution_desc} onChange={v => setForm(f => ({ ...f, solution_desc: v }))}
              placeholder="How was it resolved? Root cause, fix applied, follow-up actions required…" rows={6} />
            {(form.solution_images || []).length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {form.solution_images.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt={`solution-${i}`} style={{ width: 110, height: 85, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                    <button onClick={() => removeImage('solution_images', i)} style={{ position: 'absolute', top: 2, right: 2, background: '#ef4444', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Incidents ──────────────────────────────────────────────────────────────
export default function Incidents({ users, incidents, setIncidents, currentUser, isManager, timesheets, setTimesheets }) {
  const [showModal, setShowModal] = useState(false);
  const [viewInc,   setViewInc]   = useState(null);
  const [editInc,   setEditInc]   = useState(null);
  const [filter,    setFilter]    = useState('all');
  const { selected, toggleOne, toggleAll, clearAll } = useBulkSelect(incidents);

  const EMPTY_FORM = {
    alert_name: '', vm_service: '', severity: 'Disaster', assigned_to: currentUser,
    kb_ref: '', ticket_ref: '', email_ref: '',
    issue_desc: '', issue_images: [],
    actions_desc: '', actions_images: [], actions_code: '',
    solution_desc: '',
    duration_hours: '',
  };
  const [form, setForm] = useState(EMPTY_FORM);

  const openAdd  = ()        => { setForm({ ...EMPTY_FORM, assigned_to: currentUser }); setEditInc(null); setShowModal(true); };
  const openEdit = (inc, e)  => { e.stopPropagation(); setForm({ ...inc }); setEditInc(inc.id); setShowModal(true); };

  // ── Timesheet helpers ─────────────────────────────────────────────────────
  // Builds one timesheet row for an incident — worked hours only (not standby)
  const makeTimesheetEntry = (incId, alertName, incDate, hours) => {
    const dow  = new Date(incDate + 'T12:00:00').getDay();
    const isWE = dow === 0 || dow === 6;
    return {
      week:           `INC ${incId}`,
      weekday_oncall: 0,
      weekend_oncall: 0,
      // Incident response = actively worked hours, not standby
      worked_wd:  isWE ? 0 : hours,
      worked_we:  isWE ? hours : 0,
      standby_wd: 0,
      standby_we: 0,
      notes:      `Incident: ${alertName} (${incDate}, ${hours}h)`,
      autoLogged: true,
      incidentId: incId,
      date:       incDate,   // explicit ISO date for payroll range filtering
    };
  };

  // Remove any existing timesheet row for this incident from one user
  const removeIncidentTimesheet = (incId, userId) => {
    if (!setTimesheets || !userId) return;
    const label = `INC ${incId}`;
    setTimesheets(prev => ({
      ...prev,
      [userId]: (prev[userId] || []).filter(e => e.week !== label),
    }));
  };

  // Add (or replace) timesheet row for this incident for one user
  const addIncidentTimesheet = (incId, userId, alertName, incDate, hours) => {
    if (!setTimesheets || !userId || !hours) return;
    const entry = makeTimesheetEntry(incId, alertName, incDate, +hours);
    setTimesheets(prev => ({
      ...prev,
      [userId]: [entry, ...(prev[userId] || []).filter(e => e.week !== `INC ${incId}`)],
    }));
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const save = () => {
    if (!form.alert_name) return;
    const combinedDesc = [
      form.issue_desc    ? `<h3>🔴 Issue</h3>${form.issue_desc}` : '',
      form.actions_desc  ? `<h3>⚙️ Actions Taken</h3>${form.actions_desc}${form.actions_code ? `<pre style="background:rgba(0,0,0,0.4);padding:10px;border-radius:6px;overflow:auto;font-size:12px">${form.actions_code}</pre>` : ''}` : '',
      form.solution_desc ? `<h3>✅ Solution</h3>${form.solution_desc}` : '',
    ].filter(Boolean).join('');

    if (editInc) {
      // ── Edit path ──────────────────────────────────────────────────────────
      const oldInc  = incidents.find(i => i.id === editInc);
      const oldHrs  = +(oldInc?.duration_hours || 0);
      const newHrs  = +(form.duration_hours    || 0);
      const oldUid  = oldInc?.assigned_to;
      const newUid  = form.assigned_to;
      const incDate = (oldInc?.date || new Date().toISOString()).slice(0, 10);

      setIncidents(incidents.map(i => i.id === editInc ? { ...i, ...form, desc: combinedDesc } : i));

      // Step 1: remove old timesheet entry if user changed OR duration cleared
      if (oldHrs > 0 && (oldUid !== newUid || newHrs === 0)) {
        removeIncidentTimesheet(editInc, oldUid);
      }

      // Step 2: add / update new timesheet entry if duration is set
      if (newHrs > 0 && newUid) {
        // Also clean up old user's entry when reassigned
        if (oldUid && oldUid !== newUid && oldHrs > 0) {
          removeIncidentTimesheet(editInc, oldUid);
        }
        addIncidentTimesheet(editInc, newUid, form.alert_name, incDate, newHrs);
      }

    } else {
      // ── New incident path ──────────────────────────────────────────────────
      const trigram = (currentUser || 'UNK').toUpperCase();
      const id      = `${trigram}-${Date.now()}`;
      // Use local date (not UTC) to avoid timezone-shift at midnight
      const _now    = new Date();
      const incDate = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
      const newInc  = {
        id, ...form, desc: combinedDesc,
        status: 'Investigating', reporter: currentUser,
        date: `${incDate} ${String(_now.getHours()).padStart(2,'0')}:${String(_now.getMinutes()).padStart(2,'0')}`,
        updates: [],
      };
      setIncidents(prev => {
        const safe = Array.isArray(prev) ? prev : [];
        return [newInc, ...safe];
      });

      if (form.duration_hours && form.assigned_to) {
        addIncidentTimesheet(id, form.assigned_to, form.alert_name, incDate, +form.duration_hours);
      }
    }
    setShowModal(false); setForm(EMPTY_FORM);
  };

  const resolve = (id, e) => {
    e.stopPropagation();
    setIncidents(incidents.map(i => i.id === id
      ? { ...i, status: 'Resolved', resolvedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') }
      : i));
  };

  const pruneTimesheetEntries = (deletedIds) => {
    if (!setTimesheets) return;
    const incLabels = new Set([...deletedIds].map(id => `INC ${id}`));
    setTimesheets(prev => {
      const updated = {};
      Object.entries(prev || {}).forEach(([uid, entries]) => {
        updated[uid] = (entries || []).filter(e => !incLabels.has(e.week));
      });
      return updated;
    });
  };

  const deleteOne = (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this incident?')) return;
    setIncidents(incidents.filter(i => i.id !== id));
    pruneTimesheetEntries([id]);
  };

  const deleteBulk = () => {
    if (!window.confirm(`Delete ${selected.size} incidents?`)) return;
    setIncidents(incidents.filter(i => !selected.has(i.id)));
    pruneTimesheetEntries([...selected]);
    clearAll();
  };

  const filtered     = filter === 'all' ? incidents : incidents.filter(i => i.status === filter || i.severity === filter);
  const assignedUser = (id) => users.find(u => u.id === id);

  return (
    <div>
      <PageHeader title="Incidents" sub="Log and track operational incidents"
        actions={<>
          <select className="select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 150 }}>
            <option value="all">All</option>
            <option value="Investigating">Investigating</option>
            <option value="Resolved">Resolved</option>
            <option value="Disaster">🔴 Disaster</option>
            <option value="High">🟠 High</option>
          </select>
          {selected.size > 0 && (
            <button className="btn btn-danger btn-sm" onClick={deleteBulk}>🗑 Delete {selected.size}</button>
          )}
          <button className="btn btn-primary" onClick={openAdd}>+ Log Incident</button>
        </>}
      />

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={selected.size === incidents.length && incidents.length > 0} onChange={toggleAll} />
              </th>
              <th>ID</th><th>Alert Name</th><th>VM/Service</th><th>Severity</th><th>Status</th>
              <th>Assigned To</th><th>Duration</th><th>KB Ref</th><th>Date</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...filtered].sort((a, b) => new Date(b.date) - new Date(a.date)).map(i => {
              const sev = INC_SEVERITIES.find(s => s.value === i.severity) || INC_SEVERITIES[0];
              const eng = assignedUser(i.assigned_to);
              return (
                <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setViewInc(i)}>
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} />
                  </td>
                  <td><span style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{i.id}</span></td>
                  <td>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>{i.alert_name}</div>
                    {i.desc && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}
                      dangerouslySetInnerHTML={{ __html: (i.desc || '').replace(/<[^>]+>/g, '').slice(0, 60) + (i.desc?.length > 60 ? '…' : '') }} />}
                  </td>
                  <td style={{ fontSize: 12 }}>{i.vm_service || '—'}</td>
                  <td>
                    <span style={{ background: sev.color + '25', color: sev.color, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                      {sev.label}
                    </span>
                  </td>
                  <td><Tag label={i.status} type={i.status === 'Resolved' ? 'green' : 'red'} /></td>
                  <td>
                    {eng
                      ? <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={eng} size={20} /><span style={{ fontSize: 12 }}>{eng.name.split(' ')[0]}</span></div>
                      : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: 11, fontFamily: 'DM Mono', color: i.duration_hours ? '#fcd34d' : 'var(--text-muted)' }}>
                    {i.duration_hours ? `${i.duration_hours}h` : '—'}
                  </td>
                  <td style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--accent)' }}>{i.kb_ref || '—'}</td>
                  <td style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text-muted)' }}>{i.date}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={e => openEdit(i, e)}>✏</button>
                      {i.status !== 'Resolved' && (
                        <button className="btn btn-success btn-sm" onClick={e => resolve(i.id, e)}>✓</button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={e => deleteOne(i.id, e)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Log / Edit modal */}
      {showModal && (
        <Modal title={editInc ? `✏ Edit Incident — ${form.alert_name || ''}` : '🚨 Log New Incident'} onClose={() => setShowModal(false)} fullscreen>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <FormGroup label="Alert Name">
                <input className="input" placeholder="e.g. High CPU on prod-api-01"
                  value={form.alert_name} onChange={e => setForm({ ...form, alert_name: e.target.value })} />
              </FormGroup>
              <FormGroup label="VM / Service Issue">
                <input className="input" placeholder="e.g. prod-api-01 / payment-service"
                  value={form.vm_service} onChange={e => setForm({ ...form, vm_service: e.target.value })} />
              </FormGroup>
              <FormGroup label="Severity">
                <select className="select" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
                  {INC_SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </FormGroup>
              <FormGroup label="Assigned To">
                <select className="select" value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
                </select>
              </FormGroup>
              <FormGroup label="KB Reference (optional)">
                <input className="input" placeholder="e.g. KB-1234"
                  value={form.kb_ref} onChange={e => setForm({ ...form, kb_ref: e.target.value })} />
              </FormGroup>
              <FormGroup label="Ticket Ref (optional)">
                <input className="input" placeholder="e.g. JIRA-5678 / ServiceNow#"
                  value={form.ticket_ref} onChange={e => setForm({ ...form, ticket_ref: e.target.value })} />
              </FormGroup>
              <FormGroup label="Email Ref (optional)" hint="paste email subject or link">
                <input className="input" placeholder="e.g. Alert email subject"
                  value={form.email_ref} onChange={e => setForm({ ...form, email_ref: e.target.value })} />
              </FormGroup>
              <FormGroup label="Duration (Hours)" hint="Auto-added to timesheets & payroll">
                <select className="select" value={form.duration_hours} onChange={e => setForm({ ...form, duration_hours: e.target.value })}>
                  <option value="">Select duration…</option>
                  {[0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => (
                    <option key={h} value={h}>{h} hour{h !== 1 ? 's' : ''}</option>
                  ))}
                </select>
              </FormGroup>
            </div>
            <IncidentTabs form={form} setForm={setForm} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>{editInc ? 'Update Incident' : 'Log Incident'}</button>
            </div>
          </div>
        </Modal>
      )}

      {viewInc && (
        <Modal title={`${viewInc.id} — ${viewInc.alert_name}`} onClose={() => setViewInc(null)} fullscreen>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            {/* Meta row */}
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:18 }}>
              {(() => { const s = INC_SEVERITIES.find(x => x.value === viewInc.severity); return s ? <span style={{ background:s.color+'25', color:s.color, padding:'4px 12px', borderRadius:8, fontSize:12, fontWeight:700 }}>{s.label}</span> : null; })()}
              <Tag label={viewInc.status} type={viewInc.status === 'Resolved' ? 'green' : 'red'} />
              <span className="muted-xs">{viewInc.date}</span>
              {viewInc.resolvedAt && <span style={{ fontSize:11, color:'#6ee7b7' }}>✅ Resolved: {viewInc.resolvedAt}</span>}
            </div>

            {/* Info grid */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:10, marginBottom:20, padding:16, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10 }}>
              {viewInc.vm_service    && <div><div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>VM / Service</div><div style={{ fontSize:13, marginTop:3 }}>{viewInc.vm_service}</div></div>}
              {viewInc.assigned_to   && <div><div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Assigned To</div><div style={{ fontSize:13, marginTop:3 }}>{users.find(u => u.id === viewInc.assigned_to)?.name || viewInc.assigned_to}</div></div>}
              {viewInc.duration_hours && <div><div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Duration</div><div style={{ fontSize:13, fontFamily:'DM Mono', color:'#fcd34d', marginTop:3 }}>⏱ {viewInc.duration_hours}h</div></div>}
              {viewInc.kb_ref        && <div><div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>KB Ref</div><div style={{ fontSize:13, color:'var(--accent)', fontFamily:'DM Mono', marginTop:3 }}>{viewInc.kb_ref}</div></div>}
              {viewInc.ticket_ref    && <div><div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Ticket</div><div style={{ fontSize:13, color:'var(--accent)', fontFamily:'DM Mono', marginTop:3 }}>{viewInc.ticket_ref}</div></div>}
              {viewInc.email_ref     && <div><div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Email Ref</div><div style={{ fontSize:13, color:'var(--accent)', marginTop:3 }}>{viewInc.email_ref}</div></div>}
            </div>

            {/* Sections */}
            {viewInc.issue_desc && (
              <div style={{ marginBottom:16, border:'1px solid rgba(239,68,68,0.3)', borderRadius:10, overflow:'hidden' }}>
                <div style={{ background:'rgba(239,68,68,0.12)', padding:'9px 14px', fontWeight:700, fontSize:13, color:'#fca5a5', borderBottom:'1px solid rgba(239,68,68,0.2)' }}>🔴 Issue</div>
                <div style={{ padding:'16px 18px', fontSize:14, color:'var(--text-secondary)', lineHeight:1.8 }} dangerouslySetInnerHTML={{ __html: viewInc.issue_desc }} />
                {(viewInc.issue_images||[]).length > 0 && <div style={{ padding:'0 18px 14px', display:'flex', gap:10, flexWrap:'wrap' }}>{viewInc.issue_images.map((img,i) => <img key={i} src={img} alt="" style={{ maxWidth:280, maxHeight:200, borderRadius:8, border:'1px solid var(--border)' }} />)}</div>}
              </div>
            )}
            {viewInc.actions_desc && (
              <div style={{ marginBottom:16, border:'1px solid rgba(245,158,11,0.3)', borderRadius:10, overflow:'hidden' }}>
                <div style={{ background:'rgba(245,158,11,0.12)', padding:'9px 14px', fontWeight:700, fontSize:13, color:'#fcd34d', borderBottom:'1px solid rgba(245,158,11,0.2)' }}>⚙️ Actions Taken</div>
                <div style={{ padding:'16px 18px', fontSize:14, color:'var(--text-secondary)', lineHeight:1.8 }} dangerouslySetInnerHTML={{ __html: viewInc.actions_desc }} />
                {viewInc.actions_code && <pre style={{ margin:'0 18px 14px', background:'rgba(0,0,0,0.5)', padding:14, borderRadius:8, fontSize:12, overflow:'auto', color:'#6ee7b7', fontFamily:'DM Mono,monospace' }}>{viewInc.actions_code}</pre>}
                {(viewInc.actions_images||[]).length > 0 && <div style={{ padding:'0 18px 14px', display:'flex', gap:10, flexWrap:'wrap' }}>{viewInc.actions_images.map((img,i) => <img key={i} src={img} alt="" style={{ maxWidth:280, maxHeight:200, borderRadius:8, border:'1px solid var(--border)' }} />)}</div>}
              </div>
            )}
            {viewInc.solution_desc && (
              <div style={{ marginBottom:16, border:'1px solid rgba(16,185,129,0.3)', borderRadius:10, overflow:'hidden' }}>
                <div style={{ background:'rgba(16,185,129,0.12)', padding:'9px 14px', fontWeight:700, fontSize:13, color:'#6ee7b7', borderBottom:'1px solid rgba(16,185,129,0.2)' }}>✅ Solution</div>
                <div style={{ padding:'16px 18px', fontSize:14, color:'var(--text-secondary)', lineHeight:1.8 }} dangerouslySetInnerHTML={{ __html: viewInc.solution_desc }} />
                {(viewInc.solution_images||[]).length > 0 && <div style={{ padding:'0 18px 14px', display:'flex', gap:10, flexWrap:'wrap' }}>{viewInc.solution_images.map((img,i) => <img key={i} src={img} alt="" style={{ maxWidth:280, maxHeight:200, borderRadius:8, border:'1px solid var(--border)' }} />)}</div>}
              </div>
            )}
            {/* Fallback for old-format */}
            {!viewInc.issue_desc && !viewInc.actions_desc && !viewInc.solution_desc && viewInc.desc && (
              <div style={{ fontSize:14, color:'var(--text-secondary)', lineHeight:1.8, padding:'4px 0' }} dangerouslySetInnerHTML={{ __html: viewInc.desc || '' }} />
            )}
            {/* Footer actions */}
            <div style={{ display:'flex', gap:8, marginTop:24, paddingTop:16, borderTop:'1px solid var(--border)' }}>
              <button className="btn btn-secondary" onClick={e => { setViewInc(null); openEdit(viewInc, e); }}>✏ Edit</button>
              {viewInc.status !== 'Resolved' && (
                <button className="btn btn-success" onClick={e => { resolve(viewInc.id, e); setViewInc(null); }}>✓ Resolve</button>
              )}
              <button className="btn btn-secondary" style={{ marginLeft:'auto' }} onClick={() => setViewInc(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
