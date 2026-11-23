/**
 * Board2CAD — Storage Service (IndexedDB + Repo Fetch + ZIP Packager)
 * Pure Vanilla ES6 Module — Zero Framework Dependencies
 */

const DB_NAME = 'Board2CAD_DB';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const SETTINGS_KEY = 'board2cad_settings_v1';

const DEFAULT_SETTINGS = {
  aiProvider: 'gemini',
  aiModel: 'gemini-2.5-flash',
  aiApiKey: '',
  ghOwner: 'debartoloa',
  ghRepo: 'Board2CAD',
  ghBranch: 'main',
  ghToken: ''
};

export class StorageService {
  constructor() {
    this.dbPromise = null;
  }

  /**
   * Legge le impostazioni salvate in localStorage
   */
  getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Salva le impostazioni in localStorage
   */
  saveSettings(newSettings) {
    const merged = { ...this.getSettings(), ...newSettings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  }

  /**
   * Inizializza e apre il database IndexedDB
   */
  openDB() {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB non supportato in questo browser.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'slug' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  /**
   * Carica l'indice dei modelli versionati nel repository Git (/models/index.json)
   */
  async fetchRepoModelsIndex() {
    try {
      const res = await fetch(`./models/index.json?t=${Date.now()}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.models) ? data.models : [];
      return list.map((item) => ({
        ...item,
        source: 'repo',
        previewUrl: item.preview || `./models/${item.slug}/preview.png`
      }));
    } catch (err) {
      console.warn('[StorageService] Impossibile caricare /models/index.json:', err);
      return [];
    }
  }

  /**
   * Restituisce tutti i modelli salvati in IndexedDB locale
   */
  async getLocalModels() {
    try {
      const db = await this.openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const records = (req.result || []).map((rec) => ({
            ...rec.meta,
            slug: rec.slug,
            source: 'local',
            previewUrl: rec.previewDataUrl || `./models/freenove-esp32-s3-2.8/preview.png`,
            _record: rec
          }));
          resolve(records);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[StorageService] Lettura IndexedDB fallita:', err);
      return [];
    }
  }

  /**
   * Unisce i modelli del repository GitHub (models/index.json) e quelli locali (IndexedDB).
   * Se un modello del repo (es. freenove-esp32-s3-2.8) è stato modificato e salvato in IndexedDB,
   * la versione modificata sovrascrive in modo persistente quella base mantenendo il flag hasLocalOverride.
   */
  async getAllModels() {
    const [repoModels, localModels] = await Promise.all([
      this.fetchRepoModelsIndex(),
      this.getLocalModels()
    ]);

    const repoSlugSet = new Set(repoModels.map((m) => m.slug));
    const bySlug = new Map();

    for (const m of repoModels) {
      bySlug.set(m.slug, {
        ...m,
        source: 'repo',
        hasLocalOverride: false
      });
    }

    for (const m of localModels) {
      const isRepoOverride = repoSlugSet.has(m.slug);
      bySlug.set(m.slug, {
        ...m,
        source: isRepoOverride ? 'repo' : 'local',
        hasLocalOverride: isRepoOverride
      });
    }

    return Array.from(bySlug.values()).sort((a, b) => {
      const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    });
  }

  /**
   * Carica tutti i file di un modello specifico.
   * Verifica sempre prima se esistono modifiche salvate dall'utente in IndexedDB per quello slug!
   */
  async loadFullModel(slug, source = 'repo', forceRepoDefault = false) {
    if (!forceRepoDefault) {
      try {
        const db = await this.openDB();
        const localRec = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(slug);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
        if (localRec) {
          return {
            slug: localRec.slug,
            source: localRec.originalSource || source || 'local',
            hasLocalOverride: true,
            customMeshLocked: Boolean(localRec.customMeshLocked),
            meta: localRec.meta,
            scad: localRec.scad,
            stlBuffer: localRec.stlBuffer || null,
            threemfBuffer: localRec.threemfBuffer || null,
            previewDataUrl: localRec.previewDataUrl || './models/freenove-esp32-s3-2.8/preview.png'
          };
        }
      } catch (e) {
        console.warn('[StorageService] Controllo IndexedDB fallito:', e);
      }
    }

    // Caricamento dalla cartella statica /models/<slug>/
    const basePath = `./models/${slug}`;
    const [metaRes, scadRes, stlRes, threemfRes] = await Promise.all([
      fetch(`${basePath}/meta.json?t=${Date.now()}`),
      fetch(`${basePath}/model.scad?t=${Date.now()}`),
      fetch(`${basePath}/model.stl?t=${Date.now()}`).catch(() => null),
      fetch(`${basePath}/model.3mf?t=${Date.now()}`).catch(() => null)
    ]);

    if (!metaRes.ok || !scadRes.ok) {
      throw new Error(`Modello "${slug}" non trovato in /models/${slug}/`);
    }

    const meta = await metaRes.json();
    const scad = await scadRes.text();
    const stlBuffer = stlRes && stlRes.ok ? await stlRes.arrayBuffer() : null;
    const threemfBuffer = threemfRes && threemfRes.ok ? await threemfRes.arrayBuffer() : null;

    return {
      slug,
      source: 'repo',
      hasLocalOverride: false,
      customMeshLocked: false,
      meta,
      scad,
      stlBuffer,
      threemfBuffer,
      previewDataUrl: `${basePath}/preview.png`
    };
  }

  /**
   * Salva o aggiorna un modello completo (tutti i 5 file: scad, stl, 3mf, png, meta) in IndexedDB
   */
  async saveLocalModel(modelData) {
    const db = await this.openDB();
    const nowIso = new Date().toISOString();
    const record = {
      slug: modelData.slug,
      originalSource: modelData.source || 'local',
      customMeshLocked: Boolean(modelData.customMeshLocked),
      updatedAt: nowIso,
      meta: {
        ...modelData.meta,
        slug: modelData.slug,
        updatedAt: nowIso
      },
      scad: modelData.scad,
      stlBuffer: modelData.stlBuffer || null,
      threemfBuffer: modelData.threemfBuffer || null,
      previewDataUrl: modelData.previewDataUrl || ''
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Scrive direttamente tutti i 5 file del modello (model.scad, model.stl, model.3mf, preview.png, meta.json)
   * in una cartella sul disco locale dell'utente tramite File System Access API (showDirectoryPicker).
   */
  async saveModelToLocalDiskFolder(modelData) {
    if (!('showDirectoryPicker' in window)) {
      return this.downloadModelFolderZip(modelData);
    }

    const slug = modelData.slug || 'custom-pcb-model';
    const rootDirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents'
    });

    // Se l'utente seleziona la root del progetto (che contiene models/), scrive dentro models/<slug>/
    // Se seleziona models/, scrive dentro <slug>/
    // Se seleziona direttamente la cartella <slug>/, scrive direttamente lì!
    let targetDirHandle = rootDirHandle;
    if (rootDirHandle.name !== slug) {
      try {
        const modelsDir = await rootDirHandle.getDirectoryHandle('models', { create: false });
        targetDirHandle = await modelsDir.getDirectoryHandle(slug, { create: true });
      } catch {
        targetDirHandle = await rootDirHandle.getDirectoryHandle(slug, { create: true });
      }
    }

    const writeFileToDir = async (filename, content) => {
      const fileHandle = await targetDirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    };

    await writeFileToDir('model.scad', modelData.scad || '');
    await writeFileToDir('meta.json', JSON.stringify(modelData.meta, null, 2));

    if (modelData.stlBuffer) {
      await writeFileToDir('model.stl', modelData.stlBuffer);
    }
    if (modelData.threemfBuffer) {
      await writeFileToDir('model.3mf', modelData.threemfBuffer);
    }

    const pngBytes = await this.dataUrlOrUrlToUint8Array(modelData.previewDataUrl);
    if (pngBytes) {
      await writeFileToDir('preview.png', pngBytes);
    }

    return targetDirHandle.name;
  }

  /**
   * Elimina un modello locale da IndexedDB
   */
  async deleteLocalModel(slug) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(slug);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Svuota tutti i modelli salvati in IndexedDB
   */
  async clearAllLocalModels() {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Crea e scarica un pacchetto .ZIP completo della cartella del modello
   * (<slug>/model.scad, model.stl, model.3mf, preview.png, meta.json)
   */
  async downloadModelFolderZip(modelData) {
    const slug = modelData.slug || 'custom-pcb-model';
    const metaJsonStr = JSON.stringify(modelData.meta, null, 2);
    const pngBytes = await this.dataUrlOrUrlToUint8Array(modelData.previewDataUrl);

    try {
      const JSZipModule = await import('jszip');
      const JSZip = JSZipModule.default || JSZipModule;
      const zip = new JSZip();
      const folder = zip.folder(slug);

      folder.file('model.scad', modelData.scad || '');
      folder.file('meta.json', metaJsonStr);
      if (modelData.stlBuffer) {
        folder.file('model.stl', modelData.stlBuffer);
      }
      if (modelData.threemfBuffer) {
        folder.file('model.3mf', modelData.threemfBuffer);
      }
      if (pngBytes) {
        folder.file('preview.png', pngBytes);
      }

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      this.triggerBlobDownload(blob, `${slug}.zip`);
      return true;
    } catch (err) {
      console.warn('[StorageService] JSZip CDN non raggiungibile, uso packager ZIP nativo:', err);
      const files = [
        { name: `${slug}/model.scad`, data: new TextEncoder().encode(modelData.scad || '') },
        { name: `${slug}/meta.json`, data: new TextEncoder().encode(metaJsonStr) }
      ];
      if (modelData.stlBuffer) {
        files.push({ name: `${slug}/model.stl`, data: new Uint8Array(modelData.stlBuffer) });
      }
      if (modelData.threemfBuffer) {
        files.push({ name: `${slug}/model.3mf`, data: new Uint8Array(modelData.threemfBuffer) });
      }
      if (pngBytes) {
        files.push({ name: `${slug}/preview.png`, data: pngBytes });
      }
      const zipBuffer = buildUncompressedZip(files);
      const blob = new Blob([zipBuffer], { type: 'application/zip' });
      this.triggerBlobDownload(blob, `${slug}.zip`);
      return true;
    }
  }

  /**
   * Converte un DataURL o URL immagine in Uint8Array
   */
  async dataUrlOrUrlToUint8Array(src) {
    if (!src) return null;
    try {
      if (src.startsWith('data:')) {
        const base64 = src.split(',')[1] || '';
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }
      const res = await fetch(src);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  /**
   * Avvia il download di un Blob nel browser
   */
  triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

/**
 * Packager ZIP Store (senza dipendenze esterne, usato sia come fallback ZIP sia per creare pacchetti .3MF)
 */
export function buildUncompressedZip(files) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }

  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };

  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // Store (0)
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + size;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLength = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of localParts) {
    out.set(part, pos);
    pos += part.length;
  }
  for (const part of centralParts) {
    out.set(part, pos);
    pos += part.length;
  }
  out.set(eocd, pos);
  return out.buffer;
}

export const storageService = new StorageService();
