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
const cacheVersionMatch = source.match(/const CACHE_VERSION = '([^']+)';/);
assert.ok(cacheVersionMatch, 'service worker must declare a cache version');
const currentCacheVersion = cacheVersionMatch[1];

function createServiceWorkerHarness(cachedResponses = {}, existingCacheKeys = []) {
  let fetchHandler;
  let activateHandler;
  let installHandler;
  let messageHandler;
  let precacheUrls = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  const cache = new Map(Object.entries(cachedResponses));
  const deletedCacheKeys = [];
  const cacheStorage = {
    async match(request) {
      const key = typeof request === 'string' ? request : new URL(request.url).pathname;
      return cache.get(key);
    },
    async open() {
      return {
        addAll(urls) {
          precacheUrls = [...urls];
          return Promise.resolve();
        },
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
    clients: { claim() { claimCalls += 1; } },
    skipWaiting() { skipWaitingCalls += 1; },
    addEventListener(type, listener) {
      listeners.set(type, listener);
      if (type === 'fetch') fetchHandler = listener;
      if (type === 'activate') activateHandler = listener;
      if (type === 'install') installHandler = listener;
      if (type === 'message') messageHandler = listener;
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

  return {
    fetchHandler,
    activateHandler,
    installHandler,
    messageHandler,
    deletedCacheKeys,
    get precacheUrls() { return precacheUrls; },
    get skipWaitingCalls() { return skipWaitingCalls; },
    get claimCalls() { return claimCalls; }
  };
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
  const harness = createServiceWorkerHarness({}, existingCacheKeys);
  let activationPromise;
  harness.activateHandler({
    waitUntil(promise) {
      activationPromise = Promise.resolve(promise);
    }
  });
  await activationPromise;
  return harness;
}

async function installServiceWorker() {
  const harness = createServiceWorkerHarness();
  let installPromise;
  harness.installHandler({
    waitUntil(promise) {
      installPromise = Promise.resolve(promise);
    }
  });
  await installPromise;
  return harness;
}

function createRegistrationHarness({ waiting = true, mode = '', recording = false, controlled = true } = {}) {
  function target() {
    const listeners = new Map();
    return {
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      async emit(type) {
        for (const listener of listeners.get(type) || []) await listener();
      }
    };
  }
  const messages = [];
  const worker = Object.assign(target(), { state: 'installing', postMessage: (message) => messages.push(message.type) });
  const registration = Object.assign(target(), { waiting: waiting ? worker : null, installing: null });
  const serviceWorker = Object.assign(target(), {
    controller: controlled ? {} : null,
    register: async () => registration,
    ready: Promise.resolve(registration)
  });
  let reloads = 0;
  const timers = [];
  const window = Object.assign(target(), {
    appState: { currentMode: mode },
    ASQMode: { isRecording: recording },
    location: { hostname: 'example.test', protocol: 'https:', reload: () => { reloads += 1; } }
  });
  vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), 'public/js/sw-register.js'), 'utf8'), {
    window, navigator: { serviceWorker },
    document: { visibilityState: 'visible' },
    setTimeout: (callback) => { timers.push(callback); },
    clearTimeout: () => {}
  });
  return { window, serviceWorker, registration, worker, messages,
    get reloads() { return reloads; },
    async tick() { const pending = timers.splice(0); for (const callback of pending) await callback(); }
  };
}

async function testRegistrationLifecycle() {
  const ready = createRegistrationHarness();
  await ready.window.emit('load');
  await ready.tick();
  assert.deepEqual(ready.messages, ['SKIP_WAITING'], 'a fresh idle dashboard must activate an already waiting update');
  ready.serviceWorker.controller = {};
  await ready.serviceWorker.emit('controllerchange');
  assert.equal(ready.reloads, 0, 'a different worker taking control must not reload this client');
  ready.serviceWorker.controller = ready.worker;
  await ready.serviceWorker.emit('controllerchange');
  await ready.serviceWorker.emit('controllerchange');
  assert.equal(ready.reloads, 1, 'controller change must reload at most once');

  const discovered = createRegistrationHarness({ waiting: false });
  await discovered.window.emit('load');
  discovered.registration.installing = discovered.worker;
  await discovered.registration.emit('updatefound');
  discovered.registration.waiting = discovered.worker;
  discovered.worker.state = 'installed';
  await discovered.worker.emit('statechange');
  await discovered.tick();
  assert.deepEqual(discovered.messages, ['SKIP_WAITING'], 'updatefound must detect the newly waiting worker');

  for (const options of [{ mode: 'speak' }, { recording: true }]) {
    const busy = createRegistrationHarness(options);
    await busy.window.emit('load');
    await busy.tick();
    await busy.serviceWorker.emit('controllerchange');
    assert.equal(busy.messages.length, 0, 'practice or recording must defer activation');
    assert.equal(busy.reloads, 0, 'practice or recording must defer reload');
  }
  const interacted = createRegistrationHarness();
  await interacted.window.emit('pointerdown');
  await interacted.window.emit('load');
  await interacted.tick();
  assert.equal(interacted.messages.length, 0, 'interaction closes the fresh-page activation boundary');

  const bootstrap = createRegistrationHarness();
  delete bootstrap.window.appState;
  await bootstrap.window.emit('load');
  assert.equal(bootstrap.messages.length, 0, 'unknown startup state is not a safe dashboard');
  bootstrap.window.appState = { currentMode: '' };
  await bootstrap.tick();
  assert.deepEqual(bootstrap.messages, ['SKIP_WAITING'], 'delayed dashboard bootstrap must not strand the waiting worker');

  const later = createRegistrationHarness({ waiting: false });
  await later.window.emit('load');
  await later.window.emit('keydown');
  later.registration.installing = later.worker;
  await later.registration.emit('updatefound');
  later.registration.waiting = later.worker;
  later.worker.state = 'installed';
  await later.worker.emit('statechange');
  await later.serviceWorker.emit('controllerchange');
  assert.equal(later.messages.length, 0, 'mid-session update must wait for the next fresh navigation');
  assert.equal(later.reloads, 0, 'an update requested by another client must not reload this client');

  const exited = createRegistrationHarness({ mode: 'speak' });
  await exited.window.emit('load');
  exited.window.appState.currentMode = '';
  await exited.tick();
  assert.equal(exited.messages.length, 0, 'returning to dashboard cannot prove legacy private recorders have stopped');

  const race = createRegistrationHarness();
  await race.window.emit('load');
  await race.tick();
  race.window.ASQMode.isRecording = true;
  race.serviceWorker.controller = race.worker;
  await race.serviceWorker.emit('controllerchange');
  assert.equal(race.reloads, 0, 'recording starting after the activation request must prevent reload');

  const firstInstall = createRegistrationHarness({ controlled: false });
  await firstInstall.window.emit('load');
  await firstInstall.tick();
  await firstInstall.serviceWorker.emit('controllerchange');
  assert.equal(firstInstall.reloads, 0, 'first installation must not trigger a reload');
}

(async () => {
  await testRegistrationLifecycle();
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

  const activated = await activateServiceWorker([
      'bel-offline-v21-shell',
      'bel-offline-v21-runtime',
      `${currentCacheVersion}-shell`,
      `${currentCacheVersion}-runtime`,
      'unrelated-cache'
    ]);
  assert.deepEqual(
    activated.deletedCacheKeys,
    ['bel-offline-v21-shell', 'bel-offline-v21-runtime', 'unrelated-cache'],
    'service-worker activation should evict stale and unrelated caches while retaining the current pair'
  );
  assert.equal(activated.claimCalls, 0, 'activation must not force control of an active attempt');

  const installed = await installServiceWorker();
  assert.equal(installed.skipWaitingCalls, 0, 'install must wait for a safe client-controlled update boundary');
  assert.ok(!installed.precacheUrls.includes('/ipa-dict.json'), 'heavy IPA dictionary must be runtime-cached on demand');
  assert.ok(!installed.precacheUrls.some((url) => url.includes('write-essay-mode.js')), 'essay controller must not block service-worker installation');
  installed.messageHandler({ data: { type: 'SKIP_WAITING' } });
  assert.equal(installed.skipWaitingCalls, 1, 'an explicit client update may activate the waiting worker');

  assert.ok(
    !source.includes("'/cmudict.json'"),
    'service worker should not force-download the 3.8 MB CMU dict during install'
  );

  console.log('Phase 3 service worker config test passed.');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
