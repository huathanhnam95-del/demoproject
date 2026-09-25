'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  finiteNumberOrNull,
  readAssessmentField,
  readScore,
  normalizePhoneme,
  ticksToCanonicalSpan,
  normalizeWord,
  normalizeFinalResult
} = require('../functions/src/services/azure-speech/normalize.js');

test('finiteNumberOrNull handles various inputs', () => {
  assert.equal(finiteNumberOrNull(42), 42);
  assert.equal(finiteNumberOrNull(0), 0);
  assert.equal(finiteNumberOrNull(-15.5), -15.5);
  assert.equal(finiteNumberOrNull('85.5'), 85.5);
  assert.equal(finiteNumberOrNull('  90 '), 90);
  assert.equal(finiteNumberOrNull(null), null);
  assert.equal(finiteNumberOrNull(undefined), null);
  assert.equal(finiteNumberOrNull(''), null);
  assert.equal(finiteNumberOrNull('abc'), null);
  assert.equal(finiteNumberOrNull(NaN), null);
  assert.equal(finiteNumberOrNull(Infinity), null);
  assert.equal(finiteNumberOrNull(false), null);
});

test('readAssessmentField checks nested and flat shapes', () => {
  const flatNode = { AccuracyScore: 88, Word: 'test' };
  assert.equal(readAssessmentField(flatNode, 'AccuracyScore'), 88);

  const nestedNode = {
    PronunciationAssessment: { AccuracyScore: 95 }
  };
  assert.equal(readAssessmentField(nestedNode, 'AccuracyScore'), 95);

  const mixedNode = {
    AccuracyScore: 70,
    PronunciationAssessment: { AccuracyScore: 92 }
  };
  assert.equal(readAssessmentField(mixedNode, 'AccuracyScore'), 92);

  const explicitNullNested = {
    AccuracyScore: 80,
    PronunciationAssessment: { AccuracyScore: null }
  };
  assert.equal(readAssessmentField(explicitNullNested, 'AccuracyScore'), null);
});

test('readScore preserves true zero and rejects out-of-range', () => {
  assert.equal(readScore({ AccuracyScore: 0 }), 0);
  assert.equal(readScore({ AccuracyScore: 100 }), 100);
  assert.equal(readScore({ AccuracyScore: 75.4 }), 75.4);
  assert.equal(readScore({ AccuracyScore: -5 }), null);
  assert.equal(readScore({ AccuracyScore: 105 }), null);
  assert.equal(readScore({ AccuracyScore: null }), null);
});

test('normalizePhoneme parses candidates', () => {
  const node = {
    Phoneme: 't',
    PronunciationAssessment: {
      AccuracyScore: 82,
      NBestPhonemes: [
        { Phoneme: 't', Score: 82 },
        { Phoneme: 'd', Score: 45 }
      ]
    }
  };
  const result = normalizePhoneme(node);
  assert.equal(result.expectedIpaRaw, 't');
  assert.equal(result.accuracyScore, 82);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates[1], { ipaRaw: 'd', score: 45 });
});

test('ticksToCanonicalSpan converts 100-ns ticks accurately', () => {
  const audio = { sampleRateHz: 16000, sampleCount: 32000 };
  // 1 second offset = 10,000,000 ticks. 0.5s duration = 5,000,000 ticks.
  const node = { Offset: 10000000, Duration: 5000000 };
  const span = ticksToCanonicalSpan(node, audio);
  assert.deepEqual(span, { startSample: 16000, endSample: 24000 });

  // Out of bounds sampleCount
  const overflowNode = { Offset: 30000000, Duration: 5000000 };
  assert.equal(ticksToCanonicalSpan(overflowNode, audio), null);
});

test('normalizeWord handles omission and normal word', () => {
  const audio = { sampleRateHz: 16000, sampleCount: 32000 };
  const wordNode = {
    Word: 'hello',
    Offset: 10000000,
    Duration: 4000000,
    PronunciationAssessment: { AccuracyScore: 90, ErrorType: 'None' }
  };
  const normWord = normalizeWord(wordNode, 0, audio);
  assert.equal(normWord.occurrenceId, 'w-0');
  assert.equal(normWord.accuracyScore, 90);
  assert.equal(normWord.startMs, 1000);
  assert.equal(normWord.endMs, 1400);
  assert.equal(normWord.rawStartMs, 1000);
  assert.equal(normWord.rawEndMs, 1400);
  assert.deepEqual(normWord.rawProviderSpan, { startSample: 16000, endSample: 22400 });

  const omissionNode = {
    Word: 'world',
    Offset: 15000000,
    Duration: 4000000,
    PronunciationAssessment: { AccuracyScore: null, ErrorType: 'Omission' }
  };
  const normOmission = normalizeWord(omissionNode, 1, audio);
  assert.equal(normOmission.errorType, 'Omission');
  assert.equal(normOmission.rawProviderSpan, null);
  assert.equal(normOmission.clipSpan, null);
});

test('normalizeFinalResult returns complete envelope with bel.speech.v3 schema by default', () => {
  const audio = { sampleRateHz: 16000, sampleCount: 32000 };
  const rawResult = {
    NBest: [{
      AccuracyScore: 85,
      FluencyScore: 80,
      ProsodyScore: 82,
      Words: [
        {
          Word: 'test',
          Offset: 1000000,
          Duration: 2000000,
          PronunciationAssessment: { AccuracyScore: 85 }
        }
      ]
    }]
  };
  const finalResult = normalizeFinalResult({ rawResult, audio, mode: 'read_aloud' });
  assert.equal(finalResult.schemaVersion, 'bel.speech.v3');
  assert.equal(finalResult.status, 'ready');
  assert.equal(finalResult.scores.pronunciationAccuracy, 85);
  assert.equal(finalResult.coverage.scoredWordCount, 1);
  assert.equal(finalResult.words.length, 1);

  // Backward compatibility: explicit schemaVersion option
  const legacyResult = normalizeFinalResult({ rawResult, audio, mode: 'read_aloud', schemaVersion: 'practice-pronunciation-v2' });
  assert.equal(legacyResult.schemaVersion, 'practice-pronunciation-v2');
});
