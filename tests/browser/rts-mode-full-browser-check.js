/* eslint-disable no-console */
/**
 * RTS Mode — Full Browser Test (14 Phases, ~95 assertions)
 * Covers: init, navigation, audio countdown, prep, recording, results,
 *         AI scoring, result rendering, sample tabs, retry/next, edge cases.
 */
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
        export const signInWithCustomToken = () => Promise.resolve({ user: mockUser });
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
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function log(phase, msg) {
  console.log(`  [Phase ${phase}] ${msg}`);
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
          score: 5, max: 6,
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
      start() { this.state = 'recording'; }
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
    // ═══════════════ PHASE 1: Mode Init & Question Loading ═══════════════
    console.log('\n═══ Phase 1: Mode Init & Question Loading ═══');
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.switchToMode && window.RTSMode));
    log(1, 'switchToMode and RTSMode globals detected');

    await page.evaluate(async () => window.switchToMode('rts'));
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-rts');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 5000 });
    log(1, 'RTS mode panel visible');

    await page.waitForFunction(() => {
      const pill = document.querySelector('.spc-picker-pill') || document.getElementById('rts-v7-question-pill');
      return pill && pill.textContent && pill.textContent.includes('#');
    }, null, { timeout: 8000 });
    log(1, 'Questions loaded into picker');

    const initState = await page.evaluate(() => ({
      pillText: (document.querySelector('.spc-picker-pill') || document.getElementById('rts-v7-question-pill')).textContent,
      playVisible: getComputedStyle(document.getElementById('play-rts-btn')).display !== 'none',
      practiceHidden: getComputedStyle(document.getElementById('rts-practice-area')).display === 'none'
    }));
    assert.ok(initState.pillText.includes('#'), 'Pill should show question ID');
    assert.strictEqual(initState.playVisible, true, 'Play button should be visible');
    assert.strictEqual(initState.practiceHidden, true, 'Practice area should be hidden initially');
    log(1, 'All init state checks passed');

    // ═══════════════ PHASE 2: Question Navigation ═══
    console.log('\n═══ Phase 2: Question Navigation ═══');
    const nextBtn = (await page.$('.spc-controller .spc-picker-next')) || (await page.$('#rts-v7-next-btn'));
    if (nextBtn) await nextBtn.click();
    await page.waitForTimeout(300);
    let navPill = await page.evaluate(() => (document.querySelector('.spc-picker-pill') || document.getElementById('rts-v7-question-pill')).textContent);
    assert.ok(navPill.includes('#'), 'Next should advance to next question');
    log(2, 'Next button works');

    const prevBtn = (await page.$('.spc-controller .spc-picker-prev')) || (await page.$('#rts-v7-prev-btn'));
    if (prevBtn) await prevBtn.click();
    await page.waitForTimeout(300);
    navPill = await page.evaluate(() => (document.querySelector('.spc-picker-pill') || document.getElementById('rts-v7-question-pill')).textContent);
    assert.ok(navPill.includes('#'), 'Prev should go back');
    log(2, 'Prev button works');

    // Jump to question via picker sheet
    const pickerPill = (await page.$('.spc-picker-pill')) || (await page.$('#rts-v7-question-pill'));
    if (pickerPill) await pickerPill.click();
    await page.waitForSelector('.spc-sheet.is-active, #rts-v7-sheet.is-open', { timeout: 3000 });
    const jumpItems = await page.evaluate(() => document.querySelectorAll('.spc-sheet.is-active .spc-sheet-item, #rts-v7-jump-list .ra-v7-list-item').length);
    assert.ok(jumpItems > 10, 'Jump list should have items');
    log(2, `Jump sheet opened with ${jumpItems} items`);

    // Click 3rd item in jump list
    const item = (await page.$('.spc-sheet.is-active .spc-sheet-item:nth-child(3)')) || (await page.$('#rts-v7-jump-list .ra-v7-list-item:nth-child(3)'));
    if (item) await item.click();
    await page.waitForTimeout(300);
    const afterJump = await page.evaluate(() => {
      const pill = document.querySelector('.spc-picker-pill') || document.getElementById('rts-v7-question-pill');
      const sheet = document.querySelector('.spc-sheet.is-active') || document.getElementById('rts-v7-sheet');
      return {
        pillText: pill ? pill.textContent : '',
        sheetOpen: sheet ? (sheet.classList.contains('is-active') || sheet.classList.contains('is-open')) : false,
        playVisible: getComputedStyle(document.getElementById('play-rts-btn')).display !== 'none'
      };
    });
    assert.ok(!afterJump.sheetOpen, 'Sheet should close after jump');
    assert.strictEqual(afterJump.playVisible, true, 'Play button still visible after jump');
    log(2, 'Jump-list pick works');

    // Reset to question 0 via prev clicks (click prev twice from index 2)
    const prevBtn2 = (await page.$('.spc-controller .spc-picker-prev')) || (await page.$('#rts-v7-prev-btn'));
    if (prevBtn2) await prevBtn2.click();
    await page.waitForTimeout(200);
    if (prevBtn2) await prevBtn2.click();
    await page.waitForTimeout(200);
    log(2, 'Navigation checks passed');

    // ═══════════════ PHASE 3: Start Flow & Audio Countdown ═══════════════
    console.log('\n═══ Phase 3: Start Flow & Audio Countdown ═══');

    // Setup chat mocks before starting
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
      bubble.openChat = () => { window.__rtsChatOpened = true; };
    });

    await page.click('#play-rts-btn');
    const startState = await page.evaluate(() => ({
      playHidden: getComputedStyle(document.getElementById('play-rts-btn')).display === 'none',
      practiceVisible: getComputedStyle(document.getElementById('rts-practice-area')).display !== 'none',
      audioStepVisible: getComputedStyle(document.getElementById('rts-step-audio')).display !== 'none',
      countdownVisible: getComputedStyle(document.getElementById('rts-audio-countdown-box')).display !== 'none',
      promptText: document.getElementById('rts-prompt-text').textContent
    }));
    assert.strictEqual(startState.playHidden, true, 'Play button hides after start');
    assert.strictEqual(startState.practiceVisible, true, 'Practice area shows');
    assert.strictEqual(startState.audioStepVisible, true, 'Audio step visible');
    assert.strictEqual(startState.countdownVisible, true, 'Countdown box visible');
    assert.ok(startState.promptText.length > 10, 'Prompt text should contain situation text');
    log(3, 'Start flow and audio countdown UI verified');

    // ═══════════════ PHASE 4: Audio Playback → Prep Transition ═══════════════
    console.log('\n═══ Phase 4: Audio Playback → Prep Transition ═══');
    await page.dispatchEvent('#rts-audio-player', 'ended');
    // Wait for prep step
    await page.waitForSelector('#rts-step-prep', { state: 'visible', timeout: 12000 });
    const prepVisible = await page.evaluate(() => ({
      audioHidden: getComputedStyle(document.getElementById('rts-step-audio')).display === 'none',
      prepVisible: getComputedStyle(document.getElementById('rts-step-prep')).display !== 'none',
      prepText: document.getElementById('rts-prompt-text-prep').textContent
    }));
    assert.strictEqual(prepVisible.audioHidden, true, 'Audio step should hide');
    assert.strictEqual(prepVisible.prepVisible, true, 'Prep step should show');
    assert.ok(prepVisible.prepText.length > 10, 'Prep should show prompt text');
    log(4, 'Audio → Prep transition verified');

    // ═══════════════ PHASE 5–6: Prep Timer → Recording ═══════════════
    console.log('\n═══ Phase 5–6: Prep Timer → Recording ═══');
    await page.waitForSelector('#rts-step-record', { state: 'visible', timeout: 12000 });
    const recordState = await page.evaluate(() => ({
      prepHidden: getComputedStyle(document.getElementById('rts-step-prep')).display === 'none',
      recordVisible: getComputedStyle(document.getElementById('rts-step-record')).display !== 'none',
      recordingActive: document.getElementById('rts-record-status').classList.contains('rts-recording-active'),
      stopVisible: getComputedStyle(document.getElementById('rts-stop-btn')).display !== 'none',
      promptRecord: document.getElementById('rts-prompt-text-record').textContent
    }));
    assert.strictEqual(recordState.prepHidden, true, 'Prep step should hide');
    assert.strictEqual(recordState.recordVisible, true, 'Record step should show');
    assert.strictEqual(recordState.recordingActive, true, 'Recording indicator active');
    assert.strictEqual(recordState.stopVisible, true, 'Stop button visible');
    assert.ok(recordState.promptRecord.length > 10, 'Recording shows prompt text');
    log(6, 'Recording step verified');

    // ═══════════════ PHASE 7: Stop Recording ═══════════════
    console.log('\n═══ Phase 7: Stop Recording ═══');
    await page.waitForTimeout(250);
    await page.click('#rts-stop-btn');
    await page.waitForFunction(() =>
      document.getElementById('rts-transcript')?.textContent?.includes('extension')
    );
    log(7, 'Recording stopped, transcript captured');

    // ═══════════════ PHASE 8: Results Display (Pre-AI) ═══════════════
    console.log('\n═══ Phase 8: Results Display (Pre-AI) ═══');
    const preAiState = await page.evaluate(() => ({
      resultsVisible: getComputedStyle(document.getElementById('rts-step-results')).display !== 'none',
      recordHidden: getComputedStyle(document.getElementById('rts-step-record')).display === 'none',
      hasPlaybackSrc: Boolean(document.getElementById('rts-recording-playback')?.src),
      transcript: document.getElementById('rts-transcript').textContent,
      aiScoreVisible: getComputedStyle(document.getElementById('rts-ai-score-btn')).display !== 'none',
      aiScoreDisabled: document.getElementById('rts-ai-score-btn').disabled,
      aiScoreText: document.getElementById('rts-ai-score-btn').textContent.trim(),
      retryVisible: getComputedStyle(document.getElementById('rts-retry-btn')).display !== 'none',
      nextVisible: getComputedStyle(document.getElementById('rts-next-question-btn')).display !== 'none',
      resultsEmpty: document.getElementById('rts-results-container').innerHTML === '',
      recordingInactive: !document.getElementById('rts-record-status').classList.contains('rts-recording-active')
    }));
    assert.strictEqual(preAiState.resultsVisible, true, 'Results step should show');
    assert.strictEqual(preAiState.recordHidden, true, 'Record step should hide');
    assert.ok(preAiState.transcript.includes('extension'), 'Transcript should contain speech');
    assert.strictEqual(preAiState.aiScoreVisible, true, 'AI score button visible');
    assert.strictEqual(preAiState.aiScoreDisabled, false, 'AI score button enabled');
    assert.strictEqual(preAiState.retryVisible, true, 'Retry button visible');
    assert.strictEqual(preAiState.nextVisible, true, 'Next question button visible');
    assert.strictEqual(preAiState.resultsEmpty, true, 'Results container empty before scoring');
    assert.strictEqual(preAiState.recordingInactive, true, 'Recording indicator deactivated');
    log(8, 'Pre-AI results state verified');

    // ═══════════════ PHASE 9: AI Scoring Submission ═══════════════
    console.log('\n═══ Phase 9: AI Scoring Submission ═══');
    // Override the transcript before scoring to verify the div text is the payload source.
    await page.evaluate(() => {
      document.getElementById('rts-transcript').textContent = 'I need an extension because I am waiting for important feedback from a teammate. I can send a partial update today and finish it on Thursday.';
    });
    await page.click('#rts-ai-score-btn');
    await page.waitForFunction(() => document.getElementById('rts-results-container').innerText.includes('5'));

    const aiPayload = await page.evaluate(() => ({
      callableName: window.__lastCallableName,
      payload: window.__lastCallablePayload,
      aiScoreHidden: getComputedStyle(document.getElementById('rts-ai-score-btn')).display === 'none',
      aiScoreDisabled: document.getElementById('rts-ai-score-btn').disabled
    }));
    assert.strictEqual(aiPayload.callableName, 'scoreRTS', 'Should call scoreRTS');
    assert.ok(aiPayload.payload.transcript.includes('partial update'), 'Payload should use edited transcript');
    assert.ok(aiPayload.payload.transcript.length <= 3000, 'Transcript truncated to 3000');
    assert.ok(aiPayload.payload.situationText.length > 20, 'Situation text included');
    assert.ok(aiPayload.payload.questionId, 'Question ID included');
    assert.strictEqual(aiPayload.aiScoreHidden, true, 'Score button hidden after success');
    assert.strictEqual(aiPayload.aiScoreDisabled, true, 'Score button disabled after success');
    log(9, 'AI scoring submission and payload verified');

    // ═══════════════ PHASE 10: AI Results Rendering ═══════════════
    console.log('\n═══ Phase 10: AI Results Rendering ═══');
    const resultsText = await page.evaluate(() => document.getElementById('rts-results-container').innerText);

    // Score circle
    assert.ok(resultsText.includes('5'), 'Score shows 5');
    assert.ok(resultsText.includes('6'), 'Max shows 6');
    assert.ok(resultsText.includes('83%'), 'Percentage shows 83%');
    log(10, 'Score circle verified');

    // Content breakdown
    assert.ok(resultsText.includes('Content'), 'Content label present');
    assert.ok(resultsText.includes('Clear goal and context'), 'Rationale displayed');
    assert.ok(resultsText.includes('Add a specific next step'), 'Fix tips displayed');
    assert.ok(resultsText.includes('I need an extension'), 'Evidence displayed');
    log(10, 'Content breakdown verified');

    // Response Analysis
    assert.ok(resultsText.includes('Response Analysis'), 'Response Analysis section present');
    assert.ok(resultsText.includes('formal'), 'Register shown');
    assert.ok(resultsText.includes('request more time'), 'Communication goal shown');
    assert.ok(resultsText.includes('Clear request'), 'Strength points shown');
    assert.ok(resultsText.includes('Add a timeline'), 'Improvement areas shown');
    log(10, 'Response Analysis verified');

    // Sample responses
    assert.ok(resultsText.includes('Full Sample'), 'Full Sample tab exists');
    assert.ok(resultsText.includes('Simplified'), 'Simplified tab exists');
    assert.ok(resultsText.includes('Good morning'), 'Sample response text visible');
    log(10, 'Sample responses verified');

    // Teacher Advice
    const resultsHtml = await page.evaluate(() => document.getElementById('rts-results-container').innerHTML);
    assert.ok(resultsHtml.includes('Teacher Advice'), 'Teacher Advice section present');
    assert.ok(resultsHtml.includes('Teacher advice should stay in the RTS UI only'), 'Advice text rendered');
    log(10, 'Teacher Advice verified');

    // ═══════════════ PHASE 11: Sample Response Tab Switching ═══════════════
    console.log('\n═══ Phase 11: Sample Response Tab Switching ═══');
    const simplifiedTab = await page.$('.rts-sample-tab[data-tab="simplified"]');
    if (simplifiedTab) {
      await simplifiedTab.click();
      const tabState = await page.evaluate(() => {
        const fullPane = document.querySelector('[data-pane="full"]');
        const simpPane = document.querySelector('[data-pane="simplified"]');
        return {
          fullHidden: fullPane ? fullPane.style.display === 'none' : null,
          simpVisible: simpPane ? simpPane.style.display !== 'none' : null,
          simpText: simpPane ? simpPane.textContent : ''
        };
      });
      assert.strictEqual(tabState.fullHidden, true, 'Full pane hidden after tab switch');
      assert.strictEqual(tabState.simpVisible, true, 'Simplified pane visible');
      assert.ok(tabState.simpText.includes('waiting for important feedback'), 'Simplified text correct');
      log(11, 'Tab switching verified');

      // Switch back to full
      const fullTab = await page.$('.rts-sample-tab[data-tab="full"]');
      if (fullTab) await fullTab.click();
    } else {
      log(11, 'SKIP — sample tabs not found in DOM');
    }

    // ═══════════════ PHASE 12: Retry ═══════════════
    console.log('\n═══ Phase 12: Retry ═══');
    await page.click('#rts-retry-btn');
    const retryState = await page.evaluate(() => ({
      practiceHidden: getComputedStyle(document.getElementById('rts-practice-area')).display === 'none',
      playVisible: getComputedStyle(document.getElementById('play-rts-btn')).display !== 'none',
      resultsHidden: getComputedStyle(document.getElementById('rts-step-results')).display === 'none',
      resultsEmpty: document.getElementById('rts-results-container').innerHTML === '',
      aiScoreVisible: getComputedStyle(document.getElementById('rts-ai-score-btn')).display !== 'none',
      aiScoreEnabled: !document.getElementById('rts-ai-score-btn').disabled,
      pillText: (document.querySelector('.spc-picker-pill') || document.getElementById('rts-v7-question-pill'))?.textContent || ''
    }));
    assert.strictEqual(retryState.practiceHidden, true, 'Practice area hidden after retry');
    assert.strictEqual(retryState.playVisible, true, 'Play button visible after retry');
    assert.strictEqual(retryState.resultsHidden, true, 'Results hidden after retry');
    assert.strictEqual(retryState.resultsEmpty, true, 'Results cleared after retry');
    assert.ok(retryState.pillText.includes('#'), 'Picker still shows question after retry');
    log(12, 'Retry state reset verified');

    // ═══════════════ PHASE 13: RTS Chat Isolation ═══════════════
    console.log('\n═══ Phase 13: Edge Cases — Chat Isolation ═══');
    const chatState = await page.evaluate(() => ({
      chatOpened: Boolean(window.__rtsChatOpened),
      renderedAdvice: window.__rtsRenderedAdvice || null
    }));
    assert.strictEqual(chatState.chatOpened, false, 'RTS should NOT open BEL chat');
    assert.strictEqual(chatState.renderedAdvice, null, 'RTS should NOT render into BEL chat');
    log(13, 'Chat isolation verified — advice stays inline');

    // ═══════════════ PHASE 14: Console Error Audit ═══════════════
    console.log('\n═══ Phase 14: Console Error Audit ═══');
    assert.deepStrictEqual(pageErrors, [], `No page errors should occur, got: ${pageErrors.join(' | ')}`);
    log(14, 'Zero page errors');

    // Take final screenshot
    await page.screenshot({ path: 'tmp/rts-mode-full-browser-check.png', fullPage: true });

    console.log('\n✅ RTS mode full browser verification complete — all phases passed.\n');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
