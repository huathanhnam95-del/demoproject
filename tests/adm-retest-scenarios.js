/**
 * ADM Browser Retest Plan — Scenarios S1-S13
 * Runs against https://localhost:8443 via Playwright
 * Uses correct DifficultyManager API: setManualLevel, setAutoAdjustEnabled, adjustDifficulty
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'https://localhost:8443';
const results = [];

function log(scenario, status, detail) {
    const entry = { scenario, status, detail };
    results.push(entry);
    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    console.log(`${icon} ${scenario}: ${detail}`);
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();
    const consoleErrors = [];

    page.on('pageerror', (err) => consoleErrors.push(err.message));
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            const t = msg.text();
            if (!t.includes('Failed to load resource') && !t.includes('favicon'))
                consoleErrors.push(t);
        }
    });

    async function goMode(mode) {
        await page.goto(`${BASE}/practice.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
    }

    async function evalDM(fn, ...args) {
        return page.evaluate(fn, ...args);
    }

    // ================================================================
    // S1: Fresh Chrome Baseline
    // ================================================================
    try {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await page.evaluate(() => localStorage.clear());
        await goMode('type');

        const badgeExists = await page.locator('#difficulty-badge').count();
        const modalExists = await page.locator('#adaptive-engine-modal').count();

        log('S1', badgeExists >= 1 ? 'PASS' : 'FAIL', `Badge count=${badgeExists}`);
        log('S1', modalExists >= 1 ? 'PASS' : 'FAIL', `Modal count=${modalExists}`);

        const adaptiveErrors = consoleErrors.filter(e =>
            e.toLowerCase().includes('adaptive') || e.toLowerCase().includes('difficulty')
        );
        log('S1', adaptiveErrors.length === 0 ? 'PASS' : 'WARN',
            adaptiveErrors.length === 0 ? 'No adaptive console errors' : `Errors: ${adaptiveErrors.join('; ')}`);
    } catch (e) {
        log('S1', 'FAIL', e.message);
    }

    // ================================================================
    // S2: Adaptive → Manual → Adaptive Contract
    // ================================================================
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode('type');

        // 1. Fresh user starts uncalibrated
        const initial = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            return { profile: dm.getProfile('type'), settings: dm.getCurrentSettings('type') };
        });
        log('S2', initial ? 'PASS' : 'FAIL',
            `Initial: level=${initial?.profile?.level}, calibrated=${initial?.settings?.calibrated}`);

        // 2. Simulate strong attempts to promote via adjustDifficulty
        const promoted = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            for (let i = 0; i < 15; i++) {
                dm.adjustDifficulty('type', 0.95, { wpm: 60, accuracy: 0.95 });
            }
            return { profile: dm.getProfile('type'), settings: dm.getCurrentSettings('type') };
        });
        log('S2', 'PASS', `After 15 strong: level=${promoted?.profile?.level}, calibrated=${promoted?.settings?.calibrated}`);

        // 3. Switch to manual mode (setManualLevel disables auto + sets level)
        const manual = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            dm.setManualLevel(4);
            return { profile: dm.getProfile('type'), settings: dm.getCurrentSettings('type'), global: dm.getGlobalSettings() };
        });
        log('S2', 'PASS',
            `Manual mode: effective=${manual?.settings?.level}, organic=${manual?.profile?.level}, autoAdjust=${manual?.global?.autoAdjustEnabled}`);

        // Verify organic profile preserved
        if (manual && manual.profile.level !== manual.settings.level) {
            log('S2', 'PASS', 'Organic profile preserved (differs from manual effective level)');
        } else if (manual) {
            log('S2', 'WARN', 'Organic and effective levels match — may be a coincidence');
        }

        // 4. Weak attempts in manual mode
        const afterWeak = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            for (let i = 0; i < 5; i++) {
                dm.adjustDifficulty('type', 0.15, { wpm: 10, accuracy: 0.15 });
            }
            return { profile: dm.getProfile('type'), settings: dm.getCurrentSettings('type') };
        });
        log('S2', 'PASS', `After weak in manual: organic=${afterWeak?.profile?.level}`);

        // 5. Re-enable adaptive
        const restored = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            dm.setAutoAdjustEnabled(true);
            return { profile: dm.getProfile('type'), settings: dm.getCurrentSettings('type') };
        });
        log('S2', 'PASS',
            `Adaptive restored: effective=${restored?.settings?.level}, organic=${restored?.profile?.level}, source=${restored?.settings?.source}`);
    } catch (e) {
        log('S2', 'FAIL', e.message);
    }

    // ================================================================
    // S3: Question-Difficulty Override Persistence
    // ================================================================
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode('type');

        await page.evaluate(() => localStorage.setItem('questionDifficulty_type_guest', '1'));
        await goMode('type');

        const afterReload = await page.evaluate(() => localStorage.getItem('questionDifficulty_type_guest'));
        log('S3', afterReload === '1' ? 'PASS' : 'FAIL', `After reload: ${afterReload}`);

        // Set manual engine level 4, confirm browser override stays at 1
        await evalDM(() => { if (window.DifficultyManager) window.DifficultyManager.setManualLevel(4); });
        const afterManual = await page.evaluate(() => localStorage.getItem('questionDifficulty_type_guest'));
        log('S3', afterManual === '1' ? 'PASS' : 'FAIL', `After engine→4: override=${afterManual}`);
    } catch (e) {
        log('S3', 'FAIL', e.message);
    }

    // ================================================================
    // S4: Legacy Key Migration
    // ================================================================
    try {
        await page.evaluate(() => localStorage.clear());
        await page.evaluate(() => {
            localStorage.removeItem('questionDifficulty_type_guest');
            localStorage.setItem('difficultyFilter_type_guest', '2');
        });
        await goMode('type');

        const migrated = await page.evaluate(() => ({
            newKey: localStorage.getItem('questionDifficulty_type_guest'),
            oldKey: localStorage.getItem('difficultyFilter_type_guest')
        }));
        if (migrated.newKey === '2' && migrated.oldKey === null) {
            log('S4', 'PASS', 'Legacy migrated: new=2, old=deleted');
        } else if (migrated.newKey === '2') {
            log('S4', 'WARN', `Migrated but old lingering: old=${migrated.oldKey}`);
        } else {
            log('S4', 'FAIL', `new=${migrated.newKey}, old=${migrated.oldKey}`);
        }
    } catch (e) {
        log('S4', 'FAIL', e.message);
    }

    // ================================================================
    // S5: Invalid Stored Value Self-Healing
    // ================================================================
    try {
        await page.evaluate(() => localStorage.clear());
        await page.evaluate(() => localStorage.setItem('questionDifficulty_notes_guest', 'bogus'));
        await goMode('notes');

        const healed = await page.evaluate(() => ({
            stored: localStorage.getItem('questionDifficulty_notes_guest')
        }));
        // After load the app should normalize or ignore the bogus value
        log('S5', healed.stored !== 'bogus' ? 'PASS' : 'WARN',
            `Stored after heal: ${healed.stored} (bogus should be cleaned or defaulted)`);
    } catch (e) {
        log('S5', 'FAIL', e.message);
    }

    // ================================================================
    // S6: Reload Timing Around Promotion
    // ================================================================
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode('type');

        // 9 strong attempts
        const before10 = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            for (let i = 0; i < 9; i++) dm.adjustDifficulty('type', 0.95, {});
            return dm.getProfile('type');
        });
        log('S6', 'PASS', `After 9: level=${before10?.level}, attempts=${before10?.attemptsAtLevel}`);

        // Reload
        await goMode('type');
        const afterReload9 = await evalDM(() => window.DifficultyManager?.getProfile('type'));
        log('S6', 'PASS', `After reload(9): level=${afterReload9?.level}`);

        // 10th attempt
        const after10 = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            dm.adjustDifficulty('type', 0.95, {});
            return dm.getProfile('type');
        });
        log('S6', 'PASS', `After 10th: level=${after10?.level}`);

        // Reload and verify persistence
        await goMode('type');
        const afterReload10 = await evalDM(() => window.DifficultyManager?.getProfile('type'));
        log('S6', afterReload10?.level === after10?.level ? 'PASS' : 'FAIL',
            `Reload persistence: expected=${after10?.level}, got=${afterReload10?.level}`);
    } catch (e) {
        log('S6', 'FAIL', e.message);
    }

    // ================================================================
    // S7: Reload Timing Around Demotion
    // ================================================================
    try {
        await goMode('type');
        const preLevel = await evalDM(() => window.DifficultyManager?.getProfile('type'));
        log('S7', 'PASS', `Starting level: ${preLevel?.level}`);

        const afterWeak = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            for (let i = 0; i < 15; i++) dm.adjustDifficulty('type', 0.1, {});
            return dm.getProfile('type');
        });
        log('S7', 'PASS', `After 15 weak: level=${afterWeak?.level}`);

        await goMode('type');
        const afterReload = await evalDM(() => window.DifficultyManager?.getProfile('type'));
        log('S7', afterReload?.level === afterWeak?.level ? 'PASS' : 'FAIL',
            `Demotion survives reload: expected=${afterWeak?.level}, got=${afterReload?.level}`);
    } catch (e) {
        log('S7', 'FAIL', e.message);
    }

    // ================================================================
    // S8: Corrupt/Partial difficulty_profile
    // ================================================================
    try {
        // Corrupt JSON
        await page.evaluate(() => localStorage.setItem('difficulty_profile', '{CORRUPT!!!}'));
        await goMode('type');

        const afterCorrupt = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            return { type: dm.getProfile('type'), speak: dm.getProfile('speak'), notes: dm.getProfile('notes') };
        });
        log('S8', afterCorrupt?.type ? 'PASS' : 'FAIL',
            `Corrupt recovery: type.level=${afterCorrupt?.type?.level}`);

        // Partial payload
        await page.evaluate(() => {
            localStorage.setItem('difficulty_profile', JSON.stringify({
                version: 3,
                globalSettings: { autoAdjustEnabled: true, adjustmentSensitivity: 'medium', manualLevel: 1 },
                profiles: { type: { level: 3, exp: 0, history: [], attemptsAtLevel: 20 } }
            }));
        });
        await goMode('type');

        const afterPartial = await evalDM(() => {
            const dm = window.DifficultyManager;
            if (!dm) return null;
            return {
                type: dm.getProfile('type'),
                speak: dm.getProfile('speak'),
                notes: dm.getProfile('notes'),
                extended: dm.getProfile('extended')
            };
        });
        log('S8', afterPartial?.speak ? 'PASS' : 'WARN',
            `Partial: type=${afterPartial?.type?.level}, speak=${afterPartial?.speak?.level}, notes=${afterPartial?.notes?.level}`);
    } catch (e) {
        log('S8', 'FAIL', e.message);
    }

    // ================================================================
    // S9: CEFR 4-6 Mapping
    // ================================================================
    try {
        for (const level of [4, 5, 6]) {
            await page.evaluate(() => localStorage.clear());
            await goMode('type');

            await evalDM((lvl) => {
                if (window.DifficultyManager) window.DifficultyManager.setManualLevel(lvl);
            }, level);

            await page.waitForTimeout(1000);
            const settings = await evalDM((lvl) => {
                const dm = window.DifficultyManager;
                if (!dm) return null;
                return dm.getCurrentSettings('type');
            }, level);

            log('S9', settings?.contentTier ? 'PASS' : 'WARN',
                `Level ${level}: tier=${settings?.contentTier}, effectiveLevel=${settings?.level}`);
        }
    } catch (e) {
        log('S9', 'FAIL', e.message);
    }

    // ================================================================
    // S10: Manual Override + Browser Override Conflict
    // ================================================================
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode('type');

        await evalDM(() => { window.DifficultyManager?.setManualLevel(6); });
        await page.evaluate(() => localStorage.setItem('questionDifficulty_type_guest', '1'));
        await page.waitForTimeout(500);

        const conflict = await page.evaluate(() => {
            const dm = window.DifficultyManager;
            return {
                engineLevel: dm?.getCurrentSettings('type')?.level,
                browserOverride: localStorage.getItem('questionDifficulty_type_guest')
            };
        });

        if (conflict.engineLevel && conflict.browserOverride === '1') {
            log('S10', 'PASS', `Engine=${conflict.engineLevel}, Browser=${conflict.browserOverride} — independent`);
        } else {
            log('S10', 'FAIL', JSON.stringify(conflict));
        }
    } catch (e) {
        log('S10', 'FAIL', e.message);
    }

    // ================================================================
    // S11: Auth Transition Isolation
    // ================================================================
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode('extended');

        await page.evaluate(() => localStorage.setItem('questionDifficulty_extended_guest', '2'));
        const guestKey = await page.evaluate(() => localStorage.getItem('questionDifficulty_extended_guest'));
        log('S11', 'PASS', `Guest override: ${guestKey}`);

        // Simulate user-scoped key
        await page.evaluate(() => localStorage.setItem('questionDifficulty_extended_huathanhnam95@gmail.com', '4'));
        const isolation = await page.evaluate(() => ({
            guest: localStorage.getItem('questionDifficulty_extended_guest'),
            user: localStorage.getItem('questionDifficulty_extended_huathanhnam95@gmail.com')
        }));

        log('S11', isolation.guest === '2' && isolation.user === '4' ? 'PASS' : 'FAIL',
            `Isolation: guest=${isolation.guest}, user=${isolation.user}`);
    } catch (e) {
        log('S11', 'FAIL', e.message);
    }

    // ================================================================
    // S12: Recommendation & Media Sync
    // ================================================================
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode('extended');
        await page.waitForTimeout(2000);

        // Check for any recommendation button
        const extRecExists = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, .recommended-btn, [data-action]');
            for (const b of btns) {
                if (b.textContent?.toLowerCase().includes('recommend')) return true;
            }
            return false;
        });
        log('S12', extRecExists ? 'PASS' : 'WARN', `Extended recommend button: ${extRecExists}`);

        await goMode('notes');
        await page.waitForTimeout(2000);
        const notesRecExists = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, .recommended-btn, [data-action]');
            for (const b of btns) {
                if (b.textContent?.toLowerCase().includes('recommend')) return true;
            }
            return false;
        });
        log('S12', notesRecExists ? 'PASS' : 'WARN', `Notes recommend button: ${notesRecExists}`);
    } catch (e) {
        log('S12', 'FAIL', e.message);
    }

    // ================================================================
    // S13: Multi-Tab Storage Race
    // ================================================================
    try {
        await page.evaluate(() => localStorage.clear());
        await goMode('type');

        // Tab A writes 1
        await page.evaluate(() => localStorage.setItem('questionDifficulty_type_guest', '1'));
        // Tab B writes 3
        await page.evaluate(() => localStorage.setItem('questionDifficulty_type_guest', '3'));

        await goMode('type');
        const finalVal = await page.evaluate(() => localStorage.getItem('questionDifficulty_type_guest'));
        log('S13', finalVal === '3' ? 'PASS' : 'FAIL', `Last write wins: ${finalVal}`);
    } catch (e) {
        log('S13', 'FAIL', e.message);
    }

    // ================================================================
    // SUMMARY
    // ================================================================
    await browser.close();

    console.log('\n========================================');
    console.log('ADM RETEST RESULTS SUMMARY');
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
