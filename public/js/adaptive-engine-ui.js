/**
 * Adaptive Engine UI Module
 * Displays the "Adaptive Engine — Active" profile panel with live data from DifficultyManager.
 */
const AdaptiveEngineUI = (() => {
    // CEFR Level Mappings (mirrored from DifficultyManager)
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

    const GRACE_PERIOD = 20;

    let currentMode = 'type';
    let modal = null;

    /**
     * Initialize event listeners
     */
    function init() {
        // Wait for DOM ready
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

        // View Profile button click
        const viewProfileBtn = document.getElementById('panel-view-profile-btn');
        if (viewProfileBtn) {
            viewProfileBtn.addEventListener('click', openModal);
        }

        // Close button
        const closeBtn = document.getElementById('ae-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }

        // Backdrop click to close
        const backdrop = modal.querySelector('.ae-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', closeModal);
        }

        // Mode tab buttons
        const modeBtns = modal.querySelectorAll('.ae-mode-btn');
        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                selectMode(mode);
            });
        });

        // ESC key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display !== 'none') {
                closeModal();
            }
        });

        console.log('[AE-UI] Adaptive Engine UI initialized');
    }

    /**
     * Open the modal and populate data
     */
    function openModal() {
        if (!modal) return;

        modal.style.display = 'flex';
        refreshData();
    }

    /**
     * Close the modal
     */
    function closeModal() {
        if (!modal) return;
        modal.style.display = 'none';
    }

    /**
     * Switch between mode tabs
     */
    function selectMode(mode) {
        currentMode = mode;

        // Update tab UI
        const modeBtns = modal.querySelectorAll('.ae-mode-btn');
        modeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        refreshData();
    }

    /**
     * Pull latest data from DifficultyManager and update UI
     */
    function refreshData() {
        // Try to get profile from localStorage directly (same source as DifficultyManager)
        let profiles = {};
        let settings = {};

        try {
            const stored = localStorage.getItem('difficulty_profile');
            if (stored) {
                const data = JSON.parse(stored);
                profiles = data.profiles || {};
                settings = data.settings || {};
            }
        } catch (e) {
            console.warn('[AE-UI] Failed to load profile:', e);
        }

        const profile = profiles[currentMode] || { level: 1, history: [], attemptsAtLevel: 0 };

        // --- Current Level ---
        const level = profile.level || 1;
        const levelName = LEVEL_NAMES[level] || 'Unknown';
        const levelEl = document.getElementById('ae-level');
        if (levelEl) {
            levelEl.textContent = levelName;
        }

        // --- Rolling Accuracy ---
        const history = Array.isArray(profile.history) ? profile.history : [];
        // Filter to current level entries
        const relevantHistory = history.filter(h => h.level === level);
        const windowSize = 10; // Medium sensitivity
        const recentHistory = relevantHistory.slice(-windowSize);

        let rollingAccuracy = 0;
        if (recentHistory.length > 0) {
            const sum = recentHistory.reduce((acc, h) => acc + (h.score || 0), 0);
            rollingAccuracy = sum / recentHistory.length;
        }

        const raEl = document.getElementById('ae-rolling-accuracy');
        const raBar = document.getElementById('ae-ra-bar');
        if (raEl) {
            raEl.textContent = recentHistory.length > 0 ? `${Math.round(rollingAccuracy * 100)}%` : '—%';
        }
        if (raBar) {
            raBar.style.width = `${Math.round(rollingAccuracy * 100)}%`;
        }

        // --- Level Progress (Stability) ---
        const attempts = profile.attemptsAtLevel || 0;
        const progressPercent = Math.min((attempts / GRACE_PERIOD) * 100, 100);

        const lpEl = document.getElementById('ae-level-progress');
        const lpBar = document.getElementById('ae-lp-bar');

        if (lpEl) {
            lpEl.textContent = `${Math.round(progressPercent)}%`;
        }
        if (lpBar) {
            lpBar.style.width = `${progressPercent}%`;
        }

        // --- Current Settings (Active Configuration) ---
        let levelSettings = {};
        if (window.DifficultyManager && typeof window.DifficultyManager.getCurrentSettings === 'function') {
            levelSettings = window.DifficultyManager.getCurrentSettings(currentMode);
        } else {
            levelSettings = getDefaultSettings(level);
        }

        const compEl = document.getElementById('ae-complexity');
        const assistEl = document.getElementById('ae-assistance');

        // Complexity (Sentence Length)
        if (compEl && levelSettings.sentenceLengthRange) {
            const [min, max] = levelSettings.sentenceLengthRange;
            // Humanize range
            let label = `${min}-${max} words`;
            if (max > 900) label = "Unlimited Length";
            else if (max <= 12) label = `Basic (${label})`;
            else if (max <= 25) label = `Intermediate (${label})`;
            else label = `Advanced (${label})`;

            compEl.textContent = label;
        } else if (compEl) {
            compEl.textContent = '—';
        }

        // Assistance (Replays + Reveal)
        if (assistEl) {
            const masking = levelSettings.initialRevealPercentage || 0;
            const replays = levelSettings.maxReplays;

            let assistLabel = "Standard";

            if (masking >= 40) assistLabel = "High Support (Hints Active)";
            else if (masking >= 15) assistLabel = "Moderate Support";
            else if (masking === 0 && replays <= 2) assistLabel = " minimal assistance";
            else assistLabel = "Low Support";

            // Add concise replay note
            const replayText = (replays > 99) ? "∞ Replays" : `${replays} Replays`;
            assistEl.textContent = `${assistLabel} • ${replayText}`;
        }

        // --- Status Badge ---
        const badge = document.getElementById('ae-status-badge');
        if (badge) {
            badge.classList.remove('promoting', 'stable', 'optimizing');

            const setsUntilCheck = Math.max(0, GRACE_PERIOD - attempts);

            if (rollingAccuracy >= THRESHOLDS.UP && recentHistory.length >= windowSize) {
                badge.textContent = `Ready for Promotion`;
                badge.classList.add('promoting');
            } else if (rollingAccuracy < THRESHOLDS.DOWN && recentHistory.length >= windowSize) {
                badge.textContent = 'Needs Optimization';
                badge.classList.add('optimizing');
            } else {
                if (setsUntilCheck > 0) {
                    badge.textContent = `${setsUntilCheck} sets to evaluation`;
                } else {
                    badge.textContent = 'Analyzing Performance...';
                }
                badge.classList.add('stable');
            }
        }
    }

    /**
     * Fallback settings when DifficultyManager is not available
     */
    function getDefaultSettings(level) {
        const defaults = {
            1: { sentenceLengthRange: [5, 8], maxReplays: 10, initialRevealPercentage: 50 },
            2: { sentenceLengthRange: [8, 12], maxReplays: 5, initialRevealPercentage: 40 },
            3: { sentenceLengthRange: [12, 18], maxReplays: 4, initialRevealPercentage: 30 },
            4: { sentenceLengthRange: [18, 25], maxReplays: 3, initialRevealPercentage: 15 },
            5: { sentenceLengthRange: [25, 35], maxReplays: 2, initialRevealPercentage: 0 },
            6: { sentenceLengthRange: [30, 999], maxReplays: 1, initialRevealPercentage: 0 }
        };
        return defaults[level] || defaults[1];
    }

    // Public API
    return {
        init,
        openModal,
        closeModal,
        selectMode,
        refreshData
    };
})();

// Auto-init
AdaptiveEngineUI.init();

// Expose globally
window.AdaptiveEngineUI = AdaptiveEngineUI;
