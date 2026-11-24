/**
 * Board2CAD — Vanilla Service Worker (sw.js)
 * Cache Version: board2cad-v1.5.1 (Aligned with APP_VERSION & CHANGELOG.md)
 * Strategy: Network-First with Offline Cache Fallback for App Shell & 3D Models Library
 */

const CACHE_VERSION = 'v1.5.1';
const CACHE_NAME = `board2cad-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './screenshot-mobile.png',
  './screenshot-desktop.png',
  './css/variables.css?v=1.5.1',
  './css/main.css?v=1.5.1',
  './css/viewer.css?v=1.5.1',
  './js/app.js?v=1.5.1',
  './js/services/aiService.js',
  './js/services/storageService.js',
  './js/services/githubService.js',
  './js/components/wizard.js',
  './js/components/viewer3d.js',
  './js/components/gallery.js',
  './js/components/settings.js',
  './js/workers/openscad.worker.js',
  './models/index.json',
  './models/freenove-esp32-s3-2.8/meta.json',
  './models/freenove-esp32-s3-2.8/model.scad',
  './models/freenove-esp32-s3-2.8/model.stl',
  './models/freenove-esp32-s3-2.8/model.3mf',
  './models/freenove-esp32-s3-2.8/preview.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('board2cad-') && key !== CACHE_NAME)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Non intercettare chiamate API dinamiche verso Gemini, OpenRouter, Groq, OpenAI o GitHub REST API
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('openrouter.ai') ||
    url.hostname.includes('api.groq.com') ||
    url.hostname.includes('openai.com') ||
    url.hostname.includes('api.github.com')
  ) {
    return;
  }

  // Network-First con bypass HTTP cache per asset locali e fallback immediato offline
  const fetchReq = url.origin === self.location.origin
    ? new Request(event.request, { cache: 'no-cache' })
    : event.request;

  event.respondWith(
    fetch(fetchReq)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: false });
        if (cached) return cached;
        const cachedNoQuery = await caches.match(event.request, { ignoreSearch: true });
        if (cachedNoQuery) return cachedNoQuery;
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        throw new Error('Risorsa non disponibile offline');
      })
  );
});
