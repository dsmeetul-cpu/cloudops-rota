// src/InstallAppButton.js
// "Install App" button — mirrors the Claude Desktop-style install prompt.
// Uses the browser's native PWA install flow (beforeinstallprompt), so it
// only appears in Chromium browsers (Chrome/Edge/Brave) once the app meets
// installability criteria: HTTPS, a linked manifest.json, and a registered
// service worker (see public/manifest.json and public/service-worker.js).
// Firefox/Safari don't support this API, so the button simply never shows
// there — no extra handling needed.
import React, { useState, useEffect } from 'react';

export default function InstallAppButton({ style, compact = false }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(() =>
    (typeof window !== 'undefined') &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)
  );

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Nothing to show: already installed, or the browser hasn't offered (yet / ever)
  if (installed || !deferredPrompt) return null;

  const handleInstall = async () => {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <button
      onClick={handleInstall}
      title="Install CloudOps as a desktop app"
      className="btn btn-secondary btn-sm"
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)',
        color: '#38bdf8', fontWeight: 600,
        ...style,
      }}
    >
      <span style={{ fontSize: 14 }}>⬇️</span>
      {!compact && 'Install App'}
    </button>
  );
}
