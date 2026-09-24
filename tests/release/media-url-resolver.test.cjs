'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createResolverContext() {
  const code = fs.readFileSync(path.join(__dirname, '../../public/js/media-url-resolver.js'), 'utf8');
  const customEvents = [];
  const warnings = [];

  const context = {
    console: {
      log: () => {},
      warn: (...args) => warnings.push(args.join(' ')),
      error: (...args) => {}
    },
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Set,
    Date,
    decodeURIComponent,
    encodeURIComponent,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    window: {
      dispatchEvent: (event) => {
        customEvents.push(event);
        return true;
      }
    }
  };
  context.globalThis = context;
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(code, context);

  return {
    resolver: context.MediaUrlResolver,
    context,
    customEvents,
    warnings
  };
}

test('MediaUrlResolver: _normalizePath and path security validation', () => {
  const { resolver } = createResolverContext();

  assert.equal(
    resolver._normalizePath('/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3'),
    'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3'
  );

  assert.equal(
    resolver._normalizePath('database/SST/audio/1/SST_1_af_bella.mp3?v=123#frag'),
    'public/database/SST/audio/1/SST_1_af_bella.mp3'
  );

  assert.throws(() => resolver._normalizePath('../secret/passwords.txt'), /Invalid or malicious path/);
  assert.throws(() => resolver._normalizePath('//evil.com/payload.mp3'), /Invalid or malicious path/);
  assert.throws(() => resolver._normalizePath('javascript:alert(1)'), /Invalid or malicious path/);
});

test('MediaUrlResolver: _detectMode extracts mode from logical path', () => {
  const { resolver } = createResolverContext();
  assert.equal(resolver._detectMode('public/database/RA/Voice/audio/1.mp3'), 'RA');
  assert.equal(resolver._detectMode('public/database/SST/audio/1.mp3'), 'SST');
  assert.equal(resolver._detectMode('public/database/Describe Image/DI/1.png'), 'Describe-Image');
  assert.equal(resolver._detectMode('public/database/Highlight Incorrect Words/1.mp3'), 'HIW');
});

test('MediaUrlResolver: rollout state = legacy bypasses remote fetch', async () => {
  const { resolver, context } = createResolverContext();
  let fetchCalled = false;
  context.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called in legacy mode');
  };

  const testConfig = {
    publicationId: 'pilot-test',
    deliveryBaseUrl: 'https://storage.googleapis.com/test-bucket/',
    modes: {
      RA: { state: 'legacy' }
    }
  };

  const path = '/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3';
  const resolved = await resolver.resolveAudioUrl(path, { config: testConfig });
  assert.equal(resolved, path);
  assert.equal(fetchCalled, false);
});

test('MediaUrlResolver: remote-with-fallback successfully resolves mapped GCS asset', async () => {
  const { resolver, context } = createResolverContext();

  const testConfig = {
    publicationId: 'pilot-test',
    deliveryBaseUrl: 'https://storage.googleapis.com/test-bucket/',
    modes: {
      RA: { state: 'remote-with-fallback', shardKey: 'catalogs/pilot-test/RA.json' }
    }
  };

  const mockShard = {
    mode: 'RA',
    assets: {
      'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3': {
        key: 'media/sha256/0ac3e88e6e516eac81c9cf2202b35398da0ec39bf0ddd841954d6dd4498115f6.mp3'
      }
    }
  };

  context.fetch = async (url) => {
    assert.equal(url, 'https://storage.googleapis.com/test-bucket/catalogs/pilot-test/RA.json');
    return {
      ok: true,
      json: async () => mockShard
    };
  };

  const path = '/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3';
  const resolved = await resolver.resolveAudioUrl(path, { config: testConfig });
  assert.equal(
    resolved,
    'https://storage.googleapis.com/test-bucket/media/sha256/0ac3e88e6e516eac81c9cf2202b35398da0ec39bf0ddd841954d6dd4498115f6.mp3'
  );
});

test('MediaUrlResolver: in-flight request deduplication batches concurrent shard requests', async () => {
  const { resolver, context } = createResolverContext();
  let fetchCount = 0;

  const testConfig = {
    publicationId: 'pilot-test',
    deliveryBaseUrl: 'https://storage.googleapis.com/test-bucket/',
    modes: {
      RA: { state: 'remote-with-fallback' }
    }
  };

  context.fetch = async () => {
    fetchCount++;
    await new Promise(r => setTimeout(r, 20));
    return {
      ok: true,
      json: async () => ({
        mode: 'RA',
        assets: {
          'public/database/RA/1.mp3': { key: 'media/sha256/1.mp3' },
          'public/database/RA/2.mp3': { key: 'media/sha256/2.mp3' }
        }
      })
    };
  };

  // Dispatch 5 concurrent requests simultaneously
  const results = await Promise.all([
    resolver.resolveAudioUrl('/database/RA/1.mp3', { config: testConfig }),
    resolver.resolveAudioUrl('/database/RA/2.mp3', { config: testConfig }),
    resolver.resolveAudioUrl('/database/RA/1.mp3', { config: testConfig }),
    resolver.resolveAudioUrl('/database/RA/2.mp3', { config: testConfig }),
    resolver.resolveAudioUrl('/database/RA/1.mp3', { config: testConfig })
  ]);

  assert.equal(fetchCount, 1, 'Exactly one network fetch occurred for concurrent requests');
  assert.equal(results[0], 'https://storage.googleapis.com/test-bucket/media/sha256/1.mp3');
  assert.equal(results[1], 'https://storage.googleapis.com/test-bucket/media/sha256/2.mp3');
});

test('MediaUrlResolver: remote-with-fallback falls back to legacy path and emits observable event', async () => {
  const { resolver, context, customEvents, warnings } = createResolverContext();

  const testConfig = {
    publicationId: 'pilot-test',
    deliveryBaseUrl: 'https://storage.googleapis.com/test-bucket/',
    modes: {
      SST: { state: 'remote-with-fallback' }
    }
  };

  // Shard has empty assets
  context.fetch = async () => ({
    ok: true,
    json: async () => ({ mode: 'SST', assets: {} })
  });

  const path = '/database/SST/audio/1/missing_audio.mp3';
  const resolved = await resolver.resolveAudioUrl(path, { config: testConfig });

  assert.equal(resolved, path, 'Fell back to local path');
  assert.ok(warnings.some(w => w.includes('Fallback to legacy path for')), 'Logged warning');
  assert.equal(customEvents.length, 1, 'Dispatched CustomEvent');
  assert.equal(customEvents[0].type, 'bel:media-fallback');
  assert.equal(customEvents[0].detail.logicalPath, path);
  assert.equal(customEvents[0].detail.mode, 'SST');
});

test('MediaUrlResolver: remote-only rejects unmapped assets without fallback', async () => {
  const { resolver, context } = createResolverContext();

  const testConfig = {
    publicationId: 'pilot-test',
    deliveryBaseUrl: 'https://storage.googleapis.com/test-bucket/',
    modes: {
      RA: { state: 'remote-only' }
    }
  };

  context.fetch = async () => ({
    ok: true,
    json: async () => ({ mode: 'RA', assets: {} })
  });

  await assert.rejects(
    () => resolver.resolveAudioUrl('/database/RA/unmapped.mp3', { config: testConfig }),
    /Remote resolution failed in remote-only mode/
  );
});

test('MediaUrlResolver: abort signal cancels in-flight resolution', async () => {
  const { resolver, context } = createResolverContext();

  const testConfig = {
    publicationId: 'pilot-test',
    deliveryBaseUrl: 'https://storage.googleapis.com/test-bucket/',
    modes: {
      RA: { state: 'remote-only' }
    }
  };

  context.fetch = async () => {
    await new Promise(r => setTimeout(r, 50));
    return { ok: true, json: async () => ({ mode: 'RA', assets: {} }) };
  };

  const controller = new AbortController();
  const promise = resolver.resolveAudioUrl('/database/RA/test.mp3', {
    config: testConfig,
    signal: controller.signal
  });

  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
});

test('MediaUrlResolver: falls back to local same-origin shard when remote bucket shard fetch fails', async () => {
  const { resolver, context } = createResolverContext();

  const testConfig = {
    publicationId: 'pub-test',
    deliveryBaseUrl: 'https://storage.googleapis.com/test-bucket/',
    modes: {
      'Entrance-Test': { state: 'remote-only', shardKey: 'catalogs/pub-test/Entrance-Test.json' }
    }
  };

  const mockLocalShard = {
    mode: 'Entrance-Test',
    assets: {
      'public/database/Entrance Test/Listening Q2.mp3': {
        key: 'media/sha256/7faae63f5f8abe88694547aada408c98e24e4d12bcf7196c070f3e71e60ddba2.mp3'
      }
    }
  };

  const fetchedUrls = [];
  context.fetch = async (url) => {
    fetchedUrls.push(url);
    if (url.startsWith('https://storage.googleapis.com/')) {
      // Simulate CORS block or network failure on remote bucket
      throw new Error('Failed to fetch (CORS block)');
    }
    if (url === '/catalogs/pub-test/Entrance-Test.json') {
      return {
        ok: true,
        json: async () => mockLocalShard
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const resolved = await resolver.resolveAudioUrl('/database/Entrance Test/Listening Q2.mp3', {
    config: testConfig,
    mode: 'Entrance-Test'
  });

  assert.equal(
    resolved,
    'https://storage.googleapis.com/test-bucket/media/sha256/7faae63f5f8abe88694547aada408c98e24e4d12bcf7196c070f3e71e60ddba2.mp3'
  );
  assert.equal(fetchedUrls.length, 3, '2 attempts on remote URL + 1 local fallback attempt');
  assert.equal(fetchedUrls[0], 'https://storage.googleapis.com/test-bucket/catalogs/pub-test/Entrance-Test.json');
  assert.equal(fetchedUrls[1], 'https://storage.googleapis.com/test-bucket/catalogs/pub-test/Entrance-Test.json');
  assert.equal(fetchedUrls[2], '/catalogs/pub-test/Entrance-Test.json');
});

