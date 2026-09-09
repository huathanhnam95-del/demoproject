'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createProjectsDraftService, PROJECT_AI_PREVIEWS } = require('../../../functions/src/crm/projects/voice/draft-service');
const { createVoiceSessionService } = require('../../../functions/src/ai-assistance/voice/session-service');
const { AI_VOICE_COLLECTIONS: V } = require('../../../functions/src/ai-assistance/collections');
const { digest } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
process.env.CRM_PROJECTS_ENABLED = 'true';
function fixture() {
    const rows = new Map([['users/staff', { allowed: true }], ['crmProjects/p', { name: 'Project', lifecycle: 'active', revision: 0, structureRevision: 0, schemaRevision: 0, membershipRevision: 1 }]]);
    for (const taskId of ['one', 'two', 'parent']) rows.set(`crmProjects/p/tasks/${taskId}`, { projectId: 'p', title: taskId, revision: 0, lifecycle: 'active', parentTaskId: null });
    const state = { now: 1800000000000, prepares: 0, flushes: 0, executes: 0, hookFlushed: false }; let queue = Promise.resolve();
    const doc = path => ({ path, collection: name => collection(`${path}/${name}`) });
    const collection = (path, filters = [], limit = 1000) => ({ path, query: true, filters, limitValue: limit, doc: id => doc(`${path}/${id}`), where: (key, op, value) => { assert.equal(op, '=='); return collection(path, [...filters, [key, value]], limit); }, limit: size => collection(path, filters, size) });
    const db = { collection, async runTransaction(work) { const promise = queue.then(async () => {
        let writing = false; const writes = new Map(); const tx = {
            async get(ref) { assert.equal(writing, false, 'all domain/authorization reads before writes'); if (ref.query) return { docs: [...rows].filter(([path, row]) => path.startsWith(`${ref.path}/`) && path.split('/').length === ref.path.split('/').length + 1 && ref.filters.every(([key, value]) => row[key] === value)).slice(0, ref.limitValue).map(([path, row]) => ({ id: path.split('/').pop(), exists: true, data: () => structuredClone(row) })) }; return { exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)) }; },
            set(ref, value, options) { writing = true; writes.set(ref.path, options?.merge ? { ...rows.get(ref.path), ...structuredClone(value) } : structuredClone(value)); }, create(ref, value) { assert.equal(rows.has(ref.path) || writes.has(ref.path), false); this.set(ref, value); }
        }; const result = await work(tx); for (const entry of writes) rows.set(...entry); return result;
    }); queue = promise.catch(() => {}); return promise; } };
    const accessService = {
        async assertTransactionEligible(tx, uid) { const profile = await tx.get(doc(`users/${uid}`)); if (!profile.exists || !profile.data().allowed) throw Object.assign(Error('revoked'), { code: 'FORBIDDEN', status: 403 }); return { uid, profile: profile.data(), workforce: {} }; },
        async assertTransactionContentAccess(tx, uid, projectId) { const identity = await this.assertTransactionEligible(tx, uid), project = await tx.get(doc(`crmProjects/${projectId}`)); if (!project.exists) throw Error('missing project'); return { identity, role: 'Editor', membership: { data: { uid, projectId, role: 'Editor', active: true } }, project: { id: projectId, data: project.data() } }; }
    };
    const recoveryService = {
        async prepareFieldBatch({ transaction, projectId, changes }) {
            state.prepares++; const project = (await transaction.get(doc(`crmProjects/${projectId}`))).data(); const original = [];
            for (const change of changes) { const value = (await transaction.get(doc(`crmProjects/${projectId}/tasks/${change.taskId}`))).data(); if (value.revision !== change.expectedRevision) throw Object.assign(Error('stale'), { code: 'STALE_REVISION', status: 409 }); original.push(value); }
            return { fenceDigest: digest({ project, original }), preview: { kind: 'fieldBatch', changes }, flush() { assert.equal(transaction.semantic, true, 'flush must use semantic command capture'); state.flushes++; changes.forEach((change, index) => transaction.set(doc(`crmProjects/${projectId}/tasks/${change.taskId}`), { ...original[index], ...change.patch, revision: original[index].revision + 1 })); return { result: { count: changes.length }, affectedIds: changes.map(c => c.taskId) }; } };
        },
        async prepareMoveBatch({ transaction, projectId, moves, destination, expectedStructureRevision }) {
            state.prepares++; const project = (await transaction.get(doc(`crmProjects/${projectId}`))).data(), parent = (await transaction.get(doc(`crmProjects/${projectId}/tasks/${destination.parentTaskId}`))).data(); const original = [];
            for (const move of moves) original.push((await transaction.get(doc(`crmProjects/${projectId}/tasks/${move.taskId}`))).data());
            assert.equal(parent.revision, destination.expectedParentRevision); assert.equal(project.structureRevision, expectedStructureRevision);
            return { fenceDigest: digest({ project, parent, original }), preview: { kind: 'moveBatch', destination, moves }, flush() { assert.equal(transaction.semantic, true); state.flushes++; moves.forEach((move, index) => transaction.set(doc(`crmProjects/${projectId}/tasks/${move.taskId}`), { ...original[index], parentTaskId: destination.parentTaskId, revision: original[index].revision + 1 })); return { result: { moved: moves.map(m => m.taskId) } }; } };
        }
    };
    const commandService = { async runCommand(options) { return db.runTransaction(async tx => {
        await accessService.assertTransactionContentAccess(tx, options.actorUid, options.projectId); const before = state.flushes;
        const auth = await options.prepareAuthorization({ transaction: tx }); state.hookFlushed ||= state.flushes !== before;
        const opRef = doc(`operations/${options.operationId}`), previous = await tx.get(opRef);
        if (previous.exists) { assert.equal(auth.replayed, true); return previous.data().result; }
        assert.equal(auth.replayed, false); state.executes++;
        const transaction = new Proxy(tx, { get(target, key) { if (key === 'semantic') return true; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
        const executed = await options.execute({ transaction }); assert.equal(executed.origin, 'ai'); auth.consume(); if (state.rollback) throw Object.assign(Error('atomic rollback'), { code: 'INJECTED_ROLLBACK' }); tx.create(opRef, { result: executed.result, origin: executed.origin }); return executed.result;
    }); } };
    const service = createProjectsDraftService({ db, accessService, recoveryService, commandService, now: () => state.now, engineeringMode: true });
    const identity = { uid: 'staff' }, actions = ['one', 'two'].map(taskId => ({ kind: 'field_update', taskId, patch: { title: `New ${taskId}` } }));
    async function draft() { return (await service.createFromProposal(identity, 'p', { requestId: 'create', actions })).draft; }
    async function attestation(draft, preview) {
        const voice = createVoiceSessionService({ db, runTransaction: work => db.runTransaction(work), now: () => state.now, featureAdapters: { projects: service.voiceAdapter }, engineeringMode: true });
        const prepare = await voice.prepare({ actorUid: 'staff', feature: 'projects', requestId: 'voice', contextHints: { projectId: 'p', draftId: draft.draftId, previewId: preview.previewId } });
        const owner = { actorUid: 'staff', feature: 'projects', sessionId: prepare.sessionId }; await voice.claim({ ...owner, ticket: prepare.ticket, connectionId: 'connection' }); const channel = voice.providerChannel({ ...owner, epoch: 1 });
        await channel.beginUtterance({ utteranceId: 'one', eventId: 'begin', source: 'user_audio' }); return channel.finalizeUtterance({ utteranceId: 'one', eventId: 'final', source: 'user_audio', final: true, text: 'I confirm these changes.', audioEvidence: { audioDigest: 'c'.repeat(64), durationMs: 1000 } });
    }
    return { rows, state, db, service, accessService, recoveryService, commandService, identity, actions, draft, attestation };
}

test('correction targets second stable action and rejects unsupported/mixed proposals', async () => {
    const f = fixture(), draft = await f.draft(); const changed = await f.service.correct(f.identity, draft.draftId, { expectedRevision: 0, actionId: draft.actions[1].actionId, patch: { patch: { title: 'Only second corrected' } }, requestId: 'correct' });
    assert.deepEqual(changed.draft.actions[0], draft.actions[0]); assert.equal(changed.draft.actions[1].actionId, draft.actions[1].actionId); assert.equal(changed.draft.actions[1].patch.title, 'Only second corrected'); assert.equal(f.rows.get('crmProjects/p/tasks/two').title, 'two');
    for (const actions of [[{ kind: 'field_update', taskId: 'one', patch: { lifecycle: 'trashed' } }], [f.actions[0], { kind: 'move_task', taskId: 'two', parentTaskId: 'parent' }]]) await assert.rejects(f.service.createFromProposal(f.identity, 'p', { requestId: 'bad', actions }));
});

test('preview is immutable, has server revisions and never flushes domain writes', async () => {
    const f = fixture(), draft = await f.draft(), input = { expectedRevision: 0, requestId: 'preview' }; const preview = await f.service.preview(f.identity, draft.draftId, input);
    assert.equal(f.state.flushes, 0); assert.equal(preview.batchInput.changes[1].expectedRevision, 0); assert.equal(preview.binding.draftDigest, draft.draftDigest); assert.equal(Object.isFrozen(preview.binding), true);
    f.state.now += 1000; const replay = await f.service.preview(f.identity, draft.draftId, input); assert.equal(replay.replayed, true); assert.equal(replay.expiresAtMs, preview.expiresAtMs);
    f.rows.get('crmProjects/p/tasks/two').revision = 1; await assert.rejects(f.service.preview(f.identity, draft.draftId, input), e => e.code === 'PREVIEW_REQUEST_CONFLICT');
    assert.equal(f.rows.get(`${PROJECT_AI_PREVIEWS}/${preview.previewId}`).batchInput.changes[1].expectedRevision, 0);
});

test('voice context references saved preview and requires explicit exact phrase', async () => {
    const f = fixture(), draft = await f.draft(), preview = await f.service.preview(f.identity, draft.draftId, { expectedRevision: 0, requestId: 'preview' });
    const context = await f.db.runTransaction(tx => f.service.voiceAdapter.resolveContext({ tx, actorUid: 'staff', contextHints: { projectId: 'p', draftId: draft.draftId, previewId: preview.previewId } })); assert.deepEqual(context.previewBinding, preview.binding);
    assert.equal(f.service.voiceAdapter.confirm({ text: 'Confirm this preview!' }), true); assert.equal(f.service.voiceAdapter.confirm({ text: 'yes' }), false); assert.equal(f.service.voiceAdapter.confirm({ text: 'Do not confirm this preview' }), false);
    await assert.rejects(f.db.runTransaction(tx => f.service.voiceAdapter.resolveContext({ tx, actorUid: 'staff', contextHints: { projectId: 'p', draftId: draft.draftId, previewId: preview.previewId, actions: [] } })));
    await f.service.correct(f.identity, draft.draftId, { expectedRevision: 0, actionId: draft.actions[0].actionId, patch: { patch: { title: 'Correction' } }, requestId: 'correct' });
    const stale = await f.db.runTransaction(tx => f.service.voiceAdapter.resolveContext({ tx, actorUid: 'staff', contextHints: { projectId: 'p', draftId: draft.draftId, previewId: preview.previewId } })); assert.equal(stale.previewBinding, null);
});

test('reference-only apply stages attestation, draft and semantic domain effects atomically and replays once', async () => {
    const f = fixture(), draft = await f.draft(), preview = await f.service.preview(f.identity, draft.draftId, { expectedRevision: 0, requestId: 'preview' }), proof = await f.attestation(draft, preview); assert.ok(proof.attestationId);
    const input = { previewId: preview.previewId, attestationId: proof.attestationId };
    await assert.rejects(f.service.apply(f.identity, draft.draftId, { ...input, actions: [] }));
    const result = await f.service.apply(f.identity, draft.draftId, input); assert.equal(result.count, 2); assert.equal(f.state.hookFlushed, false); assert.equal(f.state.flushes, 1);
    assert.equal(f.rows.get('crmProjects/p/tasks/one').title, 'New one'); assert.equal((await f.service.read(f.identity, draft.draftId)).status, 'committed'); assert.equal(f.rows.get(`${V.attestations}/${proof.attestationId}`).consumedReceiptId, preview.operationId);
    assert.deepEqual(await f.service.apply(f.identity, draft.draftId, input), result); assert.equal(f.state.flushes, 1); assert.equal(f.state.executes, 1);
    f.rows.get('users/staff').allowed = false; await assert.rejects(f.service.apply(f.identity, draft.draftId, input), e => e.code === 'FORBIDDEN');
});

test('changed canonical fence aborts before flush and preserves confirmation/draft', async () => {
    const f = fixture(), draft = await f.draft(), preview = await f.service.preview(f.identity, draft.draftId, { expectedRevision: 0, requestId: 'preview' }), proof = await f.attestation(draft, preview);
    // A nonselected project field changes the full preparer fence; this adapter
    // keeps the safe planning DTO unchanged, so apply must catch the live fence.
    f.rows.get('crmProjects/p').internalFence = 'changed';
    await assert.rejects(f.service.apply(f.identity, draft.draftId, { previewId: preview.previewId, attestationId: proof.attestationId }), e => e.code === 'STALE_ATTESTATION');
    assert.equal(f.state.flushes, 0); assert.equal(f.rows.get(`${V.attestations}/${proof.attestationId}`).consumedReceiptId, null); assert.equal((await f.service.read(f.identity, draft.draftId)).status, 'active'); assert.equal(f.rows.get('crmProjects/p/tasks/one').title, 'one');
});

test('moves require one existing parent and preview computes end index and structure fences', async () => {
    const f = fixture(); f.rows.set('crmProjects/p/tasks/child', { projectId: 'p', revision: 0, parentTaskId: 'parent', lifecycle: 'active' });
    const draft = (await f.service.createFromProposal(f.identity, 'p', { requestId: 'move', actions: ['one', 'two'].map(taskId => ({ kind: 'move_task', taskId, parentTaskId: 'parent' })) })).draft;
    const preview = await f.service.preview(f.identity, draft.draftId, { expectedRevision: 0, requestId: 'move-preview' }); assert.equal(preview.batchInput.destination.index, 1); assert.equal(preview.batchInput.destination.expectedParentRevision, 0); assert.equal(preview.batchInput.expectedStructureRevision, 0); assert.equal(f.state.flushes, 0);
});


test('failed domain command rolls back flushed tasks and staged draft/attestation together', async () => {
    const f = fixture(), draft = await f.draft(), preview = await f.service.preview(f.identity, draft.draftId, { expectedRevision: 0, requestId: 'preview' }), proof = await f.attestation(draft, preview);
    const input = { previewId: preview.previewId, attestationId: proof.attestationId }; f.state.rollback = true;
    await assert.rejects(f.service.apply(f.identity, draft.draftId, input), e => e.code === 'INJECTED_ROLLBACK');
    assert.equal(f.rows.get('crmProjects/p/tasks/one').title, 'one'); assert.equal((await f.service.read(f.identity, draft.draftId)).status, 'active'); assert.equal(f.rows.get(`${V.attestations}/${proof.attestationId}`).consumedReceiptId, null);
    assert.equal(f.rows.has(`operations/${preview.operationId}`), false); f.state.rollback = false;
    assert.equal((await f.service.apply(f.identity, draft.draftId, input)).count, 2);
});

test('production composition rejects engineering attestation without applying domain effects', async () => {
    const f = fixture(), draft = await f.draft(), preview = await f.service.preview(f.identity, draft.draftId, { expectedRevision: 0, requestId: 'preview' }), proof = await f.attestation(draft, preview);
    const native = createProjectsDraftService({ db: f.db, accessService: f.accessService, recoveryService: f.recoveryService, commandService: f.commandService, now: () => f.state.now });
    await assert.rejects(native.apply(f.identity, draft.draftId, { previewId: preview.previewId, attestationId: proof.attestationId }), e => e.code === 'ENGINEERING_ATTESTATION');
    assert.equal(f.state.flushes, 0); assert.equal(f.rows.get('crmProjects/p/tasks/one').title, 'one');
});


test('full domain fence changes before speech suppress readiness and attestation without flushing', async () => {
    const f = fixture(), draft = await f.draft(), preview = await f.service.preview(f.identity, draft.draftId, { expectedRevision: 0, requestId: 'preview' });
    f.rows.get('crmProjects/p').internalCalendarFence = 'changed-without-task-revision';
    const context = await f.db.runTransaction(tx => f.service.voiceAdapter.resolveContext({ tx, actorUid: 'staff', contextHints: { projectId: 'p', draftId: draft.draftId, previewId: preview.previewId } }));
    assert.equal(context.previewBinding, null); assert.equal(f.state.flushes, 0);
    assert.equal((await f.attestation(draft, preview)).attestationId, null); assert.equal(f.state.flushes, 0);
    assert.equal(f.rows.get('crmProjects/p/tasks/one').revision, 0);
});

test('known stale preparer failure clears readiness while authority and unexpected errors propagate', async () => {
    const f = fixture(), draft = await f.draft(), preview = await f.service.preview(f.identity, draft.draftId, { expectedRevision: 0, requestId: 'preview' });
    const resolve = () => f.db.runTransaction(tx => f.service.voiceAdapter.resolveContext({ tx, actorUid: 'staff', contextHints: { projectId: 'p', draftId: draft.draftId, previewId: preview.previewId } }));
    f.rows.get('crmProjects/p/tasks/one').revision++;
    assert.equal((await resolve()).previewBinding, null);
    f.recoveryService.prepareFieldBatch = async () => { throw Object.assign(Error('authority'), { code: 'FORBIDDEN', status: 403 }); };
    await assert.rejects(resolve(), e => e.code === 'FORBIDDEN');
    f.recoveryService.prepareFieldBatch = async () => { throw Object.assign(Error('unexpected'), { code: 'INTERNAL_FAILURE' }); };
    await assert.rejects(resolve(), e => e.code === 'INTERNAL_FAILURE'); assert.equal(f.state.flushes, 0);
});
