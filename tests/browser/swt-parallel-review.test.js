/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const fs = require('fs');
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
  const screenshotDir = path.join(__dirname, '..', '..', 'test-results', 'swt-local-test');
  fs.mkdirSync(screenshotDir, { recursive: true });

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
      const sampleTab = document.querySelector('.swt-review-tab-sample');
      const coreCount = document.querySelector('.swt-review-count-core')?.textContent;
      const ignoreCount = document.querySelector('.swt-review-count-ignore')?.textContent;
      const sampleCount = document.querySelector('.swt-review-count-sample')?.textContent;
      const point1 = document.getElementById('point-core-1');
      const caption = document.querySelector('.swt-review-evidence-caption')?.textContent;
      const counter = document.querySelector('.swt-review-evidence-counter')?.textContent;
      const prevBtn = document.querySelector('.swt-review-prev-evidence');
      const nextBtn = document.querySelector('.swt-review-next-evidence');
      const coreTabControls = coreTab?.getAttribute('aria-controls');
      const ignoreTabControls = ignoreTab?.getAttribute('aria-controls');
      const sampleTabControls = sampleTab?.getAttribute('aria-controls');
      const corePanelLabel = document.getElementById('swt-review-panel-core')?.getAttribute('aria-labelledby');
      const ignorePanelLabel = document.getElementById('swt-review-panel-ignore')?.getAttribute('aria-labelledby');
      const samplePanelLabel = document.getElementById('swt-review-panel-sample')?.getAttribute('aria-labelledby');
      const point1Controls = point1?.getAttribute('aria-controls');
      const showAllControls = document.querySelector('.swt-review-show-all-core')?.getAttribute('aria-controls');
      const viewAnalysisControls = document.querySelector('.swt-review-view-btn[data-view="analysis"]')?.getAttribute('aria-controls');
      const viewSourceControls = document.querySelector('.swt-review-view-btn[data-view="source"]')?.getAttribute('aria-controls');

      return {
        isSplit: shell.classList.contains('is-split'),
        activeKind: st?.activeKind,
        activePointId: st?.activePointId,
        markCount: sourceMarks.length,
        firstMarkClass: sourceMarks[0]?.className,
        coreSelected: coreTab.getAttribute('aria-selected'),
        ignoreSelected: ignoreTab.getAttribute('aria-selected'),
        sampleSelected: sampleTab.getAttribute('aria-selected'),
        coreCount,
        ignoreCount,
        sampleCount,
        point1Pressed: point1?.getAttribute('aria-pressed'),
        caption,
        counter,
        prevDisabled: prevBtn?.disabled,
        nextDisabled: nextBtn?.disabled,
        coreTabControls,
        ignoreTabControls,
        sampleTabControls,
        corePanelLabel,
        ignorePanelLabel,
        samplePanelLabel,
        point1Controls,
        showAllControls,
        viewAnalysisControls,
        viewSourceControls
      };
    });

    assert.strictEqual(desktopState.isSplit, true, 'Desktop review should have .is-split layout');
    assert.strictEqual(desktopState.activeKind, 'core', 'Initial tab should be core');
    assert.strictEqual(desktopState.activePointId, 'core-1', 'Initial point should be core-1');
    assert.ok(desktopState.markCount >= 2, 'Core-1 evidence marks should be rendered in passage');
    assert.ok(desktopState.firstMarkClass.includes('swt-evidence--core'), 'Marks should have .swt-evidence--core class');
    assert.strictEqual(desktopState.coreSelected, 'true', 'Core tab should be selected');
    assert.strictEqual(desktopState.ignoreSelected, 'false', 'Ignore tab should not be selected');
    assert.strictEqual(desktopState.sampleSelected, 'false', 'Sample tab should not be selected');
    assert.strictEqual(desktopState.coreCount, '4', 'Core count should be 4');
    assert.strictEqual(desktopState.ignoreCount, '3', 'Ignore count should be 3');
    assert.strictEqual(desktopState.sampleCount, '3', 'Sample count badge should reflect 3 versions');
    assert.strictEqual(desktopState.point1Pressed, 'true', 'Point 1 should have aria-pressed="true"');
    assert.strictEqual(desktopState.caption, 'Core point 01', 'Evidence caption should display Core point 01');
    assert.ok(desktopState.counter.includes('Excerpt 1 of 2'), 'Counter should display Excerpt 1 of 2');
    assert.strictEqual(desktopState.prevDisabled, true, 'Prev evidence button should be disabled on first excerpt');
    assert.strictEqual(desktopState.nextDisabled, false, 'Next evidence button should be enabled');

    // W3C ARIA linkages
    assert.strictEqual(desktopState.coreTabControls, 'swt-review-panel-core', 'Core tab should control core panel');
    assert.strictEqual(desktopState.ignoreTabControls, 'swt-review-panel-ignore', 'Ignore tab should control ignore panel');
    assert.strictEqual(desktopState.sampleTabControls, 'swt-review-panel-sample', 'Sample tab should control sample panel');
    assert.strictEqual(desktopState.corePanelLabel, 'swt-review-tab-core', 'Core panel should be labeled by core tab');
    assert.strictEqual(desktopState.ignorePanelLabel, 'swt-review-tab-ignore', 'Ignore panel should be labeled by ignore tab');
    assert.strictEqual(desktopState.samplePanelLabel, 'swt-review-tab-sample', 'Sample panel should be labeled by sample tab');
    assert.ok(desktopState.point1Controls.includes('swt-review-source-passage'), 'Point button should control source passage');
    assert.ok(desktopState.point1Controls.includes('detail-core-1'), 'Point button should control its detail panel');
    assert.strictEqual(desktopState.showAllControls, 'swt-review-source-passage', 'Show all should control source passage');
    assert.strictEqual(desktopState.viewAnalysisControls, 'swt-review-analysis-pane', 'Analysis view btn should control analysis pane');
    assert.strictEqual(desktopState.viewSourceControls, 'swt-review-source-pane', 'Source view btn should control source pane');

    console.log('Step 2b: Verifying individual core points with distinct colors and capturing screenshot 01 & 02...');
    const point1Style = await page.evaluate(() => {
      const badge = document.querySelector('#point-core-1 .swt-review-point-number');
      const mark = document.querySelector('.swt-review-passage mark');
      const badgeStyle = window.getComputedStyle(badge);
      const markStyle = window.getComputedStyle(mark);
      return {
        badgeBg: badgeStyle.backgroundColor,
        markPointIds: mark.dataset.pointIds,
        markPointIndices: mark.dataset.pointIndices,
        markHasPointClass: mark.classList.contains('swt-point-1'),
        markDecoColor: markStyle.textDecorationColor
      };
    });
    assert.strictEqual(point1Style.markPointIds, 'core-1', 'Point 1 mark should have core-1 dataset');
    assert.strictEqual(point1Style.markPointIndices, '0', 'Point 1 mark should have pointIndices="0"');
    assert.strictEqual(point1Style.markHasPointClass, true, 'Point 1 mark should have .swt-point-1 class');
    await page.screenshot({ path: path.join(screenshotDir, '01-individual-core-point-1.png'), fullPage: true });

    // Select Core Point 2 and verify distinct color and accurate index
    await page.click('#point-core-2');
    const point2Style = await page.evaluate(() => {
      const badge = document.querySelector('#point-core-2 .swt-review-point-number');
      const mark = document.querySelector('.swt-review-passage mark');
      const badgeStyle = window.getComputedStyle(badge);
      const markStyle = window.getComputedStyle(mark);
      return {
        badgeBg: badgeStyle.backgroundColor,
        markPointIds: mark.dataset.pointIds,
        markPointIndices: mark.dataset.pointIndices,
        markHasPointClass: mark.classList.contains('swt-point-2'),
        markDecoColor: markStyle.textDecorationColor
      };
    });
    assert.strictEqual(point2Style.markPointIds, 'core-2', 'Point 2 mark should have core-2 dataset');
    assert.strictEqual(point2Style.markPointIndices, '1', 'Point 2 mark should have pointIndices="1"');
    assert.strictEqual(point2Style.markHasPointClass, true, 'Point 2 mark should have .swt-point-2 class');
    assert.notStrictEqual(point2Style.badgeBg, point1Style.badgeBg, 'Point 2 badge color should be distinct from Point 1');
    assert.notStrictEqual(point2Style.markDecoColor, point1Style.markDecoColor, 'Point 2 mark decoration color should be distinct from Point 1');
    await page.screenshot({ path: path.join(screenshotDir, '02-individual-core-point-2.png'), fullPage: true });

    // Select Core Point 3 and verify distinct color and index
    await page.click('#point-core-3');
    const point3Style = await page.evaluate(() => {
      const badge = document.querySelector('#point-core-3 .swt-review-point-number');
      const mark = document.querySelector('.swt-review-passage mark');
      const badgeStyle = window.getComputedStyle(badge);
      const markStyle = window.getComputedStyle(mark);
      return {
        badgeBg: badgeStyle.backgroundColor,
        markPointIds: mark.dataset.pointIds,
        markPointIndices: mark.dataset.pointIndices,
        markHasPointClass: mark.classList.contains('swt-point-3'),
        markDecoColor: markStyle.textDecorationColor
      };
    });
    assert.strictEqual(point3Style.markPointIds, 'core-3', 'Point 3 mark should have core-3 dataset');
    assert.strictEqual(point3Style.markPointIndices, '2', 'Point 3 mark should have pointIndices="2"');
    assert.strictEqual(point3Style.markHasPointClass, true, 'Point 3 mark should have .swt-point-3 class');
    assert.notStrictEqual(point3Style.badgeBg, point1Style.badgeBg, 'Point 3 badge color should be distinct from Point 1');
    assert.notStrictEqual(point3Style.badgeBg, point2Style.badgeBg, 'Point 3 badge color should be distinct from Point 2');
    assert.notStrictEqual(point3Style.markDecoColor, point1Style.markDecoColor, 'Point 3 mark decoration color should be distinct from Point 1');
    assert.notStrictEqual(point3Style.markDecoColor, point2Style.markDecoColor, 'Point 3 mark decoration color should be distinct from Point 2');

    // Select Core Point 4 and verify distinct color and index
    await page.click('#point-core-4');
    const point4Style = await page.evaluate(() => {
      const badge = document.querySelector('#point-core-4 .swt-review-point-number');
      const mark = document.querySelector('.swt-review-passage mark');
      const badgeStyle = window.getComputedStyle(badge);
      const markStyle = window.getComputedStyle(mark);
      return {
        badgeBg: badgeStyle.backgroundColor,
        markPointIds: mark.dataset.pointIds,
        markPointIndices: mark.dataset.pointIndices,
        markHasPointClass: mark.classList.contains('swt-point-4'),
        markDecoColor: markStyle.textDecorationColor
      };
    });
    assert.strictEqual(point4Style.markPointIds, 'core-4', 'Point 4 mark should have core-4 dataset');
    assert.strictEqual(point4Style.markPointIndices, '3', 'Point 4 mark should have pointIndices="3"');
    assert.strictEqual(point4Style.markHasPointClass, true, 'Point 4 mark should have .swt-point-4 class');
    assert.notStrictEqual(point4Style.badgeBg, point1Style.badgeBg, 'Point 4 badge color should be distinct from Point 1');
    assert.notStrictEqual(point4Style.badgeBg, point2Style.badgeBg, 'Point 4 badge color should be distinct from Point 2');
    assert.notStrictEqual(point4Style.badgeBg, point3Style.badgeBg, 'Point 4 badge color should be distinct from Point 3');
    assert.notStrictEqual(point4Style.markDecoColor, point1Style.markDecoColor, 'Point 4 mark decoration color should be distinct from Point 1');
    assert.notStrictEqual(point4Style.markDecoColor, point2Style.markDecoColor, 'Point 4 mark decoration color should be distinct from Point 2');
    assert.notStrictEqual(point4Style.markDecoColor, point3Style.markDecoColor, 'Point 4 mark decoration color should be distinct from Point 3');

    // Switch back to Point 1
    await page.click('#point-core-1');

    console.log('Step 2c: Verifying "Show all 4 core points at once" on the passage and capturing screenshot 03...');
    // Click "Show all points" in passage header
    await page.click('.swt-review-show-all-passage-btn');
    const allCoreState = await page.evaluate(() => {
      const headerBtn = document.querySelector('.swt-review-show-all-passage-btn');
      const listBtn = document.querySelector('.swt-review-show-all-core');
      const marks = Array.from(document.querySelectorAll('.swt-review-passage mark'));
      const pointIds = marks.map(m => m.dataset.pointIds);
      const caption = document.querySelector('.swt-review-evidence-caption')?.textContent;
      const counter = document.querySelector('.swt-review-evidence-counter')?.textContent;
      return {
        headerPressed: headerBtn?.getAttribute('aria-pressed'),
        listPressed: listBtn?.getAttribute('aria-pressed'),
        markCount: marks.length,
        pointIds,
        caption,
        counter
      };
    });
    assert.strictEqual(allCoreState.headerPressed, 'true', 'Header show all button should have aria-pressed="true"');
    assert.strictEqual(allCoreState.listPressed, 'true', 'List show all button should have aria-pressed="true"');
    assert.strictEqual(allCoreState.markCount, 7, 'All 4 core points should produce 7 passage marks');
    assert.ok(allCoreState.pointIds.some(id => id.includes('core-1')), 'Marks should include core-1');
    assert.ok(allCoreState.pointIds.some(id => id.includes('core-2')), 'Marks should include core-2');
    assert.ok(allCoreState.pointIds.some(id => id.includes('core-3')), 'Marks should include core-3');
    assert.ok(allCoreState.pointIds.some(id => id.includes('core-4')), 'Marks should include core-4');
    assert.strictEqual(allCoreState.caption, 'All core points', 'Caption should say All core points');
    assert.ok(allCoreState.counter.includes('All core points in distinct colors'), 'Counter should indicate distinct colors');
    await page.screenshot({ path: path.join(screenshotDir, '03-show-all-4-core-points.png'), fullPage: true });

    // Clicking individual point returns to single-point focus smoothly
    await page.click('#point-core-1');
    const returnState = await page.evaluate(() => {
      const headerBtn = document.querySelector('.swt-review-show-all-passage-btn');
      const listBtn = document.querySelector('.swt-review-show-all-core');
      const marks = document.querySelectorAll('.swt-review-passage mark');
      return {
        headerPressed: headerBtn?.getAttribute('aria-pressed'),
        listPressed: listBtn?.getAttribute('aria-pressed'),
        markCount: marks.length
      };
    });
    assert.strictEqual(returnState.headerPressed, 'false', 'Header show all button should be unpressed after selecting individual point');
    assert.strictEqual(returnState.listPressed, 'false', 'List show all button should be unpressed after selecting individual point');
    assert.strictEqual(returnState.markCount, 2, 'Marks should return to 2 excerpts for core-1');

    console.log('Step 3: Verifying excerpt navigation (next and prev) and point-card excerpt chip removal...');
    await page.click('.swt-review-next-evidence');
    const excerpt2State = await page.evaluate(() => {
      const counter = document.querySelector('.swt-review-evidence-counter')?.textContent;
      const prevBtn = document.querySelector('.swt-review-prev-evidence');
      const nextBtn = document.querySelector('.swt-review-next-evidence');
      const chipsCount = document.querySelectorAll('.swt-review-evidence-chip').length;
      return {
        counter,
        prevDisabled: prevBtn?.disabled,
        nextDisabled: nextBtn?.disabled,
        chipsCount
      };
    });

    assert.ok(excerpt2State.counter.includes('Excerpt 2 of 2'), 'Counter should update to Excerpt 2 of 2');
    assert.strictEqual(excerpt2State.prevDisabled, false, 'Prev button should be enabled on excerpt 2');
    assert.strictEqual(excerpt2State.nextDisabled, true, 'Next button should be disabled on last excerpt');
    assert.strictEqual(excerpt2State.chipsCount, 0, 'Point card excerpt navigation chips must not be rendered');

    // Navigate back to Excerpt 1 using prev button
    await page.click('.swt-review-prev-evidence');
    const excerpt1State = await page.evaluate(() => {
      const counter = document.querySelector('.swt-review-evidence-counter')?.textContent;
      const prevBtn = document.querySelector('.swt-review-prev-evidence');
      const nextBtn = document.querySelector('.swt-review-next-evidence');
      return {
        counter,
        prevDisabled: prevBtn?.disabled,
        nextDisabled: nextBtn?.disabled
      };
    });
    assert.ok(excerpt1State.counter.includes('Excerpt 1 of 2'), 'Counter should return to Excerpt 1 of 2');
    assert.strictEqual(excerpt1State.prevDisabled, true, 'Prev button should be disabled on excerpt 1');
    assert.strictEqual(excerpt1State.nextDisabled, false, 'Next button should be enabled on excerpt 1');

    console.log('Step 3b: Clicking Example summary tab and verifying dedicated 3rd panel, multi-version summaries (Version A, B, C) with core point highlights...');
    await page.click('#swt-review-tab-sample');
    const sampleSummaryState = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.swt-review-sample-tab')).map(t => ({
        text: t.textContent.trim(),
        version: t.dataset.version,
        selected: t.getAttribute('aria-selected'),
        id: t.id,
        controls: t.getAttribute('aria-controls'),
        role: t.getAttribute('role')
      }));
      const panel = document.getElementById('swt-review-sample-panel');
      const tabSample = document.querySelector('.swt-review-tab-sample');
      const samplePanel = document.getElementById('swt-review-panel-sample');
      const corePanel = document.getElementById('swt-review-panel-core');
      const ignorePanel = document.getElementById('swt-review-panel-ignore');
      const summaryText = document.querySelector('.swt-review-sample-summary')?.textContent.trim() || '';
      const summaryWords = summaryText.split(/\s+/).filter(Boolean).length;
      const desc = document.querySelector('.swt-review-sample-desc')?.textContent.trim() || '';
      const meta = document.querySelector('.swt-review-summary-meta')?.textContent.trim() || '';
      const ctrl = window.SWTMode.getReviewController();
      const state = ctrl ? ctrl.getState() : null;
      const legendHidden = document.querySelector('.swt-review-sample-legend')?.hidden;
      const legendItems = Array.from(document.querySelectorAll('.swt-review-sample-legend .swt-sample-legend-item')).map(item => ({
        pointId: item.dataset.pointId,
        pointIndex: item.dataset.pointIndex,
        text: item.textContent.trim()
      }));
      const highlights = Array.from(document.querySelectorAll('.swt-review-sample-summary mark.swt-sample-highlight')).map(m => ({
        pointId: m.dataset.pointId,
        pointIndex: m.dataset.pointIndex,
        text: m.textContent.trim()
      }));

      const guide = document.querySelector('.swt-review-paraphrase-guide');
      const guideHidden = guide ? guide.hidden : true;
      const guideItemCount = guide ? guide.querySelectorAll('.swt-paraphrase-item').length : 0;

      return {
        tabs,
        panelRole: panel?.getAttribute('role'),
        panelLabelledBy: panel?.getAttribute('aria-labelledby'),
        tabSampleSelected: tabSample?.getAttribute('aria-selected'),
        samplePanelHidden: samplePanel?.hidden,
        corePanelHidden: corePanel?.hidden,
        ignorePanelHidden: ignorePanel?.hidden,
        summaryText,
        summaryWords,
        desc,
        meta,
        legendHidden,
        legendItems,
        highlights,
        guideHidden,
        guideItemCount,
        activeSampleVersion: state?.activeSampleVersion,
        sampleVersionCount: state?.sampleVersionCount,
        activeKind: state?.activeKind
      };
    });

    assert.strictEqual(sampleSummaryState.tabSampleSelected, 'true', 'Example summary tab should be selected');
    assert.strictEqual(sampleSummaryState.samplePanelHidden, false, 'Example summary panel should be visible');
    assert.strictEqual(sampleSummaryState.corePanelHidden, true, 'Core points panel should be hidden');
    assert.strictEqual(sampleSummaryState.ignorePanelHidden, true, 'Points to ignore panel should be hidden');
    assert.strictEqual(sampleSummaryState.activeKind, 'sample', 'Active category should be sample');
    assert.strictEqual(sampleSummaryState.tabs.length, 3, 'Should render 3 version tabs');
    assert.strictEqual(sampleSummaryState.sampleVersionCount, 3, 'Controller state should report 3 sample versions');
    assert.strictEqual(sampleSummaryState.activeSampleVersion, 'versionA', 'Active sample version should be versionA');
    assert.strictEqual(sampleSummaryState.tabs[0].version, 'versionA', 'First tab should be version A');
    assert.strictEqual(sampleSummaryState.tabs[0].selected, 'true', 'Version A should be selected by default');
    assert.strictEqual(sampleSummaryState.tabs[0].controls, 'swt-review-sample-panel', 'Tab should control sample panel');
    assert.strictEqual(sampleSummaryState.panelRole, 'tabpanel', 'Sample panel must have role="tabpanel"');
    assert.strictEqual(sampleSummaryState.panelLabelledBy, 'swt-review-sample-tab-versionA', 'Sample panel must be labelled by version A tab');
    assert.strictEqual(sampleSummaryState.legendHidden, false, 'Sample summary legend should be visible');
    assert.strictEqual(sampleSummaryState.legendItems.length, 4, 'Sample legend should display all 4 core points');
    assert.strictEqual(sampleSummaryState.highlights.length, 4, 'Version A should have 4 core point highlights');
    assert.strictEqual(sampleSummaryState.highlights[0].pointId, 'core-1', 'First highlight should map to core-1');
    assert.strictEqual(sampleSummaryState.highlights[1].pointId, 'core-2', 'Second highlight should map to core-2');
    assert.strictEqual(sampleSummaryState.highlights[2].pointId, 'core-3', 'Third highlight should map to core-3');
    assert.strictEqual(sampleSummaryState.highlights[3].pointId, 'core-4', 'Fourth highlight should map to core-4');
    assert.strictEqual(sampleSummaryState.guideHidden, true, 'Version A Paraphrasing Guide should be hidden');
    assert.strictEqual(sampleSummaryState.guideItemCount, 0, 'Version A Paraphrasing Guide should have 0 items');
    assert.ok(sampleSummaryState.summaryWords >= 50 && sampleSummaryState.summaryWords <= 70, `Version A word count (${sampleSummaryState.summaryWords}) should be 50-70`);
    assert.ok(sampleSummaryState.summaryWords <= 75, 'Version A word count must never exceed 75 words');
    assert.ok(sampleSummaryState.summaryText.includes('Major athletic events around the globe'), 'Version A should reuse passage phrasing');
    await page.evaluate(() => {
      const scroll = document.querySelector('.swt-review-analysis-scroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
    await page.screenshot({ path: path.join(screenshotDir, '04-sample-summary-version-a.png'), fullPage: true });

    // Switch to Version B
    await page.click('.swt-review-sample-tab[data-version="versionB"]');
    const versionBState = await page.evaluate(() => {
      const panel = document.getElementById('swt-review-sample-panel');
      const summaryText = document.querySelector('.swt-review-sample-summary')?.textContent.trim() || '';
      const summaryWords = summaryText.split(/\s+/).filter(Boolean).length;
      const desc = document.querySelector('.swt-review-sample-desc')?.textContent.trim() || '';
      const tabBSelected = document.querySelector('.swt-review-sample-tab[data-version="versionB"]')?.getAttribute('aria-selected');
      const ctrl = window.SWTMode.getReviewController();
      const highlights = Array.from(document.querySelectorAll('.swt-review-sample-summary mark.swt-sample-highlight')).map(m => ({
        pointId: m.dataset.pointId,
        pointIndex: m.dataset.pointIndex,
        text: m.textContent.trim()
      }));
      const core1Mark = document.querySelector('.swt-review-sample-summary mark.swt-sample-highlight[data-point-id="core-1"]');
      const core2Mark = document.querySelector('.swt-review-sample-summary mark.swt-sample-highlight[data-point-id="core-2"]');
      const guide = document.querySelector('.swt-review-paraphrase-guide');
      const guideHidden = guide ? guide.hidden : true;
      const guideItems = Array.from(document.querySelectorAll('.swt-review-paraphrase-guide .swt-paraphrase-item')).map(item => ({
        badgeText: item.querySelector('.swt-paraphrase-badge')?.textContent.trim(),
        hasSynonymBadge: Boolean(item.querySelector('.swt-paraphrase-badge--synonym')),
        hasStructureBadge: Boolean(item.querySelector('.swt-paraphrase-badge--structure')),
        original: item.querySelector('.swt-paraphrase-original')?.textContent.trim(),
        arrow: item.querySelector('.swt-paraphrase-arrow')?.textContent.trim(),
        result: item.querySelector('.swt-paraphrase-result')?.textContent.trim(),
        note: item.querySelector('.swt-paraphrase-note')?.textContent.trim()
      }));
      return {
        summaryText,
        summaryWords,
        desc,
        tabBSelected,
        highlights,
        guideHidden,
        guideItems,
        panelLabelledBy: panel?.getAttribute('aria-labelledby'),
        activeSampleVersion: ctrl?.getState()?.activeSampleVersion,
        core1MarkSelected: core1Mark?.classList.contains('is-selected'),
        core1MarkAria: core1Mark?.getAttribute('aria-pressed'),
        core2MarkSelected: core2Mark?.classList.contains('is-selected')
      };
    });
    assert.strictEqual(versionBState.tabBSelected, 'true', 'Version B tab should be selected');
    assert.strictEqual(versionBState.activeSampleVersion, 'versionB', 'Controller state should report active versionB');
    assert.strictEqual(versionBState.panelLabelledBy, 'swt-review-sample-tab-versionB', 'Sample panel must be labelled by version B tab');
    assert.strictEqual(versionBState.highlights.length, 4, 'Version B should have 4 core point highlights');
    assert.strictEqual(versionBState.highlights[0].pointId, 'core-1', 'Version B first highlight maps to core-1');
    assert.strictEqual(versionBState.highlights[1].pointId, 'core-2', 'Version B second highlight maps to core-2');
    assert.strictEqual(versionBState.highlights[2].pointId, 'core-3', 'Version B third highlight maps to core-3');
    assert.strictEqual(versionBState.highlights[3].pointId, 'core-4', 'Version B fourth highlight maps to core-4');
    assert.strictEqual(versionBState.core1MarkSelected, true, 'Active core-1 highlight should be selected in newly rendered Version B');
    assert.strictEqual(versionBState.core1MarkAria, 'true', 'Active core-1 highlight should have aria-pressed="true" in Version B');
    assert.strictEqual(versionBState.core2MarkSelected, false, 'Inactive core-2 highlight should not be selected in Version B');
    assert.strictEqual(versionBState.guideHidden, false, 'Version B Paraphrasing Guide should be visible');
    assert.strictEqual(versionBState.guideItems.length, 6, 'Version B Paraphrasing Guide should have exactly 6 items');
    assert.ok(versionBState.guideItems.some(item => item.hasStructureBadge), 'Version B should contain structure transformations');
    assert.ok(versionBState.guideItems.some(item => item.hasSynonymBadge), 'Version B should contain synonym transformations');
    assert.strictEqual(versionBState.guideItems[0].arrow, '→', 'Guide should render transformation arrow');
    assert.ok(versionBState.guideItems[0].original.length > 0, 'Guide item should render original phrase');
    assert.ok(versionBState.guideItems[0].result.length > 0, 'Guide item should render paraphrased phrase');
    assert.ok(versionBState.guideItems[0].note.length > 0, 'Guide item should render explanation note');
    assert.ok(versionBState.summaryWords >= 50 && versionBState.summaryWords <= 70, `Version B word count (${versionBState.summaryWords}) should be 50-70`);
    assert.ok(versionBState.summaryWords <= 75, 'Version B word count must never exceed 75 words');
    assert.ok(versionBState.summaryText.includes('carbon neutrality is being actively pursued'), 'Version B should use passive voice / synonyms');
    await page.evaluate(() => {
      const scroll = document.querySelector('.swt-review-analysis-scroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
    await page.screenshot({ path: path.join(screenshotDir, '05-sample-summary-version-b.png'), fullPage: true });
    await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      const pane = document.querySelector('.swt-review-analysis-pane');
      const scroll = document.querySelector('.swt-review-analysis-scroll');
      const foot = document.querySelector('.swt-review-analysis-foot');
      if (shell) shell.style.height = 'auto';
      if (pane) pane.style.height = 'auto';
      if (scroll) {
        scroll.style.overflow = 'visible';
        scroll.style.maxHeight = 'none';
      }
      if (foot) foot.style.display = 'none';
    });
    const guideBEl = await page.$('.swt-review-paraphrase-guide');
    if (guideBEl) {
      await guideBEl.screenshot({ path: path.join(screenshotDir, '05b-paraphrase-guide-version-b.png') });
    }
    await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      const pane = document.querySelector('.swt-review-analysis-pane');
      const scroll = document.querySelector('.swt-review-analysis-scroll');
      const foot = document.querySelector('.swt-review-analysis-foot');
      if (shell) shell.style.height = '';
      if (pane) pane.style.height = '';
      if (scroll) {
        scroll.style.overflow = '';
        scroll.style.maxHeight = '';
      }
      if (foot) foot.style.display = '';
    });

    // Switch to Version C
    await page.click('.swt-review-sample-tab[data-version="versionC"]');
    const versionCState = await page.evaluate(() => {
      const panel = document.getElementById('swt-review-sample-panel');
      const summaryText = document.querySelector('.swt-review-sample-summary')?.textContent.trim() || '';
      const summaryWords = summaryText.split(/\s+/).filter(Boolean).length;
      const desc = document.querySelector('.swt-review-sample-desc')?.textContent.trim() || '';
      const tabCSelected = document.querySelector('.swt-review-sample-tab[data-version="versionC"]')?.getAttribute('aria-selected');
      const ctrl = window.SWTMode.getReviewController();
      const highlights = Array.from(document.querySelectorAll('.swt-review-sample-summary mark.swt-sample-highlight')).map(m => ({
        pointId: m.dataset.pointId,
        pointIndex: m.dataset.pointIndex,
        text: m.textContent.trim()
      }));
      const guide = document.querySelector('.swt-review-paraphrase-guide');
      const guideHidden = guide ? guide.hidden : true;
      const guideItems = Array.from(document.querySelectorAll('.swt-review-paraphrase-guide .swt-paraphrase-item')).map(item => ({
        badgeText: item.querySelector('.swt-paraphrase-badge')?.textContent.trim(),
        hasSynonymBadge: Boolean(item.querySelector('.swt-paraphrase-badge--synonym')),
        hasStructureBadge: Boolean(item.querySelector('.swt-paraphrase-badge--structure')),
        arrow: item.querySelector('.swt-paraphrase-arrow')?.textContent.trim()
      }));
      return {
        summaryText,
        summaryWords,
        desc,
        tabCSelected,
        highlights,
        guideHidden,
        guideItems,
        panelLabelledBy: panel?.getAttribute('aria-labelledby'),
        activeSampleVersion: ctrl?.getState()?.activeSampleVersion
      };
    });
    assert.strictEqual(versionCState.tabCSelected, 'true', 'Version C tab should be selected');
    assert.strictEqual(versionCState.activeSampleVersion, 'versionC', 'Controller state should report active versionC');
    assert.strictEqual(versionCState.panelLabelledBy, 'swt-review-sample-tab-versionC', 'Sample panel must be labelled by version C tab');
    assert.strictEqual(versionCState.highlights.length, 5, 'Version C should have 5 core point highlights');
    assert.ok(versionCState.highlights.some(h => h.pointId === 'core-1'), 'Version C highlights should include core-1');
    assert.ok(versionCState.highlights.some(h => h.pointId === 'core-2'), 'Version C highlights should include core-2');
    assert.ok(versionCState.highlights.some(h => h.pointId === 'core-3'), 'Version C highlights should include core-3');
    assert.ok(versionCState.highlights.some(h => h.pointId === 'core-4'), 'Version C highlights should include core-4');
    assert.strictEqual(versionCState.guideHidden, false, 'Version C Paraphrasing Guide should be visible');
    assert.strictEqual(versionCState.guideItems.length, 4, 'Version C Paraphrasing Guide should have exactly 4 items');
    assert.ok(versionCState.guideItems.some(item => item.hasStructureBadge), 'Version C should contain structure transformations');
    assert.ok(versionCState.guideItems.some(item => item.hasSynonymBadge), 'Version C should contain synonym transformations');
    assert.strictEqual(versionCState.guideItems[0].arrow, '→', 'Guide should render transformation arrow');
    assert.ok(versionCState.summaryWords >= 50 && versionCState.summaryWords <= 70, `Version C word count (${versionCState.summaryWords}) should be 50-70`);
    assert.ok(versionCState.summaryWords <= 75, 'Version C word count must never exceed 75 words');
    assert.ok(versionCState.summaryText.includes('embedding environmental accountability'), 'Version C should use true summary / conceptual restructuring');
    await page.evaluate(() => {
      const scroll = document.querySelector('.swt-review-analysis-scroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
    await page.screenshot({ path: path.join(screenshotDir, '06-sample-summary-version-c.png'), fullPage: true });
    await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      const pane = document.querySelector('.swt-review-analysis-pane');
      const scroll = document.querySelector('.swt-review-analysis-scroll');
      const foot = document.querySelector('.swt-review-analysis-foot');
      if (shell) shell.style.height = 'auto';
      if (pane) pane.style.height = 'auto';
      if (scroll) {
        scroll.style.overflow = 'visible';
        scroll.style.maxHeight = 'none';
      }
      if (foot) foot.style.display = 'none';
    });
    const guideCEl = await page.$('.swt-review-paraphrase-guide');
    if (guideCEl) {
      await guideCEl.screenshot({ path: path.join(screenshotDir, '06b-paraphrase-guide-version-c.png') });
    }
    await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      const pane = document.querySelector('.swt-review-analysis-pane');
      const scroll = document.querySelector('.swt-review-analysis-scroll');
      const foot = document.querySelector('.swt-review-analysis-foot');
      if (shell) shell.style.height = '';
      if (pane) pane.style.height = '';
      if (scroll) {
        scroll.style.overflow = '';
        scroll.style.maxHeight = '';
      }
      if (foot) foot.style.display = '';
    });

    // Interactive highlight click: clicking a sample highlight activates that core point while staying on sample tab
    await page.click('.swt-review-sample-summary mark.swt-sample-highlight[data-point-id="core-2"]');
    const linkedHighlightState = await page.evaluate(() => {
      const ctrl = window.SWTMode.getReviewController();
      const state = ctrl?.getState();
      const caption = document.querySelector('.swt-review-evidence-caption')?.textContent;
      const tabSample = document.getElementById('swt-review-tab-sample');
      const samplePanel = document.getElementById('swt-review-panel-sample');
      const marks = Array.from(document.querySelectorAll('.swt-review-passage mark.swt-point-2'));
      return {
        activePointId: state?.activePointId,
        activeKind: state?.activeKind,
        tabSampleSelected: tabSample?.getAttribute('aria-selected'),
        samplePanelHidden: samplePanel?.hidden,
        markCount: marks.length,
        caption
      };
    });
    assert.strictEqual(linkedHighlightState.activePointId, 'core-2', 'Clicking sample highlight should select core-2');
    assert.strictEqual(linkedHighlightState.activeKind, 'sample', 'Active category should remain sample when clicking highlight in sample panel');
    assert.strictEqual(linkedHighlightState.tabSampleSelected, 'true', 'Example summary tab should remain selected');
    assert.strictEqual(linkedHighlightState.samplePanelHidden, false, 'Example summary panel should remain visible');
    assert.ok(linkedHighlightState.markCount > 0, 'Passage should highlight excerpts for core-2');
    assert.strictEqual(linkedHighlightState.caption, 'Core point 02', 'Evidence caption should reflect core point 02');

    // Click sample legend item for core-1 to test switching point selection from within sample summary
    await page.click('.swt-sample-legend-item[data-point-id="core-1"]');
    const legendClickState = await page.evaluate(() => {
      const ctrl = window.SWTMode.getReviewController();
      const state = ctrl?.getState();
      const caption = document.querySelector('.swt-review-evidence-caption')?.textContent;
      const tabSample = document.getElementById('swt-review-tab-sample');
      const samplePanel = document.getElementById('swt-review-panel-sample');
      const marks = Array.from(document.querySelectorAll('.swt-review-passage mark.swt-point-1'));
      return {
        activePointId: state?.activePointId,
        activeKind: state?.activeKind,
        tabSampleSelected: tabSample?.getAttribute('aria-selected'),
        samplePanelHidden: samplePanel?.hidden,
        markCount: marks.length,
        caption
      };
    });
    assert.strictEqual(legendClickState.activePointId, 'core-1', 'Clicking sample legend item should select core-1');
    assert.strictEqual(legendClickState.activeKind, 'sample', 'Active category should remain sample');
    assert.strictEqual(legendClickState.tabSampleSelected, 'true', 'Example summary tab should remain selected');
    assert.strictEqual(legendClickState.samplePanelHidden, false, 'Example summary panel should remain visible');
    assert.ok(legendClickState.markCount > 0, 'Passage should highlight excerpts for core-1');
    assert.strictEqual(legendClickState.caption, 'Core point 01', 'Evidence caption should reflect core point 01');

    // Keyboard navigation on sample summary tabs (ArrowLeft, ArrowRight with wrap, Home, End)
    await page.focus('.swt-review-sample-tab[data-version="versionC"]');
    await page.keyboard.press('ArrowLeft');
    let navVersion = await page.evaluate(() => document.querySelector('.swt-review-sample-tab[aria-selected="true"]')?.dataset?.version);
    assert.strictEqual(navVersion, 'versionB', 'ArrowLeft should navigate from Version C to Version B');

    await page.keyboard.press('ArrowRight');
    navVersion = await page.evaluate(() => document.querySelector('.swt-review-sample-tab[aria-selected="true"]')?.dataset?.version);
    assert.strictEqual(navVersion, 'versionC', 'ArrowRight should navigate from Version B to Version C');

    await page.keyboard.press('ArrowRight');
    navVersion = await page.evaluate(() => document.querySelector('.swt-review-sample-tab[aria-selected="true"]')?.dataset?.version);
    assert.strictEqual(navVersion, 'versionA', 'ArrowRight from Version C should wrap around to Version A');

    await page.keyboard.press('End');
    navVersion = await page.evaluate(() => document.querySelector('.swt-review-sample-tab[aria-selected="true"]')?.dataset?.version);
    assert.strictEqual(navVersion, 'versionC', 'End key should jump to last tab (Version C)');

    await page.keyboard.press('Home');
    navVersion = await page.evaluate(() => document.querySelector('.swt-review-sample-tab[aria-selected="true"]')?.dataset?.version);
    assert.strictEqual(navVersion, 'versionA', 'Home key should jump to first tab (Version A)');

    // Keyboard navigation on sample summary legend items (ArrowLeft, ArrowRight with wrap, Home, End)
    await page.focus('.swt-sample-legend-item.swt-point-4');
    await page.keyboard.press('ArrowRight');
    const focusedLegend1 = await page.evaluate(() => document.activeElement?.dataset?.pointId);
    assert.strictEqual(focusedLegend1, 'core-1', 'ArrowRight from last legend item should wrap to first (core-1)');

    await page.keyboard.press('ArrowLeft');
    const focusedLegend4 = await page.evaluate(() => document.activeElement?.dataset?.pointId);
    assert.strictEqual(focusedLegend4, 'core-4', 'ArrowLeft from first legend item should wrap to last (core-4)');

    // Return to Core points tab before core point contrast checks
    await page.click('#swt-review-tab-core');
    const returnCoreState = await page.evaluate(() => {
      const tabCore = document.getElementById('swt-review-tab-core');
      const panelCore = document.getElementById('swt-review-panel-core');
      const p1 = document.querySelector('.swt-review-point-item[data-point-id="core-1"]');
      return {
        tabCoreSelected: tabCore?.getAttribute('aria-selected'),
        panelCoreHidden: panelCore?.hidden,
        p1Selected: p1?.classList.contains('is-selected')
      };
    });
    assert.strictEqual(returnCoreState.tabCoreSelected, 'true', 'Core points tab should be selected');
    assert.strictEqual(returnCoreState.panelCoreHidden, false, 'Core points panel should be visible');
    assert.strictEqual(returnCoreState.p1Selected, true, 'Core 1 should remain selected');

    // Contrast and WCAG AA verification in computed styles (Amber and Emerald)
    const contrastReport = await page.evaluate(() => {
      function luminance(r, g, b) {
        const [rs, gs, bs] = [r, g, b].map(c => {
          c = c / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      }
      function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        const num = parseInt(hex, 16);
        return [num >> 16, (num >> 8) & 255, num & 255];
      }
      function parseRgb(str) {
        if (!str) return [0, 0, 0];
        if (str.startsWith('#')) return hexToRgb(str);
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : [0, 0, 0];
      }
      function contrast(rgb1, rgb2) {
        const l1 = luminance(...rgb1);
        const l2 = luminance(...rgb2);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }

      const shell = document.querySelector('.swt-review-shell');
      const style = window.getComputedStyle(shell);
      const p3Color = parseRgb(style.getPropertyValue('--point-3-color').trim());
      const p3Soft = parseRgb(style.getPropertyValue('--point-3-soft').trim());
      const p4Color = parseRgb(style.getPropertyValue('--point-4-color').trim());
      const p4Soft = parseRgb(style.getPropertyValue('--point-4-soft').trim());
      const white = [255, 255, 255];

      return {
        p3VsWhite: contrast(p3Color, white),
        p3VsSoft: contrast(p3Color, p3Soft),
        p4VsWhite: contrast(p4Color, white),
        p4VsSoft: contrast(p4Color, p4Soft)
      };
    });

    assert.ok(contrastReport.p3VsWhite >= 4.5, `Amber vs white (${contrastReport.p3VsWhite.toFixed(2)}) must meet WCAG AA (>= 4.5)`);
    assert.ok(contrastReport.p3VsSoft >= 4.5, `Amber vs soft bg (${contrastReport.p3VsSoft.toFixed(2)}) must meet WCAG AA (>= 4.5)`);
    assert.ok(contrastReport.p4VsWhite >= 4.5, `Emerald vs white (${contrastReport.p4VsWhite.toFixed(2)}) must meet WCAG AA (>= 4.5)`);
    assert.ok(contrastReport.p4VsSoft >= 4.5, `Emerald vs soft bg (${contrastReport.p4VsSoft.toFixed(2)}) must meet WCAG AA (>= 4.5)`);

    // Dark theme activation & deep contrast check
    await page.evaluate(() => document.body.classList.add('dark-mode'));
    const darkThemeReport = await page.evaluate(() => {
      function luminance(r, g, b) {
        const [rs, gs, bs] = [r, g, b].map(c => {
          c = c / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      }
      function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        const num = parseInt(hex, 16);
        return [num >> 16, (num >> 8) & 255, num & 255];
      }
      function parseRgb(str) {
        if (!str) return [0, 0, 0];
        if (str.startsWith('#')) return hexToRgb(str);
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : [0, 0, 0];
      }
      function contrast(rgb1, rgb2) {
        const l1 = luminance(...rgb1);
        const l2 = luminance(...rgb2);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }

      const shell = document.querySelector('.swt-review-shell');
      const style = window.getComputedStyle(shell);
      const p3Dark = style.getPropertyValue('--point-3-color').trim();
      const p4Dark = style.getPropertyValue('--point-4-color').trim();
      const darkBg = style.getPropertyValue('--canvas').trim();

      const p1Badge = document.querySelector('#point-core-1 .swt-review-point-number');
      const p1BadgeStyle = window.getComputedStyle(p1Badge);
      const p1BadgeText = parseRgb(p1BadgeStyle.color);
      const p1BadgeBg = parseRgb(p1BadgeStyle.backgroundColor);
      const p1BadgeContrast = contrast(p1BadgeText, p1BadgeBg);

      const p1Item = document.querySelector('.swt-review-point-item[data-point-id="core-1"]');
      const p1ItemBg = window.getComputedStyle(p1Item).backgroundColor;

      const activeTab = document.querySelector('.swt-review-sample-tab[aria-selected="true"]');
      const activeTabStyle = window.getComputedStyle(activeTab);
      const tabText = parseRgb(activeTabStyle.color);
      const tabBg = parseRgb(activeTabStyle.backgroundColor);
      const tabContrast = contrast(tabText, tabBg);

      return {
        p3Dark,
        p4Dark,
        darkBg,
        p1BadgeContrast,
        p1BadgeBg: p1BadgeStyle.backgroundColor,
        p1BadgeColor: p1BadgeStyle.color,
        p1ItemBg,
        tabBg: activeTabStyle.backgroundColor,
        tabContrast
      };
    });

    assert.strictEqual(darkThemeReport.p3Dark, '#fbbf24', 'Dark mode should use high-contrast Amber #fbbf24');
    assert.strictEqual(darkThemeReport.p4Dark, '#34d399', 'Dark mode should use high-contrast Emerald #34d399');
    assert.ok(darkThemeReport.p1BadgeContrast >= 4.5, `Dark mode badge number text contrast (${darkThemeReport.p1BadgeContrast.toFixed(2)}) must meet WCAG AA (>= 4.5)`);
    assert.ok(darkThemeReport.tabContrast >= 4.5, `Dark mode active tab contrast (${darkThemeReport.tabContrast.toFixed(2)}) must meet WCAG AA (>= 4.5)`);
    assert.notStrictEqual(darkThemeReport.tabBg, 'rgb(255, 255, 255)', 'Dark mode active tab background must not be pure white');
    assert.notStrictEqual(darkThemeReport.p1ItemBg, 'rgb(243, 249, 245)', 'Dark mode selected card background must not use light-mode light green');

    // Switch to Point 3 in dark mode to verify Amber badge contrast
    await page.click('#point-core-3');
    const p3DarkBadgeReport = await page.evaluate(() => {
      function luminance(r, g, b) {
        const [rs, gs, bs] = [r, g, b].map(c => {
          c = c / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      }
      function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        const num = parseInt(hex, 16);
        return [num >> 16, (num >> 8) & 255, num & 255];
      }
      function parseRgb(str) {
        if (!str) return [0, 0, 0];
        if (str.startsWith('#')) return hexToRgb(str);
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : [0, 0, 0];
      }
      function contrast(rgb1, rgb2) {
        const l1 = luminance(...rgb1);
        const l2 = luminance(...rgb2);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }
      const p3Badge = document.querySelector('#point-core-3 .swt-review-point-number');
      const p3BadgeStyle = window.getComputedStyle(p3Badge);
      const text = parseRgb(p3BadgeStyle.color);
      const bg = parseRgb(p3BadgeStyle.backgroundColor);
      return {
        contrast: contrast(text, bg),
        bg: p3BadgeStyle.backgroundColor,
        color: p3BadgeStyle.color
      };
    });
    assert.ok(p3DarkBadgeReport.contrast >= 4.5, `Dark mode Amber Point 3 badge contrast (${p3DarkBadgeReport.contrast.toFixed(2)}) must meet WCAG AA (>= 4.5)`);

    // Switch back to Point 1 and light mode
    await page.click('#point-core-1');
    await page.evaluate(() => document.body.classList.remove('dark-mode'));

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

    console.log('Step 8: Verifying Keyboard Tab switching (ArrowLeft, ArrowRight, Home, End)...');
    await page.focus('.swt-review-tab-ignore');
    await page.keyboard.press('ArrowLeft');
    const arrowLeftState = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-core')?.getAttribute('aria-selected');
    });
    assert.strictEqual(arrowLeftState, 'true', 'ArrowLeft should navigate to Core points tab');

    await page.keyboard.press('ArrowRight');
    const arrowRightState = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-ignore')?.getAttribute('aria-selected');
    });
    assert.strictEqual(arrowRightState, 'true', 'ArrowRight should navigate to Ignore points tab');

    await page.keyboard.press('ArrowRight');
    const arrowRightSampleState = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-sample')?.getAttribute('aria-selected');
    });
    assert.strictEqual(arrowRightSampleState, 'true', 'ArrowRight should navigate from Ignore to Example summary tab');

    await page.keyboard.press('ArrowRight');
    const wrapCoreState = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-core')?.getAttribute('aria-selected');
    });
    assert.strictEqual(wrapCoreState, 'true', 'ArrowRight should wrap around from Example summary to Core points tab');

    await page.keyboard.press('End');
    const endState = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-sample')?.getAttribute('aria-selected');
    });
    assert.strictEqual(endState, 'true', 'End key should navigate to last tab (Example summary)');

    await page.keyboard.press('Home');
    const homeState = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-core')?.getAttribute('aria-selected');
    });
    assert.strictEqual(homeState, 'true', 'Home key should navigate to first tab (Core)');

    await page.keyboard.press('ArrowLeft');
    const wrapSampleState = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-sample')?.getAttribute('aria-selected');
    });
    assert.strictEqual(wrapSampleState, 'true', 'ArrowLeft from first tab should wrap around to Example summary tab');

    // Test ArrowDown and ArrowUp on category tabs
    await page.keyboard.press('ArrowDown');
    const downToCore = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-core')?.getAttribute('aria-selected');
    });
    assert.strictEqual(downToCore, 'true', 'ArrowDown should navigate from sample tab to core tab');

    await page.keyboard.press('ArrowUp');
    const upToSample = await page.evaluate(() => {
      return document.querySelector('.swt-review-tab-sample')?.getAttribute('aria-selected');
    });
    assert.strictEqual(upToSample, 'true', 'ArrowUp should navigate back to sample tab');

    // Return to core tab and test keyboard Enter on point button
    await page.keyboard.press('Home');
    await page.focus('#point-core-2');
    await page.keyboard.press('Enter');
    const kbPointState = await page.evaluate(() => {
      const ctrl = window.SWTMode.getReviewController();
      const st = ctrl?.getState();
      const pointBtn = document.getElementById('point-core-2');
      return {
        activePointId: st?.activePointId,
        pressed: pointBtn?.getAttribute('aria-pressed'),
        expanded: pointBtn?.getAttribute('aria-expanded')
      };
    });
    assert.strictEqual(kbPointState.activePointId, 'core-2', 'Enter key on point button should activate core-2');
    assert.strictEqual(kbPointState.pressed, 'true', 'Point button should have aria-pressed="true"');
    assert.strictEqual(kbPointState.expanded, 'true', 'Point button should have aria-expanded="true"');

    console.log('Step 9: Verifying Mobile responsive layout (< 1024px) via natural ResizeObserver...');
    await page.setViewportSize({ width: 390, height: 844 });
    // Naturally wait for ResizeObserver to update layout without manual synthetic invocation
    await page.waitForFunction(() => {
      const shell = document.querySelector('.swt-review-shell');
      return shell && !shell.classList.contains('is-split');
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
    await page.waitForTimeout(150);
    const afterMobilePointClick = await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      const sourcePane = document.querySelector('.swt-review-source-pane');
      const analysisPane = document.querySelector('.swt-review-analysis-pane');
      const marks = document.querySelectorAll('.swt-review-passage mark');
      const scrollY = window.scrollY;

      return {
        currentView: shell.dataset.view,
        sourceDisplay: getComputedStyle(sourcePane).display,
        analysisDisplay: getComputedStyle(analysisPane).display,
        markCount: marks.length,
        scrollY
      };
    });

    assert.strictEqual(afterMobilePointClick.currentView, 'source', 'Selecting point on mobile should switch to source view');
    assert.strictEqual(afterMobilePointClick.sourceDisplay !== 'none', true, 'Source pane should now be visible');
    assert.strictEqual(afterMobilePointClick.analysisDisplay, 'none', 'Analysis pane should now be hidden');
    assert.ok(afterMobilePointClick.markCount >= 2, 'Evidence marks should be visible in mobile source view');
    assert.ok(afterMobilePointClick.scrollY > 0, 'Scroll position on mobile must remain at the review workspace and not jump to 0');

    // Switch back to analysis view
    await page.click('.swt-review-view-btn[data-view="analysis"]');
    const afterSwitchBack = await page.evaluate(() => {
      const shell = document.querySelector('.swt-review-shell');
      return shell.dataset.view;
    });
    assert.strictEqual(afterSwitchBack, 'analysis', 'Switching back to analysis view should work');

    // Test mobile switch keyboard navigation (ArrowRight / ArrowLeft loop wrapping)
    await page.focus('.swt-review-view-btn[data-view="analysis"]');
    await page.keyboard.press('ArrowRight');
    const viewAfterArrowRight = await page.evaluate(() => document.querySelector('.swt-review-shell')?.dataset?.view);
    assert.strictEqual(viewAfterArrowRight, 'source', 'ArrowRight on mobile switch should navigate to source view');

    await page.keyboard.press('ArrowRight');
    const viewAfterArrowRightWrap = await page.evaluate(() => document.querySelector('.swt-review-shell')?.dataset?.view);
    assert.strictEqual(viewAfterArrowRightWrap, 'analysis', 'ArrowRight from source view should wrap back to analysis view');

    // Verify sample summary tabs and layout integrity on mobile analysis view
    const mobileSampleTabs = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.swt-review-sample-tab'));
      const samplePanel = document.getElementById('swt-review-panel-sample');
      const innerPanel = document.getElementById('swt-review-sample-panel');
      return {
        tabCount: tabs.length,
        panelAttached: Boolean(samplePanel),
        innerPanelVisible: innerPanel ? getComputedStyle(innerPanel).display !== 'none' : false,
        overflow: document.documentElement.scrollWidth > window.innerWidth
      };
    });
    assert.strictEqual(mobileSampleTabs.tabCount, 3, 'Mobile view should preserve all 3 sample version tabs');
    assert.strictEqual(mobileSampleTabs.panelAttached, true, 'Dedicated 3rd panel #swt-review-panel-sample must be attached');
    assert.strictEqual(mobileSampleTabs.overflow, false, 'Mobile view must not have horizontal overflow');

    console.log('Step 10: Verifying desktop layout restoration on resize and cleanup on Retry...');
    await page.setViewportSize({ width: 1440, height: 1200 });
    // Naturally wait for ResizeObserver to restore .is-split
    await page.waitForFunction(() => {
      const shell = document.querySelector('.swt-review-shell');
      return shell && shell.classList.contains('is-split');
    });

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

    console.log('Step 11: Verifying fallback for Question #2 (no answerAnalysis)...');
    await page.click('#swt-v7-question-pill');
    await page.waitForSelector('#swt-v7-sheet.is-open', { state: 'visible' });
    await page.click('.ra-v7-list-item[data-index="1"]'); // Question #2
    await page.waitForFunction(() => {
      const pill = document.getElementById('swt-v7-question-pill');
      return pill && pill.textContent.includes('#2');
    });

    await page.click('#start-swt-btn');
    await page.waitForSelector('#swt-step-write', { state: 'visible' });
    await page.fill('#swt-input', 'This is a valid summary test for question two without annotations.');
    await page.click('#swt-submit-btn');
    await page.waitForSelector('#swt-step-results', { state: 'visible' });

    const q2State = await page.evaluate(() => {
      const mount = document.getElementById('swt-parallel-review-mount');
      const ctrl = window.SWTMode.getReviewController();
      return {
        mountDisplay: getComputedStyle(mount).display,
        controllerActive: Boolean(ctrl?.getState()?.isMounted)
      };
    });
    assert.strictEqual(q2State.mountDisplay, 'none', 'Question #2 without answerAnalysis must hide parallel review');
    assert.strictEqual(q2State.controllerActive, false, 'Review controller should not be active for Question #2');

    console.log('Step 12: Verifying AI scoring integration and review preservation...');
    await page.click('#swt-retry-btn');
    await page.click('#swt-v7-question-pill');
    await page.waitForSelector('#swt-v7-sheet.is-open', { state: 'visible' });
    await page.click('.ra-v7-list-item[data-index="0"]'); // Question #1
    await page.waitForFunction(() => {
      const pill = document.getElementById('swt-v7-question-pill');
      return pill && pill.textContent.includes('#1');
    });

    await page.click('#start-swt-btn');
    await page.waitForSelector('#swt-step-write', { state: 'visible' });
    await page.fill('#swt-input', 'Major sporting events around the globe are taking coordinated steps to neutralize their carbon footprint through global initiatives.');
    await page.click('#swt-submit-btn');
    await page.waitForSelector('#swt-parallel-review-mount .swt-review-shell', { state: 'visible' });

    await page.click('#swt-ai-score-btn');
    await page.waitForSelector('.essay-results-breakdown', { state: 'visible' });

    const postAiState = await page.evaluate(() => {
      const mount = document.getElementById('swt-parallel-review-mount');
      const ctrl = window.SWTMode.getReviewController();
      const shell = document.querySelector('.swt-review-shell');
      const marks = document.querySelectorAll('.swt-review-passage mark');
      return {
        mountDisplay: getComputedStyle(mount).display,
        isMounted: Boolean(ctrl?.getState()?.isMounted),
        isSplit: shell?.classList.contains('is-split'),
        markCount: marks.length
      };
    });

    assert.strictEqual(postAiState.mountDisplay !== 'none', true, 'Review mount must remain visible after AI scoring');
    assert.strictEqual(postAiState.isMounted, true, 'Review controller must remain mounted after AI scoring');
    assert.strictEqual(postAiState.isSplit, true, 'Review should remain in desktop split after AI scoring');
    assert.ok(postAiState.markCount >= 2, 'Evidence marks should remain highlighted after AI scoring');

    console.log('Step 13: Verifying changing question directly while on results screen resets attempt and review...');
    // Currently on Question #1 results screen. Change to Question #2 directly without clicking Try Again.
    await page.click('#swt-v7-question-pill');
    await page.waitForSelector('#swt-v7-sheet.is-open', { state: 'visible' });
    await page.click('.ra-v7-list-item[data-index="1"]'); // Question #2
    await page.waitForFunction(() => {
      const pill = document.getElementById('swt-v7-question-pill');
      return pill && pill.textContent.includes('#2');
    });

    const directChangeState = await page.evaluate(() => {
      const mount = document.getElementById('swt-parallel-review-mount');
      const ctrl = window.SWTMode.getReviewController();
      const stepResults = document.getElementById('swt-step-results');
      const startBtn = document.getElementById('start-swt-btn');
      const practiceArea = document.getElementById('swt-practice-area');
      return {
        mountDisplay: getComputedStyle(mount).display,
        controllerActive: Boolean(ctrl?.getState()?.isMounted),
        stepResultsDisplay: getComputedStyle(stepResults).display,
        startBtnVisible: getComputedStyle(startBtn).display !== 'none',
        practiceAreaHidden: getComputedStyle(practiceArea).display === 'none'
      };
    });

    assert.strictEqual(directChangeState.stepResultsDisplay, 'none', 'Results screen must be hidden after selecting new question');
    assert.strictEqual(directChangeState.mountDisplay, 'none', 'Review mount must be hidden after selecting new question');
    assert.strictEqual(directChangeState.controllerActive, false, 'Review controller must be destroyed on question switch');
    assert.strictEqual(directChangeState.startBtnVisible, true, 'Start Writing button must be visible for the new question');
    assert.strictEqual(directChangeState.practiceAreaHidden, true, 'Practice area must be hidden before starting new question');

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
