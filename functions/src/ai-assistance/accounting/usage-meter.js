'use strict';
const { reject } = require('./money-pricing');
const { METERING_VERSION, COUNTERS, zeroCounters, validateCounters, validateUsageEvidence } = require('./usage-credit-policy');
const ACTIVITY = Object.freeze({ windowMs: 20, rmsThreshold: 256, description: 'Fixed-window PCM amplitude activity; not semantic speech recognition.' });
const emptyCounters = zeroCounters, checkedCounters = validateCounters;
function textBytes(value) { if (typeof value !== 'string') reject('INVALID_USAGE_TEXT', 'Metered text must be a string.'); return Buffer.byteLength(value, 'utf8'); }
function assertWithinBounds(counters, bounds) {
    const actual = checkedCounters(counters), maximum = checkedCounters(bounds);
    if (COUNTERS.some(key => actual[key] > maximum[key])) reject('USAGE_BOUND_EXCEEDED', 'Locally measured usage exceeds the reserved turn limits.', 409);
    return actual;
}
function quotaBounds(quota, stage) {
    if (quota === undefined || quota === null) return null; // Explicit legacy/engineering ledger mode.
    if (quota.stage !== stage || quota.meteringVersion !== METERING_VERSION) reject('INVALID_USAGE_QUOTA', 'Quota does not match this metered stage.', 409);
    return checkedCounters(quota.bounds);
}
function usageEvidence({ eventId, stage, counters, final = true }) {
    if (!['live', 'asr', 'generation'].includes(stage)) reject('INVALID_USAGE_STAGE', 'A registered usage stage is required.');
    if (typeof eventId !== 'string' || !eventId || eventId.length > 128 || typeof final !== 'boolean') reject('INVALID_USAGE_EVENT', 'A stable bounded usage event identity is required.');
    return validateUsageEvidence({ eventId, stage, final, counters: checkedCounters(counters), inputSampleRate: 16000, outputSampleRate: 24000, meteringVersion: METERING_VERSION });
}
function createActivityMeter({ sampleRate } = {}) {
    if (![16000, 24000].includes(sampleRate)) reject('INVALID_USAGE_RATE', 'PCM activity supports fixed 16kHz input or 24kHz output only.');
    const windowSamples = sampleRate * ACTIVITY.windowMs / 1000;
    let totalSamples = 0, activeSamples = 0, windowCount = 0, squares = 0, trailingByte = null, finished = false;
    function finishWindow() {
        if (windowCount && squares >= windowCount * ACTIVITY.rmsThreshold ** 2) activeSamples += windowCount;
        windowCount = 0; squares = 0;
    }
    function sample(value) { totalSamples++; windowCount++; squares += value * value; if (windowCount === windowSamples) finishWindow(); }
    return Object.freeze({
        add(bytes) {
            if (finished) reject('USAGE_METER_CLOSED', 'Completed activity meters cannot consume more samples.');
            if (!Buffer.isBuffer(bytes)) reject('INVALID_USAGE_PCM', 'PCM activity requires raw bytes.');
            let offset = 0;
            if (trailingByte !== null && bytes.length) { const raw = trailingByte | bytes[0] << 8; sample(raw >= 32768 ? raw - 65536 : raw); trailingByte = null; offset = 1; }
            for (; offset + 1 < bytes.length; offset += 2) sample(bytes.readInt16LE(offset));
            if (offset < bytes.length) trailingByte = bytes[offset];
        },
        finish() {
            if (trailingByte !== null) reject('INVALID_USAGE_PCM', 'PCM16 cannot end with an incomplete sample.');
            if (!finished) { finishWindow(); finished = true; }
            return { totalSamples, activeSamples };
        }
    });
}
module.exports = { METERING_VERSION, COUNTERS, ACTIVITY, emptyCounters, textBytes, assertWithinBounds, quotaBounds, usageEvidence, createActivityMeter };
