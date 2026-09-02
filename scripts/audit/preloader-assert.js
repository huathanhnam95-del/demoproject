const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const p = await c.newPage();
  await p.goto('https://localhost:8443/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500); // same sample point as tests/browser/preloader-browser-check.js
  const r = await p.evaluate(() => {
    const el = document.getElementById('app-preloader');
    return { display: getComputedStyle(el).display, visible: el.offsetParent !== null || getComputedStyle(el).position === 'fixed' };
  });
  console.log('COLD @1500ms  display=' + r.display + '  (test requires block|flex):', (r.display === 'block' || r.display === 'flex') ? 'PASS' : 'FAIL');
  await p.waitForFunction(() => { const e = document.getElementById('app-preloader'); return getComputedStyle(e).opacity === '0' || getComputedStyle(e).display === 'none'; }, { timeout: 30000 });
  // warm navigation must skip it entirely
  await p.goto('https://localhost:8443/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(250);
  const w = await p.evaluate(() => getComputedStyle(document.getElementById('app-preloader')).display);
  console.log('WARM @250ms   display=' + w + '  (should be none):', w === 'none' ? 'PASS' : 'FAIL');
  await b.close();
})();
