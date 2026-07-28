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
      const theIpa = mode._getReducedWordIpaInfo('the');
      const haveIpa = mode._getReducedWordIpaInfo('have');
      const hasIpa = mode._getReducedWordIpaInfo('has');
      const fromIpa = mode._getReducedWordIpaInfo('from');
      const linkingIpa = {
        she: mode._getLinkingIpaDetails('she', 'is', {}).ipa1,
        he: mode._getLinkingIpaDetails('he', 'is', {}).ipa1,
        we: mode._getLinkingIpaDetails('we', 'are', {}).ipa1,
        seven: mode._getLinkingIpaDetails('seven', 'of', {}).ipa1,
        ten: mode._getLinkingIpaDetails('ten', 'of', {}).ipa1
      };

      return { forIpa, toIpa, andIpa, ofIpa, theIpa, haveIpa, hasIpa, fromIpa, linkingIpa };
    });

    console.log('for IPA:', testResults.forIpa);
    console.log('to IPA:', testResults.toIpa);
    console.log('and IPA:', testResults.andIpa);
    console.log('of IPA:', testResults.ofIpa);

    const forCorrect = testResults.forIpa.strong === '/fɔr/' && testResults.forIpa.reduced === '/fər/';
    const toCorrect = testResults.toIpa.strong === '/tu/' && testResults.toIpa.reduced === '/tə/';
    const andCorrect = testResults.andIpa.strong === '/ænd/'
      && testResults.andIpa.reduced === '/ən/, /ənd/, /n/, /t/, /d/';
    const ofCorrect = testResults.ofIpa.strong === '/ʌv/'
      && testResults.ofIpa.reduced === '/əv/, /ə/';
    const theCorrect = testResults.theIpa.strong === '/ði/'
      && testResults.theIpa.reduced === '/ðə/ before a consonant sound; /ði/ before a vowel sound';
    const haveCorrect = testResults.haveIpa.strong === '/hæv/'
      && testResults.haveIpa.reduced === '/həv/, /əv/, /v/';
    const hasCorrect = testResults.hasIpa.strong === '/hæz/'
      && testResults.hasIpa.reduced === '/həz/, /əz/, /z/';
    const fromCorrect = testResults.fromIpa.strong === '/frʌm/ or /frɑm/'
      && testResults.fromIpa.reduced === '/frəm/';
    const linkingCorrect = JSON.stringify(testResults.linkingIpa) === JSON.stringify({
      she: '/ʃi/',
      he: '/hi/',
      we: '/wi/',
      seven: '/ˈsɛvn/',
      ten: '/tɛn/'
    });

    const success = forCorrect && toCorrect && andCorrect && ofCorrect
      && theCorrect && haveCorrect && hasCorrect && fromCorrect && linkingCorrect;

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
