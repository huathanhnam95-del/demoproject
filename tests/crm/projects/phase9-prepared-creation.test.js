'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectsCommandService } = require('../../../functions/src/crm/projects/domain/command-service');
const { createProjectsRecoveryService } = require('../../../functions/src/crm/projects/recovery-service');
const { memberDocumentId } = require('../../../functions/src/crm/projects/access-service');
function fixture() {
    const records = new Map(), writes = []; let transactions = 0, instant = new Date('2026-09-08T00:00:00Z');
    function ref(path, filters = [], cap = Infinity) { return { path, id: path.split('/').pop(), filters, cap,
        doc: id => ref(`${path}/${id}`), collection: id => ref(`${path}/${id}`), limit: count => ref(path, filters, count),
        where: (field, operator, value) => { assert.equal(operator, '=='); return ref(path, [...filters, [field, value]], cap); }, async get() { return snapshot(this); } }; }
    function snapshot(target) {
        if (target.path.split('/').length % 2 === 0) return { ref: target, id: target.id, exists: records.has(target.path), data: () => structuredClone(records.get(target.path)) };
        const docs = [...records.keys()].filter(path => path.startsWith(`${target.path}/`) && path.split('/').length === target.path.split('/').length + 1)
            .map(path => snapshot(ref(path))).filter(doc => target.filters.every(([field, value]) => doc.data()[field] === value)).slice(0, target.cap);
        return { docs, size: docs.length };
    }
    const db = { collection: ref, async runTransaction(work) {
        transactions++; const staged = []; let writing = false;
        const tx = { async get(target) { assert.equal(writing, false, 'reads must precede actual writes'); return snapshot(target); },
            set(target, data, options) { writing = true; writes.push(target.path); staged.push([target.path, structuredClone(data), options]); },
            create(target, data) { assert.equal(records.has(target.path), false); this.set(target, data); } };
        const result = await work(tx); for (const [path, data, options] of staged) records.set(path, options?.merge ? { ...records.get(path), ...data } : data); return result;
    } };
    for (const uid of ['staff', 'other']) { records.set(`users/${uid}`, { role: 'staff', revision: 1 }); records.set(`crmWorkforceAccounts/${uid}`, { active: true, revision: 1 }); }
    const accessService = {
        async assertTransactionEligible(tx, uid) { const [profile, workforce] = await Promise.all([tx.get(ref(`users/${uid}`)), tx.get(ref(`crmWorkforceAccounts/${uid}`))]); if (!profile.exists || !workforce.data()?.active) throw Object.assign(Error('denied'), { code: 'FORBIDDEN' }); return { uid, profile: profile.data(), workforce: workforce.data() }; },
        async assertTransactionContentAccess(tx, uid, projectId, options = {}) {
            const identity = await this.assertTransactionEligible(tx, uid); const project = await tx.get(ref(`crmProjects/${projectId}`)); const member = await tx.get(ref(`crmProjectMembers/${memberDocumentId(projectId, uid)}`));
            const role = member.data()?.role; if (!project.exists || !member.exists || member.data().active === false || options.owner && role !== 'Owner' || options.write && !['Owner', 'Editor'].includes(role)) throw Object.assign(Error('denied'), { code: 'FORBIDDEN' });
            return { identity, role, project: { id: projectId, data: project.data(), ref: ref(`crmProjects/${projectId}`) }, membership: { data: member.data() } };
        }
    };
    records.set('crmProjects/p', { projectId: 'p', name: 'Existing', ownerUid: 'staff', lifecycle: 'active', revision: 1, structureRevision: 1, schemaRevision: 1, contentRevision: 0, membershipRevision: 1 });
    records.set('crmProjects/p/sections/s', { projectId: 'p', lifecycle: 'active', revision: 1 });
    for (const uid of ['staff', 'other']) records.set(`crmProjectMembers/${memberDocumentId('p', uid)}`, { projectId: 'p', uid, active: true, role: 'Owner', revision: 1 });
    const command = createProjectsCommandService({ db, accessService, now: () => instant });
    const recovery = createProjectsRecoveryService({ db, accessService, commandService: command, now: () => instant });
    const taskPayload = { operationId: 'create-task', title: 'Created', sectionId: 's', expectedStructureRevision: 1 };
    return { records, writes, db, command, recovery, accessService, taskPayload, transactions: () => transactions, time: value => { instant = new Date(value); }, ref };
}
const prep = (f, method, payload, projectId = 'p') => f.db.runTransaction(transaction => f.command[method]({ transaction, actorUid: 'staff', projectId, payload }));

test('all three canonical preparers perform zero writes or nested transactions and flush exactly once', async () => {
    for (const [method, payload] of [['prepareCreateProject', { operationId: 'new-project', name: 'New' }], ['prepareCreateTask', { operationId: 'new-task', title: 'New', sectionId: 's', expectedStructureRevision: 1 }], ['prepareUpdateProject', { operationId: 'edit', name: 'Renamed', expectedRevision: 1 }]]) {
        const f = fixture(); const before = structuredClone([...f.records]); const prepared = await prep(f, method, payload);
        assert.equal(f.transactions(), 1); assert.deepEqual([...f.records], before); assert.equal(f.writes.length, 0); assert.match(prepared.fenceDigest, /^[a-f0-9]{64}$/);
        await f.command.runCommand({ actorUid: 'staff', projectId: method === 'prepareCreateProject' ? prepared.preview.projectId : 'p', creation: method === 'prepareCreateProject', command: 'applyAiDraft', operationId: 'apply', payload: {}, execute: async ({ transaction }) => {
            const current = await f.command[method]({ transaction, actorUid: 'staff', projectId: 'p', payload }); assert.equal(current.fenceDigest, prepared.fenceDigest);
            const result = current.flush(); assert.throws(() => current.flush(), error => error.code === 'PREPARED_COMMAND_INTEGRITY'); return result;
        } });
        assert.equal(f.transactions(), 2); assert.ok(f.records.has('crmProjectOperations/apply')); assert.equal(f.records.has(`crmProjectOperations/${payload.operationId}`), false);
    }
});

test('manual and prepared commands have identical domain writes and executed results', async () => {
    for (const [method, manual, payload, key] of [['prepareCreateProject', 'createProject', { operationId: 'project', name: 'Project', description: 'Description' }, 'project'], ['prepareCreateTask', 'createTask', { operationId: 'task', title: 'Task', sectionId: 's', expectedStructureRevision: 1, ownerUid: 'other', dueDate: '2026-10-01' }, 'task'], ['prepareUpdateProject', 'updateProject', { operationId: 'update', expectedRevision: 1, description: 'new' }, 'project']]) {
        const a = fixture(), b = fixture();
        const result = manual === 'createProject' ? await a.command[manual]({ uid: 'staff' }, payload) : await a.command[manual]({ uid: 'staff' }, 'p', payload);
        let executed; await b.db.runTransaction(async transaction => { executed = (await b.command[method]({ transaction, actorUid: 'staff', projectId: 'p', payload })).flush(); });
        assert.deepEqual(executed.result, result);
        const target = key === 'task' ? `crmProjects/p/tasks/${result.task.id}` : `crmProjects/${result.project.id}`;
        const manualData = { ...a.records.get(target) };
        assert.deepEqual(b.records.get(target), manualData);
        assert.equal(b.records.has(`crmProjectOperations/${payload.operationId}`), false);
    }
});

test('fences exclude generated timestamps and include schema, assignment authority, graph and canonical input', async () => {
    const f = fixture(), payload = { ...f.taskPayload, ownerUid: 'other' }; const first = await prep(f, 'prepareCreateTask', payload);
    f.time('2026-09-09T00:00:00Z'); assert.equal((await prep(f, 'prepareCreateTask', payload)).fenceDigest, first.fenceDigest);
    for (const [path, patch] of [['users/other', { displayName: 'Changed' }], ['crmProjects/p/columns/x', { projectId: 'p', type: 'text', revision: 1 }], ['crmProjects/p/tasks/unrelated', { projectId: 'p', parentTaskId: null, sectionId: 's', lifecycle: 'active', rank: '2/1', revision: 1 }]]) {
        const before = (await prep(f, 'prepareCreateTask', payload)).fenceDigest; f.records.set(path, { ...f.records.get(path), ...patch });
        assert.notEqual((await prep(f, 'prepareCreateTask', payload)).fenceDigest, before);
    }
    assert.notEqual((await prep(f, 'prepareCreateTask', { ...payload, title: 'changed' })).fenceDigest, (await prep(f, 'prepareCreateTask', payload)).fenceDigest);
    const withoutRegistry = (await prep(f, 'prepareCreateTask', payload)).fenceDigest;
    f.records.set('crmProjectAutomationRegistries/p', { revision: 2, versions: [] }); assert.notEqual((await prep(f, 'prepareCreateTask', payload)).fenceDigest, withoutRegistry);
    f.records.get('crmWorkforceAccounts/other').active = false; await assert.rejects(prep(f, 'prepareCreateTask', payload), error => error.code === 'FORBIDDEN'); assert.equal(f.writes.length, 0);
});

test('fences are deterministic across parallel read completion order and retain known missing records', async () => {
    const f = fixture(); const original = f.accessService.assertTransactionEligible;
    let reverse = false;
    f.accessService.assertTransactionEligible = async function (tx, uid) {
        await Promise.all((reverse ? ['missing-b', 'missing-a'] : ['missing-a', 'missing-b']).map(async (name, index) => { await new Promise(resolve => setTimeout(resolve, index)); await tx.get(f.ref(`authority/${name}`)); }));
        return original.call(this, tx, uid);
    };
    const first = await prep(f, 'prepareCreateTask', f.taskPayload); reverse = true;
    assert.equal((await prep(f, 'prepareCreateTask', f.taskPayload)).fenceDigest, first.fenceDigest);
    f.records.set('authority/missing-a', { revision: 1 }); assert.notEqual((await prep(f, 'prepareCreateTask', f.taskPayload)).fenceDigest, first.fenceDigest);
});

test('missing transaction and client preparation options cannot perform writes or bypass normal command validation', async () => {
    const f = fixture(); assert.throws(() => f.command.prepareCreateProject({ actorUid: 'staff', payload: { operationId: 'p', name: 'P' } }), error => error.code === 'PREPARATION_TRANSACTION_REQUIRED');
    await assert.rejects(f.command.createProject({ uid: 'staff' }, { operationId: 'p', name: 'P', preparationTransaction: {} })); assert.equal(f.records.has('crmProjects/project-p'), false); assert.equal(f.writes.length, 0);
});

test('prepared preview strips CRM references and stale or invalid canonical input never stages writes', async () => {
    const f = fixture(); f.records.get('crmProjects/p').crmLinks = [{ secret: 'private' }];
    const prepared = await prep(f, 'prepareUpdateProject', { operationId: 'update', expectedRevision: 1, name: 'New' }); assert.equal(JSON.stringify(prepared.preview).includes('private'), false);
    for (const payload of [{ ...f.taskPayload, expectedStructureRevision: 0 }, { ...f.taskPayload, parentTaskId: 'missing' }, { ...f.taskPayload, ownerUid: 'unknown' }, { ...f.taskPayload, values: { unknown: 1 } }]) await assert.rejects(prep(f, 'prepareCreateTask', payload));
    assert.equal(f.writes.length, 0);
});

test('task creation Undo archives history and restores rebalanced siblings once', async () => {
    const f = fixture();
    for (const name of ['left', 'right']) f.records.set(`crmProjects/p/tasks/${name}`, { projectId: 'p', title: name, parentTaskId: null, sectionId: 's', lifecycle: 'active', rank: '0/1', revision: 1 });
    const result = await f.command.createTask({ uid: 'staff' }, 'p', { ...f.taskPayload, index: 1 }); const operation = f.records.get('crmProjectOperations/create-task'); assert.ok(operation.inverse.rebalanceBefore.length > 0);
    await f.recovery.undoOperation({ uid: 'staff' }, 'p', 'create-task', { operationId: 'undo' });
    assert.equal(f.records.get(`crmProjects/p/tasks/${result.task.id}`).lifecycle, 'archived'); assert.equal(f.records.get('crmProjects/p').structureRevision, 3);
    for (const name of ['left', 'right']) assert.equal(f.records.get(`crmProjects/p/tasks/${name}`).rank, '0/1');
    assert.ok(f.records.has('crmProjectOperations/create-task')); assert.ok(f.records.has('crmProjectEvents/undo'));
    const after = structuredClone([...f.records]); await f.recovery.undoOperation({ uid: 'staff' }, 'p', 'create-task', { operationId: 'undo' }); assert.deepEqual([...f.records], after);
});

test('task creation Undo rejects edits, dependents and later discussion without partial writes', async () => {
    for (const change of ['edit', 'dependent', 'discussion', 'attachment', 'links', 'structure']) {
        const f = fixture(); const { task } = await f.command.createTask({ uid: 'staff' }, 'p', f.taskPayload);
        if (change === 'edit') f.records.get(`crmProjects/p/tasks/${task.id}`).revision++;
        if (change === 'dependent') f.records.set('crmProjects/p/tasks/dependent', { projectId: 'p', revision: 1, predecessorTaskIds: [task.id] });
        if (change === 'discussion') f.records.set('crmProjects/p/discussions/message', { taskId: task.id });
        if (change === 'attachment') f.records.set('crmProjects/p/attachments/file', { taskId: task.id });
        if (change === 'links') f.records.set(`crmProjects/p/taskLinks/${task.id}`, { links: [] });
        if (change === 'structure') f.records.get('crmProjects/p').structureRevision++;
        const before = structuredClone([...f.records]); await assert.rejects(f.recovery.undoOperation({ uid: 'staff' }, 'p', 'create-task', { operationId: 'undo' }), error => error.code === 'UNDO_CONFLICT'); assert.deepEqual([...f.records], before);
    }
});

test('project creation Undo archives an unchanged empty project and preserves Owner membership', async () => {
    const f = fixture(); const { project } = await f.command.createProject({ uid: 'staff' }, { operationId: 'new', name: 'New' });
    const membership = structuredClone(f.records.get(`crmProjectMembers/${memberDocumentId(project.id, 'staff')}`));
    await f.recovery.undoOperation({ uid: 'staff' }, project.id, 'new', { operationId: 'undo' });
    assert.equal(f.records.get(`crmProjects/${project.id}`).lifecycle, 'archived'); assert.equal(f.records.get(`crmProjects/${project.id}`).revision, 2);
    assert.deepEqual(f.records.get(`crmProjectMembers/${memberDocumentId(project.id, 'staff')}`), membership); assert.ok(f.records.has('crmProjectOperations/new'));
});

test('project creation Undo denies added content/membership and project metadata Undo requires Owner under applyAiDraft', async () => {
    for (const change of ['content', 'member', 'edit']) {
        const f = fixture(); const { project } = await f.command.createProject({ uid: 'staff' }, { operationId: 'new', name: 'New' });
        if (change === 'content') f.records.set(`crmProjects/${project.id}/sections/s`, { projectId: project.id });
        if (change === 'member') f.records.set(`crmProjectMembers/${memberDocumentId(project.id, 'other')}`, { projectId: project.id, uid: 'other', active: true, role: 'Viewer', revision: 1 });
        if (change === 'edit') f.records.get(`crmProjects/${project.id}`).name = 'Later';
        const before = structuredClone([...f.records]); await assert.rejects(f.recovery.undoOperation({ uid: 'staff' }, project.id, 'new', { operationId: 'undo' }), error => error.code === 'UNDO_CONFLICT'); assert.deepEqual([...f.records], before);
    }
    const f = fixture(); await f.command.runCommand({ actorUid: 'staff', projectId: 'p', command: 'applyAiDraft', operationId: 'ai', payload: {}, execute: async ({ transaction }) => (await f.command.prepareUpdateProject({ transaction, actorUid: 'staff', projectId: 'p', payload: { operationId: 'edit', name: 'Changed', expectedRevision: 1 } })).flush() });
    f.records.get(`crmProjectMembers/${memberDocumentId('p', 'staff')}`).role = 'Editor';
    await assert.rejects(f.recovery.undoOperation({ uid: 'staff' }, 'p', 'ai', { operationId: 'undo' }), error => error.code === 'PROJECT_OWNER_REQUIRED');
    f.records.get(`crmProjectMembers/${memberDocumentId('p', 'staff')}`).role = 'Owner'; await f.recovery.undoOperation({ uid: 'staff' }, 'p', 'ai', { operationId: 'undo' }); assert.equal(f.records.get('crmProjects/p').name, 'Existing');
});

test('prepared creation rolls back with failed proof consumption and exact replay creates one project/receipt', async () => {
    const f = fixture(), payload = { operationId: 'stable-create', name: 'One project' };
    const preview = await prep(f, 'prepareCreateProject', payload); let failConsumption = true;
    const run = () => f.command.runCommand({ actorUid: 'staff', projectId: preview.preview.projectId, creation: true, command: 'applyAiDraft', operationId: 'confirmed-create', payload: { previewId: 'immutable' },
        prepareAuthorization: async ({ transaction }) => { const proof = await transaction.get(f.ref('proofs/one')); return { replayed: proof.exists, consume() { if (failConsumption) throw Error('proof rejected'); transaction.set(f.ref('proofs/one'), { consumed: true }); } }; },
        execute: async ({ transaction }) => { const current = await f.command.prepareCreateProject({ transaction, actorUid: 'staff', payload }); assert.equal(current.fenceDigest, preview.fenceDigest); return current.flush(); } });
    const before = structuredClone([...f.records]); await assert.rejects(run(), /proof rejected/); assert.deepEqual([...f.records], before);
    failConsumption = false; const created = await run(); const after = structuredClone([...f.records]); assert.deepEqual(await run(), created); assert.deepEqual([...f.records], after);
    assert.equal([...f.records.keys()].filter(path => path === `crmProjects/${created.project.id}`).length, 1); assert.equal(f.records.has('crmProjectOperations/stable-create'), false);
});

test('creation Undo receipt replay rechecks current Owner authority', async () => {
    const f = fixture(); const { project } = await f.command.createProject({ uid: 'staff' }, { operationId: 'new-replay', name: 'New' }); const undo = () => f.recovery.undoOperation({ uid: 'staff' }, project.id, 'new-replay', { operationId: 'undo-replay' });
    const result = await undo(); assert.deepEqual(await undo(), result); f.records.get('crmProjectMembers/' + memberDocumentId(project.id, 'staff')).role = 'Editor'; await assert.rejects(undo(), { code: 'PROJECT_OWNER_REQUIRED' });
});
