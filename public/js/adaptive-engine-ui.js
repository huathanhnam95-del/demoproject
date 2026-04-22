/**
 * Adaptive Engine UI Module
 * Displays the Adaptive Engine profile panel with live data from DifficultyManager.
 */
const AdaptiveEngineUI = (() => {
    const LEVEL_NAMES = {
        1: 'A1 (Beginner I)',
        2: 'A2 (Beginner II)',
        3: 'B1 (Intermediate I)',
        4: 'B2 (Intermediate II)',
        5: 'C1 (Expert I)',
        6: 'C2 (Expert II)'
    };

    const THRESHOLDS = {
        UP: 0.85,
        DOWN: 0.60
    };

    const GRACE_PERIOD = 10;
    const WINDOW_SIZES = {
        low: 15,
        medium: 10,
        high: 5
    };

    const MODE_TABS = ['type', 'speak', 'extended', 'notes', 'sgd', 'srs'];

    let currentMode = 'type';
    let modal = null;

    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup);
        } else {
            setup();
        }
    }

    function setup() {
        modal = document.getElementById('adaptive-engine-modal');
        if (!modal) {
            console.warn('[AE-UI] Modal element not found');
            return;
        }

        const adaptiveBtn = document.getElementById('profile-adaptive-settings-btn');
        if (adaptiveBtn) adaptiveBtn.addEventListener('click', openModal);

        const closeBtn = document.getElementById('ae-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);

        const backdrop = modal.querySelector('.ae-backdrop');
        if (backdrop) backdrop.addEventListener('click', closeModal);

        modal.querySelectorAll('.ae-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => selectMode(btn.dataset.mode));
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display !== 'none') {
                closeModal();
            }
        });
    }

    function openModal() {
        if (!modal) return;
        modal.style.display = 'flex';
        refreshData();
    }

    function closeModal() {
        if (!modal) return;
        modal.style.display = 'none';
    }

    function selectMode(mode) {
        if (!MODE_TABS.includes(mode)) return;
        currentMode = mode;
        modal.querySelectorAll('.ae-mode-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        refreshData();
    }

    function getManagerSnapshot() {
        const manager = window.DifficultyManager;
        if (manager && typeof manager.getUiSnapshot === 'function') {
            return manager.getUiSnapshot(currentMode);
        }
        return null;
    }

    function getFallbackSnapshot() {
        try {
            const stored = localStorage.getItem('difficulty_profile');
            if (!stored) return null;
            const data = JSON.parse(stored);
            const profiles = data.profiles || {};
            const globalSettings = data.globalSettings || data.settings || {};
            const profile = profiles[currentMode] || { level: 1, history: [], attemptsAtLevel: 0 };
            const level = Number(profile.level) || 1;
            const sensitivity = globalSettings.adjustmentSensitivity || 'medium';
            const windowSize = WINDOW_SIZES[sensitivity] || 10;

            return {
                mode: currentMode,
                level,
                levelName: LEVEL_NAMES[level] || `Level ${level}`,
                contentTier: level <= 2 ? 1 : level <= 4 ? 2 : 3,
                source: globalSettings.autoAdjustEnabled === false ? 'manual' : 'auto',
                calibrated: (profile.attemptsAtLevel || 0) >= GRACE_PERIOD,
                autoAdjustEnabled: globalSettings.autoAdjustEnabled !== false,
                manualLevel: Number(globalSettings.manualLevel) || 1,
                adjustmentSensitivity: sensitivity,
                attemptsAtLevel: profile.attemptsAtLevel || 0,
                historySize: Array.isArray(profile.history) ? profile.history.length : 0,
                graceRemaining: Math.max(0, GRACE_PERIOD - (profile.attemptsAtLevel || 0)),
                windowSize,
                recentScore: Array.isArray(profile.history) && profile.history.length > 0
                    ? profile.history[profile.history.length - 1].score
                    : null,
                settings: getDefaultSettings(level),
                profile
            };
        } catch (error) {
            console.warn('[AE-UI] Failed to load profile:', error);
            return null;
        }
    }

    function refreshData() {
        const snapshot = getManagerSnapshot() || getFallbackSnapshot() || {
            mode: currentMode,
            level: 1,
            levelName: LEVEL_NAMES[1],
            contentTier: 1,
            source: 'auto',
            calibrated: false,
            autoAdjustEnabled: true,
            manualLevel: 1,
            adjustmentSensitivity: 'medium',
            attemptsAtLevel: 0,
            historySize: 0,
            graceRemaining: GRACE_PERIOD,
            windowSize: 10,
            recentScore: null,
            settings: getDefaultSettings(1),
            profile: { level: 1, history: [], attemptsAtLevel: 0 }
        };

        const profile = snapshot.profile || { level: 1, history: [], attemptsAtLevel: 0 };
        const isAutoAdjust = snapshot.autoAdjustEnabled !== false;
        const windowSize = snapshot.windowSize || WINDOW_SIZES[snapshot.adjustmentSensitivity || 'medium'] || 10;
        const requiredAttempts = Math.max(GRACE_PERIOD, windowSize);
        const level = snapshot.level || 1;
        const levelName = snapshot.levelName || LEVEL_NAMES[level] || 'Unknown';

        const titleEl = modal.querySelector('.ae-title');
        if (titleEl) {
            titleEl.textContent = isAutoAdjust ? 'Adaptive Engine - Auto' : 'Adaptive Engine - Manual';
        }

        const dotEl = modal.querySelector('.ae-status-dot');
        if (dotEl) {
            dotEl.style.background = isAutoAdjust ? '#22c55e' : '#94a3b8';
        }

        const levelEl = document.getElementById('ae-level');
        if (levelEl) {
            levelEl.textContent = levelName;
        }

        const history = Array.isArray(profile.history) ? profile.history : [];
        const recentHistory = history.filter((entry) => entry.level === level).slice(-windowSize);
        const rollingAccuracy = recentHistory.length > 0
            ? recentHistory.reduce((sum, entry) => sum + (Number(entry.score) || 0), 0) / recentHistory.length
            : 0;

        const raEl = document.getElementById('ae-rolling-accuracy');
        const raBar = document.getElementById('ae-ra-bar');
        if (raEl) {
            raEl.textContent = recentHistory.length > 0 ? `${Math.round(rollingAccuracy * 100)}%` : '—%';
        }
        if (raBar) {
            raBar.style.width = `${Math.round(rollingAccuracy * 100)}%`;
        }

        const attempts = Number(profile.attemptsAtLevel) || 0;
        const progressPercent = Math.min((attempts / requiredAttempts) * 100, 100);
        const lpEl = document.getElementById('ae-level-progress');
        const lpBar = document.getElementById('ae-lp-bar');
        if (lpEl) {
            lpEl.textContent = isAutoAdjust ? `${Math.round(progressPercent)}%` : 'Manual';
        }
        if (lpBar) {
            lpBar.style.width = isAutoAdjust ? `${progressPercent}%` : '0%';
        }

        const levelSettings = snapshot.settings
            || (window.DifficultyManager && typeof window.DifficultyManager.getCurrentSettings === 'function'
                ? window.DifficultyManager.getCurrentSettings(currentMode)
                : getDefaultSettings(level));

        const compEl = document.getElementById('ae-complexity');
        const assistEl = document.getElementById('ae-assistance');

        if (compEl) {
            if (currentMode === 'type' && levelSettings.sentenceLengthRange) {
                const [min, max] = levelSettings.sentenceLengthRange;
                let label = `${min}-${max} words`;
                if (max > 900) label = 'Unlimited Length';
                else if (max <= 12) label = `Basic (${label})`;
                else if (max <= 25) label = `Intermediate (${label})`;
                else label = `Advanced (${label})`;
                compEl.textContent = label;
            } else if (currentMode === 'speak') {
                compEl.textContent = `Strictness: ${levelSettings.strictness || 'medium'}`;
            } else if (currentMode === 'extended') {
                compEl.textContent = levelSettings.showHints ? 'Hints enabled' : 'Hints hidden';
            } else if (currentMode === 'notes') {
                compEl.textContent = levelSettings.showTranscript ? 'Transcript visible' : 'Transcript hidden';
            } else if (currentMode === 'srs') {
                compEl.textContent = `Typos: ${levelSettings.typoTolerance ?? 0}`;
            } else {
                compEl.textContent = '—';
            }
        }

        if (assistEl) {
            if (currentMode === 'type') {
                const masking = levelSettings.initialRevealPercentage || 0;
                const replays = levelSettings.maxReplays || 0;
                let assistLabel = 'Low Support';
                if (masking >= 40) assistLabel = 'High Support (Hints Active)';
                else if (masking >= 15) assistLabel = 'Moderate Support';
                else if (masking === 0 && replays <= 2) assistLabel = 'Minimal Assistance';
                const replayText = (replays > 99) ? '∞ Replays' : `${replays} Replays`;
                assistEl.textContent = `${assistLabel} • ${replayText}`;
            } else if (currentMode === 'speak') {
                const ipa = levelSettings.showIPA ? 'IPA visible' : 'IPA hidden';
                assistEl.textContent = `${ipa} • ${levelSettings.maxReplays || 0} Replays`;
            } else if (currentMode === 'extended') {
                assistEl.textContent = `${levelSettings.maxReplays || 0} Replays • Fill accuracy tracked`;
            } else if (currentMode === 'notes') {
                assistEl.textContent = `${levelSettings.maxReplays || 0} Replays • Note-match accuracy tracked`;
            } else if (currentMode === 'srs') {
                assistEl.textContent = `${levelSettings.showDef ? 'Definitions visible' : 'Definitions hidden'} • Review accuracy tracked`;
            } else {
                assistEl.textContent = '—';
            }
        }

        const badge = document.getElementById('ae-status-badge');
        if (!badge) return;

        badge.classList.remove('promoting', 'stable', 'optimizing');

        if (!isAutoAdjust) {
            badge.textContent = 'MANUAL';
            badge.classList.add('stable');
            return;
        }

        const meetsEvaluationMinimum = attempts >= requiredAttempts && recentHistory.length >= windowSize;
        const attemptsLeft = Math.max(0, requiredAttempts - attempts);

        if (meetsEvaluationMinimum && rollingAccuracy >= THRESHOLDS.UP) {
            badge.textContent = 'Ready for Promotion';
            badge.classList.add('promoting');
        } else if (meetsEvaluationMinimum && rollingAccuracy <= THRESHOLDS.DOWN) {
            badge.textContent = 'Needs Optimization';
            badge.classList.add('optimizing');
        } else {
            badge.textContent = attemptsLeft > 0 ? `${attemptsLeft} sets to evaluation` : 'Analyzing Performance...';
            badge.classList.add('stable');
        }
    }

    /**
     * Fallback settings when DifficultyManager is not available
     */
    function getDefaultSettings(level) {
        const defaults = {
            1: { sentenceLengthRange: [5, 8], maxReplays: 5, initialRevealPercentage: 50, strictness: 'low', showIPA: true, showHints: true, showTranscript: true, typoTolerance: 2, showDef: true },
            2: { sentenceLengthRange: [8, 12], maxReplays: 5, initialRevealPercentage: 40, strictness: 'low', showIPA: true, showHints: true, showTranscript: true, typoTolerance: 2, showDef: true },
            3: { sentenceLengthRange: [12, 18], maxReplays: 5, initialRevealPercentage: 30, strictness: 'medium', showIPA: true, showHints: false, showTranscript: false, typoTolerance: 1, showDef: true },
            4: { sentenceLengthRange: [18, 25], maxReplays: 5, initialRevealPercentage: 15, strictness: 'medium', showIPA: false, showHints: false, showTranscript: false, typoTolerance: 1, showDef: true },
            5: { sentenceLengthRange: [25, 35], maxReplays: 5, initialRevealPercentage: 0, strictness: 'high', showIPA: false, showHints: false, showTranscript: false, typoTolerance: 0, showDef: false },
            6: { sentenceLengthRange: [30, 999], maxReplays: 5, initialRevealPercentage: 0, strictness: 'high', showIPA: false, showHints: false, showTranscript: false, typoTolerance: 0, showDef: false }
        };
        return defaults[level] || defaults[1];
    }

    return {
        init
    };
})();

window.AdaptiveEngineUI = AdaptiveEngineUI;
