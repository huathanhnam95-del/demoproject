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
        extended: [
            // Placeholder steps for Fill/Extended mode
            {
                target: null,
                icon: '📝',
                title: 'Fill Mode Guide',
                text: 'Welcome to <strong>Fill in the Blank</strong> mode! First, read the text within the time limit.',
                position: 'center',
                nextLabel: 'Start →',
                interactive: false
            },
            {
                target: '#reading-timer-display',
                icon: '⏱️',
                title: 'Reading Timer',
                text: 'You have 30 seconds to read the text. You can skip this if you finish early.',
                position: 'bottom',
                nextLabel: 'Next',
                interactive: false
            },
            {
                target: '#skip-reading-btn',
                icon: '⏩',
                title: 'Skip Reading',
                text: 'Click here to skip the timer and start filling in the blanks.',
                position: 'top',
                nextLabel: 'Got it!',
                interactive: false
            }
        ],
        writing: [
            // Placeholder steps for Writing Challenge
            {
                target: null,
                icon: '✍️',
                title: 'Writing Challenge',
                text: 'Time to practice your writing! You will be given a topic or question to answer.',
                position: 'center',
                nextLabel: 'Next →',
                interactive: false
            },
            {
                target: '#srs-writing-textarea', // Assuming ID, might need adjustment based on SRS module
                icon: '⌨️',
                title: 'Your Response',
                text: 'Type your answer here. Try to use the vocabulary you\'ve learned.',
                position: 'top',
                nextLabel: 'Finish',
                interactive: false
            }
        ]
    };

    let currentStep = 0;
    let currentMode = 'type';
    let isActive = false;
    let interactiveListener = null;

    // DOM elements (cached)
    let overlay, backdrop, spotlight, tooltip, title, text, icon, nextBtn, skipBtn, dotsContainer;

    /**
     * Initialize tutorial DOM references
     */
    function initElements() {
        overlay = document.getElementById('tutorial-overlay');
        backdrop = document.getElementById('tutorial-backdrop');
        spotlight = document.getElementById('tutorial-spotlight');
        tooltip = document.getElementById('tutorial-tooltip');
        title = document.getElementById('tutorial-title');
        text = document.getElementById('tutorial-text');
        icon = document.getElementById('tutorial-icon');
        nextBtn = document.getElementById('tutorial-next');
        skipBtn = document.getElementById('tutorial-skip');
        dotsContainer = document.getElementById('tutorial-dots');

        if (nextBtn) nextBtn.addEventListener('click', nextStep);
        if (skipBtn) skipBtn.addEventListener('click', endTutorial);

        // Forward clicks on overlay to the spotlighted element
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (!isActive || !spotlight || spotlight.style.display === 'none') return;

                const spotlightRect = spotlight.getBoundingClientRect();

                // Check if click is inside spotlight
                if (e.clientX >= spotlightRect.left &&
                    e.clientX <= spotlightRect.right &&
                    e.clientY >= spotlightRect.top &&
                    e.clientY <= spotlightRect.bottom) {

                    e.stopPropagation();
                    e.preventDefault();

                    // Hide overlay momentarily to click what's underneath
                    overlay.style.display = 'none';
                    const target = document.elementFromPoint(e.clientX, e.clientY);

                    if (target) {
                        target.click();
                        // Also trigger focus if it's an input/button
                        if (target.focus) target.focus();
                    }

                    // Restore overlay
                    overlay.style.display = 'block';
                }
            }, { capture: true });
        }
    }

    /**
     * Check if tutorial has been completed for a mode
     */
    function hasCompletedTutorial(mode = 'type') {
        let key = 'lengthFilterTutorialCompleted';
        if (mode === 'speak') key = 'speakLengthFilterTutorialCompleted';
        else if (mode === 'extended') key = 'extendedTutorialCompleted';
        else if (mode === 'writing') key = 'writingTutorialCompleted';

        return localStorage.getItem(key) === 'true';
    }

    /**
     * Mark tutorial as completed for a mode
     */
    function markTutorialCompleted(mode = 'type') {
        let key = 'lengthFilterTutorialCompleted';
        if (mode === 'speak') key = 'speakLengthFilterTutorialCompleted';
        else if (mode === 'extended') key = 'extendedTutorialCompleted';
        else if (mode === 'writing') key = 'writingTutorialCompleted';

        localStorage.setItem(key, 'true');
    }

    /**
     * Start the tutorial for a specific mode
     */
    function startTutorial(mode = 'type') {
        if (hasCompletedTutorial(mode)) {
            console.log(`Tutorial for ${mode} mode already completed, skipping.`);
            return;
        }

        console.log(`Starting length filter tutorial for ${mode} mode...`);
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
     * Show a specific step
     */
    function showStep(index) {
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

        // Small delay to let UI settle after beforeShow
        setTimeout(() => {
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
                const targetEl = document.querySelector(step.target);
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
        markTutorialCompleted(currentMode);
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
     * Reset tutorial for a mode (for testing/replay)
     */
    function resetTutorial(mode = 'type') {
        let key = 'lengthFilterTutorialCompleted';
        if (mode === 'speak') key = 'speakLengthFilterTutorialCompleted';
        else if (mode === 'extended') key = 'extendedTutorialCompleted';
        else if (mode === 'writing') key = 'writingTutorialCompleted';

        localStorage.removeItem(key);
        console.log(`Tutorial for ${mode} mode reset. Will show on next unlock/visit.`);
    }

    /**
     * Mark tutorial as completed for a mode manually (for settings)
     */
    function forceCompleteTutorial(mode = 'type') {
        let key = 'lengthFilterTutorialCompleted';
        if (mode === 'speak') key = 'speakLengthFilterTutorialCompleted';
        else if (mode === 'extended') key = 'extendedTutorialCompleted';
        else if (mode === 'writing') key = 'writingTutorialCompleted';

        localStorage.setItem(key, 'true');
        console.log(`Tutorial for ${mode} mode marked as completed.`);
    }

    /**
     * Initialize settings checkboxes
     */
    function initSettings() {
        const settingsMap = {
            'tutorial-replay-listen': 'type',
            'tutorial-replay-speak': 'speak',
            'tutorial-replay-cloze': 'extended',
            'tutorial-replay-writing': 'writing'
        };

        for (const [id, mode] of Object.entries(settingsMap)) {
            const toggle = document.getElementById(id);
            if (toggle) {
                // Set initial state: Checked if tutorial is NOT completed (replay enabled)
                // BUT: User wants "Enable to replay next time". 
                // So if it's completed, box is unchecked. If I check it, I reset the tutorial.

                // Check if tutorial is currently "active" (not completed)
                let isCompleted = hasCompletedTutorial(mode);

                // If the key is missing or false, it means tutorial is pending -> Replay is ON
                toggle.checked = !isCompleted;

                toggle.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        // User wants to replay -> Enable it (reset completion flag)
                        resetTutorial(mode);
                    } else {
                        // User wants to disable replay -> Mark as completed
                        forceCompleteTutorial(mode);
                    }
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
