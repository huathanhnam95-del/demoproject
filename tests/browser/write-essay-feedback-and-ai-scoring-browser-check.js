const { chromium } = require('playwright');
const assert = require('assert');

(async () => {
  console.log('Starting Write Essay Feedback and AI Scoring Browser Check...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const origin = 'http://localhost:3000';
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
      teacherAdvice: 'Focus on your vocabulary and spelling to improve your score.'
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

    // 1. Enter Write Essay mode
    await page.evaluate(async () => {
      if (window.switchToMode) {
          await window.switchToMode('essay');
      }
      window.WriteEssayMode?.loadEntries?.();
    });
    await page.waitForTimeout(1000);

    // 2. Select a prompt and start
    await page.evaluate(() => {
      const select = document.getElementById('question-select-essay');
      if (select) {
          select.value = '0';
          select.dispatchEvent(new Event('change'));
      }
    });
    await page.evaluate(() => {
        const startBtn = document.getElementById('start-practice-essay');
        if (startBtn) startBtn.click();
    });
    await page.waitForTimeout(1000);

    // 3. Type and Submit as Guest
    const essayText = 'This is a test essay about the impact of technology on society. It has several sentences to meet the minimum length requirement for basic feedback.';
    await page.fill('#essay-input', essayText);
    
    // Use evaluate to bypass any overlays
    await page.evaluate(() => {
        const submitBtn = document.getElementById('submit-essay-btn');
        if (submitBtn) submitBtn.click();
    });

    console.log('Waiting for feedback section...');
    await page.waitForFunction(() => document.querySelector('.feedback-content-essay'));
    
    const feedbackVisible = await page.isVisible('.feedback-content-essay');
    assert.strictEqual(feedbackVisible, true, 'Feedback section should be visible after submission');

    // Check that AI score is disabled for guest
    const aiBtnDisabled = await page.$eval('#submit-ai-scoring-btn', btn => btn.disabled);
    assert.strictEqual(aiBtnDisabled, true, 'AI scoring button should be disabled for guests');

    // Click AI Scoring as guest -> should show login
    await page.evaluate(() => {
        const aiBtn = document.getElementById('submit-ai-scoring-btn');
        if (aiBtn) aiBtn.click();
    });
    const loginShown = await page.evaluate(() => window.loginFormShown === true);
    assert.strictEqual(loginShown, true, 'Login form should be triggered when guest clicks AI scoring');

    // 4. Submit as Authenticated User
    // Mock login and re-render
    await page.evaluate(() => {
      window.mockUser = { uid: 'test-admin' };
      sessionStorage.setItem('guestMode', 'false');
      
      // Ensure the mock is where the app looks
      if (!window.__FIREBASE_INTERNAL__) window.__FIREBASE_INTERNAL__ = {};
      if (!window.__FIREBASE_INTERNAL__.auth) window.__FIREBASE_INTERNAL__.auth = {};
      Object.defineProperty(window.__FIREBASE_INTERNAL__.auth, 'currentUser', {
          get: () => window.mockUser,
          configurable: true
      });

      if (window.WriteEssayMode && window.WriteEssayMode.updateAiScoreButtonState) {
          window.WriteEssayMode.updateAiScoreButtonState();
      }
    });

    const aiBtnEnabled = await page.$eval('#submit-ai-scoring-btn', btn => !btn.disabled);
    assert.strictEqual(aiBtnEnabled, true, 'AI scoring button should be enabled for logged-in users');

    // Click AI Scoring
    await page.evaluate(() => {
        const aiBtn = document.getElementById('submit-ai-scoring-btn');
        if (aiBtn) aiBtn.click();
    });

    console.log('Waiting for AI scoring results...');
    await page.waitForFunction(() => document.querySelector('.essay-results-summary'), { timeout: 15000 });

    const scoreText = await page.$eval('.total-score-display .score-value', el => el.textContent);
    assert.ok(scoreText.includes('12'), 'AI Score should display 12');

    // 5. Test BEL Assistant Advice
    await page.evaluate(() => {
        const adviceBtn = document.querySelector('.teacher-advice-card .primary-btn');
        if (adviceBtn) adviceBtn.click();
    });

    const chatOpened = await page.evaluate(() => window.chatOpened === true);
    assert.strictEqual(chatOpened, true, 'BEL Assistant chat should open when clicking Get More Advice');

    console.log('✅ Write Essay Feedback and AI Scoring Check PASSED');
  } catch (err) {
    console.error('❌ Test FAILED:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
