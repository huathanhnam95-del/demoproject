/* eslint-disable no-console */
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
const BASE = 'https://localhost:8443';
const SHOTS = path.join(__dirname, 'shots-verify');
require('fs').mkdirSync(SHOTS, { recursive: true });

const navProbe = () => {
  const shell = document.querySelector('.crm-admin');
  const list = document.querySelector('.crm-nav-list');
  const toggle = document.getElementById('crm-nav-toggle');
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const items = [...document.querySelectorAll('.crm-nav-list .crm-nav-item')].map(b => { const r = b.getBoundingClientRect(); return { l: b.textContent.trim().replace(/\s+/g, ' ').slice(0, 20), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) }; });
  const lr = list ? list.getBoundingClientRect() : null;
  return {
    w: innerWidth,
    toggleVisible: vis(toggle),
    drawerOpen: !!shell && shell.classList.contains('crm-nav-open'),
    navVisible: vis(document.getElementById('crm-nav')),
    scrollW: list ? list.scrollWidth : null, clientW: list ? list.clientWidth : null,
    clipped: lr && vis(list) ? items.filter(i => i.right > lr.right + 1 || i.left < lr.left - 1).map(i => i.l) : [],
    itemCount: items.length,
    minH: items.length ? Math.min(...items.map(i => i.h)) : null,
    moreInNav: !!document.querySelector('#crm-nav .crm-nav-more-dropdown')
  };
};

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));

  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(10000);
  await p.goto(`${BASE}/crm-admin.html`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(9000);

  console.log('h1 count     :', await p.evaluate(() => document.querySelectorAll('h1').length),
    '| text:', await p.evaluate(() => (document.querySelector('h1') || {}).textContent?.trim().slice(0, 30)));
  console.log('skip link    :', await p.evaluate(() => !!document.querySelector('.crm-skip-link')));
  console.log('funnel       :', await p.evaluate(() => {
    const f = document.getElementById('dashboard-funnel');
    return { bars: f ? f.querySelectorAll('.crm-funnel-bar').length : 0, empty: f ? f.querySelectorAll('.crm-empty-state').length : 0 };
  }));
  console.log('telemetry in :', await p.evaluate(() => {
    const el = document.getElementById('read-aloud-prompt-summary-cards');
    return el ? (el.closest('[data-panel]') || {}).dataset?.panel : 'missing';
  }));
  console.log('stage lists  :', await p.evaluate(() => ({
    funnel: window.CrmDashboard ? window.CrmDashboard.buildFunnelRows({}).length : null,
    leads: window.CrmLeads ? window.CrmLeads.STAGES.length : null,
    shared: !!window.CrmLifecycleStages
  })));

  for (const w of [1440, 1280, 1100, 1024, 768, 390]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(900);
    console.log(`nav @${w}`.padEnd(13) + ':', JSON.stringify(await p.evaluate(navProbe)));
  }

  // drawer interaction at 390
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
  await p.locator('#crm-nav-toggle').click(); await p.waitForTimeout(600);
  console.log('drawer open  :', JSON.stringify(await p.evaluate(navProbe)));
  await p.screenshot({ path: path.join(SHOTS, 'crm-drawer-390.png') });
  await p.locator('.crm-nav-item[data-main="staff"]').click(); await p.waitForTimeout(2500);
  console.log('after nav    :', JSON.stringify(await p.evaluate(() => ({
    open: document.querySelector('.crm-admin').classList.contains('crm-nav-open'),
    hash: location.hash, h1: (document.querySelector('h1') || {}).textContent?.trim().slice(0, 24)
  }))));

  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(900);
  // Courses & Classes now navigates
  await p.locator('.crm-nav-item[data-main="courses"]').click(); await p.waitForTimeout(2500);
  console.log('courses click:', JSON.stringify(await p.evaluate(() => ({ hash: location.hash, h1: (document.querySelector('h1') || {}).textContent?.trim().slice(0, 30) }))));
  await p.screenshot({ path: path.join(SHOTS, 'crm-after-phase2.png'), fullPage: true });

  console.log('page errors  :', errs.length, JSON.stringify(errs.slice(0, 4)));
  await b.close();
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
