/**
 * Visual verification for the Oxford IPA notation change.
 * Confirms the length mark renders as a real glyph (not tofu) in the fonts the
 * app actually uses, and that the longer strings do not overflow their boxes.
 */
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = 'C:/Cursor AI';

async function startServer() {
  const app = express();
  app.use(express.static(path.join(ROOT, 'public')));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

(async () => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let failed = false;
  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // 1. Glyph coverage: compare the length mark against a private-use
    // codepoint that no font can have. Equal widths mean tofu.
    const glyph = await page.evaluate(() => {
      const fontsToTest = [];
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:40px';
      document.body.appendChild(probe);
      const measure = (text, font) => {
        probe.style.fontFamily = font;
        probe.textContent = text;
        return probe.getBoundingClientRect().width;
      };
      const bodyFont = getComputedStyle(document.body).fontFamily;
      const ipaEl = document.querySelector('.pa-ipa-text, .vocab-phonetic, #srs-phonetic');
      const ipaFont = ipaEl ? getComputedStyle(ipaEl).fontFamily : bodyFont;
      for (const [label, font] of [['body', bodyFont], ['ipa-element', ipaFont]]) {
        const notdef = measure('\uE000', font);
        fontsToTest.push({
          label,
          font,
          lengthMark: measure('ː', font),
          nurse: measure('ɜ', font),
          schwa: measure('ə', font),
          notdef
        });
      }
      probe.remove();
      return fontsToTest;
    });

    console.log('--- GLYPH COVERAGE ---');
    for (const g of glyph) {
      const tofuLen = Math.abs(g.lengthMark - g.notdef) < 0.5;
      const tofuNurse = Math.abs(g.nurse - g.notdef) < 0.5;
      console.log(`  ${g.label} (${g.font.split(',')[0]})`);
      console.log(`    ː  width ${g.lengthMark.toFixed(1)} vs notdef ${g.notdef.toFixed(1)} -> ${tofuLen ? 'TOFU ✗' : 'renders ✓'}`);
      console.log(`    ɜ  width ${g.nurse.toFixed(1)} vs notdef ${g.notdef.toFixed(1)} -> ${tofuNurse ? 'TOFU ✗' : 'renders ✓'}`);
      if (tofuLen || tofuNurse) failed = true;
    }

    // 2. Overflow: inject the longest realistic Oxford strings into the live
    // IPA containers and check they still fit.
    const overflow = await page.evaluate(async () => {
      // old notation -> new notation, so growth is measured on real pairs.
      const pairs = [
        ['/ˌæntaɪˈdʌmpɪŋ/', '/ˌæntaɪˈdʌmpɪŋ/'],
        ['/kəmˈpjutɝ/', '/kəmˈpjuːtər/'],
        ['/ˈhərəˌkeɪn/', '/ˈhɜːrəˌkeɪn/'],
        ['/ˌɑkjuˈpeɪʃən/', '/ˌɑːkjuˈpeɪʃən/'],
        ['/ʌnˈsərvɪsəbl/', '/ʌnˈsɜːrvɪsəbl/'],
        ['/ˈwɔtɝ/', '/ˈwɔːtər/']
      ];
      const results = [];
      const selectors = ['#pa-ipa-display', '#srs-phonetic', '#srs-phonetic-back'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) { results.push({ sel, status: 'not-found' }); continue; }

        // Reveal every hidden ancestor so widths are real, then restore.
        const touched = [];
        for (let node = el; node && node !== document.body; node = node.parentElement) {
          const cs = getComputedStyle(node);
          if (cs.display === 'none') {
            touched.push([node, node.style.display]);
            node.style.display = 'block';
          }
        }
        const original = el.textContent;
        let worst = null;
        for (const [oldText, newText] of pairs) {
          el.textContent = oldText;
          const oldW = el.scrollWidth;
          el.textContent = newText;
          const newW = el.scrollWidth;
          const over = newW - el.clientWidth;
          if (!worst || (newW - oldW) > (worst.sw - worst.oldW)) {
            worst = { text: newText, over, sw: newW, oldW, cw: el.clientWidth, growthPct: oldW ? ((newW - oldW) / oldW * 100) : 0 };
          }
        }
        el.textContent = original;
        touched.forEach(([node, prev]) => { node.style.display = prev; });
        results.push({ sel, status: 'checked', ...worst });
      }
      return results;
    });

    console.log('\n--- OVERFLOW (longest Oxford strings in live containers) ---');
    for (const r of overflow) {
      if (r.status === 'not-found') { console.log(`  ${r.sel}: not rendered on this screen`); continue; }
      const bad = r.cw > 0 && r.over > 1;
      const width = r.cw > 0 ? `scrollW ${r.sw} vs clientW ${r.cw}` : `scrollW ${r.sw} (container unconstrained)`;
      console.log(`  ${r.sel}: worst ${r.text} ${width}, +${r.growthPct.toFixed(1)}% vs old notation -> ${bad ? 'OVERFLOW ✗' : 'fits ✓'}`);
      if (bad) failed = true;
    }

    await page.screenshot({ path: path.join(ROOT, 'test-results', 'oxford-ipa-visual.png'), fullPage: false });
    console.log('\nscreenshot: test-results/oxford-ipa-visual.png');
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failed ? '\n❌ VISUAL CHECK FAILED' : '\n✅ VISUAL CHECK PASSED');
  process.exit(failed ? 1 : 0);
})();
