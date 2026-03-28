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
      <title>Pronounce Mode Syllable Playback Harness</title>
    </head>
    <body>
      <button id="tab-pronounce" class="tab-btn">Pronounce</button>
      <div id="mode-pronounce" class="mode-panel" style="display:block;">
        <button id="pa-record-btn">Record</button>
        <button id="pa-stop-btn" disabled>Stop</button>
        <div id="pa-status"></div>
        <div id="pa-spinner" style="display:none;"></div>
        <div id="pa-results-summary"></div>
        <input id="pa-word-input" value="photograph">
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
        <div id="pa-feedback-section" style="display:none;">
          <div class="pa-feedback-header">
            <h3>Detailed Analysis</h3>
            <div id="pa-syllable-tabs"></div>
          </div>
          <div id="pa-feedback-content"></div>
        </div>
        <button id="pa-search-btn"></button>
      </div>
      <script type="module" src="/pronunciation-analyzer/main.js"></script>
    </body>
  </html>`;
}

function startServer() {
  const app = express();
  app.use(express.static('public'));
  app.get('/pronounce-playback-harness', (_req, res) => {
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
    window.__playbackMetrics = {
      segmentStarts: [],
      htmlAudioSeeks: []
    };

    class FakeChart {
      constructor(_canvas, config) {
        this.data = config?.data || { labels: [], datasets: [] };
      }

      destroy() {}

      update() {}
    }

    class FakeAudioContext {
      constructor() {
        this.sampleRate = 44100;
        this.state = 'running';
        this.destination = { id: 'fake-destination' };
      }

      async resume() {
        this.state = 'running';
      }

      async decodeAudioData() {
        const samples = new Float32Array(44100);
        for (let index = 0; index < samples.length; index += 1) {
          samples[index] = Math.sin((2 * Math.PI * 220 * index) / this.sampleRate) * 0.16;
        }
        return {
          duration: 1.0,
          sampleRate: this.sampleRate,
          length: samples.length,
          getChannelData: () => samples
        };
      }

      createBufferSource() {
        return {
          buffer: null,
          onended: null,
          connect() {},
          disconnect() {},
          start: (_when, offset, duration) => {
            window.__playbackMetrics.segmentStarts.push({ offset, duration });
          },
          stop() {}
        };
      }
    }

    class FakeAudio {
      constructor(src = '') {
        this.src = src;
        this._currentTime = 0;
        this._listeners = new Map();
      }

      addEventListener(event, handler) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(handler);
      }

      removeEventListener(event, handler) {
        this._listeners.get(event)?.delete(handler);
      }

      load() {
        const handlers = Array.from(this._listeners.get('canplaythrough') || []);
        setTimeout(() => handlers.forEach((handler) => handler()), 0);
      }

      pause() {}

      play() {
        return Promise.resolve();
      }

      get currentTime() {
        return this._currentTime;
      }

      set currentTime(value) {
        this._currentTime = value;
        window.__playbackMetrics.htmlAudioSeeks.push(value);
      }
    }

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
      }

      stop() {
        if (this.state !== 'recording') {
          throw new Error('MediaRecorder.stop called while inactive');
        }

        this.state = 'inactive';

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
    window.Audio = FakeAudio;
    window.MediaRecorder = FakeMediaRecorder;
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
            pronunciation: "photograph",
            syllableCount: 3,
            stressedSyllable: 0,
            definition: 'camera picture word',
            audioUrl: 'https://example.com/native-photograph.mp3'
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/dictionary/')) {
        return new Response(JSON.stringify({
          found: true,
          pronunciation: "fotegraf",
          syllableCount: 3,
          stressedSyllable: 0,
          alternatives: [{
            pronunciation: "fotegraf",
            syllableCount: 3,
            stressedSyllable: 0,
            definition: 'camera picture word',
            audioUrl: 'https://example.com/native-photograph.mp3'
          }]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/analyze-url')) {
        return new Response(JSON.stringify({
          duration: 0.82,
          syllables: [
            { startTime: 0.12, endTime: 0.30, duration: 0.18, vowelDuration: 0.15, maxPitch: 188, intensity: 78, isStressed: true },
            { startTime: 0.30, endTime: 0.46, duration: 0.16, vowelDuration: 0.12, maxPitch: 150, intensity: 63, isStressed: false },
            { startTime: 0.46, endTime: 0.74, duration: 0.28, vowelDuration: 0.24, maxPitch: 128, intensity: 57, isStressed: false }
          ],
          pitch: {
            times: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
            values: [null, 188, 180, 150, 146, 132, 128, 120]
          },
          intensity: {
            times: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
            values: [42, 78, 74, 63, 61, 57, 55, 50]
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/analyze') && !url.includes('/analyze-url')) {
        return new Response(JSON.stringify({
          duration: 0.80,
          syllables: [
            { startTime: 0.08, endTime: 0.28, duration: 0.20, vowelDuration: 0.17, maxPitch: 182, intensity: 72 },
            { startTime: 0.28, endTime: 0.45, duration: 0.17, vowelDuration: 0.13, maxPitch: 148, intensity: 60 },
            { startTime: 0.45, endTime: 0.78, duration: 0.33, vowelDuration: 0.27, maxPitch: 122, intensity: 54 }
          ],
          pitch: {
            times: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
            values: [null, 182, 170, 148, 144, 128, 122, 118]
          },
          intensity: {
            times: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
            values: [40, 72, 70, 60, 58, 54, 52, 48]
          },
          quality: {
            rateable: true,
            reason: null,
            metrics: {
              peakEnergy: 0.25,
              activeSpeechDurationMs: 700,
              voicedFrameRatio: 1,
              activeFrameCount: 20
            }
          }
        }), {
          status: 200,
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
      body: 'export function YIN() { return () => 220; }'
    });
  });

  await context.route('**/proxy-audio*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: 'fake-mp3-data'
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
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  try {
    await page.goto(`${origin}/pronounce-playback-harness`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('pa-pattern-display')?.textContent.includes('3 Syllables'), { timeout: 30000 });

    await page.click('#pa-record-btn');
    await page.waitForFunction(() => document.getElementById('pa-status')?.textContent.includes('Recording'), { timeout: 30000 });
    await page.click('#pa-stop-btn');

    await page.waitForSelector('#pa-feedback-section', { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('pa-feedback-section')?.style.display === 'block', { timeout: 30000 });
    await page.click('#pa-syllable-tabs .pa-syl-tab:nth-child(2)');
    await page.click('#pa-feedback-syl-1 .pa-play-syl-btn');
    await page.waitForTimeout(100);

    const playback = await page.evaluate(() => ({
      segmentStarts: window.__playbackMetrics.segmentStarts,
      htmlAudioSeeks: window.__playbackMetrics.htmlAudioSeeks
    }));

    assert.equal(playback.segmentStarts.length, 1, 'Expected precise segment playback for the chosen syllable');
    assert.equal(playback.htmlAudioSeeks.length, 0, 'Expected no coarse HTML audio seeking when precise playback is available');
    assert(Math.abs(playback.segmentStarts[0].offset - 0.30) < 0.001, `Expected syllable playback to start at 0.30s, got ${playback.segmentStarts[0].offset}`);
    assert(Math.abs(playback.segmentStarts[0].duration - 0.16) < 0.001, `Expected syllable playback duration to be 0.16s, got ${playback.segmentStarts[0].duration}`);
    assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join('\n')}`);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    server.close();
  }
}

run().then(() => {
  console.log('pronounce-mode syllable playback check passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
