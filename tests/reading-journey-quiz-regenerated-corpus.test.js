/**
 * Reading Journey quiz regenerated-corpus tests
 * Run with: node tests/reading-journey-quiz-regenerated-corpus.test.js
 */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildAssessmentQuiz } = require('../src/services/reading-journey/quiz-builder');

console.log('Starting Reading Journey regenerated-corpus quiz tests...');

function storyText(deck) {
  return deck.storySnapshot.paragraphs.map((paragraph) => paragraph.text).join(' ').toLowerCase();
}

function assertGroundedDeck(deck, { beatOutline }) {
  const text = storyText(deck);
  const beatTexts = (Array.isArray(beatOutline) ? beatOutline : []).map((beat) => String(beat.milestone || beat || '').toLowerCase());

  assert.strictEqual(deck.questions.length, 5, 'buildAssessmentQuiz should still produce five questions');

  const clickWord = deck.questions.find((question) => question.type === 'click_word_meaning');
  assert.ok(clickWord, 'buildAssessmentQuiz should include a click_word_meaning question');
  assert.ok(
    text.includes(String(clickWord.target.word).toLowerCase()),
    'click_word_meaning target should exist in the regenerated story text'
  );

  const evidenceQuestion = deck.questions.find((question) => question.type === 'tap_evidence');
  assert.ok(evidenceQuestion, 'buildAssessmentQuiz should include a tap_evidence question');
  assert.ok(
    Number.isInteger(evidenceQuestion.target.paragraphIndex)
      && evidenceQuestion.target.paragraphIndex >= 0
      && evidenceQuestion.target.paragraphIndex < deck.storySnapshot.paragraphs.length,
    'tap_evidence paragraphIndex should stay grounded in the regenerated snapshot'
  );

  const sequenceQuestion = deck.questions.find((question) => question.type === 'sequence_events');
  assert.ok(sequenceQuestion, 'buildAssessmentQuiz should include a sequence_events question');
  assert.deepStrictEqual(
    sequenceQuestion.items.map((item) => String(item.text || '').toLowerCase()),
    beatTexts.slice(0, 3),
    'sequence_events items should mirror the regenerated beat outline'
  );
  assert.deepStrictEqual(
    sequenceQuestion.correctOrder,
    sequenceQuestion.items.map((item) => item.id),
    'sequence_events should keep the item order internally consistent'
  );
}

(async () => {
  const regeneratedStories = [
    (() => {
      const fixturePath = path.join(__dirname, 'fixtures', 'reading-journey', 'regen-outline-301.json');
      const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      const selectedPath = Array.isArray(fixture.paths) ? fixture.paths[0] : null;
      const beats = Array.isArray(selectedPath?.beats) ? selectedPath.beats : [];

      return {
        outlineId: fixture.outlineId,
        outline: {
          title: fixture.title,
          beatOutline: beats.slice(0, 3).map((beat, index) => ({
            beat: index + 1,
            milestone: beat.segment
          }))
        },
        segments: beats.slice(0, 3).map((beat) => beat.segment),
        endWrap: beats[3]?.endWrap || '',
        highlights: beats.slice(0, 3).map((beat) => beat.highlights || [])
      };
    })(),
    {
      outlineId: 'regen-outline-1',
      outline: {
        title: 'Lanterns After Rain',
        beatOutline: [
          { beat: 1, milestone: 'Maya finds a folded note in a library book.' },
          { beat: 2, milestone: 'She studies the clue and keeps calm.' },
          { beat: 3, milestone: 'She asks Leo for help.' },
          { beat: 4, milestone: 'They open the atlas and find a bookmark.' },
          { beat: 5, milestone: 'Maya realizes the surprise was a thank-you for her honesty.' }
        ]
      },
      segments: [
        'Maya found a folded note in a library book after school. The clue told her to look behind the atlas, and the quiet room made the mystery feel larger than life.',
        'She studied the clue carefully and then asked Leo for help. Together they checked the atlas shelf and found a paper bookmark with tiny silver dots.',
        'After that, they opened a little envelope tucked inside the atlas. Inside was a thank-you message from the librarian for Maya’s honesty and helpfulness.',
        'Maya felt relieved when the secret turned out to be kind. She smiled, kept the bookmark, and promised to keep helping others.'
      ],
      endWrap: 'The evening ended with a gentle thank-you and a new bookmark tucked safely into Maya’s favorite novel.',
      highlights: [
        ['folded note', 'atlas', 'clue'],
        ['bookmark', 'silver dots'],
        ['thank-you message', 'honesty'],
        ['relieved', 'kind']
      ]
    },
    {
      outlineId: 'regen-outline-2',
      outline: {
        title: 'The Hidden Envelope',
        beatOutline: [
          { beat: 1, milestone: 'Maya notices an envelope hidden in a returned book.' },
          { beat: 2, milestone: 'She follows the clue to the archive shelf.' },
          { beat: 3, milestone: 'She finds a note that explains the secret.' },
          { beat: 4, milestone: 'She shares the discovery with the librarian.' },
          { beat: 5, milestone: 'She learns the surprise was a reward for honesty.' }
        ]
      },
      segments: [
        'Maya noticed an envelope hidden in a returned book and read the short clue aloud. The word “reward” was written on the back, and it made her curious about the archive shelf.',
        'She followed the clue to the archive shelf and found a second note beside an old bookmark. The note thanked her for always returning books on time.',
        'When Maya shared the discovery with the librarian, she learned the secret reward was meant for her honesty and careful reading habits.',
        'By the end, Maya felt proud and relieved. She placed the bookmark in her bag and smiled at how a small clue became a warm surprise.'
      ],
      endWrap: 'Maya left the library knowing that honesty can turn a small clue into a meaningful reward.',
      highlights: [
        ['envelope', 'reward'],
        ['archive shelf', 'bookmark'],
        ['honesty', 'careful reading'],
        ['relieved', 'warm surprise']
      ]
    }
  ];

  for (const story of regeneratedStories) {
    const deck = await buildAssessmentQuiz({
      outline: story.outline,
      outlineId: story.outlineId,
      level: 'B1',
      segments: story.segments,
      endWrap: story.endWrap,
      beatOutline: story.outline.beatOutline,
      highlights: story.highlights,
      draftGenerator: async () => ({
        questions: [
          {
            id: `${story.outlineId}-stale-click`,
            type: 'click_word_meaning',
            skill: 'vocabulary',
            prompt: 'Click the word that means calm and peaceful.',
            target: {
              word: 'serene',
              paragraphIndex: 99,
              acceptedSurfaceForms: ['serene']
            }
          },
          {
            id: `${story.outlineId}-stale-sequence`,
            type: 'sequence_events',
            skill: 'comprehension',
            prompt: 'Order the events.',
            items: [
              { id: 'old-1', text: 'Old event 1' },
              { id: 'old-2', text: 'Old event 2' },
              { id: 'old-3', text: 'Old event 3' }
            ],
            correctOrder: ['old-1', 'old-2', 'old-3']
          }
        ]
      })
    });

    assertGroundedDeck(deck, { beatOutline: story.outline.beatOutline });
  }

  console.log('Reading Journey regenerated-corpus quiz tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
