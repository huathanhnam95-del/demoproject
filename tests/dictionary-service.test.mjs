import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'public/dictionary-service.js'), 'utf8');

function createStorage(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    dump() {
      return Object.fromEntries(store.entries());
    }
  };
}

function createHarness({ translations = {}, definitions = {}, fetchBehavior }) {
  const localStorage = createStorage({
    vocab_translations_cache: JSON.stringify({ timestamp: Date.now(), data: translations }),
    vocab_definitions_cache: JSON.stringify({ timestamp: Date.now(), data: definitions })
  });
  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(String(url));
    return fetchBehavior(String(url));
  };

  const context = {
    window: null,
    module: { exports: {} },
    exports: {},
    console,
    Logger: {
      create: () => ({
        log() {},
        warn() {},
        error() {},
        debug() {}
      })
    },
    localStorage,
    fetch,
    DOMParser: class {
      parseFromString() {
        return {};
      }
    },
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Map,
    Set,
    URL,
    encodeURIComponent,
    decodeURIComponent
  };
  context.window = context;

  vm.runInNewContext(source, context, { filename: 'public/dictionary-service.js' });

  return {
    service: context.window.DictionaryService,
    localStorage,
    fetchCalls
  };
}

function okJson(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

test('dictionary service returns a valid cached translation without network fetch', async () => {
  const harness = createHarness({
    translations: {
      hello: { translation: 'xin chao', sentences: [], source: 'cache' }
    },
    fetchBehavior: async () => {
      throw new Error('cache hit should not fetch');
    }
  });

  const result = await harness.service.getVietnameseEntry('hello');

  assert.equal(result.servedFromCache, true);
  assert.equal(result.translation, 'xin chao');
  assert.equal(harness.fetchCalls.length, 0);
});

test('dictionary service ignores expired cache entries and falls back to remote lookup', async () => {
  const expiredStorage = createStorage({
    vocab_translations_cache: JSON.stringify({
      timestamp: Date.now() - (1000 * 60 * 60 * 24 * 31),
      data: {
        beta: { translation: 'stale cache', sentences: [], source: 'cache' }
      }
    }),
    vocab_definitions_cache: JSON.stringify({ timestamp: Date.now(), data: {} })
  });
  const fetchCalls = [];
  const fetchBehavior = async (url) => {
    fetchCalls.push(url);
    if (url.includes('/api/tracau')) {
      return okJson({ tratu: [], sentences: [] });
    }
    if (url.includes('wiktionary')) {
      return okJson({
        en: [
          {
            partOfSpeech: 'noun',
            definitions: [{ definition: 'remote translation' }]
          }
        ]
      });
    }
    if (url.includes('glosbe')) {
      return {
        ok: false,
        async json() {
          return {};
        }
      };
    }
    if (url.includes('mymemory')) {
      return okJson({
        responseStatus: 200,
        responseData: { translatedText: 'remote translation' }
      });
    }
    return okJson({});
  };

  const context = {
    window: null,
    module: { exports: {} },
    exports: {},
    console,
    Logger: {
      create: () => ({
        log() {},
        warn() {},
        error() {},
        debug() {}
      })
    },
    localStorage: expiredStorage,
    fetch: async (url) => fetchBehavior(String(url)),
    DOMParser: class {
      parseFromString() {
        return {};
      }
    },
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Map,
    Set,
    URL,
    encodeURIComponent,
    decodeURIComponent
  };
  context.window = context;

  vm.runInNewContext(source, context, { filename: 'public/dictionary-service.js' });

  const result = await context.window.DictionaryService.getVietnameseEntry('beta');

  assert.equal(result.servedFromCache, false);
  assert.equal(result.translation, 'remote translation');
  assert.ok(fetchCalls.length > 0);
  assert.ok(fetchCalls.some((url) => String(url).includes('/api/tracau?word=beta')));
});

test('dictionary service saveCaches writes timestamped payloads and upgradeCacheToRich dedupes', async () => {
  const harness = createHarness({
    translations: {
      gamma: 'legacy translation'
    },
    fetchBehavior: async () =>
      okJson({
        tratu: [],
        sentences: [{ fields: { en: 'Example sentence', vi: 'Cau vi du' } }]
      })
  });

  await Promise.all([
    harness.service.upgradeCacheToRich('gamma'),
    harness.service.upgradeCacheToRich('gamma')
  ]);

  const upgradedCalls = harness.fetchCalls.filter((url) => url.includes('/api/tracau'));
  const parsedTranslations = JSON.parse(harness.localStorage.getItem('vocab_translations_cache'));

  assert.equal(upgradedCalls.length, 1);
  assert.equal(parsedTranslations.data.gamma.source, 'cache_upgraded');
  assert.equal(parsedTranslations.data.gamma.sentences.length, 1);

  harness.service.saveCaches();
  const persistedTranslations = JSON.parse(harness.localStorage.getItem('vocab_translations_cache'));
  const persistedDefinitions = JSON.parse(harness.localStorage.getItem('vocab_definitions_cache'));

  assert.equal(typeof persistedTranslations.timestamp, 'number');
  assert.equal(typeof persistedDefinitions.timestamp, 'number');
  assert.equal(persistedTranslations.data.gamma.source, 'cache_upgraded');

  harness.service.clearCache();
  assert.equal(harness.localStorage.getItem('vocab_translations_cache'), null);
  assert.equal(harness.localStorage.getItem('vocab_definitions_cache'), null);
});
