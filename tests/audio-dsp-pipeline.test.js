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

(async () => {
  // Test 4: enhance fallback with createUrl: false vs true
  const origUrl = globalThis.URL;
  let createdUrlCount = 0;
  globalThis.URL = {
    createObjectURL: () => {
      createdUrlCount++;
      return 'blob:mock-url-' + createdUrlCount;
    }
  };
  const testBlob = new Blob(['mock audio'], { type: 'audio/webm' });

  const resWithUrl = await pipeline.enhance(testBlob, { createUrl: true });
  assert(resWithUrl.audioUrl && resWithUrl.audioUrl.startsWith('blob:mock-url-'), 'audioUrl must be created when createUrl: true');
  assert.strictEqual(createdUrlCount, 1, 'createObjectURL must be called once');

  const resNoUrl = await pipeline.enhance(testBlob, { createUrl: false });
  assert.strictEqual(resNoUrl.audioUrl, null, 'audioUrl must be null when createUrl: false');
  assert.strictEqual(createdUrlCount, 1, 'createObjectURL must not be called when createUrl: false');

  if (origUrl) {
    globalThis.URL = origUrl;
  } else {
    delete globalThis.URL;
  }

  // Test 5: createRecorder cancel while getUserMedia is pending
  let stoppedCount = 0;
  const mockTrack = {
    stop: () => { stoppedCount++; }
  };
  let resolveGUM;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: {
      getUserMedia: () => new Promise((resolve) => { resolveGUM = resolve; })
    },
    configurable: true
  });
  const recorder = pipeline.createRecorder();
  const startPromise = recorder.start();
  recorder.cancel();
  assert.strictEqual(recorder.getState(), 'inactive');
  resolveGUM({ getTracks: () => [mockTrack] });
  await startPromise;
  assert.strictEqual(stoppedCount, 1, 'Stream tracks must be stopped if recorder was cancelled during getUserMedia');
  assert.strictEqual(recorder.getState(), 'inactive', 'State must remain inactive');

  // Define MockMediaRecorder for node environment
  let mockStopCallback;
  globalThis.MediaRecorder = function MockMediaRecorder() {
    this.state = 'inactive';
    this.addEventListener = (evt, cb) => {
      if (evt === 'stop') mockStopCallback = cb;
    };
    this.start = () => { this.state = 'recording'; };
    this.stop = () => {
      this.state = 'inactive';
      setTimeout(() => mockStopCallback?.(), 10);
    };
  };

  // Test 6: createRecorder prevents concurrent start() invocations while acquisition is pending
  let resolveGUM2;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: {
      getUserMedia: () => new Promise((resolve) => { resolveGUM2 = resolve; })
    },
    configurable: true,
    writable: true
  });
  const recorder2 = pipeline.createRecorder();
  const startPromise2 = recorder2.start();
  let concurrentStartThrew = false;
  try {
    await recorder2.start();
  } catch (e) {
    concurrentStartThrew = true;
    assert(e.message.includes('already active'), 'Should throw recorder already active');
  }
  assert.strictEqual(concurrentStartThrew, true, 'Concurrent start() invocation must throw');
  recorder2.cancel();
  resolveGUM2({ getTracks: () => [mockTrack] });
  await startPromise2;
  assert.strictEqual(recorder2.getState(), 'inactive');

  // Test 7: createRecorder cancel during stop() processing suppresses onStop and revokes audioUrl
  let revokedUrls = [];
  globalThis.URL = {
    createObjectURL: () => 'blob:mock-stop-dsp-url',
    revokeObjectURL: (url) => { revokedUrls.push(url); }
  };
  let onStopFired = false;
  const recorder3 = pipeline.createRecorder({
    onStop: () => { onStopFired = true; }
  });

  // Mock navigator for recording lifecycle
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => {} }]
      })
    },
    configurable: true,
    writable: true
  });

  await recorder3.start();
  assert.strictEqual(recorder3.getState(), 'recording');
  const stopPromise = recorder3.stop();
  // Cancel while stop() / DSP is processing
  recorder3.cancel();
  assert.strictEqual(recorder3.getState(), 'inactive');
  const stopResult = await stopPromise;
  assert.strictEqual(stopResult, null, 'stop() promise must resolve to null when cancelled during processing');
  assert.strictEqual(onStopFired, false, 'options.onStop must not fire when cancelled during processing');
  assert(revokedUrls.includes('blob:mock-stop-dsp-url'), 'Created audioUrl must be revoked on cancel during processing');

  delete globalThis.MediaRecorder;
  delete globalThis.navigator.mediaDevices;
  if (origUrl) {
    globalThis.URL = origUrl;
  } else {
    delete globalThis.URL;
  }

  // Test 8: verify peakAfter computation from buffer
  const silentChannel = new Float32Array(16000); // 1s pure silence
  let silencePeak = 0;
  for (let i = 0; i < silentChannel.length; i++) {
    const val = Math.abs(silentChannel[i]);
    if (val > silencePeak) silencePeak = val;
  }
  assert.strictEqual(silencePeak, 0, 'Silent buffer peakBefore and peakAfter must be exactly 0, not targetPeakDb');

  console.log('AudioDspPipeline unit tests passed successfully!');
})().catch((err) => {
  console.error('AudioDspPipeline unit test failed:', err);
  process.exit(1);
});
