'use strict';
const crypto = require('crypto');
const { DomainError, id, digestPayload } = require('./domain/validation');
const { PROJECT_COLLECTIONS, serializeProjectAccess } = require('./access-service');
const { projectCollection, projectRef, snapshotRows } = require('./domain/storage');
const { resolveTaskState } = require('./domain/hierarchy');
const { assertProjectTask, nowIso } = require('./phase4-utils');
const { calendarSummary, calendarDays, evaluateSchedule, datesInRange, FEED_VERSION } = require('./calendar-model');
const { MAX_QUERY_TASKS, MAX_QUERY_SECTIONS } = require('./domain/query-service');

function requiredRevision(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new DomainError(400, 'INVALID_REVISION', 'A current nonnegative integer revision is required.');
    return value;
}
function dependencyWarnings(taskId, tasks, effective) {
    const task = tasks.get(taskId)?.data || {}; const warnings = [];
    for (const predecessorId of task.predecessorTaskIds || []) {
        const predecessor = tasks.get(predecessorId)?.data;
        if (!predecessor || effective.get(predecessorId)?.lifecycle !== 'active') warnings.push({ code: 'DEPENDENCY_UNAVAILABLE', predecessorTaskId: predecessorId });
        else if (!predecessor.dueDate || !task.startDate) warnings.push({ code: 'DEPENDENCY_DATES_MISSING', predecessorTaskId: predecessorId });
        else if (predecessor.dueDate >= task.startDate) warnings.push({ code: 'DEPENDENCY_DATE_CONFLICT', predecessorTaskId: predecessorId });
    }
    return warnings;
}
function assertDependencyGraph(rows, taskId, predecessors) {
    if (!Array.isArray(predecessors) || predecessors.length > 200) throw new DomainError(400, 'INVALID_DEPENDENCIES', 'At most 200 predecessors are allowed.');
    predecessors = predecessors.map((value) => id(value, 'predecessor task ID'));
    if (new Set(predecessors).size !== predecessors.length) throw new DomainError(400, 'DUPLICATE_DEPENDENCY', 'Predecessors must be unique.');
    if (predecessors.includes(taskId)) throw new DomainError(400, 'DEPENDENCY_CYCLE', 'A task cannot depend on itself.');
    const graph = new Map(rows.map((row) => [row.id, row.id === taskId ? predecessors : row.data.predecessorTaskIds || []]));
    for (const predecessor of predecessors) if (!graph.has(predecessor)) throw new DomainError(400, 'DEPENDENCY_NOT_FOUND', 'Predecessors must exist in this project.');
    // Iterative DFS avoids call-stack exhaustion on the bounded full graph.
    const visited = new Set(); const visiting = new Set();
    for (const node of graph.keys()) {
        if (visited.has(node)) continue;
        const stack = [[node, false]];
        while (stack.length) {
            const [current, exit] = stack.pop();
            if (exit) { visiting.delete(current); visited.add(current); continue; }
            if (visiting.has(current)) throw new DomainError(409, 'DEPENDENCY_CYCLE', 'Dependencies would contain a cycle.');
            if (visited.has(current) || !graph.has(current)) continue;
            visiting.add(current); stack.push([current, true]);
            for (const predecessor of graph.get(current)) stack.push([predecessor, false]);
        }
    }
    return predecessors;
}
function effectiveStates(snapshot) {
    const tasks = new Map(snapshot.tasks.map((row) => [row.id, row]));
    const sections = new Map(snapshot.sections.map((row) => [row.id, row]));
    const effective = new Map(snapshot.tasks.map((row) => [row.id, resolveTaskState({ tasks, taskId: row.id, sections, projectLifecycle: snapshot.project.data.lifecycle || 'active' })]));
    return { tasks, effective };
}
function createViewCalendarService({ db, accessService, queryService, commandService, taskLinksService, now = () => new Date() }) {
    const calendarRef = db.collection(PROJECT_COLLECTIONS.organizationConfig).doc('calendar');
    async function views(identity, projectId, options) {
        projectId = id(projectId, 'project ID');
        const snapshot = await queryService.readSnapshot(identity, projectId);
        const page = await queryService.queryTasks(identity, projectId, options, snapshot);
        const { tasks, effective } = effectiveStates(snapshot);
        return { ...page, project: serializeProjectAccess(snapshot.access), membership: snapshot.access.membership.data,
            tasks: page.tasks.map((task) => {
                let calendarWarnings = [];
                if (task.startDate && task.dueDate) {
                    try { calendarWarnings = evaluateSchedule(task, snapshot.calendar, task.startDate, task.dueDate).warnings; }
                    catch (_) { calendarWarnings = [{ code: 'SCHEDULE_RANGE_UNSUPPORTED' }]; }
                } else calendarWarnings = [{ code: 'TASK_DATES_MISSING' }];
                return { ...task, predecessorTaskIds: task.predecessorTaskIds || [], dependencyWarnings: dependencyWarnings(task.id, tasks, effective), calendarWarnings };
            }), calendar: calendarSummary(snapshot.calendar), linkAccess: { canManage: ['Owner', 'Editor'].includes(snapshot.access.role) && await taskLinksService.canManage(snapshot.access.identity) } };
    }
    async function calendar(identity, projectId, input) {
        datesInRange(input.fromDate, input.toDate);
        const snapshot = await queryService.readSnapshot(identity, id(projectId, 'project ID'));
        return { calendar: calendarDays(snapshot.calendar, input.fromDate, input.toDate, snapshot.memberUids) };
    }
    async function readScheduleState(transaction, projectId) {
        async function bounded(name, maximum) {
            const rows = snapshotRows(await transaction.get(projectCollection(db, projectId, name).limit(maximum + 1)));
            if (rows.length > maximum) throw new DomainError(409, 'PROJECT_QUERY_LIMIT', 'Project exceeds the bounded schedule limit.');
            return rows;
        }
        const tasks = await bounded('tasks', MAX_QUERY_TASKS); const sections = await bounded('sections', MAX_QUERY_SECTIONS);
        const project = await transaction.get(projectRef(db, projectId)); const config = await transaction.get(calendarRef);
        return { tasks, sections, project: { id: projectId, data: project.data() || {} }, calendar: config.exists ? config.data() : {} };
    }
    function scheduleFence(snapshot) { return digestPayload({ tasks: snapshot.tasks.map(({ id: taskId, data, updateTime }) => ({ id: taskId, data, updateTime })), sections: snapshot.sections.map(({ id: sectionId, data, updateTime }) => ({ id: sectionId, data, updateTime })), project: snapshot.project, calendar: snapshot.calendar, feedVersion: FEED_VERSION }); }
    async function dependencies(identity, projectId, taskId, input) {
        projectId = id(projectId, 'project ID'); taskId = id(taskId, 'task ID');
        const expectedRevision = requiredRevision(input.expectedRevision); const expectedStructureRevision = requiredRevision(input.expectedStructureRevision);
        // Validate before using the values in a command envelope.
        const predecessors = assertDependencyGraph([{ id: taskId, data: {} }, ...(Array.isArray(input.predecessorTaskIds) ? input.predecessorTaskIds.map((predecessor) => ({ id: predecessor, data: {} })) : [])], taskId, input.predecessorTaskIds);
        return commandService.runCommand({ actorUid: identity.uid, command: 'updateTaskDependencies', projectId, targetId: taskId, operationId: input.operationId,
            payload: { predecessorTaskIds: predecessors, expectedRevision, expectedStructureRevision }, access: { write: true }, execute: async ({ transaction }) => {
                const task = await assertProjectTask(transaction, db, projectId, taskId);
                const snapshot = await readScheduleState(transaction, projectId);
                if (Number(task.data.revision || 0) !== expectedRevision || Number(snapshot.project.data.structureRevision || 0) !== expectedStructureRevision) throw new DomainError(409, 'STALE_REVISION', 'Task or project structure changed; refresh.');
                assertDependencyGraph(snapshot.tasks, taskId, predecessors);
                const { effective } = effectiveStates(snapshot);
                for (const predecessor of predecessors) if (effective.get(predecessor)?.lifecycle !== 'active') throw new DomainError(409, 'DEPENDENCY_UNAVAILABLE', 'New predecessors must be active.');
                const revision = expectedRevision + 1; const structureRevision = expectedStructureRevision + 1;
                transaction.update(task.ref, { predecessorTaskIds: predecessors, revision, updatedAt: nowIso(now), updatedBy: identity.uid });
                transaction.update(projectRef(db, projectId), { structureRevision, dependencyRevision: Number(snapshot.project.data.dependencyRevision || 0) + 1, updatedAt: nowIso(now) });
                return { result: { task: { id: taskId, revision }, structureRevision, operationId: input.operationId }, before: { taskId, revision: expectedRevision }, after: { taskId, revision }, inverse: { kind: 'taskDependencies', changes: [{ type: 'task', id: taskId, previous: { predecessorTaskIds: task.data.predecessorTaskIds || [] }, fields: ['predecessorTaskIds'], expectedRevisionAfter: revision }], expectedStructureRevisionAfter: structureRevision }, affectedIds: [taskId], affectedPaths: [task.ref.path], beforeRevisions: { [task.ref.path]: expectedRevision }, afterRevisions: { [task.ref.path]: revision }, structureRevisionBefore: expectedStructureRevision, structureRevisionAfter: structureRevision };
            } });
    }
    async function preview(identity, projectId, input) {
        projectId = id(projectId, 'project ID'); const taskId = id(input.taskId, 'task ID');
        const expectedRevision = requiredRevision(input.expectedRevision); datesInRange(input.startDate, input.dueDate);
        const slot = digestPayload({ actorUid: identity.uid, projectId, taskId }).slice(0, 32);
        const nonce = crypto.randomBytes(24).toString('base64url'); const token = `${slot}.${nonce}`;
        return db.runTransaction(async (transaction) => {
            await accessService.assertTransactionContentAccess(transaction, identity.uid, projectId, { write: true });
            const task = await assertProjectTask(transaction, db, projectId, taskId);
            if (Number(task.data.revision || 0) !== expectedRevision) throw new DomainError(409, 'STALE_REVISION', 'Task changed; refresh.');
            const snapshot = await readScheduleState(transaction, projectId);
            const evaluation = evaluateSchedule(task.data, snapshot.calendar, input.startDate, input.dueDate);
            const { tasks, effective } = effectiveStates(snapshot);
            tasks.set(taskId, { ...task, data: { ...task.data, startDate: input.startDate, dueDate: input.dueDate } });
            const warnings = [...evaluation.warnings, ...dependencyWarnings(taskId, tasks, effective)];
            for (const row of snapshot.tasks) if ((row.data.predecessorTaskIds || []).includes(taskId)) warnings.push(...dependencyWarnings(row.id, tasks, effective).map((warning) => ({ ...warning, successorTaskId: row.id })));
            const value = { token, taskId, before: { startDate: task.data.startDate || null, dueDate: task.data.dueDate || null }, after: { startDate: input.startDate, dueDate: input.dueDate }, workingDayCount: evaluation.workingDayCount, nonWorkingDays: evaluation.nonWorkingDays, warnings,
                canApply: evaluation.calendar.requiresConfiguration.length === 0, calendarRevision: evaluation.calendar.revision, feedVersion: FEED_VERSION };
            transaction.set(projectCollection(db, projectId, 'schedulePreviews').doc(slot), { actorUid: identity.uid, projectId, taskId, token, expectedRevision, fence: scheduleFence(snapshot), preview: value, expiresAt: new Date(new Date(now()).getTime() + 15 * 60000).toISOString() });
            return { preview: value };
        });
    }
    async function apply(identity, projectId, input) {
        projectId = id(projectId, 'project ID'); const token = String(input.previewToken || '');
        if (!/^[a-f0-9]{32}\.[A-Za-z0-9_-]{32}$/.test(token)) throw new DomainError(400, 'INVALID_PREVIEW', 'Invalid preview token.');
        return commandService.runCommand({ actorUid: identity.uid, command: 'applySchedulePreview', projectId, targetId: token.split('.')[0], operationId: input.operationId, payload: { previewToken: token }, access: { write: true }, execute: async ({ transaction }) => {
            const stored = await transaction.get(projectCollection(db, projectId, 'schedulePreviews').doc(token.split('.')[0]));
            const value = stored.exists ? stored.data() : null;
            if (!value || value.actorUid !== identity.uid || value.projectId !== projectId || value.token !== token || Date.parse(value.expiresAt) <= new Date(now()).getTime()) throw new DomainError(409, 'STALE_PREVIEW', 'Preview expired or was replaced; preview again.');
            const task = await assertProjectTask(transaction, db, projectId, value.taskId);
            const snapshot = await readScheduleState(transaction, projectId);
            if (scheduleFence(snapshot) !== value.fence || Number(task.data.revision || 0) !== value.expectedRevision) throw new DomainError(409, 'STALE_PREVIEW', 'Task, dependencies or calendar changed; preview again.');
            if (!value.preview.canApply || value.preview.feedVersion !== FEED_VERSION) throw new DomainError(409, 'CALENDAR_INCOMPLETE', 'Resolve calendar choices before applying this preview.');
            const revision = value.expectedRevision + 1;
            transaction.update(task.ref, { ...value.preview.after, revision, updatedAt: nowIso(now), updatedBy: identity.uid });
            return { result: { task: { id: task.id, revision }, operationId: input.operationId }, before: { taskId: task.id, revision: value.expectedRevision }, after: { taskId: task.id, revision }, inverse: { kind: 'updateTask', changes: [{ type: 'task', id: task.id, previous: value.preview.before, fields: ['startDate', 'dueDate'], expectedRevisionAfter: revision }] }, affectedIds: [task.id], affectedPaths: [task.ref.path], beforeRevisions: { [task.ref.path]: value.expectedRevision }, afterRevisions: { [task.ref.path]: revision } };
        } });
    }
    return { views, calendar, dependencies, preview, apply };
}
module.exports = { createViewCalendarService, assertDependencyGraph, dependencyWarnings, effectiveStates };
