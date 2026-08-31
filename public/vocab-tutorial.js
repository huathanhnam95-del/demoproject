/**
 * ============================================
 * Vocabulary Book Tutorial System
 * ============================================
 * Comprehensive step-by-step tutorials for Vocabulary Book features
 * Includes: Vocab Book Intro, SRS modes (Listen/Speak/Cloze), Writing Challenge
 */

(function () {
    'use strict';

    // ============================================
    // TUTORIAL DEFINITIONS
    // ============================================

    const TUTORIALS = {
        // Tutorial 1: Vocab Book Introduction (after unlock)
        vocabBookIntro: {
            id: 'vocabBookIntro',
            name: 'Vocabulary Book Introduction',
            steps: [
                {
                    target: null,
                    icon: '🎉',
                    title: 'Vocabulary Book Unlocked!',
                    text: 'Congratulations! Your personal vocabulary tracker is ready. Let\'s explore what you can do with it!',
                    position: 'center',
                    nextLabel: 'Show Me! →',
                    interactive: false
                },
                {
                    target: '#vocab-panel-toggle',
                    icon: '📖',
                    title: 'Your Vocabulary Book',
                    text: 'Click this icon anytime to open your vocabulary book. It\'s always here on the left side when you need it!',
                    position: 'right',
                    nextLabel: null,
                    interactive: true,
                    waitForEvent: 'click',
                    beforeShow: () => {
                        const toggle = document.getElementById('vocab-panel-toggle');
                        if (toggle) toggle.style.display = 'flex';
                    }
                },
                {
                    // Explicit id, not ':first-child' — a positional selector silently
                    // retargets this step if the panel sections are ever reordered.
                    target: '#vocab-section-bookmarked',
                    icon: '📌',
                    title: 'Bookmarked Words',
                    text: 'Words you <strong>manually save</strong> appear here. Add any word you want to remember by clicking the + button!',
                    position: 'bottom',
                    nextLabel: 'Got It →',
                    interactive: false,
                    beforeShow: () => {
                        // Ensure panel is open. The panel's open class is 'expanded'
                        // (see vocab-book.js togglePanel / style.css .vocab-panel-side.expanded);
                        // this used to add 'open', which no stylesheet matches, so the
                        // panel stayed shut and the step spotlit a hidden element.
                        const panel = document.getElementById('vocab-panel-side');
                        if (panel && !panel.classList.contains('expanded')) {
                            panel.classList.add('expanded');
                        }
                    }
                },
                {
                    target: '#vocab-section-missed',
                    icon: '⚠️',
                    title: 'Frequently Missed',
                    text: 'Words you miss <strong>3+ times</strong> during practice are automatically tracked here. No word slips through the cracks!',
                    position: 'bottom',
                    nextLabel: 'Next →',
                    interactive: false
                },
                {
                    target: '#vocab-panel-content',
                    icon: '📋',
                    title: 'View Full List',
                    text: 'Scroll down and click <strong>"View Full List"</strong> to see all your words in a detailed table with pronunciation and translations!',
                    position: 'left',
                    nextLabel: 'Next →',
                    interactive: false
                },
                {
                    target: null,
                    icon: '🔄',
                    title: 'Vocabulary Practice',
                    text: 'In the full list, switch to the <strong>Vocabulary Practice</strong> tab to review your words using spaced repetition. That\'s where the magic happens!',
                    position: 'center',
                    nextLabel: 'Let\'s Go! ✓',
                    interactive: false
                }
            ]
        },

        // Tutorial 2: Add Modal Introduction (auto-unlock flow)
        vocabAddModalIntro: {
            id: 'vocabAddModalIntro',
            name: 'Add to Vocabulary',
            steps: [
                {
                    target: '#vocab-add-modal',
                    icon: '📖',
                    title: 'Vocabulary Book is Ready',
                    text: 'You missed some key words. This panel lets you save them for review.',
                    position: 'center',
                    nextLabel: 'Next →',
                    interactive: false
                },
                {
                    target: '#vocab-add-words .vocab-add-word-item:first-child input',
                    icon: '✅',
                    title: 'Select Words',
                    text: 'Tick the words you want to keep. You can open examples before deciding.',
                    position: 'bottom',
                    nextLabel: 'Next →',
                    interactive: false,
                    skipIfMissing: true
                },
                {
                    target: '#vocab-add-btn',
                    icon: '💾',
                    title: 'Save to Vocabulary Book',
                    text: 'Press Add Selected to store these words for later practice.',
                    position: 'top',
                    nextLabel: 'Next →',
                    interactive: false
                },
                {
                    target: '#vocab-panel-toggle',
                    icon: '📚',
                    title: 'Review Later',
                    text: 'Open your Vocabulary Book from this button any time to review saved words.',
                    position: 'right',
                    nextLabel: 'Got It',
                    interactive: false,
                    skipIfMissing: true,
                    beforeShow: () => {
                        const toggle = document.getElementById('vocab-panel-toggle');
                        if (toggle) toggle.style.display = 'flex';
                    }
                }
            ]
        },

        // Tutorial 3: Listen and Type Mode
        srsListenType: {
            id: 'srsListenType',
            name: 'Listen and Type',
            steps: [
                {
                    target: '#srs-audio-btn',
                    icon: '🔊',
                    title: 'Listen to the Word',
                    text: 'Click this button to hear the pronunciation. Listen carefully — you\'ll need to type what you hear!',
                    position: 'bottom',
                    nextLabel: null,
                    interactive: true,
                    waitForEvent: 'click'
                },
                {
                    target: '#srs-input',
                    icon: '⌨️',
                    title: 'Type What You Hear',
                    text: 'Type the word you heard in this box. <strong>Spelling counts!</strong> Take your time.',
                    position: 'bottom',
                    nextLabel: 'Got It →',
                    interactive: false
                },
                {
                    target: '.srs-flashcard',
                    icon: '👆',
                    title: 'Flip to Check',
                    text: 'When you\'re ready, <strong>click the card</strong> or press Enter to flip it and see if you got it right!',
                    position: 'bottom',
                    nextLabel: null,
                    interactive: true,
                    waitForEvent: 'click',
                    // Auto-skip if card already flipped (user typed correct answer)
                    beforeShow: () => {
                        const card = document.querySelector('.srs-flashcard');
                        if (card && card.classList.contains('flipped')) {
                            Logger.log('[VocabTutorial] Card already flipped, auto-advancing');
                            return 'skip';
                        }
                    }
                }
            ]
        },

        // Tutorial 4: Listen and Repeat Mode  
        srsListenRepeat: {
            id: 'srsListenRepeat',
            name: 'Listen and Repeat',
            steps: [
                {
                    target: '#srs-word-front',
                    icon: '👀',
                    title: 'See the Word',
                    text: 'The word is shown here. Take a moment to read it before practicing pronunciation.',
                    position: 'bottom',
                    nextLabel: 'Next →',
                    interactive: false
                },
                {
                    target: '#srs-audio-btn',
                    icon: '🔊',
                    title: 'Listen First',
                    text: 'Click to hear the native pronunciation. Pay attention to the <strong>accent and rhythm</strong>!',
                    position: 'bottom',
                    nextLabel: null,
                    interactive: true,
                    waitForEvent: 'click'
                },
                {
                    target: '#srs-record-btn',
                    icon: '🎙️',
                    title: 'Now You Try!',
                    text: 'Click <strong>Start Recording</strong> and say the word out loud. The system will check your pronunciation!',
                    position: 'bottom',
                    nextLabel: null,
                    interactive: true,
                    waitForEvent: 'click'
                },
                {
                    target: null,
                    icon: '💡',
                    title: 'Pro Tip',
                    text: 'After flipping the card, you can click <strong>"Practice Saying It"</strong> to practice pronunciation as many times as you want!',
                    position: 'center',
                    nextLabel: 'Let\'s Practice! ✓',
                    interactive: false
                }
            ]
        },

        // Tutorial 5: Cloze (Fill in the Blank) Mode
        srsCloze: {
            id: 'srsCloze',
            name: 'Fill in the Blank',
            steps: [
                {
                    target: '#srs-definition-prompt',
                    icon: '📝',
                    title: 'Read the Sentence',
                    text: 'See the blank (______) in the sentence? Use the <strong>context</strong> to figure out which word fits!',
                    position: 'bottom',
                    nextLabel: 'Next →',
                    interactive: false
                },
                {
                    target: '#srs-input',
                    icon: '✏️',
                    title: 'Fill in the Blank',
                    text: 'Type the missing word based on the context. Think about what makes sense in this sentence!',
                    position: 'top',
                    nextLabel: 'Got It →',
                    interactive: false
                },
                {
                    target: null,
                    icon: '💡',
                    title: 'Context is Key',
                    text: 'This mode helps you understand how words are <strong>used in real sentences</strong>. It\'s one of the best ways to learn!',
                    position: 'center',
                    nextLabel: 'Let\'s Do It! ✓',
                    interactive: false
                }
            ]
        },

        // Tutorial 6: Writing Challenge
        writingChallenge: {
            id: 'writingChallenge',
            name: 'Writing Challenge',
            steps: [
                {
                    target: '#srs-writing-prompt',
                    icon: '📝',
                    title: 'Your Writing Prompt',
                    text: 'This is your challenge! Write a sentence using the <strong>target word</strong> in the given context.',
                    position: 'bottom',
                    nextLabel: 'Next →',
                    interactive: false
                },
                {
                    target: '#hint-collocations',
                    icon: '💡',
                    title: 'Collocation Hints',
                    text: 'These are <strong>common word combinations</strong> (collocations) that native speakers use. Try using them in your sentence!',
                    position: 'bottom',
                    nextLabel: 'Next →',
                    interactive: false,
                    skipIfMissing: true
                },
                {
                    target: null,  // Centered, no spotlight - avoids obscuring input
                    icon: '✍️',
                    title: 'Write Your Sentence',
                    text: 'Type your sentence here. Make sure to <strong>include the target word</strong> naturally!',
                    position: 'center',
                    nextLabel: 'Got It! →',
                    interactive: false
                },
                {
                    target: '#more-help-btn',
                    icon: '🆘',
                    title: 'Need More Help?',
                    text: 'Stuck? Click this button for <strong>example sentences</strong> and video clips to inspire you!',
                    position: 'left',
                    nextLabel: 'Ready to Write! ✓',
                    interactive: false,
                    skipIfMissing: true
                }
            ]
        }
    };

    // ============================================
    // STATE MANAGEMENT
    // ============================================

    const STORAGE_KEY = 'vocabTutorialState';
    const REPLAY_KEY = 'vocabTutorialReplay';

    let currentTutorial = null;
    let currentStep = 0;
    let isActive = false;
    let interactiveListener = null;
    let onCompleteCallback = null;

    // DOM elements (cached)
    let overlay, backdrop, spotlight, tooltip, titleEl, textEl, iconEl, nextBtn, skipBtn, dotsContainer;

    /**
     * Get tutorial state from localStorage
     */
    function getState() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch (e) {
            console.warn('[VocabTutorial] Error reading state:', e);
            return {};
        }
    }

    /**
     * Save tutorial state to localStorage
     */
    function saveState(state) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('[VocabTutorial] Error saving state:', e);
        }
    }

    /**
     * Check if a tutorial has been completed
     */
    function hasCompleted(tutorialId) {
        const state = getState();
        return state[tutorialId] === true;
    }

    /**
     * Mark a tutorial as completed
     */
    function markCompleted(tutorialId) {
        const state = getState();
        state[tutorialId] = true;
        saveState(state);
        Logger.log(`[VocabTutorial] Marked ${tutorialId} as completed`);
    }

    /**
     * Get replay preferences
     */
    function getReplayPreferences() {
        try {
            const stored = localStorage.getItem(REPLAY_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch (e) {
            return {};
        }
    }

    /**
     * Set replay preference for a tutorial
     */
    function setReplayEnabled(tutorialId, enabled) {
        const prefs = getReplayPreferences();
        prefs[tutorialId] = enabled;
        try {
            localStorage.setItem(REPLAY_KEY, JSON.stringify(prefs));
        } catch (e) {
            console.warn('[VocabTutorial] Error saving replay prefs:', e);
        }
    }

    /**
     * Check if a tutorial should be shown
     * Returns true if: not completed OR replay is enabled
     */
    function shouldShow(tutorialId) {
        const prefs = getReplayPreferences();

        // If replay is explicitly enabled, show it
        if (prefs[tutorialId] === true) {
            return true;
        }

        // Otherwise, show only if not completed
        return !hasCompleted(tutorialId);
    }

    /**
     * Reset a tutorial (for testing)
     */
    function resetTutorial(tutorialId) {
        const state = getState();
        delete state[tutorialId];
        saveState(state);
        Logger.log(`[VocabTutorial] Reset ${tutorialId}`);
    }

    /**
     * Reset all tutorials (for testing)
     */
    function resetAll() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(REPLAY_KEY);
        Logger.log('[VocabTutorial] All tutorials reset');
    }

    // ============================================
    // DOM INITIALIZATION
    // ============================================

    /**
     * Initialize tutorial DOM references
     */
    function initElements() {
        overlay = document.getElementById('vocab-tutorial-overlay');
        backdrop = document.getElementById('vocab-tutorial-backdrop');
        spotlight = document.getElementById('vocab-tutorial-spotlight');
        tooltip = document.getElementById('vocab-tutorial-tooltip');
        titleEl = document.getElementById('vocab-tutorial-title');
        textEl = document.getElementById('vocab-tutorial-text');
        iconEl = document.getElementById('vocab-tutorial-icon');
        nextBtn = document.getElementById('vocab-tutorial-next');
        skipBtn = document.getElementById('vocab-tutorial-skip');
        dotsContainer = document.getElementById('vocab-tutorial-dots');

        if (nextBtn) nextBtn.addEventListener('click', nextStep);
        if (skipBtn) skipBtn.addEventListener('click', endTutorial);

        // Forward clicks on spotlight area to underlying elements
        if (overlay) {
            overlay.addEventListener('click', handleOverlayClick, { capture: true });
        }
    }

    /**
     * Handle clicks on overlay - forward to spotted element if within spotlight
     */
    function handleOverlayClick(e) {
        if (!isActive || !spotlight || spotlight.style.display === 'none') return;

        // NEVER intercept clicks on the tooltip or its children
        if (tooltip && tooltip.contains(e.target)) {
            return; // Let the click bubble normally to the buttons
        }

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
                if (target.focus) target.focus();
            }

            // Restore overlay
            overlay.style.display = 'block';
        }
    }

    // ============================================
    // TUTORIAL RENDERING
    // ============================================

    /**
     * Start a tutorial by ID
     */
    function startTutorial(tutorialId) {
        const tutorialDef = TUTORIALS[tutorialId];
        if (!tutorialDef) {
            Logger.error(`[VocabTutorial] Unknown tutorial: ${tutorialId}`);
            return;
        }

        // Check if should show
        if (!shouldShow(tutorialId)) {
            Logger.log(`[VocabTutorial] ${tutorialId} already completed, skipping`);
            return;
        }

        Logger.log(`[VocabTutorial] Starting ${tutorialId}...`);

        initElements();

        if (!overlay) {
            Logger.error('[VocabTutorial] Overlay element not found');
            return;
        }

        currentTutorial = tutorialDef;
        currentStep = 0;
        isActive = true;

        // Render progress dots
        renderDots();

        // Show overlay
        overlay.style.display = 'block';
        overlay.classList.add('active');

        // Show first step
        showStep(currentStep);
    }

    /**
     * Render progress dots
     */
    function renderDots() {
        if (!dotsContainer || !currentTutorial) return;
        dotsContainer.innerHTML = '';

        const steps = currentTutorial.steps;
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
            interactiveListener.target.removeEventListener(
                interactiveListener.event,
                interactiveListener.handler,
                interactiveListener.options
            );

            // FIX: Restore original styles if they were modified
            const targetEl = interactiveListener.target;
            targetEl.style.zIndex = '';
            targetEl.style.pointerEvents = '';

            interactiveListener = null;
        }
    }

    /**
     * Show a specific step
     */
    function showStep(index) {
        if (!currentTutorial) return;

        const steps = currentTutorial.steps;

        if (index >= steps.length) {
            endTutorial();
            return;
        }

        const step = steps[index];

        // Skip step if target missing and skipIfMissing is true
        if (step.skipIfMissing && step.target) {
            const targetEl = document.querySelector(step.target);
            if (!targetEl) {
                Logger.log(`[VocabTutorial] Skipping step ${index} - target missing`);
                currentStep++;
                showStep(currentStep);
                return;
            }
        }

        // Clean up previous listener
        cleanupInteractiveListener();

        // Run beforeShow callback if exists
        if (step.beforeShow) {
            const result = step.beforeShow();
            // If beforeShow returns 'skip', auto-advance to next step
            if (result === 'skip') {
                currentStep++;
                showStep(currentStep);
                return;
            }
        }

        // Small delay to let UI settle
        setTimeout(() => {
            // Update content
            if (iconEl) iconEl.textContent = step.icon;
            if (titleEl) titleEl.textContent = step.title;
            if (textEl) textEl.innerHTML = step.text;

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
                            setTimeout(() => nextStep(), 150);
                        };
                        targetEl.addEventListener(step.waitForEvent, handler, { once: true });
                        interactiveListener = { target: targetEl, event: step.waitForEvent, handler };

                        // FIX: Make target clickable ABOVE the tutorial overlay
                        // Overlay z-index is 20000, spotlight is 20001, tooltip is 20002
                        // Target needs to be ABOVE all of them to receive clicks
                        targetEl.style.position = 'relative';
                        targetEl.style.zIndex = '30000';
                        targetEl.style.pointerEvents = 'auto';

                        // Store original styles to restore later
                        interactiveListener.originalStyles = {
                            position: targetEl.style.position,
                            zIndex: targetEl.style.zIndex,
                            pointerEvents: targetEl.style.pointerEvents
                        };
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
                tooltip.style.left = Math.max(16, Math.min(window.innerWidth - 380, rect.left + rect.width / 2 - 180)) + 'px';
                break;
            case 'top':
                tooltip.style.top = (rect.top - gap - 200) + 'px';
                tooltip.style.left = Math.max(16, Math.min(window.innerWidth - 380, rect.left + rect.width / 2 - 180)) + 'px';
                break;
            case 'left':
                tooltip.style.top = Math.max(16, rect.top + rect.height / 2 - 100) + 'px';
                tooltip.style.left = (rect.left - gap - 360) + 'px';
                break;
            case 'right':
                tooltip.style.top = Math.max(16, rect.top + rect.height / 2 - 100) + 'px';
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
        if (!currentTutorial) return;

        const steps = currentTutorial.steps;
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
        if (!currentTutorial) return;

        const tutorialId = currentTutorial.id;

        isActive = false;
        cleanupInteractiveListener();

        // Mark as completed
        markCompleted(tutorialId);

        // Disable replay flag if it was set
        const prefs = getReplayPreferences();
        if (prefs[tutorialId]) {
            setReplayEnabled(tutorialId, false);
        }

        // Hide overlay immediately
        if (overlay) {
            overlay.classList.remove('active');
            overlay.style.display = 'none';
        }

        // Reset spotlight and tooltip to prevent stale state
        if (spotlight) {
            spotlight.style.display = 'none';
            spotlight.classList.remove('pulse');
        }
        if (tooltip) {
            tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right', 'center');
        }

        Logger.log(`[VocabTutorial] Tutorial ${tutorialId} completed!`);

        // Clear current tutorial BEFORE calling callback to allow new tutorials to start
        currentTutorial = null;
        currentStep = 0;

        // Call completion callback
        if (onCompleteCallback) {
            const cb = onCompleteCallback;
            onCompleteCallback = null;
            cb();
        }
    }

    // ============================================
    // PUBLIC API - TUTORIAL STARTERS
    // ============================================

    function startVocabBookIntro(callback) {
        onCompleteCallback = callback;
        startTutorial('vocabBookIntro');
    }

    function startSRSListenTypeTutorial(callback) {
        onCompleteCallback = callback;
        startTutorial('srsListenType');
    }

    function startSRSListenRepeatTutorial(callback) {
        onCompleteCallback = callback;
        startTutorial('srsListenRepeat');
    }

    function startSRSClozeTutorial(callback) {
        onCompleteCallback = callback;
        startTutorial('srsCloze');
    }

    function startWritingChallengeTutorial(callback) {
        onCompleteCallback = callback;
        startTutorial('writingChallenge');
    }

    // ============================================
    // REPLAY TOGGLE UI INITIALIZATION
    // ============================================

    function initReplayToggles() {
        const toggleIds = {
            'tutorial-replay-listen': 'srsListenType',
            'tutorial-replay-speak': 'srsListenRepeat',
            'tutorial-replay-cloze': 'srsCloze',
            'tutorial-replay-writing': 'writingChallenge'
        };

        Object.entries(toggleIds).forEach(([toggleId, tutorialId]) => {
            const toggle = document.getElementById(toggleId);
            if (!toggle) return;

            // Always refresh the checked state — the toggle may have just been
            // re-rendered, and stored preferences can change between renders.
            const prefs = getReplayPreferences();
            toggle.checked = prefs[tutorialId] === true;

            // Bind once per element. This function doubles as the rebind hook for
            // lazily-rendered surfaces (the Vocab Practice tab), so it must be safe
            // to call repeatedly without stacking duplicate change listeners.
            if (toggle.dataset.replayBound === 'true') return;
            toggle.dataset.replayBound = 'true';

            toggle.addEventListener('change', () => {
                setReplayEnabled(tutorialId, toggle.checked);
                Logger.log(`[VocabTutorial] Replay ${tutorialId}: ${toggle.checked}`);
            });
        });
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initElements();
            initReplayToggles();
        });
    } else {
        initElements();
        initReplayToggles();
    }

    // ============================================
    // EXPOSE TO WINDOW
    // ============================================

    window.VocabTutorial = {
        // State management
        hasCompleted,
        shouldShow,
        markCompleted,
        resetTutorial,
        resetAll,

        // Replay preferences
        getReplayPreferences,
        setReplayEnabled,
        // Re-wire the #tutorial-replay-* checkboxes after they are (re)rendered.
        // The Vocab Practice tab renders lazily, so the DOM-ready pass alone would
        // leave the toggles inert. Idempotent — safe to call after every render.
        rebindReplayToggles: initReplayToggles,

        // Tutorial starters
        startVocabBookIntro,
        startSRSListenTypeTutorial,
        startSRSListenRepeatTutorial,
        startSRSClozeTutorial,
        startWritingChallengeTutorial,

        // Generic starter
        start: startTutorial
    };

})();
