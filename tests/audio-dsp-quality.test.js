'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
require('../public/js/audio-dsp-pipeline.js');
const pipeline = globalThis.AudioDspPipeline;
function pcmWavBytes(samples, sampleRate = 16000, metadata = null) {
  const pcm = new Uint8Array(samples.length * 2); const pcmView = new DataView(pcm.buffer);
  samples.forEach((sample, index) => pcmView.setInt16(index * 2, sample, true));
  const metadataSize = metadata ? 8 + metadata.length + (metadata.length & 1) : 0;
  const bytes = new Uint8Array(44 + metadataSize + pcm.length); const view = new DataView(bytes.buffer);
  const write = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  let cursor = 36;
  if (metadata) { write(cursor, 'JUNK'); view.setUint32(cursor + 4, metadata.length, true); bytes.set(metadata, cursor + 8); cursor += metadataSize; }
  write(cursor, 'data'); view.setUint32(cursor + 4, pcm.length, true); bytes.set(pcm, cursor + 8);
  return { bytes, pcm };
}
async function sha256(value) { const { createHash } = require('node:crypto'); return createHash('sha256').update(Buffer.from(value)).digest('hex'); }
test('isValidMono16kWav accepts only the strict scoring format', async () => {
  const source = pcmWavBytes([-2, -1, 0, 1, 2]);
  const wav = new Blob([source.bytes], { type: 'audio/wav' });
  assert.equal(await pipeline.isValidMono16kWav({ outputBlob: wav, outputMimeType: 'audio/wav', outputFormat: 'wav', fallback: false }), true);
  assert.equal(await pipeline.isValidMono16kWav({ outputBlob: new Blob(['raw'], { type: 'audio/webm' }), outputMimeType: 'audio/webm', outputFormat: 'raw', fallback: true }), false);
});
test('prepareForAssessment preserves canonical PCM samples byte-for-byte', async () => {
  const source = pcmWavBytes([-32768, -1234, -1, 0, 1, 1234, 32767]);
  const raw = new Blob([source.bytes], { type: 'audio/wav' }); const prepared = await pipeline.prepareForAssessment(raw);
  assert.equal(prepared.rawBlob, raw); assert.equal(prepared.outputBlob, raw);
  assert.equal(await sha256((await prepared.outputBlob.arrayBuffer()).slice(44)), await sha256(source.pcm));
  assert.deepEqual(prepared.appliedStages, []); assert.equal(await pipeline.isValidMono16kWav(prepared), true);
});
test('prepareForAssessment rewrites metadata only and preserves PCM payload', async () => {
  const source = pcmWavBytes([-30000, -10, 0, 10, 30000], 16000, Uint8Array.from([1, 2, 3]));
  const raw = new Blob([source.bytes], { type: 'audio/wav' }); const prepared = await pipeline.prepareForAssessment(raw);
  assert.notEqual(prepared.outputBlob, raw); assert.equal(prepared.outputBlob.size, 44 + source.pcm.length);
  assert.equal(await sha256((await prepared.outputBlob.arrayBuffer()).slice(44)), await sha256(source.pcm));
});
test('format conversion failure keeps a non-WAV original capture separate', async () => {
  const raw = new Blob(['original-webm-capture'], { type: 'audio/webm' });
  await assert.rejects(pipeline.prepareForAssessment(raw), error => error.code === 'AUDIO_FORMAT_CONVERSION_FAILED');
  assert.equal(raw.type, 'audio/webm');
  assert.equal(await raw.text(), 'original-webm-capture');
});

test('format conversion decodes, resamples, and encodes a separate scoring WAV', async () => {
  const previousWindow = globalThis.window;
  class MockAudioContext {
    async decodeAudioData() {
      return {
        numberOfChannels: 1,
        length: 4,
        sampleRate: 8000,
        getChannelData: () => Float32Array.from([0.1, 0.2, -0.2, 0.3])
      };
    }
    async close() {}
  }
  try {
    globalThis.window = { AudioContext: MockAudioContext };
    const raw = new Blob(['original-webm-capture'], { type: 'audio/webm' });
    const prepared = await pipeline.prepareForAssessment(raw);
    assert.equal(prepared.rawBlob, raw);
    assert.equal(await raw.text(), 'original-webm-capture');
    assert.equal(prepared.outputFormat, 'wav');
    assert.equal(prepared.outputMimeType, 'audio/wav');
    assert.notEqual(prepared.outputBlob, raw);
    assert.equal(await pipeline.isValidMono16kWav(prepared), true);
    assert.equal(prepared.audioBuffer.sampleRate, 16000);
    assert.equal(prepared.audioBuffer.numberOfChannels, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('raw-only recorder returns the untouched capture without a prepared copy', async () => {
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousMediaRecorder = globalThis.MediaRecorder;
  const track = { stop() {} };
  class MockMediaRecorder {
    static isTypeSupported() { return false; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; this.listeners = {}; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.listeners.dataavailable?.({ data: new Blob(['raw-only-capture'], { type: 'audio/webm' }) });
      setTimeout(() => this.listeners.stop?.(), 0);
    }
  }
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } } });
    globalThis.MediaRecorder = MockMediaRecorder;
    const recorder = pipeline.createRecorder({ audioPreparation: 'raw-only' });
    await recorder.start();
    const result = await recorder.stop();
    assert.equal(result.rawBlob.type, 'audio/webm');
    assert.equal(await result.rawBlob.text(), 'raw-only-capture');
    assert.equal(result.outputBlob, null);
    assert.equal(result.outputFormat, 'raw');
    assert.equal(result.processingStatus, 'raw-only');
  } finally {
    if (previousNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor);
    else delete globalThis.navigator;
    if (previousMediaRecorder === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = previousMediaRecorder;
  }
});

test('format-only recorder rejects an unavailable scoring conversion without losing raw capture', async () => {
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousMediaRecorder = globalThis.MediaRecorder;
  const track = { stop() {} };
  class MockMediaRecorder {
    static isTypeSupported() { return false; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; this.listeners = {}; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.listeners.dataavailable?.({ data: new Blob(['format-only-capture'], { type: 'audio/webm' }) });
      setTimeout(() => this.listeners.stop?.(), 0);
    }
  }
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } } });
    globalThis.MediaRecorder = MockMediaRecorder;
    const recorder = pipeline.createRecorder({ audioPreparation: 'format-only' });
    await recorder.start();
    const result = await recorder.stop();
    assert.equal(result.rawBlob.type, 'audio/webm');
    assert.equal(await result.rawBlob.text(), 'format-only-capture');
    assert.equal(result.outputBlob, null);
    assert.equal(result.outputFormat, 'unavailable');
    assert.equal(result.processingStatus, 'format-conversion-failed');
    assert.match(result.error, /Audio format conversion failed/);
  } finally {
    if (previousNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor);
    else delete globalThis.navigator;
    if (previousMediaRecorder === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = previousMediaRecorder;
  }
});
test('conversion failure keeps the original capture available', async () => {
  const raw = new Blob(['original-webm-capture'], { type: 'audio/webm' }); const before = await raw.text();
  const previousWindow = globalThis.window; class FailingAudioContext { async decodeAudioData() { throw new Error('decoder failure'); } async close() {} }
  try { globalThis.window = { AudioContext: FailingAudioContext }; await assert.rejects(pipeline.prepareForAssessment(raw)); assert.equal(await raw.text(), before); }
  finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});
