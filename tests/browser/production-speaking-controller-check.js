/* eslint-disable no-console */
/**
 * Production Speaking Controller Check (V1.8.25)
 * Verifies live deployment on https://listening-tasks-3ae34.web.app
 * Tests version tag, speaking controller mounting, picker sheets,
 * Basic/Advanced toggle, and console error cleanliness.
 */
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const PRODUCTION_URL = 'https://listening-tasks-3ae34.web.app';
const CREDENTIALS_PATH = path.join(process.cwd(), '.local', 'browser-test-credentials.md');

function parseCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  const text = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0];
  const passwordLine = text.split(/\r?\n/).find((line) => /password/i.test(line));
  const password = passwordLine
    ? passwordLine.replace(/^\s*[-*]?\s*/, '').replace(/`|\*\*/g, '').replace(/^password\s*[:=-]\s*/i, '').trim()
    : '';
  return email && password ? { email, password } : null;
}

(async () => {
  console.log(`\n--- Production Browser Verification (${PRODUCTION_URL}) ---`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Bypass tutorial overlays and onboarding modals before page load
  await page.addInitScript(() => {
    sessionStorage.setItem('tutorialDismissed', 'true');
    sessionStorage.setItem('onboardingComplete', 'true');
    localStorage.setItem('tutorialDismissed', 'true');
    localStorage.setItem('onboardingComplete', 'true');

    // Add style rule to suppress tutorial overlays
    const style = document.createElement('style');
    style.textContent = '#tutorial-overlay, #tutorial-backdrop, .tutorial-overlay, .tutorial-backdrop { display: none !important; pointer-events: none !important; }';
    document.head?.appendChild(style);
  });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('praat-api') && !text.includes('CORS') && !text.includes('Failed to fetch')) {
        consoleErrors.push(text);
      }
    }
  });

  try {
    console.log('[1] Loading production website...');
    await page.goto(PRODUCTION_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle preloader if present
    await page.waitForFunction(() => {
      const preloader = document.getElementById('app-preloader');
      if (!preloader) return true;
      const dismiss = document.getElementById('preloader-dismiss-btn');
      return getComputedStyle(preloader).display === 'none' || Boolean(dismiss);
    }, null, { timeout: 15000 }).catch(() => {});

    const dismissButton = page.locator('#preloader-dismiss-btn');
    if (await dismissButton.count()) {
      await dismissButton.click({ force: true }).catch(() => {});
    }

    const guestButton = page.locator('#guest-mode-btn');
    if (await guestButton.isVisible().catch(() => false)) {
      await guestButton.click({ force: true }).catch(() => {});
    }

    // Wait for main dashboard
    await page.waitForSelector('#version-indicator', { timeout: 15000 });

    // Verify Version Indicator
    const versionText = await page.locator('#version-indicator').textContent();
    console.log(`  √ Production Version Indicator: ${versionText.trim()}`);
    assert.strictEqual(versionText.trim(), 'V1.8.25', 'Version indicator must be V1.8.25');

    // Switch to PTE Practice tab
    const pteTabBtn = page.locator('#tab-pte');
    if (await pteTabBtn.isVisible()) {
      await pteTabBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    // Test Mode 1: Read Aloud (pte:read-aloud)
    console.log('[2] Testing Read Aloud mode on production...');
    const raModeBtn = page.locator('#mode-btn-read-aloud');
    await raModeBtn.click({ force: true });
    await page.waitForSelector('#mode-read-aloud .spc-controller', { timeout: 15000 });
    console.log('  √ Read Aloud SpeakingPracticeController mounted');

    // Test Picker Pill & Sheet
    const raPill = page.locator('#spc-picker-read-aloud');
    await page.waitForSelector('#spc-picker-read-aloud', { timeout: 10000 });
    assert.strictEqual(await raPill.getAttribute('aria-expanded'), 'false');
    
    // Dispatch click to open sheet
    await page.evaluate(() => document.getElementById('spc-picker-read-aloud').click());
    await page.waitForSelector('#spc-picker-sheet-read-aloud.is-active', { timeout: 10000 });
    console.log('  √ Read Aloud picker sheet opened');

    const raSheetItems = page.locator('#spc-picker-sheet-read-aloud .spc-sheet-item');
    const itemCount = await raSheetItems.count();
    console.log(`  √ Sheet populated with ${itemCount} items`);
    assert.ok(itemCount > 0, 'Picker sheet should contain question items');

    // Close sheet
    await page.evaluate(() => {
      const closeBtn = document.querySelector('#spc-picker-sheet-read-aloud .spc-sheet-close');
      if (closeBtn) closeBtn.click();
    });
    await page.waitForTimeout(300);

    // Test Toggle
    const raController = page.locator('#mode-read-aloud .spc-controller');
    console.log(`  √ Current View: ${await raController.getAttribute('data-spc-view')}`);
    
    await page.evaluate(() => {
      const advBtn = document.querySelector('#mode-read-aloud .spc-view-toggle-btn[data-view="advanced"]');
      if (advBtn) advBtn.click();
    });
    await page.waitForTimeout(300);
    assert.strictEqual(await raController.getAttribute('data-spc-view'), 'advanced');
    console.log('  √ Switched view to Advanced');

    await page.evaluate(() => {
      const basicBtn = document.querySelector('#mode-read-aloud .spc-view-toggle-btn[data-view="basic"]');
      if (basicBtn) basicBtn.click();
    });
    await page.waitForTimeout(300);
    assert.strictEqual(await raController.getAttribute('data-spc-view'), 'basic');
    console.log('  √ Switched view back to Basic');

    // Test Mode 2: RTS (pte:rts)
    console.log('[3] Testing RTS mode on production...');
    await page.evaluate(() => window.switchToMode('rts'));
    await page.waitForSelector('#mode-rts .spc-controller', { timeout: 15000 });
    const rtsController = page.locator('#mode-rts .spc-controller');
    assert.ok(await rtsController.getAttribute('data-spc-no-toggle') !== null, 'RTS controller should have data-spc-no-toggle');
    console.log('  √ RTS controller mounted with no-toggle attribute');

    // Test Mode 3: Repeat Sentence / Speak (pte:speak)
    console.log('[4] Testing Speak mode on production...');
    await page.evaluate(() => window.switchToMode('speak'));
    await page.waitForSelector('#mode-speak .spc-controller', { timeout: 15000 });
    console.log('  √ Speak controller mounted');

    // Console error audit
    const spcErrors = consoleErrors.filter(e => e.includes('[SPC]'));
    console.log(`[5] Console error audit: ${spcErrors.length} controller errors`);
    assert.strictEqual(spcErrors.length, 0, 'No SpeakingPracticeController console errors');

    console.log('\n--- Production Browser Verification PASSED ---');
  } catch (err) {
    console.error('Production Verification Failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
