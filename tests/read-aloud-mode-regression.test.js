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

async function preparePage(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
}

async function assertUnsupportedFlow(browser, baseUrl) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;

    const originalFetch = window.fetch.bind(window);
    window.__raFetchCount = 0;
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        window.__raFetchCount += 1;
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);

  const initialFetchCount = await page.evaluate(() => Number(window.__raFetchCount || 0));
  assert.equal(initialFetchCount, 0, 'Read Aloud database should not fetch before mode entry');

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    return (
      Number(window.__raFetchCount || 0) >= 1 &&
      !!status &&
      /not supported|unsupported/i.test(String(status.textContent || '')) &&
      !!recordBtn &&
      !!recordBtn.disabled
    );
  }, { timeout: 30000 });

  const state = await page.evaluate(() => {
    const panel = document.getElementById('mode-read-aloud');
    const tab = document.getElementById('tab-read-aloud');
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    return {
      panelActive: !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none',
      tabActive: !!tab && tab.classList.contains('active'),
      fetchCount: Number(window.__raFetchCount || 0),
      statusText: status ? String(status.textContent || '').trim() : '',
      recordDisabled: recordBtn ? !!recordBtn.disabled : null
    };
  });

  assert.equal(state.panelActive, true, 'Read Aloud panel should activate via switchToMode');
  assert.equal(state.tabActive, true, 'Read Aloud tab should activate via switchToMode');
  assert.equal(state.fetchCount, 1, 'Read Aloud database should fetch on first mode entry');
  assert.match(state.statusText, /not supported|unsupported/i, 'unsupported browsers should get an explicit message');
  assert.equal(state.recordDisabled, true, 'record button should stay disabled when speech recognition is unavailable');

  await page.evaluate(() => {
    window.startTutorial('read-aloud', true);
  });
  await page.waitForFunction(() => {
    const overlay = document.getElementById('tutorial-overlay');
    const title = document.getElementById('tutorial-title');
    return (
      !!overlay &&
      overlay.classList.contains('active') &&
      !!title &&
      /read aloud/i.test(String(title.textContent || ''))
    );
  }, { timeout: 30000 });

  const tutorialTitle = await page.evaluate(() => {
    const title = document.getElementById('tutorial-title');
    return title ? String(title.textContent || '').trim() : '';
  });
  assert.match(tutorialTitle, /read aloud/i, 'Read Aloud tutorial should not fall back to Type mode');

  await context.close();
}

async function assertSupportedFlow(browser, baseUrl) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    class FakeSpeechRecognition {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.lang = 'en-US';
        window.__raLastRecognition = this;
      }

      start() {
        window.__raRecognitionStarts = Number(window.__raRecognitionStarts || 0) + 1;
      }

      stop() {
        window.__raRecognitionStops = Number(window.__raRecognitionStops || 0) + 1;
      }

      emit(finalTranscript, interimTranscript = '') {
        const results = [];
        if (interimTranscript) {
          results.push({ isFinal: false, 0: { transcript: interimTranscript } });
        }
        if (finalTranscript) {
          results.push({ isFinal: true, 0: { transcript: finalTranscript } });
        }
        if (typeof this.onresult === 'function') {
          this.onresult({ resultIndex: 0, results });
        }
      }
    }

    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;

    const originalFetch = window.fetch.bind(window);
    window.__raFetchCount = 0;
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        window.__raFetchCount += 1;
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);

  await page.evaluate(() => {
    const originalSheetToJson = window.XLSX.utils.sheet_to_json.bind(window.XLSX.utils);
    window.__raMockRows = [
      {
        ANSWER: 'This is a simple prompt',
        'Word count': 5
      }
    ];

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
  });

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });

  await page.waitForFunction(() => {
    const text = document.getElementById('ra-text-prompt');
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    return (
      Number(window.__raFetchCount || 0) === 1 &&
      !!text &&
      /this is a simple prompt/i.test(String(text.textContent || '')) &&
      !!status &&
      /read the text silently/i.test(String(status.textContent || '')) &&
      !!recordBtn &&
      /skip prep/i.test(String(recordBtn.textContent || '')) &&
      !recordBtn.disabled
    );
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    return (
      Number(window.__raRecognitionStarts || 0) === 1 &&
      !!status &&
      /recording/i.test(String(status.textContent || '')) &&
      !!recordBtn &&
      /finish recording/i.test(String(recordBtn.textContent || ''))
    );
  }, { timeout: 30000 });

  await page.evaluate(() => {
    window.__raLastRecognition.emit('This is a simple prompt');
  });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });

  await page.waitForFunction(() => {
    const resultBox = document.getElementById('ra-result-box');
    const accuracy = document.getElementById('ra-accuracy-value');
    const feedback = document.getElementById('ra-transcript-feedback');
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    return (
      !!resultBox &&
      getComputedStyle(resultBox).display !== 'none' &&
      !!accuracy &&
      String(accuracy.textContent || '').trim() === '100' &&
      !!feedback &&
      /this is a simple prompt/i.test(String(feedback.textContent || '')) &&
      !!status &&
      /analysis complete/i.test(String(status.textContent || '')) &&
      !!recordBtn &&
      /next prompt/i.test(String(recordBtn.textContent || ''))
    );
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });

  await page.waitForFunction(() => {
    const resultBox = document.getElementById('ra-result-box');
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    return (
      Number(window.__raFetchCount || 0) === 1 &&
      !!resultBox &&
      getComputedStyle(resultBox).display === 'none' &&
      !!status &&
      /read the text silently/i.test(String(status.textContent || '')) &&
      !!recordBtn &&
      /skip prep/i.test(String(recordBtn.textContent || ''))
    );
  }, { timeout: 30000 });

  const supportedState = await page.evaluate(() => ({
    fetchCount: Number(window.__raFetchCount || 0),
    recognitionStarts: Number(window.__raRecognitionStarts || 0),
    recognitionStops: Number(window.__raRecognitionStops || 0)
  }));

  assert.equal(supportedState.fetchCount, 1, 'database should stay cached between prompts');
  assert.equal(supportedState.recognitionStarts, 1, 'recording should start exactly once for one attempt');
  assert.ok(supportedState.recognitionStops >= 1, 'recording should stop when finishing the attempt');

  await context.close();
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
    await assertUnsupportedFlow(browser, baseUrl);
    await assertSupportedFlow(browser, baseUrl);

    console.log('read-aloud mode regression test passed');
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
