import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHeaderTools, renderApp } from '../../public/js/entrance-test-ui/view.js';

const copy = {
  demoLabel: 'Demo D · Noto Sans', saved: 'Saved', saving: 'Saving', notSaved: 'Not saved', saveFailed: 'Save failed', retry: 'Retry',
  introTitle: 'Entrance assessment', introLead: 'Lead', introResume: 'Continue', introStart: 'Start', introNew: 'New', introSections: 'Sections', introChecks: ['Check'],
  speaking: 'Speaking', vocab: 'Vocabulary', grammar: 'Grammar', listen_write: 'Listening', speakingCopy: 'Speak', vocabCopy: 'Vocab', grammarCopy: 'Grammar', listen_writeCopy: 'Listen',
  instruction: 'Instruction', speakingInstruction: 'Read the passage aloud clearly and naturally. You can practise before recording.', vocabInstruction: 'Choose the best word for each blank.', grammarInstruction: 'Choose the correct form to complete the passage.', listen_writeInstruction: 'Listen to the recording and type the missing words.',
  question: 'Question', blank: 'Blank', blanksFilled: 'blanks filled', blanksMissing: 'blanks missing', recordingsSaved: 'recordings saved', groupsComplete: 'groups complete', partNavigation: 'Parts and questions', current: 'Current', flagged: 'flagged',
  group: 'Group', of: 'of', completed: 'complete', partial: 'partial', unanswered: 'unanswered', answered: 'answered', flag: 'Flag', unflag: 'Unflag', overview: 'Overview', close: 'Close', previous: 'Previous', next: 'Next', review: 'Review', backToReview: 'Back', jump: 'Jump', choose: 'Choose', typeAnswer: 'Type', listeningPlayer: 'Audio', play: 'Play', pause: 'Pause', speed: 'Speed', noAudio: 'No audio', retryAudio: 'Retry audio',
  micTitle: 'Mic', micLead: 'Mic lead', micStart: 'Start mic', micRecordAgain: 'Record again', micStop: 'Stop mic', micPlay: 'Play mic', micSkip: 'Skip mic', micIdle: 'Idle', micRecording: 'Recording', micProcessing: 'Processing', micSaved: 'Saved', micPermission: 'Permission',
  recordingStart: 'Record', recordingStop: 'Stop', recordingReplace: 'Replace', recordingPlay: 'Play recording', recordingSaved: 'Saved recording', recordingProcessing: 'Processing', recordingFailed: 'Failed', elapsed: 'Elapsed',
  reviewTitle: 'Review', reviewLead: 'Review lead', missing: 'missing', nothingMissing: 'Nothing missing', acknowledge: 'Acknowledge', submitDemo: 'Finish', submitting: 'Finishing', submitBlocked: 'Blocked', doneTitle: 'Done', doneLead: 'Done lead', receipt: 'Receipt', receiptSavedAt: 'Saved at', responses: 'Responses', doneAgain: 'Again', textSize: 'Text size', language: 'Language', english: 'EN', vietnamese: 'VI', qa: 'QA', qaNote: 'QA note', qaFillAll: 'Fill', qaPartial: 'Partial', qaClear: 'Clear', qaFlag: 'Flag', qaJump: 'Jump', qaComplete: 'Complete', qaReset: 'Reset', qaImport: 'Import', qaFixture: 'Fixture', recoveryTitle: 'Recovery', recoveryCopy: 'Recovery copy', recoverNew: 'New', cancel: 'Cancel', demo: 'Demo', textScale100: '100%', textScale115: '115%', textScale130: '130%'
};

const questionIndex = [
  { sectionId: 'vocab', questionId: 'vocab_q1', questionNumber: 1, type: 'mc', instructionVi: 'Hướng dẫn', parts: [
    { type: 'text', text: 'Before ' }, { type: 'blank', blankId: 'vocab_q1__b1', options: ['one', 'two'] }, { type: 'text', text: '.' }
  ] },
  { sectionId: 'speaking', questionId: 'speaking_q1', questionNumber: 1, type: 'speaking', text: 'Read this aloud.' },
  { sectionId: 'speaking', questionId: 'speaking_q2', questionNumber: 2, type: 'speaking', text: 'Read the second passage aloud.' },
  { sectionId: 'speaking', questionId: 'speaking_q3', questionNumber: 3, type: 'speaking', text: 'Read the third passage aloud.' },
  { sectionId: 'listen_write', questionId: 'listen_write_q1', questionNumber: 1, type: 'fill', audioUrl: 'audio.mp3', parts: [
    { type: 'text', text: 'Listen ' }, { type: 'blank', blankId: 'listen_write_q1__b1' }
  ] }
];

const sections = [
  { id: 'speaking', questions: [questionIndex[1], questionIndex[2], questionIndex[3]] },
  { id: 'vocab', questions: [questionIndex[0]] },
  { id: 'grammar', questions: [] },
  { id: 'listen_write', questions: [questionIndex[4]] }
];

const summary = {
  totalQuestions: 5, completeQuestions: 3, partialQuestions: 1, emptyQuestions: 1, filledBlanks: 1, totalBlanks: 2,
  items: [
    { questionId: 'vocab_q1', sectionId: 'vocab', type: 'mc', answered: 0, total: 1, state: 'empty', flagged: false, missingBlankIds: ['vocab_q1__b1'] },
    { questionId: 'speaking_q1', sectionId: 'speaking', type: 'speaking', answered: 1, total: 1, state: 'complete', flagged: true, missingBlankIds: [] },
    { questionId: 'speaking_q2', sectionId: 'speaking', type: 'speaking', answered: 1, total: 1, state: 'complete', flagged: false, missingBlankIds: [] },
    { questionId: 'speaking_q3', sectionId: 'speaking', type: 'speaking', answered: 1, total: 1, state: 'complete', flagged: false, missingBlankIds: [] },
    { questionId: 'listen_write_q1', sectionId: 'listen_write', type: 'fill', answered: 1, total: 1, state: 'complete', flagged: false, missingBlankIds: [] }
  ],
  bySection: { speaking: { total: 3, complete: 3, partial: 0, empty: 0, answered: 3, blanks: 3 }, vocab: { total: 1, complete: 0, partial: 0, empty: 1, answered: 0, blanks: 1 }, grammar: { total: 0, complete: 0, partial: 0, empty: 0, answered: 0, blanks: 0 }, listen_write: { total: 1, complete: 1, partial: 0, empty: 0, answered: 1, blanks: 1 } }
};

function draft(overrides = {}) {
  return { view: 'question', locale: 'vi', textScale: 115, activeQuestionId: 'vocab_q1', answers: {}, flags: { speaking_q1: true }, recordingRefs: {}, micCheck: 'skipped', reviewAcknowledged: false, submission: null, ...overrides };
}

test('header tools expose locale, scale and Noto Sans defaults without unsafe global controls', () => {
  const html = renderHeaderTools({ draft: draft(), copy, persistenceState: 'saved' });
  assert.match(html, /data-action="locale" data-value="vi"/);
  assert.match(html, /data-action="scale" data-value="115"/);
  assert.match(html, /Noto Sans/);
  assert.match(html, /data-visual-revision="signal-noto-v2"/);
  assert.doesNotMatch(html, /font-family|etlab:fonts/);
});

test('speaking task renders every canonical passage before its recorder with real English guidance', () => {
  for (const question of questionIndex.filter((item) => item.type === 'speaking')) {
    const html = renderApp({ draft: draft({ locale: 'en', activeQuestionId: question.questionId }), sections, questions: questionIndex, summary, currentQuestion: question, copy, persistenceState: 'saved' });
    assert.match(html, new RegExp(question.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(html, /Read the passage aloud clearly and naturally\. You can practise before recording\./);
    assert.doesNotMatch(html, />Instruction</);
    assert.ok(html.indexOf(question.text) < html.indexOf('et-recorder'), `${question.questionId} passage must precede recorder`);
  }
});

test('question view renders stable accessible blank controls and compact part navigation', () => {
  const html = renderApp({ draft: draft(), sections, questions: questionIndex, summary, currentQuestion: questionIndex[0], copy, persistenceState: 'saved' });
  assert.match(html, /id="answer-vocab_q1__b1"/);
  assert.match(html, /for="answer-vocab_q1__b1"/);
  assert.match(html, /data-action="nav-question" data-question-id="speaking_q1"/);
  assert.match(html, /data-action="nav-part" data-section-id="speaking"/);
  assert.match(html, /aria-label="Speaking, Question 1/);
  assert.doesNotMatch(html, /<main class="et-task-main">/);
  assert.match(html, /data-action="open-overview"/);
  assert.match(html, /data-action="toggle-flag"/);
});

test('review view uses explicit section units, human missing targets and keeps complete flagged groups reachable', () => {
  const html = renderApp({ draft: draft({ view: 'review' }), sections, questions: questionIndex, summary, copy, persistenceState: 'saved' });
  assert.equal((html.match(/class="et-review-section"/g) || []).length, 4);
  assert.match(html, /3 recordings saved/);
  assert.match(html, /data-question-id="speaking_q1"/);
  assert.match(html, /Vocabulary · Question 4/);
  assert.match(html, /class="et-review-details"/);
  assert.doesNotMatch(html, />[^<]*vocab_q1__b1[^<]*</);
  assert.match(html, /data-action="review-ack"/);
  assert.match(html, /data-action="submit-demo"/);
  assert.match(html, /data-action="jump-blank"[^>]*data-blank-id="vocab_q1__b1"/);
  assert.match(html, /data-action="back-to-question"/);
});

test('saved mic check offers Record again without a duplicate elapsed label', () => {
  const html = renderApp({ draft: draft({ view: 'miccheck' }), sections, questions: questionIndex, summary, copy, audioState: { status: 'saved', testUrl: 'blob:test', elapsedLabel: '0:04' }, persistenceState: 'saved' });
  assert.match(html, /Record again/);
  assert.doesNotMatch(html, /Elapsed/);
});

test('done view shows a local receipt and does not present learner submission controls', () => {
  const html = renderApp({ draft: draft({ view: 'done', submission: { receiptId: 'demo-d-abc123', committedAt: '2026-09-13T00:00:00.000Z' } }), sections, questions: questionIndex, summary, copy, persistenceState: 'saved' });
  assert.match(html, /demo-d-abc123/);
  assert.match(html, /demo-local/);
  assert.doesNotMatch(html, /data-action="submit-demo"/);
});
test('semantic registry is unique across every canonical question and screen',async()=>{
 const {NORMALIZED_DEMO_DATA}=await import('../../public/js/entrance-test-ui/demo-data.js');
 const {getCopy}=await import('../../public/js/entrance-test-ui/copy.js');
 const {createDraft,summarizeAssessment}=await import('../../public/js/entrance-test-ui/state.js');
 const sections=NORMALIZED_DEMO_DATA.sections,questions=sections.flatMap(s=>s.questions.map(q=>({...q,sectionId:s.id})));
 const base=createDraft({attemptId:'registry',revisionId:'academic-noto-v1',contentVersion:'entrance_test_36plus_v1'});
 for(const view of ['intro','miccheck','review','done',...questions.map(q=>q.questionId)]){
  const q=questions.find(q=>q.questionId===view),state={...base,view:q?'question':view,activeQuestionId:q?.questionId||questions[0].questionId};
  const html=renderApp({draft:state,sections,questions,summary:summarizeAssessment(questions,state),currentQuestion:q,copy:getCopy(state.locale)});
  const ids=[...html.matchAll(/data-et-annotation-id="([^"]+)"/g)].map(m=>m[1]);assert.ok(ids.length,view);assert.equal(new Set(ids).size,ids.length,view);
  if(q){assert.ok(ids.includes(`question/${q.questionId}/passage`));for(const part of q.parts||[])if(part.type==='blank')assert.ok(ids.includes(`question/${q.questionId}/blank/${part.blankId}`));}
 }
});
