'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectPreview } = require('../../../functions/src/crm/projects/automation/preview-projection');
const { validateReferences } = require('../../../functions/src/crm/projects/automation/references');
const { validateDefinition } = require('../../../functions/src/crm/projects/automation/definition');
const { normalizeListFilters, matchesListFilters } = require('../../../functions/src/crm/projects/automation/rule-service');
const { memberDocumentId } = require('../../../functions/src/crm/projects/access-service');
const notify = (nodeId = 'notify') => ({ nodeId, type: 'notify', payload: { message: 'Please review', recipients: 'task_owner' } });
const assign = (ownerUid = 'new-owner') => ({ nodeId: 'assign', type: 'assign', payload: { target: 'trigger_task', ownerUid, assigneeUids: [] } });
const definition = steps => ({ schemaVersion: 1, trigger: { type: 'status_changed' }, steps });
const source = ownerUid => ({ t: { title: 'Sample', status: 'in_progress', ownerUid, assigneeUids: [], parentTaskId: null, sectionId: 's', values: {}, crmLinks: [{ secret: 'PRIVATE_LINK' }] } });
test('ordered assign then notify resolves initially missing and changed owner without mutating inputs', () => {
    for (const owner of [null, 'old-owner']) {
        const tasks = source(owner); const original = JSON.stringify(tasks);
        const output = projectPreview({ definition: definition([assign(), notify()]), sampleTaskId: 't', tasks });
        assert.deepEqual(output.effects[0].changes[0], { field: 'ownerUid', before: owner, after: 'new-owner' });
        assert.deepEqual(output.effects[1].recipientUids, ['new-owner']); assert.equal(output.effects[1].sequence, 2); assert.equal(output.effects[1].path, '/notify');
        assert.equal(JSON.stringify(tasks), original); assert.ok(!JSON.stringify(output).includes('PRIVATE_LINK'));
    }
});
test('pre-delay branches keep triggering snapshot while sequential effects track current sample fields', () => {
    const value = definition([{ nodeId: 'status', type: 'set_field', payload: { target: 'trigger_task', patch: { status: 'done' } } }, { nodeId: 'branch', type: 'if', condition: { field: 'status', operator: 'equals', value: 'done' }, then: [notify('wrong')], else: [assign(), notify()] }]);
    const output = projectPreview({ definition: value, sampleTaskId: 't', tasks: source(null) });
    assert.deepEqual(output.effects.map(e => e.path), ['/status', '/branch/else/assign', '/branch/else/notify']);
    assert.deepEqual(output.effects[2].recipientUids, ['new-owner']);
});
test('delay labels later projected branch/effects provisional and no-match emits no effects', () => {
    const value = definition([assign(), { nodeId: 'pause', type: 'delay', payload: { durationMs: 1000 } }, { nodeId: 'branch', type: 'if', condition: { field: 'ownerUid', operator: 'equals', value: 'new-owner' }, then: [notify()], else: [] }]);
    const output = projectPreview({ definition: value, sampleTaskId: 't', tasks: source(null) });
    assert.deepEqual(output.effects.map(e => e.provisional), [false, false, true]); assert.equal(output.warnings.length, 1);
    const unmatched = projectPreview({ definition: { ...value, condition: { field: 'status', operator: 'equals', value: 'done' } }, sampleTaskId: 't', tasks: source(null) });
    assert.equal(unmatched.conditionMatched, false); assert.deepEqual(unmatched.effects, []);
});
test('projection keeps safe explicit target, typed changes and subtree root destination', () => {
    const tasks = { ...source('owner'), child: { title: 'Child', parentTaskId: 't', values: { score: 2 } } };
    const value = definition([{ nodeId: 'field', type: 'set_field', payload: { target: { taskId: 'child' }, patch: { values: { score: 3 } } } }, { nodeId: 'move', type: 'move_section', payload: { target: { taskId: 'child' }, sectionId: 'other' } }]);
    const output = projectPreview({ definition: value, sampleTaskId: 't', tasks, sections: { other: { title: 'Destination' } } });
    assert.deepEqual(output.effects[0].target, { taskId: 'child', label: 'Child' }); assert.deepEqual(output.effects[0].changes, [{ field: 'values.score', before: 2, after: 3 }]);
    assert.deepEqual(output.effects[1].section, { sectionId: 'other', label: 'Destination' }); assert.ok(output.warnings[0].includes('leaving its current parent'));
});
function referenceFixture(ownerUid) {
    const records = new Map([['crmProjects/p', { lifecycle: 'active' }], ['crmProjects/p/tasks/t', { ...source(ownerUid).t, projectId: 'p', lifecycle: 'active' }], ['crmProjects/p/sections/s', { title: 'Section', lifecycle: 'active' }], [`crmProjectMembers/${memberDocumentId('p', 'new-owner')}`, { uid: 'new-owner', projectId: 'p', active: true, role: 'Editor' }]]);
    const collection = path => ({ doc: key => document(`${path}/${key}`), limit: () => ({ collectionPath: path }) });
    const document = path => ({ path, collection: name => collection(`${path}/${name}`) }); const db = { doc: document, collection };
    const transaction = { async get(reference) { if (reference.collectionPath) return { docs: [] }; return { ref: reference, exists: records.has(reference.path), data: () => records.get(reference.path) }; }, set() { throw new Error('Preview must not write'); }, update() { throw new Error('Preview must not write'); } };
    const accessService = { async assertTransactionContentAccess() { return { project: { data: records.get('crmProjects/p') } }; }, async assertTransactionEligible() { return {}; } };
    return { db, transaction, accessService, projectId: 'p', actorUid: 'actor', sampleTaskId: 't' };
}
test('reference validation uses reached ordered recipients without any task writes', async () => {
    const fixture = referenceFixture(null); const value = validateDefinition(definition([assign(), notify()]));
    const checked = await validateReferences(fixture.transaction, { ...fixture, definition: value });
    assert.deepEqual(checked.projection.effects[1].recipientUids, ['new-owner']);
    await assert.rejects(() => validateReferences(fixture.transaction, { ...fixture, definition: definition([notify()]) }), error => error.code === 'BROKEN_REFERENCE');
});
test('unreached dynamic notification is allowed; unreached explicit broken reference still fails', async () => {
    const fixture = referenceFixture(null);
    const branch = then => definition([{ nodeId: 'branch', type: 'if', condition: { field: 'status', operator: 'equals', value: 'done' }, then, else: [assign()] }]);
    const okay = await validateReferences(fixture.transaction, { ...fixture, definition: branch([notify()]) }); assert.equal(okay.projection.effects.length, 1);
    await assert.rejects(() => validateReferences(fixture.transaction, { ...fixture, definition: branch([{ nodeId: 'missing', type: 'move_section', payload: { target: { taskId: 'missing' }, sectionId: 's' } }]) }), error => error.code === 'TASK_NOT_FOUND');
});
test('management filters distinguish all folders from unfiled and normalize cursor-equivalent values', () => {
    assert.deepEqual(normalizeListFilters({ query: '  ReVIEW ', enabled: 'true' }), { query: 'review', folder: null, enabled: true });
    assert.deepEqual(normalizeListFilters({ folder: '', enabled: 'all' }), { query: '', folder: '', enabled: null });
    assert.equal(matchesListFilters({ title: 'Review', folder: 'Team', enabled: true }, normalizeListFilters({ query: 'review', folder: 'Team', enabled: true })), true);
    assert.equal(matchesListFilters({ title: 'Review', folder: 'Team', enabled: true }, normalizeListFilters({ folder: '' })), false);
    for (const input of [{ enabled: 'yes' }, { folder: null }, { query: 'a'.repeat(201) }, { unknown: true }]) assert.throws(() => normalizeListFilters(input), error => error.status === 400);
});
test('known owner overlap rejects preview; earlier assignee clearing makes later owner change valid', () => {
    const tasks = source('old-owner'); tasks.t.assigneeUids = ['new-owner'];
    const ownerChange = { nodeId: 'owner', type: 'set_field', payload: { target: 'trigger_task', patch: { ownerUid: 'new-owner' } } };
    assert.throws(() => projectPreview({ definition: definition([ownerChange]), sampleTaskId: 't', tasks }), error => error.code === 'INVALID_ASSIGNEES');
    const clear = { nodeId: 'clear', type: 'set_field', payload: { target: 'trigger_task', patch: { assigneeUids: [] } } };
    const output = projectPreview({ definition: definition([clear, ownerChange, notify()]), sampleTaskId: 't', tasks });
    assert.deepEqual(output.effects[2].recipientUids, ['new-owner']);
});
test('create-subtask projection uses parent effective section even after preceding subtree move', () => {
    const tasks = { ...source('owner'), child: { title: 'Nested', parentTaskId: 't' } }; const sections = { s: { title: 'Original' }, other: { title: 'Destination' } };
    const create = { nodeId: 'create', type: 'create_task', payload: { parent: { taskId: 'child' }, sectionId: 's', task: { title: 'New subtask' } } };
    const move = { nodeId: 'move', type: 'move_section', payload: { target: 'trigger_task', sectionId: 'other' } };
    const output = projectPreview({ definition: definition([move, create]), sampleTaskId: 't', actorUid: 'actor', tasks, sections });
    assert.deepEqual(output.effects[1].section, { sectionId: 'other', label: 'Destination' });
    assert.deepEqual(output.effects[1].parent, { taskId: 'child', label: 'Nested' }); assert.equal(output.effects[1].target.taskId, null);
});
test('creation preview shows designated actor defaults and preserves explicit null owner', () => {
    const project = task => projectPreview({ definition: definition([{ nodeId: 'create', type: 'create_task', payload: { sectionId: 's', task } }]), sampleTaskId: 't', actorUid: 'designated-actor', tasks: source('sample-owner'), sections: { s: { title: 'Section' } } });
    const fields = effect => Object.fromEntries(effect.changes.map(change => [change.field, change.after]));
    assert.deepEqual(fields(project({ title: 'Created' }).effects[0]), { title: 'Created', status: 'not_started', ownerUid: 'designated-actor', assigneeUids: [], startDate: null, dueDate: null, values: {} });
    assert.equal(fields(project({ title: 'Unassigned', ownerUid: null }).effects[0]).ownerUid, null);
    assert.throws(() => project({ title: 'Invalid default', assigneeUids: ['designated-actor'] }), error => error.code === 'INVALID_ASSIGNEES');
    assert.throws(() => project({ title: 'Invalid explicit', ownerUid: 'person', assigneeUids: ['person'] }), error => error.code === 'INVALID_ASSIGNEES');
    assert.equal(fields(project({ title: 'Explicit null', ownerUid: null, assigneeUids: ['designated-actor'] }).effects[0]).ownerUid, null);
});
