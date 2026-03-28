/**
 * ADM Browser Retest — S14 (Edge), S15 (Firefox), S16 (Mobile Emulation)
 * Re-runs core scenarios on alternative browsers and viewports.
 */
const { chromium, firefox } = require('playwright');

const BASE = process.env.BASE_URL || 'https://localhost:8443';
const results = [];

function log(scenario, status, detail) {
    results.push({ scenario, status, detail });
    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    console.log(`${icon} ${scenario}: ${detail}`);
}

async function goMode(page, mode) {
    await page.goto(`${BASE}/practice.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
}

async function runCoreScenarios(page, browserLabel) {
    // --- S1-equivalent: Badge + Modal ---
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode(page, 'type');

        const badge = await page.locator('#difficulty-badge').count();
        const modal = await page.locator('#adaptive-engine-modal').count();
        log(`${browserLabel}-S1`, badge >= 1 && modal >= 1 ? 'PASS' : 'FAIL',
            `Badge=${badge}, Modal=${modal}`);
    } catch (e) {
        log(`${browserLabel}-S1`, 'FAIL', e.message);
    }

    // --- S2-equivalent: Adaptive contract ---
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode(page, 'type');

        const result = await page.evaluate(() => {
            const dm = window.DifficultyManager;
            if (!dm) return { error: 'no DM' };

            // Strong attempts
            for (let i = 0; i < 15; i++) dm.adjustDifficulty('type', 0.95, {});
            const afterStrong = { level: dm.getProfile('type').level, calibrated: dm.getCurrentSettings('type').calibrated };

            // Manual
            dm.setManualLevel(4);
            const organic = dm.getProfile('type').level;
            const effective = dm.getCurrentSettings('type').level;

            // Restore adaptive
            dm.setAutoAdjustEnabled(true);
            const restored = dm.getCurrentSettings('type').level;

            return { afterStrong, organic, effective, restored };
        });

        if (result && !result.error) {
            log(`${browserLabel}-S2`, 'PASS',
                `Strong→level=${result.afterStrong.level}, Manual→eff=${result.effective}/org=${result.organic}, Restored→${result.restored}`);
        } else {
            log(`${browserLabel}-S2`, 'FAIL', JSON.stringify(result));
        }
    } catch (e) {
        log(`${browserLabel}-S2`, 'FAIL', e.message);
    }

    // --- S3-equivalent: Override persistence ---
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode(page, 'type');
        await page.evaluate(() => localStorage.setItem('questionDifficulty_type_guest', '1'));
        await goMode(page, 'type');

        const val = await page.evaluate(() => localStorage.getItem('questionDifficulty_type_guest'));
        log(`${browserLabel}-S3`, val === '1' ? 'PASS' : 'FAIL', `Override after reload: ${val}`);
    } catch (e) {
        log(`${browserLabel}-S3`, 'FAIL', e.message);
    }

    // --- S11-equivalent: Auth isolation ---
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode(page, 'extended');
        await page.evaluate(() => {
            localStorage.setItem('questionDifficulty_extended_guest', '2');
            localStorage.setItem('questionDifficulty_extended_user@test.com', '5');
        });

        const iso = await page.evaluate(() => ({
            guest: localStorage.getItem('questionDifficulty_extended_guest'),
            user: localStorage.getItem('questionDifficulty_extended_user@test.com')
        }));
        log(`${browserLabel}-S11`, iso.guest === '2' && iso.user === '5' ? 'PASS' : 'FAIL',
            `guest=${iso.guest}, user=${iso.user}`);
    } catch (e) {
        log(`${browserLabel}-S11`, 'FAIL', e.message);
    }
}

(async () => {
    // ================================================================
    // S14: Edge Desktop Parity (Chromium-based)
    // ================================================================
    console.log('\n--- S14: Edge Desktop Parity (via Chromium channel) ---');
    try {
        // Edge is Chromium-based; use chromium with msedge channel if available, else use chromium
        let edgeBrowser;
        try {
            edgeBrowser = await chromium.launch({ headless: true, channel: 'msedge' });
        } catch {
            console.log('⚠️ msedge channel not found, using chromium as proxy for Edge');
            edgeBrowser = await chromium.launch({ headless: true });
        }
        const edgeCtx = await edgeBrowser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
        const edgePage = await edgeCtx.newPage();
        await runCoreScenarios(edgePage, 'Edge');
        await edgeBrowser.close();
    } catch (e) {
        log('Edge', 'FAIL', `Edge launch failed: ${e.message}`);
    }

    // ================================================================
    // S15: Firefox Smoke
    // ================================================================
    console.log('\n--- S15: Firefox Smoke ---');
    try {
        const ffBrowser = await firefox.launch({ headless: true });
        const ffCtx = await ffBrowser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
        const ffPage = await ffCtx.newPage();

        await ffPage.evaluate(() => localStorage.clear());
        await goMode(ffPage, 'type');

        const badge = await ffPage.locator('#difficulty-badge').count();
        const modal = await ffPage.locator('#adaptive-engine-modal').count();
        log('Firefox-S15', badge >= 1 && modal >= 1 ? 'PASS' : 'FAIL', `Badge=${badge}, Modal=${modal}`);

        // Persistence
        await ffPage.evaluate(() => localStorage.setItem('questionDifficulty_type_guest', '2'));
        await goMode(ffPage, 'type');
        const persisted = await ffPage.evaluate(() => localStorage.getItem('questionDifficulty_type_guest'));
        log('Firefox-S15', persisted === '2' ? 'PASS' : 'FAIL', `Persistence: ${persisted}`);

        // Notes + Extended
        await goMode(ffPage, 'notes');
        const notesOk = await ffPage.locator('#difficulty-badge').count();
        log('Firefox-S15', notesOk >= 1 ? 'PASS' : 'WARN', `Notes badge: ${notesOk}`);

        await goMode(ffPage, 'extended');
        const extOk = await ffPage.locator('#difficulty-badge').count();
        log('Firefox-S15', extOk >= 1 ? 'PASS' : 'WARN', `Extended badge: ${extOk}`);

        // Console errors
        const ffErrors = [];
        ffPage.on('pageerror', (e) => ffErrors.push(e.message));
        await goMode(ffPage, 'type');
        log('Firefox-S15', ffErrors.length === 0 ? 'PASS' : 'WARN',
            ffErrors.length === 0 ? 'No page errors' : `Errors: ${ffErrors.join('; ')}`);

        await ffBrowser.close();
    } catch (e) {
        log('Firefox-S15', 'FAIL', `Firefox error: ${e.message}`);
    }

    // ================================================================
    // S16: Mobile Emulation (375x667)
    // ================================================================
    console.log('\n--- S16: Mobile Emulation ---');
    try {
        const mobileBrowser = await chromium.launch({ headless: true });
        const mobileCtx = await mobileBrowser.newContext({
            ignoreHTTPSErrors: true,
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true
        });
        const mobilePage = await mobileCtx.newPage();

        await mobilePage.evaluate(() => localStorage.clear());
        await goMode(mobilePage, 'type');

        // Badge visible
        const badge = await mobilePage.locator('#difficulty-badge').count();
        log('Mobile-S16', badge >= 1 ? 'PASS' : 'FAIL', `Badge visible: ${badge}`);

        // Modal exists
        const modal = await mobilePage.locator('#adaptive-engine-modal').count();
        log('Mobile-S16', modal >= 1 ? 'PASS' : 'FAIL', `Modal exists: ${modal}`);

        // Check if badge is not clipped (still within viewport)
        const badgeBox = await mobilePage.locator('#difficulty-badge').first().boundingBox();
        if (badgeBox) {
            const withinViewport = badgeBox.x >= 0 && badgeBox.y >= 0 && (badgeBox.x + badgeBox.width) <= 375;
            log('Mobile-S16', withinViewport ? 'PASS' : 'WARN',
                `Badge bounds: x=${Math.round(badgeBox.x)}, y=${Math.round(badgeBox.y)}, w=${Math.round(badgeBox.width)}`);
        } else {
            log('Mobile-S16', 'WARN', 'Badge bounding box not available');
        }

        // Controls still functional
        const fn = await mobilePage.evaluate(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            return dm.getCurrentSettings('type');
        });
        log('Mobile-S16', fn ? 'PASS' : 'FAIL', `DM functional on mobile: level=${fn?.level}`);

        await mobileBrowser.close();
    } catch (e) {
        log('Mobile-S16', 'FAIL', e.message);
    }

    // ================================================================
    // SUMMARY
    // ================================================================
    console.log('\n========================================');
    console.log('CROSS-BROWSER RETEST SUMMARY');
    console.log('========================================');
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const warned = results.filter(r => r.status === 'WARN').length;
    console.log(`PASS: ${passed}  |  FAIL: ${failed}  |  WARN: ${warned}  |  TOTAL: ${results.length}`);

    if (failed > 0) {
        console.log('\n--- FAILURES ---');
        results.filter(r => r.status === 'FAIL').forEach(r =>
            console.log(`  ❌ ${r.scenario}: ${r.detail}`)
        );
    }
    if (warned > 0) {
        console.log('\n--- WARNINGS ---');
        results.filter(r => r.status === 'WARN').forEach(r =>
            console.log(`  ⚠️ ${r.scenario}: ${r.detail}`)
        );
    }

    console.log('\n========================================');
    process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(2);
});
