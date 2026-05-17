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

    assert.deepStrictEqual(pageErrors, [], `Unexpected JS runtime errors: ${pageErrors.join(' | ')}`);
    // Filter known SDK/harness noise from console.error() calls
    const NOISE = /favicon\.ico|net::ERR_|Failed to fetch|firebase|googleapis|identitytoolkit|database|WebSocket|ERR_NAME|400|responded with a status/i;
    const realConsoleErrors = consoleErrors.filter((e) => !NOISE.test(e));
    assert.deepStrictEqual(realConsoleErrors, [], `Unexpected console errors (after noise filter): ${realConsoleErrors.join(' | ')}`);

    await page.click('#btn-panel-srs');
    await page.waitForFunction(() => {
      const panel = document.getElementById('panel-srs');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 15000 });

    await page.click('#btn-panel-tutorials');
    await waitForActivePanel(page, 'panel-tutorials');

    const defaultState = await page.evaluate(() => {
      const speakingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]');
      const readAloudCard = document.getElementById('mode-btn-read-aloud');
      const rfibCard = document.getElementById('mode-btn-rfib');
      return {
        speakingSelected: speakingButton ? speakingButton.getAttribute('aria-pressed') : null,
        readAloudVisible: readAloudCard ? !readAloudCard.hidden : false,
        rfibVisible: rfibCard ? !rfibCard.hidden : false
      };
    });

    assert.strictEqual(defaultState.speakingSelected, 'true', 'Speaking should be selected on first load (defaultSkill is speaking)');
    assert.strictEqual(defaultState.readAloudVisible, true, 'Read Aloud should be visible when Speaking is selected');
    assert.strictEqual(defaultState.rfibVisible, false, 'Reading should not be visible before selecting that skill');

    await page.click('#practice-skill-filter .practice-skill-btn[data-practice-skill="reading"]');

    const readingFilteredState = await page.evaluate(() => {
      const readingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="reading"]');
      const modeType = document.getElementById('mode-btn-type');
      const modeRfib = document.getElementById('mode-btn-rfib');
      return {
        selected: readingButton ? readingButton.getAttribute('aria-pressed') : null,
        typeHidden: modeType ? modeType.hidden : true,
        rfibHidden: modeRfib ? modeRfib.hidden : true
      };
    });

    assert.strictEqual(readingFilteredState.selected, 'true', 'Reading should become the selected skill after clicking the filter');
    assert.strictEqual(readingFilteredState.typeHidden, true, 'Type should be hidden when Reading is selected');
    assert.strictEqual(readingFilteredState.rfibHidden, false, 'RFIB card should be visible when Reading is selected');

    await page.click('#mode-btn-rfib');
    await waitForActivePanel(page, 'mode-rfib');

    const rfibState = await page.evaluate(() => {
      const readingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="reading"]');
      const modeName = document.getElementById('current-mode-name');
      return {
        selected: readingButton ? readingButton.getAttribute('aria-pressed') : null,
        modeName: modeName?.textContent || ''
      };
    });

    assert.strictEqual(rfibState.selected, 'true', 'switchToMode(rfib) should keep Reading selected');
    assert.strictEqual(rfibState.modeName, 'Fill in the blanks', 'RFIB should show its label in the mode indicator');

    // Navigate back to the dashboard before testing the SRS tab.
    // When a mode panel is active (e.g. RFIB), the entire dashboard-modern-container
    // is hidden. exitCurrentMode() restores it.
    await page.evaluate(() => {
      if (typeof exitCurrentMode === 'function') {
        exitCurrentMode();
      } else if (window.exitCurrentMode) {
        window.exitCurrentMode();
      }
    });
    // Wait for the dashboard to reappear
    await page.waitForFunction(() => {
      const dashboard = document.querySelector('.dashboard-modern-container');
      return dashboard && getComputedStyle(dashboard).display !== 'none';
    }, { timeout: 10000 });

    // Now switch to panel-tutorials to ensure the segmented buttons are visible
    await page.evaluate(() => {
      if (typeof toggleDashboardPanel === 'function') {
        toggleDashboardPanel('panel-tutorials');
      }
    });
    await waitForActivePanel(page, 'panel-tutorials');

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
      const indicator = document.getElementById('current-mode-indicator');
      return {
        selected: readingButton ? readingButton.getAttribute('aria-pressed') : null,
        rfibHidden: rfibCard ? rfibCard.hidden : true,
        indicatorHidden: indicator ? (indicator.style.display === 'none') : true
      };
    });

    // After exitCurrentMode → SRS → back to tutorials:
    // The skill filter (Reading) should persist, but mode indicator is hidden
    assert.strictEqual(reentryState.selected, 'true', 'Returning to Learning Center should preserve the Reading filter');
    assert.strictEqual(reentryState.rfibHidden, false, 'Returning to Learning Center should keep the RFIB card visible');
    assert.strictEqual(reentryState.indicatorHidden, true, 'After exiting mode, the indicator should be hidden');

    await page.click('#practice-skill-filter .practice-skill-btn[data-practice-skill="writing"]');
    const writingState = await page.evaluate(() => {
      const writingButton = document.querySelector('#practice-skill-filter .practice-skill-btn[data-practice-skill="writing"]');
      const rfibCard = document.getElementById('mode-btn-rfib');
      const modeName = document.getElementById('current-mode-name');
      return {
        selected: writingButton ? writingButton.getAttribute('aria-pressed') : null,
        rfibHidden: rfibCard ? rfibCard.hidden : true,
        modeName: modeName?.textContent || ''
      };
    });

    assert.strictEqual(writingState.selected, 'true', 'Writing should become selected when the filter is clicked');
    assert.strictEqual(writingState.rfibHidden, true, 'Reading cards should hide when Writing is selected');
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
