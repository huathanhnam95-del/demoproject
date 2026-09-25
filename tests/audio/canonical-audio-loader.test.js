'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioManifest, CANONICAL_SAMPLE_RATE_HZ } = require('../../functions/src/services/azure-speech/audio-manifest.js');
const BoundedClipPlayer = require('../../public/js/audio/bounded-clip-player.js');

// Mock Web Audio Context & Buffer for Node.js testing
class MockAudioBuffer {
  constructor({ numberOfChannels = 1, length, sampleRate }) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this._data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(c) {
    return this._data[c];
  }
  copyToChannel(source, channel) {
    this._data[channel].set(source);
  }
}

class MockAudioContext {
  createBuffer(channels, length, sampleRate) {
    return new MockAudioBuffer({ numberOfChannels: channels, length, sampleRate });
  }
}

test('AudioManifest: builds deterministic canonical 16 kHz manifest from buffer', () => {
  // 16000 samples at 16-bit mono = 32000 bytes
  const pcmBytes = 32000;
  const rawPcm = Buffer.alloc(pcmBytes);
  const manifest = createAudioManifest(rawPcm, { timelineId: 'tl-test-123', allowRawPcm: true });

  assert.equal(manifest.sampleRateHz, 16000);
  assert.equal(manifest.channels, 1);
  assert.equal(manifest.format, 'pcm_s16le');
  assert.equal(manifest.sampleCount, 16000);
  assert.equal(manifest.timelineId, 'tl-test-123');
  assert.equal(typeof manifest.canonicalFileHash, 'string');
});

test('makeBoundedClip: slices exact canonical sample interval [16000, 24000) at 16 kHz', () => {
  const ctx = new MockAudioContext();
  const sourceBuffer = new MockAudioBuffer({
    numberOfChannels: 1,
    length: 32000,
    sampleRate: 16000
  });

  // Populate synthetic audio data
  const data = sourceBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = i / 32000;
  }

  const manifest = {
    sampleRateHz: 16000,
    sampleCount: 32000,
    channels: 1,
    timelineId: 'tl-1'
  };

  const span = {
    timelineId: 'tl-1',
    startSample: 16000,
    endSample: 24000
  };

  const clip = BoundedClipPlayer.makeBoundedClip(ctx, sourceBuffer, manifest, span);
  assert.equal(clip.length, 8000, 'Clip length must exactly match end - start (0.5s at 16 kHz)');
  assert.equal(clip.sampleRate, 16000);

  const clipData = clip.getChannelData(0);
  assert.ok(Math.abs(clipData[0] - 16000 / 32000) < 1e-6);
  assert.ok(Math.abs(clipData[7999] - 23999 / 32000) < 1e-6);
});

test('makeBoundedClip: strictly rejects decoded buffer with mismatched sample rate (e.g. 48 kHz)', () => {
  const ctx = new MockAudioContext();
  // Browser decodeAudioData resampled to 48 kHz hardware rate
  const resampledBuffer = new MockAudioBuffer({
    numberOfChannels: 1,
    length: 96000,
    sampleRate: 48000
  });

  const manifest = {
    sampleRateHz: 16000,
    sampleCount: 32000,
    channels: 1,
    timelineId: 'tl-1'
  };

  const span = {
    timelineId: 'tl-1',
    startSample: 16000,
    endSample: 24000
  };

  assert.throws(
    () => BoundedClipPlayer.makeBoundedClip(ctx, resampledBuffer, manifest, span),
    /DECODED_AUDIO_MISMATCH/,
    'Must throw DECODED_AUDIO_MISMATCH when sample rate or length differs from canonical manifest'
  );
});

test('makeBoundedClip: rejects out-of-range sample indices', () => {
  const ctx = new MockAudioContext();
  const sourceBuffer = new MockAudioBuffer({
    numberOfChannels: 1,
    length: 16000,
    sampleRate: 16000
  });

  const manifest = {
    sampleRateHz: 16000,
    sampleCount: 16000,
    channels: 1,
    timelineId: 'tl-1'
  };

  assert.throws(
    () => BoundedClipPlayer.makeBoundedClip(ctx, sourceBuffer, manifest, { timelineId: 'tl-1', startSample: -5, endSample: 1000 }),
    /INVALID_CLIP_SPAN/
  );

  assert.throws(
    () => BoundedClipPlayer.makeBoundedClip(ctx, sourceBuffer, manifest, { timelineId: 'tl-1', startSample: 1000, endSample: 20000 }),
    /INVALID_CLIP_SPAN/
  );

  assert.throws(
    () => BoundedClipPlayer.makeBoundedClip(ctx, sourceBuffer, manifest, { timelineId: 'tl-1', startSample: 500, endSample: 500 }),
    /INVALID_CLIP_SPAN/
  );
});

test('makeBoundedClip: requires all inputs and validates timelineId identity', () => {
  const ctx = new MockAudioContext();
  const sourceBuffer = new MockAudioBuffer({ numberOfChannels: 1, length: 16000, sampleRate: 16000 });
  const manifest = { sampleRateHz: 16000, sampleCount: 16000, channels: 1, timelineId: 'tl-abc' };
  const span = { timelineId: 'tl-abc', startSample: 100, endSample: 500 };

  assert.throws(() => BoundedClipPlayer.makeBoundedClip(null, sourceBuffer, manifest, span), /CLIP_INPUT_REQUIRED/);
  assert.throws(() => BoundedClipPlayer.makeBoundedClip(ctx, null, manifest, span), /CLIP_INPUT_REQUIRED/);
  assert.throws(() => BoundedClipPlayer.makeBoundedClip(ctx, sourceBuffer, null, span), /CLIP_INPUT_REQUIRED/);
  assert.throws(() => BoundedClipPlayer.makeBoundedClip(ctx, sourceBuffer, manifest, null), /CLIP_INPUT_REQUIRED/);

  // Timeline mismatch
  assert.throws(
    () => BoundedClipPlayer.makeBoundedClip(ctx, sourceBuffer, manifest, { timelineId: 'tl-xyz', startSample: 100, endSample: 500 }),
    /AUDIO_TIMELINE_MISMATCH/
  );
});

test('AudioManifest: validates inputs and parses WAV RIFF chunks with padding', () => {
  assert.throws(() => createAudioManifest(null), /BUFFER_REQUIRED/);
  assert.throws(() => createAudioManifest(Buffer.alloc(0)), /BUFFER_REQUIRED/);

  // 12 bytes RIFF header + 24 bytes fmt chunk (8 header + 16 payload) + 8 bytes data header + 3200 bytes data payload = 3244 bytes
  const totalWav = Buffer.alloc(12 + 24 + 8 + 3200);
  totalWav.write('RIFF', 0, 'ascii');
  totalWav.writeUInt32LE(totalWav.length - 8, 4);
  totalWav.write('WAVE', 8, 'ascii');

  // fmt chunk (16 bytes payload)
  let pos = 12;
  totalWav.write('fmt ', pos, 'ascii');
  totalWav.writeUInt32LE(16, pos + 4);
  totalWav.writeUInt16LE(1, pos + 8); // PCM format
  totalWav.writeUInt16LE(1, pos + 10); // mono
  totalWav.writeUInt32LE(16000, pos + 12); // 16 kHz
  totalWav.writeUInt32LE(32000, pos + 16); // byte rate
  totalWav.writeUInt16LE(2, pos + 20); // block align
  totalWav.writeUInt16LE(16, pos + 22); // 16-bit
  pos += 24;

  // data chunk
  totalWav.write('data', pos, 'ascii');
  totalWav.writeUInt32LE(3200, pos + 4);

  const manifest = createAudioManifest(totalWav);
  assert.equal(manifest.sampleRateHz, 16000);
  assert.equal(manifest.channels, 1);
  assert.equal(manifest.sampleCount, 1600);
  assert.equal(manifest.format, 'pcm_s16le');
});

test('AudioManifest rejects malformed and 48 kHz WAV before quoting', () => {
  const wav = Buffer.alloc(44 + 3200);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(3200, 40);
  assert.throws(() => createAudioManifest(wav), /INVALID_CANONICAL_AUDIO/);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt32LE(6400, 40);
  assert.throws(() => createAudioManifest(wav), /INVALID_WAV_CHUNK/);
});
