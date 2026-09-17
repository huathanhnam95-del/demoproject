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
          uid: 'fluid-test-user',
          email: 'fluid@example.test',
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

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));
  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });
  app.use((_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
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

async function runTests() {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
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

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  try {
    console.log('--- Starting Practice Fluid Layout Acceptance Tests ---');

    await page.addInitScript(() => {
      window.__DISABLE_FIREBASE_EMULATORS__ = true;
      sessionStorage.setItem('pte_onboarding_completed', 'true');
      sessionStorage.setItem('hasSeenA2OnboardingModal', 'true');
      localStorage.setItem('userStatus', 'guest');
      localStorage.setItem('hasSeenScopeTutorial', 'true');
      localStorage.setItem('read-aloudModeFirstUse', 'true');

      if (!window.XLSX || !window.XLSX.utils) {
        window.XLSX = window.XLSX || {};
        window.XLSX.utils = window.XLSX.utils || {};
      }
      window.XLSX.read = () => ({
        SheetNames: ['Sheet1'],
        Sheets: {
          Sheet1: {
            __mockRows: [
              {
                ID: 1,
                ANSWER: 'Yellowstone National Park is a national park located primarily in Wyoming.',
                'ANSWER FOR COMPARE OR TRANSCRIPT': 'Yellowstone National Park is a national park located primarily in Wyoming.',
                'ANSWER CHUNKED': 'Yellowstone National Park / is a national park.'
              }
            ]
          }
        }
      });
      window.XLSX.utils.sheet_to_json = () => [
        {
          ID: 1,
          ANSWER: 'Yellowstone National Park is a national park located primarily in Wyoming.',
          'ANSWER FOR COMPARE OR TRANSCRIPT': 'Yellowstone National Park is a national park located primarily in Wyoming.',
          'ANSWER CHUNKED': 'Yellowstone National Park / is a national park.'
        }
      ];
    });

    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await page.waitForTimeout(500);

    // 1. Initial State: Non-practice route should NOT have fluid-v1
    const initialLayout = await page.evaluate(() => document.body.dataset.practiceLayout);
    assert.strictEqual(initialLayout, undefined, 'Initial non-practice state must not have data-practice-layout');
    console.log('✓ Initial non-practice state verified (no fluid marker)');

    // 2. Multi-viewport Read Aloud tests
    const viewports = [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 }
    ];

    await page.evaluate(() => window.switchToMode('read-aloud'));
    await page.waitForSelector('#mode-read-aloud', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);

      const metrics = await page.evaluate(() => {
        const bodyMarker = document.body.dataset.practiceLayout;
        const shell = document.querySelector('[data-practice-shell]');
        const stage = document.querySelector('#ra-prompt-stage');
        const text = document.querySelector('#ra-text-prompt');
        const docEl = document.documentElement;

        const shellRect = shell ? shell.getBoundingClientRect() : null;
        const stageRect = stage ? stage.getBoundingClientRect() : null;
        const textRect = text ? text.getBoundingClientRect() : null;

        const shellStyle = shell ? window.getComputedStyle(shell) : null;
        const innerShellWidth = shellRect && shellStyle
          ? shellRect.width - parseFloat(shellStyle.paddingLeft) - parseFloat(shellStyle.paddingRight)
          : 0;

        const workspace = document.querySelector('.ra-workbench') || document.querySelector('[data-practice-workarea]');
        const workspaceRect = workspace ? workspace.getBoundingClientRect() : null;

        return {
          bodyMarker,
          clientWidth: docEl.clientWidth,
          scrollWidth: docEl.scrollWidth,
          hasHorizontalOverflow: docEl.scrollWidth > docEl.clientWidth + 1,
          innerShellWidth,
          workspaceTop: workspaceRect ? workspaceRect.top : 0,
          stageWidth: stageRect ? stageRect.width : 0,
          stageTop: stageRect ? stageRect.top : 0,
          stageRatio: innerShellWidth > 0 && stageRect ? stageRect.width / innerShellWidth : 0,
          textWidth: textRect ? textRect.width : 0
        };
      });

      console.log(`[Read Aloud @ ${vp.width}x${vp.height}]`);
      console.log(`  bodyMarker: ${metrics.bodyMarker}`);
      console.log(`  innerShellWidth: ${metrics.innerShellWidth.toFixed(1)}px`);
      console.log(`  stageWidth: ${metrics.stageWidth.toFixed(1)}px (fill ratio: ${(metrics.stageRatio * 100).toFixed(1)}%)`);
      console.log(`  stageTop: ${metrics.stageTop.toFixed(1)}px`);
      console.log(`  overflow: ${metrics.hasHorizontalOverflow ? 'YES (FAIL)' : 'NO (PASS)'}`);

      assert.strictEqual(metrics.bodyMarker, 'fluid-v1', `bodyMarker must be fluid-v1 at ${vp.width}`);
      assert.strictEqual(metrics.hasHorizontalOverflow, false, `Must not overflow horizontally at ${vp.width}`);
      assert.ok(metrics.stageRatio >= 0.88, `Stage must fill >= 88% of inner shell at ${vp.width} (got ${(metrics.stageRatio * 100).toFixed(1)}%)`);

      if (vp.width === 1440) {
        assert.ok(metrics.stageWidth >= 1200, `At 1440px viewport, stage width must be >= 1200px (got ${metrics.stageWidth.toFixed(1)}px)`);
        assert.ok(metrics.workspaceTop <= 245, `At 1440x900 viewport, practice workspace must begin <= 245px (got ${metrics.workspaceTop.toFixed(1)}px)`);
        assert.ok(metrics.stageTop <= 400, `At 1440x900 viewport, stage top must begin <= 400px (got ${metrics.stageTop.toFixed(1)}px)`);
        console.log('  ✓ 1440px wide expansion and vertical clearance verified');
      }
      if (vp.width === 1920) {
        assert.ok(metrics.stageWidth >= 1650, `At 1920px viewport, stage width must be >= 1650px (got ${metrics.stageWidth.toFixed(1)}px)`);
        console.log('  ✓ 1920px wide expansion verified');
      }
    }

    // 3. SWT container-query layout verification
    console.log('\nTesting SWT container-query layout (side-by-side on desktop, stacked on mobile)...');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/pte-practice/writing/swt`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.SWTMode && document.getElementById('mode-swt')), { timeout: 15000 });
    await page.waitForTimeout(600);

    // Click start writing button if available
    const startBtn = page.locator('#start-swt-btn');
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await page.waitForTimeout(400);
    }

    // Desktop check (1440px >= 1040px)
    const swtDesktop = await page.evaluate(() => {
      const source = document.querySelector('.swt-source-card');
      const response = document.querySelector('.swt-compose-card');
      if (!source || !response) return null;
      const sRect = source.getBoundingClientRect();
      const rRect = response.getBoundingClientRect();
      return {
        sourceLeft: sRect.left,
        sourceRight: sRect.right,
        sourceTop: sRect.top,
        responseLeft: rRect.left,
        responseRight: rRect.right,
        responseTop: rRect.top,
        isSideBySide: rRect.left >= sRect.right - 10 && Math.abs(rRect.top - sRect.top) < 60
      };
    });

    if (swtDesktop) {
      console.log('SWT Desktop (1440px):', swtDesktop);
      assert.ok(swtDesktop.isSideBySide, 'SWT desktop layout should be side-by-side at 1440px');
      console.log('✓ SWT side-by-side desktop verified');
    }

    // Mobile check (390px < 1040px)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const swtMobile = await page.evaluate(() => {
      const source = document.querySelector('.swt-source-card');
      const response = document.querySelector('.swt-compose-card');
      if (!source || !response) return null;
      const sRect = source.getBoundingClientRect();
      const rRect = response.getBoundingClientRect();
      return {
        sourceBottom: sRect.bottom,
        responseTop: rRect.top,
        isStacked: rRect.top >= sRect.bottom - 10
      };
    });

    if (swtMobile) {
      console.log('SWT Mobile (390px):', swtMobile);
      assert.ok(swtMobile.isStacked, 'SWT mobile layout should be stacked at 390px');
      console.log('✓ SWT stacked mobile verified');
    }

    // 4. Exit practice mode cleanup verification
    console.log('\nTesting exit mode cleanup...');
    await page.evaluate(() => {
      if (typeof window.exitCurrentMode === 'function') {
        window.exitCurrentMode();
      } else if (typeof window.switchToMode === 'function') {
        window.switchToMode('dashboard');
      }
    });
    await page.waitForTimeout(400);

    const cleanedLayout = await page.evaluate(() => document.body.dataset.practiceLayout);
    assert.strictEqual(cleanedLayout, undefined, 'Exiting practice mode must delete body.dataset.practiceLayout');
    console.log('✓ Practice exit cleanup verified (no leaking data-practice-layout)');

    console.log('\n🎉 ALL PRACTICE FLUID LAYOUT ACCEPTANCE CHECKS PASSED SUCCESSFULLY!');
  } finally {
    await browser.close();
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
