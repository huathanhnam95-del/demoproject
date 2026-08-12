export const COMPARISON_JUDGMENTS = Object.freeze(['v2', 'v3', 'tie', 'neither']);
export const COMPARISON_STATUSES = Object.freeze(['complete', 'partial_failure']);

const REASON_COPY = Object.freeze({
    ANALYSIS_FAILED: 'Analysis unavailable because the analysis service failed.',
    MODEL_INFERENCE_FAILED: 'Analysis unavailable because model inference failed.',
    TIMEOUT: 'Analysis unavailable because the model timed out.',
    V3_PRAAT_FAILED: 'Analysis unavailable because the V3 acoustic pass failed.',
    LOW_PHONEME_CONFIDENCE: 'Analysis unavailable because model confidence was too low.',
    V3_ANALYSIS_FAILED: 'Analysis unavailable because the V3 analysis failed.',
    REFERENCE_CONFLICT: 'Analysis unavailable because the pronunciation reference conflicts.',
    V3_NOT_ACTIVE: 'Analysis unavailable because V3 is not active.',
    RECOGNIZER_CONFIG_MISSING: 'Analysis unavailable because the local phoneme recognizer is not configured.',
    RECOGNIZER_UNREACHABLE: 'Analysis unavailable because the recognizer could not be reached.',
    DECODED_UNRATEABLE: 'Analysis unavailable because the recording could not be decoded reliably.',
    RECOGNIZER_CONTRACT_INVALID: 'Analysis unavailable because the recognizer returned an invalid response.',
    RECOGNIZER_BUSY: 'Analysis unavailable because the recognizer is temporarily busy.',
    CONTRACT_MISMATCH: 'Analysis unavailable because the recognizer contract version is incompatible.',
    RECOGNIZER_AUTH_FAILED: 'Analysis unavailable because recognizer authentication failed.',
    V3_VERIFICATION_UNAVAILABLE: 'Analysis unavailable because V3 verification could not be completed.'
});

const BINARY_KEYS = new Set([
    'audio', 'audioBlob', 'blob', 'file', 'recording', 'wav', 'wavBlob'
]);
const IDENTITY_KEYS = new Set([
    'uid', 'email', 'createdAt', 'updatedAt', 'timestamp', 'idToken'
]);

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value) {
    const number = finiteNumber(value);
    return number !== null && number >= 0 ? number : null;
}

function normalizeSpan(span, index, { source = 'measurement' } = {}) {
    const measuredStart = finiteNumber(span?.measurementStartTime ?? span?.measurement_start_time);
    const measuredEnd = finiteNumber(span?.measurementEndTime ?? span?.measurement_end_time);
    const rawStart = finiteNumber(span?.startTime ?? span?.start_time);
    const rawEnd = finiteNumber(span?.endTime ?? span?.end_time);
    const partitionStart = finiteNumber(span?.partitionStartTime ?? span?.partition_start_time);
    const partitionEnd = finiteNumber(span?.partitionEndTime ?? span?.partition_end_time);
    const startTime = source === 'partition'
        ? (partitionStart ?? rawStart ?? measuredStart)
        : (source === 'raw' ? (rawStart ?? measuredStart) : (measuredStart ?? rawStart));
    const endTime = source === 'partition'
        ? (partitionEnd ?? rawEnd ?? measuredEnd)
        : (source === 'raw' ? (rawEnd ?? measuredEnd) : (measuredEnd ?? rawEnd));
    if (startTime === null || endTime === null || endTime <= startTime) return null;
    const label = String(span?.label || span?.ipa || span?.symbol || '').trim();
    // When measurement boundaries widened the span, recompute duration to
    // match.  Otherwise keep the analyzer-owned duration — the chart prefers
    // vowelDuration over the full boundary interval for V2 timing evidence.
    const usesExplicitWindow = source === 'partition'
        ? (partitionStart !== null || partitionEnd !== null)
        : (source === 'raw' || measuredStart !== null || measuredEnd !== null);
    const duration = usesExplicitWindow
        ? (endTime - startTime)
        : nonNegativeNumber(span?.duration);
    const vowelDuration = nonNegativeNumber(span?.vowelDuration ?? span?.vowel_duration);
    return {
        startTime,
        endTime,
        ...(duration !== null ? { duration } : {}),
        ...(source === 'partition' && duration !== null ? { partitionDuration: duration } : {}),
        ...(vowelDuration !== null ? { vowelDuration } : {}),
        ...(label ? { label } : {}),
        index
    };
}

function analysisSyllables(analysis) {
    if (!analysis || typeof analysis !== 'object') return [];
    if (Array.isArray(analysis.observed?.syllables)) return analysis.observed.syllables;
    if (Array.isArray(analysis.observed_syllables)) return analysis.observed_syllables;
    if (Array.isArray(analysis.syllables)) return analysis.syllables;
    return [];
}

function analysisCount(analysis, syllables) {
    const explicit = analysis?.observed?.syllableCount ?? analysis?.syllable_count ?? analysis?.syllableCount;
    return Number.isInteger(explicit) ? explicit : syllables.length;
}

function analysisConfidence(analysis) {
    return finiteNumber(analysis?.quality?.confidence ?? analysis?.confidence);
}

function analysisDuration(analysis) {
    return finiteNumber(analysis?.duration ?? analysis?.total_duration);
}

function sanitizeSerializable(value, seen = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return undefined;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) return undefined;
    if (typeof value !== 'object') return undefined;
    if (seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
        return value
            .map((item) => sanitizeSerializable(item, seen))
            .filter((item) => item !== undefined);
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (BINARY_KEYS.has(key) || IDENTITY_KEYS.has(key)) continue;
        const sanitized = sanitizeSerializable(item, seen);
        if (sanitized !== undefined) output[key] = sanitized;
    }
    return output;
}

function normalizeManualSegments(manualSegments) {
    if (!Array.isArray(manualSegments)) return [];
    return manualSegments
        .map((segment) => normalizeSpan(segment, 0))
        .filter(Boolean)
        .sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime)
        .map((segment, index) => ({ ...segment, index }));
}

export function normalizeComparisonReason(reason) {
    const key = String(reason || '').trim().toUpperCase();
    return REASON_COPY[key] || 'Analysis unavailable for an unspecified reason.';
}

export function isCompleteComparison(comparison) {
    return Boolean(
        comparison &&
        comparison.status === 'complete' &&
        comparison.v2?.status === 'available' &&
        comparison.v3?.status === 'available'
    );
}

export function buildComparisonViewModel(comparison) {
    const columns = ['v2', 'v3'].map((version) => {
        const envelope = comparison?.[version] || {};
        const analysis = envelope.analysis || null;
        const syllables = analysisSyllables(analysis);
        const available = envelope.status === 'available';
        const isPraatFallback = !available && analysis?.segmentation_source === 'praat-fallback';
        const segmentationConvention = String(analysis?.segmentation_convention || '').trim();
        const measurementConvention = String(analysis?.measurement_convention || '').trim();
        const partitionConvention = String(analysis?.partition_convention || '').trim();
        const isCtcTokenCoverage = available && segmentationConvention === 'ctc-token-coverage';
        const hasContiguousPartition = available && (
            partitionConvention === 'ctc-interspan-midpoint-contiguous-v1'
            || partitionConvention === 'ctc-interspan-acoustic-tail-contiguous-v2'
            || partitionConvention === 'ctc-interspan-acoustic-hybrid-contiguous-v3'
        );
        const isLegacyBoundaryConvention = available && !segmentationConvention;
        return {
            version,
            label: version.toUpperCase(),
            status: available ? 'available' : 'unavailable',
            reason: available ? null : normalizeComparisonReason(envelope.reason),
            analysis,
            // A degraded V3 response can carry untargeted Praat spans for
            // playback and charts. They are not recognizer evidence, so the
            // comparison metrics remain explicitly unavailable.
            syllableCount: available ? analysisCount(analysis, syllables) : null,
            confidence: available ? analysisConfidence(analysis) : null,
            duration: analysisDuration(analysis),
            boundaryStatus: available ? 'automatic' : 'display-only',
            boundarySource: isPraatFallback ? 'praat-acoustic' : (hasContiguousPartition ? 'ctc-contiguous-partition' : (isCtcTokenCoverage ? 'ctc-token-coverage' : (isLegacyBoundaryConvention ? 'recognizer-legacy' : (available ? 'recognizer' : 'none')))),
            boundaryLabel: isPraatFallback
                ? 'Display-only acoustic boundaries (Praat fallback)'
                : (hasContiguousPartition ? 'Contiguous phonological partition boundaries' : (isCtcTokenCoverage ? 'CTC token coverage boundaries' : (isLegacyBoundaryConvention ? 'Legacy recognizer boundaries (convention unknown)' : (available ? 'Automatic boundaries' : 'No automatic boundaries available')))),
            measurementConvention: measurementConvention || null,
            partitionConvention: partitionConvention || null,
            boundarySpans: syllables
                .map((span, index) => normalizeSpan(span, index, {
                    source: hasContiguousPartition ? 'partition' : (isCtcTokenCoverage ? 'raw' : 'measurement')
                }))
                .filter(Boolean),
            rawCtcSpans: isCtcTokenCoverage
                ? syllables.map((span, index) => normalizeSpan(span, index, { source: 'raw' })).filter(Boolean)
                : [],
            measurementSpans: measurementConvention
                ? syllables.map((span, index) => normalizeSpan(span, index, { source: 'measurement' })).filter(Boolean)
                : []
        };
    });
    const rows = [
        { key: 'syllableCount', label: 'Syllable count', v2: columns[0].syllableCount, v3: columns[1].syllableCount },
        {
            key: 'confidence',
            label: 'Confidence',
            v2: columns[0].confidence,
            v3: columns[1].confidence,
            v2Subtitle: 'Acoustic segmentation',
            v3Subtitle: 'Mean forced-alignment'
        },
        { key: 'duration', label: 'Duration', v2: columns[0].duration, v3: columns[1].duration }
    ];
    return {
        comparisonId: comparison?.comparisonId || null,
        status: comparison?.status || (isCompleteComparison(comparison) ? 'complete' : 'partial_failure'),
        context: sanitizeSerializable(comparison?.context || {}),
        revisions: sanitizeSerializable(comparison?.revisions || {}),
        columns,
        rows,
        manualSegments: normalizeManualSegments(comparison?.manualSegments)
    };
}

export function buildComparisonSaveMetadata(comparison, { judgment = null, manualSegments = [] } = {}) {
    if (!comparison || typeof comparison !== 'object') throw new Error('comparison is required');
    const complete = isCompleteComparison(comparison);
    if (complete && judgment !== null && !COMPARISON_JUDGMENTS.includes(judgment)) {
        throw new Error(`Invalid comparison judgment: ${judgment}`);
    }
    if (!complete && judgment !== null && !COMPARISON_JUDGMENTS.includes(judgment)) {
        throw new Error(`Invalid comparison judgment: ${judgment}`);
    }
    const normalizedJudgment = complete ? (judgment || null) : null;
    const normalizedManualSegments = normalizeManualSegments(manualSegments);
    const expectedCount = Number(comparison?.context?.expectedSyllables);
    if (normalizedManualSegments.length) {
        if (Number.isInteger(expectedCount) && normalizedManualSegments.length !== expectedCount) {
            throw new Error(`Manual segments must match the expected syllable count (${expectedCount}).`);
        }
        if (normalizedManualSegments.some((segment, index) => (
            index > 0
            && Math.abs(segment.startTime - normalizedManualSegments[index - 1].endTime) > 0.000001
        ))) {
            throw new Error('Manual segments must be contiguous.');
        }
    }
    const envelope = (version) => {
        const source = comparison[version] || {};
        return sanitizeSerializable({
            status: source.status || 'unavailable',
            reason: source.reason || null,
            analysis: source.analysis || null
        });
    };
    return {
        schemaVersion: 'pronunciation-comparison-save-v1',
        comparisonId: String(comparison.comparisonId || ''),
        status: complete ? 'complete' : 'partial_failure',
        context: sanitizeSerializable(comparison.context || {}),
        revisions: sanitizeSerializable(comparison.revisions || {}),
        judgment: normalizedJudgment,
        manualSegmentationConvention: normalizedManualSegments.length
            ? 'ipa-phonological-contiguous-v1'
            : null,
        manualSegments: normalizedManualSegments,
        analyses: {
            v2: envelope('v2'),
            v3: envelope('v3')
        }
    };
}

export { normalizeManualSegments };
