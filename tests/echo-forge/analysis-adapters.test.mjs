import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAzureAnalysis } from '../../public/js/echo-forge/adapters/azure-analysis-adapter.js';
import { assertV3WordChallenge, normalizeV3Analysis } from '../../public/js/echo-forge/adapters/v3-analysis-adapter.js';

const challenge = (overrides = {}) => ({
  challengeId: 'ef-a1-azure-word-001',
  evaluationMode: 'azure_word',
  unitType: 'word',
  pronunciation: { variantId: 'ef-en-us-hello-v1' },
  ...overrides,
});

test('Azure word uses AccuracyScore and phrase uses the locked weighted formula', () => {
  const word = normalizeAzureAnalysis({
    success: true, accuracyScore: 84, fluencyScore: 12, completenessScore: 20,
  }, challenge());
  assert.equal(word.status, 'scored');
  assert.equal(word.score, 84);
  assert.equal(word.evaluationMode, 'azure_word');
  assert.deepEqual(word.dimensions, { accuracy: 84 });

  const phrase = normalizeAzureAnalysis({
    success: true, accuracyScore: 80, fluencyScore: 70, completenessScore: 60,
  }, challenge({
    challengeId: 'ef-a1-azure-phrase-001', evaluationMode: 'azure_phrase', unitType: 'phrase',
  }));
  assert.equal(phrase.score, 73); // round(.55*80 + .20*70 + .25*60)
  assert.deepEqual(phrase.dimensions, { accuracy: 80, fluency: 70, completeness: 60 });
});

test('Azure low evidence is incorrect while missing required evidence is unrateable', () => {
  const low = normalizeAzureAnalysis({ success: true, accuracyScore: 40 }, challenge());
  assert.equal(low.status, 'incorrect');
  assert.equal(low.score, 40);

  const missing = normalizeAzureAnalysis({ success: true, accuracyScore: 80 }, challenge({
    challengeId: 'ef-a1-azure-phrase-001', evaluationMode: 'azure_phrase', unitType: 'phrase',
  }));
  assert.equal(missing.status, 'unrateable');
  assert.equal(missing.score, null);
  assert.equal(missing.reasonCode, 'AZURE_REQUIRED_SCORE_MISSING');
  for (const accuracyScore of ['', '   ', true]) {
    assert.equal(normalizeAzureAnalysis({ success: true, accuracyScore }, challenge()).status, 'unrateable');
  }

  const failed = normalizeAzureAnalysis({
    success: false, error: 'AZURE_ASSESSMENT_FAILED', accuracyScore: 95,
  }, challenge());
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.score, null);
  assert.equal(failed.reasonCode, 'AZURE_ASSESSMENT_FAILED');

  const routeMissing = normalizeAzureAnalysis({
    success: false, error: 'AZURE_REQUIRED_SCORE_MISSING',
  }, challenge());
  assert.equal(routeMissing.status, 'unrateable');
  assert.equal(routeMissing.score, null);
});

test('V3 categorical score is 100, 55, or 25 from formal evidence only', () => {
  const v3Challenge = challenge({
    challengeId: 'ef-a1-v3-word-001', evaluationMode: 'v3_word', unitType: 'word',
  });
  const raw = (countStatus, stressStatus, extra = {}) => ({
    verification: {
      status: countStatus === 'incorrect' || stressStatus === 'incorrect' ? 'incorrect' : 'verified',
      count: { status: countStatus, expected: 2, observed: countStatus === 'incorrect' ? 3 : 2, reasons: [] },
      primary_stress: { applicable: true, status: stressStatus, matches_expected: stressStatus === 'verified', reasons: [] },
      model_revision: 'sha256:model-v1',
      ...extra,
    },
  });
  assert.equal(normalizeV3Analysis(raw('verified', 'verified'), v3Challenge).score, 100);
  assert.equal(normalizeV3Analysis(raw('verified', 'incorrect'), v3Challenge).score, 55);
  assert.equal(normalizeV3Analysis(raw('incorrect', 'unrateable'), v3Challenge).score, 25);
});

test('V3 rejects phrases before networking and fails closed on missing/conflicted evidence', () => {
  assert.throws(() => assertV3WordChallenge(challenge({
    challengeId: 'bad', evaluationMode: 'v3_word', unitType: 'phrase',
  })), /word|phrase/);

  const v3Challenge = challenge({
    challengeId: 'ef-a1-v3-word-001', evaluationMode: 'v3_word', unitType: 'word',
  });
  const missing = normalizeV3Analysis({ verification: {
    status: 'unrateable',
    count: { status: 'unrateable', reasons: ['MISSING_STRESS_EVIDENCE'] },
    primary_stress: { applicable: true, status: 'unrateable', reasons: ['MISSING_STRESS_EVIDENCE'] },
    model_revision: 'sha256:model-v1',
  } }, v3Challenge);
  assert.equal(missing.status, 'unrateable');
  assert.equal(missing.score, null);

  const conflict = normalizeV3Analysis({ analysis: { verification: {
    status: 'unrateable',
    count: { status: 'unrateable', reasons: ['REFERENCE_CONFLICT'] },
    primary_stress: { applicable: true, status: 'unrateable', reasons: ['REFERENCE_CONFLICT'] },
    model_revision: 'sha256:model-v1',
  } } }, v3Challenge);
  assert.equal(conflict.status, 'unrateable');
  assert.equal(conflict.dimensions.referenceConflict, true);
  assert.equal(conflict.reasonCode, 'REFERENCE_CONFLICT');

  const failed = normalizeV3Analysis({
    success: false,
    error: 'MODEL_UNAVAILABLE',
    verification: {
      status: 'verified',
      count: { status: 'verified', reasons: [] },
      primary_stress: { applicable: false, status: 'unrateable', reasons: [] },
      model_revision: 'fake-valid-revision',
    },
  }, v3Challenge);
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.score, null);

  for (const reasons of [['MODEL_UNAVAILABLE'], ['COUNT_UNCERTAIN', 'MODEL_UNAVAILABLE']]) {
    const unavailable = normalizeV3Analysis({ verification: {
      status: 'unrateable',
      count: { status: 'unrateable', reasons },
      primary_stress: { applicable: true, status: 'unrateable', reasons: [] },
      model_revision: null,
    } }, v3Challenge);
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(unavailable.reasonCode, 'MODEL_UNAVAILABLE');
  }
});
