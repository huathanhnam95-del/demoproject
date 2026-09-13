import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_DATA } from '../../public/js/entrance-test-ui/demo-data.js';
import {
  applyAction,
  createDraft,
  importLegacyDemoDraft,
  resolveResumeTarget,
  summarizeAssessment,
  summarizeQuestion
} from '../../public/js/entrance-test-ui/state.js';
import legacyDraft from '../fixtures/entrance-test-ui/legacy-draft.json' with { type: 'json' };

const questions = DEMO_DATA.sections.flatMap((section) => section.questions);
const vocabQ1 = questions.find((question) => question.questionId === 'vocab_q1');
const speakingQ1 = questions.find((question) => question.questionId === 'speaking_q1');

function draft() {
  return createDraft({
    attemptId: 'attempt-state-test',
    revisionId: 'academic-noto-v1',
    contentVersion: DEMO_DATA.version
  });
}

test('createDraft has stable identity, explicit view state and no cached counts', () => {
  const value = draft();
  assert.deepEqual(value, {
    schemaVersion: 1,
    revisionId: 'academic-noto-v1',
    contentVersion: 'entrance_test_36plus_v1',
    attemptId: 'attempt-state-test',
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
  });
});

test('answer actions preserve exact text and unrelated responses while counts derive from stable blank IDs', () => {
  let value = draft();
  value = applyAction(value, {
    type: 'set-answer', questionId: 'vocab_q1', blankId: 'vocab_q1__b1', value: '  primates  '
  }, questions);
  value = applyAction(value, {
    type: 'set-answer', questionId: 'vocab_q1', blankId: 'vocab_q1__b2', value: 'diet, intentionally'
  }, questions);

  assert.equal(value.answers.vocab_q1['vocab_q1__b1'], '  primates  ');
  assert.equal(value.answers.vocab_q1['vocab_q1__b2'], 'diet, intentionally');
  assert.equal(value.revision, 2);
  assert.deepEqual(summarizeQuestion(vocabQ1, value), {
    questionId: 'vocab_q1',
    sectionId: 'vocab',
    type: 'mc',
    answered: 2,
    total: 4,
    state: 'partial',
    flagged: false,
    missingBlankIds: ['vocab_q1__b3', 'vocab_q1__b4'],
    recordingReady: false
  });
});

test('flags, locale and text size do not alter answer completion', () => {
  let value = draft();
  value = applyAction(value, { type: 'toggle-flag', questionId: 'vocab_q1' }, questions);
  value = applyAction(value, { type: 'set-locale', locale: 'vi' }, questions);
  value = applyAction(value, { type: 'set-text-scale', textScale: 130 }, questions);
  const summary = summarizeQuestion(vocabQ1, value);

  assert.equal(summary.flagged, true);
  assert.equal(summary.answered, 0);
  assert.equal(summary.state, 'empty');
  assert.equal(value.locale, 'vi');
  assert.equal(value.textScale, 130);
});

test('speaking is complete only for committed recording references or explicit QA fixtures', () => {
  let value = draft();
  assert.equal(summarizeQuestion(speakingQ1, value).state, 'empty');
  value = applyAction(value, {
    type: 'set-recording-ref',
    questionId: 'speaking_q1',
    recordingRef: { recordId: 'r1', takeId: 't1', mimeType: 'audio/wav', durationMs: 1200 }
  }, questions);
  assert.equal(summarizeQuestion(speakingQ1, value).state, 'complete');
  assert.equal(summarizeQuestion(speakingQ1, value).recordingReady, true);
});

test('assessment summary separates complete, partial, empty and flagged groups', () => {
  let value = draft();
  value = applyAction(value, { type: 'set-answer', questionId: 'vocab_q1', blankId: 'vocab_q1__b1', value: 'x' }, questions);
  value = applyAction(value, { type: 'toggle-flag', questionId: 'grammar_q2' }, questions);
  const summary = summarizeAssessment(questions, value);

  assert.equal(summary.totalQuestions, 13);
  assert.equal(summary.completeQuestions, 0);
  assert.equal(summary.partialQuestions, 1);
  assert.equal(summary.emptyQuestions, 12);
  assert.deepEqual(summary.flaggedQuestionIds, ['grammar_q2']);
  assert.equal(summary.filledBlanks, 1);
  assert.equal(summary.totalBlanks, 45);
});

test('resume targets the active stable ID, then the first incomplete group', () => {
  let value = draft();
  value = applyAction(value, { type: 'set-answer', questionId: 'vocab_q1', blankId: 'vocab_q1__b1', value: 'x' }, questions);
  value = applyAction(value, { type: 'set-active-question', questionId: 'vocab_q1', view: 'question' }, questions);
  assert.deepEqual(resolveResumeTarget(value, questions), { questionId: 'vocab_q1', view: 'question' });

  value = { ...value, activeQuestionId: 'unknown' };
  assert.deepEqual(resolveResumeTarget(value, questions), { questionId: 'speaking_q1', view: 'question' });
});

test('unsupported content versions are rejected and legacy import maps ordinal answers without mutating source', () => {
  assert.throws(() => applyAction({ ...draft(), contentVersion: 'old-version' }, {
    type: 'set-answer', questionId: 'vocab_q1', blankId: 'vocab_q1__b1', value: 'x'
  }, questions), /content version/);

  const imported = importLegacyDemoDraft(legacyDraft, 'b', questions);
  assert.equal(imported.sourceSkin, 'b');
  assert.equal(imported.activeQuestionId, 'vocab_q1');
  assert.equal(imported.answers.vocab_q1['vocab_q1__b1'], 'primates');
  assert.equal(imported.answers.vocab_q1['vocab_q1__b3'], '');
  assert.equal(imported.answers.listen_write_q1['listen_write_q1__b7'], 'through');
  assert.equal(imported.flags.vocab_q1, true);
  assert.deepEqual(legacyDraft.answers.vocab_q1, ['primates', 'diet', '', 'throat']);
});

test('final blank acknowledgement is distinct from committed submission', () => {
  let value = draft();
  value = applyAction(value, { type: 'acknowledge-blanks' }, questions);
  assert.equal(value.reviewAcknowledged, true);
  assert.equal(value.submission, null);
  value = applyAction(value, {
    type: 'commit-submission',
    receiptId: 'demo-receipt-1',
    committedAt: '2026-09-13T00:00:00.000Z'
  }, questions);
  assert.deepEqual(value.submission, {
    receiptId: 'demo-receipt-1',
    draftRevision: value.revision,
    committedAt: '2026-09-13T00:00:00.000Z',
    mode: 'demo-local'
  });
  assert.equal(value.view, 'done');
});
