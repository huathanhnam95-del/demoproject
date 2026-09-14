'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../../../public/js/crm/projects/automation-definition-editor');
const E = globalThis.CrmAutomationDefinitionEditor;
const rendererSource = fs.readFileSync(path.join(__dirname, '../../../public/js/crm/projects/automations-renderer.js'), 'utf8');
const automationSource = fs.readFileSync(path.join(__dirname, '../../../public/js/crm/projects/automations.js'), 'utf8');
const { validateDefinition } = require('../../../functions/src/crm/projects/automation/definition');
const context = { sections: [{ id: 's1', title: 'Work' }], members: [{ uid: 'u1', displayName: 'Owner', role: 'Owner' }], project: { statusLabels: { done: 'Finished' } }, columns: [
  { id: 'text', type: 'text', label: 'Notes' }, { id: 'number', type: 'number', label: 'Effort' }, { id: 'date', type: 'date', label: 'Review date' }, { id: 'people', type: 'people', label: 'People' }, { id: 'status', type: 'status', label: 'Stage' }, { id: 'priority', type: 'priority', label: 'Importance' }, { id: 'dropdown', type: 'dropdown', label: 'Team', options: [{ key: 'blue', label: 'Blue' }] }
] };
function fixture() {
  return { schemaVersion: 1, trigger: { type: 'status_changed', from: 'not_started', to: 'done' }, condition: { all: [{ field: { columnId: 'number' }, operator: 'greater_or_equal', value: 0 }, { any: [{ field: 'title', operator: 'contains', value: 'Task' }, { not: { field: 'ownerUid', operator: 'is_empty' } }] }] }, steps: [
    { nodeId: 'fields', type: 'set_field', payload: { target: 'trigger_task', patch: { title: 'Task', values: { text: 'Keep text', number: 3.5, date: '2026-09-08', people: ['u1'], status: 'done', priority: 'high', dropdown: 'blue' } } } },
    { nodeId: 'assign', type: 'assign', payload: { target: { taskId: 't1' }, ownerUid: 'u1', assigneeUids: [] } },
    { nodeId: 'branch', type: 'if', condition: { field: 'status', operator: 'equals', value: 'done' }, then: [{ nodeId: 'wait', type: 'delay', payload: { durationMs: 120000 } }, { nodeId: 'notify', type: 'notify', payload: { message: 'Ready', recipients: ['u1'] } }], else: [{ nodeId: 'move', type: 'move_section', payload: { target: 'trigger_task', sectionId: 's1' } }] },
    { nodeId: 'create', type: 'create_task', payload: { sectionId: 's1', parent: 'trigger_task', task: { title: 'New task', status: 'not_started', ownerUid: 'u1', assigneeUids: [], startDate: null, dueDate: '2026-09-09', values: { number: 2 } } } }
  ] };
}
test('all actions, typed columns, nested groups and branches remain accepted by server contract', () => {
  const value = fixture(); assert.deepEqual(E.validate(value, context), []);
  assert.doesNotThrow(() => validateDefinition(value, Object.fromEntries(context.columns.map(column => [column.id, column]))));
  for (const type of E.triggers) { const next = E.clone(value); next.trigger = type === 'due_date' ? { type, time: '09:00', offsetDays: -2 } : type === 'status_changed' ? { type, from: 'not_started', to: 'done' } : { type }; assert.deepEqual(E.validate(next, context), []); validateDefinition(next, Object.fromEntries(context.columns.map(column => [column.id, column]))); }
});
test('recipe and connected-block rendering do not mutate persisted shape or types', () => {
  const sandbox = { CrmAutomationDefinitionEditor: E }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/projects/automations-renderer.js'), 'utf8'), sandbox);
  const value = fixture(), before = JSON.stringify(value);
  for (const mode of ['recipe', 'blocks', 'recipe']) { const html = sandbox.CrmAutomationsRenderer.definition(value, context, mode); assert.match(html, /data-auto-step="branch"/); assert.match(html, /Otherwise/); assert.match(html, /Finished/); assert.match(html, /Wait \(minutes\)/); assert.equal(JSON.stringify(value), before); }
  assert.equal(typeof value.steps[0].payload.patch.values.number, 'number');
});
test('nested immutable edits preserve unrelated branches and stable identities', () => {
  const value = fixture(), before = E.clone(value);
  const next = E.editNode(value, 'notify', node => E.setAt(node, ['payload', 'message'], 'Changed'));
  assert.deepEqual(value, before); assert.equal(E.find(next, 'notify').node.payload.message, 'Changed'); assert.deepEqual(E.find(next, 'branch').node.else, E.find(before, 'branch').node.else);
  const paths = []; E.walk(next, entry => paths.push(entry.path)); assert.ok(paths.includes('/branch/then/notify')); assert.ok(paths.includes('/branch/else/move'));
});

test('from-scratch definitions are explicitly unselected and remain invalid until configured', () => {
  assert.equal(typeof E.createBlank, 'function');
  const blank = E.createBlank(context);
  assert.deepEqual(blank, { schemaVersion: 1, trigger: { type: '' }, steps: [] });
  assert.ok(E.validate(blank, context).length);
  assert.deepEqual(E.create(context).trigger, { type: 'task_created' });
});

test('automation workspace exposes the simple builder and one searchable picker contract', () => {
  assert.match(rendererSource, /simpleDefinition/);
  assert.match(rendererSource, /data-auto-picker/);
  assert.match(automationSource, /simple-trigger|simple-action/);
});
test('branch duplication refreshes every copied step identity and reorder/remove retain others', () => {
  const value = fixture(), duplicate = E.duplicate(value, 'branch'), ids = []; E.walk(duplicate, entry => ids.push(entry.node.nodeId)); assert.equal(ids.length, new Set(ids).size);
  assert.equal(duplicate.steps.length, value.steps.length + 1); const moved = E.reorder(duplicate, 'create', -1); assert.equal(moved.steps[3].nodeId, 'create');
  const removed = E.remove(moved, 'notify'); assert.equal(E.find(removed, 'notify'), undefined); assert.ok(E.find(removed, 'wait'));
  const one = E.create(); assert.throws(() => E.remove(one, one.steps[0].nodeId), /replacement/);
});
test('empty else branch supports insert and remove without corrupting required then', () => {
  const value = fixture(); E.find(value, 'branch').node.else = [];
  const next = E.insert(value, { parentId: 'branch', branch: 'else', type: 'delay', context }); const id = E.find(next, 'branch').node.else[0].nodeId;
  const removed = E.remove(next, id); assert.deepEqual(E.find(removed, 'branch').node.else, []); assert.equal(E.find(removed, 'branch').node.then.length, 2);
});
test('excessive depth, size, count and cyclic imports return errors without recursion failure', () => {
  const deep = fixture(); let condition = E.leaf(); for (let index = 0; index < 10000; index++) condition = { not: condition }; deep.condition = condition;
  assert.doesNotThrow(() => E.validate(deep, context)); assert.ok(E.validate(deep, context).length);
  const sized = fixture(); sized.steps[0].payload.patch.title = 'x'.repeat(70000); assert.match(E.validate(sized, context).join(' '), /size/);
  const count = E.create(); count.steps = Array.from({ length: 100 }, () => E.newNode()); assert.match(E.validate(count, context).join(' '), /64/);
  const cyclic = E.create(); cyclic.condition = cyclic; assert.ok(E.validate(cyclic, context).length);
});
test('scalar owner rejects arrays while custom people permits typed arrays', () => {
  const value = fixture(); value.steps[1].payload.ownerUid = ['u1']; assert.ok(E.validate(value, context).length);
  value.steps[1].payload.ownerUid = 'u1'; assert.deepEqual(E.validate(value, context), []);
});
test('unknown fields, invalid dates, mismatched typed literals and unsafe paths are rejected', () => {
  const unknown = fixture(); unknown.steps[0].payload.script = 'unexpected'; assert.ok(E.validate(unknown, context).length);
  const badDate = fixture(); badDate.steps[0].payload.patch.values.date = '2026-02-31'; assert.ok(E.validate(badDate, context).length);
  const badNumber = fixture(); badNumber.steps[0].payload.patch.values.number = '3'; assert.ok(E.validate(badNumber, context).length);
  assert.throws(() => E.setAt(fixture(), ['__proto__', 'polluted'], true), /Invalid/); assert.equal({}.polluted, undefined);
});
test('safe preview omits raw payload and labels empty custom values', () => {
  const sandbox = { CrmAutomationDefinitionEditor: E }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/projects/automations-renderer.js'), 'utf8'), sandbox);
  const html = sandbox.CrmAutomationsRenderer.preview({ effects: [{ type: 'create_task', target: { taskId: 'x', label: '<unsafe>' }, payload: { secret: 'HIDDEN_CAPABILITY' }, changes: [{ field: 'values', before: null, after: {} }] }], warnings: [] }, context);
  assert.ok(!html.includes('HIDDEN_CAPABILITY')); assert.match(html, /No custom values/); assert.match(html, /&lt;unsafe&gt;/);
});
