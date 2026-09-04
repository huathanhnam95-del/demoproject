const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { chromium } = require('playwright');

let consoleLines = [];

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (typeof port === 'number') {
          resolve(port);
          return;
        }
        reject(new Error('Failed to allocate free port'));
      });
    });
    server.on('error', reject);
  });
}

async function setupFirebaseMocks(context) {
  await context.route('**/firebase-app.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const initializeApp = () => ({ name: '[DEFAULT]' });
        export const getApp = () => ({ name: '[DEFAULT]' });
      `
    });
  });

  await context.route('**/firebase-auth.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getAuth = () => ({ currentUser: null });
        export const connectAuthEmulator = () => {};
        export const onAuthStateChanged = (_auth, cb) => {
          setTimeout(() => cb(null), 10);
          return () => {};
        };
        export const setPersistence = () => Promise.resolve();
        export const browserLocalPersistence = 'local';
        export const signInWithEmailAndPassword = () => Promise.resolve({ user: {} });
        export const signOut = () => Promise.resolve();
        export const createUserWithEmailAndPassword = () => Promise.resolve({ user: {} });
        export const sendPasswordResetEmail = () => Promise.resolve();
        export const sendEmailVerification = () => Promise.resolve();
      `
    });
  });

  await context.route('**/firebase-firestore.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getFirestore = () => ({ _type: 'firestore' });
        export const connectFirestoreEmulator = () => {};
        export const collection = (db, path) => ({ _type: 'collection', path });
        export const doc = (db, path, ...segments) => ({
          _type: 'doc',
          path: [path, ...segments].filter(Boolean).join('/')
        });
        export const getDoc = async () => ({
          exists: () => false,
          data: () => ({})
        });
        export const getDocs = async () => ({ empty: true, docs: [] });
        export const setDoc = async () => {};
        export const updateDoc = async () => {};
        export const deleteDoc = async () => {};
        export const addDoc = async () => ({ id: 'mock-id' });
        export const query = (ref) => ref;
        export const where = () => ({});
        export const limit = () => ({});
        export const orderBy = () => ({});
        export const serverTimestamp = () => new Date();
        export const increment = (v) => v;
        export const arrayUnion = (...v) => v;
        export const arrayRemove = (...v) => v;
        export const Timestamp = {
          now: () => new Date(),
          fromDate: (d) => d
        };
        export const writeBatch = () => ({
          set: () => {},
          update: () => {},
          commit: async () => {}
        });
        export const runTransaction = async (_db, cb) => cb({
          get: async () => ({ exists: () => false }),
          set: () => {},
          update: () => {}
        });
        export const setLogLevel = () => {};
      `
    });
  });

  await context.route('**/firebase-functions.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getFunctions = () => ({});
        export const connectFunctionsEmulator = () => {};
        export const httpsCallable = () => async () => ({ data: {} });
      `
    });
  });
}

async function clickByScript(page, selector) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.click();
  }, selector);
}

async function mockWorkbookRows(page, rows) {
  await page.evaluate((mockRows) => {
    if (!window.XLSX || !window.XLSX.utils || !window.XLSX.utils.sheet_to_json) {
      throw new Error('XLSX not available for mocking');
    }
    const originalSheetToJson = window.XLSX.utils.sheet_to_json.bind(window.XLSX.utils);
    window.__raMockRows = mockRows;

    window.XLSX.read = () => ({
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          __mockRows: window.__raMockRows
        }
      }
    });

    window.XLSX.utils.sheet_to_json = (worksheet) => {
      if (Array.isArray(worksheet?.__mockRows)) {
        return worksheet.__mockRows.slice();
      }
      return originalSheetToJson(worksheet);
    };
  }, rows);
}

async function assertSharedControllerStructure(page, label) {
  const state = await page.evaluate(() => {
    function describeButton(selector) {
      const el = selector.startsWith('#') || !selector.includes('.')
        ? document.getElementById(selector.replace(/^#/, ''))
        : document.querySelector(selector);
      if (!el) return { exists: false, hasSvg: false, hasDataLabel: false };
      return {
        exists: true,
        hasSvg: !!el.querySelector('svg'),
        hasDataLabel: !!el.querySelector('[data-label]')
      };
    }
    const pill = document.getElementById('spc-picker-read-aloud');
    const select = document.getElementById('ra-question-select');
    const selected = select?.selectedOptions?.length
      ? select.selectedOptions[0]
      : Array.from(select?.options || []).find((opt) => opt.value === select?.value);
    const styleOf = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        minHeight: style.minHeight,
        radius: style.borderRadius,
        backgroundImage: style.backgroundImage
      };
    };
    return {
      legacyPickerBarExists: !!document.getElementById('ra-v7-picker-bar'),
      pillExists: !!pill,
      pillText: String(pill?.textContent || '').trim(),
      selectedLabel: String(selected?.textContent || '').trim(),
      prev: describeButton('.spc-picker-prev'),
      next: describeButton('.spc-picker-next'),
      filters: { exists: !!document.getElementById('ra-v7-filters-btn') },
      playSample: describeButton('ra-play-audio-btn'),
      playRecording: describeButton('ra-play-recording-btn'),
      playSampleStyle: styleOf('#ra-play-audio-btn'),
      recordStyle: styleOf('#ra-record-btn'),
      checkStyle: styleOf('#ra-check-btn'),
      retryStyle: styleOf('#ra-retry-btn')
    };
  });

  assert.equal(state.legacyPickerBarExists, false, `[${label}] Expected the legacy picker bar to be removed.`);
  assert.equal(state.pillExists, true, `[${label}] Expected the shared controller picker pill to exist.`);
  assert.ok(state.pillText.length > 0, `[${label}] Expected the shared picker pill text to be non-empty.`);
  if (state.selectedLabel) {
    assert.ok(
      state.pillText.includes(state.selectedLabel) || state.selectedLabel.includes(state.pillText),
      `[${label}] Expected pill text to identify the selected option.`
    );
  }

  for (const [key, value] of Object.entries({
    'prev button': state.prev,
    'next button': state.next,
    'sample-audio button': state.playSample,
    'recording lifecycle proxy': state.playRecording
  })) {
    assert.equal(value.exists, true, `[${label}] Missing ${key}.`);
  }
  assert.equal(state.filters.exists, false, `[${label}] Expected the legacy filter action to be removed.`);
  assert.equal(state.playSampleStyle?.radius, '12px', `[${label}] Sample audio should use the shared RFIB radius.`);
  assert.equal(state.recordStyle?.radius, '12px', `[${label}] Record should use the shared RFIB radius.`);
  assert.equal(state.checkStyle?.radius, '12px', `[${label}] Check should use the shared RFIB radius.`);
  assert.equal(state.retryStyle?.radius, '12px', `[${label}] Retry should use the shared RFIB radius.`);
  assert.ok(state.playSampleStyle?.backgroundImage.includes('59, 130, 246'), `[${label}] Sample audio should use the blue Play treatment.`);
  assert.ok(state.recordStyle?.backgroundImage.includes('244, 63, 94'), `[${label}] Record should use the red treatment.`);
  assert.ok(state.checkStyle?.backgroundImage.includes('34, 197, 94'), `[${label}] Check should use the green treatment.`);
  assert.ok(state.retryStyle?.backgroundImage.includes('245, 158, 11'), `[${label}] Retry should use the amber treatment.`);
}

(async () => {
  const v7CssPath = path.join(process.cwd(), 'public', 'read-aloud-question-picker-v7.css');
  const v7Css = fs.readFileSync(v7CssPath, 'utf8');
  assert(!/\.spc-(?:sheet-pagination|pagination-btn|pagination-info)/.test(v7Css), 'Speaking pagination selectors must be owned by speaking-practice-controller.css.');

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server = null;

  const express = require('express');
  const http = require('http');
  const publicDir = path.join(process.cwd(), 'public');
  const app = express();
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    permissions: ['microphone']
  });
  await setupFirebaseMocks(context);

  await context.addInitScript(() => {
    function createMonoPcmWavBytes({ sampleRate = 16000, durationMs = 1000, amplitude = 12000 } = {}) {
      const sampleCount = Math.max(1, Math.round(sampleRate * (durationMs / 1000)));
      const dataLength = sampleCount * 2;
      const buffer = new ArrayBuffer(44 + dataLength);
      const view = new DataView(buffer);
      const writeAscii = (offset, text) => {
        for (let index = 0; index < text.length; index += 1) {
          view.setUint8(offset + index, text.charCodeAt(index));
        }
      };

      writeAscii(0, 'RIFF');
      view.setUint32(4, 36 + dataLength, true);
      writeAscii(8, 'WAVE');
      writeAscii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(36, 'data');
      view.setUint32(40, dataLength, true);

      for (let index = 0; index < sampleCount; index += 1) {
        const t = index / sampleRate;
        const val = Math.round(amplitude * Math.sin(2 * Math.PI * 440 * t));
        view.setInt16(44 + (index * 2), val, true);
      }

      return new Uint8Array(buffer);
    }

    class FakeMediaRecorder {
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/wav';
        this.listeners = {};
      }

      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      }

      start() {
        this.state = 'recording';
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        const emitFinalEvents = () => {
          const blob = new Blob([createMonoPcmWavBytes()], { type: this.mimeType });
          (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
          (this.listeners.stop || []).forEach((handler) => handler());
        };
        const delayMs = Number(window.__raFakeRecorderStopDelayMs || 0);
        if (delayMs > 0) {
          setTimeout(emitFinalEvents, delayMs);
        } else {
          emitFinalEvents();
        }
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks() {
            return [{
              stop() {}
            }];
          }
        })
      }
    });

    const originalPlay = window.HTMLMediaElement.prototype.play;
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: function play() {
        this.__raPausedState = false;
        return Promise.resolve(originalPlay ? originalPlay.call(this).catch(() => { }) : undefined);
      }
    });
    const originalPause = window.HTMLMediaElement.prototype.pause;
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      writable: true,
      value: function pause() {
        this.__raPausedState = true;
        return originalPause ? originalPause.call(this) : undefined;
      }
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() {
        return this.__raPausedState !== false;
      }
    });
  });

  await context.route('**/database/RA/RA.xlsx', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: Buffer.from([1, 2, 3, 4])
    });
  });

  await context.route('**/database/RA/Voice/audio/manifest.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        1: {
          male: { files: { 100: 'dummy.wav' } }
        }
      })
    });
  });

  await context.route('**/database/RA/Voice/audio/dummy.wav', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'audio/wav'
      },
      body: Buffer.from([82, 73, 70, 70]) // RIFF header stub
    });
  });

  await context.route('**/api/read-aloud/assess', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        success: true,
        accuracyScore: 92,
        recognizedText: 'Pick it up now',
        words: [],
        connectedSpeech: { status: 'not_applicable' }
      })
    });
  });

  const page = await context.newPage();
  consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));

  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await clickByScript(page, '#vocab-alert-ok');

    await page.waitForFunction(() => typeof window.XLSX === 'object' && !!window.XLSX.utils, { timeout: 30000 });
    await mockWorkbookRows(page, [
      {
        ID: 1,
        ANSWER: 'Pick / it up now',
        'ANSWER FOR COMPARE OR TRANSCRIPT': 'Pick it up now',
        'ANSWER CHUNKED': 'Pick / it up now',
        'Word count': 4
      },
      {
        ID: 2,
        ANSWER: 'I can / take it to / the store',
        'ANSWER FOR COMPARE OR TRANSCRIPT': 'I can take it to the store',
        'ANSWER CHUNKED': 'I can / take it to / the store',
        'Word count': 7
      }
    ]);

    await page.evaluate(() => window.switchToMode('read-aloud'));
    await page.waitForFunction(() => window.ReadAloudMode?.currentPromptReady, { timeout: 30000 });
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return !!panel && panel.classList.contains('active');
    }, { timeout: 30000 });

    await assertSharedControllerStructure(page, 'initial');

    await page.evaluate(() => document.getElementById('ra-record-btn')?.click());
    await page.waitForFunction(() => {
      const stopBtn = document.getElementById('ra-stop-btn');
      return !!stopBtn && getComputedStyle(stopBtn).display !== 'none';
    }, { timeout: 30000 });

    await assertSharedControllerStructure(page, 'recording');

    await page.evaluate(() => {
      window.__raFakeRecorderStopDelayMs = 50;
      document.getElementById('ra-stop-btn')?.click();
    });
    const stoppingState = await page.evaluate(() => {
      const status = document.getElementById('ra-status-message');
      const checkBtn = document.getElementById('ra-check-btn');
      const audio = document.getElementById('ra-user-recording-audio');
      return {
        modeState: window.ReadAloudMode?.state || '',
        statusText: String(status?.textContent || ''),
        checkVisible: !!checkBtn && getComputedStyle(checkBtn).display !== 'none',
        audioVisible: !!audio && getComputedStyle(audio).display !== 'none'
      };
    });
    assert.equal(stoppingState.modeState, 'STOPPING_RECORDING', 'stop should enter a finalizing state until recorder data is ready');
    assert.match(stoppingState.statusText, /finishing recording/i, 'stop should tell the user the recording is finalizing');
    assert.equal(stoppingState.checkVisible, false, 'Check should stay hidden until the recorded blob is ready');
    assert.equal(stoppingState.audioVisible, false, 'Audio player should stay hidden until a recorded blob URL exists');

    await page.waitForFunction(() => {
      const status = document.getElementById('ra-status-message');
      const checkBtn = document.getElementById('ra-check-btn');
      return !!status
        && /recording captured/i.test(String(status.textContent || ''))
        && !!checkBtn
        && getComputedStyle(checkBtn).display !== 'none'
        && window.ReadAloudMode?.state === 'RECORDED';
    }, { timeout: 30000 });

    await page.evaluate(() => document.getElementById('ra-check-btn')?.click());
    await page.waitForFunction(() => {
      const status = document.getElementById('ra-status-message');
      return !!status && /analysis complete/i.test(String(status.textContent || ''));
    }, { timeout: 30000 });

    await assertSharedControllerStructure(page, 'after-results');

    // Move to next prompt deterministically and re-check structure.
    await page.evaluate(async () => {
      await window.ReadAloudMode.loadSpecificPrompt(1);
    });
    await page.waitForFunction(() => window.ReadAloudMode?.currentPromptReady && String(window.ReadAloudMode.currentQuestionId || '') === '2', { timeout: 30000 });
    await assertSharedControllerStructure(page, 'after-next');

    const throttleWarning = consoleLines.find((line) => line.toLowerCase().includes('throttling navigation to prevent the browser from hanging'));
    assert(!throttleWarning, `Unexpected navigation throttling warning: ${throttleWarning}`);

    process.stdout.write('Read Aloud shared controller DOM contract check passed.\n');
  } finally {
    await browser.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
})().catch((error) => {
  console.error('Test failed:', error.stack || error.message);
  if (typeof consoleLines !== 'undefined') {
    console.error('--- BROWSER CONSOLE LOGS ---');
    consoleLines.forEach(line => console.error(line));
    console.error('----------------------------');
  }
  process.exit(1);
});

