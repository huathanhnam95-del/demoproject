import assert from 'node:assert/strict';
import {
  buildAssessWritingContext,
  consumePendingWritingChallenges,
  createActiveWritingChallengeContext,
  createQueuedWritingChallengeItem,
  getPendingWritingChallengeCount,
  getWritingChallengeSummaryState,
  getWritingChallengeDecision,
  getNextPendingWritingChallenge,
  normalizeWritingChallengeOptions,
  normalizeWritingChallengeWordKey,
  shouldConsumePendingWritingChallenge
} from '../public/js/writing-challenge-utils.js';

console.log('Starting Writing Challenge helper tests...');

const phraseDecision = getWritingChallengeDecision({
  currentWord: { lemma: 'phrase:raise awareness', originalWord: 'raise awareness', entryType: 'phrase' },
  wasCorrect: true,
  becameMastered: false
});
assert.equal(phraseDecision.shouldTrigger, true);
assert.equal(phraseDecision.reason, 'phrase-success');

const prematureWordDecision = getWritingChallengeDecision({
  currentWord: { lemma: 'debate', originalWord: 'debate', entryType: 'word', partOfSpeech: 'noun' },
  wasCorrect: true,
  becameMastered: false
});
assert.equal(prematureWordDecision.shouldTrigger, false);

const masteredWordDecision = getWritingChallengeDecision({
  currentWord: { lemma: 'debate', originalWord: 'debate', entryType: 'word', partOfSpeech: 'noun' },
  wasCorrect: true,
  becameMastered: true
});
assert.equal(masteredWordDecision.shouldTrigger, true);
assert.equal(masteredWordDecision.reason, 'mastered-word');

const selfRatedWrongDecision = getWritingChallengeDecision({
  currentWord: { lemma: 'debate', originalWord: 'debate', entryType: 'word', partOfSpeech: 'noun' },
  wasCorrect: false,
  becameMastered: true
});
assert.equal(selfRatedWrongDecision.shouldTrigger, false);

const normalizedOptions = normalizeWritingChallengeOptions([
  { text: 'raise awareness', source: 'PTE Academic' },
  { text: ' raise awareness ', source: 'Common Usage' },
  { text: 'spark debate', source: 'Common Usage' }
]);
assert.equal(normalizedOptions.length, 2);
assert.deepEqual(normalizedOptions.map(option => option.text), ['raise awareness', 'spark debate']);

const wordKey = normalizeWritingChallengeWordKey({
  lemma: 'Apple',
  originalWord: 'apple',
  entryType: 'word'
});
assert.equal(wordKey, 'word:apple');
assert.equal(
  normalizeWritingChallengeWordKey({
    lemma: 'phrase:raise awareness',
    originalWord: 'raise awareness',
    entryType: 'phrase'
  }),
  'phrase:raise awareness'
);

const queuedItem = createQueuedWritingChallengeItem({
  lemma: 'apple',
  originalWord: 'apple',
  entryType: 'word',
  partOfSpeech: 'noun'
}, 'mastered-word');
assert.equal(queuedItem.wordKey, 'word:apple');
assert.equal(queuedItem.triggerReason, 'mastered-word');
assert.equal(queuedItem.wordObj.lemma, 'apple');

const activeContext = createActiveWritingChallengeContext({
  ...queuedItem,
  wordObj: {
    ...queuedItem.wordObj,
    definition: 'a fruit'
  }
}, 'summary_123');
assert.equal(activeContext.contextId, 'summary_123');
assert.equal(activeContext.wordObj.definition, 'a fruit');
assert.equal(activeContext.validationTarget, 'apple');

const assessContext = buildAssessWritingContext({
  ...activeContext,
  promptText: 'Write a sentence using "golden apple".',
  usedCollocation: 'golden apple',
  validationTarget: 'golden apple'
});
assert.deepEqual(assessContext, {
  challengeId: activeContext.challengeId,
  contextId: 'summary_123',
  word: 'apple',
  lemma: 'apple',
  partOfSpeech: 'noun',
  entryType: 'word',
  promptText: 'Write a sentence using "golden apple".',
  usedCollocation: 'golden apple',
  validationTarget: 'golden apple'
});

const queueA = createQueuedWritingChallengeItem({
  lemma: 'policy',
  originalWord: 'policy',
  entryType: 'word',
  partOfSpeech: 'noun'
}, 'mastered-word');
const queueB = createQueuedWritingChallengeItem({
  lemma: 'phrase:raise awareness',
  originalWord: 'raise awareness',
  entryType: 'phrase',
  partOfSpeech: 'verb'
}, 'phrase-success');
const queue = [queueA, queueB];

assert.equal(getPendingWritingChallengeCount(queue), 2);
assert.equal(getPendingWritingChallengeCount(null), 0);
assert.equal(getNextPendingWritingChallenge(queue)?.wordKey, queueA.wordKey);
assert.equal(getNextPendingWritingChallenge([]), null);

assert.equal(shouldConsumePendingWritingChallenge('dismiss'), false);
assert.equal(shouldConsumePendingWritingChallenge('skip'), true);
assert.equal(shouldConsumePendingWritingChallenge('auto-complete'), true);
assert.equal(shouldConsumePendingWritingChallenge('complete'), true);
assert.equal(shouldConsumePendingWritingChallenge('weird-custom-reason'), false);

const preservedQueue = consumePendingWritingChallenges(queue, 'dismiss');
assert.equal(preservedQueue.length, 2);
assert.equal(preservedQueue[0].wordKey, queueA.wordKey);
assert.notEqual(preservedQueue, queue);

const skippedQueue = consumePendingWritingChallenges(queue, 'skip');
assert.equal(skippedQueue.length, 1);
assert.equal(skippedQueue[0].wordKey, queueB.wordKey);

const summaryZero = getWritingChallengeSummaryState([]);
assert.deepEqual(summaryZero, {
  count: 0,
  text: '',
  showButton: false,
  showStatus: false
});

const summaryOne = getWritingChallengeSummaryState([queueA]);
assert.deepEqual(summaryOne, {
  count: 1,
  text: '1 Writing Challenge ready',
  showButton: true,
  showStatus: true
});

const summaryTwo = getWritingChallengeSummaryState([queueA, queueB]);
assert.deepEqual(summaryTwo, {
  count: 2,
  text: '2 Writing Challenges ready',
  showButton: true,
  showStatus: true
});

console.log('Writing Challenge helper tests passed');
