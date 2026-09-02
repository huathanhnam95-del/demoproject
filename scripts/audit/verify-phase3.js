/* eslint-disable no-console */
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
const BASE = 'https://localhost:8443';
const SHOTS = path.join(__dirname, 'shots-verify');
require('fs').mkdirSync(SHOTS, { recursive: true });

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  for (const dev of [{ n: 'desktop', w: 1440, h: 900 }, { n: 'mobile', w: 390, h: 844, m: true }]) {
    const c = await b.newContext({ viewport: { width: dev.w, height: dev.h }, ignoreHTTPSErrors: true, isMobile: !!dev.m, hasTouch: !!dev.m });
    const p = await c.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(11000);
    try { const l = p.locator('.entry-btn.level-btn[data-level="intermediate"]'); if (await l.count() && await l.first().isVisible()) { await l.first().click(); await p.waitForTimeout(7000); } } catch (e) { }

    console.log(`\n===== ${dev.n} =====`);
    console.log('cards      :', JSON.stringify(await p.evaluate(() => {
      const c = document.querySelector('#mode-btn-read-aloud');
      if (!c) return null;
      const cta = c.querySelector('.card-cta');
      const vis = c.querySelector('.card-visual');
      const cs = cta ? getComputedStyle(cta) : null;
      return {
        cardH: Math.round(c.getBoundingClientRect().height),
        visualH: vis ? Math.round(vis.getBoundingClientRect().height) : null,
        ctaOpacity: cs ? cs.opacity : null,
        ctaPointer: cs ? cs.pointerEvents : null,
        ctaVisibleH: cta ? Math.round(cta.getBoundingClientRect().height) : null
      };
    })));
    console.log('skill hue  :', JSON.stringify(await p.evaluate(() => {
      const out = {};
      document.querySelectorAll('[data-practice-skill]').forEach(card => {
        const v = card.querySelector('.card-visual');
        if (!v || !v.getBoundingClientRect().width) return;
        out[card.dataset.practiceSkill] = getComputedStyle(v).backgroundColor;
      });
      return out;
    })));
    console.log('loops      :', await p.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.animationName !== 'none' && s.animationIterationCount === 'infinite'; }).length));
    console.log('DialogA11y :', await p.evaluate(() => !!window.DialogA11y));
    console.log('vocab tab  :', JSON.stringify(await p.evaluate(() => {
      const c = document.querySelector('.vocab-panel-content');
      return c ? getComputedStyle(c).visibility : 'missing';
    })));
    console.log('page errors:', errs.length, JSON.stringify(errs.slice(0, 3)));

    if (dev.n === 'desktop') {
      // keyboard walk
      const walk = [];
      for (let i = 0; i < 16; i++) {
        await p.keyboard.press('Tab');
        await p.waitForTimeout(120);
        walk.push(await p.evaluate(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return 'BODY';
          const s = getComputedStyle(a);
          const ring = s.outlineStyle !== 'none' && (s.outlineStyle === 'auto' || parseFloat(s.outlineWidth) > 0);
          return (ring ? '[ring] ' : '[none] ') + a.tagName + (a.id ? '#' + a.id : '') + '.' + String(a.className || '').slice(0, 26);
        }));
      }
      console.log('tab order  :'); walk.forEach((w, i) => console.log('   ' + String(i).padStart(2) + ' ' + w));
    }
    await p.screenshot({ path: path.join(SHOTS, `app-phase3-${dev.n}.png`), fullPage: true });
    await c.close();
  }
  await b.close();
  console.log('\nDONE');
})().catch(e => { console.error(e); process.exit(1); });
