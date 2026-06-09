const CACHE_NAME = 'galeri-mikro-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Pasang Cache ke dalam HP
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Jalankan Aplikasi secara murni Offline
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
