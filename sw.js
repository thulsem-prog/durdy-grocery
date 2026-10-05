// Durdy Grocery service worker: caches the app so it runs fully offline.
// When you change any app file, bump CACHE_VERSION so phones pick up the update.
const CACHE_VERSION = 'durdy-v1';

const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Try the network first (so updates show up right away), but fall back to the
// cached copy if offline or the connection is slow (e.g. inside the store).
const NETWORK_TIMEOUT_MS = 2500;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const cacheKey = req.mode === 'navigate' ? './index.html' : req;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) cache.put(cacheKey, res.clone());
      return res;
    });
    event.waitUntil(network.catch(() => null));
    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch (e) { /* offline */ }
    const cached = await cache.match(cacheKey, { ignoreSearch: true });
    if (cached) return cached;
    try { return await network; } catch (e) {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
