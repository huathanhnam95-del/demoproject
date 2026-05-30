/**
 * Take Notes Mode Module
 * Handles the Take Notes practice mode in the learner app
 * UI matches Type/Speak modes with question selector and filter dropdown
 * 
 * Flow: Select question → Play → Watch guiding video (if available) → Listen to audio + take notes → See results
 */

(function () {
    'use strict';

    const FIRESTORE_LOAD_TIMEOUT_MS = 8000;

    // State
    let entries = [];
    let filteredEntries = [];
    let currentEntryIndex = 0;
    let currentEntry = null;
    let notesPlayer = null;
    let isPlayerReady = false;
    let currentFilter = 'all'; // 'all', 'has-video', 'no-video'
    let isInitialized = false;
    let hasLoadedEntries = false;
    let loadEntriesPromise = null;
    let notesRecommendationEngine = null;
    let notesRecommendationIndex = null;
    let recentRecommendedIds = [];
    let notesAttemptStartTime = null;
    let notesPerformanceTracker = null;

    const REASON_LABELS = {
        level_and_continuity: 'Smart Match',
        difficulty_only: 'Difficulty Match',
        continuity_only: 'Vocabulary Match',
        fallback: 'Best Available Match'
    };

    // DOM Elements
    const elements = {};

    /**
     * Initialize Take Notes mode
     */
    function init() {
        if (isInitialized) {
            return;
        }

        cacheElements();
        if (!elements.questionSelect) {
            console.warn('[TakeNotes] UI elements not found, skipping init');
            return;
        }

        setupEventListeners();
        loadEntries();
        isInitialized = true;
    }

    /**
     * Reset UI state (called when switching away from Notes tab)
     */
    function reset() {
        // Hide practice area
        if (elements.practiceArea) {
            elements.practiceArea.style.display = 'none';
        }
        // Hide all steps
        if (elements.stepVideo) elements.stepVideo.style.display = 'none';
        if (elements.stepAudio) elements.stepAudio.style.display = 'none';
        if (elements.stepResults) elements.stepResults.style.display = 'none';

        // Clear YouTube player iframe to stop video playback
        if (elements.youtubePlayer) {
            elements.youtubePlayer.innerHTML = '';
        }

        // Stop any playing audio
        if (elements.audio) {
            elements.audio.pause();
            elements.audio.src = '';
        }
        // Clear user input
        if (elements.userInput) {
            elements.userInput.value = '';
        }
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        // Question selector elements
        elements.currentQuestionId = document.getElementById('current-question-id-notes');
        elements.backBtn = document.getElementById('back-btn-notes');
        elements.nextBtn = document.getElementById('next-btn-notes');
        elements.questionSelect = document.getElementById('question-select-notes');
        elements.totalQuestions = document.getElementById('total-questions-notes');
        elements.playBtn = document.getElementById('play-notes-btn');
        elements.score = document.getElementById('score-notes');
        elements.recommendedBtn = document.getElementById('recommended-btn-notes');
        elements.recommendationSummary = document.getElementById('recommendation-summary-notes');

        // Status filter
        elements.statusFilterBtn = document.getElementById('status-filter-btn-notes');
        elements.statusFilterLabel = document.getElementById('status-filter-label-notes');
        elements.statusFilterMenu = document.getElementById('status-filter-menu-notes');

        // Practice area
        elements.practiceArea = document.getElementById('notes-practice-area');

        // Step 1: Video
        elements.stepVideo = document.getElementById('notes-step-video');
        elements.youtubePlayer = document.getElementById('notes-youtube-player');
        elements.skipVideoBtn = document.getElementById('notes-skip-video-btn');

        // Step 2: Audio + Notes
        elements.stepAudio = document.getElementById('notes-step-audio');
        elements.audio = document.getElementById('notes-audio');
        elements.userInput = document.getElementById('notes-user-input');
        elements.submitBtn = document.getElementById('notes-submit-btn');

        // Step 3: Results
        elements.stepResults = document.getElementById('notes-step-results');
        elements.transcriptDisplay = document.getElementById('notes-transcript-display');
        elements.userDisplay = document.getElementById('notes-user-display');
        elements.matchCount = document.getElementById('notes-match-count');
        elements.retryBtn = document.getElementById('notes-retry-btn');
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Navigation
        if (elements.backBtn) {
            elements.backBtn.addEventListener('click', goToPrevious);
        }
        if (elements.nextBtn) {
            elements.nextBtn.addEventListener('click', goToNext);
        }
        if (elements.questionSelect) {
            elements.questionSelect.addEventListener('change', onQuestionSelectChange);
        }
        if (elements.recommendedBtn) {
            elements.recommendedBtn.addEventListener('click', applyRecommendedEntry);
        }

        // Play button
        if (elements.playBtn) {
            elements.playBtn.addEventListener('click', startPractice);
        }
        if (elements.audio) {
            elements.audio.addEventListener('play', markAttemptStart);
        }
        if (elements.userInput) {
            elements.userInput.addEventListener('input', markAttemptStart);
        }

        // Status filter
        if (elements.statusFilterBtn) {
            elements.statusFilterBtn.addEventListener('click', toggleFilterMenu);
        }
        // Filter options
        const filterOptions = document.querySelectorAll('#status-filter-menu-notes .filter-option');
        filterOptions.forEach(option => {
            option.addEventListener('click', () => {
                const value = option.dataset.value;
                applyFilter(value);
                elements.statusFilterMenu.style.display = 'none';
            });
        });

        // Close filter menu when clicking outside
        document.addEventListener('click', (e) => {
            if (elements.statusFilterMenu && elements.statusFilterBtn) {
                if (!elements.statusFilterBtn.contains(e.target) && !elements.statusFilterMenu.contains(e.target)) {
                    elements.statusFilterMenu.style.display = 'none';
                }
            }
        });

        // Practice controls
        if (elements.skipVideoBtn) {
            elements.skipVideoBtn.addEventListener('click', goToAudioStep);
        }
        if (elements.submitBtn) {
            elements.submitBtn.addEventListener('click', submitNotes);
        }
        if (elements.retryBtn) {
            elements.retryBtn.addEventListener('click', retryPractice);
        }
    }

    function ensureRecommendationEngine() {
        if (notesRecommendationEngine) return notesRecommendationEngine;
        const factory = window.QuestionRecommendationEngine?.createQuestionRecommendationEngine;
        if (typeof factory !== 'function') return null;
        notesRecommendationEngine = factory({ recentWindowSize: 10 });
        return notesRecommendationEngine;
    }

    function ensurePerformanceTracker() {
        if (notesPerformanceTracker) return notesPerformanceTracker;
        if (window.notesPerformanceTracker) {
            notesPerformanceTracker = window.notesPerformanceTracker;
            return notesPerformanceTracker;
        }
        if (!window.PerformanceTracker) return null;
        notesPerformanceTracker = new window.PerformanceTracker('notes');
        window.notesPerformanceTracker = notesPerformanceTracker;
        return notesPerformanceTracker;
    }

    function markAttemptStart() {
        if (!notesAttemptStartTime) {
            notesAttemptStartTime = Date.now();
        }
    }

    function buildRecommendationIndex() {
        const engine = ensureRecommendationEngine();
        if (!engine) {
            notesRecommendationIndex = null;
            return;
        }
        notesRecommendationIndex = engine.buildIndex('notes', entries);
    }

    function getNotesCefrLevel() {
        const filterValue = window.DifficultyFilter?.getCurrentDifficulty?.('notes');
        const filteredLevel = Number.parseInt(filterValue, 10);
        if (Number.isFinite(filteredLevel) && filteredLevel >= 1 && filteredLevel <= 3) {
            return filteredLevel * 2;
        }

        const isAdaptive = !!window.DifficultyManager?.getGlobalSettings?.()?.autoAdjustEnabled;
        if (isAdaptive && typeof window.DifficultyManager?.getContentTier === 'function') {
            const contentTier = window.DifficultyManager.getContentTier('notes');
            if (Number.isFinite(contentTier) && contentTier >= 1 && contentTier <= 3) {
                return contentTier * 2;
            }
        }

        const currentLevel = Number.parseInt(String(currentEntry?.level), 10);
        if (Number.isFinite(currentLevel) && currentLevel >= 1 && currentLevel <= 3) {
            return currentLevel * 2;
        }

        return 1;
    }

    function rememberRecommendedId(questionId) {
        const numericId = Number.parseInt(String(questionId), 10);
        if (!Number.isFinite(numericId)) return;
        recentRecommendedIds = recentRecommendedIds.filter((id) => id !== numericId);
        recentRecommendedIds.push(numericId);
        recentRecommendedIds = recentRecommendedIds.slice(-10);
    }

    function getVisibleQuestionIds() {
        return filteredEntries
            .map((entry) => Number.parseInt(String(entry?.id), 10))
            .filter((id) => Number.isFinite(id));
    }

    function getReasonLabel(reasonCode) {
        return REASON_LABELS[reasonCode] || 'best available match';
    }

    function formatRecommendationSummary(nextQuestionId, reasonCode) {
        return `Recommended next: #${nextQuestionId} \u2022 ${getReasonLabel(reasonCode)}`;
    }

    function getPreferredEntryIndex() {
        const currentEntryId = String(currentEntry?.id || '').trim();
        if (!currentEntryId) return 0;

        const existingIndex = filteredEntries.findIndex((entry) => String(entry?.id || '').trim() === currentEntryId);
        return existingIndex >= 0 ? existingIndex : 0;
    }

    function computeRecommendation() {
        if (!currentEntry) return null;
        const engine = ensureRecommendationEngine();
        if (!engine) return null;

        if (!notesRecommendationIndex) {
            buildRecommendationIndex();
        }
        if (!notesRecommendationIndex) return null;

        const currentQuestionId = Number.parseInt(String(currentEntry.id), 10);
        if (!Number.isFinite(currentQuestionId)) return null;

        return engine.recommendNext({
            mode: 'notes',
            currentQuestionId,
            currentCefrLevel: getNotesCefrLevel(),
            visibleQuestionIds: getVisibleQuestionIds(),
            recentQuestionIds: recentRecommendedIds,
            index: notesRecommendationIndex
        });
    }

    function refreshRecommendationUI() {
        if (!elements.recommendedBtn || !elements.recommendationSummary) return;
        const recommendation = computeRecommendation();
        const currentQuestionId = Number.parseInt(String(currentEntry?.id), 10);
        const nextQuestionId = Number.parseInt(String(recommendation?.nextQuestionId), 10);

        if (!recommendation || !Number.isFinite(nextQuestionId) || nextQuestionId === currentQuestionId) {
            elements.recommendedBtn.disabled = true;
            elements.recommendationSummary.textContent = 'No better match in current filters';
            elements.recommendationSummary.classList.remove('is-hidden');
            return;
        }

        elements.recommendedBtn.disabled = false;
        elements.recommendationSummary.textContent = formatRecommendationSummary(nextQuestionId, recommendation.reasonCode);
        elements.recommendationSummary.classList.remove('is-hidden');
    }

    function applyRecommendedEntry() {
        const recommendation = computeRecommendation();
        if (!recommendation) {
            refreshRecommendationUI();
            return;
        }

        const targetQuestionId = Number.parseInt(String(recommendation.nextQuestionId), 10);
        if (!Number.isFinite(targetQuestionId)) {
            refreshRecommendationUI();
            return;
        }

        const targetIndex = filteredEntries.findIndex((entry) => {
            return Number.parseInt(String(entry?.id), 10) === targetQuestionId;
        });

        if (targetIndex === -1) {
            refreshRecommendationUI();
            return;
        }

        rememberRecommendedId(targetQuestionId);
        selectEntry(targetIndex);
    }

    async function withTimeout(promise, timeoutMs, errorMessage) {
        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(errorMessage));
            }, timeoutMs);
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        }
    }

    /**
     * Load entries from Firestore or Excel
     */
    async function loadEntries() {
        if (!elements.questionSelect) return;
        if (loadEntriesPromise) return loadEntriesPromise;

        if (hasLoadedEntries && entries.length > 0) {
            applyFilter(currentFilter);
            return;
        }

        const pendingLoad = (async () => {
            elements.questionSelect.innerHTML = '<option value="">Loading...</option>';

            try {
                // Try to load from Firestore first
                if (typeof firebase !== 'undefined' && firebase.firestore) {
                    try {
                        const db = firebase.firestore();
                        const snapshot = await withTimeout(
                            db.collection('takeNotesEntries').get(),
                            FIRESTORE_LOAD_TIMEOUT_MS,
                            'Firestore request timed out'
                        );

                        if (!snapshot.empty) {
                            entries = snapshot.docs.map((doc) => {
                                const data = doc.data() || {};
                                let parsedLevel = parseInt(data.level, 10);
                                if (isNaN(parsedLevel) || parsedLevel < 1 || parsedLevel > 3) parsedLevel = 1;

                                return {
                                    id: String(data.id ?? doc.id ?? '').trim(),
                                    transcript: data.transcript ? String(data.transcript).trim() : '',
                                    level: parsedLevel,
                                    videoUrl: data.videoUrl ? String(data.videoUrl).trim() : ''
                                };
                            }).filter((entry) => entry.id.length > 0);

                            // Sort entries numerically by ID
                            entries.sort((a, b) => {
                                const idA = parseInt(a.id, 10);
                                const idB = parseInt(b.id, 10);
                                return (isNaN(idA) || isNaN(idB)) ? a.id.localeCompare(b.id) : idA - idB;
                            });

                            buildRecommendationIndex();
                            applyFilter('all');
                            hasLoadedEntries = true;
                            return;
                        }
                    } catch (firestoreError) {
                        console.warn('[TakeNotes] Firestore error, falling back to Excel:', firestoreError.message);
                    }
                }

                // Fallback: Load from Excel
                const excelPath = 'database/Take%20Notes/RL/RL.xlsx';

                const response = await fetch(excelPath);
                if (!response.ok) {
                    throw new Error(`Excel file not found (${response.status})`);
                }

                const arrayBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                entries = [];
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    if (row[0]) {
                        let parsedLevel = parseInt(row[3], 10);
                        if (isNaN(parsedLevel) || parsedLevel < 1 || parsedLevel > 3) parsedLevel = 1;

                        entries.push({
                            id: String(row[0]).trim(),
                            transcript: row[2] ? String(row[2]).trim() : '',
                            level: parsedLevel,
                            videoUrl: row[5] ? String(row[5]).trim() : ''
                        });
                    }
                }


                // Sort entries numerically by ID
                entries.sort((a, b) => {
                    const idA = parseInt(a.id, 10);
                    const idB = parseInt(b.id, 10);
                    return (isNaN(idA) || isNaN(idB)) ? a.id.localeCompare(b.id) : idA - idB;
                });

                buildRecommendationIndex();
                applyFilter('all');
                hasLoadedEntries = true;

            } catch (error) {
                hasLoadedEntries = false;
                console.error('[TakeNotes] Error loading entries:', error);
                elements.questionSelect.innerHTML = '<option value="">Error loading</option>';
                if (elements.totalQuestions) elements.totalQuestions.textContent = '0';
                refreshRecommendationUI();
            }
        })();

        loadEntriesPromise = pendingLoad;
        try {
            await pendingLoad;
        } finally {
            if (loadEntriesPromise === pendingLoad) {
                loadEntriesPromise = null;
            }
        }
    }

    /**
     * Apply compound filters (status and difficulty)
     */
    function applyFilter(filterValue = currentFilter) {
        currentFilter = filterValue;

        // Update filter label
        const filterLabels = {
            'all': 'All Questions',
            'has-video': 'Guiding Video',
            'no-video': 'No Guiding Video'
        };
        if (elements.statusFilterLabel) {
            elements.statusFilterLabel.textContent = filterLabels[filterValue] || 'Filter by Status';
        }

        let tempEntries = [...entries];

        // 1. Apply Status Filter
        if (filterValue === 'has-video') {
            tempEntries = tempEntries.filter(e => e.videoUrl && e.videoUrl.length > 0);
        } else if (filterValue === 'no-video') {
            tempEntries = tempEntries.filter(e => !e.videoUrl || e.videoUrl.length === 0);
        }

        // 2. Apply Difficulty Filter
        const currentDifficulty = window.DifficultyFilter ? window.DifficultyFilter.getCurrentDifficulty('notes') : 'all';
        if (currentDifficulty !== 'all') {
            const level = parseInt(currentDifficulty, 10);
            tempEntries = tempEntries.filter(e => e.level === level);
        }

        filteredEntries = tempEntries;

        // Update UI
        updateQuestionSelector();

        if (filteredEntries.length === 0) {
            handleEmptyState();
        } else {
            if (elements.playBtn) elements.playBtn.disabled = false;
            if (elements.questionSelect) elements.questionSelect.disabled = false;
            currentEntryIndex = getPreferredEntryIndex();
            selectEntry(currentEntryIndex);
        }
    }

    /**
     * Handle empty state when filters return 0 results
     */
    function handleEmptyState() {
        if (elements.questionSelect) {
            elements.questionSelect.innerHTML = '<option value="">No matching questions</option>';
            elements.questionSelect.disabled = true;
        }
        if (elements.totalQuestions) {
            elements.totalQuestions.textContent = '0';
        }
        if (elements.currentQuestionId) {
            elements.currentQuestionId.textContent = '-';
        }
        if (elements.playBtn) {
            elements.playBtn.disabled = true;
        }

        currentEntry = null;
        currentEntryIndex = -1;
        reset();
        refreshRecommendationUI();
    }

    /**
     * Toggle filter menu visibility
     */
    function toggleFilterMenu() {
        if (!elements.statusFilterMenu) return;
        const isVisible = elements.statusFilterMenu.style.display !== 'none';
        elements.statusFilterMenu.style.display = isVisible ? 'none' : 'block';
    }

    /**
     * Update question selector dropdown
     */
    function updateQuestionSelector() {
        if (!elements.questionSelect) return;

        if (filteredEntries.length === 0) return;

        elements.questionSelect.innerHTML = filteredEntries.map((entry, index) => {
            const hasVideo = entry.videoUrl && entry.videoUrl.trim().length > 0;
            const videoLabel = hasVideo ? ` 🎥` : ``;
            return `<option value="${index}">[Lvl ${entry.level}] ${entry.id}${videoLabel}</option>`;
        }).join('');

        if (elements.totalQuestions) {
            elements.totalQuestions.textContent = filteredEntries.length;
        }
    }

    /**
     * Handle question select change
     */
    function onQuestionSelectChange() {
        const index = parseInt(elements.questionSelect.value, 10);
        if (!isNaN(index)) {
            selectEntry(index);
        }
    }

    /**
     * Go to previous question
     */
    function goToPrevious() {
        if (currentEntryIndex > 0) {
            selectEntry(currentEntryIndex - 1);
        }
    }

    /**
     * Go to next question
     */
    function goToNext() {
        if (currentEntryIndex < filteredEntries.length - 1) {
            selectEntry(currentEntryIndex + 1);
        }
    }

    /**
     * Select an entry by index
     */
    function selectEntry(index) {
        if (index < 0 || index >= filteredEntries.length) return;

        currentEntryIndex = index;
        currentEntry = filteredEntries[index];

        // Update UI
        if (elements.currentQuestionId) {
            elements.currentQuestionId.textContent = currentEntry.id;
        }
        if (elements.questionSelect) {
            elements.questionSelect.value = index;
        }

        // Reset practice area
        reset();
        refreshRecommendationUI();

        // Update URL with current question ID (replaceState — no history entry per question)
        if (window.PracticeRouter && currentEntry.id) {
            window.PracticeRouter.replaceRoute('notes', currentEntry.id);
        }

    }

    /**
     * Start practice - show practice area and begin flow
     */
    function startPractice() {
        if (!currentEntry) {
            alert('Please select a question first');
            return;
        }


        // Show practice area
        elements.practiceArea.style.display = 'block';

        // Clear previous state
        elements.stepVideo.style.display = 'none';
        elements.stepAudio.style.display = 'none';
        elements.stepResults.style.display = 'none';
        elements.userInput.value = '';
        notesAttemptStartTime = null;

        // Check if has guiding video
        const hasVideo = currentEntry.videoUrl && currentEntry.videoUrl.trim().length > 0;

        if (hasVideo) {
            loadGuidingVideo(currentEntry.videoUrl);
            elements.stepVideo.style.display = 'block';
        } else {
            goToAudioStep();
        }
    }

    /**
     * Load guiding video in YouTube player
     */
    function loadGuidingVideo(url) {
        const videoId = extractVideoId(url);
        if (!videoId) {
            console.warn('[TakeNotes] Invalid video URL:', url);
            goToAudioStep();
            return;
        }

        // Simple iframe embed
        elements.youtubePlayer.innerHTML = `
            <iframe 
                width="100%" 
                height="100%" 
                src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1"
                frameborder="0" 
                allow="autoplay; encrypted-media"
                allowfullscreen>
            </iframe>
        `;
    }

    /**
     * Extract video ID from YouTube URL
     */
    function extractVideoId(url) {
        if (!url) return null;
        const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : null;
    }

    /**
     * Go to audio step (Step 2)
     */
    function goToAudioStep() {

        // Clear video iframe
        if (elements.youtubePlayer) {
            elements.youtubePlayer.innerHTML = '';
        }

        // Hide video step, show audio step
        elements.stepVideo.style.display = 'none';
        elements.stepAudio.style.display = 'block';

        // Load audio
        loadAudio(currentEntry.id);
    }

    /**
     * Load audio file with extension fallback
     */
    async function loadAudio(audioId) {
        const tryExtensions = ['m4a', 'wav', 'mp3', 'aac', 'ogg'];
        const basePath = `database/Take%20Notes/RL/audio/${audioId}`;

        for (const ext of tryExtensions) {
            const audioPath = `${basePath}.${ext}`;
            const exists = await checkFileExists(audioPath);
            if (exists) {
                elements.audio.src = audioPath;
                return;
            }
        }

        console.warn(`[TakeNotes] No audio file found for ${audioId}`);
    }

    /**
     * Check if file exists
     */
    async function checkFileExists(url) {
        try {
            const response = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
            const contentType = response.headers.get('content-type');
            return response.ok && contentType && contentType.startsWith('audio/');
        } catch (e) {
            return false;
        }
    }

    /**
     * Submit notes and show results
     */
    function submitNotes() {
        const userNotes = elements.userInput.value.trim();
        if (!userNotes) {
            alert('Please enter some notes before submitting.');
            return;
        }


        // Hide audio step, show results step
        elements.stepAudio.style.display = 'none';
        elements.stepResults.style.display = 'block';

        // Compare notes with transcript
        const transcript = currentEntry.transcript || '';
        const { highlightedTranscript, matchedWords, transcriptWordCount } = compareTexts(transcript, userNotes);

        // Display results
        elements.transcriptDisplay.innerHTML = highlightedTranscript;
        elements.userDisplay.textContent = userNotes;
        elements.matchCount.textContent = matchedWords.length;

        const tracker = ensurePerformanceTracker();
        if (tracker) {
            const safeWordCount = Math.max(1, transcriptWordCount || 0);
            const accuracy = Math.max(0, Math.min(1, matchedWords.length / safeWordCount));
            const timeTaken = Math.max(2, (Date.now() - (notesAttemptStartTime || Date.now())) / 1000);
            tracker.recordAttempt({
                correct: matchedWords.length > 0 && matchedWords.length === transcriptWordCount,
                accuracy,
                attempts: 1,
                hintUsed: false,
                timeTaken,
                wordCount: safeWordCount
            });
        }

        // Save progress if user is logged in
        saveProgress(userNotes, matchedWords, transcriptWordCount);

        window.PTEAttemptArchive?.saveTextAttempt?.('notes', {
            ...(currentEntry || {}),
            audioPath: currentEntry?.audioPath || currentEntry?.audio || currentEntry?.file || null,
            transcript
        }, userNotes, {
            score: matchedWords.length,
            maxScore: transcriptWordCount,
            matchedWords,
            transcriptWordCount
        }, { scoringSource: 'client' }).catch((error) => console.warn('[PTE Archive] Retell Lecture save failed:', error));

        window.getPracticeVariantHooks?.('notes')?.afterSubmit?.({
            entryId: String(currentEntry?.id || ''),
            userNotes
        });
    }

    /**
     * Retry practice - go back to audio step
     */
    function retryPractice() {
        elements.stepResults.style.display = 'none';
        elements.userInput.value = '';
        notesAttemptStartTime = null;
        startPractice();
    }

    /**
     * Compare user notes with transcript and highlight matches
     */
    function compareTexts(transcript, userNotes) {
        // Use Compromise NLP for lemmatization
        const getLemma = (word) => {
            if (typeof nlp === 'undefined') {
                return word.toLowerCase().replace(/[^a-z0-9]/g, '');
            }

            const cleanWord = word.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!cleanWord) return '';

            const doc = nlp(cleanWord);

            // Try verbs -> infinitive (e.g., running -> run, went -> go)
            const verbs = doc.verbs().toInfinitive().out('text');
            if (verbs) return verbs;

            // Try nouns -> singular (e.g., children -> child)
            const nouns = doc.nouns().toSingular().out('text');
            if (nouns) return nouns;

            return cleanWord;
        };

        const clean = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

        // 1. Build User Indices
        const uniqueUserWords = new Set(userNotes.split(/\s+/).map(clean).filter(w => w));
        const exactUserSet = new Set(uniqueUserWords);
        const lemmaUserMap = new Map();

        uniqueUserWords.forEach(word => {
            const lemma = getLemma(word);
            if (!lemmaUserMap.has(lemma)) {
                lemmaUserMap.set(lemma, []);
            }
            lemmaUserMap.get(lemma).push(word);
        });

        const matchedWords = [];
        const transcriptWords = transcript.split(/(\s+)/);

        const highlightedTranscript = transcriptWords.map(part => {
            // Preserve whitespace and punct only chunks
            if (/^\s*$/.test(part)) return part;

            const cleanPart = clean(part);
            if (!cleanPart) return part;

            // Layer 1: Exact Match
            if (exactUserSet.has(cleanPart)) {
                matchedWords.push(part);
                return `<span class="notes-matched">${part}</span>`;
            }

            // Layer 2: Lemma Match with Constraint
            const partLemma = getLemma(cleanPart);
            if (lemmaUserMap.has(partLemma)) {
                const candidates = lemmaUserMap.get(partLemma);

                // Constraint: share at least 3 starting characters
                const hasValidMatch = candidates.some(userWord => {
                    if (userWord.length < 3 || cleanPart.length < 3) return false;
                    return userWord.substring(0, 3) === cleanPart.substring(0, 3);
                });

                if (hasValidMatch) {
                    matchedWords.push(part);
                    return `<span class="notes-matched">${part}</span>`;
                }
            }

            return part;
        }).join('');

        const transcriptWordCount = transcript.split(/\s+/).filter(w => w.length > 3).length; // Filter short words for better metric

        return { highlightedTranscript, matchedWords, transcriptWordCount };
    }

    /**
     * Save user progress to Firestore
     */
    async function saveProgress(userNotes, matchedWords, transcriptWordCount) {
        try {
            const userId = window.authUI?.getCurrentUserId?.() || window.auth?.currentUser?.uid;
            if (!userId) return;

            // Dual-Track Scoring Integration (Phase 2.1 - Server-Authoritative)
            if (window.handleDualTrackScoring) {
                // Pass raw user notes text for server-side word matching
                await window.handleDualTrackScoring('notes', currentEntry.id, userNotes);
            }

            if (!window.firebaseFirestoreFunctions?.upsertTakeNotesProgress) return;

            await window.firebaseFirestoreFunctions.upsertTakeNotesProgress(userId, String(currentEntry.id), {
                entryId: String(currentEntry.id),
                userNotes: userNotes,
                matchedWordsCount: matchedWords.length,
                transcriptWordCount: transcriptWordCount
            });

        } catch (error) {
            console.error('[TakeNotes] Error saving progress:', error);
        }
    }

    // Initialize when DOM is ready; handle lazy-loaded script after DOMContentLoaded.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    window.TakeNotesMode = {
        init,
        reset,
        loadEntries,
        applyFilters: applyFilter
    };

    // Deep-link support: listen for PracticeRouter question navigation events
    window.addEventListener('practice-route-question', (event) => {
        const { mode, questionId } = event.detail || {};
        if (mode !== 'notes' || !questionId) return;
        if (!hasLoadedEntries || filteredEntries.length === 0) return;
        const idx = filteredEntries.findIndex((e) => String(e.id) === String(questionId));
        if (idx >= 0) {
            selectEntry(idx);
        }
    });

})();
