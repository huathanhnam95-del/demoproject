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
  console.log(`Server on ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    // Navigate directly to Speak mode (Repeat Sentence)
    await page.goto(`${baseUrl}/pte-practice/speaking/speak/1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const checks = {};

    // 1. Check main page state
    checks.controllerExists = await page.evaluate(() => !!document.querySelector('#mode-speak .spc-controller'));
    checks.adaptiveNotOnMainPage = await page.evaluate(() => {
      const el = document.getElementById('adaptive-toggle-container-speak');
      if (!el) return true;
      const inSheet = el.closest('.spc-sheet') !== null;
      return inSheet || el.offsetParent === null;
    });

    // 2. Click Settings button
    await page.evaluate(() => {
      const settingsBtn = document.querySelector('#mode-speak .spc-settings-btn');
      if (settingsBtn) settingsBtn.click();
    });
    await page.waitForTimeout(600);

    // 3. Verify settings sheet open state
    checks.sheetOpen = await page.evaluate(() => {
      const sheet = document.getElementById('spc-settings-sheet-speak');
      return sheet && sheet.classList.contains('is-active');
    });

    checks.adaptiveInsideSheet = await page.evaluate(() => {
      const sheet = document.getElementById('spc-settings-sheet-speak');
      if (!sheet) return false;
      const adaptive = sheet.querySelector('#adaptive-toggle-container-speak') || sheet.querySelector('.adaptive-toggle-container');
      return !!adaptive;
    });

    checks.questionTotalRemovedFromSheet = await page.evaluate(() => {
      const sheet = document.getElementById('spc-settings-sheet-speak');
      if (!sheet) return false;
      const total = sheet.querySelector('#total-questions-speak') || sheet.querySelector('.question-total');
      return !total;
    });

    checks.filtersInsideSheet = await page.evaluate(() => {
      const sheet = document.getElementById('spc-settings-sheet-speak');
      if (!sheet) return false;
      const statusFilter = sheet.querySelector('#status-filter-container-speak');
      return !!statusFilter;
    });

    console.log('\n=== SPC SETTINGS SHEET VERIFICATION ===');
    for (const [key, val] of Object.entries(checks)) {
      console.log(`${val ? '✅' : '❌'} ${key}: ${val}`);
    }

    const allPassed = Object.values(checks).every(Boolean);
    if (allPassed) {
      console.log('\n🎉 ALL CHECKS PASSED SUCCESSFULLY!');
    } else {
      console.log('\n⚠️ SOME CHECKS FAILED!');
      process.exit(1);
    }

  } finally {
    await browser.close();
    server.close();
  }
})();
