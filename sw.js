const CACHE_NAME = 'ai-picture-galeri-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Pasang Cache ke dalam penyimpanan HP
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting()) // Paksa SW baru langsung aktif
  );
});

// Bersihkan cache usang saat ada pembaruan versi sw.js
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Jalankan Aplikasi secara murni Offline (Cache First)
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
