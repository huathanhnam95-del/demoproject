const assert = require('assert');
const net = require('net');
const path = require('path');
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

async function setupFirebaseMocks(context) {
  // Mock Firebase App
  await context.route('**/firebase-app.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const initializeApp = () => ({ name: '[DEFAULT]' });
        export const getApp = () => ({ name: '[DEFAULT]' });
      `
    });
  });

  // Mock Firebase Auth
  await context.route('**/firebase-auth.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getAuth = () => ({ currentUser: null });
        export const connectAuthEmulator = () => {};
        export const onAuthStateChanged = (auth, cb) => {
          setTimeout(() => cb(null), 10);
          return () => {};
        };
        export const setPersistence = () => Promise.resolve();
        export const browserLocalPersistence = 'local';
        export const signInWithEmailAndPassword = () => Promise.resolve({ user: {} });
        export const signOut = () => Promise.resolve();
        export const createUserWithEmailAndPassword = () => Promise.resolve({ user: {} });
        export const sendPasswordResetEmail = () => Promise.resolve();
        export const sendEmailVerification = () => Promise.resolve();
      `
    });
  });

  // Mock Firebase Firestore
  await context.route('**/firebase-firestore.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getFirestore = () => ({ _type: 'firestore' });
        export const connectFirestoreEmulator = () => {};
        export const collection = (db, path) => ({ _type: 'collection', path });
        export const doc = (db, path, ...segments) => ({
          _type: 'doc',
          path: [path, ...segments].filter(Boolean).join('/')
        });
        export const getDoc = async () => ({
          exists: () => false,
          data: () => ({})
        });
        export const getDocs = async () => ({ empty: true, docs: [] });
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
        export const Timestamp = {
          now: () => new Date(),
          fromDate: (d) => d
        };
        export const writeBatch = () => ({
          set: () => {},
          update: () => {},
          commit: async () => {}
        });
        export const runTransaction = async (_db, cb) => cb({
          get: async () => ({ exists: () => false }),
          set: () => {},
          update: () => {}
        });
        export const setLogLevel = () => {};
      `
    });
  });

  // Mock Firebase Functions
  await context.route('**/firebase-functions.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getFunctions = () => ({});
        export const connectFunctionsEmulator = () => {};
        export const httpsCallable = () => async () => ({ data: {} });
      `
    });
  });
}

async function clickByScript(page, selector) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.click();
  }, selector);
}

(async () => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server = null;

  const express = require('express');
  const http = require('http');
  const publicDir = path.join(process.cwd(), 'public');
  const app = express();
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

  await setupFirebaseMocks(context);

  let rfibScriptRequests = 0;
  await context.route('**/rfib-mode.js', async (route) => {
    rfibScriptRequests += 1;
    if (rfibScriptRequests === 1) {
      await route.fulfill({
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
        contentType: 'application/javascript',
        body: '/* fail once */'
      });
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  const errors = [];

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to load resource')) {
        errors.push(text);
      }
    }
  });

  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    // Attempt 1: fail loading rfib-mode.js
    await page.evaluate(() => window.switchToMode('rfib'));

    const firstAttemptState = await page.evaluate(() => ({
      hasRFIBMode: typeof window.RFIBMode === 'object',
      rfibActive: !!document.getElementById('mode-rfib')?.classList.contains('active')
    }));

    assert.equal(firstAttemptState.hasRFIBMode, false, 'Expected RFIBMode not to exist after a failed asset load.');
    assert.equal(firstAttemptState.rfibActive, false, 'Expected RFIB panel to remain inactive after a failed asset load.');

    // If a modal is shown, dismiss it so the next attempt can proceed cleanly.
    await clickByScript(page, '#vocab-alert-ok');
    // First attempt is expected to log a load failure; only treat errors after this point as failures.
    errors.length = 0;

    // Attempt 2: same tab, no reload — should recover and load assets.
    await page.evaluate(() => window.switchToMode('rfib'));
    await page.waitForFunction(() => typeof window.RFIBMode === 'object' && typeof window.RFIBMode.activate === 'function', { timeout: 30000 });
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-rfib');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 30000 });

    assert(rfibScriptRequests >= 2, `Expected at least 2 rfib-mode.js requests, saw ${rfibScriptRequests}.`);

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }

    console.log('Lazy-loader RFIB retry check passed (recover without reload).');
  } finally {
    await browser.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
