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
        srs: null,
        extended: null,
        rfib: null,
        notes: null,
        rop: null
    };
    const STORAGE_VERSION = 3;
    const SUPPORTED_MODES = ['type', 'speak', 'srs', 'extended', 'rfib', 'notes', 'rop'];

    // --- Modules ---
    const logic = new DifficultyLogic();
    const ui = new DifficultyUI();

    // --- Core Methods ---

    function clampLevel(level, fallback = 1) {
        const parsed = Number.parseInt(level, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(DifficultyConfig.LEVELS.MIN, Math.min(DifficultyConfig.LEVELS.MAX, parsed));
    }

    function normalizeGlobalSettings(settings = {}) {
        const merged = {
            autoAdjustEnabled: true,
            adjustmentSensitivity: DifficultyConfig.ADJUSTMENT.DEFAULT_SENSITIVITY,
            manualLevel: 1,
            ...settings
        };

        return {
            autoAdjustEnabled: !!merged.autoAdjustEnabled,
            adjustmentSensitivity: ['low', 'medium', 'high'].includes(merged.adjustmentSensitivity)
                ? merged.adjustmentSensitivity
                : DifficultyConfig.ADJUSTMENT.DEFAULT_SENSITIVITY,
            manualLevel: clampLevel(merged.manualLevel, 1)
        };
    }

    function normalizeHistoryEntry(entry, fallbackLevel) {
        if (!entry || typeof entry !== 'object') return null;
        const score = Number(entry.score);
        const calibMult = Number(entry.calibMult);
        return {
            date: Number.isFinite(Number(entry.date)) ? Number(entry.date) : Date.now(),
            score: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0,
            level: clampLevel(entry.level, fallbackLevel),
            assisted: !!entry.assisted,
            calibMult: Number.isFinite(calibMult) ? Math.max(0.25, Math.min(1.0, calibMult)) : 1.0
        };
    }

    function normalizeProfile(profile, fallbackLevel = 1) {
        const base = logic.makeDefaultProfile();
        if (!profile || typeof profile !== 'object') {
            return { ...base, level: clampLevel(fallbackLevel, 1) };
        }

        const history = Array.isArray(profile.history)
            ? profile.history.map((entry) => normalizeHistoryEntry(entry, clampLevel(profile.level, fallbackLevel))).filter(Boolean)
            : [];

        return {
            level: clampLevel(profile.level, fallbackLevel),
            exp: Number.isFinite(Number(profile.exp)) ? Number(profile.exp) : base.exp,
            history: history.slice(-DifficultyConfig.HISTORY_SIZE),
            attemptsAtLevel: Number.isFinite(Number(profile.attemptsAtLevel))
                ? Math.max(0, Number(profile.attemptsAtLevel))
                : history.length
        };
    }

    function hydrateProfiles(rawProfiles = {}) {
        const hydrated = {};
        SUPPORTED_MODES.forEach((mode) => {
            hydrated[mode] = normalizeProfile(rawProfiles[mode], globalSettings.manualLevel);
        });
        return hydrated;
    }

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
    }

    function loadProfile() {
        let needsResave = false;
        try {
            const stored = localStorage.getItem(DifficultyConfig.STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                const legacySettings = parsed.settings && !parsed.globalSettings;
                const versionMismatch = Number(parsed.version) !== STORAGE_VERSION;

                globalSettings = normalizeGlobalSettings(parsed.globalSettings || parsed.settings || globalSettings);
                userDifficultyProfile = hydrateProfiles(parsed.profiles || {});

                if (legacySettings || versionMismatch) {
                    needsResave = true;
                }
            }
        } catch (e) {
            console.error('[DifficultyManager] Load failed', e);
            globalSettings = normalizeGlobalSettings(globalSettings);
        }

        // Ensure defaults
        SUPPORTED_MODES.forEach(mode => {
            if (!userDifficultyProfile[mode]) {
                userDifficultyProfile[mode] = normalizeProfile(null, globalSettings.manualLevel);
            }
        });

        if (needsResave) {
            saveProfile();
        }
    }

    function saveProfile() {
        try {
            const data = {
                version: STORAGE_VERSION,
                globalSettings: normalizeGlobalSettings(globalSettings),
                profiles: userDifficultyProfile,
                lastSaved: Date.now()
            };
            localStorage.setItem(DifficultyConfig.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('[DifficultyManager] Save failed', e);
        }
    }

    function getEffectiveLevel(mode) {
        if (!isInitialized) init();

        if (!globalSettings.autoAdjustEnabled) {
            return clampLevel(globalSettings.manualLevel, 1);
        }

        return clampLevel(userDifficultyProfile[mode]?.level, 1);
    }

    function getContentTier(mode) {
        return DifficultyConfig.getContentTierForLevel(getEffectiveLevel(mode));
    }

    function adjustDifficulty(mode, score, meta = {}) {
        if (!isInitialized) init();

        const profile = userDifficultyProfile[mode];
        if (!profile) return; // Should not happen after init

        const safeScore = Number.isFinite(Number(score)) ? Math.max(0, Math.min(1, Number(score))) : 0;

        // Record History
        profile.history.push({
            date: Date.now(),
            score: safeScore,
            level: profile.level,
            assisted: !!meta.assisted,
            calibMult: meta.calibMult || 1
        });
        if (profile.history.length > DifficultyConfig.HISTORY_SIZE) profile.history.shift();
        profile.attemptsAtLevel++;

        // Calculate Adjustment
        const result = logic.calculateAdjustment(profile, safeScore, globalSettings);

        if (result) {
            profile.level = result.newLevel;
            profile.attemptsAtLevel = 0;
            // Trim history to avoid immediate flip-flop? Logic handles filtering by level, so maybe not needed, 
            // but cleaning up is good.
            // profile.history = []; // Keep history for "Smurf" stats? Logic filters by level.

            // Notify UI
            const icon = result.direction === 'increase' ? 'trending-up' : 'trending-down';
            ui.showToast(`Difficulty ${result.direction}d to Level ${result.newLevel}`, 'info', icon);

            if (result.direction === 'increase') {
                const settingName = DifficultyConfig.LEVELS.NAMES[result.newLevel];
                ui.showAscensionModal(result.newLevel, settingName);
            }

            updateIndicator();
        }

        saveProfile();
    }

    function getCurrentSettings(mode) {
        if (!isInitialized) init();

        const effectiveLevel = getEffectiveLevel(mode);
        const settings = logic.getLevelSettings(mode, effectiveLevel);
        return {
            ...settings,
            source: globalSettings.autoAdjustEnabled ? 'auto' : 'manual',
            autoAdjustEnabled: globalSettings.autoAdjustEnabled,
            calibrated: logic.isCalibrated(userDifficultyProfile[mode]),
            contentTier: DifficultyConfig.getContentTierForLevel(effectiveLevel)
        };
    }

    function getUiSnapshot(mode) {
        if (!isInitialized) init();
        const profile = userDifficultyProfile[mode] || logic.makeDefaultProfile();
        const currentSettings = getCurrentSettings(mode);
        const windowSize = DifficultyConfig.ADJUSTMENT.WINDOW_SIZES[globalSettings.adjustmentSensitivity] || 10;
        return {
            mode,
            level: currentSettings.level,
            levelName: currentSettings.name,
            contentTier: currentSettings.contentTier,
            source: currentSettings.source,
            calibrated: currentSettings.calibrated,
            autoAdjustEnabled: globalSettings.autoAdjustEnabled,
            manualLevel: clampLevel(globalSettings.manualLevel, 1),
            adjustmentSensitivity: globalSettings.adjustmentSensitivity,
            attemptsAtLevel: profile.attemptsAtLevel || 0,
            historySize: profile.history?.length || 0,
            graceRemaining: Math.max(0, DifficultyConfig.GRACE_PERIOD_ATTEMPTS - (profile.attemptsAtLevel || 0)),
            windowSize,
            recentScore: profile.history?.length ? profile.history[profile.history.length - 1].score : null,
            settings: currentSettings,
            profile
        };
    }

    function setAutoAdjustEnabled(enabled) {
        if (!isInitialized) init();
        globalSettings.autoAdjustEnabled = !!enabled;
        saveProfile();
        updateIndicator();
    }

    function setGlobalManualLevel(level) {
        if (!isInitialized) init();
        const nextLevel = clampLevel(level, globalSettings.manualLevel);
        globalSettings.manualLevel = nextLevel;

        // If a profile is still pristine, seed it to the requested baseline.
        SUPPORTED_MODES.forEach((mode) => {
            const profile = userDifficultyProfile[mode];
            if (profile && (profile.history?.length || 0) === 0 && (profile.attemptsAtLevel || 0) === 0) {
                profile.level = nextLevel;
            }
        });

        saveProfile();
        updateIndicator();
    }

    function setManualLevel(level) {
        if (!isInitialized) init();

        const nextLevel = clampLevel(level, globalSettings.manualLevel);
        setGlobalManualLevel(nextLevel);
        setAutoAdjustEnabled(false);
    }

    /**
     * Seed a starting CEFR level without toggling auto-adjust off.
     * Used by onboarding / AuthUI to set an initial level baseline.
     * @param {number} level
     */
    function seedLevel(level) {
        if (!isInitialized) init();

        const nextLevel = clampLevel(level, globalSettings.manualLevel);
        globalSettings.manualLevel = nextLevel;

        SUPPORTED_MODES.forEach((mode) => {
            const profile = userDifficultyProfile[mode];
            if (profile && (profile.history?.length || 0) === 0 && (profile.attemptsAtLevel || 0) === 0) {
                profile.level = nextLevel;
            }
        });

        saveProfile();
        updateIndicator();
    }

    function openSettings() {
        if (!isInitialized) init();
        ui.openSettingsModal(globalSettings, (newSettings) => {
            globalSettings = normalizeGlobalSettings({ ...globalSettings, ...newSettings });
            saveProfile();
            updateIndicator();
        });
    }

    function updateIndicator() {
        let activeMode = 'type';
        if (document.querySelector('#tab-speak.active')) activeMode = 'speak';
        else if (document.querySelector('#tab-extended.active')) activeMode = 'extended';
        else if (document.querySelector('#tab-rfib.active')) activeMode = 'rfib';
        else if (document.querySelector('#tab-notes.active')) activeMode = 'notes';
        else if (document.querySelector('#tab-srs.active')) activeMode = 'srs';
        else if (document.querySelector('#tab-rop.active')) activeMode = 'rop';

        const settings = getCurrentSettings(activeMode);
        ui.updateBadge(activeMode, settings.level, !globalSettings.autoAdjustEnabled);
    }

    function isCalibrated(mode) {
        if (!isInitialized) init();
        const profile = userDifficultyProfile[mode];
        if (!profile) return false;

        // If they have toggled manual mode, consider them calibrated (so it doesn't force a random level)
        // Note: globalSettings.autoAdjustEnabled might be false.

        return logic.isCalibrated(profile);
    }

    // Public API
    const api = {
        init,
        // Back-compat: public/script.js expects this to exist.
        // Semantics: feature availability (not whether auto-adjust is toggled on).
        isFeatureEnabled: () => hasUnlockedFeature,
        adjustDifficulty,
        getCurrentSettings,
        getEffectiveLevel,
        getContentTier,
        getUiSnapshot,
        openSettings,
        setAutoAdjustEnabled,
        setGlobalManualLevel,
        setManualLevel,
        seedLevel,
        isCalibrated,
        saveProfile,
        // Expose state getters for debugging
        getProfile: (mode) => userDifficultyProfile[mode],
        getGlobalSettings: () => globalSettings,
        /**
         * Returns a human-readable explanation of how the current difficulty
         * level was determined for a given mode. Useful for admin/debug views.
         */
        getDebugExplanation: (mode) => {
            const profile = userDifficultyProfile[mode];
            const settings = getCurrentSettings(mode);
            const calibrated = profile ? logic.isCalibrated(profile) : false;
            return {
                mode,
                currentLevel: settings.level,
                levelName: DifficultyConfig.LEVELS.NAMES[settings.level] || `Level ${settings.level}`,
                source: globalSettings.autoAdjustEnabled ? 'auto' : 'manual',
                calibrated,
                attemptsAtLevel: profile?.attemptsAtLevel || 0,
                graceRemaining: Math.max(0, DifficultyConfig.GRACE_PERIOD_ATTEMPTS - (profile?.attemptsAtLevel || 0)),
                historySize: profile?.history?.length || 0,
                autoAdjustEnabled: globalSettings.autoAdjustEnabled,
                sensitivity: globalSettings.adjustmentSensitivity,
                contentTier: DifficultyConfig.getContentTierForLevel(settings.level)
            };
        }
    };

    // Add back-compat property for script.js and auth-ui.js
    Object.defineProperty(api, 'globalSettings', {
        get: () => globalSettings,
        set: (val) => { globalSettings = normalizeGlobalSettings(val); }
    });

    return api;
})();

// Assign to window
window.DifficultyManager = DifficultyManager;

// Auto-init logic if verified? Original code called init() inside methods if not init. 
// We generally want to export the module.
export default DifficultyManager;
