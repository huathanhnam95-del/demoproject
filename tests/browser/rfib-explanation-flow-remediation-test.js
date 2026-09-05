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
    const sockets = new Set();
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    server.destroyAll = () => {
      for (const s of sockets) s.destroy();
    };
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
    } catch (_) {}
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

async function runRemediationVerification() {
  console.log('[Remediation Test] Starting server...');
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });

  try {
    // ═══════════════════════════════════════════════════════════════
    // TEST SUITE 1: Desktop Viewport (Accessibility, Select Locking, Padding Bug)
    // ═══════════════════════════════════════════════════════════════
    console.log('[Remediation Test] 1. Desktop Viewport Verification');
    const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await desktopContext.newPage();
    page.on('console', (msg) => {
      if (msg.text().includes('RFIB')) {
        console.log('  PAGE CONSOLE:', msg.text());
      }
    });

    await page.addInitScript(() => {
      sessionStorage.setItem('welcome_dismissed', 'true');
      sessionStorage.setItem('bypass_welcome_modal', 'true');
      localStorage.setItem('welcome_dismissed', 'true');
    });

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(page);

    await page.evaluate(() => window.switchToMode && window.switchToMode('rfib'));
    await page.waitForSelector('#mode-rfib.active', { timeout: 10000 });
    await page.waitForSelector('#rfib-cloze-view .rfib-blank-select', { timeout: 15000 });

    // Verify question 1 is selected
    const qSelectVal = await page.$eval('#rfib-question-select', (el) => el.value);
    console.log(`[Remediation Test] Loaded question ID: ${qSelectVal}`);
    assert.strictEqual(qSelectVal, '1', 'Expected question 1 to be initially selected');

    // Confirm selects are enabled initially
    const initialDisabled = await page.$$eval('#rfib-cloze-view .rfib-blank-select', (selects) =>
      selects.map((s) => s.disabled)
    );
    // Deliberately select an incorrect answer for blank 1 ('was receiving') to verify distractor analysis
    const b1Select = page.locator('#rfib-cloze-view .rfib-blank-select').first();
    const b1Options = await b1Select.locator('option').allTextContents();
    console.log('[Remediation Test] Available options for Blank 1:', b1Options);
    const wrongOption = b1Options.find((opt) => opt && opt.toLowerCase().includes('was receiving')) || b1Options[2];
    if (wrongOption) {
      await b1Select.selectOption({ label: wrongOption });
    }

    // Click Check
    await page.click('#rfib-check-btn');
    await page.waitForSelector('.rfib-hint-btn.is-visible', { timeout: 10000 });

    // Priority 0: Dropdown selects must now be locked (disabled === true)
    const postCheckDisabled = await page.$$eval('#rfib-cloze-view .rfib-blank-select', (selects) =>
      selects.map((s) => s.disabled)
    );
    console.log('[Remediation Test] Selects disabled state post-check:', postCheckDisabled);
    assert(postCheckDisabled.every((d) => d === true), 'Expected all selects to be disabled after checkAnswers');

    // Dismiss vocabulary modal triggered by grading
    await page.evaluate(() => {
      const modal = document.getElementById('vocab-add-modal');
      if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
      }
    });

    // Priority 1: Touch target of .rfib-popover-close and .rfib-hint-btn
    const hintBtnAria = await page.$eval('.rfib-hint-btn', (el) => ({
      ariaLabel: el.getAttribute('aria-label'),
      ariaHasPopup: el.getAttribute('aria-haspopup')
    }));
    assert(hintBtnAria.ariaLabel?.includes('Explanation for blank'), 'Hint button should have informative aria-label');
    assert.strictEqual(hintBtnAria.ariaHasPopup, 'dialog', 'Hint button should declare aria-haspopup="dialog"');

    // Open the popover by clicking the first hint button
    const firstHint = page.locator('.rfib-hint-btn').first();
    await firstHint.click();

    await page.waitForSelector('.rfib-popover.is-visible', { timeout: 5000 });

    // Priority 1: Check ARIA dialog attributes on .rfib-popover
    const popoverAria = await page.evaluate(() => {
      const popover = document.querySelector('.rfib-popover');
      const title = document.getElementById('rfib-popover-title');
      const closeBtn = popover?.querySelector('.rfib-popover-close');
      const closeStyle = closeBtn ? window.getComputedStyle(closeBtn) : null;
      return {
        role: popover?.getAttribute('role'),
        ariaModal: popover?.getAttribute('aria-modal'),
        ariaLabelledBy: popover?.getAttribute('aria-labelledby'),
        titleText: title?.textContent,
        closeAriaLabel: closeBtn?.getAttribute('aria-label'),
        closeWidth: closeStyle?.width,
        closeHeight: closeStyle?.height
      };
    });
    console.log('[Remediation Test] Popover ARIA and touch target:', popoverAria);
    assert.strictEqual(popoverAria.role, 'dialog', 'Expected role="dialog"');
    assert.strictEqual(popoverAria.ariaModal, 'false', 'Expected aria-modal="false"');
    assert.strictEqual(popoverAria.ariaLabelledBy, 'rfib-popover-title', 'Expected aria-labelledby="rfib-popover-title"');
    assert.strictEqual(popoverAria.titleText, 'Blank 1', 'Expected title to identify Blank 1');
    assert.strictEqual(popoverAria.closeWidth, '40px', 'Expected close button width 40px');
    assert.strictEqual(popoverAria.closeHeight, '40px', 'Expected close button height 40px');

    // Priority 0: Verify 4-digit padding bug resolution - explanation & grammar tag must be populated!
    const explanationContent = await page.evaluate(() => {
      const popover = document.querySelector('.rfib-popover');
      const badge = popover?.querySelector('.rfib-popover-grammar-badge')?.textContent;
      const enExp = popover?.querySelector('.rfib-popover-section-en .rfib-popover-exp-text')?.textContent;
      const viExp = popover?.querySelector('.rfib-popover-section-vi .rfib-popover-exp-text')?.textContent;
      const empty = popover?.querySelector('.rfib-popover-empty');
      const hasEmpty = Boolean(empty);
      const hasAnswerGrid = Boolean(popover?.querySelector('.rfib-popover-answer-grid'));
      const hasDistractorCard = Boolean(popover?.querySelector('.rfib-popover-section-distractor'));
      return { badge, enExp, viExp, hasEmpty, hasAnswerGrid, hasDistractorCard };
    });
    console.log('[Remediation Test] Explanation content for Question 1 Blank 1:', {
      badge: explanationContent.badge,
      enLength: explanationContent.enExp?.length,
      hasAnswerGrid: explanationContent.hasAnswerGrid,
      hasDistractorCard: explanationContent.hasDistractorCard,
      hasEmpty: explanationContent.hasEmpty
    });
    assert.strictEqual(explanationContent.hasEmpty, false, 'Expected real explanation to load, not empty placeholder!');
    assert(explanationContent.enExp && explanationContent.enExp.length > 10, 'Expected English explanation for blank 1');
    assert(explanationContent.badge && explanationContent.badge.includes('Simple Past Tense'), 'Expected grammar badge from review-metadata.json');
    assert.strictEqual(explanationContent.hasAnswerGrid, true, 'Expected dual answer comparison grid');
    assert.strictEqual(explanationContent.hasDistractorCard, true, 'Expected distractor section explaining why user choice was wrong');

    // Priority 1: Focus shifting on open
    const activeBeforeWait = await page.evaluate(() => ({
      activeTag: document.activeElement?.tagName,
      activeClass: document.activeElement?.className,
      popoverVisible: document.querySelector('.rfib-popover')?.classList.contains('is-visible')
    }));
    console.log('[Remediation Test] Active element before wait:', activeBeforeWait);

    await page.waitForFunction(() => document.activeElement?.classList.contains('rfib-popover-close'), { timeout: 3000 });
    const activeElementTag = await page.evaluate(() => document.activeElement?.className);
    console.log('[Remediation Test] Active element after open:', activeElementTag);
    assert(activeElementTag?.includes('rfib-popover-close'), 'Expected focus to shift to close button on open');

    // Priority 1: Focus restoration on Escape
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const pop = document.querySelector('.rfib-popover');
      return !pop || !pop.classList.contains('is-visible');
    });

    await page.waitForFunction(() => document.activeElement?.classList.contains('rfib-hint-btn'), { timeout: 3000 });
    const activeElementAfterEscape = await page.evaluate(() => document.activeElement?.className);
    console.log('[Remediation Test] Active element after Escape:', activeElementAfterEscape);
    assert(activeElementAfterEscape?.includes('rfib-hint-btn'), 'Expected focus to restore to hint button on Escape');

    // Priority 1: Test closing via close button restores focus to hint button
    console.log('[Remediation Test] Testing close button click restores focus to hint button...');
    await firstHint.click();
    await page.waitForSelector('.rfib-popover.is-visible', { timeout: 5000 });
    await page.click('.rfib-popover-close');
    await page.waitForFunction(() => {
      const pop = document.querySelector('.rfib-popover');
      return !pop || !pop.classList.contains('is-visible');
    }, { timeout: 5000 });
    await page.waitForFunction(() => document.activeElement?.classList.contains('rfib-hint-btn'), { timeout: 3000 });
    const activeAfterCloseBtn = await page.evaluate(() => document.activeElement?.className);
    console.log('[Remediation Test] Active element after close button click:', activeAfterCloseBtn);
    assert(activeAfterCloseBtn?.includes('rfib-hint-btn'), 'Expected focus to restore to hint button on close button click');

    // Priority 1: Test outside click dismisses popover WITHOUT stealing focus
    console.log('[Remediation Test] Testing outside click does NOT steal focus back to hint button...');
    await firstHint.click();
    await page.waitForSelector('.rfib-popover.is-visible', { timeout: 5000 });
    // Click outside on the retry button
    await page.click('#rfib-retry-btn');
    await page.waitForFunction(() => {
      const pop = document.querySelector('.rfib-popover');
      return !pop || !pop.classList.contains('is-visible');
    }, { timeout: 5000 });
    await page.waitForTimeout(100);
    const activeAfterOutsideClick = await page.evaluate(() => document.activeElement?.className);
    console.log('[Remediation Test] Active element after outside click:', activeAfterOutsideClick);
    assert(!activeAfterOutsideClick?.includes('rfib-hint-btn'), 'Expected outside click NOT to restore/steal focus back to hint button');

    // Priority 0: Test Retry button re-enables selects
    console.log('[Remediation Test] Testing Retry restores select dropdowns...');
    await page.waitForFunction(() => {
      const selects = Array.from(document.querySelectorAll('#rfib-cloze-view .rfib-blank-select'));
      return selects.length > 0 && selects.every((s) => !s.disabled);
    }, { timeout: 10000 });
    const postRetryDisabled = await page.$$eval('#rfib-cloze-view .rfib-blank-select', (selects) =>
      selects.map((s) => s.disabled)
    );
    console.log('[Remediation Test] Selects disabled state post-retry:', postRetryDisabled);
    assert(postRetryDisabled.every((d) => d === false), 'Expected all selects to be re-enabled after Retry');

    // Priority 0: Test check answers -> navigate to next question also re-enables selects
    console.log('[Remediation Test] Testing question navigation unlocks selects...');
    await page.click('#rfib-check-btn');
    await page.waitForSelector('.rfib-hint-btn.is-visible', { timeout: 10000 });
    const disabledAfterCheck = await page.$$eval('#rfib-cloze-view .rfib-blank-select', (selects) =>
      selects.map((s) => s.disabled)
    );
    assert(disabledAfterCheck.every((d) => d === true), 'Expected selects to be disabled after check');

    // Dismiss vocabulary modal if open
    await page.evaluate(() => {
      const modal = document.getElementById('vocab-add-modal');
      if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
      }
    });

    // Navigate to next question
    await page.click('#rfib-next-question-btn');
    await page.waitForFunction(() => {
      const qSelect = document.getElementById('rfib-question-select');
      return qSelect && qSelect.value === '2';
    }, { timeout: 10000 });
    const nextQDisabled = await page.$$eval('#rfib-cloze-view .rfib-blank-select', (selects) =>
      selects.map((s) => s.disabled)
    );
    console.log('[Remediation Test] Selects disabled state on Question 2:', nextQDisabled);
    assert(nextQDisabled.every((d) => d === false), 'Expected all selects to be enabled upon loading a new question');

    await desktopContext.close();

    // ═══════════════════════════════════════════════════════════════
    // TEST SUITE 2: Mobile Viewport (Bottom Sheet Transformation & Pull Down)
    // ═══════════════════════════════════════════════════════════════
    console.log('[Remediation Test] 2. Mobile Viewport Verification');
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
      hasTouch: true
    });
    const mobilePage = await mobileContext.newPage();

    await mobilePage.addInitScript(() => {
      sessionStorage.setItem('welcome_dismissed', 'true');
      sessionStorage.setItem('bypass_welcome_modal', 'true');
      localStorage.setItem('welcome_dismissed', 'true');
    });

    await mobilePage.goto(origin, { waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(mobilePage);

    await mobilePage.evaluate(() => window.switchToMode && window.switchToMode('rfib'));
    await mobilePage.waitForSelector('#mode-rfib.active', { timeout: 10000 });
    await mobilePage.waitForSelector('#rfib-cloze-view .rfib-blank-select', { timeout: 15000 });

    await mobilePage.click('#rfib-check-btn');
    await mobilePage.waitForSelector('.rfib-hint-btn.is-visible', { timeout: 10000 });

    // Dismiss vocabulary modal
    await mobilePage.evaluate(() => {
      const modal = document.getElementById('vocab-add-modal');
      if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
      }
    });

    // Open popover on mobile
    await mobilePage.locator('.rfib-hint-btn').first().click();
    await mobilePage.waitForSelector('.rfib-popover.is-visible', { timeout: 5000 });

    // Verify mobile drawer layout
    const mobileLayout = await mobilePage.evaluate(() => {
      const popover = document.querySelector('.rfib-popover');
      const style = window.getComputedStyle(popover);
      const rect = popover.getBoundingClientRect();
      const arrow = popover.querySelector('.rfib-popover-arrow');
      const arrowStyle = arrow ? window.getComputedStyle(arrow) : null;
      return {
        bottom: style.bottom,
        left: style.left,
        width: rect.width,
        windowWidth: window.innerWidth,
        arrowDisplay: arrowStyle?.display
      };
    });
    console.log('[Remediation Test] Mobile layout details:', mobileLayout);
    assert.strictEqual(mobileLayout.bottom, '0px', 'Expected mobile drawer bottom to be 0px');
    assert.strictEqual(mobileLayout.left, '0px', 'Expected mobile drawer left to be 0px');
    assert(mobileLayout.width >= mobileLayout.windowWidth - 20, `Expected mobile drawer to span full width, got ${mobileLayout.width}`);
    assert.strictEqual(mobileLayout.arrowDisplay, 'none', 'Expected arrow to be hidden on mobile');

    // Test PointerEvent pull-down dismissal gesture
    console.log('[Remediation Test] Simulating pull-down drag gesture on mobile drawer header...');
    const header = mobilePage.locator('.rfib-popover-header');
    const headerBox = await header.boundingBox();
    assert(headerBox, 'Expected header bounding box');

    const startX = headerBox.x + headerBox.width / 2;
    const startY = headerBox.y + headerBox.height / 2;

    await mobilePage.mouse.move(startX, startY);
    await mobilePage.mouse.down();
    // Drag downwards by 100px (exceeds 70px dismissal threshold)
    await mobilePage.mouse.move(startX, startY + 100, { steps: 5 });
    await mobilePage.mouse.up();

    await mobilePage.waitForFunction(() => {
      const pop = document.querySelector('.rfib-popover');
      return !pop || !pop.classList.contains('is-visible');
    }, { timeout: 5000 });

    const isVisibleAfterDrag = await mobilePage.$eval('.rfib-popover', (el) => el.classList.contains('is-visible'));
    assert.strictEqual(isVisibleAfterDrag, false, 'Expected mobile bottom drawer to dismiss after pulling down > 70px');

    // TEST: Cross-breakpoint resize / device orientation change
    console.log('[Remediation Test] Testing orientation change / resize from mobile to desktop...');
    await mobilePage.locator('.rfib-hint-btn').first().click();
    await mobilePage.waitForSelector('.rfib-popover.is-visible', { timeout: 5000 });

    // Rotate/resize to desktop width
    await mobilePage.setViewportSize({ width: 800, height: 600 });
    await mobilePage.waitForTimeout(200);

    const rotatedDesktopLayout = await mobilePage.evaluate(() => {
      const popover = document.querySelector('.rfib-popover');
      const rect = popover.getBoundingClientRect();
      const arrow = popover.querySelector('.rfib-popover-arrow');
      return {
        top: popover.style.top,
        left: popover.style.left,
        rectTop: rect.top,
        rectLeft: rect.left,
        arrowDisplay: window.getComputedStyle(arrow).display
      };
    });
    console.log('[Remediation Test] Rotated desktop layout:', rotatedDesktopLayout);
    assert(rotatedDesktopLayout.rectTop > 0 && rotatedDesktopLayout.rectLeft > 0, 'Expected valid positioned coordinates on desktop resize');
    assert.notStrictEqual(rotatedDesktopLayout.arrowDisplay, 'none', 'Expected arrow to be visible in desktop viewport');

    await mobileContext.close();

    console.log('\n[Remediation Test] ALL TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    try {
      await browser.close();
    } catch (_) {}
    try {
      server.destroyAll?.();
      server.close();
    } catch (_) {}
  }
}

runRemediationVerification().catch((err) => {
  console.error('[Remediation Test] FAILED:', err);
  process.exit(1);
});
