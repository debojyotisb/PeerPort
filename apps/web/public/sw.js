/**
 * PeerPort Service Worker (Application Shell Caching)
 *
 * Provides 100% offline startup availability for PeerPort.
 * Caches HTML, JS, CSS, fonts, and SVG assets so the app opens instantly
 * without an active internet connection.
 *
 * Sensitive transferred files are stored strictly in IndexedDB
 * and are NEVER cached by this Service Worker.
 */

const CACHE_NAME = 'peerport-shell-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/lightning.svg'
];

// Install: Cache critical App Shell assets immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: Clean up any outdated caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: Offline-first strategy for App Shell
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Ignore cross-origin WebSocket upgrades or signaling endpoints
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Navigation requests (HTML documents): Network-first with Cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          // Offline fallback: Serve cached App Shell
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('/index.html');
          if (fallback) return fallback;
          return caches.match('/');
        })
    );
    return;
  }

  // Static Assets (JS, CSS, SVGs, Fonts): Cache-first with Network fallback
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.woff2') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.ico'))
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      })
    );
  }
});

