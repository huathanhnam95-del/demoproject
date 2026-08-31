const CACHE_VERSION = 'bel-offline-v23';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/landing/',
  '/landing/index.html',
  '/offline.html',
  '/style.css?v=20260508_practice_router_fix',
  '/script.js?v=20260802_browser_cache_fix',
  '/write-essay-mode.js?v=20260509_write_essay_feedback_ai_scoring',
  '/landing/landing.css',
  '/dictionary-service.js',
  '/collocations.json',
  '/arpabet-ipa-map.js',
  '/phonetics.js',
  '/oxford-american-ipa.json',
  '/ipa-dict.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isSameOrigin(requestUrl) {
  try {
    const url = new URL(requestUrl);
    return url.origin === self.location.origin;
  } catch {
    return false;
  }
}

function isFreshAssetRequest(requestUrl) {
  const pathname = requestUrl.pathname || '';
  return requestUrl.searchParams.has('v') || pathname.endsWith('.js') || pathname.endsWith('.css');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!isSameOrigin(request.url)) return;

  const requestUrl = new URL(request.url);
  if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/database/')) {
    return;
  }

  if (isFreshAssetRequest(requestUrl)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => { });
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => { });
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;
          const normalizedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
          const normalizedCachedPage = await caches.match(normalizedPath);
          if (normalizedCachedPage) return normalizedCachedPage;
          if (normalizedPath.startsWith('/landing')) {
            const landingCachedPage = await caches.match('/landing/index.html');
            if (landingCachedPage) return landingCachedPage;
          } else {
            const appShell = await caches.match('/index.html');
            if (appShell) return appShell;
          }
          const offlinePage = await caches.match('/offline.html');
          if (offlinePage) return offlinePage;
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request)
          .then((response) => {
            if (!response || !response.ok) return;
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, response.clone())).catch(() => { });
          })
          .catch(() => { });
        return cached;
      }

      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => { });
          }
          return response;
        })
        .catch(() => new Response('Offline', { status: 503, statusText: 'Offline' }));
    })
  );
});
