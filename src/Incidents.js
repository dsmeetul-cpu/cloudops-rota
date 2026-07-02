// src/Incidents.js
// CloudOps Rota — Incidents Component
// Meetul Bhundia (MBA47) · Cloud Run Operations · June 2026

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { driveRead } from './hooks/useGoogleDrive';

// ── Constants ─────────────────────────────────────────────────────────────
const SEVERITIES    = ['Disaster', 'Critical', 'High', 'Medium', 'Low'];
const STATUSES      = ['Investigating', 'Identified', 'Monitoring', 'Resolved'];
const HOURS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const DAILY_TYPES = [
  { id: 'deployment',   label: 'Deployment',   icon: '🚀' },
  { id: 'service_down', label: 'Service Down',  icon: '🔴' },
  { id: 'performance',  label: 'Performance',   icon: '📉' },
  { id: 'security',     label: 'Security',      icon: '🔐' },
  { id: 'data',         label: 'Data Issue',    icon: '🗄️' },
  { id: 'network',      label: 'Network',       icon: '🌐' },
  { id: 'config',       label: 'Config Change', icon: '⚙️' },
  { id: 'other',        label: 'Other',         icon: '📌' },
];

const SEV_COLOR = {
  Disaster: { bg: 'rgba(216,90,48,0.18)',   text: '#fca5a5', border: '#ef4444' },
  Critical: { bg: 'rgba(186,117,23,0.18)',  text: '#fcd34d', border: '#f59e0b' },
  High:     { bg: 'rgba(55,138,221,0.18)',  text: '#93c5fd', border: '#3b82f6' },
  Medium:   { bg: 'rgba(29,158,117,0.18)',  text: '#6ee7b7', border: '#10b981' },
  Low:      { bg: 'rgba(136,135,128,0.18)', text: '#94a3b8', border: '#64748b' },
};

const STATUS_COLOR = {
  Investigating: { bg: '#7f1d1d33', text: '#fca5a5', border: '#ef4444' },
  Identified:    { bg: '#92400e33', text: '#fcd34d', border: '#f59e0b' },
  Monitoring:    { bg: '#1e3a8a33', text: '#93c5fd', border: '#3b82f6' },
  Resolved:      { bg: '#14532d33', text: '#86efac', border: '#22c55e' },
};

const BLANK_INCIDENT = {
  title: '', severity: 'High', status: 'Investigating', assigned_to: '',
  date: new Date().toISOString().slice(0, 10),
  hours: 1, isDaily: false, dailyType: 'other',
  issueContent: '', diagnosticsContent: '', resolutionContent: '',
};

// ── Toolbar config ────────────────────────────────────────────────────────
const TOOLBAR = [
  { icon: 'B',   title: 'Bold',          before: '**',     after: '**',    ph: 'bold text',  s: { fontWeight: 800 } },
  { icon: 'I',   title: 'Italic',        before: '*',      after: '*',     ph: 'italic',     s: { fontStyle: 'italic' } },
  { sep: true },
  { icon: 'H1',  title: 'Heading 1',     before: '\n# ',   after: '',      ph: 'Heading',    s: { fontSize: 10, fontWeight: 700, letterSpacing: 0.5 } },
  { icon: 'H2',  title: 'Heading 2',     before: '\n## ',  after: '',      ph: 'Heading',    s: { fontSize: 10, fontWeight: 700, letterSpacing: 0.5 } },
  { icon: 'H3',  title: 'Heading 3',     before: '\n### ', after: '',      ph: 'Heading',    s: { fontSize: 10, fontWeight: 700, letterSpacing: 0.5 } },
  { sep: true },
  { icon: '`·`', title: 'Inline code',   before: '`',      after: '`',     ph: 'code',       s: { fontFamily: 'monospace', fontSize: 11 } },
  { icon: '```', title: 'Code block',    before: '```\n',  after: '\n```', ph: 'code here',  s: { fontFamily: 'monospace', fontSize: 11 } },
  { sep: true },
  { icon: '❝',   title: 'Blockquote',    before: '\n> ',   after: '',      ph: 'quote',      s: {} },
  { icon: '—',   title: 'Divider',       before: '\n---\n',after: '',      ph: '',           s: { fontSize: 13 } },
  { sep: true },
  { icon: '•',   title: 'Bullet list',   before: '\n- ',   after: '',      ph: 'item',       s: { fontSize: 16, lineHeight: 1 } },
  { icon: '1.',  title: 'Numbered list', before: '\n1. ',  after: '',      ph: 'item',       s: { fontSize: 12 } },
];

// ── Markdown renderer ─────────────────────────────────────────────────────
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="inc-pre"${lang ? ` data-lang="${lang}"` : ''}><code>${escHtml(code.trimEnd())}</code></pre>`)
    .replace(/`([^`]+)`/g, (_, c) => `<code class="inc-ic">${escHtml(c)}</code>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 class="inc-h3">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="inc-h2">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1 class="inc-h1">$1</h1>')
    .replace(/^---$/gm,       '<hr class="inc-hr" />')
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm,'<li class="inc-ol">$1</li>')
    .replace(/^> (.+)$/gm,   '<blockquote class="inc-bq">$1</blockquote>')
    .replace(/\n\n/g, '</p><p class="inc-p">')
    .replace(/\n/g, '<br />');
  return `<p class="inc-p">${html}</p>`;
}

// ── Insert markdown at cursor ─────────────────────────────────────────────
function insertAtCursor(taRef, before, after, ph) {
  const el = taRef.current;
  if (!el) return;
  const s   = el.selectionStart;
  const e   = el.selectionEnd;
  const sel = el.value.substring(s, e) || ph || '';
  const nv  = el.value.substring(0, s) + before + sel + after + el.value.substring(e);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, nv);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  const cp = s + before.length + sel.length;
  el.setSelectionRange(cp, cp);
}

// ── .docx extraction ──────────────────────────────────────────────────────
async function extractDocxText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const entries = [];
  let i = 0;
  while (i < bytes.length - 30) {
    if (bytes[i]===0x50 && bytes[i+1]===0x4B && bytes[i+2]===0x03 && bytes[i+3]===0x04) {
      const compression = bytes[i+8]  | (bytes[i+9]  << 8);
      const compSize    = bytes[i+18] | (bytes[i+19] << 8) | (bytes[i+20] << 16) | (bytes[i+21] << 24);
      const nameLen     = bytes[i+26] | (bytes[i+27] << 8);
      const extraLen    = bytes[i+28] | (bytes[i+29] << 8);
      const name        = new TextDecoder().decode(bytes.slice(i+30, i+30+nameLen));
      const dataOffset  = i + 30 + nameLen + extraLen;
      entries.push({ name, compression, compSize, dataOffset });
      i = dataOffset + compSize;
    } else { i++; }
  }
  const docEntry = entries.find(e => e.name === 'word/document.xml');
  if (!docEntry) throw new Error('word/document.xml not found in .docx');
  let xmlBytes = bytes.slice(docEntry.dataOffset, docEntry.dataOffset + docEntry.compSize);
  if (docEntry.compression === 8) {
    const ds = new DecompressionStream('deflate-raw');
    const w  = ds.writable.getWriter();
    const r  = ds.readable.getReader();
    w.write(xmlBytes); w.close();
    const chunks = [];
    let done = false;
    while (!done) { const { value, done: d } = await r.read(); if (value) chunks.push(value); done = d; }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    xmlBytes = out;
  }
  const xml   = new TextDecoder('utf-8').decode(xmlBytes);
  const lines = [];
  const pRe   = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let pm;
  while ((pm = pRe.exec(xml)) !== null) {
    const para = pm[0];
    const styleM = para.match(/w:styleId="([^"]+)"/);
    const style  = styleM ? styleM[1] : '';
    const texts  = [];
    const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let tm;
    while ((tm = tRe.exec(para)) !== null) texts.push(tm[1]);
    const line = texts.join('').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    if (!line.trim()) { lines.push(''); continue; }
    if (/Heading1/i.test(style)) lines.push(`# ${line}`);
    else if (/Heading2/i.test(style)) lines.push(`## ${line}`);
    else if (/Heading3/i.test(style)) lines.push(`### ${line}`);
    else lines.push(line);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Shared UI ─────────────────────────────────────────────────────────────
function Avatar({ user, size = 28 }) {
  if (!user) return null;
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.3),
      background: user.color || '#1d4ed8', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: Math.round(size * 0.38),
      fontWeight: 700, color: '#fff', flexShrink: 0,
    }}>{user.avatar || user.id?.slice(0, 2)}</div>
  );
}
function SevBadge({ severity }) {
  const c = SEV_COLOR[severity] || SEV_COLOR.Low;
  return <span style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{severity}</span>;
}
function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.Investigating;
  return <span style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{status}</span>;
}
function StatCard({ label, value, sub, accent = 'var(--accent)', icon }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 100, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Rich Editor ───────────────────────────────────────────────────────────
function RichEditor({ value, onChange, placeholder }) {
  const [preview, setPreview] = useState(false);
  const taRef   = useRef(null);
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const name = file.name.toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.txt') || name.endsWith('.markdown')) {
      const text = await file.text();
      onChange(value ? value + '\n\n' + text : text);
      return;
    }
    if (name.endsWith('.docx')) {
      try {
        const text = await extractDocxText(await file.arrayBuffer());
        onChange(value ? value + '\n\n' + text : text);
      } catch (err) { alert('Could not parse .docx — try saving as .txt or .md first.\n\n' + err.message); }
      return;
    }
    alert('Supported: .md  .txt  .docx');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Single unified toolbar row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '6px 12px',
        background: 'var(--sidebar, #111827)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, flexWrap: 'wrap', minHeight: 40,
      }}>
        {TOOLBAR.map((t, idx) =>
          t.sep
            ? <div key={idx} style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            : (
              <button key={idx} title={t.title}
                onMouseDown={ev => { ev.preventDefault(); insertAtCursor(taRef, t.before, t.after, t.ph); }}
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 5, padding: '4px 9px', cursor: 'pointer',
                  color: 'var(--text-secondary)', lineHeight: 1.3,
                  minWidth: 28, textAlign: 'center', ...t.s,
                }}
              >{t.icon}</button>
            )
        )}
        {/* Spacer */}
        <div style={{ flex: 1 }} />
        {/* Import button */}
        <button title="Import .md / .txt / .docx file" onClick={() => fileRef.current?.click()}
          style={{
            background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)',
            borderRadius: 5, padding: '4px 12px', cursor: 'pointer',
            color: '#93c5fd', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          }}>⬆ Import</button>
        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 6px' }} />
        {/* Preview toggle */}
        <button onClick={() => setPreview(p => !p)}
          style={{
            background: preview ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${preview ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 5, padding: '4px 12px', cursor: 'pointer',
            color: preview ? '#93c5fd' : 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap',
          }}>{preview ? '✏ Edit' : '👁 Preview'}</button>
        <input ref={fileRef} type="file" accept=".md,.txt,.markdown,.docx" style={{ display: 'none' }} onChange={handleFile} />
      </div>

      {/* Editor / Preview area */}
      {preview ? (
        <div
          className="inc-preview"
          style={{
            flex: 1, overflowY: 'auto', padding: '16px 20px',
            background: 'rgba(0,0,0,0.1)', fontSize: 13, lineHeight: 1.75,
            color: 'var(--text-secondary)',
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || '<span style="color:var(--text-muted);font-style:italic">Nothing to preview yet.</span>' }}
        />
      ) : (
        <textarea
          ref={taRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            flex: 1, resize: 'none', border: 'none', outline: 'none',
            background: 'rgba(0,0,0,0.1)', color: 'var(--text-primary)',
            fontFamily: '"DM Mono", "Fira Code", monospace',
            fontSize: 13, lineHeight: 1.75, padding: '16px 20px',
          }}
        />
      )}

      {/* Inline CSS for markdown rendering */}
      <style>{`
        .inc-preview .inc-h1 { font-size:18px; font-weight:700; color:var(--text-primary); margin:14px 0 6px; border-bottom:1px solid var(--border); padding-bottom:4px; }
        .inc-preview .inc-h2 { font-size:15px; font-weight:700; color:var(--text-primary); margin:12px 0 5px; }
        .inc-preview .inc-h3 { font-size:13px; font-weight:600; color:var(--text-secondary); margin:10px 0 4px; }
        .inc-preview .inc-p  { margin:0 0 10px; }
        .inc-preview li      { margin-left:20px; list-style:disc; margin-bottom:3px; }
        .inc-preview .inc-ol { list-style:decimal; }
        .inc-preview .inc-bq { border-left:3px solid var(--accent); padding:4px 14px; color:var(--text-muted); margin:8px 0; font-style:italic; background:rgba(59,130,246,0.06); border-radius:0 4px 4px 0; }
        .inc-preview .inc-hr { border:none; border-top:1px solid var(--border); margin:14px 0; }
        .inc-preview pre.inc-pre { background:rgba(0,0,0,0.4); border:1px solid var(--border); border-radius:7px; padding:12px 16px; overflow-x:auto; margin:10px 0; }
        .inc-preview pre.inc-pre::before { content:attr(data-lang); display:block; font-size:9px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase; letter-spacing:1px; font-family:monospace; }
        .inc-preview pre.inc-pre code { font-family:"DM Mono",monospace; font-size:12px; color:#e2e8f0; white-space:pre; }
        .inc-preview code.inc-ic { background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.1); border-radius:4px; padding:1px 6px; font-family:"DM Mono",monospace; font-size:12px; color:#93c5fd; }
      `}</style>
    </div>
  );
}

// ── Incident list card ────────────────────────────────────────────────────
function IncidentCard({ inc, users, isManager, currentUser, onEdit, onDelete, onResolve }) {
  const assignee = users.find(u => u.id === inc.assigned_to);
  const canEdit  = isManager || inc.assigned_to === currentUser;
  const dailyT   = DAILY_TYPES.find(t => t.id === inc.dailyType);
  const snippet  = (inc.issueContent || inc.description || '').slice(0, 160).replace(/[#*`>\-]/g, '').trim();

  return (
    <div className="card" style={{ borderLeft: `3px solid ${SEV_COLOR[inc.severity]?.border || '#64748b'}`, padding: '14px 16px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            {inc.isDaily && (
              <span style={{ fontSize: 10, background: '#1e40af33', border: '1px solid #3b82f6', color: '#93c5fd', borderRadius: 5, padding: '1px 6px', fontWeight: 600 }}>
                {dailyT?.icon || '📋'} Daily
              </span>
            )}
            <SevBadge severity={inc.severity} />
            <StatusBadge status={inc.status} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono' }}>{(inc.date || '').slice(0, 10)}</span>
            {!inc.isDaily && inc.hours > 0 && (
              <span style={{ fontSize: 11, color: '#fcd34d', background: '#92400e22', border: '1px solid #f59e0b', borderRadius: 5, padding: '1px 6px' }}>⏱ {inc.hours}h</span>
            )}
            {inc.diagnosticsContent && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>🔍 Diag</span>}
            {inc.resolutionContent  && <span style={{ fontSize: 10, color: '#86efac' }}>✅ Fix</span>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{inc.title}</div>
          {snippet && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 6 }}>{snippet}{snippet.length >= 160 ? '…' : ''}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <Avatar user={assignee} size={20} />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{assignee?.name || inc.assigned_to}</span>
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexDirection: 'column' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => onEdit(inc)}>✏ Edit</button>
            {inc.status !== 'Resolved' && (
              <button className="btn btn-sm" onClick={() => onResolve(inc.id)}
                style={{ background: '#14532d', color: '#86efac', border: '1px solid #22c55e' }}>✅ Resolve</button>
            )}
            {isManager && <button className="btn btn-danger btn-sm" onClick={() => onDelete(inc.id)}>🗑</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Full-screen Incident Modal ────────────────────────────────────────────
const EDITOR_TABS = [
  {
    id: 'issue', label: '🚨 Issue', field: 'issueContent',
    placeholder: '# Summary\nWhat happened and what was the impact?\n\n## Impact\n- Which services were affected\n- How many users impacted\n\n## Timeline\n- HH:MM — First alert fired\n- HH:MM — Engineer paged\n- HH:MM — Incident declared',
  },
  {
    id: 'diagnostics', label: '🔍 Diagnostics', field: 'diagnosticsContent',
    placeholder: '## Investigation Steps\n1. Checked monitoring dashboards\n2. Reviewed application logs\n\n## Relevant Logs\n```\npaste log output here\n```\n\n## Root Cause\nDescribe what caused the incident.',
  },
  {
    id: 'resolution', label: '✅ Resolution', field: 'resolutionContent',
    placeholder: '## Fix Applied\nDescribe what was done to resolve the incident.\n\n## Follow-up Actions\n- [ ] Action item 1\n- [ ] Action item 2\n\n## Post-Incident Review\nDate and notes for the PIR.',
  },
];

function IncidentModal({ editId, form, setForm, onSave, onClose, users, currentUser, isManager }) {
  const [editorTab, setEditorTab] = useState('issue');
  const activeTab = EDITOR_TABS.find(t => t.id === editorTab);

  return (
    <>
      {/* Full-viewport overlay — zIndex 9000 to clear app chrome */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.88)',
        zIndex: 9000,
        display: 'flex', alignItems: 'stretch', justifyContent: 'center',
        padding: '20px',
      }}>
        {/* Modal panel */}
        <div style={{
          background: 'var(--card)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          width: '100%',
          maxWidth: 1100,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 32px 96px rgba(0,0,0,0.7)',
        }}>

          {/* ── Row 1: Type toggle + Title + Close ──────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.2)', flexShrink: 0,
          }}>
            <button
              className={`btn btn-sm ${!form.isDaily ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setForm(f => ({ ...f, isDaily: false }))}>
              🚨 On-Call
            </button>
            <button
              className={`btn btn-sm ${form.isDaily ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setForm(f => ({ ...f, isDaily: true }))}>
              📋 Daily
            </button>
            <input
              className="form-input"
              style={{ flex: 1, fontSize: 15, fontWeight: 600, minWidth: 0 }}
              placeholder="Incident title *"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              autoFocus
            />
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
              borderRadius: 7, color: 'var(--text-muted)', width: 32, height: 32,
              cursor: 'pointer', fontSize: 18, flexShrink: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>

          {/* ── Row 2: Meta fields ────────────────────────────────────────── */}
          <div style={{
            display: 'flex', gap: 10, padding: '10px 16px',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
            background: 'rgba(0,0,0,0.1)', alignItems: 'flex-end', flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Severity</div>
              <select className="form-input" style={{ width: 118 }} value={form.severity}
                onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                {SEVERITIES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Status</div>
              <select className="form-input" style={{ width: 130 }} value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Assigned To</div>
              <select className="form-input" style={{ width: 155 }} value={form.assigned_to}
                onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                disabled={!isManager}>
                <option value="">— Select —</option>
                {(isManager ? users : users.filter(u => u.id === currentUser)).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Date</div>
              <input type="date" className="form-input" style={{ width: 132 }} value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            {!form.isDaily && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Hours (payroll)</div>
                <select className="form-input" style={{ width: 106 }} value={form.hours}
                  onChange={e => setForm(f => ({ ...f, hours: Number(e.target.value) }))}>
                  {HOURS_OPTIONS.map(h => <option key={h} value={h}>{h}h</option>)}
                </select>
              </div>
            )}
            {form.isDaily && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Type</div>
                <select className="form-input" style={{ width: 150 }} value={form.dailyType}
                  onChange={e => setForm(f => ({ ...f, dailyType: e.target.value }))}>
                  {DAILY_TYPES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* ── Row 3: Tab bar ──────────────────────────────────────────── */}
          <div style={{
            display: 'flex', borderBottom: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.15)', flexShrink: 0,
          }}>
            {EDITOR_TABS.map(t => {
              const filled = !!(form[t.field] || '').trim();
              const active = editorTab === t.id;
              return (
                <button key={t.id} onClick={() => setEditorTab(t.id)} style={{
                  padding: '10px 22px', border: 'none', cursor: 'pointer',
                  background: active ? 'var(--card)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  fontSize: 13, fontWeight: active ? 700 : 400,
                  display: 'flex', alignItems: 'center', gap: 7,
                  transition: 'color 0.15s, border-color 0.15s',
                }}>
                  {t.label}
                  {filled && (
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: t.id === 'resolution' ? '#22c55e' : 'var(--accent)',
                    }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Row 4: Editor (fills remaining height) ──────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {activeTab && (
              <RichEditor
                key={editorTab}
                value={form[activeTab.field] || ''}
                onChange={val => setForm(f => ({ ...f, [activeTab.field]: val }))}
                placeholder={activeTab.placeholder}
              />
            )}
          </div>

          {/* ── Row 5: Footer ───────────────────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '11px 16px', borderTop: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.2)', flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Markdown supported · toolbar above · ⬆ Import to load .md / .txt / .docx
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={onSave}>
                {editId ? '✅ Save Changes' : '🚨 Log Incident'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main Incidents Component ──────────────────────────────────────────────
export default function Incidents({
  incidents, setIncidents,
  users, currentUser, isManager,
  driveToken,
  timesheets, setTimesheets,
  addLog,
}) {
  const [view,      setView]      = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editId,    setEditId]    = useState(null);
  const [form,      setForm]      = useState({ ...BLANK_INCIDENT });
  const [filter,    setFilter]    = useState({ status: 'all', severity: 'all', uid: 'all' });
  const [notify,    setNotify]    = useState('');
  const [lastSync,  setLastSync]  = useState(null);
  const [syncing,   setSyncing]   = useState(false);
  const pollRef     = useRef(null);
  const notifyTimer = useRef(null);

  const safe = Array.isArray(incidents) ? incidents : [];

  // ── Real-time polling every 15 s ──────────────────────────────────────
  const pollDrive = useCallback(async () => {
    if (!driveToken) return;
    try {
      setSyncing(true);
      const data = await driveRead(driveToken, 'incidents').catch(() => null);
      if (Array.isArray(data)) { setIncidents(data); setLastSync(new Date()); }
    } catch (_) {}
    finally { setSyncing(false); }
  }, [driveToken, setIncidents]);

  useEffect(() => {
    pollDrive();
    pollRef.current = setInterval(pollDrive, 15000);
    return () => clearInterval(pollRef.current);
  }, [pollDrive]);

  const showNotify = (msg) => {
    setNotify(msg);
    clearTimeout(notifyTimer.current);
    notifyTimer.current = setTimeout(() => setNotify(''), 3500);
  };

  // ── CRUD ─────────────────────────────────────────────────────────────
  const openAdd = () => {
    setForm({
      ...BLANK_INCIDENT,
      assigned_to: isManager ? (users[0]?.id || currentUser) : currentUser,
      isDaily: view === 'daily',
      date: new Date().toISOString().slice(0, 10),
    });
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (inc) => {
    setForm({ ...BLANK_INCIDENT, ...inc });
    setEditId(inc.id);
    setShowModal(true);
  };

  const saveIncident = () => {
    if (!form.title.trim())  { showNotify('⚠ Title is required.'); return; }
    if (!form.assigned_to)   { showNotify('⚠ Assignee is required.'); return; }
    if (!form.date)          { showNotify('⚠ Date is required.'); return; }
    if (!isManager && form.assigned_to !== currentUser) {
      showNotify('⚠ You can only log incidents for yourself.'); return;
    }
    const entry = {
      ...form,
      id:         editId || `inc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      hours:      Number(form.hours) || 1,
      updated_at: new Date().toISOString(),
      created_at: editId ? (safe.find(i => i.id === editId)?.created_at || new Date().toISOString()) : new Date().toISOString(),
    };
    setIncidents(editId ? safe.map(i => i.id === editId ? entry : i) : [entry, ...safe]);
    setShowModal(false);
    showNotify(editId ? '✅ Incident updated.' : '✅ Incident logged.');
    addLog?.({ section: 'incidents', level: 'info', action: editId ? 'Edit incident' : 'Log incident', detail: `${entry.severity} — "${entry.title}"` });
  };

  const deleteIncident = (id) => {
    if (!isManager) { showNotify('⚠ Only the manager can delete incidents.'); return; }
    if (!window.confirm('Delete this incident?')) return;
    const entry = safe.find(i => i.id === id);
    setIncidents(safe.filter(i => i.id !== id));
    showNotify('🗑 Incident deleted.');
    addLog?.({ section: 'incidents', level: 'warning', action: 'Delete incident', detail: `"${entry?.title || id}"` });
  };

  const resolveIncident = (id) => {
    setIncidents(safe.map(i => i.id === id ? { ...i, status: 'Resolved', updated_at: new Date().toISOString() } : i));
    showNotify('✅ Marked as Resolved.');
  };

  // ── Filter & sort ─────────────────────────────────────────────────────
  const viewFiltered = safe.filter(i => {
    if (view === 'daily')  return i.isDaily === true;
    if (view === 'oncall') return !i.isDaily;
    return true;
  });
  const displayed = viewFiltered.filter(i => {
    if (filter.status   !== 'all' && i.status      !== filter.status)   return false;
    if (filter.severity !== 'all' && i.severity    !== filter.severity) return false;
    if (filter.uid      !== 'all' && i.assigned_to !== filter.uid)      return false;
    return true;
  });
  const sorted = [...displayed].sort((a, b) => {
    const sO = { Investigating: 0, Identified: 1, Monitoring: 2, Resolved: 3 };
    const vO = { Disaster: 0, Critical: 1, High: 2, Medium: 3, Low: 4 };
    if (sO[a.status] !== sO[b.status]) return (sO[a.status] ?? 9) - (sO[b.status] ?? 9);
    return (vO[a.severity] ?? 9) - (vO[b.severity] ?? 9);
  });

  const setF = (k, v) => setFilter(f => ({ ...f, [k]: v }));

  return (
    <div>
      {/* Toast */}
      {notify && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '10px 18px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>{notify}</div>
      )}

      {/* Header */}
      <div className="page-header">
        <div className="flex-between">
          <div>
            <div className="page-title">🚨 Incidents</div>
            <div className="page-sub">
              Log and track on-call &amp; daily incidents
              {lastSync && (
                <span style={{ marginLeft: 10, fontSize: 10, color: 'var(--text-muted)' }}>
                  {syncing ? '⏳ syncing…' : `● live · ${lastSync.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
                </span>
              )}
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Log Incident</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Open"     value={safe.filter(i => i.status === 'Investigating').length} sub="Investigating" accent="#ef4444"       icon="🚨" />
        <StatCard label="Resolved" value={safe.filter(i => i.status === 'Resolved').length}      sub="Closed"        accent="#22c55e"       icon="✅" />
        <StatCard label="Today"    value={safe.filter(i => (i.date||'').slice(0,10) === new Date().toISOString().slice(0,10)).length} sub="Logged today" accent="#f59e0b" icon="📅" />
        <StatCard label="Daily"    value={safe.filter(i => i.isDaily).length}                    sub="Ops incidents" accent="#818cf8"       icon="📋" />
        <StatCard label="Total"    value={safe.length}                                            sub="All time"      accent="var(--accent)" icon="📊" />
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '10px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[{ id:'all', label:'All' }, { id:'daily', label:'📋 Daily' }, { id:'oncall', label:'🚨 On-Call' }].map(t => (
              <button key={t.id} className={`btn btn-sm ${view === t.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setView(t.id)}>{t.label}</button>
            ))}
          </div>
          <select className="form-input" style={{ width: 140 }} value={filter.status} onChange={e => setF('status', e.target.value)}>
            <option value="all">All Statuses</option>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select className="form-input" style={{ width: 120 }} value={filter.severity} onChange={e => setF('severity', e.target.value)}>
            <option value="all">All Severities</option>
            {SEVERITIES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select className="form-input" style={{ width: 150 }} value={filter.uid} onChange={e => setF('uid', e.target.value)}>
            <option value="all">All Engineers</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {(filter.status !== 'all' || filter.severity !== 'all' || filter.uid !== 'all') && (
            <button className="btn btn-secondary btn-sm" onClick={() => setFilter({ status:'all', severity:'all', uid:'all' })}>✕ Clear</button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{sorted.length} shown</span>
        </div>
      </div>

      {/* List */}
      {sorted.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎉</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No incidents match your filters</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Use the button above to log one.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(inc => (
            <IncidentCard key={inc.id} inc={inc} users={users} isManager={isManager}
              currentUser={currentUser} onEdit={openEdit} onDelete={deleteIncident} onResolve={resolveIncident} />
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <IncidentModal
          editId={editId}
          form={form}
          setForm={setForm}
          onSave={saveIncident}
          onClose={() => setShowModal(false)}
          users={users}
          currentUser={currentUser}
          isManager={isManager}
        />
      )}
    </div>
  );
}
