/**
 * Describe Image Mode Module (PTE Practice → Speaking)
 * Flow: Select question → Play → Prepare (25s) → Record (40s) → Review → Results + AI
 */
(function () {
    'use strict';

    const DI_JSON_PATH = 'database/Describe Image/describe-image-questions.json';
    const DI_IMAGE_DIR = 'database/Describe Image/DI/';
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
    let recordingSessionToken = 0;

    // Speech recognition
    let speechRecognition = null;
    let transcriptText = '';

    // Current step
    let currentStep = 'idle'; // idle | preparing | recording | review | results

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
            'total-questions-di', 'play-di-btn', 'di-practice-area', 'di-step-progress',
            'di-step-prepare', 'di-step-record', 'di-step-review', 'di-step-results',
            'di-image', 'di-image-record', 'di-image-container', 'di-preview-img',
            'di-prep-timer', 'di-prep-bar-fill', 'di-record-timer', 'di-record-bar-fill',
            'di-record-status', 'di-record-status-text', 'di-stop-btn',
            'di-recording-playback', 'di-transcript',
            'di-retry-btn', 'di-submit-btn',
            'di-sample-answer', 'di-key-points',
            'di-ai-btn', 'di-results-retry-btn', 'di-next-question-btn',
            'di-zoom-overlay', 'di-zoom-image', 'di-zoom-close', 'di-zoom-btn',
            'di-info-box', 'di-image-preview',
            'difficulty-filter-btn-di', 'difficulty-filter-menu-di', 'difficulty-filter-label-di',
            'difficulty-filter-container-di',
            'recommended-btn-di', 'recommendation-summary-di'
        ];
        ids.forEach(id => {
            const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            el[key] = document.getElementById(id);
        });
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

        // Dismiss info box if previously dismissed
        if (localStorage.getItem('diInfoDismissed') === '1' && el.diInfoBox) {
            el.diInfoBox.style.display = 'none';
        }
    }

    function reset() {
        stopAllTimers();
        stopRecording(true);
        currentStep = 'idle';
        transcriptText = '';
        if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }
        recordedChunks = [];
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
        hide(el.diPracticeArea);
        hide(el.diStepPrepare);
        hide(el.diStepRecord);
        hide(el.diStepReview);
        hide(el.diStepResults);
        updateProgressBreadcrumb('idle');
        closeZoom();
        // Restore the persistent image preview
        if (el.diImagePreview) el.diImagePreview.style.display = '';
    }

    /* ──────────────────────────── DATA LOADING ──────────────────────────── */

    function loadEntries() {
        if (loadEntriesPromise) return loadEntriesPromise;
        loadEntriesPromise = (async () => {
            try {
                const resp = await fetch(DI_JSON_PATH);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                entries = Array.isArray(data) ? data : (data.questions || []);
            } catch (err) {
                console.warn('[DI] JSON load failed, using empty set:', err.message);
                entries = [];
            }
            hasLoadedEntries = entries.length > 0;
            filteredEntries = [...entries];
            populateQuestionSelect();
            if (filteredEntries.length > 0) {
                currentEntryIndex = 0;
                currentEntry = filteredEntries[0];
                updateQuestionDisplay();
            }
        })();
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
        if (el.totalQuestionsDi) el.totalQuestionsDi.textContent = filteredEntries.length;
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

    function setImageWithFallback(imgEl, entry) {
        if (!imgEl || !entry) return;
        const primarySrc = getImageSrc(entry);
        const fallbackSrc = getImageFallbackSrc(entry);
        imgEl.onerror = () => {
            imgEl.onerror = null;
            if (fallbackSrc && imgEl.src !== fallbackSrc) imgEl.src = fallbackSrc;
        };
        imgEl.src = primarySrc;
    }

    function updateQuestionDisplay() {
        if (!currentEntry) return;
        if (el.currentQuestionIdDi) el.currentQuestionIdDi.textContent = currentEntry.id;
        if (el.questionSelectDi) el.questionSelectDi.value = currentEntryIndex;

        // Always update the persistent preview image
        setImageWithFallback(el.diPreviewImg, currentEntry);

        // Update URL with current question ID (replaceState — no history entry per question)
        if (window.PracticeRouter && currentEntry.id) {
            window.PracticeRouter.replaceRoute('describe-image', currentEntry.id);
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
        updateQuestionDisplay();
        reset();
    }

    /* ──────────────────────────── FILTERS ──────────────────────────── */

    function applyDifficultyFilter(val) {
        if (val === 'all') {
            filteredEntries = [...entries];
        } else {
            const level = parseInt(val, 10);
            filteredEntries = entries.filter(e => e.level === level);
        }
        populateQuestionSelect();
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

        // Hide the persistent preview during practice (image is in the step UI)
        if (el.diImagePreview) el.diImagePreview.style.display = 'none';

        goToStep('preparing');
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
    }

    /* ──────────────────────────── PREPARATION TIMER ──────────────────────────── */

    function startPrepTimer() {
        prepStartTime = performance.now();
        if (el.diPrepTimer) el.diPrepTimer.textContent = `00:00 / 00:${PREP_SECONDS}`;
        if (el.diPrepBarFill) el.diPrepBarFill.style.width = '0%';
        tickPrep();
    }

    function tickPrep() {
        const elapsed = (performance.now() - prepStartTime) / 1000;
        if (el.diPrepTimer) el.diPrepTimer.textContent = `${fmt(elapsed)} / 00:${PREP_SECONDS}`;
        if (el.diPrepBarFill) el.diPrepBarFill.style.width = `${Math.min(100, (elapsed / PREP_SECONDS) * 100)}%`;

        if (elapsed >= PREP_SECONDS) {
            goToStep('recording');
            return;
        }
        prepRAF = requestAnimationFrame(tickPrep);
    }

    /* ──────────────────────────── RECORDING ──────────────────────────── */

    async function startRecordingSession() {
        try {
            if (recordingBlobUrl) { URL.revokeObjectURL(recordingBlobUrl); recordingBlobUrl = null; }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const sessionToken = ++recordingSessionToken;
            recordedChunks = [];
            transcriptText = '';

            const recorder = new window.MediaRecorder(stream);
            recorder.addEventListener('dataavailable', (e) => {
                if (sessionToken !== recordingSessionToken) return;
                if (e.data.size > 0) recordedChunks.push(e.data);
            });
            recorder.addEventListener('stop', () => {
                stream.getTracks().forEach(t => t.stop());
                if (el.diRecordStatus) el.diRecordStatus.classList.remove('di-recording-active');
                if (sessionToken !== recordingSessionToken) return;
                if (recordedChunks.length > 0) {
                    const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
                    recordingBlobUrl = URL.createObjectURL(blob);
                    if (el.diRecordingPlayback) el.diRecordingPlayback.src = recordingBlobUrl;
                }

                // Transition to review only if we were still in the recording step.
                if (currentStep === 'recording') {
                    if (el.diTranscript) {
                        el.diTranscript.textContent = transcriptText || 'No transcript detected.';
                    }
                    goToStep('review');
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
            if (typeof window.showToast === 'function') {
                window.showToast('Could not access microphone. Please allow microphone access.', 5000);
            }
        }
    }

    function tickRecord() {
        const elapsed = (performance.now() - recordStartTime) / 1000;
        if (el.diRecordTimer) el.diRecordTimer.textContent = `${fmt(elapsed)} / 00:${RECORD_SECONDS}`;
        if (el.diRecordBarFill) el.diRecordBarFill.style.width = `${Math.min(100, (elapsed / RECORD_SECONDS) * 100)}%`;

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
        transcriptText = '';
        goToStep('preparing');
    }

    function submitForResults() {
        goToStep('results');
    }

    function displayResults() {
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
            const points = currentEntry.keyPoints || [];
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
        const keyPoints = (currentEntry?.keyPoints || []).join(', ') || 'N/A';

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
        const src = imgEl?.src;
        if (!el.diZoomOverlay || !el.diZoomImage || !src) return;
        el.diZoomImage.src = src;
        show(el.diZoomOverlay);
        document.body.style.overflow = 'hidden';
    }

    function closeZoom() {
        hide(el.diZoomOverlay);
        document.body.style.overflow = '';
    }

    /* ──────────────────────────── TIMER CLEANUP ──────────────────────────── */

    function stopAllTimers() {
        if (prepRAF) { cancelAnimationFrame(prepRAF); prepRAF = null; }
        if (recordRAF) { cancelAnimationFrame(recordRAF); recordRAF = null; }
    }

    /* ──────────────────────────── LIFECYCLE ──────────────────────────── */

    function onEnter() {
        init();
        if (!hasLoadedEntries) loadEntries();
    }

    function onExit() {
        reset();
    }

    /* ──────────────────────────── EXPOSE ──────────────────────────── */

    window.DescribeImageMode = { init, reset, onEnter, onExit, loadEntries };

    // Deep-link support: listen for PracticeRouter question navigation events
    window.addEventListener('practice-route-question', (event) => {
        const { mode, questionId } = event.detail || {};
        if (mode !== 'describe-image' || !questionId) return;
        if (!hasLoadedEntries || filteredEntries.length === 0) return;
        const idx = filteredEntries.findIndex((e) => String(e.id) === String(questionId));
        if (idx >= 0) {
            currentEntryIndex = idx;
            currentEntry = filteredEntries[idx];
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
