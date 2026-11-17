/*
 * LEXIA service worker — PWA-ready, online-first (FR-020, DEV-106).
 * Caches ONLY public static shell assets and the offline page. It never caches /app, /api, file downloads
 * or any authenticated response; confidential matter data and Lawyer DNA samples are never stored offline.
 */
const CACHE = 'lexia-static-v1';
const PRECACHE = ['/offline', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function isStatic(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith('/_next/static/') || PRECACHE.includes(url.pathname));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/app') || url.pathname.startsWith('/api')) {
    // Network only. Offline navigation gets the generic offline page — never a cached private page.
    if (req.mode === 'navigate') e.respondWith(fetch(req).catch(() => caches.match('/offline')));
    return;
  }
  if (isStatic(url)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (req.mode === 'navigate') e.respondWith(fetch(req).catch(() => caches.match('/offline')));
});
