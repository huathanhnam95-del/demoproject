/**
 * Difficulty Manager Module
 * Manages difficulty levels (CEFR A1-C2), persistence, and adjustments for the Adaptive Difficulty System.
 */

const DifficultyManager = (() => {
    // Factory function to create fresh profile objects for each mode
    // This prevents shared array/object references across modes.
    const makeDefaultProfile = () => ({
        level: 1, // 1: A1, 2: A2, 3: B1, 4: B2, 5: C1, 6: C2
        exp: 0,
        history: [], // Recent performance history (score + difficulty) for RA calculation
        attemptsAtLevel: 0 // Track attempts at current level for grace period
    });

    let userDifficultyProfile = {
        type: makeDefaultProfile(),
        speak: makeDefaultProfile(),
        extended: makeDefaultProfile(),
        watch: makeDefaultProfile(),
        srs: makeDefaultProfile()
    };

    let globalSettings = {
        autoAdjustEnabled: true,
        adjustmentSensitivity: 'medium', // Determines RA window size
        notificationsEnabled: true,
        manualLevel: 1 // Default manual level (1-6)
    };

    // CEFR Level Definitions
    const MAX_LEVEL = 6;
    const MIN_LEVEL = 1;

    const LEVEL_NAMES = {
        1: 'A1 (Beginner I)',
        2: 'A2 (Beginner II)',
        3: 'B1 (Intermediate I)',
        4: 'B2 (Intermediate II)',
        5: 'C1 (Expert I)',
        6: 'C2 (Expert II)'
    };

    const HISTORY_SIZE = 20; // Keep enough history for rolling averages
    const GRACE_PERIOD_ATTEMPTS = 20; // Minimum attempts before level change allowed (approx 5-10 mins)

    // Hysteresis Thresholds
    const THRESHOLDS = {
        UP: 0.85,    // > 85% to level up
        DOWN: 0.60,  // < 60% to level down
        SMURF: 0.98  // > 98% allows fast track
    };

    let isInitialized = false;
    let hasUnlockedFeature = false;

    // DOM Elements
    let toastContainer = null;

    /**
     * Initialize the module
     */
    function init() {
        if (isInitialized) return;

        // Check if feature is unlocked
        if (window.shopModule) {
            hasUnlockedFeature = window.shopModule.isModeUnlocked('autoAdjust');
            console.log('🎯 [DM] Shop module found, autoAdjust unlocked:', hasUnlockedFeature);
        } else {
            console.warn('🎯 [DM] Shop module NOT found at init time!');
        }

        // Load persisted data
        loadProfile();

        // Create UI elements if they don't exist
        createToastContainer();

        isInitialized = true;
        console.log('🎯 Difficulty Manager Initialized (CEFR 6-Level). Feature enabled:', hasUnlockedFeature);

        // Listen for shop unlocks
        window.addEventListener('shop-unlock', (e) => {
            if (e.detail && e.detail.mode === 'autoAdjust') {
                hasUnlockedFeature = true;
                updateIndicator();
                notifyAdjustment('increase', 1); // Mock notification to show it's active
            }
        });

        // Listen for tab changes to update indicator
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-btn')) {
                setTimeout(updateIndicator, 50);
            }
        });

        // Save profile on page unload to prevent data loss
        window.addEventListener('beforeunload', saveProfile);
    }

    /**
     * Load difficulty profile from storage
     */
    function loadProfile() {
        const stored = localStorage.getItem('difficulty_profile');
        if (stored) {
            try {
                const data = JSON.parse(stored);
                userDifficultyProfile = { ...userDifficultyProfile, ...data.profiles };
                globalSettings = { ...globalSettings, ...data.settings };

                // Normalize global settings
                const validSens = new Set(['low', 'medium', 'high']);
                if (!validSens.has(globalSettings.adjustmentSensitivity)) {
                    globalSettings.adjustmentSensitivity = 'medium';
                }
                globalSettings.manualLevel = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, parseInt(globalSettings.manualLevel, 10) || MIN_LEVEL));
                globalSettings.autoAdjustEnabled = !!globalSettings.autoAdjustEnabled;
                globalSettings.notificationsEnabled = globalSettings.notificationsEnabled !== false;

                // Normalize each mode profile to ensure required fields exist and are not shared
                for (const mode of Object.keys(userDifficultyProfile)) {
                    const p = userDifficultyProfile[mode] ??= makeDefaultProfile();

                    // Type-safe normalization
                    if (!Array.isArray(p.history)) p.history = [];
                    p.level = Number.isFinite(p.level) ? p.level : MIN_LEVEL;
                    p.level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, p.level));

                    // Migrate old 'sessionsAtLevel' -> 'attemptsAtLevel' at load-time
                    if (!Number.isFinite(p.attemptsAtLevel)) {
                        p.attemptsAtLevel = Number.isFinite(p.sessionsAtLevel) ? p.sessionsAtLevel : 0;
                        if (p.sessionsAtLevel != null) delete p.sessionsAtLevel;
                    }
                }
            } catch (e) {
                console.error('Error loading difficulty profile:', e);
            }
        }
    }

    /**
     * Save difficulty profile to storage
     */
    function saveProfile() {
        try {
            const data = {
                profiles: userDifficultyProfile,
                settings: globalSettings,
                updatedAt: Date.now()
            };
            localStorage.setItem('difficulty_profile', JSON.stringify(data));
        } catch (e) {
            console.warn('[DM] Failed to save difficulty profile:', e);
        }
    }

    /**
     * Get current difficulty settings for a mode
     * @param {string} mode - 'type', 'speak', etc.
     */
    function getCurrentSettings(mode) {
        if (!isInitialized) init();

        let level;

        // Determine effective level
        if (hasUnlockedFeature && !globalSettings.autoAdjustEnabled) {
            // Manual Override active
            level = globalSettings.manualLevel || 1;
        } else {
            // Auto-adjust active (or feature locked -> default to profile which defaults to 1)
            level = userDifficultyProfile[mode]?.level || 1;
        }

        // Clamp level to valid range using constants
        level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));

        return getLevelSettings(mode, level);
    }

    /**
     * Get specific settings for a difficulty level (CEFR Mapped)
     */
    function getLevelSettings(mode, level) {
        const params = {
            type: {
                // A1: Beginner I
                1: {
                    name: LEVEL_NAMES[1],
                    maxReplays: 10,
                    sentenceLengthRange: [5, 8],
                    autoShowWordCount: true,
                    autoShowFirstLetters: true,
                    autoShowWordLengths: true,
                    topicHint: true,
                    keywordPreview: true,
                    delayBeforeTyping: 0,
                    initialRevealPercentage: 50
                },
                // A2: Beginner II
                2: {
                    name: LEVEL_NAMES[2],
                    maxReplays: 5,
                    sentenceLengthRange: [8, 12],
                    autoShowWordCount: true,
                    autoShowFirstLetters: false,
                    autoShowWordLengths: true,
                    topicHint: true,
                    keywordPreview: true,
                    delayBeforeTyping: 1,
                    initialRevealPercentage: 40
                },
                // B1: Intermediate I
                3: {
                    name: LEVEL_NAMES[3],
                    maxReplays: 4,
                    sentenceLengthRange: [12, 18],
                    autoShowWordCount: true,
                    autoShowFirstLetters: false,
                    autoShowWordLengths: false,
                    topicHint: true,
                    keywordPreview: false,
                    delayBeforeTyping: 3,
                    initialRevealPercentage: 30
                },
                // B2: Intermediate II
                4: {
                    name: LEVEL_NAMES[4],
                    maxReplays: 3,
                    sentenceLengthRange: [18, 25],
                    autoShowWordCount: false,
                    autoShowFirstLetters: false,
                    autoShowWordLengths: false,
                    topicHint: true,
                    keywordPreview: false,
                    delayBeforeTyping: 4,
                    initialRevealPercentage: 15
                },
                // C1: Expert I
                5: {
                    name: LEVEL_NAMES[5],
                    maxReplays: 2,
                    sentenceLengthRange: [25, 35],
                    autoShowWordCount: false,
                    autoShowFirstLetters: false,
                    autoShowWordLengths: false,
                    topicHint: false,
                    keywordPreview: false,
                    delayBeforeTyping: 5,
                    initialRevealPercentage: 0
                },
                // C2: Expert II
                6: {
                    name: LEVEL_NAMES[6],
                    maxReplays: 1,
                    sentenceLengthRange: [30, 999], // Unbounded
                    autoShowWordCount: false,
                    autoShowFirstLetters: false,
                    autoShowWordLengths: false,
                    topicHint: false,
                    keywordPreview: false,
                    delayBeforeTyping: 6,
                    initialRevealPercentage: 0
                }
            },
            // Mapping for other modes (simplified for now)
            speak: {
                1: { name: LEVEL_NAMES[1], strictness: 'low', showIPA: true, maxReplays: Infinity },
                2: { name: LEVEL_NAMES[2], strictness: 'low', showIPA: true, maxReplays: 5 },
                3: { name: LEVEL_NAMES[3], strictness: 'medium', showIPA: true, maxReplays: 3 },
                4: { name: LEVEL_NAMES[4], strictness: 'medium', showIPA: false, maxReplays: 2 },
                5: { name: LEVEL_NAMES[5], strictness: 'high', showIPA: false, maxReplays: 1 },
                6: { name: LEVEL_NAMES[6], strictness: 'high', showIPA: false, maxReplays: 1 }
            },
            srs: {
                1: { name: LEVEL_NAMES[1], typoTolerance: 2, showDef: true },
                2: { name: LEVEL_NAMES[2], typoTolerance: 2, showDef: true },
                3: { name: LEVEL_NAMES[3], typoTolerance: 1, showDef: true },
                4: { name: LEVEL_NAMES[4], typoTolerance: 1, showDef: true },
                5: { name: LEVEL_NAMES[5], typoTolerance: 0, showDef: false },
                6: { name: LEVEL_NAMES[6], typoTolerance: 0, showDef: false }
            }
        };

        const modeParams = params[mode] || params['type'];
        // Fallback to level 1 if requested level doesn't exist
        return { level, ...(modeParams[level] || modeParams[1]) };
    }

    /**
     * Adjust difficulty based on performance score (0.0 - 1.0)
     * Implements: Rolling Average + Hysteresis + Grace Period + Smurf fast-track
     */
    function adjustDifficulty(mode, score) {
        if (!hasUnlockedFeature || !globalSettings.autoAdjustEnabled) return;

        // --- Validate inputs ---
        score = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;

        const profile = userDifficultyProfile?.[mode];
        if (!profile) return;

        // --- Init / sanitization guards ---
        if (!Array.isArray(profile.history)) profile.history = [];
        profile.level = Number.isFinite(profile.level) ? profile.level : MIN_LEVEL;
        profile.level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, profile.level));
        profile.attemptsAtLevel = Number.isFinite(profile.attemptsAtLevel) ? profile.attemptsAtLevel : 0;

        // Normalize existing history entries defensively
        profile.history = profile.history
            .filter(Boolean)
            .map(h => ({
                date: h.date ?? Date.now(),
                score: Number.isFinite(h.score) ? Math.max(0, Math.min(1, h.score)) : 0,
                level: Number.isFinite(h.level) ? h.level : profile.level
            }));

        // --- Record attempt ---
        profile.history.push({ date: Date.now(), score, level: profile.level });
        if (profile.history.length > HISTORY_SIZE) profile.history.shift();
        profile.attemptsAtLevel++;

        const windowSizes = { low: 15, medium: 10, high: 5 };
        const windowSize = windowSizes[globalSettings.adjustmentSensitivity] || 10;

        // Only consider attempts at the CURRENT level for decisions
        const relevantHistory = profile.history.filter(h => h.level === profile.level);

        // --- Smurf check (does NOT require RA window size) ---
        const lastFive = relevantHistory.slice(-5);
        const isSmurfing = lastFive.length === 5 && lastFive.every(h => h.score >= THRESHOLDS.SMURF);

        let newLevel = profile.level;
        let direction = 'maintain';
        let didChange = false;

        if (isSmurfing && profile.level < MAX_LEVEL) {
            newLevel = profile.level + 1;
            direction = 'increase';
            didChange = true;
            console.log('[DM] Smurf detected! Fast tracking level up.');
        } else {
            // --- Normal logic only if we have enough same-level history for RA ---
            if (relevantHistory.length >= windowSize) {
                const recentHistory = relevantHistory.slice(-windowSize);
                const rollingAvg = recentHistory.reduce((sum, item) => sum + item.score, 0) / windowSize;

                console.log(
                    `[DM] Mode: ${mode} | Level: ${profile.level} | Score: ${score.toFixed(
                        2
                    )} | RA: ${rollingAvg.toFixed(2)} | Attempts: ${profile.attemptsAtLevel}`
                );

                // Grace period
                if (profile.attemptsAtLevel >= GRACE_PERIOD_ATTEMPTS) {
                    // Level up
                    if (rollingAvg > THRESHOLDS.UP && profile.level < MAX_LEVEL) {
                        const lastThree = relevantHistory.slice(-3);
                        const lastThreeConsistent = lastThree.every(h => h.score >= 0.70);

                        if (lastThreeConsistent) {
                            newLevel = profile.level + 1;
                            direction = 'increase';
                            didChange = true;
                        }
                    }
                    // Level down
                    else if (rollingAvg < THRESHOLDS.DOWN && profile.level > MIN_LEVEL) {
                        newLevel = profile.level - 1;
                        direction = 'decrease';
                        didChange = true;
                    }
                }
            }
            // else: not enough data yet; do nothing but still allow periodic saving below
        }

        if (didChange) {
            profile.level = newLevel;
            profile.attemptsAtLevel = 0;

            // Keep a small tail for audit/debug (won’t affect decisions due to level filtering)
            profile.history = profile.history.slice(-3);

            saveProfile();
            notifyAdjustment(direction, newLevel);
            updateIndicator();

            console.log(`[Difficulty] Adjusted ${mode} to Level ${newLevel} (${direction})`);
        } else if (profile.attemptsAtLevel % 10 === 0) {
            // Periodic save to prevent data loss on refresh (every 10 attempts)
            saveProfile();
        }
    }

    /**
     * Notify user of difficulty change (Level Ascension Event)
     */
    function notifyAdjustment(direction, newLevel) {
        if (direction === 'maintain') return;

        const levelName = LEVEL_NAMES[newLevel];

        // Level Up "Ascension"
        if (direction === 'increase') {
            triggerAscensionEvent(newLevel, levelName);
        }
        // Level Down "Optimization"
        else {
            showToast(`Optimizing difficulty: ${levelName}`, 'info', 'trending-down');
        }
    }

    /**
     * Trigger the full screen ascension visual
     */
    function triggerAscensionEvent(newLevel, levelName) {
        // Create modal if not exists
        let modal = document.getElementById('ascension-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ascension-modal';
            modal.innerHTML = `
                <div class="ascension-content">
                    <div class="ascension-icon">🏆</div>
                    <h2>LEVEL UP!</h2>
                    <p class="ascension-level" id="ascension-level-text"></p>
                    <p class="ascension-sub">Difficulty increased. Keep pushing!</p>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const levelText = document.getElementById('ascension-level-text');
        levelText.textContent = levelName;

        // Animate Enter (CSS transition handles opacity)
        modal.style.display = 'flex';
        // Force reflow
        void modal.offsetWidth;
        modal.style.opacity = '1';
        modal.querySelector('.ascension-content').style.transform = 'scale(1)';

        // Auto Close
        setTimeout(() => {
            modal.style.opacity = '0';
            modal.querySelector('.ascension-content').style.transform = 'scale(0.8)';
            setTimeout(() => { modal.style.display = 'none'; }, 500);
        }, 3000);
    }

    function showToast(message, type, iconName) {
        if (!toastContainer) return;

        const toast = document.createElement('div');
        // Legacy support: map 'info' to 'info', 'success' to 'success'
        // New styles use specific border colors
        toast.className = `toast ${type}`;

        if (iconName) {
            const emoji = iconName === 'trending-up' ? '🚀' : '🛡️';
            message = `${emoji} ${message}`;
        }

        const span = document.createElement('span');
        span.textContent = message;
        toast.innerHTML = ''; // Clear
        toast.appendChild(span);
        toastContainer.appendChild(toast);

        // Animation handled by CSS (opacity/transform) but JS needed to trigger state
        // Force reflow
        void toast.offsetWidth;

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ... (settings code) ...

    function createToastContainer() {
        const existing = document.getElementById('difficulty-toast-container');
        if (existing) {
            toastContainer = existing;
            return;
        }
        toastContainer = document.createElement('div');
        toastContainer.id = 'difficulty-toast-container';
        // Inline styles removed in favor of CSS
        document.body.appendChild(toastContainer);
    }
    /**
     * UI: Create and Open Settings Modal
     */
    function openSettings() {
        // Remove old modal if exists (to force re-render with new options)
        const oldModal = document.getElementById('difficulty-settings-modal');
        if (oldModal) oldModal.remove();

        createSettingsModal();
        const modal = document.getElementById('difficulty-settings-modal');

        // Sync state
        const toggle = document.getElementById('diff-s-toggle');
        const sensitivity = document.getElementById('diff-s-sensitivity');
        const manualLevel = document.getElementById('diff-s-manual-level');
        const manualContainer = document.getElementById('diff-s-manual-container');
        const sensitivityContainer = document.getElementById('diff-s-sensitivity-container');

        if (toggle) {
            toggle.checked = globalSettings.autoAdjustEnabled;
            // Update visibility based on toggle
            if (toggle.checked) {
                manualContainer.style.display = 'none';
                sensitivityContainer.style.display = 'block';
            } else {
                manualContainer.style.display = 'block';
                sensitivityContainer.style.display = 'none';
            }
        }
        if (sensitivity) sensitivity.value = globalSettings.adjustmentSensitivity;
        if (manualLevel) manualLevel.value = globalSettings.manualLevel || 1;

        modal.style.display = 'flex';
        void modal.offsetWidth;
        modal.classList.add('active');
    }

    function createSettingsModal() {
        const modal = document.createElement('div');
        modal.id = 'difficulty-settings-modal';
        modal.className = 'shop-modal';
        modal.style.zIndex = '11000';

        modal.innerHTML = `
            <div class="shop-modal-content" style="max-width: 450px; padding: 0;">
                <div class="shop-header">
                    <h2>Smart Difficulty (CEFR)</h2>
                    <button class="shop-close-btn" id="diff-s-close">&times;</button>
                </div>
                
                <div class="shop-body">
                    <div class="setting-group">
                        <label class="setting-label">
                            <span>Auto-Adjust Levels</span>
                            <div class="toggle-switch">
                                <input type="checkbox" id="diff-s-toggle">
                                <span class="toggle-slider"></span>
                            </div>
                        </label>
                        <p class="setting-desc">
                            AI will promote/demote you between A1-C2 based on your performance.
                        </p>
                    </div>

                    <!-- Manual Level Selection (1-6) -->
                    <div id="diff-s-manual-container" class="setting-group" style="display: none;">
                        <label class="setting-label">Manual Level (CEFR)</label>
                        <select id="diff-s-manual-level" class="setting-select">
                            <option value="1">A1 - Beginner I</option>
                            <option value="2">A2 - Beginner II</option>
                            <option value="3">B1 - Intermediate I</option>
                            <option value="4">B2 - Intermediate II</option>
                            <option value="5">C1 - Expert I</option>
                            <option value="6">C2 - Expert II</option>
                        </select>
                    </div>

                    <div id="diff-s-sensitivity-container" class="setting-group">
                        <label class="setting-label">Sensitivity</label>
                        <select id="diff-s-sensitivity" class="setting-select">
                            <option value="low">Low (Stable)</option>
                            <option value="medium">Medium (Recommended)</option>
                            <option value="high">High (Responsive)</option>
                        </select>
                    </div>

                    <div style="text-align:right; margin-top:10px;">
                        <button id="diff-s-save" class="shop-item-btn buy" style="width: auto; padding: 12px 32px;">Save Settings</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // UI Logic: Toggle Manual/Sensitivity Visibility
        const toggle = document.getElementById('diff-s-toggle');
        const manualContainer = document.getElementById('diff-s-manual-container');
        const sensitivityContainer = document.getElementById('diff-s-sensitivity-container');

        toggle.addEventListener('change', () => {
            if (toggle.checked) {
                manualContainer.style.display = 'none';
                sensitivityContainer.style.display = 'block';
            } else {
                manualContainer.style.display = 'block';
                sensitivityContainer.style.display = 'none';
            }
        });

        // Event Listeners
        document.getElementById('diff-s-save').addEventListener('click', () => {
            const toggle = document.getElementById('diff-s-toggle');
            const sensitivity = document.getElementById('diff-s-sensitivity');
            const manualLevel = document.getElementById('diff-s-manual-level');

            globalSettings.autoAdjustEnabled = toggle.checked;
            globalSettings.adjustmentSensitivity = sensitivity.value;
            globalSettings.manualLevel = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, parseInt(manualLevel.value, 10) || MIN_LEVEL));

            saveProfile();
            updateIndicator();

            modal.classList.remove('active');
            setTimeout(() => { modal.style.display = 'none'; }, 300);

            showToast('Settings saved', 'success', 'check-circle');
        });

        const closeBtn = document.getElementById('diff-s-close');
        const closeFn = () => {
            modal.classList.remove('active');
            setTimeout(() => { modal.style.display = 'none'; }, 300);
        };
        closeBtn.onclick = closeFn;
        modal.onclick = (e) => { if (e.target === modal) closeFn(); };
    }



    function updateIndicator() {
        const badge = document.getElementById('difficulty-badge');
        if (!badge) return;

        let activeMode = 'type';
        // Simple heuristic for active tab (should be improved with actual state if available)
        if (document.getElementById('tab-speak') && document.getElementById('tab-speak').classList.contains('active')) activeMode = 'speak';
        else if (document.getElementById('tab-srs') && document.getElementById('tab-srs').classList.contains('active')) activeMode = 'srs';

        const settings = getCurrentSettings(activeMode);
        const isManual = hasUnlockedFeature && !globalSettings.autoAdjustEnabled;

        if (!hasUnlockedFeature) {
            badge.style.display = 'none';
            return;
        }

        const levelName = settings.name;
        const suffix = isManual ? ' (M)' : '';

        const textEl = document.getElementById('diff-level-text');
        if (textEl) textEl.textContent = `${levelName}${suffix}`; // e.g. A2 (Beginner II) (M)

        // Map CEFR levels to CSS classes (level-1 to level-6)
        // Ensure CSS handles level-4, level-5, level-6 colors
        badge.className = `difficulty-badge level-${settings.level}`;
        badge.style.display = 'inline-flex';
        badge.title = `Smart Difficulty: ${activeMode.toUpperCase()} Mode (Level ${settings.level} - ${levelName})`;
    }

    /**
     * Public API: Manually set a difficulty level (CEFR 1-6)
     * This disables auto-adjust and saves the profile.
     * @param {number} level - 1 to 6
     */
    function setManualLevel(level) {
        if (!isInitialized) init();

        const numericLevel = parseInt(level, 10);
        if (isNaN(numericLevel) || numericLevel < 1 || numericLevel > 6) {
            console.error('[DM] Invalid manual level:', level);
            return;
        }

        globalSettings.autoAdjustEnabled = false;
        globalSettings.manualLevel = numericLevel;

        // Also update the current mode's profile if it exists to ensure fallback immediate consistency
        // Update ALL modes to this baseline to prevent "difficulty shock" if they switch back to Auto later.
        // Dynamically get all mode keys from the profile object
        const modes = Object.keys(userDifficultyProfile);
        modes.forEach(mode => {
            if (userDifficultyProfile[mode]) {
                userDifficultyProfile[mode].level = numericLevel;
                // Optional: Reset their history so they start fresh at this new level
                userDifficultyProfile[mode].history = [];
                userDifficultyProfile[mode].attemptsAtLevel = 0;
            }
        });

        saveProfile();
        updateIndicator();

        console.log(`🎯 [DM] Manual Level set to ${numericLevel} (${LEVEL_NAMES[numericLevel]})`);
        showToast(`Manual Level: ${LEVEL_NAMES[numericLevel].split(' ')[0]}`, 'success', 'check-circle');
    }

    // Public API
    return {
        init,
        getCurrentSettings,
        adjustDifficulty,
        openSettings,
        setManualLevel,
        isFeatureEnabled: () => hasUnlockedFeature,
        isAutoAdjustUnlocked: () => hasUnlockedFeature,
        refreshProfile: loadProfile
    };

})();

window.DifficultyManager = DifficultyManager;
