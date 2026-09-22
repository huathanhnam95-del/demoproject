/**
 * Respond To Situation (RTS) Mode Module (PTE Practice → Speaking)
 * Flow: Select question → Start → Audio Countdown (15s) → Audio Plays → Prep (10s) → Record (40s) → Results
 */
(function () {
    'use strict';

    const RTS_JSON_PATH = '/database/RTS/rts_questions.json';
    const RTS_AUDIO_DIR = '/database/RTS/audio/';
    const AUDIO_COUNTDOWN_SECONDS = 15;
    const PREP_SECONDS = 10;
    const RECORD_SECONDS = 40;
    const RECORD_HARD_LIMIT = 45; // backend safety

    // State
    let entries = [];
    let currentEntryIndex = 0;
    let currentEntry = null;
    let isInitialized = false;
    let hasLoadedEntries = false;
    let loadEntriesPromise = null;
    let pickerOpen = false;

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
    let v3LastAiScoreData = null;
    let v3ActiveTab = 'ai'; // 'ai' | 'sample'
    let v3ActiveSampleTab = 'full'; // 'full' | 'simplified'
    let origAiScoreBtnParent = null;
    let origAiScoreBtnSibling = null;
    let origAiScoreHintParent = null;
    let origAiScoreHintSibling = null;

    // Timer state (drift-free via performance.now)
    let audioCountdownStart = null;
    let audioCountdownRAF = null;
    let prepStartTime = null;
    let prepRAF = null;
    let recordStartTime = null;
    let recordRAF = null;
    let recordHardTimeout = null;

    // Recording state
    let mediaRecorder = null;
    let activeMediaStream = null;
    let recordedChunks = [];
    let recordingBlobUrl = null;
    let recordingBlob = null;
    let dspPromise = null;
    let recordingSessionToken = 0;
    let archiveAttemptId = null;
    let archiveSavePromise = null;

    // AI scoring state
    let scoreRTSFn = null;
    let isAiScoring = false;
    let hasAiScoreResult = false;
    let spokenAssessmentData = null;

    // Speech recognition
    let speechRecognition = null;
    let transcriptText = '';

    // Current step
    let currentStep = 'idle'; // idle | audio | prep | recording | results

    // DOM cache
    const el = {};

    /* ──────────────────────────── HELPERS ──────────────────────────── */

    function isV3() {
        return !!(v3Active || window.PteShellConfig?.isModeEnabled?.('rts', 'pte'));
    }

    function show(e) { if (e) e.style.display = ''; }
    function hide(e) { if (e) e.style.display = 'none'; }
    function setTranscriptDisplay(value) {
        const text = String(value || '').trim();
        if (!el.rtsTranscript) return;
        el.rtsTranscript.textContent = text || 'No transcript detected.';
        el.rtsTranscript.classList.toggle('rts-no-transcript', !text);
    }
    function getTranscriptForScoring() {
        if (isV3()) {
            const v3Tr = document.getElementById('rts-v3-transcript');
            if (v3Tr) {
                const text = String(v3Tr.textContent || '').trim();
                if (text && text !== 'No transcript detected.') return text;
            }
            return String(transcriptText || '').trim();
        }
        if (el.rtsTranscript) {
            const text = String(el.rtsTranscript.textContent || '').trim();
            return text === 'No transcript detected.' ? '' : text;
        }
        return String(transcriptText || '').trim();
    }
    function fmt(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function stopMediaStream() {
        if (activeMediaStream) {
            try {
                activeMediaStream.getTracks().forEach(track => track.stop());
            } catch (_) { /* ignore */ }
            activeMediaStream = null;
        }
    }

    function rememberArchiveSave(promise) {
        archiveSavePromise = Promise.resolve(promise || null)
            .then((result) => {
                archiveAttemptId = result?.attemptId || archiveAttemptId;
                return archiveAttemptId;
            })
            .catch((error) => {
                console.warn('[PTE Archive] RTS save failed:', error);
                return null;
            });
        return archiveSavePromise;
    }

    async function ensureArchiveAttemptId() {
        if (archiveAttemptId) return archiveAttemptId;
        if (archiveSavePromise) {
            const attemptId = await archiveSavePromise;
            return attemptId || archiveAttemptId;
        }
        return null;
    }

    /* ──────────────────────────── INIT ──────────────────────────── */

    function cacheElements() {
        const ids = [
            // v7 picker
            'rts-v7-prev-btn', 'rts-v7-next-btn', 'rts-v7-question-pill',
            'rts-v7-backdrop', 'rts-v7-sheet', 'rts-v7-sheet-close',
            'rts-v7-jump-search', 'rts-v7-jump-list',
            // practice
            'play-rts-btn', 'rts-practice-area', 'rts-step-progress',
            'rts-step-audio', 'rts-prompt-text', 'rts-audio-countdown-box',
            'rts-audio-countdown-text', 'rts-audio-countdown-timer', 'rts-audio-countdown-bar-fill',
            'rts-audio-player',
            'rts-step-prep', 'rts-prompt-text-prep', 'rts-prep-timer', 'rts-prep-bar-fill',
            'rts-step-record', 'rts-prompt-text-record', 'rts-record-status',
            'rts-record-status-text', 'rts-record-timer', 'rts-record-bar-fill', 'rts-stop-btn',
            'rts-step-results', 'rts-recording-playback', 'rts-transcript',
            'rts-retry-btn', 'rts-next-question-btn',
            'rts-ai-score-btn', 'rts-ai-score-hint', 'rts-results-container'
        ];
        ids.forEach(id => {
            const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            el[key] = document.getElementById(id);
        });
    }

    function init() {
        if (isInitialized) return;
        cacheElements();
        if (!el.playRtsBtn) {
            console.warn('[RTS] Practice UI elements not found, skipping init');
            return;
        }
        setupEventListeners();
        loadEntries();
        isInitialized = true;
    }

    function reset() {
        stopAllTimers();
        stopAllV3Timers();
        stopMediaStream();
        stopRecording(true);
        currentStep = 'idle';
        transcriptText = '';
        v3RecordedDurationSec = 0;
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        dspPromise = null;
        archiveAttemptId = null;
        archiveSavePromise = null;
        recordedChunks = [];
        if (el.rtsRecordingPlayback) {
            try {
                el.rtsRecordingPlayback.pause();
                el.rtsRecordingPlayback.removeAttribute('src');
                el.rtsRecordingPlayback.load();
            } catch (_) { /* ignore */ }
        }
        const v3Playback = document.getElementById('rts-v3-playback');
        if (v3Playback) {
            try {
                v3Playback.pause();
                v3Playback.removeAttribute('src');
                v3Playback.load();
            } catch (_) { /* ignore */ }
        }
        // Stop audio player
        if (el.rtsAudioPlayer) {
            try {
                el.rtsAudioPlayer.pause();
                el.rtsAudioPlayer.currentTime = 0;
            } catch (_) { /* ignore */ }
        }
        setTranscriptDisplay('');
        const v3Tr = document.getElementById('rts-v3-transcript');
        if (v3Tr) v3Tr.textContent = 'No transcript detected.';
        if (el.rtsRecordTimer) el.rtsRecordTimer.classList.remove('rts-timer-warning');
        if (el.rtsRecordStatus) el.rtsRecordStatus.classList.remove('rts-recording-active');
        // Reset AI scoring state
        isAiScoring = false;
        hasAiScoreResult = false;
        v3LastAiScoreData = null;
        v3ActiveTab = 'ai';
        v3ActiveSampleTab = 'full';
        setV3ActiveTab('ai');
        setV3SampleTab('full');
        if (el.rtsResultsContainer) el.rtsResultsContainer.innerHTML = '';
        const v3Results = document.getElementById('rts-v3-results-container');
        if (v3Results) { v3Results.innerHTML = ''; v3Results.style.display = 'none'; }
        const v3Empty = document.getElementById('rts-v3-ai-empty');
        if (v3Empty) v3Empty.style.display = '';
        if (el.rtsAiScoreBtn) {
            el.rtsAiScoreBtn.disabled = false;
            el.rtsAiScoreBtn.style.display = '';
            el.rtsAiScoreBtn.textContent = 'Submit to AI Scoring';
        }
        if (el.rtsAiScoreHint) { el.rtsAiScoreHint.style.display = 'none'; el.rtsAiScoreHint.innerHTML = ''; }
        if (!isV3()) {
            hide(el.rtsPracticeArea);
            hide(el.rtsStepAudio);
            hide(el.rtsStepPrep);
            hide(el.rtsStepRecord);
            hide(el.rtsStepResults);
        }
        updateProgressBreadcrumb('idle');
    }

    function stopAllV3Timers() {
        if (v3Timer) { cancelAnimationFrame(v3Timer); v3Timer = null; }
        if (v3RecordRAF) { cancelAnimationFrame(v3RecordRAF); v3RecordRAF = null; }
    }

    function stopAllTimers() {
        if (audioCountdownRAF) { cancelAnimationFrame(audioCountdownRAF); audioCountdownRAF = null; }
        if (prepRAF) { cancelAnimationFrame(prepRAF); prepRAF = null; }
        if (recordRAF) { cancelAnimationFrame(recordRAF); recordRAF = null; }
        if (recordHardTimeout) { clearTimeout(recordHardTimeout); recordHardTimeout = null; }
        audioCountdownStart = null;
        prepStartTime = null;
        recordStartTime = null;
    }

    /* ──────────────────────────── BREADCRUMB ──────────────────────────── */

    function updateProgressBreadcrumb(step) {
        if (!el.rtsStepProgress) return;
        const dots = el.rtsStepProgress.querySelectorAll('.rts-step-dot');
        const order = ['audio', 'prep', 'record', 'results'];
        const activeIdx = order.indexOf(step);
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === activeIdx);
            dot.classList.toggle('completed', i < activeIdx);
        });
        window.SpeakingPracticeController?.sync?.('rts');
    }

    /* ──────────────────────────── DATA LOADING ──────────────────────────── */

    function loadEntries() {
        if (hasLoadedEntries) return loadEntriesPromise;
        loadEntriesPromise = fetch(RTS_JSON_PATH)
            .then(r => {
                if (!r.ok) throw new Error(`Failed to load RTS data: ${r.status}`);
                return r.json();
            })
            .then(data => {
                entries = data.sort((a, b) => a.id - b.id);
                hasLoadedEntries = true;
                renderPicker();
                if (entries.length > 0) loadQuestion(0);
                window.SpeakingPracticeController?.sync?.('rts');
            })
            .catch(err => console.error('[RTS] Failed to load entries:', err));
        return loadEntriesPromise;
    }

    /* ──────────────────────────── V7 PICKER ──────────────────────────── */

    function renderPicker() {
        if (!el.rtsV7QuestionPill) return;
        const entry = entries[currentEntryIndex];
        el.rtsV7QuestionPill.textContent = entry
            ? `#${entry.id} — ${entry.title || 'Question ' + entry.id}`
            : 'No questions available';
        setNavigationLocked(entries.length === 0);
    }

    function renderJumpList(filter) {
        if (!el.rtsV7JumpList) return;
        const lf = String(filter || '').toLowerCase().trim();
        const items = entries.map((entry, idx) => {
            const title = entry.title || 'Question ' + entry.id;
            if (lf && !title.toLowerCase().includes(lf) && !String(entry.id).includes(lf)) return '';
            const isActive = idx === currentEntryIndex;
            return `<button class="ra-v7-list-item${isActive ? ' is-active' : ''}" type="button" data-index="${idx}" role="option" ${isActive ? 'aria-selected="true"' : ''}>
                <span class="ra-v7-item-id">#${escapeHtml(String(entry.id))}</span>
                <span class="ra-v7-item-title">${escapeHtml(title)}</span>
            </button>`;
        }).filter(Boolean);
        el.rtsV7JumpList.innerHTML = items.length > 0 ? items.join('') : '<div class="ra-v7-empty">No matching questions</div>';
    }

    function openPicker() {
        if (!el.rtsV7Sheet || !el.rtsV7Backdrop || entries.length === 0) return;
        pickerOpen = true;
        el.rtsV7Backdrop.classList.add('is-visible');
        el.rtsV7Backdrop.setAttribute('aria-hidden', 'false');
        el.rtsV7Sheet.classList.add('is-open');
        if (el.rtsV7QuestionPill) el.rtsV7QuestionPill.setAttribute('aria-expanded', 'true');
        renderJumpList();
        if (el.rtsV7JumpSearch) { el.rtsV7JumpSearch.value = ''; el.rtsV7JumpSearch.focus(); }
    }

    function closePicker() {
        if (!el.rtsV7Sheet || !el.rtsV7Backdrop) return;
        pickerOpen = false;
        el.rtsV7Backdrop.classList.remove('is-visible');
        el.rtsV7Backdrop.setAttribute('aria-hidden', 'true');
        el.rtsV7Sheet.classList.remove('is-open');
        if (el.rtsV7QuestionPill) el.rtsV7QuestionPill.setAttribute('aria-expanded', 'false');
    }

    function setNavigationLocked(locked) {
        const hasEntries = entries.length > 0;
        if (el.rtsV7PrevBtn) el.rtsV7PrevBtn.disabled = locked || currentEntryIndex <= 0;
        if (el.rtsV7NextBtn) el.rtsV7NextBtn.disabled = locked || currentEntryIndex >= entries.length - 1;
        if (el.rtsV7QuestionPill) el.rtsV7QuestionPill.disabled = locked || !hasEntries;
    }

    /* ──────────────────────────── QUESTION NAVIGATION ──────────────────────────── */

    function loadQuestion(index) {
        if (index < 0 || index >= entries.length) return;
        reset();
        currentEntryIndex = index;
        currentEntry = entries[index];

        // Update v7 picker
        renderPicker();
        closePicker();

        // Pre-load audio
        if (el.rtsAudioPlayer) {
            const rtsAudioUrl = `${RTS_AUDIO_DIR}RTS_${currentEntry.id}.mp3`;
            if (window.MediaUrlResolver && typeof window.MediaUrlResolver.loadAudio === 'function') {
                window.MediaUrlResolver.loadAudio(el.rtsAudioPlayer, rtsAudioUrl, { mode: 'RTS' });
            } else {
                el.rtsAudioPlayer.src = rtsAudioUrl;
                el.rtsAudioPlayer.load();
            }
        }

        // Show start button
        if (!isV3()) {
            show(el.playRtsBtn);
        } else {
            hide(el.playRtsBtn);
            show(el.rtsPracticeArea);
        }
        window.SpeakingPracticeController?.sync?.('rts');

        // Update URL with current question ID
        if (window.PracticeRouter && currentEntry?.id) {
            window.PracticeRouter.replaceRoute('rts', currentEntry.id);
        }

        if (isV3()) {
            ensureV3Elements();
            const promptEl = document.getElementById('rts-pte-prompt-text');
            if (promptEl) promptEl.textContent = currentEntry.answer || currentEntry.prompt || '';
            startV3QuestionFlow();
        }
    }

    function getItems() {
        return entries.map((entry) => ({
            id: String(entry.id),
            label: entry.title || `Question ${entry.id}`,
            searchText: `${entry.title || ''} ${entry.id}`.trim(),
            disabled: false
        }));
    }

    function getCurrentId() {
        return currentEntry ? String(currentEntry.id) : null;
    }

    function select(id) {
        const index = entries.findIndex((entry) => String(entry.id) === String(id));
        if (index >= 0) loadQuestion(index);
    }

    /* ──────────────────────────── EVENT LISTENERS ──────────────────────────── */

    function setupEventListeners() {
        // v7 Picker navigation
        if (el.rtsV7PrevBtn) el.rtsV7PrevBtn.addEventListener('click', () => {
            if (currentEntryIndex > 0) loadQuestion(currentEntryIndex - 1);
        });
        if (el.rtsV7NextBtn) el.rtsV7NextBtn.addEventListener('click', () => {
            if (currentEntryIndex < entries.length - 1) loadQuestion(currentEntryIndex + 1);
        });
        if (el.rtsV7QuestionPill) el.rtsV7QuestionPill.addEventListener('click', () => {
            pickerOpen ? closePicker() : openPicker();
        });
        if (el.rtsV7Backdrop) el.rtsV7Backdrop.addEventListener('click', closePicker);
        if (el.rtsV7SheetClose) el.rtsV7SheetClose.addEventListener('click', closePicker);
        if (el.rtsV7JumpSearch) {
            el.rtsV7JumpSearch.addEventListener('input', (e) => renderJumpList(e.target.value));
        }
        if (el.rtsV7JumpList) {
            el.rtsV7JumpList.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-index]');
                if (btn) loadQuestion(Number(btn.dataset.index));
            });
        }

        // Start
        if (el.playRtsBtn) el.playRtsBtn.addEventListener('click', startFlow);

        // Stop recording
        if (el.rtsStopBtn) el.rtsStopBtn.addEventListener('click', () => {
            if (isV3()) stopV3Recording();
            else stopRecording(false);
        });

        // Results buttons
        if (el.rtsRetryBtn) el.rtsRetryBtn.addEventListener('click', () => {
            if (isV3()) startV3Prep();
            else if (currentEntry) loadQuestion(currentEntryIndex);
        });
        if (el.rtsNextQuestionBtn) el.rtsNextQuestionBtn.addEventListener('click', () => {
            if (currentEntryIndex < entries.length - 1) {
                loadQuestion(currentEntryIndex + 1);
            }
        });

        // AI scoring
        if (el.rtsAiScoreBtn) el.rtsAiScoreBtn.addEventListener('click', submitToAiScoring);

        // v3 action buttons
        const recBtn = document.getElementById('rts-record-btn');
        if (recBtn) recBtn.addEventListener('click', () => {
            if (isV3()) startV3Recording();
            else startRecording();
        });

        const cancelBtn = document.getElementById('rts-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => {
            if (isV3()) cancelRecording();
        });

        const playBtn = document.getElementById('rts-play-btn');
        if (playBtn) playBtn.addEventListener('click', toggleUserAudioPlayback);

        const submitBtn = document.getElementById('rts-submit-btn');
        if (submitBtn) submitBtn.addEventListener('click', () => {
            if (isV3()) submitForFeedback();
        });

        const redoBtn = document.getElementById('rts-redo-btn');
        if (redoBtn) redoBtn.addEventListener('click', () => {
            if (isV3()) startV3Prep();
        });

        // Audio ended → transition to Prep
        if (el.rtsAudioPlayer) {
            el.rtsAudioPlayer.addEventListener('ended', onAudioEnded);
        }
    }

    /* ──────────────────────────── FLOW: START ──────────────────────────── */

    function startFlow() {
        if (!currentEntry) return;
        closePicker();
        hide(el.playRtsBtn);
        show(el.rtsPracticeArea);
        setNavigationLocked(false);
        startAudioCountdown();
    }

    /* ──────────────────────────── STEP 1: AUDIO COUNTDOWN (15s) ──────────────────────────── */

    function startAudioCountdown() {
        currentStep = 'audio';
        updateProgressBreadcrumb('audio');
        show(el.rtsStepAudio);
        show(el.rtsAudioCountdownBox);

        // Set prompt text
        if (el.rtsPromptText) el.rtsPromptText.textContent = currentEntry.answer;

        audioCountdownStart = performance.now();

        function tick() {
            const elapsed = (performance.now() - audioCountdownStart) / 1000;
            const remaining = Math.max(0, AUDIO_COUNTDOWN_SECONDS - elapsed);

            if (el.rtsAudioCountdownTimer) el.rtsAudioCountdownTimer.textContent = Math.ceil(remaining);
            if (el.rtsAudioCountdownBarFill) {
                el.rtsAudioCountdownBarFill.style.width = `${(remaining / AUDIO_COUNTDOWN_SECONDS) * 100}%`;
            }

            if (remaining <= 0) {
                audioCountdownRAF = null;
                startAudioPlayback();
                return;
            }
            audioCountdownRAF = requestAnimationFrame(tick);
        }
        audioCountdownRAF = requestAnimationFrame(tick);
    }

    /* ──────────────────────────── STEP 1b: AUDIO PLAYBACK ──────────────────────────── */

    function startAudioPlayback() {
        // Hide countdown box, keep prompt visible
        hide(el.rtsAudioCountdownBox);

        if (el.rtsAudioPlayer) {
            el.rtsAudioPlayer.play().catch(err => {
                console.error('[RTS] Audio playback failed:', err);
                // Fallback: proceed to prep if audio fails
                onAudioEnded();
            });
        } else {
            // No audio element, skip to prep
            onAudioEnded();
        }
    }

    function onAudioEnded() {
        if (currentStep !== 'audio') return;
        hide(el.rtsStepAudio);
        startPrepTimer();
    }

    /* ──────────────────────────── STEP 2: PREPARATION (10s) ──────────────────────────── */

    // Hold the prep countdown while a blocking tutorial covers the prompt, then resume
    // from the same remaining time. See describe-image-mode.js for the same pattern.
    let prepPausedAt = null;
    let resumePrepTick = null;
    window.addEventListener('tutorial:start', () => {
        if (currentStep !== 'prep' || prepPausedAt !== null) return;
        prepPausedAt = performance.now();
        if (prepRAF) { cancelAnimationFrame(prepRAF); prepRAF = null; }
    });
    window.addEventListener('tutorial:end', () => {
        if (prepPausedAt === null) return;
        prepStartTime += performance.now() - prepPausedAt;
        prepPausedAt = null;
        if (currentStep === 'prep' && resumePrepTick) prepRAF = requestAnimationFrame(resumePrepTick);
    });

    function startPrepTimer() {
        currentStep = 'prep';
        updateProgressBreadcrumb('prep');
        show(el.rtsStepPrep);

        // Show prompt text in prep step too
        if (el.rtsPromptTextPrep) el.rtsPromptTextPrep.textContent = currentEntry.answer;

        prepStartTime = performance.now();

        function tick() {
            const elapsed = (performance.now() - prepStartTime) / 1000;
            const remaining = Math.max(0, PREP_SECONDS - elapsed);

            if (el.rtsPrepTimer) el.rtsPrepTimer.textContent = fmt(remaining);
            if (el.rtsPrepBarFill) {
                el.rtsPrepBarFill.style.width = `${(remaining / PREP_SECONDS) * 100}%`;
            }

            if (remaining <= 0) {
                prepRAF = null;
                hide(el.rtsStepPrep);
                startRecording();
                return;
            }
            prepRAF = requestAnimationFrame(tick);
        }
        resumePrepTick = tick;
        if (window.isTutorialActive) {
            prepPausedAt = performance.now();
            return;
        }
        prepRAF = requestAnimationFrame(tick);
    }

    /* ──────────────────────────── STEP 3: RECORDING (40s display / 45s hard limit) ──────────────────────────── */

    async function startRecording() {
        currentStep = 'recording';
        updateProgressBreadcrumb('record');
        show(el.rtsStepRecord);

        // Show prompt text during recording (faded)
        if (el.rtsPromptTextRecord) el.rtsPromptTextRecord.textContent = currentEntry.answer;

        if (el.rtsRecordStatus) el.rtsRecordStatus.classList.add('rts-recording-active');

        recordingSessionToken++;
        const myToken = recordingSessionToken;
        recordedChunks = [];
        transcriptText = '';
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        dspPromise = null;

        // Request mic
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.error('[RTS] Mic access denied:', err);
            if (el.rtsRecordStatusText) el.rtsRecordStatusText.textContent = 'Mic access denied';
            return;
        }

        if (myToken !== recordingSessionToken) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        // Start MediaRecorder
        const mimeType = (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
            ? 'audio/webm;codecs=opus' : 'audio/webm';
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            if (myToken !== recordingSessionToken) return;
            onRecordingComplete();
        };
        mediaRecorder.start(250); // collect chunks every 250ms

        // Start speech recognition
        startSpeechRecognition(myToken);

        // Start visual timer (40s display)
        recordStartTime = performance.now();
        function tick() {
            if (myToken !== recordingSessionToken) return;
            const elapsed = (performance.now() - recordStartTime) / 1000;
            const remaining = Math.max(0, RECORD_SECONDS - elapsed);

            if (el.rtsRecordTimer) {
                el.rtsRecordTimer.textContent = fmt(remaining);
                el.rtsRecordTimer.classList.toggle('rts-timer-warning', remaining <= 5);
            }
            if (el.rtsRecordBarFill) {
                el.rtsRecordBarFill.style.width = `${(remaining / RECORD_SECONDS) * 100}%`;
            }

            if (remaining <= 0) {
                recordRAF = null;
                stopRecording(false);
                return;
            }
            recordRAF = requestAnimationFrame(tick);
        }
        recordRAF = requestAnimationFrame(tick);

        // Hard limit (45s backend safety)
        recordHardTimeout = setTimeout(() => {
            if (myToken === recordingSessionToken) {
                stopRecording(false);
            }
        }, RECORD_HARD_LIMIT * 1000);
    }

    function stopRecording(isCancel) {
        stopAllTimers();
        stopSpeechRecognition();
        stopMediaStream();

        if (isCancel) {
            recordingSessionToken++; // Invalidate ongoing media requests and onstop callbacks
        }

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch (_) { /* ignore */ }
        }
        mediaRecorder = null;
    }

    function onRecordingComplete() {
        if (recordedChunks.length === 0) {
            dspPromise = Promise.resolve(null);
            showResults(null);
            return;
        }
        const blob = new Blob(recordedChunks, { type: recordedChunks[0].type || 'audio/webm' });
        recordingBlob = blob;
        recordingBlobUrl = URL.createObjectURL(blob);

        const currentToken = recordingSessionToken;
        dspPromise = (window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function')
            ? window.AudioDspPipeline.enhance(blob).then((result) => {
                if (currentToken !== recordingSessionToken) return blob;
                if (result && result.wavBlob) {
                    if (recordingBlobUrl) URL.revokeObjectURL(recordingBlobUrl);
                    recordingBlob = result.wavBlob;
                    recordingBlobUrl = result.audioUrl || URL.createObjectURL(result.wavBlob);
                    if (el.rtsRecordingPlayback) {
                        el.rtsRecordingPlayback.src = recordingBlobUrl;
                    }
                    return result.wavBlob;
                }
                return blob;
            }).catch((err) => {
                console.warn('[RTS] AudioDspPipeline enhancement failed, keeping raw audio:', err);
                return blob;
            })
            : Promise.resolve(blob);

        showResults(recordingBlobUrl);
    }

    /* ──────────────────────────── SPEECH RECOGNITION ──────────────────────────── */

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
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    if (event.results[i].isFinal) {
                        transcriptText += event.results[i][0].transcript + ' ';
                    }
                }
            };
            speechRecognition.onerror = () => { /* silent */ };
            speechRecognition.start();
        } catch (_) { /* ignore */ }
    }

    function stopSpeechRecognition() {
        if (speechRecognition) {
            try { speechRecognition.stop(); } catch (_) { /* ignore */ }
            speechRecognition = null;
        }
    }

    /* ──────────────────────────── STEP 4: RESULTS ──────────────────────────── */

    function showResults(audioUrl) {
        currentStep = 'results';
        updateProgressBreadcrumb('results');
        hide(el.rtsStepRecord);
        show(el.rtsStepResults);

        if (el.rtsRecordStatus) el.rtsRecordStatus.classList.remove('rts-recording-active');

        // Playback
        if (el.rtsRecordingPlayback) {
            if (audioUrl) {
                el.rtsRecordingPlayback.src = audioUrl;
            } else {
                el.rtsRecordingPlayback.removeAttribute('src');
            }
        }

        setTranscriptDisplay(transcriptText);

        // Hide/show next button at end
        if (el.rtsNextQuestionBtn) {
            el.rtsNextQuestionBtn.style.display = currentEntryIndex < entries.length - 1 ? '' : 'none';
        }

        // Clear previous AI results and display reference model
        hasAiScoreResult = false;
        if (el.rtsResultsContainer) {
            el.rtsResultsContainer.innerHTML = buildSampleResponsesHtml(currentEntry?.sampleResponse);
            initSampleResponseTabs();
        }
        if (el.rtsAiScoreBtn) {
            el.rtsAiScoreBtn.style.display = '';
            el.rtsAiScoreBtn.textContent = 'Submit to AI Scoring';
        }

        // Update AI score button state
        updateAiScoreButtonState();

        archiveAttemptId = null;
        archiveSavePromise = null;
        const currentToken = recordingSessionToken;
        rememberArchiveSave((async () => {
            const finalBlob = dspPromise ? await dspPromise.catch(() => recordingBlob) : recordingBlob;
            if (currentToken !== recordingSessionToken) return null;
            return window.PTEAttemptArchive?.saveAttempt?.({
                practiceMode: 'rts',
                promptSnapshot: {
                    promptId: currentEntry?.id || null,
                    title: currentEntry?.title || '',
                    text: currentEntry?.answer || currentEntry?.prompt || '',
                    sourceAssetPaths: [currentEntry?.audioPath || currentEntry?.audio || currentEntry?.mediaPath].filter(Boolean),
                    data: currentEntry || null
                },
                responseSnapshot: {
                    transcript: getTranscriptForScoring() || transcriptText || ''
                },
                answerSnapshot: {
                    sampleResponse: currentEntry?.sampleResponse || currentEntry?.sampleResponses || null
                },
                resultSnapshot: {
                    submitted: true,
                    hasAudio: !!finalBlob
                },
                scoringSource: 'client',
                media: finalBlob ? [{
                    slot: 'student',
                    label: 'Student response',
                    blob: finalBlob,
                    contentType: finalBlob.type || 'audio/webm'
                }] : []
            });
        })());
    }

    /* ──────────────────────────── AI SCORING ──────────────────────────── */

    function isGuestMode() {
        return sessionStorage.getItem('guestMode') === 'true';
    }

    function getCurrentUser() {
        return window.__FIREBASE_INTERNAL__?.auth?.currentUser || window.auth?.currentUser || null;
    }

    function updateAiScoreButtonState() {
        if (!el.rtsAiScoreBtn) return;
        if (hasAiScoreResult) {
            el.rtsAiScoreBtn.disabled = true;
            el.rtsAiScoreBtn.style.display = 'none';
            if (el.rtsAiScoreHint) {
                el.rtsAiScoreHint.style.display = 'none';
                el.rtsAiScoreHint.innerHTML = '';
            }
            return;
        }

        el.rtsAiScoreBtn.style.display = '';
        const hasTranscript = Boolean(getTranscriptForScoring());
        if (!hasTranscript) {
            el.rtsAiScoreBtn.disabled = true;
            if (el.rtsAiScoreHint) {
                el.rtsAiScoreHint.style.display = 'block';
                el.rtsAiScoreHint.innerHTML = '<div class="essay-ai-score-hint-text">No transcript detected. Type or record a response before scoring.</div>';
            }
            return;
        }

        const user = getCurrentUser();
        const allowed = Boolean(user) && !isGuestMode();
        el.rtsAiScoreBtn.disabled = !allowed;

        if (!el.rtsAiScoreHint) return;

        if (allowed) {
            el.rtsAiScoreHint.style.display = 'none';
            el.rtsAiScoreHint.innerHTML = '';
            return;
        }

        el.rtsAiScoreHint.style.display = 'block';
        el.rtsAiScoreHint.innerHTML = `
            <div class="essay-ai-score-hint-text">AI scoring requires login.</div>
            <button id="rts-ai-score-login-btn" class="modern-btn modern-btn--hint" type="button">Log in</button>
        `;

        const btn = document.getElementById('rts-ai-score-login-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                if (window.authUI && typeof window.authUI.showLoginModal === 'function') {
                    window.authUI.showLoginModal();
                }
            });
        }
    }

    async function getScoreRTSCallable() {
        if (scoreRTSFn) return scoreRTSFn;
        if (typeof window.__mockScoreRTSFn === 'function') {
            scoreRTSFn = window.__mockScoreRTSFn;
            return scoreRTSFn;
        }
        if (window.__FIREBASE_INTERNAL__ && window.__FIREBASE_INTERNAL__.functions) {
            const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            scoreRTSFn = httpsCallable(window.__FIREBASE_INTERNAL__.functions, 'scoreRTS');
            return scoreRTSFn;
        }
        if (typeof firebase !== 'undefined' && firebase.functions) {
            scoreRTSFn = firebase.functions().httpsCallable('scoreRTS');
            return scoreRTSFn;
        }
        throw new Error('AI scoring unavailable (Firebase functions not loaded)');
    }

    async function submitToAiScoring() {
        if (isAiScoring) return;
        const safeTranscript = getTranscriptForScoring();
        if (!safeTranscript) {
            alert('No transcript detected. Please record again or type your response before scoring.');
            return;
        }

        updateAiScoreButtonState();
        if (el.rtsAiScoreBtn && el.rtsAiScoreBtn.disabled) return;
        transcriptText = safeTranscript;

        const qGen = questionGen;
        const aGen = attemptGen;

        let aiAssessmentId = null;
        if (window.AiScoringGate?.requestConsentAndConfirm) {
            const rawBlob = recordingBlob;
            const sampleRate = 16000;
            const durationSec = Math.max(1, Math.round(v3RecordedDurationSec || recordingSeconds || 40));
            const sampleCount = Math.max(16000, durationSec * sampleRate);
            let base64Audio = null;
            if (rawBlob && window.AiScoringGate.blobToBase64) {
                base64Audio = await window.AiScoringGate.blobToBase64(rawBlob).catch(() => null);
            }

            const gateResult = await window.AiScoringGate.requestConsentAndConfirm({
                mode: 'respond_to_situation',
                inputMeta: {
                    textResponse: safeTranscript,
                    sampleCount,
                    sampleRateHz: sampleRate,
                    audioBuffer: base64Audio
                },
                questionId: currentEntry?.id || null
            });

            if (!gateResult.allowed) {
                if (gateResult.cancelled) {
                    if (el.rtsAiScoreBtn) el.rtsAiScoreBtn.textContent = 'Submit to AI Scoring';
                    updateAiScoreButtonState();
                    return;
                }
                alert(gateResult.error || 'Scoring not authorized');
                if (el.rtsAiScoreBtn) el.rtsAiScoreBtn.textContent = 'Submit to AI Scoring';
                updateAiScoreButtonState();
                return;
            }
            aiAssessmentId = gateResult.assessmentId || null;
            if (aiAssessmentId && window.AiScoringGate.pollAssessmentResult) {
                window.AiScoringGate.pollAssessmentResult(aiAssessmentId)
                    .then(res => {
                        spokenAssessmentData = res;
                        const discEl = document.getElementById(v3Active ? 'rts-v3-transcript-disclosure' : 'rts-transcript-disclosure');
                        if (discEl && window.TranscriptDisclosure && res) {
                            new window.TranscriptDisclosure({ containerEl: discEl }).render(res);
                        }
                    })
                    .catch(err => console.warn('[RTS] Spoken assessment polling failed:', err));
            }
        }

        isAiScoring = true;
        if (el.rtsAiScoreBtn) {
            el.rtsAiScoreBtn.disabled = true;
            el.rtsAiScoreBtn.textContent = 'AI scoring...';
        }
        if (el.rtsAiScoreHint) el.rtsAiScoreHint.style.display = 'none';

        try {
            const callable = await getScoreRTSCallable();
            if (v3Active && (qGen !== questionGen || aGen !== attemptGen)) return;

            const result = await callable({
                transcript: safeTranscript.slice(0, 3000),
                situationText: String(currentEntry?.answer || '').slice(0, 2000),
                questionId: String(currentEntry?.id || '')
            });

            if (v3Active && (qGen !== questionGen || aGen !== attemptGen)) return;

            const data = result?.data || {};
            if (data?.limited) {
                alert(data.message || 'AI scoring is limited. Please try again later.');
                return;
            }
            if (!data?.success) {
                throw new Error(data?.message || 'AI scoring failed');
            }

            displayAiScoreResults(data);
            hasAiScoreResult = true;
            const savedArchiveAttemptId = await ensureArchiveAttemptId();
            if (savedArchiveAttemptId && (!v3Active || (qGen === questionGen && aGen === attemptGen))) {
                const numericScore = Number.isFinite(Number(data.overall?.total))
                    ? Number(data.overall.total)
                    : (Number.isFinite(Number(data.score)) ? Number(data.score) : null);
                window.PTEAttemptArchive?.patchAttempt?.(savedArchiveAttemptId, {
                    resultSnapshot: {
                        overall: data.overall || null,
                        scores: data.scores || null,
                        responseAnalysis: data.responseAnalysis || null,
                        teacherAdvice: data.teacherAdvice || null,
                        score: numericScore
                    },
                    responseSnapshot: {
                        transcript: safeTranscript,
                        spokenTranscript: spokenAssessmentData?.transcription?.rawTranscript || null,
                        transcriptSource: spokenAssessmentData ? 'server_asr' : 'browser_stt',
                        pronunciationAssessmentId: aiAssessmentId || null
                    },
                    scoringSnapshot: {
                        source: 'ai',
                        success: data.success === true,
                        teacherAdviceChat: data.teacherAdviceChat || null,
                        pronunciationAssessmentId: aiAssessmentId || null
                    }
                }).catch((error) => console.warn('[PTE Archive] RTS AI patch failed:', error));
            }
        } catch (error) {
            console.error('[RTS] scoreRTS failed:', error);
            if (!v3Active || (qGen === questionGen && aGen === attemptGen)) {
                alert('AI scoring failed. Please try again.');
            }
        } finally {
            if (!v3Active || (qGen === questionGen && aGen === attemptGen)) {
                isAiScoring = false;
                if (el.rtsAiScoreBtn) {
                    el.rtsAiScoreBtn.textContent = 'Submit to AI Scoring';
                }
                updateAiScoreButtonState();
            }
        }
    }

    function renderScoreRow(label, result, maxScore) {
        const score = typeof result?.score === 'number' ? result.score : -1;
        const isUnavailable = score < 0;
        const badgeClass = isUnavailable ? 'essay-score-na' :
            score === maxScore ? 'essay-score-full' :
                score > 0 ? 'essay-score-partial' : 'essay-score-zero';

        return `
            <div class="essay-score-row">
                <div class="essay-score-label">${label}</div>
                <div class="essay-score-badge ${badgeClass}">
                    ${isUnavailable ? 'N/A' : `${score}/${maxScore}`}
                </div>
                <div class="essay-score-detail">${escapeHtml(result?.detail || '')}</div>
            </div>
        `;
    }

    function displayAiScoreResults(data) {
        if (!el.rtsResultsContainer) return;

        const overall = data.overall || {};
        const total = Number(overall.total || 0);
        const maxTotal = Number(overall.maxTotal || 6);
        const percent = Number.isFinite(Number(overall.percent)) ? Number(overall.percent) : (maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0);

        const scores = data.scores && typeof data.scores === 'object' ? data.scores : {};
        const content = scores.content || {};

        // Build detail text from rationale + evidence + fixTips
        const detailParts = [];
        const rationale = content.rationale || '';
        if (rationale) detailParts.push(String(rationale));
        const fixTips = Array.isArray(content.fixTips) ? content.fixTips : [];
        if (fixTips.length > 0) detailParts.push('Fix: ' + fixTips.slice(0, 3).join(' | '));
        const evidence = Array.isArray(content.evidence) ? content.evidence : [];
        if (evidence.length > 0) detailParts.push('Evidence: ' + evidence.slice(0, 2).join('; '));

        const breakdownHtml = renderScoreRow('Content', {
            score: Number.isFinite(Number(content.score)) ? Number(content.score) : -1,
            detail: detailParts.join(' ')
        }, 6);

        // Response analysis section
        const analysis = data.responseAnalysis || {};
        const analysisHtml = buildAnalysisHtml(analysis);

        // Sample responses
        const hasValidSample = Boolean(data?.sampleResponse && (data.sampleResponse.full || data.sampleResponse.simplified));
        const sampleResponse = hasValidSample ? data.sampleResponse : currentEntry?.sampleResponse;
        const sampleHtml = buildSampleResponsesHtml(sampleResponse);

        // Teacher advice inline
        const teacherAdvice = String(data?.teacherAdvice || data?.teacherAdviceChat || '').trim();
        const teacherAdviceHtml = teacherAdvice ? `
            <details class="essay-basic-feedback" style="margin-top: 16px;">
                <summary>💡 Teacher Advice</summary>
                <div class="essay-basic-feedback-body" style="white-space: pre-line; line-height: 1.7; padding: 12px 16px;">${escapeHtml(teacherAdvice)}</div>
            </details>
        ` : '';

        el.rtsResultsContainer.innerHTML = `
            <div id="rts-transcript-disclosure" class="rts-transcript-disclosure" style="margin-bottom: 16px;"></div>
            <div class="essay-results-summary">
                <div class="essay-results-score-circle">
                    <span class="essay-score-number">${total}</span>
                    <span class="essay-score-divider">/</span>
                    <span class="essay-score-total">${maxTotal}</span>
                </div>
                <div class="essay-results-percentage">${percent}%</div>
            </div>

            <div class="essay-results-breakdown">
                ${breakdownHtml}
            </div>

            ${analysisHtml}
            ${sampleHtml}
            ${teacherAdviceHtml}
        `;

        if (spokenAssessmentData && window.TranscriptDisclosure) {
            const discEl = document.getElementById('rts-transcript-disclosure');
            if (discEl) new window.TranscriptDisclosure({ containerEl: discEl }).render(spokenAssessmentData);
        }

        // Init sample tabs
        initSampleResponseTabs();

        v3LastAiScoreData = data;
        const v3Results = document.getElementById('rts-v3-results-container');
        if (v3Results) {
            v3Results.innerHTML = el.rtsResultsContainer.innerHTML;
            const emptyEl = document.getElementById('rts-v3-ai-empty');
            if (emptyEl) emptyEl.style.display = 'none';
            v3Results.style.display = '';
        }
        if (data.sampleResponse) {
            const sampleFull = document.getElementById('rts-v3-sample-full');
            const sampleSimp = document.getElementById('rts-v3-sample-simplified');
            if (sampleFull && data.sampleResponse.full) sampleFull.innerHTML = escapeHtml(String(data.sampleResponse.full));
            if (sampleSimp && data.sampleResponse.simplified) sampleSimp.innerHTML = escapeHtml(String(data.sampleResponse.simplified));
        }
        setV3ActiveTab('ai');
    }

    function buildAnalysisHtml(analysis) {
        if (!analysis || (!analysis.register && !analysis.communicationGoal)) return '';

        const strengths = Array.isArray(analysis.strengthPoints) && analysis.strengthPoints.length > 0
            ? '<div style="margin-top:8px;"><strong>✅ Strengths:</strong><ul style="margin:4px 0 0 16px;">' +
              analysis.strengthPoints.map(s => `<li>${escapeHtml(s)}</li>`).join('') + '</ul></div>' : '';

        const improvements = Array.isArray(analysis.improvementAreas) && analysis.improvementAreas.length > 0
            ? '<div style="margin-top:8px;"><strong>🔧 Improve:</strong><ul style="margin:4px 0 0 16px;">' +
              analysis.improvementAreas.map(s => `<li>${escapeHtml(s)}</li>`).join('') + '</ul></div>' : '';

        return `
            <details class="essay-basic-feedback" style="margin-top: 16px;" open>
                <summary>📊 Response Analysis</summary>
                <div class="essay-basic-feedback-body" style="padding: 12px 16px; line-height: 1.7;">
                    ${analysis.register ? `<div><strong>Register:</strong> ${escapeHtml(analysis.register)}</div>` : ''}
                    ${analysis.communicationGoal ? `<div><strong>Goal:</strong> ${escapeHtml(analysis.communicationGoal)}</div>` : ''}
                    ${strengths}
                    ${improvements}
                </div>
            </details>
        `;
    }

    function buildSampleResponsesHtml(sampleResponse) {
        if (!sampleResponse) return '';
        const full = String(sampleResponse.full || '').trim();
        const simplified = String(sampleResponse.simplified || '').trim();
        if (!full && !simplified) return '';

        return `
            <div class="rts-sample-responses" style="margin-top: 16px; border: 1px solid var(--border-color, #e0e0e0); border-radius: 12px; overflow: hidden;">
                <div class="rts-sample-tabs" style="display: flex; border-bottom: 1px solid var(--border-color, #e0e0e0);">
                    <button class="rts-sample-tab active" data-tab="full" style="flex: 1; padding: 10px 16px; background: var(--bg-primary, #fff); border: none; cursor: pointer; font-weight: 600; font-size: 0.9rem; transition: background 0.2s;">📝 Full Sample</button>
                    <button class="rts-sample-tab" data-tab="simplified" style="flex: 1; padding: 10px 16px; background: var(--bg-secondary, #f8f9fa); border: none; cursor: pointer; font-weight: 500; font-size: 0.9rem; transition: background 0.2s;">📖 Simplified</button>
                </div>
                <div class="rts-sample-content" style="padding: 16px; line-height: 1.7; font-size: 0.95rem;">
                    <div class="rts-sample-pane" data-pane="full" style="">${escapeHtml(full)}</div>
                    <div class="rts-sample-pane" data-pane="simplified" style="display: none;">${escapeHtml(simplified)}</div>
                </div>
            </div>
        `;
    }

    function initSampleResponseTabs() {
        const container = el.rtsResultsContainer;
        if (!container) return;
        const tabs = container.querySelectorAll('.rts-sample-tab');
        const panes = container.querySelectorAll('.rts-sample-pane');
        if (!tabs.length || !panes.length) return;

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.getAttribute('data-tab');
                tabs.forEach(t => {
                    t.classList.toggle('active', t === tab);
                    t.style.background = t === tab ? 'var(--bg-primary, #fff)' : 'var(--bg-secondary, #f8f9fa)';
                    t.style.fontWeight = t === tab ? '600' : '500';
                });
                panes.forEach(p => {
                    p.style.display = p.getAttribute('data-pane') === target ? '' : 'none';
                });
            });
        });
    }

    /* ──────────────────────────── V3 SHELL INTEGRATION ──────────────────────────── */

    function toggleUserAudioPlayback() {
        const audioEl = (isV3() ? document.getElementById('rts-v3-playback') : el.rtsRecordingPlayback) || el.rtsRecordingPlayback;
        if (!audioEl) return;
        const playBtn = document.getElementById('rts-play-btn');
        if (audioEl.paused) {
            audioEl.play().then(() => {
                if (playBtn) playBtn.textContent = 'Pause';
            }).catch(() => {});
        } else {
            audioEl.pause();
            if (playBtn) playBtn.textContent = 'Play';
        }
    }

    function setV3ActiveTab(tabName) {
        v3ActiveTab = tabName || 'ai';
        const feedback = document.getElementById('rts-pte-feedback');
        if (!feedback) return;
        const aiTabBtn = feedback.querySelector('[data-v3-tab="ai"]');
        const sampleTabBtn = feedback.querySelector('[data-v3-tab="sample"]');
        const aiPanel = feedback.querySelector('#rts-v3-ai-panel');
        const samplePanel = feedback.querySelector('#rts-v3-sample-panel');

        if (v3ActiveTab === 'sample') {
            sampleTabBtn?.classList.add('active');
            sampleTabBtn?.setAttribute('aria-selected', 'true');
            aiTabBtn?.classList.remove('active');
            aiTabBtn?.setAttribute('aria-selected', 'false');
            if (aiPanel) aiPanel.style.display = 'none';
            if (samplePanel) samplePanel.style.display = '';
        } else {
            aiTabBtn?.classList.add('active');
            aiTabBtn?.setAttribute('aria-selected', 'true');
            sampleTabBtn?.classList.remove('active');
            sampleTabBtn?.setAttribute('aria-selected', 'false');
            if (aiPanel) aiPanel.style.display = '';
            if (samplePanel) samplePanel.style.display = 'none';
        }
    }

    function setV3SampleTab(sampleTabName) {
        v3ActiveSampleTab = sampleTabName || 'full';
        const feedback = document.getElementById('rts-pte-feedback');
        if (!feedback) return;
        const fullSampleBtn = feedback.querySelector('[data-v3-sample-tab="full"]');
        const simpSampleBtn = feedback.querySelector('[data-v3-sample-tab="simplified"]');
        const fullPane = feedback.querySelector('#rts-v3-sample-full');
        const simpPane = feedback.querySelector('#rts-v3-sample-simplified');

        if (v3ActiveSampleTab === 'simplified') {
            simpSampleBtn?.classList.add('active');
            fullSampleBtn?.classList.remove('active');
            if (fullPane) fullPane.style.display = 'none';
            if (simpPane) simpPane.style.display = '';
        } else {
            fullSampleBtn?.classList.add('active');
            simpSampleBtn?.classList.remove('active');
            if (fullPane) fullPane.style.display = '';
            if (simpPane) simpPane.style.display = 'none';
        }
    }

    function ensureV3Elements() {
        const area = document.getElementById('rts-practice-area');
        if (!area) return;

        if (!document.getElementById('rts-pte-instruction')) {
            const instr = document.createElement('div');
            instr.id = 'rts-pte-instruction';
            instr.className = 'rts-pte-instruction pte-instr';
            instr.textContent = 'Listen to and read a description of a situation. You will have 10 seconds to think about your answer. Then you will hear a beep. You will have 40 seconds to answer the question. Please answer as completely as you can.';
            area.insertBefore(instr, area.firstChild);
        }

        let stage = document.getElementById('rts-pte-stage');
        if (!stage) {
            stage = document.createElement('div');
            stage.id = 'rts-pte-stage';
            stage.className = 'rts-pte-stage';

            const promptText = document.createElement('div');
            promptText.id = 'rts-pte-prompt-text';
            promptText.className = 'rts-pte-prompt-text';

            const audioHost = document.createElement('div');
            audioHost.id = 'rts-pte-audio-host';

            const recHost = document.createElement('div');
            recHost.id = 'rts-pte-rec-host';

            stage.append(promptText, audioHost, recHost);
            area.appendChild(stage);
        }

        const promptText = document.getElementById('rts-pte-prompt-text');
        if (promptText && currentEntry) {
            promptText.textContent = currentEntry.answer || currentEntry.prompt || '';
        }

        let feedback = document.getElementById('rts-pte-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.id = 'rts-pte-feedback';
            feedback.className = 'rts-pte-feedback';
            feedback.hidden = true;
            feedback.style.display = 'none';

            feedback.innerHTML = `
                <div class="pte-fb rts-fb-grid">
                    <div class="pte-fb__left rts-fb-left">
                        <h4 class="rts-fb-heading">Your Recording</h4>
                        <audio id="rts-v3-playback" controls aria-label="Student recording" style="width: 100%;"></audio>
                        <h4 class="rts-fb-heading" style="margin-top: 12px;">Your Transcript</h4>
                        <div id="rts-v3-transcript" class="rts-v3-transcript" style="font-size: 1rem; line-height: 1.6; padding: 12px; background: var(--bg-secondary, #f8fafc); border-radius: 8px; border: 1px solid var(--border-light, #e2e8f0);">No transcript detected.</div>
                    </div>
                    <div class="pte-fb__right rts-fb-right">
                        <div class="rts-v3-fb-tabs" role="tablist">
                            <button type="button" class="rts-v3-fb-tab active" data-v3-tab="ai" role="tab" aria-selected="true">AI Score</button>
                            <button type="button" class="rts-v3-fb-tab" data-v3-tab="sample" role="tab" aria-selected="false">Sample Answers</button>
                        </div>
                        <div id="rts-v3-ai-panel" class="rts-v3-fb-panel">
                            <div id="rts-v3-ai-empty" class="rts-ai-empty">
                                <div class="rts-ai-empty-title">Not scored yet</div>
                                <div class="rts-ai-empty-desc">Submit your response to AI scoring for detailed feedback and analysis.</div>
                                <div id="rts-v3-ai-btn-host" style="display: flex; flex-direction: column; align-items: center; gap: 8px;"></div>
                            </div>
                            <div id="rts-v3-results-container" style="display: none;"></div>
                        </div>
                        <div id="rts-v3-sample-panel" class="rts-v3-fb-panel" style="display: none;">
                            <div class="rts-sample-tabs" style="display: flex; border-bottom: 1px solid var(--border-light, #e2e8f0); margin-bottom: 12px;">
                                <button type="button" class="rts-v3-fb-tab active" data-v3-sample-tab="full" style="flex: 1; text-align: center;">📝 Full Sample</button>
                                <button type="button" class="rts-v3-fb-tab" data-v3-sample-tab="simplified" style="flex: 1; text-align: center;">📖 Simplified</button>
                            </div>
                            <div id="rts-v3-sample-full" style="padding: 12px; line-height: 1.6; font-size: 0.95rem;">No sample answer available.</div>
                            <div id="rts-v3-sample-simplified" style="display: none; padding: 12px; line-height: 1.6; font-size: 0.95rem;">No simplified sample answer available.</div>
                        </div>
                    </div>
                </div>
            `;
            area.appendChild(feedback);

            // Wire tab switching
            const aiTabBtn = feedback.querySelector('[data-v3-tab="ai"]');
            const sampleTabBtn = feedback.querySelector('[data-v3-tab="sample"]');
            aiTabBtn?.addEventListener('click', () => setV3ActiveTab('ai'));
            sampleTabBtn?.addEventListener('click', () => setV3ActiveTab('sample'));

            const fullSampleBtn = feedback.querySelector('[data-v3-sample-tab="full"]');
            const simpSampleBtn = feedback.querySelector('[data-v3-sample-tab="simplified"]');
            fullSampleBtn?.addEventListener('click', () => setV3SampleTab('full'));
            simpSampleBtn?.addEventListener('click', () => setV3SampleTab('simplified'));

            // Wire playback events on rts-v3-playback
            const v3Playback = feedback.querySelector('#rts-v3-playback');
            if (v3Playback) {
                const syncPlayBtn = () => {
                    const playBtn = document.getElementById('rts-play-btn');
                    if (playBtn) playBtn.textContent = v3Playback.paused ? 'Play' : 'Pause';
                };
                v3Playback.addEventListener('play', syncPlayBtn);
                v3Playback.addEventListener('pause', syncPlayBtn);
                v3Playback.addEventListener('ended', syncPlayBtn);
            }
        }

        // Host AI score button & hint inside v3
        const aiHost = document.getElementById('rts-v3-ai-btn-host');
        if (aiHost && el.rtsAiScoreBtn && !aiHost.contains(el.rtsAiScoreBtn)) {
            if (!origAiScoreBtnParent) {
                origAiScoreBtnParent = el.rtsAiScoreBtn.parentNode;
                origAiScoreBtnSibling = el.rtsAiScoreBtn.nextSibling;
            }
            aiHost.appendChild(el.rtsAiScoreBtn);
        }
        if (aiHost && el.rtsAiScoreHint && !aiHost.contains(el.rtsAiScoreHint)) {
            if (!origAiScoreHintParent) {
                origAiScoreHintParent = el.rtsAiScoreHint.parentNode;
                origAiScoreHintSibling = el.rtsAiScoreHint.nextSibling;
            }
            aiHost.appendChild(el.rtsAiScoreHint);
        }

        const audioHost = document.getElementById('rts-pte-audio-host');
        if (audioHost && !pteAudioBox && el.rtsAudioPlayer && window.PteAudioBox) {
            pteAudioBox = window.PteAudioBox.create(audioHost, { audio: el.rtsAudioPlayer });
        }

        const recHost = document.getElementById('rts-pte-rec-host');
        if (recHost && !pteRecorderWidget && window.PteRecorderWidget) {
            pteRecorderWidget = window.PteRecorderWidget.create(recHost, { totalSeconds: RECORD_SECONDS });
        }

        ['rts-record-btn', 'rts-cancel-btn', 'rts-play-btn', 'rts-submit-btn', 'rts-redo-btn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.style.display = '';
        });
    }

    function mountPteShell() {
        v3Active = true;
        const modePanel = document.getElementById('mode-rts');
        if (modePanel) modePanel.classList.add('rts-pte-v3');
        ensureV3Elements();
        if (currentEntry) {
            const promptEl = document.getElementById('rts-pte-prompt-text');
            if (promptEl) promptEl.textContent = currentEntry.answer || currentEntry.prompt || '';
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
        const modePanel = document.getElementById('mode-rts');
        if (modePanel) modePanel.classList.remove('rts-pte-v3');
        stopAllV3Timers();
        if (pteAudioBox) {
            pteAudioBox.destroy();
            pteAudioBox = null;
        }
        if (pteRecorderWidget) {
            pteRecorderWidget.destroy();
            pteRecorderWidget = null;
        }

        // Restore AI score button & hint
        if (el.rtsAiScoreBtn && origAiScoreBtnParent) {
            if (origAiScoreBtnSibling && origAiScoreBtnParent.contains(origAiScoreBtnSibling)) {
                origAiScoreBtnParent.insertBefore(el.rtsAiScoreBtn, origAiScoreBtnSibling);
            } else {
                origAiScoreBtnParent.appendChild(el.rtsAiScoreBtn);
            }
        }
        if (el.rtsAiScoreHint && origAiScoreHintParent) {
            if (origAiScoreHintSibling && origAiScoreHintParent.contains(origAiScoreHintSibling)) {
                origAiScoreHintParent.insertBefore(el.rtsAiScoreHint, origAiScoreHintSibling);
            } else {
                origAiScoreHintParent.appendChild(el.rtsAiScoreHint);
            }
        }

        document.getElementById('rts-pte-instruction')?.remove();
        document.getElementById('rts-pte-stage')?.remove();
        document.getElementById('rts-pte-feedback')?.remove();
        reset();
    }

    function syncPteShell() {
        if (!v3Active) return;
        window.SpeakingPracticeController?.setPhase?.('rts', v3Phase);
        syncPteV3UI();
    }

    function syncPteV3UI() {
        if (!isV3()) return;
        const stage = document.getElementById('rts-pte-stage');
        const feedback = document.getElementById('rts-pte-feedback');
        const practiceArea = document.getElementById('rts-practice-area');
        if (practiceArea) practiceArea.style.display = 'block';

        if (v3Phase === 'feedback') {
            if (stage) { stage.hidden = true; stage.style.display = 'none'; }
            if (feedback) { feedback.hidden = false; feedback.style.display = 'flex'; }
            renderV3Feedback();
        } else {
            if (stage) { stage.hidden = false; stage.style.display = 'flex'; }
            if (feedback) { feedback.hidden = true; feedback.style.display = 'none'; }
        }
    }

    async function startV3QuestionFlow() {
        if (!v3Active || !currentEntry) return;
        stopAllTimers();
        stopAllV3Timers();
        stopSpeechRecognition();
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

        const recHost = document.getElementById('rts-pte-rec-host');
        if (recHost) recHost.style.display = 'none';
        pteRecorderWidget?.reset?.();

        ensureV3Elements();
        pteAudioBox?.reset?.();

        const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
        const cdSec = scale < 1 ? 1 : AUDIO_COUNTDOWN_SECONDS;

        try {
            if (pteAudioBox) {
                await pteAudioBox.countdown(cdSec);
            }
        } catch (err) {
            if (err?.name === 'AbortError' || qGen !== questionGen || aGen !== attemptGen) return;
        }
        if (qGen !== questionGen || aGen !== attemptGen || !v3Active) {
            return;
        }

        try {
            if (pteAudioBox) {
                await pteAudioBox.play();
            }
        } catch (err) {
            if (err?.name === 'AbortError' || qGen !== questionGen || aGen !== attemptGen) return;
            console.warn('[RTS v3] Prompt audio play blocked or error:', err);
        }
        if (qGen !== questionGen || aGen !== attemptGen || !v3Active) {
            return;
        }

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

        hasAiScoreResult = false;
        v3LastAiScoreData = null;
        isAiScoring = false;
        archiveAttemptId = null;
        archiveSavePromise = null;
        v3RecordedDurationSec = 0;
        transcriptText = '';
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        dspPromise = null;
        v3ActiveTab = 'ai';
        v3ActiveSampleTab = 'full';

        const recHost = document.getElementById('rts-pte-rec-host');
        if (recHost) recHost.style.display = '';

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

        const recHost = document.getElementById('rts-pte-rec-host');
        if (recHost) recHost.style.display = '';

        recordingSessionToken++;
        const myToken = recordingSessionToken;
        recordedChunks = [];
        transcriptText = '';
        v3RecordedDurationSec = 0;
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        dspPromise = null;
        hasAiScoreResult = false;
        v3LastAiScoreData = null;
        isAiScoring = false;
        archiveAttemptId = null;
        archiveSavePromise = null;

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.error('[RTS v3] Mic access denied:', err);
            return;
        }

        if (qGen !== questionGen || aGen !== attemptGen || v3Phase !== 'recording' || !v3Active || myToken !== recordingSessionToken) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        activeMediaStream = stream;
        pteRecorderWidget?.showRecording(RECORD_SECONDS);
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

    function cancelRecording() {
        if (v3Phase !== 'recording') return;
        stopAllTimers();
        stopAllV3Timers();
        stopSpeechRecognition();
        stopMediaStream();
        recordingSessionToken++;
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try { mediaRecorder.stop(); } catch (_) {}
        }
        mediaRecorder = null;
        recordedChunks = [];
        recordingBlob = null;
        dspPromise = null;
        hasAiScoreResult = false;
        v3LastAiScoreData = null;
        isAiScoring = false;
        archiveAttemptId = null;
        archiveSavePromise = null;
        v3RecordedDurationSec = 0;
        startV3Prep();
    }

    function stopV3Recording() {
        if (v3Phase !== 'recording') return;
        stopAllTimers();
        stopAllV3Timers();
        stopSpeechRecognition();
        v3Phase = 'complete';
        syncPteShell();
        pteRecorderWidget?.showComplete();
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch (_) {}
        }
    }

    function onV3RecordingComplete() {
        if (recordedChunks.length === 0) {
            recordingBlob = null;
            dspPromise = Promise.resolve(null);
            return;
        }
        const blob = new Blob(recordedChunks, { type: recordedChunks[0].type || 'audio/webm' });
        recordingBlob = blob;
        recordingBlobUrl = URL.createObjectURL(blob);

        const currentToken = recordingSessionToken;
        dspPromise = (window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function')
            ? window.AudioDspPipeline.enhance(blob).then((result) => {
                if (currentToken !== recordingSessionToken) return blob;
                if (result && result.wavBlob) {
                    if (recordingBlobUrl) URL.revokeObjectURL(recordingBlobUrl);
                    recordingBlob = result.wavBlob;
                    recordingBlobUrl = result.audioUrl || URL.createObjectURL(result.wavBlob);
                    const v3Playback = document.getElementById('rts-v3-playback');
                    if (v3Playback) v3Playback.src = recordingBlobUrl;
                    return result.wavBlob;
                }
                return blob;
            }).catch((err) => {
                console.warn('[RTS] AudioDspPipeline enhancement failed, keeping raw audio:', err);
                return blob;
            })
            : Promise.resolve(blob);
    }

    async function submitForFeedback() {
        if (v3Phase !== 'complete') return;
        const qGen = questionGen;
        const aGen = attemptGen;

        v3Phase = 'feedback';
        v3ActiveTab = 'ai';
        v3ActiveSampleTab = 'full';
        syncPteShell();

        archiveAttemptId = null;
        archiveSavePromise = null;
        const currentToken = recordingSessionToken;

        rememberArchiveSave((async () => {
            const finalBlob = dspPromise ? await dspPromise.catch(() => recordingBlob) : recordingBlob;
            if (currentToken !== recordingSessionToken || qGen !== questionGen || aGen !== attemptGen) return null;
            return window.PTEAttemptArchive?.saveAttempt?.({
                practiceMode: 'rts',
                promptSnapshot: {
                    promptId: currentEntry?.id || null,
                    title: currentEntry?.title || '',
                    text: currentEntry?.answer || currentEntry?.prompt || '',
                    sourceAssetPaths: [currentEntry?.audioPath || currentEntry?.audio || currentEntry?.mediaPath].filter(Boolean),
                    data: currentEntry || null
                },
                responseSnapshot: {
                    transcript: transcriptText || ''
                },
                answerSnapshot: {
                    sampleResponse: currentEntry?.sampleResponse || currentEntry?.sampleResponses || null
                },
                resultSnapshot: {
                    submitted: true,
                    hasAudio: !!finalBlob
                },
                scoringSource: 'client',
                media: finalBlob ? [{
                    slot: 'student',
                    label: 'Student response',
                    blob: finalBlob,
                    contentType: finalBlob.type || 'audio/webm'
                }] : []
            });
        })());

        renderV3Feedback();
    }

    function renderV3Feedback() {
        const feedback = document.getElementById('rts-pte-feedback');
        if (!feedback) return;

        setV3ActiveTab(v3ActiveTab || 'ai');
        setV3SampleTab(v3ActiveSampleTab || 'full');

        const v3Playback = document.getElementById('rts-v3-playback');
        if (v3Playback) {
            if (recordingBlobUrl) {
                v3Playback.src = recordingBlobUrl;
            } else if (recordingBlob) {
                recordingBlobUrl = URL.createObjectURL(recordingBlob);
                v3Playback.src = recordingBlobUrl;
            } else {
                v3Playback.removeAttribute('src');
            }
        }

        const v3Transcript = document.getElementById('rts-v3-transcript');
        if (v3Transcript) {
            const text = String(transcriptText || '').trim();
            v3Transcript.textContent = text || 'No transcript detected.';
            v3Transcript.classList.toggle('rts-no-transcript', !text);
        }

        // Sample answers
        const sampleFull = document.getElementById('rts-v3-sample-full');
        const sampleSimp = document.getElementById('rts-v3-sample-simplified');
        const sampleResponse = v3LastAiScoreData?.sampleResponse || currentEntry?.sampleResponse || currentEntry?.sampleResponses || null;
        if (sampleResponse && (sampleResponse.full || sampleResponse.simplified)) {
            if (sampleFull) sampleFull.innerHTML = escapeHtml(String(sampleResponse.full || 'No full sample available.'));
            if (sampleSimp) sampleSimp.innerHTML = escapeHtml(String(sampleResponse.simplified || 'No simplified sample available.'));
        } else {
            if (sampleFull) sampleFull.textContent = 'Sample answers will be available once AI scoring is complete.';
            if (sampleSimp) sampleSimp.textContent = 'Sample answers will be available once AI scoring is complete.';
        }

        // AI Score state
        const emptyEl = document.getElementById('rts-v3-ai-empty');
        const resultsEl = document.getElementById('rts-v3-results-container');
        if (hasAiScoreResult && v3LastAiScoreData) {
            if (emptyEl) emptyEl.style.display = 'none';
            if (resultsEl) {
                resultsEl.style.display = '';
                renderV3AiScoreResults(v3LastAiScoreData);
            }
        } else {
            if (emptyEl) emptyEl.style.display = '';
            if (resultsEl) {
                resultsEl.style.display = 'none';
                resultsEl.innerHTML = '';
            }
            updateAiScoreButtonState();
        }
    }

    function renderV3AiScoreResults(data) {
        const container = document.getElementById('rts-v3-results-container');
        if (!container) return;

        const overall = data.overall || {};
        const total = Number(overall.total || 0);
        const maxTotal = Number(overall.maxTotal || 6);
        const percent = Number.isFinite(Number(overall.percent)) ? Number(overall.percent) : (maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0);

        const scores = data.scores && typeof data.scores === 'object' ? data.scores : {};
        const content = scores.content || {};

        const detailParts = [];
        const rationale = content.rationale || '';
        if (rationale) detailParts.push(String(rationale));
        const fixTips = Array.isArray(content.fixTips) ? content.fixTips : [];
        if (fixTips.length > 0) detailParts.push('Fix: ' + fixTips.slice(0, 3).join(' | '));
        const evidence = Array.isArray(content.evidence) ? content.evidence : [];
        if (evidence.length > 0) detailParts.push('Evidence: ' + evidence.slice(0, 2).join('; '));

        const breakdownHtml = renderScoreRow('Content', {
            score: Number.isFinite(Number(content.score)) ? Number(content.score) : -1,
            detail: detailParts.join(' ')
        }, 6);

        const analysis = data.responseAnalysis || {};
        const analysisHtml = buildAnalysisHtml(analysis);

        const teacherAdvice = String(data?.teacherAdvice || data?.teacherAdviceChat || '').trim();
        const teacherAdviceHtml = teacherAdvice ? `
            <details class="essay-basic-feedback" style="margin-top: 16px;">
                <summary>💡 Teacher Advice</summary>
                <div class="essay-basic-feedback-body" style="white-space: pre-line; line-height: 1.7; padding: 12px 16px;">${escapeHtml(teacherAdvice)}</div>
            </details>
        ` : '';

        container.innerHTML = `
            <div id="rts-v3-transcript-disclosure" class="rts-v3-transcript-disclosure" style="margin-bottom: 16px;"></div>
            <div class="essay-results-summary">
                <div class="essay-results-score-circle">
                    <span class="essay-score-number">${total}</span>
                    <span class="essay-score-divider">/</span>
                    <span class="essay-score-total">${maxTotal}</span>
                </div>
                <div class="essay-results-percentage">${percent}%</div>
            </div>
            <div class="essay-results-breakdown">
                ${breakdownHtml}
            </div>
            ${analysisHtml}
            ${teacherAdviceHtml}
        `;

        if (spokenAssessmentData && window.TranscriptDisclosure) {
            const discEl = document.getElementById('rts-v3-transcript-disclosure');
            if (discEl) new window.TranscriptDisclosure({ containerEl: discEl }).render(spokenAssessmentData);
        }
    }

    async function finishRecordingForNext() {
        stopAllTimers();
        stopAllV3Timers();
        stopMediaStream();
        const qGen = questionGen;
        const aGen = ++attemptGen;
        stopSpeechRecognition();
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try { mediaRecorder.stop(); } catch (_) {}
        }
        mediaRecorder = null;
        const finalBlob = dspPromise ? await dspPromise.catch(() => recordingBlob) : recordingBlob;
        if (qGen !== questionGen || aGen !== attemptGen) return;
        if (currentEntry) {
            try {
                await window.PTEAttemptArchive?.saveAttempt?.({
                    practiceMode: 'rts',
                    promptSnapshot: {
                        promptId: currentEntry.id || null,
                        title: currentEntry.title || '',
                        text: currentEntry.answer || currentEntry.prompt || '',
                        sourceAssetPaths: [currentEntry.audioPath || currentEntry.audio || currentEntry.mediaPath].filter(Boolean),
                        data: currentEntry
                    },
                    responseSnapshot: { transcript: transcriptText || '' },
                    answerSnapshot: { sampleResponse: currentEntry.sampleResponse || null },
                    resultSnapshot: { submitted: true, score: null },
                    scoringSource: 'client',
                    media: finalBlob ? [{
                        slot: 'student',
                        label: 'Student response',
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
        loadQuestion(nextIndex);
    }

    /* ──────────────────────────── LIFECYCLE ──────────────────────────── */

    function onEnter() {
        init();
        if (entries.length > 0 && !currentEntry) {
            loadQuestion(0);
        } else if (currentEntry && window.PracticeRouter) {
            window.PracticeRouter.replaceRoute('rts', currentEntry.id);
        }
        renderPicker();
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
        closePicker();
        if (isV3()) {
            stopAllV3Timers();
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

    /* ──────────────────────────── EXPORT ──────────────────────────── */

    window.RTSMode = {
        onEnter,
        onExit,
        getItems,
        getCurrentId: () => (currentEntry ? String(currentEntry.id) : null),
        select,
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

    Object.defineProperty(window.RTSMode, 'isRecording', {
        get: () => (isV3() ? v3Phase === 'recording' : currentStep === 'recording'),
        configurable: true
    });
    Object.defineProperty(window.RTSMode, 'currentId', {
        get: () => (currentEntry ? String(currentEntry.id) : null),
        configurable: true
    });

    // Deep-link support: listen for PracticeRouter question navigation events
    window.addEventListener('practice-route-question', (event) => {
        const { mode, questionId } = event.detail || {};
        if (mode !== 'rts' || !questionId) return;
        const idx = entries.findIndex((e) => String(e.id) === String(questionId));
        if (idx >= 0) {
            loadQuestion(idx);
        }
    });
})();
