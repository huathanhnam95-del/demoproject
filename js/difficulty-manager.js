/**
 * Difficulty Manager Module
 * Manages difficulty levels, persistence, and adjustments for the Adaptive Difficulty System.
 */

const DifficultyManager = (() => {
    // Default profiles for each mode
    const DEFAULT_PROFILE = {
        level: 1, // 1: Guided, 2: Supported, 3: Independent
        exp: 0,
        history: [], // Recent performance history
        settings: {} // Mode-specific overrides
    };

    let userDifficultyProfile = {
        type: { ...DEFAULT_PROFILE },
        speak: { ...DEFAULT_PROFILE },
        extended: { ...DEFAULT_PROFILE },
        watch: { ...DEFAULT_PROFILE },
        srs: { ...DEFAULT_PROFILE }
    };

    let globalSettings = {
        autoAdjustEnabled: true,
        adjustmentSensitivity: 'medium', // low, medium, high
        notificationsEnabled: true,
        manualLevel: 1 // Default manual level
    };

    const HISTORY_SIZE = 15;
    let isInitialized = false;
    let hasUnlockedFeature = false;

    // DOM Elements
    let indicatorEl = null;
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
        console.log('🎯 Difficulty Manager Initialized. Feature enabled:', hasUnlockedFeature);

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
                // Small delay to allow active class to update
                setTimeout(updateIndicator, 50);
            }
        });
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
            } catch (e) {
                console.error('Error loading difficulty profile:', e);
            }
        }
    }

    /**
     * Save difficulty profile to storage
     */
    function saveProfile() {
        const data = {
            profiles: userDifficultyProfile,
            settings: globalSettings,
            updatedAt: Date.now()
        };
        localStorage.setItem('difficulty_profile', JSON.stringify(data));

        // Sync to Firestore if user is logged in (optional implementation)
        if (window.authUI && window.authUI.getCurrentUserId()) {
            // debounced Firestore save could go here
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

        return getLevelSettings(mode, level);
    }

    /**
     * Get specific settings for a difficulty level
     */
    function getLevelSettings(mode, level) {
        // Define difficulty parameters for each mode
        const params = {
            type: {
                1: {
                    name: 'Guided',
                    // Replay limits
                    maxReplays: 10,
                    // Sentence filtering (word count range)
                    sentenceLengthRange: [5, 8],
                    // Auto-show hints
                    autoShowWordCount: true,
                    autoShowFirstLetters: true,
                    autoShowWordLengths: true,
                    // Scaffolds (Phase 2)
                    partialDictation: false, // Future
                    wordBank: 'full', // Future
                    chunkPlayback: true, // Future
                    // Context hints
                    topicHint: true,
                    keywordPreview: true,
                    // Timing
                    delayBeforeTyping: 0
                },
                2: {
                    name: 'Supported',
                    maxReplays: 3,
                    sentenceLengthRange: [7, 10],
                    autoShowWordCount: true,
                    autoShowFirstLetters: false,
                    autoShowWordLengths: false,
                    partialDictation: false,
                    wordBank: 'partial',
                    chunkPlayback: false,
                    topicHint: true,
                    keywordPreview: false,
                    delayBeforeTyping: 3
                },
                3: {
                    name: 'Independent',
                    maxReplays: 1,
                    sentenceLengthRange: null, // All lengths
                    autoShowWordCount: false,
                    autoShowFirstLetters: false,
                    autoShowWordLengths: false,
                    partialDictation: false,
                    wordBank: null,
                    chunkPlayback: false,
                    topicHint: false,
                    keywordPreview: false,
                    delayBeforeTyping: 5
                }
            },
            speak: {
                1: { name: 'Guided', strictness: 'low', showIPA: true, visualAids: true, maxReplays: Infinity },
                2: { name: 'Supported', strictness: 'medium', showIPA: true, visualAids: false, maxReplays: 3 },
                3: { name: 'Independent', strictness: 'high', showIPA: false, visualAids: false, maxReplays: 1 }
            },
            srs: {
                1: { name: 'Guided', typoTolerance: 2, showStart: true, showDef: true },
                2: { name: 'Supported', typoTolerance: 1, showStart: false, showDef: true },
                3: { name: 'Independent', typoTolerance: 0, showStart: false, showDef: false }
            }
        };

        // Default or specific mode settings
        const modeParams = params[mode] || params['type'];
        return { level, ...modeParams[level] };
    }

    /**
     * Adjust difficulty based on performance score (0.0 - 1.0)
     * @param {string} mode 
     * @param {number} score 
     */
    function adjustDifficulty(mode, score) {
        if (!hasUnlockedFeature || !globalSettings.autoAdjustEnabled) return;

        const profile = userDifficultyProfile[mode];
        const OPTIMAL_MIN = 0.60;
        const OPTIMAL_MAX = 0.85;

        let newLevel = profile.level;
        let didChange = false;
        let direction = 'maintain';

        // Add to history
        profile.history.push({ date: Date.now(), score });
        if (profile.history.length > HISTORY_SIZE) profile.history.shift();

        // Calculate Trend (last N attempts based on sensitivity)
        const attemptCounts = { low: 8, medium: 5, high: 3 };
        const requiredAttempts = attemptCounts[globalSettings.adjustmentSensitivity] || 5;

        const recentAttempts = profile.history.slice(-requiredAttempts);
        if (recentAttempts.length < requiredAttempts) return; // Need enough attempts to adjust

        const avgScore = recentAttempts.reduce((sum, item) => sum + item.score, 0) / recentAttempts.length;

        if (avgScore > OPTIMAL_MAX) {
            // Too easy -> Increase difficulty
            if (profile.level < 3) {
                newLevel++;
                direction = 'increase';
                didChange = true;
            }
        } else if (avgScore < OPTIMAL_MIN) {
            // Too hard -> Decrease difficulty
            if (profile.level > 1) {
                newLevel--;
                direction = 'decrease';
                didChange = true;
            }
        }

        if (didChange) {
            profile.level = newLevel;
            // Clear recent history to prevent rapid oscillation
            profile.history = [];

            saveProfile();
            notifyAdjustment(direction, newLevel);
            updateIndicator();

            console.log(`[Difficulty] Adjusted ${mode} to Level ${newLevel} (${direction})`);
        }
    }

    /**
     * Notify user of difficulty change
     */
    function notifyAdjustment(direction, newLevel) {
        // Only show toast if explicitly requested (e.g. from tests) or it's a real change
        // For 'maintain', maybe no toast needed unless debug
        if (direction === 'maintain') {
            showToast('Settings saved', 'success', 'check-circle');
            return;
        }

        const msg = direction === 'increase' ? 'Difficulty Increased!' : 'Difficulty Decreased';
        const icon = direction === 'increase' ? 'trending-up' : 'trending-down';

        showToast(`${msg} (Level ${newLevel})`, 'info', icon);
    }

    function showToast(message, type, iconName) {
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.style.cssText = `
            background: white;
            color: #333;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 12px;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s ease;
            pointer-events: auto;
            min-width: 250px;
        `;

        if (iconName) {
            // In a real app we'd use an icon library like Feather
            // Here just a placeholder or emoji
            const emoji = type === 'success' ? '✅' : (type === 'info' ? 'ℹ️' : '⚠️');
            message = `${emoji} ${message}`;
        }

        toast.innerHTML = `<span style="font-weight:500;">${message}</span>`; // Simple for now

        if (toast.querySelector('.icon')) {
            toast.querySelector('.icon').style.fontSize = '20px';
        }

        toastContainer.appendChild(toast);

        // Animate In
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        // Animate Out
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    /**
     * UI: Create Toast Container
     */
    function createToastContainer() {
        if (document.getElementById('difficulty-toast-container')) return;

        toastContainer = document.createElement('div');
        toastContainer.id = 'difficulty-toast-container';
        toastContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(toastContainer);
    }

    function updateIndicator() {
        const badge = document.getElementById('difficulty-badge');
        if (!badge) return;

        // Determine current mode
        let activeMode = 'type';
        if (document.getElementById('tab-speak') && document.getElementById('tab-speak').classList.contains('active')) {
            activeMode = 'speak';
        } else if (document.getElementById('tab-srs') && document.getElementById('tab-srs').classList.contains('active')) {
            activeMode = 'srs';
        } // Add other modes as needed

        // Check if manual or auto
        // Note: getCurrentSettings handles the logic, but we want to know if it's manual for display text
        const isManual = hasUnlockedFeature && !globalSettings.autoAdjustEnabled;

        // Use getCurrentSettings to get the EFFECTIVE settings (auto or manual)
        const settings = getCurrentSettings(activeMode);

        if (!hasUnlockedFeature && !globalSettings.manualLevel) { // Hide if not unlocked and not manually forced (unlikely case)
            badge.style.display = 'none';
            return;
        }

        // Ensure badge is visible if unlocked OR if we want to show it for manual testing
        // The requirement "when auto is turned off, let user choose" implies feature is unlocked.
        if (!hasUnlockedFeature) {
            badge.style.display = 'none';
            return;
        }

        const levelName = settings.name || `Level ${settings.level}`;
        const suffix = isManual ? ' (Manual)' : '';

        const textEl = document.getElementById('diff-level-text');
        if (textEl) textEl.textContent = `${levelName}${suffix}`;

        badge.className = `difficulty-badge level-${settings.level}`;
        badge.style.display = 'inline-flex';
        badge.title = `Smart Difficulty: ${activeMode.toUpperCase()} Mode (Level ${settings.level}${suffix})`;
    }

    /**
     * UI: Create and Open Settings Modal
     */
    function openSettings() {
        let modal = document.getElementById('difficulty-settings-modal');
        if (!modal) {
            createSettingsModal();
            modal = document.getElementById('difficulty-settings-modal');
        }

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

        // Show modal with transition
        modal.display = 'flex'; // This line might be redundant with style.display below or incorrect props
        modal.style.display = 'flex';
        // Force reflow
        void modal.offsetWidth;
        modal.classList.add('active');
    }

    function createSettingsModal() {
        const modal = document.createElement('div');
        modal.id = 'difficulty-settings-modal';
        // Reuse shop-modal classes for consistent "Premium" look
        modal.className = 'shop-modal';
        modal.style.zIndex = '11000'; // Ensure it's above other elements

        modal.innerHTML = `
            <div class="shop-modal-content" style="max-width: 450px; padding: 0;">
                <div class="shop-header">
                    <h2>Smart Difficulty Settings</h2>
                    <button class="shop-close-btn" id="diff-s-close">&times;</button>
                </div>
                
                <div class="shop-body">
                    <div class="setting-group" style="margin-bottom: 24px; background: white; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <label class="setting-label" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; margin-bottom: 8px;">
                            <span style="font-weight:600; font-size: 1.1rem; color: #1e293b;">Enable Auto-Adjust</span>
                            <!-- Custom Toggle Switch -->
                            <div class="toggle-switch">
                                <input type="checkbox" id="diff-s-toggle">
                                <span class="toggle-slider"></span>
                            </div>
                        </label>
                        <p style="color:#64748b; font-size:0.9rem; margin:0; line-height: 1.5;">
                            Automatically increases or decreases difficulty based on your performance history.
                        </p>
                    </div>

                    <!-- Manual Level Selection (Hidden by default) -->
                    <div id="diff-s-manual-container" class="setting-group" style="margin-bottom: 24px; background: white; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0; display: none;">
                        <label class="setting-label" style="display:block; font-weight:600; margin-bottom:12px; color: #1e293b; font-size: 1.1rem;">Manual Level Selection</label>
                        <select id="diff-s-manual-level" style="width:100%; padding:12px; border-radius:8px; border:1px solid #cbd5e1; font-size: 1rem; color: #334155; background-color: #f8fafc;">
                            <option value="1">Level 1 (Guided)</option>
                            <option value="2">Level 2 (Supported)</option>
                            <option value="3">Level 3 (Independent)</option>
                        </select>
                        <p style="color:#64748b; font-size:0.85rem; margin-top:8px; line-height: 1.4;">
                            Manually override the difficulty level for testing or specific practice.
                        </p>
                    </div>

                    <div id="diff-s-sensitivity-container" class="setting-group" style="margin-bottom: 24px; background: white; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <label class="setting-label" style="display:block; font-weight:600; margin-bottom:12px; color: #1e293b; font-size: 1.1rem;">Adjustment Sensitivity</label>
                        <select id="diff-s-sensitivity" style="width:100%; padding:12px; border-radius:8px; border:1px solid #cbd5e1; font-size: 1rem; color: #334155; background-color: #f8fafc;">
                            <option value="low">Low (Steady Progress)</option>
                            <option value="medium">Medium (Recommended)</option>
                            <option value="high">High (Fast Paced)</option>
                        </select>
                        <p style="color:#64748b; font-size:0.85rem; margin-top:8px; line-height: 1.4;">
                            Determines how quickly the AI reacts to your success or struggle.
                        </p>
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
            // Ensure manualLevel is saved as a number
            globalSettings.manualLevel = parseInt(manualLevel.value, 10);

            saveProfile();
            updateIndicator(); // Reflect changes immediately

            // Close modal
            modal.classList.remove('active');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);

            // Show toast

            notifyAdjustment('maintain', userDifficultyProfile.type.level);
        });

        // Close functions
        const closeBtn = document.getElementById('diff-s-close');
        const closeFn = () => {
            modal.classList.remove('active');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);
        };

        closeBtn.onclick = closeFn;

        // Close on outside click
        modal.onclick = (e) => {
            if (e.target === modal) closeFn();
        };
    }

    // Public API
    return {
        init,
        getCurrentSettings,
        adjustDifficulty,
        getLevelSettings,
        openSettings,
        isFeatureEnabled: () => hasUnlockedFeature
    };
})();

window.DifficultyManager = DifficultyManager;
