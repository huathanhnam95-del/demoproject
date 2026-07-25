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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    console.log('Navigating to Read Aloud mode...');
    await page.goto(`${baseUrl}/pte-practice/speaking/read-aloud/353`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // 1. Verify Basic mode (default)
    const basicGuidesVisible = await page.evaluate(() => {
      const guides = document.getElementById('ra-prompt-guides-group');
      if (!guides) return false;
      const style = window.getComputedStyle(guides);
      return style.display !== 'none';
    });
    console.log(`1. Basic view - guides visible: ${basicGuidesVisible} (expected: false)`);

    // 2. Click Advanced button
    console.log('Clicking Advanced button...');
    await page.evaluate(() => {
      const panel = document.getElementById('mode-read-aloud');
      const advBtn = panel ? panel.querySelector('.spc-view-toggle-btn[data-view="advanced"]') : null;
      if (advBtn) advBtn.click();
    });
    await page.waitForTimeout(500);

    const advGuidesVisible = await page.evaluate(() => {
      const guides = document.getElementById('ra-prompt-guides-group');
      if (!guides) return false;
      const style = window.getComputedStyle(guides);
      return style.display !== 'none';
    });
    console.log(`2. Advanced view - guides visible: ${advGuidesVisible} (expected: true)`);

    const sheetOpenOnAdv = await page.evaluate(() => {
      const sheet = document.getElementById('ra-settings-sheet');
      return !!(sheet && sheet.classList.contains('is-active'));
    });
    console.log(`3. Advanced view - Settings sheet open: ${sheetOpenOnAdv} (expected: false)`);

    // 3. Click Settings button
    console.log('Clicking Settings button...');
    await page.evaluate(() => {
      const panel = document.getElementById('mode-read-aloud');
      const settingsBtn = panel ? panel.querySelector('.spc-settings-btn') : null;
      if (settingsBtn) settingsBtn.click();
    });
    await page.waitForTimeout(500);

    const sheetOpenOnSettings = await page.evaluate(() => {
      const sheet = document.getElementById('ra-settings-sheet');
      return !!(sheet && sheet.classList.contains('is-active'));
    });
    console.log(`4. Settings click - Settings sheet open: ${sheetOpenOnSettings} (expected: true)`);

    // 4. Verify Difficulty filter chips inside Settings sheet
    const hasDifficultyChips = await page.evaluate(() => {
      const diffAll = document.getElementById('ra-diff-all');
      const diff1 = document.getElementById('ra-diff-1');
      const diff2 = document.getElementById('ra-diff-2');
      const diff3 = document.getElementById('ra-diff-3');
      return !!(diffAll && diff1 && diff2 && diff3);
    });
    console.log(`5. Settings sheet - Multi-factor difficulty chips present: ${hasDifficultyChips} (expected: true)`);

    const success = !basicGuidesVisible && advGuidesVisible && !sheetOpenOnAdv && sheetOpenOnSettings && hasDifficultyChips;

    if (success) {
      console.log('\n🎉 ALL CHECKS PASSED SUCCESSFULLY!');
    } else {
      console.error('\n⚠️ SOME CHECKS FAILED!');
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
