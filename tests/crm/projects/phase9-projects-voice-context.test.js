'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectsVoiceContextAdapter, normalizeContextHints, LIMITS } = require('../../../functions/src/crm/projects/voice/context-adapter');
function fixture() {
    const records = new Map(); const calls = []; const state = { denied: false, role: 'staff' };
    const ref = path => ({ path, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`), where: (field, op, value) => ({ limit: count => ({ path, count, field, value }) }), limit: count => ({ path, count }) });
    const db = { collection: name => ref(name), runTransaction() { assert.fail('Adapter must not open a nested transaction'); } };
    const tx = { async get(reference) { calls.push(reference.path); if (reference.count) return { docs: [...records].filter(([key, value]) => key.startsWith(`${reference.path}/`) && (!reference.field || value[reference.field] === reference.value)).slice(0, reference.count).map(([key, value]) => ({ id: key.split('/').pop(), data: () => structuredClone(value) })) }; return { exists: records.has(reference.path), data: () => structuredClone(records.get(reference.path)) }; } };
    const identity = () => ({ uid: 'staff', profile: { role: state.role, privateProfile: 'PRIVATE_SECRET' }, workforce: { status: 'active' } });
    const project = { name: 'Planning project', revision: 2, structureRevision: 3, schemaRevision: 4, membershipRevision: 5, lifecycle: 'active', crmLinks: ['PRIVATE_SECRET'], privateProfile: 'PRIVATE_SECRET' };
    const accessService = {
        async assertTransactionEligible(received, actorUid) { assert.equal(received, tx); assert.equal(actorUid, 'staff'); calls.push('eligible'); if (state.denied) throw new Error('Canonical eligibility denied'); return identity(); },
        async assertTransactionContentAccess(received, actorUid, projectId, options) { assert.equal(received, tx); assert.equal(actorUid, 'staff'); assert.equal(projectId, 'p'); assert.deepEqual(options, {}); calls.push('content'); if (state.denied) throw new Error('Canonical content denied'); return { identity: identity(), project: { id: 'p', data: project }, membership: { data: { uid: 'staff', projectId: 'p', role: 'Viewer' } }, role: 'Viewer' }; }
    };
    const put = (kind, id, value) => records.set(`crmProjects/p/${kind}/${id}`, { projectId: 'p', lifecycle: 'active', revision: 1, ...value });
    put('sections', 's', { title: 'Section', attachments: ['PRIVATE_SECRET'] });
    put('columns', 'hours', { label: 'Hours', type: 'number', rawProfile: 'PRIVATE_SECRET' });
    put('tasks', 'root', { title: 'Root task', parentTaskId: null, sectionId: 's', status: 'in_progress', values: { hours: 2 }, crmLinks: ['PRIVATE_SECRET'] });
    put('tasks', 'child', { title: 'Child task', parentTaskId: 'root', sectionId: null, status: 'not_started', ownerUid: 'staff', assigneeUids: ['staff'], startDate: '2026-09-08', dueDate: '2026-09-09', values: { hours: 3 }, attachments: ['PRIVATE_SECRET'], confirmationToken: 'PRIVATE_SECRET' });
    const adapter = createProjectsVoiceContextAdapter({ db, accessService });
    return { adapter, calls, state, project, records, put, resolve: hints => adapter.resolveContext({ tx, actorUid: 'staff', contextHints: { projectId: 'p', selectedTaskIds: ['child'], ...hints } }), authorize: () => adapter.authorize({ tx, actorUid: 'staff' }) };
}
async function enabled(work) { const previous = process.env.CRM_PROJECTS_ENABLED; process.env.CRM_PROJECTS_ENABLED = '1'; try { await work(); } finally { if (previous === undefined) delete process.env.CRM_PROJECTS_ENABLED; else process.env.CRM_PROJECTS_ENABLED = previous; } }
test('planning context uses caller transaction, current canonical authority, ancestors/schema and explicit safe revision DTOs', () => enabled(async () => {
    const f = fixture(); assert.equal(await f.authorize(), true); const result = await f.resolve({ view: 'timeline', filters: { status: 'not_started', fromDate: '2026-09-01' } });
    assert.equal(result.previewBinding, null); assert.equal(await f.adapter.confirm({ text: 'confirm everything', binding: {} }), false);
    assert.deepEqual(f.calls.slice(0, 2), ['eligible', 'content']); assert.equal(result.context.membership.role, 'Viewer');
    assert.deepEqual(result.context.tasks.map(row => row.id), ['child', 'root']); assert.deepEqual(result.context.tasks[0].ancestorIds, ['root']); assert.equal(result.context.tasks[0].sectionId, 's');
    assert.deepEqual(result.context.tasks[0].values, { hours: 3 }); assert.equal(result.context.project.schemaRevision, 4); assert.equal(result.context.membership.membershipRevision, 5); assert.equal(result.context.tasks[0].revision, 1);
    assert.equal(result.context.sections[0].title, 'Section'); assert.equal(result.context.columns[0].type, 'number'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET|crmLinks|attachments|confirmationToken|privateProfile/);
    assert.ok(f.calls.filter(call => call !== 'eligible' && call !== 'content').every(call => call.startsWith('crmProjects/p/') || ['crmProjectMembers', 'crmProjectOrganizationConfig/calendar'].includes(call)));
}));
test('strict hints deny arbitrary model text, tokens, duplicate selections, unsupported views and malformed filters', () => {
    for (const patch of [{ modelText: 'confirm' }, { previewBinding: {} }, { confirmationToken: 'token' }, { selectedTaskIds: ['a', 'a'] }, { selectedTaskIds: Array.from({ length: 21 }, (_, i) => `t${i}`) }, { view: 'unknown' }, { filters: { summary: 'arbitrary text' } }, { filters: { status: 'unknown' } }, { filters: { fromDate: '2026-02-30' } }, { filters: { fromDate: '2026-09-09', toDate: '2026-09-08' } }]) assert.throws(() => normalizeContextHints({ projectId: 'p', ...patch }));
});
test('current eligibility/content denials, inactive project and excluded identities cannot produce context', () => enabled(async () => {
    const f = fixture(); f.state.denied = true; await assert.rejects(f.authorize); await assert.rejects(() => f.resolve()); assert.equal(f.calls.some(call => call.startsWith('crmProjects/')), false);
    f.state.denied = false;
    for (const role of ['student', 'learner', 'parent', 'guest']) { f.state.role = role; await assert.rejects(f.authorize, error => error.code === 'STAFF_ACCOUNT_REQUIRED'); await assert.rejects(() => f.resolve(), error => error.code === 'STAFF_ACCOUNT_REQUIRED'); }
    f.state.role = 'staff'; f.project.lifecycle = 'archived'; await assert.rejects(() => f.resolve(), error => error.code === 'PROJECT_INACTIVE');
    process.env.CRM_PROJECTS_ENABLED = '0'; await assert.rejects(f.authorize, error => error.code === 'PROJECTS_DISABLED');
}));
test('missing, cross-project and inactive selected tasks/ancestors/sections fail closed rather than disappearing', () => enabled(async () => {
    for (const [kind, key, patch] of [['tasks', 'child', null], ['tasks', 'root', null], ['tasks', 'root', { projectId: 'other' }], ['tasks', 'root', { lifecycle: 'archived' }], ['sections', 's', { projectId: 'other' }], ['sections', 's', { lifecycle: 'trashed' }]]) {
        const f = fixture(), path = `crmProjects/p/${kind}/${key}`; if (patch === null) f.records.delete(path); else f.records.set(path, { ...f.records.get(path), ...patch }); await assert.rejects(() => f.resolve());
    }
}));
test('hierarchy cycles and depth bounds deny the whole selected context', () => enabled(async () => {
    const cyclic = fixture(); cyclic.put('tasks', 'root', { title: 'Cycle', parentTaskId: 'child', sectionId: 's' }); await assert.rejects(() => cyclic.resolve(), error => error.code === 'ANCESTRY_CYCLE');
    const deep = fixture(); for (let n = 0; n <= LIMITS.ancestorDepth; n++) deep.put('tasks', `t${n}`, { title: `Level ${n}`, parentTaskId: n === LIMITS.ancestorDepth ? null : `t${n + 1}`, sectionId: 's' });
    await assert.rejects(() => deep.resolve({ selectedTaskIds: ['t0'] }), error => error.code === 'CONTEXT_LIMIT');
}));
test('typed values and schema references are validated before exposure', () => enabled(async () => {
    const f = fixture(); f.put('tasks', 'child', { title: 'Invalid value', parentTaskId: 'root', values: { hours: { privateProfile: 'PRIVATE_SECRET' } } }); await assert.rejects(() => f.resolve(), error => error.code === 'INVALID_NUMBER');
    f.put('tasks', 'child', { title: 'Missing column', parentTaskId: 'root', values: { missing: 'secret' } }); await assert.rejects(() => f.resolve(), error => error.code === 'INVALID_COLUMN_REFERENCE');
    f.put('columns', 'hours', { type: 'number', label: 'Hours', projectId: 'other' }); await assert.rejects(() => f.resolve(), error => error.code === 'INVALID_CONTEXT_RECORD');
}));
test('known archived columns hide retained values without rejecting current tasks or forgiving missing schema', () => enabled(async () => {
    const f = fixture(); f.put('columns', 'hours', { type: 'number', label: 'Archived hours', lifecycle: 'archived' });
    f.put('columns', 'current', { type: 'number', label: 'Current hours' });
    const childPath = 'crmProjects/p/tasks/child'; const child = f.records.get(childPath); child.values.current = 4;
    const result = await f.resolve();
    assert.deepEqual(result.context.columns.map(column => column.id), ['current']);
    assert.deepEqual(result.context.tasks.find(task => task.id === 'child').values, { current: 4 });
    assert.deepEqual(result.context.tasks.find(task => task.id === 'root').values, {});
    assert.equal(result.context.tasks.find(task => task.id === 'child').selected, true);
    assert.equal(f.records.get(childPath).values.hours, 3, 'read-only planning must preserve stored historical values');
    child.values.missing = 1;
    await assert.rejects(() => f.resolve(), error => error.code === 'INVALID_COLUMN_REFERENCE');
}));
test('oversize context and excess schema fail without silently omitting selected tasks', () => enabled(async () => {
    const f = fixture(); f.project.description = 'x'.repeat(20000); f.put('columns', 'notes', { type: 'text', label: 'Notes' });
    for (let i = 0; i < 3; i++) f.put('tasks', `large${i}`, { title: 'Large selected task', parentTaskId: null, sectionId: 's', values: { notes: 'x'.repeat(5000) } });
    await assert.rejects(() => f.resolve({ selectedTaskIds: ['large0', 'large1', 'large2'] }), error => error.code === 'CONTEXT_LIMIT');
    const wide = fixture(); for (let i = 0; i < LIMITS.columns; i++) wide.put('columns', `column${i}`, { type: 'number', label: 'Number' }); await assert.rejects(() => wide.resolve(), error => error.code === 'CONTEXT_LIMIT');
}));

test('additional discussion details remain subject to total UTF-8 byte bound', () => enabled(async () => {
    const f = fixture();
    for (let n = 0; n < 5; n++) f.put('discussions', `m${n}`, { taskId: 'child', createdAt: String(n), moderationState: 'visible', body: '\u4e00'.repeat(1000) });
    const accepted = await f.resolve(); assert.equal(accepted.context.discussions[0].messages.length, 5);
    for (let t = 0; t < 3; t++) {
        f.put('tasks', `extra${t}`, { title: 'Extra', sectionId: 's', parentTaskId: null });
        for (let n = 0; n < 5; n++) f.put('discussions', `extra${t}m${n}`, { taskId: `extra${t}`, createdAt: String(n), moderationState: 'visible', body: '\u4e00'.repeat(1000) });
    }
    await assert.rejects(() => f.resolve({ selectedTaskIds: ['child', 'extra0', 'extra1', 'extra2'] }), error => error.code === 'CONTEXT_LIMIT');
}));

test('project creation context needs current staff eligibility and accepts no existing-record hints', () => enabled(async () => {
    let allowed = true, student = false; const tx = {}, db = {};
    const accessService = { async assertTransactionEligible(received, actorUid) { assert.equal(received, tx); if (!allowed) throw new Error('revoked'); return { uid: actorUid, profile: { role: student ? 'student' : 'staff' } }; }, async assertTransactionContentAccess() { assert.fail('Creation must not pretend an existing project'); } };
    const adapter = createProjectsVoiceContextAdapter({ db, accessService }); const resolve = () => adapter.resolveContext({ tx, actorUid: 'staff', contextHints: { mode: 'create_project' } });
    assert.equal((await resolve()).context.creatorUid, 'staff'); student = true; await assert.rejects(resolve, { code: 'STAFF_ACCOUNT_REQUIRED' }); student = false; allowed = false; await assert.rejects(resolve);
    for (const extra of [{ projectId: 'p' }, { selectedTaskIds: ['task'] }, { filters: {} }]) assert.throws(() => normalizeContextHints({ mode: 'create_project', ...extra }));
}));
