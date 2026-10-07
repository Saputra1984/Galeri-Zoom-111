const CACHE_NAME = 'aipicture-v1';
const CORE = ['./', './index.html', './db.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE)));
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Tangkap share target — pakai endsWith, bukan ===
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
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

    // Ambil base URL dari request supaya redirect relatif benar
    const url = new URL(request.url);
    // Path tanpa '/share-target' → ini base PWA
    const basePath = url.pathname.replace(/\/share-target$/, '') || '/';

    if (files.length === 0) {
      return Response.redirect(basePath + '/index.html?shared=empty', 303);
    }

    const db = await openDB();
    for (const file of files) {
      await addMedia(db, {
        name: file.name || 'shared_' + Date.now(),
        type: file.type,
        blob: file,
        thumbBlob: null,
        date: Date.now()
      });
    }

    return Response.redirect(basePath + '/index.html?shared=ok', 303);
  } catch (err) {
    console.error('Share target error:', err);
    const url = new URL(request.url);
    const basePath = url.pathname.replace(/\/share-target$/, '') || '/';
    return Response.redirect(basePath + '/index.html?shared=error', 303);
  }
}

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

function addMedia(db, item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const req = tx.objectStore('media').add(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
