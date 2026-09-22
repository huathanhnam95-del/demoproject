/**
 * SGD Mode Module (Summarize Group Discussion)
 * Handles the SGD practice mode in the learner app
 * Flow: Select question → Play → Listen + Take Notes (speaker tabs) → Record (2 min max) → Results
 *
 * Forked from take-notes-mode.js with:
 *  - Speaker-tabbed note-taking instead of single textarea
 *  - 2-minute recording phase (MediaRecorder)
 *  - Speaker-aware compareTexts scoring (who-said-what)
 */

(function () {
    'use strict';

    const FIRESTORE_LOAD_TIMEOUT_MS = 8000;
    const MAX_RECORDING_SECONDS = 120; // 2 minutes
    const STEPS = ['listen', 'record', 'results'];

    // State
    let entries = [];
    let filteredEntries = [];
    let currentEntryIndex = 0;
    let currentEntry = null;
    let currentFilter = 'all';
    let isInitialized = false;
    let hasLoadedEntries = false;
    let loadEntriesPromise = null;
    let currentStep = null; // track active step for breadcrumb
    let speakerShortcutBound = false; // prevent duplicate listener
    let currentAudioLoadToken = 0;
    let speakerTabButtons = [];
    let speakerNotePanels = [];
    let speakerNoteInputs = [];
    const audioAvailabilityCache = new Map();

    // Recording state
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordingTimerId = null;
    let recordingSeconds = 0;
    let recordingBlobUrl = null;
    let recordingBlob = null;
    let originalRecordingBlob = null;
    let enhancedPlaybackBlob = null;
    let acceptedTranscription = null;
    let pronunciationAssessmentId = null;
    let dspPromise = null;
    let recordingSessionToken = 0;

    // PTE Speaking Shell v3 state
    let v3Active = false;
    let v3Phase = 'loading'; // 'listen' | 'prep' | 'recording' | 'complete' | 'feedback'
    let questionGen = 0;
    let attemptGen = 0;
    let v3Timer = null;
    let v3RecordRAF = null;
    let pteAudioBox = null;
    let pteRecorderWidget = null;
    let v3PrepStartTime = 0;
    let v3RecordStartTime = 0;
    let v3RecordedDurationSec = 0;
    let v3ActiveTab = 'stats'; // 'stats' | 'transcript'
    let v3ActiveSpeakerIndex = 0;
    let v3LastResult = null;
    let v3LastNotes = null;
    let activeMediaStream = null;

    // Recommendation engine state
    let sgdRecommendationEngine = null;
    let sgdRecommendationIndex = null;
    let recentRecommendedIds = [];
    let sgdAttemptStartTime = null;
    let sgdPerformanceTracker = null;

    const REASON_LABELS = {
        level_and_continuity: 'Smart Match',
        difficulty_only: 'Difficulty Match',
        continuity_only: 'Vocabulary Match',
        fallback: 'Best Available Match'
    };

    /* ──────────────────────────── HELPERS ─────────────────────────── */

    function isV3() {
        return !!(v3Active || window.PteShellConfig?.isModeEnabled?.('sgd', 'pte'));
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function show(element) { if (element) element.style.display = 'block'; }
    function hide(element) { if (element) element.style.display = 'none'; }
    function showInline(element) { if (element) element.style.display = ''; }
    function clearChildren(element) { if (element) element.replaceChildren(); }

    function autoGrowTextarea(e) {
        const ta = e.target;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
    }

    /* ── Stop words & keyword helpers (module-level) ── */
    const STOP_WORDS = new Set([
        'a', 'an', 'the', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should',
        'may', 'might', 'must', 'can', 'could', 'i', 'me', 'my', 'mine', 'we', 'us',
        'our', 'ours', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
        'it', 'its', 'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those',
        'and', 'but', 'or', 'nor', 'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very',
        'just', 'about', 'also', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from',
        'by', 'as', 'into', 'like', 'over', 'after', 'before', 'between', 'out', 'up',
        'down', 'off', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
        'some', 'such', 'only', 'own', 'same', 'what', 'which', 'who', 'whom', 'how',
        'when', 'where', 'why', 'here', 'there', 'again', 'once', 'well', 'much',
        'even', 'still', 'already', 'really', 'quite', 'lot', 'thing', 'things',
        'gonna', 'gotta', 'wanna', 'dont', 'doesnt', 'didnt', 'wont', 'cant',
        'get', 'got', 'make', 'know', 'think', 'go', 'going', 'come', 'take', 'want'
    ]);
    const cleanWord = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isKeyword = (w) => w.length > 2 && !STOP_WORDS.has(w);

    /** In-web toast notification (replaces browser alert) */
    function showToast(message, durationMs) {
        const existing = document.getElementById('sgd-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'sgd-toast';
        Object.assign(toast.style, {
            position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
            background: '#333', color: '#fff', padding: '12px 24px', borderRadius: '8px',
            fontSize: '14px', zIndex: '10000', boxShadow: '0 4px 12px rgba(0,0,0,.25)',
            transition: 'opacity .3s', opacity: '1'
        });
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 350); }, durationMs || 3000);
    }

    /** In-web confirm banner inside a container element */
    function showConfirmBanner(container, message, onConfirm, onCancel) {
        const existing = container.querySelector('.sgd-confirm-banner');
        if (existing) existing.remove();
        const banner = document.createElement('div');
        banner.className = 'sgd-confirm-banner';
        Object.assign(banner.style, {
            background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '8px',
            padding: '14px 18px', marginBottom: '12px', display: 'flex',
            alignItems: 'center', gap: '12px', flexWrap: 'wrap'
        });
        const msg = document.createElement('span');
        msg.style.flex = '1';
        msg.textContent = message;
        const btnYes = document.createElement('button');
        btnYes.textContent = 'Yes, submit anyway';
        Object.assign(btnYes.style, {
            background: '#28a745', color: '#fff', border: 'none', borderRadius: '6px',
            padding: '6px 14px', cursor: 'pointer', fontSize: '13px'
        });
        btnYes.addEventListener('click', () => { banner.remove(); onConfirm(); });
        const btnNo = document.createElement('button');
        btnNo.textContent = 'Let me add notes first';
        Object.assign(btnNo.style, {
            background: '#6c757d', color: '#fff', border: 'none', borderRadius: '6px',
            padding: '6px 14px', cursor: 'pointer', fontSize: '13px'
        });
        btnNo.addEventListener('click', () => { banner.remove(); if (onCancel) onCancel(); });
        banner.append(msg, btnYes, btnNo);
        container.prepend(banner);
    }

    function setSelectSingleOption(select, label) {
        if (!select) return;
        clearChildren(select);
        const option = document.createElement('option');
        option.value = '';
        option.textContent = label;
        select.appendChild(option);
    }

    // DOM Elements
    const el = {};

    /* ──────────────────────────── INIT ──────────────────────────── */

    function init() {
        if (isInitialized) return;
        cacheElements();
        if (!el.questionSelect) {
            console.warn('[SGD] UI elements not found, skipping init');
            return;
        }
        setupEventListeners();
        isInitialized = true;

    }

    function getAudioPlayer() {
        if (!el.audioPlayer && window.PracticeAudioPlayer) {
            el.audioPlayer = window.PracticeAudioPlayer.attach({
                prefix: 'sgd',
                audioId: 'sgd-audio'
            });
        }
        return el.audioPlayer;
    }

    function reset() {
        currentAudioLoadToken += 1;
        hide(el.practiceArea);
        hide(el.stepListen);
        hide(el.stepRecord);
        hide(el.stepResults);
        if (el.audio) {
            el.audio.pause();
            el.audio.removeAttribute('src');
            el.audio.load();
        }
        const player = getAudioPlayer();
        if (player) {
            player.reset();
            player.setEnabled(true);
        }
        if (el.audio && el.audio.parentElement) {
            el.audio.parentElement.classList.remove('sgd-audio-loading');
        }
        stopRecording(true); // silent cleanup
        if (recordingBlobUrl) {
            URL.revokeObjectURL(recordingBlobUrl);
            recordingBlobUrl = null;
        }
        recordingBlob = null;
        dspPromise = null;
        recordingSessionToken++;
        if (el.recordingPlayback) {
            el.recordingPlayback.removeAttribute('src');
            el.recordingPlayback.load();
        }
        hide(el.playbackArea);
        hide(el.submitBtn);
        hide(el.stopBtn);
        showInline(el.recordBtn);
        if (el.recordTimer) {
            el.recordTimer.classList.remove('sgd-recording-active', 'sgd-timer-warning');
        }
        updateTimerDisplay(0);
        setProceedEnabled(false);
        setAudioStatus('');
        clearSpeakerNotes();
        if (el.resultsContainer) clearChildren(el.resultsContainer);
        if (el.overallAccuracy) el.overallAccuracy.textContent = '0';
        currentStep = null;
        updateStepProgress();

        // Restore DOM order if recording step was reordered above listening
        if (el.stepRecord && el.stepListen && el.stepRecord.parentNode) {
            const parent = el.stepRecord.parentNode;
            if (Array.from(parent.children).indexOf(el.stepRecord) < Array.from(parent.children).indexOf(el.stepListen)) {
                parent.insertBefore(el.stepListen, el.stepRecord);
            }
        }
    }

    async function onEnter() {
        init();
        await loadEntries();
        if (window.PracticeRouter && currentEntry?.id) {
            window.PracticeRouter.replaceRoute('sgd', currentEntry.id);
        }
        if (isV3()) {
            ensureV3Elements();
            if (currentEntry) {
                queueMicrotask(() => {
                    if (v3Active && currentEntry) startV3QuestionFlow();
                });
            }
        }
    }

    function onExit() {
        reset();
        if (isV3()) {
            stopAllV3Timers();
            stopMediaStream();
            if (pteAudioBox) {
                pteAudioBox.destroy();
                pteAudioBox = null;
            }
            if (pteRecorderWidget) {
                pteRecorderWidget.destroy();
                pteRecorderWidget = null;
            }
        }
    }

    /* ──────────────────────────── DOM CACHE ──────────────────────── */

    function cacheElements() {
        // Question selector
        el.currentQuestionId = document.getElementById('current-question-id-sgd');
        el.backBtn = document.getElementById('back-btn-sgd');
        el.nextBtn = document.getElementById('next-btn-sgd');
        el.questionSelect = document.getElementById('question-select-sgd');
        el.playBtn = document.getElementById('play-sgd-btn');
        el.recommendedBtn = document.getElementById('recommended-btn-sgd');
        el.recommendationSummary = document.getElementById('recommendation-summary-sgd');

        // Practice area
        el.practiceArea = document.getElementById('sgd-practice-area');

        // Step 1: Listen + Notes
        el.stepListen = document.getElementById('sgd-step-listen');
        el.topicDisplay = document.getElementById('sgd-topic');
        el.audio = document.getElementById('sgd-audio');
        el.audioStatus = document.getElementById('sgd-audio-status');
        getAudioPlayer();
        el.speakerTabs = document.getElementById('sgd-speaker-tabs');
        el.notePanels = document.getElementById('sgd-note-panels');
        el.nextStepBtn = document.getElementById('sgd-next-step-btn');

        // Step 2: Record
        el.stepRecord = document.getElementById('sgd-step-record');
        el.recordTimer = document.getElementById('sgd-record-timer');
        el.recordBtn = document.getElementById('sgd-record-btn');
        el.stopBtn = document.getElementById('sgd-stop-btn');
        el.playbackArea = document.getElementById('sgd-playback-area');
        el.recordingPlayback = document.getElementById('sgd-recording-playback');
        el.submitBtn = document.getElementById('sgd-submit-btn');

        // Step 3: Results
        el.stepResults = document.getElementById('sgd-step-results');
        el.resultsContainer = document.getElementById('sgd-results-container');
        el.overallAccuracy = document.getElementById('sgd-overall-accuracy');
        el.retryBtn = document.getElementById('sgd-retry-btn');
        el.backToNotesBtn = document.getElementById('sgd-back-to-notes-btn');
    }

    /* ──────────────────────────── EVENT LISTENERS ────────────────── */

    function setupEventListeners() {
        if (el.backBtn) el.backBtn.addEventListener('click', goToPrevious);
        if (el.nextBtn) el.nextBtn.addEventListener('click', goToNext);
        if (el.questionSelect) el.questionSelect.addEventListener('change', onQuestionSelectChange);
        if (el.recommendedBtn) el.recommendedBtn.addEventListener('click', applyRecommendedEntry);
        if (el.playBtn) el.playBtn.addEventListener('click', startPractice);
        if (el.audio) el.audio.addEventListener('play', markAttemptStart);

        // Practice controls
        if (el.nextStepBtn) el.nextStepBtn.addEventListener('click', goToRecordingStep);
        if (el.backToNotesBtn) el.backToNotesBtn.addEventListener('click', goBackToNotes);
        if (el.recordBtn) el.recordBtn.addEventListener('click', () => {
            if (isV3()) startV3Recording();
            else startRecordingSession();
        });
        if (el.stopBtn) el.stopBtn.addEventListener('click', () => {
            if (isV3()) stopV3Recording();
            else stopRecording();
        });
        if (el.submitBtn) el.submitBtn.addEventListener('click', () => {
            if (isV3()) submitForFeedback();
            else submitNotes();
        });
        if (el.retryBtn) el.retryBtn.addEventListener('click', () => {
            if (isV3()) startV3Prep();
            else retryPractice();
        });
        const cancelBtn = document.getElementById('sgd-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => {
            if (isV3()) cancelRecording();
        });
        const playUserBtn = document.getElementById('sgd-play-user-btn');
        if (playUserBtn) playUserBtn.addEventListener('click', toggleUserAudioPlayback);
        const redoBtn = document.getElementById('sgd-redo-btn');
        if (redoBtn) redoBtn.addEventListener('click', () => {
            if (isV3()) startV3Prep();
        });
        if (el.speakerTabs) el.speakerTabs.addEventListener('click', handleSpeakerTabClick);
    }

    /* ──────────────────────────── RECOMMENDATION ENGINE ──────────── */

    function ensureRecommendationEngine() {
        if (sgdRecommendationEngine) return sgdRecommendationEngine;
        const factory = window.QuestionRecommendationEngine?.createQuestionRecommendationEngine;
        if (typeof factory !== 'function') return null;
        sgdRecommendationEngine = factory({ recentWindowSize: 10 });
        return sgdRecommendationEngine;
    }

    function ensurePerformanceTracker() {
        if (sgdPerformanceTracker) return sgdPerformanceTracker;
        if (window.sgdPerformanceTracker) {
            sgdPerformanceTracker = window.sgdPerformanceTracker;
            return sgdPerformanceTracker;
        }
        if (!window.PerformanceTracker) return null;
        sgdPerformanceTracker = new window.PerformanceTracker('sgd');
        window.sgdPerformanceTracker = sgdPerformanceTracker;
        return sgdPerformanceTracker;
    }

    function markAttemptStart() {
        if (!sgdAttemptStartTime) sgdAttemptStartTime = Date.now();
    }

    function buildRecommendationIndex() {
        const engine = ensureRecommendationEngine();
        if (!engine) { sgdRecommendationIndex = null; return; }
        sgdRecommendationIndex = engine.buildIndex('sgd', entries);
    }

    function getSgdCefrLevel() {
        const filterValue = window.DifficultyFilter?.getCurrentDifficulty?.('sgd');
        const filteredLevel = Number.parseInt(filterValue, 10);
        if (Number.isFinite(filteredLevel) && filteredLevel >= 1 && filteredLevel <= 3) return filteredLevel * 2;
        const isAdaptive = !!window.DifficultyManager?.getGlobalSettings?.()?.autoAdjustEnabled;
        if (isAdaptive && typeof window.DifficultyManager?.getContentTier === 'function') {
            const ct = window.DifficultyManager.getContentTier('sgd');
            if (Number.isFinite(ct) && ct >= 1 && ct <= 3) return ct * 2;
        }
        const cl = Number.parseInt(String(currentEntry?.level), 10);
        if (Number.isFinite(cl) && cl >= 1 && cl <= 3) return cl * 2;
        return 1;
    }

    function rememberRecommendedId(qid) {
        const n = Number.parseInt(String(qid), 10);
        if (!Number.isFinite(n)) return;
        recentRecommendedIds = recentRecommendedIds.filter(id => id !== n);
        recentRecommendedIds.push(n);
        recentRecommendedIds = recentRecommendedIds.slice(-10);
    }

    function getVisibleQuestionIds() {
        return filteredEntries.map(e => Number.parseInt(String(e?.id), 10)).filter(Number.isFinite);
    }

    function computeRecommendation() {
        if (!currentEntry) return null;
        const engine = ensureRecommendationEngine();
        if (!engine) return null;
        if (!sgdRecommendationIndex) buildRecommendationIndex();
        if (!sgdRecommendationIndex) return null;
        const cid = Number.parseInt(String(currentEntry.id), 10);
        if (!Number.isFinite(cid)) return null;
        return engine.recommendNext({
            mode: 'sgd', currentQuestionId: cid, currentCefrLevel: getSgdCefrLevel(),
            visibleQuestionIds: getVisibleQuestionIds(), recentQuestionIds: recentRecommendedIds,
            index: sgdRecommendationIndex
        });
    }

    function refreshRecommendationUI() {
        if (!el.recommendedBtn || !el.recommendationSummary) return;
        const rec = computeRecommendation();
        const cid = Number.parseInt(String(currentEntry?.id), 10);
        const nid = Number.parseInt(String(rec?.nextQuestionId), 10);
        if (!rec || !Number.isFinite(nid) || nid === cid) {
            el.recommendedBtn.disabled = true;
            el.recommendationSummary.textContent = 'No better match in current filters';
            el.recommendationSummary.classList.remove('is-hidden');
            return;
        }
        el.recommendedBtn.disabled = false;
        el.recommendationSummary.textContent = `Recommended next: #${nid} \u2022 ${REASON_LABELS[rec.reasonCode] || 'best available match'}`;
        el.recommendationSummary.classList.remove('is-hidden');
    }

    function applyRecommendedEntry() {
        const rec = computeRecommendation();
        if (!rec) { refreshRecommendationUI(); return; }
        const tid = Number.parseInt(String(rec.nextQuestionId), 10);
        if (!Number.isFinite(tid)) { refreshRecommendationUI(); return; }
        const idx = filteredEntries.findIndex(e => Number.parseInt(String(e?.id), 10) === tid);
        if (idx === -1) { refreshRecommendationUI(); return; }
        rememberRecommendedId(tid);
        selectEntry(idx);
    }

    /* ──────────────────────────── DATA LOADING ───────────────────── */

    async function withTimeout(promise, timeoutMs, errorMessage) {
        let tid = null;
        const tp = new Promise((_, rej) => { tid = setTimeout(() => rej(new Error(errorMessage)), timeoutMs); });
        try { return await Promise.race([promise, tp]); } finally { if (tid !== null) clearTimeout(tid); }
    }

    function normalizeLevel(rawLevel) {
        const level = Number.parseInt(rawLevel, 10);
        return Number.isFinite(level) && level >= 1 && level <= 3 ? level : 1;
    }

    function hasValidLevel(rawLevel) {
        const level = Number.parseInt(rawLevel, 10);
        return Number.isFinite(level) && level >= 1 && level <= 3;
    }

    function ensureDifficultyLevels(list) {
        const normalizedEntries = Array.isArray(list) ? list : [];
        if (normalizedEntries.length === 0) return [];

        if (normalizedEntries.every((entry) => hasValidLevel(entry?.level))) {
            return normalizedEntries.map((entry) => ({ ...entry, level: normalizeLevel(entry.level) }));
        }

        const classifier = window.ContentDifficultyClassifier;
        if (typeof classifier?.classifyEntriesByText !== 'function') {
            return normalizedEntries.map((entry) => ({ ...entry, level: normalizeLevel(entry.level) }));
        }

        const classifiedEntries = classifier.classifyEntriesByText(
            normalizedEntries,
            (entry) => String(entry?.transcript || '').trim()
        );

        return normalizedEntries.map((entry, index) => ({
            ...entry,
            level: normalizeLevel(classifiedEntries[index]?.level)
        }));
    }

    function sortEntriesById(list) {
        list.sort((a, b) => {
            const ia = Number.parseInt(a.id, 10);
            const ib = Number.parseInt(b.id, 10);
            return (Number.isNaN(ia) || Number.isNaN(ib)) ? a.id.localeCompare(b.id) : ia - ib;
        });
    }

    function appendTextSegment(existing, segment) {
        const normalizedSegment = String(segment || '').trim();
        if (!normalizedSegment) return existing || '';
        return existing ? `${existing} ${normalizedSegment}` : normalizedSegment;
    }

    function normalizeSpeakerKey(rawKey) {
        return String(rawKey || '')
            .replace(/\s+/g, ' ')
            .replace(/(\d)/, ' $1')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Parse raw ANSWER text into speaker structure.
     * Returns { narration, speakers: { 'Speaker 1': 'text', ... }, speakerCount }
     */
    function parseSpeakers(answerText) {
        const lines = (answerText || '').split('\n').map(l => l.trim()).filter(Boolean);
        let narration = '';
        const speakers = {};
        let activeSpeaker = '';
        let appendToNarration = false;

        for (const line of lines) {
            const narrMatch = line.match(/^Narration:\s*(.*)/i);
            if (narrMatch) {
                narration = appendTextSegment(narration, narrMatch[1]);
                activeSpeaker = '';
                appendToNarration = true;
                continue;
            }

            const spkMatch = line.match(/^(Speaker\s*\d+):\s*(.*)/i);
            if (spkMatch) {
                const normalKey = normalizeSpeakerKey(spkMatch[1]);
                speakers[normalKey] = appendTextSegment(speakers[normalKey], spkMatch[2]);
                activeSpeaker = normalKey;
                appendToNarration = false;
                continue;
            }

            if (activeSpeaker) {
                speakers[activeSpeaker] = appendTextSegment(speakers[activeSpeaker], line);
            } else if (appendToNarration || narration) {
                narration = appendTextSegment(narration, line);
            }
        }

        return {
            narration,
            speakers,
            speakerCount: Object.keys(speakers).length
        };
    }

    function buildSpeakerData(answerText, narrationText, speakerColumns) {
        const parsed = parseSpeakers(answerText);
        const speakers = { ...parsed.speakers };

        (speakerColumns || []).forEach((speakerText, index) => {
            const normalizedText = String(speakerText || '').trim();
            if (!normalizedText) return;
            const key = `Speaker ${index + 1}`;
            const existing = speakers[key] || '';
            speakers[key] = normalizedText.length >= existing.length ? normalizedText : existing;
        });

        return {
            narration: String(narrationText || '').trim() || parsed.narration,
            speakers,
            speakerCount: Object.keys(speakers).length
        };
    }

    async function loadEntries() {
        if (!el.questionSelect) return;
        if (loadEntriesPromise) return loadEntriesPromise;
        if (hasLoadedEntries && entries.length > 0) { applyFilter(currentFilter); return; }

        const pendingLoad = (async () => {
            setSelectSingleOption(el.questionSelect, 'Loading...');
            try {
                // Try Firestore first
                if (typeof firebase !== 'undefined' && firebase.firestore) {
                    try {
                        const db = firebase.firestore();
                        const snapshot = await withTimeout(
                            db.collection('sgdEntries').get(),
                            FIRESTORE_LOAD_TIMEOUT_MS, 'Firestore request timed out'
                        );
                        if (!snapshot.empty) {
                            entries = snapshot.docs.map(doc => {
                                const d = doc.data() || {};
                                const transcript = d.transcript || d.answer || '';
                                const speakerData = buildSpeakerData(transcript, d.narration || '', []);
                                const entryId = String(d.id ?? doc.id ?? '').trim();
                                return {
                                    id: entryId,
                                    title: d.title ? String(d.title).trim() : '',
                                    transcript,
                                    narration: speakerData.narration,
                                    speakers: speakerData.speakers,
                                    speakerCount: speakerData.speakerCount,
                                    level: d.level,
                                    audioUrl: d.audioUrl || d.audio_url || ''
                                };
                            }).filter(e => e.id.length > 0);
                            entries = ensureDifficultyLevels(entries);
                            sortEntriesById(entries);
                            buildRecommendationIndex();
                            applyFilter('all');
                            hasLoadedEntries = true;
                            return;
                        }
                    } catch (err) {
                        console.warn('[SGD] Firestore error, falling back to Excel:', err.message);
                    }
                }

                // Fallback: Excel
                const excelPath = '/database/SGD/SGD/SGD.xlsx';
                const resp = await fetch(excelPath);
                if (!resp.ok) throw new Error(`Excel not found (${resp.status})`);
                const ab = await resp.arrayBuffer();
                const wb = XLSX.read(ab, { type: 'array' });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                entries = [];
                // Headers: ID(0) TITLE(1) ANSWER(2) NARRATION(3) SPEAKER1_TEXT(4)
                // SPEAKER2_TEXT(5) SPEAKER3_TEXT(6) SPEAKER_COUNT(7) Difficulty (1-3)(8 optional)
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    if (!row[0]) continue;
                    const level = row[8];

                    const answer = row[2] ? String(row[2]).trim() : '';
                    const narration = row[3] ? String(row[3]).trim() : '';
                    const s1 = row[4] ? String(row[4]).trim() : '';
                    const s2 = row[5] ? String(row[5]).trim() : '';
                    const s3 = row[6] ? String(row[6]).trim() : '';
                    const audioUrl = row[9] ? String(row[9]).trim() : '';
                    const speakerData = buildSpeakerData(answer, narration, [s1, s2, s3]);

                    entries.push({
                        id: String(row[0]).trim(),
                        title: row[1] ? String(row[1]).trim() : '',
                        transcript: answer,
                        narration: speakerData.narration,
                        speakers: speakerData.speakers,
                        speakerCount: speakerData.speakerCount,
                        level,
                        audioUrl
                    });
                }

                entries = ensureDifficultyLevels(entries);
                sortEntriesById(entries);
                buildRecommendationIndex();
                applyFilter('all');
                hasLoadedEntries = true;
            } catch (error) {
                hasLoadedEntries = false;
                console.error('[SGD] Error loading entries:', error);
                setSelectSingleOption(el.questionSelect, 'Error loading');
                refreshRecommendationUI();
            }
        })();

        loadEntriesPromise = pendingLoad;
        try { await pendingLoad; } finally { if (loadEntriesPromise === pendingLoad) loadEntriesPromise = null; }
    }

    /* ──────────────────────────── FILTERS & NAV ──────────────────── */

    function applyFilter(filterValue = currentFilter) {
        currentFilter = filterValue;

        let temp = [...entries];
        const cd = window.DifficultyFilter ? window.DifficultyFilter.getCurrentDifficulty('sgd') : 'all';
        if (cd !== 'all') {
            const lvl = parseInt(cd, 10);
            temp = temp.filter(e => e.level === lvl);
        }
        filteredEntries = temp;
        updateQuestionSelector();
        if (filteredEntries.length === 0) { handleEmptyState(); }
        else {
            if (el.playBtn) el.playBtn.disabled = false;
            if (el.questionSelect) el.questionSelect.disabled = false;
            currentEntryIndex = getPreferredEntryIndex();
            selectEntry(currentEntryIndex);
        }
    }

    function handleEmptyState() {
        if (el.questionSelect) {
            setSelectSingleOption(el.questionSelect, 'No matching questions');
            el.questionSelect.disabled = true;
        }
        if (el.currentQuestionId) el.currentQuestionId.textContent = '-';
        if (el.playBtn) el.playBtn.disabled = true;
        currentEntry = null;
        currentEntryIndex = -1;
        reset();
        refreshRecommendationUI();
    }

    function updateQuestionSelector() {
        if (!el.questionSelect || filteredEntries.length === 0) return;
        const fragment = document.createDocumentFragment();
        filteredEntries.forEach((entry, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = `[Lvl ${entry.level}] ${entry.id} - ${entry.title || ''}`;
            fragment.appendChild(option);
        });
        el.questionSelect.replaceChildren(fragment);
    }

    function onQuestionSelectChange() {
        const i = parseInt(el.questionSelect.value, 10);
        if (!isNaN(i)) selectEntry(i);
    }

    function goToPrevious() { if (currentEntryIndex > 0) selectEntry(currentEntryIndex - 1); }
    function goToNext() { if (currentEntryIndex < filteredEntries.length - 1) selectEntry(currentEntryIndex + 1); }

    function getPreferredEntryIndex() {
        const cid = String(currentEntry?.id || '').trim();
        if (!cid) return 0;
        const idx = filteredEntries.findIndex(e => String(e?.id || '').trim() === cid);
        return idx >= 0 ? idx : 0;
    }

    function selectEntry(index) {
        if (index < 0 || index >= filteredEntries.length) return;
        currentEntryIndex = index;
        currentEntry = filteredEntries[index];
        if (el.currentQuestionId) el.currentQuestionId.textContent = currentEntry.id;
        if (el.questionSelect) el.questionSelect.value = index;
        reset();
        refreshRecommendationUI();

        // Update URL with current question ID (replaceState — no history entry per question)
        if (window.PracticeRouter && currentEntry.id) {
            window.PracticeRouter.replaceRoute('sgd', currentEntry.id);
        }
        if (isV3()) {
            ensureV3Elements();
            if (currentEntry) {
                queueMicrotask(() => {
                    if (v3Active && currentEntry) startV3QuestionFlow();
                });
            }
        }
    }

    /* ──────────────────────────── STEP PROGRESS ───────────────────── */

    function updateStepProgress() {
        const bar = document.getElementById('sgd-step-progress');
        if (!bar) return;
        bar.querySelectorAll('.sgd-progress-step').forEach(stepEl => {
            const s = stepEl.dataset.step;
            stepEl.classList.toggle('active', s === currentStep);
            stepEl.classList.toggle('completed', STEPS.indexOf(s) < STEPS.indexOf(currentStep));
        });
        window.SpeakingPracticeController?.sync?.('sgd');
    }

    function setProceedEnabled(isEnabled) {
        if (el.nextStepBtn) el.nextStepBtn.disabled = !isEnabled;
    }

    function setAudioStatus(message, state) {
        if (!el.audioStatus) return;
        el.audioStatus.className = 'sgd-audio-status';
        if (state) el.audioStatus.classList.add(`is-${state}`);
        el.audioStatus.textContent = message || '';
        el.audioStatus.hidden = !message;
    }

    function goToStep(stepName) {
        // Hide all steps
        hide(el.stepListen);
        hide(el.stepRecord);
        hide(el.stepResults);

        currentStep = stepName;

        switch (stepName) {
            case 'listen': show(el.stepListen); break;
            case 'record': show(el.stepRecord); break;
            case 'results': show(el.stepResults); break;
        }
        updateStepProgress();
    }

    /* ──────────────────────────── PRACTICE FLOW ───────────────────── */

    function startPractice() {
        if (!currentEntry) { showToast('Please select a question first'); return; }
        show(el.practiceArea);
        sgdAttemptStartTime = null;

        // Go directly to listening step (no video)
        goToListeningStep();
    }

    function goToListeningStep() {
        goToStep('listen');

        // Hide the discussion topic box (user has manual Topic input)
        if (el.topicDisplay) {
            el.topicDisplay.style.display = 'none';
        }

        // Build speaker inputs
        renderSpeakerTabs();

        // Load audio with loading state
        loadAudio(currentEntry.id);
    }

    /* ──────────────────────────── SPEAKER TABS ───────────────────── */

    function renderSpeakerTabs() {
        if (!el.speakerTabs || !el.notePanels) return;
        const speakerNames = Object.keys(currentEntry.speakers || {});
        if (speakerNames.length === 0) {
            clearSpeakerNotes();
            return;
        }

        const panelsFragment = document.createDocumentFragment();
        speakerTabButtons = [];
        speakerNotePanels = [];
        speakerNoteInputs = [];

        if (isV3()) {
            if (el.speakerTabs) {
                el.speakerTabs.style.display = 'flex';
                clearChildren(el.speakerTabs);
            }

            const tabsFragment = document.createDocumentFragment();
            const tabList = ['Topic', ...speakerNames];

            tabList.forEach((tabName, idx) => {
                const tabBtn = document.createElement('button');
                tabBtn.type = 'button';
                tabBtn.className = `sgd-speaker-tab ${idx === v3ActiveSpeakerIndex ? 'active' : ''}`;
                tabBtn.dataset.speakerIndex = String(idx);
                tabBtn.dataset.speakerName = tabName;
                tabBtn.textContent = tabName;
                tabBtn.addEventListener('click', () => switchV3SpeakerTab(idx));
                tabsFragment.appendChild(tabBtn);
                speakerTabButtons.push(tabBtn);

                const panel = document.createElement('div');
                panel.className = `sgd-note-panel ${idx === v3ActiveSpeakerIndex ? 'active' : ''}`;
                panel.dataset.speakerIndex = String(idx);
                panel.dataset.speaker = tabName === 'Topic' ? 'topic' : String(idx - 1);
                panel.style.display = idx === v3ActiveSpeakerIndex ? 'block' : 'none';

                const textarea = document.createElement('textarea');
                textarea.className = 'sgd-note-input sgd-note-textarea';
                textarea.dataset.speakerName = tabName;
                textarea.placeholder = tabName === 'Topic' ? 'Type topic notes here...' : `Type notes for ${tabName}...`;
                textarea.addEventListener('input', autoGrowTextarea);

                panel.appendChild(textarea);
                panelsFragment.appendChild(panel);
                speakerNotePanels.push(panel);
                speakerNoteInputs.push(textarea);
            });

            if (el.speakerTabs) el.speakerTabs.appendChild(tabsFragment);
            el.notePanels.replaceChildren(panelsFragment);
            return;
        }

        // Hide speaker tabs completely since we show all inputs vertically
        if (el.speakerTabs) el.speakerTabs.style.display = 'none';

        // Add Topic input
        const topicPanel = document.createElement('div');
        topicPanel.className = 'sgd-note-panel active';
        topicPanel.style.display = 'block';
        topicPanel.style.padding = '0';
        topicPanel.style.border = 'none';
        topicPanel.style.marginBottom = '20px';

        const topicLabel = document.createElement('div');
        topicLabel.className = 'sgd-note-label';
        topicLabel.textContent = 'Topic:';
        topicLabel.style.fontWeight = 'bold';
        topicLabel.style.marginBottom = '5px';

        const topicInput = document.createElement('textarea');
        topicInput.className = 'sgd-note-input';
        topicInput.dataset.speakerName = 'Topic';
        topicInput.rows = 1;
        topicInput.placeholder = '(input text)';
        topicInput.style.width = '100%';
        topicInput.style.boxSizing = 'border-box';
        topicInput.style.resize = 'none';
        topicInput.style.overflow = 'hidden';
        topicInput.addEventListener('input', autoGrowTextarea);

        topicPanel.append(topicLabel, topicInput);
        panelsFragment.appendChild(topicPanel);
        speakerNotePanels.push(topicPanel);

        speakerNames.forEach((name, i) => {
            const panel = document.createElement('div');
            panel.className = 'sgd-note-panel active';
            panel.dataset.speaker = String(i);
            panel.style.display = 'block';
            panel.style.padding = '0';
            panel.style.border = 'none';
            panel.style.marginBottom = '15px';

            const panelLabel = document.createElement('div');
            panelLabel.className = 'sgd-note-label';
            panelLabel.textContent = `${name}:`;
            panelLabel.style.fontWeight = 'bold';
            panelLabel.style.marginBottom = '5px';

            const textarea = document.createElement('textarea');
            textarea.className = 'sgd-note-input';
            textarea.dataset.speakerName = name;
            textarea.rows = 3;
            textarea.placeholder = '-\n-\n-';
            textarea.style.width = '100%';
            textarea.style.boxSizing = 'border-box';
            textarea.style.resize = 'none';
            textarea.style.overflow = 'hidden';
            textarea.addEventListener('input', autoGrowTextarea);

            panel.append(panelLabel, textarea);
            panelsFragment.appendChild(panel);
            speakerNotePanels.push(panel);
            speakerNoteInputs.push(textarea);
        });

        // Flat layout — no extra borders on wrapper
        el.notePanels.style.border = 'none';
        el.notePanels.style.padding = '10px 0';
        el.notePanels.style.boxShadow = 'none';
        el.notePanels.style.background = 'transparent';

        el.notePanels.replaceChildren(panelsFragment);

        // Keyboard shortcuts: Alt+1, Alt+2, Alt+3 — prevent duplicate listeners
        if (!speakerShortcutBound) {
            document.addEventListener('keydown', handleSpeakerShortcut);
            speakerShortcutBound = true;
        }
    }

    function handleSpeakerTabClick(e) {
        // Obsolete function since tabs are removed
    }

    function switchV3SpeakerTab(index) {
        v3ActiveSpeakerIndex = index;
        speakerTabButtons.forEach((btn, idx) => {
            btn.classList.toggle('active', idx === index);
        });
        speakerNotePanels.forEach((panel, idx) => {
            const isActive = idx === index;
            panel.classList.toggle('active', isActive);
            panel.style.display = isActive ? 'block' : 'none';
            if (isActive) {
                const ta = panel.querySelector('textarea');
                if (ta) ta.focus();
            }
        });
    }

    function handleSpeakerShortcut(e) {
        if (!el.stepListen && !isV3()) return;
        if (e.altKey && e.key >= '1' && e.key <= '9') {
            const idx = parseInt(e.key, 10) - 1;
            if (isV3()) {
                if (idx < speakerTabButtons.length) {
                    e.preventDefault();
                    switchV3SpeakerTab(idx);
                }
                return;
            }
            const speakerCount = speakerNoteInputs.length;
            if (idx < speakerCount) {
                e.preventDefault();
                switchSpeakerTab(idx);
            }
        }
    }

    function switchSpeakerTab(index) {
        if (speakerNoteInputs.length === 0) return;
        if (index < 0 || index >= speakerNoteInputs.length) return;
        const activeTextarea = speakerNoteInputs[index];
        if (activeTextarea) activeTextarea.focus();
    }

    function clearSpeakerNotes() {
        speakerTabButtons = [];
        speakerNotePanels = [];
        speakerNoteInputs = [];
        clearChildren(el.speakerTabs);
        clearChildren(el.notePanels);
    }

    function collectSpeakerNotes() {
        const notes = {};
        const topicInput = el.notePanels?.querySelector('textarea[data-speaker-name="Topic"]');
        if (topicInput && topicInput.value.trim()) {
            notes['Topic'] = topicInput.value.trim();
        }

        speakerNoteInputs.forEach(ta => {
            const name = ta.dataset.speakerName;
            if (name) notes[name] = ta.value.trim();
        });
        return notes;
    }

    /* ──────────────────────────── AUDIO LOADING ───────────────────── */

    async function loadAudio(audioId) {
        const loadToken = ++currentAudioLoadToken;

        // Show loading indicator
        const audioContainer = el.audio?.parentElement;
        if (audioContainer) audioContainer.classList.add('sgd-audio-loading');
        setProceedEnabled(false);
        setAudioStatus('Loading audio...', 'loading');
        if (el.audio) {
            el.audio.pause();
            el.audio.removeAttribute('src');
            el.audio.load();
        }
        const player = getAudioPlayer();
        if (player) {
            player.reset();
            player.setEnabled(false);
        }

        const cachedAudio = audioAvailabilityCache.get(String(audioId));
        if (cachedAudio !== undefined) {
            if (cachedAudio) {
                if (el.audio) {
                    el.audio.src = cachedAudio;
                    el.audio.load();
                }
                const activePlayer = getAudioPlayer();
                if (activePlayer) activePlayer.setEnabled(true);
                setAudioStatus('');
                setProceedEnabled(true);
            } else {
                const inactivePlayer = getAudioPlayer();
                if (inactivePlayer) inactivePlayer.setEnabled(false);
                setAudioStatus('Audio not available for this question yet.', 'unavailable');
                setProceedEnabled(false);
            }
            if (audioContainer) audioContainer.classList.remove('sgd-audio-loading');
            return;
        }

        // Try explicit audioUrl first if present
        if (currentEntry && currentEntry.audioUrl) {
            const exists = await checkFileExists(currentEntry.audioUrl);
            if (loadToken !== currentAudioLoadToken) return;
            if (exists) {
                if (el.audio) {
                    el.audio.src = currentEntry.audioUrl;
                    el.audio.load();
                }
                const activePlayer = getAudioPlayer();
                if (activePlayer) activePlayer.setEnabled(true);
                audioAvailabilityCache.set(String(audioId), currentEntry.audioUrl);
                setAudioStatus('');
                setProceedEnabled(true);
                if (audioContainer) audioContainer.classList.remove('sgd-audio-loading');
                return;
            }
        }

        const tryExts = ['mp3', 'm4a', 'wav', 'aac', 'ogg'];
        const basePath = `/database/SGD/audio/${audioId}`;
        let found = false;
        let resolvedPath = '';
        for (const ext of tryExts) {
            const path = `${basePath}.${ext}`;
            let targetUrl = path;
            let exists = false;
            if (window.MediaUrlResolver && typeof window.MediaUrlResolver.resolveAudioUrl === 'function') {
                try {
                    const res = await window.MediaUrlResolver.resolveAudioUrl(path, { mode: 'SGD' });
                    if (res && res !== path) {
                        targetUrl = res;
                        exists = true;
                    }
                } catch (_) {}
            }
            if (!exists) {
                exists = await checkFileExists(path);
            }
            if (loadToken !== currentAudioLoadToken) return;
            if (exists) {
                if (el.audio) {
                    el.audio.src = targetUrl;
                    el.audio.load();
                }
                const activePlayer = getAudioPlayer();
                if (activePlayer) activePlayer.setEnabled(true);
                resolvedPath = targetUrl;
                found = true;
                break;
            }
        }
        if (loadToken !== currentAudioLoadToken) return;
        if (!found) {
            audioAvailabilityCache.set(String(audioId), null);
            if (el.audio) {
                el.audio.pause();
                el.audio.removeAttribute('src');
                el.audio.load();
            }
            const inactivePlayer = getAudioPlayer();
            if (inactivePlayer) inactivePlayer.setEnabled(false);
            setAudioStatus('Audio not available for this question yet.', 'unavailable');
            setProceedEnabled(false);
        } else {
            audioAvailabilityCache.set(String(audioId), resolvedPath);
            setAudioStatus('');
            setProceedEnabled(true);
        }

        // Remove loading indicator
        if (audioContainer) audioContainer.classList.remove('sgd-audio-loading');
    }

    function isUsableAudioResponse(response) {
        if (!response || !response.ok) return false;
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        return !contentType || contentType.startsWith('audio/') || contentType === 'application/octet-stream';
    }

    async function checkFileExists(url) {
        try {
            const headResponse = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
            if (isUsableAudioResponse(headResponse)) return true;

            const shouldRetryWithGet =
                headResponse.status === 403 ||
                headResponse.status === 405 ||
                headResponse.status === 501 ||
                (headResponse.ok && !isUsableAudioResponse(headResponse));

            if (!shouldRetryWithGet) return false;

            const getResponse = await fetch(url, {
                method: 'GET',
                cache: 'no-cache',
                headers: { Range: 'bytes=0-0' }
            });
            return isUsableAudioResponse(getResponse);
        } catch { return false; }
    }

    /* ──────────────────────────── RECORDING ──────────────────────── */

    function goToRecordingStep() {
        // Pause audio if still playing
        if (el.audio) { el.audio.pause(); }

        // Show both steps — recording above notes
        show(el.stepListen);
        show(el.stepRecord);
        hide(el.stepResults);
        currentStep = 'record';
        updateStepProgress();

        // Move recording section above listening/notes section in DOM
        if (el.stepRecord && el.stepListen && el.stepRecord.parentNode) {
            el.stepRecord.parentNode.insertBefore(el.stepRecord, el.stepListen);
        }

        // Make notes read-only during recording
        speakerNoteInputs.forEach(ta => { ta.readOnly = true; ta.style.opacity = '0.85'; });
        const topicTa = el.notePanels?.querySelector('textarea[data-speaker-name="Topic"]');
        if (topicTa) { topicTa.readOnly = true; topicTa.style.opacity = '0.85'; }

        // Reset recording state
        recordingSeconds = 0;
        updateTimerDisplay(0);
        showInline(el.recordBtn);
        hide(el.stopBtn);
        hide(el.playbackArea);
        hide(el.submitBtn);
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        dspPromise = null;
        recordingSessionToken++;

        // Remove recording-active indicator
        const timerEl = el.recordTimer;
        if (timerEl) timerEl.classList.remove('sgd-recording-active');
    }

    function goBackToNotes() {
        // Restore notes to editable
        speakerNoteInputs.forEach(ta => { ta.readOnly = false; ta.style.opacity = '1'; });
        const topicTa = el.notePanels?.querySelector('textarea[data-speaker-name="Topic"]');
        if (topicTa) { topicTa.readOnly = false; topicTa.style.opacity = '1'; }

        // Restore DOM order: listening before recording
        if (el.stepRecord && el.stepListen && el.stepRecord.parentNode) {
            el.stepRecord.parentNode.insertBefore(el.stepListen, el.stepRecord);
        }
        goToStep('listen');
    }

    async function startRecordingSession() {
        try {
            // Bug fix: clean up previous recording blob if re-recording
            if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
            recordingBlob = null;
            originalRecordingBlob = null;
            enhancedPlaybackBlob = null;
            dspPromise = null;
            const currentToken = ++recordingSessionToken;

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            recordedChunks = [];
            const recorder = new window.MediaRecorder(stream);

            recorder.addEventListener('dataavailable', (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            });

            recorder.addEventListener('stop', () => {
                stream.getTracks().forEach(t => t.stop());
                if (recordedChunks.length > 0) {
                    const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
                    originalRecordingBlob = blob;
                    recordingBlob = blob;
                    recordingBlobUrl = URL.createObjectURL(blob);
                    if (el.recordingPlayback) el.recordingPlayback.src = recordingBlobUrl;
                    show(el.playbackArea);
                    showInline(el.submitBtn);

                    dspPromise = (window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function')
                        ? window.AudioDspPipeline.enhance(blob).then((result) => {
                            if (currentToken !== recordingSessionToken) return blob;
                            if (result && result.wavBlob) {
                                if (recordingBlobUrl) URL.revokeObjectURL(recordingBlobUrl);
                                enhancedPlaybackBlob = result.wavBlob;
                                recordingBlobUrl = result.audioUrl || URL.createObjectURL(result.wavBlob);
                                if (el.recordingPlayback) el.recordingPlayback.src = recordingBlobUrl;
                                return result.wavBlob;
                            }
                            return blob;
                        }).catch((err) => {
                            console.warn('[SGD] AudioDspPipeline enhancement failed, keeping raw audio:', err);
                            return blob;
                        })
                        : Promise.resolve(blob);
                } else {
                    dspPromise = Promise.resolve(null);
                }
                // Bug fix: show record button only here (not in stopRecording)
                showInline(el.recordBtn);
                hide(el.stopBtn);

                // Remove recording-active indicator
                if (el.recordTimer) el.recordTimer.classList.remove('sgd-recording-active');
            });

            recorder.start();
            mediaRecorder = recorder;
            sgdAttemptStartTime = Date.now();

            // UI updates
            hide(el.recordBtn);
            showInline(el.stopBtn);
            hide(el.playbackArea);
            hide(el.submitBtn);

            // Add recording-active indicator
            if (el.recordTimer) el.recordTimer.classList.add('sgd-recording-active');

            // Start timer (count up)
            recordingSeconds = 0;
            recordingTimerId = setInterval(() => {
                recordingSeconds++;
                updateTimerDisplay(recordingSeconds);
                if (recordingSeconds >= MAX_RECORDING_SECONDS) stopRecording();
            }, 1000);

        } catch (err) {
            console.error('[SGD] Recording error:', err);
            showToast('Could not access microphone. Please allow microphone access and try again.', 5000);
        }
    }

    function stopRecording(silent) {
        if (recordingTimerId) { clearInterval(recordingTimerId); recordingTimerId = null; }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop(); // 'stop' event handler will update UI
        }
        mediaRecorder = null;
        // Bug fix: don't re-show record button here — the 'stop' event handler does it
    }

    function updateTimerDisplay(elapsedSeconds) {
        if (!el.recordTimer) return;
        const sec = Math.max(0, elapsedSeconds);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        el.recordTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
        // Warning when approaching limit (last 30s)
        const remaining = MAX_RECORDING_SECONDS - sec;
        if (remaining <= 30 && sec > 0) {
            el.recordTimer.classList.add('sgd-timer-warning');
        } else {
            el.recordTimer.classList.remove('sgd-timer-warning');
        }
    }

    /* ──────────────────────────── SCORING ────────────────────────── */

    function submitNotes() {
        const userNotes = collectSpeakerNotes();
        const hasAnyNotes = Object.values(userNotes).some(v => v.length > 0);

        const doSubmit = async () => {
            hide(el.stepRecord);
            hide(el.stepListen);
            goToStep('results');

            // Run speaker-aware comparison
            const result = compareTextsBySpeaker(currentEntry.speakers || {}, userNotes);
            displayResults(result, userNotes);

            // Performance tracking
            const tracker = ensurePerformanceTracker();
            if (tracker) {
                const totalWords = Math.max(1, result.overall.totalWords);
                const accuracy = Math.max(0, Math.min(1, result.overall.totalMatched / totalWords));
                const timeTaken = Math.max(2, (Date.now() - (sgdAttemptStartTime || Date.now())) / 1000);
                tracker.recordAttempt({
                    correct: accuracy > 0.5, accuracy, attempts: 1, hintUsed: false,
                    timeTaken, wordCount: totalWords
                });
            }

            saveProgress(userNotes, result);

            const currentToken = recordingSessionToken;
            const finalBlob = dspPromise ? await dspPromise.catch(() => recordingBlob) : recordingBlob;
            if (currentToken !== recordingSessionToken) return;

            window.PTEAttemptArchive?.saveAttempt?.({
                practiceMode: 'sgd',
                promptSnapshot: {
                    promptId: currentEntry?.id || null,
                    title: currentEntry?.title || '',
                    text: currentEntry?.prompt || currentEntry?.scenario || '',
                    sourceAssetPaths: [currentEntry?.audioPath || currentEntry?.audio || currentEntry?.videoPath].filter(Boolean),
                    data: currentEntry || null
                },
                responseSnapshot: {
                    notes: userNotes,
                    spokenTranscript: acceptedTranscription?.rawTranscript || null,
                    transcriptSource: acceptedTranscription ? 'server_asr' : null,
                    pronunciationAssessmentId: pronunciationAssessmentId || null,
                    legacyNotesProxy: Object.values(userNotes || {}).join(' ')
                },
                answerSnapshot: {
                    keyPoints: currentEntry?.keyPoints || [],
                    sampleAnswer: currentEntry?.sampleAnswer || null
                },
                resultSnapshot: result,
                scoringSource: 'client',
                media: finalBlob ? [{
                    slot: 'student',
                    label: 'Student summary',
                    blob: finalBlob,
                    contentType: finalBlob.type || 'audio/webm'
                }] : []
            }).catch((error) => console.warn('[PTE Archive] SGD save failed:', error));

            window.getPracticeVariantHooks?.('sgd')?.afterSubmit?.({
                entryId: String(currentEntry?.id || ''), userNotes
            });
        };

        if (!hasAnyNotes) {
            // Soft prompt — don't block submission
            const container = el.stepRecord || el.practiceArea;
            if (container) {
                showConfirmBanner(
                    container,
                    'You haven\'t written any notes yet. If you took notes elsewhere, please rewrite them here for result checking. Submit anyway?',
                    doSubmit
                );
            } else {
                doSubmit();
            }
            return;
        }

        doSubmit();
    }

    /**
     * Compare user notes with transcript on a per-speaker basis.
     * Uses NLP lemmatization (Compromise) when available.
     */
    function compareTextsBySpeaker(speakers, userNotes) {
        const clean = cleanWord;
        const lemmaCache = new Map();
        const getLemma = (word) => {
            const cw = clean(word);
            if (!cw) return '';
            if (lemmaCache.has(cw)) return lemmaCache.get(cw);
            if (typeof nlp === 'undefined') {
                lemmaCache.set(cw, cw);
                return cw;
            }
            const doc = nlp(cw);
            const verbs = doc.verbs().toInfinitive().out('text');
            if (verbs) {
                lemmaCache.set(cw, verbs);
                return verbs;
            }
            const nouns = doc.nouns().toSingular().out('text');
            if (nouns) {
                lemmaCache.set(cw, nouns);
                return nouns;
            }
            lemmaCache.set(cw, cw);
            return cw;
        };

        const perSpeaker = {};
        let totalMatched = 0;
        let totalWords = 0;
        const misattributed = [];

        // Build a global map: word → which speaker actually said it
        const wordToSpeaker = new Map();
        for (const [spk, text] of Object.entries(speakers)) {
            const words = (text || '').split(/\s+/).map(clean).filter(w => isKeyword(w));
            for (const w of words) {
                if (!wordToSpeaker.has(w)) wordToSpeaker.set(w, new Set());
                wordToSpeaker.get(w).add(spk);
            }
        }

        for (const [speakerName, speakerText] of Object.entries(speakers)) {
            const userText = userNotes[speakerName] || '';

            // Build user word indices for this speaker
            const userWords = new Set(userText.split(/\s+/).map(clean).filter(w => w));
            const lemmaMap = new Map();
            userWords.forEach(w => {
                const lemma = getLemma(w);
                if (!lemmaMap.has(lemma)) lemmaMap.set(lemma, []);
                lemmaMap.get(lemma).push(w);
            });

            const matched = [];
            const transcriptWords = (speakerText || '').split(/(\s+)/);
            const highlightedParts = transcriptWords.map(part => {
                if (/^\s*$/.test(part)) return { text: part, matched: false };
                const cp = clean(part);
                if (!cp) return { text: part, matched: false };

                // Skip stop words — only match meaningful keywords
                if (!isKeyword(cp)) return { text: part, matched: false };

                // Layer 1: Exact match
                if (userWords.has(cp)) {
                    matched.push(part);
                    return { text: part, matched: true };
                }

                // Layer 2: Lemma match
                const pl = getLemma(cp);
                if (lemmaMap.has(pl)) {
                    const candidates = lemmaMap.get(pl);
                    const valid = candidates.some(uw => uw.length >= 3 && cp.length >= 3 && uw.substring(0, 3) === cp.substring(0, 3));
                    if (valid) {
                        matched.push(part);
                        return { text: part, matched: true };
                    }
                }

                return { text: part, matched: false };
            });

            const wordCount = (speakerText || '').split(/\s+/).map(clean).filter(w => isKeyword(w)).length;
            totalWords += wordCount;
            totalMatched += matched.length;

            perSpeaker[speakerName] = {
                matched,
                total: wordCount,
                accuracy: wordCount > 0 ? matched.length / wordCount : 0,
                highlightedTranscriptParts: highlightedParts
            };

            // Check for misattributed words: user wrote under this speaker, but the word belongs to another speaker
            userWords.forEach(uw => {
                if (!isKeyword(uw)) return;
                const actualSpeakers = wordToSpeaker.get(uw);
                if (actualSpeakers && !actualSpeakers.has(speakerName)) {
                    const actualSpk = [...actualSpeakers][0];
                    misattributed.push({ word: uw, notedUnder: speakerName, actualSpeaker: actualSpk });
                }
            });
        }

        return {
            perSpeaker,
            overall: { totalMatched, totalWords, accuracy: totalWords > 0 ? totalMatched / totalWords : 0 },
            misattributed
        };
    }

    /* ──────────────────────────── RESULTS DISPLAY ────────────────── */

    const SPEAKER_COLORS = {
        0: { bg: '#fff9c4', border: '#f9a825', label: 'yellow' },   // Speaker 1 — yellow
        1: { bg: '#c8e6c9', border: '#388e3c', label: 'green' },    // Speaker 2 — green
        2: { bg: '#e1bee7', border: '#7b1fa2', label: 'purple' }    // Speaker 3 — purple
    };

    function displayResults(result, userNotes) {
        if (!el.resultsContainer) return;

        clearChildren(el.resultsContainer);
        const grid = document.createElement('div');
        grid.className = 'sgd-results-grid';

        const speakerEntries = Object.entries(result.perSpeaker);

        speakerEntries.forEach(([speakerName, data], idx) => {
            const pct = Math.round(data.accuracy * 100);
            const colorClass = pct >= 70 ? 'sgd-score-good' : pct >= 40 ? 'sgd-score-ok' : 'sgd-score-low';
            const colors = SPEAKER_COLORS[idx] || SPEAKER_COLORS[0];

            const card = document.createElement('div');
            card.className = 'sgd-speaker-result';

            // ── Header ──
            const header = document.createElement('div');
            header.className = 'sgd-speaker-result-header';
            const nameEl = document.createElement('span');
            nameEl.className = 'sgd-speaker-result-name';
            nameEl.textContent = speakerName;
            const scoreEl = document.createElement('span');
            scoreEl.className = `sgd-speaker-result-score ${colorClass}`;
            scoreEl.textContent = `${pct}%`;
            header.append(nameEl, scoreEl);

            // ── Stats ──
            const statsEl = document.createElement('div');
            statsEl.className = 'sgd-speaker-result-stats';
            statsEl.textContent = `${data.matched.length} / ${data.total} key words matched`;

            // ── Full Transcript (collapsible) ──
            const toggleBtn = document.createElement('button');
            toggleBtn.textContent = '▶ Show Full Transcript';
            Object.assign(toggleBtn.style, {
                background: 'none', border: '1px solid #ccc', borderRadius: '4px',
                padding: '4px 10px', cursor: 'pointer', fontSize: '12px',
                color: '#555', marginTop: '6px'
            });
            const transcriptEl = document.createElement('div');
            transcriptEl.className = 'sgd-speaker-transcript';
            transcriptEl.style.display = 'none';
            transcriptEl.style.marginTop = '6px';
            transcriptEl.style.borderLeft = `2px solid ${colors.border}`;
            transcriptEl.style.paddingLeft = '10px';
            (data.highlightedTranscriptParts || []).forEach((part) => {
                if (part.matched) {
                    const match = document.createElement('span');
                    match.className = 'sgd-matched';
                    match.textContent = part.text;
                    transcriptEl.appendChild(match);
                } else {
                    transcriptEl.appendChild(document.createTextNode(part.text));
                }
            });
            toggleBtn.addEventListener('click', () => {
                const visible = transcriptEl.style.display !== 'none';
                transcriptEl.style.display = visible ? 'none' : 'block';
                toggleBtn.textContent = visible ? '▶ Show Full Transcript' : '▼ Hide Full Transcript';
            });

            // ── User's Notes for this speaker ──
            const userNote = userNotes?.[speakerName] || '';
            let userNoteEl = null;
            if (userNote) {
                userNoteEl = document.createElement('div');
                userNoteEl.style.cssText = `margin-top:6px;padding:6px 10px;background:${colors.bg};border-radius:4px;font-size:13px;color:#333;`;
                const noteLabel = document.createElement('strong');
                noteLabel.textContent = 'Your notes: ';
                userNoteEl.append(noteLabel, document.createTextNode(userNote));
            }

            card.append(header, statsEl, toggleBtn, transcriptEl);
            if (userNoteEl) card.appendChild(userNoteEl);
            grid.appendChild(card);
        });

        el.resultsContainer.appendChild(grid);

        // ── User's Transcribed Speech with speaker-colored highlights ──
        if (recordingBlobUrl) {
            const speechSection = document.createElement('div');
            speechSection.style.cssText = 'margin-top:16px;padding:14px;border:1px solid #e0e0e0;border-radius:8px;background:#fafafa;';
            const speechTitle = document.createElement('div');
            speechTitle.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:14px;';
            speechTitle.textContent = 'Your Transcribed Speech';
            const speechNote = document.createElement('div');
            speechNote.style.cssText = 'font-size:12px;color:#888;margin-bottom:6px;';
            speechNote.textContent = '(Speech-to-text transcription will appear here once processed)';
            speechSection.append(speechTitle, speechNote);
            el.resultsContainer.appendChild(speechSection);
        }

        // ── Legend ──
        const legend = document.createElement('div');
        legend.style.cssText = 'display:flex;gap:16px;margin-top:10px;font-size:12px;color:#666;flex-wrap:wrap;';
        speakerEntries.forEach(([name], idx) => {
            const colors = SPEAKER_COLORS[idx] || SPEAKER_COLORS[0];
            const item = document.createElement('span');
            item.style.cssText = `padding:2px 8px;border-radius:3px;background:${colors.bg};border:1px solid ${colors.border};`;
            item.textContent = name;
            legend.appendChild(item);
        });
        el.resultsContainer.appendChild(legend);

        // Misattribution warnings
        if (result.misattributed.length > 0) {
            const unique = result.misattributed.slice(0, 10);
            const warningBox = document.createElement('div');
            warningBox.className = 'sgd-misattribution-box';

            const warningTitle = document.createElement('div');
            warningTitle.className = 'sgd-misattribution-title';
            warningTitle.textContent = 'Misattributed Content';

            const warningList = document.createElement('ul');
            for (const m of unique) {
                const item = document.createElement('li');
                item.appendChild(document.createTextNode('"'));
                const word = document.createElement('strong');
                word.textContent = m.word;
                item.appendChild(word);
                item.appendChild(document.createTextNode('" - you noted under '));
                const notedUnder = document.createElement('em');
                notedUnder.textContent = m.notedUnder;
                item.appendChild(notedUnder);
                item.appendChild(document.createTextNode(', but it was said by '));
                const actualSpeaker = document.createElement('em');
                actualSpeaker.textContent = m.actualSpeaker;
                item.appendChild(actualSpeaker);
                warningList.appendChild(item);
            }
            warningBox.append(warningTitle, warningList);
            el.resultsContainer.appendChild(warningBox);
        }

        // Overall accuracy
        if (el.overallAccuracy) {
            el.overallAccuracy.textContent = Math.round(result.overall.accuracy * 100);
        }
    }

    /* ──────────────────────────── PERSISTENCE ────────────────────── */

    async function saveProgress(userNotes, result) {
        try {
            const userId = window.authUI?.getCurrentUserId?.() || window.auth?.currentUser?.uid;
            if (!userId) return;

            if (window.handleDualTrackScoring) {
                const flatNotes = Object.values(userNotes).join(' ');
                await window.handleDualTrackScoring('sgd', currentEntry.id, flatNotes);
            }

            if (!window.firebaseFirestoreFunctions?.upsertSGDProgress) return;
            await window.firebaseFirestoreFunctions.upsertSGDProgress(userId, String(currentEntry.id), {
                entryId: String(currentEntry.id),
                userNotes,
                overallAccuracy: result.overall.accuracy,
                perSpeakerAccuracy: Object.fromEntries(
                    Object.entries(result.perSpeaker).map(([k, v]) => [k, v.accuracy])
                ),
                misattributedCount: result.misattributed.length
            });
        } catch (err) {
            console.error('[SGD] Error saving progress:', err);
        }
    }

    function retryPractice() {
        // Bug fix: stop audio if still playing
        if (el.audio) { el.audio.pause(); }
        clearSpeakerNotes();
        sgdAttemptStartTime = null;
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        dspPromise = null;
        recordingSessionToken++;
        startPractice();
    }

    /* ──────────────────────────── PTE SPEAKING SHELL V3 ──────────────────── */

    function ensureV3Elements() {
        if (!el.practiceArea) cacheElements();
        if (!el.practiceArea) return;

        show(el.practiceArea);

        let instruction = document.getElementById('sgd-pte-instruction');
        if (!instruction) {
            instruction = document.createElement('p');
            instruction.id = 'sgd-pte-instruction';
            instruction.className = 'sgd-pte-instruction pte-instr';
            instruction.textContent = 'You will hear three people having a discussion. When you hear the beep, summarize the whole discussion. You will have 10 seconds to prepare and 2 minutes to give your response.';
            el.practiceArea.prepend(instruction);
        }

        let stage = document.getElementById('sgd-pte-stage');
        if (!stage) {
            stage = document.createElement('div');
            stage.id = 'sgd-pte-stage';
            stage.className = 'sgd-pte-stage';

            // Audio row
            const audioRow = document.createElement('div');
            audioRow.className = 'sgd-audio-row';

            const groupIcon = document.createElement('div');
            groupIcon.className = 'sgd-group-icon';
            groupIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
            audioRow.appendChild(groupIcon);

            const audioHost = document.createElement('div');
            audioHost.id = 'sgd-pte-audio-host';
            audioHost.className = 'sgd-pte-audio-host';
            audioRow.appendChild(audioHost);
            stage.appendChild(audioRow);

            // Recorder host
            const recHost = document.createElement('div');
            recHost.id = 'sgd-pte-rec-host';
            recHost.className = 'sgd-pte-rec-host';
            recHost.style.display = 'none';
            stage.appendChild(recHost);

            // Move or place #sgd-speaker-notes
            const speakerNotes = document.getElementById('sgd-speaker-notes');
            if (speakerNotes) {
                let notesHeader = stage.querySelector('.sgd-notes-header');
                if (!notesHeader) {
                    notesHeader = document.createElement('div');
                    notesHeader.className = 'sgd-notes-header';
                    notesHeader.innerHTML = `<span class="sgd-notes-title">Your notes</span><span id="sgd-notes-subtitle" class="sgd-notes-subtitle">· type while you listen</span>`;
                    stage.appendChild(notesHeader);
                }
                stage.appendChild(speakerNotes);
            }

            if (instruction.nextSibling) {
                el.practiceArea.insertBefore(stage, instruction.nextSibling);
            } else {
                el.practiceArea.appendChild(stage);
            }
        }

        const audioHost = document.getElementById('sgd-pte-audio-host');
        if (audioHost && !pteAudioBox && el.audio && window.PteAudioBox) {
            pteAudioBox = window.PteAudioBox.create(audioHost, { audio: el.audio });
        }

        const recHost = document.getElementById('sgd-pte-rec-host');
        if (recHost && !pteRecorderWidget && window.PteRecorderWidget) {
            pteRecorderWidget = window.PteRecorderWidget.create(recHost, { totalSeconds: MAX_RECORDING_SECONDS });
        }

        let feedback = document.getElementById('sgd-pte-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.id = 'sgd-pte-feedback';
            // Only the inner grid is a .pte-fb; nesting one inside another gave the
            // shell two competing column systems.
            feedback.className = 'sgd-pte-feedback';
            feedback.style.display = 'none';
            feedback.hidden = true;

            const grid = document.createElement('div');
            grid.className = 'sgd-fb-grid pte-fb';

            // Left column
            const leftCol = document.createElement('div');
            leftCol.className = 'sgd-fb-left pte-fb__left';
            leftCol.innerHTML = `
                <h4 class="sgd-fb-heading">Your Recording</h4>
                <div id="sgd-v3-playback" class="sgd-v3-playback">
                    <audio id="sgd-v3-student-audio" controls style="width: 100%;"></audio>
                </div>
                <div id="sgd-v3-ai-scoring-section" class="sgd-v3-ai-scoring-section" style="margin-top: 14px; margin-bottom: 16px;">
                    <button type="button" id="sgd-v3-ai-score-btn" class="pte-btn pte-btn--primary" style="width: 100%; padding: 10px 14px; font-weight: 600; border-radius: 8px;">
                        ⚡ Get AI Pronunciation Assessment
                    </button>
                    <div id="sgd-v3-ai-status" style="font-size: 13px; color: #64748b; margin-top: 6px; text-align: center;"></div>
                </div>
                <div id="sgd-v3-transcript-disclosure" class="sgd-v3-transcript-disclosure" style="margin-bottom: 16px;"></div>
                <h4 class="sgd-fb-heading">Your Notes</h4>
                <div id="sgd-v3-notes-review" class="sgd-v3-notes-review"></div>
            `;
            grid.appendChild(leftCol);

            // Right column
            const rightCol = document.createElement('div');
            rightCol.className = 'sgd-fb-right pte-fb__right';
            rightCol.innerHTML = `
                <div class="sgd-v3-fb-tabs">
                    <button type="button" class="sgd-v3-fb-tab active" data-v3-tab="stats">Who said what</button>
                    <button type="button" class="sgd-v3-fb-tab" data-v3-tab="transcript">Transcript</button>
                </div>
                <div id="sgd-v3-stats-panel" class="sgd-v3-fb-panel"></div>
                <div id="sgd-v3-transcript-panel" class="sgd-v3-fb-panel" style="display: none;"></div>
            `;
            grid.appendChild(rightCol);

            feedback.appendChild(grid);
            el.practiceArea.appendChild(feedback);

            const aiScoreBtn = feedback.querySelector('#sgd-v3-ai-score-btn');
            if (aiScoreBtn) {
                aiScoreBtn.addEventListener('click', requestSgdAiScoring);
            }

            const tabButtons = feedback.querySelectorAll('.sgd-v3-fb-tab');
            tabButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const tab = btn.dataset.v3Tab;
                    v3ActiveTab = tab;
                    tabButtons.forEach(b => b.classList.toggle('active', b === btn));
                    const statsP = document.getElementById('sgd-v3-stats-panel');
                    const transP = document.getElementById('sgd-v3-transcript-panel');
                    if (statsP) statsP.style.display = tab === 'stats' ? 'flex' : 'none';
                    if (transP) transP.style.display = tab === 'transcript' ? 'flex' : 'none';
                });
            });
        }

        ['sgd-record-btn', 'sgd-cancel-btn', 'sgd-stop-btn', 'sgd-retry-btn', 'sgd-play-user-btn', 'sgd-submit-btn', 'sgd-redo-btn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.style.display = '';
        });
    }

    function mountPteShell() {
        v3Active = true;
        const modePanel = document.getElementById('mode-sgd');
        if (modePanel) modePanel.classList.add('sgd-pte-v3');
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
        const modePanel = document.getElementById('mode-sgd');
        if (modePanel) modePanel.classList.remove('sgd-pte-v3');
        stopAllV3Timers();
        stopMediaStream();
        if (pteAudioBox) {
            pteAudioBox.destroy();
            pteAudioBox = null;
        }
        if (pteRecorderWidget) {
            pteRecorderWidget.destroy();
            pteRecorderWidget = null;
        }

        const speakerNotes = document.getElementById('sgd-speaker-notes');
        const stepListen = document.getElementById('sgd-step-listen');
        if (speakerNotes && stepListen && !stepListen.contains(speakerNotes)) {
            stepListen.appendChild(speakerNotes);
        }

        document.getElementById('sgd-pte-instruction')?.remove();
        document.getElementById('sgd-pte-stage')?.remove();
        document.getElementById('sgd-pte-feedback')?.remove();
        reset();
    }

    function syncPteShell() {
        if (!v3Active) return;
        window.SpeakingPracticeController?.setPhase?.('sgd', v3Phase);
        syncPteV3UI();
    }

    function syncPteV3UI() {
        if (!isV3()) return;
        const stage = document.getElementById('sgd-pte-stage');
        const feedback = document.getElementById('sgd-pte-feedback');
        const practiceArea = document.getElementById('sgd-practice-area');
        if (practiceArea) practiceArea.style.display = 'block';

        if (v3Phase === 'feedback') {
            if (stage) { stage.hidden = true; stage.style.display = 'none'; }
            // Leave display to the stylesheet so .pte-fb keeps its grid and its
            // stacking rule; an inline value overrode both.
            if (feedback) { feedback.hidden = false; feedback.style.display = ''; }
            renderV3Feedback();
        } else {
            if (stage) { stage.hidden = false; stage.style.display = 'flex'; }
            if (feedback) { feedback.hidden = true; feedback.style.display = ''; }
        }
    }

    async function startV3QuestionFlow() {
        if (!v3Active || !currentEntry) return;
        stopAllTimers();
        stopAllV3Timers();
        stopMediaStream();
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try { mediaRecorder.stop(); } catch (_) {}
        }
        mediaRecorder = null;
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        dspPromise = null;

        const qGen = ++questionGen;
        const aGen = ++attemptGen;
        v3Phase = 'listen';
        syncPteShell();

        const recHost = document.getElementById('sgd-pte-rec-host');
        if (recHost) recHost.style.display = 'none';
        pteRecorderWidget?.reset?.();

        ensureV3Elements();
        renderSpeakerTabs();

        const sub = document.getElementById('sgd-notes-subtitle');
        if (sub) sub.textContent = '· type while you listen';

        loadAudio(currentEntry.id);
        pteAudioBox?.reset?.();

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
            console.warn('[SGD v3] Audio play error:', err);
        }
        if (qGen !== questionGen || aGen !== attemptGen || !v3Active) return;

        startV3Prep();
    }

    function startV3Prep() {
        if (!v3Active || !currentEntry) return;
        stopAllTimers();
        stopAllV3Timers();
        stopMediaStream();

        const qGen = questionGen;
        const aGen = ++attemptGen;
        v3Phase = 'prep';
        syncPteShell();

        v3RecordedDurationSec = 0;
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        dspPromise = null;

        const recHost = document.getElementById('sgd-pte-rec-host');
        if (recHost) recHost.style.display = '';

        const sub = document.getElementById('sgd-notes-subtitle');
        if (sub) sub.textContent = '· type while you listen';

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
            v3Timer = requestAnimationFrame(tickPrep);
        };
        v3Timer = requestAnimationFrame(tickPrep);
    }

    async function startV3Recording() {
        stopAllTimers();
        stopAllV3Timers();

        const qGen = questionGen;
        const aGen = ++attemptGen;
        v3Phase = 'recording';
        syncPteShell();

        const recHost = document.getElementById('sgd-pte-rec-host');
        if (recHost) recHost.style.display = '';

        const sub = document.getElementById('sgd-notes-subtitle');
        if (sub) sub.textContent = '· look at them while you speak';

        recordingSessionToken++;
        const myToken = recordingSessionToken;
        recordedChunks = [];
        v3RecordedDurationSec = 0;
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        originalRecordingBlob = null;
        enhancedPlaybackBlob = null;
        dspPromise = null;

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.error('[SGD v3] Mic access error:', err);
            return;
        }

        if (qGen !== questionGen || aGen !== attemptGen || v3Phase !== 'recording' || !v3Active || myToken !== recordingSessionToken) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        activeMediaStream = stream;
        pteRecorderWidget?.showRecording(MAX_RECORDING_SECONDS);
        pteRecorderWidget?.attachStream(stream);

        const mimeType = (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
            ? 'audio/webm;codecs=opus' : 'audio/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorder = recorder;
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        recorder.onstop = () => {
            stopMediaStream();
            if (qGen !== questionGen || aGen !== attemptGen || myToken !== recordingSessionToken) return;
            onV3RecordingComplete();
        };
        recorder.start(250);

        v3RecordStartTime = performance.now();
        const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
        const effectiveRecScale = scale < 1 ? 0.3 : scale;

        const tickRec = () => {
            if (qGen !== questionGen || aGen !== attemptGen || v3Phase !== 'recording' || !v3Active || myToken !== recordingSessionToken) return;
            const elapsed = ((performance.now() - v3RecordStartTime) / 1000) / effectiveRecScale;
            v3RecordedDurationSec = elapsed;
            pteRecorderWidget?.setElapsed(elapsed);
            if (elapsed >= MAX_RECORDING_SECONDS) {
                stopV3Recording();
                return;
            }
            v3RecordRAF = requestAnimationFrame(tickRec);
        };
        v3RecordRAF = requestAnimationFrame(tickRec);
    }

    function cancelRecording() {
        if (v3Phase !== 'recording') return;
        stopAllTimers();
        stopAllV3Timers();
        stopMediaStream();
        recordingSessionToken++;
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try { mediaRecorder.stop(); } catch (_) {}
        }
        mediaRecorder = null;
        recordedChunks = [];
        recordingBlob = null;
        originalRecordingBlob = null;
        enhancedPlaybackBlob = null;
        dspPromise = null;
        startV3Prep();
    }

    function stopV3Recording() {
        stopAllV3Timers();
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    }

    async function onV3RecordingComplete() {
        const myToken = recordingSessionToken;
        const blob = recordedChunks.length > 0 ? new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' }) : null;
        originalRecordingBlob = blob;
        recordingBlob = blob;
        if (blob) {
            recordingBlobUrl = URL.createObjectURL(blob);
        }

        if (blob && window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function') {
            dspPromise = window.AudioDspPipeline.enhance(blob).then((res) => {
                if (myToken !== recordingSessionToken) return blob;
                if (res?.wavBlob) {
                    if (recordingBlobUrl) URL.revokeObjectURL(recordingBlobUrl);
                    enhancedPlaybackBlob = res.wavBlob;
                    recordingBlobUrl = res.audioUrl || URL.createObjectURL(res.wavBlob);
                    return res.wavBlob;
                }
                return blob;
            }).catch(() => blob);
        } else {
            dspPromise = Promise.resolve(blob);
        }

        v3Phase = 'complete';
        syncPteShell();
    }

    function toggleUserAudioPlayback() {
        let audioEl = document.getElementById('sgd-v3-student-audio');
        if (!audioEl) audioEl = el.recordingPlayback;
        if (!audioEl) return;
        if (audioEl.src !== recordingBlobUrl && recordingBlobUrl) {
            audioEl.src = recordingBlobUrl;
        }
        if (audioEl.paused) {
            audioEl.play().catch(e => console.warn('playback failed:', e));
        } else {
            audioEl.pause();
        }
    }

    async function submitForFeedback() {
        const qGen = questionGen;
        const aGen = attemptGen;
        v3Phase = 'feedback';
        syncPteShell();

        const userNotes = collectSpeakerNotes();
        const result = compareTextsBySpeaker(currentEntry?.speakers || {}, userNotes);
        v3LastResult = result;
        v3LastNotes = userNotes;

        renderV3Feedback();

        const currentToken = recordingSessionToken;
        const finalBlob = dspPromise ? await dspPromise.catch(() => recordingBlob) : recordingBlob;
        if (qGen !== questionGen || aGen !== attemptGen || currentToken !== recordingSessionToken) return;

        try {
            await window.PTEAttemptArchive?.saveAttempt?.({
                practiceMode: 'sgd',
                promptSnapshot: {
                    promptId: currentEntry?.id || null,
                    title: currentEntry?.title || '',
                    text: currentEntry?.narration || '',
                    sourceAssetPaths: currentEntry?.audio ? [currentEntry.audio] : [],
                    data: currentEntry
                },
                responseSnapshot: {
                    userNotes,
                    speakerCount: Object.keys(currentEntry?.speakers || {}).length,
                    spokenTranscript: acceptedTranscription?.rawTranscript || null,
                    transcriptSource: acceptedTranscription ? 'server_asr' : null,
                    pronunciationAssessmentId: pronunciationAssessmentId || null,
                    legacyNotesProxy: Object.values(userNotes || {}).join(' ')
                },
                answerSnapshot: {
                    keyPoints: currentEntry?.keyPoints || [],
                    sampleAnswer: currentEntry?.sampleAnswer || null
                },
                resultSnapshot: result,
                scoringSource: 'client',
                media: finalBlob ? [{
                    slot: 'student',
                    label: 'Student summary',
                    blob: finalBlob,
                    contentType: finalBlob.type || 'audio/webm'
                }] : []
            });
        } catch (err) {
            console.warn('[PTE Archive] SGD v3 save failed:', err);
        }
    }

    async function requestSgdAiScoring() {
        const aiBtn = document.getElementById('sgd-v3-ai-score-btn');
        const aiStatus = document.getElementById('sgd-v3-ai-status');
        const disclosureEl = document.getElementById('sgd-v3-transcript-disclosure');
        const rawBlob = originalRecordingBlob || recordingBlob;
        if (!rawBlob) {
            if (aiStatus) aiStatus.textContent = 'No recording available to score.';
            return;
        }

        if (aiBtn) aiBtn.disabled = true;
        if (aiStatus) aiStatus.textContent = 'Calculating credit quote...';

        try {
            const sampleRate = 16000;
            const durationSec = Math.max(1, Math.round(v3RecordedDurationSec || recordingSeconds || 30));
            const sampleCount = Math.max(16000, durationSec * sampleRate);
            const base64Audio = await window.AiScoringGate?.blobToBase64?.(rawBlob);

            const gateResult = await window.AiScoringGate.requestConsentAndConfirm({
                mode: 'summarize_group_discussion',
                inputMeta: {
                    sampleCount,
                    sampleRateHz: sampleRate,
                    audioBuffer: base64Audio
                },
                questionId: currentEntry?.id || null
            });

            if (!gateResult.allowed) {
                if (gateResult.cancelled) {
                    if (aiStatus) aiStatus.textContent = 'AI assessment cancelled. No credits charged.';
                    if (aiBtn) aiBtn.disabled = false;
                    return;
                }
                throw new Error(gateResult.error || 'Scoring not authorized');
            }

            if (aiStatus) aiStatus.textContent = 'Analyzing response with Azure Speech AI...';

            let assessmentResult = null;
            if (gateResult.assessmentId) {
                assessmentResult = await window.AiScoringGate.pollAssessmentResult(gateResult.assessmentId);
            } else if (gateResult.unmetered) {
                assessmentResult = gateResult.result || null;
            }

            if (assessmentResult) {
                acceptedTranscription = assessmentResult.transcription || null;
                pronunciationAssessmentId = gateResult.assessmentId || null;

                if (disclosureEl && window.TranscriptDisclosure) {
                    const disclosure = new window.TranscriptDisclosure({
                        containerEl: disclosureEl,
                        onWordClick: (w) => {
                            console.log('[SGD Disclosure] Clicked token:', w);
                        }
                    });
                    disclosure.render(assessmentResult);
                }

                if (aiStatus) aiStatus.textContent = 'Pronunciation assessment complete.';
                if (aiBtn) aiBtn.style.display = 'none';

                // Patch attempt archive with real transcript and assessment id
                const userNotes = v3LastNotes || collectSpeakerNotes();
                window.PTEAttemptArchive?.saveAttempt?.({
                    practiceMode: 'sgd',
                    promptSnapshot: {
                        promptId: currentEntry?.id || null,
                        title: currentEntry?.title || '',
                        text: currentEntry?.narration || '',
                        sourceAssetPaths: currentEntry?.audio ? [currentEntry.audio] : [],
                        data: currentEntry
                    },
                    responseSnapshot: {
                        userNotes,
                        spokenTranscript: acceptedTranscription?.rawTranscript || null,
                        transcriptSource: 'server_asr',
                        pronunciationAssessmentId: pronunciationAssessmentId,
                        speakerCount: Object.keys(currentEntry?.speakers || {}).length,
                        legacyNotesProxy: Object.values(userNotes || {}).join(' ')
                    },
                    answerSnapshot: {
                        keyPoints: currentEntry?.keyPoints || [],
                        sampleAnswer: currentEntry?.sampleAnswer || null
                    },
                    resultSnapshot: v3LastResult,
                    scoringSource: 'ai',
                    media: rawBlob ? [{
                        slot: 'student',
                        label: 'Student summary',
                        blob: rawBlob,
                        contentType: rawBlob.type || 'audio/webm'
                    }] : []
                }).catch(err => console.warn('[PTE Archive] SGD patch failed:', err));
            }
        } catch (err) {
            console.error('[SGD AI Scoring] Error:', err);
            if (aiStatus) aiStatus.textContent = err.message || 'Scoring failed. Please try again.';
            if (aiBtn) aiBtn.disabled = false;
        }
    }

    function renderV3Feedback() {
        const feedback = document.getElementById('sgd-pte-feedback');
        if (!feedback || !v3LastResult) return;

        const aiSection = document.getElementById('sgd-v3-ai-scoring-section');
        const aiBtn = document.getElementById('sgd-v3-ai-score-btn');
        const aiStatus = document.getElementById('sgd-v3-ai-status');
        const disclosureEl = document.getElementById('sgd-v3-transcript-disclosure');
        if (aiSection) {
            if (recordingBlob || originalRecordingBlob) {
                aiSection.style.display = 'block';
                if (aiBtn) {
                    aiBtn.style.display = pronunciationAssessmentId ? 'none' : 'block';
                    aiBtn.disabled = false;
                }
                if (aiStatus) {
                    aiStatus.textContent = pronunciationAssessmentId ? 'Pronunciation assessment complete.' : '';
                }
            } else {
                aiSection.style.display = 'none';
            }
        }

        const studentAudio = document.getElementById('sgd-v3-student-audio');
        if (studentAudio && recordingBlobUrl) {
            studentAudio.src = recordingBlobUrl;
        }

        const notesReview = document.getElementById('sgd-v3-notes-review');
        if (notesReview) {
            clearChildren(notesReview);
            const userNotes = v3LastNotes || {};
            const topicText = userNotes['Topic'] || '';
            if (topicText) {
                const topicBox = document.createElement('div');
                topicBox.className = 'sgd-v3-note-item';
                topicBox.innerHTML = `<strong>Topic:</strong> <p>${escapeHtml(topicText)}</p>`;
                notesReview.appendChild(topicBox);
            }

            Object.entries(currentEntry?.speakers || {}).forEach(([spkName]) => {
                const text = userNotes[spkName] || '';
                const spkData = v3LastResult.perSpeaker[spkName];
                const matchedSet = new Set((spkData?.matched || []).map(m => cleanWord(m)));

                const spkBox = document.createElement('div');
                spkBox.className = 'sgd-v3-note-item';

                const tokens = (text || '(No notes)').split(/(\s+)/);
                const highlighted = tokens.map(tok => {
                    const cw = cleanWord(tok);
                    if (cw && matchedSet.has(cw)) {
                        return `<span class="sgd-matched-word">${escapeHtml(tok)}</span>`;
                    }
                    return escapeHtml(tok);
                }).join('');

                spkBox.innerHTML = `<strong>${escapeHtml(spkName)}:</strong> <p>${highlighted}</p>`;
                notesReview.appendChild(spkBox);
            });
        }

        const statsPanel = document.getElementById('sgd-v3-stats-panel');
        if (statsPanel) {
            clearChildren(statsPanel);
            const overallPct = Math.round((v3LastResult.overall?.accuracy || 0) * 100);

            const overallCard = document.createElement('div');
            overallCard.className = 'notes-results-stats';
            overallCard.innerHTML = `<span id="sgd-overall-accuracy">${overallPct}</span>% overall accuracy`;
            statsPanel.appendChild(overallCard);

            const grid = document.createElement('div');
            grid.className = 'sgd-results-grid';
            Object.entries(v3LastResult.perSpeaker || {}).forEach(([spkName, data]) => {
                const pct = Math.round((data.accuracy || 0) * 100);
                const card = document.createElement('div');
                card.className = 'sgd-speaker-result';
                card.innerHTML = `
                    <div class="sgd-speaker-result-header">
                        <span class="sgd-speaker-result-name">${escapeHtml(spkName)}</span>
                        <span class="sgd-speaker-result-score">${pct}%</span>
                    </div>
                    <div class="sgd-speaker-result-stats">${data.matched.length} / ${data.total} key words matched</div>
                `;
                grid.appendChild(card);
            });
            statsPanel.appendChild(grid);
        }

        const transPanel = document.getElementById('sgd-v3-transcript-panel');
        if (transPanel) {
            clearChildren(transPanel);
            if (currentEntry?.narration) {
                const narrBox = document.createElement('div');
                narrBox.className = 'sgd-v3-narr-box';
                narrBox.innerHTML = `<em>Narration: ${escapeHtml(currentEntry.narration)}</em>`;
                transPanel.appendChild(narrBox);
            }

            Object.entries(v3LastResult.perSpeaker || {}).forEach(([spkName, data]) => {
                const spkBox = document.createElement('div');
                spkBox.className = 'sgd-v3-trans-item';
                const parts = data.highlightedTranscriptParts || [];
                const html = parts.map(p => {
                    if (p.matched) return `<span class="sgd-matched-word">${escapeHtml(p.text)}</span>`;
                    return escapeHtml(p.text);
                }).join('');
                spkBox.innerHTML = `<strong>${escapeHtml(spkName)}:</strong> <p>${html}</p>`;
                transPanel.appendChild(spkBox);
            });
        }
    }

    async function finishRecordingForNext() {
        stopAllTimers();
        stopAllV3Timers();
        stopMediaStream();
        const qGen = questionGen;
        const aGen = ++attemptGen;
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try { mediaRecorder.stop(); } catch (_) {}
        }
        mediaRecorder = null;
        const finalBlob = dspPromise ? await dspPromise.catch(() => recordingBlob) : recordingBlob;
        if (qGen !== questionGen || aGen !== attemptGen) return;
        if (currentEntry) {
            const userNotes = collectSpeakerNotes();
            const result = compareTextsBySpeaker(currentEntry.speakers || {}, userNotes);
            try {
                await window.PTEAttemptArchive?.saveAttempt?.({
                    practiceMode: 'sgd',
                    promptSnapshot: {
                        promptId: currentEntry.id || null,
                        title: currentEntry.title || '',
                        text: currentEntry.narration || '',
                        sourceAssetPaths: currentEntry.audio ? [currentEntry.audio] : [],
                        data: currentEntry
                    },
                    responseSnapshot: { userNotes },
                    answerSnapshot: {
                        keyPoints: currentEntry.keyPoints || [],
                        sampleAnswer: currentEntry.sampleAnswer || null
                    },
                    resultSnapshot: result,
                    scoringSource: 'client',
                    media: finalBlob ? [{
                        slot: 'student',
                        label: 'Student summary',
                        blob: finalBlob,
                        contentType: finalBlob.type || 'audio/webm'
                    }] : []
                });
            } catch (_) {}
        }
    }

    function advanceQuestion() {
        if (!entries || entries.length === 0) return;
        const nextIndex = (currentEntryIndex + 1) % entries.length;
        selectEntry(nextIndex);
    }

    function stopAllTimers() {
        if (recordingTimerId) {
            clearInterval(recordingTimerId);
            recordingTimerId = null;
        }
        stopAllV3Timers();
    }

    function stopAllV3Timers() {
        if (v3Timer) {
            cancelAnimationFrame(v3Timer);
            v3Timer = null;
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

    /* ──────────────────────────── BOOTSTRAP ────────────────────────── */

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.SGDMode = {
        init,
        reset,
        loadEntries,
        applyFilters: applyFilter,
        onEnter,
        onExit,
        getItems: () => entries,
        getCurrentId: () => (currentEntry ? String(currentEntry.id) : null),
        select: (id) => {
            const idx = filteredEntries.findIndex(e => String(e.id) === String(id));
            if (idx >= 0) selectEntry(idx);
        },
        previous: goToPrevious,
        next: goToNext,
        // v3 methods
        mountPteShell,
        unmountPteShell,
        syncPteShell,
        getPtePhase: () => v3Phase,
        startV3Recording,
        stopV3Recording,
        cancelRecording,
        retryRecording: startV3Prep,
        toggleUserAudioPlayback,
        submitForFeedback,
        finishRecordingForNext,
        advanceQuestion
    };

    // Deep-link support: listen for PracticeRouter question navigation events
    window.addEventListener('practice-route-question', (event) => {
        const { mode, questionId } = event.detail || {};
        if (mode !== 'sgd' || !questionId) return;
        if (!hasLoadedEntries || filteredEntries.length === 0) return;
        const idx = filteredEntries.findIndex((e) => String(e.id) === String(questionId));
        if (idx >= 0) {
            selectEntry(idx);
        }
    });
})();
