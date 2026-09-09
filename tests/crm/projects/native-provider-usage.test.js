'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeNativeUsage, validateNormalizedEvidence } = require('../../../functions/src/ai-assistance/accounting/provider-accounting');
const { calculateCost, STANDARD_PRICING, NATIVE_STANDARD_PRICING } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
const base = { kind: 'flash', dispatchIdentity: 'local-reservation', evidenceId: 'observation1', providerRequestId: 'FnCfauWMH_KGjuMPseqVcQ', serviceTier: 'standard', final: true };
test('actual minimal Flash response completes omitted zero thoughts with explicit derived provenance', () => {
    const evidence = normalizeNativeUsage({ ...base, usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 1, totalTokenCount: 9, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 8 }], serviceTier: 'standard' } });
    assert.equal(evidence.complete, true); assert.deepEqual(evidence.quantities, { inputText: '8', outputText: '1', inputAudio: '0', inputImage: '0' }); assert.ok(evidence.provenance.derived.includes('omitted_thoughts_zero_from_reconciled_total')); assert.equal(calculateCost(NATIVE_STANDARD_PRICING[0], evidence.quantities), '9750'); assert.equal(evidence.provenance.usageMetadata.thoughtsTokenCount, undefined);
});
test('thoughts require disjoint totals; absent nonzero residual remains unknown', () => {
    const usage = { promptTokenCount: 3, candidatesTokenCount: 5, thoughtsTokenCount: 2, totalTokenCount: 10 };
    assert.equal(normalizeNativeUsage({ ...base, usageMetadata: usage }).quantities.outputText, '7');
    const ambiguous = normalizeNativeUsage({ ...base, usageMetadata: { ...usage, totalTokenCount: 8 } }); assert.equal(ambiguous.complete, false); assert.deepEqual(ambiguous.provenance.reasons, ['AMBIGUOUS_THOUGHTS']);
    const incomplete = normalizeNativeUsage({ ...base, usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 10 } }); assert.equal(incomplete.complete, false); assert.equal(incomplete.quantities, undefined);
});
test('Live known modality vectors settle only explicit final session scope and preserve missing provider ID', () => {
    const usage = { promptTokenCount: 12, responseTokenCount: 8, thoughtsTokenCount: 2, totalTokenCount: 22, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 2 }, { modality: 'AUDIO', tokenCount: 10 }], responseTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }, { modality: 'AUDIO', tokenCount: 5 }] };
    const evidence = normalizeNativeUsage({ ...base, kind: 'live', providerRequestId: null, aggregation: 'final_session_snapshot', usageMetadata: usage }); assert.equal(evidence.complete, true); assert.equal(evidence.providerRequestId, null); assert.deepEqual(evidence.quantities, { inputText: '2', inputAudio: '10', outputText: '5', outputAudio: '5', inputImage: '0', inputVideo: '0' });
    assert.equal(validateNormalizedEvidence(evidence, Object.keys(evidence.quantities), { dispatchIdentity: base.dispatchIdentity }).providerRequestId, null);
    assert.throws(() => validateNormalizedEvidence(evidence, [], { dispatchIdentity: 'wrong' }));
    assert.equal(normalizeNativeUsage({ ...base, kind: 'live', usageMetadata: usage }).complete, false);
    assert.equal(normalizeNativeUsage({ ...base, kind: 'live', aggregation: 'final_session_snapshot', usageMetadata: { ...usage, responseTokensDetails: undefined } }).complete, false);
});
test('missing counts, tier mismatch and unsupported modalities cannot become zero-cost settlement', () => {
    for (const usageMetadata of [null, {}, { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2, serviceTier: 'priority' }, { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 1 }] }]) assert.equal(normalizeNativeUsage({ ...base, usageMetadata }).complete, false);
});

test('captured Live category gap remains incomplete with raw provenance', () => {
    const usageMetadata = { promptTokenCount: 240, responseTokenCount: 23, totalTokenCount: 263, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 139 }, { modality: 'AUDIO', tokenCount: 76 }], responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 23 }] };
    const evidence = normalizeNativeUsage({ ...base, kind: 'live', aggregation: 'final_session_snapshot', usageMetadata });
    assert.equal(evidence.complete, false); assert.deepEqual(evidence.provenance.usageMetadata, usageMetadata); assert.equal(evidence.quantities, undefined);
});
test('captured Flash audio counts use separate pinned generic input pricing', () => {
    const evidence = normalizeNativeUsage({ ...base, inputModalities: ['TEXT', 'AUDIO'], usageMetadata: { promptTokenCount: 109, candidatesTokenCount: 15, totalTokenCount: 124, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 31 }, { modality: 'AUDIO', tokenCount: 78 }], serviceTier: 'standard' } });
    assert.equal(evidence.complete, true); assert.deepEqual(evidence.quantities, { inputText: '31', inputAudio: '78', outputText: '15', inputImage: '0' }); assert.equal(calculateCost(NATIVE_STANDARD_PRICING[0], evidence.quantities), '138000'); assert.equal(STANDARD_PRICING[0].ratesNano.inputAudio, undefined); assert.notEqual(NATIVE_STANDARD_PRICING[0].versionId, STANDARD_PRICING[0].versionId);
});


test('Flash image split requires pinned IMAGE, reconciled distinct counts and native image pricing', () => {
    const usageMetadata = { promptTokenCount: 12, candidatesTokenCount: 2, totalTokenCount: 14, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }, { modality: 'IMAGE', tokenCount: 9 }] };
    const evidence = normalizeNativeUsage({ ...base, inputModalities: ['TEXT', 'IMAGE'], usageMetadata });
    assert.equal(evidence.complete, true); assert.deepEqual(evidence.quantities, { inputText: '3', inputImage: '9', inputAudio: '0', outputText: '2' });
    assert.equal(calculateCost(NATIVE_STANDARD_PRICING[0], evidence.quantities), '16500'); assert.equal(calculateCost(NATIVE_STANDARD_PRICING[1], evidence.quantities), '33000'); assert.equal(STANDARD_PRICING[0].ratesNano.inputImage, undefined);
    assert.equal(normalizeNativeUsage({ ...base, usageMetadata }).complete, false);
    for (const patch of [{ totalTokenCount: 15 }, { promptTokensDetails: [...usageMetadata.promptTokensDetails, { modality: 'IMAGE', tokenCount: 0 }] }, { promptTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }, { modality: 'IMAGE', tokenCount: 8 }] }, { promptTokensDetails: undefined, promptTokenCount: 0, totalTokenCount: 2 }]) assert.equal(normalizeNativeUsage({ ...base, inputModalities: ['TEXT', 'IMAGE'], usageMetadata: { ...usageMetadata, ...patch } }).complete, false);
});
