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
          uid: 'swt-review-user',
          email: 'swt-review@example.test',
          metadata: { lastSignInTime: 'Wed, 13 May 2026 00:00:00 GMT' },
          getIdTokenResult: () => Promise.resolve({ claims: {} })
        };
        export const getAuth = () => ({ currentUser: mockUser });
        export const connectAuthEmulator = () => {};
        export const onAuthStateChanged = (auth, cb) => { setTimeout(() => cb(mockUser), 10); return () => {}; };
        export const setPersistence = () => Promise.resolve();
        export const browserLocalPersistence = 'local';
        export const signInWithEmailAndPassword = () => Promise.resolve({ user: { uid: 'swt-review-user' } });
        export const signOut = () => Promise.resolve();
        export const createUserWithEmailAndPassword = () => Promise.resolve({ user: { uid: 'swt-review-user' } });
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
        export const collection = (db, path) => ({ _type: 'collection', path });
        export const doc = (db, path, ...segments) => ({ _type: 'doc', path: [path, ...segments].filter(Boolean).join('/') });
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
        export const httpsCallable = (functions, name) => async (payload) => {
          return { data: { success: true } };
        };
      `
    });
  });
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
  app.get(/^(?!\/api).*$/, (req, res, next) => {
    if (/\.\w{2,5}(\?.*)?$/.test(req.path)) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

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

(async () => {
  console.log('Starting SWT Parallel Answer Review browser tests...');
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await setupFirebaseMocks(context);
  const page = await context.newPage();
  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
      console.log(`[browser error] ${message.text()}`);
    }
  });

  await page.addInitScript(() => {
    window.__DISABLE_FIREBASE_EMULATORS__ = true;
    localStorage.setItem('swtModeFirstUse', 'true');
    localStorage.setItem('swtInfoDismissed', '1');
  });

  try {
    await page.goto(`${origin}/pte-practice/writing/swt`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.switchToMode && window.SWTMode && window.SWTEvidence && window.SWTReview));
    await page.waitForFunction(() => {
      const pill = document.getElementById('swt-v7-question-pill');
      return pill && pill.textContent.includes('#1');
    });

    console.log('Step 1: Starting attempt and submitting summary...');
    await page.click('#start-swt-btn');
    await page.waitForSelector('#swt-step-write', { state: 'visible' });

    await page.fill('#swt-input', 'Major sporting events around the globe are taking coordinated steps to neutralize their carbon footprint through global initiatives.');
    await page.click('#swt-submit-btn');

    await page.waitForSelector('#swt-step-results', { state: 'visible' });
    await page.waitForSelector('#swt-parallel-review-mount .swt-review-shell', { state: 'visible' });

    console.log('Step 2: Verifying desktop split review layout...');
    const desktopState = await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      const ctrl = window.SWTMode.getReviewController();
      const st = ctrl ? ctrl.getState() : null;
      const sourceMarks = document.querySelectorAll('.swt-review-passage mark');
      const coreTab = document.querySelector('.swt-review-tab-core');
      const ignoreTab = document.querySelector('.swt-review-tab-ignore');
      const coreCount = document.querySelector('.swt-review-count-core')?.textContent;
      const ignoreCount = document.querySelector('.swt-review-count-ignore')?.textContent;
      const point1 = document.getElementById('point-core-1');
      const caption = document.querySelector('.swt-review-evidence-caption')?.textContent;
      const counter = document.querySelector('.swt-review-evidence-counter')?.textContent;
      const prevBtn = document.querySelector('.swt-review-prev-evidence');
      const nextBtn = document.querySelector('.swt-review-next-evidence');

      return {
        isSplit: shell.classList.contains('is-split'),
        activeKind: st?.activeKind,
        activePointId: st?.activePointId,
        markCount: sourceMarks.length,
        firstMarkClass: sourceMarks[0]?.className,
        coreSelected: coreTab.getAttribute('aria-selected'),
        ignoreSelected: ignoreTab.getAttribute('aria-selected'),
        coreCount,
        ignoreCount,
        point1Pressed: point1?.getAttribute('aria-pressed'),
        caption,
        counter,
        prevDisabled: prevBtn?.disabled,
        nextDisabled: nextBtn?.disabled
      };
    });

    assert.strictEqual(desktopState.isSplit, true, 'Desktop review should have .is-split layout');
    assert.strictEqual(desktopState.activeKind, 'core', 'Initial tab should be core');
    assert.strictEqual(desktopState.activePointId, 'core-1', 'Initial point should be core-1');
    assert.ok(desktopState.markCount >= 2, 'Core-1 evidence marks should be rendered in passage');
    assert.ok(desktopState.firstMarkClass.includes('swt-evidence--core'), 'Marks should have .swt-evidence--core class');
    assert.strictEqual(desktopState.coreSelected, 'true', 'Core tab should be selected');
    assert.strictEqual(desktopState.ignoreSelected, 'false', 'Ignore tab should not be selected');
    assert.strictEqual(desktopState.coreCount, '4', 'Core count should be 4');
    assert.strictEqual(desktopState.ignoreCount, '3', 'Ignore count should be 3');
    assert.strictEqual(desktopState.point1Pressed, 'true', 'Point 1 should have aria-pressed="true"');
    assert.strictEqual(desktopState.caption, 'Core point 01', 'Evidence caption should display Core point 01');
    assert.ok(desktopState.counter.includes('Excerpt 1 of 2'), 'Counter should display Excerpt 1 of 2');
    assert.strictEqual(desktopState.prevDisabled, true, 'Prev evidence button should be disabled on first excerpt');
    assert.strictEqual(desktopState.nextDisabled, false, 'Next evidence button should be enabled');

    console.log('Step 3: Verifying excerpt navigation...');
    await page.click('.swt-review-next-evidence');
    const excerpt2State = await page.evaluate(() => {
      const counter = document.querySelector('.swt-review-evidence-counter')?.textContent;
      const prevBtn = document.querySelector('.swt-review-prev-evidence');
      const nextBtn = document.querySelector('.swt-review-next-evidence');
      const chip2 = document.querySelector('.swt-review-evidence-chip[data-excerpt="1"]');
      return {
        counter,
        prevDisabled: prevBtn?.disabled,
        nextDisabled: nextBtn?.disabled,
        chip2Pressed: chip2?.getAttribute('aria-pressed')
      };
    });

    assert.ok(excerpt2State.counter.includes('Excerpt 2 of 2'), 'Counter should update to Excerpt 2 of 2');
    assert.strictEqual(excerpt2State.prevDisabled, false, 'Prev button should be enabled on excerpt 2');
    assert.strictEqual(excerpt2State.nextDisabled, true, 'Next button should be disabled on last excerpt');
    assert.strictEqual(excerpt2State.chip2Pressed, 'true', 'Chip 2 should be pressed');

    console.log('Step 4: Verifying category switching to Points to ignore...');
    await page.click('.swt-review-tab-ignore');
    const ignoreTabState = await page.evaluate(() => {
      const corePanel = document.querySelector('.swt-review-panel-core');
      const ignorePanel = document.querySelector('.swt-review-panel-ignore');
      const coreTab = document.querySelector('.swt-review-tab-core');
      const ignoreTab = document.querySelector('.swt-review-tab-ignore');
      const caption = document.querySelector('.swt-review-evidence-caption')?.textContent;
      return {
        corePanelHidden: corePanel.hidden,
        ignorePanelHidden: ignorePanel.hidden,
        coreSelected: coreTab.getAttribute('aria-selected'),
        ignoreSelected: ignoreTab.getAttribute('aria-selected'),
        caption
      };
    });

    assert.strictEqual(ignoreTabState.corePanelHidden, true, 'Core panel should be hidden');
    assert.strictEqual(ignoreTabState.ignorePanelHidden, false, 'Ignore panel should be visible');
    assert.strictEqual(ignoreTabState.coreSelected, 'false', 'Core tab aria-selected should be false');
    assert.strictEqual(ignoreTabState.ignoreSelected, 'true', 'Ignore tab aria-selected should be true');
    assert.ok(ignoreTabState.caption.includes('Choose a point'), 'Category switch should reset active point');

    console.log('Step 5: Verifying Ignore point selection and dotted highlight...');
    await page.click('#point-ignore-1');
    const ignorePointState = await page.evaluate(() => {
      const marks = document.querySelectorAll('.swt-review-passage mark');
      const caption = document.querySelector('.swt-review-evidence-caption')?.textContent;
      return {
        markCount: marks.length,
        firstMarkClass: marks[0]?.className,
        caption
      };
    });

    assert.strictEqual(ignorePointState.markCount, 1, 'Ignore-1 should highlight 1 excerpt (date)');
    assert.ok(ignorePointState.firstMarkClass.includes('swt-evidence--ignore'), 'Mark should have .swt-evidence--ignore class');
    assert.strictEqual(ignorePointState.caption, 'Point to ignore 01', 'Caption should display Point to ignore 01');

    console.log('Step 6: Verifying "Highlight all" overview...');
    await page.click('.swt-review-show-all-ignore');
    const highlightAllState = await page.evaluate(() => {
      const marks = document.querySelectorAll('.swt-review-passage mark');
      const caption = document.querySelector('.swt-review-evidence-caption')?.textContent;
      const btnPressed = document.querySelector('.swt-review-show-all-ignore')?.getAttribute('aria-pressed');
      return {
        markCount: marks.length,
        caption,
        btnPressed
      };
    });

    assert.strictEqual(highlightAllState.btnPressed, 'true', 'Highlight all button should have aria-pressed="true"');
    assert.strictEqual(highlightAllState.markCount, 3, 'All 3 ignore points should be highlighted');
    assert.strictEqual(highlightAllState.caption, 'All points to ignore', 'Caption should show All points to ignore');

    console.log('Step 7: Verifying Escape key clears overview / selection...');
    await page.keyboard.press('Escape');
    const clearedState = await page.evaluate(() => {
      const marks = document.querySelectorAll('.swt-review-passage mark');
      const caption = document.querySelector('.swt-review-evidence-caption')?.textContent;
      const btnPressed = document.querySelector('.swt-review-show-all-ignore')?.getAttribute('aria-pressed');
      return {
        markCount: marks.length,
        caption,
        btnPressed
      };
    });

    assert.strictEqual(clearedState.markCount, 0, 'Marks should be cleared after Escape');
    assert.strictEqual(clearedState.btnPressed, 'false', 'Highlight all button should be unpressed');
    assert.ok(clearedState.caption.includes('Choose a point'), 'Caption should be reset');

    console.log('Step 8: Verifying Keyboard Tab switching (ArrowLeft / ArrowRight)...');
    await page.focus('.swt-review-tab-ignore');
    await page.keyboard.press('ArrowLeft');
    const arrowLeftState = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-core')?.getAttribute('aria-selected');
    });
    assert.strictEqual(arrowLeftState, 'true', 'ArrowLeft should navigate to Core points tab');

    console.log('Step 9: Verifying Mobile responsive layout (< 1024px)...');
    await page.setViewportSize({ width: 390, height: 844 });
    // Trigger resize observer / layout update
    await page.evaluate(() => {
      window.SWTMode.getReviewController()?.updateLayout();
    });

    const mobileState = await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      const switchEl = document.querySelector('.swt-review-mobile-switch');
      const viewAnalysisBtn = document.querySelector('.swt-review-view-btn[data-view="analysis"]');
      const viewSourceBtn = document.querySelector('.swt-review-view-btn[data-view="source"]');
      const sourcePane = document.querySelector('.swt-review-source-pane');
      const analysisPane = document.querySelector('.swt-review-analysis-pane');

      return {
        isSplit: shell.classList.contains('is-split'),
        switchVisible: getComputedStyle(switchEl).display !== 'none',
        currentView: shell.dataset.view,
        analysisPressed: viewAnalysisBtn.getAttribute('aria-pressed'),
        sourcePressed: viewSourceBtn.getAttribute('aria-pressed'),
        sourceDisplay: getComputedStyle(sourcePane).display,
        analysisDisplay: getComputedStyle(analysisPane).display
      };
    });

    assert.strictEqual(mobileState.isSplit, false, 'Mobile viewport should NOT be .is-split');
    assert.strictEqual(mobileState.switchVisible, true, 'Mobile view switch should be visible');
    assert.strictEqual(mobileState.analysisDisplay !== 'none', true, 'Analysis pane should be visible in analysis view');
    assert.strictEqual(mobileState.sourceDisplay, 'none', 'Source pane should be hidden in analysis view');

    // Tap a point in mobile view -> auto-switches to source view
    await page.click('#point-core-1');
    const afterMobilePointClick = await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      const sourcePane = document.querySelector('.swt-review-source-pane');
      const analysisPane = document.querySelector('.swt-review-analysis-pane');
      const marks = document.querySelectorAll('.swt-review-passage mark');

      return {
        currentView: shell.dataset.view,
        sourceDisplay: getComputedStyle(sourcePane).display,
        analysisDisplay: getComputedStyle(analysisPane).display,
        markCount: marks.length
      };
    });

    assert.strictEqual(afterMobilePointClick.currentView, 'source', 'Selecting point on mobile should switch to source view');
    assert.strictEqual(afterMobilePointClick.sourceDisplay !== 'none', true, 'Source pane should now be visible');
    assert.strictEqual(afterMobilePointClick.analysisDisplay, 'none', 'Analysis pane should now be hidden');
    assert.ok(afterMobilePointClick.markCount >= 2, 'Evidence marks should be visible in mobile source view');

    // Switch back to analysis view
    await page.click('.swt-review-view-btn[data-view="analysis"]');
    const afterSwitchBack = await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      return shell.dataset.view;
    });
    assert.strictEqual(afterSwitchBack, 'analysis', 'Switching back to analysis view should work');

    console.log('Step 10: Verifying cleanup on Retry...');
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.click('#swt-retry-btn');

    const afterRetry = await page.evaluate(() => {
      const mount = document.getElementById('swt-parallel-review-mount');
      const ctrl = window.SWTMode.getReviewController();
      const practiceHidden = getComputedStyle(document.getElementById('swt-practice-area')).display === 'none';
      const startVisible = getComputedStyle(document.getElementById('start-swt-btn')).display !== 'none';
      return {
        mountDisplay: getComputedStyle(mount).display,
        mountChildren: mount.children.length,
        controllerActive: Boolean(ctrl?.getState()?.isMounted),
        practiceHidden,
        startVisible
      };
    });

    assert.strictEqual(afterRetry.mountDisplay, 'none', 'Parallel review mount should be hidden after retry');
    assert.strictEqual(afterRetry.mountChildren, 0, 'Parallel review mount should be cleared');
    assert.strictEqual(afterRetry.controllerActive, false, 'Review controller should be destroyed');
    assert.strictEqual(afterRetry.practiceHidden, true, 'Practice area should be reset');
    assert.strictEqual(afterRetry.startVisible, true, 'Start button should be visible');

    assert.deepStrictEqual(pageErrors, [], `Expected no page errors, got: ${pageErrors.join(' | ')}`);
    console.log('SWT Parallel Answer Review browser tests PASSED successfully!');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
