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
          uid: 'rts-user',
          email: 'rts@example.test',
          metadata: {
            lastSignInTime: 'Thu, 14 May 2026 10:00:00 GMT',
            creationTime: 'Thu, 14 May 2026 10:00:00 GMT'
          },
          getIdToken: () => Promise.resolve('mock-token'),
          getIdTokenResult: () => Promise.resolve({ claims: {} })
        };
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
    });
  });

  await context.route('**/firebase-firestore.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getFirestore = () => ({ _type: 'firestore' });
        export const connectFirestoreEmulator = () => {};
        export const collection = (db, path) => ({ path });
        export const doc = (db, path, ...segments) => ({ path: [path, ...segments].filter(Boolean).join('/') });
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
          return { data: window.__mockRTSScoreResult };
        };
      `
    });
  });

  await context.route('**/df-messenger.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        customElements.define('df-messenger', class extends HTMLElement {});
        customElements.define('df-messenger-chat-bubble', class extends HTMLElement {});
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
      resolve({
        server,
        origin: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    permissions: ['microphone']
  });
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
    localStorage.setItem('rtsModeFirstUse', 'true');
    localStorage.setItem('rtsInfoDismissed', '1');

    window.__mockRTSScoreResult = {
      success: true,
      scores: {
        content: {
          score: 5,
          max: 6,
          rationale: 'Clear goal and context.',
          evidence: ['I need an extension'],
          fixTips: ['Add a specific next step.']
        }
      },
      overall: { total: 5, maxTotal: 6, percent: 83 },
      sampleResponse: {
        full: 'Good morning. I understand the update is due Friday, but I am still waiting for key feedback. Could I send a partial update first and finalize it after Thursday?',
        simplified: 'Good morning. I am waiting for important feedback. Could I send part of the update first and finish it after Thursday?'
      },
      responseAnalysis: {
        register: 'formal',
        communicationGoal: 'request more time',
        strengthPoints: ['Clear request'],
        improvementAreas: ['Add a timeline']
      },
      teacherAdvice: 'Teacher advice should stay in the RTS UI only.'
    };

    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    window.MediaRecorder = class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      constructor(_stream, opts) {
        this.mimeType = opts?.mimeType || 'audio/webm';
        this.state = 'inactive';
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
        this.onstop?.();
      }
    };
    class FakeSpeechRecognition {
      start() {
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: [{
              isFinal: true,
              0: { transcript: 'I need an extension because I am waiting for important feedback from a teammate.' }
            }]
          });
        }, 80);
      }
      stop() {}
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
  });

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.switchToMode && window.RTSMode));

    await page.evaluate(async () => window.switchToMode('rts'));
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-rts');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 5000 });

    // Wait for the v7 picker to load the first question
    await page.waitForFunction(() => {
      const pill = document.querySelector('#rts-v7-question-pill');
      return pill && pill.textContent && pill.textContent.includes('#1');
    }, null, { timeout: 10000 });

    await page.evaluate(() => {
      const messenger = document.querySelector('df-messenger');
      if (messenger) {
        messenger.renderCustomText = (text, showBotAvatar) => {
          window.__rtsRenderedAdvice = { text, showBotAvatar };
        };
      }
      let bubble = document.querySelector('df-messenger-chat-bubble');
      if (!bubble) {
        bubble = document.createElement('df-messenger-chat-bubble');
        document.body.appendChild(bubble);
      }
      bubble.openChat = () => {
        window.__rtsChatOpened = true;
      };
    });

    await page.click('#rts-v7-next-btn');
    await page.waitForFunction(() => document.getElementById('rts-v7-question-pill')?.textContent?.includes('#2'));

    await page.click('#play-rts-btn');
    await page.dispatchEvent('#rts-audio-player', 'ended');
    await page.waitForSelector('#rts-step-record', { state: 'visible', timeout: 12000 });
    const activeNavState = await page.evaluate(() => ({
      prevDisabled: document.getElementById('rts-v7-prev-btn').disabled,
      nextDisabled: document.getElementById('rts-v7-next-btn').disabled,
      pillDisabled: document.getElementById('rts-v7-question-pill').disabled
    }));
    assert.strictEqual(activeNavState.prevDisabled, false, 'Previous question should stay available while RTS is recording');
    assert.strictEqual(activeNavState.nextDisabled, false, 'Next question should stay available while RTS is recording');
    assert.strictEqual(activeNavState.pillDisabled, false, 'Question picker should stay available while RTS is recording');

    await page.click('#rts-v7-question-pill');
    await page.waitForSelector('#rts-v7-sheet.is-open', { timeout: 3000 });
    await page.click('#rts-v7-jump-list .ra-v7-list-item:nth-child(3)');
    await page.waitForFunction(() => {
      const pill = document.getElementById('rts-v7-question-pill');
      const practice = document.getElementById('rts-practice-area');
      return pill?.textContent?.includes('#3') && getComputedStyle(practice).display === 'none';
    });

    await page.click('#play-rts-btn');
    await page.dispatchEvent('#rts-audio-player', 'ended');
    await page.waitForSelector('#rts-step-record', { state: 'visible', timeout: 12000 });
    await page.click('#rts-v7-prev-btn');
    await page.waitForFunction(() => {
      const pill = document.getElementById('rts-v7-question-pill');
      const practice = document.getElementById('rts-practice-area');
      return pill?.textContent?.includes('#2') && getComputedStyle(practice).display === 'none';
    });

    await page.click('#play-rts-btn');
    await page.dispatchEvent('#rts-audio-player', 'ended');
    await page.waitForSelector('#rts-step-record', { state: 'visible', timeout: 12000 });
    await page.waitForTimeout(250);
    await page.click('#rts-stop-btn');
    await page.waitForFunction(() => document.getElementById('rts-transcript')?.textContent?.includes('extension'));

    await page.evaluate(() => {
      document.getElementById('rts-transcript').textContent = 'I need an extension because I am waiting for important feedback from a teammate. I can send a partial update today and finish it on Thursday.';
    });
    await page.click('#rts-ai-score-btn');
    await page.waitForFunction(() => document.getElementById('rts-results-container').innerText.includes('5'));

    const finalState = await page.evaluate(() => ({
      modeVisible: getComputedStyle(document.getElementById('mode-rts')).display !== 'none',
      callableName: window.__lastCallableName,
      payload: window.__lastCallablePayload,
      scoreText: document.getElementById('rts-results-container').innerText,
      chatOpened: Boolean(window.__rtsChatOpened),
      renderedAdvice: window.__rtsRenderedAdvice || null,
      aiScoreVisible: getComputedStyle(document.getElementById('rts-ai-score-btn')).display !== 'none',
      aiScoreDisabled: document.getElementById('rts-ai-score-btn').disabled
    }));

    assert.strictEqual(finalState.modeVisible, true, 'RTS mode should be visible after switchToMode');
    assert.strictEqual(finalState.callableName, 'scoreRTS', 'RTS should call scoreRTS');
    assert.ok(finalState.payload.transcript.includes('partial update'), 'score payload should use the edited transcript');
    assert.ok(finalState.scoreText.includes('Response Analysis'), 'RTS should render response analysis inline');
    assert.ok(finalState.scoreText.includes('Teacher Advice'), 'RTS should render teacher advice inline');
    assert.strictEqual(finalState.chatOpened, false, 'RTS feedback should not open BEL/Dialogflow chat');
    assert.strictEqual(finalState.renderedAdvice, null, 'RTS feedback should not render into BEL/Dialogflow chat');
    assert.strictEqual(finalState.aiScoreVisible, false, 'RTS should hide the scoring button after a successful score');
    assert.deepStrictEqual(pageErrors, [], 'No page errors should occur');

    console.log('RTS mode browser verification complete.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
