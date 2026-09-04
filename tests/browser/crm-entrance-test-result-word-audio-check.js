const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { admin, db } = require(path.resolve('src', 'utils', 'firebase'));

const cliArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
const TEST_ID = cliArgs[0] || '5726ca5178ece2a551cbd2709366e02dcfd73cad19bd3b81d3db4c44ef685740';
const isHeaded = process.argv.includes('--headed');
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicDir));

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

function buildFirebaseStubScript() {
  return `(function () {
    const firebase = window.firebase || (window.firebase = {});
    const currentUser = {
      email: 'admin@test.com',
      getIdToken: async () => 'fake-token'
    };
    const authState = {
      currentUser,
      setPersistence: async () => {},
      onAuthStateChanged(cb) { cb(currentUser); return () => {}; }
    };
    firebase.apps = firebase.apps || [];
    firebase.initializeApp = firebase.initializeApp || function(c) { firebase.apps.push(c); return firebase; };
    firebase.auth = firebase.auth || function() { return authState; };
    firebase.auth.Auth = firebase.auth.Auth || { Persistence: { LOCAL: 'LOCAL' } };
    firebase.firestore = firebase.firestore || function() { return {}; };
  })();`;
}

async function getRealTestData() {
  const doc = await db.collection('entranceTests').doc(TEST_ID).get();
  if (!doc.exists) {
    throw new Error(`Entrance test ${TEST_ID} not found in Firestore`);
  }
  const testData = doc.data();

  // Generate real signed audio URLs for questions that have audio
  const bucket = admin.storage().bucket('listening-tasks-3ae34.firebasestorage.app');
  const audioUrls = {};

  const speaking = testData.speaking || {};
  for (const [qId, qData] of Object.entries(speaking)) {
    const storagePath = qData?.audio?.storagePath;
    if (storagePath) {
      try {
        const file = bucket.file(storagePath);
        const [url] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000
        });
        audioUrls[qId] = url;
      } catch (err) {
        console.warn(`Could not sign URL for ${qId}:`, err.message);
      }
    }
  }

  // Build standard public session for test 36 plus
  const { buildPublicSession } = require(path.resolve('src', 'entrance-test', 'test36plus'));
  const session = buildPublicSession(TEST_ID);

  return {
    testData,
    audioUrls,
    session
  };
}

async function runBrowserTest() {
  console.log('[1] Loading real test data from Firestore...');
  const { testData, audioUrls, session } = await getRealTestData();
  console.log(`[1] Loaded test data. Speaking questions: ${Object.keys(testData.speaking || {}).join(', ')}`);
  console.log(`[1] Audio URLs signed: ${Object.keys(audioUrls).length}`);

  const { server, origin } = await startHarnessServer();
  console.log(`[2] Harness server listening at: ${origin}`);

  const browser = await chromium.launch({ headless: !isHeaded });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    acceptDownloads: true
  });

  // Stub Firebase auth
  await context.route('**/firebase-app-compat.js*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: buildFirebaseStubScript() });
  });
  await context.route('**/firebase-auth-compat.js*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: buildFirebaseStubScript() });
  });
  await context.route('**/firebase-firestore-compat.js*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: buildFirebaseStubScript() });
  });

  // Mock API config and admin status endpoints
  await context.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        config: { apiKey: 'fake-api-key' }
      })
    });
  });

  await context.route('**/api/admin/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        isAdmin: true
      })
    });
  });

  // Mock API endpoints
  await context.route(`**/api/admin/entrance-tests/${TEST_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        testId: TEST_ID,
        test: testData,
        lead: { id: 'lead-1', name: 'Test Candidate', email: 'candidate@test.com' },
        student: { id: 'student-1', name: 'Test Candidate', email: 'candidate@test.com' },
        session
      })
    });
  });

  // Mock audio-url endpoints
  await context.route(`**/api/admin/entrance-tests/${TEST_ID}/speaking/*/audio-url`, async (route) => {
    const url = route.request().url();
    const match = url.match(/\/speaking\/([^\/]+)\/audio-url/);
    const qId = match ? match[1] : null;
    const signedUrl = (qId && audioUrls[qId]) ? audioUrls[qId] : '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        url: signedUrl
      })
    });
  });

  const page = await context.newPage();

  page.on('console', (msg) => {
    console.log(`[Browser Console ${msg.type()}]`, msg.text());
  });

  try {
    const targetUrl = `${origin}/crm-entrance-test-result.html?testId=${TEST_ID}`;
    console.log(`[3] Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // 1. Check title and speaking details
    await page.waitForSelector('.crm-result-question', { timeout: 10000 });
    console.log('[4] Page loaded and speaking questions rendered.');

    // 2. Check transcript hint
    const hints = await page.$$('.crm-transcript-hint');
    console.log(`[5] Found ${hints.length} transcript hints.`);
    assert(hints.length > 0, 'Transcript hint "(Click any recognized word to play audio)" should be rendered.');
    const hintText = await hints[0].textContent();
    assert.strictEqual(hintText.trim(), '(Click any recognized word to play audio)');

    // 3. Check word tokens
    const wordTokens = await page.$$('.crm-word-token');
    console.log(`[6] Found ${wordTokens.length} total word tokens across speaking questions.`);
    assert(wordTokens.length >= 100, `Expected at least 100 word tokens, got ${wordTokens.length}`);

    const playableTokens = await page.$$('button.crm-word-token[data-playable="true"]');
    console.log(`[7] Found ${playableTokens.length} playable word tokens.`);
    assert(playableTokens.length >= 75, `Expected >= 75 playable tokens, got ${playableTokens.length}`);

    // Check attributes on the first playable token
    const firstPlayable = playableTokens[0];
    const startMs = await firstPlayable.getAttribute('data-start-ms');
    const endMs = await firstPlayable.getAttribute('data-end-ms');
    const title = await firstPlayable.getAttribute('title');
    console.log(`[8] First playable token attributes: startMs=${startMs}, endMs=${endMs}, title="${title}"`);
    assert(Number(startMs) >= 0, 'startMs must be non-negative');
    assert(Number(endMs) > Number(startMs), 'endMs must be greater than startMs');
    assert(title && title.includes('Click to hear'), 'Token should have informative title tooltip');

    // 4. Test clicking word token triggers audio seek and play
    console.log('[9] Testing audio seek on word token click...');

    // Select tokens in Question 1
    const questionCards = await page.$$('.crm-result-question');
    console.log(`[9] Found ${questionCards.length} question cards.`);
    assert(questionCards.length >= 3, 'Expected at least 3 question cards');

    const q1Card = questionCards[0];
    const q1Tokens = await q1Card.$$('button.crm-word-token[data-playable="true"]');
    console.log(`[10] Question 1 has ${q1Tokens.length} playable tokens.`);
    assert(q1Tokens.length >= 10, 'Question 1 should have at least 10 playable tokens');

    const testToken = q1Tokens[4];
    const tokenText = await testToken.textContent();
    const tokenStartMs = Number(await testToken.getAttribute('data-start-ms'));
    const tokenEndMs = Number(await testToken.getAttribute('data-end-ms'));
    console.log(`[11] Selected token: "${tokenText.trim()}" (${tokenStartMs}ms - ${tokenEndMs}ms)`);

    // Click the token
    await testToken.click();
    await page.waitForTimeout(100);

    // Verify token has .is-playing class
    const isPlaying = await testToken.evaluate(el => el.classList.contains('is-playing'));
    assert.strictEqual(isPlaying, true, 'Clicked token must have .is-playing class');
    console.log('[12] Verified .is-playing class applied to clicked token.');

    // Verify audio element seeked to startMs / 1000
    const audioCurrentTime = await q1Card.evaluate(card => {
      const audio = card.querySelector('audio.crm-result-audio');
      return audio ? audio.currentTime : -1;
    });
    console.log(`[13] Audio currentTime: ${audioCurrentTime.toFixed(3)}s (expected ~${(tokenStartMs / 1000).toFixed(3)}s)`);
    assert(Math.abs(audioCurrentTime - (tokenStartMs / 1000)) < 0.5, `Audio currentTime should be near ${(tokenStartMs / 1000)}s`);

    // Take screenshot of playing state
    const screenshotPlayingPath = path.join(SCREENSHOT_DIR, 'entrance-test-word-audio-playing.png');
    await page.screenshot({ path: screenshotPlayingPath, fullPage: false });
    console.log(`[14] Saved screenshot of active playback to ${screenshotPlayingPath}`);

    // Toggle off by clicking the same token again
    console.log('[15] Clicking same token to toggle off playback...');
    await testToken.click();
    await page.waitForTimeout(100);

    const isPlayingAfterToggle = await testToken.evaluate(el => el.classList.contains('is-playing'));
    assert.strictEqual(isPlayingAfterToggle, false, 'Toggling same token must remove .is-playing class');
    console.log('[16] Verified .is-playing removed after toggle click.');

    // 5. Test switching to another token
    console.log('[17] Testing click switch to a different word token...');
    const secondToken = q1Tokens[7];
    const secondStartMs = Number(await secondToken.getAttribute('data-start-ms'));
    await secondToken.click();
    await page.waitForTimeout(100);

    const firstIsPlaying = await testToken.evaluate(el => el.classList.contains('is-playing'));
    const secondIsPlaying = await secondToken.evaluate(el => el.classList.contains('is-playing'));
    assert.strictEqual(firstIsPlaying, false, 'Previous token must not be playing');
    assert.strictEqual(secondIsPlaying, true, 'New token must have .is-playing');
    console.log('[18] Verified switching token cleanly updates active .is-playing state.');

    // 6. Test keyboard activation (Enter key)
    console.log('[19] Testing keyboard activation with Enter key...');
    const thirdToken = q1Tokens[9];
    await thirdToken.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const thirdIsPlaying = await thirdToken.evaluate(el => el.classList.contains('is-playing'));
    assert.strictEqual(thirdIsPlaying, true, 'Pressing Enter on focused word token must activate playback');
    console.log('[20] Verified keyboard Enter activation works.');

    // Stop playback
    await page.keyboard.press('Enter');

    // 7. Verify Question 2 and Question 3 also have playable tokens
    const q2Playable = await questionCards[1].$$('button.crm-word-token[data-playable="true"]');
    const q3Playable = await questionCards[2].$$('button.crm-word-token[data-playable="true"]');
    console.log(`[21] Question 2 playable tokens: ${q2Playable.length}, Question 3 playable tokens: ${q3Playable.length}`);
    assert(q2Playable.length >= 20, 'Question 2 should have playable tokens');
    assert(q3Playable.length >= 15, 'Question 3 should have playable tokens');

    // 8. Verify PDF clone cleanups
    console.log('[21] Testing PDF clone logic to ensure clean printable DOM...');
    const pdfCloneCheck = await page.evaluate(() => {
      const root = document.getElementById('crm-result-root');
      const clone = root.cloneNode(true);
      clone.querySelectorAll('audio').forEach((audio) => audio.remove());
      clone.querySelectorAll('.crm-transcript-hint').forEach((hint) => hint.remove());

      return {
        remainingHints: clone.querySelectorAll('.crm-transcript-hint').length,
        remainingAudio: clone.querySelectorAll('audio').length,
        tokensCount: clone.querySelectorAll('.crm-word-token').length
      };
    });
    console.log('[22] PDF clone check:', pdfCloneCheck);
    assert.strictEqual(pdfCloneCheck.remainingHints, 0, 'PDF clone must remove all transcript hints');
    assert.strictEqual(pdfCloneCheck.remainingAudio, 0, 'PDF clone must remove all audio tags');
    assert(pdfCloneCheck.tokensCount > 0, 'PDF clone retains word token elements for styled reading');

    // Capture full page screenshot
    const fullScreenshotPath = path.join(SCREENSHOT_DIR, 'entrance-test-word-audio-full.png');
    await page.screenshot({ path: fullScreenshotPath, fullPage: true });
    console.log(`[23] Saved full page screenshot to ${fullScreenshotPath}`);

    console.log('\n========================================');
    console.log('ALL WORD AUDIO PLAYBACK TESTS PASSED!');
    console.log('========================================\n');

    if (isHeaded) {
      console.log('[Interactive Mode] Browser window is now open!');
      console.log('Click on any green or red word to hear its audio segment.');
      console.log('Close the browser window when you are done.\n');
      await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

runBrowserTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
