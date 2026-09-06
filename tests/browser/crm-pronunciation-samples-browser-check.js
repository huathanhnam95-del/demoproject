/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const BASE_ORIGIN = 'https://betterenglishlearning.test';

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
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      permissions: ['microphone']
    });

    const pageErrors = [];
    const consoleErrors = [];
    const requestLog = [];

    await context.route(/^https?:\/\//, async (route) => {
      const url = new URL(route.request().url());

      if (url.origin === BASE_ORIGIN) {
        const { pathname } = url;
        const method = route.request().method();

        if (pathname.startsWith('/api/') || pathname.startsWith('/admin/')) {
          requestLog.push({ method, path: pathname, url: url.toString() });

          if (pathname === '/api/config' && method === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({
                success: true,
                config: {
                  apiKey: 'mock-apiKey',
                  authDomain: 'mock-project.firebaseapp.com',
                  projectId: 'mock-project',
                  storageBucket: 'mock-project.appspot.com',
                  messagingSenderId: '000000000000',
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

          if (pathname === '/api/pronunciation-assessment/option-a' && method === 'POST') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({
                success: true,
                engine: 'option-a',
                targetWord: 'photograph',
                referenceIpa: 'ˈfoʊ.tə.ɡræf',
                prosodySource: 'praat-fusion',
                azureScores: { accuracy: 94, fluency: 90, completeness: 100, pronScore: 92 },
                detectedStressedIndex: 0,
                stressedSyllableNumber: 1,
                syllables: [
                  {
                    syllableNumber: 1,
                    nucleusPhoneme: 'oʊ',
                    startTime: 0.12,
                    endTime: 0.32,
                    vowelDuration: 0.20,
                    maxPitch: 225.4,
                    meanPitch: 218.0,
                    peakIntensity: 78.2,
                    meanIntensity: 74.0,
                    prominence: 0.95,
                    isStressed: true,
                    reduction: { isReduced: false, phoneme: 'oʊ', verdict: 'Full vowel [oʊ] maintained' }
                  },
                  {
                    syllableNumber: 2,
                    nucleusPhoneme: 'ə',
                    startTime: 0.40,
                    endTime: 0.49,
                    vowelDuration: 0.09,
                    maxPitch: 165.2,
                    meanPitch: 160.0,
                    peakIntensity: 66.5,
                    meanIntensity: 62.0,
                    prominence: 0.45,
                    isStressed: false,
                    reduction: { isReduced: true, phoneme: 'ə', verdict: 'Weak reduction to [ə] detected' }
                  },
                  {
                    syllableNumber: 3,
                    nucleusPhoneme: 'æ',
                    startTime: 0.58,
                    endTime: 0.72,
                    vowelDuration: 0.14,
                    maxPitch: 175.0,
                    meanPitch: 170.0,
                    peakIntensity: 71.0,
                    meanIntensity: 68.0,
                    prominence: 0.62,
                    isStressed: false,
                    reduction: { isReduced: false, phoneme: 'æ', verdict: 'Full vowel [æ] maintained' }
                  }
                ],
                phonemes: [
                  { index: 0, phoneme: 'f', startTime: 0.05, endTime: 0.12, accuracyScore: 95, isVowel: false },
                  { index: 1, phoneme: 'oʊ', startTime: 0.12, endTime: 0.32, accuracyScore: 93, isVowel: true },
                  { index: 2, phoneme: 't', startTime: 0.32, endTime: 0.40, accuracyScore: 91, isVowel: false },
                  { index: 3, phoneme: 'ə', startTime: 0.40, endTime: 0.49, accuracyScore: 89, isVowel: true },
                  { index: 4, phoneme: 'ɡ', startTime: 0.49, endTime: 0.53, accuracyScore: 96, isVowel: false },
                  { index: 5, phoneme: 'r', startTime: 0.53, endTime: 0.58, accuracyScore: 92, isVowel: false },
                  { index: 6, phoneme: 'æ', startTime: 0.58, endTime: 0.72, accuracyScore: 94, isVowel: true },
                  { index: 7, phoneme: 'f', startTime: 0.72, endTime: 0.80, accuracyScore: 95, isVowel: false }
                ],
                summary: { totalSyllables: 3, detectedStressed: 0, stressedSyllableNumber: 1, stressConfidence: 0.95 }
              })
            });
          }

          if ((pathname === '/api/pronunciation-assessment/option-b' || pathname === '/analyze/option-b') && method === 'POST') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({
                success: true,
                engine: 'option-b',
                targetWord: 'photograph',
                referenceIpa: 'ˈfoʊ.tə.ɡræf',
                duration: 0.85,
                detectedStressedIndex: 0,
                syllables: [
                  { syllable: 1, startTime: 0.05, endTime: 0.35, duration: 0.30, vowelDuration: 0.19, maxPitch: 228.0, avgPitch: 219.0, intensity: 78.5, isStressed: true, prominence: 0.96 },
                  { syllable: 2, startTime: 0.35, endTime: 0.52, duration: 0.17, vowelDuration: 0.08, maxPitch: 162.0, avgPitch: 158.0, intensity: 65.0, isStressed: false, prominence: 0.42 },
                  { syllable: 3, startTime: 0.52, endTime: 0.82, duration: 0.30, vowelDuration: 0.13, maxPitch: 172.0, avgPitch: 168.0, intensity: 70.0, isStressed: false, prominence: 0.60 }
                ],
                v4Syllabification: {
                  ruleVersion: 'pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1',
                  displaySyllabification: '/ˈfoʊ.tə.ɡræf/',
                  syllable_count: 3
                },
                summary: { syllableCount: 3, detectedStressed: 0, stressedSyllableNumber: 1 }
              })
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

      // Route localhost:8081 calls to the same mock
      if (url.port === '8081' && url.pathname === '/analyze/option-b') {
        requestLog.push({ method: route.request().method(), path: url.pathname, url: url.toString() });
        return route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            engine: 'option-b',
            targetWord: 'photograph',
            referenceIpa: 'ˈfoʊ.tə.ɡræf',
            duration: 0.85,
            detectedStressedIndex: 0,
            syllables: [
              { syllable: 1, startTime: 0.05, endTime: 0.35, duration: 0.30, vowelDuration: 0.19, maxPitch: 228.0, avgPitch: 219.0, intensity: 78.5, isStressed: true, prominence: 0.96 },
              { syllable: 2, startTime: 0.35, endTime: 0.52, duration: 0.17, vowelDuration: 0.08, maxPitch: 162.0, avgPitch: 158.0, intensity: 65.0, isStressed: false, prominence: 0.42 },
              { syllable: 3, startTime: 0.52, endTime: 0.82, duration: 0.30, vowelDuration: 0.13, maxPitch: 172.0, avgPitch: 168.0, intensity: 70.0, isStressed: false, prominence: 0.60 }
            ],
            summary: { syllableCount: 3, detectedStressed: 0, stressedSyllableNumber: 1 }
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
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    // 1. Load the main CRM Admin page
    await page.goto(`${BASE_ORIGIN}/crm-admin.html`, { waitUntil: 'domcontentloaded' });

    // 2. Wait for the Pronunciation Samples sidebar nav to become active
    await page.waitForSelector('#nav-pronunciation-samples-container', { state: 'attached' });
    await page.waitForFunction(() => {
      const el = document.getElementById('nav-pronunciation-samples-container');
      return el && el.style.display !== 'none';
    });

    // 3. Click the nav button (hovering More dropdown if nested) to navigate to pronunciation-samples panel
    if (await page.locator('.crm-nav-more-dropdown').count() > 0) {
      await page.hover('.crm-nav-more-dropdown');
    }
    await page.click('#nav-pronunciation-samples-container button');

    // 4. Verify that the new Dual Arena is mounted in the panel
    await page.waitForSelector('.dual-arena-root', { state: 'visible', timeout: 5000 });
    const arenaTitle = await page.textContent('.dual-arena-title');
    assert.match(arenaTitle, /Option A vs\. Option B Comparison/i, 'Dual Arena title should be visible.');

    // 5. Test Backend Toggle (Local vs Cloud Run)
    const localPill = page.locator('.dual-arena-pill[data-backend="local"]');
    const cloudPill = page.locator('.dual-arena-pill[data-backend="cloud"]');
    assert.strictEqual(await localPill.isVisible(), true);
    assert.strictEqual(await cloudPill.isVisible(), true);

    await cloudPill.click();
    assert.strictEqual(await cloudPill.evaluate(el => el.classList.contains('is-active')), true);
    await localPill.click();
    assert.strictEqual(await localPill.evaluate(el => el.classList.contains('is-active')), true);

    // 6. Test Preset Dropdown Selection
    const presetSelect = page.locator('#dual-arena-preset-select');
    await presetSelect.selectOption({ label: "re'cord (verb) [rɪˈkɔːrd]" });
    const wordVal = await page.inputValue('#dual-arena-word-input');
    const ipaVal = await page.inputValue('#dual-arena-ipa-input');
    assert.strictEqual(wordVal, 'record');
    assert.strictEqual(ipaVal, 'rɪˈkɔːrd');

    // Revert to photograph preset
    await presetSelect.selectOption({ label: "'photograph (3 syl) [ˈfoʊ.tə.ɡræf]" });

    // 7. Test Audio File Upload
    const fakeWavPath = path.join(__dirname, 'test-temp.wav');
    fs.writeFileSync(fakeWavPath, makeWavBuffer());
    await page.setInputFiles('#dual-arena-file-input', fakeWavPath);

    // Run Dual Analysis button should become enabled
    const runBtn = page.locator('#dual-arena-btn-run');
    await runBtn.waitFor({ state: 'visible' });
    assert.strictEqual(await runBtn.isDisabled(), false, 'Run Dual Analysis button should be enabled after audio is uploaded.');

    // 7b. Verify Waveform Visualization Display is mounted and visible
    const waveformWrap = page.locator('#dual-arena-waveform-wrap');
    await waveformWrap.waitFor({ state: 'visible', timeout: 5000 });
    assert.strictEqual(await waveformWrap.isVisible(), true, 'Waveform container should be visible after audio is loaded.');
    const playWaveformBtn = page.locator('#dual-arena-waveform-play-btn');
    assert.strictEqual(await playWaveformBtn.isVisible(), true, 'Waveform play button should be visible.');
    const durationText = await page.textContent('#dual-arena-audio-duration');
    assert.match(durationText, /\d+\.\d+s/, 'Duration badge should show audio length in seconds.');

    // 8. Click "Run Dual Analysis" and verify side-by-side card rendering
    await runBtn.click();

    // Verify Option A card displays metrics
    await page.waitForSelector('#dual-arena-card-a .card-inner-results', { state: 'visible', timeout: 8000 });
    const cardAText = await page.textContent('#dual-arena-card-a');
    assert.match(cardAText, /Syllable 1/i, 'Option A should detect Syllable 1 stress');
    assert.match(cardAText, /Weak reduction to \[ə\] detected/i, 'Option A should detect /ə/ reduction');

    // Verify Option B card displays metrics
    await page.waitForSelector('#dual-arena-card-b .card-inner-results', { state: 'visible', timeout: 8000 });
    const cardBText = await page.textContent('#dual-arena-card-b');
    assert.match(cardBText, /Syllable 1/i, 'Option B should detect Syllable 1 stress');
    assert.match(cardBText, /V4 Syllabification Structure/i, 'Option B should display V4 structure');

    // Verify benchmark evaluation panel is displayed
    await page.waitForSelector('#dual-arena-benchmark-panel', { state: 'visible', timeout: 5000 });

    // 9. Test Manual Rating & Saving to Benchmark
    const ratingBtnA = page.locator('.rating-btn[data-winner="option-a"]');
    await ratingBtnA.click();
    assert.strictEqual(await ratingBtnA.evaluate(el => el.classList.contains('is-selected')), true);

    await page.fill('#dual-arena-notes', 'Option A properly detected the schwa reduction on syllable 2.');
    const saveRatingBtn = page.locator('#dual-arena-btn-save-rating');
    assert.strictEqual(await saveRatingBtn.isDisabled(), false);
    await saveRatingBtn.click();

    const counterText = await page.textContent('#benchmark-counter');
    assert.match(counterText, /1 Comparisons Saved/i, 'Benchmark counter should increment to 1.');

    // 10. Test Standalone Unauthenticated Runner Page
    await page.goto(`${BASE_ORIGIN}/pronunciation-visual-comparison.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dual-arena-root', { state: 'visible', timeout: 5000 });
    const standaloneTitle = await page.textContent('.standalone-title');
    assert.match(standaloneTitle, /Pronunciation Assessment Dual Arena/i, 'Standalone runner header should load.');
    assert.strictEqual(await page.locator('#dual-arena-btn-record').isVisible(), true);

    // Verify no fatal page or console errors occurred
    assert.strictEqual(pageErrors.length, 0, `Unexpected page errors:\n${pageErrors.join('\n')}`);
    assert.strictEqual(consoleErrors.length, 0, `Unexpected console errors:\n${consoleErrors.join('\n')}`);

    console.log('crm pronunciation samples dual arena browser check passed successfully!');
  } finally {
    const fakeWavPath = path.join(__dirname, 'test-temp.wav');
    if (fs.existsSync(fakeWavPath)) {
      try { fs.unlinkSync(fakeWavPath); } catch (_) {}
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
