'use strict';
const { strict, text, reject, instant, deepFreeze, integer } = require('./money-pricing');
const CALIBRATION_VERSION = 'crm-ai-usage-v1-2026-09';
const METERING_VERSION = 'crm-ai-activity-v1';
const COUNTERS = Object.freeze(['inputActiveSamples', 'outputActiveSamples', 'inputTextBytes', 'outputTextBytes', 'processingTokens', 'imageUnits']);
const zeroCounters = () => Object.fromEntries(COUNTERS.map(key => [key, 0]));
function validateCounters(value) {
    strict(value, COUNTERS);
    for (const key of COUNTERS) if (!Number.isSafeInteger(value[key]) || value[key] < 0) reject('INVALID_USAGE_COUNTER', 'All usage counters must be nonnegative safe integers.');
    return { ...value };
}
function validateUsageEvidence(value) {
    strict(value, ['eventId', 'stage', 'final', 'counters', 'inputSampleRate', 'outputSampleRate', 'meteringVersion']);
    text(value.eventId, 'usage event ID');
    if (!['live', 'asr', 'generation'].includes(value.stage) || typeof value.final !== 'boolean'
        || value.inputSampleRate !== 16000 || value.outputSampleRate !== 24000 || value.meteringVersion !== METERING_VERSION) reject('INVALID_USAGE_METERING', 'Pinned server metering schema is required.');
    return { ...value, counters: validateCounters(value.counters) };
}
function calculateUsageMicrocredits(stage, raw) {
    const c = validateCounters(raw);
    if (!['live', 'asr', 'generation'].includes(stage)) reject('INVALID_USAGE_STAGE', 'Unsupported usage stage.');
    if (stage === 'live' && (c.outputTextBytes || c.imageUnits)
        || stage !== 'live' && (c.inputActiveSamples || c.outputActiveSamples)
        || stage === 'asr' && (c.outputTextBytes || c.imageUnits)) reject('DUPLICATE_USAGE_REPRESENTATION', 'Audio and transcript representations cannot be charged twice.');
    // The activity meter emits all-zero counters for an idle connection. A
    // text-only processed request must still charge its text and processing.
    const outputRate = stage === 'live' ? 4500n : 3750n;
    const textCost = BigInt(c.inputTextBytes) * 750n + (BigInt(c.outputTextBytes) + BigInt(c.processingTokens)) * outputRate + BigInt(c.imageUnits) * 1120n * 750n;
    // Rational sample costs use a common denominator. Round once at the final
    // cumulative watermark, not per transport chunk. Rates include no idle time.
    const denominator = 2880000n * 100n;
    const numerator = (textCost * 2880000n + BigInt(c.inputActiveSamples) * 15000000n + BigInt(c.outputActiveSamples) * 36000000n) * 125n;
    return ((numerator + denominator - 1n) / denominator).toString();
}
function deriveUsageReservation({ model, request, at }) {
    const time = instant(at).getTime();
    if (time < Date.parse('2026-09-01T00:00:00Z') || time >= Date.parse('2027-01-01T00:00:00Z')) reject('USAGE_CALIBRATION_UNAVAILABLE', 'An effective usage calibration is required.', 409);
    if (!request || typeof request !== 'object') reject('INVALID_REQUEST', 'Usage request descriptor required.');
    const output = request.maxOutputTokens, input = request.inputBytes ?? 0, audio = request.audioBytes ?? 0;
    if (![output, input, audio].every(Number.isSafeInteger) || output < 1 || output > 8192 || input < 0 || input > 65536 || audio < 0 || audio > 3840000 || audio % 2) reject('REQUEST_BOUND_EXCEEDED', 'Invalid bounded usage descriptor.');
    const stage = request.kind === 'live' ? 'live' : request.kind === 'transcription' ? 'asr' : 'generation';
    if (model !== (stage === 'live' ? 'gemini-3.1-flash-live-preview' : 'gemini-3.8-flash')) reject('MODEL_NOT_ALLOWED', 'Usage stage does not match the pinned model.');
    const bounds = { ...zeroCounters(), inputTextBytes: Math.min(65536, input + 4096), processingTokens: output };
    if (stage === 'live') { bounds.inputActiveSamples = audio / 2; bounds.outputActiveSamples = output * 960; }
    if (stage === 'generation') {
        const maxBytes = request.maxOutputBytes ?? 65536;
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536) reject('REQUEST_BOUND_EXCEEDED', 'Invalid output byte limit.');
        bounds.outputTextBytes = Math.min(maxBytes, output * 16);
        const image = request.descriptor?.image;
        if (image) {
            if (![image.width, image.height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 8192) || image.width * image.height > 16000000) reject('INVALID_REQUEST', 'Invalid image quota descriptor.');
            bounds.imageUnits = Math.ceil(image.width / 768) * Math.ceil(image.height / 768);
        }
    }
    return deepFreeze({ stage, bounds, calibrationVersion: CALIBRATION_VERSION, meteringVersion: METERING_VERSION,
        maximumMicrocredits: calculateUsageMicrocredits(stage, bounds) });
}
// One approximate active minute: 30s input/output and one request per stage.
// This profile includes each stage's processing estimate; ASR does not charge
// captured audio/transcript again. Actual context/response sizes can vary.
const VOICE_PROFILE_MICROCREDITS = BigInt(calculateUsageMicrocredits('live', { ...zeroCounters(), inputActiveSamples: 480000, outputActiveSamples: 720000, inputTextBytes: 2048, processingTokens: 512 }))
    + BigInt(calculateUsageMicrocredits('asr', { ...zeroCounters(), inputTextBytes: 512, processingTokens: 2048 }))
    + BigInt(calculateUsageMicrocredits('generation', { ...zeroCounters(), inputTextBytes: 4096, outputTextBytes: 4096, processingTokens: 4096 }));
function estimateVoice(remaining) {
    const seconds = integer(remaining) * 60n / VOICE_PROFILE_MICROCREDITS;
    if (seconds > BigInt(Number.MAX_SAFE_INTEGER)) reject('INTEGER_LIMIT', 'Voice estimate exceeds the safe display range.');
    return { remainingSeconds: Number(seconds), profileVersion: 'crm-voice-minute-v1',
        basis: 'Estimated active voice time including context and ASR/proposal processing; varies with request size.' };
}
module.exports = { CALIBRATION_VERSION, METERING_VERSION, COUNTERS, zeroCounters, validateCounters, validateUsageEvidence, calculateUsageMicrocredits, deriveUsageReservation, estimateVoice };
