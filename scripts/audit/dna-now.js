const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
const { aestheticFn } = require('./aesthetic-lib');
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const p = await c.newPage();
  await p.goto('https://localhost:8443/index.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(9000);
  try { const l = p.locator('.entry-btn.level-btn[data-level="intermediate"]'); if (await l.count() && await l.first().isVisible()) { await l.first().click(); await p.waitForTimeout(6000); } } catch (e) { }
  const d = await p.evaluate(aestheticFn);
  console.log('=== practice page ===');
  console.log('type sizes :', d.type.sizeCount, JSON.stringify(d.type.sizes.map(x => x[0])));
  console.log('radii      :', d.surface.radiusCount, JSON.stringify(d.surface.radii.map(x => x[0])));
  console.log('shadows    :', d.surface.shadowCount);
  d.surface.shadows.forEach(x => console.log('     ', x[1] + '×', x[0].slice(0, 62)));
  console.log('paddings   :', d.space.padCount, JSON.stringify(d.space.pads.map(x => x[0])));
  console.log('text colors:', d.color.textCount);
  console.log('emoji nodes:', await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && [...e.childNodes].some(n => n.nodeType === 3 && /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(n.nodeValue)); }).map(e => (e.innerText || '').trim().slice(0, 22))));
  await b.close();
})();
