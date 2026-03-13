/**
 * Reading Journey quiz results tests
 * Run with: node tests/reading-journey-quiz-results.test.js
 */
/* eslint-disable no-console */

const assert = require('assert');

(async () => {
  const QuizResults = await import('../public/js/reading-journey-quiz-results.js');
  const QuizStorage = await import('../public/js/reading-journey-quiz-storage.js');

  console.log('Starting Reading Journey quiz result tests...');

  const storySnapshot = {
    title: 'Lanterns at the Library',
    paragraphs: [
      {
        id: 'p1',
        text: 'A warm glimmer floated near the history shelves and made the dust look golden.'
      },
      {
        id: 'p2',
        text: 'Inside the atlas, Maya found a thank-you note from a former student who had once felt lonely in the library.'
      }
    ]
  };

  const questions = [
    {
      id: 'q1',
      type: 'click_word_meaning',
      skill: 'vocabulary',
      prompt: 'Click the word that means a soft shining light.',
      explanation: '"Glimmer" means a faint or gentle light.',
      target: {
        word: 'glimmer',
        paragraphIndex: 0,
        acceptedSurfaceForms: ['glimmer']
      }
    },
    {
      id: 'q2',
      type: 'tap_evidence',
      skill: 'comprehension',
      prompt: 'Tap the paragraph that shows why the library mattered to the former student.',
      explanation: 'The second paragraph explains that the student felt lonely but learned to love reading there.',
      target: {
        paragraphIndex: 1,
        evidenceAnchors: ['felt lonely', 'love reading there']
      }
    },
    {
      id: 'q3',
      type: 'mcq_main_idea',
      skill: 'comprehension',
      prompt: 'What is the main idea of the story?',
      explanation: 'A small mystery leads Maya to a message about kindness.',
      options: [
        { id: 'a', text: 'Libraries should close earlier.' },
        { id: 'b', text: 'Maya finds a message about kindness through a small mystery.' },
        { id: 'c', text: 'The librarian hides all the notes.' }
      ],
      correctOptionId: 'b'
    },
    {
      id: 'q4',
      type: 'sequence_events',
      skill: 'comprehension',
      prompt: 'Put the story events in order.',
      explanation: 'Maya notices the light, investigates, then finds the note.',
      items: [
        { id: 'e1', text: 'Maya notices the strange light.' },
        { id: 'e2', text: 'Maya investigates the shelf.' },
        { id: 'e3', text: 'Maya finds the thank-you note.' }
      ],
      correctOrder: ['e1', 'e2', 'e3']
    },
    {
      id: 'q5',
      type: 'short_answer',
      skill: 'vocabulary',
      prompt: 'In one short answer, what did Maya find inside the atlas?',
      explanation: 'She found a thank-you note.',
      idealAnswers: ['thank-you note', 'a note'],
      rubric: {
        acceptsKeywords: ['note']
      }
    }
  ];

  const answers = {
    q1: { correct: false },
    q2: { correct: true },
    q3: { selectedOptionId: 'b' },
    q4: { order: ['e1', 'e2', 'e3'] },
    q5: { text: 'A book light' }
  };

  const rows = QuizResults.gradeQuizResults({ questions, answers, storySnapshot });
  assert.strictEqual(rows.length, 5, 'gradeQuizResults should produce one row per question');
  assert.strictEqual(rows.filter((row) => row.correct).length, 3, 'gradeQuizResults should count correct answers correctly');
  assert.ok(rows.every((row) => row.explanation), 'gradeQuizResults should attach explanatory feedback to every row');

  const vocabMiss = rows.find((row) => row.questionId === 'q1');
  assert.strictEqual(vocabMiss.correctAnswer, 'glimmer', 'gradeQuizResults should expose the correct answer label');
  assert.ok(vocabMiss.evidenceText.includes('glimmer floated'), 'gradeQuizResults should attach story evidence when available');

  const summary = QuizResults.summarizeQuizPerformance(rows, { level: 'B1' });
  assert.strictEqual(summary.correctCount, 3, 'summarizeQuizPerformance should compute total correct answers');
  assert.strictEqual(summary.scorePercent, 60, 'summarizeQuizPerformance should compute score percent');
  assert.deepStrictEqual(
    summary.missedBySkill,
    { vocabulary: 2, comprehension: 0 },
    'summarizeQuizPerformance should group misses by vocabulary vs comprehension'
  );
  assert.strictEqual(summary.recommendation.key, 'review', 'scores below 70% should recommend review');

  const sameLevelSummary = QuizResults.summarizeQuizPerformance(rows.map((row, index) => ({
    ...row,
    correct: index === 0 ? false : true
  })), { level: 'B1' });
  assert.strictEqual(sameLevelSummary.recommendation.key, 'same_level', 'scores from 70% to 89% should recommend the same level');

  const harderSummary = QuizResults.summarizeQuizPerformance(rows.map((row) => ({
    ...row,
    correct: true
  })), { level: 'B1' });
  assert.strictEqual(harderSummary.recommendation.key, 'harder_level', 'scores from 90% and above should recommend a harder level');

  const reviewItems = QuizResults.buildMissedReviewItems(rows, {
    quizId: 'quiz-123',
    level: 'B1',
    storyTitle: 'Lanterns at the Library'
  });
  assert.deepStrictEqual(
    reviewItems.map((item) => item.reviewId),
    ['quiz-123:q1', 'quiz-123:q5'],
    'buildMissedReviewItems should include only missed questions'
  );

  const fakeStorage = (() => {
    const map = new Map();
    return {
      getItem(key) {
        return map.has(key) ? map.get(key) : null;
      },
      setItem(key, value) {
        map.set(key, String(value));
      }
    };
  })();

  const queueResult = QuizStorage.queueQuizMisses(rows, {
    quizId: 'quiz-123',
    level: 'B1',
    storyTitle: 'Lanterns at the Library',
    storage: fakeStorage,
    now: 1_742_100_000_000
  });
  assert.strictEqual(queueResult.enqueuedCount, 2, 'queueQuizMisses should persist only missed items');
  assert.strictEqual(queueResult.queue.items.length, 2, 'queueQuizMisses should write only the missed items into the queue');

  const duplicateQueueResult = QuizStorage.queueQuizMisses(rows, {
    quizId: 'quiz-123',
    level: 'B1',
    storyTitle: 'Lanterns at the Library',
    storage: fakeStorage,
    now: 1_742_100_100_000
  });
  assert.strictEqual(
    duplicateQueueResult.enqueuedCount,
    0,
    'queueQuizMisses should report zero new items when all misses are already queued'
  );
  assert.strictEqual(
    duplicateQueueResult.queue.items.length,
    2,
    'queueQuizMisses should not duplicate existing review items'
  );

  console.log('Reading Journey quiz results passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
