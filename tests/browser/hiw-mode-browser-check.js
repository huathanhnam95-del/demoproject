/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function getWorkbookQuestions() {
  const xlsxPath = path.join(process.cwd(), 'public', 'database', 'Highlight Incorrect Words', 'HIW', 'HIW.xlsx');
  const workbook = new ExcelJS.Workbook();
  let lastError = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await workbook.xlsx.readFile(xlsxPath);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await sleep(250 * attempt);
    }
  }
  if (lastError) throw lastError;
  const sheet = workbook.worksheets[0];

  const questions = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = row.getCell(1).value;
    const title = row.getCell(2).value;
    const answerRaw = row.getCell(3).value;
    const transcript = row.getCell(4).value;
    const explanation = row.getCell(5).value;
    if (!id || !answerRaw) return;

    questions.push({
      id: Number(id),
      title,
      answerRaw,
      transcript,
      explanation
    });
  });

  assert(questions.length > 0, 'Expected at least one HIW question in the workbook');
  return questions;
}

function validateWorkbookAssets(questions) {
  const manifestPath = path.join(process.cwd(), 'public', 'database', 'Highlight Incorrect Words', 'audio', 'manifest.json');
  assert(fs.existsSync(manifestPath), 'Expected HIW audio manifest to exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const workbookIds = questions.map(question => String(question.id)).sort((a, b) => Number(a) - Number(b));
  const manifestIds = Object.keys(manifest).sort((a, b) => Number(a) - Number(b));

  // Verify at least Q1 and Q2 exist and match manifest
  assert(manifest['1'], 'Expected question 1 in manifest');
  assert(manifest['2'], 'Expected question 2 in manifest');

  for (const qId of ['1', '2']) {
    const question = questions.find(q => String(q.id) === qId);
    assert(question, `Workbook should contain question ${qId}`);
    assert(String(question.transcript || '').trim().length > 10, `Question ${qId} should have a transcript`);
    assert(String(question.answerRaw || '').trim().includes('__'), `Question ${qId} should have incorrect/correct markup`);

    const voices = manifest[qId];
    assert(Array.isArray(voices), `Question ${qId} should have voice variants in manifest`);
    assert.equal(voices.length, 3, `Question ${qId} should have exactly 3 voice variants`);

    for (const voice of voices) {
      const audioPath = path.join(process.cwd(), 'public', 'database', 'Highlight Incorrect Words', 'audio', qId, voice.file || '');
      assert(fs.existsSync(audioPath), `Expected audio file for question ${qId}: ${voice.file}`);
    }
  }
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
        export const signInWithCustomToken = () => Promise.resolve({ user: {} });
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
        export const getDoc = async (docRef) => ({ 
          exists: () => false, 
          data: () => ({}) 
        });
        export const getDocs = async (q) => ({ empty: true, docs: [] });
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

async function getWordSpan(page, text) {
  return page.locator('#hiw-passage-container .hiw-word', { hasText: text }).first();
}

async function assertWordClass(page, text, expectedClass) {
  const span = await getWordSpan(page, text);
  const hasClass = await span.evaluate((el, className) => el.classList.contains(className), expectedClass);
  assert(hasClass, `Word "${text}" should have class "${expectedClass}"`);
}

async function assertResultScore(page, finalScore, maxScore) {
  const resultBox = page.locator('#hiw-result-box');
  await page.waitForFunction(() => {
    const box = document.getElementById('hiw-result-box');
    return !!box && getComputedStyle(box).display !== 'none';
  }, undefined, { timeout: 5000 });

  const scoreText = await resultBox.textContent();
  assert(
    scoreText.includes(`Practice Score: ${finalScore} / ${maxScore}`),
    `Expected score "Practice Score: ${finalScore} / ${maxScore}", found: ${scoreText}`
  );
}

async function retryAndAssertReset(page) {
  await page.locator('#hiw-retry-btn').click();

  const resetState = await page.evaluate(() => {
    const words = Array.from(document.querySelectorAll('#hiw-passage-container .hiw-word'));
    const staleStateClasses = [
      'is-selected',
      'is-correct-click',
      'is-incorrect-click',
      'is-missed',
      'is-disabled'
    ];
    const hasStaleState = words.some((word) => staleStateClasses.some((className) => word.classList.contains(className)));
    const resultBoxDisplay = getComputedStyle(document.getElementById('hiw-result-box')).display;
    const explanationDisplay = getComputedStyle(document.getElementById('hiw-explanation-panel')).display;
    const submitBtn = document.getElementById('hiw-submit-btn');
    const submitVisible = submitBtn && getComputedStyle(submitBtn).display !== 'none';
    const submitDisabled = submitBtn ? submitBtn.disabled : true;
    return {
      hasStaleState,
      resultBoxVisible: resultBoxDisplay !== 'none',
      explanationVisible: explanationDisplay !== 'none',
      submitVisible,
      submitDisabled
    };
  });

  assert.equal(resetState.hasStaleState, false, 'Words should clear classes after retry');
  assert.equal(resetState.resultBoxVisible, false, 'Result box should be hidden after retry');
  assert.equal(resetState.explanationVisible, false, 'Explanation panel should be hidden after retry');
  assert.equal(resetState.submitVisible, true, 'Submit button should be shown again after retry');
  assert.equal(resetState.submitDisabled, false, 'Submit button should be enabled on restart');
}

(async () => {
  const port = await getFreePort();
  const questions = await getWorkbookQuestions();
  validateWorkbookAssets(questions);
  const firstQuestion = questions[0];
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
    localStorage.setItem('practiceScope', 'pte');
  });

  const errors = [];
  const optionalBackendNoise = /CORS policy|praat-api|Error fetching word data|Failed to fetch/i;
  page.on('pageerror', (error) => {
    console.error('PAGE ERROR:', error);
    if (!optionalBackendNoise.test(error.message)) errors.push(error.message);
  });
  page.on('console', (msg) => {
    console.log(`BROWSER CONSOLE [${msg.type()}]:`, msg.text());
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to load resource') && !text.includes('Error loading extended database') && !optionalBackendNoise.test(text)) {
        errors.push(text);
      }
    }
  });

  try {
    // 1. Load the practice home and verify page navigation to HIW mode
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', undefined, { timeout: 30000 });

    // Click Listening skill button
    const listeningSkillButton = page.locator('.practice-skill-btn[data-practice-skill="listening"]');
    await listeningSkillButton.click();
    await page.waitForFunction(() => {
      const button = document.querySelector('.practice-skill-btn[data-practice-skill="listening"]');
      const card = document.getElementById('mode-btn-hiw');
      return button?.classList.contains('is-active') &&
        card &&
        getComputedStyle(card).display !== 'none';
    }, undefined, { timeout: 10000 });

    const hiwCard = page.locator('#mode-btn-hiw');
    await hiwCard.click();
    
    // Wait for HIW panel to activate
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-hiw');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, undefined, { timeout: 30000 });

    // Wait for Excel content to load and tokens to render
    await page.waitForFunction(() => {
      const list = document.querySelectorAll('#hiw-passage-container .hiw-word');
      return list.length > 10;
    }, undefined, { timeout: 30000 });

    // Verify picker displays question #1
    let pillText = await page.locator('#hiw-v7-question-pill').textContent();
    assert(pillText.includes(firstQuestion.title), `Pill text "${pillText}" does not contain expected title "${firstQuestion.title}"`);

    // Verify pagination controls
    await page.locator('#hiw-v7-next-btn').click();
    await page.waitForFunction((firstTitle) => {
      const pill = document.getElementById('hiw-v7-question-pill')?.textContent || '';
      return !pill.includes(firstTitle);
    }, firstQuestion.title, { timeout: 5000 });
    await page.locator('#hiw-v7-prev-btn').click();
    await page.waitForFunction((firstTitle) => {
      const pill = document.getElementById('hiw-v7-question-pill')?.textContent || '';
      return pill.includes(firstTitle);
    }, firstQuestion.title, { timeout: 5000 });

    // Verify speed controls
    const speedGroup = page.locator('.hiw-speed-group');
    assert.equal(await speedGroup.locator('.hiw-speed-btn.is-active').textContent(), '1.0x', 'Default speed should be 1.0x');
    await speedGroup.locator('.hiw-speed-btn[data-speed="1.2"]').click();
    assert.equal(await speedGroup.locator('.hiw-speed-btn.is-active').textContent(), '1.2x', 'Speed should change to 1.2x');

    // Verify voice model list
    const voiceOptions = page.locator('#hiw-voice-select option');
    assert.equal(await voiceOptions.count(), 3, 'Voice select should show 3 randomized options');

    // 2. Perform interactive clicking on words
    // Incorrect words in first question: "initial" (spoken: inertial), "eclipse" (spoken: ellipse), "vocal" (spoken: focal), "crust" (spoken: axis)
    // We will select "initial" (correct highlight), select "Happy" (incorrect highlight/penalty), and leave "eclipse" unselected (missed highlight)
    const initialSpan = await getWordSpan(page, 'initial');
    const happySpan = await getWordSpan(page, 'Happy');

    await initialSpan.click();
    await happySpan.click();

    // Verify classes are selected
    await assertWordClass(page, 'initial', 'is-selected');
    await assertWordClass(page, 'Happy', 'is-selected');

    // Submit answers
    const submitBtn = page.locator('#hiw-submit-btn');
    await submitBtn.click();

    // Verify post-submission visual corrections
    // "initial" is correct selection (mismatched + selected) => green
    await assertWordClass(page, 'initial', 'is-correct-click');
    // "Happy" is incorrect selection (matching + selected) => red
    await assertWordClass(page, 'Happy', 'is-incorrect-click');
    // "eclipse" is missed incorrect word (mismatched + unselected) => orange dashed
    await assertWordClass(page, 'eclipse', 'is-missed');
    // "New" is normal unselected => faded disabled
    await assertWordClass(page, 'New', 'is-disabled');

    // Score: 1 correct - 1 incorrect = 0 final score. Max possible is 4 (4 incorrect words)
    await assertResultScore(page, 0, 4);

    // Verify explanation toggle
    const explanationToggle = page.locator('#hiw-explanation-toggle');
    assert.equal(await explanationToggle.isVisible(), true, 'Explanation toggle should be visible after submit');
    await explanationToggle.click();

    await page.waitForFunction(() => {
      const panel = document.getElementById('hiw-explanation-panel');
      return !!panel && getComputedStyle(panel).display !== 'none';
    }, undefined, { timeout: 5000 });

    const explanationContent = await page.locator('#hiw-explanation-content').innerHTML();
    assert(explanationContent.length > 50, 'Explanation content should be populated');
    assert(!/<script|onerror=|onclick=/i.test(explanationContent), 'Explanation content should be sanitized');

    const hasTable = await page.locator('#hiw-explanation-content .hiw-comparison-table').count();
    assert(hasTable > 0, 'Expected .hiw-comparison-table to be rendered in explanation');
    const hasCard = await page.locator('#hiw-explanation-content .hiw-explanation-text-card').count();
    assert(hasCard > 0, 'Expected .hiw-explanation-text-card to be rendered in explanation');

    try {
      const successScreenshotPath = path.join(process.cwd(), 'tests', 'browser', 'hiw-success-screenshot.png');
      await page.screenshot({ path: successScreenshotPath, fullPage: true });
      console.log(`Saved success screenshot to: ${successScreenshotPath}`);
    } catch (ssErr) {
      console.error('Failed to capture success screenshot:', ssErr);
    }

    await explanationToggle.click();
    await page.waitForFunction(() => {
      const panel = document.getElementById('hiw-explanation-panel');
      return !!panel && getComputedStyle(panel).display === 'none';
    }, undefined, { timeout: 5000 });

    // Retry and check reset
    await retryAndAssertReset(page);

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }

    console.log('HIW browser check passed successfully.');
  } catch (err) {
    try {
      const screenshotPath = path.join(process.cwd(), 'tests', 'browser', 'hiw-failure-screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Saved failure screenshot to: ${screenshotPath}`);
    } catch (ssErr) {
      console.error('Failed to capture screenshot:', ssErr);
    }
    if (errors.length) {
      console.error('Console Errors during run:\n' + errors.join('\n'));
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
