'use strict';
const { id, uid, STATUS_KEYS, validateTaskPatch, validateTaskInput, validateTypedValues } = require('../domain/validation');
const { strict, fail, hash } = require('./store');
const MAX_NODES = 64;
const MAX_DELAY_MS = 30 * 86400000;
const BUILTINS = Object.freeze({ title: 'text', status: 'status', ownerUid: 'people', assigneeUids: 'people', startDate: 'date', dueDate: 'date' });
function string(value, max = 200) { if (typeof value !== 'string' || !value.trim() || value.length > max || Array.from(value).some(c => { const n = c.charCodeAt(0); return n < 32 && ![9, 10, 13].includes(n) || n === 127; })) fail('INVALID_AUTOMATION_TEXT', 'Invalid bounded text.'); return value.trim(); }
function target(value = 'trigger_task') { if (value === 'trigger_task') return value; strict(value, ['taskId']); return { taskId: id(value.taskId) }; }
function fieldType(field, columns) { if (typeof field === 'string' && BUILTINS[field]) return BUILTINS[field]; strict(field, ['columnId']); const column = columns[id(field.columnId)]; if (!column || (column.lifecycle || 'active') !== 'active') fail('BROKEN_REFERENCE', 'Condition column is unavailable.', 409); return column.type; }
function validateDefinition(input, columns = {}) {
    if (Buffer.byteLength(JSON.stringify(input || null)) > 65536) fail('AUTOMATION_LIMIT', 'Definition exceeds 64KB.');
    strict(input, ['schemaVersion', 'trigger', 'condition', 'steps']);
    if (input.schemaVersion !== 1) fail('INVALID_SCHEMA_VERSION', 'Unsupported automation schema.');
    const names = new Set(); let count = 0;
    function countNode(depth) { if (++count > MAX_NODES || depth > 8) fail('AUTOMATION_LIMIT', 'Definition exceeds node or nesting limit.'); }
    function condition(value, depth = 1) {
        countNode(depth);
        if (value?.all || value?.any) { strict(value, [value.all ? 'all' : 'any']); const key = value.all ? 'all' : 'any'; if (!Array.isArray(value[key]) || !value[key].length) fail('INVALID_CONDITION', 'Condition group must be nonempty.'); return { [key]: value[key].map(v => condition(v, depth + 1)) }; }
        if (value?.not) { strict(value, ['not']); return { not: condition(value.not, depth + 1) }; }
        strict(value, ['field', 'operator', 'value']); const type = fieldType(value.field, columns); const op = value.operator;
        const allowed = ['equals', 'not_equals', ...(['number', 'date'].includes(type) ? ['less_than', 'less_or_equal', 'greater_than', 'greater_or_equal'] : []), ...(['text', 'people', 'dropdown'].includes(type) ? ['contains'] : []), ...(['people', 'dropdown'].includes(type) ? ['is_empty'] : [])];
        if (!allowed.includes(op)) fail('INVALID_CONDITION', 'Operator does not match field type.');
        if (op === 'is_empty') { if (value.value !== undefined) fail('INVALID_CONDITION', 'is_empty does not accept a literal.'); return { field: value.field, operator: op }; }
        const literal = value.value;
        if (type === 'number' && (typeof literal !== 'number' || !Number.isFinite(literal))) fail('INVALID_CONDITION', 'Expected finite number.');
        if (type !== 'number' && typeof literal !== 'string' && literal !== null) fail('INVALID_CONDITION', 'Expected typed scalar literal.');
        if (typeof literal === 'string' && literal.length > 5000) fail('INVALID_CONDITION', 'Literal too long.');
        if (type === 'date' && literal !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(literal) || !Number.isFinite(Date.parse(literal)) || new Date(literal).toISOString().slice(0, 10) !== literal)) fail('INVALID_CONDITION', 'Invalid date.');
        if (type === 'status' && !STATUS_KEYS.includes(literal)) fail('INVALID_CONDITION', 'Invalid status.');
        if (type === 'priority' && !['none', 'low', 'medium', 'high', 'urgent'].includes(literal)) fail('INVALID_CONDITION', 'Invalid priority.');
        if (type === 'people' && literal !== null) uid(literal);
        if (typeof value.field === 'object' && type === 'dropdown') validateTypedValues({ [value.field.columnId]: literal }, columns);
        return { field: value.field, operator: op, value: literal };
    }
    strict(input.trigger, ['type', 'from', 'to', 'time', 'offsetDays']); const trigger = { ...input.trigger };
    if (!['task_created', 'status_changed', 'assignment_changed', 'due_date', 'all_direct_children_complete'].includes(trigger.type)) fail('INVALID_TRIGGER', 'Unsupported trigger.');
    if (trigger.type !== 'status_changed' && (trigger.from !== undefined || trigger.to !== undefined)) fail('INVALID_TRIGGER', 'Status filter requires status trigger.');
    for (const key of ['from', 'to']) if (trigger[key] !== undefined && !STATUS_KEYS.includes(trigger[key])) fail('INVALID_TRIGGER', 'Invalid status key.');
    if (trigger.type === 'due_date') { trigger.time = trigger.time || '09:00'; trigger.offsetDays = trigger.offsetDays ?? 0; if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(trigger.time) || !Number.isInteger(trigger.offsetDays) || Math.abs(trigger.offsetDays) > 30) fail('INVALID_TRIGGER', 'Invalid Vietnam firing time or offset.'); }
    else if (trigger.time !== undefined || trigger.offsetDays !== undefined) fail('INVALID_TRIGGER', 'Time requires due trigger.');
    function steps(values, depth = 1) {
        if (!Array.isArray(values) || !values.length) fail('INVALID_STEPS', 'Steps must be nonempty.');
        let wait = 0;
        const result = values.map(value => {
            countNode(depth); strict(value, ['nodeId', 'type', 'payload', 'condition', 'then', 'else']); const nodeId = id(value.nodeId); if (names.has(nodeId)) fail('DUPLICATE_NODE', 'nodeId must be unique.'); names.add(nodeId);
            if (value.type === 'if') { if (value.payload !== undefined) fail('INVALID_STEP', 'Branch cannot have payload.'); const yes = steps(value.then, depth + 1); if (value.else !== undefined && !Array.isArray(value.else)) fail('INVALID_STEPS', 'Else must be an array.'); const no = value.else?.length ? steps(value.else, depth + 1) : { result: [], wait: 0 }; wait += Math.max(yes.wait, no.wait); return { nodeId, type: 'if', condition: condition(value.condition, depth + 1), then: yes.result, else: no.result }; }
            if (value.condition !== undefined || value.then !== undefined || value.else !== undefined) fail('INVALID_STEP', 'Only a branch accepts conditions.');
            const p = value.payload;
            if (value.type === 'delay') { strict(p, ['durationMs']); if (!Number.isInteger(p.durationMs) || p.durationMs < 1 || p.durationMs > MAX_DELAY_MS) fail('INVALID_DELAY', 'Invalid delay.'); wait += p.durationMs; return { nodeId, type: value.type, payload: { durationMs: p.durationMs } }; }
            if (value.type === 'set_field') { strict(p, ['target', 'patch']); strict(p.patch, Object.keys(BUILTINS).concat('values')); if (!Object.keys(p.patch).length) fail('INVALID_ACTION', 'Empty field patch.'); const patch = validateTaskPatch(p.patch); if (patch.values) patch.values = validateTypedValues(patch.values, columns); return { nodeId, type: value.type, payload: { target: target(p.target), patch } }; }
            if (value.type === 'assign') { strict(p, ['target', 'ownerUid', 'assigneeUids']); const patch = validateTaskPatch({ ownerUid: p.ownerUid ?? null, assigneeUids: p.assigneeUids || [] }); if (patch.ownerUid && patch.assigneeUids.includes(patch.ownerUid)) fail('INVALID_ASSIGNEES', 'Owner cannot be an additional assignee.'); return { nodeId, type: value.type, payload: { target: target(p.target), ...patch } }; }
            if (value.type === 'move_section') { strict(p, ['target', 'sectionId']); return { nodeId, type: value.type, payload: { target: target(p.target), sectionId: id(p.sectionId) } }; }
            if (value.type === 'create_task') { strict(p, ['sectionId', 'parent', 'task']); const task = validateTaskInput(p.task); if (task.values) task.values = validateTypedValues(task.values, columns); return { nodeId, type: value.type, payload: { sectionId: id(p.sectionId), parent: p.parent ? target(p.parent) : null, task } }; }
            if (value.type === 'notify') { strict(p, ['message', 'recipients']); const recipients = ['task_owner', 'task_assignees'].includes(p.recipients) ? p.recipients : (Array.isArray(p.recipients) && p.recipients.length && p.recipients.length <= 50 ? p.recipients.map(v => uid(v)) : null); if (!recipients || (Array.isArray(recipients) && new Set(recipients).size !== recipients.length)) fail('INVALID_RECIPIENTS', 'Explicit eligible recipients are required.'); return { nodeId, type: value.type, payload: { message: string(p.message, 2000), recipients } }; }
            fail('INVALID_ACTION', 'Unsupported action.');
        });
        if (wait > MAX_DELAY_MS) fail('AUTOMATION_LIMIT', 'Total scheduled waiting exceeds 30 days.'); return { result, wait };
    }
    const normalizedCondition = input.condition !== undefined ? condition(input.condition) : null;
    const definition = { schemaVersion: 1, trigger, ...(normalizedCondition ? { condition: normalizedCondition } : {}), steps: steps(input.steps).result };
    return definition;
}
function evaluateCondition(condition, task) {
    if (!condition) return true;
    if (condition.all) return condition.all.every(c => evaluateCondition(c, task));
    if (condition.any) return condition.any.some(c => evaluateCondition(c, task));
    if (condition.not) return !evaluateCondition(condition.not, task);
    const a = typeof condition.field === 'string' ? task[condition.field] : task.values?.[condition.field.columnId]; const b = condition.value;
    switch (condition.operator) { case 'equals': return (a ?? null) === b; case 'not_equals': return (a ?? null) !== b; case 'contains': return typeof a === 'string' || Array.isArray(a) ? a.includes(b) : false; case 'is_empty': return a == null || a.length === 0; case 'less_than': return a != null && a < b; case 'less_or_equal': return a != null && a <= b; case 'greater_than': return a != null && a > b; case 'greater_or_equal': return a != null && a >= b; default: return false; }
}
function dueTime(date, trigger = {}) { return Date.parse(`${date}T${trigger.time || '09:00'}:00+07:00`) + (trigger.offsetDays || 0) * 86400000; }
function walkSteps(steps, fn, prefix = '') { for (const node of steps) { const path = `${prefix}/${node.nodeId}`; fn(node, path); if (node.type === 'if') { walkSteps(node.then, fn, `${path}/then`); walkSteps(node.else, fn, `${path}/else`); } } }
module.exports = { validateDefinition, evaluateCondition, dueTime, walkSteps, fieldType, string, MAX_NODES, MAX_DELAY_MS, definitionDigest: hash };
