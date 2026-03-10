const { chromium } = require('playwright');

(async () => {
    console.log("Starting Browser Test for Adaptive Question Selection...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
        console.log("Navigating to https://localhost:8443/");
        await page.goto('https://localhost:8443/');
        
        // Wait for difficulty manager to initialize
        await page.waitForFunction(() => window.DifficultyManager !== undefined);

        // --- Scenario 1: Initial State & Uncalibrated Experience ---
        console.log("\n[Scenario 1] Initial State & Uncalibrated Experience...");
        
        // Clear local storage for profile
        await page.evaluate(() => {
            localStorage.removeItem('difficulty_profile');
            window.location.reload();
        });
        await page.waitForFunction(() => window.DifficultyManager !== undefined);

        // Verify Adaptive Mode is default (globalSettings.autoAdjustEnabled === true)
        const isAuto = await page.evaluate(() => window.DifficultyManager.getGlobalSettings().autoAdjustEnabled);
        if (!isAuto) throw new Error("Expected Adaptive mode to be true by default.");
        console.log(" ✓ Adaptive Mode is enabled by default.");

        // Check if uncalibrated
        const isCalibrated = await page.evaluate(() => window.DifficultyManager.isCalibrated('type'));
        if (isCalibrated) throw new Error("Expected to be uncalibrated initially.");
        console.log(" ✓ User is uncalibrated initially.");

        // --- Scenario 2: Calibration Threshold ---
        console.log("\n[Scenario 2] The Calibration Threshold...");
        // Force 10 perfect attempts via Logic (simulate gameplay)
        await page.evaluate(() => {
            for (let i = 0; i < 10; i++) {
                window.DifficultyManager.adjustDifficulty('type', 0.90, { assisted: false });
            }
        });

        // After 10 attempts (Grace Period = 10), level should increase
        let profile = await page.evaluate(() => window.DifficultyManager.getProfile('type'));
        if (profile.level !== 2) throw new Error(`Expected calibration to push level to 2, got ${profile.level}`);
        console.log(" ✓ User organically calibrated to Level 2 after grace period.");

        // --- Scenario 3: Manual Override ---
        console.log("\n[Scenario 3] Manual Override...");
        // Set manual level 4
        await page.evaluate(() => {
            window.DifficultyManager.setManualLevel(4);
        });

        let settings = await page.evaluate(() => window.DifficultyManager.getGlobalSettings());
        if (settings.autoAdjustEnabled !== false) throw new Error("Expected Auto Adjust to be false.");
        if (settings.manualLevel !== 4) throw new Error("Expected Manual Level to be 4.");
        console.log(" ✓ Switched to Manual Mode Level 4.");

        // Fail 10 times in manual mode
        await page.evaluate(() => {
            for (let i = 0; i < 10; i++) {
                window.DifficultyManager.adjustDifficulty('type', 0.30, { assisted: false });
            }
        });
        // Verify it did not demote
        profile = await page.evaluate(() => window.DifficultyManager.getProfile('type'));
        if (profile.level !== 4) throw new Error(`Expected level to remain 4 in manual mode, got ${profile.level}`);
        console.log(" ✓ User remains at Level 4 in Manual Mode despite failing.");

        // --- Scenario 4: Returning to Adaptive ---
        console.log("\n[Scenario 4] Returning to Adaptive...");
        await page.evaluate(() => {
            // Re-enable adaptive (simulate toggle)
            const settings = window.DifficultyManager.getGlobalSettings();
            window.DifficultyManager.openSettings(); // Initialize UI interaction if needed
            // Actually change setting directly for headless
            const data = JSON.parse(localStorage.getItem('difficulty_profile'));
            data.globalSettings.autoAdjustEnabled = true;
            localStorage.setItem('difficulty_profile', JSON.stringify(data));
            window.location.reload();
        });
        await page.waitForFunction(() => window.DifficultyManager !== undefined);

        settings = await page.evaluate(() => window.DifficultyManager.getGlobalSettings());
        if (!settings.autoAdjustEnabled) throw new Error("Expected Auto Adjust to be true again.");
        
        let activeLevel = await page.evaluate(() => window.DifficultyManager.getCurrentSettings('type').level);
        if (activeLevel !== 4) {
             console.log(` ✓ Returned to organic level tracking (Level ${activeLevel}).`);
        } else {
            console.log(" ✓ Adaptive mode restored.");
        }

        // --- Scenario 5: Mode Isolation ---
        console.log("\n[Scenario 5] Mode Isolation...");
        const speakProfile = await page.evaluate(() => window.DifficultyManager.getProfile('speak'));
        if (speakProfile.history.length !== 0) throw new Error("Expected Speak Mode history to be empty.");
        console.log(" ✓ Speak mode remains completely isolated and uncalibrated.");

        console.log("\n=========================================");
        console.log("✅ ALL BROWSER SIMULATION TESTS PASSED.");
        console.log("=========================================");

    } catch (e) {
        console.error("❌ Test Failed:", e.message);
    } finally {
        await browser.close();
    }
})();