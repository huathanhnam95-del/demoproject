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
      // ignore
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

  await page.waitForFunction(() => {
    const entryModal = document.getElementById('entry-modal');
    const wrapper = document.getElementById('page-layout-wrapper');
    const modalHidden = !entryModal || getComputedStyle(entryModal).display === 'none';
    const wrapperVisible = !!wrapper && getComputedStyle(wrapper).display !== 'none';
    return modalHidden && wrapperVisible;
  }, { timeout: 15000 });
}

async function waitForActivePanel(page, panelId) {
  await page.waitForFunction((expectedPanelId) => {
    const panel = document.getElementById(expectedPanelId);
    return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
  }, panelId, { timeout: 15000 });
}

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
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

    const defaultState = await page.evaluate(() => {
      const englishScopeBtn = document.querySelector('#practice-scope-filter .practice-scope-btn[data-practice-scope="english"]');
      const listeningBtn = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="listening"]');
      return {
        englishPressed: englishScopeBtn ? englishScopeBtn.getAttribute('aria-pressed') : null,
        listeningPressed: listeningBtn ? listeningBtn.getAttribute('aria-pressed') : null
      };
    });

    assert.strictEqual(defaultState.englishPressed, 'true', 'English Practice should be selected by default');
    assert.strictEqual(defaultState.listeningPressed, 'true', 'Listening should be selected by default');

    await page.click('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');

    const englishSpeakingState = await page.evaluate(() => {
      const notesCard = document.getElementById('mode-btn-notes');
      const speakCardTitle = document.querySelector('#mode-btn-speak .card-body h3');
      return {
        notesVisible: notesCard ? getComputedStyle(notesCard).display !== 'none' : false,
        speakTitle: speakCardTitle ? speakCardTitle.textContent.trim() : ''
      };
    });

    assert.strictEqual(englishSpeakingState.notesVisible, false, 'Notes should be hidden under Speaking in English scope');
    assert.strictEqual(englishSpeakingState.speakTitle, 'Repeat', 'English scope should keep the original Speak card label');

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
        speakVisible: speakCard ? getComputedStyle(speakCard).display !== 'none' : false,
        notesVisible: notesCard ? getComputedStyle(notesCard).display !== 'none' : false,
        readAloudVisible: readAloudCard ? getComputedStyle(readAloudCard).display !== 'none' : false,
        pronounceVisible: pronounceCard ? getComputedStyle(pronounceCard).display !== 'none' : false,
        speakTitle,
        notesTitle
      };
    });

    assert.strictEqual(pteSpeakingState.readAloudVisible, true, 'Read Aloud should be visible in PTE Speaking');
    assert.strictEqual(pteSpeakingState.speakVisible, true, 'Speak should be visible in PTE Speaking');
    assert.strictEqual(pteSpeakingState.notesVisible, true, 'Notes should be visible in PTE Speaking');
    assert.strictEqual(pteSpeakingState.pronounceVisible, false, 'Pronounce should be hidden in PTE scope');
    assert.strictEqual(pteSpeakingState.speakTitle, 'Repeat Sentence', 'Speak card should rename in PTE scope');
    assert.strictEqual(pteSpeakingState.notesTitle, 'Retell Lecture', 'Notes card should rename in PTE scope');

    await page.click('#mode-btn-notes');
    await waitForActivePanel(page, 'mode-notes');

    const pteNotesState = await page.evaluate(() => {
      const speakingBtn = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');
      const indicator = document.getElementById('current-mode-indicator');
      const modeName = document.getElementById('current-mode-name');
      return {
        speakingPressed: speakingBtn ? speakingBtn.getAttribute('aria-pressed') : null,
        indicatorVisible: indicator ? getComputedStyle(indicator).display !== 'none' : false,
        modeName: modeName?.textContent?.trim() || ''
      };
    });

    assert.strictEqual(pteNotesState.speakingPressed, 'true', 'Notes in PTE scope should map to Speaking');
    assert.strictEqual(pteNotesState.indicatorVisible, true, 'Switching modes should show the mode indicator');
    assert.strictEqual(pteNotesState.modeName, 'Retell Lecture', 'Mode indicator should use the PTE label for Notes');

    await page.click('#practice-scope-filter .practice-scope-btn[data-practice-scope="english"]');

    const restoredEnglishNotesState = await page.evaluate(() => {
      const listeningBtn = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="listening"]');
      const indicator = document.getElementById('current-mode-indicator');
      const modeName = document.getElementById('current-mode-name');
      const notesPanel = document.getElementById('mode-notes');
      return {
        listeningPressed: listeningBtn ? listeningBtn.getAttribute('aria-pressed') : null,
        indicatorVisible: indicator ? getComputedStyle(indicator).display !== 'none' : false,
        modeName: modeName?.textContent?.trim() || '',
        notesPanelVisible: notesPanel ? getComputedStyle(notesPanel).display !== 'none' : false
      };
    });

    assert.strictEqual(restoredEnglishNotesState.listeningPressed, 'true', 'Notes should remap back to Listening in English scope');
    assert.strictEqual(restoredEnglishNotesState.indicatorVisible, true, 'Switching back to English should preserve the active mode indicator');
    assert.strictEqual(restoredEnglishNotesState.modeName, 'Take Notes', 'Mode indicator should revert to the English Notes label');
    assert.strictEqual(restoredEnglishNotesState.notesPanelVisible, true, 'Notes should remain the active panel when it is still visible in the new scope');

    const backToEnglishState = await page.evaluate(() => {
      const notesCard = document.getElementById('mode-btn-notes');
      const notesTitle = document.querySelector('#mode-btn-notes .card-body h3')?.textContent?.trim() || '';
      const typeTitle = document.querySelector('#mode-btn-type .card-body h3')?.textContent?.trim() || '';
      return {
        notesVisible: notesCard ? getComputedStyle(notesCard).display !== 'none' : false,
        notesTitle,
        typeTitle
      };
    });

    assert.strictEqual(backToEnglishState.notesVisible, true, 'Notes should return under Listening in English scope');
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
