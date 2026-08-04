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

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    await page.evaluate(() => {
      window.__notesTakeNotesGetCount = 0;
      window.__notesSyntheticEntries = [
        { id: '1', transcript: 'climate birds migration study', level: 1, videoUrl: '' },
        { id: '2', transcript: 'stone bridge river valley', level: 1, videoUrl: '' },
        { id: '3', transcript: 'climate birds migration patterns', level: 3, videoUrl: '' }
      ];
      const fb = window.firebase;
      if (!fb || typeof fb.firestore !== 'function') return;

      const originalFirestore = fb.firestore.bind(fb);
      window.__restoreFirebaseFirestore = () => {
        fb.firestore = originalFirestore;
      };

      fb.firestore = function patchedFirestore(...args) {
        const db = originalFirestore(...args);
        if (!db || typeof db.collection !== 'function') return db;

        const originalCollection = db.collection.bind(db);
        db.collection = function patchedCollection(name, ...rest) {
          if (name === 'takeNotesEntries') {
            return {
              get: async function patchedGet() {
                window.__notesTakeNotesGetCount += 1;
                return {
                  empty: false,
                  docs: window.__notesSyntheticEntries.map((entry) => ({
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

    const visibilityResult = await page.evaluate(async () => {
      if (window.DifficultyManager?.globalSettings) {
        window.DifficultyManager.setAutoAdjustEnabled(true);
      }

      const notesFilter = document.getElementById('difficulty-filter-container-notes');
      if (!notesFilter) {
        return { before: null, after: null, notesGetCount: 0 };
      }

      notesFilter.style.display = 'block';
      const before = getComputedStyle(notesFilter).display;
      await window.switchToMode('notes');
      const after = getComputedStyle(notesFilter).display;
      const notesGetCount = Number(window.__notesTakeNotesGetCount || 0);
      return { before, after, notesGetCount };
    });

    assert.equal(visibilityResult.before, 'block');
    assert.equal(visibilityResult.after, 'block');
    console.log('notes adaptive visibility regression test passed');

    await page.waitForFunction(() => {
      const select = document.getElementById('question-select-notes');
      if (!select || !select.options || select.options.length === 0) return false;
      const first = String(select.options[0].textContent || '').trim().toLowerCase();
      return first !== 'loading...' && !first.startsWith('error');
    }, { timeout: 120000 });

    const notesGetCount = await page.evaluate(() => Number(window.__notesTakeNotesGetCount || 0));
    assert.equal(notesGetCount, 1);
    console.log('notes initial load dedupe regression test passed');

    const recommendationState = await page.evaluate(() => {
      if (window.DifficultyManager?.globalSettings) {
        window.DifficultyManager.setManualLevel(6);
      }
      if (window.DifficultyFilter?.selectDifficulty) {
        window.DifficultyFilter.selectDifficulty('notes', 'all');
      }
      if (window.TakeNotesMode?.applyFilters) {
        window.TakeNotesMode.applyFilters();
      }

      const summary = document.getElementById('recommendation-summary-notes')?.textContent?.trim() || '';
      const currentQuestionId = document.getElementById('current-question-id-notes')?.textContent?.trim() || '';
      return { summary, currentQuestionId };
    });

    assert.equal(recommendationState.currentQuestionId, '1');
    assert.match(recommendationState.summary, /Recommended next: #2/);
    assert.match(recommendationState.summary, /\u2022/);
    console.log('notes recommendation target regression test passed');

    const selectionRetention = await page.evaluate(() => {
      const select = document.getElementById('question-select-notes');
      if (!select || !select.options || select.options.length < 2) {
        return { optionCount: select?.options?.length || 0, beforeId: null, afterId: null, afterValue: null };
      }

      select.value = '2';
      select.dispatchEvent(new Event('change'));
      const beforeId = document.getElementById('current-question-id-notes')?.textContent?.trim() || '';

      window.TakeNotesMode?.applyFilters?.();

      return {
        optionCount: select.options.length,
        beforeId,
        afterId: document.getElementById('current-question-id-notes')?.textContent?.trim() || '',
        afterValue: select.value
      };
    });

    assert.ok(selectionRetention.optionCount >= 2);
    assert.equal(selectionRetention.beforeId, '2');
    assert.equal(selectionRetention.afterId, '2');
    assert.equal(selectionRetention.afterValue, '2');
    console.log('notes selection retention regression test passed');
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
