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
      // Intentional retry.
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
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.route('**/database/Take%20Notes/RL/audio/*', async (route) => {
      const request = route.request();
      if (request.method() === 'HEAD') {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'audio/mpeg' }
        });
        return;
      }

      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
        body: 'fake-audio'
      });
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    await page.evaluate(() => {
      window.__notesSmartJumpEntries = [
        { id: '1', transcript: 'climate birds migration study', level: 1, videoUrl: '' },
        { id: '2', transcript: 'climate birds migration patterns', level: 1, videoUrl: '' },
        { id: '3', transcript: 'stone bridge river valley', level: 3, videoUrl: '' }
      ];

      const fb = window.firebase;
      if (!fb || typeof fb.firestore !== 'function') return;

      const originalFirestore = fb.firestore.bind(fb);
      fb.firestore = function patchedFirestore(...args) {
        const db = originalFirestore(...args);
        if (!db || typeof db.collection !== 'function') return db;

        const originalCollection = db.collection.bind(db);
        db.collection = function patchedCollection(name, ...rest) {
          if (name === 'takeNotesEntries') {
            return {
              get: async function patchedGet() {
                return {
                  empty: false,
                  docs: window.__notesSmartJumpEntries.map((entry) => ({
                    id: entry.id,
                    data: () => ({ ...entry })
                  }))
                };
              }
            };
          }

          return originalCollection(name, ...rest);
        };
        return db;
      };
    });

    await page.evaluate(async () => {
      if (window.DifficultyManager?.globalSettings) {
        window.DifficultyManager.setManualLevel(6);
      }
      await window.switchToMode('notes');
    });

    await page.waitForFunction(() => {
      const select = document.getElementById('question-select-notes');
      if (!select || !select.options || select.options.length < 3) return false;
      const first = String(select.options[0].textContent || '').trim().toLowerCase();
      return first !== 'loading...' && !first.startsWith('error');
    }, { timeout: 120000 });

    await page.evaluate(async () => {
      document.getElementById('play-notes-btn')?.click();
      await new Promise((resolve) => setTimeout(resolve, 300));

      document.getElementById('recommended-btn-notes')?.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      document.getElementById('play-notes-btn')?.click();
    });

    await page.waitForFunction(() => {
      const src = document.getElementById('notes-audio')?.getAttribute('src') || '';
      return /\/2\.(m4a|wav|mp3|aac|ogg)(\?|$)/.test(src);
    }, { timeout: 30000 });

    const result = await page.evaluate(() => ({
      currentQuestionId: document.getElementById('current-question-id-notes')?.textContent?.trim() || '',
      audioSrc: document.getElementById('notes-audio')?.getAttribute('src') || '',
      practiceVisible: getComputedStyle(document.getElementById('notes-practice-area')).display,
      audioStepVisible: getComputedStyle(document.getElementById('notes-step-audio')).display
    }));

    assert.equal(result.currentQuestionId, '2');
    assert.match(result.audioSrc, /\/2\.(m4a|wav|mp3|aac|ogg)$/);
    assert.equal(result.practiceVisible, 'block');
    assert.equal(result.audioStepVisible, 'block');
    console.log('notes smart jump regression test passed');
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
      // Intentional cleanup best effort.
    }
    try {
      server.kill();
    } catch (_) {
      // Intentional cleanup best effort.
    }
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
