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
        export const getAuth = () => ({ currentUser: null });
        export const connectAuthEmulator = () => {};
        export const onAuthStateChanged = (_auth, cb) => {
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

  await context.addInitScript(() => {
    window.__historyCounts = { push: 0, replace: 0 };
    try {
      const originalPushState = window.history.pushState.bind(window.history);
      const originalReplaceState = window.history.replaceState.bind(window.history);

      window.history.pushState = (...args) => {
        window.__historyCounts.push += 1;
        return originalPushState(...args);
      };
      window.history.replaceState = (...args) => {
        window.__historyCounts.replace += 1;
        return originalReplaceState(...args);
      };
    } catch (_) {
      // Ignore instrumentation failures.
    }
  });

  const page = await context.newPage();
  const consoleLines = [];

  page.on('console', (msg) => {
    consoleLines.push(`${msg.type()}: ${msg.text()}`);
  });

  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    // Normalize to a known UI state (dismiss any initial modals).
    await clickByScript(page, '#vocab-alert-ok');

    // Navigate into a mode and choose a specific question so URL updates occur.
    await page.evaluate(() => window.switchToMode('read-aloud'));
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 30000 });

    await page.waitForFunction(() => {
      const select = document.getElementById('ra-question-select');
      return !!select && select.options && select.options.length >= 2;
    }, { timeout: 30000 });

    await page.evaluate(() => {
      const select = document.getElementById('ra-question-select');
      if (!select) throw new Error('Missing #ra-question-select');
      const numericOption = Array.from(select.options).find((opt) => /^\d+$/.test(String(opt.value || '')));
      if (!numericOption) {
        throw new Error('Expected at least one numeric Read Aloud option');
      }
      select.value = String(numericOption.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForFunction(() => window.location.pathname.includes('/practice') && window.location.pathname.includes('/read-aloud'), { timeout: 30000 });

    // Reset counters to measure only the browser back interaction.
    await page.evaluate(() => {
      if (window.__historyCounts) {
        window.__historyCounts.push = 0;
        window.__historyCounts.replace = 0;
      }
    });

    // Simulate browser back button.
    await page.goBack({ waitUntil: 'domcontentloaded' });

    // After back, we should no longer be in Read Aloud mode.
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return !panel || !panel.classList.contains('active') || getComputedStyle(panel).display === 'none';
    }, { timeout: 30000 });

    const counts = await page.evaluate(() => window.__historyCounts || { push: -1, replace: -1 });
    assert(counts.replace >= 0 && counts.push >= 0, 'Expected history counters to be available.');

    // Primary signal: back navigation should not trigger high-rate History API updates.
    assert(counts.replace <= 5, `Expected <= 5 replaceState calls during back navigation, saw ${counts.replace}.`);
    assert(counts.push <= 2, `Expected <= 2 pushState calls during back navigation, saw ${counts.push}.`);

    // Best-effort: ensure the Chrome warning isn't emitted.
    const throttleWarning = consoleLines.find((line) => line.toLowerCase().includes('throttling navigation to prevent the browser from hanging'));
    assert(!throttleWarning, `Unexpected navigation throttling warning: ${throttleWarning}`);

    console.log('PracticeRouter back/popstate browser check passed.');
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

