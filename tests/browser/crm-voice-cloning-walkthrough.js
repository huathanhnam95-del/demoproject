/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const BASE_ORIGIN = 'https://betterenglishlearning.com';
const VOICE_CLONING_URL = `${BASE_ORIGIN}/crm-admin.html#voice-cloning`;

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.woff2': return 'font/woff2';
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

    const firestoreDoc = () => ({
      get: async () => ({ exists: false, data: () => null }),
      set: async () => {},
      update: async () => {}
    });

    const firestoreCollection = () => ({
      doc: () => firestoreDoc(),
      where: () => firestoreCollection(),
      orderBy: () => firestoreCollection(),
      limit: () => firestoreCollection(),
      get: async () => ({ docs: [], empty: true, size: 0, forEach: () => {} }),
      onSnapshot: () => () => {}
    });

    const firestoreInstance = {
      collection: () => firestoreCollection(),
      doc: () => firestoreDoc()
    };

    window.firebase = {
      apps: [{}],
      auth: () => ({
        currentUser,
        onAuthStateChanged: (cb) => {
          setTimeout(() => cb(currentUser), 10);
          return () => {};
        }
      }),
      firestore: Object.assign(() => firestoreInstance, {
        FieldValue: { serverTimestamp: () => new Date().toISOString() }
      }),
      storage: () => ({
        ref: () => ({
          put: async () => ({ ref: { getDownloadURL: async () => 'https://example.com/audio.webm' } }),
          getDownloadURL: async () => 'https://example.com/audio.webm'
        })
      })
    };
  })();`;
}

(async () => {
  console.log('Starting CRM Voice Cloning E2E browser verification...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 960 } });
  const page = await context.newPage();

  page.on('console', (msg) => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => console.error(`[Browser PageError] ${err.message}`));
  let queueTriggered = false;
  let synthesizedJobId = null;

  // Intercept network requests
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;

    // Firebase SDK stubs
    if (pathname.startsWith('/__/firebase/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* firebase sdk stub */'
      });
    }

    // Static assets
    if (url.origin === BASE_ORIGIN && !pathname.startsWith('/api/')) {
      let relativePath = pathname.replace(/^\/+/, '');
      if (!relativePath || relativePath.endsWith('/')) relativePath += 'crm-admin.html';
      const cleanPath = relativePath.split('?')[0];
      const filePath = path.join(PUBLIC_DIR, cleanPath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return route.fulfill({
          status: 200,
          contentType: contentTypeFor(filePath),
          body: fs.readFileSync(filePath)
        });
      }
    }

    // Config & Admin Auth
    if (pathname === '/api/config') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          config: {
            apiKey: 'browser-test-api-key',
            authDomain: 'betterenglishlearning.com',
            projectId: 'test-project',
            storageBucket: 'test.appspot.com'
          }
        })
      });
    }

    if (pathname === '/api/admin/status') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, isAdmin: true })
      });
    }

    // Voice Cloning API Mocks
    if (pathname === '/api/admin/voice-cloning/status' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          worker: {
            ready: true,
            f5ttsReachable: true,
            modelsReady: true,
            lastHeartbeatAt: new Date().toISOString()
          },
          pendingCount: 3,
          processingCount: 0
        })
      });
    }

    if (pathname === '/api/admin/voice-cloning/profiles' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profiles: [
            {
              id: 'voice_01',
              name: 'Teacher Nam - Academic Cadence',
              questionId: 'ra_15',
              audioUrl: '/tools/voice_cloning_lab/samples/my_saved_voice.webm'
            }
          ]
        })
      });
    }

    if (pathname === '/api/admin/voice-cloning/trigger' && method === 'POST') {
      queueTriggered = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Voice cloning queue processing triggered.'
        })
      });
    }

    if (pathname === '/api/admin/voice-cloning/upload-reference' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          audioUrl: '/api/admin/voice-cloning/audio/ref_walkthrough_01',
          fileId: 'ref_walkthrough_01'
        })
      });
    }

    if (pathname === '/api/admin/voice-cloning/synthesize-test' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          jobId: 'test_walkthrough_123',
          status: 'pending'
        })
      });
    }

    if (pathname === '/api/admin/voice-cloning/jobs/test_walkthrough_123' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          id: 'test_walkthrough_123',
          voiceName: 'Calibration Cloned Voice',
          status: 'completed',
          mp3Url: '/audio/voice-cloning/ra_18_cloned_test.mp3',
          durationSeconds: 7.2,
          wpm: 151.0,
          style: 'formal'
        })
      });
    }

    if (pathname === '/api/admin/voice-cloning/synthesize' && method === 'POST') {
      synthesizedJobId = 'job_walkthrough_123';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          jobId: synthesizedJobId,
          status: 'pending'
        })
      });
    }

    if (pathname === '/api/admin/voice-cloning/jobs/job_walkthrough_123' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          id: 'job_walkthrough_123',
          voiceName: 'Teacher Nam - Academic Cadence',
          status: 'completed',
          mp3Url: '/results/generations/job_walkthrough_123.mp3',
          durationSeconds: 6.8,
          wpm: 154.2,
          style: 'connected',
          annotations: [
            { original: 'for', spoken: 'fer', type: 'reduction', note: 'Weak-form' }
          ]
        })
      });
    }

    // Default 200 for other CRM background calls
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });

  // Inject Firebase stub
  await page.addInitScript(buildFirebaseStubScript());

  console.log('Navigating to CRM Voice Cloning panel...');
  await page.goto(VOICE_CLONING_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 1. Verify Panel Visibility
  const panelVisible = await page.$eval('section[data-panel="voice-cloning"]', el => el.style.display !== 'none');
  assert.ok(panelVisible, 'Voice Cloning panel must be visible when hash is #voice-cloning');
  console.log('✔ Voice Cloning panel active and visible');

  // 2. Verify Worker Status & Queue Count
  await page.waitForSelector('#vc-worker-status-badge');
  const badgeText = await page.$eval('#vc-worker-status-badge', el => el.textContent.trim());
  assert.match(badgeText, /Voice Worker: Ready/, 'Worker badge must show Ready');
  console.log(`✔ Worker status verified: "${badgeText}"`);

  const queueCountText = await page.$eval('#vc-queue-count-badge', el => el.textContent.trim());
  assert.match(queueCountText, /3 queued/, 'Queue count must show 3 queued');
  console.log(`✔ Queue count verified: "${queueCountText}"`);

  // 3. Test Manual Queue Trigger
  console.log('Testing manual queue trigger button...');
  await page.click('#btn-vc-queue-trigger');
  await page.waitForTimeout(500);
  assert.ok(queueTriggered, 'Manual queue trigger API must be called');
  console.log('✔ Manual queue trigger executed successfully');

  // 3b. Test Dynamic Calibration Test Output (Step B)
  console.log('Testing dynamic calibration test generation (Step B)...');
  await page.setInputFiles('#vc-audio-file-input', {
    name: 'test_voice.webm',
    mimeType: 'audio/webm',
    buffer: Buffer.from('mock webm audio content')
  });
  await page.waitForTimeout(300);
  await page.click('#btn-vc-generate-test');
  await page.waitForSelector('#vc-test-output-box', { state: 'visible', timeout: 8000 });
  const testAudioSrc = await page.$eval('#vc-test-audio-player', el => el.getAttribute('src'));
  assert.ok(testAudioSrc, 'Step B test audio player must have a valid src');
  console.log(`✔ Step B dynamic cloned audio player loaded: ${testAudioSrc}`);

  // 4. Verify Studio Voice Selector
  const optionTexts = await page.$$eval('#vc-studio-voice-select option', opts => opts.map(o => o.textContent));
  assert.ok(optionTexts.some(t => t.includes('Teacher Nam')), 'Voice selector must contain Teacher Nam profile');
  console.log(`✔ Voice profiles populated: ${optionTexts.join(', ')}`);

  // 5. Switch to Connected Stream Style
  await page.click('#btn-vc-style-connected');
  const isConnectedActive = await page.$eval('#btn-vc-style-connected', el => el.classList.contains('is-active'));
  assert.ok(isConnectedActive, 'Connected style button must become active');
  console.log('✔ Speech style set to Connected Stream');

  // 6. Enter Text & Synthesize
  console.log('Synthesizing custom Read Aloud text...');
  await page.fill('#vc-studio-text-input', 'Certain types of methodology are suitable for research.');
  await page.click('#btn-vc-studio-synthesize');

  // Wait for synthesis result card
  await page.waitForSelector('#vc-studio-output-box', { state: 'visible', timeout: 5000 });
  const outputAudioSrc = await page.$eval('#vc-studio-output-audio', el => el.getAttribute('src'));
  assert.equal(outputAudioSrc, '/results/generations/job_walkthrough_123.mp3', 'Output audio must point to generated MP3');
  console.log(`✔ Output audio player loaded: ${outputAudioSrc}`);

  const downloadHref = await page.$eval('#btn-vc-download-mp3', el => el.getAttribute('href'));
  const downloadAttr = await page.$eval('#btn-vc-download-mp3', el => el.getAttribute('download'));
  assert.equal(downloadHref, '/results/generations/job_walkthrough_123.mp3', 'Download link must point to MP3');
  assert.match(downloadAttr, /\.mp3$/, 'Download attribute must be .mp3 filename');
  console.log(`✔ Download MP3 button ready: "${downloadAttr}"`);

  // Save screenshot
  const screenshotDir = path.join(ROOT, 'artifacts', 'screenshots');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, 'crm-voice-cloning-live-verified.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`✔ Verification screenshot saved to: ${screenshotPath}`);

  await browser.close();
  console.log('\nAll CRM Voice Cloning E2E checks passed with 100% success!');
})();
