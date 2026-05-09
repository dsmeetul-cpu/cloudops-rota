// src/Incidents.js
// CloudOps Rota — Incidents Component
// Meetul Bhundia (MBA47) · Cloud Run Operations · 9th May 2026

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
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={
        fullscreen
          ? { width: '98vw', maxWidth: 1300, height: '95vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }
          : wide ? { width: 720 } : {}
      }>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 20px 20px', flex: 1, overflowY: 'auto' }}>{children}</div>
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

// ── Rich text editor ───────────────────────────────────────────────────────
function RichEditor({ value, onChange, placeholder = 'Start typing…', rows = 8, fullPage = false }) {
  const ref     = useRef(null);
  const fileRef = useRef(null);

  const exec = (cmd, val = null) => { document.execCommand(cmd, false, val); ref.current?.focus(); };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'md' || ext === 'txt') {
      const text = await file.text();
      let html = text
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
        .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,    '<em>$1</em>')
        .replace(/`(.+?)`/g,      '<code>$1</code>')
        .replace(/^- (.+)$/gm,    '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g,   '<br>');
      html = '<p>' + html + '</p>';
      if (ref.current) { ref.current.innerHTML = html; onChange && onChange(html); }
    } else if (ext === 'csv') {
      const text = await file.text();
      const rows = text.trim().split('\n').map(r => r.split(','));
      let html = '<table border="1" style="border-collapse:collapse;width:100%">';
      rows.forEach((r, i) => {
        html += '<tr>';
        r.forEach(c => { html += i === 0 ? `<th style="padding:4px 8px;background:#1e3a5f">${c.trim()}</th>` : `<td style="padding:4px 8px">${c.trim()}</td>`; });
        html += '</tr>';
      });
      html += '</table>';
      if (ref.current) { ref.current.innerHTML = html; onChange && onChange(html); }
    } else if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
      const loadJSZip = () => new Promise((resolve, reject) => {
        if (window.JSZip) { resolve(window.JSZip); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = () => resolve(window.JSZip);
        s.onerror = reject;
        document.head.appendChild(s);
      });
      try {
        const JSZip = await loadJSZip();
        const ab    = await file.arrayBuffer();
        const zip   = await JSZip.loadAsync(ab);
        let text    = '';
        const targets = ext === 'docx' ? ['word/document.xml']
          : ext === 'pptx' ? Object.keys(zip.files).filter(n => n.startsWith('ppt/slides/slide') && n.endsWith('.xml'))
          : ['xl/sharedStrings.xml'];
        for (const t of targets) {
          const f = zip.file(t);
          if (f) { const xml = await f.async('text'); text += xml.replace(/<[^>]+>/g, ' ') + '\n'; }
        }
        text = text.replace(/\s+/g, ' ').trim().slice(0, 20000);
        const lines = text.split(/(?<=[.!?])\s+/).filter(Boolean);
        const html  = '<p>' + lines.join('</p><p>') + '</p>';
        if (ref.current) {
          ref.current.innerHTML = html || `<p><em>📎 ${file.name} imported (no readable text found)</em></p>`;
          onChange && onChange(ref.current.innerHTML);
        }
      } catch {
        const msg = `<p><em>📎 Imported: <strong>${file.name}</strong></em></p><p style="color:#fcd34d">⚠ Could not extract text from this file. Try saving as .txt or .md first.</p>`;
        if (ref.current) { ref.current.innerHTML = msg; onChange && onChange(msg); }
      }
    } else {
      const text = await file.text().catch(() => '[Binary file — cannot preview]');
      const html = `<p><em>📎 ${file.name}</em></p><pre style="font-size:11px;overflow:auto">${text.slice(0, 3000)}</pre>`;
      if (ref.current) { ref.current.innerHTML = html; onChange && onChange(html); }
    }
    e.target.value = '';
  };

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
    }
  }, []); // eslint-disable-line

  const insertTable = () => {
    const html = `<table border="1" style="border-collapse:collapse;width:100%;margin:8px 0"><tr><th style="padding:6px 10px;background:#1e3a5f">Header 1</th><th style="padding:6px 10px;background:#1e3a5f">Header 2</th></tr><tr><td style="padding:6px 10px">Cell 1</td><td style="padding:6px 10px">Cell 2</td></tr></table><p></p>`;
    document.execCommand('insertHTML', false, html);
    ref.current?.focus();
  };

  const insertLink = () => { const url = prompt('Enter URL:'); if (url) exec('createLink', url); };
  const insertHR   = () => { exec('insertHTML', '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:16px 0"/><p></p>'); };

  const minH = fullPage ? '60vh' : rows * 22;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card2)', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 5 }}>
        <select onChange={e => { exec('formatBlock', e.target.value); e.target.value = ''; }} defaultValue=""
          style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', maxWidth: 90 }}>
          <option value="" disabled>Style</option>
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="pre">Code Block</option>
          <option value="blockquote">Quote</option>
        </select>
        <select onChange={e => { exec('fontName', e.target.value); e.target.value = ''; }} defaultValue=""
          style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', maxWidth: 90 }}>
          <option value="" disabled>Font</option>
          {['Arial', 'Georgia', 'Courier New', 'Verdana', 'Times New Roman', 'Trebuchet MS'].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select onChange={e => exec('fontSize', e.target.value)} defaultValue=""
          style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', width: 54 }}>
          <option value="" disabled>Size</option>
          {[1, 2, 3, 4, 5, 6, 7].map(s => <option key={s} value={s}>{[8, 10, 12, 14, 18, 24, 36][s - 1]}pt</option>)}
        </select>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        {[
          { cmd: 'bold',          label: 'B',  style: { fontWeight: 700 } },
          { cmd: 'italic',        label: 'I',  style: { fontStyle: 'italic' } },
          { cmd: 'underline',     label: 'U',  style: { textDecoration: 'underline' } },
          { cmd: 'strikeThrough', label: 'S̶', style: {} },
          { cmd: 'superscript',   label: 'x²', style: { fontSize: 10 } },
          { cmd: 'subscript',     label: 'x₂', style: { fontSize: 10 } },
        ].map(b => (
          <button key={b.cmd} onMouseDown={e => { e.preventDefault(); exec(b.cmd); }}
            style={{ ...b.style, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12, minWidth: 28 }}>
            {b.label}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        {[
          { cmd: 'justifyLeft',   label: '⬛▫▫' },
          { cmd: 'justifyCenter', label: '▫⬛▫' },
          { cmd: 'justifyRight',  label: '▫▫⬛' },
          { cmd: 'justifyFull',   label: '⬛⬛⬛' },
        ].map(b => (
          <button key={b.cmd} onMouseDown={e => { e.preventDefault(); exec(b.cmd); }}
            style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 9, minWidth: 28 }}>
            {b.label}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        {[
          { cmd: 'insertUnorderedList', label: '• List' },
          { cmd: 'insertOrderedList',   label: '1. List' },
          { cmd: 'indent',              label: '→ Indent' },
          { cmd: 'outdent',             label: '← Outdent' },
        ].map(b => (
          <button key={b.label} onMouseDown={e => { e.preventDefault(); exec(b.cmd); }}
            style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11 }}>
            {b.label}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>A</span>
          <input type="color" defaultValue="#ffffff" onChange={e => exec('foreColor', e.target.value)}
            title="Text colour" style={{ width: 22, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none', padding: 0 }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>bg</span>
          <input type="color" defaultValue="#1e3a5f" onChange={e => exec('hiliteColor', e.target.value)}
            title="Highlight colour" style={{ width: 22, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none', padding: 0 }} />
        </div>
        <div style={{ width: 1, background: 'var(--border)', margin: '0 3px' }} />
        <button onMouseDown={e => { e.preventDefault(); insertTable(); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11 }}>
          ⊞ Table
        </button>
        <button onMouseDown={e => { e.preventDefault(); insertLink(); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}>
          🔗 Link
        </button>
        <button onMouseDown={e => { e.preventDefault(); insertHR(); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>
          ─ HR
        </button>
        <label style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
          📎 Import
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.docx,.pptx,.xlsx,.html" onChange={handleImport} style={{ display: 'none' }} />
        </label>
        <button onMouseDown={e => { e.preventDefault(); exec('removeFormat'); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>
          ✕ Fmt
        </button>
        <button onMouseDown={e => { e.preventDefault(); exec('undo'); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>↩</button>
        <button onMouseDown={e => { e.preventDefault(); exec('redo'); }}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>↪</button>
      </div>
      {/* Editable area */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange && onChange(ref.current.innerHTML)}
        data-placeholder={placeholder}
        style={{
          minHeight: minH, padding: fullPage ? '24px 32px' : '12px 14px', outline: 'none',
          fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.8,
          caretColor: 'var(--accent)', flex: 1,
          fontFamily: 'Georgia, serif',
        }}
      />
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

  const save = () => {
    if (!form.alert_name) return;
    const combinedDesc = [
      form.issue_desc    ? `<h3>🔴 Issue</h3>${form.issue_desc}` : '',
      form.actions_desc  ? `<h3>⚙️ Actions Taken</h3>${form.actions_desc}${form.actions_code ? `<pre style="background:rgba(0,0,0,0.4);padding:10px;border-radius:6px;overflow:auto;font-size:12px">${form.actions_code}</pre>` : ''}` : '',
      form.solution_desc ? `<h3>✅ Solution</h3>${form.solution_desc}` : '',
    ].filter(Boolean).join('');

    if (editInc) {
      setIncidents(incidents.map(i => i.id === editInc ? { ...i, ...form, desc: combinedDesc } : i));
    } else {
      const trigram = (currentUser || 'UNK').toUpperCase();
      const id      = `${trigram}-${Date.now()}`;
      const newInc  = {
        id, ...form, desc: combinedDesc,
        status: 'Investigating', reporter: currentUser,
        date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        updates: [],
      };
      setIncidents(prev => {
        const safe = Array.isArray(prev) ? prev : [];
        return [newInc, ...safe];
      });
      if (form.duration_hours && form.assigned_to && setTimesheets) {
        const incDate  = new Date().toISOString().slice(0, 10);
        const dow      = new Date().getDay();
        const isWE     = dow === 0 || dow === 6;
        const hrs      = +form.duration_hours;
        const weekLabel = `INC ${id}`;
        setTimesheets(prev => ({
          ...prev,
          [form.assigned_to]: [
            {
              week: weekLabel,
              weekday_oncall: isWE ? 0 : hrs,
              weekend_oncall: isWE ? hrs : 0,
              worked_wd:      isWE ? 0 : hrs,
              worked_we:      isWE ? hrs : 0,
              standby_wd: 0, standby_we: 0,
              notes: `Auto-logged: ${form.alert_name} on ${incDate} (${hrs}h)`,
            },
            ...(prev[form.assigned_to] || []),
          ],
        }));
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
        <Modal title={editInc ? 'Edit Incident' : 'Log New Incident'} onClose={() => setShowModal(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => (
                  <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>
                ))}
              </select>
            </FormGroup>
          </div>
          <IncidentTabs form={form} setForm={setForm} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{editInc ? 'Update Incident' : 'Log Incident'}</button>
          </div>
        </Modal>
      )}

      {/* View modal */}
      {viewInc && (
        <Modal title={`${viewInc.id} — ${viewInc.alert_name}`} onClose={() => setViewInc(null)} wide>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {(() => {
              const s = INC_SEVERITIES.find(x => x.value === viewInc.severity);
              return s ? <span style={{ background: s.color + '25', color: s.color, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{s.label}</span> : null;
            })()}
            <Tag label={viewInc.status} type={viewInc.status === 'Resolved' ? 'green' : 'red'} />
            <span className="muted-xs">{viewInc.date}</span>
          </div>
          {viewInc.vm_service   && <div className="muted-xs" style={{ marginBottom: 8 }}>VM/Service: <strong>{viewInc.vm_service}</strong></div>}
          {viewInc.assigned_to  && <div className="muted-xs" style={{ marginBottom: 8 }}>Assigned to: <strong>{users.find(u => u.id === viewInc.assigned_to)?.name || viewInc.assigned_to}</strong></div>}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            {viewInc.kb_ref         && <div className="muted-xs">📚 KB: <span style={{ color: 'var(--accent)' }}>{viewInc.kb_ref}</span></div>}
            {viewInc.ticket_ref     && <div className="muted-xs">🎫 Ticket: <span style={{ color: 'var(--accent)' }}>{viewInc.ticket_ref}</span></div>}
            {viewInc.email_ref      && <div className="muted-xs">📧 Email: <span style={{ color: 'var(--accent)' }}>{viewInc.email_ref}</span></div>}
            {viewInc.duration_hours && <div className="muted-xs">⏱ Duration: <span style={{ color: '#fcd34d' }}>{viewInc.duration_hours}h</span></div>}
          </div>

          {/* Structured sections */}
          {viewInc.issue_desc && (
            <div style={{ marginBottom: 12, border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: 'rgba(239,68,68,0.12)', padding: '6px 12px', fontWeight: 600, fontSize: 12, color: '#fca5a5' }}>🔴 Issue</div>
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: viewInc.issue_desc }} />
              {(viewInc.issue_images || []).length > 0 && (
                <div style={{ padding: '0 12px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {viewInc.issue_images.map((img, i) => <img key={i} src={img} alt="" style={{ maxWidth: 200, maxHeight: 150, borderRadius: 6, border: '1px solid var(--border)' }} />)}
                </div>
              )}
            </div>
          )}
          {viewInc.actions_desc && (
            <div style={{ marginBottom: 12, border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: 'rgba(245,158,11,0.12)', padding: '6px 12px', fontWeight: 600, fontSize: 12, color: '#fcd34d' }}>⚙️ Actions Taken</div>
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: viewInc.actions_desc }} />
              {viewInc.actions_code && (
                <pre style={{ margin: '0 12px 10px', background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: 6, fontSize: 12, overflow: 'auto', color: '#6ee7b7' }}>{viewInc.actions_code}</pre>
              )}
              {(viewInc.actions_images || []).length > 0 && (
                <div style={{ padding: '0 12px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {viewInc.actions_images.map((img, i) => <img key={i} src={img} alt="" style={{ maxWidth: 200, maxHeight: 150, borderRadius: 6, border: '1px solid var(--border)' }} />)}
                </div>
              )}
            </div>
          )}
          {viewInc.solution_desc && (
            <div style={{ marginBottom: 12, border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: 'rgba(16,185,129,0.12)', padding: '6px 12px', fontWeight: 600, fontSize: 12, color: '#6ee7b7' }}>✅ Solution</div>
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: viewInc.solution_desc }} />
            </div>
          )}

          {/* Fallback for old-format incidents */}
          {!viewInc.issue_desc && !viewInc.actions_desc && !viewInc.solution_desc && viewInc.desc && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: viewInc.desc || '' }} />
          )}
          {viewInc.resolvedAt && <div className="muted-xs" style={{ marginTop: 12 }}>Resolved: {viewInc.resolvedAt}</div>}
        </Modal>
      )}
    </div>
  );
}
