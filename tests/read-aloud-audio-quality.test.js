/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const {
  analyzeAudioQuality
} = require(path.join(process.cwd(), 'src/read-aloud/audio-quality.js'));
const {
  loadAudioQualityThresholds
} = require(path.join(process.cwd(), 'src/read-aloud/audio-quality-thresholds.js'));

function createMonoPcmWavBuffer({ sampleRate = 16000, durationMs = 260, amplitude = 1200 } = {}) {
  const sampleCount = Math.max(1, Math.round(sampleRate * (durationMs / 1000)));
  const dataLength = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(amplitude, 44 + (index * 2));
  }
  return buffer;
}

(async () => {
  const thresholds = loadAudioQualityThresholds();
  assert.strictEqual(thresholds.version, 'aq-v1', 'threshold config should load from the shared JSON file');
  assert.strictEqual(thresholds.minimumContainerDurationMs, 100, 'threshold config should expose the container-duration gate');

  const clippedAudio = analyzeAudioQuality(createMonoPcmWavBuffer({ durationMs: 260, amplitude: 32767 }));
  assert.strictEqual(clippedAudio.passed, false, 'clipped audio should fail quality checks');
  assert.strictEqual(clippedAudio.reason, 'clipped', 'clipped audio should map to the clipped reason');

  const cleanAudio = analyzeAudioQuality(createMonoPcmWavBuffer({ durationMs: 260, amplitude: 1200 }));
  assert.strictEqual(cleanAudio.passed, true, 'clean audio should pass quality checks');
  assert.strictEqual(cleanAudio.reason, null, 'clean audio should have no failure reason');

  console.log('read-aloud audio quality tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
