/* eslint-disable no-console */
/** Per-mode settings sheet audit — fresh page per mode, active sheet only. */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');

const MODES = ['read-aloud', 'speak', 'describe-image', 'notes', 'sgd', 'rts', 'asq'];
const OUT_DIR = path.resolve(__dirname, '../../test-results/speaking-ui-audit-2026-08-01');
fs.mkdirSync(OUT_DIR, { recursive: true });
const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

function initScript() {
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    ['read-aloud', 'rts', 'asq', 'describe-image', 'notes', 'sgd', 'speak'].forEach((m) => {
        window.localStorage.setItem(`${m}ModeFirstUse`, 'true');
    });
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { } }] }) }
    });
}

(async () => {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve({ s, url: `http://127.0.0.1:${s.address().port}/index.html` }));
    });
    const browser = await chromium.launch({ headless: true });
    const out = [];
    try {
        for (const mode of MODES) {
            const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            await ctx.addInitScript(initScript);
            const page = await ctx.newPage();
            await page.goto(server.url, { waitUntil: 'domcontentloaded' });
            for (const sel of ['#preloader-dismiss-btn', '#guest-mode-btn']) {
                const loc = page.locator(sel);
                if (await loc.count()) await loc.click({ timeout: 3000 }).catch(() => { });
            }
            await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
            await page.evaluate(async (id) => { await window.switchToMode(id); }, mode);
            await page.waitForTimeout(2000);
            const clicked = await page.evaluate((id) => {
                const btn = document.querySelector(`#mode-${id} .spc-settings-btn`)
                    || document.querySelector('.spc-settings-btn');
                if (!btn) return 'no-button';
                btn.click();
                return 'clicked';
            }, mode);
            await page.waitForTimeout(900);
            const info = await page.evaluate((modeId) => {
                const target = document.querySelector('.spc-sheet.is-active');
                if (!target) {
                    return {
                        modeId, sheetOpen: false,
                        sheetsInDom: [...document.querySelectorAll('.spc-sheet')].map((s) => s.id || s.className)
                    };
                }
                const r = target.getBoundingClientRect();
                const controls = [...target.querySelectorAll('button, select, input, [role="radio"], [role="checkbox"]')].filter((el) => {
                    const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0;
                }).map((el) => {
                    const s = getComputedStyle(el); const b = el.getBoundingClientRect();
                    return {
                        tag: el.tagName.toLowerCase(), id: el.id || null,
                        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 44),
                        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26),
                        h: Math.round(b.height), w: Math.round(b.width),
                        font: s.fontFamily.split(',')[0].replace(/["']/g, ''),
                        fontSize: s.fontSize, radius: s.borderTopLeftRadius,
                        border: `${s.borderTopStyle}/${s.borderTopWidth}`,
                        appearance: s.appearance
                    };
                });
                return {
                    modeId, sheetOpen: true, sheetId: target.id, sheetCls: target.className,
                    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                    headings: [...target.querySelectorAll('h1,h2,h3,h4,.spc-sheet-title,.read-aloud-filter-label')]
                        .map((h) => h.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
                    tabs: [...target.querySelectorAll('.spc-sheet-tab')].map((t) => t.textContent.trim()),
                    controls
                };
            }, mode);
            info.clicked = clicked;
            out.push(info);
            await page.screenshot({ path: path.join(OUT_DIR, `settings2-${mode}.png`) });
            await ctx.close();
        }
    } finally {
        await browser.close();
        server.s.close();
    }
    fs.writeFileSync(path.join(OUT_DIR, 'settings-report2.json'), JSON.stringify(out, null, 2));
    out.forEach((m) => {
        console.log(`\n### ${m.modeId} click=${m.clicked} open=${m.sheetOpen} id=${m.sheetId || ''} box=${JSON.stringify(m.box || null)}`);
        if (!m.sheetOpen) { console.log('   sheetsInDom: ' + JSON.stringify(m.sheetsInDom)); return; }
        console.log('   tabs: ' + JSON.stringify(m.tabs) + '  headings: ' + JSON.stringify(m.headings));
        (m.controls || []).forEach((c) => console.log(`   ${c.tag} ${String(c.id || c.cls).slice(0, 32).padEnd(34)} h=${String(c.h).padStart(3)} font=${c.font.padEnd(11)} fs=${c.fontSize.padEnd(7)} r=${c.radius.padEnd(6)} bd=${c.border.padEnd(10)} app=${c.appearance} "${c.text}"`));
    });
})();
