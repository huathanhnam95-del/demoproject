/* eslint-disable no-console */

const assert = require('assert');
const http = require('http');
const path = require('path');
const net = require('net');
const { chromium } = require('playwright');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => port ? resolve(port) : reject(new Error('Failed to allocate port')));
    });
    server.on('error', reject);
  });
}

(async () => {
  const port = await getFreePort();
  const publicDir = path.join(process.cwd(), 'public');
  const fixture = `<!doctype html>
    <html><head>
      <link rel="stylesheet" href="/style.css">
      <link rel="stylesheet" href="/design-tokens.css">
      <link rel="stylesheet" href="/practice-mode-base.css">
      <link rel="stylesheet" href="/hcs-mode.css">
      <link rel="stylesheet" href="/speaking-practice-controller.css">
    </head><body>
      <main id="mode-read-aloud"><p id="ra-text-prompt">Read this aloud.</p></main>
      <main id="mode-rfib"><div class="rfib-cloze-view">Reading passage.</div></main>
      <main id="mode-rop"><div class="rop-item-content">Reorder this paragraph.</div></main>
      <main id="mode-hcs"><p id="hcs-question-prompt">Choose the best summary.</p><div class="hcs-choice-text">A choice.</div></main>
      <main id="mode-lmcsa"><p class="lmcsa-question-prompt">Listening question.</p><div class="lmcsa-transcript-text">Transcript.</div></main>
      <main id="mode-hiw"><div id="hiw-passage-container" class="hiw-passage-container">Listen and identify the missing words.</div></main>
      <main id="mode-sst"><h2 id="sst-question-title">Summarize the lecture.</h2></main>
      <main id="mode-type"><div id="transcription-text">Click Start Recording.</div></main>
      <button id="hcs-submit-btn" class="modern-btn modern-btn--check" disabled>Submit</button>
    </body></html>`;

  const server = http.createServer((req, res) => {
    if (req.url === '/font-fixture.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(fixture);
      return;
    }
    const file = path.join(publicDir, req.url === '/' ? 'index.html' : req.url.slice(1));
    require('fs').createReadStream(file).on('error', () => {
      res.statusCode = 404;
      res.end();
    }).pipe(res);
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/font-fixture.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(100);

  const result = await page.evaluate(() => {
    const contentSelectors = [
      '#ra-text-prompt', '#mode-rfib .rfib-cloze-view', '#mode-rop .rop-item-content',
      '#hcs-question-prompt', '#mode-hcs .hcs-choice-text',
      '#mode-lmcsa .lmcsa-question-prompt', '#mode-lmcsa .lmcsa-transcript-text',
      '#mode-hiw #hiw-passage-container', '#mode-sst #sst-question-title', '#mode-type #transcription-text'
    ];
    const contentFonts = Object.fromEntries(contentSelectors.map(selector => [
      selector,
      getComputedStyle(document.querySelector(selector)).fontFamily
    ]));
    const submit = document.getElementById('hcs-submit-btn');
    return {
      contentFonts,
      contentFontToken: getComputedStyle(document.documentElement).getPropertyValue('--font-content').trim(),
      submitClass: submit.className,
      submitDisabled: submit.disabled,
      submitFont: getComputedStyle(submit).fontFamily,
      submitOpacity: Number(getComputedStyle(submit).opacity),
      submitBackgroundImage: getComputedStyle(submit).backgroundImage
    };
  });
  for (const [selector, font] of Object.entries(result.contentFonts)) {
    assert(/Lora|Georgia/i.test(font), `${selector} should use the content font, received ${font}`);
  }
  assert(/Lora/i.test(result.contentFontToken), 'Expected --font-content to use Lora');
  assert(result.submitClass.includes('modern-btn--check'), 'HCS submit should use shared check styling');
  assert.equal(result.submitDisabled, true, 'HCS submit should preserve disabled state');
  assert(/Outfit|system-ui/i.test(result.submitFont), `HCS submit should retain the Outfit UI font, received ${result.submitFont}`);
  assert(result.submitOpacity < 1, 'HCS submit should use the shared disabled opacity');
  assert.notEqual(result.submitBackgroundImage, 'none', 'HCS submit should retain the shared check-button background');
  assert.deepEqual(pageErrors, [], `Unexpected browser errors: ${pageErrors.join('; ')}`);

  await page.screenshot({ path: path.join(require('os').tmpdir(), 'practice-font-browser-check.png'), fullPage: true });
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  console.log('Practice content font and HCS button browser verification complete.');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
