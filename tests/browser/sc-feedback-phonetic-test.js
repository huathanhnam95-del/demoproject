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
    console.log('Testing phonetic reasoning engine...');
    await page.goto(`${baseUrl}/pte-practice/speaking/read-aloud/353`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Evaluate _getSuccessLinkReasonText for merely a, is every, that effective, regulations are
    const testResults = await page.evaluate(() => {
      const mode = window.ReadAloudMode;
      if (!mode) return null;

      const p1 = mode._getSuccessLinkReasonText({ phrase: 'merely a' });
      const p2 = mode._getSuccessLinkReasonText({ phrase: 'is every' });
      const p3 = mode._getSuccessLinkReasonText({ phrase: 'that effective' });
      const p4 = mode._getSuccessLinkReasonText({ phrase: 'regulations are' });

      return { p1, p2, p3, p4 };
    });

    console.log('1. merely a:', testResults.p1);
    console.log('2. is every:', testResults.p2);
    console.log('3. that effective:', testResults.p3);
    console.log('4. regulations are:', testResults.p4);

    // Verify merely a is Vowel-to-vowel link (linking /j/)
    const p1Correct = testResults.p1.reason.includes('Vowel-to-vowel link') && testResults.p1.reason.includes('/j/');
    console.log(`Check 1 - "merely a" classified as Vowel-to-vowel link (linking /j/): ${p1Correct}`);

    // Verify non-templated tips
    const p2Tip = testResults.p2.tip;
    const p3Tip = testResults.p3.tip;
    const p4Tip = testResults.p4.tip;
    const tipsUnique = p2Tip !== p3Tip && p3Tip !== p4Tip;
    console.log(`Check 2 - Tips are dynamic and unique across pairs: ${tipsUnique}`);

    const success = p1Correct && tipsUnique;

    if (success) {
      console.log('\n🎉 ALL PHONETIC REASONING CHECKS PASSED!');
    } else {
      console.error('\n⚠️ PHONETIC REASONING CHECKS FAILED!');
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
