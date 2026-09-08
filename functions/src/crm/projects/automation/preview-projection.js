'use strict';
const { evaluateCondition } = require('./definition');
const { fail } = require('./store');

const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));

// Pure, ordered sample projection. Conditions before a delay deliberately use
// the triggering snapshot, while action targets reflect preceding sample edits.
// A delay cannot predict a future task read: all subsequent output is provisional.
function projectPreview({ definition, sampleTaskId, actorUid, tasks = {}, sections = {} }) {
    const projected = new Map(Object.entries(tasks).map(([key, value]) => [key, clone(value)]));
    const initial = clone(tasks[sampleTaskId]);
    if (!initial) fail('BROKEN_REFERENCE', 'Sample task is unavailable.', 409);
    const effects = []; const warnings = []; const dynamicRecipients = [];
    let provisional = false;
    const conditionMatched = evaluateCondition(definition.condition, initial);
    function resolve(taskId) { const task = projected.get(taskId); if (!task) fail('BROKEN_REFERENCE', 'Action target is unavailable.', 409); return task; }
    function effectiveSection(taskId) {
        const seen = new Set(); let task = resolve(taskId);
        while (task.parentTaskId) { if (seen.has(task.parentTaskId)) fail('BROKEN_REFERENCE', 'Sample ancestry contains a cycle.', 409); seen.add(task.parentTaskId); task = resolve(task.parentTaskId); }
        return task.sectionId;
    }
    function changes(before, patch) {
        const result = [];
        for (const [field, after] of Object.entries(patch)) {
            if (field === 'values') { for (const [columnId, value] of Object.entries(after || {})) result.push({ field: `values.${columnId}`, before: clone(before.values?.[columnId]), after: clone(value) }); }
            else result.push({ field, before: clone(before[field]), after: clone(after) });
        }
        return result;
    }
    function visit(nodes, prefix = '') {
        for (const node of nodes) {
            const path = `${prefix}/${node.nodeId}`;
            if (node.type === 'if') {
                const snapshot = provisional ? resolve(sampleTaskId) : initial;
                const branch = evaluateCondition(node.condition, snapshot) ? 'then' : 'else';
                visit(node[branch], `${path}/${branch}`);
                continue;
            }
            const p = node.payload;
            const effect = { nodeId: node.nodeId, type: node.type, payload: clone(p), path, sequence: effects.length + 1, changes: [], recipientUids: [], provisional };
            if (node.type === 'delay') {
                effects.push(effect); provisional = true;
                warnings.push('Effects after a delay are provisional: execution reads a future authorized task snapshot.');
                continue;
            }
            if (node.type === 'create_task') {
                const section = sections[p.sectionId]; if (!section) fail('BROKEN_REFERENCE', 'Creation section is unavailable.', 409);
                effect.section = { sectionId: p.sectionId, label: section.title };
                // The canonical task ID is operation-derived only at execution;
                // do not fabricate a persisted task ID during a dry preview.
                effect.target = { taskId: null, label: p.task.title };
                const created = { title: p.task.title, status: p.task.status || 'not_started', ownerUid: p.task.ownerUid === undefined ? actorUid : p.task.ownerUid, assigneeUids: p.task.assigneeUids || [], startDate: p.task.startDate || null, dueDate: p.task.dueDate || null, values: p.task.values || {} };
                if (created.ownerUid === undefined) fail('BROKEN_REFERENCE', 'Designated actor is required to preview task creation.', 409);
                if (created.ownerUid && created.assigneeUids.includes(created.ownerUid)) fail('INVALID_ASSIGNEES', 'The accountable owner cannot also be an additional assignee.');
                effect.changes = changes({}, created);
                if (!Object.keys(created.values).length) effect.changes.push({ field: 'values', before: null, after: {} });
                if (p.parent) {
                    const parentId = p.parent === 'trigger_task' ? sampleTaskId : p.parent.taskId; const parent = resolve(parentId); effect.parent = { taskId: parentId, label: parent.title };
                    const sectionId = effectiveSection(parentId); const destination = sections[sectionId]; if (!destination) fail('BROKEN_REFERENCE', 'Parent section is unavailable.', 409);
                    effect.section = { sectionId, label: destination.title };
                }
            } else {
                const taskId = p.target?.taskId || sampleTaskId; const task = resolve(taskId);
                effect.target = { taskId, label: task.title };
                if (node.type === 'set_field' || node.type === 'assign') {
                    const patch = node.type === 'assign' ? { ownerUid: p.ownerUid, assigneeUids: p.assigneeUids } : p.patch;
                    effect.changes = changes(task, patch);
                    const next = { ...task, ...clone(patch), ...(patch.values ? { values: { ...(task.values || {}), ...clone(patch.values) } } : {}) };
                    if (!provisional && next.ownerUid && (next.assigneeUids || []).includes(next.ownerUid)) fail('INVALID_ASSIGNEES', 'The accountable owner cannot also be an additional assignee.');
                    projected.set(taskId, next);
                }
                if (node.type === 'move_section') {
                    const section = sections[p.sectionId]; if (!section) fail('BROKEN_REFERENCE', 'Destination section is unavailable.', 409);
                    effect.section = { sectionId: p.sectionId, label: section.title };
                    effect.changes = changes(task, { parentTaskId: null, sectionId: p.sectionId });
                    projected.set(taskId, { ...task, parentTaskId: null, sectionId: p.sectionId });
                    warnings.push('Move section places the selected subtree at the destination section root, leaving its current parent.');
                }
                if (node.type === 'notify') {
                    const current = resolve(sampleTaskId);
                    const recipients = p.recipients === 'task_owner' ? [current.ownerUid].filter(Boolean) : p.recipients === 'task_assignees' ? current.assigneeUids || [] : p.recipients;
                    if (!Array.isArray(recipients) || !recipients.length) fail('BROKEN_REFERENCE', 'Reached notification requires an eligible recipient.', 409);
                    effect.recipientUids = [...new Set(recipients)];
                    if (typeof p.recipients === 'string') dynamicRecipients.push(...effect.recipientUids);
                }
            }
            effects.push(effect);
        }
    }
    if (conditionMatched) visit(definition.steps);
    return { effects, warnings: [...new Set(warnings)], conditionMatched, dynamicRecipients: [...new Set(dynamicRecipients)] };
}

module.exports = { projectPreview };
