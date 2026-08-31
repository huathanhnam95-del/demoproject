/* eslint-disable no-console */
/**
 * Track Progress modal - browser contract check.
 *
 * Covers the V1.8.83 redesign:
 *   - three tabs (Vocabulary / Question Mastery / PTE Attempts) all switch
 *   - Vocabulary tab renders live SRS data via readPracticeState()
 *   - the mastery sparkline appears at >=2 mastered words and hides below that
 *   - the Type/Speak toggle drives the Question Mastery tab
 *   - the removed donut chart leaves no trace
 *   - Escape / backdrop close and restore body scroll
 *
 * Follows the same express-static + Playwright + Firebase-mock harness as the
 * other tests/browser/*.js checks so it needs no emulator stack.
 */
const assert = require('assert');
const net = require('net');
const path = require('path');
const { chromium } = require('playwright');

let consoleLines = [];

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (typeof port === 'number') resolve(port);
        else reject(new Error('Failed to allocate free port'));
      });
    });
    server.on('error', reject);
  });
}

async function setupFirebaseMocks(context) {
  await context.route('**/firebase-app.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const initializeApp = () => ({ name: '[DEFAULT]' });
      export const getApp = () => ({ name: '[DEFAULT]' });
    `
  }));

  await context.route('**/firebase-auth.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const getAuth = () => ({ currentUser: null });
      export const connectAuthEmulator = () => {};
      export const onAuthStateChanged = (_auth, cb) => { setTimeout(() => cb(null), 10); return () => {}; };
      export const setPersistence = () => Promise.resolve();
      export const browserLocalPersistence = 'local';
      export const signInWithEmailAndPassword = () => Promise.resolve({ user: {} });
      export const signOut = () => Promise.resolve();
      export const createUserWithEmailAndPassword = () => Promise.resolve({ user: {} });
      export const sendPasswordResetEmail = () => Promise.resolve();
      export const sendEmailVerification = () => Promise.resolve();
      export const signInWithCustomToken = () => Promise.resolve({ user: {} });
      export const signInWithPopup = () => Promise.resolve({ user: {} });
      export const signInAnonymously = () => Promise.resolve({ user: {} });
      export const GoogleAuthProvider = class { static credential() { return {}; } };
      export const updateProfile = () => Promise.resolve();
      export const reload = () => Promise.resolve();
      export const getIdToken = () => Promise.resolve('mock-token');
      export const onIdTokenChanged = (_auth, cb) => { setTimeout(() => cb(null), 10); return () => {}; };
    `
  }));

  await context.route('**/firebase-firestore.js', (route) => route.fulfill({
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
      export const runTransaction = async (_db, cb) => cb({ get: async () => ({ exists: () => false }), set: () => {}, update: () => {} });
      export const setLogLevel = () => {};
      export const onSnapshot = () => () => {};
      export const startAfter = () => ({});
      export const endBefore = () => ({});
      export const documentId = () => '__name__';
      export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) });
      export const enableIndexedDbPersistence = async () => {};
      export const initializeFirestore = () => ({ _type: 'firestore' });
      export const deleteField = () => ({});
      export const FieldValue = { serverTimestamp: () => new Date() };
    `
  }));

  await context.route('**/firebase-functions.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const getFunctions = () => ({});
      export const connectFunctionsEmulator = () => {};
      export const httpsCallable = () => async () => ({ data: {} });
    `
  }));
}

/** Build a guest SRS blob with a known tier spread and mastery timeline. */
function buildGuestSrsBlob({ masteredCount }) {
  const now = Date.now();
  const day = 86400000;
  const srsData = {};

  // 3 due now (reviewing, past due)
  for (let i = 0; i < 3; i += 1) {
    srsData[`duewordilingua${i}`] = {
      algorithm: 'SM2', interval: 6, repetitions: 3, easeFactor: 2.5, stepIndex: 0,
      state: 'reviewing', nextReviewDate: new Date(now - day).toISOString(),
      lastReviewDate: new Date(now - 7 * day).toISOString(),
      originalWord: `dueword${i}`, entryType: 'word'
    };
  }
  // 2 learning
  for (let i = 0; i < 2; i += 1) {
    srsData[`learnword${i}`] = {
      algorithm: 'SM2', interval: 0, repetitions: 0, easeFactor: 2.5, stepIndex: 0,
      state: 'learning', nextReviewDate: new Date(now + 2 * day).toISOString(),
      lastReviewDate: new Date(now - day).toISOString(),
      originalWord: `learnword${i}`, entryType: 'word'
    };
  }
  // 4 new
  for (let i = 0; i < 4; i += 1) {
    srsData[`newword${i}`] = {
      algorithm: 'SM2', interval: 0, repetitions: 0, easeFactor: 2.5, stepIndex: 0,
      state: 'new', nextReviewDate: new Date(now + 3 * day).toISOString(),
      lastReviewDate: null, originalWord: `newword${i}`, entryType: 'word'
    };
  }
  // N mastered
  const masteredWords = [];
  for (let i = 0; i < masteredCount; i += 1) {
    const lemma = `mastered${i}`;
    srsData[lemma] = {
      algorithm: 'SM2', interval: 40, repetitions: 12, easeFactor: 2.6, stepIndex: 0,
      state: 'mastered', nextReviewDate: new Date(now + 40 * day).toISOString(),
      lastReviewDate: new Date(now - 5 * day).toISOString(),
      originalWord: lemma, entryType: 'word'
    };
    masteredWords.push({
      lemma,
      masteredAt: new Date(now - (masteredCount - i) * 3 * day).toISOString(),
      totalReviews: 12
    });
  }

  return {
    srsData,
    reviewStats: {
      totalReviews: 143, dailyReviews: 8, streak: 7, longestStreak: 12,
      lastReviewDate: new Date(now - 3600000).toISOString(),
      xp: 620, masteredCount, sessionsCompleted: 21
    },
    masteredWords,
    totalPoints: 620,
    algorithm: 'SM2',
    updatedAt: new Date(now).toISOString()
  };
}

async function readModalState(page) {
  return page.evaluate(() => {
    const modal = document.getElementById('progress-attempts-modal');
    const activeBtn = modal?.querySelector('.progress-tab-btn.active');
    const visiblePanels = Array.from(modal?.querySelectorAll('.progress-tab-content') || [])
      .filter((el) => el.classList.contains('active'))
      .map((el) => el.getAttribute('data-tab-panel'));
    const barSegs = Array.from(modal?.querySelectorAll('.progress-tab-content.active .tp-bar-segment') || [])
      .map((el) => parseFloat(el.style.width) || 0);
    return {
      open: modal?.classList.contains('active') || false,
      display: modal?.style.display || '',
      bodyOverflow: document.body.style.overflow,
      activeTab: activeBtn?.getAttribute('data-tab') || null,
      activeAriaSelected: activeBtn?.getAttribute('aria-selected') || null,
      visiblePanels,
      ringPct: modal?.querySelector('.tp-ring-value')?.textContent?.trim() || null,
      heroDue: modal?.querySelector('.tp-hero-due')?.textContent?.replace(/\s+/g, ' ').trim() || null,
      statValues: Array.from(modal?.querySelectorAll('.progress-tab-content.active .tp-stat-value') || [])
        .map((el) => el.textContent.trim()),
      statLabels: Array.from(modal?.querySelectorAll('.progress-tab-content.active .tp-stat-label') || [])
        .map((el) => el.textContent.trim()),
      legend: Array.from(modal?.querySelectorAll('.progress-tab-content.active .tp-legend-item') || [])
        .map((el) => ({
          label: el.querySelector('.tp-legend-label')?.textContent.trim(),
          value: el.querySelector('.tp-legend-value')?.textContent.trim()
        })),
      barWidthSum: Math.round(barSegs.reduce((a, b) => a + b, 0) * 100) / 100,
      barSegmentCount: barSegs.length,
      hasSparkline: !!modal?.querySelector('.tp-spark-line'),
      sparkPointCount: (modal?.querySelector('.tp-spark-line')?.getAttribute('points') || '')
        .trim().split(/\s+/).filter(Boolean).length,
      hasDonut: !!modal?.querySelector('#distribution-pie, .pie-chart-container, .distribution-pie-chart'),
      qmMode: modal?.querySelector('.tp-segmented-btn.is-active')?.getAttribute('data-qm-mode') || null,
      modeLabel: document.getElementById('progress-mode-label')?.textContent?.trim() || null,
      guestNoticeShown: (document.getElementById('progress-guest-notice')?.style.display || 'none') !== 'none',
      emptyTitle: modal?.querySelector('.tp-empty-title')?.textContent?.trim() || null
    };
  });
}

/**
 * Swap the guest SRS blob and force the module to reload it.
 * A page reload would be undone by addInitScript re-seeding the original blob,
 * and setUser('guest') alone short-circuits when the user has not changed --
 * hence the null round-trip.
 */
async function reseedGuestSrs(page, blob) {
  await page.evaluate((b) => {
    if (b) localStorage.setItem('bel_guest_srs_v1', JSON.stringify(b));
    else localStorage.removeItem('bel_guest_srs_v1');
    window.SRSReview.setUser(null, null);
    window.SRSReview.setUser('guest', null);
  }, blob);
  await page.waitForTimeout(600);
}

/** Same overlay dismissal the other browser checks use, so screenshots show the real UI. */
async function dismissBlockingOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    return getComputedStyle(preloader).display === 'none'
      || Boolean(document.getElementById('preloader-dismiss-btn'));
  }, { timeout: 20000 }).catch(() => {});

  const dismiss = page.locator('#preloader-dismiss-btn');
  if (await dismiss.count()) {
    await dismiss.click({ timeout: 3000 }).catch(() => {});
  }
  await page.evaluate(() => {
    const preloader = document.getElementById('app-preloader');
    if (preloader) preloader.style.display = 'none';
    document.getElementById('vocab-alert-ok')?.click();
  });

  const guest = page.locator('#guest-mode-btn');
  if (await guest.isVisible().catch(() => false)) {
    await guest.click().catch(() => {});
  }
  await page.evaluate(() => {
    const entry = document.getElementById('entry-modal');
    if (entry) entry.style.display = 'none';
  });
}

async function openModal(page, tab) {
  await page.evaluate((t) => {
    window.PTEAttemptArchive.openProgressModal(t);
  }, tab);
  await page.waitForTimeout(350);
}

async function switchTab(page, tab) {
  await page.evaluate((t) => {
    document.querySelector(`.progress-tab-btn[data-tab="${t}"]`)?.click();
  }, tab);
  await page.waitForTimeout(350);
}

async function main() {
  const port = await getFreePort();
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
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block'
  });
  await setupFirebaseMocks(context);

  const seeded = buildGuestSrsBlob({ masteredCount: 6 });
  await context.addInitScript((blob) => {
    localStorage.setItem('bel_guest_srs_v1', JSON.stringify(blob));
    localStorage.setItem('srs_onboarding_complete', 'true');
    localStorage.setItem('srs_tutorial_seen', 'true');
  }, seeded);

  const page = await context.newPage();
  consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`pageerror: ${err.message}`));

  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(`  PASS  ${name}`); } catch (err) {
      results.push(`  FAIL  ${name}\n        ${err.message}`);
      process.exitCode = 1;
    }
  };

  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!document.getElementById('progress-attempts-modal')
        && !!window.PTEAttemptArchive?.openProgressModal,
      { timeout: 30000 }
    );
    await dismissBlockingOverlays(page);

    // Drive the guest load directly. Relying on the auth stack would make this
    // check hostage to the Firebase mock surface rather than the modal itself.
    await page.evaluate(() => window.SRSReview.setUser('guest', null));
    await page.waitForFunction(
      () => (window.SRSReview?.getTierCounts?.().total || 0) > 0,
      { timeout: 15000 }
    );

    // ---- 1. Opens on the Vocabulary tab by default --------------------------
    await openModal(page, 'vocab-progress'); // legacy alias used by index.html
    let s = await readModalState(page);
    check('opens via legacy "vocab-progress" alias on the Vocabulary tab',
      () => assert.equal(s.activeTab, 'vocabulary'));
    check('exactly one panel visible',
      () => assert.deepEqual(s.visiblePanels, ['vocabulary']));
    check('active tab is aria-selected',
      () => assert.equal(s.activeAriaSelected, 'true'));
    check('modal marked open + body scroll locked', () => {
      assert.equal(s.open, true);
      assert.equal(s.bodyOverflow, 'hidden');
    });
    check('no donut chart anywhere', () => assert.equal(s.hasDonut, false));

    // ---- 2. Vocabulary tab shows real SRS numbers ---------------------------
    // Seeded: 4 new + 2 learning + 3 reviewing + 6 mastered = 15 total, 3 due.
    check('vocabulary stat row reports seeded SRS values', () => {
      assert.deepEqual(s.statLabels, ['Day streak', 'Best streak', 'Words tracked', 'Mastered']);
      assert.deepEqual(s.statValues, ['7', '12', '15', '6']);
    });
    check('mastery ring = round(6/15) = 40%',
      () => assert.equal(s.ringPct, '40%'));
    check('hero shows the 3 due words',
      () => assert.ok(/\b3 words due now\b/.test(s.heroDue), `got: ${s.heroDue}`));
    check('collection legend matches seeded tiers', () => {
      const map = Object.fromEntries(s.legend.map((l) => [l.label, l.value]));
      assert.deepEqual(map, { New: '4', Learning: '2', Reviewing: '3', Mastered: '6' });
    });
    check('collection bar widths sum to 100%',
      () => assert.ok(Math.abs(s.barWidthSum - 100) < 0.5, `sum was ${s.barWidthSum}`));
    check('relearning tier omitted when empty',
      () => assert.equal(s.barSegmentCount, 4));
    check('sparkline drawn with one point per mastered word', () => {
      assert.equal(s.hasSparkline, true);
      assert.equal(s.sparkPointCount, 6);
    });

    // ---- 3. Question Mastery tab + Type/Speak toggle ------------------------
    await switchTab(page, 'question-mastery');
    s = await readModalState(page);
    check('question-mastery panel becomes the only visible one',
      () => assert.deepEqual(s.visiblePanels, ['question-mastery']));
    check('Type/Speak toggle defaults to Type',
      () => assert.equal(s.qmMode, 'type'));
    check('question-mastery stat row has all five tiers', () => {
      assert.deepEqual(s.statLabels,
        ['Total', 'Not started', 'Completed', 'Consolidated', 'Mastered']);
    });
    check('guest sees the login notice on question mastery',
      () => assert.equal(s.guestNoticeShown, true));

    await page.evaluate(() => {
      document.querySelector('.tp-segmented-btn[data-qm-mode="speak"]')?.click();
    });
    await page.waitForTimeout(400);
    s = await readModalState(page);
    check('Speak toggle activates and relabels the mode', () => {
      assert.equal(s.qmMode, 'speak');
      assert.equal(s.modeLabel, 'Speak Mode');
    });

    // ---- 4. PTE Attempts tab ------------------------------------------------
    await switchTab(page, 'pte-attempts');
    s = await readModalState(page);
    check('pte-attempts panel becomes the only visible one',
      () => assert.deepEqual(s.visiblePanels, ['pte-attempts']));

    // ---- 5. Back to Vocabulary (3-way switching regression) -----------------
    await switchTab(page, 'vocabulary');
    s = await readModalState(page);
    check('switching back to Vocabulary still works',
      () => assert.deepEqual(s.visiblePanels, ['vocabulary']));
    check('vocabulary re-render keeps its numbers',
      () => assert.deepEqual(s.statValues, ['7', '12', '15', '6']));

    await page.screenshot({ path: 'track-progress-vocabulary-desktop.png' });
    await switchTab(page, 'question-mastery');
    await page.screenshot({ path: 'track-progress-question-mastery-desktop.png' });
    await switchTab(page, 'vocabulary');

    // ---- 6. Escape closes and restores scroll -------------------------------
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    s = await readModalState(page);
    check('Escape closes the modal and restores body scroll', () => {
      assert.equal(s.open, false);
      assert.equal(s.display, 'none');
      assert.equal(s.bodyOverflow, '');
    });

    // ---- 7. Backdrop click closes ------------------------------------------
    await openModal(page, 'vocabulary');
    await page.evaluate(() => {
      const modal = document.getElementById('progress-attempts-modal');
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    s = await readModalState(page);
    check('backdrop click closes the modal', () => assert.equal(s.open, false));

    // ---- 8. Mobile ----------------------------------------------------------
    await page.setViewportSize({ width: 375, height: 780 });
    await openModal(page, 'vocabulary');
    const mobile = await page.evaluate(() => {
      const content = document.querySelector('.progress-modal-content');
      const r = content.getBoundingClientRect();
      return {
        radius: getComputedStyle(content).borderRadius,
        width: Math.round(r.width),
        viewport: window.innerWidth,
        clientWidth: document.documentElement.clientWidth,
        // The fixed modal's containing block is the initial containing block,
        // which headless Chromium reports as the <html> border box.
        icbWidth: Math.round(document.documentElement.getBoundingClientRect().width),
        docScrollW: document.documentElement.scrollWidth,
        panelScrollW: document.querySelector('.progress-tab-content.active')?.scrollWidth || 0,
        panelClientW: document.querySelector('.progress-tab-content.active')?.clientWidth || 0
      };
    });
    check('modal is full-screen at 375px', () => {
      assert.equal(mobile.radius, '0px');
      // Fills its containing block edge to edge. Comparing against innerWidth
      // would fail only because headless Chromium reserves a classic 15px
      // scrollbar gutter that no real mobile browser has.
      assert.ok(Math.abs(mobile.width - mobile.icbWidth) <= 1,
        `modal width ${mobile.width} != containing block ${mobile.icbWidth}`);
    });
    check('no horizontal overflow at 375px', () => {
      assert.ok(mobile.docScrollW <= mobile.clientWidth + 1,
        `document scrollWidth ${mobile.docScrollW} > clientWidth ${mobile.clientWidth}`);
      assert.ok(mobile.panelScrollW <= mobile.panelClientW + 1,
        `panel scrollWidth ${mobile.panelScrollW} > clientWidth ${mobile.panelClientW}`);
    });
    await page.screenshot({ path: 'track-progress-vocabulary-mobile.png' });

    // ---- 9. Sparkline hidden below 2 mastered words -------------------------
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reseedGuestSrs(page, buildGuestSrsBlob({ masteredCount: 1 }));
    await openModal(page, 'vocabulary');
    s = await readModalState(page);
    check('sparkline hidden with only 1 mastered word',
      () => assert.equal(s.hasSparkline, false));
    check('tier bar still renders with 1 mastered word',
      () => assert.ok(Math.abs(s.barWidthSum - 100) < 0.5, `sum was ${s.barWidthSum}`));

    // ---- 10. Empty state ----------------------------------------------------
    await reseedGuestSrs(page, null);
    await openModal(page, 'vocabulary');
    s = await readModalState(page);
    check('empty vocabulary shows an empty state, not a broken chart', () => {
      assert.ok(s.emptyTitle, 'expected .tp-empty-title');
      assert.equal(s.hasSparkline, false);
    });

    // ---- 11. Console hygiene ------------------------------------------------
    const bad = consoleLines.filter((l) => /^(pageerror|error):/i.test(l)
      && !/favicon|net::ERR|Failed to load resource|the server responded with a status/i.test(l)
      // Unrelated to this modal: the pronunciation analyzer calls a backend the
      // static harness does not run.
      && !/word-reference-service|PronunciationApp|Error fetching word data/i.test(l));
    check('no page errors from the progress modal', () => {
      assert.deepEqual(bad, [], `console errors:\n${bad.join('\n')}`);
    });
  } finally {
    console.log('\nTrack Progress modal - browser contract check\n');
    console.log(results.join('\n'));
    const failed = results.filter((r) => r.startsWith('  FAIL')).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed\n`);
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('Harness error:', err);
  process.exit(1);
});
