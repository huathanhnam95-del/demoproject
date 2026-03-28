const { chromium } = require('playwright');

(async () => {
    console.log('Starting Browser Test for Adaptive Question Selection...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
        console.log('Navigating to https://localhost:8443/');
        await page.goto('https://localhost:8443/');

        await page.waitForFunction(() => window.DifficultyManager !== undefined);

        console.log('\n[Scenario 1] Initial State & Uncalibrated Experience...');
        await page.evaluate(() => {
            localStorage.removeItem('difficulty_profile');
            window.location.reload();
        });
        await page.waitForFunction(() => window.DifficultyManager !== undefined);

        const isAuto = await page.evaluate(() => window.DifficultyManager.getGlobalSettings().autoAdjustEnabled);
        if (!isAuto) throw new Error('Expected Adaptive mode to be true by default.');
        console.log('Adaptive mode is enabled by default.');

        const isCalibrated = await page.evaluate(() => window.DifficultyManager.isCalibrated('type'));
        if (isCalibrated) throw new Error('Expected to be uncalibrated initially.');
        console.log('User is uncalibrated initially.');

        console.log('\n[Scenario 2] The Calibration Threshold...');
        await page.evaluate(() => {
            for (let i = 0; i < 10; i++) {
                window.DifficultyManager.adjustDifficulty('type', 0.90, { assisted: false });
            }
        });

        let profile = await page.evaluate(() => window.DifficultyManager.getProfile('type'));
        if (profile.level !== 2) throw new Error(`Expected calibration to push level to 2, got ${profile.level}`);
        console.log('User organically calibrated to Level 2 after grace period.');

        console.log('\n[Scenario 3] Manual Override...');
        await page.evaluate(() => {
            window.DifficultyManager.setManualLevel(4);
        });

        let settings = await page.evaluate(() => window.DifficultyManager.getGlobalSettings());
        if (settings.autoAdjustEnabled !== false) throw new Error('Expected Auto Adjust to be false.');
        if (settings.manualLevel !== 4) throw new Error('Expected Manual Level to be 4.');

        let activeLevel = await page.evaluate(() => window.DifficultyManager.getCurrentSettings('type').level);
        if (activeLevel !== 4) throw new Error(`Expected effective level to be 4 in manual mode, got ${activeLevel}`);
        console.log('Switched to Manual Mode Level 4.');

        await page.evaluate(() => {
            for (let i = 0; i < 10; i++) {
                window.DifficultyManager.adjustDifficulty('type', 0.30, { assisted: false });
            }
        });

        profile = await page.evaluate(() => window.DifficultyManager.getProfile('type'));
        if (profile.level !== 2) {
            throw new Error(`Expected organic profile to remain at Level 2 in manual mode, got ${profile.level}`);
        }
        console.log('User remains on the organic profile while manual mode forces Level 4.');

        console.log('\n[Scenario 4] Returning to Adaptive...');
        await page.evaluate(() => {
            window.DifficultyManager.setAutoAdjustEnabled(true);
            window.location.reload();
        });
        await page.waitForFunction(() => window.DifficultyManager !== undefined);

        settings = await page.evaluate(() => window.DifficultyManager.getGlobalSettings());
        if (!settings.autoAdjustEnabled) throw new Error('Expected Auto Adjust to be true again.');

        activeLevel = await page.evaluate(() => window.DifficultyManager.getCurrentSettings('type').level);
        if (activeLevel !== 2) {
            throw new Error(`Expected adaptive mode to restore the organic Level 2 profile, got ${activeLevel}`);
        }
        console.log('Adaptive mode restored to the organic profile.');

        console.log('\n[Scenario 5] Mode Isolation...');
        const speakProfile = await page.evaluate(() => window.DifficultyManager.getProfile('speak'));
        if (speakProfile.history.length !== 0) throw new Error('Expected Speak Mode history to be empty.');
        console.log('Speak mode remains completely isolated and uncalibrated.');

        console.log('\n=========================================');
        console.log('ALL BROWSER SIMULATION TESTS PASSED.');
        console.log('=========================================');
    } catch (e) {
        console.error('Test Failed:', e.message);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
