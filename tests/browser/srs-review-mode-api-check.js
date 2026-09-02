/* eslint-disable no-console */
/**
 * Verifies the SRS read/launch APIs added for the Vocab Practice dashboard:
 *   - getTierCounts()
 *   - getNextReviewSummary()
 *   - getReviewStats()
 *   - startReviewSession({ mode }) pins the drill type
 *   - startReviewSession(true) still works (legacy boolean form)
 *
 * Run: node tests/browser/srs-review-mode-api-check.js
 */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

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
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function dismissBlockingOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    return getComputedStyle(preloader).display === 'none'
      || Boolean(document.getElementById('preloader-dismiss-btn'));
  }, { timeout: 20000 });

  const dismissButton = page.locator('#preloader-dismiss-btn');
  if (await dismissButton.count()) {
    try { await dismissButton.click({ timeout: 3000 }); } catch (_) { /* ignore */ }
  }

  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    return !preloader || getComputedStyle(preloader).display === 'none';
  }, { timeout: 20000 });

  const guestButton = page.locator('#guest-mode-btn');
  if (await guestButton.isVisible().catch(() => false)) {
    await guestButton.click();
  }
}

/** Seed a deterministic guest SRS collection. */
async function seedCards(page) {
  return page.evaluate(async () => {
    // startReviewSession() awaits SRSOnboarding.init() for first-time users, which
    // opens a modal and never resolves without a click. Mark onboarding done so the
    // session can start headlessly.
    localStorage.setItem('srs_onboarding_complete', 'true');
    localStorage.setItem('srs_tutorial_seen', 'true');
    localStorage.setItem('srs_algorithm_preference', 'SM2');

    await window.SRSReview.setUser('guest', null);
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    words.forEach((w) => {
      window.SRSReview.initializeWord(w, w, {
        entryType: 'word',
        partOfSpeech: 'noun',
        definition: `definition of ${w}`,
        example: `A sentence containing ${w} for cloze masking.`
      });
    });
    return words.length;
  });
}

async function main() {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => Boolean(window.SRSReview), { timeout: 20000 });

    const seeded = await seedCards(page);
    assert.strictEqual(seeded, 6, 'expected 6 seeded words');
    console.log(`Seeded ${seeded} SRS cards.`);

    // --- getTierCounts() ---
    const tiers = await page.evaluate(() => window.SRSReview.getTierCounts());
    console.log('getTierCounts() ->', JSON.stringify(tiers));
    for (const key of ['new', 'learning', 'reviewing', 'relearning', 'mastered', 'total', 'due']) {
      assert.strictEqual(typeof tiers[key], 'number', `getTierCounts().${key} must be a number`);
      assert.ok(!Number.isNaN(tiers[key]), `getTierCounts().${key} must not be NaN`);
    }
    assert.strictEqual(tiers.total, 6, 'total should equal the number of seeded cards');
    const tierSum = tiers.new + tiers.learning + tiers.reviewing + tiers.relearning + tiers.mastered;
    assert.strictEqual(tierSum, tiers.total, 'per-state counts must sum to total');
    console.log('✅ getTierCounts() shape and totals correct.');

    // due must agree with the pre-existing getDueCount()
    const dueCount = await page.evaluate(() => window.SRSReview.getDueCount());
    assert.strictEqual(tiers.due, dueCount, 'getTierCounts().due must match getDueCount()');
    console.log(`✅ getTierCounts().due agrees with getDueCount() (${dueCount}).`);

    // --- getReviewStats() ---
    const stats = await page.evaluate(() => window.SRSReview.getReviewStats());
    console.log('getReviewStats() ->', JSON.stringify(stats));
    for (const key of ['totalReviews', 'reviewsToday', 'streak', 'longestStreak']) {
      assert.strictEqual(typeof stats[key], 'number', `getReviewStats().${key} must be a number`);
      assert.ok(!Number.isNaN(stats[key]), `getReviewStats().${key} must not be NaN`);
    }
    assert.ok(stats.longestStreak >= stats.streak, 'longestStreak must never be below streak');
    console.log('✅ getReviewStats() normalises both historical shapes.');

    // --- getNextReviewSummary() ---
    const next = await page.evaluate(() => window.SRSReview.getNextReviewSummary());
    console.log('getNextReviewSummary() ->', JSON.stringify(next));
    assert.strictEqual(typeof next.label, 'string', 'label must be a string');
    assert.ok(next.label.length > 0, 'label must not be empty');
    assert.ok(!next.label.includes('undefined'), 'label must not contain "undefined"');
    assert.ok(!/\bIn 1 hours\b/.test(next.label), 'plural bug "In 1 hours" must be fixed');
    console.log('✅ getNextReviewSummary() returns a usable label.');

    // --- startReviewSession({ mode }) pins the drill ---
    for (const mode of ['listen', 'speak']) {
      const snapshot = await page.evaluate(async (m) => {
        await window.SRSReview.startReviewSession({ mode: m, forceEarly: true });
        return window.SRSReview.getCurrentReviewSnapshot();
      }, mode);
      assert.strictEqual(snapshot.requestedMode, mode, `requestedMode should be "${mode}"`);
      assert.strictEqual(snapshot.currentMode, mode, `currentMode should be pinned to "${mode}"`);
      console.log(`✅ startReviewSession({ mode: '${mode}' }) pinned the drill.`);
    }

    // --- legacy boolean form still works ---
    const legacy = await page.evaluate(async () => {
      await window.SRSReview.startReviewSession(true);
      return window.SRSReview.getCurrentReviewSnapshot();
    });
    assert.strictEqual(legacy.requestedMode, null, 'boolean form must not pin a mode');
    assert.ok(
      ['listen', 'speak', 'cloze'].includes(legacy.currentMode),
      `boolean form must still pick a valid mode, got ${legacy.currentMode}`
    );
    console.log(`✅ Legacy startReviewSession(true) still works (picked "${legacy.currentMode}").`);

    // --- an unknown mode is ignored rather than breaking the session ---
    const bogus = await page.evaluate(async () => {
      await window.SRSReview.startReviewSession({ mode: 'not-a-mode', forceEarly: true });
      return window.SRSReview.getCurrentReviewSnapshot();
    });
    assert.strictEqual(bogus.requestedMode, null, 'unknown mode must be discarded');
    assert.ok(
      ['listen', 'speak', 'cloze'].includes(bogus.currentMode),
      'session must still start with a valid mode'
    );
    console.log('✅ Unknown mode falls back to the weighted picker.');

    console.log('\n🎉 All SRS mode/API checks passed.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ SRS mode/API check failed:', err.message);
  console.error(err);
  process.exit(1);
});
