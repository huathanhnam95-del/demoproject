'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
let policy;
try { policy = require('../../../functions/src/ai-assistance/accounting/usage-credit-policy'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
test('shared credit policy exposes exact calibrated server metering', () => {
    assert.equal(typeof policy?.calculateUsageMicrocredits, 'function');
    const counters = policy.zeroCounters();
    assert.equal(policy.calculateUsageMicrocredits('live', counters), '0');
    assert.equal(policy.calculateUsageMicrocredits('live', { ...counters, inputActiveSamples: 960000 }), '6250000');
    assert.equal(policy.calculateUsageMicrocredits('live', { ...counters, outputActiveSamples: 1440000 }), '22500000');
    assert.equal(policy.calculateUsageMicrocredits('generation', { ...counters, inputTextBytes: 4, outputTextBytes: 2, processingTokens: 3, imageUnits: 1 }), '1077188');
});
test('policy rejects duplicated audio transcript units and enforces pinned bounds', () => {
    assert.ok(policy);
    const counters = policy.zeroCounters();
    assert.throws(() => policy.calculateUsageMicrocredits('live', { ...counters, outputTextBytes: 1 }));
    assert.throws(() => policy.calculateUsageMicrocredits('asr', { ...counters, inputActiveSamples: 1 }));
    assert.throws(() => policy.calculateUsageMicrocredits('asr', { ...counters, outputTextBytes: 1 }));
    const value = policy.deriveUsageReservation({ model: 'gemini-3.1-flash-live-preview', request: { kind: 'live', inputBytes: 40000, audioBytes: 32000, maxOutputTokens: 512 }, at: '2026-09-09T00:00:00Z' });
    assert.equal(value.bounds.inputTextBytes, 44096); assert.equal(value.bounds.outputActiveSamples, 491520);
    assert.equal(value.bounds.outputTextBytes, 0);
    assert.throws(() => policy.deriveUsageReservation({ model: 'gemini-3.1-flash-live-preview', request: { kind: 'live', audioBytes: 32000, maxOutputTokens: 512 }, at: '2028-01-01' }));
});
test('strict metering schema rejects unsafe counters, wrong formats and unknown fields', () => {
    assert.ok(policy);
    const evidence = { eventId: 'e1', stage: 'generation', final: true, counters: policy.zeroCounters(), inputSampleRate: 16000, outputSampleRate: 24000, meteringVersion: policy.METERING_VERSION };
    assert.deepEqual(policy.validateUsageEvidence(evidence), evidence);
    for (const patch of [{ extra: true }, { inputSampleRate: 48000 }, { final: 'true' }, { counters: { ...evidence.counters, inputTextBytes: Number.MAX_SAFE_INTEGER + 1 } }, { counters: { ...evidence.counters, inputTextBytes: -1 } }]) assert.throws(() => policy.validateUsageEvidence({ ...evidence, ...patch }));
});
test('text-only Live processing is charged while an all-zero idle observation is free', () => {
    const counters = policy.zeroCounters();
    assert.equal(policy.calculateUsageMicrocredits('live', counters), '0');
    assert.equal(policy.calculateUsageMicrocredits('live', { ...counters, inputTextBytes: 4, processingTokens: 2 }), '15000');
});
test('large safe counters are combined only as integers and voice estimates reject unsafe values', () => {
    const a = Number.MAX_SAFE_INTEGER, b = a - 1;
    const expected = ((BigInt(a) + BigInt(b)) * 3750n * 125n + 99n) / 100n;
    assert.equal(policy.calculateUsageMicrocredits('generation', { ...policy.zeroCounters(), outputTextBytes: a, processingTokens: b }), expected.toString());
    assert.throws(() => policy.estimateVoice('-1'));
    assert.throws(() => policy.estimateVoice('999999999999999999999999999999'));
});
test('voice minute estimate includes independent ASR and proposal processing without reused audio', () => {
    const z = policy.zeroCounters();
    const minute = BigInt(policy.calculateUsageMicrocredits('live', { ...z, inputActiveSamples: 480000, outputActiveSamples: 720000, inputTextBytes: 2048, processingTokens: 512 }))
        + BigInt(policy.calculateUsageMicrocredits('asr', { ...z, inputTextBytes: 512, processingTokens: 2048 }))
        + BigInt(policy.calculateUsageMicrocredits('generation', { ...z, inputTextBytes: 4096, outputTextBytes: 4096, processingTokens: 4096 }));
    assert.equal(minute, 71495000n); assert.equal(policy.estimateVoice(minute.toString()).remainingSeconds, 60);
});
