const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
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

async function waitForServer(url, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // Retry until ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseAnswers(answerText) {
  return String(answerText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .match(/__([^_]+?)__/g)?.map((chunk) => {
      const inner = chunk.slice(2, -2);
      return normalizeText(inner.split('/')[0] || '');
    }).filter(Boolean) || [];
}

function parseArgs(argv) {
  const args = {
    noServer: false,
    baseUrl: process.env.BASE_URL || ''
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-server') {
      args.noServer = true;
    } else if (arg === '--base-url') {
      args.baseUrl = argv[index + 1] || '';
      args.noServer = true;
      index += 1;
    }
  }

  if (args.baseUrl) {
    args.noServer = true;
  }

  if (args.noServer && !args.baseUrl) {
    throw new Error('BASE_URL is required when running rfib-mode-browser-check.js with --no-server.');
  }

  return args;
}

function getSmokeQuestion() {
  const dataPath = path.join(process.cwd(), 'public', 'database', 'RFIB', 'index.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const items = Array.isArray(data.items) ? data.items : [];
  const target = items.find((item) => item && item.beginnerText && item.intermediateText && item.audio?.beginner && item.audio?.intermediate)
    || items.find((item) => item && item.beginnerText && item.intermediateText)
    || items[0];

  assert(target, 'Expected RFIB dataset to contain at least one question.');

  const answers = parseAnswers(target.answerText);
  assert.equal(
    answers.length,
    Number(target.blankCount || 0),
    `Expected parsed answer count to match blank count for question ${target.id}.`
  );

  return { target, answers };
}

async function waitForQuestion(page, questionId) {
  await page.waitForFunction((expectedId) => {
    const current = document.getElementById('rfib-current-question-id');
    return !!current && current.textContent.trim() === String(expectedId).padStart(4, '0');
  }, questionId, { timeout: 30000 });
}

async function waitForBlanks(page, blankCount) {
  await page.waitForFunction((expectedCount) => {
    return document.querySelectorAll('#rfib-cloze-view .rfib-blank-select').length === Number(expectedCount);
  }, blankCount, { timeout: 30000 });
}

async function fillAnswers(page, answers) {
  await page.evaluate((expectedAnswers) => {
    const selects = Array.from(document.querySelectorAll('#rfib-cloze-view .rfib-blank-select'));
    if (selects.length !== expectedAnswers.length) {
      throw new Error(`Expected ${expectedAnswers.length} blanks, found ${selects.length}`);
    }

    selects.forEach((select, index) => {
      const answer = expectedAnswers[index];
      const option = Array.from(select.options).find((opt) => opt.value === answer);
      if (!option) {
        throw new Error(`Missing answer option for blank ${index + 1}: ${answer}`);
      }
      select.value = answer;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, answers);
}

async function clickByScript(page, selector) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.click();
  }, selector);
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
        export const getDoc = async (docRef) => ({ 
          exists: () => false, 
          data: () => ({}) 
        });
        export const getDocs = async (q) => ({ empty: true, docs: [] });
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
        export const runTransaction = async (db, cb) => cb({ 
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

(async () => {
  const args = parseArgs(process.argv);
  const port = await getFreePort();
  const { target, answers } = getSmokeQuestion();
  const baseUrl = args.baseUrl || `http://127.0.0.1:${port}`;
  let server = null;

  if (!args.noServer) {
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
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

  // ── Firebase Mocking ───────────────────────────────────────────
  await setupFirebaseMocks(context);

  const page = await context.newPage();
  
  // Disable emulators explicitly in the browser context
  await page.addInitScript(() => {
    window.__DISABLE_FIREBASE_EMULATORS__ = true;
  });
  const errors = [];

  page.on('pageerror', (error) => {
    console.error('BROWSER PAGEERROR:', error.message, error.stack);
    errors.push(error.message);
  });
  page.on('console', (msg) => {
    const text = msg.text();
    console.log(`BROWSER ${msg.type().toUpperCase()}:`, text);
    if (msg.type() === 'error') {
      if (!text.includes('Failed to load resource')) {
        errors.push(text);
      }
    }
  });

  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    await page.evaluate(() => window.switchToMode('rfib'));
    await page.waitForFunction(() => typeof window.RFIBMode === 'object' && typeof window.RFIBMode.activate === 'function', { timeout: 30000 });
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-rfib');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 30000 });

    await page.selectOption('#rfib-question-select', String(target.id));
    await waitForQuestion(page, target.id);
    await waitForBlanks(page, target.blankCount);

    const firstBlankOptionCount = await page.locator('#rfib-cloze-view .rfib-blank-select').first().locator('option').count();
    assert(firstBlankOptionCount >= 4, 'Expected each blank to render a randomized option list.');

    await fillAnswers(page, answers);
    await clickByScript(page, '#rfib-check-btn');

    await page.waitForFunction((blankCount) => {
      const box = document.getElementById('rfib-result-box');
      return !!box && box.classList.contains('is-visible') && box.textContent.includes(`/${blankCount} blanks correct`);
    }, target.blankCount, { timeout: 30000 });

    const summary = await page.locator('#rfib-result-box .rfib-result-summary').textContent();
    assert(
      String(summary || '').includes(`${answers.length}/${answers.length}`),
      `Unexpected RFIB summary: ${summary}`
    );

    const beginnerText = normalizeText(target.beginnerText || '');
    const intermediateText = normalizeText(target.intermediateText || '');

    if (beginnerText) {
      await clickByScript(page, '#rfib-support-beginner-btn');
      await page.waitForFunction(() => {
        const variant = document.getElementById('rfib-support-variant')?.textContent || '';
        const text = String(document.getElementById('rfib-support-text')?.textContent || '').replace(/\s+/g, ' ').trim();
        return /beginner/i.test(variant) && text.length > 20;
      }, { timeout: 30000 });
    }

    if (intermediateText) {
      await clickByScript(page, '#rfib-support-intermediate-btn');
      await page.waitForFunction(() => {
        const variant = document.getElementById('rfib-support-variant')?.textContent || '';
        const text = String(document.getElementById('rfib-support-text')?.textContent || '').replace(/\s+/g, ' ').trim();
        return /intermediate/i.test(variant) && text.length > 20;
      }, { timeout: 30000 });
    }

    const supportState = await page.evaluate(() => ({
      supportVariant: document.getElementById('rfib-support-variant')?.textContent || '',
      supportText: document.getElementById('rfib-support-text')?.textContent || '',
      supportAudioHtml: document.getElementById('rfib-support-audio')?.innerHTML || '',
      fullAudioSrc: document.getElementById('rfib-full-audio-player')?.src || '',
      resultText: document.getElementById('rfib-result-box')?.textContent || ''
    }));

    assert(supportState.fullAudioSrc, 'Expected RFIB full audio source to be populated.');
    assert(
      String(supportState.supportText || '').trim().length > 20,
      'Expected RFIB support text to render after toggling support.'
    );
    if (target.audio?.beginner || target.audio?.intermediate) {
      assert(
        supportState.supportAudioHtml.includes('modern-btn--play') || supportState.supportAudioHtml.includes('Audio not available'),
        'Expected RFIB support audio UI to render.'
      );
    }
    /* Result text was already verified at submission time above. */

    await clickByScript(page, '#rfib-retry-btn');
    await page.waitForFunction(() => {
      const box = document.getElementById('rfib-result-box');
      const selects = Array.from(document.querySelectorAll('#rfib-cloze-view .rfib-blank-select'));
      return (
        !!box &&
        !box.classList.contains('is-visible') &&
        selects.length > 0 &&
        selects.every((select) => String(select.value || '') === '')
      );
    }, { timeout: 30000 });

    const cleared = await page.evaluate(() => ({
      firstValue: document.querySelector('#rfib-cloze-view .rfib-blank-select')?.value || '',
      resultVisible: document.getElementById('rfib-result-box')?.classList.contains('is-visible') || false
    }));

    assert.equal(cleared.firstValue, '', 'Retry should clear the current blank selections.');
    assert.equal(cleared.resultVisible, false, 'Retry should clear the result box.');

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }

    console.log(`RFIB browser check passed for question ${target.id}.`);
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
