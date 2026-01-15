/**
 * ============================================
 * Interactive Tutorial System (Multi-mode)
 * ============================================
 * Mobile game-style step-by-step tutorial with spotlight effect
 * Supports Type and Speak modes with interactive steps
 */

(function () {
    'use strict';

    // Tutorial steps configuration for each mode
    const TUTORIAL_STEPS = {
        type: [
            {
                target: null,
                icon: '🎉',
                title: 'Feature Unlocked!',
                text: 'Congratulations! You\'ve unlocked <strong>Filter by Sentence Length</strong> for Type mode! This helps you practice with sentences of different lengths.',
                position: 'center',
                nextLabel: 'Show Me How →',
                interactive: false
            },
            {
                target: '#length-filter-btn-type',
                icon: '👆',
                title: 'Step 1: Click the Button',
                text: 'Click this purple button to open the filter menu.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const container = document.getElementById('length-filter-container-type');
                    if (container) container.style.display = 'block';
                }
            },
            {
                target: '#length-filter-menu-type .filter-option[data-value="5-8"]',
                icon: '📝',
                title: 'Step 2: Select a Length',
                text: 'Now click on <strong>"5-8 words"</strong> to filter for short sentences. Great for beginners!',
                position: 'right',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const menu = document.getElementById('length-filter-menu-type');
                    const dropdown = document.getElementById('length-filter-container-type');
                    if (menu) menu.style.display = 'block';
                    if (dropdown) dropdown.classList.add('open');
                }
            },
            {
                target: '#question-select-type',
                icon: '🎯',
                title: 'Filtered!',
                text: 'The questions are now filtered by sentence length. You can change the filter anytime. Happy practicing!',
                position: 'bottom',
                nextLabel: 'Got It! ✓',
                interactive: false
            }
        ],
        speak: [
            {
                target: null,
                icon: '🎉',
                title: 'Feature Unlocked!',
                text: 'Congratulations! You\'ve unlocked <strong>Filter by Sentence Length</strong> for Speak mode! This helps you practice with sentences of different lengths.',
                position: 'center',
                nextLabel: 'Show Me How →',
                interactive: false
            },
            {
                target: '#length-filter-btn-speak',
                icon: '👆',
                title: 'Step 1: Click the Button',
                text: 'Click this purple button to open the filter menu.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    // Switch to Speak tab first
                    const speakTab = document.getElementById('tab-speak');
                    if (speakTab) speakTab.click();
                    const container = document.getElementById('length-filter-container-speak');
                    if (container) container.style.display = 'block';
                }
            },
            {
                target: '#length-filter-menu-speak .filter-option[data-value="4-7"]',
                icon: '📝',
                title: 'Step 2: Select a Length',
                text: 'Now click on <strong>"4-7 words"</strong> to filter for short sentences. Great for beginners!',
                position: 'right',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const menu = document.getElementById('length-filter-menu-speak');
                    const dropdown = document.getElementById('length-filter-container-speak');
                    if (menu) menu.style.display = 'block';
                    if (dropdown) dropdown.classList.add('open');
                }
            },
            {
                target: '#question-select-speak',
                icon: '🎯',
                title: 'Filtered!',
                text: 'The questions are now filtered by sentence length. You can change the filter anytime. Happy practicing!',
                position: 'bottom',
                nextLabel: 'Got It! ✓',
                interactive: false
            }
        ],
    };

    // Helper functions

    /**
     * Helper to get keys for a mode
     */
    function getKeys(mode) {
        if (mode === 'speak') return {
            complete: 'speakLengthFilterTutorialCompleted',
            replay: 'speakLengthFilterTutorialReplay'
        };
        if (mode === 'extended') return {
            complete: 'extendedTutorialCompleted',
            replay: 'extendedTutorialReplay'
        };
        if (mode === 'writing') return {
            complete: 'writingTutorialCompleted',
            replay: 'writingTutorialReplay'
        };
        // Default 'type'
        return {
            complete: 'lengthFilterTutorialCompleted',
            replay: 'lengthFilterTutorialReplay'
        };
    }

    /**
     * Check if tutorial has been fully completed
     */
    function hasCompletedTutorial(mode = 'type') {
        const { complete } = getKeys(mode);
        return localStorage.getItem(complete) === 'true';
    }

    /**
     * Check if replay is enabled
     */
    function isReplayEnabled(mode = 'type') {
        const { replay } = getKeys(mode);
        return localStorage.getItem(replay) === 'true';
    }

    /**
     * Check if tutorial should show (Not completed OR Replay enabled)
     */
    function shouldShowTutorial(mode = 'type') {
        return !hasCompletedTutorial(mode) || isReplayEnabled(mode);
    }

    /**
     * Mark tutorial as completed
     */
    function markTutorialCompleted(mode = 'type') {
        const { complete } = getKeys(mode);
        localStorage.setItem(complete, 'true');
    }

    /**
     * Set replay preference
     */
    function setReplayPreference(mode, enabled) {
        const { replay } = getKeys(mode);
        if (enabled) {
            localStorage.setItem(replay, 'true');
        } else {
            localStorage.removeItem(replay);
        }
    }

    /**
     * Start the tutorial for a specific mode
     */
    function startTutorial(mode = 'type') {
        if (!shouldShowTutorial(mode)) {
            console.log(`Tutorial for ${mode} mode skipped (Completed & No Replay).`);
            return;
        }

        console.log(`Starting tutorial for ${mode} mode...`);
        currentMode = mode;
        initElements();

        if (!overlay) {
            console.error('Tutorial overlay not found');
            return;
        }

        currentStep = 0;
        isActive = true;

        // Create dots
        renderDots();

        // Show overlay
        overlay.style.display = 'block';

        // Show first step
        showStep(currentStep);
    }

    /**
     * Get steps for current mode
     */
    function getSteps() {
        return TUTORIAL_STEPS[currentMode] || TUTORIAL_STEPS.type;
    }

    /**
     * Render progress dots
     */
    function renderDots() {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';

        const steps = getSteps();
        for (let i = 0; i < steps.length; i++) {
            const dot = document.createElement('span');
            dot.className = 'tutorial-dot';
            if (i === currentStep) dot.classList.add('active');
            if (i < currentStep) dot.classList.add('completed');
            dotsContainer.appendChild(dot);
        }
    }

    /**
     * Clean up interactive listener
     */
    function cleanupInteractiveListener() {
        if (interactiveListener && interactiveListener.target && interactiveListener.handler) {
            interactiveListener.target.removeEventListener(interactiveListener.event, interactiveListener.handler, interactiveListener.options);
            interactiveListener = null;
        }
    }

    /**
     * Helper to safely find target with retries
     */
    function waitForTarget(selector, timeout = 500) {
        return new Promise(resolve => {
            const element = document.querySelector(selector);
            if (element && element.offsetParent !== null) { // Check visibility
                resolve(element);
                return;
            }

            // Retry for a bit if not found/visible
            let retries = 0;
            const interval = setInterval(() => {
                retries++;
                const el = document.querySelector(selector);
                if (el && el.offsetParent !== null) {
                    clearInterval(interval);
                    resolve(el);
                } else if (retries * 50 > timeout) {
                    clearInterval(interval);
                    resolve(null);
                }
            }, 50);
        });
    }

    /**
     * Show a specific step
     */
    async function showStep(index) {
        const steps = getSteps();

        if (index >= steps.length) {
            endTutorial();
            return;
        }

        const step = steps[index];

        // Clean up previous listener
        cleanupInteractiveListener();

        // Run beforeShow callback if exists
        if (step.beforeShow) step.beforeShow();

        // Small delay to let UI settle, then verify target
        setTimeout(async () => {
            // Update content
            if (icon) icon.textContent = step.icon;
            if (title) title.textContent = step.title;
            if (text) text.innerHTML = step.text;

            // Handle next button visibility
            if (step.interactive && !step.nextLabel) {
                if (nextBtn) nextBtn.style.display = 'none';
            } else {
                if (nextBtn) {
                    nextBtn.style.display = 'inline-block';
                    nextBtn.textContent = step.nextLabel || 'Next →';
                }
            }

            // Update dots
            renderDots();

            // Position spotlight and tooltip
            if (step.target) {
                // Robust wait for element
                const targetEl = await waitForTarget(step.target);

                if (targetEl) {
                    positionSpotlight(targetEl);
                    positionTooltip(targetEl, step.position);
                    spotlight.style.display = 'block';
                    spotlight.classList.add('pulse');
                    backdrop.style.display = 'none';

                    // Set up interactive listener
                    if (step.interactive && step.waitForEvent) {
                        const handler = () => {
                            // Small delay to let the click complete its normal action
                            setTimeout(() => nextStep(), 100);
                        };
                        targetEl.addEventListener(step.waitForEvent, handler, { once: true });
                        interactiveListener = { target: targetEl, event: step.waitForEvent, handler };

                        // Make target clickable through spotlight
                        targetEl.style.position = 'relative';
                        targetEl.style.zIndex = '10002';
                    }
                } else {
                    console.warn(`Tutorial target not found: ${step.target}, falling back to centered`);
                    showCenteredTooltip();
                }
            } else {
                showCenteredTooltip();
            }

            // Update tooltip arrow class
            tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right', 'center');
            if (step.position === 'center') {
                tooltip.classList.add('center');
            } else if (step.position === 'bottom') {
                tooltip.classList.add('arrow-top');
            } else if (step.position === 'top') {
                tooltip.classList.add('arrow-bottom');
            } else if (step.position === 'left') {
                tooltip.classList.add('arrow-right');
            } else if (step.position === 'right') {
                tooltip.classList.add('arrow-left');
            }
        }, 100);
    }

    /**
     * Show centered tooltip (no spotlight)
     */
    function showCenteredTooltip() {
        spotlight.style.display = 'none';
        spotlight.classList.remove('pulse');
        backdrop.style.display = 'block';

        tooltip.style.top = '50%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
    }

    /**
     * Position spotlight around target element
     */
    function positionSpotlight(targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const padding = 8;

        spotlight.style.top = (rect.top - padding) + 'px';
        spotlight.style.left = (rect.left - padding) + 'px';
        spotlight.style.width = (rect.width + padding * 2) + 'px';
        spotlight.style.height = (rect.height + padding * 2) + 'px';
    }

    /**
     * Position tooltip near target element
     */
    function positionTooltip(targetEl, position) {
        const rect = targetEl.getBoundingClientRect();
        const gap = 16;

        tooltip.style.transform = 'none';

        switch (position) {
            case 'bottom':
                tooltip.style.top = (rect.bottom + gap) + 'px';
                tooltip.style.left = Math.max(16, rect.left + rect.width / 2 - 180) + 'px';
                break;
            case 'top':
                tooltip.style.top = (rect.top - gap - 200) + 'px';
                tooltip.style.left = Math.max(16, rect.left + rect.width / 2 - 180) + 'px';
                break;
            case 'left':
                tooltip.style.top = (rect.top + rect.height / 2 - 100) + 'px';
                tooltip.style.left = (rect.left - gap - 380) + 'px';
                break;
            case 'right':
                tooltip.style.top = (rect.top + rect.height / 2 - 100) + 'px';
                tooltip.style.left = (rect.right + gap) + 'px';
                break;
            default:
                tooltip.style.top = '50%';
                tooltip.style.left = '50%';
                tooltip.style.transform = 'translate(-50%, -50%)';
        }
    }

    /**
     * Go to next step
     */
    function nextStep() {
        const steps = getSteps();
        const step = steps[currentStep];

        // Reset z-index of previous target
        if (step && step.target) {
            const targetEl = document.querySelector(step.target);
            if (targetEl) {
                targetEl.style.zIndex = '';
            }
        }

        // Run afterHide callback if exists
        if (step && step.afterHide) step.afterHide();

        currentStep++;

        if (currentStep >= steps.length) {
            endTutorial();
        } else {
            showStep(currentStep);
        }
    }

    /**
     * End the tutorial
     */
    function endTutorial() {
        isActive = false;

        // Mark as completed
        markTutorialCompleted(currentMode);

        // Turn OFF replay preference (standard behavior: play once then disable replay unless re-enabled)
        setReplayPreference(currentMode, false);

        cleanupInteractiveListener();

        if (overlay) overlay.style.display = 'none';

        // Clean up any open menus
        const menuType = document.getElementById('length-filter-menu-type');
        const dropdownType = document.getElementById('length-filter-container-type');
        const menuSpeak = document.getElementById('length-filter-menu-speak');
        const dropdownSpeak = document.getElementById('length-filter-container-speak');

        if (menuType) menuType.style.display = 'none';
        if (dropdownType) dropdownType.classList.remove('open');
        if (menuSpeak) menuSpeak.style.display = 'none';
        if (dropdownSpeak) dropdownSpeak.classList.remove('open');

        console.log(`Tutorial for ${currentMode} mode completed!`);
    }

    /**
     * Reset tutorial for a mode (for testing)
     */
    function resetTutorial(mode = 'type') {
        const { complete, replay } = getKeys(mode);
        localStorage.removeItem(complete);
        localStorage.removeItem(replay);
        console.log(`Tutorial for ${mode} mode reset.`);
    }

    /**
     * Initialize settings checkboxes
     */
    function initSettings() {
        const settingsMap = {
            'tutorial-replay-listen': 'type',
            'tutorial-replay-speak': 'speak',
            // Removed 'extended' and 'writing' from here as they are handled by vocab-tutorial.js
            // to avoid conflict (double event listeners on the same checkbox)
        };

        for (const [id, mode] of Object.entries(settingsMap)) {
            const toggle = document.getElementById(id);
            if (toggle) {
                // FIXED: Checkbox logic now reflects "Replay Preference" only
                // It does NOT change the permanent completion status

                // Initial state: Checked if Replay is explicitly enabled
                toggle.checked = isReplayEnabled(mode);

                toggle.addEventListener('change', (e) => {
                    setReplayPreference(mode, e.target.checked);
                    console.log(`Tutorial replay for ${mode}: ${e.target.checked}`);
                });
            }
        }
    }

    // Expose to window for external triggering
    window.LengthFilterTutorial = {
        start: startTutorial,
        reset: resetTutorial,
        hasCompleted: hasCompletedTutorial,
        initSettings: initSettings
    };

    // Initialize settings on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSettings);
    } else {
        initSettings();
    }

})();
