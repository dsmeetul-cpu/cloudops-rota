// src/TeamChat.js
// CloudOps Rota — Slack-style Team Chat
// Meetul Bhundia (MBA47) · Cloud Run Operations · July 2026
//
// SYNC DESIGN:
//  • Messages: poll whatsappChats.json every 6 s using cached file IDs
//              (avoids driveFindFile search on every poll — 1 API call not 2)
//  • Presence: heartbeat on mount + every 30 s + on every message sent
//              polled every 6 s alongside messages (same request batch)
//  • _rev monotonic counter: only apply Drive state if rev > local rev

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ── Drive helpers (same pattern as App.js) ─────────────────────────────────
async function chatFindFile(token, name) {
  const q = encodeURIComponent(
    `name='${name}' and trashed=false`
  );
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' } }
  ).then(r => r.json());
  return r.files?.[0] || null;
}

async function chatReadJson(token, fileId) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&_t=${Date.now()}`,
    { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' } }
  );
  return r.json();
}

async function chatWriteJson(token, name, data, fileIdRef) {
  const body = JSON.stringify(data);
  // Try update first using cached ID
  if (fileIdRef.current) {
    const r = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileIdRef.current}?uploadType=media`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }
    ).then(r => r.json());
    if (!r.error) return;
    fileIdRef.current = null; // ID stale, fall through to create
  }
  // Find or create
  const existing = await chatFindFile(token, name);
  if (existing) {
    fileIdRef.current = existing.id;
    await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }
    );
  } else {
    const meta = { name, mimeType: 'application/json' };
    const created = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    }).then(r => r.json());
    fileIdRef.current = created.id;
    await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }
    );
  }
}

// ── Constants ──────────────────────────────────────────────────────────────
const POLL_MS         = 6000;
const PRESENCE_MS     = 30000;  // heartbeat every 30 s
const ONLINE_WINDOW   = 90000;  // online = seen in last 90 s
const AWAY_WINDOW     = 300000; // away = seen in last 5 min

const EMOJIS = ['👍','❤️','😂','🔥','✅','⚡','👀','🎉','😮','🙏','💡','⚠️','🚀','💯','🤔'];

// ── Styles ─────────────────────────────────────────────────────────────────
const S = {
  sidebar: {
    width: 260,
    flexShrink: 0,
    background: '#1a1d21',
    borderRight: '1px solid rgba(255,255,255,0.07)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: '#1e2124',
  },
  msgArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 20px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
};

// ── Presence dot ───────────────────────────────────────────────────────────
function PresenceDot({ status, size = 9 }) {
  const colors = { online: '#23a55a', away: '#f0b232', offline: '#6b7280' };
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size, borderRadius: '50%',
      background: colors[status] || colors.offline,
      flexShrink: 0,
      boxShadow: status === 'online' ? `0 0 5px ${colors.online}88` : 'none',
    }} />
  );
}

// ── Avatar with presence ring ──────────────────────────────────────────────
function Avatar({ user, size = 36, presence = 'offline' }) {
  if (!user) return null;
  const presenceColors = { online: '#23a55a', away: '#f0b232', offline: 'transparent' };
  return (
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
      <div style={{
        width: size, height: size,
        borderRadius: Math.round(size * 0.25),
        background: user.color || '#1d4ed8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.4), fontWeight: 700, color: '#fff',
      }}>{user.avatar || user.name?.slice(0, 2) || '?'}</div>
      {presence !== 'offline' && (
        <span style={{
          position: 'absolute', bottom: -1, right: -1,
          width: Math.round(size * 0.28), height: Math.round(size * 0.28),
          borderRadius: '50%',
          background: presenceColors[presence],
          border: '2px solid #1a1d21',
          boxShadow: presence === 'online' ? `0 0 4px #23a55a` : 'none',
        }} />
      )}
    </div>
  );
}

// ── Format timestamp ───────────────────────────────────────────────────────
function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── Main component ─────────────────────────────────────────────────────────
export default function TeamChat({ whatsappChats, setWhatsappChats, users, currentUser, isManager, driveToken }) {
  const [selectedChat,  setSelectedChat]  = useState(null);
  const [threadOpen,    setThreadOpen]    = useState(null);
  const [draft,         setDraft]         = useState('');
  const [threadDraft,   setThreadDraft]   = useState('');
  const [showNew,       setShowNew]       = useState(false);
  const [newForm,       setNewForm]       = useState({ type: 'channel', name: '', topic: '', members: [] });
  const [search,        setSearch]        = useState('');
  const [editMsgId,     setEditMsgId]     = useState(null);
  const [editContent,   setEditContent]   = useState('');
  const [emojiPicker,   setEmojiPicker]   = useState(null);
  const [presence,      setPresence]      = useState({});      // { uid: isoTimestamp }
  const [toasts,        setToasts]        = useState([]);
  const [notifPerm,     setNotifPerm]     = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [syncStatus,    setSyncStatus]    = useState('');      // '' | 'saving' | 'saved' | 'error'
  const [showPinned,    setShowPinned]    = useState(false);
  const [showMembers,   setShowMembers]   = useState(false);

  // Refs
  const chatFileId     = useRef(null);   // cached Drive file ID for whatsappChats.json
  const presFileId     = useRef(null);   // cached Drive file ID for presence.json
  const lastRevRef     = useRef(0);
  const seenMsgIds     = useRef(new Set());
  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);
  const originalTitle  = useRef(document.title);
  const titleTimer     = useRef(null);

  const safe = Array.isArray(whatsappChats) ? whatsappChats : [];
  const channels = safe.filter(c => c.type === 'channel');
  const dms = safe.filter(c => c.type === 'dm' && (c.members || []).includes(currentUser));
  const current = safe.find(c => c.id === selectedChat) || null;

  // ── Presence helpers ────────────────────────────────────────────────────
  const getPresenceStatus = useCallback((uid) => {
    const ts = presence[uid];
    if (!ts) return 'offline';
    const age = Date.now() - new Date(ts).getTime();
    if (age < ONLINE_WINDOW) return 'online';
    if (age < AWAY_WINDOW)   return 'away';
    return 'offline';
  }, [presence]);

  const onlineCount = users.filter(u => getPresenceStatus(u.id) === 'online').length;

  // ── Write presence heartbeat ────────────────────────────────────────────
  const writePresence = useCallback(async () => {
    if (!driveToken) return;
    try {
      // Read current presence first
      let pres = {};
      if (presFileId.current) {
        try { pres = await chatReadJson(driveToken, presFileId.current); } catch (_) { presFileId.current = null; }
      }
      if (!presFileId.current) {
        const f = await chatFindFile(driveToken, 'presence.json');
        if (f) { presFileId.current = f.id; pres = await chatReadJson(driveToken, f.id); }
      }
      pres[currentUser] = new Date().toISOString();
      await chatWriteJson(driveToken, 'presence.json', pres, presFileId);
      setPresence({ ...pres });
    } catch (_) {}
  }, [driveToken, currentUser]);

  // ── Poll Drive (chats + presence, using cached IDs) ─────────────────────
  const pollDrive = useCallback(async () => {
    if (!driveToken) return;
    try {
      // ── Chats ──
      if (!chatFileId.current) {
        const f = await chatFindFile(driveToken, 'whatsappChats.json');
        if (f) chatFileId.current = f.id;
      }
      if (chatFileId.current) {
        const raw = await chatReadJson(driveToken, chatFileId.current);
        const rev = raw?._rev ?? 0;
        const data = raw?.chats ?? (Array.isArray(raw) ? raw : null);
        if (data && rev > lastRevRef.current) {
          lastRevRef.current = rev;
          setWhatsappChats(data);
        }
      }
      // ── Presence ──
      if (!presFileId.current) {
        const f = await chatFindFile(driveToken, 'presence.json');
        if (f) presFileId.current = f.id;
      }
      if (presFileId.current) {
        const pres = await chatReadJson(driveToken, presFileId.current);
        if (pres && typeof pres === 'object') setPresence({ ...pres });
      }
    } catch (_) {}
  }, [driveToken, setWhatsappChats]);

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!driveToken) return;
    // Seed seenMsgIds so we don't notify existing messages
    safe.forEach(c => {
      (c.messages || []).forEach(m => {
        seenMsgIds.current.add(m.id);
        (m.thread || []).forEach(r => seenMsgIds.current.add(r.id));
      });
    });
    pollDrive();
  }, [driveToken]); // eslint-disable-line

  // ── Poll interval ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!driveToken) return;
    const t = setInterval(pollDrive, POLL_MS);
    return () => clearInterval(t);
  }, [driveToken, pollDrive]);

  // ── Presence heartbeat ──────────────────────────────────────────────────
  useEffect(() => {
    if (!driveToken) return;
    writePresence();
    const t = setInterval(writePresence, PRESENCE_MS);
    return () => clearInterval(t);
  }, [driveToken, writePresence]);

  // ── Request notification permission ─────────────────────────────────────
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(p => setNotifPerm(p));
    }
    return () => { clearInterval(titleTimer.current); document.title = originalTitle.current; };
  }, []); // eslint-disable-line

  // ── New message notifications ────────────────────────────────────────────
  useEffect(() => {
    let unread = 0;
    safe.forEach(chat => {
      const isMember = (chat.members || []).includes(currentUser) || chat.type === 'channel';
      if (!isMember) return;
      (chat.messages || []).forEach(msg => {
        if (msg.sender === currentUser || msg.deleted) return;
        if (seenMsgIds.current.has(msg.id)) {
          if (chat.id !== selectedChat) unread++;
          return;
        }
        seenMsgIds.current.add(msg.id);
        if (chat.id === selectedChat) return;
        unread++;
        const senderName = users.find(u => u.id === msg.sender)?.name || msg.sender;
        const chanName = chat.type === 'channel' ? `#${chat.name}` : senderName;
        const preview = (msg.content || '').slice(0, 60);
        if (notifPerm === 'granted') {
          try {
            const n = new Notification(`${senderName} in ${chanName}`, { body: preview, icon: '/favicon.ico', tag: msg.id });
            n.onclick = () => { window.focus(); selectChat(chat.id); n.close(); };
          } catch (_) {}
        }
        const tid = 'toast-' + msg.id;
        setToasts(p => [...p.slice(-3), { id: tid, chatId: chat.id, channel: chanName, sender: senderName, body: preview }]);
        setTimeout(() => setToasts(p => p.filter(t => t.id !== tid)), 6000);
      });
    });
    // Tab title flash
    clearInterval(titleTimer.current);
    if (unread > 0) {
      let f = false;
      titleTimer.current = setInterval(() => {
        document.title = f ? `(${unread}) 💬 CRO` : originalTitle.current; f = !f;
      }, 1500);
    } else {
      document.title = originalTitle.current;
    }
  }, [whatsappChats]); // eslint-disable-line

  // ── Auto-select first channel ────────────────────────────────────────────
  useEffect(() => {
    if (!selectedChat && safe.length > 0) selectChat(safe[0].id);
  }, [safe.length]); // eslint-disable-line

  // ── Scroll to bottom ─────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedChat, (safe.find(c => c.id === selectedChat)?.messages || []).length]);

  // ── Persist to Drive ────────────────────────────────────────────────────
  const persist = useCallback((next) => {
    const chats = Array.isArray(next) ? next : next.chats;
    const payload = { _rev: Date.now(), chats };
    lastRevRef.current = payload._rev;
    setWhatsappChats(chats);
    if (driveToken) {
      setSyncStatus('saving');
      chatWriteJson(driveToken, 'whatsappChats.json', payload, chatFileId)
        .then(() => { setSyncStatus('saved'); setTimeout(() => setSyncStatus(''), 2000); })
        .catch(() => { setSyncStatus('error'); setTimeout(() => setSyncStatus(''), 3000); });
    }
  }, [driveToken, setWhatsappChats]);

  // ── selectChat ───────────────────────────────────────────────────────────
  const selectChat = (id) => {
    setSelectedChat(id);
    setThreadOpen(null);
    setEmojiPicker(null);
    const chat = safe.find(c => c.id === id);
    if (chat) {
      (chat.messages || []).forEach(m => {
        seenMsgIds.current.add(m.id);
        (m.thread || []).forEach(r => seenMsgIds.current.add(r.id));
      });
    }
  };

  // ── sendMsg ──────────────────────────────────────────────────────────────
  const sendMsg = (isThread = false) => {
    const text = isThread ? threadDraft : draft;
    if (!text.trim() || !selectedChat) return;
    const msg = {
      id: 'msg-' + Date.now(),
      sender: currentUser,
      content: text.trim(),
      timestamp: new Date().toISOString(),
      reactions: {},
      thread: [],
    };
    seenMsgIds.current.add(msg.id);
    const next = safe.map(c => {
      if (c.id !== selectedChat) return c;
      if (isThread && threadOpen) {
        return { ...c, messages: c.messages.map(m => m.id === threadOpen ? { ...m, thread: [...(m.thread || []), msg] } : m) };
      }
      return { ...c, messages: [...(c.messages || []), msg] };
    });
    persist(next);
    isThread ? setThreadDraft('') : setDraft('');
    // Bump presence on send
    writePresence();
  };

  const deleteMsg = (msgId) => {
    if (!window.confirm('Delete this message?')) return;
    persist(safe.map(c => c.id !== selectedChat ? c : {
      ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, deleted: true, content: '[deleted]' } : m)
    }));
  };

  const saveEdit = (msgId) => {
    if (!editContent.trim()) return;
    persist(safe.map(c => c.id !== selectedChat ? c : {
      ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, content: editContent.trim(), edited: true } : m)
    }));
    setEditMsgId(null);
  };

  const toggleReaction = (msgId, emoji) => {
    persist(safe.map(c => {
      if (c.id !== selectedChat) return c;
      return { ...c, messages: c.messages.map(m => {
        if (m.id !== msgId) return m;
        const r = { ...(m.reactions || {}) };
        const who = r[emoji] || [];
        r[emoji] = who.includes(currentUser) ? who.filter(u => u !== currentUser) : [...who, currentUser];
        if (r[emoji].length === 0) delete r[emoji];
        return { ...m, reactions: r };
      })};
    }));
    setEmojiPicker(null);
  };

  const togglePin = (msgId) => {
    persist(safe.map(c => {
      if (c.id !== selectedChat) return c;
      const pinned = (c.pinned || []).includes(msgId) ? (c.pinned || []).filter(id => id !== msgId) : [...(c.pinned || []), msgId];
      return { ...c, pinned };
    }));
  };

  const createNew = () => {
    if (newForm.type === 'channel' && !newForm.name.trim()) return;
    const id = 'chat-' + Date.now();
    const chat = {
      id, type: newForm.type,
      name: newForm.type === 'channel'
        ? newForm.name.trim().toLowerCase().replace(/\s+/g, '-')
        : (users.find(u => u.id === newForm.members[0])?.name || 'DM'),
      topic: newForm.topic,
      createdBy: currentUser,
      created: new Date().toISOString(),
      members: [...new Set([...newForm.members, currentUser])],
      pinned: [], messages: [],
    };
    persist([...safe, chat]);
    selectChat(id);
    setShowNew(false);
    setNewForm({ type: 'channel', name: '', topic: '', members: [] });
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getUser  = (uid) => users.find(x => x.id === uid);
  const getName  = (uid) => getUser(uid)?.name || uid;
  const unreadCount = (chat) => (chat.messages || []).filter(m => m.sender !== currentUser && !m.deleted && !seenMsgIds.current.has(m.id)).length;

  const visibleMsgs = (current?.messages || []).filter(m =>
    !search || (m.content || '').toLowerCase().includes(search.toLowerCase())
  );

  // Group messages by date for separators
  const msgGroups = [];
  let lastDate = '';
  visibleMsgs.forEach(msg => {
    const d = new Date(msg.timestamp).toDateString();
    if (d !== lastDate) { msgGroups.push({ type: 'date', label: fmtDate(msg.timestamp), id: 'date-' + msg.timestamp }); lastDate = d; }
    msgGroups.push({ type: 'msg', msg });
  });

  // ── Message bubble ────────────────────────────────────────────────────────
  const MsgBubble = ({ msg, inThread = false }) => {
    const [hovered, setHovered] = useState(false);
    const sender   = getUser(msg.sender);
    const isOwn    = msg.sender === currentUser;
    const canEdit  = isOwn && !msg.deleted;
    const canDel   = (isOwn || isManager) && !msg.deleted;
    const isPinned = (current?.pinned || []).includes(msg.id);
    const threadCount = (msg.thread || []).length;
    const pres = getPresenceStatus(msg.sender);

    // Group consecutive messages from same sender (compact mode)
    const msgList = inThread ? (current?.messages?.find(m => m.id === threadOpen)?.thread || []) : visibleMsgs;
    const myIdx   = msgList.indexOf(msg);
    const prevMsg = msgList[myIdx - 1];
    const compact = prevMsg && prevMsg.sender === msg.sender &&
      !prevMsg.deleted &&
      (new Date(msg.timestamp) - new Date(prevMsg.timestamp)) < 5 * 60 * 1000;

    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); }}
        style={{
          display: 'flex', gap: 10, padding: compact ? '1px 20px 1px' : '6px 20px 1px',
          marginTop: compact ? 0 : 8,
          background: hovered ? 'rgba(255,255,255,0.03)' : isPinned ? 'rgba(0,194,255,0.04)' : 'transparent',
          borderLeft: isPinned ? '2px solid var(--accent)' : '2px solid transparent',
          position: 'relative',
          transition: 'background .1s',
        }}
      >
        {/* Avatar col */}
        <div style={{ width: 36, flexShrink: 0 }}>
          {!compact
            ? <Avatar user={sender || { avatar: '?', color: '#475569' }} size={36} presence={pres} />
            : hovered
              ? <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'DM Mono', lineHeight: '36px', display: 'block', textAlign: 'right' }}>
                  {fmtTime(msg.timestamp)}
                </span>
              : null
          }
        </div>

        {/* Content col */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header: name + timestamp (only for non-compact) */}
          {!compact && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5, color: isOwn ? 'var(--accent)' : '#fff' }}>
                {getName(msg.sender)}
              </span>
              {isOwn && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'rgba(0,194,255,0.08)', borderRadius: 3, padding: '0 4px' }}>you</span>}
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', fontFamily: 'DM Mono' }}>
                {fmtTime(msg.timestamp)}
              </span>
              {msg.edited && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>(edited)</span>}
              {isPinned && <span style={{ fontSize: 10, color: 'var(--accent)' }}>📌</span>}
            </div>
          )}

          {/* Content */}
          {editMsgId === msg.id ? (
            <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
              <input value={editContent} onChange={e => setEditContent(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(msg.id); if (e.key === 'Escape') setEditMsgId(null); }}
                autoFocus
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(0,194,255,0.4)',
                  borderRadius: 7, color: '#fff', fontSize: 13, padding: '6px 10px', outline: 'none',
                  fontFamily: 'DM Sans, sans-serif',
                }}
              />
              <button onClick={() => saveEdit(msg.id)} style={btnStylePrimary}>Save</button>
              <button onClick={() => setEditMsgId(null)} style={btnStyleGhost}>Esc</button>
            </div>
          ) : (
            <div style={{
              fontSize: 13.5, color: msg.deleted ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.85)',
              lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
              fontStyle: msg.deleted ? 'italic' : 'normal',
            }}>
              {(msg.content || '').split(/(@\w[\w.]*)/g).map((part, i) =>
                part.startsWith('@')
                  ? <span key={i} style={{ color: '#60a5fa', background: 'rgba(59,130,246,0.12)', borderRadius: 3, padding: '0 2px', fontWeight: 600 }}>{part}</span>
                  : part
              )}
            </div>
          )}

          {/* Reactions */}
          {Object.keys(msg.reactions || {}).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
              {Object.entries(msg.reactions || {}).map(([emoji, who]) => (
                <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                  borderRadius: 12, border: '1px solid',
                  background: who.includes(currentUser) ? 'rgba(0,194,255,0.15)' : 'rgba(255,255,255,0.06)',
                  borderColor: who.includes(currentUser) ? 'rgba(0,194,255,0.4)' : 'rgba(255,255,255,0.1)',
                  color: who.includes(currentUser) ? 'var(--accent)' : 'rgba(255,255,255,0.6)',
                  fontSize: 13, cursor: 'pointer', transition: 'all .15s',
                }}>
                  <span>{emoji}</span>
                  <span style={{ fontSize: 11, fontFamily: 'DM Mono', fontWeight: 600 }}>{who.length}</span>
                </button>
              ))}
            </div>
          )}

          {/* Thread preview */}
          {!inThread && threadCount > 0 && threadOpen !== msg.id && (
            <button onClick={() => setThreadOpen(msg.id)} style={{
              marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
              color: '#60a5fa', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
              borderRadius: 6, padding: '4px 10px', cursor: 'pointer', transition: 'background .15s',
            }}>
              <div style={{ display: 'flex', gap: -4 }}>
                {[...new Set((msg.thread || []).map(r => r.sender))].slice(0, 3).map(uid => {
                  const tu = getUser(uid);
                  return tu ? <div key={uid} style={{ width: 16, height: 16, borderRadius: 4, background: tu.color || '#1d4ed8', fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, marginRight: 2 }}>{tu.avatar || tu.name?.slice(0,1)}</div> : null;
                })}
              </div>
              <span>{threadCount} {threadCount === 1 ? 'reply' : 'replies'}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>Last reply {fmtTime((msg.thread || []).slice(-1)[0]?.timestamp || msg.timestamp)}</span>
            </button>
          )}
        </div>

        {/* Hover action bar — appears top-right like Slack */}
        {hovered && !msg.deleted && !editMsgId && (
          <div style={{
            position: 'absolute', right: 16, top: -14,
            display: 'flex', gap: 2, alignItems: 'center',
            background: '#2b2d31', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '3px 5px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            zIndex: 100,
          }}>
            {/* Quick emoji reactions */}
            {['👍','❤️','😂','✅'].map(e => (
              <button key={e} onClick={() => toggleReaction(msg.id, e)}
                title={e}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 15, padding: '2px 4px', borderRadius: 4, transition: 'background .1s' }}
                onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}
              >{e}</button>
            ))}
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }}/>
            {/* More emoji */}
            <button title="Add reaction" onClick={() => setEmojiPicker(emojiPicker === msg.id ? null : msg.id)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 5px', borderRadius: 4, color: 'rgba(255,255,255,0.5)' }}
              onMouseEnter={ev => ev.currentTarget.style.color = '#fff'}
              onMouseLeave={ev => ev.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
            >😊+</button>
            {!inThread && (
              <button title="Reply in thread" onClick={() => setThreadOpen(threadOpen === msg.id ? null : msg.id)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 5px', borderRadius: 4, color: 'rgba(255,255,255,0.5)' }}
                onMouseEnter={ev => ev.currentTarget.style.color = '#fff'}
                onMouseLeave={ev => ev.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
              >💬</button>
            )}
            {canEdit && (
              <button title="Edit message" onClick={() => { setEditMsgId(msg.id); setEditContent(msg.content); }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 5px', borderRadius: 4, color: 'rgba(255,255,255,0.5)' }}
                onMouseEnter={ev => ev.currentTarget.style.color = '#fff'}
                onMouseLeave={ev => ev.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
              >✏</button>
            )}
            {isManager && (
              <button title={isPinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(msg.id)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 5px', borderRadius: 4, color: isPinned ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}
                onMouseEnter={ev => ev.currentTarget.style.color = '#fff'}
                onMouseLeave={ev => ev.currentTarget.style.color = isPinned ? 'var(--accent)' : 'rgba(255,255,255,0.5)'}
              >📌</button>
            )}
            {canDel && (
              <button title="Delete" onClick={() => deleteMsg(msg.id)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 5px', borderRadius: 4, color: 'rgba(239,68,68,0.5)' }}
                onMouseEnter={ev => ev.currentTarget.style.color = '#f87171'}
                onMouseLeave={ev => ev.currentTarget.style.color = 'rgba(239,68,68,0.5)'}
              >🗑</button>
            )}
          </div>
        )}

        {/* Emoji picker floating panel */}
        {emojiPicker === msg.id && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 46, zIndex: 200,
            background: '#2b2d31', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, padding: 8, display: 'flex', flexWrap: 'wrap', gap: 2, width: 220,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}>
            {EMOJIS.map(e => (
              <button key={e} onClick={() => toggleReaction(msg.id, e)} style={{
                fontSize: 18, background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '4px', borderRadius: 5, transition: 'background .1s',
              }}
                onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}
              >{e}</button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Sidebar channel row ────────────────────────────────────────────────────
  const SidebarRow = ({ chat }) => {
    const isActive = selectedChat === chat.id;
    const isDM = chat.type === 'dm';
    const dmOtherUid = isDM ? (chat.members || []).find(m => m !== currentUser) : null;
    const dmOther = dmOtherUid ? getUser(dmOtherUid) : null;
    const unread = unreadCount(chat);
    const pres = dmOtherUid ? getPresenceStatus(dmOtherUid) : 'offline';

    return (
      <div onClick={() => selectChat(chat.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
          background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
          color: isActive ? '#fff' : unread > 0 ? '#fff' : 'rgba(255,255,255,0.55)',
          transition: 'background .12s',
          marginBottom: 1,
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
      >
        {isDM ? (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              width: 20, height: 20, borderRadius: 5,
              background: dmOther?.color || '#475569',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, color: '#fff',
            }}>{dmOther?.avatar || dmOtherUid?.slice(0, 2) || '?'}</div>
            <span style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 7, height: 7, borderRadius: '50%',
              background: pres === 'online' ? '#23a55a' : pres === 'away' ? '#f0b232' : '#6b7280',
              border: '1.5px solid #1a1d21',
            }} />
          </div>
        ) : (
          <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0, color: 'rgba(255,255,255,0.35)' }}>#</span>
        )}
        <span style={{
          flex: 1, fontSize: 13, fontWeight: unread > 0 ? 700 : isActive ? 500 : 400,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {isDM ? (dmOther?.name || dmOtherUid || 'Unknown') : chat.name}
        </span>
        {unread > 0 && !isActive && (
          <span style={{
            fontSize: 10, fontFamily: 'DM Mono', fontWeight: 700,
            background: '#e43d45', color: '#fff', borderRadius: 10, padding: '1px 6px', flexShrink: 0,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </div>
    );
  };

  // ── Button styles ──────────────────────────────────────────────────────────
  const btnStylePrimary = {
    background: 'var(--accent)', border: 'none', borderRadius: 6,
    padding: '5px 12px', cursor: 'pointer', color: '#000', fontWeight: 700, fontSize: 12,
  };
  const btnStyleGhost = {
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: 'rgba(255,255,255,0.55)', fontSize: 12,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative' }}>

      {/* Toasts */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        {toasts.map(toast => (
          <div key={toast.id} onClick={() => { selectChat(toast.chatId); setToasts(p => p.filter(t => t.id !== toast.id)); }}
            style={{
              pointerEvents: 'all', cursor: 'pointer',
              background: 'rgba(14,21,37,0.92)', backdropFilter: 'blur(20px)',
              border: '1px solid rgba(0,194,255,0.2)', borderLeft: '3px solid var(--accent)',
              borderRadius: 12, padding: '12px 14px', maxWidth: 320, minWidth: 220,
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
              animation: 'toastIn .35s cubic-bezier(.34,1.4,.64,1)',
            }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>{toast.channel}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{toast.sender}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{toast.body}</div>
          </div>
        ))}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '260px 1fr', gap: 0,
        height: 'calc(100vh - 140px)', minHeight: 520,
        borderRadius: 12, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
      }}>

        {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
        <div style={S.sidebar}>

          {/* Workspace header */}
          <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: '-0.3px', marginBottom: 4 }}>
              ☁ CloudOps
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <PresenceDot status="online" size={7} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'DM Mono' }}>
                {onlineCount} online · {users.length} total
              </span>
            </div>
          </div>

          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search messages…"
              style={{
                width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 7, color: '#fff', fontSize: 12, padding: '6px 10px', outline: 'none',
                fontFamily: 'DM Sans, sans-serif',
              }}
            />
          </div>

          {/* Channel + DM lists */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 6px' }}>

            {/* Channels section */}
            <div style={{ padding: '4px 8px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Channels</span>
              {isManager && (
                <button title="New channel" onClick={() => { setShowNew(true); setNewForm({ type: 'channel', name: '', topic: '', members: users.map(u => u.id) }); }}
                  style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', transition: 'color .15s' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
                >+</button>
              )}
            </div>
            {channels.map(c => <SidebarRow key={c.id} chat={c} />)}

            {/* DMs section */}
            <div style={{ padding: '12px 8px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Direct Messages</span>
              <button title="New DM" onClick={() => { setShowNew(true); setNewForm({ type: 'dm', name: '', topic: '', members: [] }); }}
                style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', transition: 'color .15s' }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
              >+</button>
            </div>
            {dms.length === 0 && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', padding: '4px 10px' }}>No direct messages</div>}
            {dms.map(c => <SidebarRow key={c.id} chat={c} />)}

            {/* Online members */}
            <div style={{ padding: '16px 8px 6px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Team</span>
            </div>
            {users.map(u => {
              const pres = getPresenceStatus(u.id);
              return (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 6, marginBottom: 1 }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ width: 20, height: 20, borderRadius: 5, background: u.color || '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff' }}>{u.avatar || u.name?.slice(0, 2)}</div>
                    <span style={{ position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, borderRadius: '50%', background: pres === 'online' ? '#23a55a' : pres === 'away' ? '#f0b232' : '#6b7280', border: '1.5px solid #1a1d21' }} />
                  </div>
                  <span style={{ fontSize: 12, color: pres === 'offline' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.65)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.name} {u.id === currentUser ? <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>(you)</span> : ''}
                  </span>
                  <span style={{ fontSize: 10, color: pres === 'online' ? '#23a55a' : pres === 'away' ? '#f0b232' : 'rgba(255,255,255,0.2)' }}>
                    {pres}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Footer: drive status */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontFamily: 'DM Mono', color: 'rgba(255,255,255,0.3)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: driveToken ? '#23a55a' : '#6b7280', flexShrink: 0 }} />
              {driveToken
                ? syncStatus === 'saving' ? '⟳ Saving…'
                : syncStatus === 'saved'  ? '✓ Saved to Drive'
                : syncStatus === 'error'  ? '⚠ Save failed'
                : 'Connected to Drive'
                : 'Drive offline'}
            </div>
            {notifPerm === 'default' && (
              <button onClick={() => Notification.requestPermission().then(p => setNotifPerm(p))}
                style={{ marginTop: 5, width: '100%', padding: '4px', fontSize: 10, background: 'rgba(0,194,255,0.08)', border: '1px solid rgba(0,194,255,0.2)', borderRadius: 5, cursor: 'pointer', color: 'var(--accent)' }}>
                Enable notifications
              </button>
            )}
          </div>
        </div>

        {/* ── MAIN CHAT AREA ────────────────────────────────────────────────── */}
        {current ? (
          <div style={S.main}>

            {/* Channel header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px',
              height: 52, borderBottom: '1px solid rgba(255,255,255,0.07)',
              background: '#1e2124', flexShrink: 0,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>
                    {current.type === 'channel' ? `# ${current.name}` : getName(current.members.find(m => m !== currentUser) || '')}
                  </span>
                  {current.type === 'dm' && (
                    <PresenceDot status={getPresenceStatus(current.members.find(m => m !== currentUser) || '')} />
                  )}
                </div>
                {current.topic && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                    {current.topic}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={() => setShowMembers(v => !v)} title="Members"
                  style={{ ...btnStyleGhost, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
                  👥 {(current.members || []).length}
                </button>
                <button onClick={() => setShowPinned(v => !v)} title="Pinned"
                  style={{ ...btnStyleGhost, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, color: (current.pinned || []).length > 0 ? 'var(--accent)' : 'rgba(255,255,255,0.4)' }}>
                  📌 {(current.pinned || []).length}
                </button>
                {isManager && (
                  <button onClick={() => { if (window.confirm('Delete this channel?')) { persist(safe.filter(c => c.id !== selectedChat)); setSelectedChat(null); }}}
                    style={{ background: 'transparent', border: 'none', color: 'rgba(239,68,68,0.4)', fontSize: 13, cursor: 'pointer', padding: '4px 6px', borderRadius: 5 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.4)'}
                  >🗑</button>
                )}
              </div>
            </div>

            {/* Pinned panel */}
            {showPinned && (current.pinned || []).length > 0 && (
              <div style={{ padding: '8px 16px', background: 'rgba(0,194,255,0.04)', borderBottom: '1px solid rgba(0,194,255,0.12)', maxHeight: 130, overflowY: 'auto', flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>📌 Pinned</div>
                {(current.messages || []).filter(m => (current.pinned || []).includes(m.id)).map(m => (
                  <div key={m.id} style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{getName(m.sender)}</strong>: {(m.content || '').slice(0, 100)}{(m.content || '').length > 100 ? '…' : ''}
                  </div>
                ))}
              </div>
            )}

            {/* Members panel */}
            {showMembers && (
              <div style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {(current.members || []).map(uid => {
                    const mu = getUser(uid);
                    const pres = getPresenceStatus(uid);
                    return mu ? (
                      <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                        <Avatar user={mu} size={20} presence={pres} />
                        {mu.name}
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            )}

            {/* Messages + Thread */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

              {/* Messages */}
              <div style={S.msgArea}>
                {visibleMsgs.length === 0 && (
                  <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: '40px 0' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>{current.type === 'channel' ? '#️⃣' : '💬'}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>
                      {search ? `No results for "${search}"` : current.type === 'channel' ? `Welcome to #${current.name}` : `Your DM with ${getName(current.members.find(m => m !== currentUser) || '')}`}
                    </div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)' }}>
                      {search ? 'Try a different search term' : 'Send a message to get started'}
                    </div>
                  </div>
                )}
                {msgGroups.map(item =>
                  item.type === 'date' ? (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 20px 8px', flexShrink: 0 }}>
                      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 600, whiteSpace: 'nowrap', background: '#1e2124', padding: '0 8px' }}>{item.label}</span>
                      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                    </div>
                  ) : (
                    <MsgBubble key={item.msg.id} msg={item.msg} />
                  )
                )}
                <div ref={messagesEndRef} style={{ height: 8 }} />
              </div>

              {/* Thread panel */}
              {threadOpen && (() => {
                const parent = (current.messages || []).find(m => m.id === threadOpen);
                if (!parent) return null;
                return (
                  <div style={{
                    width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
                    background: '#1a1d21', borderLeft: '1px solid rgba(255,255,255,0.07)',
                  }}>
                    <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Thread</span>
                      <button onClick={() => setThreadOpen(null)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 18 }}>✕</button>
                    </div>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
                      <MsgBubble msg={parent} inThread={true} />
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                      {(parent.thread || []).length === 0
                        ? <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, textAlign: 'center', marginTop: 20 }}>No replies yet</div>
                        : (parent.thread || []).map(r => <MsgBubble key={r.id} msg={r} inThread={true} />)
                      }
                    </div>
                    <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Avatar user={getUser(currentUser) || { avatar: '?', color: '#475569' }} size={28} presence="online" />
                        <input ref={inputRef} value={threadDraft} onChange={e => setThreadDraft(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMsg(true)}
                          placeholder="Reply in thread…"
                          style={{
                            flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 8, color: '#fff', fontSize: 13, padding: '8px 12px', outline: 'none',
                          }}
                        />
                        <button onClick={() => sendMsg(true)} disabled={!threadDraft.trim()} style={{ ...btnStylePrimary, opacity: threadDraft.trim() ? 1 : 0.4 }}>↵</button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Message input bar */}
            <div style={{ padding: '12px 16px 14px', borderTop: '1px solid rgba(255,255,255,0.07)', background: '#1e2124', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <Avatar user={getUser(currentUser) || { avatar: '?', color: '#475569' }} size={32} presence="online" />
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'flex-end',
                  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, overflow: 'hidden', transition: 'border-color .15s',
                }}
                  onFocusCapture={e => e.currentTarget.style.borderColor = 'rgba(0,194,255,0.4)'}
                  onBlurCapture={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
                >
                  <textarea value={draft} onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }}}
                    placeholder={`Message ${current.type === 'channel' ? `#${current.name}` : getName(current.members.find(m => m !== currentUser) || '')} — Shift+Enter for new line`}
                    style={{
                      flex: 1, background: 'transparent', border: 'none', color: '#fff',
                      fontSize: 13.5, padding: '10px 14px', resize: 'none', outline: 'none',
                      minHeight: 42, maxHeight: 140, lineHeight: 1.5,
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  />
                  <button onClick={sendMsg} disabled={!draft.trim()}
                    style={{
                      background: draft.trim() ? 'var(--accent)' : 'transparent',
                      border: 'none', borderRadius: 7, margin: '6px 8px',
                      padding: '6px 12px', cursor: draft.trim() ? 'pointer' : 'default',
                      color: draft.trim() ? '#000' : 'rgba(255,255,255,0.2)',
                      fontWeight: 700, fontSize: 14, transition: 'all .15s', flexShrink: 0,
                      alignSelf: 'flex-end',
                    }}
                  >↵</button>
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 6, marginLeft: 42 }}>
                Enter to send · Shift+Enter for new line · @ to mention
              </div>
            </div>
          </div>
        ) : (
          <div style={{ ...S.main, alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Select a channel or DM to start</div>
            </div>
          </div>
        )}
      </div>

      {/* ── New Channel / DM Modal ─────────────────────────────────────────── */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1e2124', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 24, width: 440, boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 18 }}>
              {newForm.type === 'channel' ? '# Create a channel' : '💬 New direct message'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              {[{ v: 'channel', l: '# Channel' }, { v: 'dm', l: '💬 Direct Message' }].map(({ v, l }) => (
                <button key={v} onClick={() => setNewForm(f => ({ ...f, type: v }))} style={{
                  flex: 1, padding: '7px', borderRadius: 8, border: '1px solid',
                  background: newForm.type === v ? 'rgba(0,194,255,0.12)' : 'transparent',
                  borderColor: newForm.type === v ? 'rgba(0,194,255,0.4)' : 'rgba(255,255,255,0.1)',
                  color: newForm.type === v ? 'var(--accent)' : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 13,
                }}>{l}</button>
              ))}
            </div>
            {newForm.type === 'channel' && (
              <>
                <input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="channel-name (lowercase, no spaces)"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 13, padding: '9px 12px', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
                />
                <input value={newForm.topic} onChange={e => setNewForm(f => ({ ...f, topic: e.target.value }))}
                  placeholder="Channel purpose (optional)"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 13, padding: '9px 12px', outline: 'none', marginBottom: 14, boxSizing: 'border-box' }}
                />
              </>
            )}
            {newForm.type === 'dm' && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Select a team member</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                  {users.filter(u => u.id !== currentUser).map(u => {
                    const sel = newForm.members.includes(u.id);
                    const pres = getPresenceStatus(u.id);
                    return (
                      <div key={u.id} onClick={() => setNewForm(f => ({ ...f, members: sel ? f.members.filter(id => id !== u.id) : [u.id] }))}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: sel ? 'rgba(0,194,255,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${sel ? 'rgba(0,194,255,0.3)' : 'transparent'}` }}>
                        <Avatar user={u} size={28} presence={pres} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{u.name}</div>
                          <div style={{ fontSize: 10, color: pres === 'online' ? '#23a55a' : 'rgba(255,255,255,0.3)' }}>{pres}</div>
                        </div>
                        {sel && <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 16 }}>✓</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNew(false)} style={btnStyleGhost}>Cancel</button>
              <button onClick={createNew} style={{ ...btnStylePrimary, padding: '8px 20px' }}>
                {newForm.type === 'channel' ? 'Create Channel' : 'Start DM'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes toastIn { from { opacity:0; transform:translateX(60px) scale(.9); } to { opacity:1; transform:none; } }
      `}</style>
    </div>
  );
}
