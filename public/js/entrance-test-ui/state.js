export const SCHEMA_VERSION = 1;
export const CONTENT_VERSION = 'entrance_test_36plus_v1';
export const REVISION_ID = 'academic-noto-v1';

const VIEWS = new Set(['intro', 'miccheck', 'question', 'review', 'done']);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function questionById(questionIndex, questionId) {
  const question = (questionIndex || []).find((item) => item.questionId === questionId);
  if (!question) throw new Error(`Unknown question ID: ${questionId}`);
  return question;
}

function blankById(question, blankId) {
  const part = (question.parts || []).find((item) => item.type === 'blank' && item.blankId === blankId);
  if (!part) throw new Error(`Unknown blank ID: ${blankId}`);
  return part;
}

function assertDraft(draft) {
  if (!draft || draft.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported draft schema version');
  if (draft.contentVersion !== CONTENT_VERSION) throw new Error(`Unsupported content version: ${draft.contentVersion}`);
}

function changed(draft, next) {
  next.revision = (Number(draft.revision) || 0) + 1;
  return next;
}

function sameObject(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createDraft({ attemptId, revisionId = REVISION_ID, contentVersion = CONTENT_VERSION }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    revisionId,
    contentVersion,
    attemptId: String(attemptId || ''),
    revision: 0,
    view: 'intro',
    activeQuestionId: 'speaking_q1',
    answers: {},
    flags: {},
    recordingRefs: {},
    playback: {},
    locale: 'en',
    textScale: 100,
    micCheck: 'not-checked',
    reviewAcknowledged: false,
    submission: null
  };
}

export function applyAction(draft, action, questionIndex = []) {
  assertDraft(draft);
  if (!action || typeof action !== 'object') throw new TypeError('Action is required');
  const next = clone(draft);

  switch (action.type) {
    case 'set-answer': {
      const question = questionById(questionIndex, action.questionId);
      const blank = blankById(question, action.blankId);
      const value = String(action.value ?? '');
      if (!next.answers[question.questionId]) next.answers[question.questionId] = {};
      if (next.answers[question.questionId][blank.blankId] === value) return draft;
      next.answers[question.questionId][blank.blankId] = value;
      return changed(draft, next);
    }
    case 'clear-answer': {
      const question = questionById(questionIndex, action.questionId);
      const blank = blankById(question, action.blankId);
      if (!next.answers[question.questionId] || !(blank.blankId in next.answers[question.questionId])) return draft;
      delete next.answers[question.questionId][blank.blankId];
      if (!Object.keys(next.answers[question.questionId]).length) delete next.answers[question.questionId];
      return changed(draft, next);
    }
    case 'toggle-flag': {
      questionById(questionIndex, action.questionId);
      if (next.flags[action.questionId]) delete next.flags[action.questionId];
      else next.flags[action.questionId] = true;
      return changed(draft, next);
    }
    case 'set-active-question': {
      questionById(questionIndex, action.questionId);
      const view = action.view && VIEWS.has(action.view) ? action.view : 'question';
      if (next.activeQuestionId === action.questionId && next.view === view) return draft;
      next.activeQuestionId = action.questionId;
      next.view = view;
      return changed(draft, next);
    }
    case 'set-view': {
      if (!VIEWS.has(action.view)) throw new Error(`Unknown view: ${action.view}`);
      if (next.view === action.view) return draft;
      next.view = action.view;
      return changed(draft, next);
    }
    case 'set-locale': {
      if (!['en', 'vi'].includes(action.locale)) throw new Error(`Unknown locale: ${action.locale}`);
      if (next.locale === action.locale) return draft;
      next.locale = action.locale;
      return changed(draft, next);
    }
    case 'set-text-scale': {
      const textScale = Number(action.textScale);
      if (![100, 115, 130].includes(textScale)) throw new Error(`Unsupported text scale: ${action.textScale}`);
      if (next.textScale === textScale) return draft;
      next.textScale = textScale;
      return changed(draft, next);
    }
    case 'set-mic-check': {
      if (!['not-checked', 'checked', 'skipped'].includes(action.micCheck)) throw new Error('Unknown microphone state');
      if (next.micCheck === action.micCheck) return draft;
      next.micCheck = action.micCheck;
      return changed(draft, next);
    }
    case 'set-recording-ref': {
      const question = questionById(questionIndex, action.questionId);
      if (question.type !== 'speaking') throw new Error('Recording references belong to speaking questions');
      const ref = action.recordingRef ? clone(action.recordingRef) : null;
      if (sameObject(next.recordingRefs[action.questionId] || null, ref)) return draft;
      if (ref) next.recordingRefs[action.questionId] = ref;
      else delete next.recordingRefs[action.questionId];
      return changed(draft, next);
    }
    case 'set-playback': {
      questionById(questionIndex, action.questionId);
      const playback = clone(action.playback || {});
      if (sameObject(next.playback[action.questionId] || {}, playback)) return draft;
      next.playback[action.questionId] = playback;
      return changed(draft, next);
    }
    case 'acknowledge-blanks':
      if (next.reviewAcknowledged) return draft;
      next.reviewAcknowledged = true;
      return changed(draft, next);
    case 'commit-submission': {
      if (next.submission) return draft;
      const receiptId = String(action.receiptId || '');
      if (!receiptId) throw new Error('Receipt ID is required');
      changed(draft, next);
      next.submission = {
        receiptId,
        draftRevision: next.revision,
        committedAt: String(action.committedAt || new Date().toISOString()),
        mode: 'demo-local'
      };
      next.view = 'done';
      return next;
    }
    default:
      throw new Error(`Unknown action: ${action.type}`);
  }
}

function isRecordingReady(ref) {
  return Boolean(ref && ref.recordId && ref.takeId && ref.mimeType && Number.isFinite(Number(ref.durationMs)) && Number(ref.durationMs) >= 0);
}

export function summarizeQuestion(question, draft, runtimeReadiness = {}) {
  const flagged = Boolean(draft.flags && draft.flags[question.questionId]);
  if (question.type === 'speaking') {
    const ref = draft.recordingRefs && draft.recordingRefs[question.questionId];
    const recordingReady = isRecordingReady(ref) || Boolean(runtimeReadiness.fixtures && runtimeReadiness.fixtures[question.questionId]);
    return {
      questionId: question.questionId,
      sectionId: question.sectionId,
      type: question.type,
      answered: recordingReady ? 1 : 0,
      total: 1,
      state: recordingReady ? 'complete' : 'empty',
      flagged,
      missingBlankIds: [],
      recordingReady
    };
  }

  const expected = (question.parts || []).filter((part) => part.type === 'blank');
  const values = (draft.answers && draft.answers[question.questionId]) || {};
  const missingBlankIds = expected.filter((part) => !String(values[part.blankId] ?? '').trim()).map((part) => part.blankId);
  const answered = expected.length - missingBlankIds.length;
  return {
    questionId: question.questionId,
    sectionId: question.sectionId,
    type: question.type,
    answered,
    total: expected.length,
    state: answered === 0 ? 'empty' : answered === expected.length ? 'complete' : 'partial',
    flagged,
    missingBlankIds,
    recordingReady: false
  };
}

export function summarizeAssessment(questions, draft, runtimeReadiness = {}) {
  const items = questions.map((question) => summarizeQuestion(question, draft, runtimeReadiness));
  const bySection = {};
  for (const item of items) {
    const section = bySection[item.sectionId] || { sectionId: item.sectionId, total: 0, complete: 0, partial: 0, empty: 0, answered: 0, blanks: 0 };
    section.total += 1;
    section[item.state] += 1;
    section.answered += item.answered;
    section.blanks += item.total;
    bySection[item.sectionId] = section;
  }
  return {
    totalQuestions: items.length,
    completeQuestions: items.filter((item) => item.state === 'complete').length,
    partialQuestions: items.filter((item) => item.state === 'partial').length,
    emptyQuestions: items.filter((item) => item.state === 'empty').length,
    flaggedQuestionIds: items.filter((item) => item.flagged).map((item) => item.questionId),
    filledBlanks: items.reduce((sum, item) => sum + (item.type === 'speaking' ? 0 : item.answered), 0),
    totalBlanks: items.reduce((sum, item) => sum + (item.type === 'speaking' ? 0 : item.total), 0),
    missingQuestionIds: items.filter((item) => item.state !== 'complete').map((item) => item.questionId),
    items,
    bySection
  };
}

export function resolveResumeTarget(draft, questionIndex) {
  const questions = questionIndex || [];
  const active = questions.find((question) => question.questionId === draft.activeQuestionId);
  if (draft.submission && active) return { questionId: active.questionId, view: 'done' };
  if (active && draft.view !== 'done' && draft.view !== 'intro') return { questionId: active.questionId, view: draft.view };
  const firstIncomplete = questions.find((question) => summarizeQuestion(question, draft).state !== 'complete');
  return { questionId: (firstIncomplete || active || questions[0]).questionId, view: 'question' };
}

export function importLegacyDemoDraft(raw, skin, questionIndex) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const answers = {};
  const legacyAnswers = source.answers && typeof source.answers === 'object' ? source.answers : {};
  for (const question of questionIndex || []) {
    if (question.type === 'speaking') continue;
    const rawAnswers = legacyAnswers[question.questionId];
    if (!Array.isArray(rawAnswers) && (!rawAnswers || typeof rawAnswers !== 'object')) continue;
    const values = {};
    const blanks = (question.parts || []).filter((part) => part.type === 'blank');
    blanks.forEach((part, index) => {
      const value = Array.isArray(rawAnswers) ? rawAnswers[index] : rawAnswers[part.blankId];
      if (value !== undefined) values[part.blankId] = String(value);
    });
    if (Object.keys(values).length) answers[question.questionId] = values;
  }
  const flags = {};
  Object.entries(source.flags && typeof source.flags === 'object' ? source.flags : {}).forEach(([questionId, value]) => {
    if (value && (questionIndex || []).some((question) => question.questionId === questionId)) flags[questionId] = true;
  });
  const qIndex = Number.isInteger(source.q) ? source.q : -1;
  const activeQuestionId = questionIndex && questionIndex[qIndex] ? questionIndex[qIndex].questionId : (questionIndex[0] && questionIndex[0].questionId);
  return {
    sourceSkin: String(skin || ''),
    activeQuestionId,
    answers,
    flags,
    warnings: ['Imported text and flags only; legacy in-memory recordings were not recoverable.']
  };
}

export { isRecordingReady };
