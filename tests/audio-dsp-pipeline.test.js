/* eslint-disable no-console */
const assert = require('assert');
require('../public/js/audio-dsp-pipeline.js');

const pipeline = globalThis.AudioDspPipeline;
assert(pipeline, 'AudioDspPipeline must be available on globalThis');
assert(typeof pipeline.enhance === 'function', 'enhance must be a function');
assert(typeof pipeline.createRecorder === 'function', 'createRecorder must be a function');
assert(typeof pipeline.detectSpeechBoundaries === 'function', 'detectSpeechBoundaries must be a function');
assert(typeof pipeline.trimSilence === 'function', 'trimSilence must be a function');
assert(typeof pipeline.encodeAudioBufferToWav === 'function', 'encodeAudioBufferToWav must be a function');

// Test 1: detectSpeechBoundaries with synthetic audio
const sampleRate = 16000;
const totalSeconds = 3;
const totalSamples = sampleRate * totalSeconds;
const channelData = new Float32Array(totalSamples);

// Silence for first 1s (0 to 16000)
// Speech (sine wave at 440 Hz, amp 0.5) from 1.0s to 2.0s (16000 to 32000)
for (let i = 16000; i < 32000; i++) {
  channelData[i] = 0.5 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
}
// Silence for last 1s (32000 to 48000)

const boundaries = pipeline.detectSpeechBoundaries(channelData, sampleRate);
assert(boundaries !== null, 'Speech boundaries must be detected');
assert(boundaries.firstSampleIndex >= 15000 && boundaries.firstSampleIndex <= 17000, `firstSampleIndex (${boundaries.firstSampleIndex}) should be near 16000`);
assert(boundaries.lastSampleIndex >= 31000 && boundaries.lastSampleIndex <= 33000, `lastSampleIndex (${boundaries.lastSampleIndex}) should be near 32000`);
assert(boundaries.speechDurationMs >= 900 && boundaries.speechDurationMs <= 1100, `speechDurationMs (${boundaries.speechDurationMs}) should be near 1000ms`);

// Test 2: detectSpeechBoundaries with pure silence
const silentData = new Float32Array(16000);
const silentBoundaries = pipeline.detectSpeechBoundaries(silentData, sampleRate);
assert.strictEqual(silentBoundaries, null, 'Pure silence should return null boundaries');

// Test 3: encodeAudioBufferToWav
const mockBuffer = {
  sampleRate: 16000,
  numberOfChannels: 1,
  length: 1600, // 100ms
  getChannelData: (ch) => new Float32Array(1600)
};
const wavBlob = pipeline.encodeAudioBufferToWav(mockBuffer);
assert(wavBlob, 'WAV blob should be created');
assert.strictEqual(wavBlob.type, 'audio/wav', 'WAV blob type must be audio/wav');
assert.strictEqual(wavBlob.size, 44 + 1600 * 2, 'WAV blob size must equal 44-byte header + 3200 bytes PCM data');

console.log('AudioDspPipeline unit tests passed successfully!');
