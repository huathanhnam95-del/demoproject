import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHeaderTools, renderApp } from '../../public/js/entrance-test-ui/view.js';

const copy = {
  demoLabel: 'Demo D · Noto Sans', saved: 'Saved', saving: 'Saving', notSaved: 'Not saved', saveFailed: 'Save failed', retry: 'Retry',
  introTitle: 'Entrance assessment', introLead: 'Lead', introResume: 'Continue', introStart: 'Start', introNew: 'New', introSections: 'Sections', introChecks: ['Check'],
  speaking: 'Speaking', vocab: 'Vocabulary', grammar: 'Grammar', listen_write: 'Listening', speakingCopy: 'Speak', vocabCopy: 'Vocab', grammarCopy: 'Grammar', listen_writeCopy: 'Listen',
  instruction: 'Instruction', group: 'Group', of: 'of', completed: 'complete', partial: 'partial', unanswered: 'unanswered', answered: 'answered', flag: 'Flag', unflag: 'Unflag', overview: 'Overview', close: 'Close', previous: 'Previous', next: 'Next', review: 'Review', backToReview: 'Back', jump: 'Jump', choose: 'Choose', typeAnswer: 'Type', listeningPlayer: 'Audio', play: 'Play', pause: 'Pause', speed: 'Speed', noAudio: 'No audio', retryAudio: 'Retry audio',
  micTitle: 'Mic', micLead: 'Mic lead', micStart: 'Start mic', micStop: 'Stop mic', micPlay: 'Play mic', micSkip: 'Skip mic', micIdle: 'Idle', micRecording: 'Recording', micProcessing: 'Processing', micSaved: 'Saved', micPermission: 'Permission',
  recordingStart: 'Record', recordingStop: 'Stop', recordingReplace: 'Replace', recordingPlay: 'Play recording', recordingSaved: 'Saved recording', recordingProcessing: 'Processing', recordingFailed: 'Failed', elapsed: 'Elapsed',
  reviewTitle: 'Review', reviewLead: 'Review lead', missing: 'missing', nothingMissing: 'Nothing missing', acknowledge: 'Acknowledge', submitDemo: 'Finish', submitBlocked: 'Blocked', doneTitle: 'Done', doneLead: 'Done lead', receipt: 'Receipt', doneAgain: 'Again', textSize: 'Text size', language: 'Language', english: 'EN', vietnamese: 'VI', qa: 'QA', qaNote: 'QA note', qaFillAll: 'Fill', qaPartial: 'Partial', qaClear: 'Clear', qaFlag: 'Flag', qaJump: 'Jump', qaComplete: 'Complete', qaReset: 'Reset', qaImport: 'Import', qaFixture: 'Fixture', recoveryTitle: 'Recovery', recoveryCopy: 'Recovery copy', recoverNew: 'New', cancel: 'Cancel', current: 'Current', demo: 'Demo', textScale100: '100%', textScale115: '115%', textScale130: '130%'
};

const questionIndex = [
  { sectionId: 'vocab', questionId: 'vocab_q1', questionNumber: 1, type: 'mc', instructionVi: 'Hướng dẫn', parts: [
    { type: 'text', text: 'Before ' }, { type: 'blank', blankId: 'vocab_q1__b1', options: ['one', 'two'] }, { type: 'text', text: '.' }
  ] },
  { sectionId: 'speaking', questionId: 'speaking_q1', questionNumber: 1, type: 'speaking', text: 'Read this aloud.' },
  { sectionId: 'listen_write', questionId: 'listen_write_q1', questionNumber: 1, type: 'fill', audioUrl: 'audio.mp3', parts: [
    { type: 'text', text: 'Listen ' }, { type: 'blank', blankId: 'listen_write_q1__b1' }
  ] }
];

const sections = [
  { id: 'speaking', questions: [questionIndex[1]] },
  { id: 'vocab', questions: [questionIndex[0]] },
  { id: 'grammar', questions: [] },
  { id: 'listen_write', questions: [questionIndex[2]] }
];

const summary = {
  totalQuestions: 3, completeQuestions: 1, partialQuestions: 1, emptyQuestions: 1, filledBlanks: 0, totalBlanks: 2,
  items: [
    { questionId: 'vocab_q1', sectionId: 'vocab', type: 'mc', answered: 0, total: 1, state: 'empty', flagged: false, missingBlankIds: ['vocab_q1__b1'] },
    { questionId: 'speaking_q1', sectionId: 'speaking', type: 'speaking', answered: 1, total: 1, state: 'complete', flagged: true, missingBlankIds: [] },
    { questionId: 'listen_write_q1', sectionId: 'listen_write', type: 'fill', answered: 1, total: 1, state: 'complete', flagged: false, missingBlankIds: [] }
  ],
  bySection: { speaking: { total: 1, complete: 1, partial: 0, empty: 0, answered: 1 }, vocab: { total: 1, complete: 0, partial: 0, empty: 1, answered: 0 }, grammar: { total: 0, complete: 0, partial: 0, empty: 0, answered: 0 }, listen_write: { total: 1, complete: 1, partial: 0, empty: 0, answered: 1 } }
};

function draft(overrides = {}) {
  return { view: 'question', locale: 'vi', textScale: 115, activeQuestionId: 'vocab_q1', answers: {}, flags: { speaking_q1: true }, recordingRefs: {}, micCheck: 'skipped', reviewAcknowledged: false, submission: null, ...overrides };
}

test('header tools expose locale, scale and Noto Sans defaults without unsafe global controls', () => {
  const html = renderHeaderTools({ draft: draft(), copy, persistenceState: 'saved' });
  assert.match(html, /data-action="locale" data-value="vi"/);
  assert.match(html, /data-action="scale" data-value="115"/);
  assert.match(html, /Noto Sans/);
  assert.doesNotMatch(html, /font-family|etlab:fonts/);
});

test('question view renders stable accessible blank controls and task navigation', () => {
  const html = renderApp({ draft: draft(), sections, questions: questionIndex, summary, currentQuestion: questionIndex[0], copy, persistenceState: 'saved' });
  assert.match(html, /id="answer-vocab_q1__b1"/);
  assert.match(html, /for="answer-vocab_q1__b1"/);
  assert.match(html, /data-action="nav-question" data-question-id="speaking_q1"/);
  assert.match(html, /data-action="open-overview"/);
  assert.match(html, /data-action="toggle-flag"/);
});

test('review view separates missing items and requires acknowledgement before finish', () => {
  const html = renderApp({ draft: draft({ view: 'review' }), sections, questions: questionIndex, summary, copy, persistenceState: 'saved' });
  assert.match(html, /data-action="review-ack"/);
  assert.match(html, /data-action="submit-demo"/);
  assert.match(html, /data-action="jump-blank"[^>]*data-blank-id="vocab_q1__b1"/);
  assert.match(html, /data-action="back-to-question"/);
});

test('done view shows a local receipt and does not present learner submission controls', () => {
  const html = renderApp({ draft: draft({ view: 'done', submission: { receiptId: 'demo-d-abc123', committedAt: '2026-09-13T00:00:00.000Z' } }), sections, questions: questionIndex, summary, copy, persistenceState: 'saved' });
  assert.match(html, /demo-d-abc123/);
  assert.match(html, /demo-local/);
  assert.doesNotMatch(html, /data-action="submit-demo"/);
});
