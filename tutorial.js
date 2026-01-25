/**
 * ============================================
 * Interactive Tutorial System (Multi-mode)
 * ============================================
 * Mobile game-style step-by-step tutorial with spotlight effect
 * Supports Type and Speak modes with interactive steps
 */

(function () {
    'use strict';

    // ============================================
    // STATE VARIABLES
    // ============================================
    let currentMode = 'type';
    let currentStep = 0;
    let isActive = false;
    let spotlightLoopId = null; // Track animation frame for spotlight loop
    let interactiveListener = null;
    let nextStepTimer = null;

    // DOM element references (cached)
    let overlay, backdrop, spotlight, tooltip, icon, title, text, nextBtn, skipBtn, dotsContainer;

    /**
     * Initialize tutorial DOM references
     */
    function initElements() {
        overlay = document.getElementById('tutorial-overlay');
        backdrop = document.getElementById('tutorial-backdrop');
        spotlight = document.getElementById('tutorial-spotlight');
        tooltip = document.getElementById('tutorial-tooltip');
        icon = document.getElementById('tutorial-icon');
        title = document.getElementById('tutorial-title');
        text = document.getElementById('tutorial-text');
        nextBtn = document.getElementById('tutorial-next');
        skipBtn = document.getElementById('tutorial-skip');
        dotsContainer = document.getElementById('tutorial-dots');

        // Set up next button click handler
        if (nextBtn) {
            nextBtn.addEventListener('click', nextStep);
        }

        if (skipBtn) {
            skipBtn.addEventListener('click', endTutorial);
        }

        // Handle window resize to update positioning
        window.addEventListener('resize', () => {
            if (isActive && currentStep >= 0) {
                const steps = getSteps();
                const step = steps[currentStep];
                if (step && step.target) {
                    const targetEl = document.querySelector(step.target);
                    if (targetEl) {
                        // Loop is already running, no need to force update here
                    }
                }
            }
        });
    }

    // Tutorial steps configuration for each mode
    const TUTORIAL_STEPS = {
        // General Type Mode Tutorial (Learning Center)
        type: [
            {
                target: null,
                icon: '⌨️',
                title: 'Welcome to Type Mode!',
                text: 'Practice your listening and typing skills by transcribing sentences you hear. Let\'s get started!',
                position: 'center',
                nextLabel: 'Show Me How →',
                interactive: false,
                beforeShow: () => {
                    const typeTab = document.getElementById('tab-type');
                    if (typeTab && !typeTab.classList.contains('active')) typeTab.click();
                }
            },
            {
                target: '#play-btn',
                icon: '🔊',
                title: 'Step 1: Listen',
                text: '<span class="tutorial-action-text">Click this button</span> to hear the sentence. You can replay it as many times as you need!',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#answer-input',
                icon: '✍️',
                title: 'Step 2: Type What You Hear',
                text: `
                    <span class="tutorial-action-text">Type a valid sentence</span>. 
                    <div class="tutorial-checklist">
                        <div class="checklist-item" id="check-cap">
                            <span class="checklist-icon">⬜</span> 
                            <span>Start with a Capital letter</span>
                        </div>
                        <div class="checklist-item" id="check-period">
                            <span class="checklist-icon">⬜</span> 
                            <span>End with a period (.)</span>
                        </div>
                    </div>
                `,
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'input',
                onInput: (e) => {
                    const val = (e.target.value || '').trim();
                    const hasCap = /^[A-Z]/.test(val);
                    const hasPeriod = /\.$/.test(val);

                    const capItem = document.getElementById('check-cap');
                    const periodItem = document.getElementById('check-period');

                    if (capItem) {
                        capItem.classList.toggle('done', hasCap);
                        capItem.querySelector('.checklist-icon').textContent = hasCap ? '✅' : '⬜';
                    }
                    if (periodItem) {
                        periodItem.classList.toggle('done', hasPeriod);
                        periodItem.querySelector('.checklist-icon').textContent = hasPeriod ? '✅' : '⬜';
                    }
                },
                validate: (e) => {
                    const val = (e.target.value || '').trim();
                    return val.length >= 3 && /^[A-Z]/.test(val) && /\.$/.test(val);
                },
                beforeShow: () => {
                    const input = document.getElementById('answer-input');
                    if (input) {
                        input.disabled = false;
                        input.placeholder = 'Type here...';
                        input.focus();
                    }
                }
            },
            {
                target: '#check-btn',
                icon: '✅',
                title: 'Step 3: Check Your Answer',
                text: 'When you\'re ready, <span class="tutorial-action-text">Click "Check"</span> to see how you did.',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const checkBtn = document.getElementById('check-btn');
                    if (checkBtn) checkBtn.style.display = 'inline-block';
                }
            },
            {
                target: '.animation-panel',
                icon: '📊',
                title: 'Step 4: Feedback',
                text: 'Correct words/letters will turn <strong style="color: #4ade80">green</strong>, and mistakes will be <strong style="color: #f87171">red</strong>. Review your errors to learn!',
                position: 'top',
                nextLabel: 'Got It →',
                interactive: false,
                beforeShow: () => {
                    // Ensure animation panel is visible
                    const animationPanel = document.querySelector('.animation-panel');
                    if (animationPanel) {
                        animationPanel.style.display = 'block';
                    }
                }
            },
            {
                target: '#progress-bar-type',
                icon: '🪙',
                title: 'Step 5: Earn Coins',
                text: 'Earn <strong>Coins</strong> for your 1st practice of the day and reaching new <strong>Milestones</strong> (3, 6, or 9 perfect scores).',
                position: 'bottom',
                nextLabel: 'Start Practicing! ✓',
                interactive: false,
                beforeShow: () => {
                    const progressBar = document.getElementById('progress-bar-type');
                    if (progressBar) progressBar.style.display = 'block';
                }
            }
        ],

        // Length Filter Tutorial (unlocked via Shop)
        typeLengthFilter: [
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
                icon: '🎤',
                title: 'Welcome to Speak Mode!',
                text: 'Improve your pronunciation by listening to native speakers and recording yourself. Let\'s practice!',
                position: 'center',
                nextLabel: 'Show Me How →',
                interactive: false,
                beforeShow: () => {
                    const speakTab = document.getElementById('tab-speak');
                    if (speakTab && !speakTab.classList.contains('active')) speakTab.click();
                }
            },
            {
                target: '#play-btn-speak',
                icon: '🔊',
                title: 'Step 1: Listen',
                text: 'Click here to hear the native pronunciation. Listen carefully to the rhythm and intonation!',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#record-btn',
                icon: '🎙️',
                title: 'Step 2: Record',
                text: 'Click "Start Recording" and speak the sentence clearly. Click it again to stop.',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: null,
                icon: '✅',
                title: 'Step 3: Check',
                text: 'After you stop recording, click <strong>"Check"</strong> to get instant feedback on your pronunciation accuracy.',
                position: 'center',
                nextLabel: 'Got It →',
                interactive: false
            },
            {
                target: null,
                icon: '🎉',
                title: 'Ready to Speak?',
                text: 'You\'re all set! Practice daily to build your confidence and fluency.',
                position: 'center',
                nextLabel: 'Start Speaking! ✓',
                interactive: false
            }
        ],

        // Length Filter Tutorial (unlocked via Shop) for Speak Mode
        speakLengthFilter: [
            {
                target: null,
                icon: '🎉',
                title: 'Feature Unlocked!',
                text: 'Congratulations! You\'ve unlocked <strong>Filter by Sentence Length</strong> for Speak mode!',
                position: 'center',
                nextLabel: 'Show Me How →',
                interactive: false
            },
            {
                target: '#length-filter-btn-speak',
                icon: '👆',
                title: 'Step 1: Click the Button',
                text: 'Click this purple button to limit questions by word count.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
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
                text: 'Select <strong>"4-7 words"</strong> to start with shorter, easier sentences.',
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
                text: 'Your question list is now updated. You can change this anytime!',
                position: 'bottom',
                nextLabel: 'Got It! ✓',
                interactive: false
            }
        ],

        // Difficulty Filter Tutorial (unlocked via Shop) for Type Mode
        typeDifficultyFilter: [
            {
                target: null,
                icon: '🎉',
                title: 'Feature Unlocked!',
                text: 'Congratulations! You\'ve unlocked <strong>Filter by Difficulty</strong>! This helps you practice at your preferred CEFR level.',
                position: 'center',
                nextLabel: 'Show Me How →',
                interactive: false
            },
            {
                target: '#difficulty-filter-btn-type',
                icon: '👆',
                title: 'Step 1: Click the Button',
                text: 'Click this teal button to open the difficulty filter menu.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const container = document.getElementById('difficulty-filter-container-type');
                    if (container) container.style.display = 'block';
                }
            },
            {
                target: '#difficulty-filter-menu-type .filter-option[data-value="1"]',
                icon: '🥉',
                title: 'Step 2: Select a Level',
                text: 'Select <strong>"Level 1 (Easy)"</strong> to start with simpler sentences. Great for beginners!',
                position: 'right',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const menu = document.getElementById('difficulty-filter-menu-type');
                    const dropdown = document.getElementById('difficulty-filter-container-type');
                    if (menu) menu.style.display = 'block';
                    if (dropdown) dropdown.classList.add('open');
                }
            },
            {
                target: '#question-select-type',
                icon: '🎯',
                title: 'Filtered!',
                text: 'Your question list now shows only easier sentences. You can change this anytime!',
                position: 'bottom',
                nextLabel: 'Got It! ✓',
                interactive: false
            }
        ],

        // Difficulty Filter Tutorial (unlocked via Shop) for Speak Mode
        speakDifficultyFilter: [
            {
                target: null,
                icon: '🎉',
                title: 'Feature Unlocked!',
                text: 'Congratulations! You\'ve unlocked <strong>Filter by Difficulty</strong> for Speak mode!',
                position: 'center',
                nextLabel: 'Show Me How →',
                interactive: false
            },
            {
                target: '#difficulty-filter-btn-speak',
                icon: '👆',
                title: 'Step 1: Click the Button',
                text: 'Click this teal button to filter questions by difficulty.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const speakTab = document.getElementById('tab-speak');
                    if (speakTab) speakTab.click();
                    const container = document.getElementById('difficulty-filter-container-speak');
                    if (container) container.style.display = 'block';
                }
            },
            {
                target: '#difficulty-filter-menu-speak .filter-option[data-value="1"]',
                icon: '🥉',
                title: 'Step 2: Select a Level',
                text: 'Select <strong>"Level 1 (Easy)"</strong> for simpler pronunciation practice.',
                position: 'right',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const menu = document.getElementById('difficulty-filter-menu-speak');
                    const dropdown = document.getElementById('difficulty-filter-container-speak');
                    if (menu) menu.style.display = 'block';
                    if (dropdown) dropdown.classList.add('open');
                }
            },
            {
                target: '#question-select-speak',
                icon: '🎯',
                title: 'Filtered!',
                text: 'Your question list is now updated. You can change this anytime!',
                position: 'bottom',
                nextLabel: 'Got It! ✓',
                interactive: false
            }
        ],

        // New Shop Tutorial Nudge
        extended: [
            {
                target: null,
                icon: '📝',
                title: 'Fill Mode',
                text: 'Improve your context-based listening by filling in missing words from a transcript.',
                position: 'center',
                nextLabel: 'Show Me! →',
                beforeShow: () => {
                    const tab = document.getElementById('tab-extended');
                    if (tab) tab.click();
                }
            },
            {
                target: '#play-pause-extended-btn',
                icon: '🔊',
                title: 'Listen Carefully',
                text: 'Click here to listen to the recording with missing words. Focus on the gaps!',
                position: 'bottom',
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#gapped-transcript',
                icon: '✍️',
                title: 'Fill in the Blanks',
                text: 'Type the missing words you hear directly into the blanks in the transcript.',
                position: 'top',
                nextLabel: 'Got It →'
            },
            {
                target: '#check-extended-btn',
                icon: '✅',
                title: 'Check Your Answer',
                text: 'Click here to see how many you got right. Green is correct, red is wrong!',
                position: 'top',
                nextLabel: 'Got It →'
            }
        ],
        watch: [
            {
                target: null,
                icon: '📺',
                title: 'Watch Mode',
                text: 'Watch short video clips and answer questions to test your comprehension.',
                position: 'center',
                nextLabel: 'Show Me! →',
                beforeShow: () => {
                    const tab = document.getElementById('tab-watch');
                    if (tab) tab.click();
                }
            },
            {
                target: '#watch-video-grid',
                icon: '🎬',
                title: 'Select a Video',
                text: 'Choose a video lesson from the grid to start practicing.',
                position: 'top',
                nextLabel: 'Got It →'
            },
            {
                target: '#watch-player-wrapper',
                icon: '📽️',
                title: 'Watch & Listen',
                text: 'Watch the clip. Questions will pop up automatically at specific moments!',
                position: 'bottom',
                nextLabel: 'Next →'
            },
            {
                target: '#watch-question-panel',
                icon: '❓',
                title: 'Answer Questions',
                text: 'When a question appears, answer it here to earn points and progress!',
                position: 'left',
                nextLabel: 'Got It ✓'
            }
        ],
        notes: [
            {
                target: null,
                icon: '📓',
                title: 'Note Mode',
                text: 'Practice taking notes while listening — a crucial real-world skill!',
                position: 'center',
                nextLabel: 'Show Me! →',
                beforeShow: () => {
                    const tab = document.getElementById('tab-notes');
                    if (tab) tab.click();
                }
            },
            {
                target: '#notes-step-video',
                icon: '🔊',
                title: 'Watch & Listen',
                text: 'Play the clip and try to catch the main points and key details.',
                position: 'bottom',
                nextLabel: 'Next →'
            },
            {
                target: '#notes-user-input',
                icon: '✏️',
                title: 'Take Notes',
                text: 'Write down your notes or a summary of what you heard here.',
                position: 'top',
                nextLabel: 'Next →'
            },
            {
                target: '#notes-submit-btn',
                icon: '⚖️',
                title: 'Compare & Learn',
                text: 'Submit your notes to see the official transcript and evaluate your performance.',
                position: 'top',
                nextLabel: 'Got It ✓'
            }
        ],
        pronounce: [
            {
                target: null,
                icon: '🗣️',
                title: 'Pronounce Mode',
                text: 'Analyze your stress, pitch, and rhythm to sound more like a native speaker!',
                position: 'center',
                nextLabel: 'Show Me! →',
                beforeShow: () => {
                    const tab = document.getElementById('tab-pronounce');
                    if (tab) tab.click();
                }
            },
            {
                target: '#pa-native-audio-container',
                icon: '🔊',
                title: 'Listen to Native',
                text: 'Hear the target word pronounced correctly. Pay attention to the rising and falling pitch!',
                position: 'bottom',
                nextLabel: 'Next →'
            },
            {
                target: '#pa-record-btn',
                icon: '🎙️',
                title: 'Record & Analyze',
                text: 'Record yourself saying the word. We\'ll compare your pitch and stress to the native speaker!',
                position: 'top',
                nextLabel: 'Next →'
            },
            {
                target: '#pa-results-summary',
                icon: '📊',
                title: 'Visual Feedback',
                text: 'See detailed charts of your pronunciation. Aim for a match with the native pattern!',
                position: 'top',
                nextLabel: 'Got It ✓'
            }
        ],
        shopUnlock: [
            {
                target: '#panel-shopping-card',
                icon: '🛒',
                title: 'You Earned Coins!',
                text: 'You have enough coins to unlock a new practice mode! Visit the Shop to unlock it.',
                position: 'left',
                nextLabel: 'Go to Shop',
                interactive: true,
                waitForEvent: 'click'
            }
        ]
    };

    // Helper functions

    /**
     * Helper to get keys for a mode
     */
    function getKeys(mode) {
        if (mode === 'speak') return {
            complete: 'speakTutorialCompleted',
            replay: 'speakTutorialReplay'
        };
        if (mode === 'speakLengthFilter') return {
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
        if (mode === 'shopUnlock') return {
            complete: 'shopUnlockTutorialCompleted',
            replay: 'shopUnlockTutorialReplay'
        };
        if (mode === 'watch') return {
            complete: 'watchTutorialCompleted',
            replay: 'watchTutorialReplay'
        };
        if (mode === 'notes') return {
            complete: 'notesTutorialCompleted',
            replay: 'notesTutorialReplay'
        };
        if (mode === 'pronounce') return {
            complete: 'pronounceTutorialCompleted',
            replay: 'pronounceTutorialReplay'
        };
        // Type Length Filter (for shop unlock tutorial)
        if (mode === 'typeLengthFilter') return {
            complete: 'lengthFilterTutorialCompleted',
            replay: 'lengthFilterTutorialReplay'
        };
        // Type Difficulty Filter (for shop unlock tutorial)
        if (mode === 'typeDifficultyFilter') return {
            complete: 'typeDifficultyFilterTutorialCompleted',
            replay: 'typeDifficultyFilterTutorialReplay'
        };
        // Speak Difficulty Filter (for shop unlock tutorial)
        if (mode === 'speakDifficultyFilter') return {
            complete: 'speakDifficultyFilterTutorialCompleted',
            replay: 'speakDifficultyFilterTutorialReplay'
        };
        // Default 'type' (general Type mode tutorial)
        return {
            complete: 'typeTutorialCompleted',
            replay: 'typeTutorialReplay'
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
    function startTutorial(mode = 'type', force = false) {
        if (!force && !shouldShowTutorial(mode)) {
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

        // Hide tooltip initially to prevent jump during first step's positioning
        if (tooltip) {
            tooltip.style.display = 'none';
            tooltip.style.opacity = '0';
        }

        // Show overlay
        overlay.style.display = 'block';

        // Small delay to trigger transition
        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });

        // Set global flag for other scripts
        window.isTutorialActive = true;

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
        if (nextStepTimer) {
            clearTimeout(nextStepTimer);
            nextStepTimer = null;
        }
        if (interactiveListener && interactiveListener.target && interactiveListener.handler) {
            interactiveListener.target.removeEventListener(interactiveListener.event, interactiveListener.handler, interactiveListener.options);
            interactiveListener = null;
        }
    }
    /**
     * Stop the continuous spotlight positioning loop
     */
    function stopSpotlightLoop() {
        if (spotlightLoopId) {
            cancelAnimationFrame(spotlightLoopId);
            spotlightLoopId = null;
        }
    }

    /**
     * Start continuous spotlight positioning loop
     */
    function startSpotlightLoop(targetEl, stepPosition) {
        stopSpotlightLoop(); // Clear any existing loop

        function loop() {
            if (!isActive || !targetEl || !document.contains(targetEl)) {
                return;
            }

            // Only position if visible
            if (targetEl.offsetParent !== null) {
                positionSpotlight(targetEl);
                // Also continuously update tooltip position to handle scrolling/resize smoothly
                positionTooltip(targetEl, stepPosition);
            }

            spotlightLoopId = requestAnimationFrame(loop);
        }

        loop();
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

        // Clean up previous listener and loop
        cleanupInteractiveListener();
        stopSpotlightLoop();
        cleanupInteractiveListener();

        // Run beforeShow callback if exists
        if (step.beforeShow) step.beforeShow();

        // Hide tooltip before positioning to prevent visual jump
        tooltip.style.opacity = '0';
        tooltip.style.display = 'none'; // Completely hidden initially
        tooltip.style.transition = 'none';
        tooltip.style.animation = 'none'; // Disable CSS animation to prevent jump
        // Set initial centered position
        tooltip.style.top = '50%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';

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
                    // Ensure target is fully visible (auto for instant stability)
                    targetEl.scrollIntoView({ behavior: 'auto', block: 'center' });

                    // Wait for scroll to apply before positioning
                    requestAnimationFrame(() => {
                        // Show element for measurement but keep it invisible
                        tooltip.style.display = 'block';
                        tooltip.style.opacity = '0';
                        tooltip.style.transition = 'none'; // Disable transition during positioning

                        spotlight.style.display = 'block';
                        spotlight.classList.add('pulse');
                        backdrop.style.display = 'none';

                        // Start continuous loop to handle animations/layout shifts
                        startSpotlightLoop(targetEl, step.position);

                        // Set up interactive listener
                        if (step.interactive && step.waitForEvent) {
                            const handler = (e) => {
                                // optional real-time feedback
                                if (step.onInput && e.type === 'input') {
                                    step.onInput(e);
                                }

                                // optional validation
                                if (step.validate && !step.validate(e)) {
                                    return;
                                }

                                // Avoid double-firing
                                if (nextStepTimer) return;

                                // Small delay to let the click complete its normal action
                                nextStepTimer = setTimeout(() => {
                                    nextStepTimer = null;
                                    nextStep();
                                }, 100);
                            };

                            // For 'input', we don't want {once: true} because they might type < 3 chars first
                            const options = (step.waitForEvent === 'input') ? {} : { once: true };

                            targetEl.addEventListener(step.waitForEvent, handler, options);
                            interactiveListener = { target: targetEl, event: step.waitForEvent, handler, options };

                            // Make target clickable through spotlight
                            targetEl.style.position = 'relative';
                            targetEl.style.zIndex = '10002';
                        }

                        // Delay fade-in to allow scroll and positioning loop to stabilize
                        setTimeout(() => {
                            tooltip.style.transition = 'opacity 0.25s ease-out';
                            tooltip.style.opacity = '1';
                        }, 150); // Wait 150ms for layout to stabilize
                    });
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
                // For center (non-target), show immediately
                tooltip.style.display = 'block';
                tooltip.style.transition = 'opacity 0.2s ease-out';
                requestAnimationFrame(() => {
                    tooltip.style.opacity = '1';
                    tooltip.style.animation = '';
                });
            } else if (step.target) {
                // Class update is handled in positionTooltip for target steps, 
                // but we can double check here or just rely on positionTooltip logic.
                // However, we moved positioning inside RAF above, so we shouldn't run this block synchronously for targets.
            } else {
                // Non-target fallback (rare)
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
     * Position tooltip near target element with smart viewport detection
     */
    function positionTooltip(targetEl, preferredPosition) {
        const rect = targetEl.getBoundingClientRect();
        const gap = 16;
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        // Get actual tooltip dimensions if stable, otherwise estimate
        const tooltipWidth = tooltip.offsetWidth || 360;
        const tooltipHeight = tooltip.offsetHeight || 200;

        tooltip.style.transform = 'none';
        tooltip.style.bottom = ''; // Reset potential bottom override
        tooltip.style.right = '';  // Reset potential right override

        let top, left, arrowClass;
        let finalPos = preferredPosition;

        // --- Space Checking ---
        const spaceBelow = viewport.height - rect.bottom;
        const spaceAbove = rect.top;
        const spaceRight = viewport.width - rect.right;
        const spaceLeft = rect.left;

        // --- Auto-Flip Logic ---
        // If preferred is bottom but no space, and there is space above -> flip to top
        if (preferredPosition === 'bottom' && spaceBelow < (tooltipHeight + gap) && spaceAbove > (tooltipHeight + gap)) {
            finalPos = 'top';
        }
        // If preferred is top but no space, and there is space below -> flip to bottom
        if (preferredPosition === 'top' && spaceAbove < (tooltipHeight + gap) && spaceBelow > (tooltipHeight + gap)) {
            finalPos = 'bottom';
        }
        // Horizontal flips
        if (preferredPosition === 'right' && spaceRight < (tooltipWidth + gap) && spaceLeft > (tooltipWidth + gap)) {
            finalPos = 'left';
        }
        if (preferredPosition === 'left' && spaceLeft < (tooltipWidth + gap) && spaceRight > (tooltipWidth + gap)) {
            finalPos = 'right';
        }

        // --- Calculate Coordinates ---
        switch (finalPos) {
            case 'bottom':
                top = rect.bottom + gap;
                left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
                arrowClass = 'arrow-top';
                break;
            case 'top':
                top = rect.top - tooltipHeight - gap;
                left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
                arrowClass = 'arrow-bottom';
                break;
            case 'left':
                top = rect.top + (rect.height / 2) - (tooltipHeight / 2);
                left = rect.left - tooltipWidth - gap;
                arrowClass = 'arrow-right';
                // Clamp top to be visible
                top = Math.max(10, Math.min(top, viewport.height - tooltipHeight - 10));
                break;
            case 'right':
                top = rect.top + (rect.height / 2) - (tooltipHeight / 2);
                left = rect.right + gap;
                arrowClass = 'arrow-left';
                // Clamp top to be visible
                top = Math.max(10, Math.min(top, viewport.height - tooltipHeight - 10));
                break;
            default: // center
                top = (viewport.height / 2) - (tooltipHeight / 2);
                left = (viewport.width / 2) - (tooltipWidth / 2);
                arrowClass = 'center';
        }

        // --- Viewport Clamping (Global) ---
        // Ensure it doesn't go off the left/right screen edges
        if (finalPos === 'top' || finalPos === 'bottom') {
            left = Math.max(10, Math.min(left, viewport.width - tooltipWidth - 10));
        }

        // Apply styles
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;

        // Reset arrow classes
        tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right', 'center');
        tooltip.classList.add(arrowClass);

        // Dynamic Arrow Adjustment (if tooltip shifted horizontally from center)
        // This moves the CSS arrow to point to the target even if the box is clamped
        if (finalPos === 'top' || finalPos === 'bottom') {
            // Find relative center of target within the tooltip's coordinate space
            const targetCenter = rect.left + (rect.width / 2);
            const tooltipStart = left;
            // Arrow position percentage (0 to 100%)
            let arrowPercent = ((targetCenter - tooltipStart) / tooltipWidth) * 100;
            arrowPercent = Math.max(10, Math.min(90, arrowPercent)); // Clamp arrow between 10% and 90%
            tooltip.style.setProperty('--arrow-left', `${arrowPercent}%`);
        } else {
            tooltip.style.removeProperty('--arrow-left');
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
        window.isTutorialActive = false;
        stopSpotlightLoop(); // Stop the loop

        window.isTutorialActive = false;

        // Mark as completed
        markTutorialCompleted(currentMode);

        // Turn OFF replay preference (standard behavior: play once then disable replay unless re-enabled)
        setReplayPreference(currentMode, false);

        cleanupInteractiveListener();

        // Remove active class for fade out
        if (overlay) {
            overlay.classList.remove('active');

            // Wait for transition (1s) before display: none
            setTimeout(() => {
                if (!isActive) { // Re-check in case tutorial started again
                    overlay.style.display = 'none';
                }
            }, 1000);
        }

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

    // Expose startTutorial globally for Learning Center buttons
    window.startTutorial = startTutorial;

    /**
     * Check if user should be nudged to the Shop
     * Called after earning coins
     */
    window.checkShopUnlockCondition = function () {
        if (!window.shopModule || !window.firebaseFirestoreFunctions) return;

        // Don't show if shop is already open
        if (document.getElementById('shop-modal')?.classList.contains('active')) return;

        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) return;

        // Check coins
        window.firebaseFirestoreFunctions.getUserProfile(userId).then(result => {
            if (result.success) {
                const coins = result.data.coins || 0;
                const unlocked = result.data.unlockedModes || [];

                // Check if can afford any LOCKED mode
                // Simple hardcoded check for now based on ShopModule data
                // Speak: 50, Fill: 100, Watch: 150
                let canAffordNewMode = false;

                if (!unlocked.includes('speak') && coins >= 50) canAffordNewMode = true;
                else if (!unlocked.includes('extended') && coins >= 50) canAffordNewMode = true;
                else if (!unlocked.includes('watch') && coins >= 50) canAffordNewMode = true;
                else if (!unlocked.includes('notes') && coins >= 50) canAffordNewMode = true;
                else if (!unlocked.includes('pronounce') && coins >= 50) canAffordNewMode = true;

                if (canAffordNewMode) {
                    // Check if already seen using localStorage to avoid nagging
                    const lastSeen = localStorage.getItem('shopNudgeLastSeen');
                    const now = Date.now();
                    // Show at most once per hour
                    if (!lastSeen || (now - parseInt(lastSeen) > 3600000)) {
                        localStorage.setItem('shopNudgeLastSeen', now);
                        window.LengthFilterTutorial.start('shopUnlock');
                    }
                }
            }
        });
    };

    // Initialize settings on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSettings);
    } else {
        initSettings();
    }

})();
