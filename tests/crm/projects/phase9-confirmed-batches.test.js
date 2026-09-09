'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectsCommandService } = require('../../../functions/src/crm/projects/domain/command-service');
const { createProjectsRecoveryService } = require('../../../functions/src/crm/projects/recovery-service');
function fixture() {
    const records = new Map(); let log = [];
    const ref = path => ({ path, id: path.split('/').pop(), doc: id => ref(`${path}/${id}`), collection: id => ref(`${path}/${id}`), limit() { return this; }, async get() { return snapshot(this); } });
    const snapshot = target => {
        if (target.path.split('/').length % 2 === 0) return { ref: target, id: target.id, exists: records.has(target.path), data: () => structuredClone(records.get(target.path)) };
        const docs = [...records.keys()].filter(path => path.startsWith(`${target.path}/`) && path.split('/').length === target.path.split('/').length + 1).map(path => snapshot(ref(path)));
        return { docs, size: docs.length };
    };
    const db = { collection: ref, async runTransaction(work) { const writes = []; let writing = false; const tx = { async get(target) { assert.equal(writing, false, 'read after write'); log.push(`read:${target.path}`); return snapshot(target); }, set(target, data, options) { writing = true; log.push(`write:${target.path}`); writes.push([target.path, structuredClone(data), options]); } }; const result = await work(tx); for (const [path, data, options] of writes) records.set(path, options?.merge ? { ...records.get(path), ...data } : data); return result; } };
    records.set('crmProjects/p', { projectId: 'p', lifecycle: 'active', revision: 1, structureRevision: 1, schemaRevision: 1 });
    records.set('crmProjects/p/sections/s', { projectId: 'p', lifecycle: 'active', revision: 1 });
    for (const [i, name] of ['a', 'b', 'c', 'parent', 'child'].entries()) records.set(`crmProjects/p/tasks/${name}`, { projectId: 'p', title: name, lifecycle: 'active', revision: 1, parentTaskId: name === 'child' ? 'a' : null, ...(name === 'child' ? {} : { sectionId: 's' }), rank: `${i}/1`, status: 'not_started', values: {} });
    const accessService = { async assertTransactionEligible(tx, uid) { return { uid }; }, async assertTransactionContentAccess(tx, uid, projectId) { const project = await tx.get(ref(`crmProjects/${projectId}`)); return { role: 'Editor', identity: { uid }, project: { data: project.data() } }; } };
    const command = createProjectsCommandService({ db, accessService });
    const recovery = createProjectsRecoveryService({ db, accessService, commandService: command });
    const move = (overrides = {}) => command.runCommand({ actorUid: 'staff', projectId: 'p', command: 'confirmedMoveBatch', operationId: 'move_batch', payload: {}, execute: async ({ transaction }) => (await recovery.prepareMoveBatch({ transaction, actorUid: 'staff', projectId: 'p', moves: ['a', 'b', 'c'].map(taskId => ({ taskId, expectedRevision: 1 })), destination: { parentTaskId: 'parent', expectedParentRevision: 1, index: 0 }, expectedStructureRevision: 1, ...overrides })).flush() });
    return { records, db, accessService, command, recovery, move, log: () => log, clear: () => { log = []; } };
}
test('three roots move in exact order with attached descendants, one structure change and one atomic Undo', async () => {
    const f = fixture(); await f.move();
    assert.deepEqual(['a', 'b', 'c'].map(id => f.records.get(`crmProjects/p/tasks/${id}`).parentTaskId), ['parent', 'parent', 'parent']);
    assert.deepEqual(['a', 'b', 'c'].map(id => f.records.get(`crmProjects/p/tasks/${id}`).rank), ['0/1', '1/1', '2/1']);
    assert.equal(f.records.get('crmProjects/p/tasks/child').parentTaskId, 'a'); assert.equal(f.records.get('crmProjects/p/tasks/child').revision, 1);
    assert.equal(f.records.get('crmProjects/p').structureRevision, 2);
    assert.equal(f.log().filter(line => line === 'write:crmProjects/p/tasks/a').length, 1);
    await f.recovery.undoOperation({ uid: 'staff' }, 'p', 'move_batch', { operationId: 'undo_batch' });
    for (const id of ['a', 'b', 'c']) { assert.equal(f.records.get(`crmProjects/p/tasks/${id}`).parentTaskId, null); assert.equal(f.records.get(`crmProjects/p/tasks/${id}`).revision, 3); }
    assert.equal(f.records.get('crmProjects/p').structureRevision, 3);
});
test('cycles, overlapping roots, stale revisions and empty batches reject without writes', async () => {
    for (const overrides of [{ destination: { parentTaskId: 'child', expectedParentRevision: 1, index: 0 } }, { moves: ['a', 'child'].map(taskId => ({ taskId, expectedRevision: 1 })) }, { expectedStructureRevision: 0 }, { moves: [] }]) {
        const f = fixture(); await assert.rejects(() => f.move(overrides)); assert.equal(f.log().some(line => line.startsWith('write:')), false);
    }
});
test('Undo conflicts roll back the entire grouped move restoration', async () => {
    const f = fixture(); await f.move(); f.records.get('crmProjects/p/tasks/b').revision += 1; const before = structuredClone([...f.records]);
    await assert.rejects(() => f.recovery.undoOperation({ uid: 'staff' }, 'p', 'move_batch', { operationId: 'undo_batch' }), error => error.code === 'UNDO_CONFLICT'); assert.deepEqual([...f.records], before);
});
test('authorization reads precede receipt; synchronous consume occurs after execution and before canonical receipts; replay identity is fenced', async () => {
    const f = fixture(); const run = (replayed, consume) => f.command.runCommand({ actorUid: 'staff', projectId: 'p', command: 'confirmed', operationId: 'authorized', payload: { target: 'a' }, prepareAuthorization: async ({ transaction }) => { await transaction.get(f.db.collection('tickets').doc('one')); return { replayed, consume }; }, execute: async ({ transaction }) => { transaction.set(f.db.collection('results').doc('one'), { done: true }); return { result: { ok: true } }; } });
    await assert.rejects(() => run(false, () => { throw new Error('consume denied'); })); assert.equal(f.records.has('results/one'), false);
    await run(false, () => { f.log().push('consume'); }); const lines = f.log(); assert.ok(lines.indexOf('read:tickets/one') < lines.indexOf('read:crmProjectOperations/authorized')); assert.ok(lines.lastIndexOf('write:results/one') < lines.indexOf('consume')); assert.ok(lines.indexOf('consume') < lines.indexOf('write:crmProjectOperations/authorized'));
    await assert.rejects(() => run(false, () => {}), error => error.code === 'AUTHORIZATION_INTEGRITY'); assert.deepEqual(await run(true, () => { throw new Error('replay consumed twice'); }), { ok: true });
    f.records.delete('crmProjectOperations/authorized'); await assert.rejects(() => run(true, () => {}), error => error.code === 'AUTHORIZATION_INTEGRITY');
});
test('field preparation is read-only, rejects lifecycle/stale edits, preserves custom values and fences calendar changes', async () => {
    const f = fixture(); const changes = [{ taskId: 'a', expectedRevision: 1, patch: { title: 'new' } }]; let first;
    await f.db.runTransaction(async transaction => { first = await f.recovery.prepareFieldBatch({ transaction, actorUid: 'staff', projectId: 'p', changes }); assert.equal(f.log().some(line => line.startsWith('write:')), false); });
    f.records.set('crmProjectOrganizationConfig/calendar', { revision: 2 });
    await f.db.runTransaction(async transaction => { const next = await f.recovery.prepareFieldBatch({ transaction, actorUid: 'staff', projectId: 'p', changes }); assert.notEqual(next.fenceDigest, first.fenceDigest); next.flush(); assert.throws(() => next.flush()); });
    assert.equal(f.records.get('crmProjects/p/tasks/a').title, 'new');
    await assert.rejects(() => f.recovery.bulkUpdateTasks({ uid: 'staff' }, 'p', { operationId: 'stale', changes }));
    await assert.rejects(() => f.recovery.bulkUpdateTasks({ uid: 'staff' }, 'p', { operationId: 'life', changes: [{ taskId: 'b', expectedRevision: 1, patch: { lifecycle: 'archived' } }] }));
});

test('rank rebalancing writes each affected sibling once and grouped Undo restores original structural fields', async () => {
    const f = fixture();
    for (const name of ['left', 'right']) f.records.set(`crmProjects/p/tasks/${name}`, { projectId: 'p', title: name, lifecycle: 'active', revision: 1, parentTaskId: 'parent', rank: '0/1', values: {} });
    await f.move({ destination: { parentTaskId: 'parent', expectedParentRevision: 1, index: 1 } });
    const operation = f.records.get('crmProjectOperations/move_batch');
    assert.ok(operation.inverse.changes.some(row => row.id === 'left' || row.id === 'right'));
    for (const row of operation.inverse.changes) assert.equal(f.log().filter(line => line === `write:crmProjects/p/tasks/${row.id}`).length, 1);
    await f.recovery.undoOperation({ uid: 'staff' }, 'p', 'move_batch', { operationId: 'undo_rebalance' });
    for (const name of ['left', 'right']) { assert.equal(f.records.get(`crmProjects/p/tasks/${name}`).rank, '0/1'); assert.equal(f.records.get(`crmProjects/p/tasks/${name}`).parentTaskId, 'parent'); }
});
test('manual field batch retains unpatched archived values and preserves atomic rejection and legacy taskIds input', async () => {
    const f = fixture(); f.records.get('crmProjects/p/tasks/a').values = { archived: 'retained' };
    await f.recovery.bulkUpdateTasks({ uid: 'staff' }, 'p', { operationId: 'manual', taskIds: ['a'], expectedRevisions: { a: 1 }, patch: { title: 'changed' } });
    assert.deepEqual(f.records.get('crmProjects/p/tasks/a').values, { archived: 'retained' });
    const before = structuredClone([...f.records]);
    await assert.rejects(() => f.recovery.bulkUpdateTasks({ uid: 'staff' }, 'p', { operationId: 'partial', changes: [{ taskId: 'b', expectedRevision: 1, patch: { title: 'never' } }, { taskId: 'c', expectedRevision: 0, patch: { title: 'stale' } }] }));
    assert.deepEqual([...f.records], before);
});
test('field fences cover current schema, dependency graph without shifting dates', async () => {
    const f = fixture();
    f.records.get('crmProjects/p/tasks/a').startDate = '2026-09-08'; f.records.get('crmProjects/p/tasks/a').dueDate = '2026-09-09';
    const prepare = () => f.db.runTransaction(transaction => f.recovery.prepareFieldBatch({ transaction, actorUid: 'staff', projectId: 'p', changes: [{ taskId: 'a', expectedRevision: 1, patch: { title: 'planned' } }] }));
    const first = await prepare(); assert.equal(first.preview.schedule[0].startDate, '2026-09-08'); assert.equal(first.preview.schedule[0].dueDate, '2026-09-09');
    f.records.get('crmProjects/p/tasks/b').predecessorTaskIds = ['a'];
    const second = await prepare(); assert.notEqual(second.fenceDigest, first.fenceDigest); assert.ok(second.preview.schedule[0].warnings.some(row => row.code === 'DEPENDENCY_DATE_CONFLICT'));
    f.records.set('crmProjects/p/columns/number', { type: 'number', revision: 1 }); assert.notEqual((await prepare()).fenceDigest, second.fenceDigest);
});

test('authority fence is stable across reversed concurrent completion and duplicate reads, and fences missing documents', async () => {
    const f = fixture();
    f.records.set('profiles/staff', { role: 'staff', revision: 1 });
    f.records.set('workforce/staff', { active: true, revision: 2 });
    let duplicate = false;
    const originalAccess = f.accessService.assertTransactionContentAccess;
    f.accessService.assertTransactionContentAccess = async (transaction, ...args) => {
        await Promise.all(['profiles', 'workforce'].map(collection => transaction.get(f.db.collection(collection).doc('staff'))));
        if (duplicate) await transaction.get(f.db.collection('profiles').doc('staff'));
        await transaction.get(f.db.collection('optionalAuthority').doc('staff'));
        return originalAccess(transaction, ...args);
    };
    async function prepare(reverse) {
        const completed = [];
        const result = await f.db.runTransaction(async transaction => {
            let delayed = 0; const pending = [];
            const ordered = new Proxy(transaction, { get(target, key) {
                if (key === 'get') return async document => {
                    const snapshot = await target.get(document);
                    if (['profiles/staff', 'workforce/staff'].includes(document.path) && delayed < 2) {
                        delayed += 1;
                        await new Promise(resolve => {
                            pending.push(resolve);
                            if (pending.length === 2) queueMicrotask(() => { for (const release of reverse ? [...pending].reverse() : pending) release(); });
                        });
                        completed.push(document.path);
                    }
                    return snapshot;
                };
                const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
            } });
            return f.recovery.prepareFieldBatch({ transaction: ordered, actorUid: 'staff', projectId: 'p', changes: [{ taskId: 'a', expectedRevision: 1, patch: { title: 'planned' } }] });
        });
        return { ...result, completed };
    }
    const first = await prepare(false); const reversed = await prepare(true);
    assert.deepEqual(first.completed, ['profiles/staff', 'workforce/staff']);
    assert.deepEqual(reversed.completed, ['workforce/staff', 'profiles/staff']);
    assert.equal(reversed.fenceDigest, first.fenceDigest);
    duplicate = true;
    assert.equal((await prepare(true)).fenceDigest, first.fenceDigest);
    f.records.set('optionalAuthority/staff', {});
    assert.notEqual((await prepare(false)).fenceDigest, first.fenceDigest);
    assert.equal(f.log().some(line => line.startsWith('write:')), false);
});
