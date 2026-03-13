/**
 * Reading Journey quiz contract tests
 * Run with: node tests/reading-journey-quiz-contracts.test.js
 */

const assert = require('assert');
const Contracts = require('../src/services/reading-journey/quiz-contracts');

console.log('Starting Reading Journey quiz contract tests...');

assert.ok(Contracts.QUESTION_TYPES, 'QUESTION_TYPES export is required');
assert.strictEqual(typeof Contracts.normalizeQuizDeck, 'function', 'normalizeQuizDeck export is required');
assert.strictEqual(typeof Contracts.validateQuizQuestion, 'function', 'validateQuizQuestion export is required');
assert.strictEqual(typeof Contracts.normalizeReviewQueue, 'function', 'normalizeReviewQueue export is required');

assert.deepStrictEqual(
  Contracts.QUESTION_TYPES,
  {
    MCQ_MAIN_IDEA: 'mcq_main_idea',
    CLICK_WORD_MEANING: 'click_word_meaning',
    TAP_EVIDENCE: 'tap_evidence',
    SEQUENCE_EVENTS: 'sequence_events',
    SHORT_ANSWER: 'short_answer'
  },
  'QUESTION_TYPES should expose the five supported MVP question types'
);

const validDeck = Contracts.normalizeQuizDeck({
  quizId: 'quiz-1',
  outlineId: 'outline-1',
  level: 'b1',
  storySnapshot: {
    title: 'A Quiet Surprise',
    paragraphs: [
      {
        id: 'p1',
        text: 'Maya found a small note in the library book.',
        sentences: [
          { id: 's1', text: 'Maya found a small note in the library book.' }
        ]
      }
    ]
  },
  questions: [
    {
      id: 'q1',
      type: 'click_word_meaning',
      skill: 'vocabulary',
      prompt: 'Click the word that means a short written message.',
      target: {
        word: 'note',
        paragraphIndex: 0,
        acceptedSurfaceForms: ['note']
      }
    },
    {
      id: 'q2',
      type: 'tap_evidence',
      skill: 'comprehension',
      prompt: 'Tap the paragraph that proves Maya found something.',
      target: {
        paragraphIndex: 0,
        evidenceAnchors: ['found a small note']
      }
    },
    {
      id: 'q3',
      type: 'sequence_events',
      skill: 'comprehension',
      prompt: 'Put the events in order.',
      items: [
        { id: 'a', text: 'Maya opened the book.' },
        { id: 'b', text: 'Maya found a note.' },
        { id: 'c', text: 'Maya smiled.' }
      ],
      correctOrder: ['a', 'b', 'c']
    },
    {
      id: 'q4',
      type: 'short_answer',
      skill: 'comprehension',
      prompt: 'Why did Maya smile?',
      rubric: {
        focus: 'main_idea',
        requireEvidence: false
      },
      idealAnswers: ['She was happy to find the note.']
    },
    {
      id: 'q5',
      type: 'mcq_main_idea',
      skill: 'comprehension',
      prompt: 'What is the main idea?',
      options: [
        { id: 'a', text: 'Maya buys a new book.' },
        { id: 'b', text: 'Maya discovers a note in a library book.' },
        { id: 'c', text: 'Maya loses her homework.' },
        { id: 'd', text: 'Maya talks to a teacher.' }
      ],
      correctOptionId: 'b'
    }
  ]
});

assert.strictEqual(validDeck.level, 'B1', 'normalizeQuizDeck should normalize the CEFR level');
assert.strictEqual(validDeck.questions.length, 5, 'normalizeQuizDeck should keep valid questions');
assert.strictEqual(validDeck.storySnapshot.paragraphs.length, 1, 'storySnapshot paragraphs should be preserved');

assert.deepStrictEqual(
  Contracts.validateQuizQuestion(validDeck.questions[0]),
  { valid: true, errors: [] },
  'click_word_meaning question should validate when all required fields are present'
);

assert.deepStrictEqual(
  Contracts.validateQuizQuestion(validDeck.questions[1]),
  { valid: true, errors: [] },
  'tap_evidence question should validate when evidence anchors and paragraph index are present'
);

assert.deepStrictEqual(
  Contracts.validateQuizQuestion(validDeck.questions[2]),
  { valid: true, errors: [] },
  'sequence_events question should validate when ordered ids are present'
);

assert.deepStrictEqual(
  Contracts.validateQuizQuestion(validDeck.questions[3]),
  { valid: true, errors: [] },
  'short_answer question should validate when rubric and ideal answers are present'
);

assert.throws(
  () => Contracts.normalizeQuizDeck({
    quizId: 'quiz-2',
    outlineId: 'outline-1',
    level: 'z9',
    storySnapshot: { paragraphs: [] },
    questions: []
  }),
  /level/i,
  'normalizeQuizDeck should reject unsupported CEFR levels'
);

assert.throws(
  () => Contracts.normalizeQuizDeck({
    outlineId: 'outline-1',
    level: 'B1',
    storySnapshot: { paragraphs: [{ text: 'Maya found a note.' }] },
    questions: validDeck.questions
  }),
  /quizId/i,
  'normalizeQuizDeck should require quizId'
);

assert.throws(
  () => Contracts.normalizeQuizDeck({
    quizId: 'quiz-3',
    level: 'B1',
    storySnapshot: { paragraphs: [{ text: 'Maya found a note.' }] },
    questions: validDeck.questions
  }),
  /outlineId/i,
  'normalizeQuizDeck should require outlineId'
);

assert.throws(
  () => Contracts.normalizeQuizDeck({
    quizId: 'quiz-4',
    outlineId: 'outline-1',
    level: 'B1',
    storySnapshot: { paragraphs: [] },
    questions: validDeck.questions
  }),
  /storySnapshot/i,
  'normalizeQuizDeck should require at least one story paragraph'
);

const invalidClickWord = Contracts.validateQuizQuestion({
  id: 'q-invalid-1',
  type: 'click_word_meaning',
  skill: 'vocabulary',
  prompt: 'Broken click word question',
  target: { paragraphIndex: 0, acceptedSurfaceForms: [] }
});
assert.strictEqual(invalidClickWord.valid, false, 'click_word_meaning should fail without target.word');
assert.ok(
  invalidClickWord.errors.some((error) => error.includes('target.word')),
  'click_word_meaning validation should explain missing target.word'
);

const invalidTapEvidence = Contracts.validateQuizQuestion({
  id: 'q-invalid-2',
  type: 'tap_evidence',
  skill: 'comprehension',
  prompt: 'Broken evidence question',
  target: { paragraphIndex: 0 }
});
assert.strictEqual(invalidTapEvidence.valid, false, 'tap_evidence should fail without evidence anchors');
assert.ok(
  invalidTapEvidence.errors.some((error) => error.includes('evidenceAnchors')),
  'tap_evidence validation should explain missing evidence anchors'
);

const invalidShortAnswer = Contracts.validateQuizQuestion({
  id: 'q-invalid-3',
  type: 'short_answer',
  skill: 'comprehension',
  prompt: 'Broken short answer',
  idealAnswers: []
});
assert.strictEqual(invalidShortAnswer.valid, false, 'short_answer should fail without a rubric');
assert.ok(
  invalidShortAnswer.errors.some((error) => error.includes('rubric')),
  'short_answer validation should explain missing rubric'
);

const invalidSequence = Contracts.validateQuizQuestion({
  id: 'q-invalid-4',
  type: 'sequence_events',
  skill: 'comprehension',
  prompt: 'Broken sequence',
  items: [
    { id: 'a', text: 'First event' },
    { id: 'b', text: 'Second event' }
  ],
  correctOrder: ['a', 'z']
});
assert.strictEqual(invalidSequence.valid, false, 'sequence_events should fail when correctOrder contains unknown ids');
assert.ok(
  invalidSequence.errors.some((error) => error.includes('correctOrder')),
  'sequence_events validation should explain invalid correctOrder ids'
);

const reviewQueue = Contracts.normalizeReviewQueue({
  version: 1,
  items: [
    {
      reviewId: 'review-1',
      questionType: 'click_word_meaning',
      prompt: 'Click the word that means a short written message.',
      level: 'A2',
      storyTitle: 'A Quiet Surprise',
      reviewState: {
        intervalDays: 1,
        nextReviewAt: 1_741_000_000_000,
        failures: 1
      }
    }
  ]
});

assert.strictEqual(reviewQueue.version, 1, 'normalizeReviewQueue should preserve version');
assert.strictEqual(reviewQueue.items.length, 1, 'normalizeReviewQueue should preserve valid items');
assert.strictEqual(reviewQueue.items[0].level, 'A2', 'normalizeReviewQueue should normalize item CEFR level');

const fallbackQueue = Contracts.normalizeReviewQueue(null);
assert.deepStrictEqual(fallbackQueue, { version: 1, items: [] }, 'normalizeReviewQueue should default null input');

const malformedQueue = Contracts.normalizeReviewQueue({
  version: 1,
  items: [
    {
      level: 'B1',
      storyTitle: 'Broken story',
      reviewState: { intervalDays: 1, nextReviewAt: 1, failures: 1 }
    }
  ]
});
assert.deepStrictEqual(
  malformedQueue,
  { version: 1, items: [] },
  'normalizeReviewQueue should drop review items missing required fields'
);

console.log('Reading Journey quiz contracts passed.');
