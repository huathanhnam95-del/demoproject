/**
 * Describe Image Mode Module (PTE Practice → Speaking)
 * Flow: Select question → Play → Prepare (25s) → Record (40s) → Review → Results + AI
 */
(function () {
    'use strict';

    const DI_JSON_PATH = '/database/Describe Image/describe-image-questions.json';
    const DI_IMAGE_DIR = '/database/Describe Image/DI/';
    const PREP_SECONDS = 25;
    const RECORD_SECONDS = 40;

    // State
    let entries = [];
    let filteredEntries = [];
    let currentEntryIndex = 0;
    let currentEntry = null;
    let isInitialized = false;
    let hasLoadedEntries = false;
    let loadEntriesPromise = null;

    // Timer state (drift-free via performance.now)
    let prepStartTime = null;
    let prepRAF = null;
    let recordStartTime = null;
    let recordRAF = null;

    // Recording state
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordingBlobUrl = null;
    let recordingBlob = null;
    let originalRecordingBlob = null;
    let lastV3Playback = null;
    let recordingSessionToken = 0;

    // Speech recognition
    let speechRecognition = null;
    let transcriptText = '';

    // Current step
    let currentStep = 'idle'; // idle | preparing | recording | review | results

    // v3 State
    let v3Active = false;
    let v3Phase = 'loading'; // loading | prep | recording | complete | feedback
    let questionGen = 0;
    let attemptGen = 0;
    let recordedDurationSec = 0;
    let currentDifficultyFilter = 'all';
    let pteRecorderWidget = null;
    let zoomLastFocused = null;
    let v3StageEl = null;
    let v3FeedbackEl = null;
    let v3InstructionEl = null;
    let v3OriginalContainers = new Map();

    function isV3() {
        return !!(v3Active || window.PteShellConfig?.isModeEnabled?.('describe-image', 'pte'));
    }

    // DOM cache
    const el = {};

    /* ──────────────────────────── HELPERS ──────────────────────────── */

    // Show by clearing inline display so CSS (grid/flex) can apply.
    function show(e) { if (e) e.style.display = ''; }
    function hide(e) { if (e) e.style.display = 'none'; }
    function fmt(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    /* ──────────────────────────── INIT ──────────────────────────── */

    function cacheElements() {
        const ids = [
            'question-select-di', 'current-question-id-di', 'back-btn-di', 'next-btn-di',
            'play-di-btn', 'di-practice-area', 'di-step-progress',
            'di-step-prepare', 'di-step-record', 'di-step-review', 'di-step-results',
            'di-image', 'di-image-record', 'di-image-container', 'di-preview-img',
            'di-prep-timer', 'di-prep-bar-fill', 'di-record-timer', 'di-record-bar-fill',
            'di-record-status', 'di-record-status-text', 'di-stop-btn',
            'di-recording-playback', 'di-transcript',
            'di-retry-btn', 'di-submit-btn',
            'di-sample-answer', 'di-key-points',
            'di-ai-btn', 'di-results-retry-btn', 'di-next-question-btn',
            'di-zoom-overlay', 'di-zoom-image', 'di-zoom-close', 'di-zoom-btn', 'di-image-preview',
            'difficulty-filter-btn-di', 'difficulty-filter-menu-di', 'difficulty-filter-label-di',
            'difficulty-filter-container-di',
            'recommended-btn-di', 'recommendation-summary-di'
        ];
        ids.forEach(id => {
            const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            el[key] = document.getElementById(id);
        });
        ensureLoadStatusUi();
    }

    function ensureLoadStatusUi() {
        if (!el.questionSelectDi) return;
        const selector = el.questionSelectDi.closest('.question-selector');
        if (!selector) return;
        const existing = document.getElementById('di-load-status');
        if (existing) {
            el.diLoadStatus = existing;
            el.diLoadStatusText = existing.querySelector('#di-load-status-text');
            el.diLoadRetryBtn = existing.querySelector('#di-load-retry-btn');
            return;
        }

        const status = document.createElement('div');
        status.id = 'di-load-status';
        status.className = 'di-load-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        status.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;margin-top:8px;min-height:24px;color:#475569;';

        const text = document.createElement('span');
        text.id = 'di-load-status-text';

        const retry = document.createElement('button');
        retry.id = 'di-load-retry-btn';
        retry.className = 'modern-btn modern-btn--compact';
        retry.type = 'button';
        retry.textContent = 'Retry loading images';
        retry.hidden = true;
        retry.setAttribute('aria-describedby', 'di-load-status-text');

        status.append(text, retry);
        const navRow = selector.querySelector('.question-nav-row');
        if (navRow) navRow.insertAdjacentElement('afterend', status);
        else selector.appendChild(status);
        el.diLoadStatus = status;
        el.diLoadStatusText = text;
        el.diLoadRetryBtn = retry;
    }

    function setLoadStatus(state, message, canRetry) {
        if (!el.diLoadStatus || !el.diLoadStatusText || !el.diLoadRetryBtn) return;
        el.diLoadStatus.hidden = !message;
        el.diLoadStatus.dataset.state = state || '';
        el.diLoadStatusText.textContent = message || '';
        el.diLoadRetryBtn.hidden = !canRetry;
        el.diLoadStatus.style.color = state === 'error' ? '#b91c1c' : '#475569';
        el.diLoadStatus.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    }

    function init() {
        if (isInitialized) return;
        cacheElements();
        if (!el.questionSelectDi) {
            console.warn('[DI] UI elements not found, skipping init');
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
        recordedDurationSec = 0;
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordedChunks = [];
        recordingBlob = null;
        originalRecordingBlob = null;
        lastV3Playback = null;
        if (el.diRecordingPlayback) {
            try {
                el.diRecordingPlayback.pause();
                el.diRecordingPlayback.removeAttribute('src');
                el.diRecordingPlayback.load();
            } catch (_) { /* ignore */ }
        }
        if (el.diTranscript) el.diTranscript.textContent = 'No transcript detected.';
        if (el.diRecordTimer) el.diRecordTimer.classList.remove('di-timer-warning');
        if (el.diRecordStatus) el.diRecordStatus.classList.remove('di-recording-active');
        if (!isV3()) {
            hide(el.diPracticeArea);
            hide(el.diStepPrepare);
            hide(el.diStepRecord);
            hide(el.diStepReview);
            hide(el.diStepResults);
            updateProgressBreadcrumb('idle');
            // Restore the persistent image preview
            if (el.diImagePreview) el.diImagePreview.style.display = '';
        }
        closeZoom();
    }

    /* ──────────────────────────── DATA LOADING ──────────────────────────── */

    function loadEntries() {
        if (loadEntriesPromise) return loadEntriesPromise;
        if (el.playDiBtn) el.playDiBtn.disabled = true;
        setLoadStatus('loading', 'Loading image questions…', false);
        loadEntriesPromise = (async () => {
            try {
                const resp = await fetch(DI_JSON_PATH);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                const nextEntries = Array.isArray(data) ? data : data?.questions;
                if (!Array.isArray(nextEntries)) throw new Error('Invalid Describe Image question data');
                entries = nextEntries;
            } catch (err) {
                console.warn('[DI] JSON load failed, using empty set:', err.message);
                entries = [];
                filteredEntries = [];
                currentEntry = null;
                currentEntryIndex = 0;
                hasLoadedEntries = false;
                populateQuestionSelect();
                if (el.currentQuestionIdDi) el.currentQuestionIdDi.textContent = '—';
                if (el.playDiBtn) el.playDiBtn.disabled = true;
                hide(el.diPracticeArea);
                setLoadStatus('error', 'Unable to load Describe Image questions. Check your connection and retry.', true);
                return;
            }
            hasLoadedEntries = entries.length > 0;
            filteredEntries = [...entries];
            populateQuestionSelect();
            if (filteredEntries.length > 0) {
                currentEntryIndex = 0;
                currentEntry = filteredEntries[0];
                updateQuestionDisplay();
                if (el.playDiBtn) el.playDiBtn.disabled = false;
                setLoadStatus('success', '', false);
            } else {
                currentEntry = null;
                currentEntryIndex = 0;
                if (el.currentQuestionIdDi) el.currentQuestionIdDi.textContent = '—';
                if (el.playDiBtn) el.playDiBtn.disabled = true;
                hide(el.diPracticeArea);
                setLoadStatus('empty', 'No Describe Image questions are available right now.', true);
            }
        })().finally(() => {
            loadEntriesPromise = null;
        });
        return loadEntriesPromise;
    }

    function populateQuestionSelect() {
        if (!el.questionSelectDi) return;
        el.questionSelectDi.innerHTML = '';
        filteredEntries.forEach((entry, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `#${entry.id} - ${entry.title || 'Untitled'}`;
            el.questionSelectDi.appendChild(opt);
        });
    }

    function getImageSrc(entry) {
        if (!entry) return '';
        const imgFile = entry.imageFile || `${entry.id}.png`;
        return DI_IMAGE_DIR + imgFile;
    }

    function getImageFallbackSrc(entry) {
        if (!entry) return '';
        return DI_IMAGE_DIR + entry.id + '.jpg';
    }

    // The picture is the question. While it loads its space is kept; if it cannot load the
    // learner is told and can try again - it used to collapse to an alt-text strip that still
    // offered a zoom button. CSS keys off data-image-state.
    function setImageState(imgEl, state) {
        const container = imgEl?.closest('.di-image-container');
        if (!container) return;
        container.dataset.imageState = state;
        if (state !== 'error' || container.querySelector('.di-image-error')) return;
        const note = document.createElement('div');
        note.className = 'di-image-error';
        note.setAttribute('role', 'status');
        note.innerHTML = '<p>This picture didn\u2019t load.</p><button type="button" class="pte-btn">Try again</button>';
        note.querySelector('button').addEventListener('click', (event) => {
            event.stopPropagation();
            if (currentEntry) setImageWithFallback(imgEl, currentEntry);
        });
        container.appendChild(note);
    }

    function setImageWithFallback(imgEl, entry) {
        if (!imgEl || !entry) return;
        const primarySrc = getImageSrc(entry);
        const fallbackSrc = getImageFallbackSrc(entry);
        setImageState(imgEl, 'loading');
        // Setting the src an image already shows fires no load event (the feedback thumbnail
        // reuses the stage picture), so an already-loaded picture is marked ready directly.
        const markIfLoaded = () => {
            if (imgEl.complete && imgEl.naturalWidth > 1 && !String(imgEl.currentSrc || imgEl.src).startsWith('data:')) setImageState(imgEl, 'ready');
        };
        imgEl.onload = () => {
            if (!String(imgEl.currentSrc || imgEl.src).startsWith('data:')) setImageState(imgEl, 'ready');
        };
        imgEl.onerror = () => {
            // A failure of the fallback as well leaves nothing to show.
            imgEl.onerror = () => setImageState(imgEl, 'error');
            if (!fallbackSrc || imgEl.src === fallbackSrc) { setImageState(imgEl, 'error'); return; }
            if (fallbackSrc && imgEl.src !== fallbackSrc) {
                try {
                    if (window.MediaUrlResolver && typeof window.MediaUrlResolver.loadImage === 'function') {
                        const p = window.MediaUrlResolver.loadImage(imgEl, fallbackSrc, { mode: 'Describe-Image' });
                        if (p && typeof p.catch === 'function') p.catch(() => { imgEl.src = fallbackSrc; });
                    } else {
                        imgEl.src = fallbackSrc;
                    }
                } catch (_) {
                    imgEl.src = fallbackSrc;
                }
            }
        };
        try {
            if (window.MediaUrlResolver && typeof window.MediaUrlResolver.loadImage === 'function') {
                const p = window.MediaUrlResolver.loadImage(imgEl, primarySrc, { mode: 'Describe-Image' });
                if (p && typeof p.then === 'function') p.then(markIfLoaded, () => { imgEl.src = primarySrc; markIfLoaded(); });
            } else {
                imgEl.src = primarySrc;
                markIfLoaded();
            }
        } catch (_) {
            imgEl.src = primarySrc;
            markIfLoaded();
        }
    }

    function updateQuestionDisplay() {
        if (!currentEntry) return;
        if (el.currentQuestionIdDi) el.currentQuestionIdDi.textContent = currentEntry.id;
        if (el.questionSelectDi) el.questionSelectDi.value = currentEntryIndex;

        // Always update the persistent preview image
        setImageWithFallback(el.diPreviewImg, currentEntry);
        setImageWithFallback(el.diImage, currentEntry);
        setImageWithFallback(el.diImageRecord, currentEntry);
        const fbThumb = document.getElementById('di-fb-thumb-img');
        if (fbThumb) setImageWithFallback(fbThumb, currentEntry);

        // Update URL with current question ID (replaceState — no history entry per question)
        if (window.PracticeRouter && currentEntry.id) {
            window.PracticeRouter.replaceRoute('describe-image', currentEntry.id);
        }

        if (isV3() && v3Active) {
            const token = ++questionGen;
            setTimeout(() => {
                if (token === questionGen && v3Active) {
                    startPractice();
                }
            }, 30);
        }
    }

    /* ──────────────────────────── EVENT LISTENERS ──────────────────────────── */

    function setupEventListeners() {
        // Navigation
        el.questionSelectDi?.addEventListener('change', (e) => {
            currentEntryIndex = parseInt(e.target.value, 10);
            currentEntry = filteredEntries[currentEntryIndex];
            updateQuestionDisplay();
            reset();
        });
        el.backBtnDi?.addEventListener('click', () => navigateQuestion(-1));
        el.nextBtnDi?.addEventListener('click', () => navigateQuestion(1));

        // Play
        el.playDiBtn?.addEventListener('click', startPractice);
        el.diLoadRetryBtn?.addEventListener('click', () => loadEntries());

        // Stop recording
        el.diStopBtn?.addEventListener('click', () => stopRecording());

        // Review actions
        el.diRetryBtn?.addEventListener('click', retryRecording);
        el.diSubmitBtn?.addEventListener('click', submitForResults);

        // Results actions
        el.diResultsRetryBtn?.addEventListener('click', retryRecording);
        el.diNextQuestionBtn?.addEventListener('click', () => {
            navigateQuestion(1);
            startPractice();
        });

        // AI Assessment
        el.diAiBtn?.addEventListener('click', sendAIAssessment);

        // Zoom
        el.diZoomBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openZoom(el.diImage);
        });
        el.diImageContainer?.addEventListener('click', () => openZoom(el.diImage));
        el.diImagePreview?.querySelector('.di-image-container')?.addEventListener('click', () => openZoom(el.diPreviewImg));
        el.diStepRecord?.querySelector('.di-image-container')?.addEventListener('click', () => openZoom(el.diImageRecord));
        el.diZoomClose?.addEventListener('click', closeZoom);
        el.diZoomOverlay?.querySelector('.di-zoom-backdrop')?.addEventListener('click', closeZoom);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && el.diZoomOverlay?.style.display !== 'none') closeZoom();
        });

        // Difficulty filter
        el.difficultyFilterBtnDi?.addEventListener('click', () => {
            const menu = el.difficultyFilterMenuDi;
            if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        el.difficultyFilterMenuDi?.querySelectorAll('.filter-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const val = opt.dataset.value;
                applyDifficultyFilter(val);
                if (el.difficultyFilterMenuDi) el.difficultyFilterMenuDi.style.display = 'none';
            });
        });
    }

    function navigateQuestion(dir) {
        if (filteredEntries.length === 0) return;
        currentEntryIndex = (currentEntryIndex + dir + filteredEntries.length) % filteredEntries.length;
        currentEntry = filteredEntries[currentEntryIndex];
        questionGen += 1;
        attemptGen += 1;
        updateQuestionDisplay();
        reset();
    }

    /* ──────────────────────────── FILTERS ──────────────────────────── */

    function applyDifficultyFilter(val) {
        currentDifficultyFilter = val;
        if (val === 'all') {
            filteredEntries = [...entries];
        } else {
            const level = parseInt(val, 10);
            filteredEntries = entries.filter(e => e.level === level);
        }
        populateQuestionSelect();
        questionGen += 1;
        attemptGen += 1;
        if (filteredEntries.length > 0) {
            currentEntryIndex = 0;
            currentEntry = filteredEntries[0];
            updateQuestionDisplay();
        }
        reset();
        // Update label
        const labels = { all: 'Recommended', '1': '🟢 Level 1', '2': '🟡 Level 2', '3': '🔴 Level 3' };
        if (el.difficultyFilterLabelDi) el.difficultyFilterLabelDi.textContent = labels[val] || 'Recommended';
    }

    /* ──────────────────────────── PRACTICE FLOW ──────────────────────────── */

    function startPractice() {
        if (!currentEntry) return;
        reset();
        show(el.diPracticeArea);

        // Load image into preparation and recording steps
        setImageWithFallback(el.diImage, currentEntry);
        setImageWithFallback(el.diImageRecord, currentEntry);
        const fbThumb = document.getElementById('di-fb-thumb-img');
        if (fbThumb) setImageWithFallback(fbThumb, currentEntry);

        // Hide the persistent preview during practice (image is in the step UI)
        if (el.diImagePreview && !isV3()) el.diImagePreview.style.display = 'none';

        if (isV3()) {
            v3Phase = 'prep';
            syncPteV3UI();
            window.SpeakingPracticeController?.setPhase?.('describe-image', 'prep');
            startPrepTimer();
        } else {
            goToStep('preparing');
        }
    }

    function goToStep(step) {
        currentStep = step;
        hide(el.diStepPrepare);
        hide(el.diStepRecord);
        hide(el.diStepReview);
        hide(el.diStepResults);
        updateProgressBreadcrumb(step);

        switch (step) {
            case 'preparing':
                show(el.diStepPrepare);
                startPrepTimer();
                break;
            case 'recording':
                show(el.diStepRecord);
                startRecordingSession();
                break;
            case 'review':
                show(el.diStepReview);
                break;
            case 'results':
                show(el.diStepResults);
                displayResults();
                break;
        }
    }

    function updateProgressBreadcrumb(step) {
        if (!el.diStepProgress) return;
        const steps = el.diStepProgress.querySelectorAll('.di-progress-step');
        const stepOrder = ['prepare', 'record', 'review'];
        const activeIndex = stepOrder.indexOf(step === 'preparing' ? 'prepare' :
            step === 'recording' ? 'record' :
            step === 'results' ? 'review' : step);
        steps.forEach((s, i) => {
            s.classList.toggle('active', i === activeIndex);
            s.classList.toggle('completed', i < activeIndex);
        });
        window.SpeakingPracticeController?.sync?.('describe-image');
    }

    /* ──────────────────────────── PREPARATION TIMER ──────────────────────────── */

    // Don't spend the learner's prep window while a blocking tutorial covers the image.
    // Elapsed time is derived from performance.now(), so pausing means holding the RAF
    // loop and shifting prepStartTime forward by however long the overlay was up.
    // Registered once at module scope — tutorial auto-start is deferred, so the overlay
    // usually opens after the countdown has already begun.
    let prepPausedAt = null;
    window.addEventListener('tutorial:start', () => {
        if (currentStep !== 'preparing' || prepPausedAt !== null) return;
        prepPausedAt = performance.now();
        if (prepRAF) { cancelAnimationFrame(prepRAF); prepRAF = null; }
    });
    window.addEventListener('tutorial:end', () => {
        if (prepPausedAt === null) return;
        prepStartTime += performance.now() - prepPausedAt;
        prepPausedAt = null;
        if (currentStep === 'preparing') tickPrep();
    });

    function startPrepTimer() {
        prepStartTime = performance.now();
        if (el.diPrepTimer) el.diPrepTimer.textContent = `00:00 / 00:${PREP_SECONDS}`;
        if (el.diPrepBarFill) el.diPrepBarFill.style.width = '0%';
        if (isV3() && pteRecorderWidget) {
            pteRecorderWidget.showCountdown(PREP_SECONDS);
        }
        if (window.isTutorialActive) {
            prepPausedAt = performance.now();
            return;
        }
        tickPrep();
    }

    function tickPrep() {
        const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
        const elapsed = ((performance.now() - prepStartTime) / 1000) / scale;
        const remaining = Math.max(0, PREP_SECONDS - elapsed);
        if (el.diPrepTimer) el.diPrepTimer.textContent = `${fmt(elapsed)} / 00:${PREP_SECONDS}`;
        if (el.diPrepBarFill) el.diPrepBarFill.style.width = `${Math.min(100, (elapsed / PREP_SECONDS) * 100)}%`;

        if (isV3() && pteRecorderWidget) {
            pteRecorderWidget.tick(remaining);
        }

        if (elapsed >= PREP_SECONDS) {
            if (isV3()) {
                v3Phase = 'recording';
                window.SpeakingPracticeController?.setPhase?.('describe-image', 'recording');
                startRecordingSession();
            } else {
                goToStep('recording');
            }
            return;
        }
        prepRAF = requestAnimationFrame(tickPrep);
    }

    /* ──────────────────────────── RECORDING ──────────────────────────── */

    async function startRecordingSession() {
        try {
            if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
            recordingBlob = null;
            originalRecordingBlob = null;
            lastV3Playback = null;

            const micRequest = navigator.mediaDevices.getUserMedia({ audio: true });
            if (isV3()) pteRecorderWidget?.waitForMic?.(micRequest);
            const stream = await micRequest;
            const sessionToken = ++recordingSessionToken;
            const aGen = ++attemptGen;
            const qGen = questionGen;
            recordedChunks = [];
            transcriptText = '';

            if (sessionToken !== recordingSessionToken || aGen !== attemptGen || qGen !== questionGen || (isV3() && v3Phase !== 'recording')) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            if (isV3() && pteRecorderWidget) {
                pteRecorderWidget.showRecording(RECORD_SECONDS);
                pteRecorderWidget.attachStream(stream);
            }

            const recorder = new window.MediaRecorder(stream);
            recorder.addEventListener('dataavailable', (e) => {
                if (sessionToken !== recordingSessionToken || aGen !== attemptGen || qGen !== questionGen) return;
                if (e.data.size > 0) recordedChunks.push(e.data);
            });
            recorder.addEventListener('stop', () => {
                stream.getTracks().forEach(t => t.stop());
                if (el.diRecordStatus) el.diRecordStatus.classList.remove('di-recording-active');
                if (sessionToken !== recordingSessionToken || aGen !== attemptGen || qGen !== questionGen) return;
                if (recordedChunks.length > 0) {
                    const rawMimeType = recorder.mimeType || recordedChunks.find(chunk => chunk.type)?.type || 'application/octet-stream';
                    const blob = new Blob(recordedChunks, { type: rawMimeType });
                    originalRecordingBlob = blob;
                    recordingBlob = blob;
                    recordingBlobUrl = URL.createObjectURL(blob);
                    if (el.diRecordingPlayback) el.diRecordingPlayback.src = recordingBlobUrl;
                }

                if (isV3()) {
                    if (v3Phase === 'recording') {
                        v3Phase = 'complete';
                        if (pteRecorderWidget) pteRecorderWidget.showComplete();
                        window.SpeakingPracticeController?.setPhase?.('describe-image', 'complete');
                        syncPteV3UI();
                    }
                } else {
                    // Transition to review only if we were still in the recording step.
                    if (currentStep === 'recording') {
                        if (el.diTranscript) {
                            el.diTranscript.textContent = transcriptText || 'No transcript detected.';
                        }
                        goToStep('review');
                    }
                }
            });

            recorder.start();
            mediaRecorder = recorder;

            // Start speech recognition
            startSpeechRecognition();

            // UI
            if (el.diRecordStatus) el.diRecordStatus.classList.add('di-recording-active');
            if (el.diRecordStatusText) el.diRecordStatusText.textContent = 'Recording...';

            // Start record timer
            recordStartTime = performance.now();
            if (el.diRecordTimer) el.diRecordTimer.classList.remove('di-timer-warning');
            if (el.diRecordBarFill) el.diRecordBarFill.style.width = '0%';
            tickRecord();

        } catch (err) {
            console.error('[DI] Recording error:', err);
            if (isV3()) {
                // Back to prep with the reason on screen (a 5-second toast was all there was,
                // and the dock stayed on Finish recording). Start recording is the retry; the
                // prep countdown is not restarted, so it cannot push into another attempt.
                const info = window.PteRecorderWidget?.describeMicError?.(err);
                v3Phase = 'prep';
                syncPteV3UI();
                window.SpeakingPracticeController?.setPhase?.('describe-image', 'prep');
                pteRecorderWidget?.showMicError?.(info || err);
                if (info) window.SpeakingPracticeController?.setNotice?.('describe-image', info.notice);
                return;
            }
            if (typeof window.showToast === 'function') {
                window.showToast('Could not access microphone. Please allow microphone access.', 5000);
            }
        }
    }

    function tickRecord() {
        const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
        const elapsed = ((performance.now() - recordStartTime) / 1000) / scale;
        recordedDurationSec = elapsed;
        if (el.diRecordTimer) el.diRecordTimer.textContent = `${fmt(elapsed)} / 00:${RECORD_SECONDS}`;
        if (el.diRecordBarFill) el.diRecordBarFill.style.width = `${Math.min(100, (elapsed / RECORD_SECONDS) * 100)}%`;

        if (isV3() && pteRecorderWidget) {
            pteRecorderWidget.setElapsed(elapsed);
        }

        // Warning when approaching limit
        if (elapsed >= RECORD_SECONDS - 5) {
            if (el.diRecordTimer) el.diRecordTimer.classList.add('di-timer-warning');
        }

        if (elapsed >= RECORD_SECONDS) {
            stopRecording();
            return;
        }
        recordRAF = requestAnimationFrame(tickRecord);
    }

    function stopRecording(silent) {
        if (recordRAF) { cancelAnimationFrame(recordRAF); recordRAF = null; }
        if (silent) {
            // Invalidate pending MediaRecorder events so the stop handler doesn't mutate UI/state after reset/onExit.
            recordingSessionToken += 1;
            attemptGen += 1;
        }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        mediaRecorder = null;
        stopSpeechRecognition();

        if (silent) return;
        // Stop handler advances to review once the blob is ready.
    }

    /* ──────────────────────────── SPEECH RECOGNITION ──────────────────────────── */

    // Deprecated: webkitSpeechRecognition is retained for non-authoritative interim display only; server-side two-pass ASR is authoritative per Plan V3
    function startSpeechRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        try {
            const recognition = new SR();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            let finalTranscript = '';
            recognition.onresult = (event) => {
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript + ' ';
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }
                transcriptText = (finalTranscript + interim).trim();
                if (el.diRecordStatusText) {
                    el.diRecordStatusText.textContent = transcriptText ? 'Recording...' : 'Listening...';
                }
            };
            recognition.onerror = (e) => console.warn('[DI] Speech recognition error:', e.error);
            recognition.onend = () => {
                // Restart if still recording
                if (currentStep === 'recording' && mediaRecorder?.state === 'recording') {
                    try { recognition.start(); } catch (_) { /* ignore */ }
                }
            };

            speechRecognition = recognition;
            recognition.start();
        } catch (err) {
            console.warn('[DI] Speech recognition not available:', err);
        }
    }

    function stopSpeechRecognition() {
        if (speechRecognition) {
            try { speechRecognition.stop(); } catch (_) { /* ignore */ }
            speechRecognition = null;
        }
    }

    /* ──────────────────────────── REVIEW & RESULTS ──────────────────────────── */

    function retryRecording() {
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordingBlob = null;
        originalRecordingBlob = null;
        lastV3Playback = null;
        transcriptText = '';
        recordedDurationSec = 0;
        attemptGen += 1;
        if (isV3()) {
            v3Phase = 'prep';
            syncPteV3UI();
            window.SpeakingPracticeController?.setPhase?.('describe-image', 'prep');
            startPrepTimer();
        } else {
            goToStep('preparing');
        }
    }

    function submitForResults() {
        if (isV3()) {
            v3Phase = 'feedback';
            syncPteV3UI();
            window.SpeakingPracticeController?.setPhase?.('describe-image', 'feedback');
            displayResults();
        } else {
            goToStep('results');
        }
    }

    async function displayResults() {
        if (!currentEntry) return;

        // Sample answer
        if (el.diSampleAnswer) {
            const answer = currentEntry.sampleAnswer;
            if (typeof answer === 'object' && answer.full) {
                el.diSampleAnswer.innerHTML = `
                    <div class="di-answer-full"><strong>Full Answer:</strong><br>${escapeHtml(answer.full)}</div>
                    ${answer.simple ? `<div class="di-answer-simple"><strong>Simple Answer:</strong><br>${escapeHtml(answer.simple)}</div>` : ''}
                `;
            } else if (typeof answer === 'string') {
                el.diSampleAnswer.innerHTML = `<div class="di-answer-full">${escapeHtml(answer)}</div>`;
            } else {
                el.diSampleAnswer.textContent = 'No sample answer available.';
            }
        }

        // Key points
        if (el.diKeyPoints) {
            el.diKeyPoints.innerHTML = '';
            const points = Array.isArray(currentEntry?.keyPoints) ? currentEntry.keyPoints : [];
            if (points.length > 0) {
                points.forEach(p => {
                    const li = document.createElement('li');
                    li.textContent = p;
                    el.diKeyPoints.appendChild(li);
                });
            } else {
                const li = document.createElement('li');
                li.textContent = 'Key points will be available after dataset generation.';
                el.diKeyPoints.appendChild(li);
            }
        }

        if (isV3()) {
            renderV3Feedback();
        }

        const sessionToken = recordingSessionToken;
        const aGen = attemptGen;
        const qGen = questionGen;
        const finalBlob = recordingBlob;
        if (sessionToken !== recordingSessionToken || aGen !== attemptGen || qGen !== questionGen) return;

        // Decode AudioBuffer for instant word-click and ReferenceConfirmationUi clip playback
        const speechV3 = await window.AiScoringGate?.speechV3Enabled?.('describe_image').catch(() => null);
        if (sessionToken !== recordingSessionToken || aGen !== attemptGen || qGen !== questionGen) return;
        if (speechV3 === false && finalBlob && (window.AudioContext || window.webkitAudioContext)) {
            try {
                const arrayBuf = await finalBlob.arrayBuffer();
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                const ctx = window.SegmentPlaybackCoordinator?.defaultCoordinator?.getAudioContext() || new AudioCtx();
                window.describeImageAudioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));
            } catch (decodeErr) {
                console.warn('[DI] Error decoding audio buffer for word playback:', decodeErr);
            }
        }

        // Plan V3 §11 & §13: Authoritative AI scoring via AiScoringGate with 25 credit/min rate card
        const aiAssessment = await scoreDescribeImageWithAi(finalBlob).catch(err => {
            console.warn('[DI] AI assessment error:', err);
            alert('Scoring is temporarily unavailable. Your recording is still available. Please try again.');
            return null;
        });

        if (sessionToken !== recordingSessionToken || aGen !== attemptGen || qGen !== questionGen) return;
        const isCompletedAi = aiAssessment && (aiAssessment.status === 'completed' || (Array.isArray(aiAssessment.words) && aiAssessment.words.length > 0));
        const authoritativeTranscript = aiAssessment?.transcription?.rawTranscript || transcriptText || '';

        // Render transcript disclosure banner if authoritative ASR result returned
        if (isCompletedAi && el.diTranscript && window.TranscriptDisclosure) {
            const disclosure = new window.TranscriptDisclosure({
                containerEl: el.diTranscript,
                onWordClick: (word, index) => {
                    if (aiAssessment.schemaVersion === 'bel.speech.v3' && lastV3Playback) {
                        const wordResult = aiAssessment.wordResults?.find(item => item.occurrenceId === word.occurrenceId)
                            || aiAssessment.wordResults?.[index];
                        const span = word?.clip || wordResult?.clip || wordResult?.clipTiming?.clipSpan;
                        if (span) window.AiScoringGate.playV3Span({ ...lastV3Playback, span });
                    } else if (window.PronunciationTooltip && window.describeImageAudioBuffer) {
                        const wData = aiAssessment.words?.[index];
                        if (wData && wData.startMs != null && wData.endMs != null) {
                            window.PronunciationTooltip.playAudioSegment(window.describeImageAudioBuffer, wData.startMs, wData.endMs);
                        }
                    }
                }
            });
            disclosure.render(aiAssessment);
        } else if (aiAssessment?.status === 'reference_unresolved' && el.diTranscript) {
            // Was amber text on amber (about 1.6:1) reading "cancelled by learner"; plain words
            // in the shell's note style (.di-scoring-note).
            const note = document.createElement('div');
            note.className = 'di-scoring-note';
            note.textContent = 'You cancelled AI scoring. No credits were used.';
            el.diTranscript.replaceChildren(note);
        } else if (el.diTranscript && authoritativeTranscript) {
            el.diTranscript.textContent = authoritativeTranscript;
        }

        const archiveInput = {
            practiceMode: 'describe-image',
            attemptId: aiAssessment?.archiveAttemptId || undefined,
            promptSnapshot: {
                promptId: currentEntry.id || currentEntry.title || null,
                title: currentEntry.title || '',
                text: currentEntry.prompt || currentEntry.title || '',
                sourceAssetPaths: [currentEntry.imagePath || currentEntry.image || currentEntry.src].filter(Boolean),
                data: currentEntry
            },
            responseSnapshot: {
                transcript: authoritativeTranscript
            },
            answerSnapshot: {
                keyPoints: currentEntry.keyPoints || [],
                sampleAnswer: currentEntry.sampleAnswer || null
            },
            resultSnapshot: {
                submitted: true,
                score: isCompletedAi ? (aiAssessment?.schemaVersion === 'bel.speech.v3'
                    ? (aiAssessment.overallScores?.pronunciationScore ?? null)
                    : (aiAssessment.overallScores || null)) : null,
                ...(aiAssessment?.schemaVersion === 'bel.speech.v3' ? {
                    schemaVersion: 'bel.speech.v3',
                    overallScores: aiAssessment.overallScores || null,
                    assessmentId: aiAssessment.assessmentId || null,
                    resultRef: aiAssessment.resultRef || null,
                    recognizedText: aiAssessment.recognizedText || authoritativeTranscript,
                    words: aiAssessment.wordResults || []
                } : {})
            },
            scoringSource: isCompletedAi ? 'ai_two_pass_asr' : 'client',
            media: finalBlob ? [{
                slot: 'student',
                label: 'Student description',
                blob: finalBlob,
                contentType: finalBlob.type || 'application/octet-stream'
            }] : []
        };
        const isV3Archive = aiAssessment?.schemaVersion === 'bel.speech.v3' && aiAssessment.archiveAttemptId;
        const archiveWrite = isV3Archive
            ? window.PTEAttemptArchive?.patchAttempt?.(aiAssessment.archiveAttemptId, {
                responseSnapshot: archiveInput.responseSnapshot,
                answerSnapshot: archiveInput.answerSnapshot,
                resultSnapshot: archiveInput.resultSnapshot,
                scoringSnapshot: { source: 'ai_scoring_v3', success: true, status: 'completed' }
            })
            : window.PTEAttemptArchive?.saveAttempt?.(archiveInput);
        Promise.resolve(archiveWrite).then(() => {
            if (isV3Archive) {
                window.PTEAttemptArchive?.invalidateHistoryCache?.();
                window.dispatchEvent(new CustomEvent('pte-attempt-archive:saved', {
                    detail: { attemptId: aiAssessment.archiveAttemptId,
                        practiceMode: 'describe-image', promptId: currentEntry.id || null }
                }));
            }
        }).catch((error) => console.warn('[PTE Archive] Describe Image save failed:', error));
    }

    async function scoreDescribeImageWithAi(finalBlob) {
        const sessionToken = recordingSessionToken;
        const isCurrent = () => sessionToken === recordingSessionToken && finalBlob === recordingBlob;
        if (!window.AiScoringGate?.requestConsentAndConfirm || !finalBlob) {
            return null;
        }

        const speechV3 = await window.AiScoringGate.speechV3Enabled('describe_image');
        if (!isCurrent()) return null;
        if (speechV3) {
            if (!originalRecordingBlob) throw new Error('Original recording is unavailable. Record again.');
            const flow = await window.AiScoringGate.assessV3Recording({
                mode: 'describe_image', originalBlob: originalRecordingBlob, enhancedBlob: finalBlob,
                questionId: currentEntry?.id || null,
                promptSnapshot: { promptId: currentEntry?.id || null,
                    text: currentEntry?.prompt || currentEntry?.title || '', title: currentEntry?.title || '' }
            });
            if (!isCurrent() || !flow.allowed) return null;
            lastV3Playback = { canonicalBlob: flow.canonicalBlob, manifest: flow.manifest };
            const result = flow.result;
            if (result && result.status === 'completed') {
                result.archiveAttemptId = flow.attemptId;
                result.assessmentId = flow.assessmentId;
            }
            return result;
        }

        const pipeline = window.AudioDspPipeline;
        if (!pipeline?.prepareForAssessment) throw new Error('Audio format conversion is unavailable.');
        const prepared = await pipeline.prepareForAssessment(finalBlob);
        if (!isCurrent()) return null;
        if (!pipeline.isValidMono16kWav || !await pipeline.isValidMono16kWav(prepared)) {
            throw new Error('Audio format conversion failed. Your original recording is still available.');
        }
        const sampleCount = prepared.sampleCount ?? prepared.stats?.sampleCount;
        if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0) throw new Error('Audio sample count is unavailable.');
        const base64Audio = await window.AiScoringGate.blobToBase64(prepared.outputBlob);
        if (!isCurrent()) return null;

        const gateResult = await window.AiScoringGate.requestConsentAndConfirm({
            mode: 'describe_image',
            inputMeta: {
                sampleCount,
                sampleRateHz: 16000,
                audioData: base64Audio
            },
            questionId: currentEntry?.id || null
        });

        if (!gateResult || !gateResult.allowed) {
            if (gateResult?.cancelled) {
                console.log('[DI] AI scoring cancelled by student');
            }
            return null;
        }

        if (gateResult.assessmentId) {
            let assessmentResult = await window.AiScoringGate.pollAssessmentResult(gateResult.assessmentId);

            // Handle selective uncertainty ambiguity confirmation if triggered
            if (assessmentResult?.status === 'awaiting_reference_confirmation' && el.diTranscript && window.ReferenceConfirmationUi) {
                const confPromise = new Promise((resolve) => {
                    const confirmUi = new window.ReferenceConfirmationUi({
                        container: el.diTranscript,
                        ambiguities: assessmentResult.ambiguities || [],
                        audioBuffer: window.describeImageAudioBuffer || null,
                        audioElement: el.diRecordingPlayback || null,
                        onConfirm: async (selections) => {
                            if (window.AiScoringGate?.confirmReference) {
                                await window.AiScoringGate.confirmReference({
                                    assessmentId: gateResult.assessmentId,
                                    confirmations: selections
                                }).catch(err => console.warn('[DI] Confirm error:', err));
                            }
                            const updated = await window.AiScoringGate.pollAssessmentResult(gateResult.assessmentId);
                            resolve(updated);
                        },
                        onCancel: async () => {
                            if (window.AiScoringGate?.confirmReference) {
                                await window.AiScoringGate.confirmReference({
                                    assessmentId: gateResult.assessmentId,
                                    action: 'cancel'
                                }).catch(err => console.warn('[DI] Cancel error:', err));
                            }
                            resolve({ status: 'reference_unresolved', refunded: true });
                        }
                    });
                    confirmUi.render();
                });
                assessmentResult = await confPromise;
            }

            return assessmentResult;
        }
        return null;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML.replace(/\n/g, '<br>');
    }

    /* ──────────────────────────── AI ASSESSMENT ──────────────────────────── */

    function sendAIAssessment() {
        const dfMessenger = document.querySelector('df-messenger');
        if (!dfMessenger) {
            if (typeof window.showToast === 'function') {
                window.showToast('AI Assistant is not available.', 3000);
            }
            return;
        }

        try { dfMessenger.setAttribute('expand', 'true'); } catch (_) { /* ignore */ }

        const title = currentEntry?.title || 'Unknown';
        const type = currentEntry?.type || 'image';
        const keyPoints = Array.isArray(currentEntry?.keyPoints) && currentEntry.keyPoints.length > 0
            ? currentEntry.keyPoints.join('; ')
            : 'N/A';

        const payload = `Please review my PTE Describe Image response and provide detailed feedback:

Image: ${title} (Type: ${type})
Key Points to cover: ${keyPoints}

Requirements checklist:
1. Introduction sentence describing what the image shows
2. Body describing 2-3 key data points or features
3. Conclusion summarizing the main trend/message

Student's spoken response (transcript):
${transcriptText || '[No transcript detected]'}

Please provide:
- Content coverage score (0-5)
- Missing key points
- Suggested structure improvements
- An improved B2-level sample response
- Specific feedback on vocabulary and fluency`;

        try {
            if (typeof dfMessenger.sendQuery === 'function') {
                dfMessenger.sendQuery(payload);
            }
        } catch (err) {
            console.error('[DI] Error sending to chatbot:', err);
        }

        if (el.diAiBtn) {
            el.diAiBtn.textContent = '✅ Sent to AI Tutor';
            el.diAiBtn.disabled = true;
            setTimeout(() => {
                el.diAiBtn.textContent = '🤖 AI Content Assessment';
                el.diAiBtn.disabled = false;
            }, 5000);
        }
    }

    /* ──────────────────────────── ZOOM ──────────────────────────── */

    function openZoom(sourceImg) {
        const imgEl = sourceImg || (currentStep === 'recording' ? el.diImageRecord : el.diImage) || el.diPreviewImg;
        const src = imgEl?.src || (currentEntry ? getImageSrc(currentEntry) : '');
        if (!el.diZoomOverlay || !el.diZoomImage || !src) return;
        // Nothing to enlarge while the picture is loading or after it failed.
        const imageState = imgEl?.closest('.di-image-container')?.dataset.imageState;
        if (imageState === 'loading' || imageState === 'error') return;
        zoomLastFocused = document.activeElement;
        el.diZoomImage.src = src;
        show(el.diZoomOverlay);
        document.body.style.overflow = 'hidden';
        if (el.diZoomClose) {
            try { el.diZoomClose.focus(); } catch (_) {}
        }
    }

    function closeZoom() {
        if (!el.diZoomOverlay) return;
        hide(el.diZoomOverlay);
        document.body.style.overflow = '';
        if (zoomLastFocused && typeof zoomLastFocused.focus === 'function') {
            try { zoomLastFocused.focus(); } catch (_) {}
            zoomLastFocused = null;
        }
    }

    /* ──────────────────────────── TIMER CLEANUP ──────────────────────────── */

    function stopAllTimers() {
        if (prepRAF) { cancelAnimationFrame(prepRAF); prepRAF = null; }
        if (recordRAF) { cancelAnimationFrame(recordRAF); recordRAF = null; }
    }

    /* ──────────────────────────── V3 ADAPTER & LIFECYCLE ──────────────────────────── */

    function onRecordBtnClick() {
        if (!isV3() || v3Phase !== 'prep') return;
        if (prepRAF) { cancelAnimationFrame(prepRAF); prepRAF = null; }
        v3Phase = 'recording';
        window.SpeakingPracticeController?.setPhase?.('describe-image', 'recording');
        startRecordingSession();
    }

    function onCancelBtnClick() {
        if (!isV3() || v3Phase !== 'recording') return;
        stopAllTimers();
        stopRecording(true);
        recordedDurationSec = 0;
        v3Phase = 'prep';
        syncPteV3UI();
        window.SpeakingPracticeController?.setPhase?.('describe-image', 'prep');
        startPrepTimer();
    }

    function onPlayBtnClick() {
        if (!el.diRecordingPlayback) return;
        if (el.diRecordingPlayback.paused) {
            el.diRecordingPlayback.play().catch(() => {});
        } else {
            el.diRecordingPlayback.pause();
        }
    }

    function syncPlaybackUi() {
        const isPaused = !el.diRecordingPlayback || el.diRecordingPlayback.paused;
        const playBtn = document.getElementById('di-play-btn');
        if (playBtn) playBtn.textContent = isPaused ? 'Play' : 'Pause';
        const fbPlayBtn = document.getElementById('di-fb-play-btn');
        if (fbPlayBtn) fbPlayBtn.textContent = isPaused ? '▶' : '⏸';
        const fbTime = document.getElementById('di-fb-time');
        if (fbTime && el.diRecordingPlayback) {
            fbTime.textContent = `${fmt(el.diRecordingPlayback.currentTime || 0)} / ${fmt(recordedDurationSec || el.diRecordingPlayback.duration || RECORD_SECONDS)}`;
        }
    }

    function ensureV3Elements() {
        const modePanel = document.getElementById('mode-describe-image');
        if (!modePanel) return;

        // Ensure dock action buttons exist in DOM so adoptV3Dock can adopt them
        if (!document.getElementById('di-record-btn')) {
            const btn = document.createElement('button');
            btn.id = 'di-record-btn';
            btn.type = 'button';
            btn.className = 'modern-btn';
            btn.hidden = true;
            btn.textContent = 'Start recording';
            btn.addEventListener('click', onRecordBtnClick);
            (el.diStepPrepare || modePanel).appendChild(btn);
        }
        if (!document.getElementById('di-cancel-btn')) {
            const btn = document.createElement('button');
            btn.id = 'di-cancel-btn';
            btn.type = 'button';
            btn.className = 'modern-btn';
            btn.hidden = true;
            btn.textContent = 'Cancel';
            btn.addEventListener('click', onCancelBtnClick);
            (el.diStepRecord || modePanel).appendChild(btn);
        }
        if (!document.getElementById('di-play-btn')) {
            const btn = document.createElement('button');
            btn.id = 'di-play-btn';
            btn.type = 'button';
            btn.className = 'modern-btn';
            btn.hidden = true;
            btn.textContent = 'Play';
            btn.addEventListener('click', onPlayBtnClick);
            (el.diStepReview || modePanel).appendChild(btn);
        }

        const practiceArea = document.getElementById('di-practice-area');
        if (!practiceArea) return;

        // 1. PTE instruction
        if (!document.getElementById('di-pte-instruction')) {
            v3InstructionEl = document.createElement('p');
            v3InstructionEl.className = 'pte-instr';
            v3InstructionEl.id = 'di-pte-instruction';
            v3InstructionEl.textContent = 'Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing. You will have 40 seconds to give your response.';
            practiceArea.prepend(v3InstructionEl);
        }

        // 2. Stage container (.di-pte-stage)
        if (!document.getElementById('di-pte-stage')) {
            v3StageEl = document.createElement('div');
            v3StageEl.className = 'di-pte-stage';
            v3StageEl.id = 'di-pte-stage';

            const mediaCol = document.createElement('div');
            mediaCol.className = 'di-pte-stage-media';
            mediaCol.id = 'di-pte-media';

            const recCol = document.createElement('div');
            recCol.className = 'di-pte-stage-rec';
            const recHost = document.createElement('div');
            recHost.id = 'di-pte-recorder';
            recCol.appendChild(recHost);

            v3StageEl.append(mediaCol, recCol);
            practiceArea.appendChild(v3StageEl);

            // Move #di-image-container into mediaCol
            const imgContainer = document.getElementById('di-image-container');
            if (imgContainer) {
                v3OriginalContainers.set('imgContainer', { parent: imgContainer.parentNode, nextSibling: imgContainer.nextSibling });
                mediaCol.appendChild(imgContainer);
            }

            // Move #di-zoom-btn inside #di-image-container at top right corner
            const zoomBtn = document.getElementById('di-zoom-btn');
            if (zoomBtn && imgContainer) {
                v3OriginalContainers.set('zoomBtn', { parent: zoomBtn.parentNode, nextSibling: zoomBtn.nextSibling, className: zoomBtn.className, text: zoomBtn.innerHTML });
                zoomBtn.className = 'di-zoom-btn';
                zoomBtn.setAttribute('aria-label', 'Zoom image');
                zoomBtn.setAttribute('title', 'Zoom image');
                zoomBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/></svg>';
                imgContainer.appendChild(zoomBtn);
            }
        }

        // 3. Feedback container (.pte-fb#di-pte-feedback)
        if (!document.getElementById('di-pte-feedback')) {
            v3FeedbackEl = document.createElement('div');
            v3FeedbackEl.className = 'pte-fb';
            v3FeedbackEl.id = 'di-pte-feedback';
            v3FeedbackEl.hidden = true;
            v3FeedbackEl.style.display = 'none';

            v3FeedbackEl.innerHTML = `
                <div class="pte-fb__col pte-fb__col--left pte-fb__left">
                    <div class="di-image-container di-fb-image-container">
                        <img id="di-fb-thumb-img" class="di-image" alt="Describe Image" />
                        <button id="di-fb-zoom-btn" class="di-zoom-btn" type="button" aria-label="Zoom image">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/></svg>
                        </button>
                    </div>
                    <div class="pte-listen di-fb-listen" id="di-fb-listen">
                        <span class="di-fb-listen__label">Your recording</span>
                        <button id="di-fb-play-btn" class="pte-btn pte-btn--icon di-fb-play" type="button" aria-label="Play recording">▶</button>
                        <span id="di-fb-time" class="di-fb-time">00:00 / 00:40</span>
                    </div>
                    <h4 class="di-fb-heading">What you said</h4>
                    <div class="di-transcript" id="di-fb-transcript">No transcript detected.</div>
                </div>
                <div class="pte-fb__col pte-fb__col--right pte-fb__right">
                    <div class="pte-tabs" role="tablist" aria-label="Feedback">
                        <button id="di-tab-keypoints" class="pte-tab" type="button" role="tab" aria-selected="true">Key points</button>
                        <button id="di-tab-sample" class="pte-tab" type="button" role="tab" aria-selected="false">Sample answer</button>
                    </div>
                    <div id="di-panel-keypoints" role="tabpanel" aria-labelledby="di-tab-keypoints">
                        <div class="pte-stats pte-stats--2">
                            <div>
                                <small>Key points</small>
                                <strong>—<span class="pte-stats__unit">/5</span></strong>
                            </div>
                            <div>
                                <small>Speaking time</small>
                                <strong id="di-stat-time">00:00</strong>
                            </div>
                        </div>
                        <ul class="di-keypoints-list" id="di-fb-keypoints"></ul>
                        <div class="di-ai-action">
                            <button id="di-fb-ai-btn" class="pte-btn" type="button">🤖 AI Content Assessment</button>
                            <small>Opens in Ask me! with your transcript and the key points</small>
                        </div>
                    </div>
                    <div id="di-panel-sample" role="tabpanel" aria-labelledby="di-tab-sample" hidden>
                        <div id="di-fb-sample-answer" class="sample di-fb-sample"></div>
                    </div>
                </div>
            `;
            practiceArea.appendChild(v3FeedbackEl);

            // Wire feedback tabs
            const tabKp = v3FeedbackEl.querySelector('#di-tab-keypoints');
            const tabSample = v3FeedbackEl.querySelector('#di-tab-sample');
            const panelKp = v3FeedbackEl.querySelector('#di-panel-keypoints');
            const panelSample = v3FeedbackEl.querySelector('#di-panel-sample');

            // The shell styles the active pill off aria-selected, so selection is just
            // state now - no inline colours to keep in sync.
            const selectFbTab = which => {
                const onKeypoints = which === 'keypoints';
                tabKp?.setAttribute('aria-selected', String(onKeypoints));
                tabSample?.setAttribute('aria-selected', String(!onKeypoints));
                if (panelKp) panelKp.hidden = !onKeypoints;
                if (panelSample) panelSample.hidden = onKeypoints;
            };
            tabKp?.addEventListener('click', () => selectFbTab('keypoints'));
            tabSample?.addEventListener('click', () => selectFbTab('sample'));

            // Wire AI button in feedback
            v3FeedbackEl.querySelector('#di-fb-ai-btn')?.addEventListener('click', sendAIAssessment);

            // Wire Zoom button in feedback
            v3FeedbackEl.querySelector('#di-fb-zoom-btn')?.addEventListener('click', () => {
                const thumb = document.getElementById('di-fb-thumb-img');
                openZoom(thumb);
            });

            // Wire Play button in feedback
            const fbPlayBtn = v3FeedbackEl.querySelector('#di-fb-play-btn');
            fbPlayBtn?.addEventListener('click', onPlayBtnClick);
        }

        // Recorder widget
        const recHost = document.getElementById('di-pte-recorder');
        if (recHost && (!pteRecorderWidget || recHost.children.length === 0)) {
            pteRecorderWidget = window.PteRecorderWidget?.create?.(recHost, { totalSeconds: RECORD_SECONDS });
        }

        // Wire playback events on el.diRecordingPlayback once
        if (el.diRecordingPlayback && !el.diRecordingPlayback._v3Wired) {
            el.diRecordingPlayback._v3Wired = true;
            el.diRecordingPlayback.addEventListener('play', syncPlaybackUi);
            el.diRecordingPlayback.addEventListener('pause', syncPlaybackUi);
            el.diRecordingPlayback.addEventListener('timeupdate', syncPlaybackUi);
            el.diRecordingPlayback.addEventListener('ended', syncPlaybackUi);
        }
    }

    function renderV3Feedback() {
        if (!currentEntry) return;

        // Thumbnail
        const thumb = document.getElementById('di-fb-thumb-img');
        if (thumb) setImageWithFallback(thumb, currentEntry);

        // Transcript
        const transcriptEl = document.getElementById('di-fb-transcript');
        if (transcriptEl) transcriptEl.textContent = transcriptText || 'No transcript detected.';

        // Stats
        const statTime = document.getElementById('di-stat-time');
        if (statTime) statTime.textContent = fmt(recordedDurationSec || RECORD_SECONDS);

        // Key points checklist (neutral per O-7)
        const kpList = document.getElementById('di-fb-keypoints');
        if (kpList) {
            kpList.innerHTML = '';
            const points = currentEntry.keyPoints || [];
            if (points.length > 0) {
                points.forEach(p => {
                    const li = document.createElement('li');
                    li.textContent = p;
                    kpList.appendChild(li);
                });
            } else {
                const li = document.createElement('li');
                li.textContent = 'Key points will be available after dataset generation.';
                kpList.appendChild(li);
            }
        }

        // Sample answer
        const sampleEl = document.getElementById('di-fb-sample-answer');
        if (sampleEl) {
            const answer = currentEntry.sampleAnswer;
            if (typeof answer === 'object' && answer.full) {
                sampleEl.innerHTML = `
                    <div class="di-answer-full"><strong>Full Answer:</strong><br>${escapeHtml(answer.full)}</div>
                    ${answer.simple ? `<div class="di-answer-simple" style="margin-top:12px;"><strong>Simple Answer:</strong><br>${escapeHtml(answer.simple)}</div>` : ''}
                `;
            } else if (typeof answer === 'string') {
                sampleEl.innerHTML = `<div class="di-answer-full">${escapeHtml(answer)}</div>`;
            } else {
                sampleEl.textContent = 'No sample answer available.';
            }
        }

        syncPlaybackUi();
    }

    function syncPteV3UI() {
        if (!isV3()) return;
        const stage = document.getElementById('di-pte-stage');
        const feedback = document.getElementById('di-pte-feedback');
        const practiceArea = document.getElementById('di-practice-area');

        if (practiceArea) practiceArea.style.display = 'block';

        if (v3Phase === 'feedback') {
            if (stage) { stage.hidden = true; stage.style.display = 'none'; }
            // Leave display to the stylesheet: an inline value would override .pte-fb's
            // grid and its stacking rule, which is what squashed the columns on phones.
            if (feedback) { feedback.hidden = false; feedback.style.display = ''; }
            renderV3Feedback();
        } else {
            if (stage) { stage.hidden = false; stage.style.display = 'flex'; }
            if (feedback) { feedback.hidden = true; feedback.style.display = ''; }
        }
    }

    function mountPteShell() {
        v3Active = true;
        const modePanel = document.getElementById('mode-describe-image');
        if (modePanel) modePanel.classList.add('di-pte-v3');
        ensureV3Elements();
        if (currentEntry) {
            updateQuestionDisplay();
        }
        if (v3Phase === 'loading' && currentEntry) {
            v3Phase = 'prep';
        }
        syncPteV3UI();
    }

    function unmountPteShell() {
        v3Active = false;
        const modePanel = document.getElementById('mode-describe-image');
        if (modePanel) modePanel.classList.remove('di-pte-v3');

        // Restore moved elements
        const imgContainer = document.getElementById('di-image-container');
        const origImg = v3OriginalContainers.get('imgContainer');
        if (imgContainer && origImg?.parent) {
            if (origImg.nextSibling && origImg.parent.contains(origImg.nextSibling)) {
                origImg.parent.insertBefore(imgContainer, origImg.nextSibling);
            } else {
                origImg.parent.appendChild(imgContainer);
            }
        }

        const zoomBtn = document.getElementById('di-zoom-btn');
        const origZoom = v3OriginalContainers.get('zoomBtn');
        if (zoomBtn && origZoom?.parent) {
            zoomBtn.className = origZoom.className || 'modern-btn modern-btn--compact';
            zoomBtn.innerHTML = origZoom.text || '🔍 Zoom';
            zoomBtn.removeAttribute('title');
            if (origZoom.nextSibling && origZoom.parent.contains(origZoom.nextSibling)) {
                origZoom.parent.insertBefore(zoomBtn, origZoom.nextSibling);
            } else {
                origZoom.parent.appendChild(zoomBtn);
            }
        }

        // Remove created v3 elements
        document.getElementById('di-pte-instruction')?.remove();
        document.getElementById('di-pte-stage')?.remove();
        document.getElementById('di-pte-feedback')?.remove();

        if (pteRecorderWidget) {
            pteRecorderWidget.destroy();
            pteRecorderWidget = null;
        }

        reset();
    }

    function syncPteShell() {
        if (!v3Active) return;
        window.SpeakingPracticeController?.setPhase?.('describe-image', v3Phase);
        syncPteV3UI();
    }

    async function finishRecordingForNext() {
        stopAllTimers();
        const aGen = ++attemptGen;
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try { mediaRecorder.stop(); } catch (_) {}
        }
        mediaRecorder = null;
        stopSpeechRecognition();

        const finalBlob = recordingBlob;
        if (aGen !== attemptGen) return;
        if (currentEntry) {
            try {
                await window.PTEAttemptArchive?.saveAttempt?.({
                    practiceMode: 'describe-image',
                    promptSnapshot: {
                        promptId: currentEntry.id || currentEntry.title || null,
                        title: currentEntry.title || '',
                        text: currentEntry.prompt || currentEntry.title || '',
                        data: currentEntry
                    },
                    responseSnapshot: { transcript: transcriptText || '' },
                    answerSnapshot: { keyPoints: currentEntry.keyPoints || [], sampleAnswer: currentEntry.sampleAnswer || null },
                    resultSnapshot: { submitted: true, score: null },
                    scoringSource: 'client',
                    media: finalBlob ? [{ slot: 'student', label: 'Student description', blob: finalBlob, contentType: finalBlob.type || 'application/octet-stream' }] : []
                });
            } catch (_) {}
        }
        navigateQuestion(1);
        if (v3Active) startPractice();
    }

    function advanceQuestion() {
        navigateQuestion(1);
        if (v3Active) startPractice();
    }

    /* ──────────────────────────── LIFECYCLE ──────────────────────────── */

    function onEnter() {
        init();
        if (!hasLoadedEntries) {
            loadEntries();
        } else if (currentEntry) {
            updateQuestionDisplay();
        }
    }

    function onExit() {
        reset();
    }

    /* ──────────────────────────── EXPOSE ──────────────────────────── */

    window.DescribeImageMode = {
        init,
        reset,
        onEnter,
        onExit,
        loadEntries,
        mountPteShell,
        unmountPteShell,
        syncPteShell,
        getPtePhase: () => v3Phase,
        getDifficultyFilter: () => currentDifficultyFilter,
        setDifficultyFilter: (val) => {
            currentDifficultyFilter = val;
            applyDifficultyFilter(val);
        },
        finishRecordingForNext,
        advanceQuestion,
        getCurrentQuestionId: () => currentEntry?.id || null
    };

    // Deep-link support: listen for PracticeRouter question navigation events
    window.addEventListener('practice-route-question', (event) => {
        const { mode, questionId } = event.detail || {};
        if (mode !== 'describe-image' || !questionId) return;
        if (!hasLoadedEntries || filteredEntries.length === 0) return;
        const idx = filteredEntries.findIndex((e) => String(e.id) === String(questionId));
        if (idx >= 0) {
            currentEntryIndex = idx;
            currentEntry = filteredEntries[idx];
            questionGen += 1;
            attemptGen += 1;
            updateQuestionDisplay();
            reset();
        }
    });

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
