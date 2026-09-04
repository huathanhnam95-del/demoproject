/**
 * Read Aloud UX Layout Verification — zone-based restructure check
 */
const { chromium } = require('playwright');
const express = require('express');
const path = require('path');

(async () => {
  // Start local server
  const app = express();
  app.use(express.static(path.join(__dirname, '../../public')));
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Server on ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  // Set guest mode
  await page.addInitScript(() => {
    sessionStorage.setItem('onboarding_complete', 'true');
    sessionStorage.setItem('user_scope', 'pte');
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000); // Let scripts initialize

  // Activate Read Aloud via JS
  await page.evaluate(() => {
    if (typeof switchToMode === 'function') switchToMode('read-aloud');
    else if (typeof window.switchToMode === 'function') window.switchToMode('read-aloud');
  });
  await page.waitForTimeout(3000); // Extra time for rAF-deferred Settings sheet init

  const results = {};

  // 1. Check SPC controller exists
  results.spcControllerExists = await page.evaluate(() => !!document.querySelector('#mode-read-aloud .spc-controller'));

  // 2. Check workbench parts exist. The old .ra-zone-* wrappers were three
  //    separately-measured columns; they are one .ra-workbench grid now.
  results.workbenchExists = await page.evaluate(() => !!document.querySelector('#mode-read-aloud .ra-workbench'));
  results.stageExists = await page.evaluate(() => !!document.querySelector('#mode-read-aloud .ra-stage'));
  results.railExists = await page.evaluate(() => !!document.querySelector('#mode-read-aloud .ra-rail'));

  // 3. Check text passage is visible
  results.textPromptVisible = await page.evaluate(() => {
    const el = document.getElementById('ra-text-prompt');
    return el && el.offsetHeight > 0;
  });

  // 4. Check action buttons are visible and NOT inside SPC controller
  results.recordBtnVisible = await page.evaluate(() => {
    const btn = document.getElementById('ra-record-btn');
    return btn && btn.offsetHeight > 0;
  });
  // The attempt controls are adopted into the shell's sticky footer now, so
  //    the primary action sits at the end of the flow instead of above the text.
  results.recordBtnInFooter = await page.evaluate(() => {
    const btn = document.getElementById('ra-record-btn');
    return !!btn && btn.closest('.spc-footer') !== null;
  });

  // 5. Check timers are visible and in Zone 3
  results.prepTimerVisible = await page.evaluate(() => {
    const el = document.getElementById('ra-prep-timer-box');
    return el && el.offsetHeight > 0;
  });
  results.prepTimerInFooter = await page.evaluate(() => {
    const el = document.getElementById('ra-prep-timer-box');
    return !!el && el.closest('.spc-footer') !== null;
  });

  // 6. The actions row now carries the adopted timers and attempt buttons, so
  //    it must be visible rather than hidden.
  results.spcActionsRowVisible = await page.evaluate(() => {
    const row = document.querySelector('#mode-read-aloud .spc-row--actions');
    if (!row) return 'not_found';
    return getComputedStyle(row).display !== 'none';
  });

  // 7. Check old broken buttons don't exist
  results.oldAudioShortcutsGone = await page.evaluate(() => {
    return document.getElementById('header-ra-play-audio-btn') === null;
  });

  // 8. Check question-selector visibility (Basic view = hidden since data-spc-level=advanced)
  results.questionSelectorHiddenInBasic = await page.evaluate(() => {
    const el = document.querySelector('#mode-read-aloud .question-selector');
    if (!el) return 'not_found';
    return getComputedStyle(el).display === 'none';
  });

  // 9. Check Basic/Advanced toggle exists
  results.toggleExists = await page.evaluate(() => {
    return !!document.querySelector('#mode-read-aloud .spc-view-toggle');
  });

  // 10. The passage still precedes the attempt controls: the learner meets the
  //     text before the button that acts on it.
  results.passageBeforeActions = await page.evaluate(() => {
    const passage = document.querySelector('#mode-read-aloud .ra-stage');
    const actions = document.querySelector('#mode-read-aloud .spc-footer');
    if (!passage || !actions) return false;
    return passage.getBoundingClientRect().top < actions.getBoundingClientRect().top;
  });

  // 11. Everything measures from one shared grid — the bug this redesign fixed.
  results.gridAligned = await page.evaluate(() => {
    const edge = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return Math.round(r.left + (parseFloat(getComputedStyle(el).paddingLeft) || 0));
    };
    const edges = [edge('#mode-read-aloud .spc-row--primary'), edge('#mode-read-aloud .ra-guidebar'), edge('#mode-read-aloud .ra-stage')];
    if (edges.some((v) => v === null)) return false;
    return Math.max(...edges) - Math.min(...edges) <= 1;
  });

  // Take screenshot
  await page.screenshot({ path: path.join(__dirname, 'ra-ux-basic.png'), fullPage: true });

  // Check Settings button in SPC toggle group
  results.settingsButtonExists = await page.evaluate(() => {
    const btn = document.querySelector('#mode-read-aloud .spc-settings-btn');
    return btn && btn.closest('.spc-view-toggle') !== null;
  });

  // Open Settings sheet via Settings gear button
  await page.evaluate(() => {
    const settingsBtn = document.querySelector('#mode-read-aloud .spc-settings-btn') || Array.from(document.querySelectorAll('#mode-read-aloud .spc-view-toggle-btn')).find(b => b.textContent.includes('Settings'));
    if (settingsBtn) settingsBtn.click();
  });
  await page.waitForTimeout(600);

  results.settingsSheetOpenedOnAdvanced = await page.evaluate(() => {
    const sheet = document.getElementById('ra-settings-sheet');
    return sheet && sheet.classList.contains('is-active');
  });

  results.settingsHasTabs = await page.evaluate(() => {
    const tabs = document.querySelectorAll('#ra-settings-sheet .spc-sheet-tab');
    return tabs.length === 3;
  });

  // Close sheet with close button
  await page.evaluate(() => {
    const closeBtn = document.querySelector('#ra-settings-sheet .spc-sheet-close');
    if (closeBtn) closeBtn.click();
  });
  await page.waitForTimeout(400);

  results.settingsSheetClosedOnCloseBtn = await page.evaluate(() => {
    const sheet = document.getElementById('ra-settings-sheet');
    return !sheet || !sheet.classList.contains('is-active');
  });

  // Switch to Basic view
  await page.evaluate(() => {
    const basicBtn = Array.from(document.querySelectorAll('#mode-read-aloud .spc-view-toggle-btn')).find(b => b.textContent.includes('Basic'));
    if (basicBtn) basicBtn.click();
  });
  await page.waitForTimeout(400);

  results.basicViewActive = await page.evaluate(() => {
    const controller = document.querySelector('#mode-read-aloud .spc-controller');
    return controller && controller.dataset.spcView === 'basic';
  });

  // Click ⚙ Settings button — should open Settings sheet
  await page.evaluate(() => {
    const btn = document.querySelector('#mode-read-aloud .spc-settings-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);

  results.settingsSheetOpenedOnGearBtn = await page.evaluate(() => {
    const sheet = document.getElementById('ra-settings-sheet');
    return sheet && sheet.classList.contains('is-active');
  });

  // Close sheet with close button
  await page.evaluate(() => {
    const closeBtn = document.querySelector('#ra-settings-sheet .spc-sheet-close');
    if (closeBtn) closeBtn.click();
  });
  await page.waitForTimeout(300);

  results.audioPlayerExists = await page.evaluate(() => {
    return !!document.getElementById('ra-audio-player');
  });

  // question-selector is now hidden (settings moved to sheet) — this is expected
  results.questionSelectorHiddenByDesign = await page.evaluate(() => {
    const el = document.querySelector('#mode-read-aloud .question-selector');
    if (!el) return 'not_found';
    return getComputedStyle(el).display === 'none';
  });

  await page.screenshot({ path: path.join(__dirname, 'ra-ux-advanced.png'), fullPage: true });

  console.log('\n=== READ ALOUD UX VERIFICATION ===');
  let allPassed = true;
  for (const [key, val] of Object.entries(results)) {
    const status = val === true ? '✅' : '❌';
    if (val !== true) allPassed = false;
    console.log(`${status} ${key}: ${val}`);
  }
  console.log(`\n${allPassed ? '🎉 ALL PASSED' : '⚠️ SOME CHECKS FAILED'}`);

  await browser.close();
  server.close();
  process.exit(allPassed ? 0 : 1);
})();
