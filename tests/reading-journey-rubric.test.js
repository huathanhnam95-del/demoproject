/**
 * Reading Journey Rubric unit tests
 * Run with: node tests/reading-journey-rubric.test.js
 */

const assert = require('assert');
const rubric = require('../src/services/reading-journey/rubric');

console.log('Starting Reading Journey rubric tests...');

// ── Constants ───────────────────────────────────────────────────────────────────

assert.strictEqual(rubric.CRITERIA.length, 8, 'Should have 8 criteria');
assert.strictEqual(rubric.PASS_THRESHOLD, 7.0, 'Pass threshold should be 7.0');
assert.strictEqual(rubric.CRITICAL_MIN, 5, 'Critical minimum should be 5');
assert.deepStrictEqual(
  rubric.CRITICAL_CRITERIA,
  ['vocabulary', 'grammar', 'plot', 'coherence'],
  'Critical criteria should be vocabulary, grammar, plot, coherence'
);

// ── Weight sums ─────────────────────────────────────────────────────────────────

for (const level of ['A2', 'B1', 'B2', 'C1']) {
  const weights = rubric.WEIGHTS[level];
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, 100, `Weights for ${level} should sum to 100 (got ${sum})`);
}

// ── Perfect scores → pass ───────────────────────────────────────────────────────

const perfect = { plot: 10, character: 10, vocabulary: 10, grammar: 10, pacing: 10, emotion: 10, setting: 10, coherence: 10 };
for (const level of ['A2', 'B1', 'B2', 'C1']) {
  const result = rubric.computeWeightedScore(perfect, level);
  assert.strictEqual(result.weightedAverage, 10, `All 10s at ${level} → average 10`);
  assert.strictEqual(result.passed, true, `All 10s at ${level} → pass`);
  assert.strictEqual(result.criticalFailures.length, 0, `All 10s at ${level} → no critical failures`);
}

// ── All 1s → fail ───────────────────────────────────────────────────────────────

const terrible = { plot: 1, character: 1, vocabulary: 1, grammar: 1, pacing: 1, emotion: 1, setting: 1, coherence: 1 };
const terribleResult = rubric.computeWeightedScore(terrible, 'B1');
assert.strictEqual(terribleResult.weightedAverage, 1, 'All 1s → average 1');
assert.strictEqual(terribleResult.passed, false, 'All 1s → fail');
assert.ok(terribleResult.criticalFailures.length > 0, 'All 1s → has critical failures');

// ── Boundary: exactly 7.0 with no critical failures → pass ─────────────────────

const boundary = { plot: 7, character: 7, vocabulary: 7, grammar: 7, pacing: 7, emotion: 7, setting: 7, coherence: 7 };
const boundaryResult = rubric.computeWeightedScore(boundary, 'B1');
assert.strictEqual(boundaryResult.weightedAverage, 7, 'All 7s → average exactly 7.0');
assert.strictEqual(boundaryResult.passed, true, 'Average exactly 7.0 → pass');

// ── Boundary: just below 7.0 → fail ────────────────────────────────────────────

const justBelow = { plot: 7, character: 7, vocabulary: 7, grammar: 7, pacing: 7, emotion: 6, setting: 6, coherence: 7 };
const justBelowResult = rubric.computeWeightedScore(justBelow, 'B1');
assert.ok(justBelowResult.weightedAverage < 7.0, `Avg ${justBelowResult.weightedAverage} should be < 7.0`);
assert.strictEqual(justBelowResult.passed, false, 'Just below 7.0 → fail');

// ── Critical minimum enforcement ────────────────────────────────────────────────

const highAvgLowVocab = { plot: 10, character: 10, vocabulary: 4, grammar: 10, pacing: 10, emotion: 10, setting: 10, coherence: 10 };
const highAvgResult = rubric.computeWeightedScore(highAvgLowVocab, 'B1');
assert.ok(highAvgResult.weightedAverage >= 7.0, `Average ${highAvgResult.weightedAverage} ≥ 7.0`);
assert.strictEqual(highAvgResult.passed, false, 'Vocab below 5 → fail despite high average');
assert.ok(highAvgResult.criticalFailures.includes('vocabulary'), 'Should report vocabulary as critical failure');

const highAvgLowGrammar = { plot: 10, character: 10, vocabulary: 10, grammar: 3, pacing: 10, emotion: 10, setting: 10, coherence: 10 };
const grammarResult = rubric.computeWeightedScore(highAvgLowGrammar, 'A2');
assert.strictEqual(grammarResult.passed, false, 'Grammar below 5 → fail');
assert.ok(grammarResult.criticalFailures.includes('grammar'), 'Should report grammar as critical failure');

// ── Flag failures ───────────────────────────────────────────────────────────────

const goodWithFlag = rubric.computeWeightedScore(perfect, 'B1', { tooHard: true });
assert.strictEqual(goodWithFlag.passed, false, 'tooHard flag → auto-fail');
assert.ok(goodWithFlag.flagFailures.includes('tooHard'), 'Should report tooHard flag');

const unsafeFlag = rubric.computeWeightedScore(perfect, 'C1', { unsafe: true });
assert.strictEqual(unsafeFlag.passed, false, 'unsafe flag → auto-fail');

const tooEasyFlag = rubric.computeWeightedScore(perfect, 'A2', { tooEasy: true });
assert.strictEqual(tooEasyFlag.passed, false, 'tooEasy flag → auto-fail');

// ── CEFR-level weight differences ───────────────────────────────────────────────

// At A2, vocabulary weight is 20; at C1 it's 10.
// A story strong in vocab but weak in plot should score higher at A2.
const vocabHeavy = { plot: 4, character: 5, vocabulary: 10, grammar: 10, pacing: 5, emotion: 5, setting: 5, coherence: 7 };
const a2Score = rubric.computeWeightedScore(vocabHeavy, 'A2');
const c1Score = rubric.computeWeightedScore(vocabHeavy, 'C1');
assert.ok(a2Score.weightedAverage > c1Score.weightedAverage,
  `Vocab-heavy story should score higher at A2 (${a2Score.weightedAverage}) than C1 (${c1Score.weightedAverage})`);

// ── Per-criterion output ────────────────────────────────────────────────────────

const perCrit = rubric.computeWeightedScore(perfect, 'B1');
assert.strictEqual(perCrit.perCriterion.length, 8, 'Should have 8 per-criterion entries');
for (const entry of perCrit.perCriterion) {
  assert.ok(entry.criterion, 'Each entry should have a criterion name');
  assert.ok(entry.weight > 0, 'Each entry should have a positive weight');
  assert.strictEqual(entry.score, 10, 'Each entry should have score 10');
}

// ── getAssessmentPrompt ─────────────────────────────────────────────────────────

for (const level of ['A2', 'B1', 'B2', 'C1']) {
  const prompt = rubric.getAssessmentPrompt(level);
  assert.ok(prompt.includes(level), `Prompt for ${level} should mention the level`);
  assert.ok(prompt.includes('plot'), `Prompt for ${level} should mention plot`);
  assert.ok(prompt.includes('vocabulary'), `Prompt for ${level} should mention vocabulary`);
  assert.ok(prompt.includes('JSON'), `Prompt for ${level} should mention JSON`);
}

// ── Missing scores edge case ────────────────────────────────────────────────────

const partial = { plot: 8, vocabulary: 9 };
const partialResult = rubric.computeWeightedScore(partial, 'B1');
assert.ok(partialResult.weightedAverage >= 0, 'Should handle missing scores (default to 0)');
assert.ok(partialResult.criticalFailures.includes('grammar'), 'Missing grammar treated as 0 → critical');
assert.ok(partialResult.criticalFailures.includes('coherence'), 'Missing coherence treated as 0 → critical');

// ── Invalid level defaults to B1 ────────────────────────────────────────────────

const defaultLevel = rubric.computeWeightedScore(perfect, 'Z9');
assert.strictEqual(defaultLevel.weightedAverage, 10, 'Invalid level defaults to B1 weights');

console.log('All Reading Journey rubric tests passed. ✅');
