'use strict';

const { DomainError } = require('./validation');

function lifecycleRank(value) {
    if (value === 'trashed') return 2;
    if (value === 'archived') return 1;
    return 0;
}

function lifecycleName(rank) { return rank >= 2 ? 'trashed' : (rank === 1 ? 'archived' : 'active'); }

function resolveTaskState({ tasks, taskId, projectLifecycle = 'active', sections = null }) {
    const byId = tasks instanceof Map ? tasks : new Map((tasks || []).map((row) => [row.id, row]));
    const chain = [];
    const seen = new Set();
    let current = byId.get(taskId);
    if (!current) throw new DomainError(404, 'TASK_NOT_FOUND', 'Task not found.');
    let rank = lifecycleRank(projectLifecycle);
    while (current) {
        if (seen.has(current.id)) throw new DomainError(409, 'ANCESTRY_CYCLE', 'Task ancestry contains a cycle.');
        seen.add(current.id);
        chain.push(current);
        rank = Math.max(rank, lifecycleRank(current.data.lifecycle || 'active'));
        const parentId = current.data.parentTaskId || null;
        if (!parentId) break;
        current = byId.get(parentId);
        if (!current) throw new DomainError(409, 'INVALID_PARENT_REFERENCE', 'Task parent must belong to the same project.');
    }
    const root = chain[chain.length - 1];
    const sectionId = root?.data?.sectionId || null;
    if (!sectionId) throw new DomainError(409, 'INVALID_SECTION_REFERENCE', 'Root task must reference a section.');
    const section = sections instanceof Map ? sections.get(sectionId) : null;
    if (sections && !section) throw new DomainError(409, 'INVALID_SECTION_REFERENCE', 'Root task section must belong to this project.');
    if (sections && (section.data.lifecycle || 'active') !== 'active') rank = Math.max(rank, lifecycleRank(section.data.lifecycle || 'archived'));
    const pathIds = chain.map((row) => row.id);
    return {
        pathIds,
        ancestorIds: pathIds.slice(1),
        sectionId,
        lifecycle: lifecycleName(rank)
    };
}

function assertNoCycle({ tasks, targetId, parentTaskId }) {
    if (!parentTaskId) return;
    const byId = tasks instanceof Map ? tasks : new Map((tasks || []).map((row) => [row.id, row]));
    let current = parentTaskId;
    const seen = new Set([targetId]);
    while (current) {
        if (seen.has(current)) throw new DomainError(409, 'ANCESTRY_CYCLE', 'A task cannot become its own ancestor.');
        seen.add(current);
        const row = byId.get(current);
        if (!row) throw new DomainError(409, 'INVALID_PARENT_REFERENCE', 'Task parent must belong to the same project.');
        current = row.data.parentTaskId || null;
    }
}

module.exports = { lifecycleRank, lifecycleName, resolveTaskState, assertNoCycle };
