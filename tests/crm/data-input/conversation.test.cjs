'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationService } = require('../../../functions/src/crm/data-input/conversation-service');

function fixture() {
    const rows = new Map();
    const state = { now: 1800000000000, allowed: true, authCalls: 0, reads: 0 };
    const ref = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`) });
    const collection = path => ({ doc: id => ref(`${path}/${id}`) });
    let queue = Promise.resolve();
    const db = { collection, runTransaction(fn) {
        const result = queue.then(async () => {
            const staged = new Map();
            const tx = {
                async get(reference) { state.reads++; const data = rows.get(reference.path); return { exists: data !== undefined, data: () => structuredClone(data), id: reference.id }; },
                set(reference, data) { staged.set(reference.path, structuredClone(data)); }
            };
            const value = await fn(tx);
            for (const [path, data] of staged) rows.set(path, data);
            return value;
        });
        queue = result.catch(() => {});
        return result;
    } };
    const options = { db, now: () => state.now, authorize: async ({ actorUid, tx }) => {
        assert.ok(tx); state.authCalls++; return state.allowed && ['staff-1', 'staff-2'].includes(actorUid);
    } };
    return { rows, state, options, service: createConversationService(options) };
}
const start = { actorUid: 'staff-1', requestId: 'request-1' };
const edit = draft => ({ actorUid: 'staff-1', draftId: draft.draftId, changes: { expectedRevision: draft.revision,
    upserts: [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan' } }] },
    source: { kind: 'text', messageId: 'message-1' }, text: 'Create student Lan' });

test('conversation create retries keep one draft and scope identity to the staff account', async () => {
    const { service, rows } = fixture();
    const first = await service.create(start), replay = await service.create(start);
    assert.deepEqual(replay, first);
    const another = await service.create({ ...start, actorUid: 'staff-2' });
    assert.notEqual(first.draftId, another.draftId);
    assert.equal(rows.size, 2);
});

test('a recreated service resumes persisted draft values, provenance and ordered messages', async () => {
    const { service, options } = fixture();
    const draft = await service.create(start);
    const next = await service.apply(edit(draft));
    const restarted = createConversationService(options);
    const loaded = await restarted.load({ actorUid: 'staff-1', draftId: draft.draftId });
    assert.deepEqual(loaded.draft, next.draft);
    assert.equal(loaded.messages[0].text, 'Create student Lan');
    assert.equal(loaded.messages[0].source.kind, 'text');
    assert.equal(loaded.draft.actions[0].values.name, 'Lan');
});

test('replayed messages never apply a second edit and altered replays conflict', async () => {
    const { service } = fixture();
    const draft = await service.create(start), input = edit(draft);
    await service.apply(input);
    const replay = await service.apply(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.draft.revision, 1);
    assert.equal(replay.appliedRevision, 1);
    await assert.rejects(service.apply({ ...input, text: 'Different instruction' }), error => error.code === 'MESSAGE_CONFLICT');
    const loaded = await service.load({ actorUid: 'staff-1', draftId: draft.draftId });
    assert.equal(loaded.messages.length, 1);
});

test('concurrent edits cannot overwrite a winning revision', async () => {
    const { service } = fixture();
    const draft = await service.create(start), input = edit(draft);
    const other = { ...input, source: { kind: 'voice', messageId: 'message-2' }, text: 'Create another student' };
    const results = await Promise.allSettled([service.apply(input), service.apply(other)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
    const loaded = await service.load({ actorUid: 'staff-1', draftId: draft.draftId });
    assert.equal(loaded.draft.revision, 1);
    assert.equal(loaded.messages.length, 1);
});

test('fresh admission and draft ownership protect reads, changes and cancellation', async () => {
    const { service, state } = fixture();
    const draft = await service.create(start);
    await assert.rejects(service.load({ actorUid: 'staff-2', draftId: draft.draftId }), error => error.code === 'DRAFT_NOT_FOUND');
    state.allowed = false;
    const beforeReads = state.reads;
    await assert.rejects(service.apply(edit(draft)), error => error.code === 'FORBIDDEN');
    await assert.rejects(service.load({ actorUid: 'staff-1', draftId: draft.draftId }), error => error.code === 'FORBIDDEN');
    await assert.rejects(service.discard({ actorUid: 'staff-1', draftId: draft.draftId, expectedRevision: 0 }), error => error.code === 'FORBIDDEN');
    assert.equal(state.reads, beforeReads);
});

test('expired drafts remain inspectable but cannot accept new messages', async () => {
    const { service, state } = fixture();
    const draft = await service.create(start);
    state.now = draft.expiresAtMs;
    await assert.rejects(service.apply(edit(draft)), error => error.code === 'DRAFT_EXPIRED');
    const loaded = await service.load({ actorUid: 'staff-1', draftId: draft.draftId });
    assert.equal(loaded.expired, true);
    assert.equal(loaded.messages.length, 0);
});

test('discard checks revisions, clears review authority and prevents further edits', async () => {
    const { service, rows } = fixture();
    const draft = await service.create(start), key = [...rows.keys()][0];
    rows.get(key).preview = { digest: 'review' }; rows.get(key).confirmation = { token: 'confirmation' };
    await assert.rejects(service.discard({ actorUid: 'staff-1', draftId: draft.draftId, expectedRevision: 9 }), error => error.code === 'REVISION_CONFLICT');
    const cancelled = await service.discard({ actorUid: 'staff-1', draftId: draft.draftId, expectedRevision: 0 });
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.preview, null); assert.equal(cancelled.confirmation, null);
    await assert.rejects(service.apply(edit(cancelled)), error => error.code === 'DRAFT_TERMINAL');
});

test('oversized or invalid user messages do not leave partially saved history', async () => {
    const { service, rows } = fixture();
    const draft = await service.create(start);
    await assert.rejects(service.apply({ ...edit(draft), text: 'x'.repeat(16001) }), error => error.code === 'MESSAGE_LIMIT');
    await assert.rejects(service.apply({ ...edit(draft), source: { kind: 'assistant', messageId: 'message-1' } }), error => error.code === 'INVALID_SOURCE');
    assert.equal(rows.size, 1);
    assert.equal((await service.load({ actorUid: 'staff-1', draftId: draft.draftId })).draft.revision, 0);
});
