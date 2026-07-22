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
    let recordedChunks = [];
    let recordingBlobUrl = null;
    let recordingBlob = null;
    let recordingSessionToken = 0;
    let archiveAttemptId = null;
    let archiveSavePromise = null;

    // AI scoring state
    let scoreRTSFn = null;
    let isAiScoring = false;
    let hasAiScoreResult = false;

    // Speech recognition
    let speechRecognition = null;
    let transcriptText = '';

    // Current step
    let currentStep = 'idle'; // idle | audio | prep | recording | results

    // DOM cache
    const el = {};

    /* ──────────────────────────── HELPERS ──────────────────────────── */

    function show(e) { if (e) e.style.display = ''; }
    function hide(e) { if (e) e.style.display = 'none'; }
    function setTranscriptDisplay(value) {
        const text = String(value || '').trim();
        if (!el.rtsTranscript) return;
        el.rtsTranscript.textContent = text || 'No transcript detected.';
        el.rtsTranscript.classList.toggle('rts-no-transcript', !text);
    }
    function getTranscriptForScoring() {
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
        stopRecording(true);
        currentStep = 'idle';
        transcriptText = '';
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
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
        // Stop audio player
        if (el.rtsAudioPlayer) {
            try {
                el.rtsAudioPlayer.pause();
                el.rtsAudioPlayer.currentTime = 0;
            } catch (_) { /* ignore */ }
        }
        setTranscriptDisplay('');
        if (el.rtsRecordTimer) el.rtsRecordTimer.classList.remove('rts-timer-warning');
        if (el.rtsRecordStatus) el.rtsRecordStatus.classList.remove('rts-recording-active');
        // Reset AI scoring state
        isAiScoring = false;
        hasAiScoreResult = false;
        if (el.rtsResultsContainer) el.rtsResultsContainer.innerHTML = '';
        if (el.rtsAiScoreBtn) {
            el.rtsAiScoreBtn.disabled = false;
            el.rtsAiScoreBtn.style.display = '';
            el.rtsAiScoreBtn.textContent = 'Submit to AI Scoring';
        }
        if (el.rtsAiScoreHint) { el.rtsAiScoreHint.style.display = 'none'; el.rtsAiScoreHint.innerHTML = ''; }
        hide(el.rtsPracticeArea);
        hide(el.rtsStepAudio);
        hide(el.rtsStepPrep);
        hide(el.rtsStepRecord);
        hide(el.rtsStepResults);
        updateProgressBreadcrumb('idle');
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
            el.rtsAudioPlayer.src = `${RTS_AUDIO_DIR}RTS_${currentEntry.id}.mp3`;
            el.rtsAudioPlayer.load();
        }

        // Show start button
        show(el.playRtsBtn);
        window.SpeakingPracticeController?.sync?.('rts');
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
        if (el.rtsStopBtn) el.rtsStopBtn.addEventListener('click', () => stopRecording(false));

        // Results buttons
        if (el.rtsRetryBtn) el.rtsRetryBtn.addEventListener('click', () => {
            if (currentEntry) loadQuestion(currentEntryIndex);
        });
        if (el.rtsNextQuestionBtn) el.rtsNextQuestionBtn.addEventListener('click', () => {
            if (currentEntryIndex < entries.length - 1) {
                loadQuestion(currentEntryIndex + 1);
            }
        });

        // AI scoring
        if (el.rtsAiScoreBtn) el.rtsAiScoreBtn.addEventListener('click', submitToAiScoring);

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
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
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
            showResults(null);
            return;
        }
        const blob = new Blob(recordedChunks, { type: recordedChunks[0].type || 'audio/webm' });
        recordingBlob = blob;
        recordingBlobUrl = URL.createObjectURL(blob);
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

        // Clear previous AI results
        hasAiScoreResult = false;
        if (el.rtsResultsContainer) el.rtsResultsContainer.innerHTML = '';
        if (el.rtsAiScoreBtn) {
            el.rtsAiScoreBtn.style.display = '';
            el.rtsAiScoreBtn.textContent = 'Submit to AI Scoring';
        }

        // Update AI score button state
        updateAiScoreButtonState();

        archiveAttemptId = null;
        archiveSavePromise = null;
        rememberArchiveSave(window.PTEAttemptArchive?.saveAttempt?.({
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
                hasAudio: !!recordingBlob
            },
            scoringSource: 'client',
            media: recordingBlob ? [{
                slot: 'student',
                label: 'Student response',
                blob: recordingBlob,
                contentType: recordingBlob.type || 'audio/webm'
            }] : []
        }));
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

        isAiScoring = true;
        if (el.rtsAiScoreBtn) {
            el.rtsAiScoreBtn.disabled = true;
            el.rtsAiScoreBtn.textContent = 'AI scoring...';
        }
        if (el.rtsAiScoreHint) el.rtsAiScoreHint.style.display = 'none';

        try {
            const callable = await getScoreRTSCallable();
            const result = await callable({
                transcript: safeTranscript.slice(0, 3000),
                situationText: String(currentEntry?.answer || '').slice(0, 2000),
                questionId: String(currentEntry?.id || '')
            });

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
            if (savedArchiveAttemptId) {
                window.PTEAttemptArchive?.patchAttempt?.(savedArchiveAttemptId, {
                    resultSnapshot: {
                        overall: data.overall || null,
                        scores: data.scores || null,
                        responseAnalysis: data.responseAnalysis || null,
                        teacherAdvice: data.teacherAdvice || null
                    },
                    scoringSnapshot: {
                        source: 'ai',
                        success: data.success === true,
                        teacherAdviceChat: data.teacherAdviceChat || null
                    }
                }).catch((error) => console.warn('[PTE Archive] RTS AI patch failed:', error));
            }
        } catch (error) {
            console.error('[RTS] scoreRTS failed:', error);
            alert('AI scoring failed. Please try again.');
        } finally {
            isAiScoring = false;
            if (el.rtsAiScoreBtn) {
                el.rtsAiScoreBtn.textContent = 'Submit to AI Scoring';
            }
            updateAiScoreButtonState();
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
        const sampleHtml = buildSampleResponsesHtml(data.sampleResponse);

        // Teacher advice inline
        const teacherAdvice = String(data?.teacherAdvice || data?.teacherAdviceChat || '').trim();
        const teacherAdviceHtml = teacherAdvice ? `
            <details class="essay-basic-feedback" style="margin-top: 16px;">
                <summary>💡 Teacher Advice</summary>
                <div class="essay-basic-feedback-body" style="white-space: pre-line; line-height: 1.7; padding: 12px 16px;">${escapeHtml(teacherAdvice)}</div>
            </details>
        ` : '';

        el.rtsResultsContainer.innerHTML = `
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

        // Init sample tabs
        initSampleResponseTabs();
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

    /* ──────────────────────────── LIFECYCLE ──────────────────────────── */

    function onEnter() {
        init();
        // If we have entries, ensure current question is loaded
        if (entries.length > 0 && !currentEntry) {
            loadQuestion(0);
        }
        renderPicker();
    }

    function onExit() {
        reset();
        closePicker();
    }

    /* ──────────────────────────── EXPORT ──────────────────────────── */

    window.RTSMode = { onEnter, onExit, getItems, getCurrentId, select };
})();
