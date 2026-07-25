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

    // Switch to Advanced view to show prompt guides
    await page.evaluate(() => {
      const panel = document.getElementById('mode-read-aloud');
      const advBtn = panel ? panel.querySelector('.spc-view-toggle-btn[data-view="advanced"]') : null;
      if (advBtn) advBtn.click();
    });
    await page.waitForTimeout(600);

    // 1. Test Chunking toggle (ON -> OFF)
    console.log('Testing Chunking button toggle...');
    await page.evaluate(() => {
      document.getElementById('ra-toggle-chunking-btn')?.click();
    });
    await page.waitForTimeout(300);
    const chunkOn = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-chunking-btn');
      return btn ? btn.getAttribute('aria-pressed') === 'true' : false;
    });
    console.log(`Chunking clicked 1st time - active: ${chunkOn} (expected: true)`);

    await page.evaluate(() => {
      document.getElementById('ra-toggle-chunking-btn')?.click();
    });
    await page.waitForTimeout(300);
    const chunkOff = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-chunking-btn');
      return btn ? btn.getAttribute('aria-pressed') === 'false' : false;
    });
    console.log(`Chunking clicked 2nd time - unticked/off: ${chunkOff} (expected: true)`);

    // 2. Test Linking toggle (ON -> OFF)
    console.log('Testing Linking button toggle...');
    await page.evaluate(() => {
      document.getElementById('ra-toggle-linking-btn')?.click();
    });
    await page.waitForTimeout(300);
    const linkingOn = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-linking-btn');
      return btn ? btn.getAttribute('aria-pressed') === 'true' : false;
    });
    console.log(`Linking clicked 1st time - active: ${linkingOn} (expected: true)`);

    await page.evaluate(() => {
      document.getElementById('ra-toggle-linking-btn')?.click();
    });
    await page.waitForTimeout(300);
    const linkingOff = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-linking-btn');
      return btn ? btn.getAttribute('aria-pressed') === 'false' : false;
    });
    console.log(`Linking clicked 2nd time - unticked/off: ${linkingOff} (expected: true)`);

    // 3. Test Reduced Words toggle (ON -> OFF)
    console.log('Testing Reduced Words button toggle...');
    await page.evaluate(() => {
      document.getElementById('ra-toggle-reduced-words-btn')?.click();
    });
    await page.waitForTimeout(300);
    const reducedOn = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-reduced-words-btn');
      return btn ? btn.getAttribute('aria-pressed') === 'true' : false;
    });
    console.log(`Reduced Words clicked 1st time - active: ${reducedOn} (expected: true)`);

    await page.evaluate(() => {
      document.getElementById('ra-toggle-reduced-words-btn')?.click();
    });
    await page.waitForTimeout(300);
    const reducedOff = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-reduced-words-btn');
      return btn ? btn.getAttribute('aria-pressed') === 'false' : false;
    });
    console.log(`Reduced Words clicked 2nd time - unticked/off: ${reducedOff} (expected: true)`);

    const success = chunkOn && chunkOff && linkingOn && linkingOff && reducedOn && reducedOff;

    if (success) {
      console.log('\n🎉 ALL GUIDE TOGGLE CHECKS PASSED SUCCESSFULLY!');
    } else {
      console.error('\n⚠️ SOME CHECKS FAILED!');
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
