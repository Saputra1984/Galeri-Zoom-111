// Modul IndexedDB untuk halaman utama
const DB_NAME = 'galerizoom_db';
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

// ═══════════════════════════════════════════════
// VIDEO SUPPORT — Simpan video + thumbnail
// ═══════════════════════════════════════════════

const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 MB

// Generate thumbnail dari video (frame 0.1 detik)
function generateVideoThumbnail(videoFile) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(videoFile);
    video.src = url;

    video.onloadedmetadata = () => {
      // Seek ke 0.1 detik (hindari frame hitam di awal)
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 400 / video.videoWidth);
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (blob) resolve(blob);
            else reject(new Error('Gagal buat thumbnail'));
          },
          'image/jpeg',
          0.85
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Video tidak bisa dibaca'));
    };
  });
}

// Simpan video + thumbnail otomatis
async function simpanVideo(file) {
  const thumbBlob = await generateVideoThumbnail(file);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({
      name: file.name || 'video_' + Date.now(),
      type: file.type,
      blob: file,
      thumbBlob: thumbBlob,
      isVideo: true,
      date: Date.now()
    });
    req.onsuccess = () => {
      // Jalankan cleanup setelah simpan
      cleanupVideo().catch(() => {});
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

// Auto-cleanup: hapus video tertua kalau total > 300 MB
async function cleanupVideo() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const idx = store.index('date');
    const req = idx.getAll();

    req.onsuccess = async () => {
      const all = req.result;
      const videos = all.filter(m => m.isVideo).sort((a, b) => a.date - b.date);
      let total = videos.reduce((s, v) => s + v.blob.size, 0);

      if (total <= MAX_VIDEO_BYTES) {
        resolve({ deleted: 0 });
        return;
      }

      // Hapus video tertua sampai total < 300 MB
      const db2 = await openDB();
      let deleted = 0;
      for (const v of videos) {
        if (total <= MAX_VIDEO_BYTES) break;
        await new Promise((res, rej) => {
          const tx2 = db2.transaction(STORE, 'readwrite');
          const del = tx2.objectStore(STORE).delete(v.id);
          del.onsuccess = () => res();
          del.onerror = () => rej(del.error);
        });
        total -= v.blob.size;
        deleted++;
      }
      resolve({ deleted });
    };

    req.onerror = () => reject(req.error);
  });
}

// Hitung total ukuran video (untuk info)
async function infoVideoStorage() {
  const all = await ambilSemuaMedia();
  const videos = all.filter(m => m.isVideo);
  const total = videos.reduce((s, v) => s + v.blob.size, 0);
  return {
    jumlah: videos.length,
    totalMB: (total / (1024 * 1024)).toFixed(1),
    maxMB: (MAX_VIDEO_BYTES / (1024 * 1024)).toFixed(0)
  };
}
