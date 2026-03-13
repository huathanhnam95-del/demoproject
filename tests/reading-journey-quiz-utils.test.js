/**
 * Reading Journey quiz utility tests
 * Run with: node tests/reading-journey-quiz-utils.test.js
 */
/* eslint-disable no-console */

const assert = require('assert');

(async () => {
  const QuizUtils = await import('../public/js/reading-journey-quiz-utils.js');
  const QuizStorage = await import('../public/js/reading-journey-quiz-storage.js');

  console.log('Starting Reading Journey quiz utility tests...');

  const tokenized = QuizUtils.tokenizeStorySnapshot({
    title: 'A Quiet Surprise',
    paragraphs: [
      {
        id: 'p1',
        text: 'Maya found a note in the library.',
        sentences: [{ id: 's1', text: 'Maya found a note in the library.' }]
      },
      {
        id: 'p2',
        text: 'She felt relieved after reading the message.',
        sentences: [{ id: 's2', text: 'She felt relieved after reading the message.' }]
      }
    ]
  });

  assert.strictEqual(tokenized.paragraphs.length, 2, 'tokenizeStorySnapshot should preserve paragraph count');
  assert.strictEqual(tokenized.paragraphs[0].tokens[0].id, 'p1-w1', 'tokenizeStorySnapshot should generate stable token ids');
  assert.strictEqual(tokenized.paragraphs[1].tokens[2].normalized, 'relieved', 'tokenizeStorySnapshot should normalize token text');

  assert.deepStrictEqual(
    QuizUtils.normalizeAcceptedForms([' Note ', 'notes', 'note', 'NOTE!']),
    ['note', 'notes'],
    'normalizeAcceptedForms should trim, lowercase, strip punctuation, and dedupe'
  );

  const clickResultCorrect = QuizUtils.checkClickWordAnswer(
    {
      target: {
        word: 'note',
        paragraphIndex: 0,
        acceptedSurfaceForms: ['note', 'notes']
      }
    },
    tokenized.paragraphs[0].tokens[3]
  );
  assert.deepStrictEqual(
    clickResultCorrect,
    { correct: true, paragraphIndex: 0, selectedWord: 'note', matchedForm: 'note' },
    'checkClickWordAnswer should return correct when a matching token is chosen'
  );

  const clickResultWrong = QuizUtils.checkClickWordAnswer(
    {
      target: {
        word: 'note',
        paragraphIndex: 0,
        acceptedSurfaceForms: ['note']
      }
    },
    tokenized.paragraphs[1].tokens[2]
  );
  assert.strictEqual(clickResultWrong.correct, false, 'checkClickWordAnswer should return false on mismatch');
  assert.strictEqual(clickResultWrong.paragraphIndex, 0, 'checkClickWordAnswer should preserve target paragraph index for hints');

  assert.deepStrictEqual(
    QuizUtils.checkEvidenceTap(
      {
        target: {
          paragraphIndex: 1,
          evidenceAnchors: ['felt relieved']
        }
      },
      1
    ),
    { correct: true, paragraphIndex: 1 },
    'checkEvidenceTap should mark the correct paragraph as correct'
  );

  assert.deepStrictEqual(
    QuizUtils.computeSequenceResult(['a', 'c', 'b'], ['a', 'b', 'c']),
    {
      correct: false,
      correctCount: 1,
      misplacedIds: ['c', 'b']
    },
    'computeSequenceResult should count exact-order correctness and list misplaced ids'
  );

  const fakeStorage = (() => {
    const map = new Map();
    return {
      getItem(key) {
        return map.has(key) ? map.get(key) : null;
      },
      setItem(key, value) {
        map.set(key, String(value));
      },
      removeItem(key) {
        map.delete(key);
      }
    };
  })();

  assert.deepStrictEqual(
    QuizStorage.loadReviewQueue(fakeStorage),
    { version: 1, items: [] },
    'loadReviewQueue should default to an empty queue'
  );

  fakeStorage.setItem(QuizStorage.REVIEW_QUEUE_STORAGE_KEY, '{not valid json');
  assert.deepStrictEqual(
    QuizStorage.loadReviewQueue(fakeStorage),
    { version: 1, items: [] },
    'loadReviewQueue should recover from malformed JSON'
  );

  const baseNow = 1_742_000_000_000;
  QuizStorage.enqueueMissedItems([
    {
      reviewId: 'miss-1',
      questionType: 'click_word_meaning',
      prompt: 'Click the word that means a short message.',
      level: 'B1',
      storyTitle: 'A Quiet Surprise'
    }
  ], {
    storage: fakeStorage,
    now: baseNow
  });

  let queue = QuizStorage.loadReviewQueue(fakeStorage);
  assert.strictEqual(queue.items.length, 1, 'enqueueMissedItems should persist missed items');
  assert.strictEqual(queue.items[0].reviewState.intervalDays, 1, 'new missed items should start with a 1-day interval');
  assert.strictEqual(queue.items[0].reviewState.nextReviewAt, baseNow + QuizStorage.REVIEW_INTERVALS_MS[0], 'new missed items should schedule the first review one day later');

  QuizStorage.enqueueMissedItems([
    {
      reviewId: 'miss-1',
      questionType: 'click_word_meaning',
      prompt: 'Click the word that means a short message.',
      level: 'B1',
      storyTitle: 'A Quiet Surprise'
    }
  ], {
    storage: fakeStorage,
    now: baseNow + 10
  });
  queue = QuizStorage.loadReviewQueue(fakeStorage);
  assert.strictEqual(queue.items.length, 1, 'enqueueMissedItems should not duplicate an existing review item');

  const dueItems = QuizStorage.getDueReviewItems({
    storage: fakeStorage,
    now: baseNow + QuizStorage.REVIEW_INTERVALS_MS[0]
  });
  assert.strictEqual(dueItems.length, 1, 'getDueReviewItems should return items whose review time has arrived');

  const futureItems = QuizStorage.getDueReviewItems({
    storage: fakeStorage,
    now: baseNow + 1
  });
  assert.strictEqual(futureItems.length, 0, 'getDueReviewItems should not return future items');

  console.log('Reading Journey quiz utilities passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
