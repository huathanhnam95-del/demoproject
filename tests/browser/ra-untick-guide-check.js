const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

function serveStaticFile(req, res) {
  let filePath = path.join(__dirname, '../../public', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  const ext = path.extname(filePath);
  const contentTypeMap = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeMap[ext] || 'text/plain' });
    res.end(data);
  });
}

(async () => {
  const server = http.createServer(serveStaticFile);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`Test server running on http://127.0.0.1:${port}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`PAGE LOG ERROR: ${msg.text()}`);
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      sessionStorage.setItem('pte_onboarding_dismissed', 'true');
      document.getElementById('app-preloader')?.remove();
      document.getElementById('entry-modal')?.remove();
      if (typeof switchToMode === 'function') switchToMode('read-aloud');
      else if (typeof window.switchToMode === 'function') window.switchToMode('read-aloud');
      const raPanel = document.getElementById('mode-read-aloud');
      if (raPanel) raPanel.dataset.spcView = 'advanced';
    });
    await page.waitForSelector('#mode-read-aloud', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1000);

    const results = {};

    // 1. Initial State: No guides active
    results.initialChunkingPressed = await page.$eval('#ra-toggle-chunking-btn', el => el.getAttribute('aria-pressed'));
    results.initialLinkingPressed = await page.$eval('#ra-toggle-linking-btn', el => el.getAttribute('aria-pressed'));
    results.initialReducedPressed = await page.$eval('#ra-toggle-reduced-words-btn', el => el.getAttribute('aria-pressed'));

    // 2. Click Linking -> Should turn ON Linking
    await page.click('#ra-toggle-linking-btn');
    await page.waitForTimeout(500);
    results.linkingActivePressed = await page.$eval('#ra-toggle-linking-btn', el => el.getAttribute('aria-pressed'));
    results.overlayVisibleOnLinking = await page.$eval('#ra-linking-overlay', el => window.getComputedStyle(el).display !== 'none');
    results.reducedTokensOnLinking = await page.$$eval('.ra-connected-speech-token--weak', els => els.length);

    // 3. Click Linking AGAIN -> Should UNTICK and turn OFF
    await page.click('#ra-toggle-linking-btn');
    await page.waitForTimeout(500);
    results.linkingUntickedPressed = await page.$eval('#ra-toggle-linking-btn', el => el.getAttribute('aria-pressed'));
    results.overlayHiddenAfterLinkingUntick = await page.$eval('#ra-linking-overlay', el => window.getComputedStyle(el).display === 'none');

    // 4. Click Reduced Words -> Should turn ON Reduced Words and NO linking SVG curves
    await page.click('#ra-toggle-reduced-words-btn');
    await page.waitForTimeout(500);
    results.reducedActivePressed = await page.$eval('#ra-toggle-reduced-words-btn', el => el.getAttribute('aria-pressed'));
    results.overlayHiddenOnReducedWords = await page.$eval('#ra-linking-overlay', el => window.getComputedStyle(el).display === 'none');
    results.reducedTokensOnReducedWords = await page.$$eval('.ra-connected-speech-token--weak', els => els.length);

    // 5. Click Reduced Words AGAIN -> Should UNTICK and turn OFF
    await page.click('#ra-toggle-reduced-words-btn');
    await page.waitForTimeout(500);
    results.reducedUntickedPressed = await page.$eval('#ra-toggle-reduced-words-btn', el => el.getAttribute('aria-pressed'));
    results.reducedTokensAfterUntick = await page.$$eval('.ra-connected-speech-token--weak', els => els.length);

    // 6. Click Chunking -> Should turn ON Chunking
    await page.click('#ra-toggle-chunking-btn');
    await page.waitForTimeout(500);
    results.chunkingActivePressed = await page.$eval('#ra-toggle-chunking-btn', el => el.getAttribute('aria-pressed'));

    // 7. Click Chunking AGAIN -> Should UNTICK and turn OFF Chunking
    await page.click('#ra-toggle-chunking-btn');
    await page.waitForTimeout(500);
    results.chunkingUntickedPressed = await page.$eval('#ra-toggle-chunking-btn', el => el.getAttribute('aria-pressed'));

    console.log('Test Results:', JSON.stringify(results, null, 2));

    const allPassed =
      results.linkingActivePressed === 'true' &&
      results.linkingUntickedPressed === 'false' &&
      results.overlayHiddenAfterLinkingUntick === true &&
      results.reducedActivePressed === 'true' &&
      results.overlayHiddenOnReducedWords === true &&
      results.reducedTokensOnReducedWords > 0 &&
      results.reducedUntickedPressed === 'false' &&
      results.reducedTokensAfterUntick === 0 &&
      results.chunkingActivePressed === 'true' &&
      results.chunkingUntickedPressed === 'false';

    if (allPassed) {
      console.log('✅ ALL GUIDE UNTICK / TOGGLE CHECKS PASSED!');
    } else {
      console.error('❌ SOME CHECKS FAILED');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    await browser.close();
    server.close();
  }
})();
