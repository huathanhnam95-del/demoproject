/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));
  app.use((_req, res) => {
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

async function dismissBlockingOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    const display = getComputedStyle(preloader).display;
    const dismiss = document.getElementById('preloader-dismiss-btn');
    return display === 'none' || Boolean(dismiss);
  }, { timeout: 15000 });

  const dismissButton = page.locator('#preloader-dismiss-btn');
  if (await dismissButton.count()) {
    try {
      await dismissButton.click({ timeout: 3000 });
    } catch (_) {
      // Ignore
    }
  }

  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    return !preloader || getComputedStyle(preloader).display === 'none';
  }, { timeout: 15000 });

  const guestButton = page.locator('#guest-mode-btn');
  if (await guestButton.isVisible().catch(() => false)) {
    await guestButton.click();
  }
}

async function runTest() {
  console.log('[RFIB Test] Starting server...');
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Bypass onboarding modal via sessionStorage
    await page.addInitScript(() => {
      sessionStorage.setItem('welcome_dismissed', 'true');
      sessionStorage.setItem('bypass_welcome_modal', 'true');
      localStorage.setItem('welcome_dismissed', 'true');
    });

    console.log(`[RFIB Test] Navigating to ${origin}...`);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(page);

    console.log('[RFIB Test] Switching to RFIB mode...');
    await page.evaluate(() => window.switchToMode && window.switchToMode('rfib'));

    await page.waitForSelector('#mode-rfib.active', { timeout: 10000 });
    await page.waitForSelector('#rfib-cloze-view .rfib-blank-select', { timeout: 15000 });

    const blanksCount = await page.locator('#rfib-cloze-view .rfib-blank-select').count();
    console.log(`[RFIB Test] Found ${blanksCount} blanks in passage.`);
    assert(blanksCount > 0, 'Expected at least 1 blank select in RFIB mode.');

    // Assert initial locked state of audio card before Check
    const initialLockedState = await page.evaluate(() => {
      const card = document.getElementById('rfib-audio-card');
      const overlay = document.getElementById('rfib-audio-lock-overlay');
      const textEl = overlay?.querySelector('.rfib-audio-lock-text');
      return {
        isLocked: card?.classList.contains('is-locked'),
        overlayText: textEl?.textContent || ''
      };
    });

    console.log('[RFIB Test] Initial audio card state:', initialLockedState);
    assert.strictEqual(initialLockedState.isLocked, true, 'Expected audio card to be locked before Check.');
    assert.strictEqual(initialLockedState.overlayText, 'Check answer to unlock audio', `Expected overlay text 'Check answer to unlock audio', got '${initialLockedState.overlayText}'`);

    // Do NOT choose any word for any blank (leave at default "Choose")
    console.log('[RFIB Test] Clicking Check button with unchosen blanks...');
    await page.click('#rfib-check-btn');

    await page.waitForSelector('.rfib-correct-label.is-visible', { timeout: 5000 });

    // Assert audio card is unlocked after Check
    const postCheckLockedState = await page.evaluate(() => {
      const card = document.getElementById('rfib-audio-card');
      return card?.classList.contains('is-locked');
    });
    console.log('[RFIB Test] Post-check audio card isLocked:', postCheckLockedState);
    assert.strictEqual(postCheckLockedState, false, 'Expected audio card to be unlocked after clicking Check.');

    const visibleCorrectLabels = await page.locator('.rfib-correct-label.is-visible').count();
    console.log(`[RFIB Test] Visible correct answer labels count: ${visibleCorrectLabels}`);
    assert.strictEqual(visibleCorrectLabels, blanksCount, `Expected ${blanksCount} correct answer labels for unchosen blanks, found ${visibleCorrectLabels}.`);

    // Verify styling and text content of correct answer labels
    const labelDetails = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('.rfib-correct-label.is-visible'));
      return labels.map((el) => {
        const style = window.getComputedStyle(el);
        return {
          text: el.textContent,
          fontWeight: style.fontWeight,
          fontSize: style.fontSize,
          backgroundColor: style.backgroundColor,
          color: style.color,
          display: style.display
        };
      });
    });

    console.log('[RFIB Test] Correct label styling details:', labelDetails[0]);

    for (const label of labelDetails) {
      assert(label.text.startsWith('→ '), `Expected label text to start with '→ ', got: ${label.text}`);
      assert(label.text.length > 2, `Expected label text to contain answer, got: ${label.text}`);
      assert(Number(label.fontWeight) >= 700 || label.fontWeight === 'bold', `Expected font-weight >= 700, got: ${label.fontWeight}`);
      assert(label.backgroundColor !== 'rgba(0, 0, 0, 0)' && label.backgroundColor !== 'transparent', `Expected non-transparent badge background, got: ${label.backgroundColor}`);
    }

    // Dismiss vocabulary modal if triggered by grading
    await page.evaluate(() => {
      const modal = document.getElementById('vocab-add-modal');
      if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
      }
    });

    // Assert clicking Retry re-locks the audio card
    console.log('[RFIB Test] Clicking Retry button to verify audio re-locks...');
    await page.click('#rfib-retry-btn');
    const postRetryLockedState = await page.evaluate(() => {
      const card = document.getElementById('rfib-audio-card');
      return card?.classList.contains('is-locked');
    });
    console.log('[RFIB Test] Post-retry audio card isLocked:', postRetryLockedState);
    assert.strictEqual(postRetryLockedState, true, 'Expected audio card to be re-locked after clicking Retry.');

    console.log('[RFIB Test] PASS! Audio locking and unchosen answer labels verified.');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('[RFIB Test] FAILED:', err);
  process.exit(1);
});
