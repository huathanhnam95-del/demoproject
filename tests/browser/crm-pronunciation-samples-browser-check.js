/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.join(process.cwd(), 'public');
// Use a non-local hostname so the browser exercises the same capability-nav
// initialization path as production instead of the local Dev Tools path.
const BASE_ORIGIN = 'https://betterenglishlearning.test';
const PRONUNCIATION_SAMPLES_URL = `${BASE_ORIGIN}/crm-admin.html#pronunciation-samples`;

function makeWavBuffer() {
  const dataSize = 32000;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

function buildFirebaseStubScript() {
  return `(function () {
    const currentUser = {
      uid: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      getIdToken: async () => 'browser-test-token'
    };
    window.firebase = {
      apps: [],
      initializeApp(config) {
        this.apps.push(config);
        return this;
      },
      auth() {
        return {
          currentUser,
          onAuthStateChanged(callback) {
            setTimeout(() => callback(currentUser), 0);
            return () => {};
          }
        };
      },
      firestore() {
        return {
          collection() {
            return {
              doc() {
                return {
                  get: async () => ({ exists: false, data: () => null }),
                  set: async () => {}
                };
              }
            };
          }
        };
      }
    };
  })();`;
}

function serveLocalAsset(route, url) {
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const localPath = path.join(PUBLIC_DIR, relativePath);

  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
    return route.fulfill({
      status: pathname === '/favicon.ico' ? 204 : 404,
      contentType: 'text/plain; charset=utf-8',
      body: ''
    });
  }

  return route.fulfill({
    status: 200,
    contentType: contentTypeFor(localPath),
    body: fs.readFileSync(localPath)
  });
}

async function main() {
  const requestLog = [];
  const consoleErrors = [];
  const pageErrors = [];

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream'
    ]
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1200 },
      locale: 'en-US',
      permissions: ['microphone']
    });
    await context.addInitScript(() => { window.__CRM_BROWSER_TEST__ = true; });

    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      console.log('INTERCEPTED REQUEST:', route.request().method(), route.request().url());

      if (url.hostname === 'betterenglishlearning.test') {
        const method = route.request().method();
        const pathname = url.pathname;

        if (pathname.startsWith('/api/')) {
          requestLog.push({ method, path: pathname, url: url.toString() });

          if (pathname === '/api/config' && method === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({
                success: true,
                config: {
                  apiKey: 'mock-apiKey',
                  authDomain: 'mock-authDomain',
                  projectId: 'mock-projectId',
                  storageBucket: 'mock-storageBucket',
                  messagingSenderId: 'mock-messagingSenderId',
                  appId: 'mock-appId'
                }
              })
            });
          }

          if (pathname === '/api/admin/status' && method === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({
                success: true,
                isAdmin: true,
                email: 'admin@example.com',
                uid: 'admin-1',
                bootstrapped: true
              })
            });
          }

          if (pathname === '/api/admin/sync-from-prod/collections' && method === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({ success: true, collections: [] })
            });
          }

          if (pathname === '/api/admin/sync-from-prod/jobs/latest' && method === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({ success: true, job: null })
            });
          }

          if (pathname === '/api/admin/dev/save-corpus-sample' && method === 'POST') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({
                success: true,
                sampleId: 'photograph-clean-l1-vn-01-temp',
                sample: { sourceHash: 'a1b2c3d4e5f6g7h8i9j0' }
              })
            });
          }

          if (pathname === '/api/admin/dev/corpus-samples' && method === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({
                success: true,
                samples: [{
                  id: 'busy-clean-l1-vn-01-saved',
                  sampleId: 'busy-clean-l1-vn-01-saved',
                  targetWord: 'busy',
                  category: 'clean',
                  targetSyllableCount: 2,
                  expectedObservedCount: 2,
                  durationSeconds: 2.65,
                  audioUrl: 'https://storage.test/busy.wav'
                }]
              })
            });
          }

          if (/^\/api\/admin\/dev\/corpus-samples\/[^/]+\/audio$/.test(pathname) && method === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'audio/wav',
              headers: { 'Cache-Control': 'no-store' },
              body: makeWavBuffer()
            });
          }

          // Fallback default API success response
          return route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({ success: true })
          });
        }

        return serveLocalAsset(route, url);
      }

      if (url.hostname === 'www.gstatic.com' && /firebasejs/.test(url.pathname)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript; charset=utf-8',
          body: buildFirebaseStubScript()
        });
      }

      if (url.hostname.includes('praat-api-') && url.pathname === '/analyze/v2') {
        requestLog.push({ method: route.request().method(), path: url.pathname, url: url.toString() });
        return route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            analysisVersion: 'pronunciation-analysis-v2',
            observed: {
              syllableCount: 2,
              primaryStress: 0,
              syllables: [
                { syllable: 1, startTime: 0.2, endTime: 0.4, duration: 0.2, avgPitch: 120, intensity: 80, isStressed: true },
                { syllable: 2, startTime: 0.4, endTime: 0.6, duration: 0.2, avgPitch: 90, intensity: 70, isStressed: false }
              ],
              stressEvidence: { confidence: 0.88, rateable: true }
            },
            quality: { confidence: 1, rateable: true, reasons: [] },
            segmentation: { method: 'target-aligned-acoustic-feedback', confidence: 1, selectedCount: 2 }
          })
        });
      }

      return route.fulfill({ status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
    });

    const page = await context.newPage();
    page.on('pageerror', (error) => {
      console.error(`[BROWSER PAGE ERROR] ${error.stack || error.message}`);
      pageErrors.push(error.message);
    });
    page.on('console', (message) => {
      console.log(`[BROWSER CONSOLE] ${message.type().toUpperCase()}: ${message.text()}`);
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    // 1. Load the main CRM Admin page
    await page.goto(`${BASE_ORIGIN}/crm-admin.html`, { waitUntil: 'domcontentloaded' });
    
    // 2. Wait for the Pronunciation Samples sidebar nav to become visible (capability confirmed)
    await page.waitForSelector('#nav-pronunciation-samples-container', { state: 'visible' });

    // 3. Click the sidebar nav button to navigate to the pronunciation-samples panel
    await page.click('#nav-pronunciation-samples-container button');

    await page.waitForSelector('#corpus-saved-samples .crm-stack-item', { state: 'visible', timeout: 5000 });
    const savedSamplesText = await page.textContent('#corpus-saved-samples');
    assert.match(savedSamplesText, /busy.*clean.*2\.65s/i, 'Production-shaped corpus list response should render the saved sample.');

    const analyzeButton = page.locator('[data-corpus-sample-id="busy-clean-l1-vn-01-saved"] .btn-corpus-analyze');
    await analyzeButton.waitFor({ state: 'visible', timeout: 5000 });
    await analyzeButton.click();
    const analysisResult = page.locator('[data-corpus-sample-id="busy-clean-l1-vn-01-saved"] .corpus-analysis-result');
    await analysisResult.waitFor({ state: 'visible', timeout: 15_000 });
    try {
      await page.waitForFunction(() => /2 syllables/i.test(document.querySelector('[data-corpus-sample-id="busy-clean-l1-vn-01-saved"] .corpus-analysis-result')?.textContent || ''), null, { timeout: 20_000 });
    } catch (error) {
      console.error('Analysis result text:', await analysisResult.textContent());
      throw error;
    }
    await expectText(analysisResult, /2 syllables/i);
    await expectText(analysisResult, /verified/i);
    assert.ok(requestLog.some((r) => r.path === '/api/admin/dev/corpus-samples/busy-clean-l1-vn-01-saved/audio' && r.method === 'GET'));
    assert.ok(requestLog.some((r) => r.path === '/analyze/v2' && r.method === 'POST'));
    
    // 4. Select target word 'photograph'
    await page.waitForSelector('.corpus-word-btn[data-word="photograph"]', { state: 'visible' });
    await page.click('.corpus-word-btn[data-word="photograph"]');

    // Verify Display updates
    const displayWordText = await page.textContent('#corpus-display-word');
    assert.strictEqual(displayWordText.trim(), 'photograph');

    // 5. Start Recording
    await page.click('#btn-corpus-record');
    
    // Wait for Recording status to update
    await page.waitForFunction(() => {
      const status = document.getElementById('corpus-mic-status')?.textContent;
      return status && status.includes('Recording');
    });

    // Let fake mic run for 500ms
    await page.waitForTimeout(500);

    // 6. Stop Recording
    await page.click('#btn-corpus-stop');

    // Wait for Stop operation and encoding processing
    await page.waitForFunction(() => {
      const saveBtn = document.getElementById('btn-corpus-save');
      return saveBtn && !saveBtn.disabled;
    });

    // 7. Save the attempt
    await page.click('#btn-corpus-save');

    // Wait for the success toast to appear
    await page.waitForSelector('.crm-toast.success', { state: 'visible' });

    // Assert API call was tracked
    const saveRequest = requestLog.find(r => r.path === '/api/admin/dev/save-corpus-sample' && r.method === 'POST');
    assert.ok(saveRequest, 'POST request to /api/admin/dev/save-corpus-sample should be sent.');

    assert.strictEqual(pageErrors.length, 0, `Unexpected page errors:\n${pageErrors.join('\n')}`);
    assert.strictEqual(consoleErrors.length, 0, `Unexpected console errors:\n${consoleErrors.join('\n')}`);

    console.log('crm pronunciation samples browser check passed');
  } finally {
    await browser.close();
  }
}

async function expectText(locator, pattern) {
  const text = await locator.textContent();
  assert.match(text || '', pattern);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
