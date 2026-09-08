'use strict';
const { createProjectsContextDetails } = require('./context-details');
const { isProjectsFeatureEnabled } = require('../feature-config');
const { assertStaffIdentity } = require('../budget-service');
const { projectCollection } = require('../domain/storage');
const { id, uid, normalizeDate, validateProjectInput, validateSectionInput, validateColumnInput, validateTaskInput, validateTypedValues, STATUS_KEYS } = require('../domain/validation');
const { resolveTaskState } = require('../domain/hierarchy');
const { strict, reject } = require('../../../ai-assistance/accounting/money-pricing');
const VIEWS = Object.freeze(['board', 'kanban', 'timeline', 'calendar', 'charts']);
const LIMITS = Object.freeze({ selectedTasks: 20, ancestorDepth: 20, totalTasks: 100, columns: 200, contextBytes: 32768 });
function revision(record, key = 'revision') { const value = record[key] ?? 0; if (!Number.isSafeInteger(value) || value < 0) reject('INVALID_CONTEXT_REVISION', 'Current project revisions are invalid.', 409); return value; }
function lifecycle(record) { const value = record.lifecycle ?? 'active'; if (!['active', 'archived', 'trashed'].includes(value)) reject('INVALID_CONTEXT_RECORD', 'Record lifecycle is invalid.', 409); return value; }
function owned(record, projectId) { if (!record || record.projectId !== projectId) reject('INVALID_CONTEXT_RECORD', 'A context record does not belong to this project.', 409); }
function normalizeContextHints(raw) {
    if (raw?.mode === 'create_project') { strict(raw, ['mode']); return { mode: 'create_project' }; }
    strict(raw, ['projectId', 'view', 'selectedTaskIds', 'filters']); const projectId = id(raw.projectId, 'project ID'); const view = raw.view ?? 'board';
    if (!VIEWS.includes(view)) reject('INVALID_CONTEXT_HINTS', 'Unsupported Projects view.');
    const selected = raw.selectedTaskIds ?? []; if (!Array.isArray(selected) || selected.length > LIMITS.selectedTasks) reject('CONTEXT_LIMIT', 'Select at most twenty tasks.');
    const selectedTaskIds = selected.map(value => id(value, 'task ID')); if (new Set(selectedTaskIds).size !== selectedTaskIds.length) reject('INVALID_CONTEXT_HINTS', 'Selected tasks must be unique.');
    const filters = {}; if (raw.filters !== undefined) {
        strict(raw.filters, ['sectionId', 'status', 'ownerUid', 'assigneeUid', 'fromDate', 'toDate']);
        for (const [key, value] of Object.entries(raw.filters)) {
            if (key === 'sectionId') filters[key] = id(value, 'section ID');
            else if (key === 'ownerUid' || key === 'assigneeUid') filters[key] = uid(value);
            else if (key === 'status') { if (!STATUS_KEYS.includes(value)) reject('INVALID_CONTEXT_HINTS', 'Invalid status filter.'); filters[key] = value; }
            else { const date = normalizeDate(value, key); if (!date) reject('INVALID_CONTEXT_HINTS', 'Date filters require an explicit date.'); filters[key] = date; }
        }
        if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) reject('INVALID_CONTEXT_HINTS', 'Date filter bounds are reversed.');
    }
    return { projectId, view, selectedTaskIds: selectedTaskIds.sort(), filters };
}
function createProjectsVoiceContextAdapter({ db, accessService, now = Date.now, taskLinksService = null } = {}) {
    if (!db || typeof accessService?.assertTransactionEligible !== 'function' || typeof accessService?.assertTransactionContentAccess !== 'function') throw new TypeError('Current canonical Projects authority is required.');
    function enabled() { if (!isProjectsFeatureEnabled('projects')) reject('PROJECTS_DISABLED', 'Projects is not enabled.', 404); }
    const details = createProjectsContextDetails({ db, accessService, now, taskLinksService });
    async function authorize({ tx, actorUid }) { enabled(); uid(actorUid); const identity = assertStaffIdentity(await accessService.assertTransactionEligible(tx, actorUid)); if (identity.uid !== actorUid) reject('VOICE_FORBIDDEN', 'Current staff identity is required.', 403); return true; }
    async function resolveContext({ tx, actorUid, contextHints = {} }) {
        enabled(); uid(actorUid); const hints = normalizeContextHints(contextHints);
        if (hints.mode === 'create_project') {
            await authorize({ tx, actorUid });
            return { summary: 'Create a new project. The current staff member will be its Owner.', previewBinding: null, context: { purpose: 'project_creation', mode: 'create_project', creatorUid: actorUid } };
        }
        // The caller owns this transaction. All membership/project/record reads
        // remain on it; never enter queryService.readSnapshot's transaction.
        const access = await accessService.assertTransactionContentAccess(tx, actorUid, hints.projectId, {});
        const identity = assertStaffIdentity(access.identity);
        if (identity.uid !== actorUid || access.project.id !== hints.projectId || access.membership?.data?.uid !== actorUid || access.membership.data.projectId !== hints.projectId || access.membership.data.active === false || access.membership.data.role !== access.role || !['Owner', 'Editor', 'Viewer'].includes(access.role)) reject('VOICE_FORBIDDEN', 'Current project membership is required.', 403);
        const project = access.project.data; if (lifecycle(project) !== 'active') reject('PROJECT_INACTIVE', 'Planning requires an active project.', 409);
        const tasks = new Map();
        async function readTask(taskId) {
            if (tasks.has(taskId)) return tasks.get(taskId);
            if (tasks.size >= LIMITS.totalTasks) reject('CONTEXT_LIMIT', 'Task ancestry exceeds the context record limit.', 409);
            const snapshot = await tx.get(projectCollection(db, hints.projectId, 'tasks').doc(taskId));
            if (!snapshot.exists) reject('TASK_NOT_FOUND', 'A selected task or ancestor is unavailable.', 404);
            const data = snapshot.data(); owned(data, hints.projectId); if (lifecycle(data) !== 'active') reject('TASK_INACTIVE', 'A selected task or ancestor is inactive.', 409);
            const row = { id: taskId, data }; tasks.set(taskId, row); return row;
        }
        const sectionIds = new Set(hints.filters.sectionId ? [hints.filters.sectionId] : []);
        for (const selectedId of hints.selectedTaskIds) {
            const seen = new Set(); let currentId = selectedId;
            while (currentId) {
                if (seen.has(currentId)) reject('ANCESTRY_CYCLE', 'Task ancestry contains a cycle.', 409);
                if (seen.size >= LIMITS.ancestorDepth) reject('CONTEXT_LIMIT', 'Selected task ancestry exceeds twenty levels.', 409);
                seen.add(currentId); const row = await readTask(currentId);
                currentId = row.data.parentTaskId == null || row.data.parentTaskId === '' ? null : id(row.data.parentTaskId, 'parent task ID');
                if (!currentId) sectionIds.add(id(row.data.sectionId, 'section ID'));
            }
        }
        const sections = new Map();
        for (const sectionId of [...sectionIds].sort()) {
            const snapshot = await tx.get(projectCollection(db, hints.projectId, 'sections').doc(sectionId)); if (!snapshot.exists) reject('INVALID_SECTION_REFERENCE', 'A referenced section is unavailable.', 409);
            const data = snapshot.data(); owned(data, hints.projectId); if (lifecycle(data) !== 'active') reject('SECTION_INACTIVE', 'A referenced section is inactive.', 409); sections.set(sectionId, { id: sectionId, data });
        }
        const schema = await tx.get(projectCollection(db, hints.projectId, 'columns').limit(LIMITS.columns + 1)); if (schema.docs.length > LIMITS.columns) reject('CONTEXT_LIMIT', 'Project schema exceeds its context limit.', 409);
        const schemaRows = schema.docs.map(snapshot => { const data = snapshot.data(); owned(data, hints.projectId); return { id: id(snapshot.id, 'column ID'), data, lifecycle: lifecycle(data) }; });
        const inactiveColumnIds = new Set(schemaRows.filter(row => row.lifecycle !== 'active').map(row => row.id));
        const columns = schemaRows.filter(row => row.lifecycle === 'active').sort((a, b) => a.id.localeCompare(b.id));
        const columnDtos = columns.map(row => ({ id: row.id, ...validateColumnInput({ type: row.data.type, label: row.data.label ?? row.data.name, ...(row.data.options !== undefined ? { options: row.data.options } : {}), ...(row.data.statusLabels !== undefined ? { statusLabels: row.data.statusLabels } : {}) }), revision: revision(row.data) }));
        const columnMap = Object.fromEntries(columnDtos.map(column => [column.id, column]));
        const taskDtos = [...tasks.values()].sort((a, b) => a.id.localeCompare(b.id)).map(row => {
            const data = row.data, effective = resolveTaskState({ tasks, taskId: row.id, sections, projectLifecycle: 'active' });
            const safe = validateTaskInput({ title: data.title, status: data.status, ownerUid: data.ownerUid, assigneeUids: data.assigneeUids, startDate: data.startDate, dueDate: data.dueDate, values: data.values ?? {} });
            // Canonical column archive preserves historical task values. Hide
            // only values whose inactive schema record was actually read; an
            // unknown column remains an integrity error during validation.
            const activeValues = Object.fromEntries(Object.entries(safe.values).filter(([columnId]) => !inactiveColumnIds.has(columnId)));
            return { id: row.id, ...safe, values: validateTypedValues(activeValues, columnMap), revision: revision(data), parentTaskId: data.parentTaskId || null, sectionId: effective.sectionId, ancestorIds: effective.ancestorIds, selected: hints.selectedTaskIds.includes(row.id) };
        });
        const projectDto = { id: hints.projectId, ...validateProjectInput({ name: project.name, ...(project.description !== undefined ? { description: project.description } : {}) }), revision: revision(project), structureRevision: revision(project, 'structureRevision'), schemaRevision: revision(project, 'schemaRevision'), membershipRevision: revision(project, 'membershipRevision') };
        const context = { purpose: 'planning', view: hints.view, filters: hints.filters, selectedTaskIds: hints.selectedTaskIds, project: projectDto, membership: { role: access.role, membershipRevision: projectDto.membershipRevision }, tasks: taskDtos, sections: [...sections.values()].map(row => ({ id: row.id, ...validateSectionInput({ title: row.data.title ?? row.data.name }), revision: revision(row.data) })), columns: columnDtos };
        Object.assign(context, await details.resolve({ tx, actorUid, projectId: hints.projectId, selectedTaskIds: hints.selectedTaskIds, access }));
        if (Buffer.byteLength(JSON.stringify(context)) > LIMITS.contextBytes) reject('CONTEXT_LIMIT', 'Selected context exceeds the byte limit; narrow the selection.', 409);
        return { summary: `Projects planning: ${projectDto.name}. View: ${hints.view}. Selected tasks: ${hints.selectedTaskIds.length}.`, previewBinding: null, context };
    }
    // Planning has no canonical executable draft/preview yet. Speech cannot
    // create confirmation authority until a domain preview adapter is added.
    return Object.freeze({ authorize, resolveContext, confirm: async () => false });
}
module.exports = { createProjectsVoiceContextAdapter, normalizeContextHints, VIEWS, LIMITS };
