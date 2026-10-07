// Modul IndexedDB untuk halaman utama
const DB_NAME = 'aipicture_db';
const DB_VERSION = 1;
const STORE = 'media';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date');
        store.createIndex('type', 'type');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Simpan file (Blob) — bukan base64!
async function simpanMedia(file) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({
      name: file.name,
      type: file.type,
      blob: file,
      thumbBlob: null,
      date: Date.now()
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Ambil semua media, urut dari terbaru
async function ambilSemuaMedia() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('date').getAll();
    req.onsuccess = () => resolve(req.result.reverse()); // terbaru dulu
    req.onerror = () => reject(req.error);
  });
}

// Hapus 1 media
async function hapusMedia(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Update nama
async function ubahNamaMedia(id, namaBaru) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result;
      item.name = namaBaru;
      store.put(item);
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

// Simpan thumbnail (nanti diisi WASM)
async function simpanThumbnail(id, thumbBlob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result;
      item.thumbBlob = thumbBlob;
      store.put(item);
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

// Buat URL sementara dari Blob (auto-cleanup)
function blobUrl(blob) {
  return URL.createObjectURL(blob);
    }
