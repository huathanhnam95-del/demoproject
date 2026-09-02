const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  for (const d of [{ n: 'desktop', w: 1440, h: 900 }, { n: 'mobile', w: 390, h: 844, m: true }]) {
    const c = await b.newContext({ viewport: { width: d.w, height: d.h }, ignoreHTTPSErrors: true, isMobile: !!d.m, hasTouch: !!d.m });
    const p = await c.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 100)));
    await p.goto('https://localhost:8443/index.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(9000);
    try { const l = p.locator('.entry-btn.level-btn[data-level="intermediate"]'); if (await l.count() && await l.first().isVisible()) { await l.first().click(); await p.waitForTimeout(6000); } } catch (e) { }
    const r = await p.evaluate(() => {
      const vis = e => { const q = e.getBoundingClientRect(); const s = getComputedStyle(e); return q.width > 0 && q.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const over = [...document.querySelectorAll('body *')].filter(vis).filter(e => { const q = e.getBoundingClientRect(); return q.right > innerWidth + 2 && q.width > 40; })
        .map(e => e.tagName + '.' + String(e.className).slice(0, 30));
      const sizes = new Set();
      [...document.querySelectorAll('body *')].filter(vis).forEach(e => { if ([...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim().length > 1)) sizes.add(getComputedStyle(e).fontSize); });
      const clipped = [...document.querySelectorAll('button, .card-body h3, .badge, .segmented-btn')].filter(vis)
        .filter(e => e.scrollWidth > e.clientWidth + 2).map(e => (e.innerText || '').trim().slice(0, 22) + ' [' + e.scrollWidth + '>' + e.clientWidth + ']');
      return { pageOverflow: document.documentElement.scrollWidth > innerWidth + 2, overflowing: [...new Set(over)].slice(0, 6), sizeCount: sizes.size, sizes: [...sizes].sort(), clipped: [...new Set(clipped)].slice(0, 8) };
    });
    console.log('=== ' + d.n + ' ===');
    console.log('  page h-overflow :', r.pageOverflow, r.overflowing.length ? r.overflowing : '');
    console.log('  distinct sizes  :', r.sizeCount, JSON.stringify(r.sizes));
    console.log('  clipped text    :', r.clipped.length ? r.clipped : 'none');
    console.log('  page errors     :', errs.length, errs.slice(0, 2));
    await c.close();
  }
  await b.close();
})();
