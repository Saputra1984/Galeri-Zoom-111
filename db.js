const DB_NAME = 'galerizoom_db';
const DB_VERSION = 1;
const STORE = 'media';
let MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB default

let dbPromise = null;

// Update batas dari quota browser
async function updateMaxVideoBytes() {
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            if (est.quota && est.quota > 0) {
                MAX_VIDEO_BYTES = Math.floor(est.quota * 0.6);
                console.log(`📏 Batas video: ${(MAX_VIDEO_BYTES/1024/1024/1024).toFixed(2)} GB (60% dari ${(est.quota/1024/1024/1024).toFixed(2)} GB)`);
            }
        }
    } catch (e) {
        console.warn('Gagal baca quota, pakai default 2 GB:', e.message);
    }
}

// ═══ KONEKSI DB ═══
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

// ═══ UTIL ═══
function detectFileType(file) {
    if (file.type && file.type !== '') return file.type;
    const name = (file.name || '').toLowerCase();
    if (/\.(jpg|jpeg)$/.test(name)) return 'image/jpeg';
    if (/\.png$/.test(name)) return 'image/png';
    if (/\.gif$/.test(name)) return 'image/gif';
    if (/\.webp$/.test(name)) return 'image/webp';
    if (/\.bmp$/.test(name)) return 'image/bmp';
    if (/\.svg$/.test(name)) return 'image/svg+xml';
    if (/\.avif$/.test(name)) return 'image/avif';
    if (/\.(heic|heif)$/.test(name)) return 'image/heic';
    if (/\.mp4$/.test(name)) return 'video/mp4';
    if (/\.webm$/.test(name)) return 'video/webm';
    if (/\.mov$/.test(name)) return 'video/quicktime';
    if (/\.mkv$/.test(name)) return 'video/x-matroska';
    if (/\.avi$/.test(name)) return 'video/x-msvideo';
    if (/\.3gp$/.test(name)) return 'video/3gpp';
    return 'application/octet-stream';
}

function validateFile(file) {
    if (!file) throw new Error('File tidak valid (null)');
    if (!file.size || file.size === 0) throw new Error('File kosong atau tidak terbaca (size=0)');
}

// ═══ SIMPAN: GAMBAR / NON-VIDEO ═══
async function simpanMedia(file) {
    validateFile(file);
    
    let thumbBlob = null;
    try {
        thumbBlob = await generateImageThumbnail(file);
    } catch (e) {
        console.warn('Thumbnail gambar gagal, pakai blob asli di grid:', e.message);
    }
    
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).add({
            name: file.name || ('file_' + Date.now()),
            type: detectFileType(file),
            blob: file,
            thumbBlob: thumbBlob,
            isVideo: false,
            needsThumb: false,
            date: Date.now()
        });
        let newId = null;
        req.onsuccess = () => { newId = req.result; };
        tx.oncomplete = () => resolve(newId);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
}

// ═══ SIMPAN: VIDEO ═══
async function simpanVideo(file) {
    validateFile(file);
    await updateMaxVideoBytes();
    
    if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const sisa = est.quota - est.usage;
        const butuh = file.size * 1.2;
        if (butuh > sisa) {
            throw new Error(
                `Storage tidak cukup.\n` +
                `File: ${(file.size/1024/1024).toFixed(0)} MB\n` +
                `Sisa: ${(sisa/1024/1024).toFixed(0)} MB\n\n` +
                `Hapus beberapa file lama dulu.`
            );
        }
    }
    
    if (file.size > MAX_VIDEO_BYTES) {
        throw new Error(
            `Video ${(file.size/1024/1024).toFixed(0)} MB melebihi batas ${(MAX_VIDEO_BYTES/1024/1024).toFixed(0)} MB.\n\n` +
            `Untuk video lebih besar, simpan di folder HP dan play pakai VLC.`
        );
    }
    let thumbBlob = null, needsThumb = false;
    
    if (file.size > 100 * 1024 * 1024) {
        console.log(`⏩ Skip thumbnail (video > 100 MB: ${(file.size/1024/1024).toFixed(0)} MB)`);
        needsThumb = false;
    } else {
        try {
            thumbBlob = await generateVideoThumbnail(file);
        } catch (e) {
            console.warn('Thumbnail gagal, akan di-generate nanti:', e.message);
            needsThumb = true;
        }
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).add({
            name: file.name || ('video_' + Date.now()),
            type: detectFileType(file),
            blob: file,
            thumbBlob: thumbBlob,
            isVideo: true,
            needsThumb: needsThumb,
            date: Date.now()
        });
        let newId = null;
        req.onsuccess = () => { newId = req.result; };
        tx.oncomplete = () => {
            cleanupVideo().catch((e) => console.warn('cleanup error:', e));
            resolve(newId);
        };
        tx.onerror = () => reject(tx.error);
    });
}

// ═══ AMBIL DATA ═══
async function ambilMedia(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Metadata only (tanpa blob video) — untuk grid, hemat RAM
async function ambilMetadataSemuaMedia() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const idx = tx.objectStore(STORE).index('date');
        const result = [];
        const req = idx.openCursor(null, 'prev');
        req.onsuccess = (e) => {
            const cur = e.target.result;
            if (cur) {
                const v = cur.value;
                result.push({
                    id: v.id,
                    name: v.name,
                    type: v.type,
                    isVideo: !!v.isVideo,
                    date: v.date,
                    size: v.blob ? v.blob.size : 0,
                    thumbBlob: v.thumbBlob || null,
                    needsThumb: !!v.needsThumb,
                    // Simpan blob HANYA untuk gambar (kecil), jangan video
                    blob: (v.isVideo) ? null : v.blob
                });
                cur.continue();
            } else {
                resolve(result);
            }
        };
        req.onerror = () => reject(req.error);
    });
}

// ═══ UPDATE ═══
async function hapusMedia(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function ubahNamaMedia(id, namaBaru) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const item = getReq.result;
            if (!item) return;
            item.name = namaBaru;
            store.put(item);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function simpanThumbnail(id, thumbBlob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const item = getReq.result;
            if (!item) return;
            item.thumbBlob = thumbBlob;
            item.needsThumb = false;
            store.put(item);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('tx aborted'));
    });
}

// ═══ BLOB URL (untuk dipakai HTML) ═══
function blobUrl(blob) {
    return URL.createObjectURL(blob);
}

// ═══ VIDEO THUMBNAIL ═══
function generateVideoThumbnail(videoFile) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = 'anonymous';
        const url = URL.createObjectURL(videoFile);
        video.src = url;

        let done = false;
        let retried = false;
        const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            cleanup();
            reject(new Error('Thumbnail timeout'));
        }, 10000);

        const drawFrame = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
                const canvas = document.createElement('canvas');
                const vw = video.videoWidth || 1;
                const vh = video.videoHeight || 1;
                const scale = Math.min(1, 400 / Math.max(vw, vh));
                canvas.width = Math.max(1, Math.floor(vw * scale));
                canvas.height = Math.max(1, Math.floor(vh * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // ⭐ Deteksi frame gelap
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let totalBrightness = 0;
                for (let i = 0; i < imgData.data.length; i += 4) {
                    totalBrightness += (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
                }
                const avgBrightness = totalBrightness / (imgData.data.length / 4);

                if (avgBrightness < 10 && video.duration > 1 && !retried) {
                    retried = true;
                    done = false;
                    video.currentTime = video.duration * 0.5;
                    return;
                }

                canvas.toBlob((blob) => {
                    cleanup();
                    if (blob) resolve(blob);
                    else reject(new Error('Gagal buat thumbnail (blob null)'));
                }, 'image/jpeg', 0.85);
            } catch (e) {
                cleanup();
                reject(e);
            }
        };

        video.onloadeddata = () => {
            const dur = video.duration || 0;
            const target = dur > 0 ? Math.min(1.0, dur * 0.25) : 0;
            if (target === 0) {
                drawFrame();
            } else {
                video.currentTime = target;
            }
        };

        video.onseeked = () => {
            requestAnimationFrame(() => setTimeout(drawFrame, 50));
        };

        video.onerror = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            cleanup();
            reject(new Error('Video tidak bisa dibaca (codec tidak didukung?)'));
        };
    });
}

// ═══ AUTO CLEANUP VIDEO ═══
async function cleanupVideo() {
    const all = await ambilMetadataSemuaMedia();
    const videos = all.filter(m => m.isVideo).sort((a, b) => a.date - b.date);
    let total = videos.reduce((s, v) => s + v.size, 0);
    if (total <= MAX_VIDEO_BYTES) return { deleted: 0 };

    let deleted = 0;
    for (let i = 0; i < videos.length - 1; i++) {
        if (total <= MAX_VIDEO_BYTES) break;
        await hapusMedia(videos[i].id);
        total -= videos[i].size;
        deleted++;
    }
    return { deleted };
}

// ═══ INFO STORAGE VIDEO ═══
async function infoVideoStorage() {
    const all = await ambilMetadataSemuaMedia();
    const videos = all.filter(m => m.isVideo);
    const total = videos.reduce((s, v) => s + v.size, 0);
    return {
        jumlah: videos.length,
        totalMB: (total / (1024 * 1024)).toFixed(1),
        maxMB: (MAX_VIDEO_BYTES / (1024 * 1024)).toFixed(0)
    };
}

// ═══ IMAGE THUMBNAIL ═══
function generateImageThumbnail(imageBlob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(imageBlob);
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const maxSize = 300;
                const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
                canvas.width = Math.max(1, Math.floor(img.naturalWidth * scale));
                canvas.height = Math.max(1, Math.floor(img.naturalHeight * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(url);
                    if (blob) resolve(blob);
                    else reject(new Error('Gagal buat thumbnail gambar'));
                }, 'image/jpeg', 0.8);
            } catch (e) {
                URL.revokeObjectURL(url);
                reject(e);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Gambar tidak bisa dibaca'));
        };
        img.src = url;
    });
}

// CLASSIFY FILE — deteksi apakah file layak disimpan
async function classifyFile(file) {
    const mime = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();

    const badMimePrefixes = ['audio/', 'text/', 'font/'];
    const badMimeIncludes = [
        'pdf', 'word', 'excel', 'powerpoint', 'spreadsheet', 'presentation',
        'officedocument', 'zip', 'rar', 'compressed', 'json', 'xml',
        'javascript', 'x-sh', 'x-msdownload', 'vnd.android.package'
    ];

    if (badMimePrefixes.some(p => mime.startsWith(p))) {
        return { ok: false, reason: `Tipe tidak didukung: ${mime}` };
    }
    if (badMimeIncludes.some(k => mime.includes(k))) {
        return { ok: false, reason: `Tipe dokumen/arsip: ${mime}` };
    }

    if (mime.startsWith('image/')) return { ok: true, kind: 'image' };
    if (mime.startsWith('video/')) return { ok: true, kind: 'video' };

    const ext = name.includes('.') ? name.split('.').pop() : '';

    const skipExts = [
        // Audio
        'mp3','wav','ogg','m4a','aac','flac','opus','wma','amr','mid','midi',
        // Dokumen
        'pdf','doc','docx','xls','xlsx','ppt','pptx','txt','json','xml','csv',
        'html','htm','css','md','log','ini','cfg','conf',
        // Arsip & eksekusi
        'zip','rar','7z','tar','gz','bz2','apk','exe','dmg','iso','deb','rpm',
        // Kode / data
        'js','ts','py','java','c','cpp','h','sh','bat','sql','db'
    ];
    if (skipExts.includes(ext)) {
        return { ok: false, reason: `Ekstensi tidak didukung: .${ext}` };
    }

    console.log(`🔬 Probe file misterius: ${file.name} (mime: ${mime || 'kosong'})`);

    const asImage = await probeAsImage(file);
    if (asImage.ok) {
        console.log(`✅ Terdeteksi sebagai gambar: ${asImage.detectedMime}`);
        return { ok: true, kind: 'image', mime: asImage.detectedMime };
    }

    const asVideo = await probeAsVideo(file);
    if (asVideo.ok) {
        console.log(`✅ Terdeteksi sebagai video: ${asVideo.detectedMime}`);
        return { ok: true, kind: 'video', mime: asVideo.detectedMime };
    }

    return { ok: false, reason: 'Tidak bisa dikenali sebagai gambar atau video' };
}

// Probe: coba load sebagai gambar
function probeAsImage(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        let settled = false;
        const finish = (ok, mime) => {
            if (settled) return;
            settled = true;
            try { URL.revokeObjectURL(url); } catch {}
            resolve({ ok, detectedMime: mime });
        };
        img.onload = () => {
            const w = img.naturalWidth, h = img.naturalHeight;
            if (w > 0 && h > 0) finish(true, 'image/' + (file.type || 'jpeg').split('/')[1] || 'jpeg');
            else finish(false);
        };
        img.onerror = () => finish(false);
        setTimeout(() => finish(false), 3000);
        img.src = url;
    });
}

// Probe: coba load sebagai video
function probeAsVideo(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        let settled = false;
        const finish = (ok, mime) => {
            if (settled) return;
            settled = true;
            try { URL.revokeObjectURL(url); } catch {}
            resolve({ ok, detectedMime: mime });
        };
        v.onloadedmetadata = () => {
            if (v.videoWidth > 0 || v.videoHeight > 0) {
                finish(true, (file.type && file.type.startsWith('video/')) ? file.type : 'video/mp4');
            } else {
                finish(false);
            }
        };
        v.onerror = () => finish(false);
        setTimeout(() => finish(false), 3000);
        v.src = url;
    });
}
