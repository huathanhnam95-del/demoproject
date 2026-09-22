/**
 * Take Notes Mode Module
 * Handles the Take Notes practice mode in the learner app
 * UI matches Type/Speak modes with question selector and filter dropdown
 * 
 * Flow: Select question → Play → Watch guiding video (if available) → Listen to audio + take notes → See results
 */

(function () {
    'use strict';

    const NOTES_ENTRY_DEADLINE_MS = 12_000;
    const NOTES_FIRESTORE_TIMEOUT_MS = 8_000;
    const NOTES_WORKBOOK_TIMEOUT_MS = 6_000;
    const NOTES_AUDIO_DEADLINE_MS = 10_000;
    const NOTES_AUDIO_HEAD_TIMEOUT_MS = 2_000;
    const NOTES_FALLBACK_OFFER_DELAY_MS = 1_500;
    const FIRESTORE_LOAD_TIMEOUT_MS = NOTES_FIRESTORE_TIMEOUT_MS;

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
    let pendingRouteQuestionId = null;
    let audioLoadToken = 0;
    let entryGeneration = 0;
    let entryAbortController = null;
    let audioAbortController = null;
    let notesEntryLoadStartedAt = 0;
    let notesRecommendationEngine = null;
    let notesRecommendationIndex = null;
    let recentRecommendedIds = [];
    let notesAttemptStartTime = null;
    let notesPerformanceTracker = null;

    // V3 State
    let v3Active = false;
    let v3Phase = 'loading'; // 'loading' | 'listen' | 'prep' | 'recording' | 'complete' | 'feedback'
    let pteAudioBox = null;
    let pteRecorderWidget = null;
    let questionGen = 0;
    let attemptGen = 0;
    let recordingSessionToken = 0;
    let v3ActiveTab = 'notes-match';
    let v3LastResult = null;
    let v3LastUserNotes = '';
    let v3VideoModal = null;

    // V3 Recording State
    const PREP_SECONDS = 10;
    const RECORD_SECONDS = 40;
    let activeRecorder = null;
    let activeMediaStream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordingBlob = null;
    let recordingBlobUrl = null;
    let dspPromise = null;
    let speechRecognition = null;
    let transcriptText = '';
    let v3PrepStartTime = 0;
    let v3RecordStartTime = 0;
    let v3RecordedDurationSec = 0;
    let v3PrepRAF = null;
    let v3RecordRAF = null;

    function isV3() {
        return !!(v3Active || window.PteShellConfig?.isModeEnabled?.('notes', 'pte'));
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    const REASON_LABELS = {
        level_and_continuity: 'Smart Match',
        difficulty_only: 'Difficulty Match',
        continuity_only: 'Vocabulary Match',
        fallback: 'Best Available Match'
    };

    // DOM Elements
    const elements = {};

    /**
     * In-web toast notification (replaces browser alert)
     */
    function showToast(message, durationMs = 3000) {
        const existing = document.getElementById('notes-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'notes-toast';
        toast.className = 'notes-toast';
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--slate-900, #0f172a)',
            color: 'var(--text-inverse, #ffffff)',
            padding: '12px 24px',
            borderRadius: 'var(--radius-md, 8px)',
            fontSize: 'var(--text-sm, 0.875rem)',
            zIndex: '10000',
            boxShadow: 'var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1))',
            transition: 'opacity 0.3s ease',
            opacity: '1'
        });
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 350);
        }, durationMs);
    }

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

        try {
            const route = window.PracticeRouter?.parseRoute?.(window.location.pathname);
            if (route?.mode === 'notes' && route.questionId) {
                pendingRouteQuestionId = String(route.questionId);
            }
        } catch (_) {
            // Deep-link capture is best effort; the route event remains a fallback.
        }

        setupEventListeners();
        isInitialized = true;
        renderEntryStatus('idle');
    }

    function getAudioPlayer() {
        if (!elements.audioPlayer && window.PracticeAudioPlayer) {
            elements.audioPlayer = window.PracticeAudioPlayer.attach({
                prefix: 'notes',
                audioId: 'notes-audio',
                onPlaybackError: () => setAudioStatus('playback-error', 'Audio playback failed. Retry audio or choose another question.')
            });
        }
        return elements.audioPlayer;
    }

    function renderEntryStatus(status, message = '') {
        const statusEl = elements.entryStatus;
        if (!statusEl) return;
        statusEl.dataset.notesStatus = status;
        statusEl.className = `notes-entry-status is-${status}`;
        statusEl.textContent = message;
        statusEl.hidden = !message;
        if (elements.retryEntriesBtn) elements.retryEntriesBtn.hidden = status !== 'error';
    }

    function setAudioStatus(status, message = '') {
        if (!elements.audioStatus) return;
        elements.audioStatus.dataset.notesStatus = status;
        elements.audioStatus.className = `notes-audio-status is-${status}`;
        elements.audioStatus.textContent = message;
        elements.audioStatus.hidden = !message;
        if (elements.retryAudioBtn) {
            elements.retryAudioBtn.hidden = !['unavailable', 'playback-error'].includes(status);
        }
    }

    function beginEntryGeneration() {
        entryGeneration += 1;
        if (entryAbortController) entryAbortController.abort();
        entryAbortController = new AbortController();
        notesEntryLoadStartedAt = Date.now();
        return {
            generation: entryGeneration,
            signal: entryAbortController.signal,
            deadline: notesEntryLoadStartedAt + NOTES_ENTRY_DEADLINE_MS
        };
    }

    function isEntryGenerationActive(generation) {
        return generation === entryGeneration && !entryAbortController?.signal.aborted;
    }

    function remainingBudget(deadline, cap = Number.POSITIVE_INFINITY) {
        return Math.max(0, Math.min(cap, deadline - Date.now()));
    }

    /**
     * Reset UI state (called when switching away from Notes tab or resetting question)
     */
    function reset() {
        // Ensure practice area is visible
        if (elements.practiceArea) {
            elements.practiceArea.style.display = 'block';
        }
        // Hide active sub-steps
        if (elements.stepVideo) elements.stepVideo.style.display = 'none';
        if (elements.stepAudio) elements.stepAudio.style.display = 'none';
        if (elements.stepResults) elements.stepResults.style.display = 'none';

        // Show Ready / Overview Step (legacy only)
        if (elements.stepReady) {
            elements.stepReady.style.display = isV3() ? 'none' : 'block';
            if (elements.readyTitle) {
                elements.readyTitle.textContent = currentEntry
                    ? `#${currentEntry.id} ${currentEntry.title ? currentEntry.title.replace(/^#\d+\s*/, '') : 'Lecture'}`
                    : 'No Lectures Found';
            }
            if (elements.readyDesc) {
                elements.readyDesc.textContent = currentEntry
                    ? ((currentEntry.videoUrl && currentEntry.videoUrl.trim().length > 0)
                        ? 'This lecture includes a guiding video to introduce the topic, followed by the lecture audio and note-taking.'
                        : 'Listen to the lecture audio and type your key notes as you listen.')
                    : 'No lectures match the current filters. Please adjust your filters to continue.';
            }
            if (elements.readyVideoTag) {
                elements.readyVideoTag.style.display = (currentEntry?.videoUrl && currentEntry.videoUrl.trim().length > 0) ? 'inline-flex' : 'none';
            }
            if (elements.readyAudioTag) {
                elements.readyAudioTag.style.display = currentEntry ? 'inline-flex' : 'none';
            }
            if (elements.startBtn) {
                elements.startBtn.disabled = !currentEntry;
                elements.startBtn.style.opacity = currentEntry ? '1' : '0.5';
                elements.startBtn.style.pointerEvents = currentEntry ? 'auto' : 'none';
            }
        }

        // Clear YouTube player iframe to stop video playback
        if (elements.youtubePlayer) {
            elements.youtubePlayer.innerHTML = '';
        }
        closeIntroVideoModal();

        // Stop any playing audio
        audioLoadToken += 1;
        if (audioAbortController) {
            audioAbortController.abort();
            audioAbortController = null;
        }
        if (elements.audio) {
            elements.audio.pause();
            elements.audio.removeAttribute('src');
            elements.audio.load();
        }
        if (pteAudioBox) {
            pteAudioBox.reset();
        }
        const player = getAudioPlayer();
        if (player) {
            player.reset();
            player.setEnabled(true);
        }
        if (elements.audioStatus) {
            setAudioStatus('idle');
        }
        // Clear user input
        if (elements.userInput) {
            elements.userInput.value = '';
        }

        if (activeRecorder) {
            try { activeRecorder.cancel(); } catch (_) {}
            activeRecorder = null;
        }
        stopAllV3Timers();
        stopSpeechRecognition();
        stopMediaStream();
        recordingSessionToken++;
        if (recordingBlobUrl) {
            URL.revokeObjectURL(recordingBlobUrl);
            recordingBlobUrl = null;
        }
        recordingBlob = null;
        dspPromise = null;
        transcriptText = '';
        recordedChunks = [];
        pteRecorderWidget?.reset?.();

        try {
            window.SpeakingPracticeController?.sync?.('notes');
        } catch (_) {}
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
        elements.playBtn = document.getElementById('play-notes-btn');
        elements.entryStatus = document.getElementById('notes-entry-status');
        elements.retryEntriesBtn = document.getElementById('notes-retry-entries-btn');
        elements.recommendedBtn = document.getElementById('recommended-btn-notes');
        elements.recommendationSummary = document.getElementById('recommendation-summary-notes');

        // Status filter
        elements.statusFilterBtn = document.getElementById('status-filter-btn-notes');
        elements.statusFilterLabel = document.getElementById('status-filter-label-notes');
        elements.statusFilterMenu = document.getElementById('status-filter-menu-notes');

        // Practice area
        elements.practiceArea = document.getElementById('notes-practice-area');

        // Step 0: Overview / Ready
        elements.stepReady = document.getElementById('notes-step-ready');
        elements.readyTitle = document.getElementById('notes-ready-title');
        elements.readyDesc = document.getElementById('notes-ready-desc');
        elements.readyVideoTag = document.getElementById('notes-ready-video-tag');
        elements.readyAudioTag = document.getElementById('notes-ready-audio-tag');
        elements.startBtn = document.getElementById('notes-start-btn');

        // Step 1: Video
        elements.stepVideo = document.getElementById('notes-step-video');
        elements.youtubePlayer = document.getElementById('notes-youtube-player');
        elements.skipVideoBtn = document.getElementById('notes-skip-video-btn');

        // Step 2: Audio + Notes
        elements.stepAudio = document.getElementById('notes-step-audio');
        elements.audio = document.getElementById('notes-audio');
        elements.audioStatus = document.getElementById('notes-audio-status');
        elements.retryAudioBtn = document.getElementById('notes-retry-audio-btn');
        getAudioPlayer();
        elements.userInput = document.getElementById('notes-user-input');
        elements.submitBtn = document.getElementById('notes-submit-btn');
        elements.inCardSubmitBtn = document.getElementById('notes-in-card-submit-btn');

        // Step 3: Results
        elements.stepResults = document.getElementById('notes-step-results');
        elements.transcriptDisplay = document.getElementById('notes-transcript-display');
        elements.userDisplay = document.getElementById('notes-user-display');
        elements.matchCount = document.getElementById('notes-match-count');
        elements.retryBtn = document.getElementById('notes-retry-btn');
        elements.inCardRetryBtn = document.getElementById('notes-in-card-retry-btn');
        [elements.playBtn, elements.inCardSubmitBtn, elements.inCardRetryBtn].forEach((alias) => {
            if (!alias) return;
            alias.tabIndex = -1;
            alias.hidden = true;
            alias.setAttribute('aria-hidden', 'true');
        });
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
        if (elements.retryEntriesBtn) {
            elements.retryEntriesBtn.addEventListener('click', retryEntryLoading);
        }

        // Play and start buttons
        if (elements.playBtn) {
            elements.playBtn.addEventListener('click', startPractice);
        }
        if (elements.startBtn) {
            elements.startBtn.addEventListener('click', startPractice);
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
            elements.retryBtn.addEventListener('click', () => {
                if (isV3() && v3Phase === 'complete') {
                    retryV3Recording();
                } else {
                    retryPractice();
                }
            });
        }
        if (elements.retryAudioBtn) {
            elements.retryAudioBtn.addEventListener('click', () => {
                if (currentEntry) loadAudio(currentEntry.id);
            });
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

    async function retryEntryLoading() {
        const load = beginEntryGeneration();
        hasLoadedEntries = false;
        await loadEntries({ ...load, force: true });
    }

    async function withTimeout(promise, timeoutMs, errorMessage, signal) {
        let timeoutId = null;
        let abortHandler = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(errorMessage)), Math.max(0, timeoutMs));
            if (signal) {
                abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
                if (signal.aborted) abortHandler();
                else signal.addEventListener('abort', abortHandler, { once: true });
            }
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
            if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        }
    }

    function sortEntries(items) {
        return items.filter((entry) => entry.id.length > 0).sort((a, b) => {
            const idA = parseInt(a.id, 10);
            const idB = parseInt(b.id, 10);
            return (isNaN(idA) || isNaN(idB)) ? a.id.localeCompare(b.id) : idA - idB;
        });
    }

    function normalizeFirestoreEntries(snapshot) {
        if (!snapshot || snapshot.empty) return [];
        return sortEntries(snapshot.docs.map((doc) => {
            const data = doc.data() || {};
            let parsedLevel = parseInt(data.level, 10);
            if (isNaN(parsedLevel) || parsedLevel < 1 || parsedLevel > 3) parsedLevel = 1;
            return {
                id: String(data.id ?? doc.id ?? '').trim(),
                title: data.title ? String(data.title).trim() : '',
                transcript: data.transcript ? String(data.transcript).trim() : '',
                level: parsedLevel,
                videoUrl: (data.videoUrl || data.youtubeUrl || data.url)
                    ? String(data.videoUrl || data.youtubeUrl || data.url).trim() : ''
            };
        }));
    }

    function parseWorkbookEntries(arrayBuffer) {
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const parsed = [];
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row[0] === undefined || row[0] === null || String(row[0]).trim() === '') continue;
            let parsedLevel = parseInt(row[3], 10);
            if (isNaN(parsedLevel) || parsedLevel < 1 || parsedLevel > 3) parsedLevel = 1;
            parsed.push({
                id: String(row[0]).trim(),
                title: row[1] ? String(row[1]).trim() : '',
                transcript: row[2] ? String(row[2]).trim() : '',
                level: parsedLevel,
                videoUrl: row[4] ? String(row[4]).trim() : ''
            });
        }
        return sortEntries(parsed);
    }

    async function loadFirestoreEntries(deadline, signal) {
        if (typeof firebase === 'undefined' || !firebase.firestore) return [];
        const db = firebase.firestore();
        const snapshot = await withTimeout(
            db.collection('takeNotesEntries').get(),
            remainingBudget(deadline, NOTES_FIRESTORE_TIMEOUT_MS),
            'Firestore request timed out',
            signal
        );
        return normalizeFirestoreEntries(snapshot);
    }

    async function loadWorkbookEntries(deadline, signal) {
        const excelPath = '/database/Take%20Notes/RL/RL.xlsx';
        const response = await withTimeout(
            fetch(excelPath, { cache: 'no-cache', signal }),
            remainingBudget(deadline, NOTES_WORKBOOK_TIMEOUT_MS),
            'Workbook request timed out',
            signal
        );
        if (!response.ok) throw new Error(`Excel file not found (${response.status})`);
        const arrayBuffer = await withTimeout(
            response.arrayBuffer(),
            remainingBudget(deadline, NOTES_WORKBOOK_TIMEOUT_MS),
            'Workbook request timed out',
            signal
        );
        return parseWorkbookEntries(arrayBuffer);
    }

    function commitEntries(nextEntries, generation) {
        if (!isEntryGenerationActive(generation)) return false;
        entries = sortEntries(nextEntries);
        hasLoadedEntries = entries.length > 0;
        if (hasLoadedEntries) {
            buildRecommendationIndex();
            applyFilter('all');
            renderEntryStatus('ready');
        }
        return hasLoadedEntries;
    }

    /**
     * Load Firestore and workbook candidates concurrently within one entry
     * deadline. Firestore wins when it returns usable rows; the local workbook
     * is offered after a short delay and becomes the bounded fallback.
     */
    async function loadEntries(options = {}) {
        if (!elements.questionSelect) return false;
        const generation = options.generation ?? entryGeneration;
        const signal = options.signal || entryAbortController?.signal;
        const deadline = options.deadline || (Date.now() + NOTES_ENTRY_DEADLINE_MS);

        if (loadEntriesPromise && loadEntriesPromise.generation === generation) {
            return loadEntriesPromise.promise;
        }
        if (hasLoadedEntries && entries.length > 0 && !options.force) {
            applyFilter(currentFilter);
            return true;
        }

        elements.questionSelect.innerHTML = '<option value="">Loading questions...</option>';
        renderEntryStatus('loading', 'Loading Retell Lecture questions…');

        const pendingLoad = (async () => {
            let localResult = null;
            let localOfferTimer = null;
            const localPromise = loadWorkbookEntries(deadline, signal)
                .then((items) => {
                    localResult = { items };
                    if (items.length > 0 && !hasLoadedEntries && isEntryGenerationActive(generation) &&
                        Date.now() - notesEntryLoadStartedAt >= NOTES_FALLBACK_OFFER_DELAY_MS) {
                        renderEntryStatus('local-ready', 'Local questions are ready while the cloud source is still loading.');
                    }
                    return items;
                })
                .catch((error) => {
                    localResult = { items: [], error };
                    return [];
                });
            localOfferTimer = setTimeout(() => {
                if (localResult?.items?.length && !hasLoadedEntries && isEntryGenerationActive(generation)) {
                    renderEntryStatus('local-ready', 'Local questions are ready while the cloud source is still loading.');
                }
            }, NOTES_FALLBACK_OFFER_DELAY_MS);

            let remoteEntries = [];
            try {
                remoteEntries = await loadFirestoreEntries(deadline, signal);
            } catch (error) {
                console.warn('[TakeNotes] Firestore unavailable; using bounded local fallback:', error.message);
            }

            if (remoteEntries.length > 0) {
                if (localOfferTimer) clearTimeout(localOfferTimer);
                void localPromise;
                return commitEntries(remoteEntries, generation);
            }

            const localEntries = localResult ? localResult.items : await withTimeout(
                localPromise,
                remainingBudget(deadline),
                'Retell Lecture entry loading timed out',
                signal
            );
            if (localOfferTimer) clearTimeout(localOfferTimer);
            if (localEntries.length > 0 && commitEntries(localEntries, generation)) return true;
            throw localResult?.error || new Error('No Retell Lecture questions are available');
        })();

        loadEntriesPromise = { generation, promise: pendingLoad };
        try {
            return await pendingLoad;
        } catch (error) {
            if (!isEntryGenerationActive(generation)) return false;
            hasLoadedEntries = false;
            console.error('[TakeNotes] Error loading entries:', error);
            elements.questionSelect.innerHTML = '<option value="">Questions unavailable</option>';
            renderEntryStatus('error', 'Questions are unavailable. Retry loading or check your connection.');
            refreshRecommendationUI();
            return false;
        } finally {
            if (loadEntriesPromise?.promise === pendingLoad) loadEntriesPromise = null;
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
        } else if (filterValue === 'empty') {
            tempEntries = [];
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
            const routeIndex = pendingRouteQuestionId
                ? filteredEntries.findIndex((entry) => String(entry.id) === pendingRouteQuestionId)
                : -1;
            currentEntryIndex = routeIndex >= 0 ? routeIndex : getPreferredEntryIndex();
            selectEntry(currentEntryIndex);
            if (routeIndex >= 0 || pendingRouteQuestionId) {
                pendingRouteQuestionId = null;
            }
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

        elements.questionSelect.innerHTML = filteredEntries.map((entry) => {
            const hasVideo = entry.videoUrl && entry.videoUrl.trim().length > 0;
            const videoLabel = hasVideo ? ` 🎥` : ``;
            const cleanTitle = entry.title ? ` - ${entry.title.replace(/^#\d+\s*/, '')}` : '';
            return `<option value="${entry.id}">[Lvl ${entry.level}] #${entry.id}${videoLabel}${cleanTitle}</option>`;
        }).join('');
    }

    /**
     * Handle question select change
     */
    function onQuestionSelectChange() {
        const selectedId = String(elements.questionSelect.value || '').trim();
        const index = filteredEntries.findIndex((entry) => String(entry.id) === selectedId);
        if (index >= 0) {
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
            elements.questionSelect.value = currentEntry.id;
        }

        // Reset practice area
        reset();
        refreshRecommendationUI();

        if (isV3()) {
            queueMicrotask(() => {
                if (isV3() && currentEntry) {
                    startV3QuestionFlow();
                }
            });
        }

        // Update URL with current question ID (replaceState — no history entry per question)
        if (window.PracticeRouter && currentEntry.id) {
            window.PracticeRouter.replaceRoute('notes', currentEntry.id);
        }

        try {
            window.SpeakingPracticeController?.sync?.('notes');
        } catch (_) {
            // The shared controller is optional outside PTE Retell Lecture.
        }

    }

    /**
     * Start practice - show practice area and begin flow
     */
    function startPractice() {
        if (!currentEntry) {
            showToast('Please select a question first');
            return;
        }

        // Show practice area and hide ready step
        if (elements.practiceArea) elements.practiceArea.style.display = 'block';
        if (elements.stepReady) elements.stepReady.style.display = 'none';

        // Clear previous state
        if (elements.stepVideo) elements.stepVideo.style.display = 'none';
        if (elements.stepAudio) elements.stepAudio.style.display = 'none';
        if (elements.stepResults) elements.stepResults.style.display = 'none';
        if (elements.userInput) elements.userInput.value = '';
        notesAttemptStartTime = null;

        // Check if has guiding video
        const hasVideo = currentEntry.videoUrl && currentEntry.videoUrl.trim().length > 0;

        if (hasVideo) {
            loadGuidingVideo(currentEntry.videoUrl);
            if (elements.stepVideo) elements.stepVideo.style.display = 'block';
            window.SpeakingPracticeController?.sync?.('notes');
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
        if (!currentEntry) return;

        // Clear video iframe
        if (elements.youtubePlayer) {
            elements.youtubePlayer.innerHTML = '';
        }

        // Hide ready and video steps, show audio step
        if (elements.stepReady) elements.stepReady.style.display = 'none';
        if (elements.stepVideo) elements.stepVideo.style.display = 'none';
        if (elements.stepAudio) elements.stepAudio.style.display = 'block';
        if (elements.stepResults) elements.stepResults.style.display = 'none';
        window.SpeakingPracticeController?.sync?.('notes');

        // Focus input
        if (elements.userInput) {
            elements.userInput.focus();
        }

        // Load audio
        loadAudio(currentEntry.id);
    }

    /**
     * Load audio file with extension fallback (absolute path for deep SPA routes)
     */
    async function loadAudio(audioId) {
        const requestToken = ++audioLoadToken;
        const tryExtensions = ['mp3', 'm4a', 'wav', 'aac', 'ogg'];
        const basePath = `/database/Take%20Notes/RL/audio/${encodeURIComponent(audioId)}`;
        const deadline = Date.now() + NOTES_AUDIO_DEADLINE_MS;
        if (audioAbortController) audioAbortController.abort();
        audioAbortController = new AbortController();
        const signal = audioAbortController.signal;

        if (elements.audio) {
            elements.audio.pause();
            elements.audio.removeAttribute('src');
            elements.audio.load();
        }
        const player = getAudioPlayer();
        if (player) {
            player.reset();
            player.setEnabled(false);
        }
        isPlayerReady = false;
        setAudioStatus('loading', `Loading audio for question ${audioId}…`);

        for (const ext of tryExtensions) {
            if (requestToken !== audioLoadToken || String(currentEntry?.id) !== String(audioId) || signal.aborted) return;
            const audioPath = `${basePath}.${ext}`;
            let targetUrl = audioPath;
            let exists = false;
            if (window.MediaUrlResolver && typeof window.MediaUrlResolver.resolveAudioUrl === 'function') {
                try {
                    const resolved = await window.MediaUrlResolver.resolveAudioUrl(audioPath, { mode: 'Take-Notes' });
                    if (resolved && resolved !== audioPath) {
                        targetUrl = resolved;
                        exists = true;
                    }
                } catch (_) {}
            }
            if (!exists) {
                exists = await checkFileExists(audioPath, remainingBudget(deadline, NOTES_AUDIO_HEAD_TIMEOUT_MS), signal);
            }
            if (exists) {
                if (requestToken !== audioLoadToken || String(currentEntry?.id) !== String(audioId) || signal.aborted) return;
                try {
                    elements.audio.src = targetUrl;
                    elements.audio.load();
                    const ready = await waitForAudioReady(
                        elements.audio,
                        remainingBudget(deadline),
                        signal
                    );
                    if (!ready) continue;
                    if (requestToken !== audioLoadToken || String(currentEntry?.id) !== String(audioId) || signal.aborted) return;
                    const activePlayer = getAudioPlayer();
                    if (activePlayer) activePlayer.setEnabled(true);
                    isPlayerReady = true;
                    setAudioStatus('ready');
                    return;
                } catch (error) {
                    if (signal.aborted || requestToken !== audioLoadToken) return;
                }
            }
        }

        if (requestToken !== audioLoadToken || String(currentEntry?.id) !== String(audioId) || signal.aborted) return;
        console.warn(`[TakeNotes] No audio file found for ${audioId}`);
        const inactivePlayer = getAudioPlayer();
        if (inactivePlayer) {
            inactivePlayer.setEnabled(false);
        }
        setAudioStatus('unavailable', `Audio is not available for question ${audioId}. Retry audio or choose another question.`);
        if (audioAbortController?.signal === signal) audioAbortController = null;
    }

    async function waitForAudioReady(audio, timeoutMs, signal) {
        if (!audio || timeoutMs <= 0) return false;
        if (audio.readyState >= 3) return true;
        return new Promise((resolve) => {
            let timer = null;
            const cleanup = () => {
                if (timer) clearTimeout(timer);
                audio.removeEventListener('canplay', onReady);
                audio.removeEventListener('error', onError);
                audio.removeEventListener('abort', onError);
                if (signal) signal.removeEventListener('abort', onAbort);
            };
            const onReady = () => { cleanup(); resolve(true); };
            const onError = () => { cleanup(); resolve(false); };
            const onAbort = () => { cleanup(); resolve(false); };
            audio.addEventListener('canplay', onReady, { once: true });
            audio.addEventListener('error', onError, { once: true });
            audio.addEventListener('abort', onError, { once: true });
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(onError, timeoutMs);
        });
    }

    /**
     * Check if file exists and has valid audio content-type
     */
    async function checkFileExists(url, timeoutMs = NOTES_AUDIO_HEAD_TIMEOUT_MS, signal) {
        try {
            const response = await withTimeout(
                fetch(url, { method: 'HEAD', cache: 'no-cache', signal }),
                timeoutMs,
                'Audio probe timed out',
                signal
            );
            if (!response.ok || response.status !== 200) return false;
            const contentType = response.headers.get('content-type') || '';
            return contentType.startsWith('audio/');
        } catch (e) {
            return false;
        }
    }

    /**
     * Submit notes and show results
     */
    async function submitNotes() {
        if (!currentEntry) return;
        const qGen = questionGen;
        const aGen = attemptGen;
        const currentToken = recordingSessionToken;

        const userNotes = elements.userInput ? elements.userInput.value.trim() : '';
        if (!isV3() && !userNotes) {
            showToast('Please enter some notes before submitting.');
            return;
        }

        let finalBlob = recordingBlob;
        if (dspPromise) {
            try {
                finalBlob = await dspPromise;
            } catch (_) {
                finalBlob = recordingBlob;
            }
        }
        if (isV3() && (qGen !== questionGen || aGen !== attemptGen || currentToken !== recordingSessionToken || !v3Active)) {
            return;
        }

        // Compare notes and spoken transcript with lecture transcript
        const transcript = currentEntry.transcript || '';
        const notesResult = compareTexts(transcript, userNotes);
        const spokenResult = compareTexts(transcript, transcriptText || '');

        const hasSpokenMatches = spokenResult.matchedWords && spokenResult.matchedWords.length > 0;
        const hasNotesMatches = notesResult.matchedWords && notesResult.matchedWords.length > 0;
        const effectiveMatchedWords = hasSpokenMatches ? spokenResult.matchedWords : (notesResult.matchedWords || []);
        const effectiveHighlight = hasSpokenMatches
            ? spokenResult.highlightedTranscript
            : (hasNotesMatches ? notesResult.highlightedTranscript : spokenResult.highlightedTranscript);
        const primaryScore = effectiveMatchedWords.length;
        const primaryMaxScore = hasSpokenMatches ? spokenResult.transcriptWordCount : notesResult.transcriptWordCount;

        if (isV3()) {
            v3LastResult = {
                highlightedTranscript: effectiveHighlight,
                matchedWords: spokenResult.matchedWords,
                transcriptWordCount: spokenResult.transcriptWordCount,
                notesMatchedWords: notesResult.matchedWords,
                notesWordCount: notesResult.transcriptWordCount,
                spokenTranscript: transcriptText || '',
                effectiveMatchedWords: effectiveMatchedWords
            };
            v3LastUserNotes = userNotes;
            v3Phase = 'feedback';
            syncPteV3UI();
        } else {
            if (elements.stepReady) elements.stepReady.style.display = 'none';
            if (elements.stepVideo) elements.stepVideo.style.display = 'none';
            if (elements.stepAudio) elements.stepAudio.style.display = 'none';
            if (elements.stepResults) elements.stepResults.style.display = 'block';
        }

        window.SpeakingPracticeController?.sync?.('notes');

        // Display results
        if (elements.transcriptDisplay) elements.transcriptDisplay.innerHTML = notesResult.highlightedTranscript;
        if (elements.userDisplay) elements.userDisplay.textContent = userNotes;
        if (elements.matchCount) elements.matchCount.textContent = notesResult.matchedWords.length;

        const tracker = ensurePerformanceTracker();
        if (tracker) {
            const safeWordCount = Math.max(1, notesResult.transcriptWordCount || 0);
            const accuracy = Math.max(0, Math.min(1, notesResult.matchedWords.length / safeWordCount));
            const timeTaken = Math.max(2, (Date.now() - (notesAttemptStartTime || Date.now())) / 1000);
            tracker.recordAttempt({
                correct: notesResult.matchedWords.length > 0 && notesResult.matchedWords.length === notesResult.transcriptWordCount,
                accuracy,
                attempts: 1,
                hintUsed: false,
                timeTaken,
                wordCount: safeWordCount
            });
        }

        // Save progress if user is logged in
        saveProgress(userNotes, notesResult.matchedWords, notesResult.transcriptWordCount);

        if (isV3()) {
            try {
                await window.PTEAttemptArchive?.saveStateAttempt?.('notes', {
                    currentQuestion: currentEntry,
                    userNotes: userNotes,
                    speechTranscript: transcriptText || '',
                    userAnswer: userNotes || transcriptText || '',
                    text: userNotes || transcriptText || ''
                }, {
                    score: primaryScore,
                    maxScore: primaryMaxScore,
                    matchedWords: effectiveMatchedWords,
                    spokenMatchedWords: spokenResult.matchedWords,
                    transcriptWordCount: primaryMaxScore,
                    notesMatchedWords: notesResult.matchedWords,
                    speechTranscript: transcriptText || '',
                    hasAudio: !!finalBlob
                }, {
                    scoringSource: 'client',
                    responseSnapshot: {
                        text: userNotes || transcriptText || '',
                        userNotes: userNotes || '',
                        transcript: transcriptText || '',
                        speechTranscript: transcriptText || '',
                        responseKind: finalBlob ? 'spoken_retelling' : 'notes_only',
                        pronunciation: { status: 'not_applicable' }
                    },
                    shouldPublish: () => qGen === questionGen && aGen === attemptGen && currentToken === recordingSessionToken && v3Active,
                    media: finalBlob ? [{
                        slot: 'student',
                        label: 'Student retell',
                        blob: finalBlob,
                        contentType: finalBlob.type || 'audio/webm'
                    }] : []
                });
            } catch (error) {
                console.warn('[PTE Archive] Retell Lecture save failed:', error);
            }
        } else {
            window.PTEAttemptArchive?.saveTextAttempt?.('notes', {
                ...(currentEntry || {}),
                audioPath: currentEntry?.audioPath || currentEntry?.audio || currentEntry?.file || null,
                transcript
            }, userNotes, {
                score: notesResult.matchedWords.length,
                maxScore: notesResult.transcriptWordCount,
                matchedWords: notesResult.matchedWords,
                transcriptWordCount: notesResult.transcriptWordCount
            }, { scoringSource: 'client' }).catch((error) => console.warn('[PTE Archive] Retell Lecture save failed:', error));
        }

        window.getPracticeVariantHooks?.('notes')?.afterSubmit?.({
            entryId: String(currentEntry?.id || ''),
            userNotes
        });
    }

    /**
     * Retry practice - go back to audio step
     */
    function retryPractice() {
        if (isV3()) {
            if (elements.userInput) elements.userInput.value = '';
            notesAttemptStartTime = null;
            startV3QuestionFlow();
            return;
        }
        if (elements.stepResults) elements.stepResults.style.display = 'none';
        if (elements.userInput) elements.userInput.value = '';
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

    /* ──────────────────────────── V3 IMPLEMENTATION ──────────────────────────── */

    function stopAllV3Timers() {
        if (v3PrepRAF) {
            cancelAnimationFrame(v3PrepRAF);
            v3PrepRAF = null;
        }
        if (v3RecordRAF) {
            cancelAnimationFrame(v3RecordRAF);
            v3RecordRAF = null;
        }
    }

    function stopMediaStream() {
        if (activeMediaStream) {
            try {
                activeMediaStream.getTracks().forEach(t => t.stop());
            } catch (_) {}
            activeMediaStream = null;
        }
    }

    function startSpeechRecognition(token) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        try {
            speechRecognition = new SpeechRecognition();
            speechRecognition.continuous = true;
            speechRecognition.interimResults = false;
            speechRecognition.lang = 'en-US';
            speechRecognition.onresult = (event) => {
                if (token !== recordingSessionToken) return;
                let full = '';
                for (let i = 0; i < event.results.length; i++) {
                    full += event.results[i][0].transcript + ' ';
                }
                transcriptText = full.trim();
            };
            speechRecognition.onerror = (event) => {
                console.warn('[TakeNotes v3] Speech recognition error:', event?.error);
            };
            speechRecognition.onend = () => {};
            speechRecognition.start();
        } catch (err) {
            console.warn('[TakeNotes v3] Speech recognition start error:', err);
        }
    }

    function stopSpeechRecognition() {
        if (speechRecognition) {
            try {
                speechRecognition.stop();
            } catch (_) {}
            speechRecognition = null;
        }
    }

    function ensureV3Elements() {
        if (!elements.practiceArea) cacheElements();
        if (!elements.practiceArea) return;

        if (elements.practiceArea) elements.practiceArea.style.display = 'block';

        let instruction = document.getElementById('notes-pte-instruction');
        if (!instruction) {
            instruction = document.createElement('p');
            instruction.id = 'notes-pte-instruction';
            instruction.className = 'notes-pte-instruction pte-instr';
            instruction.textContent = 'You will hear a lecture. After listening to the lecture, in 10 seconds, please speak into the microphone and retell what you have just heard from the lecture in your own words. You will have 40 seconds to give your response.';
            elements.practiceArea.prepend(instruction);
        }

        let stage = document.getElementById('notes-pte-stage');
        if (!stage) {
            stage = document.createElement('div');
            stage.id = 'notes-pte-stage';
            stage.className = 'notes-pte-stage';

            // Audio row
            const audioRow = document.createElement('div');
            audioRow.className = 'notes-audio-row';

            const lectureIcon = document.createElement('div');
            lectureIcon.className = 'notes-lecture-icon';
            lectureIcon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;
            audioRow.appendChild(lectureIcon);

            const audioHost = document.createElement('div');
            audioHost.id = 'notes-pte-audio-host';
            audioHost.className = 'notes-pte-audio-host';
            audioRow.appendChild(audioHost);
            stage.appendChild(audioRow);

            // Recorder widget host
            const recHost = document.createElement('div');
            recHost.id = 'notes-pte-rec-host';
            recHost.className = 'notes-pte-rec-host';
            recHost.style.display = 'none';
            stage.appendChild(recHost);

            // Notes wrapper
            const notesWrapper = document.createElement('div');
            notesWrapper.className = 'notes-v3-notes-wrapper';

            const notesHeader = document.createElement('div');
            notesHeader.className = 'notes-v3-header';
            notesHeader.innerHTML = `<span class="notes-v3-title">Your notes</span><span id="notes-v3-subtitle" class="notes-v3-subtitle">· type while you listen</span>`;
            notesWrapper.appendChild(notesHeader);

            if (elements.userInput) {
                elements.userInput.className = 'notes-v3-textarea';
                notesWrapper.appendChild(elements.userInput);
            }
            stage.appendChild(notesWrapper);

            if (instruction.nextSibling) {
                elements.practiceArea.insertBefore(stage, instruction.nextSibling);
            } else {
                elements.practiceArea.appendChild(stage);
            }
        }

        const audioHost = document.getElementById('notes-pte-audio-host');
        if (audioHost && !pteAudioBox && elements.audio && window.PteAudioBox) {
            pteAudioBox = window.PteAudioBox.create(audioHost, { audio: elements.audio });
        }

        const recHost = document.getElementById('notes-pte-rec-host');
        if (recHost && !pteRecorderWidget && window.PteRecorderWidget) {
            pteRecorderWidget = window.PteRecorderWidget.create(recHost, { totalSeconds: RECORD_SECONDS });
        }

        let studentAudio = document.getElementById('notes-v3-student-audio');
        if (!studentAudio) {
            studentAudio = document.createElement('audio');
            studentAudio.id = 'notes-v3-student-audio';
            studentAudio.preload = 'auto';
            studentAudio.style.display = 'none';
            document.body.appendChild(studentAudio);
        }

        let feedback = document.getElementById('notes-pte-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.id = 'notes-pte-feedback';
            // Only the inner grid is a .pte-fb; nesting one inside another gave the
            // shell two competing column systems.
            feedback.className = 'notes-pte-feedback';
            feedback.style.display = 'none';
            feedback.hidden = true;

            const grid = document.createElement('div');
            grid.className = 'notes-fb-grid pte-fb';

            // Left column
            const leftCol = document.createElement('div');
            leftCol.className = 'notes-fb-left pte-fb__left';
            leftCol.innerHTML = `
                <div id="notes-v3-audio-preview" class="notes-v3-audio-preview" style="display: none;">
                    <label class="notes-fb-heading">Your Recording</label>
                    <audio id="notes-v3-feedback-audio" controls preload="auto"></audio>
                </div>
                <div id="notes-v3-spoken-transcript" class="notes-v3-spoken-transcript" style="display: none;">
                    <h4 class="notes-fb-heading">What you said</h4>
                    <p id="notes-v3-spoken-text" class="notes-v3-spoken-text"></p>
                </div>
                <h4 class="notes-fb-heading">Your Notes</h4>
                <div id="notes-v3-matched-notes" class="notes-v3-matched-notes"></div>
            `;
            grid.appendChild(leftCol);

            // Right column
            const rightCol = document.createElement('div');
            rightCol.className = 'notes-fb-right pte-fb__right';
            rightCol.innerHTML = `
                <div class="notes-v3-fb-tabs">
                    <button type="button" class="notes-v3-fb-tab active" data-v3-tab="notes-match">Notes match</button>
                    <button type="button" class="notes-v3-fb-tab" data-v3-tab="transcript">Lecture transcript</button>
                </div>
                <div id="notes-v3-match-panel" class="notes-v3-fb-panel">
                    <div class="notes-results-stats"><span id="notes-v3-match-count">0</span> words matched</div>
                    <div id="notes-v3-match-details" class="notes-v3-match-details"></div>
                </div>
                <div id="notes-v3-transcript-panel" class="notes-v3-fb-panel" style="display: none;">
                    <div id="notes-v3-transcript-display" class="notes-transcript-display"></div>
                </div>
            `;
            grid.appendChild(rightCol);
            feedback.appendChild(grid);
            elements.practiceArea.appendChild(feedback);

            const tabButtons = feedback.querySelectorAll('.notes-v3-fb-tab');
            tabButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const tab = btn.dataset.v3Tab;
                    v3ActiveTab = tab;
                    tabButtons.forEach(b => b.classList.toggle('active', b === btn));
                    const matchP = document.getElementById('notes-v3-match-panel');
                    const transP = document.getElementById('notes-v3-transcript-panel');
                    if (matchP) matchP.style.display = tab === 'notes-match' ? 'flex' : 'none';
                    if (transP) transP.style.display = tab === 'transcript' ? 'flex' : 'none';
                });
            });
        }

        // Expose and bind dock action buttons
        ['notes-record-btn', 'notes-cancel-btn', 'notes-stop-btn', 'notes-rec-play-btn', 'notes-submit-btn', 'notes-retry-btn', 'notes-redo-btn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.style.display = '';
        });

        const recordBtn = document.getElementById('notes-record-btn');
        if (recordBtn && !recordBtn.dataset.v3Bound) {
            recordBtn.dataset.v3Bound = 'true';
            recordBtn.addEventListener('click', () => {
                if (v3Phase === 'prep') startV3Recording();
            });
        }
        const cancelBtn = document.getElementById('notes-cancel-btn');
        if (cancelBtn && !cancelBtn.dataset.v3Bound) {
            cancelBtn.dataset.v3Bound = 'true';
            cancelBtn.addEventListener('click', () => {
                if (v3Phase === 'recording') cancelRecording();
            });
        }
        const stopBtn = document.getElementById('notes-stop-btn');
        if (stopBtn && !stopBtn.dataset.v3Bound) {
            stopBtn.dataset.v3Bound = 'true';
            stopBtn.addEventListener('click', () => {
                if (v3Phase === 'recording') stopV3Recording();
            });
        }
        const playBtn = document.getElementById('notes-rec-play-btn');
        if (playBtn && !playBtn.dataset.v3Bound) {
            playBtn.dataset.v3Bound = 'true';
            playBtn.addEventListener('click', () => {
                if (v3Phase === 'complete') toggleRecordingPlayback();
            });
        }
        const redoBtn = document.getElementById('notes-redo-btn');
        if (redoBtn && !redoBtn.dataset.v3Bound) {
            redoBtn.dataset.v3Bound = 'true';
            redoBtn.addEventListener('click', () => {
                if (v3Phase === 'feedback') retryPractice();
            });
        }
    }

    function syncPteV3UI() {
        if (!isV3()) return;
        const stage = document.getElementById('notes-pte-stage');
        const feedback = document.getElementById('notes-pte-feedback');
        const recHost = document.getElementById('notes-pte-rec-host');
        if (elements.practiceArea) elements.practiceArea.style.display = 'block';

        if (v3Phase === 'feedback') {
            if (stage) { stage.hidden = true; stage.style.display = 'none'; }
            // Leave display to the stylesheet so .pte-fb keeps its grid and its
            // stacking rule; an inline value overrode both.
            if (feedback) { feedback.hidden = false; feedback.style.display = ''; }
            renderV3Feedback();
        } else {
            if (stage) { stage.hidden = false; stage.style.display = 'flex'; }
            if (feedback) { feedback.hidden = true; feedback.style.display = ''; }
            if (recHost) {
                recHost.style.display = (v3Phase === 'prep' || v3Phase === 'recording' || v3Phase === 'complete') ? '' : 'none';
            }
        }
    }

    async function startV3QuestionFlow() {
        if (!v3Active || !currentEntry) return;
        closeIntroVideoModal();
        stopAllV3Timers();
        stopSpeechRecognition();
        if (activeRecorder) {
            try { activeRecorder.cancel(); } catch (_) {}
            activeRecorder = null;
        }
        stopMediaStream();
        recordingSessionToken++;
        if (recordingBlobUrl) {
            URL.revokeObjectURL(recordingBlobUrl);
            recordingBlobUrl = null;
        }
        recordingBlob = null;
        dspPromise = null;
        transcriptText = '';
        recordedChunks = [];
        mediaRecorder = null;

        const qGen = ++questionGen;
        const aGen = ++attemptGen;
        v3Phase = 'listen';
        syncPteShell();

        ensureV3Elements();
        syncPteV3UI();

        if (elements.userInput) {
            elements.userInput.value = '';
        }
        notesAttemptStartTime = null;

        const sub = document.getElementById('notes-v3-subtitle');
        if (sub) sub.textContent = '· type while you listen';

        loadAudio(currentEntry.id);
        pteAudioBox?.reset?.();
        pteRecorderWidget?.reset?.();

        const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
        const cdSec = scale < 1 ? 1 : 3;

        try {
            if (pteAudioBox) {
                await pteAudioBox.countdown(cdSec);
            }
        } catch (err) {
            if (err?.name === 'AbortError' || qGen !== questionGen || aGen !== attemptGen) return;
        }
        if (qGen !== questionGen || aGen !== attemptGen || !v3Active) return;

        try {
            if (pteAudioBox) {
                await pteAudioBox.play();
            }
        } catch (err) {
            if (err?.name === 'AbortError' || qGen !== questionGen || aGen !== attemptGen) return;
            console.warn('[TakeNotes v3] Audio play error:', err);
        }
        if (qGen !== questionGen || aGen !== attemptGen || !v3Active) return;

        startV3Prep();
    }

    function startV3Prep() {
        if (!v3Active || !currentEntry) return;
        stopAllV3Timers();
        stopMediaStream();

        const qGen = questionGen;
        const aGen = ++attemptGen;
        v3Phase = 'prep';
        syncPteShell();
        syncPteV3UI();

        v3RecordedDurationSec = 0;
        if (recordingBlobUrl) {
            URL.revokeObjectURL(recordingBlobUrl);
            recordingBlobUrl = null;
        }
        recordingBlob = null;
        dspPromise = null;
        transcriptText = '';

        const recHost = document.getElementById('notes-pte-rec-host');
        if (recHost) recHost.style.display = '';

        const sub = document.getElementById('notes-v3-subtitle');
        if (sub) sub.textContent = '· prepare your retell';

        const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
        const effectivePrepScale = scale < 1 ? 1 : scale;
        const prepDuration = scale < 1 ? 1 : PREP_SECONDS;

        v3PrepStartTime = performance.now();
        pteRecorderWidget?.showCountdown(prepDuration);

        const tickPrep = () => {
            if (qGen !== questionGen || aGen !== attemptGen || v3Phase !== 'prep' || !v3Active) return;
            const elapsed = ((performance.now() - v3PrepStartTime) / 1000) / effectivePrepScale;
            const remaining = Math.max(0, prepDuration - elapsed);
            pteRecorderWidget?.tick(remaining);
            if (elapsed >= prepDuration) {
                startV3Recording();
                return;
            }
            v3PrepRAF = requestAnimationFrame(tickPrep);
        };
        v3PrepRAF = requestAnimationFrame(tickPrep);
    }

    async function startV3Recording() {
        stopAllV3Timers();

        const qGen = questionGen;
        const aGen = ++attemptGen;
        v3Phase = 'recording';
        syncPteShell();
        syncPteV3UI();

        const recHost = document.getElementById('notes-pte-rec-host');
        if (recHost) recHost.style.display = '';

        const sub = document.getElementById('notes-v3-subtitle');
        if (sub) sub.textContent = '· look at them while you speak';

        recordingSessionToken++;
        const myToken = recordingSessionToken;
        recordedChunks = [];
        v3RecordedDurationSec = 0;
        if (recordingBlobUrl) {
            URL.revokeObjectURL(recordingBlobUrl);
            recordingBlobUrl = null;
        }
        recordingBlob = null;
        dspPromise = null;
        transcriptText = '';

        let stream = null;
        let recorder = null;

        try {
            if (window.AudioDspPipeline && typeof window.AudioDspPipeline.createRecorder === 'function') {
                recorder = window.AudioDspPipeline.createRecorder({
                    onStream: (st) => {
                        stream = st;
                        activeMediaStream = st;
                        pteRecorderWidget?.attachStream(st);
                    },
                    onDataAvailable: (chunk) => {
                        if (chunk && chunk.size > 0) recordedChunks.push(chunk);
                    }
                });
                await recorder.start();
                activeRecorder = recorder;
                if (!stream && typeof recorder.getStream === 'function') {
                    stream = recorder.getStream();
                    if (stream) {
                        activeMediaStream = stream;
                        pteRecorderWidget?.attachStream(stream);
                    }
                }
            } else {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                activeMediaStream = stream;
                pteRecorderWidget?.attachStream(stream);
                const mimeType = (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
                    ? 'audio/webm;codecs=opus' : 'audio/webm';
                const mr = new MediaRecorder(stream, { mimeType });
                mediaRecorder = mr;
                mr.ondataavailable = (e) => {
                    if (e.data.size > 0) recordedChunks.push(e.data);
                };
                mr.start(250);
            }
        } catch (err) {
            console.warn('[TakeNotes v3] Microphone access error:', err);
            if (qGen !== questionGen || aGen !== attemptGen || !v3Active || myToken !== recordingSessionToken) return;
            showToast('Microphone access was denied or unavailable. You can review your notes and get feedback.');
            v3Phase = 'complete';
            syncPteShell();
            syncPteV3UI();
            pteRecorderWidget?.showComplete();
            return;
        }

        if (qGen !== questionGen || aGen !== attemptGen || v3Phase !== 'recording' || !v3Active || myToken !== recordingSessionToken) {
            if (recorder) {
                try { recorder.cancel(); } catch (_) {}
            }
            stopMediaStream();
            return;
        }

        pteRecorderWidget?.showRecording(RECORD_SECONDS);
        startSpeechRecognition(myToken);

        v3RecordStartTime = performance.now();
        const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
        const effectiveRecScale = scale < 1 ? 0.3 : scale;

        const tickRec = () => {
            if (qGen !== questionGen || aGen !== attemptGen || v3Phase !== 'recording' || !v3Active || myToken !== recordingSessionToken) return;
            const elapsed = ((performance.now() - v3RecordStartTime) / 1000) / effectiveRecScale;
            v3RecordedDurationSec = elapsed;
            pteRecorderWidget?.setElapsed(elapsed);
            if (elapsed >= RECORD_SECONDS) {
                stopV3Recording();
                return;
            }
            v3RecordRAF = requestAnimationFrame(tickRec);
        };
        v3RecordRAF = requestAnimationFrame(tickRec);
    }

    async function stopV3Recording() {
        if (v3Phase !== 'recording') return;
        const qGen = questionGen;
        const aGen = attemptGen;
        const myToken = recordingSessionToken;

        stopAllV3Timers();
        stopSpeechRecognition();
        v3Phase = 'complete';
        syncPteShell();
        syncPteV3UI();
        pteRecorderWidget?.showComplete();

        let stopResult = null;
        if (activeRecorder) {
            try {
                stopResult = await activeRecorder.stop();
            } catch (err) {
                console.warn('[TakeNotes v3] recorder.stop() error:', err);
            }
            activeRecorder = null;
        } else if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch (_) {}
        }
        stopMediaStream();

        if (qGen !== questionGen || aGen !== attemptGen || myToken !== recordingSessionToken || !v3Active) {
            return;
        }

        onV3RecordingComplete(stopResult);
    }

    function onV3RecordingComplete(stopResult) {
        const currentToken = recordingSessionToken;
        let blob = stopResult?.wavBlob || stopResult?.rawBlob || null;
        if (!blob && recordedChunks.length > 0) {
            blob = new Blob(recordedChunks, { type: 'audio/webm' });
        }

        recordingBlob = blob;
        if (blob) {
            recordingBlobUrl = stopResult?.audioUrl || URL.createObjectURL(blob);
            const userAudio = document.getElementById('notes-v3-student-audio');
            if (userAudio) userAudio.src = recordingBlobUrl;
        }

        if (blob && !stopResult && window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function') {
            dspPromise = window.AudioDspPipeline.enhance(blob).then((res) => {
                if (currentToken !== recordingSessionToken) return blob;
                if (res?.wavBlob) {
                    if (recordingBlobUrl && !stopResult?.audioUrl) URL.revokeObjectURL(recordingBlobUrl);
                    recordingBlob = res.wavBlob;
                    recordingBlobUrl = res.audioUrl || URL.createObjectURL(res.wavBlob);
                    const userAudio = document.getElementById('notes-v3-student-audio');
                    if (userAudio) userAudio.src = recordingBlobUrl;
                    return res.wavBlob;
                }
                return blob;
            }).catch((err) => {
                console.warn('[TakeNotes v3] DSP enhancement fallback to raw:', err);
                return blob;
            });
        } else {
            dspPromise = Promise.resolve(blob);
        }
    }

    function cancelRecording() {
        if (v3Phase !== 'recording') return;
        stopAllV3Timers();
        stopSpeechRecognition();
        if (activeRecorder) {
            try { activeRecorder.cancel(); } catch (_) {}
            activeRecorder = null;
        }
        stopMediaStream();
        recordingSessionToken++;
        recordedChunks = [];
        recordingBlob = null;
        dspPromise = null;
        transcriptText = '';
        startV3Prep();
    }

    function retryV3Recording() {
        if (v3Phase !== 'complete') return;
        stopAllV3Timers();
        stopMediaStream();
        recordingSessionToken++;
        if (recordingBlobUrl) {
            URL.revokeObjectURL(recordingBlobUrl);
            recordingBlobUrl = null;
        }
        recordingBlob = null;
        dspPromise = null;
        transcriptText = '';
        startV3Prep();
    }

    function finishRecordingForNext() {
        if (v3Phase === 'recording') {
            stopV3Recording();
        }
    }

    function toggleRecordingPlayback() {
        let audioEl = document.getElementById('notes-v3-student-audio');
        if (!audioEl) return;
        if (recordingBlobUrl && audioEl.src !== recordingBlobUrl) {
            audioEl.src = recordingBlobUrl;
        }
        if (audioEl.paused) {
            audioEl.play().catch(e => console.warn('[TakeNotes v3] Playback error:', e));
        } else {
            audioEl.pause();
        }
    }

    function renderV3Feedback() {
        const feedback = document.getElementById('notes-pte-feedback');
        if (!feedback || !v3LastResult) return;

        // Feedback audio preview
        const audioPreview = document.getElementById('notes-v3-audio-preview');
        const fbAudio = document.getElementById('notes-v3-feedback-audio');
        if (audioPreview && fbAudio) {
            if (recordingBlobUrl) {
                fbAudio.src = recordingBlobUrl;
                audioPreview.style.display = 'flex';
            } else {
                audioPreview.style.display = 'none';
            }
        }

        // Spoken transcript preview
        const spokenWrap = document.getElementById('notes-v3-spoken-transcript');
        const spokenText = document.getElementById('notes-v3-spoken-text');
        if (spokenWrap && spokenText) {
            if (v3LastResult.spokenTranscript) {
                spokenText.textContent = v3LastResult.spokenTranscript;
                spokenWrap.style.display = 'block';
            } else {
                spokenWrap.style.display = 'none';
            }
        }

        const matchedNotes = document.getElementById('notes-v3-matched-notes');
        if (matchedNotes) {
            const userNotes = v3LastUserNotes || '';
            const matchedSet = new Set((v3LastResult.notesMatchedWords || v3LastResult.matchedWords || []).map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')));
            const tokens = userNotes.split(/(\s+)/);
            const html = tokens.map(tok => {
                const cleanTok = tok.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanTok && matchedSet.has(cleanTok)) {
                    return `<span class="notes-matched">${escapeHtml(tok)}</span>`;
                }
                return escapeHtml(tok);
            }).join('');
            matchedNotes.innerHTML = html || '<em>No notes entered</em>';
        }

        const countEl = document.getElementById('notes-v3-match-count');
        if (countEl) {
            const displayCount = (v3LastResult.effectiveMatchedWords?.length != null)
                ? v3LastResult.effectiveMatchedWords.length
                : (v3LastResult.spokenTranscript ? (v3LastResult.matchedWords?.length || 0) : (v3LastResult.notesMatchedWords?.length || 0));
            countEl.textContent = displayCount;
        }

        const matchDetails = document.getElementById('notes-v3-match-details');
        if (matchDetails) {
            const spokenMatches = v3LastResult.matchedWords?.length || 0;
            const notesMatches = v3LastResult.notesMatchedWords?.length || 0;
            const totalWords = v3LastResult.transcriptWordCount || 1;
            const spokenPct = Math.min(100, Math.round((spokenMatches / totalWords) * 100));
            const notesPct = Math.min(100, Math.round((notesMatches / totalWords) * 100));
            const spokenLine = v3LastResult.spokenTranscript
                ? `<p><strong>Spoken Content Coverage:</strong> ${spokenPct}% (${spokenMatches} key lecture terms identified)</p>`
                : `<p><strong>Spoken Content Coverage:</strong> <em>No spoken words detected (audio only or silent)</em></p>`;
            matchDetails.innerHTML = `
                ${spokenLine}
                <p><strong>Written Notes Match:</strong> ${notesPct}% (${notesMatches} terms recorded)</p>
            `;
        }

        const transcriptEl = document.getElementById('notes-v3-transcript-display');
        if (transcriptEl) {
            transcriptEl.innerHTML = v3LastResult.highlightedTranscript || '';
        }

        // Additive spoken retelling step behind RL_SPOKEN_ASSESSMENT (§12.3)
        let spokenRetellHost = document.getElementById('notes-v3-spoken-retell-host');
        if (!spokenRetellHost) {
            spokenRetellHost = document.createElement('div');
            spokenRetellHost.id = 'notes-v3-spoken-retell-host';
            spokenRetellHost.className = 'notes-v3-spoken-retell-host';
            feedback.appendChild(spokenRetellHost);
        }

        if (window.RLSpokenResponseController && window.RLSpokenResponseController.isEnabled()) {
            window.RLSpokenResponseController.mount(spokenRetellHost, {
                entry: currentEntry,
                userNotes: v3LastUserNotes || elements.userInput?.value || ''
            });
        } else if (spokenRetellHost) {
            spokenRetellHost.style.display = 'none';
        }
    }

    function openIntroVideoModal() {
        if (!currentEntry?.videoUrl || currentEntry.videoUrl.trim().length === 0) {
            showToast('No intro video available for this lecture.');
            return;
        }
        const videoId = extractVideoId(currentEntry.videoUrl);
        if (!videoId) {
            showToast('Intro video is not available.');
            return;
        }

        closeIntroVideoModal();
        const opener = document.getElementById('notes-intro-video-btn') || document.activeElement;

        const overlay = document.createElement('div');
        overlay.id = 'notes-video-modal-overlay';
        overlay.className = 'pte-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.id = 'notes-video-dialog';
        dialog.className = 'pte-dialog notes-video-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'notes-video-modal-title');

        dialog.innerHTML = `
            <div class="notes-video-dialog-header">
                <h3 id="notes-video-modal-title">Intro Video · ${escapeHtml(currentEntry.title ? currentEntry.title.replace(/^#\d+\s*/, '') : 'Lecture')}</h3>
                <button type="button" class="notes-video-dialog-close" aria-label="Close intro video">✕</button>
            </div>
            <div class="notes-video-dialog-body">
                <iframe
                    width="100%"
                    height="100%"
                    src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1"
                    frameborder="0"
                    allow="autoplay; encrypted-media"
                    allowfullscreen>
                </iframe>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const closeBtn = dialog.querySelector('.notes-video-dialog-close');
        const closeHandler = () => {
            closeIntroVideoModal();
            if (opener && opener.isConnected) opener.focus();
        };
        closeBtn.addEventListener('click', closeHandler);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeHandler();
        });

        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeHandler();
            }
        };
        overlay.addEventListener('keydown', keyHandler);

        v3VideoModal = {
            overlay,
            close: () => {
                overlay.removeEventListener('keydown', keyHandler);
                const iframe = overlay.querySelector('iframe');
                if (iframe) iframe.src = '';
                overlay.remove();
                v3VideoModal = null;
            }
        };

        closeBtn.focus();
    }

    function closeIntroVideoModal() {
        if (v3VideoModal) {
            v3VideoModal.close();
            v3VideoModal = null;
        }
    }

    function mountPteShell() {
        v3Active = true;
        const modePanel = document.getElementById('mode-notes');
        if (modePanel) modePanel.classList.add('notes-pte-v3');
        ensureV3Elements();
        if (currentEntry) {
            queueMicrotask(() => {
                if (v3Active && currentEntry) {
                    startV3QuestionFlow();
                }
            });
        }
        syncPteV3UI();
    }

    function unmountPteShell() {
        v3Active = false;
        const modePanel = document.getElementById('mode-notes');
        if (modePanel) modePanel.classList.remove('notes-pte-v3');
        closeIntroVideoModal();
        stopAllV3Timers();
        stopSpeechRecognition();
        if (activeRecorder) {
            try { activeRecorder.cancel(); } catch (_) {}
            activeRecorder = null;
        }
        stopMediaStream();
        pteAudioBox?.reset?.();
        pteRecorderWidget?.reset?.();
        v3Phase = 'loading';
        const inst = document.getElementById('notes-pte-instruction');
        if (inst) inst.remove();
        const st = document.getElementById('notes-pte-stage');
        if (st) st.remove();
        const fb = document.getElementById('notes-pte-feedback');
        if (fb) fb.remove();
        const userAudio = document.getElementById('notes-v3-student-audio');
        if (userAudio) userAudio.remove();
        if (recordingBlobUrl) {
            URL.revokeObjectURL(recordingBlobUrl);
            recordingBlobUrl = null;
        }
        recordingBlob = null;
        dspPromise = null;
        transcriptText = '';
        recordedChunks = [];
        mediaRecorder = null;
        pteAudioBox = null;
        pteRecorderWidget = null;
    }

    function syncPteShell() {
        if (!isV3()) return;
        try {
            window.SpeakingPracticeController?.sync?.('notes');
        } catch (_) {}
    }

    function advanceQuestion() {
        if (!filteredEntries || filteredEntries.length === 0) return;
        const nextIndex = (currentEntryIndex + 1) % filteredEntries.length;
        selectEntry(nextIndex);
    }

    function selectEntryById(id) {
        const idx = filteredEntries.findIndex(e => String(e.id) === String(id));
        if (idx >= 0) selectEntry(idx);
    }

    async function onEnter() {
        init();
        if (!isInitialized) return false;
        if (isV3()) {
            mountPteShell();
        }
        const load = beginEntryGeneration();
        const loaded = await loadEntries(load);
        if (!isEntryGenerationActive(load.generation)) return false;
        if (!loaded && !hasLoadedEntries) return false;
        if (window.PracticeRouter && currentEntry?.id) {
            window.PracticeRouter.replaceRoute('notes', currentEntry.id);
        }
        if (isV3() && currentEntry) {
            startV3QuestionFlow();
        }
        try {
            window.SpeakingPracticeController?.sync?.('notes');
        } catch (_) {}
        return true;
    }

    function onExit() {
        entryGeneration += 1;
        if (entryAbortController) {
            entryAbortController.abort();
            entryAbortController = null;
        }
        if (isV3()) {
            unmountPteShell();
        }
        reset();
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
        onEnter,
        onExit,
        loadEntries,
        applyFilters: applyFilter,
        selectEntry,
        selectEntryById,
        startPractice,
        retryAudio: () => currentEntry ? loadAudio(currentEntry.id) : Promise.resolve(false),
        submitNotes,
        retryPractice,
        getCurrentEntry: () => currentEntry,
        getItems: () => filteredEntries,
        previous: goToPrevious,
        next: goToNext,
        // v3 methods
        mountPteShell,
        unmountPteShell,
        syncPteShell,
        getPtePhase: () => v3Phase,
        startV3QuestionFlow,
        advanceQuestion,
        openIntroVideoModal,
        closeIntroVideoModal,
        hasGuidingVideo: () => !!(currentEntry?.videoUrl && currentEntry.videoUrl.trim().length > 0),
        getCurrentFilter: () => currentFilter,
        startV3Prep,
        startV3Recording,
        stopV3Recording,
        cancelRecording,
        retryV3Recording,
        finishRecordingForNext,
        toggleRecordingPlayback,
        getRecordingBlob: () => recordingBlob,
        getTranscriptText: () => transcriptText,
        getDspPromise: () => dspPromise
    };

    // Deep-link support: listen for PracticeRouter question navigation events
    window.addEventListener('practice-route-question', (event) => {
        const { mode, questionId } = event.detail || {};
        if (mode !== 'notes' || !questionId) return;
        pendingRouteQuestionId = String(questionId);
        if (!hasLoadedEntries || filteredEntries.length === 0) return;
        const idx = filteredEntries.findIndex((e) => String(e.id) === String(questionId));
        if (idx >= 0) {
            pendingRouteQuestionId = null;
            selectEntry(idx);
        }
    });

})();
