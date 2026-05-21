/* eslint-disable no-console */

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

async function getWorkbookQuestions() {
  const xlsxPath = path.join(process.cwd(), 'public', 'database', 'RMCMA', 'RMCMA', 'RMCMA.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.worksheets[0];

  const questions = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = row.getCell(1).value;
    const title = row.getCell(2).value;
    const answerText = row.getCell(3).value;
    const explanation = row.getCell(4).value;
    const choices = parseAnswers(answerText);
    if (!id || !choices.length) return;

    questions.push({
      id,
      title,
      choices,
      explanation
    });
  });

  assert(questions.length > 0, 'Expected at least one RMCMA question in the workbook');
  return questions;
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

function getChoiceCard(page, choiceText) {
  return page.locator('#rmcma-choices-container .rmcma-choice-card', { hasText: choiceText }).first();
}

async function clickChoices(page, choices) {
  for (const choice of choices) {
    await getChoiceCard(page, choice.text).click();
  }
}

async function assertChoiceClass(page, choiceText, expectedClass) {
  const card = getChoiceCard(page, choiceText);
  const hasClass = await card.evaluate((el, className) => el.classList.contains(className), expectedClass);
  assert(hasClass, `Choice "${choiceText}" should have class "${expectedClass}"`);
}

async function assertScore(page, expectedScore, totalCorrectChoices, expectedHeader) {
  const resultBox = page.locator('#rmcma-result-box');
  await page.waitForFunction(() => {
    const box = document.getElementById('rmcma-result-box');
    return !!box && getComputedStyle(box).display !== 'none';
  }, { timeout: 5000 });

  const scoreText = await resultBox.textContent();
  assert(
    scoreText.includes(`You scored ${expectedScore} out of ${totalCorrectChoices}`),
    `Expected score "${expectedScore} out of ${totalCorrectChoices}", found: ${scoreText}`
  );
  assert(scoreText.includes(expectedHeader), `Expected result header "${expectedHeader}", found: ${scoreText}`);
}

async function retryAndAssertReset(page) {
  await page.locator('#rmcma-retry-btn').click();

  const resetState = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#rmcma-choices-container .rmcma-choice-card'));
    const staleStateClasses = [
      'is-selected',
      'is-correct-selected',
      'is-incorrect-selected',
      'is-missed-correct',
      'is-disabled'
    ];
    const hasStaleState = cards.some((card) => staleStateClasses.some((className) => card.classList.contains(className)));
    const resultBoxDisplay = getComputedStyle(document.getElementById('rmcma-result-box')).display;
    const explanationDisplay = getComputedStyle(document.getElementById('rmcma-explanation-panel')).display;
    const submitDisabled = document.getElementById('rmcma-submit-btn')?.disabled;
    return {
      hasStaleState,
      resultBoxVisible: resultBoxDisplay !== 'none',
      explanationVisible: explanationDisplay !== 'none',
      submitDisabled
    };
  });

  assert.equal(resetState.hasStaleState, false, 'Choices should be cleared after retry');
  assert.equal(resetState.resultBoxVisible, false, 'Result box should be hidden after retry');
  assert.equal(resetState.explanationVisible, false, 'Explanation panel should be hidden after retry');
  assert.equal(resetState.submitDisabled, true, 'Submit should be disabled after retry until a choice is selected');
}

(async () => {
  const port = await getFreePort();
  const questions = await getWorkbookQuestions();
  const firstQuestion = questions[0];
  const target = questions.find((question) => {
    const correctCount = question.choices.filter((choice) => choice.isCorrect).length;
    const incorrectCount = question.choices.filter((choice) => !choice.isCorrect).length;
    return correctCount >= 2 && incorrectCount >= 1;
  }) || firstQuestion;
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

    // Exercise the learner click path: Reading skill filter -> RMCMA card.
    const readingSkillButton = page.locator('.practice-skill-btn[data-practice-skill="reading"]');
    await readingSkillButton.click();
    await page.waitForFunction(() => {
      const button = document.querySelector('.practice-skill-btn[data-practice-skill="reading"]');
      const card = document.getElementById('mode-btn-rmcma');
      return button?.classList.contains('is-active') &&
        card &&
        getComputedStyle(card).display !== 'none';
    }, { timeout: 10000 });

    const rmcmaCard = page.locator('#mode-btn-rmcma');
    await rmcmaCard.click();
    
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
    let pillText = await page.locator('#rmcma-v7-question-pill').textContent();
    assert(pillText.includes(firstQuestion.title), `Pill text "${pillText}" does not contain expected title "${firstQuestion.title}"`);

    // Navigation controls should move through the question list and back.
    await page.locator('#rmcma-v7-next-btn').click();
    await page.waitForFunction((firstTitle) => {
      const pill = document.getElementById('rmcma-v7-question-pill')?.textContent || '';
      return !pill.includes(firstTitle);
    }, firstQuestion.title, { timeout: 5000 });
    await page.locator('#rmcma-v7-prev-btn').click();
    await page.waitForFunction((firstTitle) => {
      const pill = document.getElementById('rmcma-v7-question-pill')?.textContent || '';
      return pill.includes(firstTitle);
    }, firstQuestion.title, { timeout: 5000 });

    // Question picker should open, search, select an item, and close cleanly.
    await page.locator('#rmcma-v7-question-pill').click();
    await page.waitForFunction(() => {
      const sheet = document.getElementById('rmcma-v7-sheet');
      return sheet?.classList.contains('is-open') && sheet.getAttribute('aria-hidden') === 'false';
    }, { timeout: 5000 });

    await page.locator('#rmcma-v7-jump-search').fill('__no_matching_question__');
    await page.waitForFunction(() => {
      const list = document.getElementById('rmcma-v7-jump-list')?.textContent || '';
      return list.includes('No matching questions');
    }, { timeout: 5000 });

    await page.locator('#rmcma-v7-jump-search').fill(String(target.id));
    await page.waitForFunction((expectedTitle) => {
      const list = document.getElementById('rmcma-v7-jump-list')?.textContent || '';
      return list.includes(expectedTitle);
    }, target.title, { timeout: 5000 });
    await page.locator('#rmcma-v7-jump-list [data-index]', { hasText: target.title }).first().click();
    await page.waitForFunction(() => {
      const sheet = document.getElementById('rmcma-v7-sheet');
      return !sheet?.classList.contains('is-open') && sheet.getAttribute('aria-hidden') === 'true';
    }, { timeout: 5000 });

    pillText = await page.locator('#rmcma-v7-question-pill').textContent();
    assert(pillText.includes(target.title), `Pill text "${pillText}" does not contain selected title "${target.title}"`);

    // Verify all choices are rendered for the selected target question.
    const choicesCount = await page.locator('#rmcma-choices-container .rmcma-choice-card').count();
    assert.equal(choicesCount, target.choices.length, `Expected ${target.choices.length} choices, found ${choicesCount}`);

    // Submit should start disabled until the learner selects at least one option.
    const submitBtn = page.locator('#rmcma-submit-btn');
    assert.equal(await submitBtn.isDisabled(), true, 'Submit button should start disabled');

    // Correct-answer path: select every correct choice and submit.
    const correctChoices = target.choices.filter(c => c.isCorrect);
    const incorrectChoices = target.choices.filter(c => !c.isCorrect);
    await clickChoices(page, correctChoices);

    assert.equal(await submitBtn.isDisabled(), false, 'Submit button should be enabled after selections');

    await submitBtn.click();

    for (const choice of target.choices) {
      if (choice.isCorrect) {
        await assertChoiceClass(page, choice.text, 'is-correct-selected');
      } else {
        await assertChoiceClass(page, choice.text, 'is-disabled');
      }
    }

    await assertScore(page, correctChoices.length, correctChoices.length, 'Correct!');

    // Verify explanation toggle button is visible
    const explanationToggle = page.locator('#rmcma-explanation-toggle');
    assert.equal(await explanationToggle.isVisible(), true, 'Explanation toggle should be visible after submit');

    await explanationToggle.click();
    await page.waitForFunction(() => {
      const panel = document.getElementById('rmcma-explanation-panel');
      return !!panel && getComputedStyle(panel).display !== 'none';
    }, { timeout: 5000 });
    const explanationContent = await page.locator('#rmcma-explanation-content').innerHTML();
    assert(explanationContent.length > 50, 'Explanation content should be populated with analyzed text');
    assert(!/<script|onerror=|onclick=/i.test(explanationContent), 'Explanation content should be sanitized');

    await explanationToggle.click();
    await page.waitForFunction(() => {
      const panel = document.getElementById('rmcma-explanation-panel');
      return !!panel && getComputedStyle(panel).display === 'none';
    }, { timeout: 5000 });

    await retryAndAssertReset(page);

    // Partial path: select only one correct choice, leaving at least one correct choice missed.
    if (correctChoices.length > 1) {
      await clickChoices(page, [correctChoices[0]]);
      await submitBtn.click();
      await assertChoiceClass(page, correctChoices[0].text, 'is-correct-selected');
      for (const choice of correctChoices.slice(1)) {
        await assertChoiceClass(page, choice.text, 'is-missed-correct');
      }
      for (const choice of incorrectChoices) {
        await assertChoiceClass(page, choice.text, 'is-disabled');
      }
      await assertScore(page, 1, correctChoices.length, 'Partially Correct');
      await retryAndAssertReset(page);
    }

    // Incorrect path: select an incorrect choice and verify red + missed-correct states.
    if (incorrectChoices.length > 0) {
      await clickChoices(page, [incorrectChoices[0]]);
      await submitBtn.click();
      await assertChoiceClass(page, incorrectChoices[0].text, 'is-incorrect-selected');
      for (const choice of correctChoices) {
        await assertChoiceClass(page, choice.text, 'is-missed-correct');
      }
      await assertScore(page, 0, correctChoices.length, 'Incorrect');
      await retryAndAssertReset(page);
    }

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
