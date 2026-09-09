'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createNativeAccountingPolicy } = require('../../../functions/src/ai-assistance/accounting/native-policy');
test('explicit native policy validates registered models and freezes request for server estimator', () => {
    let observed;
    const policy = createNativeAccountingPolicy({ versionId: 'native-estimate-v1', models: ['gemini-3.8-flash'], deriveEstimatedQuantities(request) { observed = request; assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.parts)); return { inputText: '100', outputText: '256' }; } });
    assert.equal(policy.kind, 'estimated'); assert.equal(policy.proven, undefined); assert.deepEqual(policy.deriveEstimatedQuantities({ parts: ['hello'] }), { inputText: '100', outputText: '256' }); assert.deepEqual(observed.parts, ['hello']);
    assert.throws(() => createNativeAccountingPolicy({ versionId: 'bad', models: ['arbitrary'], deriveEstimatedQuantities() {} }));
});
test('native estimator rejects malformed quantities and oversized descriptor', () => {
    const policy = createNativeAccountingPolicy({ versionId: 'test', deriveEstimatedQuantities: () => ({ inputText: '-1' }) }); assert.throws(() => policy.deriveEstimatedQuantities({})); assert.throws(() => policy.deriveEstimatedQuantities({ text: 'x'.repeat(65537) }));
});
