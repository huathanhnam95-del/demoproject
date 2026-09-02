const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const p = await c.newPage();
  await p.goto('https://localhost:8443/index.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(9000);
  try { const l = p.locator('.entry-btn.level-btn[data-level="intermediate"]'); if (await l.count() && await l.first().isVisible()) { await l.first().click(); await p.waitForTimeout(6000); } } catch (e) { }
  await p.locator('text=Read Aloud').first().click({ timeout: 8000 }); await p.waitForTimeout(8000);
  try { const s = p.locator('text=Skip Tutorial').first(); if (await s.count()) { await s.click(); await p.waitForTimeout(2000); } } catch (e) { }
  const r = await p.evaluate(() => {
    const el = document.querySelector('#ra-text-prompt');
    const box = document.querySelector('#mode-read-aloud .ra-prompt-box');
    const s = getComputedStyle(el); const q = el.getBoundingClientRect();
    const bq = box ? box.getBoundingClientRect() : null;
    // real rendered characters per line: longest visual line
    const words = (el.innerText || '').trim();
    return {
      promptPx: Math.round(q.width), fontPx: parseFloat(s.fontSize),
      approxChars: Math.round(q.width / (parseFloat(s.fontSize) * 0.5)),
      boxPx: bq ? Math.round(bq.width) : null, boxLeft: bq ? Math.round(bq.left) : null, boxRight: bq ? Math.round(bq.right) : null,
      textLen: words.length
    };
  });
  console.log(JSON.stringify(r));
  await p.screenshot({ path: path.join(__dirname, 'shots-verify', 'ra-measure.png') });
  await b.close();
})();
