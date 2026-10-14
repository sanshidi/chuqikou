/* 出气口 — offline cache, local-only app shell */
const CACHE = 'chuqikou-v7';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './styles-games.css',
  './js/app.js',
  './js/game-core.js',
  './js/games.js',
  './js/pool.js',
  './js/extras.js',
  './js/pitch.js',
  './js/companion.js',
  './js/games/bag.js',
  './js/games/bubble.js',
  './js/games/plates.js',
  './js/games/rage.js',
  './js/games/squeeze.js',
  './js/games/muyu.js',
  './games/bag.html',
  './games/bubble.html',
  './games/plates.html',
  './games/rage.html',
  './games/squeeze.html',
  './games/muyu.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // JS/CSS/HTML: network-first so Pages deploys are not stuck on old SW cache
  const netFirst = /\.(js|css|html|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (netFirst) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
