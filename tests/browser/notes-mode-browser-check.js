/* eslint-disable no-console */
const assert = require('assert');
const { chromium } = require('playwright');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

async function waitForPageReady(page) {
  await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
  const guest = page.locator('#guest-mode-btn');
  if (await guest.isVisible().catch(() => false)) await guest.click();
}

(async () => {
  const server = app.listen(0);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    window.sessionStorage.setItem('guestMode', 'true');
    window.sessionStorage.setItem('welcomeModalDismissed', 'true');
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    window.localStorage.setItem('notesModeFirstUse', 'true');
    window.localStorage.setItem('rtsModeFirstUse', 'true');
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page);

    await page.evaluate(() => window.switchToMode('notes'));
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-notes');
      return panel && getComputedStyle(panel).display !== 'none' && document.querySelector('#mode-notes .spc-controller');
    }, { timeout: 30000 });

    const initialState = await page.evaluate(() => ({
      controllerCount: document.querySelectorAll('#mode-notes .spc-controller').length,
      legacySelectorHidden: getComputedStyle(document.querySelector('#mode-notes > .question-selector')).display === 'none',
      playVisible: getComputedStyle(document.getElementById('play-notes-btn')).display !== 'none',
      submitVisible: getComputedStyle(document.getElementById('notes-submit-btn')).display !== 'none',
      retryVisible: getComputedStyle(document.getElementById('notes-retry-btn')).display !== 'none'
    }));
    assert.strictEqual(initialState.controllerCount, 1, 'RL should have exactly one active controller');
    assert.strictEqual(initialState.legacySelectorHidden, true, 'RL legacy selector should be hidden after controller adoption');
    assert.strictEqual(initialState.playVisible, true, 'RL should show Play before practice starts');
    assert.strictEqual(initialState.submitVisible, false, 'RL should hide Submit before the audio step');
    assert.strictEqual(initialState.retryVisible, false, 'RL should hide Retry before results exist');

    await page.evaluate(() => window.switchToMode('rts'));
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-rts');
      return panel && getComputedStyle(panel).display !== 'none';
    }, { timeout: 30000 });

    const transitionState = await page.evaluate(() => ({
      activeMode: window.appState?.currentMode || '',
      notesControllers: document.querySelectorAll('#mode-notes .spc-controller').length,
      rtsControllers: document.querySelectorAll('#mode-rts .spc-controller').length,
      bodyOverflow: document.body.style.overflow
    }));
    assert.strictEqual(transitionState.activeMode, 'rts', 'Switching away from RL should settle on RTS');
    assert.strictEqual(transitionState.notesControllers, 0, 'RL controller should be unmounted during the transition');
    assert.strictEqual(transitionState.rtsControllers, 1, 'RTS should have exactly one controller after the transition');
    assert.notStrictEqual(transitionState.bodyOverflow, 'hidden', 'A mode transition should not leave the page scroll-locked');

    const confirmationRaceState = await page.evaluate(async () => {
      await window.switchToMode('essay');

      const originalConfirm = window.showCustomConfirm;
      const originalShouldConfirmExit = window.WriteEssayMode?.shouldConfirmExit;
      const originalTakeNotes = window.TakeNotesMode;
      const originalRts = window.RTSMode;
      const loader = window.BELLazyLoader;
      const originalEnsureModeScripts = loader?.ensureModeScripts;
      const confirmationResolvers = [];

      if (window.WriteEssayMode) {
        window.WriteEssayMode.shouldConfirmExit = () => true;
      }
      if (loader) loader.ensureModeScripts = async () => true;
      window.TakeNotesMode = {
        loadEntries: async () => {},
        onExit: () => {}
      };
      window.RTSMode = {
        onEnter: async () => {},
        onExit: () => {},
        getItems: () => [{ id: '1', label: 'RTS question' }],
        getCurrentId: () => '1',
        select: () => {}
      };
      window.showCustomConfirm = () => new Promise(resolve => confirmationResolvers.push(resolve));

      try {
        const olderRequest = window.switchToMode('notes');
        const newerRequest = window.switchToMode('rts');

        for (let attempt = 0; attempt < 50 && confirmationResolvers.length < 2; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (confirmationResolvers.length !== 2) {
          throw new Error(`Expected two pending confirmations, found ${confirmationResolvers.length}`);
        }

        confirmationResolvers[1](true);
        await newerRequest;
        confirmationResolvers[0](true);
        await olderRequest;
        await new Promise(resolve => setTimeout(resolve, 80));

        return {
          activeMode: window.appState?.currentMode || '',
          notesVisible: getComputedStyle(document.getElementById('mode-notes')).display !== 'none',
          rtsVisible: getComputedStyle(document.getElementById('mode-rts')).display !== 'none'
        };
      } finally {
        window.showCustomConfirm = originalConfirm;
        if (window.WriteEssayMode) {
          window.WriteEssayMode.shouldConfirmExit = originalShouldConfirmExit;
        }
        window.TakeNotesMode = originalTakeNotes;
        window.RTSMode = originalRts;
        if (loader) loader.ensureModeScripts = originalEnsureModeScripts;
      }
    });
    assert.strictEqual(confirmationRaceState.activeMode, 'rts', 'The newest confirmed transition must win');
    assert.strictEqual(confirmationRaceState.notesVisible, false, 'A stale confirmed transition must not reveal RL');
    assert.strictEqual(confirmationRaceState.rtsVisible, true, 'The latest requested mode must remain visible');
    assert.deepStrictEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.join(' | ')}`);

    console.log('Retell Lecture controller lifecycle browser check passed');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
