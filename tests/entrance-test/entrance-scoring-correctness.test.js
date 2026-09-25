const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveAcousticAndEffectiveAccuracy, parseFiniteScore } = require('../../functions/src/routes/entrance-tests');

test('Entrance Scoring: preserves true zero accuracyScore (0 is not coerced to null)', () => {
  const res = resolveAcousticAndEffectiveAccuracy({
    asrRes: { accuracyScore: 0 },
    words: [{ word: 'test', accuracyScore: 0 }],
    textAccuracyPercent: 75
  });
  assert.equal(res.accuracyScore, 0);
  assert.equal(res.effectiveAccuracy, 0);
});

test('Entrance Scoring: preserves null accuracyScore without coercing to 0 via Number(null)', () => {
  const res = resolveAcousticAndEffectiveAccuracy({
    asrRes: { accuracyScore: null },
    words: null,
    textAccuracyPercent: 85
  });
  assert.equal(res.accuracyScore, null, 'accuracyScore must remain null when Azure returns null');
  assert.equal(res.effectiveAccuracy, null, 'effectiveAccuracy must not fall back to textAccuracyPercent');
});

test('Entrance Scoring: handles missing/undefined accuracyScore safely as null', () => {
  const res = resolveAcousticAndEffectiveAccuracy({
    asrRes: {},
    words: [],
    textAccuracyPercent: 90
  });
  assert.equal(res.accuracyScore, null);
  assert.equal(res.effectiveAccuracy, null);
});

test('Entrance Scoring: calculates mean from word-level scores when top-level score is missing', () => {
  const res = resolveAcousticAndEffectiveAccuracy({
    asrRes: { accuracyScore: null },
    words: [
      { word: 'the', accuracyScore: 80 },
      { word: 'quick', accuracyScore: 90 },
      { word: 'brown', accuracyScore: 70 }
    ],
    textAccuracyPercent: 100
  });
  assert.equal(res.accuracyScore, 80);
  assert.equal(res.effectiveAccuracy, 80);
});

test('Entrance Scoring: ignores invalid or null scores in words array', () => {
  const res = resolveAcousticAndEffectiveAccuracy({
    asrRes: { accuracyScore: null },
    words: [
      { word: 'the', accuracyScore: null },
      { word: 'quick', accuracyScore: 90 },
      { word: 'brown', accuracyScore: 'invalid' }
    ],
    textAccuracyPercent: 50
  });
  assert.equal(res.accuracyScore, 90);
  assert.equal(res.effectiveAccuracy, 90);
});

test('parseFiniteScore: strictly validates score ranges and rejects invalid types', () => {
  // Valid boundaries
  assert.equal(parseFiniteScore(0), 0);
  assert.equal(parseFiniteScore(100), 100);
  assert.equal(parseFiniteScore(85.5), 85.5);
  assert.equal(parseFiniteScore('0'), 0);
  assert.equal(parseFiniteScore('100'), 100);
  assert.equal(parseFiniteScore(' 75.5 '), 75.5);

  // Invalid values coerced to null
  assert.equal(parseFiniteScore(null), null);
  assert.equal(parseFiniteScore(undefined), null);
  assert.equal(parseFiniteScore(''), null);
  assert.equal(parseFiniteScore('   '), null);
  assert.equal(parseFiniteScore('abc'), null);
  assert.equal(parseFiniteScore(NaN), null);
  assert.equal(parseFiniteScore(Infinity), null);
  assert.equal(parseFiniteScore(-Infinity), null);
  assert.equal(parseFiniteScore(-0.1), null);
  assert.equal(parseFiniteScore(100.1), null);
  assert.equal(parseFiniteScore(-10), null);
  assert.equal(parseFiniteScore(150), null);
  assert.equal(parseFiniteScore(true), null);
  assert.equal(parseFiniteScore(false), null);
  assert.equal(parseFiniteScore({}), null);
  assert.equal(parseFiniteScore([50]), null);
});

test('asr-service: cleanly exports required alignment and scoring functions', () => {
  const asr = require('../../functions/src/entrance-test/asr-service');
  assert.equal(typeof asr.transcribeAudio, 'function');
  assert.equal(typeof asr.alignAudioWithAzure, 'function');
  assert.equal(typeof asr.parseFiniteScore, 'function');
  assert.equal(asr.parseFiniteScore(0), 0);
  assert.equal(asr.parseFiniteScore(null), null);
});
