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

function parseAnswers(answerText) {
  const parts = String(answerText || '').split(/\r?\n-+\r?\n|---\r?\n|\r?\n---/);
  const cleanParts = parts.map(p => p.trim()).filter(Boolean);

  let choicesRaw = '';
  if (cleanParts.length >= 2) {
    choicesRaw = cleanParts[1];
  } else {
    choicesRaw = String(answerText || '').trim();
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
  const xlsxPath = path.join(process.cwd(), 'public', 'database', 'LMCMA', 'LMCMA', 'LMCMA.xlsx');
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
    const answerText = row.getCell(3).value;
    const transcript = row.getCell(4).value;
    const explanation = row.getCell(5).value;
    const choices = parseAnswers(answerText);
    if (!id || !choices.length) return;

    questions.push({
      id,
      title,
      choices,
      transcript,
      explanation
    });
  });

  assert(questions.length > 0, 'Expected at least one LMCMA question in the workbook');
  return questions;
}

function validateWorkbookAssets(questions) {
  const manifestPath = path.join(process.cwd(), 'public', 'database', 'LMCMA', 'audio', 'manifest.json');
  assert(fs.existsSync(manifestPath), 'Expected LMCMA audio manifest to exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const workbookIds = new Set(questions.map((question) => String(question.id)));

  for (const question of questions) {
    const id = String(question.id);
    assert(String(question.transcript || '').trim().length > 20, `Question ${id} should have a transcript`);
    assert(String(question.explanation || '').trim().length > 20, `Question ${id} should have an explanation`);
    assert(question.choices.length >= 2, `Question ${id} should have at least two choices`);
    assert(question.choices.some((choice) => choice.isCorrect), `Question ${id} should have at least one correct choice`);
    assert(question.choices.some((choice) => !choice.isCorrect), `Question ${id} should have at least one incorrect choice`);

    const voices = manifest[id];
    assert(Array.isArray(voices), `Question ${id} should be present in manifest.json`);
    assert.equal(voices.length, 3, `Question ${id} should have exactly 3 voice variants`);
    assert.equal(new Set(voices.map((voice) => voice.id)).size, 3, `Question ${id} should use 3 unique voices`);

    for (const voice of voices) {
      const audioPath = path.join(process.cwd(), 'public', 'database', 'LMCMA', 'audio', id, voice.file || '');
      assert(fs.existsSync(audioPath), `Expected audio file for question ${id}: ${voice.file}`);
      assert(fs.statSync(audioPath).size > 1000, `Audio file for question ${id} is unexpectedly small: ${voice.file}`);
    }
  }

  for (const manifestId of Object.keys(manifest)) {
    assert(workbookIds.has(manifestId), `Manifest contains an audio entry for non-workbook question ${manifestId}`);
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

function getChoiceCard(page, choiceText) {
  return page.locator('#lmcma-choices-container .lmcma-choice-card', { hasText: choiceText }).first();
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
  const resultBox = page.locator('#lmcma-result-box');
  await page.waitForFunction(() => {
    const box = document.getElementById('lmcma-result-box');
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
  await page.locator('#lmcma-retry-btn').click();

  const resetState = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#lmcma-choices-container .lmcma-choice-card'));
    const staleStateClasses = [
      'is-selected',
      'is-correct-selected',
      'is-incorrect-selected',
      'is-missed-correct',
      'is-disabled'
    ];
    const hasStaleState = cards.some((card) => staleStateClasses.some((className) => card.classList.contains(className)));
    const resultBoxDisplay = getComputedStyle(document.getElementById('lmcma-result-box')).display;
    const explanationDisplay = getComputedStyle(document.getElementById('lmcma-explanation-panel')).display;
    const submitDisabled = document.getElementById('lmcma-submit-btn')?.disabled;
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
  validateWorkbookAssets(questions);
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
    localStorage.setItem('practiceScope', 'pte');
  });

  const errors = [];
  const optionalBackendNoise = /CORS policy|praat-api|Error fetching word data|Failed to fetch/i;
  page.on('pageerror', (error) => {
    if (!optionalBackendNoise.test(error.message)) errors.push(error.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to load resource') && !optionalBackendNoise.test(text)) {
        errors.push(text);
      }
    }
  });

  try {
    // Navigate to page
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    // Exercise the learner click path: Listening skill filter -> LMCMA card.
    const listeningSkillButton = page.locator('.practice-skill-btn[data-practice-skill="listening"]');
    await listeningSkillButton.click();
    await page.waitForFunction(() => {
      const button = document.querySelector('.practice-skill-btn[data-practice-skill="listening"]');
      const card = document.getElementById('mode-btn-lmcma');
      return button?.classList.contains('is-active') &&
        card &&
        getComputedStyle(card).display !== 'none';
    }, { timeout: 10000 });

    const lmcmaCard = page.locator('#mode-btn-lmcma');
    await lmcmaCard.click();
    
    // Wait for container to become active and visible
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-lmcma');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 30000 });

    // Wait for Excel workbook to load and first question to render
    await page.waitForFunction(() => {
      const prompt = document.getElementById('lmcma-question-prompt')?.textContent || '';
      const choices = document.querySelectorAll('#lmcma-choices-container .lmcma-choice-card');
      return prompt.length > 10 && choices.length > 0 && !prompt.includes('Loading');
    }, { timeout: 30000 });

    // Verify correct question title is shown in question picker pill
    let pillText = await page.locator('#lmcma-v7-question-pill').textContent();
    assert(pillText.includes(firstQuestion.title), `Pill text "${pillText}" does not contain expected title "${firstQuestion.title}"`);

    // Navigation controls should move through the question list and back.
    await page.locator('#lmcma-v7-next-btn').click();
    await page.waitForFunction((firstTitle) => {
      const pill = document.getElementById('lmcma-v7-question-pill')?.textContent || '';
      return !pill.includes(firstTitle);
    }, firstQuestion.title, { timeout: 5000 });
    await page.locator('#lmcma-v7-prev-btn').click();
    await page.waitForFunction((firstTitle) => {
      const pill = document.getElementById('lmcma-v7-question-pill')?.textContent || '';
      return pill.includes(firstTitle);
    }, firstQuestion.title, { timeout: 5000 });

    // Question picker should open, search, select an item, and close cleanly.
    await page.locator('#lmcma-v7-question-pill').click();
    await page.waitForFunction(() => {
      const sheet = document.getElementById('lmcma-v7-sheet');
      return sheet?.classList.contains('is-open') && sheet.getAttribute('aria-hidden') === 'false';
    }, { timeout: 5000 });

    await page.locator('#lmcma-v7-jump-search').fill('__no_matching_question__');
    await page.waitForFunction(() => {
      const list = document.getElementById('lmcma-v7-jump-list')?.textContent || '';
      return list.includes('No matching questions');
    }, { timeout: 5000 });

    await page.locator('#lmcma-v7-jump-search').fill(String(target.id));
    await page.waitForFunction((expectedTitle) => {
      const list = document.getElementById('lmcma-v7-jump-list')?.textContent || '';
      return list.includes(expectedTitle);
    }, target.title, { timeout: 5000 });
    await page.locator('#lmcma-v7-jump-list [data-index]', { hasText: target.title }).first().click();
    await page.waitForFunction(() => {
      const sheet = document.getElementById('lmcma-v7-sheet');
      return !sheet?.classList.contains('is-open') && sheet.getAttribute('aria-hidden') === 'true';
    }, { timeout: 5000 });

    pillText = await page.locator('#lmcma-v7-question-pill').textContent();
    assert(pillText.includes(target.title), `Pill text "${pillText}" does not contain selected title "${target.title}"`);

    // Verify choices count
    const choicesCount = await page.locator('#lmcma-choices-container .lmcma-choice-card').count();
    assert.equal(choicesCount, target.choices.length, `Expected ${target.choices.length} choices, found ${choicesCount}`);

    // Verify speed button group interaction
    const speedGroup = page.locator('.lmcma-speed-group');
    assert.equal(await speedGroup.locator('.lmcma-speed-btn.is-active').textContent(), '1.0x', 'Default speed should be 1.0x');
    await speedGroup.locator('.lmcma-speed-btn[data-speed="1.2"]').click();
    assert.equal(await speedGroup.locator('.lmcma-speed-btn.is-active').textContent(), '1.2x', 'Speed should change to 1.2x');

    const voiceOptions = page.locator('#lmcma-voice-select option');
    assert.equal(await voiceOptions.count(), 3, 'Voice selector should show 3 randomized voices for the active question');
    const voiceValues = await voiceOptions.evaluateAll((options) => options.map((option) => option.value));
    const initialAudioSrc = await page.locator('#lmcma-audio-element').evaluate((audio) => audio.currentSrc || audio.src);
    assert(initialAudioSrc.includes(`/database/LMCMA/audio/${target.id}/`), `Audio src should point to target question folder: ${initialAudioSrc}`);
    if (voiceValues.length > 1) {
      await page.locator('#lmcma-voice-select').selectOption(voiceValues[1]);
      await page.waitForFunction((previousSrc) => {
        const audio = document.getElementById('lmcma-audio-element');
        return audio && (audio.currentSrc || audio.src) !== previousSrc;
      }, initialAudioSrc, { timeout: 5000 });
    }

    // Submit should start disabled until at least one selection is made
    const submitBtn = page.locator('#lmcma-submit-btn');
    assert.equal(await submitBtn.isDisabled(), true, 'Submit button should start disabled');

    // Partial score path: one correct answer selected, remaining correct answers missed.
    const correctChoices = target.choices.filter(c => c.isCorrect);
    const incorrectChoices = target.choices.filter(c => !c.isCorrect);
    await clickChoices(page, correctChoices.slice(0, 1));

    assert.equal(await submitBtn.isDisabled(), false, 'Submit button should be enabled after selection');
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

    // Incorrect score path: one incorrect answer selected.
    await clickChoices(page, incorrectChoices.slice(0, 1));

    assert.equal(await submitBtn.isDisabled(), false, 'Submit button should be enabled after incorrect selection');
    await submitBtn.click();

    await assertChoiceClass(page, incorrectChoices[0].text, 'is-incorrect-selected');
    for (const choice of correctChoices) {
      await assertChoiceClass(page, choice.text, 'is-missed-correct');
    }
    await assertScore(page, 0, correctChoices.length, 'Incorrect');
    await retryAndAssertReset(page);

    // Correct score path: all correct answers selected and no incorrect answers selected.
    await clickChoices(page, correctChoices);

    assert.equal(await submitBtn.isDisabled(), false, 'Submit button should be enabled after selection');
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
    const explanationToggle = page.locator('#lmcma-explanation-toggle');
    assert.equal(await explanationToggle.isVisible(), true, 'Explanation toggle should be visible after submit');

    await explanationToggle.click();
    await page.waitForFunction(() => {
      const panel = document.getElementById('lmcma-explanation-panel');
      return !!panel && getComputedStyle(panel).display !== 'none';
    }, { timeout: 5000 });

    // Verify audio transcript has been revealed in accordion
    const transcriptText = await page.locator('#lmcma-passage-text').textContent();
    assert.equal(transcriptText.trim(), target.transcript.trim(), 'Audio transcript should match target transcript');

    const explanationContent = await page.locator('#lmcma-explanation-content').innerHTML();
    assert(explanationContent.length > 50, 'Explanation content should be populated with analyzed text');
    assert(!/<script|onerror=|onclick=/i.test(explanationContent), 'Explanation content should be sanitized');

    await explanationToggle.click();
    await page.waitForFunction(() => {
      const panel = document.getElementById('lmcma-explanation-panel');
      return !!panel && getComputedStyle(panel).display === 'none';
    }, { timeout: 5000 });

    await retryAndAssertReset(page);

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }

    console.log('LMCMA browser check passed successfully.');
  } catch (err) {
    try {
      const screenshotPath = path.join(process.cwd(), 'tests', 'browser', 'lmcma-failure-screenshot.png');
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
