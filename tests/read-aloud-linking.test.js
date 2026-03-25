/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  PHASE1_LINKING_CASES,
  PHASE1_BLOCKED_CASES,
  PHASE2_REDUCED_WORD_CASES,
  PHASE3_SOUND_CHANGE_CASES,
  PHASE3_BLOCKED_CASES
} = require('./fixtures/read-aloud-linking-cases.js');

async function loadHelper() {
  require(path.join(__dirname, '../public/js/read-aloud-prompt-grammar.js'));
  require(path.join(__dirname, '../public/js/read-aloud-spoken-forms.js'));
  require(path.join(__dirname, '../public/js/read-aloud-connected-speech-rules.js'));
  require(path.join(__dirname, '../public/js/read-aloud-linking.js'));
  return globalThis.ReadAloudLinking;
}

function findBoundary(analysis, leftWord, rightWord) {
  return analysis.boundaries.find((boundary) => (
    boundary.leftWord === leftWord && boundary.rightWord === rightWord
  ));
}

function findTokenAnnotation(analysis, word) {
  if (!analysis || !Array.isArray(analysis.tokenAnnotations)) return null;
  const normalized = String(word || '').toLowerCase();
  return analysis.tokenAnnotations.find((annotation) => (
    String(annotation.word || '').toLowerCase() === normalized
    || String(annotation.display || '').toLowerCase() === normalized
  )) || null;
}

function buildPhoneticLookup(lookup = {}) {
  const normalizedLookup = new Map(
    Object.entries(lookup).map(([word, entry]) => [String(word || '').toLowerCase(), entry])
  );
  return async (word) => normalizedLookup.get(String(word || '').toLowerCase()) || null;
}

async function assertBoundaryCase(analyzePrompt, caseItem) {
  const analysis = await analyzePrompt(caseItem.text, {
    phoneticLookup: caseItem.lookup ? buildPhoneticLookup(caseItem.lookup) : undefined
  });
  const boundary = findBoundary(analysis, caseItem.leftWord, caseItem.rightWord);
  assert.ok(boundary, `expected boundary for "${caseItem.text}"`);

  const expected = caseItem.expected || {};
  if (Object.prototype.hasOwnProperty.call(expected, 'blocked')) {
    assert.strictEqual(boundary.blocked, expected.blocked, `blocked mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'blockedReason')) {
    assert.strictEqual(boundary.blockedReason, expected.blockedReason, `blockedReason mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'category')) {
    assert.strictEqual(boundary.category, expected.category, `category mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'subtype')) {
    assert.strictEqual(boundary.subtype, expected.subtype, `subtype mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'confidence')) {
    assert.strictEqual(boundary.confidence, expected.confidence, `confidence mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'source')) {
    assert.strictEqual(boundary.source, expected.source, `source mismatch for "${caseItem.text}"`);
  }
}

async function assertReducedWordCase(analyzePrompt, caseItem) {
  const analysis = await analyzePrompt(caseItem.text, {
    connectedSpeechLevel: 'v2_reduced_words'
  });
  const annotation = findTokenAnnotation(analysis, caseItem.word);
  assert.ok(annotation, `expected reduced-word annotation for "${caseItem.text}"`);

  const expected = caseItem.expected || {};
  if (Object.prototype.hasOwnProperty.call(expected, 'layer')) {
    assert.strictEqual(annotation.layer, expected.layer, `layer mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'subtype')) {
    assert.strictEqual(annotation.subtype, expected.subtype, `subtype mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'confidence')) {
    assert.strictEqual(annotation.confidence, expected.confidence, `confidence mismatch for "${caseItem.text}"`);
  }
}

async function assertSoundChangeCase(analyzePrompt, caseItem) {
  const analysis = await analyzePrompt(caseItem.text, {
    connectedSpeechLevel: 'v3_sound_changes'
  });
  const boundary = findBoundary(analysis, caseItem.leftWord, caseItem.rightWord);
  assert.ok(boundary, `expected v3 boundary for "${caseItem.text}"`);

  const expected = caseItem.expected || {};
  if (Object.prototype.hasOwnProperty.call(expected, 'blocked')) {
    assert.strictEqual(boundary.blocked, expected.blocked, `blocked mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'blockedReason')) {
    assert.strictEqual(boundary.blockedReason, expected.blockedReason, `blockedReason mismatch for "${caseItem.text}"`);
  }
  if (expected.blocked) {
    return;
  }
  if (expected.category && expected.category !== 'connected_speech') {
    if (Object.prototype.hasOwnProperty.call(expected, 'category')) {
      assert.strictEqual(boundary.category, expected.category, `category mismatch for "${caseItem.text}"`);
    }
    if (Object.prototype.hasOwnProperty.call(expected, 'subtype')) {
      assert.strictEqual(boundary.subtype, expected.subtype, `subtype mismatch for "${caseItem.text}"`);
    }
    if (Object.prototype.hasOwnProperty.call(expected, 'confidence')) {
      assert.strictEqual(boundary.confidence, expected.confidence, `confidence mismatch for "${caseItem.text}"`);
    }
    return;
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'category')) {
    assert.strictEqual(boundary.category, expected.category, `category mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'subtype')) {
    assert.strictEqual(boundary.subtype, expected.subtype, `subtype mismatch for "${caseItem.text}"`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'confidence')) {
    assert.strictEqual(boundary.confidence, expected.confidence, `confidence mismatch for "${caseItem.text}"`);
  }
  assert.strictEqual(boundary.layer, 'assimilation', `layer mismatch for "${caseItem.text}"`);
  assert.strictEqual(boundary.teachingLevel, 'v3', `teachingLevel mismatch for "${caseItem.text}"`);
  assert.strictEqual(boundary.markerText, 'sound change', `markerText mismatch for "${caseItem.text}"`);
}

async function assertNoReducedWordCase(analyzePrompt, caseItem) {
  const analysis = await analyzePrompt(caseItem.text, {
    connectedSpeechLevel: 'v2_reduced_words'
  });
  const annotation = findTokenAnnotation(analysis, caseItem.word);
  assert.strictEqual(annotation, null, `did not expect reduced-word annotation for "${caseItem.text}"`);
}

(async () => {
  const {
    tokenizePrompt,
    analyzePrompt,
    buildAccessibleSummary,
    buildGuideExplanationItems,
    hasVisibleAssimilation,
    filterAnalysisByBlockedBoundaries
  } = await loadHelper();

  const contractionTokens = tokenizePrompt(`It's over`);
  assert.deepStrictEqual(
    contractionTokens.map((token) => token.type),
    ['word', 'space', 'word'],
    'tokenizePrompt should keep contractions as single word tokens and preserve spacing'
  );
  assert.strictEqual(contractionTokens[0].normalized, `it's`, 'contractions should stay normalized with apostrophes');
  assert.strictEqual(contractionTokens[0].subtype, 'word', 'contractions should remain ordinary word tokens');

  const spacedTokens = tokenizePrompt('go  away');
  assert.deepStrictEqual(
    spacedTokens.map((token) => token.raw),
    ['go', '  ', 'away'],
    'tokenizePrompt should preserve repeated spaces as a single display segment'
  );

  const acronymTokens = tokenizePrompt('MRI exam');
  assert.deepStrictEqual(
    acronymTokens.map((token) => token.raw),
    ['MRI', ' ', 'exam'],
    'uppercase acronyms should be tokenized as a single spoken unit'
  );
  assert.strictEqual(acronymTokens[0].subtype, 'abbreviation', 'uppercase acronyms should be recognized as abbreviations');

  const dottedAcronymTokens = tokenizePrompt('Ph.D. students');
  assert.deepStrictEqual(
    dottedAcronymTokens.map((token) => token.raw),
    ['Ph.D.', ' ', 'students'],
    'dotted abbreviations should remain a single spoken token'
  );
  assert.strictEqual(dottedAcronymTokens[0].subtype, 'abbreviation', 'dotted abbreviations should preserve their subtype');

  const timeTokens = tokenizePrompt('8:00 appointment');
  assert.strictEqual(timeTokens[0].subtype, 'time', 'clock times should be tokenized as time tokens');
  const decimalTokens = tokenizePrompt('8.1 ounces');
  assert.strictEqual(decimalTokens[0].subtype, 'decimal', 'decimals should be tokenized as decimal tokens');

  const punctuationAnalysis = await analyzePrompt('go, away');
  const punctuationBoundary = findBoundary(punctuationAnalysis, 'go', 'away');
  assert.ok(punctuationBoundary, 'analyzePrompt should create a boundary record across separated words');
  assert.strictEqual(punctuationBoundary.blocked, true, 'comma-separated words should be blocked from linking');
  assert.strictEqual(punctuationBoundary.blockedReason, 'hard_boundary', 'comma-separated words should be blocked by hard boundary');

  const sentenceBoundaryAnalysis = await analyzePrompt('stop. It');
  const sentenceBoundary = findBoundary(sentenceBoundaryAnalysis, 'stop', 'it');
  assert.ok(sentenceBoundary, 'sentence boundaries should still produce analyzable boundary records');
  assert.strictEqual(sentenceBoundary.blocked, true, 'sentence-ending punctuation should block linking');

  const quoteBoundaryAnalysis = await analyzePrompt('"go" away');
  const quoteBoundary = findBoundary(quoteBoundaryAnalysis, 'go', 'away');
  assert.ok(quoteBoundary, 'quoted words should still map to adjacent boundary records');
  assert.strictEqual(quoteBoundary.blocked, true, 'quote punctuation should block linking when it interrupts adjacency');

  const bracketBoundaryAnalysis = await analyzePrompt('(turn) off');
  const bracketBoundary = findBoundary(bracketBoundaryAnalysis, 'turn', 'off');
  assert.ok(bracketBoundary, 'parenthesized words should still map to adjacent boundary records');
  assert.strictEqual(bracketBoundary.blocked, true, 'parentheses should block linking when they create a pause boundary');

  for (const caseItem of PHASE1_LINKING_CASES) {
    await assertBoundaryCase(analyzePrompt, caseItem);
  }

  for (const caseItem of PHASE1_BLOCKED_CASES) {
    await assertBoundaryCase(analyzePrompt, caseItem);
  }

  const hyphenatedTokens = tokenizePrompt('well-known artist');
  assert.deepStrictEqual(
    hyphenatedTokens.map((token) => token.type),
    ['word', 'space', 'word'],
    'hyphenated compounds should remain a single word token in v1'
  );
  assert.strictEqual(hyphenatedTokens[0].normalized, 'well-known', 'hyphenated compounds should preserve their normalized form');

  const repeatedWordTokens = tokenizePrompt('go on on time');
  assert.deepStrictEqual(
    repeatedWordTokens.filter((token) => token.type === 'word').map((token) => token.wordIndex),
    [0, 1, 2, 3],
    'repeated words should retain stable sequential word indexes'
  );

  const summary = buildAccessibleSummary({
    boundaries: [
      { leftWord: 'pick', rightWord: 'it', blocked: false, confidence: 'high' },
      { leftWord: 'turn', rightWord: 'off', blocked: false, confidence: 'medium' },
      { leftWord: 'go', rightWord: 'away', blocked: true, confidence: 'high' }
    ]
  });
  assert.match(summary, /pick it/i, 'accessible summary should name eligible linking word pairs');
  assert.match(summary, /turn off/i, 'accessible summary should include multiple eligible pairs');
  assert.doesNotMatch(summary, /go away/i, 'accessible summary should exclude blocked boundaries');

  const combinedSummary = buildAccessibleSummary({
    boundaries: [
      { leftWord: 'pick', rightWord: 'it', leftDisplay: 'pick', rightDisplay: 'it', blocked: false, confidence: 'high' }
    ],
    tokenAnnotations: [
      { layer: 'weak_forms', word: 'to', display: 'to' },
      { layer: 'weak_forms', word: 'the', display: 'the' }
    ]
  });
  assert.match(combinedSummary, /reduced words/i, 'accessible summary should mention reduced words when present');
  assert.match(combinedSummary, /"to"/i, 'accessible summary should list reduced words');

  const mixedSummary = buildAccessibleSummary({
    boundaries: [
      { leftWord: 'pick', rightWord: 'it', leftDisplay: 'pick', rightDisplay: 'it', blocked: false, confidence: 'high' },
      { leftWord: 'did', rightWord: 'you', leftDisplay: 'did', rightDisplay: 'you', blocked: false, confidence: 'medium', layer: 'assimilation' }
    ],
    tokenAnnotations: [
      { layer: 'weak_forms', word: 'to', display: 'to' }
    ]
  });
  assert.match(mixedSummary, /sound changes/i, 'accessible summary should mention sound changes when present');

  const guideItems = buildGuideExplanationItems({
    boundaries: [
      { id: 'b-1', leftWord: 'pick', rightWord: 'it', leftDisplay: 'pick', rightDisplay: 'it', blocked: false, confidence: 'high', layer: 'linking', category: 'consonant_to_vowel', subtype: 'consonant_to_vowel' },
      { id: 'b-2', leftWord: 'did', rightWord: 'you', leftDisplay: 'did', rightDisplay: 'you', blocked: false, confidence: 'medium', layer: 'assimilation', subtype: 'coalescent_dj' }
    ],
    tokenAnnotations: [
      { id: 'token-1', layer: 'weak_forms', word: 'to', display: 'to', subtype: 'to' }
    ]
  });
  assert.ok(guideItems.some((item) => item.layer === 'assimilation' && /slide|blend/i.test(item.explanation)), 'guide items should explain sound changes in plain English');
  assert.ok(guideItems.some((item) => item.layer === 'weak_forms' && /short|light/i.test(item.explanation)), 'guide items should explain reduced words in plain English');
  assert.ok(guideItems.some((item) => item.layer === 'linking' && /pause|carry|connect/i.test(item.explanation)), 'guide items should explain linking in plain English');
  assert.ok(guideItems.some((item) => item.id === 'boundary-b-2'), 'sound-change guide items should expose stable ids for badge selection');
  assert.ok(guideItems.some((item) => item.id === 'token-token-1'), 'reduced-word guide items should expose stable ids for token selection');

  const screenshotSentence = 'The situation is similar to a pregnant woman who has twin babies in her belly, says Avi of the Smithsonian Center for Astrophysics. He\'s proposing the idea in a paper that\'s been accepted for publication in the Astrophysical Journal Letters.';
  const screenshotAnalysis = await analyzePrompt(screenshotSentence, {
    connectedSpeechLevel: 'v3_sound_changes'
  });
  assert.strictEqual(hasVisibleAssimilation(screenshotAnalysis), false, 'sentences without a coalescent assimilation case should not count as visible sound changes');

  const didYouAnalysis = await analyzePrompt('Did you see it?', {
    connectedSpeechLevel: 'v3_sound_changes'
  });
  assert.strictEqual(hasVisibleAssimilation(didYouAnalysis), true, '"did you" should count as a visible Level 3 sound-change case');

  const blockedByChunk = filterAnalysisByBlockedBoundaries(await analyzePrompt('pick it up'), new Set(['0:1']));
  const blockedPickIt = findBoundary(blockedByChunk, 'pick', 'it');
  assert.ok(blockedPickIt, 'filtered analyses should retain boundary records');
  assert.strictEqual(blockedPickIt.blocked, true, 'chunk boundaries should suppress eligible linking boundaries');
  assert.strictEqual(blockedPickIt.blockedReason, 'chunk_boundary', 'chunk suppression should be explicit');

  for (const caseItem of PHASE2_REDUCED_WORD_CASES) {
    await assertReducedWordCase(analyzePrompt, caseItem);
  }

  for (const caseItem of PHASE3_SOUND_CHANGE_CASES) {
    await assertSoundChangeCase(analyzePrompt, caseItem);
  }

  for (const caseItem of PHASE3_BLOCKED_CASES) {
    await assertSoundChangeCase(analyzePrompt, caseItem);
  }

  await assertNoReducedWordCase(analyzePrompt, {
    text: 'to, ask',
    word: 'to'
  });

  const chunkBlockedReducedWords = filterAnalysisByBlockedBoundaries(
    await analyzePrompt('to ask', { connectedSpeechLevel: 'v2_reduced_words' }),
    new Set(['0:1'])
  );
  assert.strictEqual(
    findTokenAnnotation(chunkBlockedReducedWords, 'to'),
    null,
    'chunk-blocked reduced-word annotations should be removed with their blocked boundary'
  );
  assert.doesNotMatch(
    buildAccessibleSummary(chunkBlockedReducedWords),
    /reduced words/i,
    'chunk-blocked reduced words should not leak into the accessible summary'
  );

  const chunkBlockedSoundChanges = filterAnalysisByBlockedBoundaries(
    await analyzePrompt('did you', { connectedSpeechLevel: 'v3_sound_changes' }),
    new Set(['0:1'])
  );
  const blockedDidYou = findBoundary(chunkBlockedSoundChanges, 'did', 'you');
  assert.ok(blockedDidYou, 'filtered analyses should retain v3 boundary records');
  assert.strictEqual(blockedDidYou.blocked, true, 'chunk boundaries should suppress v3 sound changes');
  assert.strictEqual(blockedDidYou.blockedReason, 'chunk_boundary', 'v3 chunk suppression should be explicit');
  assert.doesNotMatch(
    buildAccessibleSummary(chunkBlockedSoundChanges),
    /sound changes/i,
    'chunk-blocked sound changes should not leak into the accessible summary'
  );
  assert.strictEqual(
    hasVisibleAssimilation(chunkBlockedSoundChanges),
    false,
    'blocked assimilation boundaries should not count as visible sound changes'
  );

  console.log('read-aloud linking helper tests passed');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
