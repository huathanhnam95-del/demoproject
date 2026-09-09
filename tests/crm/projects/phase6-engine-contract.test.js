'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDefinition, evaluateCondition, dueTime } = require('../../../functions/src/crm/projects/automation/definition');
const { triggerMatches } = require('../../../functions/src/crm/projects/automation/processor');
const { dueGeneration, prepareEventCapture } = require('../../../functions/src/crm/projects/automation/event-capture');
const { getContext } = require('../../../functions/src/crm/projects/automation/execution-context');
const action = (nodeId = 'a') => ({ nodeId, type: 'set_field', payload: { patch: { status: 'done' } } });
const definition = steps => ({ schemaVersion: 1, trigger: { type: 'status_changed' }, steps: steps || [action()] });
test('strict shared definitions reject malformed conditions, branches, unknown fields and invalid dates', () => {
    for (const condition of [false, null, {}, { all: [] }, { field: 'dueDate', operator: 'equals', value: '2026-99-99' }]) assert.throws(() => validateDefinition({ ...definition(), condition }), error => error.status === 400);
    for (const alternative of [false, {}, 'bad']) assert.throws(() => validateDefinition(definition([{ nodeId: 'branch', type: 'if', condition: { field: 'status', operator: 'equals', value: 'done' }, then: [action()], else: alternative }])), error => error.status === 400);
    assert.throws(() => validateDefinition({ ...definition(), script: 'execute' }), error => error.status === 400);
    assert.throws(() => validateDefinition(definition([{ nodeId: 'bad', type: 'set_field', payload: { patch: { lifecycle: 'active' } } }])), error => error.status === 400);
});
test('typed condition operators and immutable custom column IDs roundtrip', () => {
    const columns = { score: { type: 'number', lifecycle: 'active' }, group: { type: 'dropdown', lifecycle: 'active', options: [{ id: 'x', label: 'X' }] } };
    const value = validateDefinition({ ...definition(), condition: { all: [{ field: { columnId: 'score' }, operator: 'greater_than', value: 12 }, { field: 'title', operator: 'contains', value: 'review' }] } }, columns);
    assert.equal(evaluateCondition(value.condition, { values: { score: 13 }, title: 'review docs' }), true);
    assert.equal(evaluateCondition(value.condition, { values: { score: 11 }, title: 'review docs' }), false);
    assert.throws(() => validateDefinition({ ...definition(), condition: { field: 'status', operator: 'greater_than', value: 'done' } }), error => error.code === 'INVALID_CONDITION');
    assert.throws(() => validateDefinition({ ...definition(), condition: { field: { columnId: 'deleted' }, operator: 'equals', value: 'x' } }), error => error.code === 'BROKEN_REFERENCE');
});
test('node identity, nesting, node count and total scheduled waiting are bounded', () => {
    assert.throws(() => validateDefinition(definition([action(), action()])), error => error.code === 'DUPLICATE_NODE');
    assert.throws(() => validateDefinition(definition(Array.from({ length: 65 }, (_, i) => action(`a${i}`)))), error => error.code === 'AUTOMATION_LIMIT');
    const delay = (nodeId, days) => ({ nodeId, type: 'delay', payload: { durationMs: days * 86400000 } });
    assert.throws(() => validateDefinition(definition([delay('a', 20), delay('b', 20)])), error => error.code === 'AUTOMATION_LIMIT');
    assert.equal(validateDefinition(definition([action('a'), action('b')])).steps.length, 2);
});
test('semantic triggers ignore unchanged status and assignment ordering', () => {
    assert.equal(triggerMatches({ type: 'status_changed' }, { before: { status: 'done' }, after: { status: 'done' } }), false);
    assert.equal(triggerMatches({ type: 'assignment_changed' }, { before: { ownerUid: 'a', assigneeUids: ['b', 'c'] }, after: { ownerUid: 'a', assigneeUids: ['c', 'b'] } }), false);
    assert.equal(triggerMatches({ type: 'assignment_changed' }, { before: { ownerUid: 'a' }, after: { ownerUid: 'b' } }), true);
});
test('due generations do not revive A after A to B to A; Vietnam firing math is explicit', () => {
    assert.equal(dueGeneration(null, { dueDate: '2026-09-08' }), 1);
    assert.equal(dueGeneration({ dueDate: '2026-09-08', dueGeneration: 5 }, { dueDate: '2026-09-08', title: 'new' }), 5);
    assert.equal(dueGeneration({ dueDate: '2026-09-09', dueGeneration: 6 }, { dueDate: '2026-09-08', dueGeneration: 5 }), 7);
    assert.equal(dueTime('2026-09-08'), Date.parse('2026-09-08T02:00:00Z'));
    assert.equal(dueTime('2026-09-08', { time: '08:30', offsetDays: -1 }), Date.parse('2026-09-07T01:30:00Z'));
});
test('HTTP-shaped identity cannot forge executor origin capability', () => { assert.equal(getContext({ uid: 'owner', runId: 'run', executionContext: {} }), undefined); });
test('transaction capture preserves semantic before and patch merge without post-write reads', async () => {
    const original = { projectId: 'p', title: 'Before', status: 'in_progress', dueDate: '2026-09-08', dueGeneration: 3, values: { a: 2 }, revision: 4 };
    const rows = new Map([['crmProjects/p/tasks/t', original]]); const committed = []; let wrote = false;
    const document = path => ({ path });
    const db = { collection: name => ({ doc: key => document(`${name}/${key}`) }) };
    const transaction = { async get(doc) { assert.equal(wrote, false); return { ref: doc, exists: rows.has(doc.path), data: () => rows.get(doc.path) }; }, set(doc, value, options) { wrote = true; committed.push({ doc, value, options }); } };
    const capture = await prepareEventCapture(transaction, db, 'p', { project: { data: {} } });
    await capture.transaction.get(document('crmProjects/p/tasks/t'));
    assert.throws(() => capture.transaction.set(document('crmProjects/p/tasks/t'), { values: { a: 3 } }, { mergeFields: ['values.a'] }), error => error.code === 'SEMANTIC_WRITE_SHAPE');
    assert.throws(() => capture.transaction.set(document('crmProjects/p/tasks/t'), { 'values.a': 3 }), error => error.code === 'SEMANTIC_WRITE_SHAPE');
    capture.transaction.set(document('crmProjects/p/tasks/t'), { title: 'After', dueDate: '2026-09-09' }, { merge: true });
    const event = capture.finish(); assert.equal(event.changes[0].before.title, 'Before'); assert.equal(event.changes[0].after.title, 'After'); assert.equal(event.changes[0].after.dueGeneration, 4); assert.deepEqual(event.changes[0].after.values, { a: 2 }); assert.equal(committed[0].value.dueGeneration, 4);
});
