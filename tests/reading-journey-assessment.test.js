/**
 * Reading Journey assessment view/state tests
 * Run with: node tests/reading-journey-assessment.test.js
 */
/* eslint-disable no-console */

const assert = require('assert');

(async () => {
  const Assessment = await import('../public/js/reading-journey-assessment.js');

  console.log('Starting Reading Journey assessment tests...');

  const initialState = Assessment.createEmptyAssessmentState();
  assert.deepStrictEqual(
    initialState,
    {
      loading: false,
      deck: null,
      tokenizedStory: null,
      currentQuestionIndex: 0,
      answers: {},
      results: [],
      reviewWrite: null
    },
    'createEmptyAssessmentState should return the expected default state'
  );

  const question = {
    id: 'q-sequence',
    type: 'sequence_events',
    items: [
      { id: 'e1', text: 'Maya notices the light.' },
      { id: 'e2', text: 'Maya investigates the shelf.' },
      { id: 'e3', text: 'Maya finds the note.' }
    ]
  };

  const answer = Assessment.ensureAnswerState(initialState, question);
  assert.deepStrictEqual(
    answer.order,
    ['e1', 'e2', 'e3'],
    'ensureAnswerState should seed sequence questions with the current item order'
  );
  assert.strictEqual(
    Assessment.isQuestionReady(question, answer),
    true,
    'isQuestionReady should treat a fully-seeded sequence question as ready'
  );

  const completionMarkup = Assessment.buildCompletionSummaryMarkup({
    title: 'Lanterns at the Library',
    level: 'B1',
    skipped: true,
    choicesMade: ['📚', '🕯️', '🏁'],
    questionCount: 5
  });
  assert.match(
    completionMarkup,
    /Assessment skipped for now/i,
    'buildCompletionSummaryMarkup should surface the skipped note when the learner exits the quiz'
  );
  assert.match(
    completionMarkup,
    /Check Understanding/i,
    'buildCompletionSummaryMarkup should keep the quiz launch CTA'
  );
  assert.match(
    completionMarkup,
    /5 quick prompts/i,
    'buildCompletionSummaryMarkup should show the quiz count label'
  );

  const resultsMarkup = Assessment.buildQuizResultsMarkup({
    level: 'B1',
    results: [
      {
        questionId: 'q1',
        questionType: 'click_word_meaning',
        prompt: 'Click the word that means a soft shining light.',
        skill: 'vocabulary',
        correct: true,
        explanation: '"Glimmer" means a faint light.',
        correctAnswer: 'glimmer',
        evidenceText: 'A warm glimmer floated near the history shelves.'
      },
      {
        questionId: 'q2',
        questionType: 'mcq_main_idea',
        prompt: 'What is the main idea of the story?',
        skill: 'comprehension',
        correct: true,
        explanation: 'A small mystery leads Maya to a message about kindness.',
        correctAnswer: 'A small mystery leads Maya to a message about kindness.',
        evidenceText: 'Inside the atlas, she found a thank-you note from a former student.'
      }
    ],
    reviewWrite: {
      enqueuedCount: 0
    }
  });
  assert.match(
    resultsMarkup,
    /Understanding Check Complete/i,
    'buildQuizResultsMarkup should render the assessment completion heading'
  );
  assert.match(
    resultsMarkup,
    /Try B2/i,
    'buildQuizResultsMarkup should surface the next-level CTA when the learner earns a harder-level recommendation'
  );
  assert.match(
    resultsMarkup,
    /0 missed items added to the spaced queue/i,
    'buildQuizResultsMarkup should report the newly queued review count'
  );

  console.log('Reading Journey assessment passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
