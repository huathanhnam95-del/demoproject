'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assessFixedReference,
  computeReferenceComparison
} = require('../functions/src/services/azure-speech/continuous-assessment');

test('computeReferenceComparison: aligns perfect match with 100% completeness', () => {
  const reference = 'The quick brown fox jumps over the lazy dog';
  const words = reference.split(' ').map(w => ({ word: w, errorType: 'None' }));

  const comp = computeReferenceComparison(reference, words);
  assert.equal(comp.matchedCount, 9);
  assert.equal(comp.omittedCount, 0);
  assert.equal(comp.insertedCount, 0);
  assert.equal(comp.completenessScore, 100);
});

test('computeReferenceComparison: detects omitted and inserted words preserving order', () => {
  const reference = 'Scientists make observations, make assumptions, and do experiments.';
  // Candidate says: 'Scientists observations, make assumptions, actually do experiments.'
  // 'make' was omitted, 'actually' was inserted
  const words = [
    { word: 'Scientists', errorType: 'None' },
    { word: 'observations', errorType: 'None' },
    { word: 'make', errorType: 'None' },
    { word: 'assumptions', errorType: 'None' },
    { word: 'and', errorType: 'None' },
    { word: 'actually', errorType: 'None' },
    { word: 'do', errorType: 'None' },
    { word: 'experiments', errorType: 'None' }
  ];

  const comp = computeReferenceComparison(reference, words);
  assert.ok(comp.omittedWords.includes('make'));
  assert.ok(comp.insertedWords.includes('actually'));
  assert.ok(comp.completenessScore < 100);
});

test('assessFixedReference: produces complete assessment envelope with ending-safe word timing', async () => {
  const referenceText = 'Artificial intelligence accelerates scientific research.';
  const dummyAudio = Buffer.alloc(16000 * 2 * 2); // 2 seconds 16kHz 16-bit mono

  const result = await assessFixedReference({
    mode: 'read_aloud',
    referenceText,
    audioBuffer: dummyAudio,
    audioIdentity: { sampleRateHz: 16000, sampleCount: 32000 },
    attemptId: 'test-attempt-1'
  }, { useMock: true });

  assert.equal(result.mode, 'read_aloud');
  assert.equal(result.status, 'completed');
  assert.equal(result.referenceText, referenceText);
  assert.ok(Array.isArray(result.words));
  assert.equal(result.words.length, 5);

  // Verify that each word has clipTiming attached without destructive trimming
  for (const word of result.words) {
    assert.ok(word.clipTiming, `word ${word.word} should have clipTiming`);
    assert.equal(word.clipTiming.timingSource, 'bel_refined');
    assert.ok(word.clipTiming.clipSpan, `word ${word.word} should have clipSpan`);
  }

  // Verify overall scores
  assert.equal(typeof result.overallScores.accuracyScore, 'number');
  assert.equal(typeof result.overallScores.fluencyScore, 'number');
  assert.equal(typeof result.overallScores.completenessScore, 'number');
  assert.equal(typeof result.overallScores.pronunciationScore, 'number');
});
