'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivityMeter, textBytes, usageEvidence, assertWithinBounds, emptyCounters, METERING_VERSION } = require('../../../functions/src/ai-assistance/accounting/usage-meter');
function pcm(values) { const bytes = Buffer.alloc(values.length * 2); values.forEach((value, i) => bytes.writeInt16LE(value, i * 2)); return bytes; }
test('activity counts fixed PCM windows, excludes silence and is invariant to byte partitions', () => {
    const bytes = pcm([...Array(320).fill(0), ...Array(320).fill(1000), ...Array(320).fill(0), ...Array(97).fill(-1000)]);
    for (const chunk of [1, 3, 37, 640, bytes.length]) {
        const meter = createActivityMeter({ sampleRate: 16000 });
        for (let offset = 0; offset < bytes.length; offset += chunk) meter.add(bytes.subarray(offset, offset + chunk));
        assert.deepEqual(meter.finish(), { totalSamples: 1057, activeSamples: 417 });
        assert.deepEqual(meter.finish(), { totalSamples: 1057, activeSamples: 417 });
        assert.throws(() => meter.add(Buffer.alloc(2)), { code: 'USAGE_METER_CLOSED' });
    }
});
test('zero and below-threshold activity, output rate and incomplete PCM are explicit', () => {
    for (const sampleRate of [16000, 24000]) {
        const meter = createActivityMeter({ sampleRate }); meter.add(pcm(Array(sampleRate).fill(100)));
        assert.deepEqual(meter.finish(), { totalSamples: sampleRate, activeSamples: 0 });
    }
    assert.throws(() => createActivityMeter({ sampleRate: 48000 }), { code: 'INVALID_USAGE_RATE' });
    const partial = createActivityMeter({ sampleRate: 16000 }); partial.add(Buffer.alloc(1));
    assert.throws(() => partial.finish(), { code: 'INVALID_USAGE_PCM' });
});
test('policy text is UTF8 content bytes, and cumulative evidence preserves exact bounded counters', () => {
    assert.equal(textBytes('Xin chào 🌏'), Buffer.byteLength('Xin chào 🌏', 'utf8'));
    const counters = { ...emptyCounters(), inputTextBytes: 20, processingTokens: 512 };
    const evidence = usageEvidence({ stage: 'live', eventId: 'live-final', counters });
    assert.equal(evidence.meteringVersion, METERING_VERSION); assert.equal(evidence.inputSampleRate, 16000); assert.equal(evidence.outputSampleRate, 24000);
    assertWithinBounds(counters, counters);
    assert.throws(() => assertWithinBounds({ ...counters, inputTextBytes: 21 }, counters), { code: 'USAGE_BOUND_EXCEEDED' });
    assert.throws(() => usageEvidence({ stage: 'live', eventId: 'e', counters: { ...counters, processingTokens: -1 } }), { code: 'INVALID_USAGE_COUNTER' });
    assert.throws(() => usageEvidence({ stage: 'provider_tokens', eventId: 'e', counters }), { code: 'INVALID_USAGE_STAGE' });
});
