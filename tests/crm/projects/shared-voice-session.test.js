'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceSessionService } = require('../../../functions/src/ai-assistance/voice/session-service');
const { createVoiceConfirmationService } = require('../../../functions/src/ai-assistance/voice/confirmation-service');
const { AI_VOICE_COLLECTIONS: C } = require('../../../functions/src/ai-assistance/collections');
function fixture() {
    const rows = new Map(); const state = { at: 1800000000000, allowed: true, revision: 1, preview: true }; let queue = Promise.resolve();
    const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }) };
    const runTransaction = fn => { const result = queue.then(async () => { const pending = new Map(); let writes = false; const tx = {
        async get(ref) { assert.equal(writes, false, 'all transaction reads precede staged writes'); return { exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)) }; },
        set(ref, value) { writes = true; pending.set(ref.path, structuredClone(value)); }, create(ref, value) { assert.equal(rows.has(ref.path), false); this.set(ref, value); }
    }; const result = await fn(tx); for (const entry of pending) rows.set(...entry); return result; }); queue = result.catch(() => {}); return result; };
    const binding = feature => ({ actorUid: 'staff', feature, draftId: 'draft', previewId: `preview-${state.revision}`, revision: state.revision, draftDigest: `digest-${state.revision}`, expiresAtMs: 1800001000000, projectId: 'project', revisionFences: { membership: 1 } });
    const adapter = feature => ({ authorize: async ({ tx, actorUid }) => { assert.ok(tx); return state.allowed && actorUid === 'staff'; }, resolveContext: async () => ({ summary: state.summary || 'Create the reviewed record.', previewBinding: state.preview ? binding(feature) : null, context: { secretInternalData: 'do not expose', revision: state.revision } }), confirm: ({ text }) => text === 'I confirm this exact preview and required acknowledgements.' });
    const options = { db, runTransaction, now: () => state.at, featureAdapters: { projects: adapter('projects'), 'crm-data-input': adapter('crm-data-input') }, engineeringMode: true };
    return { rows, state, options, binding, runTransaction, service: createVoiceSessionService(options) };
}
const prepare = { actorUid: 'staff', feature: 'projects', requestId: 'request', contextHints: { projectId: 'project' } };
async function connected(f) { const ticket = await f.service.prepare(prepare); const identity = { actorUid: 'staff', feature: 'projects', sessionId: ticket.sessionId }; const claim = { ...identity, ticket: ticket.ticket, connectionId: 'connection' }; const status = await f.service.claim(claim); return { ticket, identity, claim, status, channel: f.service.providerChannel({ ...identity, epoch: status.epoch }) }; }
const begin = { utteranceId: 'utterance', eventId: 'begin', source: 'user_audio' };
const final = { ...begin, eventId: 'final', final: true, text: 'I confirm this exact preview and required acknowledgements.', audioEvidence: { audioDigest: 'a'.repeat(64), durationMs: 1500 } };
test('native final requires and persists exact captured-audio transcription provenance', async () => {
    const f = fixture(); f.service = createVoiceSessionService({ ...f.options, engineeringMode: false, nativeMode: true });
    const c = await connected(f); assert.equal(c.ticket.engineeringOnly, false); await c.channel.beginUtterance(begin);
    await assert.rejects(c.channel.finalizeUtterance(final));
    const transcription = { model: 'gemini-3.8-flash', responseId: 'response', responseDigest: 'b'.repeat(64), audioDigest: 'a'.repeat(64), reservationId: 'reservation', finishReason: 'STOP', source: 'captured_user_audio' };
    await assert.rejects(c.channel.finalizeUtterance({ ...final, audioEvidence: { ...final.audioEvidence, transcription: { ...transcription, audioDigest: 'c'.repeat(64) } } }), { code: 'UNTRUSTED_UTTERANCE' });
    const proof = await c.channel.finalizeUtterance({ ...final, audioEvidence: { ...final.audioEvidence, transcription } });
    const utterance = [...f.rows.values()].find(row => row.state === 'final'); assert.deepEqual(utterance.audioEvidence.transcription, transcription);
    assert.equal(f.rows.get(`${C.attestations}/${proof.attestationId}`).engineeringOnly, false);
});
async function attested(f) { const c = await connected(f); await c.channel.beginUtterance(begin); const proof = await c.channel.finalizeUtterance(final); return { ...c, proof }; }

test('native prepare fails closed after current authorization; tickets hashed and claimed once across instances', async () => {
    const f = fixture(), native = createVoiceSessionService({ ...f.options, engineeringMode: false });
    f.state.allowed = false; await assert.rejects(native.prepare(prepare), e => e.code === 'VOICE_FORBIDDEN'); f.state.allowed = true;
    await assert.rejects(native.prepare(prepare), e => e.code === 'NATIVE_VOICE_UNAVAILABLE');
    const c = await connected(f); assert.ok(!JSON.stringify([...f.rows.values()]).includes(c.ticket.ticket)); assert.ok(!JSON.stringify(c.status).includes('secretInternalData'));
    const second = createVoiceSessionService(f.options); assert.equal((await second.claim(c.claim)).replayed, true);
    await assert.rejects(second.claim({ ...c.claim, connectionId: 'other' }), e => e.code === 'TICKET_CONSUMED');
    const replay = await second.prepare(prepare); assert.equal(replay.ticket, null); assert.equal(replay.replayed, true);
    f.state.allowed = false; await assert.rejects(second.claim(c.claim), e => e.code === 'VOICE_FORBIDDEN'); await assert.rejects(second.prepare(prepare), e => e.code === 'VOICE_FORBIDDEN');
});

test('status reconnect performs no effects; actor feature epoch and expiry fences hold', async () => {
    const f = fixture(), c = await connected(f), before = structuredClone([...f.rows]);
    await f.service.readStatus(c.identity); assert.deepEqual([...f.rows], before);
    for (const patch of [{ actorUid: 'other' }, { feature: 'crm-data-input' }]) await assert.rejects(f.service.readStatus({ ...c.identity, ...patch }), e => e.code === 'SESSION_NOT_FOUND');
    for (const epoch of [undefined, 0, 2]) await assert.rejects(f.service.updateContext({ ...c.identity, epoch, contextHints: {} }), e => e.code === 'STALE_EPOCH');
    await f.service.close({ ...c.identity, epoch: 1 }); assert.equal((await f.service.close({ ...c.identity, epoch: 1 })).replayed, true);
    await assert.rejects(c.channel.beginUtterance(begin), e => e.code === 'SESSION_EXPIRED');
    const g = fixture(), ticket = await g.service.prepare(prepare); g.state.at += 60001;
    await assert.rejects(g.service.claim({ actorUid: 'staff', feature: 'projects', sessionId: ticket.sessionId, ticket: ticket.ticket, connectionId: 'c' }), e => e.code === 'TICKET_EXPIRED');
});

test('only final server user-audio with explicit policy creates immutable confirmation', async () => {
    const f = fixture(), c = await connected(f);
    for (const source of ['assistant', 'tool', 'text']) await assert.rejects(c.channel.beginUtterance({ ...begin, source }), e => e.code === 'UNTRUSTED_UTTERANCE');
    await c.channel.beginUtterance(begin); assert.equal((await c.channel.beginUtterance(begin)).replayed, true);
    for (const patch of [{ final: false }, { text: 'x'.repeat(16001) }, { audioEvidence: { audioDigest: 'client', durationMs: 1000 } }]) await assert.rejects(c.channel.finalizeUtterance({ ...final, ...patch }));
    const proof = await c.channel.finalizeUtterance(final); assert.ok(proof.attestationId); assert.equal((await c.channel.finalizeUtterance(final)).replayed, true);
    await assert.rejects(c.channel.finalizeUtterance({ ...final, text: 'changed' }), e => ['PROVIDER_EVENT_CONFLICT', 'UTTERANCE_CONFLICT'].includes(e.code));
    await assert.rejects(c.channel.beginUtterance({ ...begin, utteranceId: 'other' }), e => e.code === 'PROVIDER_EVENT_CONFLICT');
    assert.equal(f.rows.get(`${C.attestations}/${proof.attestationId}`).engineeringOnly, true);
});

test('changed context during speech invalidates utterance even after context refresh', async () => {
    const f = fixture(), c = await connected(f); await c.channel.beginUtterance(begin); f.state.revision++;
    assert.equal((await c.channel.finalizeUtterance(final)).attestationId, null);
    assert.equal((await f.service.updateContext({ ...c.identity, epoch: 1, contextHints: {} })).contextRevision, 1);
    assert.equal((await c.channel.finalizeUtterance(final)).attestationId, null);
    const g = fixture(), d = await connected(g); await d.channel.beginUtterance(begin); g.state.at = 1800001000001;
    await assert.rejects(d.channel.finalizeUtterance(final), e => ['SESSION_EXPIRED', 'PREVIEW_EXPIRED'].includes(e.code));
});

test('confirmation consumption stages after reads and rolls back atomically with domain effects', async () => {
    const f = fixture(), c = await attested(f), confirmation = createVoiceConfirmationService(f.options);
    const input = { actorUid: 'staff', feature: 'projects', attestationId: c.proof.attestationId, binding: f.binding('projects'), receiptId: 'receipt' };
    const ref = f.options.db.collection('domainEffects').doc('receipt');
    await assert.rejects(f.runTransaction(async tx => { const stage = await confirmation.prepareConsumption(tx, input); await tx.get(ref); stage.consume(); tx.set(ref, { applied: true }); throw Error('rollback'); }));
    assert.equal(f.rows.get(`${C.attestations}/${input.attestationId}`).consumedReceiptId, null); assert.equal(f.rows.has(ref.path), false);
    await f.runTransaction(async tx => { const stage = await confirmation.prepareConsumption(tx, input); await tx.get(ref); stage.consume(); stage.consume(); tx.set(ref, { applied: true }); });
    assert.equal(f.rows.get(`${C.attestations}/${input.attestationId}`).consumedReceiptId, 'receipt');
    await f.runTransaction(async tx => { const stage = await confirmation.prepareConsumption(tx, input); assert.equal(stage.replayed, true); stage.consume(); });
    await assert.rejects(f.runTransaction(tx => confirmation.prepareConsumption(tx, { ...input, receiptId: 'different' })), e => e.code === 'ATTESTATION_CONSUMED');
});

test('production rejects engineering proof; wrong binding, actor, feature and revoked authority cannot consume', async () => {
    const f = fixture(), c = await attested(f), confirmation = createVoiceConfirmationService(f.options), native = createVoiceConfirmationService({ ...f.options, engineeringMode: false });
    const input = { actorUid: 'staff', feature: 'projects', attestationId: c.proof.attestationId, binding: f.binding('projects'), receiptId: 'receipt' };
    await assert.rejects(f.runTransaction(tx => native.prepareConsumption(tx, input)), e => e.code === 'ENGINEERING_ATTESTATION');
    for (const patch of [{ actorUid: 'other' }, { feature: 'crm-data-input' }, { binding: { ...input.binding, revision: 2 } }]) await assert.rejects(f.runTransaction(tx => confirmation.prepareConsumption(tx, { ...input, ...patch })));
    f.state.allowed = false; await assert.rejects(f.runTransaction(tx => confirmation.prepareConsumption(tx, input)), e => e.code === 'VOICE_FORBIDDEN');
    f.state.allowed = true; f.state.revision++; await assert.rejects(f.runTransaction(tx => confirmation.prepareConsumption(tx, input)), e => e.code === 'STALE_ATTESTATION');
});

test('two instances race one ticket; final attestations are invalidated by close and expiry', async () => {
    const f = fixture(), prepared = await f.service.prepare(prepare), second = createVoiceSessionService(f.options);
    const input = { actorUid: 'staff', feature: 'projects', sessionId: prepared.sessionId, ticket: prepared.ticket };
    const results = await Promise.allSettled([f.service.claim({ ...input, connectionId: 'one' }), second.claim({ ...input, connectionId: 'two' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'TICKET_CONSUMED');
    for (const reason of ['close', 'expiry', 'refresh']) {
        const g = fixture(), c = await attested(g), confirmation = createVoiceConfirmationService(g.options);
        if (reason === 'close') await g.service.close({ ...c.identity, epoch: 1 });
        if (reason === 'expiry') g.state.at += 1000001;
        if (reason === 'refresh') { g.state.revision++; await g.service.updateContext({ ...c.identity, epoch: 1, contextHints: {} }); g.state.revision--; }
        await assert.rejects(g.runTransaction(tx => confirmation.prepareConsumption(tx, { actorUid: 'staff', feature: 'projects', attestationId: c.proof.attestationId, binding: g.binding('projects'), receiptId: 'receipt' })), e => ['STALE_ATTESTATION', 'PREVIEW_EXPIRED'].includes(e.code));
        assert.equal(g.rows.get(`${C.attestations}/${c.proof.attestationId}`).consumedReceiptId, null);
    }
});

test('ordinary user speech before and after preview persists provenance without confirming', async () => {
    for (const preview of [false, true]) {
        const f = fixture(); f.state.preview = preview; const c = await connected(f);
        await c.channel.beginUtterance(begin);
        const result = await c.channel.finalizeUtterance({ ...final, text: 'Help me plan the next student intake.' });
        assert.equal(result.attestationId, null); assert.equal(result.text, 'Help me plan the next student intake.');
        assert.equal([...f.rows.keys()].filter(key => key.startsWith(`${C.attestations}/`)).length, 0);
        assert.ok([...f.rows.values()].some(row => row.state === 'final' && row.text === result.text && row.finalDigest));
    }
});

test('status uses current safe summary and invalidates old consent while provider receives authorized context', async () => {
    const f = fixture(), c = await attested(f); f.state.summary = 'New authorized summary'; f.state.preview = false;
    const status = await f.service.readStatus(c.identity);
    assert.equal(status.contextChanged, true); assert.equal(status.summary, 'New authorized summary'); assert.equal(status.previewBinding, null); assert.equal(status.contextRevision, 1);
    assert.ok(!JSON.stringify(status).includes('secretInternalData'));
    const context = await c.channel.getContext(); assert.equal(context.summary, status.summary); assert.equal(context.context.secretInternalData, 'do not expose');
    const confirmation = createVoiceConfirmationService(f.options);
    await assert.rejects(f.runTransaction(tx => confirmation.prepareConsumption(tx, { actorUid: 'staff', feature: 'projects', attestationId: c.proof.attestationId, binding: f.binding('projects'), receiptId: 'receipt' })), e => e.code === 'STALE_ATTESTATION');
    f.state.allowed = false; await assert.rejects(c.channel.getContext(), e => e.code === 'VOICE_FORBIDDEN');
});

test('consumed same receipt survives cleared preview, closed expired session with current authority and original binding', async () => {
    const f = fixture(), c = await attested(f), confirmation = createVoiceConfirmationService(f.options);
    const input = { actorUid: 'staff', feature: 'projects', attestationId: c.proof.attestationId, binding: f.binding('projects'), receiptId: 'receipt' };
    await f.runTransaction(async tx => { const stage = await confirmation.prepareConsumption(tx, input); stage.consume(); });
    f.state.preview = false; await f.service.close({ ...c.identity, epoch: 1 }); f.state.at += 2000000;
    const before = structuredClone([...f.rows]);
    await f.runTransaction(async tx => { const stage = await confirmation.prepareConsumption(tx, input); assert.equal(stage.replayed, true); stage.consume(); });
    assert.deepEqual([...f.rows], before);
    await assert.rejects(f.runTransaction(tx => confirmation.prepareConsumption(tx, { ...input, receiptId: 'another' })), e => e.code === 'ATTESTATION_CONSUMED');
    await assert.rejects(f.runTransaction(tx => confirmation.prepareConsumption(tx, { ...input, binding: { ...input.binding, revision: 2 } })), e => e.code === 'STALE_ATTESTATION');
    f.state.allowed = false; await assert.rejects(f.runTransaction(tx => confirmation.prepareConsumption(tx, input)), e => e.code === 'VOICE_FORBIDDEN');
});

test('prepare replay refreshes stale private summary without issuing another ticket', async () => {
    const f = fixture(), c = await connected(f); f.state.summary = 'Only the newly authorized summary'; f.state.preview = false;
    const replay = await f.service.prepare(prepare);
    assert.equal(replay.ticket, null); assert.equal(replay.replayed, true); assert.equal(replay.summary, f.state.summary); assert.equal(replay.previewBinding, null); assert.equal(replay.contextRevision, 1);
    assert.equal(JSON.stringify(replay).includes('Create the reviewed record'), false);
    assert.equal(f.rows.get(`${C.sessions}/${c.identity.sessionId}`).contextRevision, 1);
});

test('preview changed before speech cannot attest unseen binding until context is synchronized', async () => {
    const f = fixture(), c = await connected(f); f.state.revision++;
    await c.channel.beginUtterance(begin);
    assert.equal((await c.channel.finalizeUtterance(final)).attestationId, null);
    const status = await f.service.readStatus(c.identity); assert.equal(status.previewBinding.revision, 2); assert.equal(status.contextRevision, 1);
    const nextBegin = { ...begin, utteranceId: 'second', eventId: 'begin-second' };
    await c.channel.beginUtterance(nextBegin);
    const proof = await c.channel.finalizeUtterance({ ...final, utteranceId: 'second', eventId: 'final-second' });
    assert.ok(proof.attestationId); assert.equal(f.rows.get(`${C.attestations}/${proof.attestationId}`).binding.revision, 2);
});


test('confirmation policy receives frozen current domain context for payment acknowledgement', async () => {
    const f = fixture(); const adapter = f.options.featureAdapters.projects;
    const original = adapter.resolveContext; let paymentRequired = true;
    adapter.resolveContext = async (...args) => { const value = await original(...args); return { ...value, context: { ...value.context, paymentAcknowledgementRequired: paymentRequired } }; };
    adapter.confirm = ({ text, binding, context }) => {
        assert.equal(Object.isFrozen(binding), true); assert.equal(Object.isFrozen(context), true); assert.equal(context.paymentAcknowledgementRequired, true);
        assert.throws(() => { context.paymentAcknowledgementRequired = false; }, TypeError);
        return text === 'I confirm and acknowledge payment is an operator assertion.';
    };
    const c = await connected(f); await c.channel.beginUtterance(begin);
    assert.equal((await c.channel.finalizeUtterance(final)).attestationId, null);
    await c.channel.beginUtterance({ ...begin, utteranceId: 'payment', eventId: 'payment-begin' });
    const result = await c.channel.finalizeUtterance({ ...final, utteranceId: 'payment', eventId: 'payment-final', text: 'I confirm and acknowledge payment is an operator assertion.' });
    assert.ok(result.attestationId);
    await c.channel.beginUtterance({ ...begin, utteranceId: 'changed', eventId: 'changed-begin' }); paymentRequired = false;
    assert.equal((await c.channel.finalizeUtterance({ ...final, utteranceId: 'changed', eventId: 'changed-final', text: 'I confirm and acknowledge payment is an operator assertion.' })).attestationId, null);
    const confirmation = createVoiceConfirmationService(f.options);
    await assert.rejects(f.runTransaction(tx => confirmation.prepareConsumption(tx, { actorUid: 'staff', feature: 'projects', attestationId: result.attestationId, binding: f.binding('projects'), receiptId: 'payment' })), e => e.code === 'STALE_ATTESTATION');
});
