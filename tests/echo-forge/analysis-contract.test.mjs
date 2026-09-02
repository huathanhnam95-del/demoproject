import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYSIS_SCHEMA_VERSION,
  EVALUATION_MODES,
  NOOP_ANALYSIS_STATUSES,
  createAnalysisResult,
  isCombatNoopAnalysis,
} from '../../public/js/echo-forge/contracts/analysis-result.js';

const base = {
  schemaVersion: 'echo-forge-analysis-v1',
  status: 'scored',
  score: 88,
  evaluationMode: 'azure_word',
  dimensions: { accuracy: 88 },
  verdict: 'accurate',
  engineRevision: 'test-engine-v1',
  challengeId: 'ef-a1-word-001',
  variantId: 'variant-001',
  reasonCode: null,
};

test('analysis DTO exposes the locked schema, modes, and immutable normalized shape', () => {
  assert.equal(ANALYSIS_SCHEMA_VERSION, 'echo-forge-analysis-v1');
  assert.deepEqual([...EVALUATION_MODES], ['azure_word', 'azure_phrase', 'v3_word']);

  const result = createAnalysisResult(base);
  assert.deepEqual(result, base);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.dimensions), true);
});

test('analysis DTO rejects unknown contracts, invalid scores, and phrase V3 requests', () => {
  assert.throws(() => createAnalysisResult({ ...base, schemaVersion: 'v2' }), /schemaVersion/);
  assert.throws(() => createAnalysisResult({ ...base, status: 'maybe' }), /status/);
  assert.throws(() => createAnalysisResult({ ...base, evaluationMode: 'v3_phrase' }), /evaluationMode/);
  assert.throws(() => createAnalysisResult({ ...base, score: 101 }), /score/);
  assert.throws(() => createAnalysisResult({ ...base, unexpected: true }), /unexpected/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => createAnalysisResult({ ...base, dimensions: cyclic }), /dimensions|cyclic|JSON/);
  assert.throws(() => createAnalysisResult({ ...base, dimensions: new Map([['accuracy', 88]]) }), /dimensions|plain|JSON/);
});

test('all analyzer failure outcomes and reference conflicts are combat no-ops', () => {
  assert.deepEqual(
    [...NOOP_ANALYSIS_STATUSES],
    ['unrateable', 'unavailable', 'cancelled', 'invalid'],
  );

  for (const status of NOOP_ANALYSIS_STATUSES) {
    const result = createAnalysisResult({
      ...base,
      status,
      score: null,
      reasonCode: `TEST_${status.toUpperCase()}`,
    });
    assert.equal(isCombatNoopAnalysis(result), true, status);
  }

  const conflicted = createAnalysisResult({
    ...base,
    dimensions: { accuracy: 88, referenceConflict: true },
    reasonCode: 'REFERENCE_CONFLICT',
  });
  assert.equal(isCombatNoopAnalysis(conflicted), true);
  assert.equal(isCombatNoopAnalysis(createAnalysisResult(base)), false);
});
