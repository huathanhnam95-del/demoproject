import { createAnalysisResult } from '../contracts/analysis-result.js';

const UNAVAILABLE_REASONS = new Set([
  'V3_NOT_ACTIVE',
  'MODEL_INFERENCE_FAILED',
  'VERIFIER_ARTIFACT_UNAVAILABLE',
  'V3_ANALYSIS_FAILED',
  'CONTRACT_MISMATCH',
  'MODEL_UNAVAILABLE',
  'REQUEST_FAILED',
]);

export function assertV3WordChallenge(challenge) {
  if (challenge?.evaluationMode !== 'v3_word' || challenge?.unitType !== 'word') {
    throw new RangeError('V3 evaluation is word-only; phrase requests are rejected before networking');
  }
  return challenge;
}

function collectReasons(verification) {
  return [
    ...(verification?.count?.reasons || []),
    ...(verification?.primary_stress?.reasons || []),
  ].filter((reason) => typeof reason === 'string' && reason);
}

function result(challenge, verification, values) {
  return createAnalysisResult({
    schemaVersion: 'echo-forge-analysis-v1',
    evaluationMode: 'v3_word',
    engineRevision: String(verification?.model_revision || 'pronunciation-analysis-v3-unavailable'),
    challengeId: challenge.challengeId,
    variantId: challenge.pronunciation?.variantId || null,
    ...values,
  });
}

export function normalizeV3Analysis(raw, challenge) {
  assertV3WordChallenge(challenge);
  if (raw?.success === false) {
    const reasonCode = String(raw.error || raw.code || 'REQUEST_FAILED');
    return result(challenge, null, {
      status: reasonCode === 'CANCELLED' ? 'cancelled' : 'unavailable',
      score: null,
      dimensions: {},
      verdict: reasonCode === 'CANCELLED' ? 'cancelled' : 'unavailable',
      reasonCode,
    });
  }
  const verification = raw?.verification || raw?.analysis?.verification || null;
  if (!verification || typeof verification !== 'object') {
    return result(challenge, verification, {
      status: 'unrateable', score: null, dimensions: {}, verdict: 'unrateable', reasonCode: 'V3_FORMAL_EVIDENCE_MISSING',
    });
  }
  const reasons = collectReasons(verification);
  const referenceConflict = reasons.includes('REFERENCE_CONFLICT');
  const dimensions = {
    countStatus: verification.count?.status || null,
    expectedCount: Number.isInteger(verification.count?.expected) ? verification.count.expected : null,
    observedCount: Number.isInteger(verification.count?.observed) ? verification.count.observed : null,
    stressApplicable: verification.primary_stress?.applicable !== false,
    stressStatus: verification.primary_stress?.status || null,
    stressMatchesExpected: verification.primary_stress?.matches_expected ?? null,
    ...(referenceConflict ? { referenceConflict: true } : {}),
  };
  if (referenceConflict) {
    return result(challenge, verification, {
      status: 'unrateable', score: null, dimensions, verdict: 'reference_conflict', reasonCode: 'REFERENCE_CONFLICT',
    });
  }
  const unavailableReason = reasons.find((reason) => UNAVAILABLE_REASONS.has(reason));
  if (unavailableReason) {
    return result(challenge, verification, {
      status: 'unavailable', score: null, dimensions, verdict: 'unavailable', reasonCode: unavailableReason,
    });
  }
  if (!verification.model_revision) {
    return result(challenge, verification, {
      status: 'unrateable', score: null, dimensions, verdict: 'unrateable', reasonCode: 'V3_MODEL_REVISION_MISSING',
    });
  }
  if (verification.count?.status === 'incorrect') {
    return result(challenge, verification, {
      status: 'incorrect', score: 25, dimensions, verdict: 'count_incorrect', reasonCode: 'V3_COUNT_INCORRECT',
    });
  }
  if (verification.count?.status === 'verified') {
    if (verification.primary_stress?.applicable === false) {
      return result(challenge, verification, {
        status: 'scored', score: 100, dimensions, verdict: 'count_verified', reasonCode: null,
      });
    }
    if (verification.primary_stress?.status === 'verified') {
      return result(challenge, verification, {
        status: 'scored', score: 100, dimensions, verdict: 'count_and_stress_verified', reasonCode: null,
      });
    }
    if (verification.primary_stress?.status === 'incorrect') {
      return result(challenge, verification, {
        status: 'incorrect', score: 55, dimensions, verdict: 'stress_incorrect', reasonCode: 'V3_STRESS_INCORRECT',
      });
    }
  }
  const reasonCode = reasons[0] || 'V3_FORMAL_EVIDENCE_MISSING';
  return result(challenge, verification, {
    status: UNAVAILABLE_REASONS.has(reasonCode) ? 'unavailable' : 'unrateable',
    score: null,
    dimensions,
    verdict: UNAVAILABLE_REASONS.has(reasonCode) ? 'unavailable' : 'unrateable',
    reasonCode,
  });
}
