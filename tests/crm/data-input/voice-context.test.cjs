'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./transaction-fixture.cjs');
const { createDraft, applyChanges, digestDraft } = require('../../../functions/src/crm/data-input/draft-service');
const { createVoiceContextAdapter } = require('../../../functions/src/crm/data-input/voice-context');
const at = 1800000000000;
function setup(revision = 1) {
    const draft = applyChanges(createDraft({ draftId: 'd1', actorUid: 'staff1', now: at }), { expectedRevision: 0, upserts: [{ actionId: 'edit', kind: 'updateStudent', values: { studentId: 's1', name: 'Nguyễn Thị Mai' } }] }, { kind: 'text', messageId: 'm1' }, at);
    draft.revision = revision; draft.status = 'review'; draft.preview = { previewId: 'p1' };
    const preview = { previewId: 'p1', revision: draft.revision, draftDigest: digestDraft(draft), expiresAtMs: at + 600000, confirmationToken: 'never-send-save-token', testTokens: { test: 'never-send-test-token' }, review: { revision: draft.revision, effects: [{ entityType: 'student', values: { name: 'Nguyễn Thị Mai', deliveryToken: 'never-send-delivery-token' } }], paymentAssertions: [] } };
    const f = fixture({ 'crmDataInputDrafts/d1': draft, 'crmDataInputDrafts/d1/previews/p1': preview, 'crmStudents/s1': { name: 'Old name' } });
    const state = { allowed: true, denied: new Set(), now: at };
    const adapter = createVoiceContextAdapter({ db: f.db, authorize: async () => state.allowed, authorizeRecord: async ({ actorUid, id }) => actorUid === 'staff1' && !state.denied.has(id), now: () => state.now });
    const resolve = hints => adapter.resolveContext({ tx: f.transaction, actorUid: 'staff1', contextHints: hints || { draftId: 'd1', previewId: 'p1' } });
    return { ...f, state, adapter, resolve, draft, preview };
}
test('voice context binds only the displayed current preview and removes save/test secrets', async () => {
    const f = setup(), value = await f.resolve();
    assert.equal(value.previewBinding.draftDigest, digestDraft(f.draft));
    assert.equal(value.previewBinding.actorUid, 'staff1');
    assert.equal(value.context.review.effects[0].values.name, 'Nguyễn Thị Mai');
    assert.equal(JSON.stringify(value).includes('never-send'), false);
    assert.equal((await f.resolve({ draftId: 'd1' })).previewBinding, null);
    assert.equal((await f.resolve({ draftId: 'd1', previewId: 'old' })).previewBinding, null);
});
test('expired or changed draft cannot produce a confirmation binding', async () => {
    const f = setup(); f.state.now = f.preview.expiresAtMs;
    assert.equal((await f.resolve()).previewBinding, null);
    f.state.now = at; f.rows.get('crmDataInputDrafts/d1').actions[0].values.name = 'Changed';
    assert.equal((await f.resolve()).previewBinding, null);
});
test('current target authority applies to draft context and committed receipt replay', async () => {
    const f = setup(); f.state.denied.add('s1');
    await assert.rejects(f.resolve(), error => error.code === 'VOICE_TARGET_FORBIDDEN');
    f.state.denied.clear(); f.rows.get('crmDataInputDrafts/d1').status = 'committed'; f.rows.get('crmDataInputDrafts/d1').receiptId = 'p1';
    f.rows.set('crmDataInputDrafts/d1/operations/p1', { actorUid: 'staff1', operationId: 'p1', revision: 1, results: { edit: { studentId: 's2', studentLink: 'never-send-link-token' } } });
    f.rows.set('crmStudents/s2', { name: 'Saved' }); f.state.denied.add('s2');
    await assert.rejects(f.resolve(), error => error.code === 'VOICE_TARGET_FORBIDDEN');
    f.state.denied.clear(); const value = await f.resolve();
    assert.equal(value.previewBinding, null); assert.equal(value.context.status, 'committed');
    assert.equal(JSON.stringify(value).includes('never-send'), false);
});
test('strict spoken save wording binds revision and payment acknowledgement policy', async () => {
    const f = setup(), value = await f.resolve();
    assert.equal(f.adapter.confirm({ text: 'Tôi xác nhận lưu bản xem trước số 1.', binding: value.previewBinding, context: value.context }), true);
    for (const text of ['đồng ý', 'không lưu', 'Tôi xác nhận lưu bản xem trước số 2', 'Tôi xác nhận lưu bản xem trước số 1?']) assert.equal(f.adapter.confirm({ text, binding: value.previewBinding, context: value.context }), false);
    f.rows.get('crmDataInputDrafts/d1/previews/p1').review.paymentAssertions = [{ actionId: 'payment' }];
    const payment = await f.resolve();
    assert.equal(f.adapter.confirm({ text: value.context.confirmationPolicy.phrase, binding: payment.previewBinding, context: payment.context }), false);
    assert.equal(f.adapter.confirm({ text: payment.context.confirmationPolicy.phrase, binding: payment.previewBinding, context: payment.context }), true);
    assert.equal(f.adapter.confirm({ text: payment.context.confirmationPolicy.phrase, binding: payment.previewBinding }), false);
});

test('exact English alternative retains revision, payment and server-derived wording', async () => {
    const f = setup(), plain = await f.resolve();
    const english = 'I confirm saving preview number 1';
    assert.equal(plain.context.confirmationPolicy.phraseEnglish, english);
    assert.match(plain.summary, /I confirm saving preview number 1/);
    assert.equal(f.adapter.confirm({ text: english + '.', binding: plain.previewBinding, context: plain.context }), true);
    for (const text of ['yes', 'I confirm saving preview number 2', english + '?', english + ' and I have received the listed payments', 'Do not save preview number 1']) {
        assert.equal(f.adapter.confirm({ text, binding: plain.previewBinding, context: plain.context }), false, text);
    }
    plain.context.confirmationPolicy.phraseEnglish = 'yes';
    assert.equal(f.adapter.confirm({ text: 'yes', binding: plain.previewBinding, context: plain.context }), false);
    f.rows.get('crmDataInputDrafts/d1/previews/p1').review.paymentAssertions = [{ actionId: 'payment' }];
    const paid = await f.resolve(), paidEnglish = english + ' and I have received the listed payments';
    assert.equal(paid.context.confirmationPolicy.phraseEnglish, paidEnglish);
    assert.equal(f.adapter.confirm({ text: paidEnglish, binding: paid.previewBinding, context: paid.context }), true);
    for (const text of [english, paidEnglish.replace('number 1', 'number 2'), english + ' and I will receive the listed payments']) {
        assert.equal(f.adapter.confirm({ text, binding: paid.previewBinding, context: paid.context }), false);
    }
    assert.equal(f.adapter.confirm({ text: paidEnglish, binding: paid.previewBinding, context: { ...paid.context, previewId: 'stale' } }), false);
    assert.equal(f.adapter.confirm({ text: paidEnglish, binding: null, context: paid.context }), false);
});
test('oversized context explicitly disables voice confirmation and foreign drafts are denied', async () => {
    const f = setup(); f.rows.get('crmDataInputDrafts/d1/previews/p1').review.effects[0].values.notes = 'x'.repeat(40000);
    const value = await f.resolve(); assert.equal(value.previewBinding, null); assert.equal(value.context.voiceConfirmationUnavailable, 'context-size');
    assert.ok(Buffer.byteLength(JSON.stringify(value.context)) <= 32768);
    await assert.rejects(f.adapter.resolveContext({ tx: f.transaction, actorUid: 'other', contextHints: { draftId: 'd1' } }), error => error.code === 'VOICE_DRAFT_FORBIDDEN');
});

test('exact current English cardinal forms preserve complete confirmation intent', async () => {
    const cases = [
        [0, ['zero']], [1, ['one']], [2, ['two']], [3, ['three']], [4, ['four']], [5, ['five']],
        [6, ['six']], [7, ['seven']], [8, ['eight']], [9, ['nine']], [10, ['ten']],
        [11, ['eleven']], [12, ['twelve']], [13, ['thirteen']], [14, ['fourteen']], [15, ['fifteen']],
        [16, ['sixteen']], [17, ['seventeen']], [18, ['eighteen']], [19, ['nineteen']],
        [20, ['twenty']], [21, ['twenty one', 'twenty-one']], [30, ['thirty']], [40, ['forty']],
        [50, ['fifty']], [60, ['sixty']], [70, ['seventy']], [80, ['eighty']], [90, ['ninety']],
        [99, ['ninety nine', 'ninety-nine']], [100, ['one hundred']],
        [101, ['one hundred one', 'one hundred and one']], [110, ['one hundred ten', 'one hundred and ten']],
        [115, ['one hundred fifteen', 'one hundred and fifteen']],
        [121, ['one hundred twenty one', 'one hundred twenty-one', 'one hundred and twenty one', 'one hundred and twenty-one']],
        [200, ['two hundred']], [300, ['three hundred']], [400, ['four hundred']], [500, ['five hundred']],
        [600, ['six hundred']], [700, ['seven hundred']], [800, ['eight hundred']], [900, ['nine hundred']],
        [999, ['nine hundred ninety nine', 'nine hundred ninety-nine', 'nine hundred and ninety nine', 'nine hundred and ninety-nine']]
    ];
    for (const [revision, forms] of cases) {
        const f = setup(revision), value = await f.resolve();
        const accepts = text => f.adapter.confirm({ text, binding: value.previewBinding, context: value.context });
        assert.equal(accepts(`I confirm saving preview number ${revision}`), true);
        for (const form of forms) {
            const phrase = `I confirm saving preview number ${form}`;
            assert.equal(accepts(phrase + '.'), true, phrase);
            for (const rejected of [phrase + '?', phrase + ' please', 'Do not ' + phrase, phrase + ' and cancel it', phrase.replace('I confirm', 'I might confirm')]) {
                assert.equal(accepts(rejected), false, rejected);
            }
        }
        assert.equal(accepts(`I confirm saving preview number ${revision + 1}`), false);
    }
});

test('cardinal confirmation rejects other revisions, non-cardinals and missing payment wording', async () => {
    const f = setup(21), plain = await f.resolve();
    const accepts = (text, value = plain) => f.adapter.confirm({ text, binding: value.previewBinding, context: value.context });
    for (const number of ['twenty two', 'two one', 'twenty-one point zero', 'twenty first', 'one hundred twenty one', 'twenty--one', 'twenty and one', '21 or 22']) {
        assert.equal(accepts(`I confirm saving preview number ${number}`), false, number);
    }
    f.rows.get('crmDataInputDrafts/d1/previews/p1').review.paymentAssertions = [{ actionId: 'payment' }];
    const paid = await f.resolve();
    const phrase = 'I confirm saving preview number twenty-one';
    const full = phrase + ' and I have received the listed payments';
    assert.equal(accepts(full, paid), true);
    assert.equal(accepts(full, plain), false);
    for (const text of [phrase, phrase + ' and received payments', full.replace('have received', 'will receive'), full.replace('twenty-one', 'twenty-two')]) {
        assert.equal(accepts(text, paid), false);
    }
    assert.equal(accepts(full, { ...paid, context: { ...paid.context, previewId: 'other' } }), false);
    paid.context.confirmationPolicy.phraseEnglish = 'yes';
    assert.equal(accepts('yes', paid), false);
    const large = setup(1000), value = await large.resolve();
    assert.equal(large.adapter.confirm({ text: 'I confirm saving preview number 1000', binding: value.previewBinding, context: value.context }), true);
    assert.equal(large.adapter.confirm({ text: 'I confirm saving preview number one thousand', binding: value.previewBinding, context: value.context }), false);
});
