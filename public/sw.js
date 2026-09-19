const CACHE_VERSION = 'bel-offline-v28-v1-8-128';
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
  '/js/pte-shell-config.js?v=20260919_pte_v3',
  '/js/pte-recorder-widget.js?v=20260919_pte_v3',
  '/js/pte-audio-box.js?v=20260919_pte_v3',
  '/js/pte-attempt-history-section.js?v=20260919_pte_v3',
  '/js/pte-attempt-archive.js?v=20260919_pte_v3',
  '/js/speaking-practice-controller.js?v=20260919_pte_v3',
  '/css/pte-speaking-shell.css?v=20260919_pte_v3',
  '/css/pte-question-area.css?v=20260919_pte_v3',
  '/js/write-essay-support.js?v=20260903_guided_ux_v15',
  '/write-essay-mode.js?v=1.8.128',
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

function isEssaySupportRequest(requestUrl) {
  return (requestUrl.pathname || '').startsWith('/database/Write Essay/support/v1/');
}

function supportManifestStrategy(request) {
  return caches.open(RUNTIME_CACHE).then(async (cache) => {
    try {
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    } catch (_) {
      const cached = await cache.match(request);
      return cached || new Response('Guided support unavailable', { status: 503, statusText: 'Offline' });
    }
  });
}

function supportPackStrategy(request) {
  return caches.open(RUNTIME_CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    } catch (_) {
      return new Response('Guided support unavailable', { status: 503, statusText: 'Offline' });
    }
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!isSameOrigin(request.url)) return;

  const requestUrl = new URL(request.url);
  if (isEssaySupportRequest(requestUrl)) {
    event.respondWith(requestUrl.pathname.endsWith('/manifest.json')
      ? supportManifestStrategy(request)
      : supportPackStrategy(request));
    return;
  }
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
