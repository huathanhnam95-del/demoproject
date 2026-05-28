/* eslint-disable no-console */
const { chromium } = require('playwright');
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');

(async () => {
  console.log('Starting Write Essay Feedback and AI Scoring Browser Check...');

  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`Essay harness running at ${origin}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    console.log(`[BROWSER CONSOLE] ${message.type()}: ${message.text()}`);
  });

  // 1. Mock Firebase Modules
  await page.route('**/firebase-config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const db = {};
      export const auth = { 
        get currentUser() { return window.mockUser; },
        onAuthStateChanged: (cb) => { cb(window.mockUser); return () => {}; }
      };
      export const storage = {};
      export const functions = {};
    `
  }));

  await page.route('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const getFunctions = () => ({});
      export const httpsCallable = (functions, name) => {
        return async () => {
          console.log('[MOCK] httpsCallable called for:', name);
          if (name === 'scoreEssay') return { data: window.mockScoreEssayResult };
          return { data: { success: true } };
        };
      };
    `
  }));

  // 2. Initialize Page State & Stubs
  await page.addInitScript(() => {
    window.mockUser = null;
    window.mockScoreEssayResult = {
      success: true,
      overall: { total: 12, maxTotal: 26, percent: 46 },
      scores: {
        content: { score: 4, rationale: 'Good coverage.' },
        form: { score: 2, rationale: 'Perfect length.' },
        development_structure_coherence: { score: 3, rationale: 'Logical flow.' },
        grammar: { score: 1, rationale: 'Some errors.' },
        general_linguistic_range: { score: 1, rationale: 'Limited.' },
        vocabulary_range: { score: 1, rationale: 'Basic.' },
        spelling: { score: 0, rationale: 'Many typos.' }
      },
      teacherAdviceChat: 'Focus on your vocabulary and spelling to improve your score.'
    };

    window.showLoginForm = () => {
      window.loginFormShown = true;
    };

    localStorage.setItem('essayInfoDismissed', '1');
    localStorage.setItem('essayModeFirstUse', 'true');

    // Add df-messenger mock
    const df = document.createElement('df-messenger');
    df.renderCustomText = (text) => { window.lastAdvice = text; };
    document.body.appendChild(df);
    
    const chatBubble = document.createElement('df-messenger-chat-bubble');
    chatBubble.openChat = () => { window.chatOpened = true; };
    document.body.appendChild(chatBubble);

    // Global firebase mock for non-module code
    window.firebase = {
      auth: () => ({
        get currentUser() { return window.mockUser; },
        onAuthStateChanged: (cb) => { cb(window.mockUser); return () => {}; }
      }),
      functions: () => ({
        httpsCallable: (name) => async () => ({ data: window.mockScoreEssayResult })
      })
    };
  });

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Dismiss blocking overlays (entry-modal, preloader)
    await page.evaluate(() => {
      const preloader = document.querySelector('.app-preloader');
      if (preloader) preloader.style.display = 'none';
      const entryModal = document.getElementById('entry-modal');
      if (entryModal) entryModal.remove();
      document.querySelectorAll('.tutorial-overlay, .cookie-banner').forEach(el => el.remove());
    });

    // 1. Enter Write Essay mode
    await page.evaluate(async () => {
      if (window.switchToMode) {
          await window.switchToMode('essay');
      }
      window.WriteEssayMode?.loadEntries?.();
    });
    // Wait for mode panel to become active
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-essay');
      return panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 10000 });

    // 2. Select a prompt and start - wait for entries to load first
    await page.waitForFunction(() => {
      const select = document.getElementById('question-select-essay');
      return select && select.options.length > 0 && select.options[0].value !== '';
    }, { timeout: 10000 });

    await page.evaluate(() => {
      const select = document.getElementById('question-select-essay');
      if (select) {
          select.value = '0';
          select.dispatchEvent(new Event('change'));
      }
    });
    await page.evaluate(() => {
        const startBtn = document.getElementById('start-essay-btn');
        if (startBtn) startBtn.click();
    });
    // Wait for the essay practice area to become visible
    await page.waitForFunction(() => {
      const area = document.getElementById('essay-practice-area');
      return area && getComputedStyle(area).display !== 'none';
    }, { timeout: 10000 });

    // 3. Type and Submit as Guest
    const essayText = 'This is a test essay about the impact of technology on society. It has several sentences to meet the minimum length requirement for basic feedback.';
    // Use evaluate to set the value directly (bypasses visibility issues)
    await page.evaluate((text) => {
      const textarea = document.getElementById('essay-input');
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, essayText);
    
    // Use evaluate to bypass any overlays
    await page.evaluate(() => {
        const submitBtn = document.getElementById('essay-submit-btn');
        if (submitBtn) submitBtn.click();
    });

    console.log('Waiting for feedback section...');
    // Wait for the results step to become visible (essay-step-results shows after submit)
    await page.waitForFunction(() => {
      const results = document.getElementById('essay-step-results');
      return results && getComputedStyle(results).display !== 'none';
    }, { timeout: 30000 });
    
    const feedbackVisible = await page.evaluate(() => {
      const sections = document.querySelector('.essay-feedback-sections');
      return sections !== null;
    });
    assert.strictEqual(feedbackVisible, true, 'Feedback section should be visible after submission');

    // Check that AI score is disabled for guest
    const aiBtnDisabled = await page.$eval('#essay-ai-score-btn', btn => btn.disabled);
    assert.strictEqual(aiBtnDisabled, true, 'AI scoring button should be disabled for guests');

    // Click AI Scoring as guest -> should show login hint
    await page.evaluate(() => {
        const aiBtn = document.getElementById('essay-ai-score-btn');
        if (aiBtn) aiBtn.click();
    });
    // Guest click on disabled button should not trigger anything; check hint is shown
    const hintVisible = await page.evaluate(() => {
      const hint = document.getElementById('essay-ai-score-hint');
      return hint && hint.style.display !== 'none' && hint.innerHTML.includes('login');
    });
    assert.strictEqual(hintVisible, true, 'AI scoring hint should show login prompt for guests');

    // 4. Submit as Authenticated User
    // Mock login and re-render
    await page.evaluate(() => {
      window.mockUser = { uid: 'test-admin' };
      sessionStorage.setItem('guestMode', 'false');
      
      // Ensure the mock is where the app looks
      if (!window.__FIREBASE_INTERNAL__) window.__FIREBASE_INTERNAL__ = {};
      if (!window.__FIREBASE_INTERNAL__.auth) window.__FIREBASE_INTERNAL__.auth = {};
      window.__FIREBASE_INTERNAL__.functions = {};
      Object.defineProperty(window.__FIREBASE_INTERNAL__.auth, 'currentUser', {
          get: () => window.mockUser,
          configurable: true
      });

      if (window.WriteEssayMode && window.WriteEssayMode.updateAiScoreButtonState) {
          window.WriteEssayMode.updateAiScoreButtonState();
      }
    });

    const aiBtnEnabled = await page.$eval('#essay-ai-score-btn', btn => !btn.disabled);
    assert.strictEqual(aiBtnEnabled, true, 'AI scoring button should be enabled for logged-in users');

    await page.evaluate(() => {
      window.__essayRenderedAdvice = [];
      window.__essayChatOpened = false;
      const messenger = document.querySelector('df-messenger');
      if (messenger) {
        messenger.renderCustomText = (text, showBotAvatar) => {
          window.__essayRenderedAdvice.push({ text, showBotAvatar });
        };
      }
      const bubble = document.querySelector('df-messenger-chat-bubble');
      if (bubble) {
        bubble.openChat = () => { window.__essayChatOpened = true; };
      }
    });
    await page.evaluate(() => {
      const aiBtn = document.getElementById('essay-ai-score-btn');
      if (aiBtn) aiBtn.click();
    });
    await page.waitForFunction(() => {
      const results = document.getElementById('essay-results-container');
      return results
        && results.innerText.includes('12')
        && results.innerText.includes('Content')
        && Array.isArray(window.__essayRenderedAdvice)
        && window.__essayRenderedAdvice.some((item) => item.text.includes('Focus on your vocabulary and spelling'));
    }, { timeout: 30000 });

    // Verify AI score display
    const hasScoreRows = await page.evaluate(() => {
      const rows = document.querySelectorAll('.essay-score-row');
      return rows.length > 0;
    });
    assert.ok(hasScoreRows, 'AI Score rows should be displayed');

    const totalScore = await page.evaluate(() => {
      const el = document.querySelector('.essay-score-number');
      return el ? el.textContent : '';
    });
    assert.strictEqual(totalScore, '12', 'Total score should display 12');

    const scoreRowCount = await page.evaluate(() => {
      return document.querySelectorAll('.essay-score-row').length;
    });
    assert.strictEqual(scoreRowCount, 7, 'Should display 7 score categories');

    // 5. Test BEL Assistant Integration
    // Verify that the df-messenger element exists (required for teacher advice)
    const hasDfMessenger = await page.evaluate(() => {
      return document.querySelector('df-messenger') !== null;
    });
    assert.strictEqual(hasDfMessenger, true, 'df-messenger element should exist for teacher advice integration');

    const adviceTest = await page.evaluate(() => {
      try {
        const bubble = document.querySelector('df-messenger-chat-bubble');
        return {
          hasBubble: bubble !== null,
          chatOpened: Boolean(window.__essayChatOpened),
          renderedAdvice: window.__essayRenderedAdvice || [],
          error: null
        };
      } catch (e) {
        return { hasBubble: false, chatOpened: false, renderedAdvice: [], error: e.message };
      }
    });
    assert.strictEqual(adviceTest.hasBubble, true, 'df-messenger chat bubble should exist for advice routing');
    assert.strictEqual(adviceTest.chatOpened, true, 'BEL chat should open when Write Essay teacher advice is sent');
    assert.ok(
      adviceTest.renderedAdvice.some((item) => item.text.includes('Focus on your vocabulary and spelling')),
      'BEL chat should receive Write Essay teacher advice'
    );

    console.log('✅ Write Essay Feedback and AI Scoring Check PASSED');
  } catch (err) {
    console.error('❌ Test FAILED:', err);
    process.exit(1);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})();
