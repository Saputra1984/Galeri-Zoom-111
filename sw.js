const CACHE_NAME = 'galerizoom-v2';
const CORE = [
    './',
    './index.html',
    './db.js',
    './zoom_wasm.js',
    './zoom_wasm.wasm',
    './manifest.json',
    './icon-galeri-192.png',
    './icon-galeri-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((c) =>
            Promise.allSettled(CORE.map((f) => c.add(f)))
        )
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(Promise.all([
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ),
        self.clients.claim()
    ]));
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
        event.respondWith(handleShare(event.request));
        return;
    }

    if (event.request.method !== 'GET') return;
    if (url.origin !== self.location.origin) return;

    const isDocument = event.request.mode === 'navigate'
                    || url.pathname.endsWith('.html')
                    || url.pathname.endsWith('.js');

    if (isDocument) {
        event.respondWith(
            fetch(event.request).then((res) => {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
                return res;
            }).catch(() =>
                caches.match(event.request).then((c) => c || caches.match('./index.html'))
            )
        );
    } else {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
                    return res;
                });
            })
        );
    }
});

async function handleShare(request) {
    const url = new URL(request.url);
    const basePath = url.pathname.replace(/\/share-target$/, ''); // "" atau "/subdir"
    const redirect = (status) =>
        Response.redirect(new URL(`${basePath}/index.html?shared=${status}`, self.location.origin).href, 303);

    try {
        const formData = await request.formData();
        const files = formData.getAll('media');
        if (files.length === 0) return redirect('empty');

        const db = await openDB();
        for (const file of files) {
            await addMedia(db, {
                name: file.name || 'shared_' + Date.now(),
                type: file.type || 'application/octet-stream',
                blob: file,
                thumbBlob: null,
                isVideo: file.type && file.type.startsWith('video/'),
                needsThumb: !!(file.type && file.type.startsWith('video/')),
                date: Date.now()
            });
        }
        return redirect('ok');
    } catch (err) {
        console.error('Share target error:', err);
        return redirect('error');
    }
}

// ⚠️ Pakai DB yang SAMA dengan db.js
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('galerizoom_db', 1);  // ← disamakan
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
