'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const browser = { window: {}, crypto: globalThis.crypto };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/data-input/client.js'), 'utf8'), browser);
const { createClient } = browser.window.CrmDataInputClient;
function setup() {
    const store = new Map(), state = { uid: 'staff1', draft: null, calls: [], loseCommit: false, committed: false };
    let serial = 0;
    const storage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
    const request = async (url, options = {}) => {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || null;
        state.calls.push({ url, method: options.method || 'GET', body });
        if (url.endsWith('/capabilities')) return { drafts: true, interpretation: true, attachments: true, imageInterpretation: state.imageSupport === true, budget: true, voice: state.voiceSupport === true, voiceRelayUrl: state.voiceSupport ? 'http://127.0.0.1:9271' : null };
        if (url.endsWith('/voice-context')) return { summary: 'Review one', confirmationPhrase: 'Tôi xác nhận lưu bản xem trước số 1', previewBinding: { actorUid: state.uid, draftId: state.draft.draftId, previewId: 'p1', revision: state.draft.revision, feature: 'crm-data-input' } };
        if (url.endsWith('/attachments')) return { revision: state.draft.revision, attachments: state.attachments || [] };
        if (/\/attachments\/[^/]+$/.test(url)) {
            if (options.method === 'POST') {
                state.uploadRequests = (state.uploadRequests || 0) + 1;
                if (!state.attachments?.length) { state.attachments = [{ attachmentId: url.split('/').at(-1), status: 'ready', mimeType: 'image/png' }]; state.draft.revision += 2; }
                if (state.loseUpload) throw Error('Upload response lost');
                return { attachment: state.attachments[0], draft: state.draft };
            }
            return new Blob(['pixels'], { type: 'image/png' });
        }
        if (url.endsWith('/lookups')) return { revision: state.draft.revision, queries: [] };
        if (url.endsWith('/interpretations') && options.method === 'POST') {
            state.interpretation = { messageId: body.messageId, text: body.text, status: state.interpretationStatus || 'done' };
            if (state.loseInterpretation) throw new Error('Interpretation response lost');
            return state.interpretation;
        }
        if (url.includes('/interpretations/') && url.endsWith('/apply')) {
            if (state.interpretation.status !== 'applied') { state.draft.revision++; state.draft.actions = [action]; state.interpretation.status = 'applied'; state.interpretation.appliedRevision = state.draft.revision; }
            if (state.loseApplication) throw new Error('Application response lost');
            return { ...state.interpretation, draft: state.draft };
        }
        if (url.includes('/interpretations/')) return state.interpretation;
        if (url.endsWith('/conversations') && options.method === 'POST') return (state.draft ||= { draftId: 'd1', actorUid: state.uid, revision: 0, status: 'draft', actions: [] });
        if (options.method === 'PATCH') { state.draft = { ...state.draft, revision: state.draft.revision + 1, actions: body.changes.upserts, status: 'draft' }; return { draft: state.draft }; }
        if (url.endsWith('/preview')) return { previewId: 'p1', confirmationToken: 'secret-confirmation-token', review: { effects: [], paymentAssertions: state.paymentAssertions || [] }, expiresAtMs: Date.now() + 10000 };
        if (url.endsWith('/commit')) { state.committed = true; state.draft.status = 'committed'; if (state.loseCommit) throw new Error('Connection lost'); return { status: 'committed', operationId: 'p1', results: {} }; }
        if (url.endsWith('/operation')) return { status: state.committed ? 'committed' : 'review', receipt: state.committed ? { status: 'committed', operationId: 'p1', results: {} } : null };
        return { draft: structuredClone(state.draft), messages: [] };
    };
    const options = { request, getUid: () => state.uid, storage, createId: () => `id-${++serial}` };
    return { state, store, options, client: createClient(options) };
}
const action = { actionId: 'lead', kind: 'createLead', values: { name: 'Lan', source: 'facebook' } };

async function reviewedRecovery({ mutateLoad, rejectPreview, changeActor } = {}) {
    const f = setup(); f.state.voiceSupport = true;
    await f.client.capabilities(); await f.client.edit([action]); await f.client.review();
    f.state.draft.status = 'review'; f.state.draft.expiresAtMs = Date.now() + 60000;
    let reads = 0;
    const client = createClient({ ...f.options, request: async (url, options) => {
        if (url.endsWith('/preview')) {
            f.state.calls.push({ url, method: options.method, body: JSON.parse(options.body) });
            if (rejectPreview) throw Object.assign(new Error(rejectPreview), { status: 409 });
            if (changeActor) f.state.uid = 'staff2';
            return { previewId: 'fresh-preview', confirmationToken: 'fresh-secret', review: { effects: [action] }, expiresAtMs: Date.now() + 60000 };
        }
        if (url.endsWith('/voice-context')) {
            const body = JSON.parse(options.body); f.state.calls.push({ url, body });
            return { confirmationPhrase: 'Confirm the fresh preview', previewBinding: { actorUid: 'staff1', draftId: 'd1', revision: f.state.draft.revision, previewId: body.previewId } };
        }
        const result = await f.options.request(url, options);
        if (url.endsWith('/conversations/d1')) { reads++; mutateLoad?.(result, reads); }
        return result;
    } });
    await client.capabilities(); f.state.calls.length = 0;
    return { ...f, client };
}

test('resume restores an unchanged server review after attachments with fresh confirmation and no provider or save', async () => {
    const f = await reviewedRecovery();
    await f.client.resume();
    assert.equal(f.client.getState().preview.confirmationToken, 'fresh-secret');
    assert.equal(f.client.getVoiceHints().previewId, 'fresh-preview');
    assert.equal(f.client.getState().voiceContext.confirmationPhrase, 'Confirm the fresh preview');
    const calls = f.state.calls;
    assert.deepEqual(calls.map(call => call.url.split('/').at(-1)), ['d1', 'd1', 'attachments', 'preview', 'voice-context']);
    const preview = calls[3].body;
    assert.equal(preview.expectedRevision, 1); assert.notEqual(preview.requestId, 'id-3');
    assert.equal([...f.store.values()].some(value => /fresh-secret|fresh-preview/.test(value)), false);
    f.state.calls.length = 0;
    await f.client.refreshAttachments();
    assert.deepEqual(f.state.calls.map(call => call.url.split('/').at(-1)), ['d1', 'attachments', 'preview', 'voice-context']);
    assert.notEqual(f.state.calls[2].body.requestId, preview.requestId);
    assert.equal(f.client.getVoiceHints().previewId, 'fresh-preview');
});

for (const condition of ['draft', 'committed', 'cancelled', 'expired', 'changed revision', 'changed values', 'pending upload', 'pending interpretation']) {
    test(`resume does not restore confirmation for ${condition}`, async () => {
        const f = await reviewedRecovery({ mutateLoad(result, reads) {
            if (condition === 'expired') result.expired = true;
            if (['draft', 'committed', 'cancelled'].includes(condition)) result.draft.status = condition;
            if (reads === 2 && condition === 'changed revision') result.draft.revision++;
            if (reads === 2 && condition === 'changed values') result.draft.actions[0].values.name = 'Different';
        } });
        if (condition === 'pending upload' || condition === 'pending interpretation') {
            const pointer = JSON.parse(f.store.get('crm-data-input:staff1'));
            if (condition === 'pending upload') pointer.pendingAttachmentId = 'pending-image';
            else { pointer.interpretationMessageId = 'pending-message'; f.state.interpretation = { messageId: 'pending-message', status: 'running' }; }
            f.store.set('crm-data-input:staff1', JSON.stringify(pointer));
            f.state.uid = 'other'; f.client.refreshIdentity(); f.state.uid = 'staff1';
            await f.client.capabilities();
        }
        await f.client.resume();
        assert.equal(f.client.getState().preview, null); assert.equal(f.client.getState().voiceContext, null);
        assert.equal(f.state.calls.some(call => call.url.endsWith('/preview')), false);
        assert.equal(f.state.calls.some(call => call.url.endsWith('/commit')), false);
    });
}

for (const error of ['FORBIDDEN', 'REVISION_CONFLICT', 'DRAFT_UNAVAILABLE']) {
    test(`server ${error} during review recovery leaves confirmation unavailable`, async () => {
        const f = await reviewedRecovery({ rejectPreview: error });
        await assert.rejects(f.client.resume(), new RegExp(error));
        assert.equal(f.client.getState().preview, null); assert.equal(f.client.getState().voiceContext, null);
        assert.equal(f.state.calls.some(call => /voice-context|commit$/.test(call.url)), false);
    });
}

test('late recovered preview cannot cross an account change', async () => {
    const f = await reviewedRecovery({ changeActor: true });
    await assert.rejects(f.client.resume(), /account changed/);
    assert.equal(f.client.getState().uid, 'staff2'); assert.equal(f.client.getState().preview, null);
    assert.equal(f.client.getState().voiceContext, null);
});

for (const condition of ['changed', 'expired', 'committed', 'pending save']) {
    test(`attachment refresh clears old confirmation without restoring it for ${condition}`, async () => {
        const f = await reviewedRecovery(); await f.client.resume();
        if (condition === 'changed') { f.state.draft.revision++; f.state.draft.status = 'draft'; }
        if (condition === 'expired') f.state.draft.expiresAtMs = Date.now() - 1;
        if (condition === 'committed') f.state.draft.status = 'committed';
        if (condition === 'pending save') {
            f.state.loseCommit = true;
            await assert.rejects(f.client.commit(), /Connection lost/);
            // The receipt remains uncertain locally even if a later draft read is review.
            f.state.draft.status = 'review';
        }
        f.state.calls.length = 0;
        const result = await f.client.refreshAttachments();
        assert.equal(result.attachments.length, 0);
        assert.equal(f.client.getState().preview, null); assert.equal(f.client.getState().voiceContext, null);
        assert.deepEqual(f.state.calls.map(call => call.url.split('/').at(-1)), ['d1', 'attachments']);
        if (condition === 'pending save') assert.equal(f.client.getState().pendingSave, true);
    });
}

test('voice commit submits only opaque attestation for the current displayed review and preserves payment acknowledgement', async () => {
    const f = setup(); f.state.voiceSupport = true; f.state.paymentAssertions = [{ actionId: 'pay' }];
    await f.client.capabilities(); await f.client.edit([action]); await f.client.review();
    assert.equal(f.client.getVoiceHints().previewId, 'p1');
    assert.match(f.client.getState().voiceContext.confirmationPhrase, /1/);
    const receipt = await f.client.commitVoice({ attestationId: 'attestation-secret', sessionId: 'session-1', epoch: 1, utteranceId: 'u1' }, { actorUid: 'staff1' });
    assert.equal(receipt.status, 'committed');
    const sent = f.state.calls.find(call => call.url.endsWith('/commit')).body;
    assert.deepEqual(sent, { previewId: 'p1', voiceAttestationId: 'attestation-secret', paymentAcknowledgements: ['pay'] });
    assert.equal([...f.store.values()].some(value => value.includes('attestation-secret')), false);
});

test('voice save cannot use a stale review or changed actor and uncertain saves recover without replay', async () => {
    const f = setup(); f.state.voiceSupport = true;
    await f.client.capabilities(); await f.client.edit([action]); await f.client.review();
    const proof = { attestationId: 'a1', sessionId: 's1', epoch: 1, utteranceId: 'u1' };
    await assert.rejects(f.client.commitVoice(proof, { actorUid: 'other' }), /account|identity/i);
    await f.client.edit([action]); assert.equal(f.client.getVoiceHints().previewId, undefined);
    await assert.rejects(f.client.commitVoice(proof, { actorUid: 'staff1' }), /review/i);
    await f.client.review(); f.state.loseCommit = true;
    await assert.rejects(f.client.commitVoice(proof, { actorUid: 'staff1' }), /lost/);
    assert.equal(f.client.getState().pendingSave, true);
    await assert.rejects(f.client.commitVoice(proof, { actorUid: 'staff1' }), /status/i);
    assert.equal(f.state.calls.filter(call => call.url.endsWith('/commit')).length, 1);
    const resumed = createClient(f.options); await resumed.resume();
    assert.equal(resumed.getState().receipt.status, 'committed'); assert.equal(f.state.calls.filter(call => call.url.endsWith('/commit')).length, 1);
});

test('selected-image interpretation requires capability and recovers after reload without resending', async () => {
    const f = setup(); await f.client.capabilities();
    await f.client.uploadAttachment(new Blob(['pixels'], { type: 'image/png' }));
    const id = f.client.getState().attachments[0].attachmentId;
    await assert.rejects(f.client.interpret('Use this name', [], id), /unavailable/i);
    f.state.imageSupport = true; await f.client.capabilities();
    await assert.rejects(f.client.interpret('Use this name', [], 'foreign'), /image/i);
    f.state.loseInterpretation = true;
    await assert.rejects(f.client.interpret('Use this name', [], id), /lost/);
    const sends = () => f.state.calls.filter(call => call.url.endsWith('/interpretations') && call.method === 'POST');
    assert.equal(sends().length, 1); assert.equal(sends()[0].body.attachmentId, id);
    const resumed = createClient(f.options); await resumed.capabilities(); await resumed.resume();
    assert.equal(resumed.getState().interpretation.status, 'applied'); assert.equal(sends().length, 1);
});

test('image upload sends binary bytes and reload recovers the original identity without another upload', async () => {
    const f = setup(); await f.client.capabilities(); f.state.loseUpload = true;
    const blob = new Blob(['pixels'], { type: 'image/png' });
    await assert.rejects(f.client.uploadAttachment(blob), /lost/);
    assert.ok(f.client.getState().pendingAttachment);
    await assert.rejects(f.client.interpret('Use the image'), /upload/i);
    assert.equal([...f.store.values()].some(value => value.includes('pixels')), false);
    const resumed = createClient(f.options); await resumed.capabilities(); await resumed.resume();
    assert.equal(resumed.getState().pendingAttachment, null); assert.equal(resumed.getState().attachments.length, 1);
    assert.equal(f.state.uploadRequests, 1);
    const image = await resumed.readAttachment(resumed.getState().attachments[0].attachmentId);
    assert.equal(await image.text(), 'pixels');
});

test('an upload absent from an early status response retains its identity for a same-file retry', async () => {
    const f = setup(); f.state.loseUpload = true;
    const blob = new Blob(['pixels'], { type: 'image/png' });
    await assert.rejects(f.client.uploadAttachment(blob));
    const id = f.client.getState().pendingAttachment.attachmentId;
    f.state.attachments = [];
    await f.client.refreshAttachments();
    assert.equal(f.client.getState().pendingAttachment.attachmentId, id);
    f.state.loseUpload = false; await f.client.uploadAttachment(blob);
    assert.equal(f.client.getState().attachments[0].attachmentId, id);
});

test('lookup refinements and selections travel with the current revision and clear after application', async () => {
    const f = setup(); await f.client.interpret('Find Lan');
    const selections = [{ lookupIndex: 0, match: { field: 'email', value: 'lan@example.test' }, id: 's2' }];
    await f.client.lookups(selections);
    assert.equal(f.client.getState().lookups.revision, 1);
    assert.deepEqual(f.state.calls.at(-1).body, { expectedRevision: 1, selections });
    await f.client.interpret('Continue', selections);
    assert.deepEqual(f.state.calls.findLast(call => call.url.endsWith('/interpretations')).body.selections, selections);
    assert.equal(f.client.getState().lookups, null);
    assert.equal([...f.store.values()].some(value => value.includes('lan@example.test')), false);
});

test('typed interpretation applies a draft and records its message without committing business data', async () => {
    const f = setup(); await f.client.capabilities(); await f.client.interpret('Add Lan');
    assert.equal(f.client.getState().draft.actions[0].values.name, 'Lan');
    assert.equal(f.client.getState().messages[0].text, 'Add Lan');
    assert.equal(f.client.getState().interpretation.status, 'applied');
    assert.equal(f.state.committed, false);
    assert.equal([...f.store.values()].join('').includes('Add Lan'), false);
});

test('reload recovers a lost interpretation response without another provider request', async () => {
    const f = setup(); f.state.loseInterpretation = true;
    await assert.rejects(f.client.interpret('Add Lan'), /response lost/);
    const recovered = createClient(f.options); await recovered.resume();
    assert.equal(recovered.getState().interpretation.status, 'applied');
    assert.equal(recovered.getState().draft.revision, 1);
    assert.equal(f.state.calls.filter(call => call.url.endsWith('/interpretations') && call.method === 'POST').length, 1);
});

test('application-response recovery does not apply the draft twice', async () => {
    const f = setup(); f.state.loseApplication = true;
    await assert.rejects(f.client.interpret('Add Lan'), /response lost/);
    f.state.loseApplication = false;
    await f.client.recoverInterpretation();
    assert.equal(f.client.getState().draft.revision, 1);
    assert.equal(f.client.getState().messages.length, 1);
});

test('uncertain interpretation blocks another request and final review until recovered', async () => {
    const f = setup(); f.state.interpretationStatus = 'unknown';
    await f.client.interpret('Add Lan');
    await assert.rejects(f.client.interpret('Try again'), /interpretation/i);
    await assert.rejects(f.client.review(), /interpretation/i);
    assert.equal(f.state.calls.filter(call => call.url.endsWith('/interpretations') && call.method === 'POST').length, 1);
});

test('late interpretation errors cannot alter the newly signed-in account state', async () => {
    const f = setup(); let rejectRequest;
    const client = createClient({ ...f.options, request: (url, options) => url.endsWith('/interpretations') ? new Promise((_resolve, reject) => { rejectRequest = reject; }) : f.options.request(url, options) });
    await client.edit([action]);
    const pending = client.interpret('Add Lan');
    while (!rejectRequest) await new Promise(resolve => setImmediate(resolve));
    f.state.uid = 'staff2'; client.refreshIdentity();
    rejectRequest(Object.assign(new Error('Old account request failed'), { status: 503 }));
    await assert.rejects(pending);
    assert.equal(client.getState().uid, 'staff2'); assert.equal(client.getState().interpretation, null);
});

test('client retains only conversation identity and resumes a saved draft', async () => {
    const f = setup();
    await f.client.edit([action], [], 'Add Lan');
    const other = createClient(f.options);
    await other.resume();
    assert.equal(other.getState().draft.actions[0].values.name, 'Lan');
    const stored = [...f.store.values()].join('');
    assert.equal(stored.includes('Lan'), false);
    await f.client.review();
    assert.equal([...f.store.values()].join('').includes('secret-confirmation-token'), false);
});

test('edits invalidate the local review and save requires a fresh server review', async () => {
    const f = setup(); await f.client.edit([action]); await f.client.review();
    await f.client.edit([{ ...action, values: { ...action.values, name: 'Mai' } }]);
    assert.equal(f.client.getState().preview, null);
    await assert.rejects(f.client.commit(), /review/i);
    assert.equal(f.state.calls.some(call => call.url.endsWith('/commit')), false);
});

test('a lost save response is recovered from the receipt without a second commit', async () => {
    const f = setup(); await f.client.edit([action]); await f.client.review();
    f.state.loseCommit = true;
    await assert.rejects(f.client.commit(), /Connection lost/);
    assert.equal(f.client.getState().pendingSave, true);
    await assert.rejects(f.client.edit([action]), /save status/i);
    await f.client.recover();
    assert.equal(f.client.getState().receipt.operationId, 'p1');
    assert.equal(f.state.calls.filter(call => call.url.endsWith('/commit')).length, 1);
});

test('payment assertions require exact explicit action selection and are not persisted locally', async () => {
    const f = setup(); f.state.paymentAssertions = [{ actionId: 'pay', meaning: 'received-payment-v1', statement: 'Confirm received payment' }];
    await f.client.edit([action]); await f.client.review();
    for (const selected of [undefined, [], ['other'], ['pay', 'pay']]) await assert.rejects(f.client.commit(selected), /payment/i);
    assert.equal(f.state.calls.filter(call => call.url.endsWith('/commit')).length, 0);
    await f.client.commit(['pay']);
    const sent = f.state.calls.find(call => call.url.endsWith('/commit'));
    assert.deepEqual(sent.body.paymentAcknowledgements, ['pay']);
    assert.ok([...f.store.values()].every(value => !value.includes('paymentAcknowledgements')));
});

test('account changes discard late responses before they reach state or storage', async () => {
    const f = setup(); let finish;
    const client = createClient({ ...f.options, request: () => new Promise(resolve => { finish = resolve; }) });
    const pending = client.edit([action]);
    f.state.uid = 'staff2';
    finish({ draftId: 'private-draft', actorUid: 'staff1', revision: 0, status: 'draft', actions: [] });
    await assert.rejects(pending, /account/i);
    assert.equal(client.getState().uid, 'staff2');
    assert.equal(client.getState().draft, null);
    assert.equal([...f.store.values()].some(value => value.includes('private-draft')), false);
});

test('simultaneous client mutations are blocked while a request is in flight', async () => {
    const f = setup(); let finish;
    const client = createClient({ ...f.options, request: () => new Promise(resolve => { finish = resolve; }) });
    const first = client.resume();
    await first; // No stored draft means no request.
    const active = client.review();
    await assert.rejects(client.edit([action]), /progress/i);
    finish({ draftId: 'd1', actorUid: 'staff1', revision: 0, status: 'draft', actions: [] });
    // Complete the subsequent preview request.
    await new Promise(resolve => setImmediate(resolve));
    finish({ previewId: 'p1', confirmationToken: 'token', review: { effects: [] } });
    await active;
});

test('a lost edit response reuses its message identity and restores the missing transcript row', async () => {
    const f = setup(); let saved, firstMessage;
    const client = createClient({ ...f.options, request: async (url, options) => {
        if (options.method !== 'PATCH') return f.options.request(url, options);
        const body = JSON.parse(options.body);
        if (saved) { assert.equal(body.messageId, firstMessage); return { ...saved, replayed: true }; }
        firstMessage = body.messageId; saved = await f.options.request(url, options); throw new Error('Lost edit response');
    } });
    await assert.rejects(client.edit([action], [], 'Add Lan'), /Lost edit response/);
    await client.edit([action], [], 'Add Lan');
    assert.equal(client.getState().draft.revision, 1);
    assert.equal(client.getState().messages.length, 1);
    assert.equal(client.getState().messages[0].text, 'Add Lan');
});
