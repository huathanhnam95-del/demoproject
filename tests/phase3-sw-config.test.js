const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* eslint-disable no-console */

console.log('Starting Phase 3 service worker config test...');

const swPath = path.join(process.cwd(), 'public', 'sw.js');
const source = fs.readFileSync(swPath, 'utf8');

assert.ok(
  source.includes("'/dictionary-service.js'"),
  'service worker should precache the real dictionary service path'
);
assert.ok(
  !source.includes("'/js/dictionary-service.js'"),
  'service worker must not precache the wrong /js/dictionary-service.js path'
);
assert.match(source, /const CACHE_VERSION = 'bel-offline-v22';/);

function createServiceWorkerHarness(cachedResponses = {}, existingCacheKeys = []) {
  let fetchHandler;
  let activateHandler;
  const cache = new Map(Object.entries(cachedResponses));
  const deletedCacheKeys = [];
  const cacheStorage = {
    async match(request) {
      const key = typeof request === 'string' ? request : new URL(request.url).pathname;
      return cache.get(key);
    },
    async open() {
      return {
        put(request, response) {
          const key = typeof request === 'string' ? request : new URL(request.url).pathname;
          cache.set(key, response);
          return Promise.resolve();
        }
      };
    },
    async keys() { return existingCacheKeys; },
    async delete(key) {
      deletedCacheKeys.push(key);
      return true;
    }
  };
  const listeners = new Map();
  const self = {
    location: { origin: 'https://example.test' },
    clients: { claim() {} },
    skipWaiting() {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
      if (type === 'fetch') fetchHandler = listener;
      if (type === 'activate') activateHandler = listener;
    }
  };

  vm.runInNewContext(source, {
    URL,
    Promise,
    Response,
    caches: cacheStorage,
    fetch: async () => { throw new Error('offline'); },
    self,
    setTimeout,
    console
  }, { filename: swPath });

  return { fetchHandler, activateHandler, deletedCacheKeys };
}

async function fetchOfflineNavigation(pathname, cachedResponses) {
  const { fetchHandler } = createServiceWorkerHarness(cachedResponses);
  let responsePromise;
  fetchHandler({
    request: {
      method: 'GET',
      mode: 'navigate',
      url: `https://example.test${pathname}`
    },
    respondWith(response) {
      responsePromise = Promise.resolve(response);
    }
  });
  return responsePromise;
}

async function activateServiceWorker(existingCacheKeys) {
  const { activateHandler, deletedCacheKeys } = createServiceWorkerHarness({}, existingCacheKeys);
  let activationPromise;
  activateHandler({
    waitUntil(promise) {
      activationPromise = Promise.resolve(promise);
    }
  });
  await activationPromise;
  return deletedCacheKeys;
}

(async () => {
  const appShell = await fetchOfflineNavigation('/practice/speaking/pronounce', {
    '/index.html': new Response('cached app shell', { status: 200 }),
    '/offline.html': new Response('cached offline page', { status: 200 })
  });
  assert.equal(appShell.status, 200, 'offline SPA navigation should return cached /index.html');
  assert.equal(await appShell.text(), 'cached app shell');

  const landing = await fetchOfflineNavigation('/landing/lesson', {
    '/landing/index.html': new Response('cached landing shell', { status: 200 }),
    '/offline.html': new Response('cached offline page', { status: 200 })
  });
  assert.equal(landing.status, 200, 'offline landing navigation should retain cached landing fallback');
  assert.equal(await landing.text(), 'cached landing shell');

  const landingWithoutShell = await fetchOfflineNavigation('/landing/missing', {
    '/index.html': new Response('cached app shell', { status: 200 }),
    '/offline.html': new Response('cached offline page', { status: 200 })
  });
  assert.equal(landingWithoutShell.status, 200, 'landing navigation without its shell should use offline fallback');
  assert.equal(await landingWithoutShell.text(), 'cached offline page');

  const offline = await fetchOfflineNavigation('/not-cached', {
    '/offline.html': new Response('cached offline page', { status: 200 })
  });
  assert.equal(offline.status, 200, 'offline navigation should retain the cached offline page fallback');
  assert.equal(await offline.text(), 'cached offline page');

  assert.deepEqual(
    await activateServiceWorker([
      'bel-offline-v21-shell',
      'bel-offline-v21-runtime',
      'bel-offline-v22-shell',
      'bel-offline-v22-runtime',
      'unrelated-cache'
    ]),
    ['bel-offline-v21-shell', 'bel-offline-v21-runtime', 'unrelated-cache'],
    'service-worker activation should evict old v21 and unrelated caches while retaining v22'
  );

  assert.ok(
    !source.includes("'/cmudict.json'"),
    'service worker should not force-download the 3.8 MB CMU dict during install'
  );

  console.log('Phase 3 service worker config test passed.');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
