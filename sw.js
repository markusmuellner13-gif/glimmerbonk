/* GLIMMERBONK service worker — network-first so deploys show up immediately */
const CACHE = 'glimmerbonk-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/config.js',
  './js/ui.js',
  './js/game.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: always try the live version, fall back to cache only when offline.
// This guarantees a freshly deployed build is served without needing a manual reload,
// while still working offline once assets have been cached.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(cached =>
        cached || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)
      )
    )
  );
});
