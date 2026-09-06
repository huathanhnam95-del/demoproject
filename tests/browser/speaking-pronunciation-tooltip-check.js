/* eslint-disable no-console */
const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.resolve(__dirname, '../../public');

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.mjs': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.wav': return 'audio/wav';
    case '.mp3': return 'audio/mpeg';
    default: return 'application/octet-stream';
  }
}

function startServer(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      let filePath = path.join(PUBLIC_DIR, safePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, {
          'Content-Type': getMimeType(filePath),
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      resolve({ server, port: actualPort });
    });
  });
}

async function runBrowserCheck() {
  const { server, port } = await startServer();
  console.log('[Browser Check] Test server running on http://127.0.0.1:' + port);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  await context.addInitScript(() => {
    try {
      sessionStorage.setItem('hasVisited', 'true');
      sessionStorage.setItem('entryModalDismissed', 'true');
      sessionStorage.setItem('welcomeModalSeen', 'true');
      localStorage.setItem('hasVisited', 'true');
    } catch (_) {
      // Ignore sessionStorage / localStorage access errors
    }
  });

  const page = await context.newPage();

  try {
    await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded' });

    // Remove any interfering overlays
    await page.evaluate(() => {
      const preloader = document.getElementById('app-preloader');
      if (preloader) preloader.remove();
      const entryModal = document.getElementById('entry-modal');
      if (entryModal) entryModal.remove();
      const overlay = document.getElementById('tutorial-overlay');
      if (overlay) overlay.remove();
      document.querySelectorAll('.modal-backdrop, .overlay').forEach(el => el.remove());
    });

    const hasTooltipModule = await page.evaluate(() => {
      return typeof window.PronunciationTooltip === 'object' && window.PronunciationTooltip !== null;
    });
    assert.strictEqual(hasTooltipModule, true, 'window.PronunciationTooltip must be loaded');

    const testResult = await page.evaluate(() => {
      const container = document.createElement('div');
      container.id = 'test-pronunciation-container';
      container.style.position = 'fixed';
      container.style.top = '100px';
      container.style.left = '50px';
      container.style.zIndex = '99999';
      container.style.background = '#ffffff';
      container.style.padding = '20px';
      container.style.borderRadius = '8px';
      container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      container.innerHTML = `
        <span class="ra-word-token" data-word="after" data-accuracy="97" data-playable="true" data-start-ms="100" data-end-ms="550" style="margin-right: 20px;" data-syllables='[
          {"text":"af","ipa":"/æf/","heardIpa":"/æt/","accuracyScore":71,"startMs":100,"endMs":320,"diagnosis":"af: Sounded like /æt/ (/t/ instead of /f/) — You stopped the air with your tongue like \\"at\\"","tip":"Rest your upper teeth lightly on your lower lip and blow air out steadily without stopping it."},
          {"text":"ter","ipa":"/tər/","heardIpa":"/tər/","accuracyScore":75,"startMs":320,"endMs":550,"diagnosis":"ter: Weak acoustic match on /ər/ (68%) — sounded a bit flat without the American \\"r\\"","tip":"Curl the tip of your tongue slightly backward and pull it back to get that rich American \\"r\\"."}
        ]'>after</span>
        <span class="speak-word-token speak-word-token--error" data-word="accurately" data-accuracy="18" data-playable="true" data-start-ms="600" data-end-ms="1200" data-syllables='[
          {"text":"ac","ipa":"/æk/","heardIpa":"/ək/","accuracyScore":34,"startMs":600,"endMs":750,"diagnosis":"ac: Sounded like /ək/ (/ə/ instead of /æ/)","tip":"Drop your jaw lower and open your mouth wide, like at the doctor saying \\"ah\\"."},
          {"text":"cu","ipa":"/jə/","heardIpa":"/jə/","accuracyScore":88,"startMs":750,"endMs":900},
          {"text":"rate","ipa":"/rət/","heardIpa":"/rət/","accuracyScore":12,"startMs":900,"endMs":1050,"diagnosis":"rate: Missed vowel clarity","tip":"Keep your tongue steady."},
          {"text":"ly","ipa":"/li/","heardIpa":"/li/","accuracyScore":22,"startMs":1050,"endMs":1200,"diagnosis":"ly: Cut short","tip":"Smile wide for the ending /iː/."}
        ]'>accurately</span>
      `;
      document.body.appendChild(container);

      window.PronunciationTooltip.bindHoverTooltip(container, {
        selector: '.ra-word-token, .speak-word-token'
      });

      return true;
    });
    assert.strictEqual(testResult, true);

    const afterToken = page.locator('.ra-word-token[data-word="after"]');
    await afterToken.hover({ force: true });
    await page.waitForSelector('#crm-word-tooltip:visible', { timeout: 3000 });

    const tooltipWord = await page.textContent('.crm-tooltip-word');
    assert.strictEqual(tooltipWord, 'after');
    const badgeText = await page.textContent('.crm-tooltip-badge');
    assert.match(badgeText, /97/);

    const subtitle = await page.textContent('.crm-tooltip-subtitle');
    assert.match(subtitle, /Word is clearly intelligible, but syllables show accent variance/i);

    const chipsCount = await page.locator('.crm-syl-chip').count();
    assert.strictEqual(chipsCount, 2, 'Should display 2 syllable chips for after');

    const tipsCount = await page.locator('.crm-insight-tip').count();
    assert.strictEqual(tipsCount, 2, 'Should display 2 tips for after');

    const firstTipText = await page.locator('.crm-insight-tip').first().textContent();
    assert.match(firstTipText, /upper teeth lightly on your lower lip/i);

    const screenshotDir = path.resolve(__dirname, '../../test-results');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, 'speaking-pronunciation-tooltip-after.png') });
    console.log('Captured screenshot: test-results/speaking-pronunciation-tooltip-after.png');

    const accuratelyToken = page.locator('.speak-word-token[data-word="accurately"]');
    await accuratelyToken.hover({ force: true });
    await page.waitForTimeout(300);

    const word2 = await page.textContent('.crm-tooltip-word');
    assert.strictEqual(word2, 'accurately');
    const badge2 = await page.textContent('.crm-tooltip-badge');
    assert.match(badge2, /18/);

    const chipsCount2 = await page.locator('.crm-syl-chip').count();
    assert.strictEqual(chipsCount2, 4, 'Should display 4 syllable chips for accurately');

    await page.screenshot({ path: path.join(screenshotDir, 'speaking-pronunciation-tooltip-accurately.png') });
    console.log('Captured screenshot: test-results/speaking-pronunciation-tooltip-accurately.png');

    console.log('All Speaking Pronunciation Tooltip browser checks passed successfully!');
  } finally {
    await browser.close();
    server.close();
  }
}

runBrowserCheck().catch((err) => {
  console.error('Browser check failed:', err);
  process.exit(1);
});
