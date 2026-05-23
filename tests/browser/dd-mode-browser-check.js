const assert = require('assert');
const path = require('path');
const fs = require('fs');
const net = require('net');
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

function getSmokeQuestion() {
  const dataPath = path.join(process.cwd(), 'public', 'database', 'DD', 'dd-questions.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const target = data.find(q => q.id === 1);
  assert(target, 'Expected DD dataset to contain Question 1.');
  return target;
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
  const target = getSmokeQuestion();
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
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    console.log('PAGE LOG:', msg.text());
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

    // Exercise learner click path: Reading skill filter -> DD card.
    console.log('Selecting Reading skill filter...');
    const readingSkillButton = page.locator('.practice-skill-btn[data-practice-skill="reading"]');
    await readingSkillButton.click();
    await page.waitForFunction(() => {
      const button = document.querySelector('.practice-skill-btn[data-practice-skill="reading"]');
      const card = document.getElementById('mode-btn-dd');
      return button?.classList.contains('is-active') &&
        card &&
        getComputedStyle(card).display !== 'none';
    }, { timeout: 10000 });

    console.log('Clicking Drag & Drop launcher card...');
    const ddCard = page.locator('#mode-btn-dd');
    await ddCard.click();

    // Wait for container to become active and visible
    console.log('Waiting for DD mode panel to load...');
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-dd');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 30000 });

    // Wait for JSON question data to be fetched and loaded
    await page.waitForFunction(() => {
      const chips = document.querySelectorAll('#dd-word-bank .dd-option-chip');
      return chips.length > 0;
    }, { timeout: 30000 });

    // Verify correct question title is shown in question picker pill
    const pillText = await page.locator('#dd-v7-question-pill').textContent();
    assert(pillText.includes(target.title), `Pill text "${pillText}" does not contain expected title "${target.title}"`);

    // Verify correct options are loaded in the word bank
    const sourceCount = await page.locator('#dd-word-bank .dd-option-chip').count();
    assert.equal(sourceCount, target.options.length, `Expected ${target.options.length} option chips, found ${sourceCount}`);

    // --- PHASE 1: Perfect Attempt (Submit and verify correct feedback) ---
    console.log('Running Perfect Attempt solve...');
    // We place options in blanks using click-to-place fallback
    for (const blank of target.blanks) {
      // Find the option chip that corresponds to this blank's correct answer
      const chip = page.locator('#dd-word-bank .dd-option-chip', { hasText: blank.answer });
      await chip.click();

      // Place it in the blank
      const slot = page.locator(`#dd-passage .dd-blank-slot[data-blank-id="${blank.blankId}"]`);
      await slot.click();
    }

    // Verify all blanks are filled and submit button is enabled
    const submitBtn = page.locator('#dd-submit-btn');
    assert.equal(await submitBtn.getAttribute('disabled'), null, 'Submit button should be enabled after all blanks are filled');

    console.log('Submitting perfect attempt...');
    await submitBtn.click();

    // Result summary box should show perfect score
    await page.waitForSelector('#dd-result-summary', { state: 'visible', timeout: 5000 });
    const summaryText = await page.locator('#dd-result-summary').textContent();
    const expectedScoreText = `${target.blanks.length} / ${target.blanks.length}`;
    assert(summaryText.includes(expectedScoreText), `Expected score ${expectedScoreText} in result summary, got: ${summaryText}`);

    // Verify explanation header is visible (Requirement 1)
    const isHeaderVisible = await page.locator('#dd-explanation-header').isVisible();
    assert(isHeaderVisible, 'Explanation header should be visible after submission');
    const headerText = await page.locator('#dd-explanation-header').textContent();
    assert.equal(headerText, 'Show explanation', 'Explanation header text should be "Show explanation"');

    // Verify that detailed cards show "Correct" and have explanations
    const resultCards = page.locator('#dd-results .dd-result-card');
    const cardCount = await resultCards.count();
    assert.equal(cardCount, target.blanks.length, `Expected ${target.blanks.length} result cards, found: ${cardCount}`);

    for (let i = 0; i < cardCount; i++) {
      const card = resultCards.nth(i);
      const cardText = await card.textContent();
      assert(cardText.includes('Correct'), `Card #${i + 1} should be Correct`);
      assert(cardText.includes('Explanation'), `Card #${i + 1} should show Explanation`);
      assert(cardText.includes('Coherence Cue') || cardText.includes('Grammar & Vocab Cue'), `Card #${i + 1} should show cues`);
    }

    // --- PHASE 2: Retry and Incorrect Attempt ---
    console.log('Testing Retry button...');
    const retryBtn = page.locator('#dd-retry-btn');
    await retryBtn.click();

    // Verify UI resets
    const clearedState = await page.evaluate(() => {
      const filledSlots = document.querySelectorAll('#dd-passage .dd-blank-slot.is-filled').length;
      const resultBoxDisplay = getComputedStyle(document.getElementById('dd-result-summary')).display;
      const resultsContainerDisplay = getComputedStyle(document.getElementById('dd-results')).display;
      const submitBtnVisible = getComputedStyle(document.getElementById('dd-submit-btn')).display !== 'none';
      const submitBtnDisabled = document.getElementById('dd-submit-btn').disabled;
      return {
        filledSlots,
        resultBoxVisible: resultBoxDisplay !== 'none',
        resultsContainerVisible: resultsContainerDisplay !== 'none',
        submitBtnVisible,
        submitBtnDisabled
      };
    });

    assert.equal(clearedState.filledSlots, 0, 'No blank slots should be filled after retry');
    assert.equal(clearedState.resultBoxVisible, false, 'Result summary should be hidden');
    assert.equal(clearedState.resultsContainerVisible, false, 'Detailed results container should be hidden');
    assert.equal(clearedState.submitBtnVisible, true, 'Submit button should be visible again');
    assert.equal(clearedState.submitBtnDisabled, true, 'Submit button should be disabled after retry');

    // Solve with 1 incorrect choice to verify distractor feedback
    console.log('Running Incorrect Attempt solve...');
    
    // We will place correct answers in all blanks except the first one, where we place a distractor
    const incorrectWord = target.options.find(o => o.kind === 'distractor').text;
    console.log(`Using incorrect word for first blank: ${incorrectWord}`);

    // Place incorrect word in blank 1
    await page.locator('#dd-word-bank .dd-option-chip', { hasText: incorrectWord }).click();
    await page.locator(`#dd-passage .dd-blank-slot[data-blank-id="${target.blanks[0].blankId}"]`).click();

    // Verify Submit button is enabled after filling just one blank (Requirement 2)
    assert.equal(await submitBtn.getAttribute('disabled'), null, 'Submit button should be enabled after filling just one blank');

    // Place correct words in remaining blanks
    for (let i = 1; i < target.blanks.length; i++) {
      const blank = target.blanks[i];
      await page.locator('#dd-word-bank .dd-option-chip', { hasText: blank.answer }).click();
      await page.locator(`#dd-passage .dd-blank-slot[data-blank-id="${blank.blankId}"]`).click();
    }

    // Submit
    assert.equal(await submitBtn.getAttribute('disabled'), null, 'Submit button should be enabled');
    console.log('Submitting incorrect attempt...');
    await submitBtn.click();

    // Verify score is incorrect (e.g. 3 / 4)
    await page.waitForSelector('#dd-result-summary', { state: 'visible', timeout: 5000 });
    const summaryTextWrong = await page.locator('#dd-result-summary').textContent();
    const expectedScoreTextWrong = `${target.blanks.length - 1} / ${target.blanks.length}`;
    assert(summaryTextWrong.includes(expectedScoreTextWrong), `Expected score ${expectedScoreTextWrong} in summary, got: ${summaryTextWrong}`);

    // Verify first card is incorrect and has distractor analysis
    const firstCard = resultCards.first();
    const firstCardText = await firstCard.textContent();
    assert(firstCardText.includes('Incorrect'), 'First blank card should show Incorrect badge');
    assert(firstCardText.includes('Distractor Analysis'), 'First blank card should show Distractor Analysis');
    assert(firstCardText.includes(incorrectWord), 'First blank card should mention incorrect word in analysis');

    // --- PHASE 3: Question Picker and Navigation ---
    console.log('Testing Question Picker...');
    // Click question pill
    const pill = page.locator('#dd-v7-question-pill');
    await pill.click();

    // Wait for picker sheet
    await page.waitForSelector('#dd-v7-sheet', { state: 'visible', timeout: 5000 });
    
    // Type in search box to filter for Dark Matter (Question #4)
    await page.fill('#dd-v7-jump-search', 'Dark Matter');
    
    // Click matching item
    await page.click('#dd-v7-jump-list .ra-v7-list-item');

    // Picker sheet should close automatically, and Q4 should load
    await page.waitForFunction(() => {
      const sheet = document.getElementById('dd-v7-sheet');
      return !sheet || !sheet.classList.contains('is-open');
    }, { timeout: 5000 });
    const newPillText = await pill.textContent();
    assert(newPillText.includes('Dark Matter') && newPillText.includes('#4'), `Expected Q4 to load, got pill: ${newPillText}`);

    // Verify Q4 options count (Dark Matter has 5 blanks, total 8 options)
    const newSourceCount = await page.locator('#dd-word-bank .dd-option-chip').count();
    assert.equal(newSourceCount, 8, `Expected 8 options for Q4, found ${newSourceCount}`);

    // Test Navigation: Next button
    console.log('Testing next button...');
    const nextBtn = page.locator('#dd-v7-next-btn');
    await nextBtn.click();

    // Verify Q5 loaded (Thea Proctor)
    await page.waitForFunction(() => {
      const pill = document.getElementById('dd-v7-question-pill');
      return pill && pill.textContent.includes('#5') && pill.textContent.includes('Thea Proctor');
    }, { timeout: 5000 });

    // Test Navigation: Prev button
    console.log('Testing prev button...');
    const prevBtn = page.locator('#dd-v7-prev-btn');
    await prevBtn.click();

    // Verify Q4 reloaded
    await page.waitForFunction(() => {
      const pill = document.getElementById('dd-v7-question-pill');
      return pill && pill.textContent.includes('#4') && pill.textContent.includes('Dark Matter');
    }, { timeout: 5000 });

    if (errors.length) {
      throw new Error('Page errors detected:\n' + errors.join('\n'));
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  DD Browser Check Passed Successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (err) {
    try {
      const screenshotPath = path.join(process.cwd(), 'dd_screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Saved failure screenshot to: ${screenshotPath}`);
    } catch (ssErr) {
      console.error('Failed to capture screenshot:', ssErr);
    }
    if (errors.length) {
      console.error('Console/Page errors during execution:\n' + errors.join('\n'));
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
