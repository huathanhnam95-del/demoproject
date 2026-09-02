import { createAnalysisResult } from '../contracts/analysis-result.js';

export const AZURE_SCORING_THRESHOLD = 60;

function score(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function assertAzureChallenge(challenge) {
  const valid = challenge?.evaluationMode === 'azure_word' && challenge?.unitType === 'word'
    || challenge?.evaluationMode === 'azure_phrase' && challenge?.unitType === 'phrase';
  if (!valid) throw new RangeError('Azure challenge must be an azure_word word or azure_phrase phrase');
}

export function normalizeAzureAnalysis(raw, challenge) {
  assertAzureChallenge(challenge);
  if (raw?.success === false) {
    const reasonCode = String(raw.error || raw.code || 'AZURE_REQUEST_FAILED');
    const status = reasonCode === 'CANCELLED'
      ? 'cancelled'
      : (reasonCode === 'AZURE_REQUIRED_SCORE_MISSING'
        ? 'unrateable'
        : (reasonCode === 'INVALID_AUDIO' || reasonCode === 'INVALID_INPUT' ? 'invalid' : 'unavailable'));
    return createAnalysisResult({
      schemaVersion: 'echo-forge-analysis-v1',
      status,
      score: null,
      evaluationMode: challenge.evaluationMode,
      dimensions: {},
      verdict: status,
      engineRevision: String(raw?.engineRevision || 'azure-read-aloud-route-v1'),
      challengeId: challenge.challengeId,
      variantId: challenge.pronunciation?.variantId || null,
      reasonCode,
    });
  }
  const accuracy = score(raw?.accuracyScore ?? raw?.AccuracyScore);
  const fluency = score(raw?.fluencyScore ?? raw?.FluencyScore);
  const completeness = score(raw?.completenessScore ?? raw?.CompletenessScore);
  const phrase = challenge.evaluationMode === 'azure_phrase';
  const requiredEvidencePresent = accuracy !== null && (!phrase || fluency !== null && completeness !== null);
  if (!requiredEvidencePresent) {
    return createAnalysisResult({
      schemaVersion: 'echo-forge-analysis-v1',
      status: 'unrateable',
      score: null,
      evaluationMode: challenge.evaluationMode,
      dimensions: {},
      verdict: 'unrateable',
      engineRevision: String(raw?.engineRevision || 'azure-read-aloud-route-v1'),
      challengeId: challenge.challengeId,
      variantId: challenge.pronunciation?.variantId || null,
      reasonCode: 'AZURE_REQUIRED_SCORE_MISSING',
    });
  }
  const normalizedScore = phrase
    ? Math.round(0.55 * accuracy + 0.20 * fluency + 0.25 * completeness)
    : accuracy;
  const passed = normalizedScore >= AZURE_SCORING_THRESHOLD;
  return createAnalysisResult({
    schemaVersion: 'echo-forge-analysis-v1',
    status: passed ? 'scored' : 'incorrect',
    score: normalizedScore,
    evaluationMode: challenge.evaluationMode,
    dimensions: phrase
      ? { accuracy, fluency, completeness }
      : { accuracy },
    verdict: passed ? 'meets_threshold' : 'below_threshold',
    engineRevision: String(raw?.engineRevision || 'azure-read-aloud-route-v1'),
    challengeId: challenge.challengeId,
    variantId: challenge.pronunciation?.variantId || null,
    reasonCode: passed ? null : 'AZURE_BELOW_THRESHOLD',
  });
}
