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
    console.log('Testing IPA weak form reduction mapping...');
    await page.goto(`${baseUrl}/pte-practice/speaking/read-aloud/353`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const testResults = await page.evaluate(() => {
      const mode = window.ReadAloudMode;
      if (!mode) return null;

      const forIpa = mode._getReducedWordIpaInfo('for');
      const toIpa = mode._getReducedWordIpaInfo('to');
      const andIpa = mode._getReducedWordIpaInfo('and');
      const ofIpa = mode._getReducedWordIpaInfo('of');

      return { forIpa, toIpa, andIpa, ofIpa };
    });

    console.log('for IPA:', testResults.forIpa);
    console.log('to IPA:', testResults.toIpa);
    console.log('and IPA:', testResults.andIpa);
    console.log('of IPA:', testResults.ofIpa);

    const forCorrect = testResults.forIpa.strong === '/fɔːr/' && testResults.forIpa.reduced === '/fər/';
    const toCorrect = testResults.toIpa.strong === '/tuː/' && testResults.toIpa.reduced === '/tə/';
    const andCorrect = testResults.andIpa.strong === '/ænd/' && testResults.andIpa.reduced === '/ənd/';
    const ofCorrect = testResults.ofIpa.strong === '/ɒv/' && testResults.ofIpa.reduced === '/əv/';

    const success = forCorrect && toCorrect && andCorrect && ofCorrect;

    if (success) {
      console.log('\n🎉 ALL IPA WEAK FORM REDUCTION CHECKS PASSED!');
    } else {
      console.error('\n⚠️ IPA REDUCTION CHECKS FAILED!');
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
