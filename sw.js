// オフラインでも開けるようにアプリ本体をキャッシュ（データは IndexedDB）
const CACHE = 'okane-navi-v3';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/fonts.css', 'css/style.css',
  'js/app.js', 'js/db.js', 'js/csv.js', 'js/importers.js', 'js/rules.js', 'js/finance.js', 'js/charts.js', 'js/util.js', 'js/sample.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// ネットワーク優先（更新をすぐ反映）、オフライン時はキャッシュ
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
