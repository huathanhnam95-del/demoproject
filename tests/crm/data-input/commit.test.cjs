'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./transaction-fixture.cjs');
const { createConversationService } = require('../../../functions/src/crm/data-input/conversation-service');
const { createCommitService } = require('../../../functions/src/crm/data-input/commit-service');

async function setup(initial = {}, actions = [{ actionId: 'lead', kind: 'createLead', values: { name: 'Lan', source: 'facebook' } }]) {
    const state = { rows: new Map(Object.entries(initial)), versions: new Map(), counter: 1, allowed: true, now: 1800000000000, failReceipt: false };
    let queue = Promise.resolve();
    const db = { collection: fixture().db.collection, runTransaction(run) {
        const result = queue.then(async () => {
            const local = fixture(Object.fromEntries(state.rows)), baseGet = local.transaction.get, baseSet = local.transaction.set;
            local.transaction.get = async reference => {
                const value = await baseGet(reference);
                const version = snapshot => { if (snapshot.exists) snapshot.updateTime = { seconds: state.versions.get(snapshot.ref.path) || 1, nanoseconds: 0 }; };
                if (value.docs) value.docs.forEach(version); else version(value);
                return value;
            };
            local.transaction.set = (reference, value) => {
                if (state.failReceipt && reference.path.includes('/operations/')) throw new Error('Simulated receipt write failure');
                baseSet(reference, value);
            };
            const value = await run(local.transaction);
            for (const [kind, path] of local.calls) if (kind !== 'read') state.versions.set(path, ++state.counter);
            state.rows = local.rows;
            return value;
        });
        queue = result.catch(() => {});
        return result;
    } };
    const authorize = async ({ actorUid }) => state.allowed && actorUid === 'staff1';
    const conversations = createConversationService({ db, authorize, now: () => state.now });
    const service = createCommitService({ db, authorize, identity: { uid: 'staff1' }, now: () => state.now, publicOrigin: 'http://localhost:9000' });
    let draft = await conversations.create({ actorUid: 'staff1', requestId: 'r1' });
    draft = (await conversations.apply({ actorUid: 'staff1', draftId: draft.draftId, changes: { expectedRevision: 0, upserts: actions }, source: { kind: 'text', messageId: 'm1' }, text: 'Create these records' })).draft;
    const request = { actorUid: 'staff1', draftId: draft.draftId, expectedRevision: draft.revision, requestId: 'review1' };
    return { state, db, service, conversations, draft, request };
}
const confirm = (f, preview) => ({ actorUid: 'staff1', draftId: f.draft.draftId, previewId: preview.previewId, confirmationToken: preview.confirmationToken });

// Contract double for the separately owned shared confirmation service. It uses
// the same transaction; external consumer verification exercises the real service.
function voiceFixture(f, preview) {
    const stored = f.state.rows.get(`crmDataInputDrafts/${f.draft.draftId}/previews/${preview.previewId}`);
    const binding = { actorUid: 'staff1', feature: 'crm-data-input', draftId: f.draft.draftId, previewId: preview.previewId,
        revision: stored.revision, draftDigest: stored.draftDigest, expiresAtMs: stored.expiresAtMs };
    const attestationId = 'attestation-1', attestationPath = `crmAiVoiceAttestations/${attestationId}`;
    f.state.rows.set(attestationPath, { actorUid: 'staff1', binding, expiresAtMs: stored.expiresAtMs, consumedReceiptId: null });
    f.state.targetsAllowed = true;
    const voice = {
        authorizeTargets: async ({ tx, actorUid, receipt }) => {
            await tx.get(f.db.collection('users').doc(actorUid));
            if (!f.state.targetsAllowed) throw Object.assign(new Error('Target forbidden'), { code: 'VOICE_TARGET_FORBIDDEN' });
            if (receipt) f.state.replayTargetChecked = true;
        },
        confirmationService: { async prepareConsumption(tx, input) {
            const ref = f.db.collection('crmAiVoiceAttestations').doc(input.attestationId), snap = await tx.get(ref), record = snap.exists ? snap.data() : null;
            if (!record || record.actorUid !== input.actorUid || input.feature !== 'crm-data-input') throw Object.assign(new Error('Missing attestation'), { code: 'ATTESTATION_NOT_FOUND' });
            assert.deepEqual(input.binding, record.binding, 'Commit must supply the server-owned exact binding');
            if (record.consumedReceiptId !== null) {
                assert.equal(record.consumedReceiptId, input.receiptId);
                return { replayed: true, consume() {} };
            }
            if (record.expiresAtMs <= f.state.now) throw Object.assign(new Error('Expired attestation'), { code: 'STALE_ATTESTATION' });
            return { replayed: false, consume() {
                if (f.state.failConsume) throw new Error('Simulated attestation write failure');
                tx.set(ref, { ...record, consumedReceiptId: input.receiptId });
            } };
        } }
    };
    f.service = createCommitService({ db: f.db, authorize: async ({ actorUid }) => f.state.allowed && actorUid === 'staff1',
        identity: { uid: 'staff1' }, now: () => f.state.now, publicOrigin: 'http://localhost:9000', voice });
    return { binding, voice, attestationPath, request: { actorUid: 'staff1', draftId: f.draft.draftId, previewId: preview.previewId, voiceAttestationId: attestationId } };
}

test('voice confirmation is unavailable without its trusted adapters and cannot mix with a manual token', async () => {
    const f = await setup(), preview = await f.service.preview(f.request);
    await assert.rejects(f.service.commit({ actorUid: 'staff1', draftId: f.draft.draftId, previewId: preview.previewId, voiceAttestationId: 'attestation-1' }), error => error.code === 'VOICE_CONFIRMATION_UNAVAILABLE');
    const v = voiceFixture(f, preview);
    await assert.rejects(f.service.commit({ ...v.request, confirmationToken: preview.confirmationToken }), error => error.code === 'INVALID_CONFIRMATION');
    assert.equal([...f.state.rows.keys()].some(path => path.startsWith('crmLeads/')), false);
});

test('voice save atomically consumes its exact attestation and concurrent retries return one receipt', async () => {
    const f = await setup(), preview = await f.service.preview(f.request), v = voiceFixture(f, preview);
    const [receipt, retry] = await Promise.all([f.service.commit(v.request), f.service.commit(v.request)]);
    assert.deepEqual(retry, receipt);
    assert.equal([...f.state.rows.keys()].filter(path => path.startsWith('crmLeads/')).length, 1);
    assert.equal(f.state.rows.get(v.attestationPath).consumedReceiptId, receipt.operationId);
    const stored = f.state.rows.get(`crmDataInputDrafts/${f.draft.draftId}/operations/${preview.previewId}`);
    assert.deepEqual(stored.voiceConfirmation, { attestationId: v.request.voiceAttestationId, binding: v.binding });
    assert.equal(Object.hasOwn(receipt, 'voiceConfirmation'), false);
    f.state.now += 3600000;
    assert.deepEqual(await f.service.commit(v.request), receipt, 'consumed receipt replay survives preview expiry');
    assert.equal(f.state.replayTargetChecked, true);
    f.state.targetsAllowed = false;
    await assert.rejects(f.service.commit(v.request), error => error.code === 'VOICE_TARGET_FORBIDDEN');
    f.state.targetsAllowed = true; f.state.allowed = false;
    await assert.rejects(f.service.commit(v.request), error => error.code === 'FORBIDDEN');
});

test('receipt or attestation write failure rolls back all voice effects and leaves confirmation reusable', async () => {
    for (const failure of ['failReceipt', 'failConsume']) {
        const f = await setup(), preview = await f.service.preview(f.request), v = voiceFixture(f, preview);
        f.state[failure] = true;
        await assert.rejects(f.service.commit(v.request), /Simulated/);
        assert.equal(f.state.rows.get(v.attestationPath).consumedReceiptId, null);
        assert.equal([...f.state.rows.keys()].some(path => path.startsWith('crmLeads/') || path.includes('/operations/')), false);
        assert.equal(f.state.rows.get(`crmDataInputDrafts/${f.draft.draftId}`).status, 'review');
        f.state[failure] = false;
        assert.equal((await f.service.commit(v.request)).status, 'committed');
    }
});

test('status recovery and manual retry of a voice receipt retain current target checks', async () => {
    const f = await setup(), preview = await f.service.preview(f.request), v = voiceFixture(f, preview);
    const receipt = await f.service.commit(v.request);
    assert.deepEqual((await f.service.status({ actorUid: 'staff1', draftId: f.draft.draftId })).receipt, receipt);
    assert.deepEqual(await f.service.commit(confirm(f, preview)), receipt);
    f.state.targetsAllowed = false;
    await assert.rejects(f.service.status({ actorUid: 'staff1', draftId: f.draft.draftId }), error => error.code === 'VOICE_TARGET_FORBIDDEN');
    await assert.rejects(f.service.commit(confirm(f, preview)), error => error.code === 'VOICE_TARGET_FORBIDDEN');
});

test('voice receipt cannot be replayed with another attestation or a manual-only receipt', async () => {
    const f = await setup(), preview = await f.service.preview(f.request), v = voiceFixture(f, preview);
    await f.service.commit(v.request);
    await assert.rejects(f.service.commit({ ...v.request, voiceAttestationId: 'another' }), error => error.code === 'INVALID_CONFIRMATION');
    const manual = await setup(), shown = await manual.service.preview(manual.request), voice = voiceFixture(manual, shown);
    await manual.service.commit(confirm(manual, shown));
    await assert.rejects(manual.service.commit(voice.request), error => error.code === 'INVALID_CONFIRMATION');
    assert.equal(manual.state.rows.get(voice.attestationPath).consumedReceiptId, null);
});

test('voice rejects forged expired or unauthorized confirmation without consuming or saving', async () => {
    for (const mode of ['missing', 'expired', 'target', 'foreign']) {
        const f = await setup(), preview = await f.service.preview(f.request), v = voiceFixture(f, preview);
        if (mode === 'missing') f.state.rows.delete(v.attestationPath);
        if (mode === 'expired') f.state.rows.get(v.attestationPath).expiresAtMs = f.state.now;
        if (mode === 'target') f.state.targetsAllowed = false;
        if (mode === 'foreign') f.state.rows.get(v.attestationPath).actorUid = 'other';
        await assert.rejects(f.service.commit(v.request), error => ['ATTESTATION_NOT_FOUND', 'STALE_ATTESTATION', 'VOICE_TARGET_FORBIDDEN'].includes(error.code));
        assert.equal(f.state.rows.get(v.attestationPath)?.consumedReceiptId ?? null, null);
        assert.equal([...f.state.rows.keys()].some(path => path.startsWith('crmLeads/') || path.includes('/operations/')), false);
    }
});

test('changed CRM records invalidate voice save without consuming confirmation', async () => {
    const f = await setup({ 'crmStudents/s1': { name: 'Lan' } }, [{ actionId: 'update', kind: 'updateStudent', values: { studentId: 's1', name: 'Mai' } }]);
    const preview = await f.service.preview(f.request), v = voiceFixture(f, preview);
    f.state.rows.get('crmStudents/s1').name = 'Concurrent change'; f.state.versions.set('crmStudents/s1', 99);
    await assert.rejects(f.service.commit(v.request), error => error.code === 'STALE_RECORDS');
    assert.equal(f.state.rows.get(v.attestationPath).consumedReceiptId, null);
    assert.equal(f.state.rows.get('crmStudents/s1').name, 'Concurrent change');
});

test('spoken confirmation preserves explicit image-payment meaning acknowledgement', async () => {
    const f = await setup({ 'crmStudents/s1': { name: 'Lan' }, 'crmInvoices/i1': { studentId: 's1', amount: 10.25, netAmount: 10.25, currency: 'USD', status: 'open' } }, [{ actionId: 'pay', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 10.25 } }]);
    f.state.rows.get(`crmDataInputDrafts/${f.draft.draftId}`).actions[0].provenance.amount = { kind: 'image', messageId: 'image-1', attachmentId: 'a1' };
    const preview = await f.service.preview(f.request), v = voiceFixture(f, preview);
    await assert.rejects(f.service.commit(v.request), error => error.code === 'PAYMENT_ASSERTION_REQUIRED');
    assert.equal(f.state.rows.get(v.attestationPath).consumedReceiptId, null);
    const receipt = await f.service.commit({ ...v.request, paymentAcknowledgements: ['pay'] });
    assert.equal(f.state.rows.get(`crmPayments/${receipt.results.pay.paymentId}`).amount, 10.25);
});

test('review shows changed before and after values and field sources without hidden metadata', async () => {
    const f = await setup({ 'crmStudents/s1': { name: 'Lan', email: 'lan@example.test', crmId: 'A0001', targets: { exam: 'PTE', score: 65 }, deliveryToken: 'private-delivery' } }, [{ actionId: 'update', kind: 'updateStudent', values: { studentId: 's1', name: 'Mai', targets: { exam: 'PTE', score: 0 } } }]);
    const preview = await f.service.preview(f.request);
    const effect = preview.review.effects.find(item => item.entityType === 'student');
    assert.equal(effect.recordId, 's1'); assert.equal(effect.created, false);
    assert.deepEqual(effect.changes.find(change => change.field === 'name'), { field: 'name', beforePresent: true, before: 'Lan', afterPresent: true, after: 'Mai' });
    assert.equal(effect.changes.find(change => change.field === 'targets').before.score, 65);
    assert.equal(effect.changes.find(change => change.field === 'targets').after.score, 0);
    assert.equal(effect.changes.some(change => change.field === 'email'), false);
    assert.ok(preview.review.actions[0].sources.some(source => source.field === 'name' && source.kind === 'text'));
    assert.equal(JSON.stringify(preview.review).includes('private-delivery'), false);
    assert.equal(f.state.rows.get('crmStudents/s1').name, 'Lan');
});

test('manual correction of the last image-derived payment field cannot remove its assertion', async () => {
    const f = await setup({ 'crmStudents/s1': { name: 'Lan' }, 'crmInvoices/i1': { studentId: 's1', amount: 10.25, netAmount: 10.25, currency: 'USD', status: 'open' } }, [{ actionId: 'pay', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 10.25 } }]);
    f.state.rows.get(`crmDataInputDrafts/${f.draft.draftId}`).actions[0].provenance.amount = { kind: 'image', messageId: 'image-1', attachmentId: 'a1' };
    const { draft } = await f.conversations.apply({ actorUid: 'staff1', draftId: f.draft.draftId, changes: { expectedRevision: 1, upserts: [{ actionId: 'pay', values: { studentId: 's1', invoiceId: 'i1', amount: 10 } }] }, source: { kind: 'text', messageId: 'manual-1' }, text: 'Correct amount to ten' });
    assert.equal(draft.actions[0].provenance.amount.kind, 'text');
    const preview = await f.service.preview({ ...f.request, expectedRevision: draft.revision });
    assert.deepEqual(preview.review.paymentAssertions.map(item => item.actionId), ['pay']);
    await assert.rejects(f.service.commit(confirm(f, preview)), error => error.code === 'PAYMENT_ASSERTION_REQUIRED');
    assert.equal([...f.state.rows.keys()].some(path => path.startsWith('crmPayments/')), false);
    const receipt = await f.service.commit({ ...confirm(f, preview), paymentAcknowledgements: ['pay'] });
    assert.equal(receipt.status, 'committed');
});

test('image-related payments require explicit received-payment assertion before any business write', async () => {
    const f = await setup({ 'crmStudents/s1': { name: 'Lan' }, 'crmInvoices/i1': { studentId: 's1', amount: 10.25, netAmount: 10.25, currency: 'USD', status: 'open' } }, [{ actionId: 'pay', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 10.25 } }]);
    f.state.rows.get(`crmDataInputDrafts/${f.draft.draftId}`).actions[0].provenance.amount = { kind: 'image', messageId: 'image-message', attachmentId: 'a1' };
    const preview = await f.service.preview(f.request);
    assert.deepEqual(preview.review.paymentAssertions.map(item => item.actionId), ['pay']);
    for (const paymentAcknowledgements of [undefined, [], ['other'], ['pay', 'pay'], true]) {
        await assert.rejects(f.service.commit({ ...confirm(f, preview), paymentAcknowledgements }), error => error.code === 'PAYMENT_ASSERTION_REQUIRED');
        assert.equal([...f.state.rows.keys()].some(path => path.startsWith('crmPayments/')), false);
    }
    const receipt = await f.service.commit({ ...confirm(f, preview), paymentAcknowledgements: ['pay'] });
    assert.equal(f.state.rows.get(`crmPayments/${receipt.results.pay.paymentId}`).amount, 10.25);
    const stored = [...f.state.rows.entries()].find(([path]) => path.includes('/operations/'))[1];
    assert.deepEqual(stored.paymentAssertion.actionIds, ['pay']); assert.equal(stored.paymentAssertion.actorUid, 'staff1');
    assert.equal(stored.paymentAssertion.meaning, 'received-payment-v1');
    assert.deepEqual(await f.service.commit(confirm(f, preview)), receipt, 'receipt retry does not request a new assertion');
});

test('image provenance on a referenced invoice also requires payment meaning confirmation', async () => {
    const f = await setup({ 'crmStudents/s1': { name: 'Lan' } }, [
        { actionId: 'invoice', kind: 'createInvoice', values: { studentId: 's1', amount: 100 } },
        { actionId: 'pay', kind: 'recordPayment', values: { studentId: 's1', invoiceId: { $ref: 'invoice.invoiceId' }, amount: 100 } }
    ]);
    f.state.rows.get(`crmDataInputDrafts/${f.draft.draftId}`).actions[0].provenance.amount = { kind: 'image', messageId: 'm2', attachmentId: 'a1' };
    const preview = await f.service.preview(f.request);
    assert.deepEqual(preview.review.paymentAssertions.map(item => item.actionId), ['pay']);
});

test('student navigation survives immutable receipt replay and recovery', async () => {
    const f = await setup({}, [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan' } }]);
    const preview = await f.service.preview(f.request);
    const receipt = await f.service.commit(confirm(f, preview));
    assert.equal(receipt.results.student.studentLink, '/crm-admin#students/a0001');
    assert.equal(f.state.rows.get(`crmStudents/${receipt.results.student.studentId}`).crmId, 'a0001');
    assert.deepEqual(await f.service.commit(confirm(f, preview)), receipt);
    assert.deepEqual((await f.service.status({ actorUid: 'staff1', draftId: f.draft.draftId })).receipt, receipt);
});

test('preview writes only review state and exposes canonical effects without test secrets', async () => {
    const f = await setup();
    const preview = await f.service.preview(f.request);
    assert.equal([...f.state.rows.keys()].some(path => path.startsWith('crmLeads/')), false);
    assert.ok(preview.review.effects.some(effect => effect.entityType === 'lead' && effect.values.name === 'Lan'));
    assert.equal(preview.testTokens, undefined);
    assert.deepEqual(await f.service.preview(f.request), preview);
});

test('confirmation commits business records and one receipt; exact retries return the original result', async () => {
    const f = await setup(), preview = await f.service.preview(f.request);
    const first = await f.service.commit(confirm(f, preview));
    const replay = await f.service.commit(confirm(f, preview));
    assert.deepEqual(replay, first); assert.equal(first.status, 'committed');
    assert.equal([...f.state.rows.keys()].filter(path => path.startsWith('crmLeads/')).length, 1);
    assert.equal([...f.state.rows.keys()].filter(path => path.includes('/operations/')).length, 1);
    const status = await f.service.status({ actorUid: 'staff1', draftId: f.draft.draftId });
    assert.deepEqual(status.receipt, first);
});

test('corrections invalidate confirmation while preserving the revised draft', async () => {
    const f = await setup(), preview = await f.service.preview(f.request);
    await f.conversations.apply({ actorUid: 'staff1', draftId: f.draft.draftId, changes: { expectedRevision: 1, upserts: [{ actionId: 'lead', values: { name: 'Mai' } }] }, source: { kind: 'text', messageId: 'm2' }, text: 'Change name to Mai' });
    await assert.rejects(f.service.commit(confirm(f, preview)), error => error.code === 'STALE_PREVIEW');
    assert.equal((await f.conversations.load({ actorUid: 'staff1', draftId: f.draft.draftId })).draft.actions[0].values.name, 'Mai');
});

test('record version changes require another review even when resulting writes would be unchanged', async () => {
    const f = await setup({ 'crmStudents/s1': { name: 'Lan' } }, [{ actionId: 'invoice', kind: 'createInvoice', values: { studentId: 's1', amount: 100 } }]);
    const preview = await f.service.preview(f.request);
    f.state.versions.set('crmStudents/s1', 99);
    await assert.rejects(f.service.commit(confirm(f, preview)), error => error.code === 'STALE_RECORDS');
    assert.equal([...f.state.rows.keys()].some(path => path.startsWith('crmInvoices/')), false);
});

test('wrong tokens, expired reviews and revoked admission never authorize a commit', async () => {
    const f = await setup(), preview = await f.service.preview(f.request);
    await assert.rejects(f.service.commit({ ...confirm(f, preview), confirmationToken: 'wrong-token' }), error => error.code === 'INVALID_CONFIRMATION');
    f.state.allowed = false;
    await assert.rejects(f.service.commit(confirm(f, preview)), error => error.code === 'FORBIDDEN');
    f.state.allowed = true; f.state.now = preview.expiresAtMs;
    await assert.rejects(f.service.commit(confirm(f, preview)), error => error.code === 'PREVIEW_EXPIRED');
});

test('concurrent confirmations produce one save and the same durable receipt', async () => {
    const f = await setup(), preview = await f.service.preview(f.request);
    const [a, b] = await Promise.all([f.service.commit(confirm(f, preview)), f.service.commit(confirm(f, preview))]);
    assert.deepEqual(a, b);
    assert.equal([...f.state.rows.keys()].filter(path => path.startsWith('crmLeads/')).length, 1);
});

test('receipt failure rolls back every business write and leaves confirmation retryable', async () => {
    const f = await setup(), preview = await f.service.preview(f.request);
    f.state.failReceipt = true;
    await assert.rejects(f.service.commit(confirm(f, preview)), /receipt write failure/);
    assert.equal([...f.state.rows.keys()].some(path => path.startsWith('crmLeads/')), false);
    f.state.failReceipt = false;
    assert.equal((await f.service.commit(confirm(f, preview))).status, 'committed');
});
