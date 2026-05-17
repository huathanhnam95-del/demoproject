/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
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
          uid: 'swt-user',
          email: 'swt@example.test',
          metadata: { lastSignInTime: 'Wed, 13 May 2026 00:00:00 GMT' },
          getIdTokenResult: () => Promise.resolve({ claims: {} })
        };
        export const getAuth = () => ({ currentUser: mockUser });
        export const connectAuthEmulator = () => {};
        export const onAuthStateChanged = (auth, cb) => { setTimeout(() => cb(mockUser), 10); return () => {}; };
        export const setPersistence = () => Promise.resolve();
        export const browserLocalPersistence = 'local';
        export const signInWithEmailAndPassword = () => Promise.resolve({ user: { uid: 'swt-user' } });
        export const signOut = () => Promise.resolve();
        export const createUserWithEmailAndPassword = () => Promise.resolve({ user: { uid: 'swt-user' } });
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
        export const doc = (db, path, ...segments) => ({ _type: 'doc', path: [path, ...segments].filter(Boolean).join('/') });
        export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
        export const getDocs = async () => ({ empty: true, docs: [], forEach: () => {} });
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
          window.__lastCallableName = name;
          window.__lastCallablePayload = payload;
          return { data: window.__mockSWTScoreResult || { success: true } };
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
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await setupFirebaseMocks(context);
  const page = await context.newPage();
  const pageErrors = [];

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
    window.__mockSWTScoreResult = {
      success: true,
      scores: {
        content: { score: 3, max: 4, rationale: 'Most key ideas are covered.', evidence: ['key ideas'], fixTips: ['Add one missing point.'] },
        form: { score: 1, max: 1, rationale: 'One valid sentence.', evidence: [], fixTips: [] },
        grammar: { score: 2, max: 2, rationale: 'Clear grammar.', evidence: [], fixTips: [] },
        vocabulary: { score: 1, max: 2, rationale: 'Adequate vocabulary.', evidence: [], fixTips: ['Use more precise academic vocabulary.'] }
      },
      overall: { total: 7, maxTotal: 9, percent: 78 },
      mainPointsAnalysis: {
        identified: ['The passage discusses climate action.'],
        missed: ['One supporting detail is missing.'],
        paraphrasingQuality: 'Mostly paraphrased.'
      },
      teacherAdviceChat: 'Practice combining main ideas into one concise sentence.'
    };
  });

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.switchToMode && window.SWTMode));

    await page.evaluate(async () => window.switchToMode('swt'));
    await page.waitForFunction(() => {
      const pill = document.getElementById('swt-v7-question-pill');
      return pill && pill.textContent.includes('#1');
    });

    const initialState = await page.evaluate(() => ({
      modeVisible: getComputedStyle(document.getElementById('mode-swt')).display !== 'none',
      startDisabled: document.getElementById('start-swt-btn').disabled,
      sourceLength: document.getElementById('swt-source-display').innerText.length,
      formInvalid: window.SWTMode.__debug.scoreForm('The text has one sentence. It has another sentence.').score,
      formInvalidNoLetters: window.SWTMode.__debug.scoreForm('123 456 789 000 111.').score,
      formValidWithAbbreviation: window.SWTMode.__debug.scoreForm('The policy encouraged cleaner transport investment across the U.S.').score
    }));

    assert.strictEqual(initialState.modeVisible, true, 'SWT mode should be visible');
    assert.strictEqual(initialState.startDisabled, false, 'Start button should be enabled after questions load');
    assert.ok(initialState.sourceLength > 100, 'Source text should render');
    assert.strictEqual(initialState.formInvalid, 0, 'Form scorer should reject multiple sentences');
    assert.strictEqual(initialState.formInvalidNoLetters, 0, 'Form scorer should reject numeric-only summaries');
    assert.strictEqual(initialState.formValidWithAbbreviation, 1, 'Form scorer should allow final abbreviations');

    await page.click('#start-swt-btn');
    await page.fill('#swt-input', 'The passage explains that major sports events are joining climate initiatives to reduce emissions and encourage wider environmental action.');

    const lockedState = await page.evaluate(() => ({
      prevDisabled: document.getElementById('swt-v7-prev-btn').disabled,
      nextDisabled: document.getElementById('swt-v7-next-btn').disabled,
      pillDisabled: document.getElementById('swt-v7-question-pill').disabled,
      shouldConfirmExit: window.SWTMode.shouldConfirmExit()
    }));

    assert.deepStrictEqual(
      lockedState,
      { prevDisabled: true, nextDisabled: true, pillDisabled: true, shouldConfirmExit: true },
      'Navigation should be locked while writing with a draft'
    );

    await page.evaluate(() => { window.confirm = () => false; });
    await page.evaluate(async () => window.switchToMode('essay'));

    const afterCancelledExit = await page.evaluate(() => ({
      currentMode: window.appState.currentMode,
      swtVisible: getComputedStyle(document.getElementById('mode-swt')).display !== 'none',
      draft: document.getElementById('swt-input').value
    }));

    assert.strictEqual(afterCancelledExit.currentMode, 'swt', 'Cancelled exit should keep app state on SWT');
    assert.strictEqual(afterCancelledExit.swtVisible, true, 'Cancelled exit should keep SWT panel visible');
    assert.ok(afterCancelledExit.draft.includes('major sports events'), 'Cancelled exit should preserve draft');

    await page.click('#swt-submit-btn');
    await page.waitForFunction(() => {
      const results = document.getElementById('swt-results-container');
      return results && results.innerText.includes('Form') && results.innerText.includes('1/1');
    });

    await page.evaluate(() => {
      window.__swtRenderedAdvice = [];
      window.__swtChatOpened = false;
      const messenger = document.querySelector('df-messenger');
      if (messenger) {
        messenger.renderCustomText = (text, showBotAvatar) => {
          window.__swtRenderedAdvice.push({ text, showBotAvatar });
        };
      }
      const bubble = document.querySelector('df-messenger-chat-bubble');
      if (bubble) {
        bubble.openChat = () => { window.__swtChatOpened = true; };
      }
    });

    await page.click('#swt-ai-score-btn');
    await page.waitForFunction(() => {
      const results = document.getElementById('swt-results-container');
      return results
        && results.innerText.includes('7 / 9')
        && results.innerText.includes('Main Points Analysis')
        && results.innerText.includes('Teacher advice')
        && results.innerText.includes('Practice combining main ideas into one concise sentence.');
    });

    const aiState = await page.evaluate(() => ({
      callableName: window.__lastCallableName,
      payloadHasSource: Boolean(window.__lastCallablePayload?.sourceText && window.__lastCallablePayload.sourceText.length > 100),
      payloadHasMainPoints: Array.isArray(window.__lastCallablePayload?.mainPoints),
      chatOpened: Boolean(window.__swtChatOpened),
      renderedAdvice: window.__swtRenderedAdvice || []
    }));

    assert.strictEqual(aiState.callableName, 'scoreSWT', 'AI scoring should call scoreSWT');
    assert.strictEqual(aiState.payloadHasSource, true, 'AI scoring payload should include source text');
    assert.strictEqual(aiState.payloadHasMainPoints, true, 'AI scoring payload should include main points array');
    assert.strictEqual(aiState.chatOpened, true, 'BEL chat should open when SWT teacher advice is sent');
    assert.ok(
      aiState.renderedAdvice.some((item) => item.text.includes('Practice combining main ideas into one concise sentence.')),
      'BEL chat should receive SWT teacher advice'
    );

    await page.click('#swt-retry-btn');
    const retryState = await page.evaluate(() => ({
      practiceHidden: getComputedStyle(document.getElementById('swt-practice-area')).display === 'none',
      startVisible: getComputedStyle(document.getElementById('start-swt-btn')).display !== 'none',
      draft: document.getElementById('swt-input').value,
      timer: document.getElementById('swt-timer').textContent
    }));

    assert.deepStrictEqual(
      retryState,
      { practiceHidden: true, startVisible: true, draft: '', timer: '10:00' },
      'Retry should reset the SWT attempt cleanly'
    );

    assert.deepStrictEqual(pageErrors, [], `Expected no page errors, got: ${pageErrors.join(' | ')}`);
    await page.screenshot({ path: 'tmp/swt-mode-browser-check.png', fullPage: true });
    console.log('SWT mode browser verification complete.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
