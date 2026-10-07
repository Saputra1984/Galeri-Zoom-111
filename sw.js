const CACHE_NAME = 'aipicture-v2';
const CORE = ['./', './index.html', './db.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(CORE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Tangkap share target (POST) — simpan file ke IndexedDB
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(handleShare(event.request));
    return;
  }

  // Cache-first untuk asset
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('media');

    if (files.length === 0) {
      return Response.redirect('/index.html?shared=empty', 303);
    }

    const db = await openDB();
    for (const file of files) {
      await db.add({
        name: file.name || 'shared_' + Date.now(),
        type: file.type,
        blob: file,
        date: Date.now()
      });
    }

    return Response.redirect('/index.html?shared=ok', 303);
  } catch (err) {
    console.error('Share target error:', err);
    return Response.redirect('/index.html?shared=error', 303);
  }
}

// IndexedDB helper (inline, karena SW tidak bisa import)
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aipicture_db', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('media')) {
        const store = db.createObjectStore('media', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date');
        store.createIndex('type', 'type');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
