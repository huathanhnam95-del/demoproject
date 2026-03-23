/**
 * Reading Journey beat client-shape regression tests
 * Run with: node tests/reading-journey-beat-client-shape.test.js
 */

const assert = require('assert');
console.log('Starting Reading Journey beat client-shape tests...');

(() => {
  const { normalizeBeatForClient } = require('../src/services/reading-journey/beat-client-shape.js');

  const legacyBeat = {
    formatVersion: 2,
    questionType: 'mcq',
    choices: [
      { id: 'next', text: 'Continue...', action: 'next' }
    ],
    choiceQuestion: {
      question: 'What should Mai do first?',
      options: [
        { id: 'investigate', label: 'Look around carefully.' },
        { id: 'ask', label: 'Ask someone nearby.' },
        { id: 'wait', label: 'Wait and observe.' }
      ]
    }
  };

  const normalizedLegacyBeat = normalizeBeatForClient(legacyBeat);
  assert.deepStrictEqual(
    normalizedLegacyBeat.choices,
    [
      { id: 'investigate', text: 'Look around carefully.' },
      { id: 'ask', text: 'Ask someone nearby.' },
      { id: 'wait', text: 'Wait and observe.' }
    ],
    'legacy next-only choices should be replaced with canonical choiceQuestion options'
  );

  const canonicalBeat = {
    formatVersion: 2,
    questionType: 'mcq',
    choices: [
      { id: 'investigate', text: 'Look around carefully.' },
      { id: 'ask', text: 'Ask someone nearby.' }
    ],
    choiceQuestion: {
      question: 'What should Mai do next?',
      options: [
        { id: 'investigate', label: 'Look around carefully.' },
        { id: 'ask', label: 'Ask someone nearby.' }
      ]
    }
  };

  const normalizedCanonicalBeat = normalizeBeatForClient(canonicalBeat);
  assert.deepStrictEqual(
    normalizedCanonicalBeat.choices,
    canonicalBeat.choices,
    'already-canonical choices should remain unchanged'
  );

  console.log('Reading Journey beat client-shape tests passed.');
})();
