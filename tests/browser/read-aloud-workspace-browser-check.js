/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

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
        const mockUser = {
          uid: 'ra-test-user',
          email: 'ra@example.test',
          metadata: {
            lastSignInTime: 'Thu, 14 May 2026 10:00:00 GMT',
            creationTime: 'Thu, 14 May 2026 10:00:00 GMT'
          },
          getIdToken: () => Promise.resolve('mock-token'),
          getIdTokenResult: () => Promise.resolve({ claims: {} })
        };
        export const getAuth = () => ({ currentUser: mockUser });
        export const connectAuthEmulator = () => {};
        export const onAuthStateChanged = (auth, cb) => { setTimeout(() => cb(mockUser), 10); return () => {}; };
        export const setPersistence = () => Promise.resolve();
        export const browserLocalPersistence = 'local';
        export const signInWithEmailAndPassword = () => Promise.resolve({ user: mockUser });
        export const signOut = () => Promise.resolve();
        export const createUserWithEmailAndPassword = () => Promise.resolve({ user: mockUser });
        export const sendPasswordResetEmail = () => Promise.resolve();
        export const sendEmailVerification = () => Promise.resolve();
        export const signInWithCustomToken = () => Promise.resolve({ user: mockUser });
      `
    });
  });

  await context.route('**/firebase-firestore.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getFirestore = () => ({ _type: 'firestore' });
        export const connectFirestoreEmulator = () => {};
        export const collection = (db, path) => ({ path });
        export const doc = (db, path, ...segments) => ({ path: [path, ...segments].filter(Boolean).join('/') });
        export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
        export const getDocs = async () => ({ empty: true, docs: [], forEach: () => {} });
        export const onSnapshot = (queryRef, onNext) => { onNext?.({ empty: true, docs: [] }); return () => {}; };
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
        export const Timestamp = { now: () => new Date(), fromDate: (d) => d };
        export const writeBatch = () => ({ set: () => {}, update: () => {}, commit: async () => {} });
        export const runTransaction = async (db, cb) => cb({ get: async () => ({ exists: () => false }), set: () => {}, update: () => {} });
        export const setLogLevel = () => {};
      `
    });
  });

  await context.route('**/firebase-functions.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getFunctions = () => ({ _type: 'functions' });
        export const connectFunctionsEmulator = () => {};
        export const httpsCallable = () => async () => ({ data: {} });
      `
    });
  });

  await context.route('**/df-messenger.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        customElements.define('df-messenger', class extends HTMLElement {});
        customElements.define('df-messenger-chat-bubble', class extends HTMLElement {});
      `
    });
  });
}

async function mockWorkbookRows(page, rows) {
  await page.evaluate((mockRows) => {
    if (!window.XLSX || !window.XLSX.utils) {
      window.XLSX = window.XLSX || {};
      window.XLSX.utils = window.XLSX.utils || {};
    }
    const originalSheetToJson = window.XLSX.utils.sheet_to_json ? window.XLSX.utils.sheet_to_json.bind(window.XLSX.utils) : null;
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
      return originalSheetToJson ? originalSheetToJson(worksheet) : [];
    };
  }, rows);
}

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        origin: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    permissions: ['microphone']
  });
  await setupFirebaseMocks(context);

  await context.route('**/database/RA/RA.xlsx*', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: Buffer.from([1, 2, 3, 4])
    });
  });

  await context.route('**/database/RA/Voice/audio/manifest.json*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        1: { male: { files: { 100: 'dummy.wav' } } }
      })
    });
  });

  await context.route('**/api/read-aloud/assess*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        success: true,
        accuracyScore: 90,
        recognizedText: 'Yellowstone National Park is a national park located in the United States.',
        words: []
      })
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  const sampleRows = [
    {
      ID: 1,
      ANSWER: 'Yellowstone National Park is a national park located primarily in the U.S. state of Wyoming, though the park also extends into Montana and Idaho.',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'Yellowstone National Park is a national park located primarily in the U.S. state of Wyoming, though the park also extends into Montana and Idaho.',
      'ANSWER CHUNKED': 'Yellowstone National Park / is a national park / located primarily in the U.S. state of Wyoming, / though the park also extends / into Montana and Idaho.'
    },
    {
      ID: 2,
      ANSWER: 'Photography is the art, application, and practice of creating images by recording light, either electronically by means of an image sensor, or chemically.',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'Photography is the art, application, and practice of creating images by recording light, either electronically by means of an image sensor, or chemically.',
      'ANSWER CHUNKED': 'Photography is the art, / application, and practice / of creating images / by recording light.'
    }
  ];

  try {
    console.log('Testing Read Aloud Workspace V2...');

    await page.addInitScript(() => {
      window.__DISABLE_FIREBASE_EMULATORS__ = true;
      sessionStorage.setItem('pte_onboarding_completed', 'true');
      sessionStorage.setItem('hasSeenA2OnboardingModal', 'true');

      navigator.mediaDevices = navigator.mediaDevices || {};
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
      window.MediaRecorder = class FakeMediaRecorder {
        static isTypeSupported() { return true; }
        constructor(_stream, opts) {
          this.mimeType = opts?.mimeType || 'audio/webm';
          this.state = 'inactive';
        }
        start() {
          this.state = 'recording';
        }
        stop() {
          this.state = 'inactive';
          this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
          this.onstop?.();
        }
      };
    });

    // 1. Test V2 Workspace Flag
    console.log(`Navigating to ${origin}/?raWorkspace=v2...`);
    await page.goto(`${origin}/?raWorkspace=v2`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 20000 });

    // Dismiss any modals
    await page.evaluate(() => {
      document.getElementById('vocab-alert-ok')?.click();
      document.querySelector('.modal-close-btn')?.click();
    });

    await mockWorkbookRows(page, sampleRows);

    console.log('Switching to read-aloud mode...');
    await page.evaluate(async () => window.switchToMode('read-aloud'));

    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 10000 });

    // Wait for read aloud prompt to be ready
    await page.waitForFunction(() => {
      return window.ReadAloudMode && window.ReadAloudMode.isActive && window.ReadAloudMode.currentPromptReady;
    }, null, { timeout: 15000 });

    // Verify V2 Workspace DOM structure
    const isV2 = await page.evaluate(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel && panel.dataset.raWorkspace === 'v2';
    });
    assert.strictEqual(isV2, true, 'mode-read-aloud must have data-ra-workspace="v2"');
    console.log('✓ V2 workspace attribute active on #mode-read-aloud');

    const headerExists = await page.waitForSelector('#ra-workspace-heading', { state: 'visible' });
    assert.ok(headerExists, '#ra-workspace-heading must exist');
    console.log('✓ Compact header rendered');

    const stepsHost = await page.waitForSelector('#ra-workspace-steps-host', { state: 'visible' });
    assert.ok(stepsHost, '#ra-workspace-steps-host must exist');
    console.log('✓ Steps host mounted');

    const instruction = await page.waitForSelector('#ra-workspace-instruction', { state: 'visible' });
    assert.ok(instruction, '#ra-workspace-instruction must exist');
    console.log('✓ Stage instruction rendered');

    const coachHost = await page.waitForSelector('#ra-workspace-coach-host', { state: 'visible' });
    assert.ok(coachHost, '#ra-workspace-coach-host must exist');
    console.log('✓ Speaking tips host rendered');

    // 2. Test Passage Geometry Stability Across States
    console.log('Testing passage bounding box stability across transitions...');
    const prepBox = await page.evaluate(() => {
      const stage = document.getElementById('ra-prompt-stage');
      const rect = stage.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    assert.ok(prepBox.width > 300, `Passage width should be substantial (actual: ${prepBox.width})`);

    // Transition to RECORDING state
    await page.evaluate(() => {
      window.ReadAloudMode.state = 'RECORDING';
      window.ReadAloudMode.updateUIForState();
    });
    await page.waitForTimeout(100);

    const recordingBox = await page.evaluate(() => {
      const stage = document.getElementById('ra-prompt-stage');
      const rect = stage.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    const deltaXRec = Math.abs(prepBox.x - recordingBox.x);
    const deltaWidthRec = Math.abs(prepBox.width - recordingBox.width);
    console.log(`Transition to RECORDING: deltaX = ${deltaXRec.toFixed(3)}px, deltaWidth = ${deltaWidthRec.toFixed(3)}px`);
    assert.ok(deltaXRec < 1.0, `Passage x must not shift >= 1px (actual: ${deltaXRec})`);
    assert.ok(deltaWidthRec < 1.0, `Passage width must not change >= 1px (actual: ${deltaWidthRec})`);

    // Verify button states in RECORDING
    const stopButtonState = await page.evaluate(() => {
      const stopBtn = document.getElementById('ra-stop-btn');
      const recordBtn = document.getElementById('ra-record-btn');
      return {
        stopHidden: stopBtn ? stopBtn.hidden : true,
        stopEmphasis: stopBtn ? stopBtn.dataset.raEmphasis : null,
        recordHidden: recordBtn ? recordBtn.hidden : false
      };
    });
    assert.strictEqual(stopButtonState.stopHidden, false, 'Stop button must be visible in RECORDING');
    assert.strictEqual(stopButtonState.stopEmphasis, 'primary', 'Stop button must have primary emphasis');
    assert.strictEqual(stopButtonState.recordHidden, true, 'Record button must be hidden in RECORDING');
    console.log('✓ Action button states verified for RECORDING phase');

    // Transition to RECORDED state
    await page.evaluate(() => {
      window.ReadAloudMode.state = 'RECORDED';
      window.ReadAloudMode.pendingBlob = new Blob(['mock audio blob'], { type: 'audio/webm' });
      window.ReadAloudMode.pendingSession = {
        id: 1,
        disposition: 'submit',
        promptToken: window.ReadAloudMode.promptLifecycleToken,
        referenceText: window.ReadAloudMode.currentPromptPlainText
      };
      window.ReadAloudMode.updateUIForState();
    });
    await page.waitForTimeout(100);

    const recordedBox = await page.evaluate(() => {
      const stage = document.getElementById('ra-prompt-stage');
      const rect = stage.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const deltaXRecorded = Math.abs(prepBox.x - recordedBox.x);
    const deltaWidthRecorded = Math.abs(prepBox.width - recordedBox.width);
    console.log(`Transition to RECORDED: deltaX = ${deltaXRecorded.toFixed(3)}px, deltaWidth = ${deltaWidthRecorded.toFixed(3)}px`);
    assert.ok(deltaXRecorded < 1.0, `Passage x must not shift >= 1px (actual: ${deltaXRecorded})`);
    assert.ok(deltaWidthRecorded < 1.0, `Passage width must not change >= 1px (actual: ${deltaWidthRecorded})`);

    // Verify button states in RECORDED
    const recordedActionState = await page.evaluate(() => {
      const checkBtn = document.getElementById('ra-check-btn');
      const retryBtn = document.getElementById('ra-retry-btn');
      return {
        checkHidden: checkBtn ? checkBtn.hidden : true,
        checkEmphasis: checkBtn ? checkBtn.dataset.raEmphasis : null,
        checkDisabled: checkBtn ? checkBtn.disabled : true,
        retryHidden: retryBtn ? retryBtn.hidden : true,
        retryEmphasis: retryBtn ? retryBtn.dataset.raEmphasis : null
      };
    });
    assert.strictEqual(recordedActionState.checkHidden, false, 'Check button must be visible in RECORDED');
    assert.strictEqual(recordedActionState.checkEmphasis, 'primary', 'Check button must have primary emphasis');
    assert.strictEqual(recordedActionState.checkDisabled, false, 'Check button must be enabled when attempt is present');
    assert.strictEqual(recordedActionState.retryHidden, false, 'Retry button must be visible in RECORDED');
    assert.strictEqual(recordedActionState.retryEmphasis, 'secondary', 'Retry button must have secondary emphasis');
    console.log('✓ Action button states verified for RECORDED phase');

    // 3. Test Navigation Guard
    console.log('Testing navigation guard for unsubmitted attempts...');
    const initialQid = await page.evaluate(() => window.ReadAloudMode.currentQuestionId);

    // Cancel navigation
    await page.evaluate(() => {
      window.confirm = () => false;
      window.ReadAloudMode.loadSpecificPrompt(1);
    });
    await page.waitForTimeout(200);
    const qidAfterCancel = await page.evaluate(() => window.ReadAloudMode.currentQuestionId);
    assert.strictEqual(qidAfterCancel, initialQid, 'Question must NOT change when user cancels confirmation');
    console.log('✓ Navigation guard prevented question discard on cancel');

    // Confirm navigation
    await page.evaluate(() => {
      window.confirm = () => true;
      window.ReadAloudMode.loadSpecificPrompt(1);
    });

    await page.waitForFunction((prevId) => {
      return window.ReadAloudMode.currentQuestionId !== prevId && window.ReadAloudMode.currentPromptReady;
    }, initialQid, { timeout: 10000 });
    console.log('✓ Navigation proceeded when user confirmed discard');

    // 4. Test Legacy Mode Isolation
    console.log('Testing legacy mode isolation without query flag...');
    await page.goto(`${origin}/?raWorkspace=legacy`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 20000 });
    await mockWorkbookRows(page, sampleRows);
    await page.evaluate(async () => window.switchToMode('read-aloud'));
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 10000 });
    await page.waitForFunction(() => {
      return window.ReadAloudMode && window.ReadAloudMode.isActive && window.ReadAloudMode.currentPromptReady;
    }, null, { timeout: 15000 });

    const isLegacy = await page.evaluate(() => {
      const panel = document.getElementById('mode-read-aloud');
      return !panel.dataset.raWorkspace || panel.dataset.raWorkspace === 'legacy';
    });
    assert.strictEqual(isLegacy, true, 'Legacy mode must NOT have data-ra-workspace="v2"');
    console.log('✓ Legacy mode is fully preserved and isolated');

    // 5. Test Default Mode (No query params) Activates V2
    console.log('Testing default navigation without query parameters activates V2...');
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 20000 });
    await mockWorkbookRows(page, sampleRows);
    await page.evaluate(async () => window.switchToMode('read-aloud'));
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 10000 });
    await page.waitForFunction(() => {
      return window.ReadAloudMode && window.ReadAloudMode.isActive && window.ReadAloudMode.currentPromptReady;
    }, null, { timeout: 15000 });

    const isV2ByDefault = await page.evaluate(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel && panel.dataset.raWorkspace === 'v2';
    });
    assert.strictEqual(isV2ByDefault, true, 'Default mode must activate V2 workspace without query flag');
    console.log('✓ V2 workspace is active by default without query flag');

    // Capture screenshot of V2 workspace
    const screenshotPath = path.join(__dirname, 'read-aloud-workspace-v2.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`✓ Screenshot captured: ${screenshotPath}`);

    console.log('\nALL READ ALOUD WORKSPACE V2 BROWSER CHECKS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})();
