import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAudioCapture,
  encodeAudioBufferToWav,
  prepareWavBlob,
} from '../../public/js/echo-forge/adapters/audio-capture-adapter.js';
import { createAnalysisClient } from '../../public/js/echo-forge/adapters/analysis-client.js';

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
