/**
 * Spaced Repetition System (SRS) Module
 * Implements SM-2 algorithm for optimal vocabulary review scheduling
 * Uses modular Firebase v9+ API
 */

import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const SRSReview = (function () {
    'use strict';

    // Firebase references
    let db = null;
    let currentUserId = null;

    // SRS Data Cache
    let srsCache = {
        srsData: {},        // Per-word SRS tracking
        reviewStats: {
            totalReviews: 0,
            reviewsToday: 0,
            lastReviewSession: null,
            streak: 0,
            longestStreak: 0
        },
        masteredWords: []   // Archive of mastered words
    };

    // Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;
    let currentTranscription = "";

    // Current review session state
    let reviewSession = {
        active: false,
        wordsToReview: [],
        currentIndex: 0,
        sessionResults: [],  // Track results for session summary
        startTime: null
    };

    // Definition cache to avoid API spam
    const definitionCache = new Map();

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
            console.warn('[SRS] Custom alert modal missing, using native');
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
        console.log('[SRS] Module initialized');
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
            srsWritingFeedback: document.getElementById('srs-writing-feedback'),
            srsWritingSubmit: document.getElementById('srs-writing-submit'),
            srsWritingSkip: document.getElementById('srs-writing-skip'),
            srsWritingCloseBtn: document.getElementById('srs-writing-close-btn'), // NEW

            // Hint elements
            hintDefValue: document.getElementById('hint-def-value'),
            hintExampleValue: document.getElementById('hint-example-value'),
            hintCollocationsValue: document.getElementById('hint-collocations-value'),
            hintStarterValue: document.getElementById('hint-starter-value')
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

        // Writing Challenge Listeners
        if (elements.srsWritingSubmit) {
            elements.srsWritingSubmit.addEventListener('click', handleWritingSubmit);
        }
        if (elements.srsWritingSkip) {
            elements.srsWritingSkip.addEventListener('click', handleWritingSkip);
        }
        if (elements.srsWritingCloseBtn) {
            elements.srsWritingCloseBtn.addEventListener('click', closeWritingChallenge);
        }
    }

    /**
     * Set Firebase user reference
     */
    function setUser(userId, firestore) {
        currentUserId = userId;
        db = firestore || window.firebaseDb;

        if (userId && db) {
            loadSRSData();
        }
    }

    /**
     * Load SRS data from Firestore
     */
    async function loadSRSData() {
        if (!currentUserId || !db) return;

        try {
            const vocabDocRef = doc(db, 'users', currentUserId, 'vocabularyBook', 'data');
            const vocabDoc = await getDoc(vocabDocRef);

            if (vocabDoc.exists()) {
                const data = vocabDoc.data();
                srsCache.srsData = data.srsData || {};
                srsCache.reviewStats = data.reviewStats || {
                    totalReviews: 0,
                    reviewsToday: 0,
                    lastReviewSession: null,
                    streak: 0,
                    longestStreak: 0
                };
                srsCache.masteredWords = data.masteredWords || [];

                console.log('[SRS] Loaded SRS data:', {
                    words: Object.keys(srsCache.srsData).length,
                    stats: srsCache.reviewStats
                });
            }

            // Fetch User Points for Gamification
            const userDocRef = doc(db, 'users', currentUserId);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const userData = userDoc.data();
                srsCache.totalPoints = userData.practicePoints || 0;
                updateGamificationUI();
            }
        } catch (e) {
            console.error('[SRS] Error loading SRS data:', e);
        }
    }

    /**
     * Save SRS data to Firestore
     */
    async function saveSRSData() {
        if (!currentUserId || !db) return;

        try {
            const vocabDocRef = doc(db, 'users', currentUserId, 'vocabularyBook', 'data');
            await setDoc(vocabDocRef, {
                srsData: srsCache.srsData,
                reviewStats: srsCache.reviewStats,
                masteredWords: srsCache.masteredWords,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            console.log('[SRS] Saved SRS data');
        } catch (e) {
            console.error('[SRS] Error saving SRS data:', e);
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
            console.log('[SRS] Word already initialized:', lemma);
            // Update context data if provided (in case it's richer than what we have)
            if (contextData.definition && !srsCache.srsData[lemma].definition) {
                srsCache.srsData[lemma].definition = contextData.definition;
                srsCache.srsData[lemma].example = contextData.example || null;
                srsCache.srsData[lemma].partOfSpeech = contextData.partOfSpeech || 'unknown';
                srsCache.srsData[lemma].sentence = contextData.sentence || null;
                saveSRSData();
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

        console.log('[SRS] Initialized word:', lemma, 'POS:', contextData.partOfSpeech || 'unknown');
        saveSRSData();
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

    /**
     * Calculate next review using SM-2 algorithm
     * @param {number} quality - User rating (0-5, we use 1-5)
     * @param {object} currentData - Current SRS data for the word
     * @returns {object} - New interval, ease factor, and next review date
     */
    function calculateNextReview(quality, currentData) {
        let { interval, easeFactor, repetitions } = currentData;

        // SM-2 Algorithm
        // Quality: 1=Again, 3=Hard, 4=Good, 5=Easy

        if (quality < 3) {
            // Failed - reset to beginning
            repetitions = 0;
            interval = 1;
        } else {
            // Passed
            if (repetitions === 0) {
                // Initial grading: Map specific qualities to start intervals
                if (quality === 3) interval = 3;
                else if (quality === 4) interval = 6;
                else if (quality === 5) interval = 14;
                else interval = 1;
            } else if (repetitions === 1) {
                // Second review: Standard SM-2 jumps to 6, but if we started higher, multiply
                if (interval < 6) interval = 6;
                else interval = Math.round(interval * easeFactor);
            } else {
                interval = Math.round(interval * easeFactor);
            }
            repetitions++;
        }

        // Update ease factor
        // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        const efChange = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
        easeFactor = Math.max(SM2_MIN_EASE, easeFactor + efChange);

        // Calculate next review date
        const now = new Date();
        const nextDate = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);

        // Determine status
        let status = 'learning';
        if (repetitions >= 3) {
            status = 'reviewing';
        }
        if (repetitions >= MASTERY_THRESHOLD) {
            status = 'mastered';
        }

        return {
            interval,
            easeFactor: Math.round(easeFactor * 100) / 100,
            repetitions,
            nextReviewDate: nextDate.toISOString(),
            lastReviewDate: now.toISOString(),
            status
        };
    }

    /**
     * Start a review session
     * @param {boolean} forceEarly - If true, skip due check and review all words
     */
    async function startReviewSession(forceEarly = false) {
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
                console.log('[SRS] Auto-starting bonus session (few words)');
                // Fall through to start session with all words
            } else {
                // Show confirmation for early review
                showEarlyReviewConfirmation(allWords);
                return;
            }
        }

        // Use due words if available, otherwise all words (for early review)
        const wordsToReview = dueWords.length > 0 ? dueWords : allWords;

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

            if (lastSession.toDateString() === yesterday.toDateString()) {
                srsCache.reviewStats.streak++;
                if (srsCache.reviewStats.streak > srsCache.reviewStats.longestStreak) {
                    srsCache.reviewStats.longestStreak = srsCache.reviewStats.streak;
                }
            } else {
                // Streak broken
                srsCache.reviewStats.streak = 0;
            }

            srsCache.reviewStats.reviewsToday = 0;
        }
    }

    /**
     * Show the review panel
     */
    function showReviewPanel() {
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
    }

    /**
     * Close the review panel
     */
    function closeReviewPanel() {
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
            console.log('[SRS] Session closed early');
        }

        reviewSession.active = false;
    }

    /**
     * toggleRecording
     */
    function toggleRecording() {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
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
                console.log('[SRS] Configured Transcript:', currentTranscription);

                // Optional: Update UI to show what's being heard (if we had a display for it)
                // But user wants to check AFTER flip.
            };

            recognition.onerror = (event) => {
                console.error('[SRS] Speech recognition error', event.error);
                stopRecording();
            };

            recognition.start();

        } catch (e) {
            console.error('[SRS] Error starting recognition:', e);
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
                const shortPos = posMap[currentWord.partOfSpeech.toLowerCase()] || currentWord.partOfSpeech;
                displayText += ` (${shortPos})`;
            }

            elements.srsWord.textContent = displayText;
        }
        if (elements.srsWordFront) {
            elements.srsWordFront.textContent = currentWord.originalWord || currentWord.lemma;
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

        console.log(`[SRS] Word: ${wordToMask}, Context: ${!!exampleForFront}, Cloze Possible: ${canDoCloze}`);

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

        console.log(`[SRS] Mode Selected: ${selectedMode}. New Weights:`, JSON.stringify(reviewSession.modeWeights));
        console.log(`[SRS] Mode selected: ${reviewSession.currentMode}`);

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
            elements.srsDefinition.style.display = 'block';
            elements.srsDefinition.textContent = '...';
        }

        // Use DictionaryService if available
        if (typeof DictionaryService !== 'undefined') {
            try {
                // Use lemma for lookup
                let lookupWord = currentWord.lemma || wordToLookup;
                let wordData = await DictionaryService.getWordData(lookupWord, currentWord.partOfSpeech);

                // Check for obscure definition and retry with base form if needed
                const OBSCURE_KEYWORDS = ['iso 639', 'language code', 'grub', 'maggot', 'symbol for'];
                const isObscure = wordData.definition && OBSCURE_KEYWORDS.some(kw => wordData.definition.toLowerCase().includes(kw));

                if (isObscure) {
                    console.warn('[SRS] Obscure definition detected, trying base form...');
                    // Try common base forms (being -> be, made -> make, etc.)
                    const baseFormMap = {
                        'being': 'be', 'been': 'be',
                        'made': 'make', 'making': 'make',
                        'doing': 'do', 'done': 'do', 'did': 'do',
                        'going': 'go', 'went': 'go', 'gone': 'go'
                    };
                    const baseWord = baseFormMap[lookupWord.toLowerCase()] || lookupWord;
                    if (baseWord !== lookupWord) {
                        wordData = await DictionaryService.getWordData(baseWord, currentWord.partOfSpeech);
                    }
                }

                // Display Vietnamese translation
                if (elements.srsVietnamese) {
                    elements.srsVietnamese.textContent = wordData.vietnameseTranslation || '';
                }

                // Display English definition
                if (elements.srsDefinition) {
                    if (wordData.definition) {
                        elements.srsDefinition.style.display = 'block';
                        elements.srsDefinition.textContent = wordData.definition;
                    } else {
                        elements.srsDefinition.style.display = 'none';
                    }
                }

                // Display example sentence (prefer stored, fallback to fetched)
                if (elements.srsExample) {
                    const example = currentWord.example || currentWord.sentence || wordData.example || '';
                    elements.srsExample.textContent = example;
                }

                console.log('[SRS] Word data loaded:', wordToLookup, wordData);
            } catch (e) {
                console.warn('[SRS] DictionaryService failed:', e);
                // Fallback to stored data
                if (elements.srsVietnamese) elements.srsVietnamese.textContent = '';
                if (elements.srsDefinition) elements.srsDefinition.style.display = 'none';
                if (elements.srsExample) elements.srsExample.textContent = currentWord.example || currentWord.sentence || '';
            }
        } else {
            // DictionaryService not available, use stored data only
            if (elements.srsVietnamese) elements.srsVietnamese.textContent = '';
            if (elements.srsDefinition) elements.srsDefinition.style.display = 'none';
            if (elements.srsExample) elements.srsExample.textContent = currentWord.example || currentWord.sentence || '';
        }
    }

    /**
     * Show the answer (flip card)
     */
    function showAnswer() {
        if (elements.showAnswerBtn) elements.showAnswerBtn.style.display = 'none';
        if (elements.qualityBtns) elements.qualityBtns.style.display = 'flex';

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
                isCorrect = userSaid === targetWord;
            }
        } else {
            // Check Spoken Transcript
            // Stop recording if active
            stopRecording();
            userSaid = (currentTranscription || "").toLowerCase().trim();
            // Fuzzy match logic could go here
            isCorrect = userSaid === targetWord;
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

            // If flipped to back, ensure controls are shown (treat as Show Answer)
            if (elements.flashcard.classList.contains('flipped')) {
                if (elements.showAnswerBtn) elements.showAnswerBtn.style.display = 'none';
                if (elements.qualityBtns) elements.qualityBtns.classList.add('visible');
                if (elements.srsControls) elements.srsControls.classList.add('visible');

                // Auto-check on flip
                checkAnswerAndDisplay();
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

        // Start recording
        btn.classList.add('recording');
        btn.textContent = '🔴 Listening...';
        if (resultDiv) resultDiv.style.display = 'none';

        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 3;

        recognition.onresult = (event) => {
            btn.classList.remove('recording');
            btn.textContent = '🎙️ Try Again';

            const transcript = event.results[0][0].transcript.toLowerCase().trim();
            const confidence = event.results[0][0].confidence;

            // Check all alternatives for a match
            let isMatch = false;
            for (let i = 0; i < event.results[0].length; i++) {
                const alt = event.results[0][i].transcript.toLowerCase().trim();
                if (alt === targetWord || alt.includes(targetWord) || targetWord.includes(alt)) {
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

            console.log('[SRS] Pronunciation:', { transcript, targetWord, isMatch, confidence });
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
        console.log('[SRS] Skipping current word');

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

        // Check if word is now mastered
        if (newData.status === 'mastered') {
            console.log('[SRS] Word mastered:', lemma);
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

        // Save to Firestore
        await saveSRSData();

        // Reset flip animation
        if (elements.flashcard) {
            elements.flashcard.classList.remove('flipped');
        }

        // --- TRIGGER WRITING CHALLENGE ---
        // Only trigger if user CORRECTLY typed/pronounced the word
        // Use stored answer correctness from checkAnswerAndDisplay
        const wasCorrect = reviewSession.lastAnswerCorrect === true;

        // Only show Writing Challenge for nouns, verbs, adjectives, adverbs
        const ALLOWED_POS = ['noun', 'verb', 'adjective', 'adverb', 'n', 'v', 'adj', 'adv'];
        const currentPOS = (currentWord.partOfSpeech || '').toLowerCase();
        const isAllowedPOS = ALLOWED_POS.some(pos => currentPOS.includes(pos));

        if (wasCorrect && isAllowedPOS) {
            setTimeout(() => {
                showWritingChallenge(currentWord, () => {
                    // Reset flag AFTER challenge completes, then move to next word
                    reviewSession.lastAnswerCorrect = false;
                    reviewSession.currentIndex++;
                    showCurrentWord();
                });
            }, 300);
        } else {
            // Incorrect answer, no answer check, or non-content word: Move to next word directly
            reviewSession.lastAnswerCorrect = false;
            reviewSession.currentIndex++;
            showCurrentWord();
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
                console.warn('[SRS] Phonetics fetch failed:', e);
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
            return result;
        } catch (e) {
            console.warn('[SRS] Definition fetch failed for:', searchTerm);
            const result = { definition: '', example: '' };
            definitionCache.set(cacheKey, result);
            return result;
        }
    }

    /**
     * Award points to user
     */
    async function awardPoints(points, reason) {
        if (!currentUserId || !db) return;

        try {
            const userDocRef = doc(db, 'users', currentUserId);
            await updateDoc(userDocRef, {
                practicePoints: increment(points)
            });

            // Show toast if available
            if (window.showPointsToast) {
                window.showPointsToast(points, reason);
            }

            // Update local cache and UI
            if (typeof srsCache.totalPoints === 'undefined') srsCache.totalPoints = 0;
            srsCache.totalPoints += points;
            updateGamificationUI();

            console.log(`[SRS] Awarded ${points} points for ${reason}`);
        } catch (e) {
            console.error('[SRS] Error awarding points:', e);
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
                console.log('[SRS] Collocations loaded:', Object.keys(collocationsData).length, 'words');
            }
        } catch (e) {
            console.warn('[SRS] Could not load collocations.json:', e.message);
        }
    }

    // Get collocations for a word
    function getCollocations(word) {
        if (!collocationsData || !word) return [];
        const key = word.toLowerCase();
        return collocationsData[key] || [];
    }

    // Generate sentence starter based on POS
    function getSentenceStarter(word, pos) {
        const lowerPos = (pos || '').toLowerCase();
        if (lowerPos.startsWith('noun')) return `The ${word}...`;
        if (lowerPos.startsWith('verb')) return `I ${word}...`;
        if (lowerPos.startsWith('adj')) return `It was ${word}...`;
        if (lowerPos.startsWith('adv')) return `${word.charAt(0).toUpperCase() + word.slice(1)}, I...`;
        return `The ${word}...`;
    }

    function showWritingChallenge(wordObj, onComplete) {
        if (!elements.srsWritingModal) {
            if (onComplete) onComplete();
            return;
        }

        const word = wordObj.originalWord || wordObj.lemma;
        const lemma = wordObj.lemma || wordObj.originalWord; // Use lemma for lookups
        const pos = wordObj.partOfSpeech || 'unknown';
        const prompt = generateWritingPrompt(word, pos);

        // UI Setup - Prompt
        elements.srsWritingPrompt.textContent = prompt;
        elements.srsWritingInput.value = '';
        elements.srsWritingFeedback.style.display = 'none';
        elements.srsWritingFeedback.textContent = '';

        // Populate Hints - Use LEMMA for collocations
        let definition = wordObj.definition || wordObj.meaning || '-';
        const example = wordObj.example || wordObj.sentence || wordObj.context || '';
        const collocations = getCollocations(lemma).slice(0, 4); // Use lemma!
        const starter = getSentenceStarter(word, pos);

        // Check for obscure definitions and re-fetch if needed
        const OBSCURE_KEYWORDS = ['grub', 'maggot', 'iso 639', 'language code'];
        const isObscure = !definition || definition === '-' || OBSCURE_KEYWORDS.some(kw => definition.toLowerCase().includes(kw));

        if (isObscure && typeof DictionaryService !== 'undefined') {
            DictionaryService.getDefinition(lemma, pos).then(result => {
                if (result.definition && elements.hintDefValue) {
                    elements.hintDefValue.textContent = result.definition;
                }
            }).catch(() => { });
        }

        if (elements.hintDefValue) elements.hintDefValue.textContent = definition;
        if (elements.hintExampleValue) {
            elements.hintExampleValue.innerHTML = example ? `<em>"${example}"</em>` : '<em>None available</em>';
        }
        if (elements.hintCollocationsValue) {
            if (collocations.length > 0) {
                // Render as pill elements
                elements.hintCollocationsValue.innerHTML = collocations
                    .map(c => `<span class="collocation-pill">${c}</span>`)
                    .join('');
            } else {
                elements.hintCollocationsValue.innerHTML = '<em>None available</em>';
            }
        }
        if (elements.hintStarterValue) elements.hintStarterValue.textContent = starter;

        elements.srsWritingModal.classList.add('visible');
        setTimeout(() => elements.srsWritingInput.focus(), 100);

        // Store callback in session
        reviewSession.writingCallback = onComplete;
        reviewSession.currentChallengeWord = word.toLowerCase();
    }

    function generateWritingPrompt(word, pos) {
        const lowerPos = (pos || '').toLowerCase();

        // Fix grammar for prompts: Use lemma if possible, or generic phrasing
        // Avoid "mades" by checking if word ends in 's' for verbs? 
        // Better: specific prompts per form

        const templates = {
            verb: [
                `Write a sentence using the verb "${word}".`,
                `Describe a time when you "${word}" something.`,
                `Use "${word}" to describe an action.`
            ],
            adjective: [
                `Write a sentence using the adjective "${word}".`,
                `Describe something that is "${word}".`,
                `What makes a person or object "${word}"?`
            ],
            noun: [
                `Write a sentence using the noun "${word}".`,
                `Describe your experience with a "${word}".`,
                `Why is a "${word}" interesting or important?`
            ],
            adverb: [
                `Write a sentence using the adverb "${word}".`,
                `Describe an action done "${word}".`
            ],
            default: [
                `Write a sentence using the word "${word}".`,
                `Create a sentence that includes "${word}".`
            ]
        };

        let list;
        if (lowerPos.startsWith('verb')) list = templates.verb;
        else if (lowerPos.startsWith('adj')) list = templates.adjective;
        else if (lowerPos.startsWith('noun')) list = templates.noun;
        else if (lowerPos.startsWith('adv')) list = templates.adverb;
        else list = templates.default;

        return list[Math.floor(Math.random() * list.length)];
    }

    function handleWritingSubmit() {
        const sentence = elements.srsWritingInput.value.trim();
        const targetWord = reviewSession.currentChallengeWord;

        if (!sentence) return;

        // Validation (Heuristic)
        const issues = [];
        if (sentence.split(/\s+/).length < 3) issues.push("Sentence is too short (min 3 words).");
        if (!sentence.toLowerCase().includes(targetWord)) issues.push(`Sentence must contain the word "${targetWord}".`);
        if (!/[.!?]$/.test(sentence)) issues.push("Sentence must end with punctuation (. ! ?).");

        const feedback = elements.srsWritingFeedback;
        feedback.style.display = 'block';

        if (issues.length > 0) {
            feedback.className = 'srs-writing-feedback error';
            feedback.innerHTML = `<strong>❌ Not quite:</strong><br>${issues.join('<br>')}`;
        } else {
            feedback.className = 'srs-writing-feedback success';
            feedback.innerHTML = `<strong>✅ Great job!</strong><br>Sentence recorded.`;

            triggerConfetti();

            // Success delay
            setTimeout(() => {
                closeWritingChallenge(); // This now calls the callback
            }, 1000);
        }
    }

    function handleWritingSkip() {
        closeWritingChallenge(); // This now calls the callback
    }

    function closeWritingChallenge() {
        if (elements.srsWritingModal) {
            elements.srsWritingModal.classList.remove('visible');
        }
        // Call callback to proceed to next word (if not already called by submit/skip)
        if (reviewSession.writingCallback) {
            const cb = reviewSession.writingCallback;
            reviewSession.writingCallback = null; // Prevent double-call
            cb();
        }
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    return {
        setUser,
        initializeWord,
        getWordsDueForReview,
        getDueCount,
        startReviewSession,
        getStats,
        getWordData,
        loadData: loadSRSData
    };

})();

// Expose to window
if (typeof window !== 'undefined') {
    window.SRSReview = SRSReview;
}
