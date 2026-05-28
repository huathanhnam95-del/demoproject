/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

async function setupFirebaseMocks(context) {
  await context.route('**/firebase-app.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export const initializeApp = () => ({ name: '[DEFAULT]' }); export const getApp = () => ({ name: '[DEFAULT]' });`
  }));
  await context.route('**/firebase-auth.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const mockUser = { uid: 'sst-user', email: 'sst@example.test', getIdTokenResult: () => Promise.resolve({ claims: {} }) };
      export const getAuth = () => ({ currentUser: mockUser });
      export const connectAuthEmulator = () => {};
      export const onAuthStateChanged = (auth, cb) => { setTimeout(() => cb(mockUser), 10); return () => {}; };
      export const setPersistence = () => Promise.resolve();
      export const browserLocalPersistence = 'local';
      export const signInWithEmailAndPassword = () => Promise.resolve({ user: mockUser });
      export const signOut = () => Promise.resolve();
      export const createUserWithEmailAndPassword = () => Promise.resolve({ user: mockUser });
      export const sendPasswordResetEmail = () => Promise.resolve();
      export const sendEmailVerification = () => Promise.resolve();
    `
  }));
  await context.route('**/firebase-firestore.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const getFirestore = () => ({ _type: 'firestore' });
      export const connectFirestoreEmulator = () => {};
      export const collection = (db, path) => ({ path });
      export const doc = (db, path, ...segments) => ({ path: [path, ...segments].join('/') });
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
      export const increment = (value) => value;
      export const arrayUnion = (...values) => values;
      export const arrayRemove = (...values) => values;
      export const Timestamp = { now: () => new Date(), fromDate: (date) => date };
      export const writeBatch = () => ({ set: () => {}, update: () => {}, commit: async () => {} });
      export const runTransaction = async (db, callback) => callback({ get: async () => ({ exists: () => false }), set: () => {}, update: () => {} });
      export const setLogLevel = () => {};
    `
  }));
  await context.route('**/firebase-functions.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const getFunctions = () => ({ _type: 'functions' });
      export const connectFunctionsEmulator = () => {};
      export const httpsCallable = (functions, name) => async (payload) => {
        window.__lastSSTCallableName = name;
        window.__lastSSTCallablePayload = payload;
        return { data: window.__mockSSTScoreResult };
      };
    `
  }));
}

function startServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicDir));
  app.get(/^(?!\/api).*$/, (request, response, next) => {
    if (/\.\w{2,5}(\?.*)?$/.test(request.path)) return next();
    response.sendFile(path.join(publicDir, 'index.html'));
  });
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function summaryOfWords(count) {
  return `${Array.from({ length: count - 1 }, (_, index) => `idea${index + 1}`).join(' ')} conclusion.`;
}

(async () => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 1100 } });
  await setupFirebaseMocks(context);
  await context.route('https://api.languagetool.org/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      matches: [
        { message: 'Use a corrected spelling.', rule: { issueType: 'misspelling', category: { id: 'TYPOS' } } },
        { message: 'Check agreement.', rule: { issueType: 'grammar', category: { id: 'GRAMMAR' } } }
      ]
    })
  }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    window.__DISABLE_FIREBASE_EMULATORS__ = true;
    window.__SST_TEST_DURATION_SECONDS__ = 4;
    Math.random = () => 0;
    localStorage.setItem('practiceScope', 'pte');
    window.__mockSSTScoreResult = {
      success: true,
      scores: {
        content: { score: 3, max: 4, rationale: 'Most lecture ideas were captured.' },
        form: { score: 2, max: 2, rationale: 'Valid response length.' },
        grammar: { score: 1, max: 2, rationale: 'Minor grammar issue.' },
        vocabulary: { score: 2, max: 2, rationale: 'Appropriate vocabulary.' },
        spelling: { score: 1, max: 2, rationale: 'One spelling issue.' }
      },
      overall: { total: 9, maxTotal: 12, percent: 75 },
      mainPointsAnalysis: {
        identified: ['The response captures the central topic.'],
        missed: ['It omits one comparison in the lecture.'],
        paraphrasingQuality: 'Mostly paraphrased in the learner own words.'
      },
      teacherAdviceChat: 'Include the comparison and retain concise academic wording.'
    };
  });

  try {
    await page.goto(`${origin}/pte-practice/listening/sst/1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.SSTMode) && document.getElementById('sst-question-title')?.textContent.includes('#1'));

    const initial = await page.evaluate(() => ({
      firstListeningCard: document.querySelector('.mode-switch-btn[data-practice-skill="listening"]')?.id,
      panelVisible: getComputedStyle(document.getElementById('mode-sst')).display !== 'none',
      timer: document.getElementById('sst-timer').textContent.trim(),
      resultsText: document.getElementById('sst-results').innerText,
      pointsVisible: document.body.innerText.includes('Main points for review')
    }));
    assert.strictEqual(initial.firstListeningCard, 'mode-btn-sst', 'SST should be first in Listening');
    assert.strictEqual(initial.panelVisible, true, 'SST panel should be visible');
    assert.strictEqual(initial.timer, '10:00', 'Timer should wait at ten minutes until playback starts');
    assert.strictEqual(initial.resultsText, '', 'Results should begin empty');
    assert.strictEqual(initial.pointsVisible, false, 'Main points should remain hidden during the attempt');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('app-preloader')).display === 'none', undefined, { timeout: 15000 });
    await page.screenshot({ path: 'tmp/sst-mode-browser-check.png', fullPage: true });

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('practice-route-question', { detail: { mode: 'sst', questionId: '115' } })));
    await page.waitForTimeout(250);
    const routedTitle = await page.locator('#sst-question-title').innerText();
    assert(routedTitle.includes('#115'), `Actual-ID route should load non-contiguous SST ID 115; displayed "${routedTitle}"`);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('practice-route-question', { detail: { mode: 'sst', questionId: '1' } })));
    await page.waitForFunction(() => document.getElementById('sst-question-title')?.textContent.includes('#1'));

    const validSummary = summaryOfWords(50);
    const initialAudioSource = await page.locator('#sst-audio-element').evaluate((audio) => audio.getAttribute('src') || audio.src);
    await page.fill('#sst-response', validSummary);
    assert.strictEqual(await page.locator('#sst-word-count').innerText(), '50', 'Word counter should update live');
    await page.click('#sst-play-btn');
    await page.waitForFunction(() => document.getElementById('sst-timer').textContent.trim() !== '10:00');

    const playing = await page.evaluate(() => ({
      playDisabled: document.getElementById('sst-play-btn').disabled,
      seekDisabled: document.getElementById('sst-seek').disabled,
      nextDisabled: document.getElementById('sst-next-btn').disabled,
      selectDisabled: document.getElementById('sst-question-select').disabled,
      rate: document.getElementById('sst-audio-element').playbackRate,
      source: document.getElementById('sst-audio-element').getAttribute('src') || document.getElementById('sst-audio-element').src,
      hasVoiceControl: Boolean(document.querySelector('#mode-sst [id*="voice"], #mode-sst [id*="speed"]'))
    }));
    assert.deepStrictEqual(playing, {
      playDisabled: true,
      seekDisabled: true,
      nextDisabled: true,
      selectDisabled: true,
      rate: 1,
      source: initialAudioSource,
      hasVoiceControl: false
    }, 'Started SST attempts should be one-play and lock navigation');

    await page.evaluate(() => { window.confirm = () => false; });
    await page.evaluate(async () => window.switchToMode('type'));
    assert.strictEqual(await page.evaluate(() => window.appState.currentMode), 'sst', 'Cancelled exit should preserve the active attempt');

    await page.evaluate(() => document.getElementById('sst-audio-element').pause());
    await page.waitForTimeout(150);
    assert.strictEqual(await page.evaluate(() => document.getElementById('sst-play-btn').disabled), true, 'Pause must not expose replay controls');

    await page.waitForFunction(() => document.getElementById('sst-results').innerText.includes('Check agreement.'), undefined, { timeout: 10000 });
    const provisional = await page.locator('#sst-results').innerText();
    assert(provisional.includes('Main points for review'), 'Main points should be revealed after submission');
    assert(provisional.includes('Provisional Grammar') && provisional.includes('1/2'), 'Grammar feedback should render after submit');
    assert(provisional.includes('Provisional Spelling') && provisional.includes('1/2'), 'Spelling feedback should render after submit');
    const reviewPlayer = await page.evaluate(() => ({
      playDisabled: document.getElementById('sst-play-btn').disabled,
      seekExists: Boolean(document.getElementById('sst-seek')),
      seekDisabled: document.getElementById('sst-seek')?.disabled
    }));
    assert.deepStrictEqual(
      reviewPlayer,
      { playDisabled: false, seekExists: true, seekDisabled: false },
      'Submitting an SST attempt should unlock replay and seek controls'
    );
    await page.click('#sst-play-btn');
    await page.waitForFunction(() => !document.getElementById('sst-audio-element').paused);
    await page.evaluate(() => {
      const seek = document.getElementById('sst-seek');
      seek.value = '10';
      seek.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const reviewPosition = await page.evaluate(() => {
      const audio = document.getElementById('sst-audio-element');
      return { currentTime: audio.currentTime, duration: audio.duration };
    });
    assert(
      reviewPosition.currentTime >= reviewPosition.duration * 0.09,
      'Review seeking should update the submitted-attempt audio position'
    );
    await page.evaluate(() => document.getElementById('sst-audio-element').pause());

    await page.evaluate(() => {
      window.__sstAdvice = [];
      const messenger = document.querySelector('df-messenger');
      if (messenger) messenger.renderCustomText = (text) => window.__sstAdvice.push(text);
      const bubble = document.querySelector('df-messenger-chat-bubble');
      if (bubble) bubble.openChat = () => {};
      document.getElementById('sst-response').value = 'Changed after submission.';
    });
    await page.click('#sst-ai-score-btn');
    await page.waitForFunction(() => document.getElementById('sst-results').innerText.includes('AI practice feedback'));
    const ai = await page.evaluate(() => ({
      name: window.__lastSSTCallableName,
      questionId: window.__lastSSTCallablePayload.questionId,
      text: window.__lastSSTCallablePayload.text,
      visibleText: document.getElementById('sst-results').innerText,
      advice: window.__sstAdvice
    }));
    assert.strictEqual(ai.name, 'scoreSST', 'SST should call the dedicated scorer');
    assert.strictEqual(ai.questionId, '1', 'AI payload should retain the submitted question ID');
    assert.strictEqual(ai.text, validSummary, 'AI payload should use the submitted snapshot, not edited textarea content');
    assert(ai.visibleText.includes('9/12') && ai.visibleText.includes('not an official PTE score'), 'AI practice score and disclaimer should render');
    assert(ai.visibleText.includes('Missed') && ai.visibleText.includes('Teacher advice'), 'Full AI coaching should render inline');
    assert(ai.advice.some((text) => text.includes('Include the comparison')), 'BEL should receive SST teacher advice');

    await context.unroute('https://api.languagetool.org/**');
    await context.route('https://api.languagetool.org/**', (route) => route.abort());
    await page.evaluate(() => { Math.random = () => 0.99; });
    await page.click('#sst-retry-btn');
    const retryAudioSource = await page.locator('#sst-audio-element').evaluate((audio) => audio.getAttribute('src') || audio.src);
    assert.notStrictEqual(retryAudioSource, initialAudioSource, 'A fresh retry may receive a new fixed voice variant');
    await page.fill('#sst-response', validSummary);
    await page.click('#sst-play-btn');
    await page.waitForFunction(() => document.getElementById('sst-submit-btn').disabled === false);
    await page.click('#sst-submit-btn');
    await page.waitForFunction(() => document.getElementById('sst-results').innerText.includes('Language check unavailable'));
    assert((await page.locator('#sst-results').innerText()).includes('N/A'), 'Unavailable language service should not award false zeroes');

    await page.click('#sst-retry-btn');
    await page.evaluate(() => {
      const audio = document.getElementById('sst-audio-element');
      audio.src = '/database/SST/audio/not-present.mp3';
      audio.load();
    });
    await page.waitForFunction(() => document.getElementById('sst-audio-status').innerText.includes('could not'), undefined, { timeout: 5000 });
    assert.strictEqual(await page.locator('#sst-timer').innerText(), '10:00', 'Pre-playback audio failure must not start the timer');
    assert.strictEqual(await page.locator('#sst-retry-btn').isVisible(), true, 'Pre-playback audio failure should expose retry');

    await page.click('#sst-retry-btn');
    await page.fill('#sst-response', validSummary);
    await page.click('#sst-play-btn');
    await page.waitForFunction(() => document.getElementById('sst-timer').textContent.trim() !== '10:00');
    await page.evaluate(() => document.getElementById('sst-audio-element').dispatchEvent(new Event('error')));
    await page.waitForFunction(() => document.getElementById('sst-audio-status').innerText.includes('attempt is void'));
    const voided = await page.evaluate(() => ({
      draft: document.getElementById('sst-response').value,
      responseDisabled: document.getElementById('sst-response').disabled,
      submitDisabled: document.getElementById('sst-submit-btn').disabled,
      retryVisible: getComputedStyle(document.getElementById('sst-retry-btn')).display !== 'none'
    }));
    assert.deepStrictEqual(voided, {
      draft: validSummary,
      responseDisabled: true,
      submitDisabled: true,
      retryVisible: true
    }, 'A mid-playback audio failure should void the attempt and preserve its draft for display');

    await page.click('#sst-retry-btn');
    await page.fill('#sst-response', validSummary);
    await page.click('#sst-play-btn');
    await page.waitForFunction(() => document.getElementById('sst-timer').textContent.trim() !== '10:00');
    await page.evaluate(() => { window.confirm = () => true; });
    await page.evaluate(async () => window.switchToMode('type'));
    assert.strictEqual(await page.evaluate(() => window.appState.currentMode), 'type', 'Confirmed exit should leave SST');
    await page.evaluate(async () => window.switchToMode('sst'));
    await page.waitForFunction(() => document.getElementById('sst-timer').textContent.trim() === '10:00');

    assert.deepStrictEqual(pageErrors, [], `Expected no page errors: ${pageErrors.join(' | ')}`);
    console.log('SST mode browser verification complete.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
