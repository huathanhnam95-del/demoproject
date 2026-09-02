import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAudioCapture,
  encodeAudioBufferToWav,
  prepareWavBlob,
} from '../../public/js/echo-forge/adapters/audio-capture-adapter.js';
import { createAnalysisClient } from '../../public/js/echo-forge/adapters/analysis-client.js';
import { createAudioPromptAdapter } from '../../public/js/echo-forge/adapters/audio-prompt-adapter.js';

const catalog = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../public/database/echo-forge/challenges.v1.json', import.meta.url), 'utf8'));

function audioManifestForCatalog(overrides = {}) {
  return {
    schemaVersion: 'echo-forge-audio-manifest-v1',
    audioVersion: 'v1',
    contentVersion: catalog.contentVersion,
    locale: catalog.locale,
    catalogSourceSha256: catalog.sourceSha256,
    sourceSha256: catalog.sourceSha256,
    provider: 'kokoro',
    providerRevision: 'kokoro-v1',
    generatorRevision: 'echo-forge-listening-audio-v1',
    generatedAt: '2026-08-25T00:00:00.000Z',
    model: { id: 'kokoro', sha256: 'a'.repeat(64) },
    voice: { id: 'af_heart', sha256: 'b'.repeat(64) },
    provenance: { license: 'Apache-2.0' },
    entries: catalog.challenges.filter((challenge) => challenge.unitType === 'listening').map((challenge) => ({
      challengeId: challenge.challengeId,
      level: challenge.level,
      sourceId: challenge.provenance.sourceId,
      contentHash: challenge.contentHash,
      audioIdentitySha256: challenge.audio.identitySha256,
      path: `/database/echo-forge/audio/v1/${challenge.level.toLowerCase()}/listening/${challenge.challengeId.slice(-3)}.wav`,
      sha256: 'c'.repeat(64),
      byteLength: 100,
      durationMs: 100,
      artifactStatus: 'generated',
      status: 'verified',
      reviewStatus: 'automated_verified',
      reviewMethod: 'structural_audio_validation',
      ...overrides,
    })),
  };
}

test('audio prompt adapter validates the manifest, hashes same-origin bytes, caches, and prevents overlap', async () => {
  const challenge = catalog.challenges.find((item) => item.challengeId === 'ef-a1-listening-001');
  const bytes = new Uint8Array([82, 73, 70, 70]);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const expectedHash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const manifest = audioManifestForCatalog({ sha256: expectedHash });
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('audio-manifest.v1.json')) return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } });
    return new Response(bytes, { headers: { 'content-type': 'audio/wav' } });
  };
  const urls = { created: [], revoked: [] };
  class FakeAudio {
    static instances = [];
    constructor() { this.listeners = {}; this.paused = true; FakeAudio.instances.push(this); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    removeEventListener(type) { delete this.listeners[type]; }
    async play() { this.paused = false; return undefined; }
    pause() { this.paused = true; this.pauseCount = (this.pauseCount || 0) + 1; }
    load() {}
    end() { this.listeners.ended?.(); }
  }
  const adapter = createAudioPromptAdapter({
    fetchImpl,
    AudioClass: FakeAudio,
    URLApi: { createObjectURL: (blob) => { const url = `blob:test-${urls.created.length}`; urls.created.push({ url, blob }); return url; }, revokeObjectURL: (url) => urls.revoked.push(url) },
    cryptoImpl: crypto,
    manifestUrl: '/database/echo-forge/audio-manifest.v1.json',
  });
  await adapter.load(catalog);
  assert.equal(adapter.isReady(), true);
  const firstPlay = adapter.play(challenge);
  const firstOutcome = firstPlay.catch((error) => error);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(FakeAudio.instances.length, 1);
  const secondPlay = adapter.play(challenge);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match((await firstOutcome).name, /AbortError/);
  FakeAudio.instances.at(-1).end();
  await secondPlay;
  assert.equal(calls.filter((url) => url.endsWith('.wav')).length, 1, 'audio bytes should be cached');
  assert.equal(FakeAudio.instances[0].pauseCount, 1, 'a new play cancels the active element');
  assert.equal(urls.created.length, 1);
  adapter.dispose();
  assert.deepEqual(urls.revoked, urls.created.map((entry) => entry.url));
});

test('audio prompt adapter fails closed for traversal or external paths and stale cancelled playback', async () => {
  const challenge = catalog.challenges.find((item) => item.challengeId === 'ef-a1-listening-001');
  const manifest = audioManifestForCatalog({ path: 'https://evil.test/audio.wav' });
  const adapter = createAudioPromptAdapter({
    fetchImpl: async () => new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }),
    AudioClass: class {},
    cryptoImpl: crypto,
    manifestUrl: '/database/echo-forge/audio-manifest.v1.json',
  });
  await assert.rejects(() => adapter.load(catalog), /same-origin|external|path|URL/i);

  const safeManifest = audioManifestForCatalog();
  safeManifest.entries[0].path = '/database/echo-forge/audio/v1/a1/listening/001.wav';
  let resolveBytes;
  const pending = new Promise((resolve) => { resolveBytes = resolve; });
  const cancelAdapter = createAudioPromptAdapter({
    fetchImpl: async (url) => {
      if (String(url).endsWith('audio-manifest.v1.json')) return new Response(JSON.stringify(safeManifest), { headers: { 'content-type': 'application/json' } });
      return pending;
    },
    AudioClass: class {},
    cryptoImpl: crypto,
    manifestUrl: '/database/echo-forge/audio-manifest.v1.json',
  });
  await cancelAdapter.load(catalog);
  const play = cancelAdapter.play(challenge);
  cancelAdapter.cancel();
  resolveBytes(new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } }));
  await assert.rejects(() => play, /cancel|stale|abort/i);
});

test('audio prompt adapter aborts a pending audio fetch when cancelled', async () => {
  const challenge = catalog.challenges.find((item) => item.challengeId === 'ef-a1-listening-001');
  const manifest = audioManifestForCatalog();
  let audioSignal;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('audio-manifest.v1.json')) {
      return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } });
    }
    audioSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    });
  };
  const adapter = createAudioPromptAdapter({
    fetchImpl,
    AudioClass: class {},
    cryptoImpl: crypto,
    manifestUrl: '/database/echo-forge/audio-manifest.v1.json',
  });
  await adapter.load(catalog);
  const play = adapter.play(challenge);
  adapter.cancel();
  assert.equal(audioSignal?.aborted, true);
  await assert.rejects(() => play, /AbortError|cancel/i);
});

test('WAV encoder writes a mono PCM header and prepareWavBlob preserves WAV input', async () => {
  const buffer = { sampleRate: 16000, getChannelData: () => new Float32Array([0, 0.5, -0.5]) };
  const wav = encodeAudioBufferToWav(buffer);
  assert.equal(wav.type, 'audio/wav');
  const bytes = new Uint8Array(await wav.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WAVE');
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 16000);
  assert.equal(await prepareWavBlob(wav), wav);
});

test('audio capture owns microphone lifecycle and returns redacted technical metadata', async () => {
  let trackStopped = false;
  const stream = { getTracks: () => [{ stop: () => { trackStopped = true; } }] };
  class FakeRecorder {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/wav'; this.listeners = {}; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.listeners.dataavailable({ data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }) });
      this.listeners.stop();
    }
  }
  const times = [100, 350];
  const capture = createAudioCapture({
    mediaDevices: { getUserMedia: async () => stream },
    MediaRecorderClass: FakeRecorder,
    clock: () => times.shift(),
  });
  await capture.start();
  assert.equal(capture.state, 'recording');
  const result = await capture.stop();
  assert.equal(result.durationMs, 250);
  assert.equal(result.byteCount, 3);
  assert.equal(result.blob.type, 'audio/wav');
  assert.equal(trackStopped, true);
  assert.equal(capture.state, 'stopped');
});

test('audio capture fails closed when microphone permission is denied', async () => {
  const capture = createAudioCapture({
    mediaDevices: { getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); } },
    MediaRecorderClass: class {},
  });
  await assert.rejects(() => capture.start(), /denied/);
  assert.equal(capture.state, 'idle');
  capture.cancel();
  assert.equal(capture.state, 'cancelled');
});

test('analysis client builds Azure and V3 requests and returns normalized results only', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('/analyze/v3')) {
      return {
        ok: true, status: 200, json: async () => ({ verification: {
          status: 'verified',
          count: { status: 'verified', expected: 2, observed: 2, reasons: [] },
          primary_stress: { applicable: true, status: 'verified', matches_expected: true, reasons: [] },
          model_revision: 'model-v1',
        } }),
      };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ success: true, accuracyScore: 90 }),
    };
  };
  const clockValues = [0, 10, 14, 15, 20, 30, 33, 35];
  const client = createAnalysisClient({ fetchImpl, v3BaseUrl: 'http://127.0.0.1:8081', clock: () => clockValues.shift() });
  const blob = new Blob([new Uint8Array([1])], { type: 'audio/wav' });
  const azureChallenge = {
    challengeId: 'ef-a1-azure-word-001', text: 'hello', evaluationMode: 'azure_word', unitType: 'word',
    pronunciation: { variantId: 'hello-v1', ipa: '/həˈloʊ/' },
  };
  const azure = await client.analyze({ blob, challenge: azureChallenge });
  assert.equal(azure.analysis.score, 90);
  assert.equal('raw' in azure, false);
  assert.equal(calls[0].url, '/api/echo-forge/assess');
  assert.equal(calls[0].options.body.get('challengeId'), 'ef-a1-azure-word-001');
  assert.equal(calls[0].options.body.get('evaluationMode'), 'azure_word');
  assert.equal(calls[0].options.body.get('referenceText'), 'hello');

  const v3Challenge = {
    challengeId: 'ef-a1-v3-word-001', text: 'apple', evaluationMode: 'v3_word', unitType: 'word',
    pronunciation: { variantId: 'apple-v1', ipa: '/ˈæpəl/', expectedSyllableCount: 2 },
  };
  const v3 = await client.analyze({ blob, challenge: v3Challenge });
  assert.equal(v3.analysis.score, 100);
  assert.equal(calls[1].url, 'http://127.0.0.1:8081/analyze/v3');
  assert.equal(calls[1].options.body.get('target_word'), 'apple');
  assert.equal(calls[1].options.body.get('expected_syllables'), '2');
});

test('V3 phrase rejection happens before networking and transport errors normalize to no-op statuses', async () => {
  let calls = 0;
  const client = createAnalysisClient({
    fetchImpl: async () => { calls += 1; throw new TypeError('network down'); },
    v3BaseUrl: 'http://127.0.0.1:8081',
  });
  const blob = new Blob([new Uint8Array([1])], { type: 'audio/wav' });
  await assert.rejects(() => client.analyze({
    blob,
    challenge: {
      challengeId: 'bad', text: 'two words', evaluationMode: 'v3_word', unitType: 'phrase',
      pronunciation: { variantId: 'bad', ipa: '/tu wɝdz/' },
    },
  }), /word|phrase/);
  assert.equal(calls, 0);

  const unavailable = await client.analyze({
    blob,
    challenge: {
      challengeId: 'ef-a1-azure-word-001', text: 'hello', evaluationMode: 'azure_word', unitType: 'word',
      pronunciation: { variantId: 'hello-v1', ipa: '/həˈloʊ/' },
    },
  });
  assert.equal(unavailable.analysis.status, 'unavailable');
  assert.equal(unavailable.analysis.score, null);
  assert.equal(calls, 1);
});
