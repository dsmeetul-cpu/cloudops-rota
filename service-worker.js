// public/service-worker.js
// Minimal service worker — Chromium browsers require an active, fetch-handling
// service worker (alongside a valid manifest) before they'll fire the
// `beforeinstallprompt` event that InstallAppButton.js listens for.
// This uses a simple network-first strategy with a tiny app-shell cache as a
// fallback. Expand the cache list / add offline routes here if you want
// real offline support later — this is intentionally minimal.

const CACHE_NAME = 'cloudops-shell-v1';
const APP_SHELL = ['/'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
