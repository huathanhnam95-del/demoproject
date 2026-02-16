/**
 * Spaced Repetition System (SRS) Module
 * Implements SM-2 and FSRS algorithms for optimal vocabulary review scheduling
 * Uses modular Firebase v9+ API
 */

import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment,
    collection,
    addDoc,
    serverTimestamp,
    getDocs,
    query,
    where,
    writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

// Import new SRS Scheduler
import { SRSScheduler, ALGORITHM, CARD_STATE, RATING } from './srs-scheduler.js';
import { WritingChallenge } from './js/writing-challenge.js';
import { CollocationRater } from './js/collocation-rater.js';

const SRSReview = (function () {
    'use strict';

    const log = Logger.create('SRS');

    // Prevent double initialization
    if (window.__SRS_INITIALIZED__) return;
    window.__SRS_INITIALIZED__ = true;
    log.debug('Module Initialized');

    // Firebase references
    let db = null;
    let currentUserId = null;

    // Current Algorithm Preference (SM2 or FSRS)
    let currentAlgorithm = 'SM2'; // Default, loaded from SRSOnboarding

    // SRS Data Cache
    let srsCache = {
        srsData: {},        // Per-word SRS tracking
        reviewStats: {
            totalReviews: 0,
            dailyReviews: 0,
            streak: 0,
            lastReviewDate: null,
            xp: 0,
            masteredCount: 0,
            sessionsCompleted: 0
        }
    };

    // Current review session
    let reviewSession = {
        active: false,
        wordsToReview: [],
        currentIndex: 0,
        sessionResults: []
    };

    // Definition Cache
    const definitionCache = new Map();
    const DEF_CACHE_KEY = 'srs_definition_cache';

    // Difficulty & Performance State
    let srsPerformanceTracker = null;
    let currentDifficultySettings = null;

    // Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;
    let currentTranscription = "";

    // Pronunciation practice recognition instance (reused to prevent abort errors)
    // Pronunciation practice recognition instance (reused to prevent abort errors)
    let pronunciationRecognition = null;

    // Writing Challenge Module Instance
    let writingChallenge = null;

    // Helper: Levenshtein Distance for Typo Tolerance
    function getLevenshteinDistance(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }
    let pendingSave = null;
    const LOCAL_STORAGE_KEY = 'srs_pending_data';

    // Save debouncing
    let saveTimeout = null;
    let lastSavedSRState = null;

    // Collocations data cache
    let collocationsData = null;

    // DOM Elements
    let elements = {};

    // Constants
    const SM2_DEFAULT_EASE = 2.5;
    const SM2_MIN_EASE = 1.3;
    const POINTS_PER_REVIEW = 2;
    const POINTS_DAILY_COMPLETE = 10;
    const POINTS_WEEKLY_STREAK = 25;
    const POINTS_WORD_MASTERED = 15;
    const MASTERY_THRESHOLD = 10; // Reviews needed to master a word

    /**
     * Show custom alert modal
     */
    function showCustomAlert(message) {
        const modal = document.getElementById('vocab-alert-modal');
        const msgEl = document.getElementById('vocab-alert-message');
        const btn = document.getElementById('vocab-alert-ok');

        if (modal && msgEl && btn) {
            msgEl.textContent = message;
            modal.style.display = 'flex';

            // Remove old listener to avoid multiple fires if reusing
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.onclick = () => {
                modal.style.display = 'none';
            };

            // Close on outside click
            modal.onclick = (e) => {
                if (e.target === modal) modal.style.display = 'none';
            };
        } else {
            log.warn('Custom alert modal missing, using native');
            alert(message);
        }
    }

    /**
     * Initialize the SRS module
     */
    function init() {
        cacheElements();
        setupEventListeners();
        loadCollocationsData(); // Load collocations for Writing Challenge
        loadPendingData();      // Load any unsaved local data
        loadDefinitionCache();  // Load persistent definitions

        // Initialize Writing Challenge Module
        writingChallenge = new WritingChallenge({
            elements: elements,
            log: log,
            generateWritingPrompt: generateWritingPrompt, // Use existing function
            assessSentence: assessSentence,
            // NEW: Cloud Function for Advanced AI Check
            assessWriting: async (text, context) => {
                const functions = getFunctions();
                const assessFn = httpsCallable(functions, 'assessWriting');
                try {
                    const targetWord = context?.lemma || context?.originalWord || context?.word || '';
                    const safeContext = {
                        word: targetWord,
                        lemma: context?.lemma || context?.originalWord || '',
                        partOfSpeech: context?.partOfSpeech || context?.pos || ''
                    };
                    const result = await assessFn({ text, context: safeContext });
                    return result.data;
                } catch (e) {
                    console.error('Cloud Function Call Failed:', e);
                    throw e;
                }
            },
            // writing-challenge.js calls saveUserSentence(wordId, lemma, sentence, feedback)
            // but the underlying persistence function is saveUserSentence(uid, word, sentence, feedback).
            saveUserSentence: (wordId, word, sentence, feedback) => saveUserSentence(currentUserId, word, sentence, feedback),
            applyAIScoreToSRS: applyAIScoreToSRS,
            saveDraft: saveDraft,
            loadDraft: loadDraft,
            clearDraft: clearDraft,
            getCollocations: getCollocations,
            triggerConfetti: triggerConfetti
        });

        // Load algorithm preference from SRSOnboarding
        if (window.SRSOnboarding) {
            currentAlgorithm = window.SRSOnboarding.getPreferredAlgorithm();
            log.debug('Algorithm preference loaded:', currentAlgorithm);
        }

        // Initial dashboard update (will update again when data loads)
        updateDashboardSummary();

        // Listen for online status to retry saves
        window.addEventListener('online', () => {
            log.debug('Back online, syncing pending changes...');
            debouncedSave();
        });

        // Periodic Cleanup
        setTimeout(cleanupDrafts, 5000); // Run 5s after load to not block init

        // FIX 1: Robust Z-Index and Body append
        if (elements.srsWritingModal) {
            // Ensure Writing Challenge is at the absolute top of the stacking context
            document.body.appendChild(elements.srsWritingModal);
            elements.srsWritingModal.style.setProperty('z-index', '99999', 'important');
        }

        log.debug('Module initialized');

        // Add lifecycle listeners to flush pending saves
        window.addEventListener('beforeunload', flushSRSSave);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushSRSSave();
        });

        // AuthUI Integration (Phase 3)
        // Subscribe to auth state changes if AuthUI is available
        if (window.authUI && typeof window.authUI.onAuthStateChange === 'function') {
            window.authUI.onAuthStateChange((userId) => {
                log.debug('Auth state changed via AuthUI:', userId);
                // Attempt to get firestore instance
                const firestore = db || getFirestore();
                setUser(userId, firestore);
            });
        }
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        elements = {
            // Main panel
            srsPanel: document.getElementById('srs-review-panel'),
            srsOverlay: document.getElementById('srs-overlay'),

            // Header stats
            srsDueCount: document.getElementById('srs-due-count'),
            srsStreak: document.getElementById('srs-streak'),
            srsLevelBadge: document.getElementById('srs-level-badge'), // NEW
            srsXpBar: document.getElementById('srs-xp-bar'), // NEW

            // Flashcard
            flashcard: document.getElementById('srs-flashcard'),
            flashcardFront: document.getElementById('srs-flashcard-front'),
            flashcardBack: document.getElementById('srs-flashcard-back'),
            srsWord: document.getElementById('srs-word'),
            srsWordFront: document.getElementById('srs-word-front'), // NEW - word on front face
            srsPhonetic: document.getElementById('srs-phonetic'),
            srsPhoneticBack: document.getElementById('srs-phonetic-back'), // NEW
            srsAudioBtn: document.getElementById('srs-audio-btn'),
            srsAudioBtnBack: document.getElementById('srs-audio-btn-back'), // NEW
            srsVietnamese: document.getElementById('srs-vietnamese'), // Vietnamese translation
            srsDefinition: document.getElementById('srs-definition'),
            srsExample: document.getElementById('srs-example'),

            // New Mode Elements
            srsFrontContentPhonetic: document.getElementById('srs-front-content-phonetic'),
            srsFrontContentDefinition: document.getElementById('srs-front-content-definition'),
            srsDefinitionPrompt: document.getElementById('srs-definition-prompt'),
            srsRecordBtn: document.getElementById('srs-record-btn'),
            srsInputContainer: document.getElementById('srs-input-container'),
            srsInput: document.getElementById('srs-input'),
            srsResultContainer: document.getElementById('srs-result-container'),
            srsResultMessage: document.getElementById('srs-result-message'),
            srsUserInputDisplay: document.getElementById('srs-user-input-display'),

            // Pronunciation Practice
            srsPracticePronunciationBtn: document.getElementById('srs-practice-pronunciation-btn'),
            srsPronunciationResult: document.getElementById('srs-pronunciation-result'),
            srsPronunciationFeedback: document.getElementById('srs-pronunciation-feedback'),

            // Controls
            srsControls: document.querySelector('.srs-controls'),
            skipBtn: document.getElementById('srs-skip-btn'),
            qualityBtns: document.getElementById('srs-quality-btns'),

            // Progress
            srsProgressText: document.getElementById('srs-progress-text'),
            srsProgressFill: document.getElementById('srs-progress-fill'),

            // Buttons
            startReviewBtn: document.getElementById('srs-start-review-btn'),
            closeBtn: document.getElementById('srs-close-btn'),

            // Summary
            srsSummary: document.getElementById('srs-summary'),
            summaryStats: document.getElementById('srs-summary-stats'),

            // Writing Challenge
            srsWritingModal: document.getElementById('srs-writing-modal'),
            srsWritingPrompt: document.getElementById('srs-writing-prompt'),
            srsWritingInput: document.getElementById('srs-writing-input'),
            skipAiToggle: document.getElementById('srs-skip-ai-toggle'), // NEW
            srsWritingFeedback: document.getElementById('srs-writing-feedback'),
            srsWritingSubmit: document.getElementById('srs-writing-submit'),
            srsWritingSkip: document.getElementById('srs-writing-skip'),
            srsWritingCloseBtn: document.getElementById('srs-writing-close-btn'),
            showAnswerBtn: document.getElementById('srs-show-answer-btn'), // FIX: Added missing reference

            // Hint elements
            hintDefValue: document.getElementById('hint-definition-value') || document.getElementById('hint-def-value'),
            hintExampleValue: document.getElementById('hint-example-value'),
            hintCollocationsValue: document.getElementById('hint-collocations-value'),
            hintStarterValue: document.getElementById('hint-starter-value'),

            // More Help! Scaffolding
            moreHelpBtn: document.getElementById('more-help-btn'),
            scaffoldingPanel: document.getElementById('scaffolding-panel'),
            exampleSentencesList: document.getElementById('example-sentences-list'),
            scaffoldingExtras: document.getElementById('scaffolding-extras-container'),
            // exampleSentencesList duplicated (legacy) - keep single reference above

            // Settings
            srsSettingsModal: document.getElementById('srs-settings-modal'),
            srsSettingsBtn: document.getElementById('srs-settings-btn'),
            srsSettingsClose: document.getElementById('srs-settings-close'),
            saveSettingsBtn: document.getElementById('save-settings-btn'),
            retentionChart: document.getElementById('retention-chart')
        };
    }

    /**
    * Trigger Confetti Reward
    */
    function triggerConfetti() {
        if (window.confetti) {
            window.confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b']
            });
        }
    }

    /**
     * Show Writing Challenge Toast Notification
     */
    function showWritingChallengeToast() {
        // Remove any existing toast
        const existingToast = document.querySelector('.srs-writing-toast');
        if (existingToast) existingToast.remove();

        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'srs-writing-toast';
        toast.innerHTML = '<span class="toast-icon">✍️</span><span>Writing Challenge!</span>';
        document.body.appendChild(toast);

        // Trigger animation (slight delay for DOM insertion)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
        });

        // Auto-hide after 2.5 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 2500);
    }

    /**
     * Calculate Level and Progress from XP
     * Level = floor(XP / 100) + 1
     */
    function calculateLevel(xp) {
        const level = Math.floor(xp / 100) + 1;
        const progress = xp % 100;
        return { level, progress };
    }

    /**
     * Update Gamification UI
     */
    function updateGamificationUI() {
        const points = srsCache.totalPoints || 0;
        const { level, progress } = calculateLevel(points);

        if (elements.srsLevelBadge) {
            elements.srsLevelBadge.textContent = `Lvl ${level}`;
            // Animate on level up
            if (srsCache.lastLevel && level > srsCache.lastLevel) {
                elements.srsLevelBadge.classList.add('level-up-anim');
                setTimeout(() => elements.srsLevelBadge.classList.remove('level-up-anim'), 1000);
                // Confetti effect (simple visual cue for now)
                showCustomAlert(`🎉 Level Up! You are now Level ${level}!`);
            }
            srsCache.lastLevel = level;
        }

        if (elements.srsXpBar) {
            elements.srsXpBar.style.width = `${progress}%`;
        }
    }

    /**
     * Update Dashboard Summary (Next Review Info)
     */
    function updateDashboardSummary() {
        const summaryEl = document.getElementById('dashboard-srs-summary');
        const textEl = document.getElementById('dashboard-srs-text');

        // Check for immediate due words
        const dueWords = getWordsDueForReview();
        const hasWords = Object.keys(srsCache.srsData).length > 0;

        if (!hasWords) {
            summaryEl.style.display = 'none';
            return;
        }

        if (dueWords.length > 0) {
            summaryEl.style.display = 'flex';
            summaryEl.classList.add('has-due');
            summaryEl.innerHTML = `<span class="icon">🔥</span><span>${dueWords.length} words due now</span>`;
            // Add pulse effect/class if desired
            return;
        } else {
            summaryEl.classList.remove('has-due');
        }

        // Find next review date
        let nextDate = null;
        let pendingCount = 0;

        // Iterate all words to find next closest date
        for (const [lemma, data] of Object.entries(srsCache.srsData)) {
            if (data.status === 'mastered') continue;

            pendingCount++;
            const reviewDate = new Date(data.nextReviewDate);

            if (!nextDate || reviewDate < nextDate) {
                nextDate = reviewDate;
            }
        }

        // Determine what to show
        if (!nextDate) {
            if (pendingCount > 0) {
                // Should technically be covered by "due now" if date passed, 
                // but effectively means all reviews are in future
                summaryEl.style.display = 'flex';
                summaryEl.innerHTML = `<span class="icon">✅</span><span>All caught up!</span>`;
            } else {
                // No words in SRS
                summaryEl.style.display = 'none';
            }
            return;
        }

        // Format Date
        const now = new Date();
        const diffMs = nextDate - now;
        const diffHours = diffMs / (1000 * 60 * 60);
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        let timeText = '';
        if (diffHours < 1) {
            timeText = 'Review in < 1h';
        } else if (diffHours < 24) {
            timeText = `Review in ${Math.round(diffHours)}h`;
        } else if (diffDays === 1) {
            timeText = 'Review tomorrow';
        } else {
            timeText = `Next review: ${nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        }

        summaryEl.style.display = 'flex';
        summaryEl.innerHTML = `<span class="icon">🕒</span><span>${timeText}</span>`;
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Skip button - advance to next word without recording
        if (elements.skipBtn) {
            elements.skipBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                skipCurrentWord();
            });
        }

        if (elements.qualityBtns) {
            elements.qualityBtns.querySelectorAll('button[data-quality]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent card flip
                    const quality = parseInt(btn.dataset.quality);
                    recordReviewResult(quality);
                });
            });
        }

        // Auto-Continue Button (for Auto-Assign Mode)
        const autoContinueBtn = document.getElementById('srs-auto-continue-btn');
        if (autoContinueBtn) {
            autoContinueBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                recordAutoReview();
            });
        }

        // Click on card to flip
        if (elements.flashcard) {
            elements.flashcard.addEventListener('click', toggleFlip);
        }

        if (elements.srsRecordBtn) {
            elements.srsRecordBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleRecording();
            });
        }

        if (elements.srsInput) {
            elements.srsInput.addEventListener('click', (e) => e.stopPropagation());
            elements.srsInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    showAnswer();
                }
            });
        }

        if (elements.srsAudioBtn) {
            elements.srsAudioBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                playCurrentWordAudio();
            });
        }
        if (elements.srsAudioBtnBack) {
            elements.srsAudioBtnBack.addEventListener('click', (e) => {
                e.stopPropagation();
                playCurrentWordAudio();
            });
        }

        if (elements.closeBtn) {
            elements.closeBtn.addEventListener('click', closeReviewPanel);
        }

        // Pronunciation Practice button
        if (elements.srsPracticePronunciationBtn) {
            elements.srsPracticePronunciationBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startPronunciationPractice();
            });
        }

        if (elements.srsOverlay) {
            elements.srsOverlay.addEventListener('click', closeReviewPanel);
        }

        // Writing Challenge Listeners are now handled by WritingChallenge module

        // Skip AI Toggle logic moved to WritingChallenge module

        // Refresh Starter Button listener moved to WritingChallenge module

        // More Help! Button
        if (elements.moreHelpBtn) {
            elements.moreHelpBtn.addEventListener('click', toggleScaffolding);
        }

        // Save Settings Button
        if (elements.saveSettingsBtn) {
            elements.saveSettingsBtn.addEventListener('click', saveSettings);
        }

        // Keyboard Shortcuts for SRS Review
        document.addEventListener('keydown', handleSRSKeyboardShortcuts);

        // Settings Listeners
        if (elements.srsSettingsBtn) {
            elements.srsSettingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openSettings();
            });
        }
        if (elements.srsSettingsClose) {
            elements.srsSettingsClose.addEventListener('click', () => {
                if (elements.srsSettingsModal) elements.srsSettingsModal.style.display = 'none';
            });
        }

        // Setup Mobile Swipe Gestures
        setupSwipeGestures();
    }

    /**
     * Setup Mobile Swipe Gestures for Flashcards
     */
    function setupSwipeGestures() {
        const card = elements.flashcard;
        if (!card) return;

        let startX = 0;
        let startY = 0;
        let diffX = 0;
        let isDragging = false;
        const SWIPE_THRESHOLD = 80;

        card.addEventListener('touchstart', (e) => {
            // Ignore if touching interactive elements (buttons, inputs)
            if (e.target.closest('button') || e.target.closest('input')) return;

            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isDragging = true;
            card.style.transition = 'none';
        }, { passive: true });

        card.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;
            diffX = currentX - startX;
            const diffY = currentY - startY;

            // If mostly vertical scrolling, ignore swipe
            if (Math.abs(diffY) > Math.abs(diffX)) return;

            // Prevent default to stop scrolling while swiping horizontally
            if (e.cancelable) e.preventDefault();

            // Visual Translate & Rotate
            const rotation = diffX * 0.05;
            card.style.transform = `translateX(${diffX}px) rotate(${rotation}deg)`;

        }, { passive: false });

        card.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            card.style.transition = 'transform 0.3s ease';

            if (Math.abs(diffX) > SWIPE_THRESHOLD) {
                // Swipe Action
                if (diffX > 0) {
                    // Right -> Good (3)
                    const btn = document.querySelector('button[data-quality="3"]');
                    if (btn) {
                        btn.click();
                        // Visual fly-out
                        card.style.transform = `translateX(${window.innerWidth}px) rotate(20deg)`;
                    }
                } else {
                    // Left -> Again (1)
                    const btn = document.querySelector('button[data-quality="1"]');
                    if (btn) {
                        btn.click();
                        // Visual fly-out
                        card.style.transform = `translateX(-${window.innerWidth}px) rotate(-20deg)`;
                    }
                }

                // Reset transform after animation
                setTimeout(() => {
                    card.style.transition = 'none';
                    card.style.transform = '';
                }, 300);
            } else {
                // Snap Back
                card.style.transform = '';
            }
            diffX = 0;
        });
    }

    /**
     * Handle keyboard shortcuts for SRS Review
     * @param {KeyboardEvent} e
     */
    function handleSRSKeyboardShortcuts(e) {
        // Only handle when SRS panel is active
        if (!reviewSession.active) return;

        // Don't handle if user is typing in an input
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            return;
        }

        switch (e.key) {
            case ' ': // Space - Flip card
                e.preventDefault();
                if (elements.flashcard) {
                    toggleFlip();
                }
                break;

            case '1': // Again
                e.preventDefault();
                if (elements.qualityBtns && elements.qualityBtns.classList.contains('visible')) {
                    recordReviewResult(1);
                }
                break;

            case '2': // Hard
                e.preventDefault();
                if (elements.qualityBtns && elements.qualityBtns.classList.contains('visible')) {
                    recordReviewResult(2);
                }
                break;

            case '3': // Good
                e.preventDefault();
                if (elements.qualityBtns && elements.qualityBtns.classList.contains('visible')) {
                    recordReviewResult(3);
                }
                break;

            case '4': // Easy
                e.preventDefault();
                if (elements.qualityBtns && elements.qualityBtns.classList.contains('visible')) {
                    recordReviewResult(4);
                }
                break;

            case 'Escape': // Close panel
                e.preventDefault();
                closeReviewPanel();
                break;

            case 'p': // Play audio
            case 'P':
                e.preventDefault();
                playCurrentWordAudio();
                break;
        }
    }

    /**
     * Open Scheduler Settings Modal
     */
    function openSettings() {
        if (!elements.srsSettingsModal) return;

        elements.srsSettingsModal.style.display = 'flex';

        // Set current radio value
        const radios = document.getElementsByName('srs-algo');
        radios.forEach(radio => {
            if (radio.value === currentAlgorithm) {
                radio.checked = true;
                radio.closest('.algo-option').style.borderColor = '#2563eb';
                radio.closest('.algo-option').style.background = '#f0f7ff';
            } else {
                radio.closest('.algo-option').style.borderColor = '#e5e7eb';
                radio.closest('.algo-option').style.background = 'white';
            }

            // Add click listener to the parent label for better UX
            const label = radio.closest('.algo-option');
            if (label) {
                label.onclick = () => {
                    radios.forEach(r => {
                        const l = r.closest('.algo-option');
                        if (l) {
                            l.style.borderColor = '#e5e7eb';
                            l.style.background = 'white';
                        }
                    });
                    radio.checked = true;
                    label.style.borderColor = '#2563eb';
                    label.style.background = '#f0f7ff';
                };
            }
        });

        renderRetentionGraph();
    }

    /**
     * Save Scheduler Settings
     */
    function saveSettings() {
        const checkedInput = document.querySelector('input[name="srs-algo"]:checked');
        if (!checkedInput) return;

        const selectedAlgo = checkedInput.value;
        const oldAlgo = currentAlgorithm;
        currentAlgorithm = selectedAlgo;

        // Persist setting
        if (currentUserId && db) {
            updateDoc(doc(db, 'users', currentUserId), {
                'srsSettings.algorithm': selectedAlgo
            }).catch(err => log.error('Error saving setting:', err));
        }
        localStorage.setItem('srs_preferred_algorithm', selectedAlgo);

        // Notify user if changed
        if (oldAlgo !== selectedAlgo) {
            log.debug(`Algorithm changed from ${oldAlgo} to ${selectedAlgo}`);
            // Refresh previews if card is active
            if (reviewSession.active) {
                const currentData = reviewSession.wordsToReview[reviewSession.currentIndex];
                if (currentData) {
                    const previews = getIntervalPreviews(currentData);
                    updateIntervalLabels(previews);
                }
            }
        }

        if (elements.srsSettingsModal) elements.srsSettingsModal.style.display = 'none';
    }

    /**
     * Render Memory Retention Distribution Graph
     * Uses memoization to prevent expensive recalculation on every open
     */
    let retentionChartInstance = null;
    let cachedStats = null;
    let lastStatsHash = "";

    function renderRetentionGraph() {
        // Simple hash based on collection size and last review time
        const dataSize = srsCache.srsData ? Object.keys(srsCache.srsData).length : 0;
        const currentHash = `${dataSize}_${srsCache.reviewStats.lastReviewSession || ''}`;

        log.debug(`Render Graph. Data Size: ${dataSize}, Hash: ${currentHash}`);

        try {
            if (!cachedStats || lastStatsHash !== currentHash) {
                log.debug('Calculating collection stats (cache miss)...');
                cachedStats = SRSScheduler.getCollectionStats(srsCache.srsData);
                lastStatsHash = currentHash;
            } else {
                log.debug('Using cached stats');
            }
        } catch (err) {
            log.error('Stats calculation failed:', err);
            cachedStats = { avgStability: 0, avgRetention: 0, distribution: [0, 0, 0, 0, 0], total: 0 };
        }

        const stats = cachedStats;

        // Update text labels
        const avgStabilityEl = document.getElementById('avg-stability');
        const avgRetentionEl = document.getElementById('avg-retention');
        if (avgStabilityEl) avgStabilityEl.textContent = `${stats.avgStability}d`;
        if (avgRetentionEl) avgRetentionEl.textContent = `${stats.avgRetention}%`;

        const ctx = document.getElementById('retention-chart');
        const loadingEl = document.getElementById('graph-loading');
        if (!ctx) return;
        if (loadingEl) loadingEl.style.display = 'none';

        if (typeof Chart === 'undefined') {
            if (loadingEl) {
                loadingEl.textContent = 'Chart.js failed to load.';
                loadingEl.style.display = 'block';
            }
            return;
        }

        if (retentionChartInstance) {
            retentionChartInstance.destroy();
        }

        retentionChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['<70%', '70-80%', '80-90%', '90-95%', '95-100%'],
                datasets: [{
                    label: 'Word Count',
                    data: stats.distribution,
                    backgroundColor: [
                        '#ef4444', // red
                        '#f59e0b', // amber
                        '#3b82f6', // blue
                        '#10b981', // green
                        '#059669'  // emerald
                    ],
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { display: false },
                        ticks: { stepSize: 1, precision: 0 }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    /**
     * Set Firebase user reference
     */
    function setUser(userId, firestore) {
        // Optimization: Don't reload if user hasn't changed
        if (currentUserId === userId && db && (firestore || db)) {
            log.debug('User already set, skipping reload.');
            return;
        }

        currentUserId = userId;
        db = firestore || (window.__FIREBASE_INTERNAL__ ? window.__FIREBASE_INTERNAL__.db : null);

        if (userId && db) {
            log.debug('Setting user for SRS:', userId);
            loadSRSData();
        } else {
            // Reset cache on logout
            srsCache.srsData = {};
            currentUserId = null;
        }
    }

    /**
     * Load SRS data from Firestore
     * Uses subcollection 'srs_cards' for individual card data (Zero Trust)
     * and a summary doc for stats.
     */
    async function loadSRSData() {
        if (!currentUserId || !db) return;

        try {
            // 1. Load Summary Data (XP, Streak, etc)
            const summaryRef = doc(db, 'users', currentUserId, 'vocabularyBook', 'data');
            const summaryDoc = await getDoc(summaryRef);

            if (summaryDoc.exists()) {
                const data = summaryDoc.data();

                // Legacy check: If srsData exists in the summary doc, we need to migrate it
                if (data.srsData && Object.keys(data.srsData).length > 0) {
                    log.warn('Legacy SRS data detected in monolithic doc. Migrating to srs_cards subcollection...');
                    await migrateToSubcollection(data.srsData);
                }

                srsCache.reviewStats = data.reviewStats || {
                    totalReviews: 0,
                    reviewsToday: 0,
                    lastReviewSession: null,
                    streak: 0,
                    longestStreak: 0
                };
                srsCache.masteredWords = data.masteredWords || [];
            }

            // 2. Load Individual Cards from Subcollection
            const cardsRef = collection(db, 'users', currentUserId, 'srs_cards');
            const cardsSnapshot = await getDocs(cardsRef);

            srsCache.srsData = {};
            cardsSnapshot.forEach(doc => {
                const card = doc.data();
                const lemma = card.lemma || doc.id;
                srsCache.srsData[lemma] = card;
            });

            log.debug(`Loaded ${Object.keys(srsCache.srsData).length} cards from srs_cards subcollection`);

            // 3. Fetch User Points for Gamification (Global User Doc)
            const userDocRef = doc(db, 'users', currentUserId);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const userData = userDoc.data();
                // Prefer totalPoints, fallback to practicePoints if migrating
                srsCache.totalPoints = userData.totalPoints ?? userData.practicePoints ?? 0;

                // Load Algorithm Preference
                if (userData.srsSettings && userData.srsSettings.algorithm) {
                    currentAlgorithm = userData.srsSettings.algorithm;
                    log.debug('Algorithm preference loaded from Firestore:', currentAlgorithm);
                } else {
                    const localAlgo = localStorage.getItem('srs_preferred_algorithm');
                    if (localAlgo) {
                        currentAlgorithm = localAlgo;
                        log.debug('Algorithm preference loaded from LocalStorage:', currentAlgorithm);
                    }
                }

                updateGamificationUI();
                if (typeof updateDashboardUI === 'function') updateDashboardUI();
            }

            updateDashboardSummary();
        } catch (e) {
            log.error('Error loading SRS data:', e);
        }
    }

    /**
     * Migrate legacy srsData map to individual srs_cards documents
     * @param {Object} legacyData - The srsData map from vocabularyBook/data
     */
    async function migrateToSubcollection(legacyData) {
        log.log(`Starting migration for ${Object.keys(legacyData).length} items...`);
        const batch = writeBatch(db);
        let count = 0;

        for (const [lemma, card] of Object.entries(legacyData)) {
            const safeId = lemma.replace(/\//g, '_');
            const cardRef = doc(db, 'users', currentUserId, 'srs_cards', safeId);

            batch.set(cardRef, {
                ...card,
                lemma: lemma,
                migratedAt: serverTimestamp()
            });
            count++;

            // Commit in chunks of 500
            if (count % 500 === 0) {
                await batch.commit();
                log.log(`Migrated ${count} items...`);
            }
        }

        if (count % 500 !== 0) {
            await batch.commit();
        }

        // Wipe legacy data from monolithic doc
        const summaryRef = doc(db, 'users', currentUserId, 'vocabularyBook', 'data');
        await updateDoc(summaryRef, {
            srsData: {}
        });

        log.important(`✓ Migration complete! ${count} items moved to subcollection.`);
    }

    /**
     * Save SRS summary stats to Firestore
     */
    async function saveSRSSummary() {
        if (!currentUserId || !db) return;

        const dataToSave = sanitize({
            reviewStats: srsCache.reviewStats,
            masteredWords: srsCache.masteredWords,
            updatedAt: new Date().toISOString()
        });

        try {
            const vocabDocRef = doc(db, 'users', currentUserId, 'vocabularyBook', 'data');
            await setDoc(vocabDocRef, dataToSave, { merge: true });
            log.debug('Saved SRS summary to Firestore');
        } catch (e) {
            log.error('Error saving SRS summary:', e);
        }
    }

    /**
     * Save individual card SRS data to Firestore
     * @param {string} lemma
     * @param {object} card
     */
    async function saveCardSRS(lemma, card) {
        if (!currentUserId || !db) return;

        const safeId = lemma.replace(/\//g, '_');
        const cardRef = doc(db, 'users', currentUserId, 'srs_cards', safeId);

        try {
            await setDoc(cardRef, sanitize({
                ...card,
                lemma: lemma,
                updatedAt: new Date().toISOString()
            }), { merge: true });
            log.debug(`Saved card SRS for: ${lemma}`);
        } catch (e) {
            log.error(`Error saving card SRS for ${lemma}:`, e);
        }
    }

    /**
     * SANITIZE: Recursively replace undefined with null for Firestore
     */
    const sanitize = (obj) => {
        if (obj === undefined) return null;
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(sanitize);
        const newObj = {};
        for (const key in obj) {
            const val = sanitize(obj[key]);
            if (val !== undefined) newObj[key] = val;
            else newObj[key] = null;
        }
        return newObj;
    };

    /**
     * Debounced save wrapper for summary stats
     */
    function debouncedSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveSRSSummary();
        }, 2000); // 2 second delay
    }

    /**
     * Flush any pending summary save immediately
     */
    function flushSRSSave() {
        if (saveTimeout) {
            log.debug('Flushing pending SRS save...');
            clearTimeout(saveTimeout);
            saveTimeout = null;
            saveSRSSummary();
        }
    }

    /**
     * Schedule retry for failed save
     */
    function scheduleRetry() {
        if (pendingSave) clearTimeout(pendingSave);
        pendingSave = setTimeout(async () => {
            log.debug('Attempting to sync local data...');
            await saveSRSSummary();
        }, 10000); // Retry after 10 seconds
    }

    /**
     * Load pending data from localStorage on init
     */
    function loadPendingData() {
        const pending = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!pending) return;

        try {
            const { userId, data, timestamp } = JSON.parse(pending);
            // Only restore if same user and data is relatively recent (< 7 days)
            if (userId === currentUserId && Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000) {
                log.debug('Restoring pending changes from local storage');
                srsCache.srsData = data.srsData || srsCache.srsData;
                srsCache.reviewStats = data.reviewStats || srsCache.reviewStats;
                srsCache.masteredWords = data.masteredWords || srsCache.masteredWords;
                saveSRSSummary(); // Try to sync immediately
            }
        } catch (e) {
            log.warn('Could not parse pending data:', e);
        }
    }

    /**
     * Initialize SRS tracking for a word
     * Called when a word is added to vocabulary book
     * @param {string} lemma - The lemmatized word
     * @param {string} originalWord - The original word form
     * @param {object} contextData - Optional context data (NEW)
     * @param {string} contextData.partOfSpeech - Part of speech
     * @param {string} contextData.definition - Stored definition
     * @param {string} contextData.example - Example sentence
     * @param {string} contextData.sentence - Original sentence
     */
    function initializeWord(lemma, originalWord, contextData = {}) {
        if (srsCache.srsData[lemma]) {
            log.log('Word already initialized:', lemma);
            // Update context data if provided (in case it's richer than what we have)
            if (contextData.definition && !srsCache.srsData[lemma].definition) {
                srsCache.srsData[lemma].definition = contextData.definition;
                srsCache.srsData[lemma].example = contextData.example || null;
                srsCache.srsData[lemma].partOfSpeech = contextData.partOfSpeech || 'unknown';
                srsCache.srsData[lemma].sentence = contextData.sentence || null;
                debouncedSave();
            }
            return;
        }

        const now = new Date();
        srsCache.srsData[lemma] = {
            originalWord: originalWord,
            interval: 1,                    // First review in 1 day
            easeFactor: SM2_DEFAULT_EASE,
            repetitions: 0,
            nextReviewDate: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            lastReviewDate: null,
            status: 'learning',             // learning | reviewing | mastered
            // NEW: Store context data
            partOfSpeech: contextData.partOfSpeech || 'unknown',
            definition: contextData.definition || null,
            example: contextData.example || null,
            sentence: contextData.sentence || null
        };

        log.log('Initialized word:', lemma, 'POS:', contextData.partOfSpeech || 'unknown');

        // Save to Firestore (Per-card for Zero Trust + Debounced summary)
        saveCardSRS(lemma, srsCache.srsData[lemma]);
        debouncedSave();
    }

    /**
     * Get words due for review today
     */
    function getWordsDueForReview() {
        const now = new Date();
        const dueWords = [];

        for (const [lemma, data] of Object.entries(srsCache.srsData)) {
            if (data.status === 'mastered') continue;

            const nextReview = new Date(data.nextReviewDate);
            if (nextReview <= now) {
                dueWords.push({
                    lemma: lemma,
                    ...data
                });
            }
        }

        // Sort by due date (oldest first - most urgent)
        dueWords.sort((a, b) => new Date(a.nextReviewDate) - new Date(b.nextReviewDate));

        return dueWords;
    }

    /**
     * Render the SRS schedule table in the dashboard
     */
    function renderScheduleTable() {
        const tableBody = document.getElementById('srs-schedule-body');
        const dueCountEl = document.getElementById('schedule-due-count');
        if (!tableBody) return;

        const allWords = Object.entries(srsCache.srsData)
            .filter(([_, data]) => data.status !== 'mastered')
            .map(([lemma, data]) => ({ lemma, ...data }));

        // Sort: Urgent (due) first, then by next review date
        const now = new Date();
        allWords.sort((a, b) => new Date(a.nextReviewDate) - new Date(b.nextReviewDate));

        if (allWords.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" class="empty-schedule">No words in your review list yet. Add some words from the practice modes!</td></tr>';
            if (dueCountEl) dueCountEl.textContent = '0 words due';
            return;
        }

        const dueWords = allWords.filter(w => new Date(w.nextReviewDate) <= now);
        if (dueCountEl) dueCountEl.textContent = `${dueWords.length} words due`;

        tableBody.innerHTML = allWords.slice(0, 15).map(word => {
            const nextReview = new Date(word.nextReviewDate);
            const isDue = nextReview <= now;
            const timeDiff = nextReview - now;

            let timeText = '';
            if (isDue) {
                timeText = 'Due now';
            } else {
                const diffHours = Math.floor(timeDiff / (1000 * 60 * 60));
                const diffDays = Math.floor(diffHours / 24);

                if (diffHours < 1) {
                    timeText = 'In < 1h';
                } else if (diffHours < 24) {
                    timeText = `In ${diffHours}h`;
                } else {
                    timeText = `In ${diffDays}d`;
                }
            }

            const statusClass = word.status === 'learning' ? 'status-learning' : 'status-review';
            const statusLabel = word.status === 'learning' ? 'Learning' : 'Review';

            return `
                <tr>
                    <td class="word-cell"><strong>${word.lemma}</strong></td>
                    <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td><span class="next-review-time ${isDue ? 'due' : ''}">${timeText}</span></td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Get SRS data for a specific word
     * @param {string} lemma - The word to look up
     * @returns {object|null} - SRS data for the word, or null if not found
     */
    function getWordData(lemma) {
        if (!lemma) return null;
        return srsCache.srsData[lemma] || null;
    }

    /**
     * Get ALL words for review (including not-yet-due)
     * Used for early review sessions
     */
    function getAllWordsForReview() {
        const allWords = [];

        for (const [lemma, data] of Object.entries(srsCache.srsData)) {
            if (data.status === 'mastered') continue;

            allWords.push({
                lemma: lemma,
                ...data
            });
        }

        // Sort by next review date (soonest first)
        allWords.sort((a, b) => new Date(a.nextReviewDate) - new Date(b.nextReviewDate));

        return allWords;
    }

    // Milestones for Auto-Assign algorithm
    const AUTO_MILESTONES = [1, 3, 6, 14];

    /**
     * Calculate next interval using Auto-Assign algorithm
     * Automatically determines interval based on pass/fail status
     * @param {boolean} wasCorrect - Whether user answered correctly
     * @param {object} currentData - Current SRS data for the word
     * @returns {object} - New interval, ease factor, and other SRS data
     */
    function calculateAutoInterval(wasCorrect, currentData) {
        let { interval, easeFactor, repetitions, consecutiveFails } = currentData;
        interval = interval || 1;
        easeFactor = easeFactor || SM2_DEFAULT_EASE;
        repetitions = repetitions || 0;
        consecutiveFails = consecutiveFails || 0;

        if (!wasCorrect) {
            // FAIL: Reduce interval
            consecutiveFails++;

            if (consecutiveFails >= 2) {
                // Multiple fails: Reset to 1 day
                interval = 1;
                log.debug('[SRS Auto] Multiple fails, resetting to 1 day');
            } else {
                // First fail: Go to 50% of current interval (min 1 day)
                interval = Math.max(1, Math.round(interval * 0.5));
                log.debug(`[SRS Auto] First fail, reducing to ${interval} days (50%)`);
            }

            // Decrease ease factor (word is harder)
            easeFactor = Math.max(SM2_MIN_EASE, easeFactor - 0.15);
            repetitions = 0; // Reset streak

        } else {
            // SUCCESS: Advance to next milestone
            consecutiveFails = 0;
            repetitions++;

            // Find current milestone index
            let currentMilestoneIdx = AUTO_MILESTONES.findIndex(m => m >= interval);
            if (currentMilestoneIdx === -1) currentMilestoneIdx = AUTO_MILESTONES.length - 1;

            // Move to next milestone
            const nextMilestoneIdx = Math.min(currentMilestoneIdx + 1, AUTO_MILESTONES.length - 1);
            interval = AUTO_MILESTONES[nextMilestoneIdx];

            // For intervals beyond milestones, apply ease factor
            if (currentMilestoneIdx >= AUTO_MILESTONES.length - 1 && repetitions > 4) {
                interval = Math.round(interval * easeFactor);
                log.debug(`[SRS Auto] Beyond 14 days, applying EF: ${interval} days`);
            } else {
                log.debug(`[SRS Auto] Success! Advancing to ${interval} days`);
            }

            // Increase ease factor slightly (word is getting easier)
            easeFactor = Math.min(2.5, easeFactor + 0.05);
        }

        // Calculate next review date
        const now = new Date();
        const nextDate = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);

        // Determine status
        let status = 'learning';
        if (repetitions >= 3) status = 'reviewing';
        // Mastery: repetition count OR long interval (unified)
        if (repetitions >= MASTERY_THRESHOLD || interval >= 21) status = 'mastered';

        log.debug(`[SRS Auto] Result: interval=${interval}, EF=${easeFactor.toFixed(2)}, reps=${repetitions}, status=${status}`);

        return {
            interval,
            easeFactor: Math.round(easeFactor * 100) / 100,
            repetitions,
            consecutiveFails,
            nextReviewDate: nextDate.toISOString(),
            lastReviewDate: now.toISOString(),
            status
        };
    }

    /**
     * Calculate next review using the selected algorithm (SM-2 or FSRS)
     * Delegates to the new SRSScheduler module
     * @param {number} quality - User rating (1=Again, 2=Hard, 3=Good, 4=Easy)
     * @param {object} currentData - Current SRS data for the word
     * @returns {object} - New interval, ease factor, and next review date
     */
    function calculateNextReview(quality, currentData) {
        // Map quality to RATING enum
        const ratingMap = {
            1: RATING.AGAIN,
            2: RATING.HARD,
            3: RATING.GOOD,
            4: RATING.EASY
        };
        const rating = ratingMap[quality] || RATING.GOOD;

        // Prepare card data for scheduler
        const card = {
            state: currentData.state || CARD_STATE.NEW,
            interval: currentData.interval || 0,
            easeFactor: currentData.easeFactor || 2.5,
            repetitions: currentData.repetitions || 0,
            stepIndex: currentData.stepIndex || 0,
            lastReviewDate: currentData.lastReviewDate,
            fsrs: currentData.fsrs || null
        };

        // Use SRSScheduler with current algorithm preference
        const result = SRSScheduler.calculate(card, rating, currentAlgorithm);

        // NEW: If interval was >= 14 days and user succeeded, promote to Mastered in VocabBook
        if (quality >= 3 && currentData.interval >= 14) {
            const lemma = currentData.lemma || currentData.originalWord;
            if (window.VocabularyBook && typeof window.VocabularyBook.promoteToMastered === 'function') {
                log.debug('Promoting to Mastered after 14-day review:', lemma);
                window.VocabularyBook.promoteToMastered(lemma);
            }
        }

        return result;
    }

    /**
     * Get interval previews for current word to display on buttons
     * @param {object} currentData - Current SRS data
     * @returns {object} - Previews for each rating
     */
    function getIntervalPreviews(currentData) {
        const card = {
            state: currentData.state || CARD_STATE.NEW,
            interval: currentData.interval || 0,
            easeFactor: currentData.easeFactor || 2.5,
            repetitions: currentData.repetitions || 0,
            stepIndex: currentData.stepIndex || 0,
            lastReviewDate: currentData.lastReviewDate,
            fsrs: currentData.fsrs || null
        };

        return SRSScheduler.getIntervalPreviews(card, currentAlgorithm);
    }

    /**
     * Update interval preview labels on the rating buttons
     * @param {object} previews - Interval previews from getIntervalPreviews
     */
    function updateIntervalLabels(previews) {
        const againEl = document.getElementById('interval-again');
        const hardEl = document.getElementById('interval-hard');
        const goodEl = document.getElementById('interval-good');
        const easyEl = document.getElementById('interval-easy');

        // Note: SRSScheduler.getIntervalPreviews returns { again: '1m', hard: '6m', ... }
        // Keys are lowercase strings, values are display strings (not objects)
        if (againEl) againEl.textContent = previews.again || '1m';
        if (hardEl) hardEl.textContent = previews.hard || '6m';
        if (goodEl) goodEl.textContent = previews.good || '10m';
        if (easyEl) easyEl.textContent = previews.easy || '4d';
    }

    /**
     * Start a review session
     * @param {boolean} forceEarly - If true, skip due check and review all words
     */
    async function startReviewSession(forceEarly = false) {
        // Check if SRS Onboarding needs to be shown (first-time user)
        if (window.SRSOnboarding && !window.SRSOnboarding.isOnboardingComplete()) {
            log.debug('First-time user, showing algorithm selection...');
            const selectedAlgorithm = await window.SRSOnboarding.init((algo) => {
                currentAlgorithm = algo;
                log.debug('User selected algorithm:', algo);
            });
            currentAlgorithm = selectedAlgorithm;
        }

        // FIX: Close vocab panel and list modal to prevent layering issues
        const vocabPanelSide = document.getElementById('vocab-panel-side');
        if (vocabPanelSide) vocabPanelSide.classList.remove('open');

        const listModal = document.querySelector('.vocab-list-modal-overlay');
        if (listModal) listModal.style.display = 'none';

        const dueWords = getWordsDueForReview();
        const allWords = getAllWordsForReview();

        // No words in SRS at all
        if (allWords.length === 0) {
            showCustomAlert('No words in your vocabulary! Bookmark some words first to start reviewing.');
            return;
        }

        // Check if there are due words
        if (dueWords.length === 0 && !forceEarly) {
            // FRICTIONLESS START: If total words < 5, just start practice immediately
            if (allWords.length < 5) {
                log.debug('Auto-starting bonus session (few words)');
                // Fall through to start session with all words
            } else {
                // Show confirmation for early review
                showEarlyReviewConfirmation(allWords);
                return;
            }
        }

        // Use due words if available, otherwise all words (for early review)
        const wordsToReview = dueWords.length > 0 ? dueWords : allWords;

        // Initialize Performance Tracker and Difficulty Settings
        if (window.PerformanceTracker) {
            srsPerformanceTracker = new window.PerformanceTracker('srs');
        }
        if (window.DifficultyManager) {
            currentDifficultySettings = window.DifficultyManager.getCurrentSettings('srs');
            log.debug('Difficulty Settings:', currentDifficultySettings);
        } else {
            currentDifficultySettings = {}; // Default empty
        }

        // Initialize session
        reviewSession = {
            active: true,
            wordsToReview: wordsToReview,
            currentIndex: 0,
            sessionResults: [],
            startTime: new Date(),
            isEarlyReview: dueWords.length === 0
        };

        // Reset daily count if new day
        checkAndResetDailyStats();

        // Show review panel
        showReviewPanel();
        showCurrentWord();

        // Trigger Tutorial if not seen
        if (window.SRSOnboarding && !window.SRSOnboarding.hasSeenTutorial()) {
            // Delay tutorial slightly to let UI render
            setTimeout(() => {
                window.SRSOnboarding.startRatingButtonsTutorial();
            }, 800);
        }
    }

    /**
     * Show confirmation popup for early review
     */
    function showEarlyReviewConfirmation(allWords) {
        // Create confirmation modal
        const overlay = document.createElement('div');
        overlay.id = 'srs-early-confirm-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
            z-index: 2100;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: linear-gradient(145deg, #1e293b, #0f172a);
            border-radius: 16px;
            padding: 24px 32px;
            max-width: 400px;
            text-align: center;
            border: 1px solid rgba(148, 163, 184, 0.2);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        `;

        modal.innerHTML = `
            <h3 style="color: #f1f5f9; margin: 0 0 16px 0; font-size: 1.25rem;">⏰ Not Scheduled Yet</h3>
            <p style="color: #94a3b8; margin: 0 0 24px 0; line-height: 1.5;">
                This is not your scheduled review time.<br>
                You have <strong style="color: #f1f5f9;">${allWords.length}</strong> word${allWords.length !== 1 ? 's' : ''} to review early.
            </p>
            <p style="color: #64748b; font-size: 0.9rem; margin: 0 0 24px 0;">
                Continue anyway?
            </p>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button id="srs-early-no" style="
                    padding: 12px 32px;
                    border: 1px solid rgba(148, 163, 184, 0.3);
                    background: transparent;
                    color: #94a3b8;
                    border-radius: 8px;
                    font-size: 1rem;
                    cursor: pointer;
                    transition: all 0.2s;
                ">No</button>
                <button id="srs-early-yes" style="
                    padding: 12px 32px;
                    border: none;
                    background: linear-gradient(145deg, #6366f1, #4f46e5);
                    color: white;
                    border-radius: 8px;
                    font-size: 1rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                ">Yes, Review Now</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Event listeners
        document.getElementById('srs-early-no').addEventListener('click', () => {
            overlay.remove();
        });

        document.getElementById('srs-early-yes').addEventListener('click', () => {
            overlay.remove();
            startReviewSession(true); // Force early review
        });

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });
    }

    /**
     * Check and reset daily stats if it's a new day
     */
    function checkAndResetDailyStats() {
        const now = new Date();
        const lastSession = srsCache.reviewStats.lastReviewSession
            ? new Date(srsCache.reviewStats.lastReviewSession)
            : null;

        if (!lastSession) {
            srsCache.reviewStats.reviewsToday = 0;
            return;
        }

        const isNewDay = now.toDateString() !== lastSession.toDateString();

        if (isNewDay) {
            // Check if yesterday (for streak)
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);

            // More forgiving: streak only breaks after 48 hours
            const hoursSinceLastSession = (now - lastSession) / (1000 * 60 * 60);
            if (hoursSinceLastSession <= 48) {
                srsCache.reviewStats.streak++;
                if (srsCache.reviewStats.streak > srsCache.reviewStats.longestStreak) {
                    srsCache.reviewStats.longestStreak = srsCache.reviewStats.streak;
                }
            } else {
                // Streak broken (missed more than 24h + 24h grace)
                srsCache.reviewStats.streak = 1; // Start new
            }

            srsCache.reviewStats.reviewsToday = 0;
        }
    }

    /**
     * Show the review panel
     */
    function showReviewPanel() {
        // Prevent background scroll
        document.body.style.overflow = 'hidden';

        if (elements.srsPanel) {
            elements.srsPanel.style.display = 'flex';
            elements.srsPanel.classList.add('active');
        }
        if (elements.srsOverlay) {
            elements.srsOverlay.style.display = 'block';
        }

        // Update stats display
        updateStatsDisplay();
        updateGamificationUI(); // Update gamification UI when panel is shown

        // Accessibility: Trap focus
        if (elements.srsPanel) trapFocus(elements.srsPanel);
    }

    /**
     * Close the review panel
     */
    function closeReviewPanel() {
        // Restore background scroll
        document.body.style.overflow = '';

        if (elements.srsPanel) {
            elements.srsPanel.classList.remove('active');
            // Actually hide the panel after animation
            setTimeout(() => {
                if (elements.srsPanel) {
                    elements.srsPanel.style.display = 'none';
                }
            }, 300);
        }
        if (elements.srsOverlay) {
            elements.srsOverlay.style.display = 'none';
        }

        // Stop recording if active
        stopRecording();

        // Reset UI state for next session
        if (elements.showAnswerBtn) elements.showAnswerBtn.style.display = 'block';
        if (elements.qualityBtns) elements.qualityBtns.style.display = 'none';
        if (elements.srsResultContainer) elements.srsResultContainer.style.display = 'none';
        if (elements.flashcard) elements.flashcard.classList.remove('flipped');

        // If session was active, show incomplete warning
        if (reviewSession.active && reviewSession.currentIndex < reviewSession.wordsToReview.length) {
            log.debug('Session closed early');
        }

        reviewSession.active = false;
    }

    /**
     * toggleRecording
     */
    function toggleRecording() {
        try {
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        } catch (error) {
            log.error('Error in toggleRecording:', error);
            // Ensure we don't leave UI in bad state
            stopRecording();
        }
    }

    /**
     * startRecording
     */
    function startRecording() {
        if (!SpeechRecognition) {
            showCustomAlert("Speech recognition is not supported in this browser.");
            return;
        }

        if (isRecording) return;

        try {
            recognition = new SpeechRecognition();
            recognition.lang = 'en-US';
            recognition.interimResults = true;
            recognition.continuous = false; // Single word/phrase usually

            recognition.onstart = () => {
                isRecording = true;
                if (elements.srsRecordBtn) {
                    elements.srsRecordBtn.textContent = 'Stop Recording';
                    elements.srsRecordBtn.classList.add('recording');
                }
                currentTranscription = "";
            };

            recognition.onend = () => {
                isRecording = false;
                if (elements.srsRecordBtn) {
                    elements.srsRecordBtn.textContent = 'Start Recording';
                    elements.srsRecordBtn.classList.remove('recording');
                }

                // Auto-flip card and check answer after recording ends
                if (currentTranscription && reviewSession.currentMode === 'speak') {
                    showAnswer();
                }
            };

            recognition.onresult = (event) => {
                // Get transcript
                let transcript = "";
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    transcript += event.results[i][0].transcript;
                }
                currentTranscription = transcript;
                log.debug('Configured Transcript:', currentTranscription);

                // Optional: Update UI to show what's being heard (if we had a display for it)
                // But user wants to check AFTER flip.
            };

            recognition.onerror = (event) => {
                log.error('Speech recognition error', event.error);
                stopRecording();
            };

            recognition.start();

        } catch (e) {
            log.error('Error starting recognition:', e);
            stopRecording();
        }
    }

    /**
     * stopRecording
     */
    function stopRecording() {
        if (recognition && isRecording) {
            try {
                recognition.stop();
            } catch (e) { /* ignore */ }
        }
        isRecording = false;
        if (elements.srsRecordBtn) {
            elements.srsRecordBtn.textContent = 'Start Recording';
            elements.srsRecordBtn.classList.remove('recording');
        }
    }

    /**
     * Show the current word in the flashcard
     */
    async function showCurrentWord() {
        if (reviewSession.currentIndex >= reviewSession.wordsToReview.length) {
            // Session complete
            showSessionSummary();
            return;
        }

        const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];

        // Hide back of card immediately to prevent flash of answer
        const backCard = document.querySelector('.srs-flashcard-back');
        if (backCard) backCard.style.opacity = '0';

        // Reset flashcard to front (remove flip class)
        if (elements.flashcard) elements.flashcard.classList.remove('flipped');

        // Restore back opacity after flip transition completes
        setTimeout(() => {
            if (backCard) backCard.style.opacity = '1';
        }, 50);

        // Reset controls: Hide quality buttons until flipped
        if (elements.qualityBtns) elements.qualityBtns.classList.remove('visible');
        if (elements.srsControls) elements.srsControls.classList.remove('visible');

        // Show Answer button deprecated, but ensure hidden just in case
        if (elements.showAnswerBtn) elements.showAnswerBtn.style.display = 'none';

        // Show flip hint
        const flipHint = document.getElementById('srs-flip-hint');
        if (flipHint) flipHint.style.opacity = '1';

        // Set word text (both front and back)
        if (elements.srsWord) {
            let displayText = currentWord.originalWord || currentWord.lemma;

            // Add POS if available (map to generic abbreviations) - hide 'unknown'
            if (currentWord.partOfSpeech && currentWord.partOfSpeech.toLowerCase() !== 'unknown') {
                const posMap = {
                    'noun': 'n',
                    'verb': 'v',
                    'adjective': 'adj',
                    'adverb': 'adv',
                    'preposition': 'prep',
                    'conjunction': 'conj',
                    'pronoun': 'pron'
                };

                // FIX 3: Filter out bad POS data (like "Symbol" or ISO codes)
                const rawPos = currentWord.partOfSpeech.toLowerCase();
                const rawDef = (currentWord.definition || "").toLowerCase();

                const isCodeOrSymbol =
                    rawPos.includes('code') ||
                    rawPos.includes('symbol') ||
                    rawPos.length > 15 ||
                    rawDef.includes('iso 639');

                if (!isCodeOrSymbol) {
                    const shortPos = posMap[rawPos] || currentWord.partOfSpeech;
                    displayText += ` (${shortPos})`;
                }
            }

            elements.srsWord.textContent = displayText;
        }

        if (elements.srsWordFront) {
            elements.srsWordFront.textContent = currentWord.originalWord || currentWord.lemma;
        }

        // Difficulty Integration: Show definition if supported
        // If hidden by difficulty, maybe blur it or hide it? 
        // Note: Logic for hiding needs to be in toggleFlip or CSS injection.
        // For now, let's inject a class based on difficulty
        if (elements.flashcard) {
            elements.flashcard.classList.remove('diff-hide-def');
            if (currentDifficultySettings && currentDifficultySettings.showDef === false) {
                elements.flashcard.classList.add('diff-hide-def');
            }
        }

        // --- SET MODE IMMEDIATELY (before async operations) ---
        // Determine available modes
        const exampleForFront = currentWord.sentence || currentWord.example || currentWord.context || '';
        const wordToMask = currentWord.originalWord || currentWord.lemma;

        let maskedSentence = '';
        let canDoCloze = false;

        if (exampleForFront && wordToMask) {
            // Try to mask
            maskedSentence = exampleForFront.replace(
                new RegExp(wordToMask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                '______'
            );
            // Only allow cloze if we actually masked something
            canDoCloze = maskedSentence !== exampleForFront;
        }

        log.debug(`Word: ${wordToMask}, Context: ${!!exampleForFront}, Cloze Possible: ${canDoCloze}`);

        // --- WEIGHTED SELECTION LOGIC ---
        // Initialize weights if not present
        if (!reviewSession.modeWeights) {
            reviewSession.modeWeights = { listen: 1, speak: 1, cloze: 1 };
        }

        // Identify valid modes
        const validModes = ['listen', 'speak'];
        if (canDoCloze) validModes.push('cloze');

        // Calculate total weight for VALID modes only
        let totalWeight = 0;
        validModes.forEach(m => totalWeight += reviewSession.modeWeights[m]);

        // Weighted Random Selection
        let r = Math.random() * totalWeight;
        let selectedMode = validModes[0];
        let runningSum = 0;

        for (const mode of validModes) {
            runningSum += reviewSession.modeWeights[mode];
            if (r < runningSum) {
                selectedMode = mode;
                break;
            }
        }

        reviewSession.currentMode = selectedMode;

        // Update Weights: Reset chosen, increment others
        reviewSession.modeWeights[selectedMode] = 1; // Reset
        validModes.forEach(m => {
            if (m !== selectedMode) {
                // Increase weight of unpicked modes to make them more likely next time
                reviewSession.modeWeights[m] = (reviewSession.modeWeights[m] || 1) + 2;
            }
        });

        log.debug(`Mode Selected: ${selectedMode}. New Weights:`, JSON.stringify(reviewSession.modeWeights));
        log.debug(`Mode selected: ${reviewSession.currentMode}`);

        // ============================================
        // SRS MODE TUTORIALS (Contextual, First-Time)
        // ============================================
        // Trigger tutorial for each mode on first encounter
        if (window.VocabTutorial) {
            if (selectedMode === 'listen' && VocabTutorial.shouldShow('srsListenType')) {
                // Slight delay to let UI render first
                setTimeout(() => VocabTutorial.startSRSListenTypeTutorial(), 200);
            } else if (selectedMode === 'speak' && VocabTutorial.shouldShow('srsListenRepeat')) {
                setTimeout(() => VocabTutorial.startSRSListenRepeatTutorial(), 200);
            } else if (selectedMode === 'cloze' && VocabTutorial.shouldShow('srsCloze')) {
                setTimeout(() => VocabTutorial.startSRSClozeTutorial(), 200);
            }
        }

        // Reset inputs and results
        if (elements.srsInput) elements.srsInput.value = '';
        if (elements.srsResultContainer) elements.srsResultContainer.style.display = 'none';
        if (elements.srsResultMessage) elements.srsResultMessage.textContent = '';
        if (elements.srsUserInputDisplay) elements.srsUserInputDisplay.textContent = '';
        if (elements.srsRecordBtn) {
            elements.srsRecordBtn.textContent = 'Start Recording';
            elements.srsRecordBtn.classList.remove('recording');
        }
        // Reset pronunciation practice UI
        if (elements.srsPracticePronunciationBtn) {
            elements.srsPracticePronunciationBtn.style.display = 'none';
            elements.srsPracticePronunciationBtn.classList.remove('recording');
            elements.srsPracticePronunciationBtn.textContent = '🎙️ Practice Saying It';
        }
        if (elements.srsPronunciationResult) elements.srsPronunciationResult.style.display = 'none';

        // Configure UI based on mode
        let displayPrompt = 'Listen and type the word';

        if (reviewSession.currentMode === 'cloze') {
            displayPrompt = maskedSentence;
        } else if (exampleForFront) {
            displayPrompt = exampleForFront;
        }

        if (elements.srsDefinitionPrompt) {
            elements.srsDefinitionPrompt.textContent = displayPrompt;
        }

        if (reviewSession.currentMode === 'listen') {
            // Listen Mode: Show Audio/Input. Hide Record. HIDE WORD.
            if (elements.srsWordFront) elements.srsWordFront.style.display = 'none';
            if (elements.srsAudioBtn) {
                elements.srsAudioBtn.style.display = 'inline-flex';
                elements.srsAudioBtn.innerHTML = '🔊 Listen'; // Reset text
            }
            if (elements.srsRecordBtn) elements.srsRecordBtn.style.display = 'none';
            if (elements.srsInputContainer) elements.srsInputContainer.style.display = 'block';

            // Set prompt specifically for listen mode
            if (elements.srsDefinitionPrompt) elements.srsDefinitionPrompt.textContent = 'Listen and type the word';

            // Focus input for immediate typing
            if (elements.srsInput) {
                elements.srsInput.placeholder = 'Type what you hear...';
                setTimeout(() => elements.srsInput.focus(), 100);
            }
        } else if (reviewSession.currentMode === 'cloze') {
            // Cloze Mode: Show Masked Sentence. Hide Audio. Show Input. HIDE WORD.
            if (elements.srsWordFront) elements.srsWordFront.style.display = 'none';

            // Hide audio to not give it away
            if (elements.srsAudioBtn) elements.srsAudioBtn.style.display = 'none';

            if (elements.srsRecordBtn) elements.srsRecordBtn.style.display = 'none';
            if (elements.srsInputContainer) elements.srsInputContainer.style.display = 'block';

            // Focus input
            if (elements.srsInput) {
                elements.srsInput.placeholder = 'Type the missing word...';
                setTimeout(() => elements.srsInput.focus(), 100);
            }
        } else {
            // Speak Mode: Show Record. Show Audio (Support). SHOW WORD.
            if (elements.srsWordFront) elements.srsWordFront.style.display = 'block';

            // "Listen First" scaffolding
            if (elements.srsAudioBtn) {
                elements.srsAudioBtn.style.display = 'inline-flex';
                elements.srsAudioBtn.innerHTML = '🔊 Listen First';
                elements.srsAudioBtn.title = 'Listen to the pronunciation before speaking';
            }

            if (elements.srsRecordBtn) elements.srsRecordBtn.style.display = 'inline-flex';
            if (elements.srsInputContainer) elements.srsInputContainer.style.display = 'none';

            // Set prompt for speak mode
            if (elements.srsDefinitionPrompt) elements.srsDefinitionPrompt.textContent = 'Say the word out loud';
        }

        // Update progress
        updateProgress();

        // --- ASYNC OPERATIONS (after mode is already set) ---
        // Fetch and display phonetics
        if (elements.srsPhonetic) elements.srsPhonetic.textContent = '...';
        if (elements.srsPhoneticBack) elements.srsPhoneticBack.textContent = '...';

        // Use stored phonetic or fetch for the specific word form displayed (NOT lemma!)
        const phonetic = currentWord.phonetic || await fetchPhonetic(currentWord.originalWord || currentWord.lemma);
        if (elements.srsPhonetic) elements.srsPhonetic.textContent = phonetic || '';
        if (elements.srsPhoneticBack) elements.srsPhoneticBack.textContent = phonetic || '';

        // Fetch Vietnamese translation and definition using DictionaryService
        const wordToLookup = currentWord.originalWord || currentWord.lemma;

        // Set loading states
        if (elements.srsVietnamese) elements.srsVietnamese.textContent = '...';
        if (elements.srsDefinition) {
            elements.srsDefinition.style.display = 'none'; // Force hide
            // elements.srsDefinition.textContent = '...'; 
        }

        // Use DictionaryService if available
        if (typeof DictionaryService !== 'undefined') {
            try {
                // Use lemma for lookup
                const lookupWord = (currentWord.lemma || wordToLookup).toLowerCase();

                // PERFORMANCE: Fetch in background, don't await if we already have some data
                // but for SRS, we want accurate data, so we'll await with a shorter timeout if we could
                const wordDataPromise = DictionaryService.getWordData(lookupWord, currentWord.partOfSpeech);

                // Add a timeout to the promise to prevent hanging UI
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2500));
                const wordData = await Promise.race([wordDataPromise, timeoutPromise]);

                // Display Vietnamese translation
                if (elements.srsVietnamese) {
                    elements.srsVietnamese.textContent = wordData.vietnameseTranslation || '';
                }

                // Display example sentence (prefer stored, fallback to fetched)
                // Also update the prompt if it was empty
                const example = currentWord.example || currentWord.sentence || wordData.example || '';
                if (elements.srsExample) {
                    elements.srsExample.textContent = example;
                }

                if (elements.srsDefinitionPrompt && (!elements.srsDefinitionPrompt.textContent || elements.srsDefinitionPrompt.textContent.includes('...'))) {
                    if (example) elements.srsDefinitionPrompt.textContent = example;
                }

                log.debug('Word data loaded:', wordToLookup, wordData);

                // Sync back
                currentWord.vietnameseTranslation = wordData.vietnameseTranslation;
                currentWord.definition = wordData.definition;
                currentWord.example = example;
            } catch (e) {
                log.warn('DictionaryService call failed or timed out:', e);
                // Fallback to locally stored info
                if (elements.srsVietnamese) elements.srsVietnamese.textContent = currentWord.vietnameseTranslation || '';
                if (elements.srsExample) elements.srsExample.textContent = currentWord.example || currentWord.sentence || '';

                // Ensure prompt is NOT empty
                if (elements.srsDefinitionPrompt && (!elements.srsDefinitionPrompt.textContent || elements.srsDefinitionPrompt.textContent.includes('...'))) {
                    elements.srsDefinitionPrompt.textContent = currentWord.example || currentWord.sentence || 'No prompt available';
                }
            } finally {
                // Update interval preview labels on rating buttons (always do this)
                try {
                    const previews = getIntervalPreviews(currentWord);
                    updateIntervalLabels(previews);
                } catch (e) {
                    log.warn('Could not update interval labels:', e);
                }
            }
        } else {
            // DictionaryService not available
            if (elements.srsVietnamese) elements.srsVietnamese.textContent = currentWord.vietnameseTranslation || '';
            if (elements.srsExample) elements.srsExample.textContent = currentWord.example || currentWord.sentence || '';
        }
    }

    function showAnswer() {
        // Hide flip hint
        const flipHint = document.getElementById('srs-flip-hint');
        if (flipHint) flipHint.style.opacity = '0';

        if (elements.showAnswerBtn) elements.showAnswerBtn.style.display = 'none';

        // Toggle between Auto-Assign mode and Manual mode
        const autoContinueBtn = document.getElementById('srs-auto-continue-btn');
        const qualityOptions = document.querySelector('.srs-quality-options');
        const qualityPrompt = document.querySelector('.srs-quality-prompt');

        if (reviewSession.autoAssignMode) {
            // Auto-Assign Mode: Show continue button, hide quality options
            if (autoContinueBtn) autoContinueBtn.style.display = 'flex';
            if (qualityOptions) qualityOptions.style.display = 'none';
            if (qualityPrompt) qualityPrompt.textContent = 'Answer recorded!';
        } else {
            // Manual Mode: Show quality options, hide continue button
            if (autoContinueBtn) autoContinueBtn.style.display = 'none';
            if (qualityOptions) qualityOptions.style.display = 'grid';
            if (qualityPrompt) qualityPrompt.textContent = 'How well did you remember?';
        }

        // Fix: Use CSS class for visibility animation
        if (elements.qualityBtns) {
            elements.qualityBtns.classList.add('visible');
            elements.qualityBtns.style.display = 'flex';
        }
        if (elements.srsControls) elements.srsControls.classList.add('visible');

        // Add flip animation
        if (elements.flashcard) {
            elements.flashcard.classList.add('flipped');
        }

        // Perform Check
        checkAnswerAndDisplay();
    }

    /**
     * Check the user's answer and update display
     */
    function checkAnswerAndDisplay() {
        const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];
        if (!currentWord) return;

        const targetWord = (currentWord.originalWord || currentWord.lemma).toLowerCase().trim();
        let userSaid = "";
        let isCorrect = false;

        if (reviewSession.currentMode === 'listen' || reviewSession.currentMode === 'cloze') {
            // Check Typed Input
            if (elements.srsInput) {
                userSaid = elements.srsInput.value.toLowerCase().trim();

                // Difficulty Integration: Typo Tolerance
                const tolerance = (currentDifficultySettings && currentDifficultySettings.typoTolerance !== undefined)
                    ? currentDifficultySettings.typoTolerance
                    : 0; // Default strict

                if (tolerance > 0) {
                    const dist = getLevenshteinDistance(userSaid, targetWord);
                    isCorrect = dist <= tolerance && userSaid.length > 0; // Prevent empty matching empty
                } else {
                    isCorrect = userSaid === targetWord;
                }
            }
        } else {
            // Check Spoken Transcript
            // Stop recording if active
            stopRecording();
            userSaid = (currentTranscription || "").toLowerCase().trim();
            // Word boundary match (more robust than strict equality)
            const wordBoundaryRegex = new RegExp(`\\b${targetWord}\\b`, 'i');
            isCorrect = wordBoundaryRegex.test(userSaid);
            log.debug(`Speech Check: "${userSaid}" vs "${targetWord}" -> ${isCorrect}`);
        }

        // Display Result
        if (elements.srsResultContainer) {
            elements.srsResultContainer.style.display = 'block';
            if (isCorrect) {
                elements.srsResultMessage.textContent = '✅ Correct!';
                elements.srsResultMessage.className = 'srs-result-message correct';
            } else {
                elements.srsResultMessage.textContent = '❌ Incorrect';
                elements.srsResultMessage.className = 'srs-result-message incorrect';
            }
            const actionVerb = reviewSession.currentMode === 'speak' ? 'said' : 'typed';
            elements.srsUserInputDisplay.textContent = `You ${actionVerb}: "${userSaid || ''}"`;
        }

        // Store correctness for Writing Challenge trigger
        reviewSession.lastAnswerCorrect = isCorrect;
        log.debug('[SRS DEBUG] checkAnswerAndDisplay - isCorrect:', isCorrect, 'stored to reviewSession.lastAnswerCorrect');

        // Difficulty Integration: Record Attempt
        if (srsPerformanceTracker) {
            // Estimate time (simple diff from last check or card show?)
            // For now, pass 0 or track it properly. 
            // We can use a simplified tracking here since SRS is item-based.
            srsPerformanceTracker.recordAttempt({
                correct: isCorrect,
                attempts: 1,
                hintUsed: false,
                timeTaken: 5 // Placeholder or implement timer
            });
        }

        // Show pronunciation practice button after answer
        if (elements.srsPracticePronunciationBtn) {
            elements.srsPracticePronunciationBtn.style.display = 'flex';
        }
        // Hide previous pronunciation result
        if (elements.srsPronunciationResult) {
            elements.srsPronunciationResult.style.display = 'none';
        }
    }

    /**
     * Toggle flashcard flip
     */
    function toggleFlip(e) {
        // Prevent flip if clicking audio button or controls
        if (e.target.closest('.srs-audio-btn') || e.target.closest('.srs-controls')) return;

        if (elements.flashcard) {
            elements.flashcard.classList.toggle('flipped');

            // If flipped to back, call showAnswer to handle UI consistency
            if (elements.flashcard.classList.contains('flipped')) {
                showAnswer();
            } else {
                // If flipping to front, hide controls
                if (elements.qualityBtns) elements.qualityBtns.classList.remove('visible');
                if (elements.srsControls) elements.srsControls.classList.remove('visible');
            }
        }
    }

    /**
     * Start pronunciation practice with speech recognition
     */
    function startPronunciationPractice() {
        const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];
        if (!currentWord) return;

        const targetWord = (currentWord.originalWord || currentWord.lemma).toLowerCase().trim();
        const btn = elements.srsPracticePronunciationBtn;
        const resultDiv = elements.srsPronunciationResult;
        const feedbackSpan = elements.srsPronunciationFeedback;

        // Check for speech recognition support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            if (feedbackSpan) feedbackSpan.textContent = '⚠️ Speech recognition not supported in this browser';
            if (resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.className = 'srs-pronunciation-result incorrect';
            }
            return;
        }

        // If already recording, stop
        if (btn.classList.contains('recording')) {
            btn.classList.remove('recording');
            btn.textContent = '🎙️ Practice Saying It';
            return;
        }

        // Stop any existing recognition to prevent 'aborted' error
        if (pronunciationRecognition) {
            try {
                pronunciationRecognition.abort();
            } catch (e) {
                log.debug('Previous recognition already stopped');
            }
            pronunciationRecognition = null;
        }

        // Start recording
        btn.classList.add('recording');
        btn.textContent = '🔴 Listening...';
        if (resultDiv) resultDiv.style.display = 'none';

        pronunciationRecognition = new SpeechRecognition();
        const recognition = pronunciationRecognition;
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 3;

        recognition.onresult = (event) => {
            btn.classList.remove('recording');
            btn.textContent = '🎙️ Try Again';

            const transcript = event.results[0][0].transcript.toLowerCase().trim();
            const confidence = event.results[0][0].confidence;

            // Check all alternatives for a match
            // Use strict matching: exact match or word appears as complete word in phrase
            let isMatch = false;
            for (let i = 0; i < event.results[0].length; i++) {
                const alt = event.results[0][i].transcript.toLowerCase().trim();
                // Exact match
                if (alt === targetWord) {
                    isMatch = true;
                    break;
                }
                // Word boundary match: target word appears as complete word in transcription
                // e.g., "the quite nice" contains "quite" as a complete word
                const wordBoundaryRegex = new RegExp(`\\b${targetWord}\\b`, 'i');
                if (wordBoundaryRegex.test(alt)) {
                    isMatch = true;
                    break;
                }
            }

            if (resultDiv && feedbackSpan) {
                resultDiv.style.display = 'block';
                if (isMatch) {
                    resultDiv.className = 'srs-pronunciation-result correct';
                    feedbackSpan.textContent = `✅ Great! You said: "${transcript}"`;
                } else {
                    resultDiv.className = 'srs-pronunciation-result incorrect';
                    feedbackSpan.textContent = `❌ You said: "${transcript}" (Expected: "${targetWord}")`;
                }
            }

            log.debug('Pronunciation:', { transcript, targetWord, isMatch, confidence });
        };

        recognition.onerror = (event) => {
            btn.classList.remove('recording');
            btn.textContent = '🎙️ Practice Saying It';

            if (resultDiv && feedbackSpan) {
                resultDiv.style.display = 'block';
                resultDiv.className = 'srs-pronunciation-result incorrect';

                if (event.error === 'no-speech') {
                    feedbackSpan.textContent = '🔇 No speech detected. Try again!';
                } else if (event.error === 'not-allowed') {
                    feedbackSpan.textContent = '🎤 Microphone access denied. Please enable it.';
                } else {
                    feedbackSpan.textContent = `⚠️ Error: ${event.error}`;
                }
            }
        };

        recognition.onend = () => {
            btn.classList.remove('recording');
            if (btn.textContent === '🔴 Listening...') {
                btn.textContent = '🎙️ Practice Saying It';
            }
        };

        recognition.start();
    }

    /**
     * Skip current word and move to next (without recording SRS data)
     */
    function skipCurrentWord() {
        log.debug('Skipping current word');

        // Move to next word
        reviewSession.currentIndex++;

        // Reset flashcard state
        if (elements.flashcard) elements.flashcard.classList.remove('flipped');
        if (elements.srsResultContainer) elements.srsResultContainer.style.display = 'none';
        if (elements.srsInput) elements.srsInput.value = '';

        // Show next word or summary
        showCurrentWord();
    }

    /**
     * Show feedback toast for SRS scheduling
     */
    function showFeedbackToast(interval) {
        let toast = document.getElementById('srs-feedback-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'srs-feedback-toast';
            toast.className = 'srs-feedback-toast';
            // Append to container relative to flashcard
            const container = document.querySelector('.srs-flashcard-container') || document.body;
            container.appendChild(toast);
        }

        const timeText = interval === 0 ? 'Review again soon' : `See you in ${interval} day${interval !== 1 ? 's' : ''}`;
        toast.innerHTML = `<span>📅</span> ${timeText}`;

        // Force reflow
        void toast.offsetWidth;

        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 1200);
    }

    /**
     * Decide whether to trigger the Writing Challenge for a word.
     * Used by both Auto-Assign and manual quality rating flows.
     */
    function getWritingChallengeTriggerDecision(currentWord, wasCorrect) {
        const decision = {
            shouldTrigger: false,
            wasCorrect: wasCorrect === true,
            currentPOS: '',
            isAllowedPOS: false,
            shouldSkipWord: false
        };

        if (!wasCorrect || !currentWord) return decision;

        // Only show Writing Challenge for nouns, verbs, adjectives, adverbs
        const ALLOWED_POS = ['noun', 'verb', 'adjective', 'adverb', 'n', 'v', 'adj', 'adv'];

        // Try multiple sources for POS: partOfSpeech, pos, or detect via dictionary service
        let currentPOS = String(currentWord.partOfSpeech || currentWord.pos || '').toLowerCase();

        // If POS is still unknown, use DictionaryService
        if ((!currentPOS || currentPOS === 'unknown') && window.DictionaryService && typeof window.DictionaryService.detectPartOfSpeech === 'function') {
            try {
                const detected = window.DictionaryService.detectPartOfSpeech(
                    currentWord.originalWord || currentWord.lemma,
                    currentWord.sentence || currentWord.example || ''
                );
                currentPOS = String(detected || '').toLowerCase();
            } catch (e) {
                // Ignore POS detection errors and continue with existing value.
            }
        }

        const isAllowedPOS = ALLOWED_POS.some(pos => currentPOS.includes(pos));

        // Words to skip for Writing Challenge (too common/simple for meaningful practice)
        const SKIP_WRITING_CHALLENGE_WORDS = ['be', 'a', 'an', 'the', 'is', 'are', 'was', 'were'];
        const wordLemma = String(currentWord.lemma || currentWord.originalWord || '').toLowerCase().trim();
        const shouldSkip = SKIP_WRITING_CHALLENGE_WORDS.includes(wordLemma);

        decision.currentPOS = currentPOS;
        decision.isAllowedPOS = isAllowedPOS;
        decision.shouldSkipWord = shouldSkip;
        decision.shouldTrigger = wasCorrect && isAllowedPOS && !shouldSkip;

        return decision;
    }

    /**
     * Record review result using Auto-Assign mode
     * Uses answer correctness to automatically determine next interval
     */
    async function recordAutoReview() {
        const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];
        const lemma = currentWord.lemma;
        const wasCorrect = reviewSession.lastAnswerCorrect === true;

        log.debug('[SRS Auto] Recording auto-review for:', lemma, 'wasCorrect:', wasCorrect);

        // Calculate new SRS values using Auto-Assign algorithm
        const currentData = srsCache.srsData[lemma] || currentWord;
        const newData = calculateAutoInterval(wasCorrect, currentData);

        // Show Feedback Toast
        showFeedbackToast(newData.interval);

        // Update cached data
        srsCache.srsData[lemma] = {
            ...srsCache.srsData[lemma],
            ...newData,
            originalWord: currentWord.originalWord || currentWord.lemma
        };

        // Track session result
        reviewSession.sessionResults.push({
            lemma,
            quality: wasCorrect ? 4 : 1, // Map to quality for stats
            wasCorrect: wasCorrect
        });

        // Check if word is now mastered
        if (newData.status === 'mastered') {
            log.debug('[SRS Auto] Word mastered:', lemma);
            srsCache.masteredWords.push({
                lemma,
                masteredAt: new Date().toISOString(),
                totalReviews: newData.repetitions
            });

            // Promote in VocabBook if applicable
            if (window.VocabularyBook && typeof window.VocabularyBook.promoteToMastered === 'function') {
                window.VocabularyBook.promoteToMastered(lemma);
            }

            await awardPoints(POINTS_WORD_MASTERED, 'word_mastered');
        }

        // Update stats
        srsCache.reviewStats.totalReviews++;
        srsCache.reviewStats.reviewsToday++;
        if (wasCorrect) {
            srsCache.reviewStats.totalCorrect = (srsCache.reviewStats.totalCorrect || 0) + 1;
        }
        srsCache.reviewStats.lastReviewSession = new Date().toISOString();

        // Track last quality for awardPoints (Map wasCorrect to quality 4 or 1)
        reviewSession.lastQuality = wasCorrect ? 4 : 1;

        await awardPoints(POINTS_PER_REVIEW, 'srs_review');
        // FIX: Removed duplicate awardPoints call

        // Save to Firestore (Per-card for Zero Trust + Debounced summary)
        await saveCardSRS(lemma, srsCache.srsData[lemma]);
        debouncedSave();
        updateDashboardSummary(); // Update dashboard "Next review" info

        // Reset flip animation
        if (elements.flashcard) {
            elements.flashcard.classList.remove('flipped');
        }

        // Trigger Writing Challenge in auto mode using the same gating logic as manual mode.
        const wcDecision = getWritingChallengeTriggerDecision(currentWord, wasCorrect);
        log.debug('[SRS Auto] Writing Challenge decision:', wcDecision);

        if (wcDecision.shouldTrigger) {
            setTimeout(() => {
                showWritingChallenge(currentWord, () => {
                    reviewSession.lastAnswerCorrect = false;
                    reviewSession.currentIndex++;
                    showCurrentWord();
                }, 'review_' + Date.now());
            }, 300);
        } else {
            // Move to next word immediately if wrong or not eligible
            reviewSession.lastAnswerCorrect = false;
            reviewSession.currentIndex++;
            showCurrentWord();
        }
    }

    /**
     * Record the review result and move to next word
     */
    async function recordReviewResult(quality) {
        const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];
        const lemma = currentWord.lemma;

        // Calculate new SRS values
        const newData = calculateNextReview(quality, srsCache.srsData[lemma] || currentWord);

        // Show Feedback Toast
        showFeedbackToast(newData.interval);

        // Update cached data
        srsCache.srsData[lemma] = {
            ...srsCache.srsData[lemma],
            ...newData,
            originalWord: currentWord.originalWord || currentWord.lemma
        };

        // Track session result
        reviewSession.sessionResults.push({
            lemma,
            quality,
            wasCorrect: quality >= 3
        });

        // Track last quality for server-scored SRS attempts
        reviewSession.lastQuality = quality;

        // Check if word is now mastered
        if (newData.status === 'mastered') {
            log.debug('Word mastered:', lemma);
            srsCache.masteredWords.push({
                lemma,
                masteredAt: new Date().toISOString(),
                totalReviews: newData.repetitions
            });

            // Award mastery points
            await awardPoints(POINTS_WORD_MASTERED, 'word_mastered');
        }

        // Update stats
        srsCache.reviewStats.totalReviews++;
        srsCache.reviewStats.reviewsToday++;
        srsCache.reviewStats.lastReviewSession = new Date().toISOString();

        // Award points for review
        await awardPoints(POINTS_PER_REVIEW, 'srs_review');

        // Save to Firestore (Per-card for Zero Trust + Debounced summary)
        await saveCardSRS(lemma, srsCache.srsData[lemma]);
        debouncedSave();

        // Reset flip animation
        if (elements.flashcard) {
            elements.flashcard.classList.remove('flipped');
        }

        // --- TRIGGER WRITING CHALLENGE ---
        // Trigger if:
        // 1. User typed correctly (lastAnswerCorrect === true)
        // 2. OR User self-rated as Good (3), Easy (4), or Perfect (5)
        const isSelfRatedCorrect = typeof quality === 'number' && quality >= 3;
        const wasCorrect = reviewSession.lastAnswerCorrect === true || isSelfRatedCorrect;

        const wcDecision = getWritingChallengeTriggerDecision(currentWord, wasCorrect);

        log.debug('[SRS DEBUG] recordReviewResult - wasCorrect:', wasCorrect, 'reviewSession.lastAnswerCorrect:', reviewSession.lastAnswerCorrect);
        log.debug('[SRS DEBUG] recordReviewResult - currentPOS:', wcDecision.currentPOS, 'isAllowedPOS:', wcDecision.isAllowedPOS);
        log.debug('[SRS DEBUG] recordReviewResult - Will trigger Writing Challenge?', wcDecision.shouldTrigger);

        if (wcDecision.shouldTrigger) {
            setTimeout(() => {
                showWritingChallenge(currentWord, () => {
                    // Callback after challenge
                    reviewSession.lastAnswerCorrect = false;
                    reviewSession.currentIndex++;
                    showCurrentWord();
                }, 'review_' + Date.now());
            }, 300);
        } else {
            // Incorrect answer, no answer check, or non-content word: Move to next word directly
            // ERROR FIX: Wait for card to flip halfway (300ms) before updating content
            // to prevent "flashing" the new answer on the back of the card.
            setTimeout(() => {
                reviewSession.lastAnswerCorrect = false;
                reviewSession.currentIndex++;
                showCurrentWord();
            }, 350);
        }
    }

    /**
     * Show session summary
     */
    async function showSessionSummary() {
        const duration = Math.round((new Date() - reviewSession.startTime) / 1000);
        const correct = reviewSession.sessionResults.filter(r => r.wasCorrect).length;
        const total = reviewSession.sessionResults.length;
        const accuracy = Math.round((correct / total) * 100);

        // Check for daily completion bonus
        const dueRemaining = getWordsDueForReview().length;
        let bonusPoints = 0;

        if (dueRemaining === 0) {
            bonusPoints += POINTS_DAILY_COMPLETE;
            await awardPoints(POINTS_DAILY_COMPLETE, 'daily_reviews_complete');
        }

        // Check for weekly streak bonus
        if (srsCache.reviewStats.streak > 0 && srsCache.reviewStats.streak % 7 === 0) {
            bonusPoints += POINTS_WEEKLY_STREAK;
            await awardPoints(POINTS_WEEKLY_STREAK, 'weekly_streak');
        }

        // Update the global SRS proficiency bonus
        await updateSRSBonus();

        // Update UI to show summary
        if (elements.flashcard) elements.flashcard.style.display = 'none';
        if (elements.showAnswerBtn) elements.showAnswerBtn.style.display = 'none';
        if (elements.qualityBtns) elements.qualityBtns.style.display = 'none';

        if (elements.srsSummary) {
            elements.srsSummary.style.display = 'block';
            elements.srsSummary.innerHTML = `
                <div class="srs-summary-content">
                    <h3>🎉 Session Complete!</h3>
                    <div class="srs-summary-stats">
                        <div class="stat">
                            <span class="stat-value">${total}</span>
                            <span class="stat-label">Words Reviewed</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">${accuracy}%</span>
                            <span class="stat-label">Accuracy</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">${formatDuration(duration)}</span>
                            <span class="stat-label">Time</span>
                        </div>
                    </div>
                    <div class="srs-points-earned">
                        <span>+${total * POINTS_PER_REVIEW + bonusPoints} points earned</span>
                        ${bonusPoints > 0 ? `<span class="bonus">(includes ${bonusPoints} bonus!)</span>` : ''}
                    </div>
                    ${dueRemaining === 0
                    ? '<div class="srs-all-done">✅ All reviews complete for today!</div>'
                    : `<div class="srs-remaining">${dueRemaining} more words due</div>`
                }
                    <button id="srs-done-btn" class="srs-done-btn">Done</button>
                </div>
            `;

            // Trigger confetti for session completion
            triggerConfetti();

            // Add event listener for done button
            const doneBtn = document.getElementById('srs-done-btn');
            if (doneBtn) {
                doneBtn.addEventListener('click', closeReviewPanel);
            }
        }

        reviewSession.active = false;
    }

    /**
     * Update progress display
     */
    function updateProgress() {
        const current = reviewSession.currentIndex + 1;
        const total = reviewSession.wordsToReview.length;
        const percentage = (reviewSession.currentIndex / total) * 100;

        if (elements.srsProgressText) {
            elements.srsProgressText.textContent = `${current} of ${total}`;
        }
        if (elements.srsProgressFill) {
            elements.srsProgressFill.style.width = `${percentage}%`;
        }
    }

    /**
     * Update stats display in header
     */
    function updateStatsDisplay() {
        const dueCount = getWordsDueForReview().length;

        if (elements.srsDueCount) {
            elements.srsDueCount.textContent = `${dueCount} word${dueCount !== 1 ? 's' : ''} due`;
        }
        if (elements.srsStreak && srsCache.reviewStats.streak > 0) {
            elements.srsStreak.textContent = `🔥 ${srsCache.reviewStats.streak} day streak`;
            elements.srsStreak.style.display = 'inline';
        } else if (elements.srsStreak) {
            elements.srsStreak.style.display = 'none';
        }
    }

    /**
     * Play audio for current word
     */
    function playCurrentWordAudio() {
        const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];
        if (!currentWord) return;

        const word = currentWord.originalWord || currentWord.lemma;

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(word);
            utterance.lang = 'en-US';

            // Match voice logic from Vocabulary Book (female/clear)
            const voices = window.speechSynthesis.getVoices();
            const preferred = voices.find((v) =>
                /female|samantha|allison|joanna|kimberly|ssml female|en-us/i.test(v.name)
            );
            if (preferred) {
                utterance.voice = preferred;
            }

            utterance.rate = 0.9; // Slightly slower for clarity
            utterance.pitch = 1.0;
            window.speechSynthesis.speak(utterance);
        }
    }

    /**
     * Fetch phonetic transcription
     */
    async function fetchPhonetic(word) {
        // Use Phonetics module if available
        if (typeof Phonetics !== 'undefined' && Phonetics.getIPA) {
            try {
                return await Phonetics.getIPA(word);
            } catch (e) {
                log.warn('Phonetics fetch failed:', e);
            }
        }
        return null;
    }

    /**
     * Fetch definition and example from Dictionary API
     */
    async function fetchDefinition(word, preferredPOS, lemma = null) {
        // Use lemma if available for better definition matching (e.g. 'made' -> 'make')
        const searchTerm = lemma || word;
        const cacheKey = `${searchTerm}:${preferredPOS || ''}`;
        // Check cache
        if (definitionCache.has(cacheKey)) {
            return definitionCache.get(cacheKey);
        }

        try {
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${searchTerm}`);
            if (!response.ok) throw new Error('Not found');

            const data = await response.json();
            const entry = data[0];

            let definition = '';
            let example = '';

            // Find best match for Part of Speech
            let meaning = entry.meanings[0];
            if (preferredPOS && entry.meanings.length > 1) {
                const posMap = {
                    'n': 'noun', 'noun': 'noun',
                    'v': 'verb', 'verb': 'verb',
                    'adj': 'adjective', 'adjective': 'adjective',
                    'adv': 'adverb', 'adverb': 'adverb'
                };
                const target = posMap[preferredPOS.toLowerCase()] || preferredPOS.toLowerCase();

                // Try exact match or partial match
                const found = entry.meanings.find(m =>
                    m.partOfSpeech.toLowerCase() === target ||
                    target.startsWith(m.partOfSpeech.toLowerCase())
                );

                if (found) meaning = found;
            }

            if (meaning && meaning.definitions && meaning.definitions.length > 0) {
                definition = meaning.definitions[0].definition;
                example = meaning.definitions[0].example || '';
            }

            const result = { definition, example };
            definitionCache.set(cacheKey, result);
            saveDefinitionCache(); // Persist to local storage
            return result;
        } catch (e) {
            log.warn('Definition fetch failed for:', searchTerm);
            const result = { definition: '', example: '' };
            definitionCache.set(cacheKey, result);
            return result;
        }
    }

    /**
     * Persistent Definition Cache Logic
     */
    function saveDefinitionCache() {
        try {
            const obj = Object.fromEntries(definitionCache);
            localStorage.setItem(DEF_CACHE_KEY, JSON.stringify(obj));
        } catch (e) { /* ignore */ }
    }

    function loadDefinitionCache() {
        try {
            const stored = localStorage.getItem(DEF_CACHE_KEY);
            if (stored) {
                const obj = JSON.parse(stored);
                for (const [k, v] of Object.entries(obj)) {
                    definitionCache.set(k, v);
                }
                log.debug('Loaded', definitionCache.size, 'definitions from cache');
            }
        } catch (e) { /* ignore */ }
    }

    /**
     * Award points to user
     */
    async function awardPoints(points, reason) {
        if (!currentUserId || !db) return;

        try {
            // Use Dual-Track Scoring for SRS Reviews if available
            if (reason === 'srs_review' && window.handleDualTrackScoring) {
                const currentWord = reviewSession.wordsToReview?.[reviewSession.currentIndex] || null;
                const lemma = currentWord?.lemma || currentWord?.originalWord || 'srs_review';
                const lastQuality = Number(reviewSession?.lastQuality);
                const qualityValue = Number.isFinite(lastQuality)
                    ? lastQuality
                    : (reviewSession?.lastAnswerCorrect === true ? 4 : 1);

                // Award XP for SRS (Track A). Track B ratings do not update for 'srs' mode on server.
                await window.handleDualTrackScoring('srs', String(lemma), qualityValue);
            } else if (window.firebaseFirestoreFunctions && window.firebaseFirestoreFunctions.addPoints) {
                await window.firebaseFirestoreFunctions.addPoints(
                    currentUserId,
                    points,
                    'SRS Review',
                    reason
                );
            } else {
                // Fallback (legacy)
                const userDocRef = doc(db, 'users', currentUserId);
                await updateDoc(userDocRef, {
                    totalPoints: increment(points),
                    coins: increment(points)
                });
            }

            // Update local cache and UI
            if (typeof srsCache.totalPoints === 'undefined') srsCache.totalPoints = 0;
            srsCache.totalPoints += points;
            updateGamificationUI();

            log.debug(`Awarded ${points} points for ${reason}`);
        } catch (e) {
            log.error('Error awarding points:', e);
        }
    }

    /**
     * Update the global SRS proficiency bonus
     * Bonus = Consistency^0.7 * Retention^1.3 (Max 5.0)
     */
    async function updateSRSBonus() {
        if (!currentUserId || !firestoreFunctions) return;

        const streak = srsCache.reviewStats.streak || 0;
        const total = srsCache.reviewStats.totalReviews || 1;
        const correct = srsCache.reviewStats.totalCorrect || 0; // Need to track this
        const retention = correct / total;

        // V6 Normalized Formula: bonus = 5 * Consistency^0.7 * Retention^1.3
        // Consistency is streak normalized to [0, 1] relative to a 30-day "full power" target
        const consistencyScale = Math.min(streak / 30, 1);
        const consistencyFactor = Math.pow(consistencyScale, 0.7);
        const retentionFactor = Math.pow(retention, 1.3);

        const bonus = Math.min(5.0, 5.0 * consistencyFactor * retentionFactor);

        log.debug(`[SRS] Calculated Bonus: ${bonus.toFixed(2)} (Streak: ${streak}, Retention: ${(retention * 100).toFixed(1)}%)`);

        try {
            const updateFn = firestoreFunctions.updateUserProfile || firestoreFunctions.createOrUpdateUserProfile;
            if (updateFn) {
                await updateFn(currentUserId, { srsBonus: bonus });
            }
        } catch (err) {
            log.error('Failed to update SRS bonus:', err);
        }
    }

    /**
     * Format duration in mm:ss
     */
    function formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Get count of words due for review (for external use)
     */
    function getDueCount() {
        return getWordsDueForReview().length;
    }

    /**
     * Get human-readable next review info for a word
     * @param {string} lemma - The lemmatized word
     * @returns {object} - { dueNow, daysUntil, dateString, timeString, fullText }
     */
    function getNextReviewInfo(lemma) {
        if (!lemma || !srsCache.srsData[lemma]) {
            return { dueNow: false, daysUntil: null, dateString: 'Not scheduled', timeString: '', fullText: 'Not in SRS' };
        }

        const wordData = srsCache.srsData[lemma];
        const nextReviewDate = new Date(wordData.nextReviewDate);
        const now = new Date();

        // Check if due now
        if (nextReviewDate <= now) {
            return {
                dueNow: true,
                daysUntil: 0,
                dateString: 'Due now',
                timeString: '',
                fullText: '📍 Due now'
            };
        }

        // Calculate days until
        const diffMs = nextReviewDate - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        // Format date
        const options = { month: 'short', day: 'numeric' };
        const dateString = nextReviewDate.toLocaleDateString('en-US', options);

        // Format time
        const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
        const timeString = nextReviewDate.toLocaleTimeString('en-US', timeOptions);

        // Create full text
        let fullText = '';
        if (diffDays === 1) {
            fullText = `📅 Tomorrow ${timeString}`;
        } else if (diffDays <= 7) {
            fullText = `📅 In ${diffDays} days (${dateString})`;
        } else {
            fullText = `📅 ${dateString}`;
        }

        return {
            dueNow: false,
            daysUntil: diffDays,
            dateString: dateString,
            timeString: timeString,
            fullText: fullText
        };
    }

    /**
     * Get review statistics
     */
    function getStats() {
        return {
            ...srsCache.reviewStats,
            dueCount: getDueCount(),
            totalWords: Object.keys(srsCache.srsData).length,
            masteredCount: srsCache.masteredWords.length
        };
    }

    /**
     * Update Dashboard UI (Next Review Date & Due Badge)
     */
    function updateDashboardUI() {
        // 1. Update Due Badge
        const dueCount = getDueCount();
        const badge = document.getElementById('srs-due-badge');
        if (badge) {
            badge.textContent = dueCount;
            badge.style.display = dueCount > 0 ? 'inline-block' : 'none';
        }

        // 2. Update Next Review Text
        const nextReviewEl = document.getElementById('srs-next-date');
        const nextReviewContainer = document.getElementById('srs-next-review-info');

        if (nextReviewEl) {
            if (dueCount > 0) {
                nextReviewEl.textContent = 'Now!';
                if (nextReviewContainer) nextReviewContainer.style.display = 'block';
                return;
            }

            // Find earliest next review date
            let earliest = null;
            const now = new Date();

            Object.values(srsCache.srsData).forEach(wordData => {
                if (wordData.nextReviewDate) {
                    const d = new Date(wordData.nextReviewDate);
                    // Only consider future dates
                    if (d > now) {
                        if (!earliest || d < earliest) earliest = d;
                    }
                }
            });

            if (earliest) {
                const diffMs = earliest - now;
                const diffMins = Math.round(diffMs / 60000);
                const diffHours = Math.round(diffMs / 3600000);
                const diffDays = Math.round(diffMs / 86400000);

                let text = '';
                if (diffMins < 60) text = `In ${diffMins} min`;
                else if (diffHours < 24) text = `In ${diffHours} hours`;
                else if (diffDays === 1) text = `Tomorrow`;
                else text = `In ${diffDays} days`; // e.g., "In 2 days"

                nextReviewEl.textContent = text;
                if (nextReviewContainer) nextReviewContainer.style.display = 'block';
            } else {
                nextReviewEl.textContent = '-';
                // keep visible or hide? maybe visible to show "Empty" state
            }
        }
    }

    /**
     * Get SRS data for a specific word
     * @param {string} lemma
     */
    function getWordData(lemma) {
        if (!lemma) return null;

        // Check if mastered
        if (srsCache.masteredWords.includes(lemma)) {
            return { status: 'mastered' };
        }

        // Return SRS data if exists
        return srsCache.srsData[lemma] || null;
    }

    /**
     * WRITING CHALLENGE LOGIC
     * -----------------------
     */

    // Load collocations data (called once on init)
    async function loadCollocationsData() {
        try {
            const response = await fetch('./collocations.json');
            if (response.ok) {
                collocationsData = await response.json();
                log.debug('Collocations loaded:', Object.keys(collocationsData).length, 'words');
            }
        } catch (e) {
            log.warn('Could not load collocations.json:', e.message);
        }
    }

    // Get collocations for a word
    function getCollocations(word, wordObj = null) {
        // If we already pre-fetched best collocations in the word object, use them
        if (wordObj && wordObj.bestCollocations) {
            return wordObj.bestCollocations;
        }

        if (!collocationsData || !word) return [];
        const key = word.toLowerCase();
        return collocationsData[key] || [];
    }

    /**
     * Source 3: Extract simple collocations (N-grams) from examples
     */
    function extractCollocations(word, examples) {
        const results = [];
        const wordLower = word.toLowerCase();

        examples.forEach(ex => {
            const cleanEx = ex.replace(/[.,!?;:]/g, '');
            const words = cleanEx.split(/\s+/);
            const idx = words.findIndex(w => w.toLowerCase() === wordLower);

            if (idx !== -1) {
                // Try to get 2-3 word chunks
                // 1. Word + next word
                if (idx + 1 < words.length) results.push(`${words[idx]} ${words[idx + 1]}`);
                // 2. Prev word + word
                if (idx - 1 >= 0) results.push(`${words[idx - 1]} ${words[idx]}`);
                // 3. Prev + Word + Next
                if (idx - 1 >= 0 && idx + 1 < words.length) {
                    results.push(`${words[idx - 1]} ${words[idx]} ${words[idx + 1]}`);
                }
            }
        });

        return results.slice(0, 3);
    }

    /**
     * Fetch collocations from Datamuse API
     */
    async function fetchDatamuseCollocations(word) {
        try {
            // rel_jjb: Adjectives that describe the noun
            // rel_jja: Nouns that can be described by the adjective
            // For general, we use both and filter
            const [adjOfNoun, nounOfAdj] = await Promise.all([
                fetch(`https://api.datamuse.com/words?rel_jjb=${word}&max=5`).then(r => r.json()),
                fetch(`https://api.datamuse.com/words?rel_jja=${word}&max=5`).then(r => r.json())
            ]);

            return [...adjOfNoun, ...nounOfAdj].map(item => {
                // Return in a format that looks like a phrase
                if (adjOfNoun.includes(item)) return `${item.word} ${word}`;
                return `${word} ${item.word}`;
            });
        } catch (e) {
            log.warn('Datamuse fetch failed:', e);
            return [];
        }
    }

    /**
     * Get best collocations using multi-source rater
     */
    async function getBestCollocations(word) {
        const wordClean = word.toLowerCase().trim();
        const sources = {
            local: getCollocations(wordClean),
            datamuse: await fetchDatamuseCollocations(wordClean)
        };

        const allCandidates = [
            ...sources.local.map(p => ({ phrase: p, source: 'local' })),
            ...sources.datamuse.map(p => ({ phrase: p, source: 'datamuse' }))
        ];

        // Rate each
        const rated = allCandidates.map(c => ({
            phrase: c.phrase,
            score: CollocationRater.score(c.phrase, wordClean)
        }));

        // Sort by score and return unique phrases
        const sorted = rated.sort((a, b) => b.score - a.score);
        const unique = [];
        const seen = new Set();

        for (const item of sorted) {
            if (!seen.has(item.phrase)) {
                unique.push(item);
                seen.add(item.phrase);
            }
        }

        return unique.map(u => u.phrase);
    }

    // ============================================
    // MORE HELP! SCAFFOLDING FUNCTIONS
    // ============================================

    // Tatoeba cache for example sentences
    const tatoebaCache = new Map();
    let scaffoldingLoadedForWord = null;

    function getCurrentScaffoldingWord() {
        const current = reviewSession.wordsToReview?.[reviewSession.currentIndex] || null;
        const word = current?.lemma || current?.originalWord || '';
        return String(word || '').trim();
    }

    function ensureMoreHelpLabelSpan() {
        const btn = elements.moreHelpBtn;
        if (!btn) return null;

        const existing = btn.querySelector('.more-help-label');
        if (existing) return existing;

        const label = document.createElement('span');
        label.className = 'more-help-label';

        const text = Array.from(btn.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Remove existing text nodes so we can reliably toggle just the label text.
        Array.from(btn.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .forEach((n) => n.remove());

        label.textContent = text || '💡 Need more help?';
        btn.appendChild(label);
        return label;
    }

    function setMoreHelpButtonLabel(isOpen) {
        const label = ensureMoreHelpLabelSpan();
        if (!label) return;
        label.textContent = isOpen ? '✖️ Close help' : '💡 Need more help?';
    }

    function resetWritingChallengeScaffolding() {
        scaffoldingLoadedForWord = null;

        if (elements.scaffoldingPanel) {
            elements.scaffoldingPanel.classList.remove('visible');
        }

        if (elements.moreHelpBtn) {
            elements.moreHelpBtn.classList.remove('active');
            setMoreHelpButtonLabel(false);

            const pulseRing = elements.moreHelpBtn.querySelector('.pulse-ring');
            if (pulseRing && elements.moreHelpBtn.dataset.pulseHidden === '1') {
                pulseRing.style.display = 'none';
            }
        }

        if (elements.exampleSentencesList) {
            elements.exampleSentencesList.innerHTML = '<li class="example-sentence-item loading">Loading examples...</li>';
        }
        if (elements.scaffoldingExtras) {
            elements.scaffoldingExtras.innerHTML = '';
        }
    }

    /**
     * Toggle scaffolding panel visibility
     */
    async function toggleScaffolding() {
        const panel = elements.scaffoldingPanel;
        const btn = elements.moreHelpBtn;
        if (!panel) return;

        const isVisible = panel.classList.contains('visible');

        // Hide pulse ring on first interaction
        const pulseRing = btn ? btn.querySelector('.pulse-ring') : null;
        if (pulseRing) {
            pulseRing.style.display = 'none';
            if (btn) btn.dataset.pulseHidden = '1';
        }

        if (isVisible) {
            panel.classList.remove('visible');
            if (btn) {
                btn.classList.remove('active');
                setMoreHelpButtonLabel(false);
            }
        } else {
            panel.classList.add('visible');
            if (btn) {
                btn.classList.add('active');
                setMoreHelpButtonLabel(true);
            }

            const word = getCurrentScaffoldingWord();
            const key = word ? word.toLowerCase() : '';
            if (word && scaffoldingLoadedForWord !== key) {
                const loaded = await loadScaffoldingContent(word);
                if (loaded) scaffoldingLoadedForWord = key;
            }
        }
    }

    /**
     * Load scaffolding content (example sentences + Enhanced Scaffolding)
     */
    async function loadScaffoldingContent(word) {
        if (!word) return false;

        const sentences = await fetchTatoebaSentences(word);
        displayExampleSentences(sentences, word);

        await displayEnhancedScaffolding(word);
        return true;
    }

    /**
     * Fetch example sentences with fallback
     */
    async function fetchTatoebaSentences(word) {
        const currentWord = reviewSession.wordsToReview.find(w =>
            (w.originalWord || w.lemma).toLowerCase() === word.toLowerCase()
        ) || reviewSession.wordsToReview[reviewSession.currentIndex];

        // 1. Check if word object already has an example
        if (currentWord && (currentWord.example || currentWord.sentence)) {
            return [currentWord.example || currentWord.sentence];
        }

        const cacheKey = word.toLowerCase();
        if (tatoebaCache.has(cacheKey)) {
            return tatoebaCache.get(cacheKey);
        }

        try {
            let sentences = [];

            // 2. Try DictionaryService (Tracau.vn) FIRST as requested
            // This provides high-quality bilingual sentences
            if (window.DictionaryService && window.DictionaryService.getWordData) {
                try {
                    const data = await window.DictionaryService.getWordData(word);
                    // Use Tracau sentences if available
                    if (data && data.sentences && data.sentences.length > 0) {
                        // Map to extract just the English sentence if it's an object {en, vi}, or use string
                        sentences = data.sentences
                            .filter(s => s && (typeof s === 'string' || s.en)) // Filter invalid entries
                            .map(s => typeof s === 'string' ? s : s.en);

                        log.debug('Loaded sentences from DictionaryService (Tracau):', sentences.length);
                    }
                } catch (e) {
                    log.warn('DictionaryService sentence fetch failed:', e);
                    // Continue to fallbacks
                }
            }

            // 3. Fallback to Backend Tatoeba Proxy if needed
            if (sentences.length === 0) {
                // Use local proxy to avoid CORS
                try {
                    // Create a timeout promise (2000ms = 2s)
                    const fetchWithTimeout = (url, ms = 2000) => {
                        return new Promise((resolve, reject) => {
                            const timer = setTimeout(() => reject(new Error('Timeout')), ms);
                            fetch(url).then(response => {
                                clearTimeout(timer);
                                resolve(response);
                            }, err => {
                                clearTimeout(timer);
                                reject(err);
                            });
                        });
                    };

                    const response = await fetchWithTimeout(`/api/tatoeba?word=${encodeURIComponent(word)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.sentences && data.sentences.length > 0) {
                            sentences = data.sentences;
                        }
                    }
                } catch (backendErr) {
                    log.warn('Backend sentences fetch failed or timed out:', backendErr);
                    // Continue to fallbacks immediately
                }
            }

            // 4. Fallback to DictionaryService definitions
            if (sentences.length === 0 && window.DictionaryService) {
                const data = await window.DictionaryService.getDefinition(word);
                if (data && data.meanings) {
                    for (const m of data.meanings) {
                        if (m.definitions) {
                            for (const d of m.definitions) {
                                if (d.example) sentences.push(d.example);
                            }
                        }
                    }
                }
            }

            if (sentences.length > 0) {
                tatoebaCache.set(cacheKey, sentences.slice(0, 3));
                return sentences.slice(0, 3);
            }

            return [];

        } catch (error) {
            log.warn('Error fetching sentences:', error);
            return [];
        }
    }

    /**
     * Display enhanced scaffolding: Syllable Breakdown, Synonyms, POS, Sentence Patterns
     */
    /**
    * Display enhanced scaffolding: Syllable Breakdown, Synonyms, POS, Sentence Patterns
    */
    /**
    * Display enhanced scaffolding: POS, Synonyms, Example phrases
    */
    async function displayEnhancedScaffolding(word) {
        const currentWord = reviewSession.wordsToReview[reviewSession.currentIndex];

        // 1. Update Compact Header POS (Moved from body to header)
        const posTag = document.getElementById('writing-pos-tag');
        let pos = currentWord?.partOfSpeech?.toLowerCase() || '';
        const posMap = { 'n': 'noun', 'v': 'verb', 'adj': 'adjective', 'adv': 'adverb' };
        if (posMap[pos]) pos = posMap[pos];

        if ((!pos || pos === 'unknown') && typeof nlp !== 'undefined') {
            const doc = nlp(word);
            if (doc.nouns().found) pos = 'noun';
            else if (doc.verbs().found) pos = 'verb';
            else if (doc.adjectives().found) pos = 'adjective';
        }

        if (posTag) {
            if (pos) {
                posTag.textContent = pos;
                posTag.style.display = 'inline-block';
                // Color coding based on POS
                if (pos === 'verb') posTag.style.color = '#d97706'; // amber
                else if (pos === 'noun') posTag.style.color = '#0284c7'; // blue
                else if (pos === 'adjective') posTag.style.color = '#059669'; // green
                else posTag.style.color = '#7c3aed'; // purple
                posTag.style.backgroundColor = posTag.style.color + '15'; // 10% opacity
            } else {
                posTag.style.display = 'none';
            }
        }

        const container = elements.scaffoldingExtras;
        if (!container) return;
        container.innerHTML = '';

        // 2. Synonyms (Only real data, no fake examples)
        if (window.DictionaryService) {
            try {
                const data = await window.DictionaryService.getDefinition(word);
                if (data && data.synonyms && data.synonyms.length > 0) {
                    const synonymsHtml = `<div class="scaffold-section"><h4>📚 Synonyms</h4><div class="context-content">${data.synonyms.slice(0, 5).join(', ')}</div></div>`;
                    container.innerHTML = synonymsHtml;
                }
            } catch (e) { }
        }

        // NOTE: "Example Phrases" (fake patterns) have been removed as per user feedback ("unmeaningful").
        // We now rely on Tracau "Example Sentences" which are high quality.
    }

    /**
     * Display example sentences
     */
    function displayExampleSentences(sentences, word) {
        const list = elements.exampleSentencesList;
        if (!list) return;

        if (sentences.length === 0) {
            list.innerHTML = '<li class="example-sentence-item no-examples">No examples available.</li>';
            return;
        }

        list.innerHTML = sentences.map(s =>
            `<li class="example-sentence-item">${highlightWord(s, word)}</li>`
        ).join('');
    }

    function highlightWord(sentence, word) {
        const regex = new RegExp(`\\b(${word})\\b`, 'gi');
        return sentence.replace(regex, '<strong class="highlight-word">$1</strong>');
    }

    /**
     * Save user sentence to Firestore Subcollection
     */
    async function saveUserSentence(uid, word, sentence, feedback) {
        if (!uid || !db) return;
        try {
            const historyRef = collection(db, 'users', uid, 'writingHistory');
            await addDoc(historyRef, {
                word,
                sentence,
                feedback,
                timestamp: serverTimestamp(),
                algorithm: currentAlgorithm // Track which algo was active
            });
            log.debug('Saved writing history for:', word);
        } catch (e) {
            log.error('Failed to save writing history:', e);
        }
    }

    /**
     * Save draft to localStorage with Timestamp
     */
    function saveDraft(word, text) {
        try {
            const key = `srs_draft_${word}`;
            if (text.trim()) {
                const payload = JSON.stringify({
                    text: text,
                    time: Date.now()
                });
                localStorage.setItem(key, payload);
            } else {
                localStorage.removeItem(key);
            }
        } catch (e) { log.warn('Draft save failed', e); }
    }

    /**
     * Load draft from localStorage
     */
    function loadDraft(word) {
        try {
            const val = localStorage.getItem(`srs_draft_${word}`);
            if (!val) return '';

            // Try parse as JSON (new format)
            try {
                const parsed = JSON.parse(val);
                return parsed.text || '';
            } catch (jsonErr) {
                // Fallback: it's likely old plain text
                return val;
            }
        } catch (e) { return ''; }
    }

    /**
     * Cleanup old drafts (> 7 days)
     */
    function cleanupDrafts() {
        try {
            log.debug('Running draft cleanup...');
            const now = Date.now();
            const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
            let removedCount = 0;

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('srs_draft_')) {
                    const val = localStorage.getItem(key);
                    try {
                        const parsed = JSON.parse(val);
                        if (parsed.time && (now - parsed.time > SEVEN_DAYS)) {
                            localStorage.removeItem(key);
                            removedCount++;
                        }
                    } catch (e) {
                        // Ignore non-JSON or old format for now, or expire them?
                        // Let's keep old format until user overwrites
                    }
                }
            }
            if (removedCount > 0) log.debug(`Cleaned up ${removedCount} old drafts.`);
        } catch (e) { log.warn('Cleanup failed:', e); }
    }

    /**
     * Clear draft
     */
    function clearDraft(word) {
        try {
            localStorage.removeItem(`srs_draft_${word}`);
        } catch (e) { }
    }

    /**
     * Generate AI Prompt via Backend Proxy
     */
    async function generateAiPrompt(wordObj, userLevel) {
        try {
            const lemma = wordObj.lemma || wordObj.originalWord;
            const pos = wordObj.partOfSpeech || 'word';
            const theme = wordObj.theme || 'general daily life';

            const aiPrompt = `Role: Supportive A2-B1 English Tutor for Vietnamese learners.
            Task: Generate a concrete, situational writing prompt for the word "${lemma}" (${pos}).
            
            Instructions:
            1. ALWAYS include the target word "${lemma}" in your prompt instructions.
            2. Describe a specific, relatable scenario (at home, work, market, travel).
            3. Keep the situation detailed enough so the user knows exactly what to write about.
            4. Keep language simple (A2-B1 level).
            5. Ensure the prompt is under 25 words.
            
            Format: "Scenario: [relatable-situation]. Task: Write a sentence using **${lemma}** to [action]."
            
            Example for "market": 
            Scenario: You are at a busy local market in Hanoi. Task: Write a sentence using **market** to describe what you are buying.
            
            Output: Just the Scenario and Task text.`;

            const response = await fetch('/api/ai-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: aiPrompt,
                    model: 'meta-llama/Llama-3.1-8B-Instruct',
                    max_tokens: 150
                })
            });

            const data = await response.json();

            if (data.fallback || data.error) {
                log.warn('AI Prompt Fallback triggered:', data.error);
                throw new Error('AI Fallback');
            }

            let generatedText = data.generated_text || '';
            generatedText = generatedText.replace(/Role:.*Task: .*/gs, '').trim();

            if (!generatedText) throw new Error('Empty AI response');

            return {
                prompt: generatedText,
                starter: '',
                usedCollocation: null,
                type: 'ai-generated',
                showStarter: false
            };
        } catch (error) {
            log.warn('AI Prompt Generation failed:', error);
            return null;
        }
    }

    /**
     * Assess Sentence via Backend Proxy
     */
    async function assessSentence(sentence, word) {
        if (!navigator.onLine) return null;
        try {
            const aiPrompt = `You are an encouraging English tutor for A2-B1 level learners. 
            Your task is to evaluate a short writing piece based on a specific target vocabulary word/phrase.

            Target: "${word}"
            User Input: "${sentence}"

            ### Rubric (Total 100%)
            1. Target Vocabulary (40%): Correct usage of "${word}".
            2. Content (15%): Relevance.
            3. Clarity (15%): Easy to understand.
            4. Organization (15%): Logical flow.
            5. Grammar (15%): Basic accuracy.

            ### Instructions
            1. Analyze the user's text.
            2. Provide a score (1-5 scale mapped to criteria).
            3. Provide "Sandwich Feedback":
               - 👍 What went well.
               - 💡 Specific improvement (Actionable).
               - 💪 Encouragement.
            
            Output format: HTML string.
            Start with <div class="ai-feedback-container">
            <div class="ai-score-badge">Score: X/5</div>
            <ul class="feedback-list">
              <li>👍 [Positive]</li>
              <li>💡 [Improvement]</li>
              <li>💪 [Encouragement]</li>
            </ul>
            <details><summary>Details</summary>[Brief explanation]</details>
            </div>`;

            const response = await fetch('/api/ai-feedback-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: aiPrompt,
                    model: 'meta-llama/Llama-3.1-8B-Instruct',
                    max_tokens: 200
                })
            });

            if (!response.ok) throw new Error(`Stream error: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            // Get the feedback feedback container if it exists to stream directly (optional)
            // For now, we'll accumulate and return, but the infrastructure is ready for UI streaming
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                                fullText += data.choices[0].delta.content;
                            }
                        } catch (e) {
                            // Ignore parse errors for partial chunks
                        }
                    }
                }
            }

            return fullText.replace(/Evaluate this.*/s, '').trim();
        } catch (e) {
            log.warn('AI Assessment failed:', e);
            return null;
        }
    }

    /**
     * Generate a contextually meaningful writing prompt
     * 
     * CORE RULE: Do NOT generate prompts using only the word.
     * Use collocations and definitions to create context.
     * 
     * @param {Object} wordObj - The word object with lemma, definition, etc.
     * @param {number} userLevel - Current user level (1+)
     * @returns {Object} { prompt, starter, usedCollocation, type, showStarter }
     */
    /**
     * Template-based Prompt Generator (Original Logic)
     * Renamed from generateWritingPrompt
     */
    function generateTemplatePrompt(wordObj, userLevel) {
        const lemma = wordObj.lemma || wordObj.originalWord;
        const collocations = getCollocations(lemma, wordObj);

        // Helper to pick random item
        const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

        // Determine difficulty level
        const isBeginner = userLevel < 5;
        const isExpert = userLevel >= 15;

        // ============================================
        // STRATEGY 1: COLLOCATION-BASED (PRIMARY)
        // ============================================
        if (collocations && collocations.length > 0) {
            const collocation = pickRandom(collocations);
            let prompt = '';
            let starter = '';
            let showStarter = true;

            // ============================================
            // COLLOCATION CLASSIFICATION
            // Verb-phrase: starts with a verb (make, take, get, etc.)
            // Noun-phrase: starts with article, adjective, or noun
            // ============================================
            const firstWord = collocation.split(' ')[0].toLowerCase();

            // Common verbs that start verb-phrase collocations
            const VERB_STARTERS = [
                'make', 'take', 'get', 'give', 'do', 'have', 'keep', 'pay', 'break',
                'catch', 'come', 'go', 'run', 'set', 'put', 'bring', 'hold', 'lose',
                'find', 'reach', 'meet', 'face', 'draw', 'raise', 'build', 'create',
                'develop', 'achieve', 'gain', 'maintain', 'improve', 'enhance',
                'made', 'took', 'got', 'gave', 'did', 'had', 'kept', 'paid' // past tense
            ];

            // Articles and determiners that start noun-phrase collocations
            const NOUN_PHRASE_STARTERS = ['a', 'an', 'the', 'my', 'your', 'his', 'her', 'their', 'our', 'its'];

            const isVerbPhrase = VERB_STARTERS.includes(firstWord) ||
                (typeof nlp !== 'undefined' && nlp(firstWord).verbs().found);
            const startsWithArticle = NOUN_PHRASE_STARTERS.includes(firstWord);

            // If not a verb phrase, treat as noun phrase
            const isNounPhrase = !isVerbPhrase;

            // ============================================
            // VERB-PHRASE TEMPLATES
            // ============================================
            // ============================================
            // GENERIC PHRASE TEMPLATES (Simpler & Safer)
            // ============================================
            const verbPhrasePromptTemplates = [
                `Write a sentence using the phrase "${collocation}".`,
                `Describe a situation involving "${collocation}".`,
                `Use "${collocation}" in a sentence.`
            ];

            const verbPhraseStarterTemplates = [
                `I ${collocation} when...`,
                `I had to ${collocation} because...`,
                `It is important to ${collocation} because...`
            ];

            // ============================================
            // NOUN-PHRASE TEMPLATES
            // ============================================
            const nounPhrasePromptTemplates = [
                `Write a sentence about "${collocation}".`,
                `Describe a situation involving "${collocation}".`,
                `Use "${collocation}" in a sentence.`
            ];

            const nounPhraseStarterTemplates = [
                `My ${collocation} is...`,
                `The ${collocation} helps to...`,
                `I learned about ${collocation} when...`
            ];

            // Select appropriate templates based on collocation type
            const collocationPromptTemplates = isVerbPhrase ? verbPhrasePromptTemplates : nounPhrasePromptTemplates;
            const collocationStarterTemplates = isVerbPhrase ? verbPhraseStarterTemplates : nounPhraseStarterTemplates;

            if (isBeginner) {
                // Beginner: Simpler prompts
                if (isVerbPhrase) {
                    prompt = pickRandom([
                        `Write one sentence about "${collocation}".`,
                        `Use "${collocation}" in a simple sentence.`
                    ]);
                } else {
                    prompt = pickRandom([
                        `Write one sentence about ${collocation}.`,
                        `Why is ${collocation} important?`
                    ]);
                }
                starter = pickRandom(collocationStarterTemplates);
                showStarter = true;
            } else if (isExpert) {
                // Expert: More challenging, optional second collocation
                if (collocations.length > 1) {
                    let secondCollocation;
                    do {
                        secondCollocation = pickRandom(collocations);
                    } while (secondCollocation === collocation);
                    prompt = `Write a complex sentence using either "${collocation}" or "${secondCollocation}".`;
                } else {
                    prompt = pickRandom(collocationPromptTemplates);
                }
                starter = ''; // Expert gets no starter
                showStarter = false;
            } else {
                // Intermediate: Full contextual prompts
                prompt = pickRandom(collocationPromptTemplates);
                starter = pickRandom(collocationStarterTemplates);
                showStarter = true;
            }

            return {
                prompt,
                starter: starter,
                usedCollocation: collocation,
                type: isVerbPhrase ? 'verb-collocation' : 'noun-collocation',
                showStarter: showStarter
            };
        }

        // ============================================
        // STRATEGY 2: DEFINITION-BASED (FALLBACK)
        // Only used when no collocations exist
        // ============================================
        if (wordObj.definition) {
            // Definition-based templates using base verb (lemma)
            const definitionPromptTemplates = [
                `Write a sentence using the word "${lemma}".`,
                `Describe a situation where you might use "${lemma}".`,
                `Write a valid sentence containing "${lemma}".`
            ];

            const definitionStarterTemplates = [
                `An example of ${lemma} is when...`,
                `I once saw someone ${lemma}...`,
                `${lemma.charAt(0).toUpperCase() + lemma.slice(1)} happened when...`
            ];

            return {
                prompt: pickRandom(definitionPromptTemplates),
                starter: pickRandom(definitionStarterTemplates),
                usedCollocation: null,
                type: 'definition',
                showStarter: true
            };
        }

        // ============================================
        // STRATEGY 3: ULTIMATE FALLBACK
        // Should rarely happen - word has no collocations AND no definition
        // ============================================
        return {
            prompt: `Write a clear sentence using the word "**${lemma}**".`,
            starter: `I think ${lemma} is...`,
            usedCollocation: null,
            type: 'generic',
            showStarter: true
        };
    }

    /**
     * Main Prompt Generator (Hybrid AI + Template)
     */
    async function generateWritingPrompt(wordObj, userLevel) {
        const lemma = wordObj.lemma || wordObj.originalWord;

        // Phase 2: Orchestrate multisource collocations
        if (!wordObj.bestCollocations) {
            log.debug('Fetching best collocations for Writing Challenge:', lemma);
            wordObj.bestCollocations = await getBestCollocations(lemma);

            // Source 3: Sample extraction if still low on collocations
            if (wordObj.bestCollocations.length < 2) {
                const examples = [wordObj.example, wordObj.sentence].filter(Boolean);
                if (examples.length > 0) {
                    const extracted = extractCollocations(lemma, examples);
                    wordObj.bestCollocations = [...wordObj.bestCollocations, ...extracted];
                }
            }
        }

        // 1. Collocation Selection (PTE vs Fallback) - PRIORITIZED
        // This allows user to choose their target phrase before AI generates a scenario if needed
        const selectionPrompt = await generateSelectionPrompt(wordObj, userLevel);
        if (selectionPrompt && selectionPrompt.type === 'multi-option') {
            return selectionPrompt;
        }

        // 2. Try AI Generation (Fallback for single-option or no-option scenarios)
        if (navigator.onLine) {
            const aiResult = await generateAiPrompt(wordObj, userLevel);
            if (aiResult) return aiResult;
        }

        return selectionPrompt; // Final fallback (will be template or definition)

    }

    /**
     * Generate Multi-Option Prompt (PTE vs Fallback)
     */
    async function generateSelectionPrompt(wordObj, userLevel) {
        const lemma = wordObj.lemma || wordObj.originalWord;

        // 1. Get PTE Collocations (Local)
        const pteCollocations = getCollocations(lemma); // Returns strings

        // 2. Get Fallback (Datamuse/Other)
        // We need to fetch fresh to ensure we have alternatives if PTE is empty or to offer variety
        let fallbackCollocations = [];
        if (navigator.onLine) {
            fallbackCollocations = await fetchDatamuseCollocations(lemma);
        }

        // 3. Selection Logic
        let optionA = null; // Represents PTE
        let optionB = null; // Represents Fallback

        // Pick Option A (PTE)
        if (pteCollocations && pteCollocations.length > 0) {
            // Pick random PTE
            optionA = {
                text: pteCollocations[Math.floor(Math.random() * pteCollocations.length)],
                source: 'PTE Academic'
            };
        }

        // Pick Option B (Fallback)
        // Ensure it is different from Option A
        const candidates = [...fallbackCollocations, ...(pteCollocations || [])];
        const distinctCandidates = candidates.filter(c => !optionA || c.toLowerCase() !== optionA.text.toLowerCase());

        if (distinctCandidates.length > 0) {
            optionB = {
                text: distinctCandidates[Math.floor(Math.random() * distinctCandidates.length)],
                source: 'Common Usage'
            };
        }

        // If we still don't have 2 options?
        if (!optionA && !optionB) {
            // Fallback to definition-based single prompt (legacy)
            return generateTemplatePrompt(wordObj, userLevel);
        }

        if (!optionA && optionB) {
            // Treat B as A if no PTE
            optionA = optionB;
            optionA.source = 'Recommended';
            optionB = null;
        }

        // Construct Options Payload
        return {
            type: 'multi-option',
            options: [optionA, optionB].filter(Boolean),
            showStarter: false,
            // Base prompt info (will be refined by selection)
            prompt: 'Choose a phrase to write about:',
            starter: ''
        };
    }

    /**
     * Template-based Prompt Generator (Legacy/Fallback)
     */
    /**
     * Helper: Calculate User Level
     */
    function calculateUserLevel() {
        const points = srsCache.totalPoints || 0;
        return Math.floor(points / 100) + 1;
    }

    function applyAIScoreToSRS(lemma, score) {
        const item = srsCache.srsData[lemma];
        if (!item) return;

        // Skip adjustment for brand new items (learning step < 1 day) to avoid messing up learning phase
        if (item.interval < 1 && item.state !== 'mastered') return;

        let modifier = 1.0;
        let msg = "";
        let type = "info";

        if (score === 5) {
            modifier = 1.25; // +25% Boost
            msg = "Perfect! Interval boosted +25%";
            type = "success";
        } else if (score === 4) {
            modifier = 1.1; // +10% Boost
            msg = "Good job! Interval boosted +10%";
            type = "success";
        } else if (score === 3) {
            // Neutral / Slight refinement needed
            return;
        } else if (score <= 2) {
            modifier = 0.75; // -25% Penalty
            msg = "Review context. Interval tightened.";
            type = "warning";
        }

        const oldInterval = item.interval;
        // Apply modifier, ensuring at least 1 day if it was >= 1
        let newInterval = Math.round(oldInterval * modifier);
        if (oldInterval >= 1) newInterval = Math.max(1, newInterval);

        if (newInterval !== oldInterval) {
            log.debug(`[SRS AI] Adjusting ${lemma} interval: ${oldInterval}d -> ${newInterval}d (Score: ${score})`);

            item.interval = newInterval;

            // Recalculate next date based on LAST review date
            const lastReview = item.lastReviewDate ? new Date(item.lastReviewDate) : new Date();
            const nextDate = new Date(lastReview);
            nextDate.setDate(nextDate.getDate() + newInterval);

            item.nextReviewDate = nextDate.toISOString();

            // Persist (Per-card for Zero Trust + Debounced summary)
            saveCardSRS(lemma, item);
            debouncedSave();

            // Show Toast
            if (typeof showToast === 'function') {
                showToast(msg, type);
            }
        }
    }

    /**
     * Legacy Bridge for Writing Challenge
     */
    function showWritingChallenge(wordObj, onComplete, uniqueId) {
        // Reset scaffolding UI/state per challenge so "More help" loads the correct word.
        resetWritingChallengeScaffolding();
        reviewSession.currentWritingWord = wordObj?.lemma || wordObj?.originalWord || '';

        const resolvedId = (typeof uniqueId === 'string' && uniqueId.length > 0)
            ? uniqueId
            : 'manual_' + Date.now();

        if (writingChallenge) {
            writingChallenge.show(wordObj, calculateUserLevel(), resolvedId, onComplete);
        } else {
            console.warn('WritingChallenge module not initialized');
            if (onComplete) onComplete();
        }
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `srs-toast srs-toast-${type}`;
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: ${type === 'warning' ? '#f59e0b' : '#1e293b'};
            color: white;
            padding: 12px 20px;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 3000;
            font-size: 0.9rem;
            font-weight: 500;
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        const icon = type === 'warning' ? '⚠️' : 'ℹ️';
        toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.style.transform = 'translateY(0)';
            toast.style.opacity = '1';
        });

        // Hide after 4 seconds
        setTimeout(() => {
            toast.style.transform = 'translateY(20px)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    /**
     * Accessibility (a11y) Features
     */
    function setupAccessibility() {
        // Apply ARIA roles and labels to modals
        if (elements.srsPanel) {
            elements.srsPanel.setAttribute('role', 'dialog');
            elements.srsPanel.setAttribute('aria-modal', 'true');
            elements.srsPanel.setAttribute('aria-label', 'Vocabulary Review Session');
        }
        if (elements.srsWritingModal) {
            elements.srsWritingModal.setAttribute('role', 'dialog');
            elements.srsWritingModal.setAttribute('aria-modal', 'true');
            elements.srsWritingModal.setAttribute('aria-label', 'Writing Challenge');
        }

        // Global Escape key handler
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (elements.srsWritingModal && elements.srsWritingModal.classList.contains('visible')) {
                    closeWritingChallenge();
                } else if (elements.srsPanel && elements.srsPanel.classList.contains('active')) {
                    closeReviewPanel();
                }
            }
        });
    }

    /**
     * Focus Trapping Logic
     */
    function trapFocus(modal) {
        const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusableElements.length === 0) return;

        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        modal.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') {
                if (e.shiftKey) { // Shift + Tab
                    if (document.activeElement === firstFocusable) {
                        lastFocusable.focus();
                        e.preventDefault();
                    }
                } else { // Tab
                    if (document.activeElement === lastFocusable) {
                        firstFocusable.focus();
                        e.preventDefault();
                    }
                }
            }
        });
    }

    /**
     * Offline Sync Helper: Check and retry
     */
    function checkOfflineSync() {
        if (navigator.onLine) {
            const pending = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (pending) {
                log.debug('Pending data found, attempt sync...');
                debouncedSave();
            }
        }
    }

    let isInitialized = false;
    function initModule() {
        if (isInitialized) return;
        init();
        setupAccessibility(); // Add a11y on init
        checkOfflineSync();    // Sync if online
        isInitialized = true;
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModule);
    } else {
        initModule();
    }

    // Public API
    return {
        setUser,
        initializeWord,
        getWordsDueForReview,
        startReviewSession,
        getWordData,
        init: initModule,
        renderScheduleTable,
        showWritingChallenge, // Expose for testing/manual triggering
        openSettings // Expose for Settings button
    };

})();

// Expose to window
if (typeof window !== 'undefined') {
    window.SRSReview = SRSReview;
}
