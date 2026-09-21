/* eslint-disable no-console */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
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
        export const getDoc = async () => ({ exists: () => true, data: () => ({ englishLevel: 'B2', isAdmin: true }) });
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
        export const httpsCallable = (functions, name) => async () => ({ data: { success: true } });
      `
    });
  });
  await context.route('**/*storage.googleapis.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({})
    });
  });
}

async function main() {
  const app = express();
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get('/pte-practice/writing/swt', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Server listening on ${baseUrl}`);

  const outputDir = path.join(__dirname, '..', 'test-results', 'swt-local-test');
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await setupFirebaseMocks(context);

  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__DISABLE_FIREBASE_EMULATORS__ = true;
    localStorage.setItem('swtModeFirstUse', 'true');
    localStorage.setItem('swtInfoDismissed', '1');
    sessionStorage.setItem('hasSeenOnboardingModal', 'true');
  });

  await page.goto(`${baseUrl}/pte-practice/writing/swt`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '#level-selection-modal, #welcome-onboarding-modal { display: none !important; }' });

  // Wait for SWT mode to initialize
  await page.waitForFunction(() => {
    const pill = document.getElementById('swt-v7-question-pill');
    return pill && pill.textContent.includes('#1');
  }, { timeout: 15000 });

  // Jump to Question #50
  await page.click('#swt-v7-question-pill');
  await page.waitForSelector('#swt-v7-sheet.is-open', { state: 'visible' });
  await page.fill('#swt-v7-jump-search', 'Overqualified');
  await page.waitForTimeout(500);
  await page.click('.ra-v7-list-item');
  await page.waitForFunction(() => {
    const pill = document.getElementById('swt-v7-question-pill');
    return pill && pill.textContent.includes('50');
  });

  // Start test and submit summary
  await page.click('#start-swt-btn');
  await page.waitForSelector('#swt-step-write', { state: 'visible' });
  await page.fill('#swt-input', 'Although overqualified workers are often rejected due to bias, research shows they perform better and stay longer, while empowerment can dissipate their dissatisfaction.');
  await page.click('#swt-submit-btn');

  // Wait for review layout
  await page.waitForSelector('#swt-parallel-review-mount .swt-review-shell', { state: 'visible', timeout: 10000 });

  // 1. Show all points overview
  await page.click('.swt-review-show-all-passage-btn');
  await page.waitForTimeout(600);

  const screenshotOverviewPath = path.join(outputDir, 'q50-01-show-all-points.png');
  await page.screenshot({ path: screenshotOverviewPath, fullPage: false });
  console.log(`Saved screenshot: ${screenshotOverviewPath}`);

  // 2. Open Example Summary Tab (Version A)
  await page.click('.swt-review-tab-sample');
  await page.waitForTimeout(600);

  const screenshotVerAPath = path.join(outputDir, 'q50-02-example-summary-version-a.png');
  await page.screenshot({ path: screenshotVerAPath, fullPage: false });
  console.log(`Saved screenshot: ${screenshotVerAPath}`);

  // 3. Switch to Version B (Advanced)
  await page.click('.swt-review-sample-tab[data-version="versionB"]');
  await page.waitForTimeout(600);

  const screenshotVerBPath = path.join(outputDir, 'q50-03-example-summary-version-b.png');
  await page.screenshot({ path: screenshotVerBPath, fullPage: false });
  console.log(`Saved screenshot: ${screenshotVerBPath}`);

  // Copy to brain artifacts
  const artifactDir = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain\\c2a9494e-013f-45ea-9da2-68d2726efdc6';
  fs.copyFileSync(screenshotOverviewPath, path.join(artifactDir, 'q50-01-show-all-points.png'));
  fs.copyFileSync(screenshotVerAPath, path.join(artifactDir, 'q50-02-example-summary-version-a.png'));
  fs.copyFileSync(screenshotVerBPath, path.join(artifactDir, 'q50-03-example-summary-version-b.png'));
  console.log('Copied all screenshots to artifact directory.');

  await browser.close();
  server.close();
  console.log('Done!');
}

main().catch((err) => {
  console.error('Error capturing Question 50 review:', err);
  process.exit(1);
});
