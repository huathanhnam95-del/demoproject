/**
 * Reading Journey quiz builder tests
 * Run with: node tests/reading-journey-quiz-builder.test.js
 */

const assert = require('assert');
const { buildAssessmentQuiz } = require('../src/services/reading-journey/quiz-builder');

console.log('Starting Reading Journey quiz builder tests...');

(async () => {
  const outline = {
    title: 'A Quiet Surprise',
    premise: 'Maya finds an unexpected message and follows a small mystery.',
    setting: 'the town library after school',
    characters: [
      { name: 'Maya', role: 'student', goal: 'understand the message' },
      { name: 'Leo', role: 'friend', goal: 'help Maya solve the mystery' }
    ],
    beatOutline: [
      { beat: 1, milestone: 'Maya discovers a note in a library book.' },
      { beat: 2, milestone: 'She studies the clue and thinks carefully.' },
      { beat: 3, milestone: 'She shares the mystery with Leo.' },
      { beat: 4, milestone: 'They follow the clue to a hidden shelf.' },
      { beat: 5, milestone: 'They understand the kind surprise behind the note.' }
    ]
  };

  const segments = [
    'Maya opened an old library book after school and a folded note slipped onto the table. The short message said, "Look behind the atlas." She glanced around the quiet room, but nobody seemed to notice. Because of this strange clue, her normal reading time suddenly felt like the start of a secret adventure.',
    'After that, Maya walked to the atlas shelf and found a paper star tucked behind the largest book. On the back, someone had written, "Ask Leo what he remembers." The star looked homemade, with neat blue lines and careful corners. She felt curious and slightly nervous as she carried it to her next class.',
    'Then Maya showed the star to Leo during break. He squinted, smiled, and said he remembered seeing the same paper in art club last week. Because of this, they decided to check the classroom supply box together. Their careful search revealed another note and a tiny painted bookmark with bright silver dots.',
    'After that, the new note guided them back to the library window seat. Under the cushion, Maya found a final envelope addressed to her. She paused, breathed slowly, and opened it with both hands. Inside was a thank-you message from the librarian, who had noticed Maya returning lost books and helping younger students.',
    'Then Maya read the message again and felt deeply relieved. The surprise was not a warning or a trick. It was a kind reward for her quiet honesty. Leo laughed softly, and Maya placed the painted bookmark inside her favorite novel, promising to keep helping others even when nobody was watching.'
  ];

  const highlights = [
    ['folded note', 'atlas', 'quiet room'],
    ['paper star', 'careful corners', 'curious'],
    ['art club', 'painted bookmark', 'silver dots'],
    ['final envelope', 'thank-you message', 'librarian'],
    ['relieved', 'kind reward', 'honesty']
  ];

  const noisyDraftGenerator = async () => ({
    questions: [
      {
        id: 'draft-1',
        type: 'click_word_meaning',
        skill: 'vocabulary',
        prompt: 'Click the word that means feeling calm after worry.',
        target: {
          word: 'serene',
          paragraphIndex: 99,
          acceptedSurfaceForms: ['serene']
        }
      },
      {
        id: 'draft-2',
        type: 'mcq_main_idea',
        skill: 'comprehension',
        prompt: 'What is the main idea of the story?',
        options: [
          { id: 'a', text: 'Maya breaks a school rule.' },
          { id: 'b', text: 'Maya follows clues and learns she is appreciated.' },
          { id: 'c', text: 'Leo hides a book from the librarian.' },
          { id: 'd', text: 'The library closes early because of rain.' }
        ],
        correctOptionId: 'b'
      }
    ]
  });

  const deck = await buildAssessmentQuiz({
    outline,
    outlineId: 'outline-1',
    level: 'B1',
    segments,
    endWrap: 'Maya leaves the library smiling, with a bookmark and a stronger belief that small good actions matter.',
    beatOutline: outline.beatOutline,
    highlights,
    draftGenerator: noisyDraftGenerator
  });

  assert.strictEqual(deck.level, 'B1', 'buildAssessmentQuiz should normalize level');
  assert.strictEqual(deck.questions.length, 5, 'buildAssessmentQuiz should always return exactly 5 questions');
  assert.ok(deck.storySnapshot.paragraphs.length >= 5, 'buildAssessmentQuiz should create a paragraph snapshot from the story');

  const vocabCount = deck.questions.filter((question) => question.skill === 'vocabulary').length;
  const comprehensionCount = deck.questions.filter((question) => question.skill === 'comprehension').length;
  assert.ok(vocabCount >= 1, 'buildAssessmentQuiz should include at least one vocabulary question');
  assert.ok(comprehensionCount >= 1, 'buildAssessmentQuiz should include at least one comprehension question');

  const textLocationCount = deck.questions.filter((question) =>
    question.type === 'click_word_meaning' || question.type === 'tap_evidence'
  ).length;
  assert.ok(textLocationCount >= 1, 'buildAssessmentQuiz should include at least one interactive text-location question');

  const storyText = deck.storySnapshot.paragraphs.map((paragraph) => paragraph.text).join(' ').toLowerCase();
  deck.questions.forEach((question) => {
    if (question.type === 'click_word_meaning') {
      assert.ok(
        Number.isInteger(question.target.paragraphIndex) && question.target.paragraphIndex >= 0 && question.target.paragraphIndex < deck.storySnapshot.paragraphs.length,
        'click_word_meaning paragraphIndex must stay within the story snapshot'
      );
      assert.ok(
        storyText.includes(String(question.target.word).toLowerCase()),
        'click_word_meaning target.word must exist in the story text'
      );
    }
    if (question.type === 'tap_evidence') {
      assert.ok(
        Number.isInteger(question.target.paragraphIndex) && question.target.paragraphIndex >= 0 && question.target.paragraphIndex < deck.storySnapshot.paragraphs.length,
        'tap_evidence paragraphIndex must stay within the story snapshot'
      );
    }
  });

  const a2Deck = await buildAssessmentQuiz({
    outline,
    outlineId: 'outline-2',
    level: 'A2',
    segments,
    endWrap: '',
    beatOutline: outline.beatOutline,
    highlights,
    draftGenerator: async () => ({ questions: [] })
  });

  assert.strictEqual(
    a2Deck.questions.filter((question) => question.type === 'short_answer').length <= 1,
    true,
    'A2 decks should use at most one short_answer item'
  );

  const c1Deck = await buildAssessmentQuiz({
    outline,
    outlineId: 'outline-3',
    level: 'C1',
    segments,
    endWrap: '',
    beatOutline: outline.beatOutline,
    highlights,
    draftGenerator: async () => ({ questions: [] })
  });

  assert.strictEqual(c1Deck.level, 'C1', 'C1 decks should preserve the advanced level');
  assert.strictEqual(c1Deck.questions.length, 5, 'C1 decks should also return exactly 5 questions');

  console.log('Reading Journey quiz builder passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
