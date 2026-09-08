'use strict';

const { PROJECT_COLLECTIONS, memberDocumentId } = require('./access-service');
const crypto = require('crypto');
const { assertDependencyGraph } = require('./view-calendar-service');
const { evaluateSchedule, FEED_VERSION } = require('./calendar-model');
const { DomainError, id, digestPayload, validateTaskPatch, validateTypedValues } = require('./domain/validation');
const { resolveTaskState, assertNoCycle, lifecycleRank, lifecycleName } = require('./domain/hierarchy');
const { projectCollection, projectRef, operationRef, cursorRef, readData, snapshotRows } = require('./domain/storage');
const { createProjectsQueryService, snapshotDigest } = require('./domain/query-service');
const { computeInsertionRank, compareSiblings } = require('./domain/ordering');
const {
    MAX_HISTORY_PAGE,
    MAX_BULK_TASKS,
    MAX_BULK_OPERATION_BYTES,
    nowIso,
    makeStableId,
    pathFor,
    operationCursor,
    encodeOperationCursor
} = require('./phase4-utils');

async function readProjectRows(transaction, db, projectId, collectionName) {
    const limit = collectionName === 'columns' ? 200 : 1000;
    const rows = snapshotRows(await transaction.get(projectCollection(db, projectId, collectionName).limit(limit + 1)));
    if (rows.length > limit) throw new DomainError(409, 'PROJECT_QUERY_LIMIT', `Project ${collectionName} exceed the bounded operation limit.`);
    return rows;
}

const LIFECYCLES = Object.freeze(['active', 'archived', 'trashed']);
const LIFECYCLE_TARGETS = Object.freeze(['project', 'section', 'task']);
const MAX_RECOVERY_TASKS = 20000;
const MAX_RECOVERY_SECTIONS = 1000;

function revisionOf(data) {
    return Number.isSafeInteger(Number(data?.revision)) && Number(data.revision) >= 0 ? Number(data.revision) : 0;
}

function structureRevisionOf(data) {
    return Number.isSafeInteger(Number(data?.structureRevision)) && Number(data.structureRevision) >= 0 ? Number(data.structureRevision) : 0;
}

function rowPath(projectId, type, recordId) {
    return type === 'project' ? `crmProjects/${projectId}` : pathFor(projectId, `${type}s`, recordId);
}

function refFor(db, projectId, type, recordId) {
    if (type === 'project') return projectRef(db, projectId);
    return projectCollection(db, projectId, `${type}s`).doc(recordId);
}

function normalizeTarget(type, targetId) {
    const normalizedType = String(type || '').trim().toLowerCase();
    if (!LIFECYCLE_TARGETS.includes(normalizedType)) throw new DomainError(400, 'INVALID_LIFECYCLE_TARGET', 'Lifecycle target is invalid.');
    return { type: normalizedType, id: normalizedType === 'project' ? id(targetId, 'project ID') : id(targetId, `${normalizedType} ID`) };
}

function assertExpectedRevision(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new DomainError(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required.');
    return value;
}

function projectRevisions(data, overrides = {}) {
    return { revision: revisionOf(data), structureRevision: structureRevisionOf(data), schemaRevision: Number(data.schemaRevision || 0), ...overrides };
}

function changedFields(before, after) {
    const metadata = new Set(['id', 'revision', 'updatedAt', 'updatedBy', 'schemaRevision', 'structureRevision', 'contentRevision', 'membershipRevision']);
    return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((key) => !metadata.has(key) && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
}

function compensateFields(current, previous, fields) {
    const next = { ...current };
    for (const key of fields) {
        if (Object.prototype.hasOwnProperty.call(previous, key)) next[key] = previous[key];
        else delete next[key];
    }
    return next;
}

function canUndoOperation(operation, role, actorUid) {
    if (!['Owner', 'Editor'].includes(role) || operation.command === 'undoOperation') return false;
    if (!['moveTask', 'moveSection', 'moveColumn', 'updateTask', 'updateProject', 'createProject', 'createTask', 'discussionMessage', 'bulkTaskUpdate', 'bulkTaskMove', 'lifecycle', 'taskDependencies'].includes(operation.inverse?.kind)) return false;
    if (role !== 'Owner' && (['moveSection', 'moveColumn', 'updateProject', 'moderateDiscussionMessage'].includes(operation.command)
        || ['createProject', 'updateProject'].includes(operation.inverse.kind) || (operation.inverse.changes || []).some((change) => ['project', 'section', 'column'].includes(change.type)))) return false;
    if (operation.inverse.kind === 'discussionMessage' && operation.actorUid !== actorUid && role !== 'Owner') return false;
    return true;
}

function safeOperationSummary(operation) {
    const result = operation?.result || {};
    const summary = {};
    if (result.count !== undefined) summary.count = result.count;
    if (result.targetType !== undefined) summary.targetType = result.targetType;
    if (result.targetId !== undefined) summary.targetId = result.targetId;
    if (result.action !== undefined) summary.action = result.action;
    if (result.lifecycle !== undefined) summary.lifecycle = result.lifecycle;
    if (result.status !== undefined) summary.status = result.status;
    if (result.revision !== undefined) summary.revision = result.revision;
    for (const key of ['updated', 'undone', 'affected']) {
        if (Array.isArray(result[key])) summary[key] = result[key].map((entry) => ({
            type: entry?.type,
            id: entry?.id || entry?.taskId || entry?.sectionId || entry?.columnId,
            revision: entry?.revision
        }));
    }
    if (result.message) summary.message = { id: result.message.id, revision: result.message.revision, moderationState: result.message.moderationState };
    if (result.attachment) summary.attachment = { id: result.attachment.id, status: result.attachment.status, revision: result.attachment.revision };
    return summary;
}

function serializeOperation(operation, canUndo) {
    return {
        operationId: operation.operationId,
        projectId: operation.projectId,
        actorUid: operation.actorUid,
        command: operation.command,
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
        affectedIds: Array.isArray(operation.affectedIds) ? operation.affectedIds : [],
        affectedPaths: Array.isArray(operation.affectedPaths) ? operation.affectedPaths : [],
        beforeRevisions: operation.beforeRevisions || {},
        afterRevisions: operation.afterRevisions || {},
        structureRevisionBefore: operation.structureRevisionBefore ?? null,
        structureRevisionAfter: operation.structureRevisionAfter ?? null,
        origin: operation.origin || 'manual',
        summary: safeOperationSummary(operation),
        canUndo
    };
}

function buildService({ db, accessService, commandService, queryService, now = () => new Date() } = {}) {
    if (!db || typeof db.runTransaction !== 'function') throw new Error('Projects recovery service requires Firestore db.');
    if (!accessService || typeof accessService.assertTransactionContentAccess !== 'function') throw new Error('Projects recovery service requires the canonical access service.');
    if (!commandService || typeof commandService.runCommand !== 'function') throw new Error('Projects recovery service requires the canonical command executor.');
    const queries = queryService || createProjectsQueryService({ db, accessService, now });

    function snapshotGraph(snapshot) {
        return { project: snapshot.project, sections: new Map(snapshot.sections.map((row) => [row.id, row])), tasks: new Map(snapshot.tasks.map((row) => [row.id, row])) };
    }

    function recoveryEntry(graph, type, row, role) {
        const projectId = graph.project.id;
        const describe = (recordType, record) => ({ path: rowPath(projectId, recordType, record.id), type: recordType, id: record.id, title: record.data.title || record.data.name || record.id, lifecycle: record.data.lifecycle || 'active', revision: revisionOf(record.data) });
        const ancestors = type === 'project' ? [] : [describe('project', graph.project)];
        let effective = row.data.lifecycle || 'active', sectionId = null;
        if (type === 'task') {
            const state = resolveTaskState({ tasks: graph.tasks, taskId: row.id, sections: graph.sections, projectLifecycle: graph.project.data.lifecycle || 'active' });
            effective = state.lifecycle; sectionId = state.sectionId;
            ancestors.push(describe('section', graph.sections.get(sectionId)));
            state.ancestorIds.slice().reverse().forEach((taskId) => ancestors.push(describe('task', graph.tasks.get(taskId))));
        } else if (type === 'section') effective = lifecycleName(Math.max(lifecycleRank(effective), lifecycleRank(graph.project.data.lifecycle)));
        const authorized = role === 'Owner' || (role === 'Editor' && type === 'task');
        return { targetId: row.id, targetType: type, title: row.data.title || row.data.name || row.id, lifecycle: effective, localLifecycle: row.data.lifecycle || 'active', revision: revisionOf(row.data), structureRevision: structureRevisionOf(graph.project.data), parentId: row.data.parentTaskId || null, parentSectionId: sectionId, ancestorPaths: ancestors, allowedActions: { archive: authorized && effective === 'active', trash: authorized && effective !== 'trashed', restore: authorized && effective !== 'active' }, canRestore: authorized && effective !== 'active' };
    }

    async function listRecovery(identity, projectId, options = {}) {
        const project = id(projectId, 'project ID');
        const type = String(options.targetType || 'task'), lifecycle = String(options.lifecycle || 'active');
        if (!LIFECYCLE_TARGETS.includes(type) || !LIFECYCLES.includes(lifecycle)) throw new DomainError(400, 'INVALID_RECOVERY_QUERY', 'Choose a valid lifecycle and record type.');
        const limit = options.limit === undefined ? 50 : Number(options.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new DomainError(400, 'INVALID_RECOVERY_LIMIT', 'Recovery limit must be from 1 to 100.');
        const queryIdentity = digestPayload({ kind: 'recovery', projectId: project, type, lifecycle, limit });
        const snapshot = await queries.readSnapshot(identity, project);
        const digest = snapshotDigest(snapshot.project, snapshot.sections, snapshot.columns, snapshot.tasks, queryIdentity);
        let previous = null;
        if (options.cursor) {
            if (typeof options.cursor !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(options.cursor)) throw new DomainError(400, 'INVALID_CURSOR', 'Recovery cursor is invalid.');
            previous = readData(await cursorRef(db, options.cursor).get());
            if (!previous || previous.actorUid !== identity.uid || previous.projectId !== project || previous.queryIdentity !== queryIdentity) throw new DomainError(400, 'INVALID_CURSOR', 'Recovery cursor belongs to a different query.');
            if (Date.parse(previous.expiresAt || '') <= new Date(now()).getTime() || previous.snapshotDigest !== digest) throw new DomainError(409, 'STALE_CURSOR', 'Project changed; refresh recovery records.');
        }
        const graph = snapshotGraph(snapshot);
        const rows = type === 'project' ? [snapshot.project] : snapshot[`${type}s`];
        // The bounded coherent graph is resolved before filtering and paging.
        let matching = rows.map((row) => recoveryEntry(graph, type, row, snapshot.access.role)).filter((entry) => entry.lifecycle === lifecycle).sort((a, b) => a.targetId.localeCompare(b.targetId));
        if (previous) {
            const index = matching.findIndex((entry) => entry.targetId === previous.lastId);
            if (index < 0) throw new DomainError(409, 'STALE_CURSOR', 'Recovery cursor position disappeared.');
            matching = matching.slice(index + 1);
        }
        const entries = matching.slice(0, limit), hasMore = matching.length > limit;
        let nextCursor = null;
        if (hasMore) {
            nextCursor = crypto.randomBytes(24).toString('base64url');
            await cursorRef(db, nextCursor).set({ actorUid: identity.uid, projectId: project, queryIdentity, snapshotDigest: digest, lastId: entries[entries.length - 1].targetId, createdAt: nowIso(now), expiresAt: new Date(new Date(now()).getTime() + 15 * 60 * 1000).toISOString() });
        }
        return { entries, hasMore, nextCursor, project: { id: project, ...projectRevisions(snapshot.project.data) }, revision: projectRevisions(snapshot.project.data) };
    }

    async function previewRecovery(identity, projectId, options = {}) {
        const project = id(projectId, 'project ID'), target = normalizeTarget(options.targetType, options.targetId);
        if (target.type === 'project' && target.id !== project) throw new DomainError(400, 'PROJECT_TARGET_MISMATCH', 'Project target must match the route.');
        const action = String(options.action || '');
        if (!['archive', 'trash', 'restore'].includes(action)) throw new DomainError(400, 'INVALID_LIFECYCLE_ACTION', 'Choose a valid recovery action.');
        if (options.restoreChain !== undefined && ![true, false, 'true', 'false'].includes(options.restoreChain)) throw new DomainError(400, 'INVALID_RESTORE_CHAIN', 'restoreChain must be true or false.');
        const restoreChain = options.restoreChain === true || options.restoreChain === 'true';
        const destinationSectionId = options.destinationSectionId ? id(options.destinationSectionId, 'destination section ID') : null;
        if (destinationSectionId && (target.type !== 'task' || action !== 'restore')) throw new DomainError(400, 'INVALID_RESTORE_DESTINATION', 'Only task restoration accepts a destination.');
        const snapshot = await queries.readSnapshot(identity, project), graph = snapshotGraph(snapshot);
        const row = targetRow(graph, target);
        if (!row) throw new DomainError(404, 'RECOVERY_TARGET_NOT_FOUND', 'Recovery record not found.');
        const entry = recoveryEntry(graph, target.type, row, snapshot.access.role);
        const unavailable = entry.ancestorPaths.filter((ancestor) => ancestor.lifecycle !== 'active');
        const destinationOptions = (graph.project.data.lifecycle || 'active') === 'active' ? snapshot.sections.filter((section) => (section.data.lifecycle || 'active') === 'active').map((section) => ({ id: section.id, title: section.data.title || section.data.name || section.id, revision: revisionOf(section.data) })) : [];
        let allowed = entry.allowedActions[action], reason = '';
        const chainRequiresOwner = unavailable.some((ancestor) => ancestor.type !== 'task');
        const requiresOwner = target.type !== 'task' || (restoreChain && chainRequiresOwner);
        if (requiresOwner && snapshot.access.role !== 'Owner') { allowed = false; reason = 'This action requires the project Owner.'; }
        if (action === 'restore' && unavailable.length && !restoreChain && !destinationSectionId) { allowed = false; reason = 'Restore unavailable ancestors explicitly or choose an active destination.'; }
        if (destinationSectionId && !destinationOptions.some((section) => section.id === destinationSectionId)) { allowed = false; reason = 'The destination section is unavailable.'; }
        const toLifecycle = action === 'restore' ? 'active' : action === 'archive' ? 'archived' : 'trashed';
        const affected = [{ path: rowPath(project, target.type, target.id), type: target.type, id: target.id, title: entry.title, fromLifecycle: entry.localLifecycle, toLifecycle, revision: entry.revision }];
        const expectedAncestorRevisions = {};
        if (action === 'restore' && restoreChain) for (const ancestor of unavailable) {
            affected.push({ ...ancestor, fromLifecycle: ancestor.lifecycle, toLifecycle: 'active' });
            expectedAncestorRevisions[ancestor.path] = ancestor.revision;
        }
        return { action, restoreChain, destinationSectionId, target: entry, affected, destinationOptions, expectedRevision: entry.revision, expectedStructureRevision: structureRevisionOf(graph.project.data), expectedAncestorRevisions, allowed, requiresOwner, chainRequiresOwner, reason };
    }

    async function readTaskGraph(transaction, projectId) {
        const [projectSnapshot, sectionSnapshot, taskSnapshot] = await Promise.all([
            transaction.get(projectRef(db, projectId)),
            transaction.get(projectCollection(db, projectId, 'sections').limit(MAX_RECOVERY_SECTIONS + 1)),
            transaction.get(projectCollection(db, projectId, 'tasks').limit(MAX_RECOVERY_TASKS + 1))
        ]);
        if ((sectionSnapshot?.size || 0) > MAX_RECOVERY_SECTIONS || (taskSnapshot?.size || 0) > MAX_RECOVERY_TASKS) throw new DomainError(409, 'PROJECT_QUERY_LIMIT', 'Recovery graph exceeds the bounded operation limit.');
        const sections = new Map(snapshotRows(sectionSnapshot).map((row) => [row.id, row]));
        const tasks = new Map(snapshotRows(taskSnapshot).map((row) => [row.id, row]));
        return {
            project: projectSnapshot?.exists ? { id: projectId, data: projectSnapshot.data() || {}, ref: projectRef(db, projectId) } : null,
            sections,
            tasks
        };
    }

    async function readLifecycleGraph(transaction, projectId, target) {
        const projectSnapshot = await transaction.get(projectRef(db, projectId));
        const graph = {
            project: projectSnapshot?.exists ? { id: projectId, data: projectSnapshot.data() || {}, ref: projectRef(db, projectId) } : null,
            sections: new Map(),
            tasks: new Map()
        };
        if (target.type === 'project') return graph;
        const collection = target.type === 'section' ? 'sections' : 'tasks';
        const targetRef = projectCollection(db, projectId, collection).doc(target.id);
        const targetSnapshot = await transaction.get(targetRef);
        if (target.type === 'section') {
            if (targetSnapshot?.exists) graph.sections.set(target.id, { id: target.id, data: targetSnapshot.data() || {}, ref: targetRef });
            return graph;
        }
        if (targetSnapshot?.exists) graph.tasks.set(target.id, { id: target.id, data: targetSnapshot.data() || {}, ref: targetRef });
        let current = graph.tasks.get(target.id);
        const seen = new Set([target.id]);
        while (current?.data?.parentTaskId) {
            const parentId = id(current.data.parentTaskId, 'parent task ID');
            if (seen.has(parentId)) throw new DomainError(409, 'ANCESTRY_CYCLE', 'Task ancestry contains a cycle.');
            const parentRef = projectCollection(db, projectId, 'tasks').doc(parentId);
            const parentSnapshot = await transaction.get(parentRef);
            if (!parentSnapshot?.exists) throw new DomainError(409, 'INVALID_PARENT_REFERENCE', 'Task parent must belong to this project.');
            current = { id: parentId, data: parentSnapshot.data() || {}, ref: parentRef };
            graph.tasks.set(parentId, current);
            seen.add(parentId);
        }
        const sectionId = current?.data?.sectionId;
        if (!sectionId) throw new DomainError(409, 'INVALID_SECTION_REFERENCE', 'Root task section is required.');
        const sectionRef = projectCollection(db, projectId, 'sections').doc(id(sectionId, 'section ID'));
        const sectionSnapshot = await transaction.get(sectionRef);
        if (!sectionSnapshot?.exists) throw new DomainError(409, 'INVALID_SECTION_REFERENCE', 'Root task section must belong to this project.');
        graph.sections.set(sectionId, { id: sectionId, data: sectionSnapshot.data() || {}, ref: sectionRef });
        return graph;
    }

    function targetRow(graph, target) {
        if (target.type === 'project') return graph.project;
        return graph[`${target.type}s`].get(target.id) || null;
    }

    function taskAncestors(tasks, taskId) {
        const chain = [];
        const seen = new Set();
        let current = tasks.get(taskId);
        while (current) {
            if (seen.has(current.id)) throw new DomainError(409, 'ANCESTRY_CYCLE', 'Task ancestry contains a cycle.');
            seen.add(current.id);
            chain.push(current);
            const parentId = current.data.parentTaskId || null;
            current = parentId ? tasks.get(parentId) : null;
            if (parentId && !current) throw new DomainError(409, 'INVALID_PARENT_REFERENCE', 'Task parent must belong to this project.');
        }
        return chain;
    }

    async function changeLifecycle(identity, projectId, targetType, targetId, action, rawPayload = {}) {
        const normalizedProjectId = id(projectId, 'project ID');
        const target = normalizeTarget(targetType, targetId);
        if (target.type === 'project' && target.id !== normalizedProjectId) throw new DomainError(400, 'PROJECT_TARGET_MISMATCH', 'Project lifecycle target must match the route project.');
        const operationId = id(rawPayload.operationId, 'operation ID');
        const expectedRevision = assertExpectedRevision(rawPayload.expectedRevision);
        const normalizedAction = String(action || '').trim().toLowerCase();
        const nextLifecycle = normalizedAction === 'archive' ? 'archived' : (normalizedAction === 'trash' ? 'trashed' : (normalizedAction === 'restore' ? 'active' : ''));
        if (!nextLifecycle) throw new DomainError(400, 'INVALID_LIFECYCLE_ACTION', 'Lifecycle action is invalid.');
        const restoreChain = rawPayload.restoreChain === true;
        const destinationSectionId = rawPayload.destinationSectionId ? id(rawPayload.destinationSectionId, 'destination section ID') : null;
        if (destinationSectionId && (target.type !== 'task' || normalizedAction !== 'restore')) throw new DomainError(400, 'INVALID_RESTORE_DESTINATION', 'Only task restoration accepts a destination.');
        if (rawPayload.expectedStructureRevision === undefined) throw new DomainError(400, 'EXPECTED_STRUCTURE_REVISION_REQUIRED', 'expectedStructureRevision is required for lifecycle changes.');
        const expectedStructureRevision = assertExpectedRevision(rawPayload.expectedStructureRevision);
        const expectedAncestorRevisions = rawPayload.expectedAncestorRevisions && typeof rawPayload.expectedAncestorRevisions === 'object' && !Array.isArray(rawPayload.expectedAncestorRevisions)
            ? rawPayload.expectedAncestorRevisions
            : {};
        const access = target.type === 'task' ? { write: true, roles: ['Owner', 'Editor'] } : { owner: true, roles: ['Owner'] };
        return commandService.runCommand({
            actorUid: identity.uid,
            command: `${normalizedAction}${target.type[0].toUpperCase()}${target.type.slice(1)}`,
            projectId: normalizedProjectId,
            targetId: target.id,
            operationId,
            payload: { targetType: target.type, targetId: target.id, action: normalizedAction, expectedRevision, restoreChain, destinationSectionId, expectedStructureRevision, expectedAncestorRevisions },
            access,
            execute: async ({ transaction, contentAccess }) => {
                const graph = await readLifecycleGraph(transaction, normalizedProjectId, target);
                const currentTarget = targetRow(graph, target);
                if (!currentTarget) throw new DomainError(404, `${target.type.toUpperCase()}_NOT_FOUND`, `${target.type} not found.`);
                if (revisionOf(currentTarget.data) !== expectedRevision) throw new DomainError(409, 'STALE_REVISION', `${target.type} changed; refresh and retry.`);
                const currentLifecycle = currentTarget.data.lifecycle || 'active';
                let effectiveCurrentLifecycle = currentLifecycle;
                if (target.type === 'task') effectiveCurrentLifecycle = resolveTaskState({ tasks: graph.tasks, taskId: target.id, projectLifecycle: graph.project?.data?.lifecycle || 'active', sections: graph.sections }).lifecycle;
                else if (target.type === 'section') effectiveCurrentLifecycle = lifecycleName(Math.max(lifecycleRank(currentLifecycle), lifecycleRank(graph.project?.data?.lifecycle)));
                if (normalizedAction === 'restore' && effectiveCurrentLifecycle === 'active') throw new DomainError(409, 'LIFECYCLE_ALREADY_ACTIVE', `${target.type} is already active.`);
                if (normalizedAction !== 'restore' && currentLifecycle === nextLifecycle) throw new DomainError(409, 'LIFECYCLE_ALREADY_SET', `${target.type} is already ${nextLifecycle}.`);
                if ((normalizedAction === 'archive' && effectiveCurrentLifecycle !== 'active') || (normalizedAction === 'trash' && effectiveCurrentLifecycle === 'trashed')) throw new DomainError(409, 'LIFECYCLE_ACTION_UNAVAILABLE', 'This lifecycle action is unavailable under the current ancestry.');
                const timestamp = nowIso(now);
                const changes = [];
                let destinationRank = null;
                const queue = [{ type: target.type, id: target.id, row: currentTarget }];
                if (normalizedAction === 'restore') {
                    if (target.type === 'project') {
                        // No ancestor exists above a project.
                    } else if (target.type === 'section') {
                        const projectLifecycle = graph.project?.data?.lifecycle || 'active';
                        if (projectLifecycle !== 'active') {
                            if (!restoreChain) throw new DomainError(409, 'RESTORE_ANCESTOR_UNAVAILABLE', 'Project is unavailable; restore the chain or choose an active destination.');
                            queue.push({ type: 'project', id: normalizedProjectId, row: graph.project });
                        }
                    } else {
                        const taskChain = taskAncestors(graph.tasks, target.id);
                        const sectionId = taskChain[taskChain.length - 1].data.sectionId;
                        const section = graph.sections.get(sectionId);
                        const projectLifecycle = graph.project?.data?.lifecycle || 'active';
                        const hasUnavailableAncestor = taskChain.slice(1).some((row) => (row.data.lifecycle || 'active') !== 'active')
                            || !section || (section.data.lifecycle || 'active') !== 'active' || projectLifecycle !== 'active';
                        if (hasUnavailableAncestor && !restoreChain && !destinationSectionId) {
                            throw new DomainError(409, 'RESTORE_ANCESTOR_UNAVAILABLE', 'An ancestor is unavailable; restore the chain or choose an active destination.');
                        }
                        if (restoreChain) {
                            taskChain.slice(1).filter((row) => (row.data.lifecycle || 'active') !== 'active').forEach((row) => queue.push({ type: 'task', id: row.id, row }));
                            if (section && (section.data.lifecycle || 'active') !== 'active') queue.push({ type: 'section', id: section.id, row: section });
                            if (graph.project && projectLifecycle !== 'active') queue.push({ type: 'project', id: normalizedProjectId, row: graph.project });
                        }
                        if (destinationSectionId) {
                            if (!graph.sections.has(destinationSectionId)) {
                                const destinationRef = projectCollection(db, normalizedProjectId, 'sections').doc(destinationSectionId);
                                const destinationSnapshot = await transaction.get(destinationRef);
                                if (destinationSnapshot?.exists) graph.sections.set(destinationSectionId, { id: destinationSectionId, data: destinationSnapshot.data() || {}, ref: destinationRef });
                            }
                            const destination = graph.sections.get(destinationSectionId);
                            if (!destination || (destination.data.lifecycle || 'active') !== 'active' || projectLifecycle !== 'active') throw new DomainError(409, 'RESTORE_DESTINATION_UNAVAILABLE', 'Restore destination must be an active section.');
                            if (target.id !== taskChain[0].id) throw new DomainError(409, 'INVALID_RESTORE_TARGET', 'Only the selected task may use an explicit destination.');
                            const siblingRows = snapshotRows(await transaction.get(projectCollection(db, normalizedProjectId, 'tasks').where('sectionId', '==', destinationSectionId).limit(MAX_RECOVERY_TASKS + 1)));
                            if (siblingRows.length > MAX_RECOVERY_TASKS) throw new DomainError(409, 'PROJECT_QUERY_LIMIT', 'Destination sibling set exceeds the recovery bound.');
                            const siblings = siblingRows.filter((row) => row.id !== target.id && !row.data.parentTaskId).map((row) => ({ id: row.id, rank: row.data.rank }));
                            destinationRank = computeInsertionRank(siblings, siblings.length).rank;
                        }
                    }
                }
                const seenKeys = new Set();
                for (const change of queue) {
                    const key = `${change.type}:${change.id}`;
                    if (seenKeys.has(key)) continue;
                    seenKeys.add(key);
                    const previous = { ...change.row.data };
                    const changePath = rowPath(normalizedProjectId, change.type, change.id);
                    const isAncestor = change.type !== target.type || change.id !== target.id;
                    if (isAncestor && restoreChain) {
                        if (!Object.prototype.hasOwnProperty.call(expectedAncestorRevisions, changePath)) throw new DomainError(400, 'EXPECTED_ANCESTOR_REVISIONS_REQUIRED', 'Restore-chain requests must fence every affected ancestor by canonical path.');
                        if (assertExpectedRevision(expectedAncestorRevisions[changePath]) !== revisionOf(previous)) throw new DomainError(409, 'STALE_ANCESTOR_REVISION', 'An ancestor changed; refresh and retry.');
                    } else if (Object.prototype.hasOwnProperty.call(expectedAncestorRevisions, changePath)
                        && assertExpectedRevision(expectedAncestorRevisions[changePath]) !== revisionOf(previous)) {
                        throw new DomainError(409, 'STALE_ANCESTOR_REVISION', 'An ancestor changed; refresh and retry.');
                    }
                    if (change.type === target.type && change.id === target.id && destinationSectionId) {
                        change.row.data.parentTaskId = null;
                        change.row.data.sectionId = destinationSectionId;
                        change.row.data.rank = destinationRank;
                    }
                    const next = {
                        ...change.row.data,
                        lifecycle: nextLifecycle,
                        lifecycleOrigin: normalizedAction === 'restore' ? (previous.lifecycleOrigin || null) : { operationId, action: normalizedAction, actorUid: identity.uid },
                        revision: revisionOf(change.row.data) + 1,
                        updatedAt: timestamp,
                        updatedBy: identity.uid
                    };
                    changes.push({ type: change.type, id: change.id, previous, next });
                }
                if (restoreChain && queue.some((entry) => entry.type === 'project' || entry.type === 'section') && contentAccess.role !== 'Owner') {
                    throw new DomainError(403, 'PROJECT_OWNER_REQUIRED', 'Restoring an unavailable project or section ancestor requires the project owner.');
                }
                let structureBefore = structureRevisionOf(graph.project?.data);
                let structureAfter = structureBefore;
                if (expectedStructureRevision !== null && structureBefore !== expectedStructureRevision) throw new DomainError(409, 'STALE_STRUCTURE_REVISION', 'Project structure changed; refresh and retry.');
                structureAfter += 1;
                for (const change of changes) {
                    if (change.type === 'project') transaction.set(projectRef(db, normalizedProjectId), change.next);
                    else transaction.set(refFor(db, normalizedProjectId, change.type, change.id), change.next);
                }
                transaction.set(projectRef(db, normalizedProjectId), { structureRevision: structureAfter, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
                const projectPath = rowPath(normalizedProjectId, 'project', normalizedProjectId);
                if (target.type === 'project') {
                    // The project write above already includes its lifecycle;
                    // the guarded merge preserves the monotonic structure
                    // fence without replacing the lifecycle/revision fields.
                    transaction.set(projectRef(db, normalizedProjectId), { contentRevision: Number(graph.project.data.contentRevision || 0) + 1 }, { merge: true });
                }
                const inverse = {
                    kind: 'lifecycle',
                    changes: changes.map((entry) => ({ type: entry.type, id: entry.id, previous: entry.previous, fields: changedFields(entry.previous, entry.next), expectedRevisionAfter: revisionOf(entry.next) })),
                    expectedStructureRevisionAfter: structureAfter,
                    expectedProjectRevisionAfter: target.type === 'project' ? revisionOf(currentTarget.data) + 1 : null
                };
                const beforeRevisions = {};
                const afterRevisions = {};
                for (const entry of changes) {
                    const path = rowPath(normalizedProjectId, entry.type, entry.id);
                    beforeRevisions[path] = revisionOf(entry.previous);
                    afterRevisions[path] = revisionOf(entry.next);
                }
                beforeRevisions[projectPath] = projectRevisions(graph.project.data);
                afterRevisions[projectPath] = projectRevisions(changes.find((entry) => entry.type === 'project')?.next || graph.project.data, { structureRevision: structureAfter });
                return {
                    result: { targetType: target.type, targetId: target.id, action: normalizedAction, lifecycle: nextLifecycle, structureRevision: structureAfter, affected: changes.map((entry) => ({ type: entry.type, id: entry.id, revision: revisionOf(entry.next) })) },
                    before: { targetType: target.type, targetId: target.id, lifecycle: currentLifecycle },
                    after: { targetType: target.type, targetId: target.id, lifecycle: nextLifecycle },
                    inverse,
                    affectedIds: [normalizedProjectId, ...changes.map((entry) => entry.id)],
                    affectedPaths: [...Object.keys(beforeRevisions), ...Object.keys(afterRevisions)],
                    beforeRevisions,
                    afterRevisions,
                    structureRevisionBefore: structureBefore,
                    structureRevisionAfter: structureAfter
                };
            }
        });
    }

    async function prepareMoveBatch({ transaction, actorUid, projectId, moves, destination, expectedStructureRevision }) {
        projectId = id(projectId, 'project ID');
        if (!Array.isArray(moves) || !moves.length || moves.length > 20) throw new DomainError(413, 'BULK_LIMIT_EXCEEDED', 'Move batches require 1 to 20 independent roots.');
        moves = moves.map(move => ({ taskId: id(move?.taskId, 'task ID'), expectedRevision: assertExpectedRevision(move?.expectedRevision) }));
        const roots = new Set(moves.map(move => move.taskId));
        if (roots.size !== moves.length) throw new DomainError(400, 'DUPLICATE_TASK_ID', 'Move roots must be unique.');
        const parentTaskId = id(destination?.parentTaskId, 'parent task ID');
        const expectedParentRevision = assertExpectedRevision(destination?.expectedParentRevision);
        expectedStructureRevision = assertExpectedRevision(expectedStructureRevision);
        const index = destination?.index;
        if (!Number.isSafeInteger(index) || index < 0) throw new DomainError(400, 'INVALID_INDEX', 'An exact destination index is required.');
        await accessService.assertTransactionContentAccess(transaction, actorUid, projectId, { write: true, roles: ['Owner', 'Editor'] });
        const graph = await readTaskGraph(transaction, projectId);
        if (!graph.project || graph.project.data.lifecycle !== 'active') throw new DomainError(409, 'PROJECT_LIFECYCLE_FORBIDDEN', 'An active project is required.');
        if (structureRevisionOf(graph.project.data) !== expectedStructureRevision) throw new DomainError(409, 'STALE_STRUCTURE_REVISION', 'Project structure changed.');
        const active = taskId => {
            const row = graph.tasks.get(taskId);
            if (!row || row.data.projectId !== projectId) throw new DomainError(404, 'TASK_NOT_FOUND', 'Task is unavailable in this project.');
            if (resolveTaskState({ tasks: graph.tasks, taskId, projectLifecycle: 'active', sections: graph.sections }).lifecycle !== 'active') throw new DomainError(409, 'TASK_LIFECYCLE_FORBIDDEN', 'Task ancestry is not active.');
            return row;
        };
        if (revisionOf(active(parentTaskId).data) !== expectedParentRevision) throw new DomainError(409, 'STALE_REVISION', 'Destination changed.');
        for (const move of moves) {
            const row = active(move.taskId);
            if (revisionOf(row.data) !== move.expectedRevision) throw new DomainError(409, 'STALE_REVISION', 'A move root changed.');
            assertNoCycle({ tasks: graph.tasks, targetId: move.taskId, parentTaskId });
            let ancestor = row.data.parentTaskId;
            const seen = new Set();
            while (ancestor) {
                if (seen.has(ancestor)) throw new DomainError(409, 'TASK_CYCLE', 'Task ancestry contains a cycle.');
                seen.add(ancestor);
                if (roots.has(ancestor)) throw new DomainError(409, 'OVERLAPPING_MOVE_ROOTS', 'Move roots cannot contain one another.');
                ancestor = graph.tasks.get(ancestor)?.data.parentTaskId;
            }
        }
        const siblings = [...graph.tasks.values()].filter(row => !roots.has(row.id) && row.data.parentTaskId === parentTaskId && resolveTaskState({ tasks: graph.tasks, taskId: row.id, projectLifecycle: 'active', sections: graph.sections }).lifecycle === 'active').map(row => ({ id: row.id, rank: row.data.rank })).sort(compareSiblings);
        if (index > siblings.length) throw new DomainError(400, 'INVALID_INDEX', 'Destination index exceeds current sibling count.');
        const finalRanks = new Map();
        for (let offset = 0; offset < moves.length; offset += 1) {
            const order = computeInsertionRank(siblings, index + offset);
            for (const item of order.rebalance) { finalRanks.set(item.id, item.rank); siblings.find(row => row.id === item.id).rank = item.rank; }
            const taskId = moves[offset].taskId;
            finalRanks.set(taskId, order.rank);
            siblings.splice(index + offset, 0, { id: taskId, rank: order.rank });
        }
        if (finalRanks.size > 148) throw new DomainError(413, 'BULK_LIMIT_EXCEEDED', 'Move rank rebalance exceeds the bounded write limit.');
        const timestamp = nowIso(now);
        const affected = [];
        for (const [taskId, rank] of finalRanks) {
            const previous = graph.tasks.get(taskId).data;
            const next = { ...previous, rank };
            if (roots.has(taskId)) { next.parentTaskId = parentTaskId; delete next.sectionId; }
            if (previous.parentTaskId === next.parentTaskId && previous.sectionId === next.sectionId && previous.rank === next.rank) continue;
            Object.assign(next, { revision: revisionOf(previous) + 1, updatedAt: timestamp, updatedBy: actorUid });
            affected.push({ id: taskId, previous, next });
        }
        if (!affected.length) throw new DomainError(409, 'EMPTY_BATCH', 'The move does not change task structure.');
        const inverse = { kind: 'bulkTaskMove', expectedStructureRevisionAfter: expectedStructureRevision + 1, changes: affected.map(row => ({ type: 'task', id: row.id, previous: row.previous, fields: ['parentTaskId', 'sectionId', 'rank'], expectedRevisionAfter: revisionOf(row.next) })) };
        if (Buffer.byteLength(JSON.stringify({ affected, inverse }), 'utf8') > MAX_BULK_OPERATION_BYTES) throw new DomainError(413, 'BULK_OPERATION_TOO_LARGE', 'Move history exceeds the bounded limit.');
        const fenceDigest = digestPayload({ project: graph.project.data, tasks: [...graph.tasks.values()].map(row => ({ id: row.id, data: row.data })), sections: [...graph.sections.values()].map(row => ({ id: row.id, data: row.data })) });
        const preview = { kind: 'moveBatch', moves, destination: { parentTaskId, expectedParentRevision, index }, expectedStructureRevision, orderedTaskIds: siblings.map(row => row.id), fenceDigest };
        let flushed = false;
        return { preview, fenceDigest, flush() {
            if (flushed) throw new DomainError(409, 'BATCH_ALREADY_FLUSHED', 'A prepared batch may only be flushed once.');
            flushed = true;
            for (const row of affected) transaction.set(projectCollection(db, projectId, 'tasks').doc(row.id), row.next);
            transaction.set(projectRef(db, projectId), { structureRevision: expectedStructureRevision + 1, updatedAt: timestamp, updatedBy: actorUid }, { merge: true });
            const beforeRevisions = Object.fromEntries(affected.map(row => [rowPath(projectId, 'task', row.id), revisionOf(row.previous)]));
            const afterRevisions = Object.fromEntries(affected.map(row => [rowPath(projectId, 'task', row.id), revisionOf(row.next)]));
            beforeRevisions[rowPath(projectId, 'project', projectId)] = projectRevisions(graph.project.data);
            afterRevisions[rowPath(projectId, 'project', projectId)] = projectRevisions(graph.project.data, { structureRevision: expectedStructureRevision + 1 });
            return { result: { moved: moves.map(move => move.taskId), structureRevision: expectedStructureRevision + 1 }, inverse, affectedIds: [projectId, ...affected.map(row => row.id)], affectedPaths: Object.keys(beforeRevisions), beforeRevisions, afterRevisions, structureRevisionBefore: expectedStructureRevision, structureRevisionAfter: expectedStructureRevision + 1 };
        } };
    }

    function normalizeFieldChanges(entries) {
        const rawChanges = Array.isArray(entries) ? entries : [];
        if (!rawChanges.length || rawChanges.length > MAX_BULK_TASKS) throw new DomainError(413, 'BULK_LIMIT_EXCEEDED', `Bulk updates are limited to ${MAX_BULK_TASKS} tasks.`);
        const changes = rawChanges.map((entry) => {
            const taskId = id(entry?.taskId, 'task ID');
            const expectedRevision = assertExpectedRevision(entry?.expectedRevision);
            const patch = validateTaskPatch(entry?.patch || {});
            if (patch.lifecycle !== undefined) throw new DomainError(400, 'LIFECYCLE_COMMAND_REQUIRED', 'Bulk lifecycle changes require lifecycle commands.');
            delete patch.lifecycle;
            return { taskId, expectedRevision, patch };
        });
        if (new Set(changes.map((entry) => entry.taskId)).size !== changes.length) throw new DomainError(400, 'DUPLICATE_TASK_ID', 'Bulk updates cannot contain duplicate task IDs.');
        const serializedSize = Buffer.byteLength(JSON.stringify(changes), 'utf8');
        if (serializedSize > MAX_BULK_OPERATION_BYTES) throw new DomainError(413, 'BULK_OPERATION_TOO_LARGE', 'Bulk operation inverse exceeds the bounded history limit.');
        return changes;
    }

    async function prepareFieldBatch({ transaction, actorUid, projectId, changes: entries }, internal = false) {
        const normalizedProjectId = id(projectId, 'project ID');
        const changes = normalizeFieldChanges(entries);
        const authorityReads = new Map();
        const originalTransaction = transaction;
        transaction = new Proxy(originalTransaction, { get(target, key) {
            if (key === 'get') return async (...args) => {
                const snapshot = await target.get(...args);
                const path = snapshot?.ref?.path || args[0]?.path;
                // Document identity, not asynchronous completion order, defines
                // the authority fence. Queries retain their graph/schema fence.
                if (path && typeof snapshot?.exists === 'boolean') authorityReads.set(path, { path, exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : null });
                return snapshot;
            };
            const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        } });
        let calendar = {};
        if (!internal) {
            await accessService.assertTransactionContentAccess(transaction, actorUid, normalizedProjectId, { write: true, roles: ['Owner', 'Editor'] });
            calendar = readData(await transaction.get(db.collection('crmProjectOrganizationConfig').doc('calendar'))) || {};
        }
                const graph = await readTaskGraph(transaction, normalizedProjectId);
                if (!graph.project) throw new DomainError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
                if ((graph.project.data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'PROJECT_LIFECYCLE_FORBIDDEN', 'Project is not active.');
                const columns = Object.fromEntries(Array.from(await readProjectRows(transaction, db, normalizedProjectId, 'columns')).map((row) => [row.id, row.data]));
                const memberCache = new Map();
                async function requireMember(memberUid) {
                    if (!memberUid) return;
                    if (memberCache.has(memberUid)) return;
                    const member = await transaction.get(db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(normalizedProjectId, memberUid)));
                    const memberData = readData(member);
                    if (!memberData || memberData.uid !== memberUid || memberData.projectId !== normalizedProjectId || memberData.active === false) throw new DomainError(403, 'ASSIGNMENT_INELIGIBLE', 'Bulk assignment target is not an active project member.');
                    await accessService.assertTransactionEligible(transaction, memberUid);
                    memberCache.set(memberUid, memberData);
                }
                const timestamp = nowIso(now);
                const affected = [];
                for (const change of changes) {
                    const currentRow = graph.tasks.get(change.taskId);
                    if (!currentRow) throw new DomainError(404, 'TASK_NOT_FOUND', `Task ${change.taskId} not found.`);
                    if (revisionOf(currentRow.data) !== change.expectedRevision) throw new DomainError(409, 'STALE_REVISION', `Task ${change.taskId} changed; refresh and retry.`);
                    const effective = resolveTaskState({ tasks: graph.tasks, taskId: change.taskId, projectLifecycle: graph.project.data.lifecycle || 'active', sections: graph.sections });
                    if (effective.lifecycle !== 'active') throw new DomainError(409, 'TASK_LIFECYCLE_FORBIDDEN', `Task ${change.taskId} is not active.`);
                    const validatedValues = change.patch.values === undefined ? undefined : validateTypedValues(change.patch.values, columns);
                    const next = { ...currentRow.data, ...change.patch, ...(validatedValues === undefined ? {} : { values: { ...(currentRow.data.values || {}), ...validatedValues } }), revision: change.expectedRevision + 1, updatedAt: timestamp, updatedBy: actorUid };
                    if (change.patch.ownerUid !== undefined) await requireMember(next.ownerUid);
                    if (change.patch.assigneeUids !== undefined) {
                        for (const assigneeUid of next.assigneeUids || []) await requireMember(assigneeUid);
                    }
                    if (change.patch.ownerUid !== undefined || change.patch.assigneeUids !== undefined) {
                        if (next.ownerUid && (next.assigneeUids || []).includes(next.ownerUid)) throw new DomainError(400, 'INVALID_ASSIGNEES', 'The accountable owner cannot also be an additional assignee.');
                    }
                    if (validatedValues) {
                        for (const [columnId, value] of Object.entries(validatedValues)) {
                            if (columns[columnId]?.type !== 'people' || value === null || value === undefined) continue;
                            for (const peopleUid of (Array.isArray(value) ? value : [value])) await requireMember(peopleUid);
                        }
                    }
                    if (!internal) for (const memberUid of [next.ownerUid, ...(next.assigneeUids || [])]) await requireMember(memberUid);
                    affected.push({ type: 'task', id: change.taskId, previous: { ...currentRow.data }, next });
                }
                const inverse = { kind: 'bulkTaskUpdate', changes: affected.map((entry) => ({ type: entry.type, id: entry.id, previous: entry.previous, fields: changedFields(entry.previous, entry.next), expectedRevisionAfter: revisionOf(entry.next) })) };
                const operationSize = Buffer.byteLength(JSON.stringify({ changes: affected, inverse }), 'utf8');
                if (operationSize > MAX_BULK_OPERATION_BYTES) throw new DomainError(413, 'BULK_OPERATION_TOO_LARGE', 'Bulk operation result and inverse exceed the bounded history limit.');
                const beforeRevisions = Object.fromEntries(affected.map((entry) => [rowPath(normalizedProjectId, 'task', entry.id), revisionOf(entry.previous)]));
                const afterRevisions = Object.fromEntries(affected.map((entry) => [rowPath(normalizedProjectId, 'task', entry.id), revisionOf(entry.next)]));
                const schedule = [];
                if (!internal) {
                    const projected = new Map(graph.tasks);
                    for (const entry of affected) projected.set(entry.id, { id: entry.id, data: entry.next });
                    for (const entry of affected) {
                        const task = entry.next;
                        const evaluation = task.startDate && task.dueDate ? evaluateSchedule(task, calendar, task.startDate, task.dueDate) : null;
                        const warnings = [...(evaluation?.warnings || [])];
                        for (const row of projected.values()) {
                            if (row.id !== entry.id && !(row.data.predecessorTaskIds || []).includes(entry.id)) continue;
                            for (const predecessorId of row.data.predecessorTaskIds || []) {
                                const predecessor = projected.get(predecessorId)?.data;
                                if (!predecessor || !predecessor.dueDate || !row.data.startDate || predecessor.dueDate >= row.data.startDate) warnings.push({ code: 'DEPENDENCY_DATE_CONFLICT', taskId: row.id, predecessorTaskId: predecessorId });
                            }
                        }
                        schedule.push({ taskId: entry.id, startDate: task.startDate || null, dueDate: task.dueDate || null, workingDayCount: evaluation?.workingDayCount ?? null, nonWorkingDays: evaluation?.nonWorkingDays || [], warnings });
                    }
                }
                const fenceDigest = digestPayload({ feedVersion: FEED_VERSION, calendar, project: graph.project.data, tasks: [...graph.tasks.values()].map(row => ({ id: row.id, data: row.data })), sections: [...graph.sections.values()].map(row => ({ id: row.id, data: row.data })), columns, members: [...memberCache], authorityReads: [...authorityReads.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
                const preview = { kind: 'fieldBatch', schedule, changes: changes.map(change => ({ taskId: change.taskId, expectedRevision: change.expectedRevision, patch: change.patch })), fenceDigest };
                let flushed = false;
                return { preview, fenceDigest, flush() {
                if (flushed) throw new DomainError(409, 'BATCH_ALREADY_FLUSHED', 'A prepared batch may only be flushed once.');
                flushed = true;
                for (const entry of affected) transaction.set(projectCollection(db, normalizedProjectId, 'tasks').doc(entry.id), entry.next);
                return {
                    result: { updated: affected.map((entry) => ({ taskId: entry.id, revision: revisionOf(entry.next) })), count: affected.length },
                    before: { tasks: affected.map((entry) => ({ taskId: entry.id, revision: revisionOf(entry.previous) })) },
                    after: { tasks: affected.map((entry) => ({ taskId: entry.id, revision: revisionOf(entry.next) })) },
                    inverse,
                    affectedIds: [normalizedProjectId, ...affected.map((entry) => entry.id)],
                    affectedPaths: Object.keys(beforeRevisions),
                    beforeRevisions,
                    afterRevisions
                };
                } };
    }

    async function bulkUpdateTasks(identity, projectId, rawPayload = {}) {
        const normalizedProjectId = id(projectId, 'project ID');
        const operationId = id(rawPayload.operationId, 'operation ID');
        const changes = normalizeFieldChanges(Array.isArray(rawPayload.changes) ? rawPayload.changes : Array.isArray(rawPayload.taskIds) ? rawPayload.taskIds.map(taskId => ({ taskId, patch: rawPayload.patch, expectedRevision: rawPayload.expectedRevisions?.[taskId] })) : []);
        return commandService.runCommand({
            actorUid: identity.uid,
            command: 'bulkUpdateTasks',
            projectId: normalizedProjectId,
            targetId: null,
            operationId,
            payload: { changes },
            access: { write: true, roles: ['Owner', 'Editor'] },
            execute: async ({ transaction }) => {
                return (await prepareFieldBatch({ transaction, actorUid: identity.uid, projectId: normalizedProjectId, changes }, true)).flush();
            }
        });
    }

    async function listHistory(identity, projectId, rawOptions = {}) {
        const normalizedProjectId = id(projectId, 'project ID');
        const rawLimit = rawOptions.limit === undefined ? 50 : Number(rawOptions.limit);
        if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_HISTORY_PAGE) throw new DomainError(400, 'INVALID_HISTORY_LIMIT', `History limit must be from 1 to ${MAX_HISTORY_PAGE}.`);
        const rawCursor = rawOptions.cursor ? String(rawOptions.cursor) : '';
        const cursor = rawCursor ? operationCursor(rawCursor) : null;
        if (rawCursor && !cursor) throw new DomainError(400, 'INVALID_HISTORY_CURSOR', 'History cursor is invalid.');
        let history;
        await db.runTransaction(async (transaction) => {
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, normalizedProjectId, { roles: ['Owner', 'Editor', 'Viewer'] });
            let historyQuery = db.collection('crmProjectOperations')
                .where('projectId', '==', normalizedProjectId)
                .orderBy('createdAt', 'desc')
                .orderBy('__name__', 'desc');
            if (cursor) historyQuery = historyQuery.startAfter(cursor.createdAt, cursor.id);
            // Reservation is an internal stage of the logical finalized upload.
            // Scan at most 500 raw operations, continuing even through a window
            // containing only reservations; never discard a continuation.
            const rows = snapshotRows(await transaction.get(historyQuery.limit(501))).map((row) => ({ ...row.data, operationId: row.id }));
            const page = [];
            let scanned = 0;
            while (scanned < Math.min(rows.length, 500) && page.length < rawLimit) {
                const operation = rows[scanned++];
                if (operation.command !== 'reserveDiscussionFile') page.push(operation);
            }
            const hasMore = rows.length > scanned;
            const safePage = page.map((operation) => ({ ...serializeOperation(operation, canUndoOperation(operation, access.role, identity.uid)), command: operation.command === 'finalizeDiscussionFile' ? 'uploadDiscussionFile' : operation.command }));
            history = { operations: safePage, count: safePage.length, hasMore, nextCursor: hasMore && scanned ? encodeOperationCursor(rows[scanned - 1]) : null };
        }, { readOnly: true });
        return history;
    }

    async function undoOperation(identity, projectId, operationId, rawPayload = {}) {
        const normalizedProjectId = id(projectId, 'project ID');
        const originalOperationId = id(operationId, 'operation ID');
        const newOperationId = id(rawPayload.operationId, 'operation ID');
        const originalOutsideTransaction = readData(await operationRef(db, originalOperationId).get());
        if (originalOutsideTransaction?.projectId === normalizedProjectId
            && ['moveTask', 'moveSection', 'moveColumn'].includes(originalOutsideTransaction.command)) {
            // Keep the Phase2 structural inverse on the same canonical API;
            // the command service performs its own fresh transactional fence.
            return commandService.undoOperation(identity, normalizedProjectId, originalOperationId, { ...rawPayload, operationId: newOperationId });
        }
        return commandService.runCommand({
            actorUid: identity.uid,
            command: 'undoOperation',
            projectId: normalizedProjectId,
            targetId: originalOperationId,
            operationId: newOperationId,
            payload: { originalOperationId },
            access: { write: true, roles: ['Owner', 'Editor'] },
            authorize: async ({ transaction, contentAccess }) => {
                // Authorization precedes receipt replay as well as execution.
                const original = readData(await transaction.get(operationRef(db, originalOperationId)));
                if (!original || original.projectId !== normalizedProjectId) throw new DomainError(404, 'OPERATION_NOT_FOUND', 'Operation not found.');
                if (!original.inverse || original.command === 'undoOperation') throw new DomainError(409, 'UNDO_UNSUPPORTED', 'This operation cannot be undone.');
                const ownerCommands = ['updateProject', 'updateSection', 'updateColumn', 'replaceColumn', 'archiveProject', 'trashProject', 'restoreProject', 'archiveSection', 'trashSection', 'restoreSection', 'moderateDiscussionMessage'];
                if ((ownerCommands.includes(original.command) || ['createProject', 'updateProject'].includes(original.inverse.kind) || (original.inverse.changes || []).some(change => ['project', 'section'].includes(change.type))) && contentAccess.role !== 'Owner') throw new DomainError(403, 'PROJECT_OWNER_REQUIRED', 'Undoing this operation requires project owner access.');
                if (String(original.command || '').toLowerCase().includes('discussion') && original.actorUid !== identity.uid && contentAccess.role !== 'Owner') throw new DomainError(403, 'MESSAGE_AUTHOR_REQUIRED', 'Only the message author or owner can undo this discussion operation.');
            },
            execute: async ({ transaction, contentAccess }) => {
                const original = readData(await transaction.get(operationRef(db, originalOperationId)));
                if (!original || original.projectId !== normalizedProjectId) throw new DomainError(404, 'OPERATION_NOT_FOUND', 'Operation not found.');
                if (!original.inverse || original.command === 'undoOperation') throw new DomainError(409, 'UNDO_UNSUPPORTED', 'This operation cannot be undone.');
                const ownerCommands = new Set(['updateProject', 'updateSection', 'updateColumn', 'replaceColumn', 'archiveProject', 'trashProject', 'restoreProject', 'archiveSection', 'trashSection', 'restoreSection', 'moderateDiscussionMessage']);
                const inverseChanges = original.inverse.changes || [];
                const touchesOwnerRecord = ownerCommands.has(original.command) || ['createProject', 'updateProject'].includes(original.inverse.kind) || inverseChanges.some((change) => change.type === 'project' || change.type === 'section');
                if (touchesOwnerRecord && contentAccess.role !== 'Owner') throw new DomainError(403, 'PROJECT_OWNER_REQUIRED', 'Undoing this operation requires project owner access.');
                if (String(original.command || '').toLowerCase().includes('discussion') && original.actorUid !== identity.uid && contentAccess.role !== 'Owner') throw new DomainError(403, 'MESSAGE_AUTHOR_REQUIRED', 'Only the message author or owner can undo this discussion operation.');
                const graph = await readTaskGraph(transaction, normalizedProjectId);
                if (!graph.project) throw new DomainError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
                if (!ownerCommands.has(original.command) && (graph.project.data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'UNDO_CONFLICT', 'Project or task ancestry is no longer active.');
                const timestamp = nowIso(now);
                const inverse = original.inverse;
                const columns = ['updateTask', 'bulkTaskUpdate'].includes(inverse.kind)
                    ? Object.fromEntries((await readProjectRows(transaction, db, normalizedProjectId, 'columns')).map((row) => [row.id, row.data])) : null;
                const touched = [];
                const planned = [];
                if (inverse.kind === 'updateTask' || inverse.kind === 'discussionMessage' || inverse.kind === 'bulkTaskUpdate' || inverse.kind === 'bulkTaskMove' || inverse.kind === 'lifecycle' || inverse.kind === 'taskDependencies') {
                    const changes = inverse.changes || [{ type: inverse.kind === 'updateTask' ? 'task' : (inverse.kind === 'discussionMessage' ? 'discussion' : null), id: inverse.targetId, previous: inverse.patch || inverse.previous, expectedRevisionAfter: inverse.expectedRevisionAfter }];
                    for (const change of changes) {
                        if (!change.type || !change.id || !change.previous) throw new DomainError(409, 'UNDO_UNSUPPORTED', 'Undo payload is incomplete.');
                        const collectionType = change.type === 'discussion' ? 'discussions' : `${change.type}s`;
                        const ref = change.type === 'project' ? projectRef(db, normalizedProjectId) : projectCollection(db, normalizedProjectId, collectionType).doc(change.id);
                        const current = readData(await transaction.get(ref));
                        if (!current || revisionOf(current) !== Number(change.expectedRevisionAfter)) throw new DomainError(409, 'UNDO_CONFLICT', 'Affected record changed after the original operation.');
                        if (change.type === 'task' && inverse.kind !== 'lifecycle') {
                            const currentState = resolveTaskState({ tasks: graph.tasks, taskId: change.id, projectLifecycle: graph.project.data.lifecycle || 'active', sections: graph.sections });
                            if (currentState.lifecycle !== 'active') throw new DomainError(409, 'UNDO_CONFLICT', 'Task or its ancestry is no longer active.');
                        }
                        if (change.type === 'discussion') {
                            const messageTask = current.taskId;
                            const taskState = resolveTaskState({ tasks: graph.tasks, taskId: messageTask, projectLifecycle: graph.project.data.lifecycle || 'active', sections: graph.sections });
                            if (taskState.lifecycle !== 'active') throw new DomainError(409, 'UNDO_CONFLICT', 'Discussion task or ancestry is no longer active.');
                        }
                        const fields = change.fields || (inverse.kind === 'lifecycle'
                            ? ['lifecycle', 'lifecycleOrigin', ...(change.type === 'task' ? ['parentTaskId', 'sectionId', 'rank'] : [])]
                            : changedFields(change.previous, inverse.kind === 'updateTask' ? original.result?.task || current : current));
                        if (change.type === 'project' && fields.some((field) => !['lifecycle', 'lifecycleOrigin'].includes(field))) throw new DomainError(409, 'UNDO_UNSUPPORTED', 'Project lifecycle inverse contains unrelated fields.');
                        const next = { ...compensateFields(current, change.previous, fields), revision: revisionOf(current) + 1, updatedAt: timestamp, updatedBy: identity.uid };
                        // Only values restored by this compensation need current
                        // schema validation; retained historical values remain intact.
                        if (change.type === 'task' && columns && fields.includes('values')) {
                            const restoredValues = {};
                            for (const [columnId, value] of Object.entries(next.values || {})) if (JSON.stringify(value) !== JSON.stringify(current.values?.[columnId])) restoredValues[columnId] = value;
                            try { validateTypedValues(restoredValues, columns); } catch (_) { throw new DomainError(409, 'UNDO_CONFLICT', 'A restored custom value no longer matches the current project schema.'); }
                        }
                        planned.push({ type: change.type, id: change.id, ref, before: current, after: next });
                    }
                    if (['lifecycle', 'taskDependencies', 'bulkTaskMove'].includes(inverse.kind) && Number.isSafeInteger(Number(inverse.expectedStructureRevisionAfter))) {
                        const currentStructure = structureRevisionOf(graph.project.data);
                        if (currentStructure !== Number(inverse.expectedStructureRevisionAfter)) throw new DomainError(409, 'UNDO_CONFLICT', 'Project structure changed after the lifecycle operation.');
                        planned.push({ type: 'projectStructure', id: normalizedProjectId, ref: projectRef(db, normalizedProjectId), before: graph.project.data, after: { structureRevision: currentStructure + 1, updatedAt: timestamp, updatedBy: identity.uid } });
                    }
                } else if (inverse.kind === 'createProject') {
                    const current = graph.project.data; const expected = { ...original.result?.project }; delete expected.id;
                    if (inverse.targetId !== normalizedProjectId || !expected.projectId || digestPayload(current) !== digestPayload(expected) || current.ownerUid !== inverse.ownerUid || graph.tasks.size || graph.sections.size) throw new DomainError(409, 'UNDO_CONFLICT', 'Created project changed or is no longer empty.');
                    for (const collection of ['columns', 'discussions', 'attachments', 'taskLinks', 'projectLinks']) {
                        const snapshot = await transaction.get(projectCollection(db, normalizedProjectId, collection).limit(1));
                        if (snapshot.docs?.length) throw new DomainError(409, 'UNDO_CONFLICT', 'Created project contains later records.');
                    }
                    const members = snapshotRows(await transaction.get(db.collection(PROJECT_COLLECTIONS.members).where('projectId', '==', normalizedProjectId).limit(2)));
                    if (members.length !== 1 || members[0].data.uid !== inverse.ownerUid || members[0].data.role !== 'Owner' || members[0].data.active === false || revisionOf(members[0].data) !== inverse.expectedMembershipRevisionAfter) throw new DomainError(409, 'UNDO_CONFLICT', 'Created project membership changed.');
                    const registry = readData(await transaction.get(db.collection('crmProjectAutomationRegistries').doc(normalizedProjectId)));
                    if (registry?.versions?.length) throw new DomainError(409, 'UNDO_CONFLICT', 'Created project has active automation.');
                    planned.push({ type: 'project', id: normalizedProjectId, ref: projectRef(db, normalizedProjectId), before: current, after: { ...current, lifecycle: 'archived', lifecycleOrigin: { operationId: newOperationId, action: 'archive', actorUid: identity.uid }, revision: revisionOf(current) + 1, structureRevision: structureRevisionOf(current) + 1, updatedAt: timestamp, updatedBy: identity.uid } });
                } else if (inverse.kind === 'createTask') {
                    const taskId = inverse.targetId, row = graph.tasks.get(taskId), current = row?.data;
                    const afterStructure = Number(original.structureRevisionAfter);
                    if (!current || revisionOf(current) !== Number(original.afterRevisions?.[rowPath(normalizedProjectId, 'task', taskId)]) || !Number.isSafeInteger(afterStructure) || structureRevisionOf(graph.project.data) !== afterStructure) throw new DomainError(409, 'UNDO_CONFLICT', 'Created task or project structure changed.');
                    if (resolveTaskState({ tasks: graph.tasks, taskId, sections: graph.sections, projectLifecycle: graph.project.data.lifecycle }).lifecycle !== 'active') throw new DomainError(409, 'UNDO_CONFLICT', 'Created task is no longer active.');
                    if ([...graph.tasks.values()].some(entry => entry.data.parentTaskId === taskId || (entry.data.predecessorTaskIds || []).includes(taskId))) throw new DomainError(409, 'UNDO_CONFLICT', 'Created task has later dependents.');
                    for (const collection of ['discussions', 'attachments']) {
                        const snapshot = await transaction.get(projectCollection(db, normalizedProjectId, collection).where('taskId', '==', taskId).limit(1));
                        if (snapshot.docs?.length) throw new DomainError(409, 'UNDO_CONFLICT', 'Created task has later discussion or files.');
                    }
                    const links = await transaction.get(projectCollection(db, normalizedProjectId, 'taskLinks').doc(taskId));
                    if (links.exists) throw new DomainError(409, 'UNDO_CONFLICT', 'Created task has later CRM links.');
                    for (const before of inverse.rebalanceBefore || []) {
                        const sibling = graph.tasks.get(before.id)?.data, after = (inverse.rebalanceAfter || []).find(entry => entry.id === before.id);
                        if (!sibling || !after || revisionOf(sibling) !== after.revision || sibling.rank !== after.rank && after.rank !== undefined) throw new DomainError(409, 'UNDO_CONFLICT', 'Sibling order changed after task creation.');
                        planned.push({ type: 'task', id: before.id, ref: projectCollection(db, normalizedProjectId, 'tasks').doc(before.id), before: sibling, after: { ...sibling, rank: before.rank, revision: revisionOf(sibling) + 1, updatedAt: timestamp, updatedBy: identity.uid } });
                    }
                    planned.push({ type: 'task', id: taskId, ref: projectCollection(db, normalizedProjectId, 'tasks').doc(taskId), before: current, after: { ...current, lifecycle: 'archived', lifecycleOrigin: { operationId: newOperationId, action: 'archive', actorUid: identity.uid }, revision: revisionOf(current) + 1, updatedAt: timestamp, updatedBy: identity.uid } });
                    planned.push({ type: 'projectStructure', id: normalizedProjectId, ref: projectRef(db, normalizedProjectId), before: graph.project.data, after: { structureRevision: afterStructure + 1, updatedAt: timestamp, updatedBy: identity.uid } });
                } else if (inverse.kind === 'updateProject') {
                    const current = graph.project?.data;
                    if (!current || revisionOf(current) !== Number(inverse.expectedRevisionAfter)) throw new DomainError(409, 'UNDO_CONFLICT', 'Project changed after the original operation.');
                    const originalAfter = original.result?.project || {};
                    const protectedProjectFields = new Set(['projectId', 'id', 'revision', 'ownerUid', 'membershipRevision', 'schemaRevision', 'structureRevision', 'contentRevision', 'updatedAt', 'updatedBy']);
                    const changedProjectFields = [];
                    const fieldNames = new Set([...Object.keys(inverse.patch || {}), ...Object.keys(originalAfter)]);
                    for (const fieldName of fieldNames) {
                        if (protectedProjectFields.has(fieldName)) continue;
                        const beforeValue = inverse.patch?.[fieldName];
                        const afterValue = originalAfter[fieldName];
                        if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) changedProjectFields.push(fieldName);
                    }
                    const next = { ...compensateFields(current, inverse.patch || {}, changedProjectFields), revision: revisionOf(current) + 1, updatedAt: timestamp, updatedBy: identity.uid };
                    if (changedProjectFields.includes('statusLabels')) next.schemaRevision = Number(current.schemaRevision || 0) + 1;
                    else next.schemaRevision = Number(current.schemaRevision || 0);
                    planned.push({ type: 'project', id: normalizedProjectId, ref: projectRef(db, normalizedProjectId), before: current, after: next });
                } else {
                    throw new DomainError(409, 'UNDO_UNSUPPORTED', 'This operation cannot be undone.');
                }
                if (planned.filter((entry) => entry.type === 'task').length) {
                    const projectedTasks = new Map(graph.tasks);
                    for (const entry of planned.filter((candidate) => candidate.type === 'task')) projectedTasks.set(entry.id, { id: entry.id, data: entry.after });
                    if (inverse.kind === 'taskDependencies') {
                        for (const entry of planned.filter((candidate) => candidate.type === 'task')) {
                            assertDependencyGraph([...projectedTasks.values()], entry.id, entry.after.predecessorTaskIds || []);
                            for (const predecessorId of entry.after.predecessorTaskIds || []) {
                                const state = resolveTaskState({ tasks: projectedTasks, taskId: predecessorId, sections: graph.sections, projectLifecycle: graph.project.data.lifecycle || 'active' });
                                if (state.lifecycle !== 'active') throw new DomainError(409, 'UNDO_CONFLICT', 'A predecessor is no longer active.');
                            }
                        }
                    }
                    for (const entry of planned.filter((candidate) => candidate.type === 'task')) {
                        if (entry.after.parentTaskId && !projectedTasks.has(entry.after.parentTaskId)) throw new DomainError(409, 'UNDO_CONFLICT', 'Undo would restore a missing task parent.');
                        if (!entry.after.parentTaskId && (!entry.after.sectionId || !graph.sections.has(entry.after.sectionId))) throw new DomainError(409, 'UNDO_CONFLICT', 'Undo would restore an invalid task section.');
                        assertNoCycle({ tasks: projectedTasks, targetId: entry.id, parentTaskId: entry.after.parentTaskId || null });
                        if (inverse.kind !== 'lifecycle' && !(inverse.kind === 'createTask' && entry.id === inverse.targetId)) {
                            const state = resolveTaskState({ tasks: projectedTasks, taskId: entry.id, sections: graph.sections, projectLifecycle: graph.project.data.lifecycle || 'active' });
                            if (state.lifecycle !== 'active') throw new DomainError(409, 'UNDO_CONFLICT', 'Undo would restore inactive task ancestry.');
                        }
                    }
                }
                const projectChange = planned.find((entry) => entry.type === 'project');
                const structureChange = planned.find((entry) => entry.type === 'projectStructure');
                if (projectChange && structureChange) {
                    Object.assign(projectChange.after, structureChange.after);
                    planned.splice(planned.indexOf(structureChange), 1);
                }
                for (const entry of planned) {
                    if (entry.type === 'projectStructure') transaction.set(entry.ref, entry.after, { merge: true });
                    else transaction.set(entry.ref, entry.after);
                    if (entry.type !== 'projectStructure') touched.push({ type: entry.type, id: entry.id, before: entry.before, after: entry.after });
                }
                const beforeRevisions = Object.fromEntries(touched.map((entry) => [rowPath(normalizedProjectId, entry.type, entry.id), revisionOf(entry.before)]));
                const afterRevisions = Object.fromEntries(touched.map((entry) => [rowPath(normalizedProjectId, entry.type, entry.id), revisionOf(entry.after)]));
                if (projectChange || structureChange) {
                    const projectPath = rowPath(normalizedProjectId, 'project', normalizedProjectId);
                    beforeRevisions[projectPath] = projectRevisions(graph.project.data);
                    afterRevisions[projectPath] = projectRevisions(projectChange?.after || { ...graph.project.data, ...structureChange.after });
                }
                return {
                    result: { originalOperationId, undone: touched.map((entry) => ({ type: entry.type, id: entry.id, revision: revisionOf(entry.after) })) },
                    before: { originalOperationId, records: touched.map((entry) => ({ type: entry.type, id: entry.id, revision: revisionOf(entry.before) })) },
                    after: { originalOperationId, records: touched.map((entry) => ({ type: entry.type, id: entry.id, revision: revisionOf(entry.after) })) },
                    inverse: { kind: 'bulkTaskUpdate', changes: touched.map((entry) => ({ type: entry.type, id: entry.id, previous: entry.before, expectedRevisionAfter: revisionOf(entry.after) })) },
                    affectedIds: [normalizedProjectId, ...touched.map((entry) => entry.id)],
                    affectedPaths: Object.keys(beforeRevisions),
                    beforeRevisions,
                    afterRevisions
                };
            }
        });
    }

    return {
        archiveProject: (identity, projectId, payload) => changeLifecycle(identity, projectId, 'project', projectId, 'archive', payload),
        trashProject: (identity, projectId, payload) => changeLifecycle(identity, projectId, 'project', projectId, 'trash', payload),
        restoreProject: (identity, projectId, payload) => changeLifecycle(identity, projectId, 'project', projectId, 'restore', payload),
        archiveSection: (identity, projectId, sectionId, payload) => changeLifecycle(identity, projectId, 'section', sectionId, 'archive', payload),
        trashSection: (identity, projectId, sectionId, payload) => changeLifecycle(identity, projectId, 'section', sectionId, 'trash', payload),
        restoreSection: (identity, projectId, sectionId, payload) => changeLifecycle(identity, projectId, 'section', sectionId, 'restore', payload),
        archiveTask: (identity, projectId, taskId, payload) => changeLifecycle(identity, projectId, 'task', taskId, 'archive', payload),
        trashTask: (identity, projectId, taskId, payload) => changeLifecycle(identity, projectId, 'task', taskId, 'trash', payload),
        restoreTask: (identity, projectId, taskId, payload) => changeLifecycle(identity, projectId, 'task', taskId, 'restore', payload),
        bulkUpdateTasks,
        prepareFieldBatch,
        prepareMoveBatch,
        listRecovery,
        previewRecovery,
        listHistory,
        undoOperation,
        constants: { MAX_HISTORY_PAGE, MAX_BULK_TASKS, MAX_BULK_OPERATION_BYTES }
    };
}

module.exports = { buildService, createProjectsRecoveryService: buildService, LIFECYCLE_TARGETS, MAX_BULK_TASKS, MAX_BULK_OPERATION_BYTES };
