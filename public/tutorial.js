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
                text: 'Click here to hear the native pronunciation. Pay attention to the rhythm and intonation!',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#record-btn',
                icon: '🎙️',
                title: 'Step 2: Start Recording',
                text: 'Click <strong>"Start Recording"</strong> and say the sentence clearly. Take a deep breath!',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#record-btn',
                icon: '🛑',
                title: 'Step 3: Stop Recording',
                text: 'Great job! Now click <strong>"Stop Recording"</strong> to finish your take.',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const btn = document.getElementById('record-btn');
                    if (btn && btn.textContent !== "Stop Recording") {
                        btn.click();
                    }
                },
                // Ultra-resilient validation: Always pass on the second click to prevent blockage
                validate: function () {
                    this.failCount = (this.failCount || 0) + 1;
                    const transcriptionText = document.getElementById('transcription-text');
                    const text = transcriptionText ? transcriptionText.textContent.trim() : "";
                    const invalidStates = ["Listening...", "Starting...", "Click 'Start Recording' and speak...", "Please say something to continue...", ""];
                    // Check if text is valid AND not one of the default states
                    const hasSpeech = !invalidStates.includes(text) && text.length > 0;

                    if (hasSpeech) {
                        return true;
                    }

                    // On failure, shake and show warning (controlled by script.js now too)
                    const btn = document.getElementById('record-btn');
                    if (btn) {
                        btn.classList.add('shake-horizontal');
                        setTimeout(() => btn.classList.remove('shake-horizontal'), 500);
                    }

                    // Note: The alert is now handled by script.js to be consistent
                    return false;
                }
            },
            {
                target: '#check-btn-speak',
                icon: '✅',
                title: 'Step 4: Check',
                text: 'Now click <strong>"Check"</strong> to get instant feedback on your pronunciation accuracy.',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '.animation-panel',
                icon: '🛠️',
                title: 'Step 5: Review Corrections',
                text: 'See <strong>How to Fix</strong> your mistakes. We compare your speech with the correct pronunciation to help you improve.',
                position: 'top',
                nextLabel: 'Next →',
                interactive: false,
                beforeShow: () => {
                    const panel = document.querySelector('.animation-panel');
                    const score = document.getElementById('score-speak');
                    if (panel) panel.style.display = 'block';
                    if (score) score.style.display = 'block';
                }
            },
            {
                target: '#pronunciation-practice',
                icon: '🧩',
                title: 'Step 6: Syllable Breakdown',
                text: 'Review the <strong>Syllable Breakdown</strong> to see exactly which parts of the word you nailed and where you can improve.',
                position: 'top',
                nextLabel: 'Next →',
                interactive: false,
                beforeShow: () => {
                    const p = document.getElementById('pronunciation-practice');
                    if (p) {
                        p.style.display = 'block';
                        p.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            },
            {
                target: '#breakdown-mode',
                icon: '✂️',
                title: 'Step 7: Breakdown Mode',
                text: 'Listen to parts of the sentence from the beginning or the end. Great for mastering tricky intonation!',
                position: 'top',
                nextLabel: 'Next →',
                interactive: false,
                beforeShow: () => {
                    const el = document.getElementById('breakdown-mode');
                    if (el) {
                        el.style.display = 'block';
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            },
            {
                target: '#same-vocab-speak',
                icon: '🔄',
                title: 'Step 8: Other Questions',
                text: 'Practice with other sentences that use the same vocabulary to build deeper connections.',
                position: 'top',
                nextLabel: 'Next →',
                interactive: false,
                beforeShow: () => {
                    const el = document.getElementById('same-vocab-speak');
                    if (el) {
                        el.style.display = 'block';
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            },
            {
                target: '#retry-btn-speak',
                icon: '⚡',
                title: 'Step 9: Retry & Improve',
                text: 'Not satisfied? Click <strong>Retry</strong> to try again immediately. Every attempt helps you improve!',
                position: 'top',
                nextLabel: 'Next →',
                interactive: false
            },
            {
                target: null,
                icon: '🪙',
                title: 'Earning Coins',
                text: '<ul style="text-align: left; margin: 0; padding-left: 20px;">' +
                    '<li><strong>+5 Coins</strong>: 1st practice attempt of the day.</li>' +
                    '<li><strong>+5 Coins</strong>: Getting a perfect (100%) score.</li>' +
                    '<li><strong>Bonus!</strong> Earn even more for hitting milestones (3, 6, 9 perfect scores).</li>' +
                    '</ul>',
                position: 'center',
                nextLabel: 'Got It →',
                interactive: false
            },
            {
                target: null,
                icon: '🎉',
                title: 'Tutorial Completed!',
                text: 'You\'re all set to master your pronunciation. Practice daily to build confidence and fluency!',
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

        // Question Difficulty Tutorial for Type Mode
        typeDifficultyFilter: [
            {
                target: null,
                icon: '🎉',
                title: 'Question Difficulty',
                text: 'Use this menu to browse easier or harder questions without changing the engine level.',
                position: 'center',
                nextLabel: 'Show Me How →',
                interactive: false
            },
            {
                target: '#difficulty-filter-btn-type',
                icon: '👆',
                title: 'Step 1: Click the Button',
                text: 'Click this button to open the question difficulty menu.',
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
                text: 'Your question list now reflects the chosen difficulty filter. You can change this anytime!',
                position: 'bottom',
                nextLabel: 'Got It! ✓',
                interactive: false
            }
        ],

        // Question Difficulty Tutorial for Speak Mode
        speakDifficultyFilter: [
            {
                target: null,
                icon: '🎉',
                title: 'Question Difficulty',
                text: 'Use this menu to browse questions by difficulty in Speak mode.',
                position: 'center',
                nextLabel: 'Show Me How →',
                interactive: false
            },
            {
                target: '#difficulty-filter-btn-speak',
                icon: '👆',
                title: 'Step 1: Click the Button',
                text: 'Click this button to open the question difficulty menu.',
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
                title: 'Fill Mode (Extended)',
                text: 'Master your listening by filling in gaps in a full transcript. This mode has two phases: <strong>Reading</strong> and <strong>Listening</strong>.',
                position: 'center',
                nextLabel: 'Show Me! →',
                beforeShow: () => {
                    const tab = document.getElementById('tab-extended');
                    if (tab) tab.click();
                }
            },
            {
                target: '.reading-timer',
                icon: '⏱️',
                title: 'Phase 1: Reading',
                text: 'You have 30 seconds to read the transcript and understand the context before the audio starts.',
                position: 'bottom',
                nextLabel: 'Next →'
            },
            {
                target: '#full-transcript',
                icon: '💡',
                title: 'Clickable Words',
                text: 'Any word in the transcript can be clicked to hear its <strong>pronunciation</strong>. Try it now!',
                position: 'top',
                nextLabel: 'Next →',
                interactive: true
            },
            {
                target: '#skip-reading-btn',
                icon: '⏭️',
                title: 'Skip to Listening',
                text: 'Ready to start? <span class="tutorial-action-text">Click "Skip reading time"</span> to jump straight to the Listening Phase!',
                position: 'top',
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#play-pause-extended-btn',
                icon: '▶️',
                title: 'Step 1: Play Audio',
                text: 'Click <strong>Play</strong> to start the recording. You should listen to the whole sentence first.',
                position: 'top',
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    // Ensure we are in listening phase
                    const lPhase = document.getElementById('listening-phase');
                    if (lPhase && lPhase.style.display === 'none') {
                        const skipBtn = document.getElementById('skip-reading-btn');
                        if (skipBtn) skipBtn.click();
                    }
                }
            },
            {
                target: '.speed-control',
                icon: '🏃',
                title: 'Step 2: Adjust Speed',
                text: 'Too fast? Use the <strong>Speed</strong> menu to slow down the audio (0.5x or 0.75x) to hear tricky parts clearly.',
                position: 'top',
                nextLabel: 'Next →'
            },
            {
                target: '.audio-slider-container',
                icon: '⏪',
                title: 'Step 3: Use Seekbar',
                text: 'Use the <strong>Seekbar</strong> to jump back and replay specific sections as many times as you need.',
                position: 'top',
                nextLabel: 'Next →'
            },
            {
                target: '#gapped-transcript',
                icon: '✍️',
                title: 'Step 4: Fill the Blanks',
                text: 'Type the missing words you hear into these gaps. Use the context to help you!',
                position: 'top',
                nextLabel: 'Next →'
            },
            {
                target: '#check-extended-btn',
                icon: '✅',
                title: 'Step 5: Check',
                text: 'When you\'re finished, click <strong>"Check"</strong> to see your results. Correct words turn green!',
                position: 'top',
                nextLabel: 'Next →'
            },
            {
                target: '#support-mode-btn',
                icon: '💡',
                title: 'Step 6: Show Hints',
                text: 'Stuck? Click <strong>"Show Hints"</strong> to reveal the first letter of each missing word!',
                position: 'top',
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '.phrase-controls',
                icon: '🔄',
                title: 'Try Variations',
                text: 'Once you finish, you can often click <strong>"Try New Blanks"</strong> to practice different parts of the same transcript!',
                position: 'top',
                nextLabel: 'Start Practicing! ✓'
            }
        ],
        watch: [
            {
                target: null,
                icon: '📺',
                title: 'Watch Mode',
                text: 'Welcome to <strong>Watch Mode</strong>! Here you can practice your listening comprehension with real video clips.',
                position: 'center',
                nextLabel: 'Let\'s Go! →',
                interactive: false,
                beforeShow: () => {
                    const tab = document.getElementById('tab-watch');
                    if (tab) tab.click();

                    // Reset to list view if needed
                    if (window.WatchMode && window.WatchMode.showVideoList) {
                        window.WatchMode.showVideoList();
                    }
                }
            },
            {
                target: '#watch-video-grid',
                icon: '🎬',
                title: 'Step 1: Select a Video',
                text: 'Choose a video from the library. We\'ll select the first one for you to demonstrate.',
                position: 'top',
                nextLabel: 'Select Video →',
                interactive: false, // We'll auto-select for them in the next step
            },
            {
                target: '#watch-play-btn',
                icon: '▶️',
                title: 'Step 2: Start Video',
                text: 'Click <strong>Play</strong> to start the video lesson.',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    // Simulate selecting the first video if needed
                    const firstCard = document.querySelector('.watch-video-card');
                    if (firstCard && !document.querySelector('#watch-player-view').offsetParent) {
                        firstCard.click();
                    } else if (window.WatchMode && window.WatchMode.selectVideo && !document.querySelector('#watch-player-view').offsetParent) {
                        window.WatchMode.selectVideo('video-0');
                    }
                }
            },
            {
                target: '#watch-player-wrapper',
                icon: '👀',
                title: 'Step 3: Watching',
                text: 'Watch carefully! The video will pause when a question appears.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'watch-question-triggered'
            },
            {
                target: '#watch-question-panel',
                icon: '❓',
                title: 'Step 4: Pop-up Questions',
                text: 'Look! A question appeared. This happens automatically when you reach a key moment in the video.',
                position: 'left',
                nextLabel: 'How to Answer →',
                beforeShow: () => {
                    // Question triggered by event
                }
            },
            {
                target: '#watch-mc-options',
                icon: '👆',
                title: 'Step 5: Answer the Question',
                text: 'Click on one of the options below to answer the question.',
                position: 'left',
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    // Ensuring question is still there (redundant but safe)
                    const panel = document.getElementById('watch-question-panel');
                    if (panel && panel.style.display === 'none') {
                        if (window.WatchMode && window.WatchMode.triggerTutorialQuestion) {
                            window.WatchMode.triggerTutorialQuestion({
                                id: 'tutorial-q1',
                                questionText: 'What falls from the sky during a storm?',
                                questionType: 'multiple_choice',
                                options: ['Rain', 'Cats', 'Pianos'],
                                correctAnswer: 0,
                                allowSkip: false
                            });
                        }
                    }
                }
            },
            {
                target: '#watch-submit-answer',
                icon: '✅',
                title: 'Step 6: Submit',
                text: 'Click <strong>Submit</strong> to check your answer.',
                position: 'left',
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#watch-feedback',
                icon: '🎉',
                title: 'Step 7: Instant Feedback',
                text: 'Great job! You\'ll see immediately if you got it right. You earn points for every correct answer!',
                position: 'left',
                nextLabel: 'Next →',
                interactive: false
            },
            {
                target: '#watch-continue-btn',
                icon: '⏯️',
                title: 'Step 8: Continue',
                text: 'Click <strong>Continue Video</strong> to resume watching the clip.',
                position: 'left',
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: null,
                icon: '🏆',
                title: 'You\'re Ready!',
                text: 'Watch videos, answer questions, and improve your listening skills. Have fun!',
                position: 'center',
                nextLabel: 'Finish Tutorial',
                interactive: false
            }
        ],
        notes: [
            {
                target: null,
                icon: '📓',
                title: 'Note Mode',
                text: 'Practice taking notes while listening — a crucial real-world skill! We\'ll guide you through the process.',
                position: 'center',
                nextLabel: 'Show Me! →',
                interactive: false,
                beforeShow: () => {
                    const tab = document.getElementById('tab-notes');
                    if (tab) tab.click();
                }
            },
            {
                target: '#question-select-notes',
                icon: '🔢',
                title: 'Step 1: Select Question 1',
                text: 'We\'ve selected <strong>Question 1</strong> for you to start with. Click Next to continue.',
                position: 'bottom',
                nextLabel: 'Next →',
                interactive: true,
                beforeShow: () => {
                    const select = document.getElementById('question-select-notes');
                    if (select) {
                        select.value = '0'; // Logic index for Question 1
                        select.dispatchEvent(new Event('change'));
                    }
                }
            },
            {
                target: '#play-notes-btn',
                icon: '▶️',
                title: 'Step 2: Start Practice',
                text: 'Click <strong>Start</strong> to begin the session. If there\'s a guiding video, it will play first.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#notes-step-video',
                icon: '📺',
                title: 'Step 3: Watch Video',
                text: 'If available, watch the video to get the main ideas. You can <strong>skip</strong> if you prefer to just listen.',
                position: 'bottom',
                nextLabel: 'Next →',
                interactive: false,
                beforeShow: () => {
                    // Check if video step is visible, if not (audio only), SKIP this step
                    const videoStep = document.getElementById('notes-step-video');
                    if (!videoStep || videoStep.style.display === 'none') {
                        return 'skip'; // Auto-advance to next step
                    }
                }
            },
            {
                target: '#notes-skip-video-btn',
                icon: '⏭️',
                title: 'Skip Video',
                text: 'Click <strong>Skip Guiding Video</strong> when you\'re ready to take notes.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                beforeShow: () => {
                    const videoStep = document.getElementById('notes-step-video');
                    if (!videoStep || videoStep.style.display === 'none') {
                        return 'skip';
                    }
                }
            },
            {
                target: '#notes-audio',
                icon: '🔊',
                title: 'Step 4: Listen',
                text: 'Listen to the audio carefully. You can pause and replay as often as needed.',
                position: 'bottom',
                nextLabel: 'Next →',
                interactive: true,
                beforeShow: () => {
                    // Ensure we are on the audio step
                    const audioStep = document.getElementById('notes-step-audio');
                    if (audioStep && audioStep.style.display === 'none') {
                        // This might happen if they manually skipped video before previous step? 
                        // But logic should handle it.
                    }
                }
            },
            {
                target: '#notes-user-input',
                icon: '✍️',
                title: 'Step 5: Take Notes',
                text: 'Type what you hear or a summary of the key points here.',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'input',
                validate: (e) => {
                    return e.target.value.length > 3;
                }
            },
            {
                target: '#notes-submit-btn',
                icon: '✅',
                title: 'Step 6: Submit',
                text: 'When you\'re done, click <strong>Submit Answers</strong> to check your work.',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#notes-step-results',
                icon: '📊',
                title: 'Step 7: Feedback',
                text: 'Review the transcript. Words found in your notes are <span style="background:#dcfce7; padding:0 2px;">highlighted</span>. Great work!',
                position: 'left',
                nextLabel: 'Finish Tutorial ✓',
                interactive: false
            }
        ],
        pronounce: [
            {
                target: null,
                icon: '🗣️',
                title: 'Pronounce Mode',
                text: 'Master your pronunciation with real-time feedback on stress, pitch, and rhythm!',
                position: 'center',
                nextLabel: 'Start Tutorial →',
                beforeShow: () => {
                    const tab = document.getElementById('tab-pronounce');
                    if (tab) tab.click();
                }
            },
            {
                target: '.pa-word-input-container > div',
                icon: '⌨️',
                title: 'Step 1: Choose & Search',
                text: 'Type a word like <strong>"photograph"</strong>, then click <strong>Search</strong> to analyze it.',
                position: 'bottom',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click',
                validate: (e) => !!e.target.closest('#pa-search-btn')
            },
            {
                target: '#pa-native-audio-container',
                icon: '👂',
                title: 'Step 2: Listen',
                text: 'Click the <strong>Play</strong> button to hear the native speaker. Listen to the <em>stress</em> and <em>rhythm</em>.',
                position: 'top',
                nextLabel: 'I\'m Ready →',
                interactive: true,
                waitTimeout: 5000, // Wait longer for search results
                beforeShow: () => {
                    // Fail-safe: If audio container is still hidden (e.g. backend error), show it manually for tutorial
                    const container = document.getElementById('pa-native-audio-container');
                    if (container && container.offsetParent === null) {
                        container.style.display = 'flex';
                        // Optional: Add a visual cue that it's in tutorial/mock mode?
                        container.setAttribute('data-tutorial-forced', 'true');
                    }
                }
            },
            {
                target: '#pa-record-btn',
                icon: '🎙️',
                title: 'Step 3: Record',
                text: 'Click <strong>Record</strong> and say the word clearly. Mimic the native speaker!',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#pa-stop-btn',
                icon: '⏹️',
                title: 'Step 4: Stop',
                text: 'Click <strong>Stop</strong> when you are done speaking to see your results.',
                position: 'top',
                nextLabel: null,
                interactive: true,
                waitForEvent: 'click'
            },
            {
                target: '#pa-results-summary',
                icon: '📊',
                title: 'Step 5: Analysis',
                text: 'Check your score! We analyze your <strong>Pitch</strong>, <strong>Duration</strong>, and <strong>Loudness</strong> compared to the native speaker.',
                position: 'top',
                nextLabel: 'Next →',
                interactive: false
            },
            {
                target: '.pa-charts-grid',
                icon: '📈',
                title: 'Step 6: Visual Feedback',
                text: 'The <strong>Green line</strong> is the native pitch. The <strong>Blue line</strong> is yours. Try to match the shape!',
                position: 'top',
                nextLabel: 'Got it! →',
                interactive: false
            },
            {
                target: '#syllable-verifier-container',
                icon: '🔍',
                title: 'Step 7: Syllables',
                text: 'Click on individual syllable boxes here to hear exactly how you sounded vs. the native speaker.',
                position: 'top',
                nextLabel: 'Finish Tutorial ✓',
                interactive: false
            }
        ],
        'read-aloud': [
            {
                target: null,
                icon: '📖',
                title: 'Read Aloud Mode',
                text: 'Read a short prompt aloud and compare what the browser hears against the original text.',
                position: 'center',
                nextLabel: 'Show Me →',
                beforeShow: () => {
                    const tab = document.getElementById('tab-read-aloud');
                    if (tab) tab.click();
                }
            },
            {
                target: '.ra-prompt-box',
                icon: '📝',
                title: 'Read The Prompt',
                text: 'Use the prompt box to preview the sentence before you begin recording.',
                position: 'bottom'
            },
            {
                target: '#ra-prompt-guides-group',
                icon: '🔗',
                title: 'Use Prompt Guides',
                text: 'Use <strong>Chunking</strong> to preview pause groups and the <strong>connected speech</strong> levels to preview how fluent speech links or reduces words. Level 1 is linking only, and level 2 adds reduced words. Both guides are optional and can be enabled together.',
                position: 'bottom'
            },
            {
                target: '.ra-status-bar',
                icon: '⏱️',
                title: 'Prep And Record',
                text: 'Watch the prep and record timers so you know when to start and when the attempt ends.',
                position: 'bottom'
            },
            {
                target: '#ra-read-aloud-controls',
                icon: '🎙️',
                title: 'Control The Attempt',
                text: 'Use Skip for a new prompt and the action button to begin, finish, or move to the next prompt.',
                position: 'top',
                nextLabel: 'Finish Tutorial ✓'
            }
        ],
        rfib: [
            {
                target: null,
                icon: '📖',
                title: 'Dropdown Mode',
                text: 'Read the passage and select the correct option from each dropdown to fill in the blanks.',
                position: 'center',
                nextLabel: 'Show Me →',
                beforeShow: () => {
                    const tab = document.getElementById('tab-rfib');
                    if (tab) tab.click();
                }
            },
            {
                target: '.rfib-passage-card',
                icon: '📝',
                title: 'Fill in the Blanks',
                text: 'Click on a blank to see the options and choose the one that fits best.',
                position: 'bottom'
            },
            {
                target: '.rfib-support-toggle-row',
                icon: '🛟',
                title: 'Support Versions',
                text: 'Stuck? Switch to <strong>Beginner</strong> or <strong>Intermediate</strong> support to get contextual hints, simplified text, or dedicated audio help.',
                position: 'top'
            },
            {
                target: '.rfib-audio-card',
                icon: '🔊',
                title: 'Listen to the Passage',
                text: 'You can listen to the original passage audio here, or switch between male and female voices.',
                position: 'bottom'
            },
            {
                target: '.rfib-actions',
                icon: '✅',
                title: 'Check Your Answers',
                text: 'Click <strong>Check</strong> when you are done to see how you did. You can then <strong>Retry</strong> any missed blanks.',
                position: 'top',
                nextLabel: 'Finish Tutorial ✓'
            }
        ],
        survival: [
            {
                target: null,
                icon: 'S',
                title: 'Survival Mode',
                text: `
                    <div class="tutorial-media">
                        <img class="tutorial-media-img" src="assets/survival-tutorial/survival-intro.svg" alt="Survival mode overview">
                    </div>
                    <strong>Type to survive.</strong> Enemies approach with words. Finish a word to fire your weapons.
                    <div class="tutorial-subtle">New enemy types unlock gradually, with quick popups the first time you meet them.</div>
                `,
                position: 'center',
                nextLabel: 'How It Works \u2192',
                interactive: false
            },
            {
                target: null,
                icon: 'K',
                title: 'Controls',
                text: `
                    <div class="tutorial-media">
                        <img class="tutorial-media-img" src="assets/survival-tutorial/survival-controls.svg" alt="Survival controls">
                    </div>
                    <div class="tutorial-checklist">
                        <div class="checklist-item done"><span class="checklist-icon">\u2705</span><span>Type letters to lock onto a target</span></div>
                        <div class="checklist-item done"><span class="checklist-icon">\u2705</span><span><strong>Backspace</strong> clears your lock</span></div>
                        <div class="checklist-item done"><span class="checklist-icon">\u2705</span><span><strong>Ctrl</strong> opens Level Up (and rerolls in the menu)</span></div>
                    </div>
                `,
                position: 'center',
                nextLabel: 'Powerups \u2192',
                interactive: false
            },
            {
                target: null,
                icon: '+',
                title: 'Powerups & Loot',
                text: `
                    <div class="tutorial-media">
                        <img class="tutorial-media-img" src="assets/survival-tutorial/survival-items.svg" alt="Survival powerups">
                    </div>
                    Powerups drop during the run. Type the pickup word to collect it.
                    <div class="tutorial-subtle">Tip: Loot caches pause the action and let you pick an augment.</div>
                `,
                position: 'center',
                nextLabel: 'Enemies \u2192',
                interactive: false
            },
            {
                target: null,
                icon: 'E',
                title: 'Enemies',
                text: ` 
                    Each enemy has a different behavior. You\u2019ll get a short popup the first time a new enemy type (or major trait) appears. 
                    <div class="tutorial-media-grid"> 
                        <img class="tutorial-media-thumb" src="assets/survival-tutorial/enemy-drone.svg" alt="Drone enemy"> 
                        <img class="tutorial-media-thumb" src="assets/survival-tutorial/enemy-rusher.svg" alt="Rusher enemy"> 
                        <img class="tutorial-media-thumb" src="assets/survival-tutorial/enemy-turret.svg" alt="Turret enemy"> 
                        <img class="tutorial-media-thumb" src="assets/survival-tutorial/enemy-tank.svg" alt="Tank enemy"> 
                        <img class="tutorial-media-thumb" src="assets/survival-tutorial/enemy-splitter.svg" alt="Splitter enemy"> 
                        <img class="tutorial-media-thumb" src="assets/survival-tutorial/enemy-shielded.svg" alt="Shielded enemy"> 
                    </div> 
                    Ready? Good luck. 
                `,
                position: 'center',
                nextLabel: 'Start \u2713',
                interactive: false
            }
        ],
        shopUnlock: [
            {
                target: '#panel-shopping-card',
                icon: '🛒',
                title: 'Practice Unlocks Features',
                text: 'Keep practicing and features will unlock automatically as you progress.',
                position: 'left',
                nextLabel: 'Open Roadmap',
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
        if (mode === 'read-aloud') return {
            complete: 'readAloudTutorialCompleted',
            replay: 'readAloudTutorialReplay'
        };
        if (mode === 'rfib') return {
            complete: 'rfibTutorialCompleted',
            replay: 'rfibTutorialReplay'
        };
        if (mode === 'survival') return {
            complete: 'survivalTutorialCompleted',
            replay: 'survivalTutorialReplay'
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

    // Auto-start gating (prevents tutorial overlay from covering auth/entry flows on mobile)
    let pendingAutoStart = null;
    let pendingAutoStartIntervalId = null;

    function clearPendingAutoStart() {
        pendingAutoStart = null;
        if (pendingAutoStartIntervalId) {
            clearInterval(pendingAutoStartIntervalId);
            pendingAutoStartIntervalId = null;
        }
    }

    function isElementVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const opacity = Number.parseFloat(style.opacity || '1');
        if (!Number.isNaN(opacity) && opacity <= 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function isGuestModeChosen() {
        try {
            if (sessionStorage.getItem('guestMode') === 'true') return true;
        } catch (_) {
            // Ignore storage access failures.
        }
        try {
            return !!(window.authUI && typeof window.authUI.isGuestMode === 'function' && window.authUI.isGuestMode());
        } catch (_) {
            return false;
        }
    }

    function isLoggedIn() {
        try {
            const userId = window.authUI?.getCurrentUserId?.();
            if (userId) return true;
        } catch (_) {
            // Ignore auth UI failures.
        }
        try {
            const user = window.authFunctions?.getCurrentUser?.();
            return !!user;
        } catch (_) {
            return false;
        }
    }

    function hasBlockingOverlayOpen() {
        // App preloader (covers screen while data loads)
        if (isElementVisible(document.getElementById('app-preloader'))) return true;

        // Entry/auth flows
        if (isElementVisible(document.getElementById('auth-overlay'))) return true;
        const entryModals = document.querySelectorAll('.entry-modal');
        for (const modal of entryModals) {
            if (isElementVisible(modal)) return true;
        }

        return false;
    }

    function shouldDelayAutoStart(mode) {
        if (mode === 'survival') return false; // Survival launch flow expects immediate tutorial start.
        if (hasBlockingOverlayOpen()) return true;

        // If the user hasn't chosen Guest or logged in yet, wait until they do.
        if (!isGuestModeChosen() && !isLoggedIn()) return true;

        return false;
    }

    function queueAutoStart(mode) {
        if (pendingAutoStart && pendingAutoStart.mode === mode) return;

        pendingAutoStart = { mode, queuedAt: Date.now() };

        if (pendingAutoStartIntervalId) {
            clearInterval(pendingAutoStartIntervalId);
        }

        pendingAutoStartIntervalId = setInterval(() => {
            if (!pendingAutoStart) {
                clearPendingAutoStart();
                return;
            }
            if (window.isTutorialActive || isActive) {
                clearPendingAutoStart();
                return;
            }

            if (!shouldDelayAutoStart(pendingAutoStart.mode)) {
                const modeToStart = pendingAutoStart.mode;
                clearPendingAutoStart();
                startTutorial(modeToStart, false);
            }
        }, 250);
    }

    /**
     * Start the tutorial for a specific mode
     */
    function startTutorial(mode = 'type', force = false) {
        if (force) clearPendingAutoStart();
        if (!force && !shouldShowTutorial(mode)) {
            return;
        }

        if (!force && shouldDelayAutoStart(mode)) {
            queueAutoStart(mode);
            return;
        }

        clearPendingAutoStart();
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
        if (step.beforeShow) {
            const result = step.beforeShow();
            if (result === 'skip') {
                showStep(index + 1);
                return;
            }
        }

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
                // Robust wait for element with custom timeout if specified
                const targetEl = await waitForTarget(step.target, step.waitTimeout || 500);

                if (targetEl) {
                    // Ensure target is fully visible (auto for instant stability)
                    targetEl.scrollIntoView({ behavior: 'auto', block: 'center' });

                    // Wait for scroll to apply before positioning
                    requestAnimationFrame(() => {
                        // Show element for measurement but keep it invisible
                        tooltip.style.display = 'block';
                        tooltip.style.opacity = '0';
                        tooltip.style.transition = 'none'; // Disable transition during positioning

                        // Prepare spotlight (hidden initially for instant move)
                        spotlight.style.display = 'block';
                        spotlight.style.opacity = '0'; // Start hidden
                        spotlight.classList.add('pulse');
                        backdrop.style.display = 'none';

                        // Start continuous loop to handle animations/layout shifts
                        startSpotlightLoop(targetEl, step.position);

                        // Set up interactive listener
                        if (step.interactive) {
                            // Make target clickable through spotlight
                            targetEl.style.position = 'relative';
                            targetEl.style.zIndex = '10002'; // above spotlight (10001)

                            if (step.waitForEvent) {
                                // Specific event listening
                                const handler = (e) => {
                                    // Optional real-time feedback
                                    if (step.onInput && e.type === 'input') {
                                        step.onInput(e);
                                    }

                                    // Optional validation
                                    if (step.validate && !step.validate.call(step, e)) {
                                        return;
                                    }

                                    // Avoid double-firing
                                    if (nextStepTimer) return;

                                    // Small delay to let the event complete its normal action
                                    nextStepTimer = setTimeout(() => {
                                        nextStepTimer = null;
                                        nextStep();
                                    }, 100);
                                };

                                // For 'input' or steps with validation, we use {once: false} 
                                const useOnce = !(step.waitForEvent === 'input' || step.validate);
                                const options = { once: useOnce };

                                targetEl.addEventListener(step.waitForEvent, handler, options);

                                interactiveListener = {
                                    target: targetEl,
                                    event: step.waitForEvent,
                                    handler: handler,
                                    options: options
                                };
                            }
                        }

                        // Auto-advance feature (timer)
                        if (step.autoAdvance) {
                            if (nextStepTimer) clearTimeout(nextStepTimer);
                            nextStepTimer = setTimeout(() => {
                                nextStepTimer = null;
                                nextStep();
                            }, step.autoAdvance);
                        }

                        // Show elements
                        // Delay fade-in to allow scroll and positioning loop to stabilize
                        setTimeout(() => {
                            tooltip.style.transition = 'opacity 0.25s ease-out';
                            tooltip.style.opacity = '1';

                            // Fade in spotlight
                            spotlight.style.opacity = '1';
                        }, 150);
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
            width: (window.visualViewport && window.visualViewport.width) || document.documentElement.clientWidth || window.innerWidth,
            height: (window.visualViewport && window.visualViewport.height) || document.documentElement.clientHeight || window.innerHeight
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

        try {
            window.dispatchEvent(new CustomEvent('tutorial:end', { detail: { mode: currentMode } }));
        } catch (_) {
            // Ignore event dispatch failures.
        }
    }

    /**
     * Reset tutorial for a mode (for testing)
     */
    function resetTutorial(mode = 'type') {
        const { complete, replay } = getKeys(mode);
        localStorage.removeItem(complete);
        localStorage.removeItem(replay);
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
     * Compatibility stub for retired shop nudges.
     */
    window.checkShopUnlockCondition = function () {
        return;
    };

    // Initialize settings on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSettings);
    } else {
        initSettings();
    }

})();
