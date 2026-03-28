/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const { chromium } = require('playwright');

function buildHarnessHtml() {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Pronounce Mode Harness</title>
    </head>
    <body>
      <button id="tab-pronounce" class="tab-btn">Pronounce</button>
      <div id="mode-pronounce" class="mode-panel" style="display:block;">
        <button id="pa-record-btn">Record</button>
        <button id="pa-stop-btn" disabled>Stop</button>
        <div id="pa-status"></div>
        <div id="pa-spinner" style="display:none;"></div>
        <div id="pa-results-summary"></div>
        <input id="pa-word-input" value="test">
        <div id="pa-ipa-display"></div>
        <div id="pa-pattern-display"></div>
        <div id="pa-word-info"></div>
        <div id="pa-word-forms"></div>
        <div id="pa-loading-placeholder"></div>
        <div id="pa-native-audio-container"><audio id="pa-native-audio"></audio></div>
        <canvas id="pa-pitch-chart" width="900" height="240"></canvas>
        <canvas id="pa-stress-chart" width="900" height="240"></canvas>
        <div id="pa-timeline-container"></div>
        <div id="syllable-verifier-container"></div>
        <button id="pa-search-btn"></button>
      </div>
      <script src="/pronunciation-analyzer/syllable-verifier.js"></script>
      <script type="module" src="/pronunciation-analyzer/main.js"></script>
    </body>
  </html>`;
}

function startServer() {
  const app = express();
  app.use(express.static('public'));
  app.get('/pronounce-harness', (_req, res) => {
    res.type('html').send(buildHarnessHtml());
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

async function run() {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });

  await context.addInitScript(() => {
    window.__pronounceMetrics = {
      recorderStarts: 0,
      recorderStops: 0,
      recorderStopInvocations: 0,
      recorderStopInactiveCalls: 0,
      praatAnalyzeCalls: 0,
      healthChecks: 0
    };

    class FakeChart {
      constructor(_canvas, config) {
        this.data = config?.data || { labels: [], datasets: [] };
        this.options = config?.options || {};
        this.config = config;
      }

      destroy() {}

      update() {}
    }

    class FakeAudioContext {
      constructor() {
        this.sampleRate = 44100;
        this.state = 'running';
      }

      async resume() {
        this.state = 'running';
      }

      async decodeAudioData() {
        const buffer = new Float32Array(44100);
        for (let index = 0; index < buffer.length; index += 1) {
          buffer[index] = Math.sin((2 * Math.PI * 220 * index) / this.sampleRate) * 0.18;
        }
        return {
          sampleRate: this.sampleRate,
          length: buffer.length,
          getChannelData: () => buffer
        };
      }
    }

    function createEmitter() {
      const listeners = new Map();
      return {
        on(event, handler) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(handler);
        },
        off(event, handler) {
          listeners.get(event)?.delete(handler);
        },
        emit(event, ...args) {
          const handlers = Array.from(listeners.get(event) || []);
          handlers.forEach((handler) => handler(...args));
        }
      };
    }

    class FakeAudio {
      constructor(src = '') {
        this.src = src;
        this._currentTime = 0;
        this._emitter = createEmitter();
        this.paused = true;
      }

      addEventListener(event, handler) {
        this._emitter.on(event, handler);
      }

      removeEventListener(event, handler) {
        this._emitter.off(event, handler);
      }

      load() {
        setTimeout(() => this._emitter.emit('canplaythrough'), 0);
      }

      play() {
        this.paused = false;
        return Promise.resolve();
      }

      pause() {
        this.paused = true;
      }

      get currentTime() {
        return this._currentTime;
      }

      set currentTime(value) {
        if (!Number.isFinite(value)) {
          throw new TypeError("The provided double value is non-finite.");
        }
        this._currentTime = value;
      }
    }

    class FakeRegion {
      constructor(wavesurfer, region) {
        this.wavesurfer = wavesurfer;
        this.id = region.id;
        this.start = region.start;
        this.end = region.end;
      }

      play() {
        this.wavesurfer.setTime(this.start);
        this.wavesurfer.play();
      }
    }

    class FakeRegionsPlugin {
      constructor(wavesurfer) {
        this.wavesurfer = wavesurfer;
        this._emitter = createEmitter();
        this._regions = [];
      }

      on(event, handler) {
        this._emitter.on(event, handler);
      }

      addRegion(region) {
        const fakeRegion = new FakeRegion(this.wavesurfer, region);
        this._regions.push(fakeRegion);
        return fakeRegion;
      }

      clearRegions() {
        this._regions = [];
      }

      getRegions() {
        return this._regions.slice();
      }
    }

    class FakeWaveSurfer {
      static create() {
        return new FakeWaveSurfer();
      }

      constructor() {
        this._emitter = createEmitter();
        this._duration = 0;
        this._time = 0;
        this._audioprocessTimer = null;
        this._finishTimer = null;
      }

      registerPlugin(factory) {
        this._regions = factory(this);
        return this._regions;
      }

      on(event, handler) {
        this._emitter.on(event, handler);
      }

      un(event, handler) {
        this._emitter.off(event, handler);
      }

      async load() {
        this._duration = 1.2;
        setTimeout(() => this._emitter.emit('ready'), 0);
      }

      getDuration() {
        return this._duration;
      }

      setPlaybackRate(rate) {
        this._playbackRate = rate;
      }

      setTime(value) {
        this._time = value;
      }

      getCurrentTime() {
        return this._time;
      }

      play() {
        this._emitter.emit('play');
        this._clearPlaybackTimers();
        this._audioprocessTimer = setInterval(() => {
          this._time += 0.05;
          this._emitter.emit('audioprocess');
        }, 10);
        this._finishTimer = setTimeout(() => {
          this._clearPlaybackTimers();
          this._emitter.emit('finish');
        }, 160);
      }

      pause() {
        this._clearPlaybackTimers();
        this._emitter.emit('pause');
      }

      stop() {
        this._time = 0;
        this.pause();
      }

      destroy() {
        this._clearPlaybackTimers();
      }

      _clearPlaybackTimers() {
        if (this._audioprocessTimer) {
          clearInterval(this._audioprocessTimer);
          this._audioprocessTimer = null;
        }
        if (this._finishTimer) {
          clearTimeout(this._finishTimer);
          this._finishTimer = null;
        }
      }
    }

    FakeWaveSurfer.Regions = {
      create() {
        return (wavesurfer) => new FakeRegionsPlugin(wavesurfer);
      }
    };

    class FakeMediaRecorder {
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
        this.ondataavailable = null;
        this.onstop = null;
      }

      start() {
        this.state = 'recording';
        window.__pronounceMetrics.recorderStarts += 1;
      }

      stop() {
        window.__pronounceMetrics.recorderStopInvocations += 1;
        if (this.state !== 'recording') {
          window.__pronounceMetrics.recorderStopInactiveCalls += 1;
          throw new Error('MediaRecorder.stop called while inactive');
        }

        this.state = 'inactive';
        window.__pronounceMetrics.recorderStops += 1;

        const blob = new Blob(['fake-recording'], { type: 'audio/webm' });
        if (typeof this.ondataavailable === 'function') {
          this.ondataavailable({ data: blob });
        }
        if (typeof this.onstop === 'function') {
          this.onstop();
        }
      }
    }

    window.Chart = FakeChart;
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    window.MediaRecorder = FakeMediaRecorder;
    window.Audio = FakeAudio;
    window.WaveSurfer = FakeWaveSurfer;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }]
        })
      }
    });
    window.Logger = {
      log() {},
      warn() {},
      error() {}
    };
    window.Phonetics = {
      getIPA: async () => null
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (resource, init) => {
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('/health')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/dictionary/')) {
        return new Response(JSON.stringify({
          found: true,
          data: {
            pronunciation: 'test',
            syllableCount: 2,
            stressedSyllable: 0,
            definition: 'a simple check',
            audioUrl: 'https://example.com/native-test.mp3'
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/dictionary/')) {
        return new Response(JSON.stringify({
          found: true,
          pronunciation: 'tɛst',
          syllableCount: 2,
          stressedSyllable: 0,
          alternatives: [{
            pronunciation: 'tɛst',
            syllableCount: 2,
            stressedSyllable: 0,
            definition: 'a simple check',
            audioUrl: 'https://example.com/native-test.mp3'
          }]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/analyze-url')) {
        return new Response(JSON.stringify({
          duration: 0.64,
          syllables: [
            {
              startTime: 0.0,
              endTime: 0.29,
              duration: 0.29,
              vowelDuration: 0.24,
              maxPitch: 186,
              intensity: 78
            },
            {
              startTime: 0.29,
              endTime: 0.64,
              duration: 0.35,
              vowelDuration: 0.28,
              maxPitch: 142,
              intensity: 63
            }
          ],
          pitch: {
            times: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
            values: [182, 186, 170, 148, 142, 135]
          },
          intensity: {
            times: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
            values: [74, 78, 72, 66, 63, 60]
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/analyze') && !url.includes('/analyze-url')) {
        window.__pronounceMetrics.praatAnalyzeCalls += 1;
        return new Response(JSON.stringify({
          error: 'Praat failure'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('generativelanguage.googleapis.com')) {
        return new Response(JSON.stringify({
          error: { message: 'disabled in browser test' }
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(resource, init);
    };
  });

  await context.route('https://esm.sh/pitchfinder', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `export function YIN() { return (chunk) => {
        if (!chunk || !chunk.length) return null;
        let sum = 0;
        for (let index = 0; index < chunk.length; index += 1) sum += Math.abs(chunk[index] || 0);
        return sum / chunk.length > 0.01 ? 220 : null;
      }; }`
    });
  });

  await context.route('**/proxy-audio*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: ''
    });
  });

  await context.route('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `export const doc = () => ({});
        export const getDoc = async () => ({ exists: () => false, data: () => null });
        export const setDoc = async () => {};
        export const updateDoc = async () => {};
        export const increment = (value) => value;
        export const serverTimestamp = () => new Date();`
    });
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!text.includes('Failed to load resource')) {
        consoleErrors.push(text);
      }
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  try {
    await page.goto(`${origin}/pronounce-harness`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('pa-pattern-display')?.textContent.includes('Syllables'), { timeout: 30000 });

    await page.click('#pa-record-btn');
    await page.waitForFunction(() => document.getElementById('pa-status')?.textContent.includes('Recording'), { timeout: 30000 });

    await page.evaluate(() => {
      document.getElementById('pa-stop-btn')?.click();
      document.getElementById('pa-stop-btn')?.click();
    });

    await page.waitForFunction(() => document.getElementById('pa-results-summary')?.textContent.includes('Prosody Match Score'), { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('pa-results-summary')?.textContent.includes('Quick Feedback'), { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('pa-results-summary')?.textContent.includes('Main fix:'), { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('pa-results-summary')?.textContent.includes("Coach's Note"), { timeout: 30000 });
    await page.waitForSelector('.sv-btn-compare', { timeout: 30000 });
    await page.click('.sv-btn-compare');
    await page.waitForTimeout(1200);

    const state = await page.evaluate(() => ({
      recorderStarts: window.__pronounceMetrics.recorderStarts,
      recorderStops: window.__pronounceMetrics.recorderStops,
      recorderStopInvocations: window.__pronounceMetrics.recorderStopInvocations,
      recorderStopInactiveCalls: window.__pronounceMetrics.recorderStopInactiveCalls,
      praatAnalyzeCalls: window.__pronounceMetrics.praatAnalyzeCalls,
      statusText: document.getElementById('pa-status')?.textContent || '',
      summaryText: document.getElementById('pa-results-summary')?.textContent || '',
      hasCompareButton: Boolean(document.querySelector('.sv-btn-compare'))
    }));

    assert.equal(state.recorderStarts, 1, 'Expected one MediaRecorder start');
    assert.equal(state.recorderStops, 1, 'Expected a single MediaRecorder stop even with fallback');
    assert.equal(state.recorderStopInvocations, 1, 'Expected only one MediaRecorder.stop invocation');
    assert.equal(state.recorderStopInactiveCalls, 0, 'Expected no stop call on an inactive recorder');
    assert.equal(state.praatAnalyzeCalls, 1, 'Expected one Praat attempt before local fallback');
    assert.equal(state.hasCompareButton, true, 'Expected verifier comparison mode when native timing data is available');
    assert(state.statusText.includes('Idle') || state.statusText.includes('Error'), 'Expected analysis to finish');
    assert(state.summaryText.includes('Prosody Match Score'), 'Expected prosody summary copy');
    assert(state.summaryText.includes('Quick Feedback'), 'Expected condensed feedback section');
    assert(state.summaryText.includes('Main fix:'), 'Expected canonical main fix copy');
    assert(state.summaryText.includes("Coach's Note"), 'Expected teacher-style summary section');
    assert.equal(consoleErrors.length, 0, `Unexpected browser console errors: ${consoleErrors.join('\n')}`);
    assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join('\n')}`);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    server.close();
  }
}

run().then(() => {
  console.log('pronounce-mode browser check passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
