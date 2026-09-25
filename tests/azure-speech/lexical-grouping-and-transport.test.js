'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isCurrencyExpression,
  expandCurrencyToken,
  groupLexicalExpressions
} = require('../../functions/src/services/azure-speech/lexical-grouping');

const {
  ContinuousAssessmentTransport
} = require('../../functions/src/services/azure-speech/continuous-transport');

test('LexicalGrouping: recognizes currency expressions', () => {
  assert.equal(isCurrencyExpression('$35,000'), true);
  assert.equal(isCurrencyExpression('$1.15 trillion'), true);
  assert.equal(isCurrencyExpression('€50 million'), true);
  assert.equal(isCurrencyExpression('£100'), true);
  assert.equal(isCurrencyExpression('regular text'), false);
  assert.equal(isCurrencyExpression('35000'), false);
});

test('LexicalGrouping: expands currency tokens into spoken words', () => {
  const words35k = expandCurrencyToken('$35,000');
  assert.deepEqual(words35k, ['thirty-five', 'thousand', 'dollars']);

  const wordsTrillion = expandCurrencyToken('$1.15 trillion');
  assert.deepEqual(wordsTrillion, ['one', 'point', 'one', 'five', 'trillion', 'dollars']);

  const wordsEuros = expandCurrencyToken('€50 million');
  assert.deepEqual(wordsEuros, ['fifty', 'million', 'euros']);
});

test('LexicalGrouping: groups recognized words matching multi-word currency reference', () => {
  const referenceTokens = ['The', 'company', 'lost', '$35,000', 'last', 'year'];
  const normalizedWords = [
    { occurrenceId: 'w-0', word: 'The', startMs: 100, endMs: 200, clipSpan: { startSample: 1600, endSample: 3200 } },
    { occurrenceId: 'w-1', word: 'company', startMs: 220, endMs: 500, clipSpan: { startSample: 3520, endSample: 8000 } },
    { occurrenceId: 'w-2', word: 'lost', startMs: 520, endMs: 700, clipSpan: { startSample: 8320, endSample: 11200 } },
    { occurrenceId: 'w-3', word: 'thirty-five', startMs: 750, endMs: 1100, clipSpan: { startSample: 12000, endSample: 17600 } },
    { occurrenceId: 'w-4', word: 'thousand', startMs: 1120, endMs: 1400, clipSpan: { startSample: 17920, endSample: 22400 } },
    { occurrenceId: 'w-5', word: 'dollars', startMs: 1420, endMs: 1800, clipSpan: { startSample: 22720, endSample: 28800 } },
    { occurrenceId: 'w-6', word: 'last', startMs: 1850, endMs: 2050, clipSpan: { startSample: 29600, endSample: 32800 } },
    { occurrenceId: 'w-7', word: 'year', startMs: 2100, endMs: 2350, clipSpan: { startSample: 33600, endSample: 37600 } }
  ];

  const grouped = groupLexicalExpressions(normalizedWords, referenceTokens);

  assert.equal(grouped.length, 8);
  const grpWord1 = grouped[3];
  const grpWord2 = grouped[4];
  const grpWord3 = grouped[5];

  assert.ok(grpWord1.lexicalGroup);
  assert.equal(grpWord1.lexicalGroup.referenceToken, '$35,000');
  assert.equal(grpWord1.lexicalGroup.isGroupLead, true);
  assert.equal(grpWord1.lexicalGroup.groupWordCount, 3);
  assert.equal(grpWord1.lexicalGroup.groupStartMs, 750);
  assert.equal(grpWord1.lexicalGroup.groupEndMs, 1800);
  assert.deepEqual(grpWord1.lexicalGroup.groupSpan, { startSample: 12000, endSample: 28800 });

  assert.ok(grpWord2.lexicalGroup);
  assert.equal(grpWord2.lexicalGroup.isGroupLead, false);
  assert.ok(grpWord3.lexicalGroup);
  assert.equal(grpWord3.lexicalGroup.isGroupLead, false);
});

test('ContinuousAssessmentTransport: normalizes to bel.speech.v3 schema with lexical grouping', async () => {
  const transport = new ContinuousAssessmentTransport();
  const dummyAudio = Buffer.alloc(32000);
  const audioIdentity = { sampleRateHz: 16000, sampleCount: 16000, channels: 1 };

  const result = await transport.assessStream({
    referenceText: 'The budget is $35,000 annually',
    audioBuffer: dummyAudio,
    audioIdentity,
    mode: 'read_aloud',
    assessmentId: 'asmt-v3-test'
  }, { useMock: true });

  assert.equal(result.schemaVersion, 'bel.speech.v3');
  assert.equal(result.status, 'ready');
  assert.equal(result.mode, 'read_aloud');
  assert.ok(Array.isArray(result.words));
  assert.ok(result.words.length > 0);
});

test('ContinuousAssessmentTransport: validates referenceText and audioBuffer inputs', async () => {
  const transport = new ContinuousAssessmentTransport();
  const dummyAudio = Buffer.alloc(16000);

  await assert.rejects(() => transport.assessStream({ referenceText: '', audioBuffer: dummyAudio }), /REFERENCE_TEXT_REQUIRED/);
  await assert.rejects(() => transport.assessStream({ referenceText: null, audioBuffer: dummyAudio }), /REFERENCE_TEXT_REQUIRED/);
  await assert.rejects(() => transport.assessStream({ referenceText: 'Test', audioBuffer: null }), /VALID_AUDIO_BUFFER_REQUIRED/);
  await assert.rejects(() => transport.assessStream({ referenceText: 'Test', audioBuffer: Buffer.alloc(0) }), /VALID_AUDIO_BUFFER_REQUIRED/);
});

test('LexicalGrouping: expands various currencies and handles non-matching/empty inputs gracefully', () => {
  // Yen & Pounds
  assert.deepEqual(expandCurrencyToken('¥500'), ['five', 'hundred', 'yen']);
  assert.deepEqual(expandCurrencyToken('£1,000'), ['one', 'thousand', 'pounds']);
  assert.deepEqual(expandCurrencyToken('not-a-currency'), ['not-a-currency']);

  // Empty words or empty tokens
  assert.deepEqual(groupLexicalExpressions([], ['Some', 'ref']), []);
  assert.deepEqual(groupLexicalExpressions(null, ['Some', 'ref']), null);

  // Currency in ref but not matching words in audio
  const nonMatchingWords = [
    { occurrenceId: 'w-0', word: 'The', startMs: 0, endMs: 100 },
    { occurrenceId: 'w-1', word: 'cost', startMs: 110, endMs: 200 }
  ];
  const grp = groupLexicalExpressions(nonMatchingWords, ['The', 'cost', '$50']);
  assert.equal(grp.length, 2);
  assert.equal(grp[0].lexicalGroup, undefined);
  assert.equal(grp[1].lexicalGroup, undefined);
});
