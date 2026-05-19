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

  await page.waitForFunction(() => {
    const entryModal = document.getElementById('entry-modal');
    const wrapper = document.getElementById('page-layout-wrapper');
    const modalHidden = !entryModal || getComputedStyle(entryModal).display === 'none';
    const wrapperVisible = !!wrapper && getComputedStyle(wrapper).display !== 'none';
    return modalHidden && wrapperVisible;
  }, { timeout: 15000 });
}

let pageErrors = [];
let consoleErrors = [];

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await dismissBlockingOverlays(page);

    assert.deepStrictEqual(pageErrors, [], `Unexpected JS runtime errors: ${pageErrors.join(' | ')}`);

    console.log('Verifying floating side banner toggles are hidden...');
    const togglesStyle = await page.evaluate(() => {
      const vocabToggle = document.getElementById('vocab-panel-toggle');
      const progressToggle = document.getElementById('progress-panel-toggle');
      return {
        vocabHidden: vocabToggle ? getComputedStyle(vocabToggle).display === 'none' : true,
        progressHidden: progressToggle ? getComputedStyle(progressToggle).display === 'none' : true
      };
    });

    assert.strictEqual(togglesStyle.vocabHidden, true, 'Vocab panel floating toggle button should be hidden');
    assert.strictEqual(togglesStyle.progressHidden, true, 'Progress panel floating toggle button should be hidden');
    console.log('✅ Side banner toggles are successfully hidden!');

    console.log('Verifying profile/account button is in the site header...');
    const accountButtonState = await page.evaluate(() => {
      const headerNav = document.querySelector('.site-header__links');
      const buttons = Array.from(document.querySelectorAll('#account-panel-toggle'));
      const panelOwnButton = document.querySelector('#account-panel-side > #account-panel-toggle');
      return {
        count: buttons.length,
        inHeader: Boolean(headerNav && buttons[0] && headerNav.contains(buttons[0])),
        panelOwnButtonExists: Boolean(panelOwnButton),
        accessibleName: buttons[0]?.getAttribute('aria-label') || buttons[0]?.title || ''
      };
    });

    assert.deepStrictEqual(
      accountButtonState,
      { count: 1, inHeader: true, panelOwnButtonExists: false, accessibleName: 'Account' },
      'Account panel toggle should be a single header-owned control'
    );
    await page.click('#account-panel-toggle');
    await page.waitForFunction(() => {
      const panel = document.getElementById('account-panel-side');
      return !!panel && panel.classList.contains('expanded');
    }, { timeout: 5000 });
    await page.click('#panel-close-btn');
    await page.waitForFunction(() => {
      const panel = document.getElementById('account-panel-side');
      return !!panel && !panel.classList.contains('expanded');
    }, { timeout: 5000 });
    console.log('✅ Account/profile button is correctly placed in the site header!');

    // Switch to panel-srs (For Growth section)
    await page.click('#btn-panel-srs');
    await page.waitForFunction(() => {
      const panel = document.getElementById('panel-srs');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 15000 });

    console.log('Verifying Vocab Book dashboard card functionality...');
    // Click on the Vocab Book card (which replaces Daily Review)
    const cardTitle = await page.innerText('.srs-card-modern h3');
    assert.strictEqual(cardTitle.trim(), 'Vocab Book', 'Growth card title should be "Vocab Book"');

    // Clicking Vocab Book card should open the Vocab Book List Modal
    await page.click('.srs-card-modern');
    await page.waitForFunction(() => {
      const modal = document.getElementById('vocab-list-modal');
      return !!modal && modal.classList.contains('active') && getComputedStyle(modal).display !== 'none';
    }, { timeout: 5000 });
    console.log('✅ Vocab Book card correctly triggers the Vocab Book list modal!');

    // Close the list modal by clicking close button
    await page.click('#vocab-list-close');
    console.log('Close button clicked! Waiting for collapse...');
    await page.waitForFunction(() => {
      const modal = document.getElementById('vocab-list-modal');
      return !!modal && !modal.classList.contains('active');
    }, { timeout: 10000 });
    console.log('✅ Vocab Book list modal successfully closed!');

    console.log('Verifying Track Progress dashboard card functionality...');
    // Click on Track Progress card, which should open the Progress panel
    await page.click('.stats-card-modern');
    await page.waitForFunction(() => {
      const panel = document.getElementById('progress-panel-side');
      return !!panel && panel.classList.contains('expanded');
    }, { timeout: 5000 });
    console.log('✅ Track Progress card correctly triggers the Progress side panel!');

    console.log('🎉 All UI refactoring checks passed successfully!');

    // Screenshot
    const fs = require('fs');
    fs.mkdirSync(path.join(__dirname, '..', '..', 'tmp'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'ui-refactor-success.png'), fullPage: true });

  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error('❌ Test failed:', error.stack || error.message);
  if (pageErrors.length) {
    console.error('Page errors encountered:', pageErrors);
  }
  if (consoleErrors.length) {
    console.error('Console errors encountered:', consoleErrors);
  }
  process.exit(1);
});
