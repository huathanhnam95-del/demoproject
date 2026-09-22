'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveWordClipTiming } = require('../../../functions/src/services/azure-speech/word-clip-policy');

test('WordClipPolicy: returns null for invalid or null word input', () => {
  assert.equal(resolveWordClipTiming(null), null);
  assert.equal(resolveWordClipTiming('not an object'), null);
});

test('WordClipPolicy: handles omission without audio span', () => {
  const word = {
    word: 'important',
    errorType: 'Omission',
    startMs: null,
    endMs: null
  };
  const clip = resolveWordClipTiming(word);
  assert.equal(clip.word, 'important');
  assert.equal(clip.wordSpan, null);
  assert.equal(clip.clipSpan, null);
  assert.equal(clip.isolationStatus, 'unavailable');
  assert.ok(clip.reasonCodes.includes('WORD_OMITTED'));
});

test('WordClipPolicy: preserves full phonetic end without shaving or truncation', () => {
  const word = {
    word: 'test',
    startMs: 1000,
    endMs: 1450,
    accuracyScore: 40 // Even with low score, never shave ending
  };
  const nextWord = {
    word: 'sentence',
    startMs: 1600,
    endMs: 2100
  };

  const clip = resolveWordClipTiming(word, nextWord, { sampleRateHz: 16000 });
  assert.equal(clip.isolationStatus, 'accepted');
  assert.deepEqual(clip.wordSpan, { startSample: 16000, endSample: 23200 });
  // clipSpan must match wordSpan exactly, without subtracting milliseconds
  assert.deepEqual(clip.clipSpan, { startSample: 16000, endSample: 23200 });
  assert.equal(clip.contextSpan, null);
});

test('WordClipPolicy: flags abutting words as uncertain and provides contextSpan', () => {
  const word = {
    word: 'get',
    startMs: 500,
    endMs: 700
  };
  const nextWord = {
    word: 'their',
    startMs: 705, // gap is 5ms (< 10ms)
    endMs: 950
  };

  const clip = resolveWordClipTiming(word, nextWord, { sampleRateHz: 16000 });
  assert.equal(clip.isolationStatus, 'uncertain');
  assert.ok(clip.reasonCodes.includes('ABUTTING_OR_OVERLAPPING_NEXT_WORD'));
  // clipSpan still preserves ending
  assert.deepEqual(clip.clipSpan, { startSample: 8000, endSample: 11200 });
  // contextSpan spans both words for broader playback
  assert.deepEqual(clip.contextSpan, { startSample: 8000, endSample: 15200 });
});
