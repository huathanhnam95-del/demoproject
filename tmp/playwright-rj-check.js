const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on('console', (msg) => {
    try {
      console.log('BROWSER_CONSOLE', msg.type(), msg.text());
    } catch {
      console.log('BROWSER_CONSOLE');
    }
  });
  page.on('pageerror', (err) => console.log('BROWSER_PAGEERROR', err && err.message ? err.message : String(err)));

  await page.goto('https://localhost:8443/readingjourney', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const root = document.getElementById('readingjourney-root');
    const wrapper = document.getElementById('page-layout-wrapper');
    const rootStyle = root ? window.getComputedStyle(root) : null;
    const wrapperStyle = wrapper ? window.getComputedStyle(wrapper) : null;

    const scripts = Array.from(document.scripts || []).map((s) => s.src || '').filter(Boolean);

    return {
      pathname: window.location.pathname,
      rootExists: Boolean(root),
      rootDisplay: rootStyle ? rootStyle.display : null,
      rootInnerLen: root ? (root.innerText || '').length : 0,
      wrapperExists: Boolean(wrapper),
      wrapperDisplay: wrapperStyle ? wrapperStyle.display : null,
      scripts: scripts.slice(0, 25)
    };
  });

  console.log('STATE', JSON.stringify(state, null, 2));

  await browser.close();
})();
