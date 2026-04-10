/**
 * Practice Scope Guest-Mode Verification
 *
 * Covers:
 *  - Scope toggle semantics and aria-pressed correctness
 *  - Keyboard activation (Tab, Enter, Space) and focus retention
 *  - Accessible label smoke check on renamed PTE cards
 *  - Scope persistence across page reload (guest localStorage)
 *  - Console pageErrors assertion
 *  - Failed-network-request assertion
 *
 * This script does NOT cover logged-in flows.
 * See practice-scope-logged-in-browser-check.js for authenticated coverage.
 */

/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

function startHarnessServer() {
    const app = express();
    const publicDir = path.join(__dirname, '..', '..', 'public');
    app.use(express.static(publicDir));
    app.get('/', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(publicDir, 'index.html'));
    });
    return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

async function dismissBlockingOverlays(page) {
    await page.waitForFunction(() => {
        const preloader = document.getElementById('app-preloader');
        if (!preloader) return true;
        const display = getComputedStyle(preloader).display;
        const dismiss = document.getElementById('preloader-dismiss-btn');
        return display === 'none' || Boolean(dismiss);
    }, { timeout: 15000 });

    const dismissButton = page.locator('#preloader-dismiss-btn');
    if (await dismissButton.count()) {
        try { await dismissButton.click({ timeout: 3000 }); } catch (_e) { /* ignore */ }
    }

    await page.waitForFunction(() => {
        const preloader = document.getElementById('app-preloader');
        return !preloader || getComputedStyle(preloader).display === 'none';
    }, { timeout: 15000 });

    const guestButton = page.locator('#guest-mode-btn');
    if (await guestButton.isVisible().catch(() => false)) {
        await guestButton.click();
    }

    await page.waitForFunction(() => {
        const entryModal = document.getElementById('entry-modal');
        const wrapper = document.getElementById('page-layout-wrapper');
        const modalHidden = !entryModal || getComputedStyle(entryModal).display === 'none';
        const wrapperVisible = !!wrapper && getComputedStyle(wrapper).display !== 'none';
        return modalHidden && wrapperVisible;
    }, { timeout: 15000 });
}

(async () => {
    const { server, origin } = await startHarnessServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const page = await context.newPage();

    const pageErrors = [];   // Actual JS runtime errors (throw / uncaught)
    const consoleErrors = []; // console.error() messages (often SDK noise)
    const failedRequests = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
        const url = req.url();
        // Only track same-origin shell-asset failures (.html, .js, .css)
        // Audio, image, and data fetches are expected to fail without a real backend
        const isShellAsset = /\.(html|js|css)(\?|$)/i.test(url);
        if (url.startsWith(origin) && isShellAsset && !url.includes('favicon.ico')) {
            failedRequests.push(url);
        }
    });

    try {
        // ── Initial load: clear scope ONCE before first navigation ──
        // Use addInitScript only for tutorial suppression, NOT for scope clearing.
        await page.addInitScript(() => {
            ['type', 'collo-dictate', 'speak', 'extended', 'watch', 'notes', 'pronounce', 'read-aloud', 'rfib']
                .forEach((m) => localStorage.setItem(`${m}ModeFirstUse`, 'true'));
        });

        // Clear scope explicitly before first goto (will not re-run on reload)
        await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => localStorage.removeItem('practiceScope'));
        await page.reload({ waitUntil: 'domcontentloaded' });

        await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
        await dismissBlockingOverlays(page);

        // ── SECTION 1: Default aria-pressed state ──
        console.log('[Guest] Checking default aria-pressed state...');
        const ariaState = await page.evaluate(() => {
            const eng = document.querySelector('[data-practice-scope="english"]');
            const pte = document.querySelector('[data-practice-scope="pte"]');
            return {
                engPressed: eng ? eng.getAttribute('aria-pressed') : null,
                ptePressed: pte ? pte.getAttribute('aria-pressed') : null
            };
        });
        assert.strictEqual(ariaState.engPressed, 'true', 'English should be aria-pressed=true by default');
        assert.strictEqual(ariaState.ptePressed, 'false', 'PTE should be aria-pressed=false by default');

        // ── SECTION 2: Click toggle to PTE ──
        console.log('[Guest] Toggling to PTE via click...');
        await page.click('[data-practice-scope="pte"]');
        await page.waitForTimeout(300);

        const afterToggle = await page.evaluate(() => ({
            eng: document.querySelector('[data-practice-scope="english"]').getAttribute('aria-pressed'),
            pte: document.querySelector('[data-practice-scope="pte"]').getAttribute('aria-pressed')
        }));
        assert.strictEqual(afterToggle.eng, 'false', 'English aria-pressed should be false after PTE click');
        assert.strictEqual(afterToggle.pte, 'true', 'PTE aria-pressed should be true after PTE click');

        // ── SECTION 3: Keyboard activation ──
        console.log('[Guest] Testing keyboard activation (Tab → Enter → Space)...');

        // Switch back to English first so we can test keyboard toggling
        await page.click('[data-practice-scope="english"]');
        await page.waitForTimeout(200);

        // Focus the English button and Tab to PTE
        await page.focus('[data-practice-scope="english"]');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);

        // Verify PTE button has focus
        const focusedId = await page.evaluate(() => {
            const el = document.activeElement;
            return el ? el.getAttribute('data-practice-scope') : null;
        });
        assert.strictEqual(focusedId, 'pte', 'Tab from English should focus PTE button');

        // Press Enter to activate PTE
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);

        const afterEnter = await page.evaluate(() => ({
            pte: document.querySelector('[data-practice-scope="pte"]').getAttribute('aria-pressed'),
            focusScope: document.activeElement ? document.activeElement.getAttribute('data-practice-scope') : null
        }));
        assert.strictEqual(afterEnter.pte, 'true', 'Enter on PTE button should activate it');
        assert.ok(afterEnter.focusScope !== null, 'Focus should remain on a scope button after Enter re-render');

        // Tab back to English and press Space to activate
        await page.focus('[data-practice-scope="english"]');
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);

        const afterSpace = await page.evaluate(() => ({
            eng: document.querySelector('[data-practice-scope="english"]').getAttribute('aria-pressed'),
            focusScope: document.activeElement ? document.activeElement.getAttribute('data-practice-scope') : null
        }));
        assert.strictEqual(afterSpace.eng, 'true', 'Space on English button should activate it');
        assert.ok(afterSpace.focusScope !== null, 'Focus should remain on a scope button after Space re-render');

        // ── SECTION 4: Accessible label smoke check on PTE card ──
        console.log('[Guest] Checking accessible label on renamed PTE card...');
        await page.click('[data-practice-scope="pte"]');
        await page.waitForTimeout(200);
        await page.click('[data-practice-skill="speaking"]');
        await page.waitForTimeout(200);

        const cardLabel = await page.evaluate(() => {
            const speakCard = document.getElementById('mode-btn-speak');
            if (!speakCard) return { visible: '', ariaLabel: '' };
            const h3 = speakCard.querySelector('.card-body h3');
            return {
                visible: h3 ? h3.textContent.trim() : '',
                ariaLabel: speakCard.getAttribute('aria-label') || ''
            };
        });
        assert.strictEqual(cardLabel.visible, 'Repeat Sentence', 'Speak card visible label should be "Repeat Sentence" in PTE scope');

        // ── SECTION 5: Guest-mode persistence across reload ──
        console.log('[Guest] Verifying scope persistence across reload...');
        // PTE is currently active from section 4 — reload WITHOUT clearing scope
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
        await dismissBlockingOverlays(page);

        const persisted = await page.evaluate(() => ({
            storedScope: localStorage.getItem('practiceScope'),
            ptePressed: document.querySelector('[data-practice-scope="pte"]')?.getAttribute('aria-pressed')
        }));
        assert.strictEqual(persisted.storedScope, 'pte', 'practiceScope should be "pte" in localStorage after reload');
        assert.strictEqual(persisted.ptePressed, 'true', 'PTE button should remain aria-pressed=true after reload');

        // ── SECTION 6: Console / page error assertions ──
        console.log('[Guest] Asserting page errors and failed requests...');

        // pageErrors = genuine JS runtime exceptions (no filtering needed)
        assert.deepStrictEqual(pageErrors, [], `Unexpected JS runtime errors: ${pageErrors.join(' | ')}`);

        // consoleErrors = console.error() calls; filter known SDK/harness noise
        const NOISE = /favicon\.ico|net::ERR_|Failed to fetch|firebase|googleapis|identitytoolkit|database|WebSocket|ERR_NAME|400|responded with a status/i;
        const realConsoleErrors = consoleErrors.filter((e) => !NOISE.test(e));
        assert.deepStrictEqual(realConsoleErrors, [], `Unexpected console errors: ${realConsoleErrors.join(' | ')}`);

        assert.deepStrictEqual(failedRequests, [], `Unexpected failed requests: ${failedRequests.join(' | ')}`);

        console.log('Practice scope guest-mode verification complete.');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
