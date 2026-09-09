'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDraftStore, TTL_MS } = require('../../../functions/src/ai-assistance/drafts/draft-store');
const { AI_DRAFT_COLLECTIONS: C } = require('../../../functions/src/ai-assistance/collections');
const { strict, digest } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
function fixture() {
    const records = new Map([['roles/staff', { allowed: true }]]), state = { time: 1800000000000 }; let queue = Promise.resolve();
    const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }) };
    const runTransaction = work => { const result = queue.then(async () => { const writes = new Map(); let writing = false; const tx = {
        async get(ref) { assert.equal(writing, false, 'reads must precede all draft and domain writes'); return { exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) }; },
        set(ref, value) { writing = true; writes.set(ref.path, structuredClone(value)); }, create(ref, value) { assert.equal(records.has(ref.path) || writes.has(ref.path), false, 'immutable records cannot be overwritten'); this.set(ref, value); }
    }; const value = await work(tx); for (const entry of writes) records.set(...entry); return value; }); queue = result.catch(() => {}); return result; };
    const adapter = {
        normalizeScope(value) { strict(value, ['projectId']); assert.equal(typeof value.projectId, 'string'); return value; },
        async authorize({ tx, actorUid, scope }) { const role = await tx.get(db.collection('roles').doc(actorUid)); return role.exists && role.data().allowed === true && scope.projectId === 'project'; },
        normalizeActions(actions) { return actions.map(action => { strict(action, ['actionId', 'kind', 'values']); assert.equal(action.kind, 'createTask'); strict(action.values, ['title', 'priority']); assert.equal(typeof action.values.title, 'string'); assert.ok(action.values.title.length > 0); assert.ok(['low', 'high'].includes(action.values.priority)); return action; }); }
    };
    const options = { db, runTransaction, now: () => state.time, featureAdapters: { projects: adapter } }, store = createDraftStore(options);
    const input = { actorUid: 'staff', feature: 'projects', requestId: 'create', scope: { projectId: 'project' }, actions: [{ kind: 'createTask', values: { title: 'One', priority: 'low' } }, { kind: 'createTask', values: { title: 'Two', priority: 'high' } }] };
    return { db, records, state, options, store, input, runTransaction, identity: draft => ({ actorUid: 'staff', feature: 'projects', draftId: draft.draftId }) };
}

test('server IDs, immutable snapshots/revisions and exact concurrent replay across instances', async () => {
    const f = fixture(), other = createDraftStore(f.options); const [one, two] = await Promise.all([f.store.create(f.input), other.create(f.input)]);
    assert.equal(one.draft.draftId, two.draft.draftId); assert.equal([one, two].filter(r => r.replayed).length, 1);
    assert.equal(new Set(one.draft.actions.map(a => a.actionId)).size, 2); assert.ok(Object.isFrozen(one.draft.actions[0].values));
    assert.throws(() => { one.draft.actions[0].values.title = 'mutated'; }, TypeError);
    assert.equal([...f.records.keys()].filter(k => k.startsWith(`${C.revisions}/`)).length, 1);
    await assert.rejects(f.store.create({ ...f.input, actions: [f.input.actions[0]] }), e => e.code === 'DRAFT_REQUEST_CONFLICT');
});

test('correction changes only second action and invalidates preview without altering older revision', async () => {
    const f = fixture(), first = (await f.store.create(f.input)).draft;
    f.records.get(`${C.drafts}/${first.draftId}`).previewBinding = { previewId: 'old-preview' };
    const input = { ...f.identity(first), expectedRevision: 0, actionId: first.actions[1].actionId, patch: { values: { title: 'Corrected two', priority: 'low' } }, requestId: 'correction' };
    const result = await f.store.correct(input); assert.equal(result.draft.revision, 1); assert.equal(result.draft.previewBinding, null);
    assert.deepEqual(result.draft.actions[0], first.actions[0]); assert.equal(result.draft.actions[1].actionId, first.actions[1].actionId); assert.equal(result.draft.actions[1].kind, first.actions[1].kind); assert.equal(result.draft.actions[1].values.title, 'Corrected two');
    const original = f.records.get(`${C.revisions}/${digest([first.draftId, 0])}`); assert.equal(original.actions[1].values.title, 'Two');
    assert.equal((await f.store.correct(input)).replayed, true); assert.equal((await f.store.read(f.identity(first))).revision, 1);
    await assert.rejects(f.store.correct({ ...input, requestId: 'stale' }), e => e.code === 'DRAFT_REVISION_CONFLICT');
    for (const patch of [{ actionId: 'replacement' }, { kind: 'other' }, { provenance: 'client' }]) await assert.rejects(f.store.correct({ ...input, expectedRevision: 1, requestId: 'bad', patch }), e => e.code === 'ACTION_IDENTITY_CHANGED');
    await assert.rejects(f.store.correct({ ...input, expectedRevision: 1, requestId: 'schema', patch: { values: { title: '', priority: 'low' } } }));
});

test('current persisted scope authorization precedes reads, exact replay and correction', async () => {
    const f = fixture(), first = await f.store.create(f.input); f.records.set('roles/staff', { allowed: false });
    for (const call of [() => f.store.create(f.input), () => f.store.read(f.identity(first.draft)), () => f.store.correct({ ...f.identity(first.draft), expectedRevision: 0, actionId: first.draft.actions[0].actionId, patch: {}, requestId: 'correct' })]) await assert.rejects(call(), e => e.code === 'DRAFT_FORBIDDEN');
    f.records.set('roles/staff', { allowed: true }); await assert.rejects(f.store.read({ ...f.identity(first.draft), actorUid: 'other' }), e => e.code === 'DRAFT_NOT_FOUND');
    await assert.rejects(f.store.create({ ...f.input, requestId: 'scope', scope: { projectId: 'other' } }), e => e.code === 'DRAFT_FORBIDDEN');
    await assert.rejects(f.store.create({ ...f.input, requestId: 'scope', scope: { projectId: 'project', provenance: 'client' } }));
});

test('declined drafts remain readable and explicit correction reopens without extending original expiry', async () => {
    const f = fixture(), first = (await f.store.create(f.input)).draft;
    const input = { ...f.identity(first), expectedRevision: 0, requestId: 'decline' }; const declined = await f.store.decline(input);
    assert.equal(declined.draft.status, 'declined'); assert.equal((await f.store.decline(input)).replayed, true); assert.equal((await f.store.read(f.identity(first))).status, 'declined');
    await assert.rejects(f.runTransaction(async tx => { const draft = await f.store.prepareCurrent(tx, f.identity(first)); f.store.stageCommitted(tx, { draft, receiptId: 'no' }); }), e => e.code === 'DRAFT_DECLINED');
    const corrected = await f.store.correct({ ...f.identity(first), expectedRevision: 1, actionId: first.actions[1].actionId, patch: { values: { title: 'Reopen', priority: 'low' } }, requestId: 'reopen' }); assert.equal(corrected.draft.status, 'active'); assert.equal(corrected.draft.revision, 2); assert.equal(corrected.draft.expiresAtMs, first.expiresAtMs);
});

test('expiry preserves historical reads/replay but forbids new correction or fresh commit', async () => {
    const f = fixture(), created = await f.store.create(f.input); f.state.time += TTL_MS;
    assert.equal((await f.store.read(f.identity(created.draft))).expired, true); const replay = await f.store.create(f.input); assert.equal(replay.replayed, true); assert.equal(replay.draft.expired, true); assert.equal(replay.draft.expiresAtMs, created.draft.expiresAtMs);
    await assert.rejects(f.store.correct({ ...f.identity(created.draft), expectedRevision: 0, actionId: created.draft.actions[0].actionId, patch: {}, requestId: 'expired' }), e => e.code === 'DRAFT_EXPIRED');
    await assert.rejects(f.runTransaction(async tx => { const draft = await f.store.prepareCurrent(tx, f.identity(created.draft)); assert.equal(draft.expired, true); f.store.stageCommitted(tx, { draft, receiptId: 'expired' }); }), e => e.code === 'DRAFT_EXPIRED');
    assert.equal([...f.records.keys()].filter(k => k.startsWith(`${C.revisions}/`)).length, 1);
});

test('commit staging is tied to prepared transaction, atomic with effects and exactly one receipt', async () => {
    const f = fixture(), created = (await f.store.create(f.input)).draft, effectRef = f.db.collection('effects').doc('one');
    const current = f.records.get(`${C.drafts}/${created.draftId}`); current.originalBinding = { previewId: 'original' };
    await assert.rejects(f.runTransaction(async tx => { const draft = await f.store.prepareCurrent(tx, f.identity(created)); await tx.get(effectRef); f.store.stageCommitted(tx, { draft, receiptId: 'receipt' }); tx.create(effectRef, { count: 1 }); throw Error('rollback'); }));
    assert.equal((await f.store.read(f.identity(created))).status, 'active'); assert.equal(f.records.has(effectRef.path), false); assert.equal([...f.records.keys()].filter(k => k.startsWith(`${C.revisions}/`)).length, 1);
    await f.runTransaction(async tx => { const draft = await f.store.prepareCurrent(tx, { ...f.identity(created), expectedRevision: 0 }); await tx.get(effectRef); const result = f.store.stageCommitted(tx, { draft, receiptId: 'receipt' }); assert.deepEqual(result.originalBinding, { previewId: 'original' }); assert.equal(f.store.stageCommitted(tx, { draft, receiptId: 'receipt' }), result); tx.create(effectRef, { count: 1 }); });
    const before = structuredClone([...f.records]); await f.runTransaction(async tx => { const draft = await f.store.prepareCurrent(tx, f.identity(created)); assert.equal(f.store.stageCommitted(tx, { draft, receiptId: 'receipt' }).status, 'committed'); }); assert.deepEqual([...f.records], before);
    await assert.rejects(f.runTransaction(async tx => { const draft = await f.store.prepareCurrent(tx, f.identity(created)); f.store.stageCommitted(tx, { draft, receiptId: 'different' }); }), e => e.code === 'DRAFT_COMMIT_CONFLICT');
    await assert.rejects(f.runTransaction(async tx => f.store.stageCommitted(tx, { draft: created, receiptId: 'forged' })), e => e.code === 'DRAFT_NOT_PREPARED');
    assert.deepEqual(f.records.get(effectRef.path), { count: 1 });
});

test('untrusted IDs/provenance and count/byte limits fail before any draft mutation', async () => {
    const f = fixture();
    for (const action of [{ ...f.input.actions[0], actionId: 'caller' }, { ...f.input.actions[0], provenance: { source: 'speech' } }]) await assert.rejects(f.store.create({ ...f.input, actions: [action] }), e => e.code === 'CLIENT_ACTION_IDENTITY');
    await assert.rejects(f.store.create({ ...f.input, actions: Array.from({ length: 21 }, () => f.input.actions[0]) }), e => e.code === 'INVALID_ACTIONS');
    await assert.rejects(f.store.create({ ...f.input, actions: [{ kind: 'createTask', values: { title: 'x'.repeat(65536), priority: 'low' } }] }), e => e.code === 'DRAFT_TOO_LARGE');
    assert.equal(f.records.size, 1);
});
