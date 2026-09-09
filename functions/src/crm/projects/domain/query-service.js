'use strict';

const crypto = require('crypto');
const { PROJECT_COLLECTIONS, memberDocumentId } = require('../access-service');
const { DomainError, canonicalize, digestPayload, id, uid, normalizeDate } = require('./validation');
const { compareSiblings, parseRank, RankIntegrityError } = require('./ordering');
const { resolveTaskState } = require('./hierarchy');
const { projectCollection, projectRef, cursorRef, readData, serializeUpdateTime, snapshotRows, PROJECT_CURSOR_COLLECTION } = require('./storage');

const CURSOR_TTL_MS = 15 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_QUERY_TASKS = 20000;
const MAX_QUERY_SECTIONS = 1000;
const MAX_QUERY_COLUMNS = 200;
const { LIMITS } = require('../change-feed-service');

function iso(now) {
    const date = now instanceof Date ? now : new Date(now || Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function cursorId() { return crypto.randomBytes(24).toString('base64url'); }

function normalizeFilters(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DomainError(400, 'INVALID_FILTER', 'Task filters must be an object.');
    const result = {};
    for (const key of ['sectionId', 'status', 'ownerUid', 'assigneeUid', 'title', 'fromDate', 'toDate', 'lifecycle', 'parentTaskId', 'parentScope']) {
        if (raw[key] === undefined || raw[key] === null || raw[key] === '') continue;
        if (key === 'sectionId' || key === 'parentTaskId') result[key] = id(raw[key], key === 'sectionId' ? 'section ID' : 'parent task ID');
        else if (key === 'ownerUid' || key === 'assigneeUid') result[key] = uid(raw[key], key);
        else if (key === 'status' && !['not_started', 'in_progress', 'blocked', 'done'].includes(raw[key])) throw new DomainError(400, 'INVALID_FILTER', 'Task status filter is invalid.');
        else if (key === 'lifecycle' && !['active', 'archived', 'trashed'].includes(raw[key])) throw new DomainError(400, 'INVALID_FILTER', 'Task lifecycle filter is invalid.');
        else if (key === 'parentScope' && !['root', 'direct', 'descendants', 'all'].includes(raw[key])) throw new DomainError(400, 'INVALID_FILTER', 'Task parent scope is invalid.');
        else if (key === 'fromDate' || key === 'toDate') result[key] = normalizeDate(raw[key], key);
        else if (key === 'title') {
            if (typeof raw[key] !== 'string' || raw[key].trim().length > 200) throw new DomainError(400, 'INVALID_FILTER', 'Task title filter is invalid.');
            result[key] = raw[key].trim();
        } else if (typeof raw[key] === 'string' || typeof raw[key] === 'number') result[key] = String(raw[key]).trim();
        else throw new DomainError(400, 'INVALID_FILTER', 'Task filter value is invalid.');
    }
    if (result.fromDate && result.toDate && result.fromDate > result.toDate) throw new DomainError(400, 'INVALID_FILTER', 'Date filter bounds are invalid.');
    if (result.parentScope && !['root', 'all'].includes(result.parentScope) && !result.parentTaskId) throw new DomainError(400, 'INVALID_FILTER', 'parentTaskId is required for this parent scope.');
    if (result.parentTaskId && !result.parentScope) result.parentScope = 'descendants';
    return result;
}

function normalizeSort(raw) {
    const sort = raw && typeof raw === 'object' ? raw : {};
    const field = ['rank', 'title', 'status', 'dueDate', 'updatedAt'].includes(sort.field) ? sort.field : 'rank';
    const direction = String(sort.direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    return { field, direction };
}

function rowLifecycle(tasks, taskId) {
    return resolveTaskState({ tasks, taskId });
}

function sortRows(rows, sort) {
    const direction = sort.direction === 'desc' ? -1 : 1;
    return rows.slice().sort((left, right) => {
        let difference = 0;
        if (sort.field === 'rank') difference = compareSiblings({ ...left, rank: left.data.rank }, { ...right, rank: right.data.rank });
        else if (sort.field === 'title') difference = String(left.data.title || '').localeCompare(String(right.data.title || ''));
        else if (sort.field === 'status') difference = String(left.data.status || '').localeCompare(String(right.data.status || ''));
        else if (sort.field === 'dueDate') difference = String(left.data.dueDate || '').localeCompare(String(right.data.dueDate || ''));
        else if (sort.field === 'updatedAt') difference = String(left.data.updatedAt || '').localeCompare(String(right.data.updatedAt || ''));
        if (difference) return difference * direction;
        return String(left.id).localeCompare(String(right.id));
    });
}

function sortSiblingRecords(rows) {
    try {
        return rows.slice().sort((left, right) => compareSiblings({ ...left, rank: left.data.rank }, { ...right, rank: right.data.rank }));
    } catch (error) {
        if (error instanceof RankIntegrityError) throw new DomainError(409, 'INVALID_RANK', error.message);
        throw error;
    }
}

function matches(row, effective, filters) {
    if (filters.lifecycle ? effective.lifecycle !== filters.lifecycle : effective.lifecycle !== 'active') return false;
    if (filters.sectionId && effective.sectionId !== filters.sectionId) return false;
    if (filters.parentScope === 'root' && row.data.parentTaskId) return false;
    if (filters.parentTaskId) {
        const scope = filters.parentScope || 'descendants';
        if (scope === 'direct' && row.data.parentTaskId !== filters.parentTaskId) return false;
        if (scope === 'descendants' && !effective.ancestorIds.includes(filters.parentTaskId) && row.id !== filters.parentTaskId) return false;
    }
    if (filters.status && row.data.status !== filters.status) return false;
    if (filters.ownerUid && row.data.ownerUid !== filters.ownerUid) return false;
    if (filters.assigneeUid && !(row.data.assigneeUids || []).includes(filters.assigneeUid)) return false;
    if (filters.title && !String(row.data.title || '').toLocaleLowerCase().includes(filters.title.toLocaleLowerCase())) return false;
    // Inclusive interval overlap; undated tasks are excluded when a date bound is active.
    const start = row.data.startDate || row.data.dueDate;
    const end = row.data.dueDate || row.data.startDate;
    if ((filters.fromDate || filters.toDate) && !start) return false;
    if (filters.fromDate && end < filters.fromDate) return false;
    if (filters.toDate && start > filters.toDate) return false;
    return true;
}

function snapshotDigest(project, sections, columns, tasks, queryDigest) {
    const records = (rows) => rows.slice().sort((left, right) => left.id.localeCompare(right.id)).map((row) => ({
        id: row.id,
        revision: Number(row.data.revision || 0),
        updatedAt: row.data.updatedAt || null,
        lifecycle: row.data.lifecycle || 'active',
        parentTaskId: row.data.parentTaskId || null,
        sectionId: row.data.sectionId || null,
        rank: row.data.rank || null,
        type: row.data.type || null,
        options: row.data.options || null,
        updateTime: row.updateTime || null
    }));
    return digestPayload({
        queryDigest,
        project: {
            id: project.id,
            revision: Number(project.data.revision || 0),
            structureRevision: Number(project.data.structureRevision || 0),
            schemaRevision: Number(project.data.schemaRevision || 0),
            lifecycle: project.data.lifecycle || 'active',
            updatedAt: project.data.updatedAt || null,
            updateTime: project.updateTime || null,
        },
        sections: records(sections),
        columns: records(columns),
        tasks: records(tasks)
    });
}

function serializeRow(row, effective, activeChildCount = 0) {
    const data = { ...row.data };
    delete data.crmLinks; delete data.links; delete data.linkedRecords;
    return { ...data, id: row.id, effectiveSectionId: effective.sectionId, effectiveLifecycle: effective.lifecycle, ancestorIds: effective.ancestorIds, pathIds: effective.pathIds, activeChildCount };
}

function buildService({ db, accessService, now = () => new Date() } = {}) {
    if (!db || typeof db.runTransaction !== 'function') throw new Error('Projects query service requires Firestore db.');
    if (!accessService || typeof accessService.assertTransactionContentAccess !== 'function') throw new Error('Projects query service requires the canonical access service.');

    async function readSnapshot(identity, projectId) {
        let snapshot;
        await db.runTransaction(async (transaction) => {
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, projectId, { roles: ['Owner', 'Editor', 'Viewer'] });
            const projectSnapshot = await transaction.get(projectRef(db, projectId));
            if (!projectSnapshot?.exists) throw new DomainError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
            async function readBounded(collectionName, limit, label) {
                const rows = snapshotRows(await transaction.get(projectCollection(db, projectId, collectionName).limit(limit + 1)));
                if (rows.length > limit) throw new DomainError(409, 'PROJECT_QUERY_LIMIT', `Project query exceeds the Phase2 ${label} limit.`);
                return rows;
            }
            const sections = await readBounded('sections', MAX_QUERY_SECTIONS, 'section');
            const columns = await readBounded('columns', MAX_QUERY_COLUMNS, 'column');
            const tasks = await readBounded('tasks', MAX_QUERY_TASKS, 'task');
            const calendarDoc = await transaction.get(db.collection(PROJECT_COLLECTIONS.organizationConfig).doc('calendar'));
            const memberDocs = await transaction.get(db.collection(PROJECT_COLLECTIONS.members).where('projectId', '==', projectId).limit(1001));
            if (memberDocs.docs.length > 1000) throw new DomainError(409, 'PROJECT_QUERY_LIMIT', 'Project member limit exceeded.');
            const memberUids = memberDocs.docs.filter((doc) => {
                const data = doc.data();
                return data.projectId === projectId && doc.id === memberDocumentId(projectId, data.uid) && data.active !== false && ['Owner', 'Editor', 'Viewer'].includes(data.role);
            }).map((doc) => doc.data().uid);
            snapshot = {
                calendar: calendarDoc.exists ? calendarDoc.data() : {}, memberUids,
                access,
                project: { id: projectId, data: projectSnapshot.data() || {}, updateTime: serializeUpdateTime(projectSnapshot.updateTime) },
                sections,
                columns,
                tasks
            };
        }, { readOnly: true });
        return snapshot;
    }

    async function queryTasks(identity, projectId, rawOptions = {}, suppliedSnapshot = null) {
        const normalizedProjectId = id(projectId, 'project ID');
        const filters = normalizeFilters(rawOptions.filters || rawOptions);
        const sort = normalizeSort(rawOptions.sort);
        const rawPageSize = rawOptions.pageSize;
        const pageSize = rawPageSize === undefined || rawPageSize === null || rawPageSize === ''
            ? DEFAULT_PAGE_SIZE
            : (typeof rawPageSize === 'string' && /^\d+$/.test(rawPageSize) ? Number(rawPageSize) : rawPageSize);
        if (typeof pageSize !== 'number' || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
            throw new DomainError(400, 'INVALID_PAGE_SIZE', `pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
        }
        const includeAncestorContext = rawOptions.includeAncestorContext === true || rawOptions.includeAncestorContext === 'true';
        const queryIdentity = digestPayload({ projectId: normalizedProjectId, filters: canonicalize(filters), sort, pageSize, includeAncestorContext });
        const suppliedCursor = rawOptions.cursor ? String(rawOptions.cursor) : '';
        let cursorRecord = null;
        if (suppliedCursor) {
            if (!/^[A-Za-z0-9_-]{32}$/.test(suppliedCursor)) throw new DomainError(400, 'INVALID_CURSOR', 'Cursor is invalid.');
            const cursorSnapshot = await cursorRef(db, suppliedCursor).get();
            cursorRecord = readData(cursorSnapshot);
            if (!cursorRecord || cursorRecord.actorUid !== identity.uid || cursorRecord.projectId !== normalizedProjectId || cursorRecord.queryIdentity !== queryIdentity) {
                throw new DomainError(400, 'INVALID_CURSOR', 'Cursor is invalid for this query.');
            }
            if (Date.parse(cursorRecord.expiresAt || '') <= new Date(now()).getTime()) throw new DomainError(409, 'STALE_CURSOR', 'Cursor has expired; refresh the project.');
        }
        const snapshot = suppliedSnapshot || await readSnapshot(identity, normalizedProjectId);
        const digest = digestPayload({ records: snapshotDigest(snapshot.project, snapshot.sections, snapshot.columns, snapshot.tasks, queryIdentity), calendar: snapshot.calendar || {} });
        if (cursorRecord && cursorRecord.snapshotDigest !== digest) throw new DomainError(409, 'STALE_CURSOR', 'Project changed; refresh before continuing.');
        try {
            for (const row of [...snapshot.sections, ...snapshot.columns, ...snapshot.tasks]) parseRank(row.data.rank);
        } catch (error) {
            if (error instanceof RankIntegrityError) throw new DomainError(409, 'INVALID_RANK', error.message);
            throw error;
        }
        const taskMap = new Map(snapshot.tasks.map((row) => [row.id, row]));
        const sectionMap = new Map(snapshot.sections.map((row) => [row.id, row]));
        const effective = new Map();
        const children = new Map();
        for (const row of snapshot.tasks) {
            try {
                const state = resolveTaskState({
                    tasks: taskMap,
                    taskId: row.id,
                    projectLifecycle: snapshot.project.data.lifecycle || 'active',
                    sections: sectionMap
                });
                effective.set(row.id, state);
                if (state.lifecycle === 'active') {
                    const parentId = row.data.parentTaskId || null;
                    const list = children.get(parentId) || [];
                    list.push(row.id);
                    children.set(parentId, list);
                }
            } catch (error) {
                if (error instanceof RankIntegrityError) throw new DomainError(409, 'INVALID_RANK', error.message);
                throw error;
            }
        }
        const dataFilters = includeAncestorContext ? { ...filters, parentTaskId: undefined, parentScope: undefined } : filters;
        const matching = snapshot.tasks.filter((row) => matches(row, effective.get(row.id), dataFilters));
        const matchingIds = new Set(matching.map((row) => row.id));
        const contextIds = new Set(matchingIds);
        if (includeAncestorContext) for (const row of matching) for (const ancestorId of effective.get(row.id).ancestorIds) contextIds.add(ancestorId);
        const displayed = includeAncestorContext ? snapshot.tasks.filter((row) => contextIds.has(row.id) && matches(row, effective.get(row.id), { lifecycle: filters.lifecycle, parentTaskId: filters.parentTaskId, parentScope: filters.parentScope })) : matching;
        let ordered;
        try { ordered = sortRows(displayed, sort); } catch (error) {
            if (error instanceof RankIntegrityError) throw new DomainError(409, 'INVALID_RANK', error.message);
            throw error;
        }
        if (cursorRecord) {
            const position = ordered.findIndex((row) => row.id === cursorRecord.lastId && String(row.data.rank || '') === String(cursorRecord.lastRank || ''));
            if (position < 0) throw new DomainError(409, 'STALE_CURSOR', 'Cursor position is no longer present.');
            ordered = ordered.slice(position + 1);
        }
        const page = ordered.slice(0, pageSize);
        const hasMore = ordered.length > page.length;
        const matchingLeafRows = snapshot.tasks.filter((row) => {
            const state = effective.get(row.id);
            if (!state || state.lifecycle !== 'active') return false;
            const directChildren = children.get(row.id) || [];
            if (directChildren.length) return false;
            return matches(row, state, dataFilters);
        });
        const byStatus = Object.create(null);
        for (const row of matchingLeafRows) {
            const status = row.data.status || 'not_started';
            byStatus[status] = (byStatus[status] || 0) + 1;
        }
        const byOwnerUid = Object.create(null);
        byOwnerUid.unassigned = 0;
        for (const row of matchingLeafRows) { const owner = row.data.ownerUid || 'unassigned'; byOwnerUid[owner] = (byOwnerUid[owner] || 0) + 1; }
        const completedLeafTaskCount = byStatus.done || 0;
        const aggregates = { activeLeafTaskCount: matchingLeafRows.length, completedLeafTaskCount, completionPercent: matchingLeafRows.length ? Math.round(completedLeafTaskCount / matchingLeafRows.length * 100) : 0, byStatus, byOwnerUid };
        const numericColumnIds = (snapshot.columns || [])
            .filter((c) => (c.data?.lifecycle || 'active') === 'active' && c.data?.type === 'number')
            .map((c) => c.id);
        const derivedById = new Map();
        for (const row of snapshot.tasks) {
            const initialSums = Object.create(null);
            for (const colId of numericColumnIds) {
                initialSums[colId] = { sum: 0, count: 0, average: 0 };
            }
            derivedById.set(row.id, {
                activeLeafCount: 0,
                completedLeafCount: 0,
                completionPercent: 0,
                startDate: null,
                dueDate: null,
                statusBattery: { not_started: 0, in_progress: 0, blocked: 0, done: 0 },
                columnSums: initialSums
            });
        }
        for (const row of snapshot.tasks) {
            const state = effective.get(row.id);
            if (!state || state.lifecycle !== 'active' || (children.get(row.id) || []).length) continue;
            const leafStatus = row.data?.status || 'not_started';
            for (const ancestorId of [row.id, ...state.ancestorIds]) {
                const derived = derivedById.get(ancestorId);
                if (!derived) continue;
                derived.activeLeafCount++;
                if (row.data?.status === 'done') derived.completedLeafCount++;
                derived.statusBattery[leafStatus] = (derived.statusBattery[leafStatus] || 0) + 1;
                if (row.data?.startDate && (!derived.startDate || row.data.startDate < derived.startDate)) derived.startDate = row.data.startDate;
                if (row.data?.dueDate && (!derived.dueDate || row.data.dueDate > derived.dueDate)) derived.dueDate = row.data.dueDate;
                derived.completionPercent = Math.round(derived.completedLeafCount / derived.activeLeafCount * 100);
                if (row.data?.values) {
                    for (const colId of numericColumnIds) {
                        const val = row.data.values[colId];
                        if (typeof val === 'number' && Number.isFinite(val)) {
                            const entry = derived.columnSums[colId];
                            if (entry) {
                                entry.sum += val;
                                entry.count += 1;
                                entry.average = entry.count ? entry.sum / entry.count : 0;
                            }
                        }
                    }
                }
            }
        }
        let nextCursor = null;
        if (hasMore && page.length) {
            nextCursor = cursorId();
            const last = page[page.length - 1];
            const cursorCreatedAt = new Date(now()).getTime();
            const cursorNow = Number.isNaN(cursorCreatedAt) ? Date.now() : cursorCreatedAt;
            await cursorRef(db, nextCursor).set({ cursorId: nextCursor, actorUid: identity.uid, projectId: normalizedProjectId, queryIdentity, snapshotDigest: digest, lastId: last.id, lastRank: last.data.rank || null, createdAt: iso(now()), expiresAt: new Date(cursorNow + CURSOR_TTL_MS).toISOString() });
        }
        return {
            tasks: page.map((row) => ({ ...serializeRow(row, effective.get(row.id), (children.get(row.id) || []).length), contextOnly: !matchingIds.has(row.id), ancestorTitles: effective.get(row.id).ancestorIds.map((ancestorId) => taskMap.get(ancestorId)?.data.title || ''), derived: derivedById.get(row.id) })),
            hasMore,
            sections: sortSiblingRecords(snapshot.sections.filter((row) => (row.data.lifecycle || 'active') === 'active')).map((row) => ({ ...row.data, id: row.id })),
            columns: sortSiblingRecords(snapshot.columns.filter((row) => (row.data.lifecycle || 'active') === 'active')).map((row) => ({ ...row.data, id: row.id })),
            nextCursor,
            queryIdentity,
            snapshotDigest: digest,
            matchingTaskCount: matching.length,
            aggregates,
            aggregateBasis: 'active-leaf-tasks-after-effective-ancestry-and-filters',
            revision: { structureRevision: Number(snapshot.project.data.structureRevision || 0), schemaRevision: Number(snapshot.project.data.schemaRevision || 0) }
        };
    }

    // Explicit IDs only: no task/member/child collection scan. Shared cache and
    // read budget cover every requested task, message and effective ancestor.
    async function hydrateChanges(identity, rawProjectId, options = {}) {
        const projectId = id(rawProjectId, 'project ID');
        const normalize = value => {
            if (!Array.isArray(value) || value.length > LIMITS.ids) throw new DomainError(400, 'INVALID_HYDRATION_IDS', 'Hydration IDs exceed their bound.');
            return [...new Set(value.map(x => id(x, 'record ID')))];
        };
        const taskIds = normalize(options.taskIds || []); const messageIds = normalize(options.messageIds || []);
        if (taskIds.length + messageIds.length > LIMITS.ids) throw new DomainError(400, 'INVALID_HYDRATION_IDS', 'Hydration IDs exceed the combined bound.');
        return db.runTransaction(async transaction => {
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, projectId);
            const cache = new Map(); let reads = 0;
            async function read(collection, recordId) {
                const key = `${collection}/${recordId}`;
                if (!cache.has(key)) {
                    if (++reads > LIMITS.hydrationReads) throw new DomainError(413, 'HYDRATION_READ_LIMIT', 'Ancestry exceeds the hydration read budget.');
                    cache.set(key, readData(await transaction.get(projectCollection(db, projectId, collection).doc(id(recordId, 'record ID')))));
                }
                return cache.get(key);
            }
            async function task(taskId, allowInactive = false) {
                const chain = []; const seen = new Set(); let currentId = taskId;
                while (currentId) {
                    if (seen.has(currentId)) return null;
                    seen.add(currentId);
                    const data = await read('tasks', currentId);
                    if (!data || (!allowInactive && (data.lifecycle || 'active') !== 'active') || (data.projectId && data.projectId !== projectId)) return null;
                    chain.push({ id: currentId, data }); currentId = data.parentTaskId || null;
                }
                if (!allowInactive && (access.project.data.lifecycle || 'active') !== 'active') return null;
                const root = chain[chain.length - 1];
                if (!root?.data.sectionId) return null;
                const section = await read('sections', root.data.sectionId);
                if (!section || (!allowInactive && (section.lifecycle || 'active') !== 'active')) return null;
                const row = chain[0]; const safe = { ...row.data, id: taskId, effectiveLifecycle: 'active', effectiveSectionId: root.data.sectionId, pathIds: chain.map(x => x.id), ancestorIds: chain.slice(1).map(x => x.id), ancestorTitles: chain.slice(1).map(x => x.data.title || '') };
                delete safe.crmLinks; delete safe.links; delete safe.linkedRecords;
                return safe;
            }
            const tasks = []; const messages = []; const unavailableTaskIds = []; const unavailableMessageIds = [];
            for (const taskId of taskIds) { const value = await task(taskId); if (value) tasks.push(value); else unavailableTaskIds.push(taskId); }
            for (const messageId of messageIds) {
                const value = await read('discussions', messageId);
                if (!value || value.projectId !== projectId || !value.taskId || !await task(value.taskId, true)) { unavailableMessageIds.push(messageId); continue; }
                const message = { ...value, id: messageId };
                if (message.moderationState !== 'visible' && access.role !== 'Owner' && message.authorUid !== identity.uid) { message.body = null; message.mentions = []; message.attachmentIds = []; message.redacted = true; }
                messages.push(message);
            }
            const result = { tasks, messages, unavailableTaskIds, unavailableMessageIds, costs: { recordReads: reads, taskEnumeration: 0 } };
            if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.hydrationBytes) throw new DomainError(413, 'HYDRATION_BYTE_LIMIT', 'Hydration exceeds its serialized byte budget.');
            return result;
        }, { readOnly: true });
    }
    async function listTasks(identity, projectId, options) { return queryTasks(identity, projectId, options); }
    return { queryTasks, listTasks, readSnapshot, hydrateChanges, constants: { CURSOR_TTL_MS, MAX_QUERY_TASKS, MAX_QUERY_SECTIONS, MAX_QUERY_COLUMNS, PROJECT_CURSOR_COLLECTION } };
}

module.exports = { buildService, createProjectsQueryService: buildService, normalizeFilters, normalizeSort, matches, rowLifecycle, snapshotDigest, MAX_QUERY_TASKS, MAX_QUERY_SECTIONS, MAX_QUERY_COLUMNS };
