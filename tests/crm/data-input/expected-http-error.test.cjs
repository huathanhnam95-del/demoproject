'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createExpectedHttpErrorGate } = require('../../browser/crm-data-input-native/expected-http-error.cjs');
const arm = { draftId: 'draft-fixture', previewId: 'preview-fixture', revision: 3 };
const payment = { method: 'POST', path: '/api/admin/data-input/conversations/draft-fixture/commit', status: 422,
    body: { previewId: 'preview-fixture', confirmationToken: 'transient-secret', paymentAcknowledgements: [] }, response: { success: false, error: 'PAYMENT_ASSERTION_REQUIRED' } };
test('payment negative gate is exact and single use without retaining token', () => {
    const gate = createExpectedHttpErrorGate('image-payment');
    assert.equal(gate.observe(payment), false); gate.arm(arm);
    for (const patch of [{ status: 403 }, { path: payment.path + '?x=1' }, { method: 'GET' }, { response: { error: 'OTHER' } }, { body: { ...payment.body, previewId: 'other' } }, { body: { ...payment.body, paymentAcknowledgements: ['pay'] } }, { body: { ...payment.body, actorUid: 'forged' } }]) {
        assert.equal(gate.observe({ ...payment, ...patch }), false);
    }
    assert.equal(gate.observe(payment), true); assert.equal(gate.observe(payment), false);
    assert.throws(() => gate.arm(arm)); assert.equal(gate.evidence().length, 1);
    assert.equal(JSON.stringify(gate.evidence()).includes('transient-secret'), false);
});
test('date negative gate binds revision and preview path, never payment errors', () => {
    const gate = createExpectedHttpErrorGate('image-ambiguous-date'); gate.arm({ draftId: arm.draftId, revision: 4 });
    const event = { method: 'POST', path: '/api/admin/data-input/conversations/draft-fixture/preview', status: 422,
        body: { expectedRevision: 4, requestId: 'request-fixture' }, response: { success: false, error: 'DRAFT_INCOMPLETE' } };
    assert.equal(gate.observe(payment), false);
    assert.equal(gate.observe({ ...event, body: { ...event.body, expectedRevision: 3 } }), false);
    assert.equal(gate.observe(event), true); assert.equal(gate.observe(event), false);
});
test('unregistered scenarios and malformed arms cannot allow a negative response', () => {
    for (const scenario of ['create', 'image', 'image-adversarial']) assert.throws(() => createExpectedHttpErrorGate(scenario).arm(arm));
    for (const value of [{ ...arm, draftId: '../other' }, { ...arm, revision: -1 }, { ...arm, previewId: '' }, { ...arm, extra: true }]) assert.throws(() => createExpectedHttpErrorGate('image-payment').arm(value));
});

test('native evidence redacts contact values embedded in provider JSON strings while preserving digest metadata', () => {
    const safe = require('../../browser/crm-data-input-native/server.cjs').createEvidenceRedactor([]);
    const result = safe({ email: 'hidden@example.invalid', text: '{"email":"other@example.invalid"}', fixtureContactDigest: 'abc123', fixtureContactSource: { kind: 'image', attachmentId: 'a1' } });
    assert.equal(result.email, undefined); assert.equal(result.text.includes('other@example.invalid'), false);
    assert.equal(result.fixtureContactDigest, 'abc123'); assert.equal(result.fixtureContactSource.attachmentId, 'a1');
});
