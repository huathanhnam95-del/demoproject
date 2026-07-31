function normalize(value) {
    return String(value ?? '').normalize('NFC').trim().toLowerCase();
}

/**
 * Reasons that mean the service never produced a judgement about this
 * recording — transport failures, a backend that is not serving V3, a missing
 * verifier artifact, a broken reference. The learner's audio was never the
 * problem, so these must not consume a re-record attempt.
 */
export const SERVICE_UNAVAILABLE_REASONS = new Set([
    // Praat/V3 service and client transport
    'V3_NOT_ACTIVE',
    'V3_VERIFICATION_UNAVAILABLE',
    'V2_FALLBACK_UNRATEABLE',
    'V3_PRAAT_FAILED',
    'V3_ANALYSIS_FAILED',
    'MODEL_INFERENCE_FAILED',
    'TIMEOUT',
    // Phoneme recognizer (see RecognizerError reasons in phoneme_client.py)
    'RECOGNIZER_BUSY',
    'RECOGNIZER_AUTH_FAILED',
    'CONTRACT_MISMATCH',
    'INFERENCE_ERROR',
    // Server-side configuration and reference problems
    'VERIFIER_ARTIFACT_UNAVAILABLE',
    'REFERENCE_CONFLICT'
]);

/**
 * Map a backend verification block onto the status understood by
 * nextAttemptState(). Anything the service could not even attempt becomes
 * 'unavailable', which is ignored by the attempt counter.
 */
export function attemptStatusFor(verification) {
    if (!verification || typeof verification !== 'object') return 'unavailable';
    const status = verification.status;
    if (status === 'verified' || status === 'incorrect') return status;
    // Only components that took part in the decision may explain it. A
    // count-only release marks primary_stress not applicable and always
    // reports STRESS_SCORING_DISABLED; that must not mask a service outage
    // reported by the count component.
    const components = [verification.count];
    if (verification.primary_stress?.applicable !== false) {
        components.push(verification.primary_stress);
    }
    const reasons = components
        .flatMap((component) => component?.reasons || [])
        .map((reason) => String(reason ?? '').trim().toUpperCase())
        .filter(Boolean);
    if (reasons.length > 0 && reasons.every((reason) => SERVICE_UNAVAILABLE_REASONS.has(reason))) {
        return 'unavailable';
    }
    return 'unrateable';
}

export function createAttemptKey({ word, variantId, ipa, expectedCount } = {}) {
    return [
        normalize(word),
        normalize(variantId),
        normalize(ipa),
        Number.isFinite(Number(expectedCount)) ? String(Number(expectedCount)) : ''
    ].join('|');
}

export function resetAttemptState(key = null) {
    return { key, count: 0 };
}

export function nextAttemptState(previous = {}, { key, status } = {}) {
    const current = previous?.key === key ? previous : resetAttemptState(key);
    if (status === 'verified' || status === 'incorrect') {
        return resetAttemptState(key);
    }
    if (!['unrateable'].includes(status)) {
        return { key, count: current.count || 0, action: 'ignore' };
    }
    const count = Math.min(3, (current.count || 0) + 1);
    if (count < 3) {
        return { key, count, action: 'retry', retryNumber: count };
    }
    return { key, count, action: 'advisory' };
}
