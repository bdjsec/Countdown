/* Offline support.
 *
 * All the arithmetic runs in the page and all the settings live in the
 * browser, so once the shell is cached the board genuinely works with no
 * network - on a plane, on the subway, on a phone in airplane mode.
 *
 * Bump CACHE whenever you change a file in SHELL. Old caches are deleted on
 * activate, and the new worker takes over immediately rather than waiting for
 * every tab to close - a stale board that won't update is a confusing first
 * bug to hit, and the app is small enough that an instant swap costs nothing.
 */

const CACHE = 'countdown-v1';

/* Relative paths, resolved against the worker's own scope, so this works
 * unchanged at example.github.io/Countdown/ and at a domain root. */
const SHELL = [
  './',
  './index.html',
  './app.css',
  './js/main.js',
  './js/counters.js',
  './js/flap.js',
  './js/config.js',
  './js/settings.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // addAll is all-or-nothing; one 404 would leave the app uncached with no
    // visible error, so each file is added on its own and misses are skipped.
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((path) => cache.add(path).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Config and data go to the network first, so an edit to config.json or a
  // preset shows up on the next load rather than whenever the cache turns
  // over. They fall back to the cached copy when offline.
  const isData = /\.(json|webmanifest)$/.test(url.pathname);

  if (isData) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
