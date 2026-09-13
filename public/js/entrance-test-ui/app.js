import { NORMALIZED_DEMO_DATA } from './demo-data.js';
import { getCopy } from './copy.js';
import {
  CONTENT_VERSION,
  REVISION_ID,
  applyAction,
  createDraft,
  importLegacyDemoDraft,
  resolveResumeTarget,
  summarizeAssessment
} from './state.js';
import {
  createDraftQueue,
  createRecordingCommitController,
  createTakeGuard,
  openDemoStore
} from './persistence.js';
import { createAudioController } from './audio.js';
import { createQATools } from './qa.js';
import { renderApp, renderFooterStatus, renderHeaderTools } from './view.js';

const ACTIVE_ID_KEY = 'entrance_test_ui_demo_v1:activeAttemptId';
const QUESTIONS = NORMALIZED_DEMO_DATA.sections.flatMap((section) => section.questions.map((question) => ({ ...question, sectionId: question.sectionId || section.id })));
const SECTIONS = NORMALIZED_DEMO_DATA.sections.map((section) => ({ ...section, questions: QUESTIONS.filter((question) => question.sectionId === section.id) }));

function makeAttemptId() {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `demo-d-${stamp}-${random}`;
}

function canUseLocalStorage() {
  try { return typeof globalThis.localStorage !== 'undefined'; } catch (_) { return false; }
}

function getStoredAttemptId() {
  if (!canUseLocalStorage()) return '';
  try { return String(localStorage.getItem(ACTIVE_ID_KEY) || ''); } catch (_) { return ''; }
}

function setStoredAttemptId(attemptId) {
  if (!canUseLocalStorage()) return;
  try { localStorage.setItem(ACTIVE_ID_KEY, attemptId); } catch (_) {}
}

function simpleFixtureWav() {
  const bytes = new Uint8Array(44 + 800);
  const view = new DataView(bytes.buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, 800, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

function whenIdle() { return new Promise((resolve) => setTimeout(resolve, 0)); }

async function boot() {
  const appRoot = document.getElementById('et-app');
  const headerRoot = document.getElementById('et-header-tools');
  const footerRoot = document.getElementById('et-footer-status');
  if (!appRoot || !headerRoot || !footerRoot) throw new Error('Demo D shell is incomplete');

  const runtime = {
    storage: null,
    queue: null,
    draft: null,
    recovery: null,
    persistenceState: 'memory',
    notice: '',
    audioState: {},
    listeningState: {},
    recordingUrls: new Map(),
    loadingRecordings: new Set(),
    compositions: new Set(),
    pendingFocus: null,
    submitting: false,
    candidateFonts: { en: '', vi: '' }
  };

  const takeGuard = createTakeGuard({ idFactory: (number) => `take-${Date.now().toString(36)}-${number}` });
  const audio = createAudioController({ onChange: (state) => { runtime.audioState = state; render(); } });
  const recordingCommit = createRecordingCommitController({
    takeGuard,
    commitRecording: (payload) => runtime.storage.commitRecording(payload)
  });

  function currentQuestion() { return QUESTIONS.find((question) => question.questionId === runtime.draft?.activeQuestionId) || QUESTIONS[0]; }
  function summary() { return summarizeAssessment(QUESTIONS, runtime.draft || createDraft({ attemptId: 'memory' })); }
  function saveStateText() {
    if (!runtime.queue || !runtime.draft) return;
    const status = runtime.queue.getState(runtime.draft.revision).status;
    runtime.persistenceState = status === 'dirty' ? 'saving' : status;
  }

  function render() {
    if (!runtime.draft) return;
    document.documentElement.lang = runtime.draft.locale;
    document.documentElement.style.setProperty('--etu-text-scale', String(Number(runtime.draft.textScale || 100) / 100));
    if (runtime.candidateFonts.en || runtime.candidateFonts.vi) {
      const selected = runtime.candidateFonts[runtime.draft.locale] || 'Noto Sans';
      document.body.style.setProperty('--etu-font', `'${selected.replaceAll("'", '')}', 'Noto Sans', system-ui, sans-serif`);
    } else document.body.style.removeProperty('--etu-font');
    const copy = getCopy(runtime.draft.locale);
    const assessment = summary();
    headerRoot.innerHTML = renderHeaderTools({ draft: runtime.draft, copy, persistenceState: runtime.persistenceState });
    appRoot.innerHTML = renderApp({ draft: runtime.draft, sections: SECTIONS, questions: QUESTIONS, summary: assessment, currentQuestion: currentQuestion(), copy, persistenceState: runtime.persistenceState, audioState: runtime.audioState, recordingUrl: runtime.recordingUrls.get(runtime.draft.activeQuestionId) || '', listeningState: runtime.listeningState, recovery: runtime.recovery, notice: runtime.notice });
    footerRoot.innerHTML = renderFooterStatus({ persistenceState: runtime.persistenceState, copy, notice: runtime.notice });
    wireListeningAudio();
    if (runtime.pendingFocus) {
      const target = document.getElementById(runtime.pendingFocus);
      if (target) { target.focus(); if (typeof target.setSelectionRange === 'function') { const end = target.value.length; target.setSelectionRange(end, end); } }
      runtime.pendingFocus = null;
    }
    if (runtime.draft.view === 'question' && currentQuestion()?.type === 'speaking') {
      const canvas = document.getElementById('et-recorder-canvas');
      if (canvas) drawBaseline(canvas);
      loadCurrentRecording();
    }
    if (runtime.draft.view === 'miccheck') {
      const canvas = document.getElementById('et-mic-canvas');
      if (canvas) drawBaseline(canvas);
    }
    announcePage();
  }

  function loadCurrentRecording() {
    const question = currentQuestion();
    const ref = question && runtime.draft.recordingRefs?.[question.questionId];
    if (!runtime.storage || !ref || runtime.recordingUrls.has(question.questionId) || runtime.loadingRecordings.has(question.questionId)) return;
    runtime.loadingRecordings.add(question.questionId);
    runtime.storage.loadRecording({ attemptId: runtime.draft.attemptId, questionId: question.questionId, takeId: ref.takeId }).then((blob) => {
      if (blob && runtime.draft.recordingRefs?.[question.questionId]?.takeId === ref.takeId) runtime.recordingUrls.set(question.questionId, URL.createObjectURL(blob));
    }).catch(() => {}).finally(() => { runtime.loadingRecordings.delete(question.questionId); render(); });
  }

  function drawBaseline(canvas) {
    const context = canvas.getContext?.('2d');
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || 600));
    const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || 100));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.clearRect(0, 0, width, height);
    context.strokeStyle = '#94a3b8'; context.lineWidth = 1; context.beginPath();
    context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
  }

  function announcePage() {
    if (!window.parent || window.parent === window) return;
    const question = currentQuestion();
    const page = runtime.draft.view === 'question' ? (question?.sectionId === 'listen_write' ? 'listening' : question?.sectionId || 'intro') : runtime.draft.view;
    window.parent.postMessage({ type: 'etui:page', skin: 'd', revisionId: REVISION_ID, page, view: runtime.draft.view }, '*');
  }

  async function enqueueDraft(nextDraft) {
    runtime.draft = nextDraft;
    if (!runtime.queue) { runtime.persistenceState = 'memory'; render(); return; }
    runtime.persistenceState = 'saving';
    render();
    runtime.queue.enqueue(nextDraft).then(() => { saveStateText(); render(); }).catch((error) => { runtime.persistenceState = 'error'; runtime.notice = error.code === 'REVISION_CONFLICT' ? 'This demo changed in another tab. Reload to recover the newest saved draft.' : ''; render(); });
  }

  function dispatch(action, focusId = null) {
    if (runtime.recovery || !runtime.draft) return runtime.draft;
    const next = applyAction(runtime.draft, action, QUESTIONS);
    if (next === runtime.draft) return next;
    runtime.pendingFocus = focusId;
    enqueueDraft(next);
    return next;
  }

  async function persistRecording(question, result, takeId, fixture = false) {
    const previousRef = runtime.draft.recordingRefs?.[question.questionId] || null;
    const ref = { recordId: `${runtime.draft.attemptId}:${question.questionId}:${takeId}`, takeId, mimeType: result.mimeType || result.blob.type || 'audio/wav', durationMs: Number(result.durationMs) || 0, fixture };
    const candidate = applyAction(runtime.draft, { type: 'set-recording-ref', questionId: question.questionId, recordingRef: ref }, QUESTIONS);
    if (!runtime.storage) {
      runtime.recordingUrls.set(question.questionId, result.url || (URL.createObjectURL ? URL.createObjectURL(result.blob) : ''));
      await enqueueDraft(candidate);
      runtime.notice = fixture ? getCopy(runtime.draft.locale).qaFixture : '';
      render();
      return ref;
    }
    const committed = await recordingCommit.commit({ draft: candidate, questionId: question.questionId, takeId, blob: result.blob, metadata: ref, previousRef });
    if (!committed.ok) {
      if (result.url && URL.revokeObjectURL) URL.revokeObjectURL(result.url);
      runtime.audioState = { ...runtime.audioState, status: 'error', questionId: question.questionId, error: 'processing' };
      render();
      return null;
    }
    const oldUrl = runtime.recordingUrls.get(question.questionId);
    if (oldUrl && oldUrl !== result.url && URL.revokeObjectURL) URL.revokeObjectURL(oldUrl);
    runtime.recordingUrls.set(question.questionId, result.url || (URL.createObjectURL ? URL.createObjectURL(result.blob) : ''));
    await enqueueDraft(candidate);
    runtime.notice = fixture ? getCopy(runtime.draft.locale).qaFixture : '';
    return committed.ref;
  }

  async function createFixtureRecording(question) {
    const takeId = `qa-${Date.now().toString(36)}`;
    const blob = simpleFixtureWav();
    const url = URL.createObjectURL ? URL.createObjectURL(blob) : '';
    return persistRecording(question, { blob, url, mimeType: blob.type, durationMs: 250 }, takeId, true);
  }

  async function startNewAttempt({ resetCurrent = false } = {}) {
    if (resetCurrent && runtime.storage && runtime.draft) await runtime.storage.resetAttempt(runtime.draft.attemptId);
    runtime.audioState = {};
    audio.cancel();
    const id = makeAttemptId();
    setStoredAttemptId(id);
    runtime.draft = createDraft({ attemptId: id, revisionId: REVISION_ID, contentVersion: CONTENT_VERSION });
    runtime.recovery = null;
    runtime.notice = '';
    if (runtime.queue) runtime.persistenceState = 'saving';
    render();
    if (runtime.queue) { runtime.queue.enqueue(runtime.draft).then(() => { saveStateText(); render(); }).catch(() => { runtime.persistenceState = 'error'; render(); }); }
  }

  function missingTarget() {
    const assessment = summary();
    for (const item of assessment.items) {
      if (item.state !== 'complete') return { questionId: item.questionId, blankId: item.missingBlankIds[0] || null };
    }
    return null;
  }

  async function guardRecordingNavigation() {
    if (!['requesting', 'recording', 'processing'].includes(runtime.audioState.status)) return true;
    if (!window.confirm('Stop the current recording before leaving this group?')) return false;
    if (runtime.audioState.status === 'recording') await stopRecording();
    return runtime.audioState.status !== 'processing';
  }

  async function goTo(questionId, view = 'question', focusId = null) {
    if (!(await guardRecordingNavigation())) return;
    if (!QUESTIONS.some((question) => question.questionId === questionId)) return;
    dispatch({ type: 'set-active-question', questionId, view }, focusId);
  }

  async function startRecording(questionId) {
    if (runtime.audioState.status === 'recording' || runtime.audioState.status === 'processing') return;
    const takeId = recordingCommit.begin(questionId);
    runtime.audioState = { status: 'requesting', questionId, takeId };
    render();
    try { await audio.start(questionId); } catch (_) { runtime.audioState = audio.getState(); render(); }
    return takeId;
  }

  async function stopRecording() {
    const questionId = runtime.audioState.questionId;
    const takeId = runtime.audioState.takeId;
    const result = await audio.stop();
    if (!result || !questionId || !takeId || !recordingCommit) return;
    if (!takeGuard.isCurrent(questionId, takeId)) return;
    await persistRecording(QUESTIONS.find((question) => question.questionId === questionId), result, takeId);
    takeGuard.invalidate(questionId);
    runtime.audioState = { ...audio.getState(), questionId };
    render();
  }

  function playUrl(url) {
    if (!url) return;
    const player = new Audio(url);
    player.addEventListener('ended', () => render(), { once: true });
    player.play().catch(() => {});
  }

  function wireListeningAudio() {
    const element = document.getElementById('et-listening-audio');
    if (!element) return;
    element.playbackRate = Number(runtime.listeningState.rate || 1);
    element.addEventListener('timeupdate', () => {
      runtime.listeningState = { ...runtime.listeningState, progress: element.duration ? (element.currentTime / element.duration) * 1000 : 0, currentTime: element.currentTime, duration: element.duration || 0, playing: !element.paused };
      const progress = document.querySelector('[data-audio-progress]');
      if (progress) progress.value = String(runtime.listeningState.progress || 0);
      const time = document.querySelector('[data-audio-time]');
      if (time) time.textContent = `${formatSeconds(element.currentTime)} / ${formatSeconds(element.duration)}`;
    });
    element.addEventListener('ended', () => { runtime.listeningState = { ...runtime.listeningState, playing: false, progress: 1000 }; render(); });
    element.addEventListener('error', () => { runtime.listeningState = { ...runtime.listeningState, audioUrl: false }; render(); }, { once: true });
  }

  async function submitDemo() {
    if (runtime.submitting) return;
    const assessment = summary();
    const missingWritten = assessment.items.some((item) => item.type !== 'speaking' && item.missingBlankIds.length);
    const missingSpeaking = assessment.items.some((item) => item.type === 'speaking' && item.state !== 'complete');
    if (missingSpeaking || (missingWritten && !runtime.draft.reviewAcknowledged)) { runtime.notice = getCopy(runtime.draft.locale).submitBlocked; render(); return; }
    runtime.submitting = true;
    try {
      if (runtime.queue) await runtime.queue.flushNow();
      const receiptId = `demo-d-${Date.now().toString(36)}`;
      let submission;
      if (runtime.storage) submission = await runtime.storage.commitSubmission({ attemptId: runtime.draft.attemptId, expectedRevision: runtime.draft.revision, receiptId });
      else submission = { receiptId, draftRevision: runtime.draft.revision, committedAt: new Date().toISOString(), mode: 'demo-local' };
      runtime.draft = { ...runtime.draft, submission, view: 'done' };
      runtime.notice = '';
      runtime.persistenceState = 'saved';
      render();
    } catch (error) {
      runtime.persistenceState = 'error';
      runtime.notice = error.code === 'REVISION_CONFLICT' ? 'This demo changed in another tab. Reload to recover the newest saved draft.' : getCopy(runtime.draft.locale).submitBlocked;
      render();
    } finally { runtime.submitting = false; }
  }

  function completeLegacyImport() {
    const imported = importLegacyDemoDraft({ q: 3, answers: { vocab_q1: ['mammals', 'diet', 'easy', 'throat'] }, flags: { vocab_q1: true } }, 'b', QUESTIONS);
    let next = runtime.draft;
    for (const [questionId, values] of Object.entries(imported.answers)) for (const [blankId, value] of Object.entries(values)) next = applyAction(next, { type: 'set-answer', questionId, blankId, value }, QUESTIONS);
    for (const questionId of Object.keys(imported.flags)) next = applyAction(next, { type: 'toggle-flag', questionId }, QUESTIONS);
    runtime.notice = `Imported Demo QA answers from old lab (${imported.sourceSkin})`;
    enqueueDraft(next);
  }

  const qa = createQATools({
    questions: QUESTIONS,
    getDraft: () => runtime.draft,
    dispatch,
    createFixtureRecording,
    reset: async () => startNewAttempt({ resetCurrent: true })
  });

  async function onAction(action, element) {
    const questionId = element?.dataset.questionId;
    switch (action) {
      case 'locale': dispatch({ type: 'set-locale', locale: element.dataset.value }); break;
      case 'scale': dispatch({ type: 'set-text-scale', textScale: Number(element.dataset.value) }); break;
      case 'start-demo': dispatch({ type: 'set-view', view: runtime.draft.micCheck === 'not-checked' ? 'miccheck' : 'question' }); break;
      case 'continue-demo': { const target = resolveResumeTarget(runtime.draft, QUESTIONS); dispatch({ type: 'set-active-question', questionId: target.questionId, view: target.view }); break; }
      case 'new-demo': if (window.confirm(getCopy(runtime.draft.locale).introNewConfirm)) await startNewAttempt(); break;
      case 'nav-question': case 'jump-question': await goTo(questionId); break;
      case 'jump-blank': await goTo(questionId, 'question', `answer-${element.dataset.blankId}`); break;
      case 'open-overview': document.getElementById('et-overview-dialog')?.showModal?.(); break;
      case 'close-overview': document.getElementById('et-overview-dialog')?.close?.(); break;
      case 'previous-question': await goTo(QUESTIONS[Math.max(0, QUESTIONS.findIndex((q) => q.questionId === runtime.draft.activeQuestionId) - 1)].questionId); break;
      case 'next-question': await goTo(QUESTIONS[Math.min(QUESTIONS.length - 1, QUESTIONS.findIndex((q) => q.questionId === runtime.draft.activeQuestionId) + 1)].questionId); break;
      case 'toggle-flag': dispatch({ type: 'toggle-flag', questionId }); break;
      case 'review': if (await guardRecordingNavigation()) dispatch({ type: 'set-view', view: 'review' }); break;
      case 'back-to-question': await goTo(runtime.draft.activeQuestionId, 'question'); break;
      case 'review-ack': dispatch({ type: 'acknowledge-blanks' }); break;
      case 'submit-demo': await submitDemo(); break;
      case 'done-again': dispatch({ type: 'set-view', view: 'done' }); break;
      case 'mic-start': await audio.start(null); break;
      case 'mic-stop': await audio.stop(); dispatch({ type: 'set-mic-check', micCheck: 'checked' }); break;
      case 'mic-play': playUrl(runtime.audioState.testUrl); break;
      case 'mic-continue': dispatch({ type: 'set-mic-check', micCheck: 'checked' }); dispatch({ type: 'set-active-question', questionId: 'speaking_q1', view: 'question' }); break;
      case 'mic-skip': audio.cancel(); dispatch({ type: 'set-mic-check', micCheck: 'skipped' }); dispatch({ type: 'set-active-question', questionId: 'speaking_q1', view: 'question' }); break;
      case 'record-start': { const takeId = await startRecording(questionId); runtime.audioState = { ...runtime.audioState, takeId, questionId }; render(); break; }
      case 'record-stop': await stopRecording(); break;
      case 'record-play': playUrl(runtime.recordingUrls.get(questionId)); break;
      case 'audio-toggle': { const audioElement = document.getElementById('et-listening-audio'); if (audioElement?.paused) await audioElement.play().catch(() => {}); else audioElement?.pause(); runtime.listeningState = { ...runtime.listeningState, playing: Boolean(audioElement && !audioElement.paused) }; render(); break; }
      case 'audio-seek': { const audioElement = document.getElementById('et-listening-audio'); if (audioElement?.duration) audioElement.currentTime = (Number(element.value) / 1000) * audioElement.duration; break; }
      case 'audio-rate': runtime.listeningState = { ...runtime.listeningState, rate: Number(element.value) }; { const audioElement = document.getElementById('et-listening-audio'); if (audioElement) audioElement.playbackRate = Number(element.value); } break;
      case 'audio-retry': runtime.listeningState = { ...runtime.listeningState, audioUrl: null }; render(); break;
      case 'qa-fill-all': await qa.fillAll(); runtime.notice = qa.lastNotice(); render(); break;
      case 'qa-partial': await qa.makePartial(); runtime.notice = qa.lastNotice(); render(); break;
      case 'qa-clear-current': qa.clearCurrent(runtime.draft.activeQuestionId); runtime.notice = qa.lastNotice(); render(); break;
      case 'qa-toggle-flag': await qa.toggleFlag(runtime.draft.activeQuestionId); runtime.notice = 'Demo QA flag toggled'; render(); break;
      case 'qa-jump-missing': { const target = qa.jumpMissing(); if (target) await goTo(target.questionId, 'question', target.blankId ? `answer-${target.blankId}` : null); break; }
      case 'qa-complete': await qa.complete(); runtime.notice = qa.lastNotice(); await submitDemo(); break;
      case 'qa-reset': if (window.confirm(getCopy(runtime.draft.locale).introNewConfirm)) await qa.reset(); break;
      case 'qa-import': completeLegacyImport(); break;
      case 'retry-save': if (runtime.queue) runtime.queue.retry().then(() => { saveStateText(); render(); }).catch(() => { runtime.persistenceState = 'error'; render(); }); break;
    }
  }

  appRoot.addEventListener('click', (event) => {
    const element = event.target.closest('[data-action],[data-mic-action],[data-record-action],[data-audio-action]');
    if (!element) return;
    const action = element.dataset.action || (element.dataset.micAction ? `mic-${element.dataset.micAction}` : element.dataset.recordAction ? `record-${element.dataset.recordAction}` : `audio-${element.dataset.audioAction}`);
    if (action === 'locale' || action === 'scale' || action === 'review-ack' || action === 'audio-rate' || action === 'audio-seek') return;
    event.preventDefault(); onAction(action, element);
  });
  appRoot.addEventListener('change', (event) => {
    const element = event.target.closest('[data-answer-question],[data-review-ack],[data-audio-action]');
    if (!element) return;
    if (element.dataset.answerQuestion) { runtime.pendingFocus = element.id; dispatch({ type: 'set-answer', questionId: element.dataset.answerQuestion, blankId: element.dataset.answerBlank, value: element.value }, element.id); }
    else if (element.dataset.action === 'review-ack') dispatch({ type: 'acknowledge-blanks' });
    else if (element.dataset.audioAction === 'rate') onAction('audio-rate', element);
    else if (element.dataset.audioAction === 'seek') onAction('audio-seek', element);
  });
  appRoot.addEventListener('input', (event) => {
    const element = event.target.closest('[data-answer-question]');
    if (!element || runtime.compositions.has(element)) return;
    runtime.pendingFocus = element.id;
    dispatch({ type: 'set-answer', questionId: element.dataset.answerQuestion, blankId: element.dataset.answerBlank, value: element.value }, element.id);
  });
  appRoot.addEventListener('compositionstart', (event) => { runtime.compositions.add(event.target); });
  appRoot.addEventListener('compositionend', (event) => { runtime.compositions.delete(event.target); event.target.dispatchEvent(new Event('input', { bubbles: true })); });
  headerRoot.addEventListener('click', (event) => { const element = event.target.closest('[data-action]'); if (element) onAction(element.dataset.action, element); });
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'etui:goto' && message.skin === 'd' && (!message.revisionId || message.revisionId === REVISION_ID)) {
      const firstBySection = (sectionId) => QUESTIONS.find((question) => question.sectionId === sectionId);
      const target = message.page === 'listening' ? firstBySection('listen_write') : firstBySection(message.page);
      if (target) goTo(target.questionId);
      else if (['intro', 'miccheck', 'review', 'done'].includes(message.page)) dispatch({ type: 'set-view', view: message.page });
    }
    if (message.type === 'etui:fonts' && message.skin === 'd' && (!message.revisionId || message.revisionId === REVISION_ID)) {
      runtime.candidateFonts = { en: String(message.en || ''), vi: String(message.vi || '') };
      render();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') runtime.queue?.flushNow?.().catch(() => {}); });
  window.addEventListener('beforeunload', () => { runtime.queue?.flushNow?.().catch(() => {}); audio.destroy(); });

  try {
    runtime.storage = await openDemoStore();
    runtime.queue = createDraftQueue({ saveDraft: (draft) => runtime.storage.saveDraft(draft) });
    const storedId = getStoredAttemptId();
    const storedDraft = storedId ? await runtime.storage.loadAttempt(storedId) : null;
    if (storedDraft) {
      if (storedDraft.schemaVersion !== 1 || storedDraft.contentVersion !== CONTENT_VERSION || storedDraft.revisionId !== REVISION_ID) runtime.recovery = { message: getCopy('en').recoveryCopy };
      else runtime.draft = storedDraft;
    }
    if (!runtime.draft) { runtime.draft = createDraft({ attemptId: storedId || makeAttemptId(), revisionId: REVISION_ID, contentVersion: CONTENT_VERSION }); setStoredAttemptId(runtime.draft.attemptId); }
    runtime.persistenceState = 'saved';
  } catch (_) {
    runtime.storage = null; runtime.queue = null; runtime.persistenceState = 'memory'; runtime.draft = createDraft({ attemptId: makeAttemptId(), revisionId: REVISION_ID, contentVersion: CONTENT_VERSION }); setStoredAttemptId(runtime.draft.attemptId);
  }
  render();
  if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'etui:ready', skin: 'd', revisionId: REVISION_ID, contentVersion: CONTENT_VERSION }, '*');
  return { runtime, questions: QUESTIONS, sections: SECTIONS };
}

function formatSeconds(value) {
  if (!Number.isFinite(Number(value))) return '0:00';
  const total = Math.max(0, Math.floor(Number(value)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

boot().catch((error) => {
  const app = document.getElementById('et-app');
  if (app) app.innerHTML = `<section class="et-recovery"><h1 class="et-recovery-title">Demo D could not start</h1><p class="et-recovery-copy">${String(error.message || error)}</p></section>`;
});

export { boot, QUESTIONS, SECTIONS };
