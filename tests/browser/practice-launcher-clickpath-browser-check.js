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
      // The preloader may already be closing on its own; keep going.
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
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.addInitScript(() => {
    ['type', 'collo-dictate', 'speak', 'extended', 'watch', 'notes', 'pronounce', 'read-aloud', 'rfib'].forEach((mode) => {
      localStorage.setItem(`${mode}ModeFirstUse`, 'true');
    });
  });

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await dismissBlockingOverlays(page);

    assert.deepStrictEqual(pageErrors, [], `Expected no page errors, got: ${pageErrors.join(' | ')}`);
    assert.deepStrictEqual(consoleErrors, [], `Expected no console errors, got: ${consoleErrors.join(' | ')}`);

    await page.click('#btn-panel-srs');
    await page.waitForFunction(() => {
      const panel = document.getElementById('panel-srs');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 15000 });

    await page.click('#btn-panel-tutorials');
    await waitForActivePanel(page, 'panel-tutorials');

    const defaultState = await page.evaluate(() => {
      const listeningButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="listening"]');
      const typeCard = document.getElementById('mode-btn-type');
      const rfibCard = document.getElementById('mode-btn-rfib');
      return {
        listeningSelected: listeningButton ? listeningButton.getAttribute('aria-pressed') : null,
        typeVisible: typeCard ? getComputedStyle(typeCard).display !== 'none' : false,
        rfibVisible: rfibCard ? getComputedStyle(rfibCard).display !== 'none' : false
      };
    });

    assert.strictEqual(defaultState.listeningSelected, 'true', 'Listening should be selected on first load');
    assert.strictEqual(defaultState.typeVisible, true, 'Type should be visible on first load');
    assert.strictEqual(defaultState.rfibVisible, false, 'Reading should not be visible before selecting that skill');

    await page.click('#practice-skill-filter .practice-skill-btn[data-practice-skill="reading"]');

    const readingFilteredState = await page.evaluate(() => {
      const readingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="reading"]');
      const modeType = document.getElementById('mode-btn-type');
      const modeRfib = document.getElementById('mode-btn-rfib');
      const writingEmpty = document.getElementById('practice-writing-empty');
      const modeName = document.getElementById('current-mode-name');
      return {
        selected: readingButton ? readingButton.getAttribute('aria-pressed') : null,
        typeVisible: modeType ? getComputedStyle(modeType).display !== 'none' : false,
        rfibVisible: modeRfib ? getComputedStyle(modeRfib).display !== 'none' : false,
        writingVisible: writingEmpty ? getComputedStyle(writingEmpty).display !== 'none' : false,
        modeName: modeName?.textContent || ''
      };
    });

    assert.strictEqual(readingFilteredState.selected, 'true', 'Reading should become the selected skill after clicking the filter');
    assert.strictEqual(readingFilteredState.typeVisible, false, 'Type should be hidden when Reading is selected');
    assert.strictEqual(readingFilteredState.rfibVisible, true, 'Reading should expose the live RFIB card');
    assert.strictEqual(readingFilteredState.writingVisible, false, 'Writing should stay hidden when Reading is selected');
    assert.strictEqual(readingFilteredState.modeName, 'Type', 'Skill filtering alone should not change the active mode');

    await page.click('#mode-btn-rfib');
    await waitForActivePanel(page, 'mode-rfib');

    const rfibState = await page.evaluate(() => {
      const readingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="reading"]');
      const modeName = document.getElementById('current-mode-name');
      const tutorialBtn = document.getElementById('mode-tutorial-btn');
      return {
        selected: readingButton ? readingButton.getAttribute('aria-pressed') : null,
        modeName: modeName?.textContent || '',
        tutorialVisible: tutorialBtn ? getComputedStyle(tutorialBtn).display !== 'none' : false,
        tutorialHidden: tutorialBtn ? tutorialBtn.hidden : null
      };
    });

    assert.strictEqual(rfibState.selected, 'true', 'switchToMode(rfib) should keep Reading selected');
    assert.strictEqual(rfibState.modeName, 'Fill in the blanks', 'RFIB should show the Reading launcher label');
    assert.strictEqual(rfibState.tutorialVisible, false, 'RFIB should not expose a tutorial button');
    assert.strictEqual(rfibState.tutorialHidden, true, 'RFIB should keep the tutorial button hidden');

    await page.click('#btn-panel-srs');
    await page.waitForFunction(() => {
      const panel = document.getElementById('panel-srs');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 15000 });

    await page.click('#btn-panel-tutorials');
    await waitForActivePanel(page, 'panel-tutorials');

    const reentryState = await page.evaluate(() => {
      const readingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="reading"]');
      const rfibCard = document.getElementById('mode-btn-rfib');
      const modeName = document.getElementById('current-mode-name');
      return {
        selected: readingButton ? readingButton.getAttribute('aria-pressed') : null,
        rfibVisible: rfibCard ? getComputedStyle(rfibCard).display !== 'none' : false,
        modeName: modeName?.textContent || ''
      };
    });

    assert.strictEqual(reentryState.selected, 'true', 'Returning to Learning Center should preserve the Reading filter');
    assert.strictEqual(reentryState.rfibVisible, true, 'Returning to Learning Center should keep the RFIB card visible');
    assert.strictEqual(reentryState.modeName, 'Fill in the blanks', 'Returning to Learning Center should keep the RFIB current-mode label');

    await page.click('#practice-skill-filter .practice-skill-btn[data-practice-skill="writing"]');
    const writingState = await page.evaluate(() => {
      const writingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="writing"]');
      const rfibCard = document.getElementById('mode-btn-rfib');
      const writingEmpty = document.getElementById('practice-writing-empty');
      const modeName = document.getElementById('current-mode-name');
      return {
        selected: writingButton ? writingButton.getAttribute('aria-pressed') : null,
        rfibVisible: rfibCard ? getComputedStyle(rfibCard).display !== 'none' : false,
        writingVisible: writingEmpty ? getComputedStyle(writingEmpty).display !== 'none' : false,
        modeName: modeName?.textContent || ''
      };
    });

    assert.strictEqual(writingState.selected, 'true', 'Writing should become selected when the filter is clicked');
    assert.strictEqual(writingState.rfibVisible, false, 'Reading cards should hide when Writing is selected');
    assert.strictEqual(writingState.writingVisible, true, 'Writing should show its empty state');
    assert.strictEqual(writingState.modeName, 'Fill in the blanks', 'Writing filter changes should not change the active mode');

    await page.screenshot({ path: 'tmp/practice-launcher-clickpath-browser-check.png', fullPage: true });
    console.log('Practice launcher click-path browser verification complete.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
