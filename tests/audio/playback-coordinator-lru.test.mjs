'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { LruAudioBufferCache } from '../../public/js/audio/segment-playback-coordinator.js';

function createMockBuffer(length, channels = 1, sampleRate = 16000) {
  return {
    length,
    numberOfChannels: channels,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: () => new Float32Array(length)
  };
}

test('LruAudioBufferCache: enforces maxEntries limit', () => {
  const cache = new LruAudioBufferCache({ maxEntries: 3, maxBytes: 100 * 1024 * 1024 });

  const buf1 = createMockBuffer(16000); // 1s = 64KB
  const buf2 = createMockBuffer(16000);
  const buf3 = createMockBuffer(16000);
  const buf4 = createMockBuffer(16000);

  cache.set('url-1', buf1);
  cache.set('url-2', buf2);
  cache.set('url-3', buf3);
  assert.equal(cache.cache.size, 3);
  assert.equal(cache.get('url-1'), buf1);

  // Adding 4th item evicts url-2 (since url-1 was just accessed)
  cache.set('url-4', buf4);
  assert.equal(cache.cache.size, 3);
  assert.equal(cache.get('url-2'), null); // Evicted!
  assert.equal(cache.get('url-1'), buf1);
  assert.equal(cache.get('url-4'), buf4);
});

test('LruAudioBufferCache: enforces maxBytes ceiling', () => {
  // 1s mono 16kHz = 16000 * 4 = 64,000 bytes. Set budget to 150,000 bytes (~2 buffers max)
  const cache = new LruAudioBufferCache({ maxEntries: 10, maxBytes: 150000 });

  const buf1 = createMockBuffer(16000);
  const buf2 = createMockBuffer(16000);
  const buf3 = createMockBuffer(16000);

  cache.set('url-1', buf1); // 64,000 bytes
  cache.set('url-2', buf2); // 128,000 bytes
  assert.equal(cache.cache.size, 2);

  // Adding buf3 would exceed 150,000 bytes -> evicts oldest (url-1)
  cache.set('url-3', buf3);
  assert.equal(cache.cache.size, 2);
  assert.equal(cache.get('url-1'), null);
  assert.equal(cache.get('url-2'), buf2);
  assert.equal(cache.get('url-3'), buf3);
});

test('LruAudioBufferCache: respects pinned active playback', () => {
  const cache = new LruAudioBufferCache({ maxEntries: 2, maxBytes: 100 * 1024 * 1024 });

  const buf1 = createMockBuffer(16000);
  const buf2 = createMockBuffer(16000);
  const buf3 = createMockBuffer(16000);

  cache.set('url-1', buf1);
  cache.set('url-2', buf2);

  // Pin url-1 because it is currently playing
  cache.pin('url-1', true);

  // Adding 3rd item should evict url-2 even though url-1 is older!
  cache.set('url-3', buf3);
  assert.equal(cache.get('url-1'), buf1); // Retained because pinned!
  assert.equal(cache.get('url-2'), null); // Evicted!
  assert.equal(cache.get('url-3'), buf3);
});

test('LruAudioBufferCache: ignores buffer larger than maxBytes budget', () => {
  const cache = new LruAudioBufferCache({ maxEntries: 3, maxBytes: 1000 });
  const giantBuf = createMockBuffer(16000); // 64,000 bytes > 1,000 bytes
  cache.set('giant-url', giantBuf);
  assert.equal(cache.get('giant-url'), null);
  assert.equal(cache.currentBytes, 0);
});
