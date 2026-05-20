const assert = require('assert');
const path = require('path');
const net = require('net');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

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

function parseAnswers(answerText) {
  const parts = String(answerText || '').split(/\n-+\n|---\n|\n---/);
  let choicesRaw = '';
  if (parts.length >= 3) {
    choicesRaw = parts.slice(2).join('\n');
  } else {
    const simpleParts = String(answerText || '').split('---');
    if (simpleParts.length >= 3) {
      choicesRaw = simpleParts.slice(2).join('\n');
    }
  }

  const choices = [];
  choicesRaw.split('\n').forEach((line) => {
    const cleanLine = line.trim();
    if (!cleanLine) return;
    const match = cleanLine.match(/^\[([xX\s]*)\]\s*(.*)$/);
    if (match) {
      choices.push({
        text: match[2].trim(),
        isCorrect: match[1].toLowerCase().includes('x')
      });
    }
  });
  return choices;
}

async function getSmokeQuestion() {
  const xlsxPath = path.join(process.cwd(), 'public', 'database', 'RMCMA', 'RMCMA', 'RMCMA.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.worksheets[0];
  
  // Read first data row (row 2)
  const row = sheet.getRow(2);
  const id = row.getCell(1).value;
  const title = row.getCell(2).value;
  const answerText = row.getCell(3).value;
  const explanation = row.getCell(4).value;

  const choices = parseAnswers(answerText);
  assert(choices.length > 0, `Expected choices to be parsed for question ${id}`);

  return {
    id,
    title,
    choices,
    explanation
  };
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
  const port = await getFreePort();
  const target = await getSmokeQuestion();
  const baseUrl = `http://127.0.0.1:${port}`;
  
  const express = require('express');
  const http = require('http');
  const publicDir = path.join(process.cwd(), 'public');
  const app = express();
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  
  const server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

  await setupFirebaseMocks(context);

  const page = await context.newPage();
  
  await page.addInitScript(() => {
    window.__DISABLE_FIREBASE_EMULATORS__ = true;
    window.sessionStorage.setItem('guestMode', 'true');
  });

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
    // Navigate to page
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    // Switch to rmcma mode
    await page.evaluate(() => window.switchToMode('rmcma'));
    
    // Wait for container to become active and visible
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-rmcma');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 30000 });

    // Wait for the Excel workbook to be fetched and first question loaded
    await page.waitForFunction(() => {
      const text = document.getElementById('rmcma-passage-text')?.textContent || '';
      return text.length > 20 && !text.includes('Loading');
    }, { timeout: 30000 });

    // Verify correct question title is shown in question picker pill
    const pillText = await page.locator('#rmcma-v7-question-pill').textContent();
    assert(pillText.includes(target.title), `Pill text "${pillText}" does not contain expected title "${target.title}"`);

    // Verify all choices are rendered
    const choicesCount = await page.locator('#rmcma-choices-container .rmcma-choice-card').count();
    assert.equal(choicesCount, target.choices.length, `Expected ${target.choices.length} choices, found ${choicesCount}`);

    // Select the correct choices by checking their texts
    const correctChoices = target.choices.filter(c => c.isCorrect);
    
    // We will click all option cards that correspond to correct choices
    for (const choice of correctChoices) {
      // Find the card element having this text
      const choiceCard = page.locator('#rmcma-choices-container .rmcma-choice-card', { hasText: choice.text });
      await choiceCard.click();
    }

    // Submit button should be enabled
    const submitBtn = page.locator('#rmcma-submit-btn');
    await assert.equal(await submitBtn.getAttribute('disabled'), null, 'Submit button should be enabled after selections');

    // Click submit
    await submitBtn.click();

    // Verify correction colors and class names
    // Correctly chosen should have class `is-correct-selected`
    for (const choice of target.choices) {
      const card = page.locator('#rmcma-choices-container .rmcma-choice-card', { hasText: choice.text });
      if (choice.isCorrect) {
        // Since we clicked it, it must have class `is-correct-selected`
        const hasClass = await card.evaluate(el => el.classList.contains('is-correct-selected'));
        assert(hasClass, `Choice "${choice.text}" should have class "is-correct-selected"`);
      } else {
        // Incorrect, unselected choice should have class `is-disabled`
        const hasClass = await card.evaluate(el => el.classList.contains('is-disabled'));
        assert(hasClass, `Choice "${choice.text}" should have class "is-disabled"`);
      }
    }

    // Verify score banner
    const resultBox = page.locator('#rmcma-result-box');
    await page.waitForFunction(() => {
      const box = document.getElementById('rmcma-result-box');
      return !!box && getComputedStyle(box).display !== 'none';
    }, { timeout: 5000 });

    const scoreText = await resultBox.textContent();
    assert(scoreText.includes(`${correctChoices.length}`), `Expected score banner to mention correct choices count: ${scoreText}`);

    // Verify explanation toggle button is visible
    const explanationToggle = page.locator('#rmcma-explanation-toggle');
    await assert.equal(await explanationToggle.isVisible(), true, 'Explanation toggle should be visible after submit');

    // Click toggle to show explanation
    await explanationToggle.click();

    // Verify explanation content is displayed
    const explanationPanel = page.locator('#rmcma-explanation-panel');
    await page.waitForFunction(() => {
      const panel = document.getElementById('rmcma-explanation-panel');
      return !!panel && getComputedStyle(panel).display !== 'none';
    }, { timeout: 5000 });

    const explanationContent = await page.locator('#rmcma-explanation-content').innerHTML();
    assert(explanationContent.length > 50, 'Explanation content should be populated with analyzed text');

    // Click retry
    const retryBtn = page.locator('#rmcma-retry-btn');
    await retryBtn.click();

    // Verify everything is reset
    const resetState = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#rmcma-choices-container .rmcma-choice-card'));
      const hasSelected = cards.some(c => c.classList.contains('is-selected') || c.classList.contains('is-correct-selected'));
      const resultBoxDisplay = getComputedStyle(document.getElementById('rmcma-result-box')).display;
      const explanationDisplay = getComputedStyle(document.getElementById('rmcma-explanation-panel')).display;
      return {
        hasSelected,
        resultBoxVisible: resultBoxDisplay !== 'none',
        explanationVisible: explanationDisplay !== 'none'
      };
    });

    assert.equal(resetState.hasSelected, false, 'Choices should be cleared after retry');
    assert.equal(resetState.resultBoxVisible, false, 'Result box should be hidden after retry');
    assert.equal(resetState.explanationVisible, false, 'Explanation panel should be hidden after retry');

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }

    console.log('RMCMA browser check passed successfully.');
  } catch (err) {
    try {
      const screenshotPath = path.join('C:\\Users\\Admin\\.gemini\\antigravity-ide\\brain\\f4292bd5-1f01-42ab-b60b-8e5bba4c315e', 'screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Saved failure screenshot to: ${screenshotPath}`);
    } catch (ssErr) {
      console.error('Failed to capture screenshot:', ssErr);
    }
    if (errors.length) {
      console.error('Page/Console Errors during run:\n' + errors.join('\n'));
    }
    throw err;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
