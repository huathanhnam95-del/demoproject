/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const CORRUPTION_MARKERS = ['Ã°', 'Ã¢', 'â†', 'âœ', 'ðŸ'];

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
        export const onAuthStateChanged = (auth, cb) => { setTimeout(() => cb(null), 10); return () => {}; };
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
        export const doc = (db, path, ...segments) => ({ _type: 'doc', path: [path, ...segments].filter(Boolean).join('/') });
        export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
        export const getDocs = async () => ({ empty: true, docs: [] });
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
        export const getFunctions = () => ({});
        export const connectFunctionsEmulator = () => {};
        export const httpsCallable = () => async () => ({ data: {} });
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

function containsCorruption(text) {
  return CORRUPTION_MARKERS.some((marker) => text.includes(marker));
}

async function checkMode(page, mode) {
  const expectations = {
    type: { difficulty: true, status: true },
    speak: { difficulty: true, status: true },
    extended: { difficulty: true, status: false },
    sgd: { difficulty: false, status: false },
    rfib: { difficulty: false, status: false },
    rmcsa: { difficulty: false, status: false },
    rmcma: { difficulty: false, status: false },
    rop: { difficulty: true, status: false },
    dd: { difficulty: false, status: false }
  };

  await page.evaluate((targetMode) => window.switchToMode(targetMode), mode);
  await page.waitForTimeout(300);

  const result = await page.evaluate((targetMode) => {
    const modePanel = document.getElementById(`mode-${targetMode}`);
    const difficultyContainer = document.getElementById(`difficulty-filter-container-${targetMode}`);
    const statusContainer = document.getElementById(`status-filter-container-${targetMode}`);

    const isV7 = targetMode === 'rmcsa' || targetMode === 'rmcma' || targetMode === 'rop' || targetMode === 'dd';
    const questionSelect = isV7
      ? document.getElementById(`${targetMode}-v7-question-pill`)
      : (targetMode === 'rfib'
         ? document.getElementById('rfib-question-select')
         : document.getElementById(`question-select-${targetMode}`));
    const backButton = isV7
      ? document.getElementById(`${targetMode}-v7-prev-btn`)
      : (targetMode === 'rfib'
         ? document.getElementById('rfib-back-btn')
         : document.getElementById(`back-btn-${targetMode}`));
    const nextButton = isV7
      ? document.getElementById(`${targetMode}-v7-next-btn`)
      : (targetMode === 'rfib'
         ? document.getElementById('rfib-next-btn')
         : document.getElementById(`next-btn-${targetMode}`));
    const text = modePanel?.innerText || '';

    return {
      hasVisibleMode: Boolean(modePanel && getComputedStyle(modePanel).display !== 'none'),
      hasDifficultyFilter: Boolean(difficultyContainer),
      hasStatusFilter: Boolean(statusContainer),
      hasQuestionSelect: Boolean(questionSelect),
      hasBackButton: Boolean(backButton),
      hasNextButton: Boolean(nextButton),
      text
    };
  }, mode);

  assert.strictEqual(result.hasVisibleMode, true, `${mode} mode should be visible after switchToMode`);
  assert.strictEqual(
    result.hasStatusFilter,
    expectations[mode].status,
    `${mode} mode should match its status-filter contract`
  );
  assert.strictEqual(
    result.hasDifficultyFilter,
    expectations[mode].difficulty,
    `${mode} mode should match its difficulty-filter contract`
  );
  assert.strictEqual(result.hasQuestionSelect, true, `${mode} mode should expose its question selector`);
  assert.strictEqual(result.hasBackButton, true, `${mode} mode should expose its previous button`);
  assert.strictEqual(result.hasNextButton, true, `${mode} mode should expose its next button`);
  assert.strictEqual(containsCorruption(result.text), false, `${mode} mode should not render corrupted text`);
}

async function checkSkillFilter(page, skill, expectedVisibleIds, expectedModeId) {
  await page.evaluate((targetSkill) => {
    const button = document.querySelector(`#practice-skill-filter .practice-skill-btn[data-practice-skill="${targetSkill}"]`);
    if (button) button.click();
  }, skill);

  await page.waitForTimeout(250);

  const result = await page.evaluate((targetSkill) => {
    const skillButton = document.querySelector(`#practice-skill-filter .practice-skill-btn[data-practice-skill="${targetSkill}"]`);
    const visiblePracticeCards = Array.from(document.querySelectorAll('.tutorial-grid [data-practice-skill]'))
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => element.id)
      .filter(Boolean);
    const activeModePanel = Array.from(document.querySelectorAll('.mode-panel'))
      .find((panel) => getComputedStyle(panel).display !== 'none')?.id || '';
    const readingCard = document.getElementById('mode-btn-rfib');
    const writingEmptyState = document.getElementById('practice-writing-empty');
    const modeTutorialBtn = document.getElementById('mode-tutorial-btn');

    return {
      selected: skillButton ? skillButton.getAttribute('aria-pressed') : null,
      visiblePracticeCards,
      activeModePanel,
      readingVisible: readingCard ? getComputedStyle(readingCard).display !== 'none' : false,
      writingVisible: writingEmptyState ? getComputedStyle(writingEmptyState).display !== 'none' : false,
      tutorialVisible: modeTutorialBtn ? getComputedStyle(modeTutorialBtn).display !== 'none' : false
    };
  }, skill);

  assert.strictEqual(result.selected, 'true', `${skill} skill should be selected`);
  assert.deepStrictEqual(
    result.visiblePracticeCards.sort(),
    expectedVisibleIds.slice().sort(),
    `${skill} skill should only show the expected practice cards`
  );
  if (expectedModeId) {
    assert.strictEqual(result.activeModePanel, expectedModeId, `${skill} skill click should not change the active mode panel`);
  }

  return result;
}

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await setupFirebaseMocks(context);
  const page = await context.newPage();
  await page.addInitScript(() => { window.__DISABLE_FIREBASE_EMULATORS__ = true; });
  const pageErrors = [];
  const consoleWarnings = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleWarnings.push(`${message.type()}: ${message.text()}`);
    }
  });

  await page.addInitScript(() => {
    ['type', 'collo-dictate', 'speak', 'extended', 'watch', 'notes', 'pronounce', 'read-aloud', 'sgd', 'swt'].forEach((mode) => {
      localStorage.setItem(`${mode}ModeFirstUse`, 'true');
    });
  });

  try {
    const [scriptSource, htmlSource] = await Promise.all([
      fetch(`${origin}/script.js`).then((res) => res.text()),
      fetch(`${origin}/index.html`).then((res) => res.text())
    ]);

    assert.strictEqual(containsCorruption(scriptSource), false, 'public/script.js should not contain corrupted text markers');
    assert.strictEqual(containsCorruption(htmlSource), false, 'public/index.html should not contain corrupted text markers');

    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Set scope to english to match subsequent assertions
    await page.evaluate(() => {
      window.setPracticeScope('english');
    });
    await page.waitForTimeout(300);

    assert.deepStrictEqual(pageErrors, [], `Expected no page errors, got: ${pageErrors.join(' | ')}`);
    assert.strictEqual(
      consoleWarnings.some((warning) => warning.includes('Difficulty filter elements not found')),
      false,
      `Expected no missing difficulty filter warnings, got: ${consoleWarnings.join(' | ')}`
    );

    const launcherSemantics = await page.evaluate(() => {
      const filterRoot = document.getElementById('practice-skill-filter');
      const readingCard = document.getElementById('mode-btn-rfib');
      const writingEmptyState = document.getElementById('practice-writing-empty');
      const readingPlaceholder = document.getElementById('mode-btn-reading');

      return {
        filterRole: filterRoot ? filterRoot.getAttribute('role') : null,
        selectedSkill: document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]')?.getAttribute('aria-pressed') || null,
        readingCardVisible: readingCard ? getComputedStyle(readingCard).display !== 'none' : false,
        readingPlaceholderExists: Boolean(readingPlaceholder),
        writingVisible: writingEmptyState ? getComputedStyle(writingEmptyState).display !== 'none' : false,
        tutorialButtonVisible: document.getElementById('mode-tutorial-btn') ? getComputedStyle(document.getElementById('mode-tutorial-btn')).display !== 'none' : false
      };
    });

    assert.strictEqual(launcherSemantics.filterRole, 'group', 'practice skill filter should use group semantics');
    assert.strictEqual(launcherSemantics.selectedSkill, 'true', 'Speaking should be selected on first load');
    assert.strictEqual(launcherSemantics.readingCardVisible, false, 'Reading live card should start hidden under Speaking');
    assert.strictEqual(launcherSemantics.readingPlaceholderExists, false, 'Reading placeholder should not exist in the launcher');
    assert.strictEqual(launcherSemantics.writingVisible, false, 'Writing empty state should start hidden');
    assert.strictEqual(launcherSemantics.tutorialButtonVisible, true, 'Tutorial button should be visible for the default Read Aloud mode');

    for (const mode of ['type', 'speak', 'extended', 'sgd', 'rfib', 'rmcsa', 'rmcma', 'rop', 'dd']) {
      // eslint-disable-next-line no-await-in-loop
      await checkMode(page, mode);
    }

    await page.evaluate(async () => {
      await window.switchToMode('extended');
    });
    await page.waitForTimeout(300);

    await checkSkillFilter(page, 'listening', [
      'mode-btn-type',
      'mode-btn-collo-dictate',
      'mode-btn-extended',
      'mode-btn-notes'
    ], 'mode-extended');

    await checkSkillFilter(page, 'speaking', [
      'mode-btn-speak',
      'mode-btn-pronounce',
      'mode-btn-read-aloud'
    ], 'mode-extended');

    const readingState = await checkSkillFilter(page, 'reading', [
      'mode-btn-rfib'
    ], 'mode-extended');
    assert.equal(readingState.readingVisible, true, 'Reading live card should be visible');
    assert.equal(readingState.writingVisible, false, 'Writing empty state should stay hidden in Reading');

    // Switch to PTE scope to verify PTE-only reading modes
    await page.evaluate(() => {
      window.setPracticeScope('pte');
    });
    await page.waitForTimeout(300);

    const pteReadingState = await checkSkillFilter(page, 'reading', [
      'mode-btn-rfib',
      'mode-btn-dd',
      'mode-btn-rmcsa',
      'mode-btn-rmcma',
      'mode-btn-rop'
    ], 'mode-extended');
    assert.equal(pteReadingState.readingVisible, true, 'Reading live card should be visible in PTE scope');

    // Switch back to English scope
    await page.evaluate(() => {
      window.setPracticeScope('english');
    });
    await page.waitForTimeout(300);

    const writingState = await checkSkillFilter(page, 'writing', ['mode-btn-essay'], 'mode-extended');
    assert.equal(writingState.writingVisible, false, 'Writing empty state should stay hidden when Essay is available');

    await page.evaluate(async () => {
      await window.switchToMode('read-aloud');
    });
    await page.waitForTimeout(300);

    const readAloudState = await page.evaluate(() => {
      const speakingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');
      const listeningButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="listening"]');
      const readAloudPanel = document.getElementById('mode-read-aloud');
      const tutorialBtn = document.getElementById('mode-tutorial-btn');
      return {
        speakingSelected: speakingButton ? speakingButton.getAttribute('aria-pressed') : null,
        listeningSelected: listeningButton ? listeningButton.getAttribute('aria-pressed') : null,
        panelVisible: readAloudPanel ? getComputedStyle(readAloudPanel).display !== 'none' && readAloudPanel.classList.contains('active') : false,
        tutorialVisible: tutorialBtn ? getComputedStyle(tutorialBtn).display !== 'none' : false
      };
    });

    assert.equal(readAloudState.speakingSelected, 'true', 'read-aloud mode should sync the skill filter to Speaking');
    assert.equal(readAloudState.panelVisible, true, 'read-aloud mode should activate its panel');
    assert.equal(readAloudState.tutorialVisible, true, 'read-aloud mode should keep the tutorial affordance visible');

    await page.evaluate(async () => {
      await window.switchToMode('type');
    });
    await page.waitForTimeout(300);

    const typeState = await page.evaluate(() => {
      const speakingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');
      const listeningButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="listening"]');
      const typePanel = document.getElementById('mode-type');
      return {
        speakingSelected: speakingButton ? speakingButton.getAttribute('aria-pressed') : null,
        listeningSelected: listeningButton ? listeningButton.getAttribute('aria-pressed') : null,
        panelVisible: typePanel ? getComputedStyle(typePanel).display !== 'none' && typePanel.classList.contains('active') : false
      };
    });

    assert.equal(typeState.speakingSelected, 'false', 'switching back to Type should clear Speaking selection');
    assert.equal(typeState.listeningSelected, 'true', 'switching back to Type should restore Listening selection');
    assert.equal(typeState.panelVisible, true, 'switching back to Type should leave the Type panel active');

    await page.evaluate(async () => {
      await window.switchToMode('rfib');
    });
    await page.waitForTimeout(300);

    const rfibState = await page.evaluate(() => {
      const readingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="reading"]');
      const rfibPanel = document.getElementById('mode-rfib');
      const rfibLauncherCard = document.getElementById('mode-btn-rfib');
      return {
        readingSelected: readingButton ? readingButton.getAttribute('aria-pressed') : null,
        panelVisible: rfibPanel ? getComputedStyle(rfibPanel).display !== 'none' && rfibPanel.classList.contains('active') : false,
        launcherVisible: rfibLauncherCard ? getComputedStyle(rfibLauncherCard).display !== 'none' : false,
        tutorialVisible: document.getElementById('mode-tutorial-btn') ? getComputedStyle(document.getElementById('mode-tutorial-btn')).display !== 'none' : false,
        modeName: document.getElementById('current-mode-name')?.textContent || ''
      };
    });

    assert.equal(rfibState.readingSelected, 'true', 'switchToMode(rfib) should sync the launcher to Reading');
    assert.equal(rfibState.panelVisible, true, 'switchToMode(rfib) should activate the rfib panel');
    assert.equal(rfibState.launcherVisible, true, 'switchToMode(rfib) should show the Reading launcher card');
    assert.equal(rfibState.tutorialVisible, false, 'switchToMode(rfib) should keep the tutorial button hidden');
    assert.equal(rfibState.modeName, 'Fill in the blanks', 'switchToMode(rfib) should update the current mode display');

    await page.screenshot({ path: 'tmp/practice-modes-browser-check.png', fullPage: true });
    console.log('Practice modes browser verification complete.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
