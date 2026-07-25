const { chromium } = require('playwright');
const express = require('express');
const path = require('path');

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });

  const modesToTest = [
    { mode: 'read-aloud', url: '/pte-practice/speaking/read-aloud/353' },
    { mode: 'speak', url: '/pte-practice/speaking/speak/1' },
    { mode: 'type', url: '/pte-practice/listening/type/1' },
    { mode: 'asq', url: '/pte-practice/speaking/asq/1' },
    { mode: 'describe-image', url: '/pte-practice/speaking/describe-image/1' },
    { mode: 'notes', url: '/pte-practice/speaking/notes/1' },
    { mode: 'rts', url: '/pte-practice/speaking/rts/1' },
    { mode: 'sgd', url: '/pte-practice/speaking/sgd/1' }
  ];

  const results = {};

  try {
    for (const testCase of modesToTest) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`${baseUrl}${testCase.url}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      // Check controller
      const controllerExists = await page.evaluate((m) => {
        const panel = document.getElementById(`mode-${m}`);
        return !!(panel && panel.querySelector('.spc-controller'));
      }, testCase.mode);

      // Try clicking Settings button
      const clicked = await page.evaluate((m) => {
        const panel = document.getElementById(`mode-${m}`);
        if (!panel) return false;
        const settingsBtn = panel.querySelector('.spc-settings-btn') || Array.from(panel.querySelectorAll('.spc-view-toggle-btn')).find(b => b.textContent.includes('Settings'));
        if (settingsBtn) {
          settingsBtn.click();
          return true;
        }
        return false;
      }, testCase.mode);

      await page.waitForTimeout(600);

      // Check if settings sheet opened
      const sheetOpened = await page.evaluate((m) => {
        const sheet = document.getElementById(`ra-settings-sheet`) || document.getElementById(`spc-settings-sheet-${m}`);
        return !!(sheet && sheet.classList.contains('is-active'));
      }, testCase.mode);

      results[testCase.mode] = { controllerExists, clicked, sheetOpened };
      await page.close();
    }

    console.log('\n=== ALL MODES SETTINGS BUTTON VERIFICATION ===');
    let allPassed = true;
    for (const [mode, res] of Object.entries(results)) {
      const status = res.controllerExists && res.clicked && res.sheetOpened;
      if (!status) allPassed = false;
      console.log(`${status ? '✅' : '❌'} ${mode}: controller=${res.controllerExists}, clicked=${res.clicked}, sheetOpened=${res.sheetOpened}`);
    }

    if (allPassed) {
      console.log('\n🎉 ALL MODES PASSED SUCCESSFULLY!');
    } else {
      console.log('\n⚠️ SOME MODES FAILED!');
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
