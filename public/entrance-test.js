(function () {
  'use strict';

  const elements = {
    card: document.getElementById('et-card'),
    subtitle: document.getElementById('et-brand-subtitle'),
    progressText: document.getElementById('et-progress-text'),
    progressFill: document.getElementById('et-progress-fill'),
    progressBar: document.querySelector('.et-progress-bar')
  };

  const urlParams = new URLSearchParams(window.location.search || '');
  const token = String(urlParams.get('token') || '').trim();

  const appState = {
    token,
    testId: null,
    session: null,
    steps: [],
    stepIndex: 0,
    totalQuestions: 0,
    responses: {
      vocab: {},
      grammar: {},
      listen_write: {}
    },
    speaking: {},
    recording: null, // { questionId, recorder, stream, chunks }
    uploading: null, // { questionId, phase: 'uploading'|'processing', percent }
    lastRenderedStepIndex: null
  };

  const PROGRESS_STORAGE_PREFIX = 'entrance_test_progress_v1:';
  const LISTENING_AUDIO_BY_QUESTION = {
    listen_write_q1: '/database/Entrance Test/Listening Q1.mp3',
    listen_write_q2: '/database/Entrance Test/Listening Q2.mp3'
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((e) => {
      console.error('[EntranceTest] init error:', e);
      renderError(e?.message || 'Failed to load test.');
    });
  });

  async function init() {
    if (!token) {
      renderError('This link is missing a token.');
      return;
    }

    setSubtitle('Preparing your test…');
    const data = await fetchSession();
    appState.testId = data.testId;

    // Segmental screening: redirect to pronunciation test page
    if (data.testType === 'segmental_screening_v1') {
      window.location.href = `/pronunciation-test/?entranceToken=${encodeURIComponent(token)}`;
      return;
    }

    appState.session = data.session;
    appState.steps = buildSteps(data.session);
    hydrateQuestionProgress(appState.steps);
    hydrateSavedProgress(choosePreferredProgressDraft(data.progress, readLocalProgressDraft()));
    render();
  }

  async function fetchSession() {
    const res = await fetch(`/api/entrance-tests/session?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      const msg = json?.message || 'This link is invalid or already used.';
      throw new Error(msg);
    }
    return json;
  }

  function setSubtitle(text) {
    if (elements.subtitle) elements.subtitle.textContent = text || '';
  }

  function buildSteps(session) {
    const steps = [];

    steps.push({
      type: 'intro',
      title: 'Bài kiểm tra đầu vào',
      subtitle: 'Vui lòng hoàn thành lần lượt. Sau khi nộp bài, link sẽ bị khoá và không thể dùng lại.',
      body: [
        'Bài test gồm 4 phần: (1) ĐỌC & NÓI, (2) TỪ VỰNG, (3) NGỮ PHÁP, (4) NGHE & VIẾT.',
        'Mỗi câu hỏi sẽ hiển thị trên một trang.',
        'Tiến độ sẽ được lưu sau mỗi câu đã nộp; bạn có thể mở lại link để tiếp tục.'
      ],
      cta: 'Bắt đầu'
    });

    const sections = Array.isArray(session?.sections) ? session.sections : [];
    for (const section of sections) {
      const extra = getSectionIntroExtraVi(section.id);
      steps.push({
        type: 'section_intro',
        sectionId: section.id,
        title: section.titleVi || 'Section',
        instructionVi: section.instructionVi || '',
        extraVi: extra,
        cta: 'Bắt đầu phần này'
      });

      const questions = Array.isArray(section.questions) ? section.questions : [];
      for (const q of questions) {
        steps.push({
          type: q.type === 'speaking' ? 'speaking_question' : (q.type === 'mc' ? 'mc_question' : 'fill_question'),
          sectionId: q.sectionId,
          sectionTitle: section.titleVi || '',
          questionId: q.questionId,
          questionNumber: q.questionNumber,
          instructionVi: q.instructionVi || section.instructionVi || '',
          text: q.text || null,
          audioUrl: q.audioUrl || null,
          parts: q.parts || null
        });
      }
    }

    steps.push({
      type: 'done',
      title: 'Cảm ơn bạn!',
      subtitle: 'Bạn đã nộp bài thành công.',
      body: [
        'Vui lòng chờ kết quả được chấm và phản hồi.',
        'Bạn có thể đóng trang này.'
      ]
    });

    return steps;
  }

  function getSectionIntroExtraVi(sectionId) {
    if (sectionId === 'speaking') {
      return [
        'Bạn sẽ đọc đoạn văn và thu âm giọng nói.',
        'Nhấn “Start recording” → “Stop recording” → “Playback” để nghe lại.',
        'Khi sẵn sàng, nhấn “Submit” để chuyển sang câu tiếp theo.'
      ];
    }
    if (sectionId === 'vocab') {
      return [
        'Đọc kỹ đoạn văn.',
        'Nhấn vào ô trống để chọn đáp án phù hợp nhất theo ngữ cảnh.',
        'Mỗi ô trống chỉ chọn 1 đáp án.'
      ];
    }
    if (sectionId === 'grammar') {
      return [
        'Đọc kỹ đoạn văn.',
        'Nhấn vào ô trống để chọn đáp án đúng về ngữ pháp và ý nghĩa.',
        'Mỗi ô trống chỉ chọn 1 đáp án.'
      ];
    }
    if (sectionId === 'listen_write') {
      return [
        'Điền từ vào ô trống.',
        'Chú ý chính tả (không cần viết hoa).',
        'Sau khi hoàn thành, nhấn “Submit” để chuyển sang câu tiếp theo.'
      ];
    }
    return [];
  }

  function hydrateQuestionProgress(steps) {
    const questionSteps = steps.filter(s => ['speaking_question', 'mc_question', 'fill_question'].includes(s.type));
    appState.totalQuestions = questionSteps.length;
    let counter = 0;
    for (const step of steps) {
      if (['speaking_question', 'mc_question', 'fill_question'].includes(step.type)) {
        counter++;
        step.globalQuestionIndex = counter;
        step.globalQuestionTotal = appState.totalQuestions;
      }
    }
  }

  function normalizeResponses(rawResponses) {
    const normalized = {
      vocab: {},
      grammar: {},
      listen_write: {}
    };

    const source = rawResponses && typeof rawResponses === 'object' ? rawResponses : {};
    for (const sectionKey of Object.keys(normalized)) {
      const section = source[sectionKey];
      if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
      for (const [questionId, answers] of Object.entries(section)) {
        if (!Array.isArray(answers)) continue;
        normalized[sectionKey][questionId] = answers.map(a => String(a ?? '').trim());
      }
    }

    return normalized;
  }

  function hydrateSavedProgress(progress) {
    if (!progress || typeof progress !== 'object') return false;
    appState.responses = normalizeResponses(progress.responses);

    const rawStepIndex = Number(progress.stepIndex);
    if (!Number.isFinite(rawStepIndex)) return true;

    const maxRestorableIndex = Math.max(0, appState.steps.length - 2);
    appState.stepIndex = clamp(Math.floor(rawStepIndex), 0, maxRestorableIndex);
    return true;
  }

  function progressTimestampMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (value && typeof value.toMillis === 'function') {
      const millis = value.toMillis();
      if (Number.isFinite(millis)) return millis;
    }
    if (value && Number.isFinite(value.seconds)) {
      const nanos = Number.isFinite(value.nanoseconds) ? value.nanoseconds : 0;
      return (value.seconds * 1000) + Math.floor(nanos / 1e6);
    }
    return null;
  }

  function choosePreferredProgressDraft(remoteProgress, localProgress) {
    if (!remoteProgress && !localProgress) return null;
    if (!remoteProgress) return localProgress;
    if (!localProgress) return remoteProgress;

    const remoteMs = progressTimestampMs(remoteProgress.updatedAtMs || remoteProgress.updatedAt);
    const localMs = progressTimestampMs(localProgress.updatedAtMs || localProgress.updatedAt);

    if (Number.isFinite(remoteMs) && Number.isFinite(localMs)) {
      return remoteMs >= localMs ? remoteProgress : localProgress;
    }

    if (Number.isFinite(localMs)) return localProgress;
    if (Number.isFinite(remoteMs)) return remoteProgress;

    return localProgress;
  }

  function progressStorageKey() {
    return `${PROGRESS_STORAGE_PREFIX}${token}`;
  }

  function readLocalProgressDraft() {
    try {
      const raw = window.localStorage.getItem(progressStorageKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_err) {
      return null;
    }
  }

  function writeLocalProgressDraft(stepIndex) {
    try {
      window.localStorage.setItem(progressStorageKey(), JSON.stringify({
        stepIndex,
        responses: appState.responses,
        updatedAt: Date.now()
      }));
    } catch (_err) {
      void _err;
    }
  }

  function clearLocalProgressDraft() {
    try {
      window.localStorage.removeItem(progressStorageKey());
    } catch (_err) {
      void _err;
    }
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function updateProgress() {
    const step = appState.steps[appState.stepIndex] || null;
    let now = 0;
    let total = 0;
    if (step && step.globalQuestionTotal) {
      now = step.globalQuestionIndex;
      total = step.globalQuestionTotal;
    }

    const percent = total > 0 ? (now / total) * 100 : 0;
    if (elements.progressFill) elements.progressFill.style.width = `${clamp(percent, 0, 100)}%`;
    if (elements.progressBar) elements.progressBar.setAttribute('aria-valuenow', String(Math.round(percent)));
    if (elements.progressText) {
      elements.progressText.textContent = total > 0 ? `Question ${now} / ${total}` : '—';
    }
  }

  function cleanupRecordingIfStepMismatch(step) {
    const r = appState.recording;
    if (!r) return;
    if (!step || step.type !== 'speaking_question' || step.questionId !== r.questionId) {
      cleanupRecordingIfAny();
    }
  }

  function render() {
    const step = appState.steps[appState.stepIndex] || null;

    const stepIndexChanged = appState.lastRenderedStepIndex !== null && appState.lastRenderedStepIndex !== appState.stepIndex;
    if (stepIndexChanged) {
      cleanupRecordingIfAny();
    } else {
      cleanupRecordingIfStepMismatch(step);
    }
    appState.lastRenderedStepIndex = appState.stepIndex;

    updateProgress();
    if (!step) {
      renderError('Step not found.');
      return;
    }

    if (step.type === 'intro') {
      setSubtitle('Welcome');
      renderIntro(step);
      return;
    }
    if (step.type === 'section_intro') {
      setSubtitle(step.title);
      renderSectionIntro(step);
      return;
    }
    if (step.type === 'speaking_question') {
      setSubtitle(step.sectionTitle || 'Speaking');
      renderSpeakingQuestion(step);
      return;
    }
    if (step.type === 'mc_question') {
      setSubtitle(step.sectionTitle || 'Multiple Choice');
      renderMultipleChoiceQuestion(step);
      return;
    }
    if (step.type === 'fill_question') {
      setSubtitle(step.sectionTitle || 'Fill in the blanks');
      renderFillQuestion(step);
      return;
    }
    if (step.type === 'done') {
      setSubtitle('Submitted');
      renderDone(step);
      return;
    }

    renderError('Unsupported step type.');
  }

  function renderIntro(step) {
    const body = (step.body || []).map(line => `<li>${escapeHtml(line)}</li>`).join('');
    elements.card.innerHTML = `
      <h1 class="et-title">${escapeHtml(step.title || '')}</h1>
      <p class="et-subtitle">${escapeHtml(step.subtitle || '')}</p>
      <div class="et-instruction">
        <ul style="margin: 0; padding-left: 18px;">${body}</ul>
      </div>
      <div class="et-actions">
        <button id="et-next" class="btn btn-primary" type="button">${escapeHtml(step.cta || 'Next')}</button>
      </div>
    `;
    elements.card.querySelector('#et-next').addEventListener('click', () => nextStep());
  }

  function renderSectionIntro(step) {
    const extra = (step.extraVi || []).map(line => `<li>${escapeHtml(line)}</li>`).join('');
    elements.card.innerHTML = `
      <h2 class="et-title" style="font-size: 1.4rem;">${escapeHtml(step.title || '')}</h2>
      <p class="et-subtitle">${escapeHtml(step.instructionVi || '')}</p>
      ${extra ? `<div class="et-instruction"><ul style="margin: 0; padding-left: 18px;">${extra}</ul></div>` : ''}
      <div class="et-actions">
        <button id="et-start-section" class="btn btn-primary" type="button">${escapeHtml(step.cta || 'Start')}</button>
      </div>
    `;
    elements.card.querySelector('#et-start-section').addEventListener('click', () => nextStep());
  }

  function renderSpeakingQuestion(step) {
    const questionId = step.questionId;
    const rec = appState.speaking[questionId] || {};
    const hasBlob = !!rec.blob;
    const isRecording = !!(appState.recording
      && appState.recording.questionId === questionId
      && appState.recording.recorder
      && appState.recording.recorder.state === 'recording');
    const upload = appState.uploading && appState.uploading.questionId === questionId ? appState.uploading : null;
    const isUploading = !!upload;

    let controlsHtml = '';
    if (isUploading) {
      const busyLabel = upload?.phase === 'processing' ? 'Processing…' : 'Uploading…';
      controlsHtml = `<button class="btn btn-secondary" type="button" disabled>${escapeHtml(busyLabel)}</button>`;
    } else if (isRecording) {
      controlsHtml = `<button id="btn-stop-rec" class="btn btn-danger et-recording-live" type="button">Stop recording</button>`;
    } else if (hasBlob) {
      controlsHtml = `
        <button id="btn-record-again" class="btn btn-secondary" type="button">Record again</button>
        <button id="btn-playback" class="btn btn-secondary" type="button">Playback</button>
      `;
    } else {
      controlsHtml = `<button id="btn-start-rec" class="btn btn-primary" type="button">Start recording</button>`;
    }

    const uploadTitle = upload?.phase === 'processing' ? 'Processing audio…' : 'Uploading audio…';
    const uploadPercentText = upload?.phase === 'uploading' && typeof upload?.percent === 'number'
      ? `${clamp(upload.percent, 0, 100)}%`
      : '';
    const uploadFillClass = upload?.phase === 'processing' ? 'et-upload-fill indeterminate' : 'et-upload-fill';
    const uploadFillStyle = upload?.phase === 'uploading' && typeof upload?.percent === 'number'
      ? `style="width:${clamp(upload.percent, 0, 100)}%;"`
      : '';
    const uploadSubtitle = upload?.phase === 'processing'
      ? 'Upload finished. Please wait while we process and score your recording.'
      : 'Uploading audio, please keep this tab open.';

    const uploadHtml = isUploading
      ? `
        <div id="et-upload" class="et-upload" role="status" aria-live="polite">
          <div class="et-upload-row">
            <div id="et-upload-title" class="et-upload-title">${escapeHtml(uploadTitle)}</div>
            <div id="et-upload-percent" class="et-upload-percent">${escapeHtml(uploadPercentText)}</div>
          </div>
          <div class="et-upload-bar">
            <div id="et-upload-fill" class="${uploadFillClass}" ${uploadFillStyle}></div>
          </div>
          <div id="et-upload-subtitle" class="et-upload-subtitle">${escapeHtml(uploadSubtitle)}</div>
        </div>
      `
      : '';

    const submitDisabledAttr = (isRecording || isUploading) ? 'disabled' : '';
    const submitText = isUploading
      ? (upload?.phase === 'processing' ? 'Processing…' : 'Uploading…')
      : 'Submit';

    elements.card.innerHTML = `
      <div class="et-section-badge">${escapeHtml(step.sectionTitle || '')} • Q${escapeHtml(String(step.questionNumber || ''))}</div>
      <div class="et-instruction">${escapeHtml(step.instructionVi || '')}</div>
      <p class="et-passage">${escapeHtml(step.text || '')}</p>

      <div class="et-audio-controls">
        ${controlsHtml}
      </div>

      <div class="et-audio-preview" ${hasBlob ? '' : 'style="display:none;"'}>
        <div style="font-weight:700; margin-bottom:8px;">Your recording</div>
        <audio id="audio-preview" controls src="${hasBlob ? escapeHtml(rec.audioUrl) : ''}"></audio>
      </div>

      ${uploadHtml}

      <div class="et-actions">
        <button id="btn-submit" class="btn btn-success" type="button" ${submitDisabledAttr}>${escapeHtml(submitText)}</button>
      </div>
    `;

    const startBtn = elements.card.querySelector('#btn-start-rec');
    const stopBtn = elements.card.querySelector('#btn-stop-rec');
    const recordAgainBtn = elements.card.querySelector('#btn-record-again');
    const playbackBtn = elements.card.querySelector('#btn-playback');
    const submitBtn = elements.card.querySelector('#btn-submit');
    const audioEl = elements.card.querySelector('#audio-preview');

    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        try {
          await startRecording(questionId);
          render();
        } catch (e) {
          console.error(e);
          void showInfoModal({
            title: 'Lỗi micro',
            message: e?.message || 'Không thể truy cập micro.',
            buttonText: 'OK'
          });
          startBtn.disabled = false;
        }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        stopBtn.disabled = true;
        stopRecording();
      });
    }

    if (recordAgainBtn) {
      recordAgainBtn.addEventListener('click', async () => {
        recordAgainBtn.disabled = true;
        try {
          clearSpeakingRecording(questionId);
          await startRecording(questionId);
          render();
        } catch (e) {
          console.error(e);
          void showInfoModal({
            title: 'Lỗi micro',
            message: e?.message || 'Không thể truy cập micro.',
            buttonText: 'OK'
          });
          recordAgainBtn.disabled = false;
        }
      });
    }

    if (playbackBtn) {
      playbackBtn.addEventListener('click', () => {
        if (audioEl) audioEl.play().catch(() => { });
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        submitSpeaking(questionId).catch((e) => {
          console.error(e);
          void showInfoModal({
            title: 'Lỗi nộp bài',
            message: e?.message || 'Không thể nộp câu trả lời nói.',
            buttonText: 'OK'
          });
        });
      });
    }
  }

  function renderMultipleChoiceQuestion(step) {
    const html = renderParts(step.parts, 'mc', step.questionId);

    elements.card.innerHTML = `
      <div class="et-section-badge">${escapeHtml(step.sectionTitle || '')} • Q${escapeHtml(String(step.questionNumber || ''))}</div>
      <div class="et-instruction">${escapeHtml(step.instructionVi || '')}</div>
      <p class="et-passage">${html}</p>
      <div class="et-actions">
        <button id="btn-submit" class="btn btn-success" type="button">Submit</button>
      </div>
    `;

    hydrateMcDefaults(step);

    elements.card.querySelector('#btn-submit').addEventListener('click', () => {
      submitMultipleChoice(step).catch((e) => {
        console.error(e);
        void showInfoModal({
          title: 'Lỗi nộp đáp án',
          message: e?.message || 'Không thể nộp đáp án trắc nghiệm.',
          buttonText: 'OK'
        });
      });
    });
  }

  function renderFillQuestion(step) {
    const html = renderParts(step.parts, 'fill', step.questionId);
    const fallbackAudioUrl = LISTENING_AUDIO_BY_QUESTION[String(step.questionId || '')] || '';
    const rawAudioUrl = step.audioUrl || fallbackAudioUrl;
    const audioSrc = rawAudioUrl ? encodeURI(String(rawAudioUrl)) : '';
    const audioBlock = audioSrc
      ? `
        <div class="et-audio-block">
          <div class="et-audio-title">Audio</div>
          <audio class="et-audio-player" controls preload="none" src="${escapeHtml(audioSrc)}"></audio>
          <div class="et-audio-note">Bạn có thể nghe lại nhiều lần trước khi nộp.</div>
        </div>
      `
      : '';

    elements.card.innerHTML = `
      <div class="et-section-badge">${escapeHtml(step.sectionTitle || '')} • Q${escapeHtml(String(step.questionNumber || ''))}</div>
      <div class="et-instruction">${escapeHtml(step.instructionVi || '')}</div>
      ${audioBlock}
      <p class="et-passage">${html}</p>
      <div class="et-actions">
        <button id="btn-submit" class="btn btn-success" type="button">Submit</button>
      </div>
    `;

    hydrateFillDefaults(step);

    const audioEl = elements.card.querySelector('.et-audio-player');
    if (audioEl && rawAudioUrl && window.MediaUrlResolver && typeof window.MediaUrlResolver.resolveAudioUrl === 'function') {
      window.MediaUrlResolver.resolveAudioUrl(rawAudioUrl, { mode: 'Entrance-Test' }).then((resolvedUrl) => {
        if (resolvedUrl) audioEl.src = resolvedUrl;
      }).catch(() => {});
    }

    elements.card.querySelector('#btn-submit').addEventListener('click', () => {
      submitFill(step).catch((e) => {
        console.error(e);
        void showInfoModal({
          title: 'Lỗi nộp đáp án',
          message: e?.message || 'Không thể nộp đáp án điền từ.',
          buttonText: 'OK'
        });
      });
    });
  }

  function renderDone(step) {
    const body = (step.body || []).map(line => `<li>${escapeHtml(line)}</li>`).join('');
    elements.card.innerHTML = `
      <h1 class="et-title">${escapeHtml(step.title || '')}</h1>
      <p class="et-subtitle">${escapeHtml(step.subtitle || '')}</p>
      <div class="et-instruction">
        <ul style="margin: 0; padding-left: 18px;">${body}</ul>
      </div>
    `;
    if (elements.progressFill) elements.progressFill.style.width = '100%';
    if (elements.progressText) elements.progressText.textContent = 'Completed';
  }

  function renderError(message) {
    setSubtitle('Error');
    if (!elements.card) return;
    elements.card.innerHTML = `
      <h1 class="et-title">Link error</h1>
      <div class="et-error">${escapeHtml(message || 'Something went wrong.')}</div>
    `;
    if (elements.progressText) elements.progressText.textContent = '—';
    if (elements.progressFill) elements.progressFill.style.width = '0%';
  }

  function nextStep() {
    appState.stepIndex = clamp(appState.stepIndex + 1, 0, appState.steps.length - 1);
    render();
  }

  async function saveProgressDraft(nextStepIndex) {
    writeLocalProgressDraft(nextStepIndex);

    try {
      const res = await fetch('/api/entrance-tests/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          stepIndex: nextStepIndex,
          responses: appState.responses
        }),
        cache: 'no-store'
      });

      if (res.status === 404) {
        return;
      }

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        console.warn('[EntranceTest] Progress API failed, using local draft only.', json?.message || res.statusText);
      }
    } catch (error) {
      console.warn('[EntranceTest] Progress API unavailable, using local draft only.', error?.message || String(error));
    }
  }

  async function advanceWithProgress() {
    const nextStepIndex = clamp(appState.stepIndex + 1, 0, appState.steps.length - 1);
    await saveProgressDraft(nextStepIndex);
    appState.stepIndex = nextStepIndex;
    render();
  }

  function isLastQuestionStepIndex(idx) {
    // last question = last step before done
    for (let i = appState.steps.length - 1; i >= 0; i--) {
      if (['speaking_question', 'mc_question', 'fill_question'].includes(appState.steps[i].type)) {
        return i === idx;
      }
    }
    return false;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str || '');
    return div.innerHTML;
  }

  function ensureModalOverlay() {
    let overlay = document.getElementById('et-modal-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'et-modal-overlay';
    overlay.className = 'et-modal-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    document.body.appendChild(overlay);
    return overlay;
  }

  function closeModalOverlay() {
    const overlay = document.getElementById('et-modal-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '';
    try {
      document.body.style.overflow = '';
    } catch (_err) { void _err; }
  }

  function showInfoModal({ title, message, buttonText }) {
    const overlay = ensureModalOverlay();
    overlay.innerHTML = `
      <div class="et-modal" role="dialog" aria-modal="true" aria-labelledby="et-modal-title">
        <div class="et-modal-header">
          <div id="et-modal-title" class="et-modal-title">${escapeHtml(title || 'Thông báo')}</div>
          <button type="button" class="et-modal-close" id="et-modal-close" aria-label="Đóng">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
            </svg>
          </button>
        </div>
        <div class="et-modal-body">
          <div>${escapeHtml(message || '')}</div>
        </div>
        <div class="et-modal-actions">
          <button type="button" class="btn btn-primary" id="et-modal-ok">${escapeHtml(buttonText || 'OK')}</button>
        </div>
      </div>
    `;

    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    try {
      document.body.style.overflow = 'hidden';
    } catch (_err) { void _err; }

    return new Promise((resolve) => {
      const okBtn = overlay.querySelector('#et-modal-ok');
      const closeBtn = overlay.querySelector('#et-modal-close');
      const onOverlayClick = (evt) => {
        if (evt.target === overlay) finish();
      };

      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.removeEventListener('click', onOverlayClick);
        closeModalOverlay();
      };

      const finish = () => {
        cleanup();
        resolve();
      };

      const onKeyDown = (evt) => {
        if (evt.key === 'Escape') {
          evt.preventDefault();
          finish();
        }
      };

      document.addEventListener('keydown', onKeyDown);

      if (okBtn) okBtn.addEventListener('click', finish);
      if (closeBtn) closeBtn.addEventListener('click', finish);
      overlay.addEventListener('click', onOverlayClick);

      if (okBtn) okBtn.focus();
    });
  }

  function showSkipMissingBlanksModal({ missingCount, totalCount }) {
    const missing = Number(missingCount) || 0;
    const total = Number(totalCount) || 0;
    if (missing <= 0) return Promise.resolve(false);

    const overlay = ensureModalOverlay();
    overlay.innerHTML = `
       <div class="et-modal" role="dialog" aria-modal="true" aria-labelledby="et-modal-title">
         <div class="et-modal-header">
           <div id="et-modal-title" class="et-modal-title">Chưa điền hết chỗ trống</div>
           <button type="button" class="et-modal-close" id="et-modal-close" aria-label="Đóng">
             <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
               <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
             </svg>
           </button>
         </div>
         <div class="et-modal-body">
           <div>Bạn còn <strong>${escapeHtml(String(missing))}</strong> chỗ trống chưa trả lời (trong tổng số ${escapeHtml(String(total))}).</div>
           <div class="et-modal-note">Bạn có thể tiếp tục sang câu tiếp theo và quay lại sau. Chỗ trống chưa trả lời sẽ bị tính sai.</div>
         </div>
         <div class="et-modal-actions">
           <button type="button" class="btn btn-secondary" id="et-modal-back">Quay lại</button>
           <button type="button" class="btn btn-primary" id="et-modal-skip">Bỏ qua &amp; tiếp tục</button>
         </div>
       </div>
     `;

    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    try {
      document.body.style.overflow = 'hidden';
    } catch (_err) { void _err; }

    return new Promise((resolve) => {
      const backBtn = overlay.querySelector('#et-modal-back');
      const skipBtn = overlay.querySelector('#et-modal-skip');
      const closeBtn = overlay.querySelector('#et-modal-close');
      const onOverlayClick = (evt) => {
        if (evt.target === overlay) finish(false);
      };

      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.removeEventListener('click', onOverlayClick);
        closeModalOverlay();
      };

      const finish = (shouldSkip) => {
        cleanup();
        resolve(!!shouldSkip);
      };

      const onKeyDown = (evt) => {
        if (evt.key === 'Escape') {
          evt.preventDefault();
          finish(false);
        }
      };

      document.addEventListener('keydown', onKeyDown);

      if (backBtn) backBtn.addEventListener('click', () => finish(false));
      if (skipBtn) skipBtn.addEventListener('click', () => finish(true));
      if (closeBtn) closeBtn.addEventListener('click', () => finish(false));
      overlay.addEventListener('click', onOverlayClick);

      if (skipBtn) skipBtn.focus();
    });
  }

  function renderParts(parts, kind, questionId) {
    const safeParts = Array.isArray(parts) ? parts : [];
    const stored = kind === 'mc'
      ? (appState.responses[getSectionKeyForQuestion(questionId)]?.[questionId] || [])
      : (appState.responses.listen_write?.[questionId] || []);

    let blankCounter = 0;
    return safeParts.map((p) => {
      if (p.type === 'text') return escapeHtml(p.text || '');
      if (p.type === 'blank') {
        blankCounter++;
        const blankId = p.blankId;
        if (kind === 'mc') {
          const prev = stored[blankCounter - 1] || '';
          const opts = Array.isArray(p.options) ? p.options : [];
          const optionsHtml = ['<option value="" disabled selected hidden></option>']
            .concat(opts.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`))
            .join('');
          const selectedAttr = prev ? ` data-selected="${escapeHtml(prev)}"` : '';
          return `<select class="et-blank-select" data-blank-id="${escapeHtml(blankId)}"${selectedAttr}>${optionsHtml}</select>`;
        }
        const prevFill = stored[blankCounter - 1] || '';
        return `<input class="et-blank-input" data-blank-id="${escapeHtml(blankId)}" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(prevFill)}" />`;
      }
      return '';
    }).join('');
  }

  function getSectionKeyForQuestion(questionId) {
    if (String(questionId || '').startsWith('vocab_')) return 'vocab';
    if (String(questionId || '').startsWith('grammar_')) return 'grammar';
    return null;
  }

  function hydrateMcDefaults(step) {
    const sectionKey = getSectionKeyForQuestion(step.questionId);
    if (!sectionKey) return;
    const stored = appState.responses[sectionKey]?.[step.questionId] || [];
    const selects = Array.from(elements.card.querySelectorAll('select[data-blank-id]'));
    selects.forEach((sel, idx) => {
      const v = stored[idx];
      if (v) {
        sel.value = v;
      } else {
        sel.selectedIndex = 0;
      }
    });
  }

  function hydrateFillDefaults(step) {
    const stored = appState.responses.listen_write?.[step.questionId] || [];
    const inputs = Array.from(elements.card.querySelectorAll('input[data-blank-id]'));
    inputs.forEach((inp, idx) => {
      const v = stored[idx];
      if (v) inp.value = v;
    });
  }

  async function submitMultipleChoice(step) {
    const sectionKey = getSectionKeyForQuestion(step.questionId);
    if (!sectionKey) throw new Error('Invalid section.');

    const selects = Array.from(elements.card.querySelectorAll('select[data-blank-id]'));
    if (selects.length === 0) throw new Error('No blanks found.');

    const answers = selects.map(s => String(s.value || '').trim());
    const missingIdx = answers.findIndex(a => !a);
    if (missingIdx !== -1) {
      const missingCount = answers.filter(a => !a).length;
      const shouldSkip = await showSkipMissingBlanksModal({ missingCount, totalCount: answers.length });
      if (!shouldSkip) {
        const firstMissing = selects[missingIdx];
        if (firstMissing && typeof firstMissing.focus === 'function') firstMissing.focus();
        return;
      }
    }

    appState.responses[sectionKey][step.questionId] = answers;

    if (isLastQuestionStepIndex(appState.stepIndex)) {
      await finalizeSubmit();
      return;
    }
    await advanceWithProgress();
  }

  async function submitFill(step) {
    const inputs = Array.from(elements.card.querySelectorAll('input[data-blank-id]'));
    if (inputs.length === 0) throw new Error('No blanks found.');

    const answers = inputs.map(i => String(i.value || '').trim());
    const missingIdx = answers.findIndex(a => !a);
    if (missingIdx !== -1) {
      const missingCount = answers.filter(a => !a).length;
      const shouldSkip = await showSkipMissingBlanksModal({ missingCount, totalCount: answers.length });
      if (!shouldSkip) {
        const firstMissing = inputs[missingIdx];
        if (firstMissing && typeof firstMissing.focus === 'function') firstMissing.focus();
        return;
      }
    }

    appState.responses.listen_write[step.questionId] = answers;

    if (isLastQuestionStepIndex(appState.stepIndex)) {
      await finalizeSubmit();
      return;
    }
    await advanceWithProgress();
  }

  function pickAudioMimeType() {
    // Safari / iOS WebKit produces headerless WebM without duration tags which cannot
    // play in Safari's native <audio> element. Prioritize audio/mp4 for Apple/Safari devices.
    const isAppleOrSafari = /iPad|iPhone|iPod|Macintosh/i.test(navigator.userAgent || '')
      || /^((?!chrome|android).)*safari/i.test(navigator.userAgent || '');

    const candidates = isAppleOrSafari
      ? [
          'audio/mp4',
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus',
          'audio/ogg'
        ]
      : [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',
          'audio/ogg;codecs=opus',
          'audio/ogg'
        ];

    for (const mt of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mt)) {
        return mt;
      }
    }
    return '';
  }

  /**
   * Client-side DSP preprocessing for entrance test speaking recordings.
   * Applies: 80 Hz high-pass → 16 kHz mono resample → -3 dBFS normalize → lead/trail trim → WAV.
   * Returns { wavBlob, stats } where stats includes duration and peak info.
   * Falls back to raw blob on processing failure or 3-second timeout (iOS Safari screen-lock).
   */
  async function prepareEntranceTestBlob(rawBlob) {
    if (window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function') {
      try {
        const result = await window.AudioDspPipeline.enhance(rawBlob, {
          targetSampleRate: 16000,
          highpassFreq: 80,
          targetPeakDb: -3,
          trim: true,
          paddingMs: 150,
          createUrl: false
        });
        return {
          wavBlob: result.wavBlob,
          stats: result.stats
        };
      } catch (err) {
        console.warn('[EntranceTest] AudioDspPipeline enhancement failed, falling back to raw blob:', err);
        return { wavBlob: rawBlob, stats: null };
      }
    }

    let audioContext = null;
    try {
      const arrayBuffer = await rawBlob.arrayBuffer();
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return { wavBlob: rawBlob, stats: null };
      audioContext = new AudioContextCtor();
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const originalDurationMs = Math.round(decoded.duration * 1000);

      const outputLength = Math.ceil(decoded.duration * 16000);
      const offline = new OfflineAudioContext(1, outputLength, 16000);

      // DSP chain: source → 80 Hz high-pass → destination
      const source = offline.createBufferSource();
      source.buffer = decoded;

      const highpass = offline.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 80;
      highpass.Q.value = 0.707; // Butterworth

      source.connect(highpass);
      highpass.connect(offline.destination);
      source.start(0);

      // 3-second timeout fallback for iOS Safari
      let rendered;
      try {
        rendered = await Promise.race([
          offline.startRendering(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('OfflineAudioContext timeout')), 3000)
          )
        ]);
      } catch (_) {
        console.warn('[EntranceTest] OfflineAudioContext timed out, using basic resample');
        const fallback = new OfflineAudioContext(1, outputLength, 16000);
        const fbSrc = fallback.createBufferSource();
        fbSrc.buffer = decoded;
        fbSrc.connect(fallback.destination);
        fbSrc.start(0);
        rendered = await Promise.race([
          fallback.startRendering(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Fallback timeout')), 3000))
        ]).catch(() => decoded);
      }

      // Close decoding audioContext as soon as rendering completes
      if (typeof audioContext.close === 'function') {
        await audioContext.close().catch(() => {});
        audioContext = null;
      }

      // Peak normalization to -3 dBFS
      const channelData = rendered.getChannelData(0);
      let maxPeak = 0;
      for (let i = 0; i < channelData.length; i++) {
        const absVal = Math.abs(channelData[i]);
        if (absVal > maxPeak) maxPeak = absVal;
      }
      const peakBefore = maxPeak;
      if (maxPeak > 0) {
        const targetPeak = Math.pow(10, -3 / 20); // ~0.7079
        const gain = targetPeak / maxPeak;
        if (gain < 0.99 || gain > 1.01) {
          for (let i = 0; i < channelData.length; i++) {
            channelData[i] = Math.max(-1, Math.min(1, channelData[i] * gain));
          }
        }
      }

      // Leading/trailing silence trimming
      let trimmedBuffer = rendered;
      const frameSize = Math.max(1, Math.round(16000 * 0.01));
      const frameRms = [];
      for (let offset = 0; offset < channelData.length; offset += frameSize) {
        const end = Math.min(channelData.length, offset + frameSize);
        let energy = 0;
        for (let i = offset; i < end; i++) {
          energy += channelData[i] * channelData[i];
        }
        frameRms.push(Math.sqrt(energy / Math.max(1, end - offset)));
      }
      const maxRms = frameRms.reduce((h, v) => Math.max(h, v), 0);
      if (maxRms >= 0.01) {
        const threshold = Math.max(0.008, maxRms * 0.18);
        let firstFrame = -1;
        let lastFrame = -1;
        for (let i = 0; i < frameRms.length; i++) {
          if (frameRms[i] >= threshold) {
            if (firstFrame === -1) firstFrame = i;
            lastFrame = i;
          }
        }
        if (firstFrame !== -1 && lastFrame !== -1) {
          const padSamples = Math.round(0.15 * 16000); // 150ms padding
          const trimStart = Math.max(0, firstFrame * frameSize - padSamples);
          const trimEnd = Math.min(channelData.length, (lastFrame + 1) * frameSize + padSamples);
          const trimLength = trimEnd - trimStart;
          if (trimLength > 0 && trimLength < channelData.length * 0.9) {
            let tb = null;
            if (typeof AudioBuffer === 'function') {
              try {
                tb = new AudioBuffer({ numberOfChannels: 1, length: trimLength, sampleRate: 16000 });
              } catch (_) { tb = null; }
            }
            if (!tb) {
              const ctx = new AudioContextCtor();
              try {
                tb = ctx.createBuffer(1, trimLength, 16000);
              } finally {
                if (typeof ctx.close === 'function') ctx.close().catch(() => {});
              }
            }
            if (tb) {
              trimmedBuffer = tb;
              const trimData = trimmedBuffer.getChannelData(0);
              for (let i = 0; i < trimLength; i++) {
                trimData[i] = channelData[trimStart + i];
              }
            }
          }
        }
      }

      // Encode as WAV
      const trimmedData = trimmedBuffer.getChannelData(0);
      const dataLength = trimmedData.length;
      const wavBuf = new ArrayBuffer(44 + dataLength * 2);
      const view = new DataView(wavBuf);
      const writeString = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + dataLength * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, dataLength * 2, true);
      let offset = 44;
      for (let i = 0; i < dataLength; i++) {
        const s = Math.max(-1, Math.min(1, trimmedData[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }

      const wavBlob = new Blob([wavBuf], { type: 'audio/wav' });
      const trimmedDurationMs = Math.round((dataLength / 16000) * 1000);
      return {
        wavBlob,
        stats: { originalDurationMs, trimmedDurationMs, peakBefore, peakAfter: Math.pow(10, -3 / 20) }
      };
    } catch (err) {
      console.warn('[EntranceTest] Audio preprocessing failed, using raw blob:', err);
      return { wavBlob: rawBlob, stats: null };
    } finally {
      if (audioContext && typeof audioContext.close === 'function') {
        audioContext.close().catch(() => {});
      }
    }
  }

  function clearSpeakingRecording(questionId) {
    const prev = appState.speaking[questionId] || null;
    const audioUrl = prev?.audioUrl;
    if (audioUrl) {
      try {
        URL.revokeObjectURL(audioUrl);
      } catch (_err) { void _err; }
    }
    delete appState.speaking[questionId];
  }

  async function startRecording(questionId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone is not supported in this browser.');
    }

    if (appState.recording?.recorder && appState.recording.recorder.state === 'recording') {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickAudioMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks = [];

    recorder.addEventListener('dataavailable', (evt) => {
      if (evt.data && evt.data.size > 0) chunks.push(evt.data);
    });

    recorder.addEventListener('stop', () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      const audioUrl = URL.createObjectURL(blob);
      appState.speaking[questionId] = { blob, audioUrl, mimeType: blob.type || 'audio/webm' };
      appState.recording = null;
      render();

      // Asynchronously preprocess for cleaner local playback (non-blocking)
      prepareEntranceTestBlob(blob).then(({ wavBlob, stats }) => {
        const current = appState.speaking[questionId];
        if (!current || current.uploaded) return; // Already submitted, skip update
        if (stats && wavBlob) {
          const processedUrl = URL.createObjectURL(wavBlob);
          // Update the playback blob and URL to the processed version
          appState.speaking[questionId] = {
            ...current,
            blob: wavBlob,
            rawBlob: blob,
            audioUrl: processedUrl,
            mimeType: 'audio/wav',
            isPreprocessed: true,
            stats
          };
          // Revoke old URL
          try { URL.revokeObjectURL(audioUrl); } catch (_) { /* ignore */ }
          // Re-render to update the audio element src
          render();
        }
      }).catch(() => { /* Preprocessing failed silently, raw blob remains */ });
    });

    appState.recording = { questionId, recorder, stream, chunks };
    recorder.start();
  }

  function stopRecording() {
    const r = appState.recording;
    if (!r) return;
    try {
      if (r.recorder && r.recorder.state === 'recording') {
        r.recorder.stop();
      }
    } catch (_err) { void _err; }
    try {
      if (r.stream) r.stream.getTracks().forEach(t => t.stop());
    } catch (_err) { void _err; }
  }

  function cleanupRecordingIfAny() {
    const r = appState.recording;
    if (!r) return;
    try {
      if (r.recorder && r.recorder.state === 'recording') {
        r.recorder.stop();
      }
    } catch (_err) { void _err; }
    try {
      if (r.stream) r.stream.getTracks().forEach(t => t.stop());
    } catch (_err) { void _err; }
    appState.recording = null;
  }

  function updateSpeakingUploadUi() {
    const upload = appState.uploading;
    if (!upload) return;

    const wrap = elements.card ? elements.card.querySelector('#et-upload') : null;
    if (!wrap) return;

    const titleEl = wrap.querySelector('#et-upload-title');
    const percentEl = wrap.querySelector('#et-upload-percent');
    const fillEl = wrap.querySelector('#et-upload-fill');
    const subtitleEl = wrap.querySelector('#et-upload-subtitle');
    const submitBtn = elements.card.querySelector('#btn-submit');

    const title = upload.phase === 'processing' ? 'Processing audio…'
      : upload.phase === 'formatting' ? 'Formatting audio…'
      : 'Uploading audio…';
    const percentText = upload.phase === 'uploading' && typeof upload.percent === 'number'
      ? `${clamp(upload.percent, 0, 100)}%`
      : '';
    const subtitle = upload.phase === 'processing'
      ? 'Upload finished. Please wait while we process and score your recording.'
      : upload.phase === 'formatting'
        ? 'Enhancing audio clarity before upload…'
        : 'Uploading audio, please keep this tab open.';

    if (titleEl) titleEl.textContent = title;
    if (percentEl) percentEl.textContent = percentText;
    if (subtitleEl) subtitleEl.textContent = subtitle;

    if (fillEl) {
      const shouldIndeterminate = upload.phase === 'processing' || upload.phase === 'formatting';
      fillEl.classList.toggle('indeterminate', shouldIndeterminate);
      if (shouldIndeterminate) {
        fillEl.style.width = '';
      } else if (typeof upload.percent === 'number') {
        fillEl.style.width = `${clamp(upload.percent, 0, 100)}%`;
      }
    }

    if (submitBtn) {
      submitBtn.textContent = upload.phase === 'processing' ? 'Processing…'
        : upload.phase === 'formatting' ? 'Formatting…'
        : 'Uploading…';
    }
  }

  function xhrUploadAudio({ url, blob, contentType, onProgress, onUploadComplete }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.responseType = 'json';
      xhr.timeout = 180000;

      try {
        if (contentType) xhr.setRequestHeader('Content-Type', contentType);
      } catch (_err) { void _err; }

      if (xhr.upload) {
        xhr.upload.onprogress = (evt) => {
          if (typeof onProgress !== 'function') return;
          if (evt.lengthComputable && evt.total > 0) {
            const pct = Math.round((evt.loaded / evt.total) * 100);
            onProgress(pct);
          } else {
            onProgress(null);
          }
        };

        xhr.upload.onload = () => {
          if (typeof onUploadComplete === 'function') onUploadComplete();
        };
      }

      xhr.onload = () => {
        const json = xhr.response || null;
        const ok = xhr.status >= 200 && xhr.status < 300 && json && json.success;
        if (ok) {
          resolve(json);
          return;
        }
        const msg = json?.message || `Upload failed (${xhr.status})`;
        reject(new Error(msg));
      };

      xhr.onerror = () => reject(new Error('Network error while uploading audio.'));
      xhr.ontimeout = () => reject(new Error('Upload timed out. Please try again.'));

      xhr.send(blob);
    });
  }

  async function submitSpeaking(questionId) {
    const rec = appState.speaking[questionId] || null;
    if (!rec?.blob) {
      await showInfoModal({
        title: 'Chưa có bản thu âm',
        message: 'Bạn cần thu âm giọng nói trước khi nộp câu này. Vui lòng nhấn “Start recording”, sau đó “Stop recording”, rồi nhấn “Submit”.',
        buttonText: 'OK'
      });
      const startBtn = elements.card ? elements.card.querySelector('#btn-start-rec') : null;
      if (startBtn && typeof startBtn.focus === 'function') startBtn.focus();
      return;
    }

    if (appState.recording?.recorder && appState.recording.recorder.state === 'recording') {
      await showInfoModal({
        title: 'Đang thu âm',
        message: 'Vui lòng nhấn “Stop recording” trước khi nộp câu này.',
        buttonText: 'OK'
      });
      const stopBtn = elements.card ? elements.card.querySelector('#btn-stop-rec') : null;
      if (stopBtn && typeof stopBtn.focus === 'function') stopBtn.focus();
      return;
    }

    if (appState.uploading) {
      return;
    }

    appState.uploading = { questionId, phase: 'formatting', percent: 0 };
    render();

    try {
      // Client-side DSP preprocessing: high-pass, normalize, trim, convert to 16kHz WAV
      // If audio was already preprocessed by the stop event handler, reuse it directly
      let uploadBlob = rec.blob;
      let uploadContentType = rec.mimeType || rec.blob.type || 'application/octet-stream';
      let stats = rec.stats || null;

      if (!rec.isPreprocessed) {
        const prepResult = await prepareEntranceTestBlob(rec.rawBlob || rec.blob);
        if (prepResult && prepResult.wavBlob && prepResult.stats) {
          uploadBlob = prepResult.wavBlob;
          uploadContentType = 'audio/wav';
          stats = prepResult.stats;
        }
      } else {
        uploadContentType = 'audio/wav';
      }

      if (stats) {
        /* eslint-disable-next-line no-console */
        console.log('[EntranceTest] Audio preprocessed:', stats);
      }

      if (!appState.uploading || appState.uploading.questionId !== questionId) return;
      appState.uploading.phase = 'uploading';
      appState.uploading.percent = 0;
      updateSpeakingUploadUi();

      const url = `/api/entrance-tests/speaking/upload?token=${encodeURIComponent(token)}&questionId=${encodeURIComponent(questionId)}`;
      const json = await xhrUploadAudio({
        url,
        blob: uploadBlob,
        contentType: uploadContentType,
        onProgress: (pct) => {
          if (!appState.uploading || appState.uploading.questionId !== questionId) return;
          if (typeof pct === 'number') {
            appState.uploading.phase = 'uploading';
            appState.uploading.percent = clamp(pct, 0, 100);
            updateSpeakingUploadUi();
          }
        },
        onUploadComplete: () => {
          if (!appState.uploading || appState.uploading.questionId !== questionId) return;
          appState.uploading.phase = 'processing';
          appState.uploading.percent = 100;
          updateSpeakingUploadUi();
        }
      });

      appState.speaking[questionId] = {
        ...rec,
        uploaded: true,
        transcript: json.transcript || null,
        accuracyPercent: typeof json.accuracyPercent === 'number' ? json.accuracyPercent : null,
        asrError: json.asrError || null
      };

      appState.uploading = null;

      if (isLastQuestionStepIndex(appState.stepIndex)) {
        await finalizeSubmit();
        return;
      }

      await advanceWithProgress();
    } catch (error) {
      appState.uploading = null;
      render();
      throw error;
    }
  }

  async function finalizeSubmit() {
    const btn = elements.card.querySelector('#btn-submit');
    const originalText = btn ? btn.textContent : 'Submit';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting...';
    }
    try {
      const res = await fetch('/api/entrance-tests/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          responses: appState.responses
        }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const msg = json?.message || 'Submit failed.';
        throw new Error(msg);
      }

      clearLocalProgressDraft();

      // Move to Thank You
      appState.stepIndex = appState.steps.length - 1;
      render();
    } catch (error) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      render();
      throw error;
    }
  }
})();
