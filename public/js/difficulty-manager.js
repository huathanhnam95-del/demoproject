/**
 * DifficultyManager.js (Facade)
 * Bridges the legacy global window.DifficultyManager API to the new modular architecture.
 */
import { DifficultyConfig } from './difficulty/DifficultyConfig.js';
import { DifficultyLogic } from './difficulty/DifficultyLogic.js';
import { DifficultyUI } from './difficulty/DifficultyUI.js';

const DifficultyManager = (function () {
    // --- State ---
    let isInitialized = false;
    // Smart Difficulty is now a core feature (no shop gating).
    // Keep this flag for backward compatibility, but it is always enabled.
    const hasUnlockedFeature = true;
    let globalSettings = {
        autoAdjustEnabled: true,
        adjustmentSensitivity: 'medium', // low, medium, high
        manualLevel: 1
    };
    let userDifficultyProfile = {
        type: null,
        speak: null,
        srs: null
    };

    // --- Modules ---
    const logic = new DifficultyLogic();
    const ui = new DifficultyUI();

    // --- Core Methods ---

    function init() {
        if (isInitialized) return;

        // Load Persistence
        loadProfile();

        // Tab Changes
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-btn')) {
                setTimeout(updateIndicator, 50);
            }
        });

        // Auto-Save
        window.addEventListener('beforeunload', saveProfile);

        ui.init();
        isInitialized = true;

        // Settings entrypoint (UX): clicking the badge opens settings.
        const badge = document.getElementById('difficulty-badge');
        if (badge) {
            badge.addEventListener('click', () => openSettings());
        }

        updateIndicator();
        console.log('Main DifficultyManager Initialized (Modular)');
    }

    function loadProfile() {
        let needsResave = false;
        try {
            const stored = localStorage.getItem(DifficultyConfig.STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                const legacySettings = parsed.settings && !parsed.globalSettings;

                // Migration: legacy schema used `settings` instead of `globalSettings`.
                const loadedGlobalSettings = parsed.globalSettings || parsed.settings;
                // Merge loaded data
                if (loadedGlobalSettings) globalSettings = { ...globalSettings, ...loadedGlobalSettings };
                if (parsed.profiles) userDifficultyProfile = { ...userDifficultyProfile, ...parsed.profiles };

                if (legacySettings) {
                    // Rewrite as canonical schema after defaults are ensured.
                    needsResave = true;
                }
            }
        } catch (e) {
            console.error('[DifficultyManager] Load failed', e);
        }

        // Ensure defaults
        ['type', 'speak', 'srs'].forEach(mode => {
            if (!userDifficultyProfile[mode]) {
                userDifficultyProfile[mode] = logic.makeDefaultProfile();
            }
        });

        if (needsResave) {
            saveProfile();
        }
    }

    function saveProfile() {
        try {
            const data = {
                version: 2,
                globalSettings,
                profiles: userDifficultyProfile,
                lastSaved: Date.now()
            };
            localStorage.setItem(DifficultyConfig.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('[DifficultyManager] Save failed', e);
        }
    }

    function adjustDifficulty(mode, score, meta = {}) {
        const profile = userDifficultyProfile[mode];
        if (!profile) return; // Should not happen after init

        // Record History
        profile.history.push({
            date: Date.now(),
            score: Number(score),
            level: profile.level,
            assisted: !!meta.assisted,
            calibMult: meta.calibMult || 1
        });
        if (profile.history.length > DifficultyConfig.HISTORY_SIZE) profile.history.shift();
        profile.attemptsAtLevel++;

        // Calculate Adjustment
        const result = logic.calculateAdjustment(profile, score, globalSettings);

        if (result) {
            const oldLevel = profile.level;
            profile.level = result.newLevel;
            profile.attemptsAtLevel = 0;
            // Trim history to avoid immediate flip-flop? Logic handles filtering by level, so maybe not needed, 
            // but cleaning up is good.
            // profile.history = []; // Keep history for "Smurf" stats? Logic filters by level.

            saveProfile();

            // Notify UI
            const icon = result.direction === 'increase' ? 'trending-up' : 'trending-down';
            ui.showToast(`Difficulty ${result.direction}d to Level ${result.newLevel}`, 'info', icon);

            if (result.direction === 'increase') {
                const settingName = DifficultyConfig.LEVELS.NAMES[result.newLevel];
                ui.showAscensionModal(result.newLevel, settingName);
            }

            updateIndicator();
        } else if (profile.attemptsAtLevel % 5 === 0) {
            saveProfile();
        }
    }

    function getCurrentSettings(mode) {
        if (!isInitialized) init();

        // 1. Determine Level
        let effectiveLevel = 1;

        if (!globalSettings.autoAdjustEnabled) {
            // Manual
            effectiveLevel = globalSettings.manualLevel;
        } else if (globalSettings.autoAdjustEnabled) {
            // Auto
            effectiveLevel = userDifficultyProfile[mode]?.level || 1;
        }

        // 2. Get Settings from Logic
        return logic.getLevelSettings(mode, effectiveLevel);
    }

    function setManualLevel(level) {
        if (!isInitialized) init();

        level = parseInt(level, 10);
        if (isNaN(level) || level < 1 || level > 6) return;

        globalSettings.autoAdjustEnabled = false;
        globalSettings.manualLevel = level;

        // Reset all profiles to this level
        Object.keys(userDifficultyProfile).forEach(m => {
            if (userDifficultyProfile[m]) {
                userDifficultyProfile[m].level = level;
                userDifficultyProfile[m].history = []; // Clear history to reset "momentum"
                userDifficultyProfile[m].attemptsAtLevel = 0;
            }
        });

        saveProfile();
        updateIndicator();
    }

    /**
     * Seed a starting CEFR level without toggling auto-adjust off.
     * Used by onboarding / AuthUI to set an initial level baseline.
     * @param {number} level
     */
    function seedLevel(level) {
        if (!isInitialized) init();

        level = parseInt(level, 10);
        if (isNaN(level) || level < 1 || level > 6) return;

        globalSettings.manualLevel = level;

        Object.keys(userDifficultyProfile).forEach(m => {
            if (userDifficultyProfile[m]) {
                userDifficultyProfile[m].level = level;
                userDifficultyProfile[m].history = [];
                userDifficultyProfile[m].attemptsAtLevel = 0;
            }
        });

        saveProfile();
        updateIndicator();
    }

    function openSettings() {
        if (!isInitialized) init();
        ui.openSettingsModal(globalSettings, (newSettings) => {
            globalSettings = { ...globalSettings, ...newSettings };

            // If manual level changed, apply it
            if (!globalSettings.autoAdjustEnabled) {
                setManualLevel(globalSettings.manualLevel);
                // setManualLevel handles saving
            } else {
                saveProfile();
                updateIndicator();
            }
        });
    }

    function updateIndicator() {
        // Simple heuristic for active mode (can be improved)
        let activeMode = 'type';
        if (document.querySelector('#tab-speak.active')) activeMode = 'speak';
        else if (document.querySelector('#tab-srs.active')) activeMode = 'srs';

        const settings = getCurrentSettings(activeMode); // Resolve level
        ui.updateBadge(activeMode, settings.level, !globalSettings.autoAdjustEnabled);
    }

    // Public API
    return {
        init,
        // Back-compat: public/script.js expects this to exist.
        // Semantics: feature availability (not whether auto-adjust is toggled on).
        isFeatureEnabled: () => hasUnlockedFeature,
        adjustDifficulty,
        getCurrentSettings,
        openSettings,
        setManualLevel,
        seedLevel,
        // Expose state getters for debugging
        getProfile: (mode) => userDifficultyProfile[mode],
        getGlobalSettings: () => globalSettings
    };
})();

// Assign to window
window.DifficultyManager = DifficultyManager;

// Auto-init logic if verified? Original code called init() inside methods if not init. 
// We generally want to export the module.
export default DifficultyManager;
