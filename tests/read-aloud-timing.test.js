/* eslint-disable no-console */
const assert = require('assert');
const { spawn } = require('child_process');
const net = require('net');
const { chromium } = require('playwright');

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

async function waitForServer(url, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // Retry until ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLogs = '';
  server.stdout.on('data', (chunk) => { serverLogs += String(chunk); });
  server.stderr.on('data', (chunk) => { serverLogs += String(chunk); });

  let browser;
  try {
    await waitForServer(`${baseUrl}/api/health`);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(() => {
      class FakeMediaRecorder {
        constructor() {
          this.state = 'inactive';
          this.listeners = {};
          this.mimeType = 'audio/webm';
        }

        addEventListener(type, handler) {
          if (!this.listeners[type]) this.listeners[type] = [];
          this.listeners[type].push(handler);
        }

        start() {
          this.state = 'recording';
          window.__raRecorderStarts = Number(window.__raRecorderStarts || 0) + 1;
        }

        stop() {
          if (this.state !== 'recording') return;
          this.state = 'inactive';
          window.__raRecorderStops = Number(window.__raRecorderStops || 0) + 1;
          const blob = new Blob(['fake-audio'], { type: this.mimeType });
          (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
          (this.listeners.stop || []).forEach((handler) => handler());
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
              return [{ stop() {} }];
            }
          })
        }
      });

      const originalFetch = window.fetch.bind(window);
      window.__raAssessCount = 0;
      window.fetch = (...args) => {
        const [resource] = args;
        const url = String(resource && resource.url ? resource.url : resource || '');
        if (url.includes('database/RA/RA.xlsx')) {
          return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
        }
        if (url.includes('database/RA/connected-speech-index.json')) {
          return Promise.resolve(new Response(JSON.stringify({
            indexVersion: '1',
            generatedAt: '2026-03-29T00:00:00.000Z',
            prompts: []
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        if (url.includes('database/RA/connected-speech-featured-prompts.json')) {
          return Promise.resolve(new Response(JSON.stringify({
            version: '1',
            updatedAt: '2026-03-29T00:00:00.000Z',
            families: {},
            subtypes: {}
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        if (url.includes('audio/ra/manifest.json')) {
          return Promise.resolve(new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        if (url.includes('/api/read-aloud/assess')) {
          window.__raAssessCount += 1;
          return Promise.resolve(new Response(JSON.stringify({
            success: true,
            accuracyScore: 92,
            fluencyScore: 89,
            completenessScore: 100,
            recognizedText: 'Pick it up now',
            words: [
              { word: 'Pick', accuracyScore: 93, errorType: 'None' },
              { word: 'it', accuracyScore: 95, errorType: 'None' },
              { word: 'up', accuracyScore: 90, errorType: 'None' },
              { word: 'now', accuracyScore: 91, errorType: 'None' }
            ],
            connectedSpeech: {
              status: 'complete',
              summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
              events: []
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return originalFetch(...args);
      };
    });

    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await page.evaluate((rows) => {
      const originalSheetToJson = window.XLSX.utils.sheet_to_json.bind(window.XLSX.utils);
      window.XLSX.read = () => ({
        SheetNames: ['Sheet1'],
        Sheets: {
          Sheet1: { __mockRows: rows }
        }
      });
      window.XLSX.utils.sheet_to_json = (worksheet) => {
        if (Array.isArray(worksheet?.__mockRows)) {
          return worksheet.__mockRows.slice();
        }
        return originalSheetToJson(worksheet);
      };
    }, [
      { ID: 1, ANSWER: 'Pick it up now', 'Word count': 4 }
    ]);

    await page.evaluate(async () => {
      await window.switchToMode('read-aloud');
      window.ReadAloudMode.prepareWavBlob = async (blob) => blob;
    });

    await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase, { timeout: 30000 });
    await page.evaluate(async () => {
      await window.ReadAloudMode.loadSpecificPrompt(0);
      window.ReadAloudMode.recordSeconds = 2;
      window.ReadAloudMode.updateTimerDisplay('ra-record-time', 2);
    });
    await page.waitForFunction(() => String(window.ReadAloudMode?.currentQuestionId || '') === '1', { timeout: 30000 });

    await page.evaluate(() => {
      document.getElementById('ra-record-btn')?.click();
    });
    await page.waitForFunction(() => Number(window.__raRecorderStarts || 0) === 1, { timeout: 30000 });
    await page.waitForFunction(() => Number(window.__raAssessCount || 0) === 1, { timeout: 2900 });

    const timingState = await page.evaluate(() => ({
      recorderStarts: Number(window.__raRecorderStarts || 0),
      recorderStops: Number(window.__raRecorderStops || 0),
      assessCount: Number(window.__raAssessCount || 0),
      statusText: String(document.getElementById('ra-status-message')?.textContent || '').trim(),
      recordText: String(document.getElementById('ra-record-btn')?.textContent || '').trim()
    }));

    assert.equal(timingState.recorderStarts, 1, 'auto-stop timing should start one recording');
    assert.equal(timingState.recorderStops, 1, 'auto-stop timing should stop at the configured second boundary');
    assert.equal(timingState.assessCount, 1, 'auto-stop timing should submit immediately after the countdown hits zero');
    assert.match(timingState.statusText, /analysis complete/i, 'auto-stop timing should finish the assessment flow');
    assert.match(timingState.recordText, /next prompt/i, 'auto-stop timing should return the CTA to next prompt');

    await context.close();
    console.log('read-aloud timing test passed');
  } catch (error) {
    const tail = serverLogs.slice(-10000);
    if (tail) {
      console.error('SERVER_LOG_TAIL_START');
      console.error(tail);
      console.error('SERVER_LOG_TAIL_END');
    }
    throw error;
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {
      // Best effort cleanup.
    }
    try {
      server.kill();
    } catch (_) {
      // Best effort cleanup.
    }
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
