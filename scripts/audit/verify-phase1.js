/* eslint-disable no-console */
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
const BASE = 'https://localhost:8443';
const SHOTS = path.join(__dirname, 'shots-verify');
require('fs').mkdirSync(SHOTS, { recursive: true });

const contrastProbe = () => {
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const q = m[1].split(',').map(Number); return { r: q[0], g: q[1], b: q[2], a: q[3] === undefined ? 1 : q[3] }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2); };
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const eff = (el) => { let n = el; while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.85) return c; n = n.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const flatten = (fg, bg) => fg.a >= 1 ? fg : { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };

  const out = [];
  const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (t.length < 2) continue;
    const p = n.parentElement;
    if (!p || !vis(p) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName)) continue;
    const s = getComputedStyle(p);
    const fgRaw = parse(s.color); if (!fgRaw) continue;
    // Skip elements painted over a gradient — the walker can't resolve those.
    let node = p, grad = false;
    while (node && node !== document.documentElement) { if (/gradient/.test(getComputedStyle(node).backgroundImage)) { grad = true; break; } if (parse(getComputedStyle(node).backgroundColor)?.a > 0.85) break; node = node.parentElement; }
    if (grad) continue;
    const bg = eff(p);
    const ratio = cr(flatten(fgRaw, bg), bg);
    const size = parseFloat(s.fontSize), weight = parseInt(s.fontWeight, 10) || 400;
    const min = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
    if (ratio < min) {
      const sel = p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + '.' + String(p.className || '').trim().split(/\s+/).slice(0, 2).join('.');
      const k = sel + s.color + Math.round(ratio * 10);
      if (seen.has(k)) continue; seen.add(k);
      out.push({ sel, ratio, need: min, px: Math.round(size), text: t.slice(0, 32) });
    }
  }
  return out.sort((a, b) => a.ratio - b.ratio).slice(0, 20);
};

const fontProbe = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const c = [...document.querySelectorAll('button,input,select,textarea')].filter(vis);
  const bad = c.filter(e => !/Outfit|Lora|Roboto Mono|Material Symbols/.test(getComputedStyle(e).fontFamily));
  const ua = c.filter(e => /outset|inset|ridge|groove/.test(getComputedStyle(e).borderTopStyle));
  return {
    total: c.length, wrongFont: bad.length, uaBorder: ua.length,
    names: bad.map(e => (e.id || e.className || e.tagName) + ' → ' + getComputedStyle(e).fontFamily.split(',')[0]).slice(0, 8)
  };
};

const navProbe = () => {
  const list = document.querySelector('.crm-nav-list');
  const items = [...document.querySelectorAll('.crm-nav-list .crm-nav-item')].map(b => {
    const r = b.getBoundingClientRect();
    return { l: b.textContent.trim().replace(/\s+/g, ' ').slice(0, 20), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) };
  });
  const lr = list ? list.getBoundingClientRect() : null;
  return {
    w: innerWidth,
    scrollW: list ? list.scrollWidth : null, clientW: list ? list.clientWidth : null,
    overflow: list ? list.scrollWidth > list.clientWidth + 1 : null,
    clipped: lr ? items.filter(i => i.right > lr.right + 1 || i.left < lr.left - 1).map(i => i.l) : [],
    minH: items.length ? Math.min(...items.map(i => i.h)) : null,
    items: items.map(i => i.l + ':' + i.w + 'x' + i.h)
  };
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, bypassCSP: false });
  const page = await ctx.newPage();

  // ---------- learner app ----------
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(11000);
  try { const l = page.locator('.entry-btn.level-btn[data-level="intermediate"]'); if (await l.count() && await l.first().isVisible()) { await l.first().click(); await page.waitForTimeout(7000); } } catch (e) { }

  console.log('APP controls  :', JSON.stringify(await page.evaluate(fontProbe)));
  const appC = await page.evaluate(contrastProbe);
  console.log('APP contrast  :', appC.length, 'failures');
  appC.forEach(c => console.log('    ', c.ratio + ':1 need ' + c.need, c.px + 'px', c.sel, JSON.stringify(c.text)));
  console.log('APP chevron   :', await page.evaluate(() => { const e = document.querySelector('.skill-card-chevron'); return e ? getComputedStyle(e).color : null; }));
  await page.screenshot({ path: path.join(SHOTS, 'app-practice.png'), fullPage: true });

  // Read Aloud: tutorial + prep timer
  await page.locator('text=Read Aloud').first().click({ timeout: 8000 });
  await page.waitForTimeout(6000);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    samples.push(await page.evaluate(() => {
      const t = document.body.innerText.match(/PREP TIME\s*([\d:]+)/i);
      return { prep: t ? t[1] : null, tut: !!window.isTutorialActive };
    }));
    await page.waitForTimeout(2000);
  }
  console.log('RA prep timer :', JSON.stringify(samples));
  try { const s = page.locator('text=Skip Tutorial').first(); if (await s.count()) { await s.click(); await page.waitForTimeout(2500); } } catch (e) { }
  console.log('RA after skip :', JSON.stringify(await page.evaluate(() => { const t = document.body.innerText.match(/PREP TIME\s*([\d:]+)/i); return t ? t[1] : null; })));
  await page.waitForTimeout(2500);
  console.log('RA ticking    :', JSON.stringify(await page.evaluate(() => { const t = document.body.innerText.match(/PREP TIME\s*([\d:]+)/i); return t ? t[1] : null; })));
  console.log('RA measure    :', JSON.stringify(await page.evaluate(() => {
    const e = document.querySelector('#ra-text-prompt'); if (!e) return null;
    const s = getComputedStyle(e), r = e.getBoundingClientRect(), fs = parseFloat(s.fontSize);
    return { px: Math.round(r.width), size: fs, ch: Math.round(r.width / (fs * 0.5)), fam: s.fontFamily.split(',')[0] };
  })));
  await page.screenshot({ path: path.join(SHOTS, 'app-read-aloud.png'), fullPage: true });

  // ---------- CRM ----------
  await page.goto(`${BASE}/crm-admin.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  console.log('CRM url       :', page.url());
  for (const w of [1440, 1280, 1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(1200);
    console.log(`CRM nav @${w}  :`, JSON.stringify(await page.evaluate(navProbe)));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1000);
  console.log('CRM controls  :', JSON.stringify(await page.evaluate(fontProbe)));
  const crmC = await page.evaluate(contrastProbe);
  console.log('CRM contrast  :', crmC.length, 'failures');
  crmC.forEach(c => console.log('    ', c.ratio + ':1 need ' + c.need, c.px + 'px', c.sel, JSON.stringify(c.text)));
  console.log('CRM markers   :', JSON.stringify(await page.evaluate(() => /<<<<<<<|>>>>>>>/.test(document.body.innerText) ? 'VISIBLE IN BODY' : 'none in rendered text')));
  await page.screenshot({ path: path.join(SHOTS, 'crm-dashboard.png'), fullPage: true });

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
