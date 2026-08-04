/* eslint-disable no-console */
/**
 * Speaking UI Full Audit — 2026-08-01
 *
 * Read-only audit (no assertions). Walks every Speaking mode, records:
 *  - first-visible-frame trace (legacy-UI flash before the shared controller mounts)
 *  - panel containment / widths
 *  - controller row geometry + gaps + overflow
 *  - legacy/banner/stepper inventory
 *  - button typography + geometry consistency
 * Writes JSON + screenshots to test-results/speaking-ui-audit-2026-08-01/.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');

const SPEAKING_MODES = ['read-aloud', 'rts', 'asq', 'describe-image', 'notes', 'sgd', 'speak'];
const OUT_DIR = path.resolve(__dirname, '../../test-results/speaking-ui-audit-2026-08-01');
fs.mkdirSync(OUT_DIR, { recursive: true });

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

function initScript() {
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    ['read-aloud', 'rts', 'asq', 'describe-image', 'notes', 'sgd', 'speak', 'type'].forEach((mode) => {
        window.localStorage.setItem(`${mode}ModeFirstUse`, 'true');
    });
    // Stub mic so recording flows can be inspected.
    class StubRecorder extends EventTarget {
        constructor(stream) { super(); this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/wav'; }
        start() { this.state = 'recording'; this.dispatchEvent(new Event('start')); }
        stop() {
            this.state = 'inactive';
            const ev = new Event('dataavailable');
            Object.defineProperty(ev, 'data', { value: new Blob(['x'], { type: this.mimeType }) });
            this.ondataavailable?.(ev); this.dispatchEvent(ev);
            const s = new Event('stop'); this.onstop?.(s); this.dispatchEvent(s);
        }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: StubRecorder });
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { } }] }) }
    });

    // First-visible-frame trace for every mode panel.
    (() => {
        const trace = [];
        const snapshot = () => {
            document.querySelectorAll('.mode-panel').forEach((panel) => {
                const visible = panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
                const controller = !!panel.querySelector('.spc-controller');
                const key = panel.id;
                const last = trace.filter((t) => t.panel === key).pop();
                if (!last || last.visible !== visible || last.controller !== controller) {
                    trace.push({ panel: key, t: Math.round(performance.now()), visible, controller });
                }
            });
        };
        const mo = new MutationObserver(snapshot);
        const start = () => mo.observe(document.documentElement, {
            subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style']
        });
        if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
        window.__uiTrace = () => trace.slice();
    })();
}

async function dismissOverlays(page) {
    await page.waitForFunction(() => {
        const p = document.getElementById('app-preloader');
        if (!p) return true;
        return getComputedStyle(p).display === 'none' || !!document.getElementById('preloader-dismiss-btn');
    }, { timeout: 30000 }).catch(() => { });
    for (const sel of ['#preloader-dismiss-btn', '#guest-mode-btn']) {
        const loc = page.locator(sel);
        if (await loc.count()) await loc.click({ timeout: 3000 }).catch(() => { });
    }
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await page.waitForTimeout(200);
}

const collect = (modeId) => {
    const panel = document.getElementById(`mode-${modeId}`);
    if (!panel) return { modeId, missing: true };
    const cs = (el) => getComputedStyle(el);
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const visible = (el) => {
        if (!el) return false;
        const s = cs(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };

    const controller = panel.querySelector('.spc-controller');
    const main = panel.closest('main.container');

    // Buttons visible inside the panel
    const buttons = [...panel.querySelectorAll('button')].filter(visible).map((b) => {
        const s = cs(b);
        return {
            id: b.id || null,
            cls: b.className,
            text: (b.textContent || '').trim().slice(0, 40),
            inController: !!b.closest('.spc-controller'),
            box: box(b),
            font: s.fontFamily.split(',')[0].replace(/["']/g, ''),
            fontSize: s.fontSize,
            radius: s.borderTopLeftRadius,
            borderStyle: s.borderTopStyle,
            borderWidth: s.borderTopWidth,
            appearance: s.appearance,
            bg: s.backgroundColor,
            color: s.color
        };
    });

    // Rows in the controller
    const rows = controller ? [...controller.querySelectorAll('[class*="spc-row"]')].map((r) => {
        const s = cs(r);
        const kids = [...r.children].filter(visible).map((c) => ({ cls: c.className, box: box(c) }));
        let maxGap = 0;
        for (let i = 1; i < kids.length; i += 1) {
            const gap = kids[i].box.x - (kids[i - 1].box.x + kids[i - 1].box.w);
            if (gap > maxGap) maxGap = gap;
        }
        return { cls: r.className, box: box(r), display: s.display, justify: s.justifyContent, gap: s.gap, childCount: kids.length, kids, maxGap: Math.round(maxGap) };
    }) : [];

    // Legacy / duplicated surfaces still visible outside the controller
    const legacyOutside = [...panel.children].filter(visible).map((c) => ({
        tag: c.tagName.toLowerCase(), id: c.id || null, cls: typeof c.className === 'string' ? c.className : '', box: box(c)
    }));

    const banner = [...panel.querySelectorAll('*')].find((el) => /Based on PTE Academic|PTE Describe Image/.test(el.textContent || '') && el.children.length === 0);

    const visibleStepper = panel.querySelector('.spc-steps') && visible(panel.querySelector('.spc-steps'))
        ? panel.querySelector('.spc-steps')
        : [...panel.querySelectorAll('[class*="step-progress"], [class*="stepper"]')].find(visible);

    return {
        modeId,
        panelBox: box(panel),
        insideMain: !!main,
        mainBox: main ? box(main) : null,
        controllerPresent: !!controller,
        controllerBox: controller ? box(controller) : null,
        controllerRows: rows,
        hasStepper: !!visibleStepper,
        stepperCls: visibleStepper?.className || null,
        hasBanner: !!banner,
        bannerText: banner ? banner.textContent.trim().slice(0, 80) : null,
        legacyOutside,
        buttons,
        docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        docScrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
    };
};

async function auditMode(browser, modeId, viewport, label) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(initScript);
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
    const result = { modeId, label };
    try {
        await page.goto(server.url, { waitUntil: 'domcontentloaded' });
        await dismissOverlays(page);
        await page.evaluate(async (id) => { await window.switchToMode(id); }, modeId);
        await page.waitForFunction((id) => {
            const p = document.getElementById(`mode-${id}`);
            return p && p.classList.contains('active') && getComputedStyle(p).display !== 'none';
        }, modeId, { timeout: 30000 }).catch(() => { });
        await page.waitForTimeout(1500);

        result.trace = (await page.evaluate(() => window.__uiTrace?.() || [])).filter((t) => t.panel === `mode-${modeId}`);
        result.flashMs = (() => {
            const t = result.trace;
            let flash = 0;
            for (let i = 0; i < t.length; i += 1) {
                if (t[i].visible && !t[i].controller) {
                    const next = t.slice(i + 1).find((x) => x.controller || !x.visible);
                    if (next) flash += next.t - t[i].t;
                }
            }
            return flash;
        })();
        result.dom = await page.evaluate(collect, modeId);
        await page.screenshot({ path: path.join(OUT_DIR, `${modeId}-${label}.png`), fullPage: false });
        result.consoleErrors = consoleErrors.slice(0, 8);
    } catch (err) {
        result.error = String(err).slice(0, 400);
    } finally {
        await ctx.close();
    }
    return result;
}

let server;
(async () => {
    server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve({ s, url: `http://127.0.0.1:${s.address().port}/index.html` }));
    });
    const browser = await chromium.launch({ headless: true });
    const report = { generatedAt: new Date().toISOString(), desktop: [], mobile: [] };
    try {
        for (const mode of SPEAKING_MODES) {
            console.log(`--- desktop ${mode}`);
            report.desktop.push(await auditMode(browser, mode, { width: 1440, height: 1000 }, 'desktop'));
        }
        for (const mode of SPEAKING_MODES) {
            console.log(`--- mobile ${mode}`);
            report.mobile.push(await auditMode(browser, mode, { width: 390, height: 844 }, 'mobile'));
        }
    } finally {
        await browser.close();
        server.s.close();
    }
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`\nWrote ${path.join(OUT_DIR, 'report.json')}`);
})();
