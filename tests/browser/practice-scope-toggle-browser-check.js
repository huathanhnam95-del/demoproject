/* eslint-disable no-console */
/**
 * Practice Scope Toggle – Browser Verification
 *
 * Tests the English ↔ PTE scope toggle and validates:
 *   - Default state (English scope, Speaking skill selected)
 *   - Mode card visibility changes when switching scopes
 *   - PTE-specific mode label overrides (Repeat Sentence, Retell Lecture, etc.)
 *   - Scope persistence through mode navigation
 *   - Mode indicator label updates when switching back to English scope
 *
 * Requires: Playwright (npx playwright install chromium)
 */

const { chromium } = require('playwright');
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');

async function dismissBlockingOverlays(page) {
  // Dismiss cookie, preloader, tutorial, and entry overlays
  await page.evaluate(() => {
    const preloader = document.querySelector('.app-preloader');
    if (preloader) preloader.style.display = 'none';
    document.querySelectorAll('.tutorial-overlay, .cookie-banner').forEach((el) => el.remove());
    // Dismiss the entry-modal that intercepts pointer events
    const entryModal = document.getElementById('entry-modal');
    if (entryModal) {
      entryModal.style.display = 'none';
      entryModal.remove();
    }
  });
}

async function waitForActivePanel(page, panelId) {
  await page.waitForFunction(
    (id) => {
      const panel = document.getElementById(id);
      return panel && panel.classList.contains('active');
    },
    panelId,
    { timeout: 15000 }
  );
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

(async () => {
  const { server, origin } = await startHarnessServer();
  console.log(`Scope toggle harness running at ${origin}`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Pre-seed localStorage to skip first-use tutorials
  await page.goto(`${origin}/index.html`, { waitUntil: 'commit' });
  await page.evaluate(() => {
    [
      'type',
      'collo-dictate',
      'speak',
      'extended',
      'watch',
      'notes',
      'pronounce',
      'read-aloud',
      'rfib'
    ].forEach((mode) => {
      localStorage.setItem(`${mode}ModeFirstUse`, 'true');
    });
    localStorage.removeItem('practiceScope');
  });

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await dismissBlockingOverlays(page);

    assert.deepStrictEqual(pageErrors, [], `Unexpected JS runtime errors: ${pageErrors.join(' | ')}`);
    // Filter known SDK/harness noise from console.error() calls
    const NOISE = /favicon\.ico|net::ERR_|Failed to fetch|firebase|googleapis|identitytoolkit|database|WebSocket|ERR_NAME|400|responded with a status/i;
    const realConsoleErrors = consoleErrors.filter((e) => !NOISE.test(e));
    assert.deepStrictEqual(realConsoleErrors, [], `Unexpected console errors (after noise filter): ${realConsoleErrors.join(' | ')}`);

    // ─────────────────────────────────────────────────────
    // 1. Default state: English scope, Speaking skill selected
    // ─────────────────────────────────────────────────────
    const defaultState = await page.evaluate(() => {
      const englishScopeBtn = document.querySelector('#practice-scope-filter .practice-scope-btn[data-practice-scope="english"]');
      const pteScopeBtn = document.querySelector('#practice-scope-filter .practice-scope-btn[data-practice-scope="pte"]');
      const speakingBtn = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');
      return {
        englishPressed: englishScopeBtn ? englishScopeBtn.getAttribute('aria-pressed') : null,
        ptePressed: pteScopeBtn ? pteScopeBtn.getAttribute('aria-pressed') : null,
        speakingPressed: speakingBtn ? speakingBtn.getAttribute('aria-pressed') : null
      };
    });

    assert.strictEqual(defaultState.ptePressed, 'true', 'PTE Practice should be selected by default');
    assert.strictEqual(defaultState.englishPressed, 'false', 'English Practice should not be selected by default');
    assert.strictEqual(defaultState.speakingPressed, 'true', 'Speaking should be selected by default');

    // ─────────────────────────────────────────────────────
    // 2. English + Speaking: Notes should be hidden (it's under Listening)
    // ─────────────────────────────────────────────────────
    await page.click('#practice-scope-filter .practice-scope-btn[data-practice-scope="english"]');
    await page.click('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');

    const englishSpeakingState = await page.evaluate(() => {
      const notesCard = document.getElementById('mode-btn-notes');
      const readAloudCard = document.getElementById('mode-btn-read-aloud');
      return {
        notesHidden: notesCard ? notesCard.hidden : true,
        readAloudHidden: readAloudCard ? readAloudCard.hidden : true
      };
    });

    assert.strictEqual(englishSpeakingState.notesHidden, true, 'Notes should be hidden under Speaking in English scope');
    assert.strictEqual(englishSpeakingState.readAloudHidden, false, 'Read Aloud should be visible under Speaking in English scope');

    // ─────────────────────────────────────────────────────
    // 3. Switch to PTE scope + Speaking
    // ─────────────────────────────────────────────────────
    await page.click('#practice-scope-filter .practice-scope-btn[data-practice-scope="pte"]');
    await page.click('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');

    const pteSpeakingState = await page.evaluate(() => {
      const speakCard = document.getElementById('mode-btn-speak');
      const notesCard = document.getElementById('mode-btn-notes');
      const readAloudCard = document.getElementById('mode-btn-read-aloud');
      const pronounceCard = document.getElementById('mode-btn-pronounce');
      const speakTitle = document.querySelector('#mode-btn-speak .card-body h3')?.textContent?.trim() || '';
      const notesTitle = document.querySelector('#mode-btn-notes .card-body h3')?.textContent?.trim() || '';
      return {
        speakHidden: speakCard ? speakCard.hidden : true,
        notesHidden: notesCard ? notesCard.hidden : true,
        readAloudHidden: readAloudCard ? readAloudCard.hidden : true,
        pronounceHidden: pronounceCard ? pronounceCard.hidden : true,
        speakTitle,
        notesTitle
      };
    });

    assert.strictEqual(pteSpeakingState.readAloudHidden, false, 'Read Aloud should be visible in PTE Speaking');
    assert.strictEqual(pteSpeakingState.speakHidden, false, 'Speak should be visible in PTE Speaking');
    assert.strictEqual(pteSpeakingState.notesHidden, false, 'Notes should be visible in PTE Speaking (remapped to speaking)');
    assert.strictEqual(pteSpeakingState.pronounceHidden, true, 'Pronounce should be hidden in PTE scope');
    assert.strictEqual(pteSpeakingState.speakTitle, 'Repeat Sentence', 'Speak card should rename in PTE scope');
    assert.strictEqual(pteSpeakingState.notesTitle, 'Retell Lecture', 'Notes card should rename in PTE scope');

    // ─────────────────────────────────────────────────────
    // 4. Navigate into Notes mode in PTE scope
    // ─────────────────────────────────────────────────────
    await page.click('#mode-btn-notes');
    await waitForActivePanel(page, 'mode-notes');

    const pteNotesState = await page.evaluate(() => {
      const speakingBtn = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');
      const indicator = document.getElementById('current-mode-indicator');
      const modeName = document.getElementById('current-mode-name');
      return {
        speakingPressed: speakingBtn ? speakingBtn.getAttribute('aria-pressed') : null,
        indicatorVisible: indicator ? indicator.style.display !== 'none' : false,
        modeName: modeName?.textContent?.trim() || ''
      };
    });

    assert.strictEqual(pteNotesState.speakingPressed, 'true', 'Notes in PTE scope should map to Speaking');
    assert.strictEqual(pteNotesState.indicatorVisible, true, 'Switching modes should show the mode indicator');
    assert.strictEqual(pteNotesState.modeName, 'Retell Lecture', 'Mode indicator should use the PTE label for Notes');

    // ─────────────────────────────────────────────────────
    // 5. Go back to dashboard, then switch to English scope
    //    When a mode panel is active, the dashboard-modern-container is hidden.
    //    Use page.evaluate to call setPracticeScope and exitCurrentMode directly.
    // ─────────────────────────────────────────────────────
    await page.evaluate(() => {
      // Use setPracticeScope (the full function) which handles UI updates
      if (window.setPracticeScope) {
        window.setPracticeScope('english');
      }
    });
    // Wait for scope change to propagate
    await page.waitForFunction(() => {
      const englishBtn = document.querySelector('#practice-scope-filter .practice-scope-btn[data-practice-scope="english"]');
      return englishBtn && englishBtn.getAttribute('aria-pressed') === 'true';
    }, { timeout: 10000 });

    const restoredEnglishState = await page.evaluate(() => {
      const speakingBtn = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');
      const listeningBtn = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="listening"]');
      const indicator = document.getElementById('current-mode-indicator');
      const modeName = document.getElementById('current-mode-name');
      return {
        speakingPressed: speakingBtn ? speakingBtn.getAttribute('aria-pressed') : null,
        listeningPressed: listeningBtn ? listeningBtn.getAttribute('aria-pressed') : null,
        indicatorVisible: indicator ? indicator.style.display !== 'none' : false,
        modeName: modeName?.textContent?.trim() || ''
      };
    });

    // Notes in English scope maps to Listening skill
    assert.strictEqual(restoredEnglishState.listeningPressed, 'true', 'Notes should remap back to Listening in English scope');
    assert.strictEqual(restoredEnglishState.indicatorVisible, true, 'Switching back to English should preserve the active mode indicator');
    assert.strictEqual(restoredEnglishState.modeName, 'Take Notes', 'Mode indicator should revert to the English Notes label');

    // ─────────────────────────────────────────────────────
    // 6. Verify mode card labels reverted in English scope
    //    First exit the mode to restore the dashboard
    // ─────────────────────────────────────────────────────
    await page.evaluate(() => {
      if (window.exitCurrentMode) window.exitCurrentMode();
    });
    await page.waitForFunction(() => {
      const dashboard = document.querySelector('.dashboard-modern-container');
      return dashboard && getComputedStyle(dashboard).display !== 'none';
    }, { timeout: 10000 });

    // Ensure tutorials panel is visible
    await page.evaluate(() => {
      if (typeof toggleDashboardPanel === 'function') toggleDashboardPanel('panel-tutorials');
    });
    await waitForActivePanel(page, 'panel-tutorials');

    await page.click('#practice-skill-filter .practice-skill-btn[data-practice-skill="listening"]');

    const backToEnglishState = await page.evaluate(() => {
      const notesCard = document.getElementById('mode-btn-notes');
      const notesTitle = document.querySelector('#mode-btn-notes .card-body h3')?.textContent?.trim() || '';
      const typeTitle = document.querySelector('#mode-btn-type .card-body h3')?.textContent?.trim() || '';
      return {
        notesHidden: notesCard ? notesCard.hidden : true,
        notesTitle,
        typeTitle
      };
    });

    assert.strictEqual(backToEnglishState.notesHidden, false, 'Notes should return under Listening in English scope');
    assert.strictEqual(backToEnglishState.notesTitle, 'Take Notes', 'Notes card title should revert in English scope');
    assert.strictEqual(backToEnglishState.typeTitle, 'Dictate', 'Type card title should remain in English scope');

    await page.screenshot({ path: 'tmp/practice-scope-toggle-browser-check.png', fullPage: true });
    console.log('Practice scope toggle browser verification complete.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
