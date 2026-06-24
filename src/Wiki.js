// src/Wiki.js
// CloudOps Rota — Wiki module
// Extracted from App.js and extended with:
//   • File import: .md, .txt, .doc/.docx (mammoth), .pdf (pdfjs)
//   • Google Drive upload to CloudOps-Rota/Wiki/ folder as Google Doc
//   • Version history (max 5 snapshots per article)
//   • Custom category creation

import React, { useState, useRef } from 'react';

// ── Drive helpers (module-level, same pattern as App.js) ─────────────────────
// These mirror the private helpers in App.js. Wiki.js gets driveToken as a prop
// and uses it to write files into the "Wiki" subfolder.

const _wikiFileIdCache = {};

async function wikiGetOrCreateFolder(token) {
  // Find CloudOps-Rota parent first
  const parentQ = encodeURIComponent(
    `name='CloudOps-Rota' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const parentResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${parentQ}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  const parentId = parentResp.files?.[0]?.id || null;

  // Now find/create Wiki subfolder inside parent
  const q = parentId
    ? encodeURIComponent(`name='Wiki' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`)
    : encodeURIComponent(`name='Wiki' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  if (resp.files?.length > 0) return resp.files[0].id;

  // Create Wiki subfolder
  const body = { name: 'Wiki', mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
  return createResp.id;
}

// Upload / update an HTML file in the Wiki folder as a Google Doc (native)
// Returns the Google Doc file ID stored in the article record.
async function wikiUploadDoc(token, articleId, title, htmlContent) {
  try {
    const folderId = await wikiGetOrCreateFolder(token);
    const fileName  = `${articleId}.html`;
    const cacheKey  = `wiki/${fileName}`;
    const blob      = new Blob([htmlContent], { type: 'text/html' });

    // Check if file already exists
    let fileId = _wikiFileIdCache[cacheKey] || null;
    if (!fileId) {
      const q = encodeURIComponent(
        `name='${fileName}' and '${folderId}' in parents and trashed=false`
      );
      const found = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then(r => r.json());
      fileId = found.files?.[0]?.id || null;
    }

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(
      fileId
        ? { name: fileName }
        : { name: fileName, parents: [folderId] }
    )], { type: 'application/json' }));
    form.append('file', blob);

    const url    = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const method = fileId ? 'PATCH' : 'POST';

    const result = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }).then(r => r.json());

    if (result.id) {
      _wikiFileIdCache[cacheKey] = result.id;
      // Make the file readable by anyone in the org (shared)
      await fetch(`https://www.googleapis.com/drive/v3/files/${result.id}/permissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }).catch(() => {}); // non-fatal if permission already set
      return result.id;
    }
    return null;
  } catch (e) {
    console.error('wikiUploadDoc error:', e);
    return null;
  }
}

// ── File import helpers ───────────────────────────────────────────────────────

// .md / .txt → HTML (simple markdown-lite conversion)
function markdownToHtml(md) {
  return md
    .replace(/^###### (.+)$/gm,  '<h6>$1</h6>')
    .replace(/^##### (.+)$/gm,   '<h5>$1</h5>')
    .replace(/^#### (.+)$/gm,    '<h4>$1</h4>')
    .replace(/^### (.+)$/gm,     '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,      '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,       '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g,   '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,       '<em>$1</em>')
    .replace(/`(.+?)`/g,         '<code style="background:rgba(0,0,0,0.4);padding:2px 6px;border-radius:4px;font-family:DM Mono,monospace;color:#6ee7b7">$1</code>')
    .replace(/^\s*---\s*$/gm,    '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:18px 0"/>')
    .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[a-z])(.+)$/gm, '<p>$1</p>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" style="color:var(--accent)">$1</a>');
}

async function readFileAsHtml(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'md' || ext === 'txt') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(markdownToHtml(e.target.result));
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  if (ext === 'docx' || ext === 'doc') {
    // mammoth.js via CDN — converts Word to clean HTML
    if (!window.mammoth) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const result = await window.mammoth.convertToHtml({ arrayBuffer: e.target.result });
          resolve(result.value);
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  if (ext === 'pdf') {
    // pdf.js via CDN — extracts text and renders as paragraphs
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          resolve();
        };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const pdf   = await window.pdfjsLib.getDocument({ data: e.target.result }).promise;
          let html    = '';
          for (let p = 1; p <= pdf.numPages; p++) {
            const page    = await pdf.getPage(p);
            const content = await page.getTextContent();
            const text    = content.items.map(i => i.str).join(' ');
            html += `<p>${text}</p>`;
          }
          resolve(html || '<p>No text content extracted from PDF.</p>');
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  throw new Error(`Unsupported file type: .${ext}`);
}

// ── Version helpers ───────────────────────────────────────────────────────────
const MAX_VERSIONS = 5;

function snapshotArticle(article) {
  return {
    snapshotAt: new Date().toISOString(),
    title:      article.title,
    content:    article.content,
    excerpt:    article.excerpt,
    tags:       article.tags,
    cat:        article.cat,
    author:     article.author,
  };
}

function addVersion(article) {
  const history = Array.isArray(article.history) ? article.history : [];
  const updated = [snapshotArticle(article), ...history].slice(0, MAX_VERSIONS);
  return { ...article, history: updated };
}

// ── Default categories (user can add more, stored in wiki meta) ───────────────
const DEFAULT_CATS = ['Operations','Engineering','Process','Security','Runbooks','Announcements'];

// ── Small sub-components ──────────────────────────────────────────────────────

function FormGroup({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
        {label}{hint && <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, color: 'var(--text-muted)', opacity: 0.7 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ImportProgress({ status }) {
  if (!status) return null;
  const isErr = status.startsWith('Error');
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 8, fontSize: 12,
      background: isErr ? 'rgba(239,68,68,0.15)' : 'rgba(0,194,255,0.12)',
      color:      isErr ? '#fca5a5'              : '#7dd3fc',
      border:     `1px solid ${isErr ? 'rgba(239,68,68,0.3)' : 'rgba(0,194,255,0.25)'}`,
      marginBottom: 12,
    }}>{isErr ? '❌ ' : '⏳ '}{status}</div>
  );
}

// ── History panel ─────────────────────────────────────────────────────────────
function HistoryPanel({ article, onRestore, onClose }) {
  const [preview, setPreview] = useState(null);
  const history = article.history || [];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 900, maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>📜 Version History — {article.title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {history.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>No previous versions saved yet. History is created each time you update an article.</div>
        ) : (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Version list */}
            <div style={{ width: 260, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
              {history.map((v, idx) => (
                <div key={idx}
                  onClick={() => setPreview(v)}
                  style={{
                    padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                    background: preview === v ? 'rgba(0,194,255,0.08)' : 'transparent',
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {idx === 0 ? '🕐 Most Recent' : `v${history.length - idx}`}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {new Date(v.snapshotAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  {v.author && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>by {v.author}</div>}
                </div>
              ))}
            </div>
            {/* Preview pane */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              {preview ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                    <button
                      onClick={() => { if (window.confirm('Restore this version? The current content will be saved to history first.')) { onRestore(preview); onClose(); } }}
                      style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                      ↩ Restore This Version
                    </button>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{preview.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    {preview.cat} · {preview.tags} · by {preview.author || '—'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}
                    dangerouslySetInnerHTML={{ __html: preview.content }} />
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
                  Select a version on the left to preview it.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Wiki component ───────────────────────────────────────────────────────
export default function Wiki({ wiki, setWiki, driveToken, currentUser, isManager }) {
  const [sel,      setSel]      = useState(null);
  const [editing,  setEditing]  = useState(false);
  const [search,   setSearch]   = useState('');
  const [catFilter,setCatFilter]= useState('all');
  const [form,     setForm]     = useState({ title: '', cat: 'Operations', heroUrl: '', excerpt: '', tags: '', content: '', author: currentUser || '' });
  const [importStatus, setImportStatus] = useState('');
  const [driveStatus,  setDriveStatus]  = useState('');
  const [showHistory,  setShowHistory]  = useState(false);
  const [showNewCat,   setShowNewCat]   = useState(false);
  const [newCatName,   setNewCatName]   = useState('');
  const fileInputRef = useRef(null);

  // Categories: built-in defaults + any custom ones stored on wiki articles
  const customCats = Array.from(new Set((wiki || []).map(w => w.cat).filter(Boolean)));
  const CATS = Array.from(new Set([...DEFAULT_CATS, ...customCats])).sort();

  // ── Helpers ────────────────────────────────────────────────────────────────
  const openNew = () => {
    setForm({ title: '', cat: 'Operations', heroUrl: '', excerpt: '', tags: '', content: '', author: currentUser || '' });
    setImportStatus(''); setDriveStatus('');
    setSel('__new__'); setEditing(true);
  };
  const openEdit = (w) => {
    setForm({ ...w, author: w.author || currentUser || '' });
    setImportStatus(''); setDriveStatus('');
    setSel(w.id); setEditing(true);
  };

  const backToList = () => { setEditing(false); setSel(null); setShowHistory(false); };

  // ── File import ────────────────────────────────────────────────────────────
  const handleFileImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus(`Reading ${file.name}…`);
    try {
      const html = await readFileAsHtml(file);
      // Use filename (without extension) as title suggestion if title is blank
      const suggestedTitle = form.title || file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      setForm(f => ({ ...f, content: html, title: f.title || suggestedTitle }));
      setImportStatus(`✅ Imported ${file.name} successfully.`);
    } catch (err) {
      setImportStatus(`Error: ${err.message}`);
    }
    // Reset input so same file can be re-imported
    e.target.value = '';
  };

  // ── Save article (with Drive upload and version history) ────────────────────
  const save = async () => {
    if (!form.title) return;
    const now  = new Date().toISOString().slice(0, 10);
    const isNew = sel === '__new__';

    setDriveStatus(isNew ? 'Creating article…' : 'Saving article…');

    if (isNew) {
      const id     = 'w' + Date.now();
      const newArt = {
        id,
        ...form,
        created: now,
        updated: now,
        history: [],
        driveFileId: null,
      };

      // Upload to Drive
      if (driveToken) {
        setDriveStatus('Uploading to Google Drive Wiki folder…');
        const driveFileId = await wikiUploadDoc(driveToken, id, form.title, form.content);
        if (driveFileId) {
          newArt.driveFileId = driveFileId;
          setDriveStatus('✅ Saved to Drive (Wiki folder) — visible to all engineers.');
        } else {
          setDriveStatus('⚠️ Article saved locally but Drive upload failed.');
        }
      } else {
        setDriveStatus('');
      }

      setWiki(prev => [newArt, ...(Array.isArray(prev) ? prev : [])]);

    } else {
      // Edit: snapshot current version into history first
      const existing = wiki.find(w => w.id === sel);
      const withHistory = existing ? addVersion(existing) : {};
      const updated = {
        ...withHistory,
        ...form,
        id:      sel,
        created: existing?.created || now,
        updated: now,
      };

      // Upload to Drive
      if (driveToken) {
        setDriveStatus('Syncing to Google Drive Wiki folder…');
        const driveFileId = await wikiUploadDoc(driveToken, sel, form.title, form.content);
        if (driveFileId) {
          updated.driveFileId = driveFileId;
          setDriveStatus('✅ Synced to Drive.');
        } else {
          setDriveStatus('⚠️ Saved locally but Drive sync failed.');
        }
      } else {
        setDriveStatus('');
      }

      setWiki(prev => (Array.isArray(prev) ? prev : []).map(w => w.id === sel ? updated : w));
    }

    setEditing(false); setSel(null);
  };

  // ── Restore a version ──────────────────────────────────────────────────────
  const restoreVersion = (snapshot) => {
    const existing = wiki.find(w => w.id === sel);
    if (!existing) return;
    // Snapshot the current state before overwriting
    const withCurrentSnap = addVersion(existing);
    const restored = {
      ...withCurrentSnap,
      title:   snapshot.title,
      content: snapshot.content,
      excerpt: snapshot.excerpt,
      tags:    snapshot.tags,
      cat:     snapshot.cat,
      author:  snapshot.author,
      updated: new Date().toISOString().slice(0, 10),
    };
    setWiki(prev => (Array.isArray(prev) ? prev : []).map(w => w.id === sel ? restored : w));
    // Also update form so editor reflects the restored state
    setForm({ ...restored });
    // Re-upload to Drive
    if (driveToken) {
      wikiUploadDoc(driveToken, sel, snapshot.title, snapshot.content).catch(() => {});
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteW = (id) => {
    if (!window.confirm('Delete this article? This cannot be undone.')) return;
    setWiki((wiki || []).filter(w => w.id !== id));
    setSel(null); setEditing(false);
  };

  // ── Add custom category ────────────────────────────────────────────────────
  const addCategory = () => {
    const name = newCatName.trim();
    if (!name || CATS.includes(name)) { setShowNewCat(false); setNewCatName(''); return; }
    // Materialise the category by creating a placeholder article that holds it,
    // or simply apply it to the current form — it will persist via article data.
    setForm(f => ({ ...f, cat: name }));
    setNewCatName(''); setShowNewCat(false);
  };

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = (wiki || []).filter(w =>
    (catFilter === 'all' || w.cat === catFilter) &&
    (
      w.title.toLowerCase().includes(search.toLowerCase()) ||
      (w.tags   || '').toLowerCase().includes(search.toLowerCase()) ||
      (w.excerpt || '').toLowerCase().includes(search.toLowerCase())
    )
  );

  // ────────────────────────────────────────────────────────────────────────────
  // ── EDITOR VIEW ─────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────────────────
  if (editing) {
    const isNew = sel === '__new__';
    const currentArticle = wiki?.find(w => w.id === sel);
    const hasHistory = (currentArticle?.history || []).length > 0;

    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={backToList}>← Back</button>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--text-muted)' }}>{isNew ? 'New Article' : 'Edit Article'}</span>
          {/* File import */}
          <input ref={fileInputRef} type="file" accept=".md,.txt,.doc,.docx,.pdf"
            style={{ display: 'none' }} onChange={handleFileImport} />
          <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
            📎 Import File
          </button>
          {!isNew && hasHistory && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowHistory(true)}>📜 History ({currentArticle.history.length})</button>
          )}
          {!isNew && <button className="btn btn-danger btn-sm" onClick={() => deleteW(sel)}>🗑 Delete</button>}
          <button className="btn btn-primary" onClick={save}>{isNew ? '🚀 Publish' : '✓ Update'}</button>
        </div>

        {/* Import / Drive status */}
        <ImportProgress status={importStatus} />
        {driveStatus && <ImportProgress status={driveStatus} />}

        {/* Hero image */}
        <div style={{ marginBottom: 20 }}>
          {form.heroUrl && (
            <div style={{ width: '100%', height: 220, borderRadius: 12, overflow: 'hidden', marginBottom: 12, position: 'relative' }}>
              <img src={form.heroUrl} alt="Hero" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 50%,rgba(10,20,40,.9))' }} />
            </div>
          )}
          <input className="input" placeholder="Hero image URL (https://…)" value={form.heroUrl}
            onChange={e => setForm({ ...form, heroUrl: e.target.value })} />
        </div>

        {/* Meta grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <FormGroup label="Title">
            <input className="input" style={{ fontSize: 15 }} placeholder="Article title"
              value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </FormGroup>
          <FormGroup label="Category">
            <div style={{ display: 'flex', gap: 6 }}>
              <select className="select" style={{ flex: 1 }} value={form.cat}
                onChange={e => {
                  if (e.target.value === '__new__') { setShowNewCat(true); }
                  else setForm({ ...form, cat: e.target.value });
                }}>
                {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__new__">＋ New category…</option>
              </select>
            </div>
            {/* Inline new-category input */}
            {showNewCat && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input className="input" style={{ flex: 1 }} placeholder="Category name"
                  autoFocus
                  value={newCatName} onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') { setShowNewCat(false); setNewCatName(''); } }} />
                <button className="btn btn-primary btn-sm" onClick={addCategory}>Add</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setShowNewCat(false); setNewCatName(''); }}>✕</button>
              </div>
            )}
          </FormGroup>
          <FormGroup label="Author">
            <input className="input" placeholder="Your name"
              value={form.author} onChange={e => setForm({ ...form, author: e.target.value })} />
          </FormGroup>
        </div>

        <FormGroup label="Tags" hint="comma separated">
          <input className="input" placeholder="e.g. aws, kubernetes, runbook"
            value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
        </FormGroup>
        <FormGroup label="Excerpt / Summary">
          <textarea className="textarea" rows={2} placeholder="Short description shown on cards…"
            value={form.excerpt} onChange={e => setForm({ ...form, excerpt: e.target.value })} />
        </FormGroup>

        {/* Supported file types note */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          💡 You can import content from <strong>.md</strong>, <strong>.txt</strong>, <strong>.doc/.docx</strong>, or <strong>.pdf</strong> files using the Import button above — or type/paste directly below.
        </div>

        <FormGroup label="Content">
          {/* Inline rich editor — reuses same contenteditable pattern as App.js */}
          <WikiRichEditor
            value={form.content}
            onChange={v => setForm({ ...form, content: v })}
          />
        </FormGroup>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={backToList}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{isNew ? '🚀 Publish Article' : '✓ Update Article'}</button>
        </div>

        {/* Version history slide-up */}
        {showHistory && currentArticle && (
          <HistoryPanel
            article={currentArticle}
            onRestore={restoreVersion}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ── ARTICLE VIEW ─────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────────────────
  if (sel && sel !== '__new__') {
    const w = (wiki || []).find(x => x.id === sel);
    if (!w) { setSel(null); return null; }
    return (
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setSel(null)}>← Back</button>
          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(w)}>✏ Edit</button>
          {(w.history || []).length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => { openEdit(w); setTimeout(() => setShowHistory(true), 0); }}>
              📜 History ({w.history.length})
            </button>
          )}
          {w.driveFileId && (
            <a
              href={`https://drive.google.com/file/d/${w.driveFileId}/view`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', padding: '4px 10px', border: '1px solid var(--accent)', borderRadius: 6 }}>
              🔗 View on Drive
            </a>
          )}
          <span style={{ flex: 1 }} />
          {isManager && <button className="btn btn-danger btn-sm" onClick={() => deleteW(w.id)}>🗑 Delete</button>}
        </div>

        {w.heroUrl && (
          <div style={{ width: '100%', height: 280, borderRadius: 16, overflow: 'hidden', marginBottom: 24, position: 'relative' }}>
            <img src={w.heroUrl} alt="Hero" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 40%,rgba(10,20,40,.95))' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 28px' }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{w.title}</div>
            </div>
          </div>
        )}
        {!w.heroUrl && <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>{w.title}</div>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <span style={{ background: '#1e40af55', color: '#bfdbfe', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{w.cat}</span>
          {(w.tags || '').split(',').filter(Boolean).map(t => (
            <span key={t} style={{ background: '#1e293b', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 12, fontSize: 11, border: '1px solid var(--border)' }}>{t.trim()}</span>
          ))}
          {w.author  && <span className="muted-xs">by {w.author}</span>}
          {w.updated && <span className="muted-xs">· Updated {w.updated}</span>}
          {(w.history || []).length > 0 && <span className="muted-xs">· {w.history.length} version{w.history.length !== 1 ? 's' : ''}</span>}
        </div>

        {w.excerpt && (
          <div style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)', fontStyle: 'italic' }}>
            {w.excerpt}
          </div>
        )}
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.9 }}
          dangerouslySetInnerHTML={{ __html: w.content }} />
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ── ARTICLE LIST ─────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>📖 Wiki</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Team knowledge base & articles</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Article</button>
      </div>

      {/* Search + Category filter */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input className="input" placeholder="🔍 Search wiki…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <select className="select" value={catFilter}
          onChange={e => setCatFilter(e.target.value)} style={{ width: 180 }}>
          <option value="all">All Categories</option>
          {CATS.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Category pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {['all', ...CATS].map(c => (
          <button key={c} onClick={() => setCatFilter(c)}
            style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${catFilter === c ? 'var(--accent)' : 'var(--border)'}`,
              background: catFilter === c ? 'var(--accent)' : 'transparent',
              color: catFilter === c ? '#000' : 'var(--text-muted)',
            }}>
            {c === 'all' ? 'All' : c}
            {c !== 'all' && <span style={{ marginLeft: 4, opacity: 0.7 }}>({(wiki || []).filter(w => w.cat === c).length})</span>}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No articles found.{catFilter !== 'all' ? ' Try a different category.' : ' Create your first article above.'}
        </div>
      )}

      {/* Featured first article */}
      {filtered.length > 0 && (() => {
        const w = filtered[0];
        return (
          <div key={w.id} className="card"
            style={{ cursor: 'pointer', marginBottom: 20, padding: 0, overflow: 'hidden' }}
            onClick={() => setSel(w.id)}>
            {w.heroUrl && (
              <div style={{ width: '100%', height: 200, position: 'relative', overflow: 'hidden' }}>
                <img src={w.heroUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 30%,rgba(10,20,40,.95))' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 24px' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{w.title}</div>
                </div>
              </div>
            )}
            <div style={{ padding: '16px 20px' }}>
              {!w.heroUrl && <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{w.title}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                <span style={{ background: '#1e40af55', color: '#bfdbfe', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>★ Featured · {w.cat}</span>
                {(w.tags || '').split(',').filter(Boolean).slice(0, 3).map(t => (
                  <span key={t} style={{ background: '#1e293b', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 10, fontSize: 10, border: '1px solid var(--border)' }}>{t.trim()}</span>
                ))}
                {(w.history || []).length > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>📜 {w.history.length}v</span>
                )}
              </div>
              <div className="muted-xs">{w.excerpt || (w.content || '').replace(/<[^>]+>/g, '').slice(0, 150)}…</div>
              <div className="muted-xs" style={{ marginTop: 8 }}>{w.author && `by ${w.author} · `}{w.updated}</div>
            </div>
          </div>
        );
      })()}

      {/* Rest as grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: 16 }}>
        {filtered.slice(1).map(w => (
          <div key={w.id} className="card"
            style={{ cursor: 'pointer', padding: 0, overflow: 'hidden' }}
            onClick={() => setSel(w.id)}>
            {w.heroUrl && (
              <div style={{ height: 120, overflow: 'hidden', position: 'relative' }}>
                <img src={w.heroUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,20,40,.3)' }} />
              </div>
            )}
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                <span style={{ background: '#1e40af55', color: '#bfdbfe', padding: '2px 6px', borderRadius: 10, fontSize: 10 }}>{w.cat}</span>
                {(w.tags || '').split(',').filter(Boolean).slice(0, 2).map(t => (
                  <span key={t} style={{ background: '#1e293b', color: 'var(--text-muted)', padding: '2px 5px', borderRadius: 8, fontSize: 9, border: '1px solid var(--border)' }}>{t.trim()}</span>
                ))}
                {(w.history || []).length > 0 && (
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>📜 {w.history.length}v</span>
                )}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, lineHeight: 1.4 }}>{w.title}</div>
              <div className="muted-xs">{w.excerpt || (w.content || '').replace(/<[^>]+>/g, '').slice(0, 100)}…</div>
              <div className="muted-xs" style={{ marginTop: 8 }}>{w.updated}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Self-contained rich text editor (mirrors App.js RichEditor) ───────────────
function WikiRichEditor({ value, onChange }) {
  const ref  = useRef(null);
  const init = useRef(false);

  React.useEffect(() => {
    if (ref.current && !init.current) {
      ref.current.innerHTML = value || '';
      init.current = true;
    }
  }, []);

  // Sync external value changes (e.g. after file import)
  React.useEffect(() => {
    if (ref.current && value !== ref.current.innerHTML) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  const exec = (cmd, val) => { document.execCommand(cmd, false, val ?? null); ref.current?.focus(); };

  const TB = (extra = {}) => ({
    padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)',
    background: 'var(--bg-card2)', color: 'var(--text-primary)', cursor: 'pointer',
    fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
    whiteSpace: 'nowrap', lineHeight: 1.3, ...extra,
  });
  const SEP = <div style={{ width: 1, background: 'var(--border)', margin: '0 4px', alignSelf: 'stretch' }} />;

  const insertTable = () => exec('insertHTML', `<table border="1" style="border-collapse:collapse;width:100%;margin:8px 0"><tr><th style="padding:6px 10px;background:#1e3a5f;min-width:80px">Header 1</th><th style="padding:6px 10px;background:#1e3a5f">Header 2</th></tr><tr><td style="padding:6px 10px">Cell</td><td style="padding:6px 10px">Cell</td></tr></table><p></p>`);
  const insertCode  = () => exec('insertHTML', `<pre style="background:rgba(0,0,0,0.55);padding:14px 16px;border-radius:8px;overflow:auto;font-size:12px;font-family:DM Mono,Courier New,monospace;color:#6ee7b7;margin:10px 0;border:1px solid rgba(110,231,183,0.2)">// code here</pre><p></p>`);
  const insertLink  = () => { const url = prompt('URL:'); const txt = prompt('Link text:'); if (url && txt) exec('insertHTML', `<a href="${url}" target="_blank" style="color:var(--accent)">${txt}</a>`); else if (url) exec('createLink', url); };
  const insertCallout = (type) => {
    const s = { info: ['rgba(0,194,255,0.1)','rgba(0,194,255,0.3)','#7dd3fc','ℹ️'], warning: ['rgba(245,158,11,0.1)','rgba(245,158,11,0.3)','#fcd34d','⚠️'], success: ['rgba(16,185,129,0.1)','rgba(16,185,129,0.3)','#6ee7b7','✅'], danger: ['rgba(239,68,68,0.1)','rgba(239,68,68,0.3)','#fca5a5','🔴'] };
    const [bg, border, color, icon] = s[type] || s.info;
    exec('insertHTML', `<div style="background:${bg};border-left:4px solid ${border};padding:12px 16px;border-radius:0 8px 8px 0;margin:10px 0;color:${color}">${icon} <strong>Note:</strong> Add text here.</div><p></p>`);
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card2)', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar row 1 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '7px 10px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'var(--bg-card)', alignItems: 'center' }}>
        <select onChange={e => { exec('formatBlock', e.target.value); e.target.value = ''; }} defaultValue=""
          style={{ ...TB(), padding: '4px 6px', fontSize: 11, minWidth: 115 }}>
          <option value="" disabled>¶ Style</option>
          <option value="p">Normal</option>
          <option value="h1">H1</option><option value="h2">H2</option>
          <option value="h3">H3</option><option value="h4">H4</option>
          <option value="pre">Code</option><option value="blockquote">Quote</option>
        </select>
        {SEP}
        <button onMouseDown={e => { e.preventDefault(); exec('bold'); }}          style={{ ...TB(), fontWeight: 700, minWidth: 30 }}>B</button>
        <button onMouseDown={e => { e.preventDefault(); exec('italic'); }}        style={{ ...TB(), fontStyle: 'italic', minWidth: 30 }}>I</button>
        <button onMouseDown={e => { e.preventDefault(); exec('underline'); }}     style={{ ...TB(), textDecoration: 'underline', minWidth: 30 }}>U</button>
        <button onMouseDown={e => { e.preventDefault(); exec('strikeThrough'); }} style={{ ...TB(), minWidth: 30 }}>S̶</button>
        {SEP}
        <button onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }} style={TB()}>• List</button>
        <button onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }}   style={TB()}>1. Numbered</button>
        {SEP}
        <button onMouseDown={e => { e.preventDefault(); insertTable(); }}  style={{ ...TB(), color: 'var(--accent)' }}>⊞ Table</button>
        <button onMouseDown={e => { e.preventDefault(); insertLink(); }}   style={{ ...TB(), color: 'var(--accent)' }}>🔗 Link</button>
        <button onMouseDown={e => { e.preventDefault(); insertCode(); }}   style={{ ...TB(), color: '#6ee7b7', fontFamily: 'DM Mono,monospace' }}>{`{}`} Code</button>
        {SEP}
        <button onMouseDown={e => { e.preventDefault(); insertCallout('info'); }}    style={{ ...TB(), color: '#7dd3fc', fontSize: 11 }}>ℹ️ Info</button>
        <button onMouseDown={e => { e.preventDefault(); insertCallout('warning'); }} style={{ ...TB(), color: '#fcd34d', fontSize: 11 }}>⚠️ Warn</button>
        <button onMouseDown={e => { e.preventDefault(); insertCallout('success'); }} style={{ ...TB(), color: '#6ee7b7', fontSize: 11 }}>✅ Note</button>
        <button onMouseDown={e => { e.preventDefault(); insertCallout('danger'); }}  style={{ ...TB(), color: '#fca5a5', fontSize: 11 }}>🔴 Alert</button>
        {SEP}
        <button onMouseDown={e => { e.preventDefault(); exec('undo'); }}   title="Undo" style={{ ...TB(), fontSize: 14 }}>↩</button>
        <button onMouseDown={e => { e.preventDefault(); exec('redo'); }}   title="Redo" style={{ ...TB(), fontSize: 14 }}>↪</button>
      </div>
      {/* Editable area */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange?.(ref.current?.innerHTML || '')}
        style={{
          minHeight: '55vh', padding: '16px 18px', outline: 'none',
          fontSize: 14, lineHeight: 1.85, color: 'var(--text-secondary)',
          overflowY: 'auto',
        }}
      />
    </div>
  );
}
