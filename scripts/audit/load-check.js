const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const p = await c.newPage();
  const bad = [];
  p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().replace('https://localhost:8443', '')); });

  // cold start
  let t0 = Date.now();
  await p.goto('https://localhost:8443/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const el = document.getElementById('app-preloader'); return !el || getComputedStyle(el).opacity === '0' || getComputedStyle(el).display === 'none'; }, { timeout: 40000 });
  console.log('COLD  time to splash gone:', Date.now() - t0, 'ms');
  try { const l = p.locator('.entry-btn.level-btn[data-level="intermediate"]'); if (await l.count() && await l.first().isVisible()) { await l.first().click(); await p.waitForTimeout(6000); } } catch (e) { }

  // same-session return
  t0 = Date.now();
  await p.goto('https://localhost:8443/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const el = document.getElementById('app-preloader'); return !el || getComputedStyle(el).opacity === '0' || getComputedStyle(el).display === 'none'; }, { timeout: 40000 });
  console.log('WARM  time to splash gone:', Date.now() - t0, 'ms');
  await p.waitForTimeout(3000);
  console.log('HTTP >=400:', bad.length ? [...new Set(bad)] : 'none');
  await b.close();
})();
