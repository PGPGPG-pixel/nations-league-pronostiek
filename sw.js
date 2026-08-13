const CACHE_NAME = 'nl-pronostiek-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/firebase-config.js',
  '/fixtures.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // For navigation requests, try network first then fallback to cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(resp => {
        return resp;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For other requests, respond with cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(resp => {
      return resp;
    }))
  );
});
