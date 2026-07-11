(function () {
  'use strict';

  const API_ROOT = '/api/practice-attempts';
  const SAVE_ENDPOINT = '/api/practice-attempts/save';
  const PREPARE_ENDPOINT = '/api/practice-attempts/prepare';
  const DEFAULT_MEDIA_SLOT = 'student';

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanString(value, maxLen) {
    const text = String(value || '').trim();
    if (!text) return null;
    return Number.isFinite(maxLen) && maxLen > 0 ? text.slice(0, maxLen) : text;
  }

  function isPteScope() {
    const path = String(window.location?.pathname || '').toLowerCase();
    const isLegacyPteWritingRoute = /^\/practice\/writing\/(essay|swt)(\/|$)/.test(path);
    if ((!window.PracticeScopeManager || PracticeScopeManager.getScope() !== 'pte') && !isLegacyPteWritingRoute) return false;
    return true;
  }

  function getCurrentUser() {
    try {
      return window.__FIREBASE_INTERNAL__?.auth?.currentUser 
        || window.auth?.currentUser 
        || window.firebase?.auth?.().currentUser 
        || null;
    } catch (_) {
      return null;
    }
  }

  async function getAuthHeaders() {
    const user = getCurrentUser();
    if (!user || typeof user.getIdToken !== 'function') return null;
    const token = await user.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  async function apiFetch(path, options = {}) {
    const headers = await getAuthHeaders();
    if (!headers) return { skipped: true, reason: 'guest' };
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const error = new Error(payload.message || `Archive request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload.data || payload;
  }

  function extensionForBlob(blob) {
    const type = String(blob?.type || '').toLowerCase();
    if (type.includes('wav')) return 'wav';
    if (type.includes('webm')) return 'webm';
    return 'webm';
  }

  function normalizePositiveDurationMs(value) {
    const durationMs = Number(value);
    return Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null;
  }

  function normalizeMediaInput(media) {
    const list = Array.isArray(media) ? media : (media ? [media] : []);
    return list
      .map((item, index) => {
        const blob = item instanceof Blob ? item : item?.blob;
        if (!(blob instanceof Blob)) return null;
        const ext = extensionForBlob(blob);
        const slot = cleanString(item?.slot || item?.kind || DEFAULT_MEDIA_SLOT, 64) || DEFAULT_MEDIA_SLOT;
        const slotFile = cleanString(item?.slotFile || item?.fileName, 128) || `${slot}.${ext}`;
        return {
          slot,
          label: cleanString(item?.label, 120) || 'Student recording',
          slotFile,
          contentType: cleanString(item?.contentType || blob.type, 80) || (ext === 'wav' ? 'audio/wav' : 'audio/webm'),
          clientReportedDurationMs: normalizePositiveDurationMs(item?.durationMs ?? item?.clientReportedDurationMs),
          blob,
          index
        };
      })
      .filter(Boolean);
  }

  function isWebmMedia(item) {
    return String(item?.contentType || item?.blob?.type || '').toLowerCase().includes('webm')
      || String(item?.slotFile || '').toLowerCase().endsWith('.webm');
  }

  function readBlobDurationMs(blob) {
    return new Promise((resolve) => {
      const urlApi = window.URL || window.webkitURL;
      if (!(blob instanceof Blob) || !urlApi || typeof document === 'undefined') {
        resolve(null);
        return;
      }
      const audio = document.createElement('audio');
      const url = urlApi.createObjectURL(blob);
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        audio.removeAttribute('src');
        try { audio.load(); } catch (_) { /* ignore */ }
        urlApi.revokeObjectURL(url);
      };
      const finish = () => {
        const duration = Number(audio.duration);
        cleanup();
        resolve(normalizePositiveDurationMs(duration * 1000));
      };
      const timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 2500);
      audio.preload = 'metadata';
      audio.onloadedmetadata = finish;
      audio.ondurationchange = () => {
        if (Number.isFinite(Number(audio.duration)) && Number(audio.duration) > 0) finish();
      };
      audio.onerror = () => {
        cleanup();
        resolve(null);
      };
      audio.src = url;
    });
  }

  async function hydrateMediaDurations(media) {
    const hydrated = [];
    for (const item of media) {
      if (isWebmMedia(item) && !normalizePositiveDurationMs(item.clientReportedDurationMs)) {
        const durationMs = await readBlobDurationMs(item.blob);
        hydrated.push({
          ...item,
          clientReportedDurationMs: normalizePositiveDurationMs(durationMs)
        });
      } else {
        hydrated.push({
          ...item,
          clientReportedDurationMs: normalizePositiveDurationMs(item.clientReportedDurationMs)
        });
      }
    }
    return hydrated;
  }

  function stripBlob(media) {
    return media.map((item) => ({
      slot: item.slot,
      label: item.label,
      slotFile: item.slotFile,
      contentType: item.contentType,
      clientReportedDurationMs: item.clientReportedDurationMs
    }));
  }

  async function prepareAttempt(input) {
    if (!isPteScope()) return { skipped: true, reason: 'non-pte-scope' };
    const media = await hydrateMediaDurations(normalizeMediaInput(input.media || input.mediaBlobs || input.blob));
    return apiFetch('/prepare', {
      method: 'POST',
      body: JSON.stringify({
        practiceScope: 'pte',
        practiceMode: input.practiceMode,
        attemptId: input.attemptId || null,
        promptSnapshot: input.promptSnapshot || null,
        mediaSlots: stripBlob(media)
      })
    });
  }

  async function uploadMediaSlots(prepared, media) {
    if (!media.length) return [];
    const slots = Array.isArray(prepared?.mediaSlots) ? prepared.mediaSlots : [];
    const bySlotFile = new Map(slots.map((slot) => [slot.slotFile, slot]));
    const storage = firebase.storage();
    const uploaded = [];
    for (const item of media) {
      const slot = bySlotFile.get(item.slotFile) || slots[item.index];
      const path = slot?.storagePath || slot?.path;
      if (!path) throw new Error('Archive media slot was not prepared.');
      await storage.ref(path).put(item.blob, { contentType: item.contentType });
      uploaded.push({
        ...item,
        storagePath: path,
        path
      });
    }
    return uploaded;
  }

  async function saveAttempt(input = {}) {
    if (!isPteScope()) return { skipped: true, reason: 'non-pte-scope' };
    const media = await hydrateMediaDurations(normalizeMediaInput(input.media || input.mediaBlobs || input.blob));
    let attemptId = cleanString(input.attemptId, 128);
    if (!attemptId) {
      attemptId = 'att_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    let idempotencyKey = cleanString(input.idempotencyKey, 128);
    if (!idempotencyKey) {
      idempotencyKey = 'idem_' + attemptId;
    }
    let mediaSlots = stripBlob(media);

    if (media.length) {
      const prepared = await prepareAttempt({
        practiceMode: input.practiceMode,
        attemptId,
        promptSnapshot: input.promptSnapshot,
        media
      });
      if (prepared?.skipped) return prepared;
      attemptId = prepared.attemptId || attemptId;
      const uploaded = await uploadMediaSlots(prepared, media);
      mediaSlots = uploaded.map((item) => ({
        slot: item.slot,
        label: item.label,
        slotFile: item.slotFile,
        contentType: item.contentType,
        storagePath: item.storagePath,
        clientReportedDurationMs: item.clientReportedDurationMs
      }));
    }

    const body = {
      practiceScope: 'pte',
      practiceMode: input.practiceMode,
      attemptId,
      promptSnapshot: input.promptSnapshot || null,
      responseSnapshot: input.responseSnapshot || null,
      answerSnapshot: input.answerSnapshot || null,
      resultSnapshot: input.resultSnapshot || null,
      timingSnapshot: input.timingSnapshot || null,
      scoringSnapshot: input.scoringSnapshot || null,
      scoringSource: input.scoringSource || null,
      invalidated: input.invalidated === true,
      archiveInvalidated: input.archiveInvalidated === true,
      idempotencyKey: idempotencyKey
    };
    if (mediaSlots.length) body.mediaSlots = mediaSlots;

    const savedAttempt = await apiFetch('/save', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    invalidateHistoryCache();
    return savedAttempt;
  }

  async function patchAttempt(attemptId, patch = {}) {
    const cleanAttemptId = cleanString(attemptId, 128);
    if (!cleanAttemptId) return { skipped: true, reason: 'missing-attempt-id' };
    const body = {};
    if ('resultSnapshot' in patch || 'result' in patch) {
      body.resultSnapshot = patch.resultSnapshot || patch.result || null;
    }
    if ('responseSnapshot' in patch || 'response' in patch) {
      body.responseSnapshot = patch.responseSnapshot || patch.response || null;
    }
    if ('scoringSnapshot' in patch || 'scoring' in patch) {
      body.scoringSnapshot = patch.scoringSnapshot || patch.scoring || null;
    }
    return apiFetch(`/${encodeURIComponent(cleanAttemptId)}/result`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  }

  async function listAttempts(options = {}) {
    if (!isPteScope() && options.scope !== 'review') return { skipped: true, reason: 'non-pte-scope' };
    const params = new URLSearchParams();
    params.set('scope', options.scope || 'mine');
    if (options.practiceScope || options.scope !== 'review') params.set('practiceScope', options.practiceScope || 'pte');
    if (options.studentId) params.set('studentId', options.studentId);
    return apiFetch(`/?${params.toString()}`, { method: 'GET' });
  }

  function listReviewAttempts(studentId) {
    return listAttempts({ scope: 'review', studentId });
  }

  function formatAttemptDate(value) {
    try {
      const raw = value?.toDate ? value.toDate() : (value?._seconds ? new Date(value._seconds * 1000) : new Date(value));
      if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) return '';
      return raw.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function ensureHistoryMount() {
    let mount = document.getElementById('pte-attempt-history');
    if (mount) return mount;
    const grid = document.querySelector('#panel-tutorials .tutorial-grid');
    if (!grid || !isPteScope()) return null;
    mount = document.createElement('section');
    mount.id = 'pte-attempt-history';
    mount.className = 'pte-attempt-history';
    mount.innerHTML = `
      <div class="pte-attempt-history__bar">
        <h3>My PTE Attempts</h3>
        <button type="button" class="pte-attempt-history__refresh" aria-label="Refresh attempts">Refresh</button>
      </div>
      <div class="pte-attempt-history__list" role="list"></div>
    `;
    mount.style.cssText = 'margin:18px 0 4px;padding:0;';
    const bar = mount.querySelector('.pte-attempt-history__bar');
    if (bar) bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;';
    const title = mount.querySelector('h3');
    if (title) title.style.cssText = 'font-size:1rem;margin:0;color:#111827;';
    const refresh = mount.querySelector('button');
    if (refresh) {
      refresh.style.cssText = 'border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;';
      refresh.addEventListener('click', () => renderLearnerHistory());
    }
    grid.insertAdjacentElement('afterend', mount);
    return mount;
  }

  async function renderLearnerHistory() {
    const mount = ensureHistoryMount();
    if (!mount || !isPteScope()) return;
    const list = mount.querySelector('.pte-attempt-history__list');
    if (!list) return;
    list.textContent = 'Loading...';
    try {
      const data = await listAttempts({ scope: 'mine' });
      if (data?.skipped) {
        list.textContent = '';
        return;
      }
      const attempts = (data.attempts || [])
        .filter((attempt) => attempt.practiceScope === 'pte' || Number(attempt.schemaVersion) >= 2)
        .slice(0, 8);
      if (!attempts.length) {
        list.textContent = 'No saved PTE attempts yet.';
        return;
      }
      list.replaceChildren(...attempts.map((attempt) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'pte-attempt-history__item';
        row.style.cssText = 'width:100%;display:grid;grid-template-columns:1fr auto;gap:8px;text-align:left;border:1px solid #e5e7eb;background:#fff;border-radius:6px;padding:10px 12px;margin-bottom:8px;cursor:pointer;';
        const label = document.createElement('span');
        label.textContent = attempt.modeLabel || attempt.practiceMode || 'PTE attempt';
        const meta = document.createElement('span');
        meta.textContent = formatAttemptDate(attempt.submittedAt || attempt.createdAt);
        meta.style.cssText = 'color:#6b7280;font-size:0.85rem;';
        row.append(label, meta);
        row.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent('pte-attempt-archive:open', { detail: { attemptId: attempt.attemptId } }));
        });
        return row;
      }));
    } catch (error) {
      console.warn('[PTE Archive] History load failed:', error);
      list.textContent = '';
    }
  }

  function installHistoryAutoRender() {
    const schedule = () => setTimeout(() => renderLearnerHistory(), 250);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', schedule, { once: true });
    } else {
      schedule();
    }
    window.PracticeScopeManager?.subscribe?.(() => schedule());
    window.addEventListener('auth-state-changed', schedule);
  }

  async function getAttempt(attemptId) {
    const cleanAttemptId = cleanString(attemptId, 128);
    if (!cleanAttemptId) return { skipped: true, reason: 'missing-attempt-id' };
    return apiFetch(`/${encodeURIComponent(cleanAttemptId)}`, { method: 'GET' });
  }

  function summarizeSelectedOptions(options, selected) {
    const selectedSet = new Set(Array.isArray(selected) ? selected.map(String) : [String(selected || '')]);
    return (Array.isArray(options) ? options : []).map((option, index) => {
      const id = cleanString(option?.id ?? option?.value ?? index, 128) || String(index);
      return {
        id,
        text: cleanString(option?.text ?? option?.label ?? option, 2000),
        selected: selectedSet.has(id) || selectedSet.has(String(option?.value ?? ''))
      };
    });
  }

  function getSelectedIndices(state) {
    if (state?.selectedIndices instanceof Set) return Array.from(state.selectedIndices);
    if (Array.isArray(state?.selectedIndices)) return state.selectedIndices;
    if (Number.isInteger(state?.selectedIndex)) return [state.selectedIndex];
    if (Array.isArray(state?.selectedAnswers)) return state.selectedAnswers;
    return [];
  }

  function summarizeQuestion(question) {
    const sourceAssetPaths = [
      question?.audio,
      question?.audioPath,
      question?.audioUrl,
      question?.image,
      question?.imagePath,
      question?.video,
      question?.videoPath
    ].map((item) => cleanString(item, 1024)).filter(Boolean);
    return {
      promptId: cleanString(question?.id || question?.promptId || question?.questionId, 128),
      title: cleanString(question?.title || question?.name, 200),
      text: cleanString(question?.prompt || question?.question || question?.text || question?.passage || question?.transcript, 12000),
      source: cleanString(question?.source || question?.section, 200),
      sourceAssetPaths,
      data: question || null
    };
  }

  function summarizeStateOptions(state) {
    const choices = state?.shuffledChoices || state?.choices || state?.options || state?.currentQuestion?.choices || state?.currentQuestion?.options || [];
    const selected = getSelectedIndices(state).map((idx) => {
      const choice = choices[idx];
      return choice?.id ?? choice?.value ?? idx;
    });
    return summarizeSelectedOptions(choices, selected).map((option, index) => ({
      ...option,
      keyedCorrect: choices[index]?.isCorrect === true || choices[index]?.correct === true,
      keyedAnswer: choices[index]?.answer === true || choices[index]?.isAnswer === true
    }));
  }

  function summarizeStateResponse(state, extra = {}) {
    const selectedIndices = getSelectedIndices(state);
    const choices = state?.shuffledChoices || state?.choices || state?.options || state?.currentQuestion?.choices || state?.currentQuestion?.options || [];
    return {
      selectedIndices,
      selectedOptionIds: selectedIndices.map((idx) => choices[idx]?.id ?? choices[idx]?.value ?? idx),
      selectedOptions: selectedIndices.map((idx) => ({
        id: choices[idx]?.id ?? choices[idx]?.value ?? idx,
        text: cleanString(choices[idx]?.text ?? choices[idx]?.label ?? choices[idx], 2000)
      })),
      userAnswer: extra.userAnswer ?? state?.userAnswer ?? state?.answer ?? null,
      selectedMappings: extra.selectedMappings || state?.selectedMappings || state?.answers || null,
      order: extra.order || state?.currentOrder || state?.userOrder || null
    };
  }

  async function saveStateAttempt(practiceMode, state = {}, result = {}, extra = {}) {
    const question = extra.question || state.currentQuestion || state.currentItem || state.question || null;
    return saveAttempt({
      practiceMode,
      attemptId: extra.attemptId || null,
      promptSnapshot: extra.promptSnapshot || summarizeQuestion(question),
      responseSnapshot: extra.responseSnapshot || summarizeStateResponse(state, extra),
      answerSnapshot: extra.answerSnapshot || {
        options: summarizeStateOptions(state),
        keyedAnswerData: extra.keyedAnswerData || question?.answer || question?.answers || null
      },
      resultSnapshot: result,
      timingSnapshot: extra.timingSnapshot || null,
      scoringSnapshot: extra.scoringSnapshot || null,
      scoringSource: extra.scoringSource || 'client',
      idempotencyKey: extra.idempotencyKey || null
    });
  }

  async function saveTextAttempt(practiceMode, question, text, result = {}, extra = {}) {
    return saveAttempt({
      practiceMode,
      attemptId: extra.attemptId || null,
      promptSnapshot: extra.promptSnapshot || summarizeQuestion(question),
      responseSnapshot: {
        text: text || '',
        wordCount: String(text || '').trim().split(/\s+/).filter(Boolean).length
      },
      answerSnapshot: extra.answerSnapshot || {
        keyedAnswerData: question?.answer || question?.answers || question?.sampleAnswer || null
      },
      resultSnapshot: result,
      timingSnapshot: extra.timingSnapshot || null,
      scoringSnapshot: extra.scoringSnapshot || null,
      scoringSource: extra.scoringSource || 'client',
      idempotencyKey: extra.idempotencyKey || null
    });
  }

  let activeModal = null;
  let activeModalKeydownHandler = null;

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  const MODE_LABELS = {
    // Canonical names
    read_aloud: 'Read Aloud',
    repeat_sentence: 'Repeat Sentence',
    describe_image: 'Describe Image',
    retell_lecture: 'Retell Lecture',
    answer_short_question: 'Answer Short Question',
    summarize_group_discussion: 'Summarize Group Discussion',
    write_essay: 'Write Essay',
    summarize_written_text: 'Summarize Written Text',
    summarize_spoken_text: 'Summarize Spoken Text',
    write_from_dictation: 'Write From Dictation',
    reading_fill_in_the_blanks: 'Reading Fill in the Blanks',
    drag_and_drop_fill_blanks: 'Drag & Drop Fill Blanks',
    reading_multiple_choice_single_answer: 'Reading Multiple Choice Single Answer',
    reading_multiple_choice_multiple_answers: 'Reading Multiple Choice Multiple Answers',
    reorder_paragraphs: 'Re-order Paragraphs',
    listening_fill_in_the_blanks: 'Listening Fill in the Blanks',
    respond_to_situation: 'Respond to a Situation',
    listening_multiple_choice_multiple_answers: 'Listening Multiple Choice Multiple Answers',
    listening_multiple_choice_single_answer: 'Listening Multiple Choice Single Answer',
    highlight_correct_summary: 'Highlight Correct Summary',
    select_missing_word: 'Select Missing Word',
    highlight_incorrect_words: 'Highlight Incorrect Words',

    // Alias names
    'read-aloud': 'Read Aloud',
    speak: 'Repeat Sentence',
    'describe-image': 'Describe Image',
    notes: 'Retell Lecture',
    asq: 'Answer Short Question',
    sgd: 'Summarize Group Discussion',
    essay: 'Write Essay',
    swt: 'Summarize Written Text',
    sst: 'Summarize Spoken Text',
    type: 'Write From Dictation',
    rfib: 'Reading Fill in the Blanks',
    dd: 'Drag & Drop Fill Blanks',
    rmcsa: 'Reading Multiple Choice Single Answer',
    rmcma: 'Reading Multiple Choice Multiple Answers',
    rop: 'Re-order Paragraphs',
    extended: 'Listening Fill in the Blanks',
    rts: 'Respond to a Situation',
    lmcma: 'Listening Multiple Choice Multiple Answers',
    lmcsa: 'Listening Multiple Choice Single Answer',
    hcs: 'Highlight Correct Summary',
    smw: 'Select Missing Word',
    hiw: 'Highlight Incorrect Words'
  };

  function injectModalStyles() {
    if (document.getElementById('pte-attempt-review-styles')) return;
    const style = document.createElement('style');
    style.id = 'pte-attempt-review-styles';
    style.textContent = `
      .pte-attempt-review-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(15, 23, 42, 0.4);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: pte-fade-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .pte-attempt-review-container {
        width: 90%;
        max-width: 720px;
        max-height: 85vh;
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.4);
        border-radius: 16px;
        box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        color: #1e293b;
        font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
        animation: pte-slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes pte-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes pte-slide-up {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .pte-attempt-review-header {
        padding: 16px 20px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 12px;
      }
      .pte-attempt-review-header-title {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 600;
        color: #0f172a;
      }
      .pte-attempt-review-header-badge {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 8px;
        border-radius: 9999px;
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: #ffffff;
      }
      .pte-attempt-review-close-btn {
        border: none;
        background: none;
        font-size: 1.5rem;
        line-height: 1;
        color: #64748b;
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        margin-left: auto;
      }
      .pte-attempt-review-close-btn:hover {
        background: rgba(0, 0, 0, 0.05);
        color: #0f172a;
      }
      .pte-attempt-review-body {
        padding: 20px 24px;
        overflow-y: auto;
        flex: 1;
      }
      .pte-attempt-review-section-title {
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 600;
        color: #4f46e5;
        margin: 20px 0 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.04);
      }
      .pte-attempt-review-section-title:first-of-type {
        margin-top: 0;
      }
      .pte-attempt-review-text-block {
        font-size: 0.95rem;
        line-height: 1.55;
        color: #334155;
        margin: 0 0 16px;
      }
      .pte-attempt-review-prompt-text {
        font-style: italic;
        background: rgba(0, 0, 0, 0.02);
        padding: 12px 16px;
        border-left: 3px solid #6366f1;
        border-radius: 0 8px 8px 0;
      }
      .pte-attempt-review-audio-player {
        width: 100%;
        margin-top: 8px;
        border-radius: 8px;
        outline: none;
      }
      .pte-attempt-review-scores-grid {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 12px;
      }
      .pte-attempt-review-score-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 0;
        border-bottom: 1px dashed rgba(0, 0, 0, 0.06);
      }
      .pte-attempt-review-score-row:last-child {
        border-bottom: none;
      }
      .pte-attempt-review-score-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.95rem;
        font-weight: 550;
        color: #0f172a;
      }
      .pte-attempt-review-score-rationale {
        font-size: 0.85rem;
        color: #64748b;
        line-height: 1.4;
      }
      .pte-attempt-review-score-badge {
        font-weight: 600;
        color: #4f46e5;
        background: rgba(99, 102, 241, 0.1);
        padding: 2px 8px;
        border-radius: 4px;
      }
      .pte-attempt-review-overall {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 16px;
        padding: 12px 0;
      }
      .pte-attempt-review-overall-number {
        font-size: 2rem;
        font-weight: 700;
        color: #4f46e5;
        line-height: 1;
      }
      .pte-attempt-review-overall-label {
        font-size: 0.95rem;
        font-weight: 550;
        color: #4f46e5;
      }
      .pte-attempt-review-overall-percent {
        font-size: 0.85rem;
        color: #64748b;
      }
      .pte-attempt-review-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 160px;
        font-size: 1rem;
        color: #64748b;
        font-weight: 500;
      }
      .history-attempts-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        text-align: left;
        width: 100%;
        max-width: 900px;
        margin-left: auto;
        margin-right: auto;
      }
      .history-attempts-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #374151;
        margin-bottom: 12px;
      }
      .history-attempt-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.6);
        border: 1px solid rgba(0, 0, 0, 0.05);
        border-radius: 8px;
        margin-bottom: 8px;
        transition: background-color 0.2s;
      }
      .history-attempt-item:hover {
        background: rgba(255, 255, 255, 0.9);
      }
      .history-attempt-meta {
        font-size: 0.85rem;
        color: #6b7280;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 130px;
      }
      .history-attempt-date {
        font-weight: 550;
        color: #374151;
      }
      .history-attempt-content {
        flex: 1;
        font-size: 0.85rem;
        color: #4b5563;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .history-attempt-audio {
        max-height: 28px;
        width: 180px;
      }
      .history-details-btn {
        font-size: 0.8rem;
        font-weight: 600;
        color: #4f46e5;
        background: rgba(99, 102, 241, 0.08);
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .history-details-btn:hover {
        background: rgba(99, 102, 241, 0.15);
      }
    `;
    document.head.appendChild(style);
  }

  function renderModalDetails(container, attempt) {
    const body = container.querySelector('.pte-attempt-review-body');
    if (!body) return;

    const rawMode = attempt.practiceMode || '';
    const displayModeLabel = attempt.modeLabel || MODE_LABELS[rawMode] || rawMode.replace(/[_-]/g, ' ');
    const dateStr = formatAttemptDate(attempt.submittedAt || attempt.createdAt);

    // 1. Prompt / Question Section
    let promptHtml = '';
    const prompt = attempt.promptSnapshot || {};
    const promptText = prompt.text || prompt.prompt || '';
    const promptTitle = prompt.title || '';
    if (promptText || promptTitle) {
      promptHtml = `
        <h4 class="pte-attempt-review-section-title">Question Prompt</h4>
        <div class="pte-attempt-review-text-block pte-attempt-review-prompt-text">
          ${promptTitle ? `<strong style="display:block;margin-bottom:6px;color:#0f172a;">${escapeHtml(promptTitle)}</strong>` : ''}
          ${escapeHtml(promptText)}
        </div>
      `;
    }

    // 2. Response / Submission Section
    let responseHtml = '';
    const response = attempt.responseSnapshot || {};
    const audioUrl = attempt.audio?.studentUrl || '';

    let userResponseContent = '';
    if (response.text) {
      userResponseContent = `<p style="white-space:pre-wrap;margin:0;">${escapeHtml(response.text)}</p>`;
    } else if (response.userAnswer) {
      userResponseContent = `<p style="white-space:pre-wrap;margin:0;">${escapeHtml(response.userAnswer)}</p>`;
    } else if (Array.isArray(response.selectedOptions) && response.selectedOptions.length) {
      userResponseContent = `<ul style="margin:0;padding-left:20px;">
        ${response.selectedOptions.map(opt => `<li>${escapeHtml(opt.text || opt)}</li>`).join('')}
      </ul>`;
    } else if (Array.isArray(response.selectedIndices) && response.selectedIndices.length) {
      userResponseContent = `<p style="margin:0;">Selected option index/indices: ${response.selectedIndices.join(', ')}</p>`;
    } else if (response.order) {
      const orderList = Array.isArray(response.order) ? response.order : [response.order];
      userResponseContent = `<p style="margin:0;">Your ordering: <strong>${orderList.join(' → ')}</strong></p>`;
    } else {
      userResponseContent = `<p style="margin:0;color:#64748b;font-style:italic;">No response text available.</p>`;
    }

    let audioPlayerHtml = '';
    if (audioUrl) {
      audioPlayerHtml = `
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px;">
          <span style="font-size:0.85rem;color:#64748b;font-weight:500;">Recorded Audio:</span>
          <audio controls src="${audioUrl}" class="pte-attempt-review-audio-player"></audio>
        </div>
      `;
    }

    responseHtml = `
      <h4 class="pte-attempt-review-section-title">Your Response</h4>
      <div class="pte-attempt-review-text-block">
        ${userResponseContent}
        ${audioPlayerHtml}
      </div>
    `;

    // 3. AI / Scoring Results Section
    let resultsHtml = '';
    const result = attempt.resultSnapshot || {};
    const scoring = attempt.scoringSnapshot || {};

    // Determine overall score
    let overallScoreHtml = '';
    const overall = result.overall || {};
    let totalScore = overall.total !== undefined ? overall.total : (result.score !== undefined ? result.score : null);
    let maxScore = overall.maxTotal !== undefined ? overall.maxTotal : (result.total !== undefined ? result.total : null);
    let percent = overall.percent !== undefined ? overall.percent : null;

    if (totalScore !== null) {
      if (maxScore !== null && percent === null) {
        percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
      }
      overallScoreHtml = `
        <div class="pte-attempt-review-overall">
          <div class="pte-attempt-review-overall-number">${totalScore}${maxScore !== null ? `<span style="font-size:1.25rem;color:#94a3b8;font-weight:400;">/${maxScore}</span>` : ''}</div>
          <div>
            <div class="pte-attempt-review-overall-label">Overall Score</div>
            ${percent !== null ? `<div class="pte-attempt-review-overall-percent">${percent}% proficiency</div>` : ''}
          </div>
        </div>
      `;
    }

    // Breakdown grid
    let breakdownHtml = '';
    const scores = result.scores || result.breakdown || null;
    if (isPlainObject(scores)) {
      const rows = [];
      if (result.wordCount !== undefined) {
        rows.push(`
          <div class="pte-attempt-review-score-row">
            <div class="pte-attempt-review-score-meta">
              <span>Word Count</span>
              <span class="pte-attempt-review-score-badge">${result.wordCount} words</span>
            </div>
          </div>
        `);
      }
      for (const [key, val] of Object.entries(scores)) {
        if (isPlainObject(val)) {
          const scoreVal = val.score !== undefined ? val.score : null;
          const rationale = val.rationale || val.detail || val.comment || '';
          const maxVal = val.max !== undefined ? val.max : null;
          
          rows.push(`
            <div class="pte-attempt-review-score-row">
              <div class="pte-attempt-review-score-meta">
                <span style="text-transform:capitalize;">${escapeHtml(key.replace(/[_-]/g, ' '))}</span>
                ${scoreVal !== null ? `<span class="pte-attempt-review-score-badge">${scoreVal}${maxVal ? `/${maxVal}` : ''}</span>` : ''}
              </div>
              ${rationale ? `<div class="pte-attempt-review-score-rationale">${escapeHtml(rationale)}</div>` : ''}
            </div>
          `);
        } else if (val !== null && val !== undefined && (typeof val === 'number' || typeof val === 'string')) {
          rows.push(`
            <div class="pte-attempt-review-score-row">
              <div class="pte-attempt-review-score-meta">
                <span style="text-transform:capitalize;">${escapeHtml(key.replace(/[_-]/g, ' '))}</span>
                <span class="pte-attempt-review-score-badge">${escapeHtml(String(val))}</span>
              </div>
            </div>
          `);
        }
      }
      if (rows.length) {
        breakdownHtml = `
          <div class="pte-attempt-review-scores-grid">
            ${rows.join('')}
          </div>
        `;
      }
    }

    // Fallback: Client-side basic feedback breakdown
    if (!overallScoreHtml && !breakdownHtml && (result.wordCount !== undefined || result.form !== undefined)) {
      const rows = [];
      if (result.wordCount !== undefined) {
        rows.push(`
          <div class="pte-attempt-review-score-row">
            <div class="pte-attempt-review-score-meta">
              <span>Word Count</span>
              <span class="pte-attempt-review-score-badge">${result.wordCount} words</span>
            </div>
          </div>
        `);
      }
      if (result.form !== undefined && isPlainObject(result.form)) {
        const formScore = result.form.score !== undefined ? result.form.score : null;
        const formMax = result.form.max !== undefined ? result.form.max : 2;
        const formDetail = result.form.detail || result.form.rationale || '';
        rows.push(`
          <div class="pte-attempt-review-score-row">
            <div class="pte-attempt-review-score-meta">
              <span>Form</span>
              ${formScore !== null ? `<span class="pte-attempt-review-score-badge">${formScore}/${formMax}</span>` : ''}
            </div>
            ${formDetail ? `<div class="pte-attempt-review-score-rationale">${escapeHtml(formDetail)}</div>` : ''}
          </div>
        `);
      }
      if (result.languageTool !== undefined && isPlainObject(result.languageTool)) {
        let ltText = '';
        if (result.languageTool.unavailable) {
          ltText = 'Check unavailable';
        } else if (result.languageTool.matchCount !== undefined) {
          ltText = `${result.languageTool.matchCount} issue${result.languageTool.matchCount === 1 ? '' : 's'} found`;
        } else {
          ltText = 'Spelling/grammar check complete';
        }
        rows.push(`
          <div class="pte-attempt-review-score-row">
            <div class="pte-attempt-review-score-meta">
              <span>Spelling & Grammar</span>
              <span class="pte-attempt-review-score-badge">${escapeHtml(ltText)}</span>
            </div>
          </div>
        `);
      }
      if (rows.length) {
        breakdownHtml = `
          <div class="pte-attempt-review-scores-grid">
            ${rows.join('')}
          </div>
        `;
      }
    }

    if (!overallScoreHtml && !breakdownHtml && result.isCorrect !== undefined) {
      const correctText = result.isCorrect ? '✅ Correct' : '❌ Incorrect';
      const scorePart = result.score !== undefined ? `${result.score} points` : '';
      overallScoreHtml = `
        <div class="pte-attempt-review-overall">
          <div class="pte-attempt-review-overall-label" style="font-size:1.2rem;">
            ${correctText} ${scorePart ? `(${scorePart})` : ''}
          </div>
        </div>
      `;
    }

    // Teacher advice / AI suggestions
    let adviceHtml = '';
    const adviceText = result.teacherAdvice || result.advice || scoring.teacherAdviceChat || result.teacherAdviceChat || '';
    if (adviceText) {
      adviceHtml = `
        <h4 class="pte-attempt-review-section-title">Teacher Advice</h4>
        <div class="pte-attempt-review-text-block" style="white-space:pre-wrap;background:rgba(99,102,241,0.03);padding:14px 18px;border-radius:8px;border-left:3px solid #4f46e5;">${escapeHtml(adviceText)}</div>
      `;
    }

    if (overallScoreHtml || breakdownHtml) {
      resultsHtml = `
        <h4 class="pte-attempt-review-section-title">Evaluation Results</h4>
        ${overallScoreHtml}
        ${breakdownHtml}
      `;
    }

    // Update title, date, and badge in header
    const headerTitle = container.querySelector('.pte-attempt-review-header-title');
    if (headerTitle) {
      headerTitle.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:1.15rem;font-weight:600;color:#0f172a;">${escapeHtml(displayModeLabel)}</span>
          ${dateStr ? `<span style="font-size:0.75rem;color:#64748b;font-weight:400;">Submitted on ${escapeHtml(dateStr)}</span>` : ''}
        </div>
      `;
    }
    
    const header = container.querySelector('.pte-attempt-review-header');
    if (header && !header.querySelector('.pte-attempt-review-header-badge')) {
      const badge = document.createElement('span');
      badge.className = 'pte-attempt-review-header-badge';
      badge.textContent = 'PTE';
      header.insertBefore(badge, header.querySelector('.pte-attempt-review-close-btn'));
    }

    body.innerHTML = `
      ${promptHtml}
      ${responseHtml}
      ${resultsHtml}
      ${adviceHtml}
    `;
  }

  function closeActiveModal() {
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
    if (activeModalKeydownHandler) {
      window.removeEventListener('keydown', activeModalKeydownHandler);
      activeModalKeydownHandler = null;
    }
  }

  async function openReviewModal(attemptId) {
    closeActiveModal();
    injectModalStyles();

    const overlay = document.createElement('div');
    overlay.className = 'pte-attempt-review-overlay';
    
    const container = document.createElement('div');
    container.className = 'pte-attempt-review-container';
    
    container.innerHTML = `
      <div class="pte-attempt-review-header">
        <h3 class="pte-attempt-review-header-title">Review Attempt</h3>
        <button type="button" class="pte-attempt-review-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="pte-attempt-review-body">
        <div class="pte-attempt-review-loading">
          <span>⏳ Loading attempt details...</span>
        </div>
      </div>
    `;
    
    overlay.appendChild(container);
    document.body.appendChild(overlay);
    activeModal = overlay;

    const closeBtn = container.querySelector('.pte-attempt-review-close-btn');
    closeBtn.addEventListener('click', closeActiveModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeActiveModal();
    });

    activeModalKeydownHandler = (e) => {
      if (e.key === 'Escape') {
        closeActiveModal();
      }
    };
    window.addEventListener('keydown', activeModalKeydownHandler);

    try {
      const data = await getAttempt(attemptId);
      const attempt = data?.attempt || data;
      if (!attempt || attempt.skipped) {
        throw new Error('Failed to retrieve attempt data.');
      }
      renderModalDetails(container, attempt);
    } catch (err) {
      console.error('[PTE Archive] Error loading review details:', err);
      const body = container.querySelector('.pte-attempt-review-body');
      if (body) {
        body.innerHTML = `
          <div class="pte-attempt-review-error" style="text-align:center;padding:24px 0;color:#ef4444;">
            <p>⚠️ Error: ${escapeHtml(err.message || 'Could not load attempt details.')}</p>
          </div>
        `;
      }
    }
  }

  window.addEventListener('pte-attempt-archive:open', (event) => {
    const attemptId = event.detail?.attemptId;
    if (attemptId) {
      openReviewModal(attemptId);
    }
  });

  let cachedAttempts = null;
  let fetchingAttemptsPromise = null;

  function invalidateHistoryCache() {
    cachedAttempts = null;
  }

  function resolveHistoryQuestionId(mode, fallbackQuestionId = null) {
    if (mode === 'essay') {
      const elId = document.getElementById('current-question-id-essay');
      return elId ? String(elId.textContent || '').trim() || fallbackQuestionId : fallbackQuestionId;
    }

    if (mode === 'swt') {
      const pill = document.getElementById('swt-v7-question-pill');
      const match = pill && pill.textContent ? pill.textContent.match(/^#(\S+)/) : null;
      return match ? match[1] : fallbackQuestionId;
    }

    if (mode === 'read-aloud') {
      const activeQuestionId = window.ReadAloudMode?.currentQuestionId;
      if (activeQuestionId) return String(activeQuestionId);
      const pill = document.getElementById('ra-v7-question-pill');
      const match = pill && pill.textContent ? pill.textContent.match(/^[Q#]?(\d+)/) : null;
      return match ? match[1] : fallbackQuestionId;
    }

    return fallbackQuestionId;
  }

  function getAttemptPromptId(attempt) {
    return attempt?.promptId
      ?? attempt?.promptSnapshot?.promptId
      ?? attempt?.promptSnapshot?.id
      ?? attempt?.promptSnapshot?.questionId
      ?? null;
  }

  function getAttemptScoreText(attempt) {
    const score = attempt?.score
      ?? attempt?.resultSnapshot?.score
      ?? attempt?.resultSnapshot?.overall?.total
      ?? null;
    return score === null || score === undefined || score === '' ? null : String(score);
  }

  async function fetchUserAttemptsCached() {
    const user = getCurrentUser();
    if (!user) {
      invalidateHistoryCache();
      return null;
    }
    if (fetchingAttemptsPromise) return fetchingAttemptsPromise;
    fetchingAttemptsPromise = (async () => {
      try {
        const data = await listAttempts({ scope: 'mine', practiceScope: 'pte' });
        cachedAttempts = Array.isArray(data?.attempts) ? data.attempts : [];
        return cachedAttempts;
      } catch (err) {
        console.warn('[PTE Archive] Failed to load history attempts:', err);
        return [];
      } finally {
        fetchingAttemptsPromise = null;
      }
    })();
    return fetchingAttemptsPromise;
  }

  async function updateHistoryUI(mode, questionId) {
    const panels = {
      essay: { startBtnId: 'start-essay-btn', panelId: 'mode-essay', skill: 'writing' },
      swt: { startBtnId: 'start-swt-btn', panelId: 'mode-swt', skill: 'writing' },
      'read-aloud': { startBtnId: 'ra-next-btn', panelId: 'mode-read-aloud', skill: 'speaking' }
    };
    const config = panels[mode];
    if (!config) return;

    injectModalStyles();

    const startBtn = document.getElementById(config.startBtnId);
    if (!startBtn) return;
    const currentQuestionId = resolveHistoryQuestionId(mode, questionId);

    let toggleBtn = document.getElementById(`${mode}-history-toggle`);
    let historyContainer = document.getElementById(`${mode}-history-container`);

    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.id = `${mode}-history-toggle`;
      toggleBtn.type = 'button';
      toggleBtn.className = 'modern-btn modern-btn--history';
      toggleBtn.style.cssText = 'margin-left: 8px; vertical-align: middle;';
      toggleBtn.textContent = '🕒 Previous Attempts';
      startBtn.insertAdjacentElement('afterend', toggleBtn);

      historyContainer = document.createElement('div');
      historyContainer.id = `${mode}-history-container`;
      historyContainer.className = 'history-attempts-section';
      historyContainer.style.display = 'none';
      
      const parentControls = startBtn.closest('.controls') || startBtn.parentElement;
      parentControls.insertAdjacentElement('afterend', historyContainer);

      toggleBtn.addEventListener('click', async () => {
        const latestQuestionId = resolveHistoryQuestionId(mode, toggleBtn.dataset.questionId || questionId);
        const isCollapsed = historyContainer.style.display === 'none';
        if (isCollapsed) {
          historyContainer.style.display = 'block';
          await refreshHistoryList(mode, latestQuestionId, historyContainer);
        } else {
          historyContainer.style.display = 'none';
        }
      });
    }

    if (toggleBtn) toggleBtn.dataset.questionId = currentQuestionId || '';
    if (historyContainer) historyContainer.dataset.questionId = currentQuestionId || '';

    if (historyContainer && historyContainer.style.display !== 'none') {
      await refreshHistoryList(mode, currentQuestionId, historyContainer);
    }
  }

  async function refreshHistoryList(mode, questionId, historyContainer) {
    if (!historyContainer) return;
    historyContainer.innerHTML = '<div style="font-size:0.85rem;color:#6b7280;">Loading history attempts...</div>';

    const user = getCurrentUser();
    if (!user) {
      historyContainer.innerHTML = '<div style="font-size:0.85rem;color:#ef4444;">Please log in to view previous attempts.</div>';
      return;
    }

    const attempts = await fetchUserAttemptsCached();
    if (!attempts || attempts.length === 0) {
      historyContainer.innerHTML = '<div style="font-size:0.85rem;color:#6b7280;">No previous attempts.</div>';
      return;
    }

    // Filter attempts by mode and prompt/question ID
    const modeAliases = {
      essay: ['essay', 'write_essay'],
      swt: ['swt', 'summarize_written_text'],
      'read-aloud': ['read-aloud', 'read_aloud']
    };
    const validModes = modeAliases[mode] || [mode];

    const filtered = attempts.filter(a => {
      const isModeMatch = validModes.includes(a.practiceMode) || validModes.includes(a.canonicalMode);
      const isQuestionMatch = String(getAttemptPromptId(a)) === String(questionId);
      return isModeMatch && isQuestionMatch;
    });

    if (filtered.length === 0) {
      historyContainer.innerHTML = '<div style="font-size:0.85rem;color:#6b7280;">No previous attempts on this question.</div>';
      return;
    }

    historyContainer.innerHTML = '';
    const title = document.createElement('h5');
    title.className = 'history-attempts-title';
    title.textContent = 'Previous Attempts';
    historyContainer.appendChild(title);

    filtered.forEach(attempt => {
      const item = document.createElement('div');
      item.className = 'history-attempt-item';

      const meta = document.createElement('div');
      meta.className = 'history-attempt-meta';
      const date = formatAttemptDate(attempt.submittedAt || attempt.createdAt);
      meta.innerHTML = `<span class="history-attempt-date">${escapeHtml(date)}</span>`;
      const scoreText = getAttemptScoreText(attempt);
      if (scoreText !== null) {
        meta.innerHTML += `<span style="font-weight:600;color:#4f46e5;">Score: ${escapeHtml(scoreText)}</span>`;
      }

      const content = document.createElement('div');
      content.className = 'history-attempt-content';

      const isSpeaking = ['read_aloud', 'read-aloud', 'speak', 'describe_image', 'describe-image', 'notes', 'sgd', 'rts'].includes(attempt.practiceMode)
        || ['read_aloud', 'repeat_sentence', 'describe_image', 'retell_lecture', 'summarize_group_discussion', 'respond_to_situation'].includes(attempt.canonicalMode);

      if (isSpeaking && attempt.audio?.studentUrl) {
        const audio = document.createElement('audio');
        audio.src = attempt.audio.studentUrl;
        audio.controls = true;
        audio.className = 'history-attempt-audio';
        content.appendChild(audio);
      } else {
        content.textContent = attempt.responseSummary || 'No text response available.';
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-details-btn';
      btn.textContent = 'Click for details';
      btn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('pte-attempt-archive:open', { detail: { attemptId: attempt.attemptId } }));
      });

      item.append(meta, content, btn);
      historyContainer.appendChild(item);
    });
  }

  // Clear cache on auth change
  window.addEventListener('auth-state-changed', () => {
    invalidateHistoryCache();
    // Find active history containers and refresh them if they are visible
    ['essay', 'swt', 'read-aloud'].forEach(mode => {
      const historyContainer = document.getElementById(`${mode}-history-container`);
      if (historyContainer && historyContainer.style.display !== 'none') {
        const questionId = resolveHistoryQuestionId(mode, historyContainer.dataset.questionId || null);
        if (questionId) {
          refreshHistoryList(mode, questionId, historyContainer);
        }
      }
    });
  });

  window.PTEAttemptArchive = {
    isPteScope,
    prepareAttempt,
    saveAttempt,
    patchAttempt,
    listAttempts,
    listReviewAttempts,
    getAttempt,
    renderLearnerHistory,
    summarizeSelectedOptions,
    summarizeQuestion,
    saveStateAttempt,
    saveChoiceAttempt: saveStateAttempt,
    saveTextAttempt,
    invalidateHistoryCache,
    normalizeMediaInput,
    isPlainObject,
    updateHistoryUI,
    fetchUserAttemptsCached
  };

  installHistoryAutoRender();
})();
