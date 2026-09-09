'use strict';

const crypto = require('crypto');
const { prepareFeedCommit } = require('../change-feed-service');
const {
    ProjectsAccessError,
    PROJECT_COLLECTIONS,
    memberDocumentId
} = require('../access-service');
const {
    DomainError,
    canonicalize,
    digestPayload,
    operationId: normalizeOperationId,
    id,
    uid,
    validateProjectInput,
    validateSectionInput,
    validateColumnInput,
    validateTaskInput,
    validateTaskPatch,
    validateStatusLabels,
    validateTypedValues,
    safeColumnId
} = require('./validation');
const { compareSiblings, computeInsertionRank, RankIntegrityError } = require('./ordering');
const { resolveTaskState, assertNoCycle: assertHierarchyNoCycle } = require('./hierarchy');
const { runTransactionWithClosedRetry } = require('./transaction-retry');
const { prepareEventCapture } = require('../automation/event-capture');
const { getContext, assertExecutionContext } = require('../automation/execution-context');
const { prepareCommand } = require('./prepared-command');
const PREPARATION_TRANSACTION = Symbol('preparationTransaction');
function requirePreparationTransaction(transaction) { if (!transaction || typeof transaction.get !== 'function' || typeof transaction.set !== 'function') throw new DomainError(400, 'PREPARATION_TRANSACTION_REQUIRED', 'Preparation requires a supplied transaction.'); return transaction; }
const {
    PROJECT_OPERATION_COLLECTION,
    PROJECT_EVENT_COLLECTION,
    projectRef,
    projectCollection,
    operationRef,
    eventRef,
    readData,
    snapshotRows
} = require('./storage');

const DEFAULT_STATUS = 'not_started';
const MAX_OPERATION_ID = 128;

function iso(now) {
    const date = now instanceof Date ? now : new Date(now || Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function randomId(prefix, operation, suffix = '') {
    const digest = crypto.createHash('sha256').update(`${operation}:${suffix}`).digest('hex').slice(0, 24);
    return `${prefix}-${digest}`;
}

function ensureOperation(raw) {
    const value = String(raw ?? '').trim();
    if (!value || value.length > MAX_OPERATION_ID) throw new DomainError(400, 'INVALID_OPERATION_ID', 'operationId is required and bounded.');
    return normalizeOperationId(value);
}

function expectedRevision(value, code = 'INVALID_REVISION') {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new DomainError(400, code, 'Revision must be a non-negative integer.');
    return value;
}

function expectedIndex(value, fallback = null) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new DomainError(400, 'INVALID_INDEX', 'Sibling index must be a non-negative integer.');
    return value;
}

function requiredRevision(value, code, message) {
    const revision = expectedRevision(value, code);
    if (revision === null) throw new DomainError(400, code, message);
    return revision;
}

function optionalReference(value, label) {
    if (value === undefined || value === null || value === '') return null;
    return id(value, label);
}

function assertExpected(actual, expected, code, message) {
    if (expected !== null && Number(actual || 0) !== expected) throw new DomainError(409, code, message);
}

function readRevision(data, key = 'revision') {
    return Number.isSafeInteger(Number(data?.[key])) && Number(data[key]) >= 0 ? Number(data[key]) : 0;
}

function copyRecord(idValue, data, ref) { return { id: idValue, data: { ...(data || {}) }, ref }; }

function operationEnvelope({ operationId: opId, actorUid, command, projectId, targetId, payload }) {
    return {
        operationId: opId,
        actorUid,
        command,
        projectId: projectId || null,
        targetId: targetId || null,
        payloadDigest: digestPayload({ operationId: opId, actorUid, command, projectId: projectId || null, targetId: targetId || null, payload: canonicalize(payload) })
    };
}

function assertExistingOperation(existing, envelope) {
    if (!existing) return null;
    if (existing.actorUid !== envelope.actorUid || existing.payloadDigest !== envelope.payloadDigest
        || existing.command !== envelope.command || (existing.projectId || null) !== (envelope.projectId || null)
        || (existing.targetId || null) !== (envelope.targetId || null)) {
        throw new DomainError(409, 'OPERATION_CONFLICT', 'operationId is already bound to a different actor or payload.');
    }
    return existing.result || null;
}

function taskRef(db, projectId, taskId) { return projectCollection(db, projectId, 'tasks').doc(taskId); }
function sectionRef(db, projectId, sectionId) { return projectCollection(db, projectId, 'sections').doc(sectionId); }
function columnRef(db, projectId, columnId) { return projectCollection(db, projectId, 'columns').doc(columnId); }
function projectPath(projectId) { return `crmProjects/${projectId}`; }
function memberPath(projectId, uidValue) { return `crmProjectMembers/${memberDocumentId(projectId, uidValue)}`; }
function recordPath(projectId, collection, recordId) { return `crmProjects/${projectId}/${collection}/${recordId}`; }
function revisionMap(entries) { return Object.fromEntries(entries); }
function projectRevision(data, overrides = {}) {
    return { revision: readRevision(data), structureRevision: readRevision(data, 'structureRevision'), schemaRevision: readRevision(data, 'schemaRevision'), ...overrides };
}

async function readCollection(transaction, collection) { return snapshotRows(await transaction.get(collection)); }

function mapById(rows) { return new Map(rows.map((row) => [row.id, row])); }

function ancestry(tasks, taskId) {
    const byId = tasks instanceof Map ? tasks : mapById(tasks);
    const chain = [];
    const seen = new Set();
    let current = byId.get(taskId);
    while (current) {
        if (seen.has(current.id)) throw new DomainError(409, 'ANCESTRY_CYCLE', 'Task ancestry contains a cycle.');
        seen.add(current.id);
        chain.push(current);
        const parentId = current.data.parentTaskId;
        if (parentId === null || parentId === undefined || parentId === '') break;
        current = byId.get(parentId);
        if (!current) throw new DomainError(409, 'INVALID_PARENT_REFERENCE', 'Task parent must belong to the same project.');
    }
    return chain;
}

function effectiveSection(tasks, taskId) {
    return resolveTaskState({ tasks, taskId }).sectionId;
}

function effectiveLifecycle(tasks, taskId) {
    return resolveTaskState({ tasks, taskId }).lifecycle;
}

function assertNoCycle(tasks, targetId, parentTaskId) {
    return assertHierarchyNoCycle({ tasks, targetId, parentTaskId });
}

function validateRankWriteCount(rebalance) {
    if ((rebalance || []).length > 128) throw new DomainError(409, 'ORDER_REBALANCE_EXHAUSTED', 'Sibling ordering requires a smaller local move.');
}

function sortSiblingRows(rows) {
    try {
        return rows.sort(compareSiblings);
    } catch (error) {
        if (error instanceof RankIntegrityError) throw new DomainError(409, 'INVALID_RANK', error.message);
        throw error;
    }
}

function computeOrder(rows, index) {
    try {
        return computeInsertionRank(rows, index);
    } catch (error) {
        if (error instanceof RankIntegrityError) throw new DomainError(409, 'ORDER_REBALANCE_EXHAUSTED', error.message);
        throw error;
    }
}

function assertProjectActive(project) {
    if ((project?.data?.lifecycle || 'active') !== 'active') throw new DomainError(409, 'PROJECT_LIFECYCLE_FORBIDDEN', 'Project is not active.');
}

async function assertAssignmentTargets({ transaction, accessService, db, projectId, ownerUid, assigneeUids }) {
    const targets = [...new Set([ownerUid, ...(assigneeUids || [])].filter(Boolean))];
    for (const targetUid of targets) {
        const targetIdentity = await accessService.assertTransactionEligible(transaction, targetUid);
        const targetMemberRef = db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(projectId, targetUid));
        if (typeof targetIdentity !== 'object' || !targetIdentity.uid) throw new DomainError(403, 'ASSIGNMENT_INELIGIBLE', 'Assignee is not eligible.');
        const targetMember = await transaction.get(targetMemberRef);
        const targetData = targetMember?.exists ? (targetMember.data() || {}) : null;
        if (!targetData || targetData.projectId !== projectId || targetData.uid !== targetUid
            || !['Owner', 'Editor', 'Viewer'].includes(targetData.role) || targetData.active === false) {
            throw new DomainError(403, 'ASSIGNMENT_INELIGIBLE', 'Assignee is not an active project member.');
        }
    }
}

async function assertPeopleValueTargets({ transaction, accessService, db, projectId, columns, values }) {
    for (const [columnId, rawValue] of Object.entries(values || {})) {
        if (columns[columnId]?.type !== 'people' || rawValue === null || rawValue === undefined) continue;
        const people = Array.isArray(rawValue) ? rawValue : [rawValue];
        await assertAssignmentTargets({ transaction, accessService, db, projectId, ownerUid: null, assigneeUids: people });
    }
}

function buildService({ db, accessService, now = () => new Date() } = {}) {
    if (!db || typeof db.runTransaction !== 'function') throw new Error('Projects command service requires Firestore db.');
    if (!accessService || typeof accessService.assertTransactionContentAccess !== 'function') throw new Error('Projects command service requires the canonical access service.');

    async function runCommand({ actorUid, command, projectId = null, targetId = null, payload = {}, operationId, access = {}, creation = false, authorize = null, prepareAuthorization = null, executionContext = null, execute, [PREPARATION_TRANSACTION]: preparationTransaction = null }) {
        const opId = ensureOperation(operationId);
        const normalizedProjectId = projectId ? id(projectId, 'project ID') : null;
        const envelope = operationEnvelope({ operationId: opId, actorUid: uid(actorUid), command, projectId: normalizedProjectId, targetId, payload });
        async function resolveAccess(transaction) {
            const contentAccess = normalizedProjectId && !creation
                ? await accessService.assertTransactionContentAccess(transaction, envelope.actorUid, normalizedProjectId, access)
                : await accessService.assertTransactionEligible(transaction, envelope.actorUid);
            if (executionContext) {
                await accessService.assertTransactionContentAccess(transaction, envelope.actorUid, normalizedProjectId, { owner: true });
                await assertExecutionContext(transaction, db, executionContext, envelope.actorUid, now, accessService);
            }
            if (authorize) await authorize({ transaction, contentAccess, envelope });
            return contentAccess;
        }
        if (preparationTransaction) return prepareCommand({ transaction: preparationTransaction, envelope, authorize: resolveAccess, execute: async context => {
            const capture = await prepareEventCapture(context.transaction, db, normalizedProjectId, context.contentAccess);
            const executed = await execute({ ...context, transaction: capture.transaction }); capture.finish(); return executed;
        } });
        const result = await runTransactionWithClosedRetry(db, async (transaction) => {
            const contentAccess = await resolveAccess(transaction);
            const authorization = prepareAuthorization ? await prepareAuthorization({ transaction, contentAccess, envelope }) : null;
            if (prepareAuthorization && (!authorization || typeof authorization.replayed !== 'boolean' || typeof authorization.consume !== 'function')) throw new DomainError(409, 'AUTHORIZATION_INTEGRITY', 'Prepared authorization is incomplete.');
            const operationSnapshot = await transaction.get(operationRef(db, opId));
            const existing = readData(operationSnapshot);
            const replayResult = assertExistingOperation(existing, envelope);
            if (existing && authorization && (!authorization.replayed || !replayResult)) throw new DomainError(409, 'AUTHORIZATION_INTEGRITY', 'Operation exists without its consumed authorization.');
            if (!existing && authorization?.replayed) throw new DomainError(409, 'AUTHORIZATION_INTEGRITY', 'Consumed authorization has no operation receipt.');
            if (replayResult) {
                if (creation) await accessService.assertTransactionContentAccess(transaction, envelope.actorUid, normalizedProjectId, { owner: true, roles: ['Owner'] });
                return replayResult;
            }
            const feed = await prepareFeedCommit(transaction, db, normalizedProjectId, opId);
            const capture = await prepareEventCapture(transaction, db, normalizedProjectId, contentAccess);
            const executed = await execute({ transaction: capture.transaction, contentAccess, envelope });
            const semantic = capture.finish();
            const timestamp = iso(now());
            const storedResult = executed.result;
            if (authorization) {
                if (authorization.consume.constructor?.name === 'AsyncFunction') throw new DomainError(409, 'AUTHORIZATION_INTEGRITY', 'Authorization consumption must be synchronous.');
                const consumed = authorization.consume({ result: storedResult });
                if (consumed && typeof consumed.then === 'function') throw new DomainError(409, 'AUTHORIZATION_INTEGRITY', 'Authorization consumption must be synchronous.');
            }
            const operationRecord = {
                ...envelope,
                createdAt: timestamp,
                updatedAt: timestamp,
                before: executed.before || null,
                after: executed.after || null,
                inverse: executed.inverse || null,
                affectedIds: Array.from(new Set(executed.affectedIds || [])),
                affectedPaths: Array.from(new Set(executed.affectedPaths || [...Object.keys(executed.beforeRevisions || {}), ...Object.keys(executed.afterRevisions || {})])),
                beforeRevisions: executed.beforeRevisions || {},
                afterRevisions: executed.afterRevisions || {},
                structureRevisionBefore: executed.structureRevisionBefore ?? null,
                structureRevisionAfter: executed.structureRevisionAfter ?? null,
                origin: executionContext ? 'automation' : (executed.origin || 'manual'),
                result: storedResult
            };
            transaction.set(operationRef(db, opId), operationRecord);
            feed?.commit();
            transaction.set(eventRef(db, opId), {
                ...(feed?.stamp || {}),
                eventId: opId,
                semantic,
                ancestry: executionContext?.ancestry || [],
                automationStatus: 'pending',
                notificationStatus: 'pending',
                operationId: opId,
                projectId: normalizedProjectId,
                actorUid: envelope.actorUid,
                command,
                targetId,
                affectedIds: operationRecord.affectedIds,
                affectedPaths: operationRecord.affectedPaths,
                beforeRevisions: operationRecord.beforeRevisions,
                afterRevisions: operationRecord.afterRevisions,
                origin: operationRecord.origin,
                createdAt: timestamp
            });
            return storedResult;
        });
        // Legacy operations may contain raw CRM references. Generic command and
        // replay responses must never act as a CRM authorization bypass.
        const safe = { ...result };
        for (const key of ['project', 'task']) if (safe[key]) {
            safe[key] = { ...safe[key] };
            delete safe[key].crmLinks; delete safe[key].links; delete safe[key].linkedRecords;
        }
        return safe;
    }

    async function createProjectCommand(identity, rawPayload = {}, preparationTransaction = null) {
        const input = { ...rawPayload };
        delete input.operationId;
        delete input.projectId;
        const payload = validateProjectInput(input);
        if (payload.crmLinks) throw new DomainError(400, 'PROJECT_LINK_ENDPOINT_REQUIRED', 'Create the project first, then use its authorized links endpoint.');
        const opId = ensureOperation(rawPayload.operationId);
        const projectId = rawPayload.projectId ? id(rawPayload.projectId, 'project ID') : randomId('project', opId);
        return runCommand({ [PREPARATION_TRANSACTION]: preparationTransaction, actorUid: identity.uid, command: 'createProject', projectId, targetId: projectId, operationId: opId, creation: true, payload: { ...payload, projectId }, execute: async ({ transaction, envelope }) => {
            const projectDocument = projectRef(db, projectId);
            const existing = await transaction.get(projectDocument);
            if (existing?.exists) throw new DomainError(409, 'PROJECT_EXISTS', 'Project already exists.');
            const timestamp = iso(now());
            const data = {
                projectId,
                name: payload.name,
                ...(payload.description !== undefined ? { description: payload.description } : {}),
                ...(payload.crmLinks ? { crmLinks: payload.crmLinks } : {}),
                lifecycle: 'active',
                ownerUid: envelope.actorUid,
                membershipRevision: 1,
                structureRevision: 0,
                contentRevision: 0,
                schemaRevision: 0,
                revision: 1,
                createdAt: timestamp,
                updatedAt: timestamp,
                updatedBy: envelope.actorUid
            };
            transaction.set(projectDocument, data);
            transaction.set(db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(projectId, envelope.actorUid)), {
                projectId,
                uid: envelope.actorUid,
                role: 'Owner',
                active: true,
                revision: 1,
                createdAt: timestamp,
                updatedAt: timestamp,
                updatedBy: envelope.actorUid
            });
            return { result: { project: { ...data, id: projectId }, membership: { projectId, uid: envelope.actorUid, role: 'Owner' } }, after: { projectId, revision: 1 }, inverse: { kind: 'createProject', targetId: projectId, ownerUid: envelope.actorUid, expectedRevisionAfter: 1, expectedMembershipRevisionAfter: 1 }, affectedIds: [projectId, envelope.actorUid], affectedPaths: [projectPath(projectId), memberPath(projectId, envelope.actorUid)], beforeRevisions: revisionMap([[projectPath(projectId), null], [memberPath(projectId, envelope.actorUid), null]]), afterRevisions: revisionMap([[projectPath(projectId), projectRevision(data)], [memberPath(projectId, envelope.actorUid), 1]]) };
        }});
    }

    async function createSection(identity, projectId, rawPayload = {}) {
        const input = { ...rawPayload };
        delete input.operationId;
        delete input.sectionId;
        delete input.index;
        delete input.expectedStructureRevision;
        const payload = validateSectionInput(input);
        const opId = ensureOperation(rawPayload.operationId);
        const expectedStructure = requiredRevision(rawPayload.expectedStructureRevision, 'EXPECTED_STRUCTURE_REVISION_REQUIRED', 'expectedStructureRevision is required for section creation.');
        const sectionId = rawPayload.sectionId ? id(rawPayload.sectionId, 'section ID') : randomId('section', opId, projectId);
        return runCommand({ actorUid: identity.uid, command: 'createSection', projectId, targetId: sectionId, operationId: opId, payload: { ...payload, sectionId, index: expectedIndex(rawPayload.index, null), expectedStructureRevision: expectedStructure }, access: { owner: true, roles: ['Owner'] }, execute: async ({ transaction, contentAccess }) => {
            const project = contentAccess.project;
            assertProjectActive(project);
            const sections = await readCollection(transaction, projectCollection(db, project.id, 'sections'));
            if (sections.some((row) => row.id === sectionId)) throw new DomainError(409, 'SECTION_EXISTS', 'Section already exists.');
            const active = sortSiblingRows(sections.filter((row) => (row.data.lifecycle || 'active') === 'active').map((row) => ({ ...row, rank: row.data.rank })));
            const index = expectedIndex(rawPayload.index, active.length);
            const order = computeOrder(active, index);
            validateRankWriteCount(order.rebalance);
            const timestamp = iso(now());
            const sectionMap = mapById(sections);
            const rebalanceBefore = order.rebalance.map((change) => ({ id: change.id, rank: sectionMap.get(change.id)?.data?.rank || null, revision: readRevision(sectionMap.get(change.id)?.data) }));
            const rebalanceAfter = [];
            for (const change of order.rebalance) {
                const revision = readRevision(sectionMap.get(change.id)?.data) + 1;
                rebalanceAfter.push({ id: change.id, rank: change.rank, revision });
                transaction.set(sectionRef(db, project.id, change.id), { rank: change.rank, revision, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            }
            transaction.set(sectionRef(db, project.id, sectionId), { projectId: project.id, title: payload.title, lifecycle: 'active', rank: order.rank, revision: 1, createdAt: timestamp, updatedAt: timestamp, updatedBy: identity.uid });
            const structureBefore = readRevision(project.data, 'structureRevision');
            assertExpected(structureBefore, expectedStructure, 'STALE_STRUCTURE_REVISION', 'Project structure changed; refresh and retry.');
            transaction.set(project.ref, { structureRevision: structureBefore + 1, schemaRevision: readRevision(project.data, 'schemaRevision'), updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            return { result: { section: { id: sectionId, projectId: project.id, ...payload, rank: order.rank, revision: 1 }, structureRevision: structureBefore + 1 }, before: { sectionId, revision: 0, rebalance: rebalanceBefore }, after: { sectionId, revision: 1, rebalance: rebalanceAfter }, inverse: { kind: 'createSection', targetId: sectionId, rebalanceBefore, rebalanceAfter }, affectedIds: [project.id, sectionId, ...rebalanceAfter.map((entry) => entry.id)], affectedPaths: [projectPath(project.id), recordPath(project.id, 'sections', sectionId), ...rebalanceAfter.map((entry) => recordPath(project.id, 'sections', entry.id))], structureRevisionBefore: structureBefore, structureRevisionAfter: structureBefore + 1, beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'sections', sectionId), null], ...rebalanceBefore.map((entry) => [recordPath(project.id, 'sections', entry.id), entry.revision])]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data, { structureRevision: structureBefore + 1 })], [recordPath(project.id, 'sections', sectionId), 1], ...rebalanceAfter.map((entry) => [recordPath(project.id, 'sections', entry.id), entry.revision])]) };
        }});
    }

    async function createColumn(identity, projectId, rawPayload = {}) {
        const input = { ...rawPayload };
        delete input.operationId;
        delete input.columnId;
        delete input.index;
        delete input.expectedSchemaRevision;
        const payload = validateColumnInput(input);
        const opId = ensureOperation(rawPayload.operationId);
        const expectedSchema = requiredRevision(rawPayload.expectedSchemaRevision, 'EXPECTED_SCHEMA_REVISION_REQUIRED', 'expectedSchemaRevision is required for column creation.');
        const columnId = rawPayload.columnId ? safeColumnId(rawPayload.columnId) : randomId('column', opId, projectId);
        return runCommand({ actorUid: identity.uid, command: 'createColumn', projectId, targetId: columnId, operationId: opId, payload: { ...payload, columnId, index: expectedIndex(rawPayload.index, null), expectedSchemaRevision: expectedSchema }, access: { owner: true, roles: ['Owner'] }, execute: async ({ transaction, contentAccess }) => {
            const project = contentAccess.project;
            assertProjectActive(project);
            const columns = await readCollection(transaction, projectCollection(db, project.id, 'columns'));
            if (columns.some((row) => row.id === columnId)) throw new DomainError(409, 'COLUMN_EXISTS', 'Column already exists.');
            const active = sortSiblingRows(columns.filter((row) => (row.data.lifecycle || 'active') === 'active').map((row) => ({ ...row, rank: row.data.rank })));
            const index = expectedIndex(rawPayload.index, active.length);
            const order = computeOrder(active, index);
            validateRankWriteCount(order.rebalance);
            const timestamp = iso(now());
            const columnMap = mapById(columns);
            const rebalanceBefore = order.rebalance.map((change) => ({ id: change.id, rank: columnMap.get(change.id)?.data?.rank || null, revision: readRevision(columnMap.get(change.id)?.data) }));
            const rebalanceAfter = [];
            for (const change of order.rebalance) {
                const revision = readRevision(columnMap.get(change.id)?.data) + 1;
                rebalanceAfter.push({ id: change.id, rank: change.rank, revision });
                transaction.set(columnRef(db, project.id, change.id), { rank: change.rank, revision, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            }
            transaction.set(columnRef(db, project.id, columnId), { projectId: project.id, ...payload, lifecycle: 'active', rank: order.rank, revision: 1, createdAt: timestamp, updatedAt: timestamp, updatedBy: identity.uid });
            const schemaBefore = readRevision(project.data, 'schemaRevision');
            assertExpected(schemaBefore, expectedSchema, 'STALE_SCHEMA_REVISION', 'Project schema changed; refresh and retry.');
            transaction.set(project.ref, { schemaRevision: schemaBefore + 1, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            return { result: { column: { id: columnId, projectId: project.id, ...payload, lifecycle: 'active', rank: order.rank, revision: 1 }, schemaRevision: schemaBefore + 1 }, before: { columnId, revision: 0, rebalance: rebalanceBefore }, after: { columnId, revision: 1, rebalance: rebalanceAfter }, inverse: { kind: 'createColumn', targetId: columnId, rebalanceBefore, rebalanceAfter }, affectedIds: [project.id, columnId, ...rebalanceAfter.map((entry) => entry.id)], affectedPaths: [projectPath(project.id), recordPath(project.id, 'columns', columnId), ...rebalanceAfter.map((entry) => recordPath(project.id, 'columns', entry.id))], beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'columns', columnId), null], ...rebalanceBefore.map((entry) => [recordPath(project.id, 'columns', entry.id), entry.revision])]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data, { schemaRevision: schemaBefore + 1 })], [recordPath(project.id, 'columns', columnId), 1], ...rebalanceAfter.map((entry) => [recordPath(project.id, 'columns', entry.id), entry.revision])]) };
        }});
    }

    async function createTaskCommand(identity, projectId, rawPayload = {}, preparationTransaction = null) {
        const input = { ...rawPayload };
        for (const key of ['operationId', 'taskId', 'parentTaskId', 'sectionId', 'index', 'expectedStructureRevision']) delete input[key];
        const payload = validateTaskInput(input);
        const opId = ensureOperation(rawPayload.operationId);
        const expectedStructure = requiredRevision(rawPayload.expectedStructureRevision, 'EXPECTED_STRUCTURE_REVISION_REQUIRED', 'expectedStructureRevision is required for task creation.');
        const parentReference = optionalReference(rawPayload.parentTaskId, 'parent task ID');
        const sectionReference = optionalReference(rawPayload.sectionId, 'section ID');
        const taskId = rawPayload.taskId ? id(rawPayload.taskId, 'task ID') : randomId('task', opId, projectId);
        return runCommand({ [PREPARATION_TRANSACTION]: preparationTransaction, actorUid: identity.uid, executionContext: getContext(identity), command: 'createTask', projectId, targetId: taskId, operationId: opId, payload: { ...payload, taskId, parentTaskId: parentReference, sectionId: sectionReference, index: expectedIndex(rawPayload.index, null), expectedStructureRevision: expectedStructure }, access: { write: true, roles: ['Owner', 'Editor'] }, execute: async ({ transaction, contentAccess }) => {
            const project = contentAccess.project;
            assertProjectActive(project);
            const taskCollection = projectCollection(db, project.id, 'tasks');
            const taskRows = await readCollection(transaction, taskCollection);
            const taskMap = mapById(taskRows);
            if (taskMap.has(taskId)) throw new DomainError(409, 'TASK_EXISTS', 'Task already exists.');
            const sectionRows = await readCollection(transaction, projectCollection(db, project.id, 'sections'));
            const sectionMap = mapById(sectionRows);
            const parentTaskId = parentReference;
            if (parentTaskId) {
                const parent = taskMap.get(parentTaskId);
                if (!parent || effectiveLifecycle(taskMap, parentTaskId) !== 'active') throw new DomainError(409, 'INVALID_PARENT_REFERENCE', 'Parent task must be active and in this project.');
            }
            const resolvedSectionId = parentTaskId ? effectiveSection(taskMap, parentTaskId) : id(sectionReference, 'section ID');
            if (!sectionMap.has(resolvedSectionId) || (sectionMap.get(resolvedSectionId).data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'INVALID_SECTION_REFERENCE', 'Task section must be active and in this project.');
            const ownerUid = payload.ownerUid === undefined ? identity.uid : payload.ownerUid;
            const assigneeUids = payload.assigneeUids || [];
            if (ownerUid && assigneeUids.includes(ownerUid)) throw new DomainError(400, 'INVALID_ASSIGNEES', 'The accountable owner cannot also be an additional assignee.');
            await assertAssignmentTargets({
                transaction,
                accessService,
                projectId: project.id,
                ownerUid: payload.ownerUid === undefined ? null : ownerUid,
                assigneeUids: payload.assigneeUids === undefined ? [] : assigneeUids,
                db
            });
            const columns = mapById(await readCollection(transaction, projectCollection(db, project.id, 'columns')));
            const columnData = Object.fromEntries(Array.from(columns, ([key, row]) => [key, row.data]));
            const values = validateTypedValues(payload.values || {}, columnData);
            await assertPeopleValueTargets({ transaction, accessService, db, projectId: project.id, columns: columnData, values });
            const siblings = sortSiblingRows(taskRows.filter((row) => (row.data.parentTaskId || null) === parentTaskId
                && (parentTaskId || row.data.sectionId === resolvedSectionId)
                && effectiveLifecycle(taskMap, row.id) === 'active')
                .map((row) => ({ ...row, rank: row.data.rank })));
            const order = computeOrder(siblings, expectedIndex(rawPayload.index, siblings.length));
            validateRankWriteCount(order.rebalance);
            const timestamp = iso(now());
            const rebalanceBefore = order.rebalance.map((change) => ({ id: change.id, rank: taskMap.get(change.id)?.data?.rank || null, revision: readRevision(taskMap.get(change.id)?.data) }));
            const rebalanceAfter = [];
            for (const change of order.rebalance) {
                const revision = readRevision(taskMap.get(change.id)?.data) + 1;
                rebalanceAfter.push({ id: change.id, rank: change.rank, revision });
                transaction.set(taskRef(db, project.id, change.id), { rank: change.rank, revision, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            }
            const task = { projectId: project.id, parentTaskId, ...(parentTaskId ? {} : { sectionId: resolvedSectionId }), title: payload.title, status: payload.status || DEFAULT_STATUS, ownerUid, assigneeUids, startDate: payload.startDate || null, dueDate: payload.dueDate || null, values, lifecycle: 'active', rank: order.rank, revision: 1, createdAt: timestamp, updatedAt: timestamp, updatedBy: identity.uid };
            transaction.set(taskRef(db, project.id, taskId), task);
            const structureBefore = readRevision(project.data, 'structureRevision');
            assertExpected(structureBefore, expectedStructure, 'STALE_STRUCTURE_REVISION', 'Project structure changed; refresh and retry.');
            transaction.set(project.ref, { structureRevision: structureBefore + 1, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            return { result: { task: { ...task, id: taskId }, structureRevision: structureBefore + 1 }, before: { taskId, revision: 0, rebalance: rebalanceBefore }, after: { taskId, revision: 1, rebalance: rebalanceAfter }, inverse: { kind: 'createTask', targetId: taskId, rebalanceBefore, rebalanceAfter }, affectedIds: [project.id, taskId, ...rebalanceAfter.map((entry) => entry.id)], affectedPaths: [projectPath(project.id), recordPath(project.id, 'tasks', taskId), ...rebalanceAfter.map((entry) => recordPath(project.id, 'tasks', entry.id))], structureRevisionBefore: structureBefore, structureRevisionAfter: structureBefore + 1, beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'tasks', taskId), null], ...rebalanceBefore.map((entry) => [recordPath(project.id, 'tasks', entry.id), entry.revision])]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data, { structureRevision: structureBefore + 1 })], [recordPath(project.id, 'tasks', taskId), 1], ...rebalanceAfter.map((entry) => [recordPath(project.id, 'tasks', entry.id), entry.revision])]) };
        }});
    }

    async function updateTask(identity, projectId, taskId, rawPayload = {}) {
        const input = { ...rawPayload };
        delete input.operationId;
        delete input.expectedRevision;
        delete input.expectedStructureRevision;
        const payload = validateTaskPatch(input);
        if (payload.lifecycle !== undefined) throw new DomainError(409, 'LIFECYCLE_COMMAND_REQUIRED', 'Task archive/restore is a separate lifecycle command.');
        const opId = ensureOperation(rawPayload.operationId);
        return runCommand({ actorUid: identity.uid, executionContext: getContext(identity), command: 'updateTask', projectId, targetId: id(taskId, 'task ID'), operationId: opId, payload: { ...payload, expectedRevision: rawPayload.expectedRevision }, access: { write: true, roles: ['Owner', 'Editor'] }, execute: async ({ transaction, contentAccess }) => {
            const project = contentAccess.project;
            if ((project.data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'PROJECT_LIFECYCLE_FORBIDDEN', 'Project is not active.');
            const currentSnapshot = await transaction.get(taskRef(db, project.id, taskId));
            if (!currentSnapshot?.exists) throw new DomainError(404, 'TASK_NOT_FOUND', 'Task not found.');
            const current = currentSnapshot.data() || {};
            const expected = expectedRevision(rawPayload.expectedRevision);
            if (expected === null) throw new DomainError(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for task edits.');
            assertExpected(readRevision(current), expected, 'STALE_REVISION', 'Task changed; refresh and retry.');
            const chainRows = [copyRecord(taskId, current, taskRef(db, project.id, taskId))];
            let parentId = current.parentTaskId || null;
            const readAncestors = new Set([taskId]);
            while (parentId) {
                if (readAncestors.has(parentId)) throw new DomainError(409, 'ANCESTRY_CYCLE', 'Task ancestry contains a cycle.');
                readAncestors.add(parentId);
                const parentSnapshot = await transaction.get(taskRef(db, project.id, parentId));
                if (!parentSnapshot?.exists) throw new DomainError(409, 'INVALID_PARENT_REFERENCE', 'Task parent must belong to the same project.');
                chainRows.push(copyRecord(parentId, parentSnapshot.data() || {}, taskRef(db, project.id, parentId)));
                parentId = parentSnapshot.data()?.parentTaskId || null;
            }
            const chainMap = mapById(chainRows);
            if (effectiveLifecycle(chainMap, taskId) !== 'active') throw new DomainError(409, 'TASK_LIFECYCLE_FORBIDDEN', 'Archived or trashed task ancestry cannot be edited.');
            const sectionId = effectiveSection(chainMap, taskId);
            const sectionSnapshot = await transaction.get(sectionRef(db, project.id, sectionId));
            if (!sectionSnapshot?.exists || (sectionSnapshot.data()?.lifecycle || 'active') !== 'active') throw new DomainError(409, 'TASK_LIFECYCLE_FORBIDDEN', 'Task section is not active.');
            const columns = mapById(await readCollection(transaction, projectCollection(db, project.id, 'columns')));
            const columnData = Object.fromEntries(Array.from(columns, ([key, row]) => [key, row.data]));
            const validatedValues = payload.values === undefined ? {} : validateTypedValues(payload.values, columnData);
            const values = { ...(current.values || {}), ...validatedValues };
            await assertPeopleValueTargets({ transaction, accessService, db, projectId: project.id, columns: columnData, values: validatedValues });
            const ownerUid = payload.ownerUid === undefined ? current.ownerUid : payload.ownerUid;
            const assigneeUids = payload.assigneeUids === undefined ? current.assigneeUids || [] : payload.assigneeUids;
            if (ownerUid && assigneeUids.includes(ownerUid)) throw new DomainError(400, 'INVALID_ASSIGNEES', 'The accountable owner cannot also be an additional assignee.');
            await assertAssignmentTargets({
                transaction,
                accessService,
                projectId: project.id,
                ownerUid: payload.ownerUid === undefined ? null : ownerUid,
                assigneeUids: payload.assigneeUids === undefined ? [] : assigneeUids,
                db
            });
            const revision = readRevision(current) + 1;
            const timestamp = iso(now());
            const next = { ...current, ...payload, ownerUid, assigneeUids, values, revision, updatedAt: timestamp, updatedBy: identity.uid };
            delete next.operationId;
            delete next.expectedRevision;
            transaction.set(taskRef(db, project.id, taskId), next);
            return { result: { task: { ...next, id: taskId } }, before: { taskId, revision: readRevision(current) }, after: { taskId, revision }, inverse: { kind: 'updateTask', targetId: taskId, expectedRevisionAfter: revision, patch: current }, affectedIds: [project.id, taskId], affectedPaths: [projectPath(project.id), recordPath(project.id, 'tasks', taskId)], beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'tasks', taskId), readRevision(current)]]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'tasks', taskId), revision]]) };
        }});
    }

    async function moveTask(identity, projectId, taskId, rawPayload = {}) {
        const targetId = id(taskId, 'task ID');
        const opId = ensureOperation(rawPayload.operationId);
        const parentReference = optionalReference(rawPayload.parentTaskId, 'parent task ID');
        const sectionReference = optionalReference(rawPayload.sectionId, 'section ID');
        const payload = { parentTaskId: parentReference, sectionId: sectionReference, index: expectedIndex(rawPayload.index, null), expectedRevision: rawPayload.expectedRevision, expectedStructureRevision: rawPayload.expectedStructureRevision };
        return runCommand({ actorUid: identity.uid, executionContext: getContext(identity), command: 'moveTask', projectId, targetId, operationId: opId, payload, access: { write: true, roles: ['Owner', 'Editor'] }, execute: async ({ transaction, contentAccess }) => {
            const project = contentAccess.project;
            if ((project.data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'PROJECT_LIFECYCLE_FORBIDDEN', 'Project is not active.');
            const taskRows = await readCollection(transaction, projectCollection(db, project.id, 'tasks'));
            const taskMap = mapById(taskRows);
            const currentRow = taskMap.get(targetId);
            if (!currentRow) throw new DomainError(404, 'TASK_NOT_FOUND', 'Task not found.');
            const expected = expectedRevision(rawPayload.expectedRevision);
            if (expected === null) throw new DomainError(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for moves.');
            assertExpected(readRevision(currentRow.data), expected, 'STALE_REVISION', 'Task changed; refresh and retry.');
            const expectedStructure = expectedRevision(rawPayload.expectedStructureRevision, 'INVALID_STRUCTURE_REVISION');
            if (expectedStructure === null) throw new DomainError(400, 'EXPECTED_STRUCTURE_REVISION_REQUIRED', 'expectedStructureRevision is required for moves.');
            const structureBefore = readRevision(project.data, 'structureRevision');
            assertExpected(structureBefore, expectedStructure, 'STALE_STRUCTURE_REVISION', 'Project structure changed; refresh and retry.');
            const parentTaskId = parentReference;
            assertNoCycle(taskMap, targetId, parentTaskId);
            const sections = mapById(await readCollection(transaction, projectCollection(db, project.id, 'sections')));
            const sourceState = resolveTaskState({ tasks: taskMap, taskId: targetId, projectLifecycle: project.data.lifecycle || 'active', sections });
            if (sourceState.lifecycle !== 'active') throw new DomainError(409, 'TASK_LIFECYCLE_FORBIDDEN', 'Archived or trashed task ancestry cannot be moved.');
            if (parentTaskId) {
                const parent = taskMap.get(parentTaskId);
                if (!parent || resolveTaskState({ tasks: taskMap, taskId: parentTaskId, projectLifecycle: project.data.lifecycle || 'active', sections }).lifecycle !== 'active') throw new DomainError(409, 'INVALID_PARENT_REFERENCE', 'Destination parent must be active and in this project.');
            }
            const resolvedSectionId = parentTaskId ? effectiveSection(taskMap, parentTaskId) : id(sectionReference, 'section ID');
            if (!sections.has(resolvedSectionId) || (sections.get(resolvedSectionId).data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'INVALID_SECTION_REFERENCE', 'Destination section must be active and in this project.');
            const siblings = sortSiblingRows(taskRows.filter((row) => row.id !== targetId && (row.data.parentTaskId || null) === parentTaskId
                && (parentTaskId || row.data.sectionId === resolvedSectionId)
                && effectiveLifecycle(taskMap, row.id) === 'active')
                .map((row) => ({ ...row, rank: row.data.rank })));
            const index = expectedIndex(rawPayload.index, siblings.length);
            const order = computeOrder(siblings, index);
            validateRankWriteCount(order.rebalance);
            const timestamp = iso(now());
            const rebalanceBefore = order.rebalance.map((change) => ({ id: change.id, rank: taskMap.get(change.id)?.data?.rank || null, revision: readRevision(taskMap.get(change.id)?.data) }));
            const rebalanceAfter = [];
            for (const change of order.rebalance) {
                const revision = readRevision(taskMap.get(change.id)?.data) + 1;
                rebalanceAfter.push({ id: change.id, rank: change.rank, revision });
                transaction.set(taskRef(db, project.id, change.id), { rank: change.rank, revision, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            }
            const before = { parentTaskId: currentRow.data.parentTaskId || null, sectionId: currentRow.data.sectionId || null, rank: currentRow.data.rank || null, revision: readRevision(currentRow.data) };
            const next = { ...currentRow.data, parentTaskId, rank: order.rank, revision: before.revision + 1, updatedAt: timestamp, updatedBy: identity.uid };
            if (parentTaskId) delete next.sectionId;
            else next.sectionId = resolvedSectionId;
            transaction.set(taskRef(db, project.id, targetId), next);
            const structureAfter = structureBefore + 1;
            transaction.set(project.ref, { structureRevision: structureAfter, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            return { result: { task: { ...next, id: targetId }, structureRevision: structureAfter }, before: { ...before, rebalance: rebalanceBefore }, after: { taskId: targetId, revision: next.revision, parentTaskId, sectionId: parentTaskId ? null : resolvedSectionId, rebalance: rebalanceAfter }, inverse: { kind: 'moveTask', targetId, parentTaskId: before.parentTaskId, sectionId: before.sectionId, rank: before.rank, expectedRevisionAfter: next.revision, expectedStructureRevisionAfter: structureAfter, rebalanceBefore, rebalanceAfter }, affectedIds: [project.id, targetId, ...rebalanceAfter.map((entry) => entry.id)], affectedPaths: [projectPath(project.id), recordPath(project.id, 'tasks', targetId), ...rebalanceAfter.map((entry) => recordPath(project.id, 'tasks', entry.id))], structureRevisionBefore: structureBefore, structureRevisionAfter: structureAfter, beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'tasks', targetId), before.revision], ...rebalanceBefore.map((entry) => [recordPath(project.id, 'tasks', entry.id), entry.revision])]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data, { structureRevision: structureAfter })], [recordPath(project.id, 'tasks', targetId), next.revision], ...rebalanceAfter.map((entry) => [recordPath(project.id, 'tasks', entry.id), entry.revision])]) };
        }});
    }

    async function updateProjectCommand(identity, projectId, rawPayload = {}, preparationTransaction = null) {
        const input = { ...rawPayload };
        delete input.operationId;
        delete input.expectedRevision;
        delete input.expectedSchemaRevision;
        delete input.projectId;
        if (Object.keys(input).some((key) => !['name', 'description', 'statusLabels'].includes(key))) throw new DomainError(400, 'INVALID_PROJECT', 'Project patch contains an unsupported field.');
        const name = input.name === undefined ? undefined : input.name;
        const description = input.description === undefined ? undefined : input.description;
        if ((name !== undefined && typeof name !== 'string') || (description !== undefined && typeof description !== 'string')) {
            throw new DomainError(400, 'INVALID_PROJECT', 'Project metadata must be text.');
        }
        if (name !== undefined && (!name || name.length > 200)) throw new DomainError(400, 'INVALID_PROJECT', 'Project name is invalid.');
        if (description !== undefined && description.length > 20000) throw new DomainError(400, 'INVALID_PROJECT', 'Project description is invalid.');
        const statusLabels = validateStatusLabels(input.statusLabels);
        if (name === undefined && description === undefined && statusLabels === undefined) throw new DomainError(400, 'INVALID_PROJECT', 'Project patch cannot be empty.');
        const payload = { ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }), ...(statusLabels === undefined ? {} : { statusLabels }), expectedRevision: rawPayload.expectedRevision, expectedSchemaRevision: rawPayload.expectedSchemaRevision };
        const opId = ensureOperation(rawPayload.operationId);
        return runCommand({ [PREPARATION_TRANSACTION]: preparationTransaction, actorUid: identity.uid, command: 'updateProject', projectId, targetId: projectId, operationId: opId, payload, access: { owner: true, roles: ['Owner'] }, execute: async ({ transaction, contentAccess }) => {
            const project = contentAccess.project;
            assertProjectActive(project);
            const expected = expectedRevision(rawPayload.expectedRevision);
            if (expected === null) throw new DomainError(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for project edits.');
            assertExpected(readRevision(project.data), expected, 'STALE_REVISION', 'Project changed; refresh and retry.');
            const schemaBefore = readRevision(project.data, 'schemaRevision');
            const expectedSchema = statusLabels === undefined
                ? null
                : expectedRevision(rawPayload.expectedSchemaRevision, 'INVALID_SCHEMA_REVISION');
            if (statusLabels !== undefined) {
                if (expectedSchema === null) throw new DomainError(400, 'EXPECTED_SCHEMA_REVISION_REQUIRED', 'expectedSchemaRevision is required when updating status labels.');
                assertExpected(schemaBefore, expectedSchema, 'STALE_SCHEMA_REVISION', 'Project schema changed; refresh and retry.');
            }
            const schemaAfter = statusLabels === undefined ? schemaBefore : schemaBefore + 1;
            const mergedStatusLabels = statusLabels === undefined
                ? project.data.statusLabels
                : { ...(project.data.statusLabels && typeof project.data.statusLabels === 'object' ? project.data.statusLabels : {}), ...statusLabels };
            const next = { ...project.data, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }), ...(statusLabels === undefined ? {} : { statusLabels: mergedStatusLabels }), revision: readRevision(project.data) + 1, schemaRevision: schemaAfter, updatedAt: iso(now()), updatedBy: identity.uid };
            delete next.operationId;
            delete next.expectedRevision;
            delete next.expectedSchemaRevision;
            transaction.set(project.ref, next);
            return { result: { project: { ...next, id: project.id } }, before: { projectId: project.id, revision: expected, schemaRevision: schemaBefore }, after: { projectId: project.id, revision: next.revision, schemaRevision: schemaAfter }, inverse: { kind: 'updateProject', targetId: project.id, expectedRevisionAfter: next.revision, patch: project.data }, affectedIds: [project.id], affectedPaths: [projectPath(project.id)], beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)]]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(next)]]) };
        }});
    }

    async function updateSection(identity, projectId, sectionId, rawPayload = {}) {
        const input = { ...rawPayload };
        delete input.operationId;
        delete input.expectedRevision;
        delete input.sectionId;
        delete input.expectedStructureRevision;
        const payload = validateSectionInput(input);
        const opId = ensureOperation(rawPayload.operationId);
        const expectedStructure = requiredRevision(rawPayload.expectedStructureRevision, 'EXPECTED_STRUCTURE_REVISION_REQUIRED', 'expectedStructureRevision is required for section edits.');
        return runCommand({ actorUid: identity.uid, command: 'updateSection', projectId, targetId: id(sectionId, 'section ID'), operationId: opId, payload: { ...payload, expectedRevision: rawPayload.expectedRevision, expectedStructureRevision: expectedStructure }, access: { owner: true, roles: ['Owner'] }, execute: async ({ transaction, contentAccess }) => {
            assertProjectActive(contentAccess.project);
            const currentSnapshot = await transaction.get(sectionRef(db, projectId, sectionId));
            if (!currentSnapshot?.exists) throw new DomainError(404, 'SECTION_NOT_FOUND', 'Section not found.');
            const current = currentSnapshot.data() || {};
            const expected = expectedRevision(rawPayload.expectedRevision);
            if (expected === null) throw new DomainError(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for section edits.');
            assertExpected(readRevision(current), expected, 'STALE_REVISION', 'Section changed; refresh and retry.');
            const next = { ...current, ...payload, revision: expected + 1, updatedAt: iso(now()), updatedBy: identity.uid };
            transaction.set(sectionRef(db, projectId, sectionId), next);
            const structureBefore = readRevision(contentAccess.project.data, 'structureRevision');
            assertExpected(structureBefore, expectedStructure, 'STALE_STRUCTURE_REVISION', 'Project structure changed; refresh and retry.');
            transaction.set(contentAccess.project.ref, { structureRevision: structureBefore + 1, updatedAt: next.updatedAt, updatedBy: identity.uid }, { merge: true });
            return { result: { section: { ...next, id: sectionId }, structureRevision: structureBefore + 1 }, before: { sectionId, revision: expected }, after: { sectionId, revision: next.revision }, affectedIds: [projectId, sectionId], affectedPaths: [projectPath(projectId), recordPath(projectId, 'sections', sectionId)], structureRevisionBefore: structureBefore, structureRevisionAfter: structureBefore + 1, beforeRevisions: revisionMap([[projectPath(projectId), projectRevision(contentAccess.project.data)], [recordPath(projectId, 'sections', sectionId), expected]]), afterRevisions: revisionMap([[projectPath(projectId), projectRevision(contentAccess.project.data, { structureRevision: structureBefore + 1 })], [recordPath(projectId, 'sections', sectionId), next.revision]]) };
        }});
    }

    async function updateColumn(identity, projectId, columnId, rawPayload = {}) {
        const input = { ...rawPayload };
        delete input.operationId;
        delete input.expectedRevision;
        delete input.columnId;
        delete input.expectedSchemaRevision;
        if (Object.keys(input).some((key) => !['type', 'label', 'options', 'statusLabels'].includes(key))) throw new DomainError(400, 'INVALID_COLUMN', 'Column patch contains an unsupported field.');
        const opId = ensureOperation(rawPayload.operationId);
        const normalizedColumnId = safeColumnId(columnId);
        const expectedSchema = requiredRevision(rawPayload.expectedSchemaRevision, 'EXPECTED_SCHEMA_REVISION_REQUIRED', 'expectedSchemaRevision is required for column edits.');
        return runCommand({ actorUid: identity.uid, command: 'updateColumn', projectId, targetId: normalizedColumnId, operationId: opId, payload: { ...input, expectedRevision: rawPayload.expectedRevision, expectedSchemaRevision: expectedSchema }, access: { owner: true, roles: ['Owner'] }, execute: async ({ transaction, contentAccess }) => {
            assertProjectActive(contentAccess.project);
            const currentSnapshot = await transaction.get(columnRef(db, projectId, normalizedColumnId));
            if (!currentSnapshot?.exists) throw new DomainError(404, 'COLUMN_NOT_FOUND', 'Column not found.');
            const current = currentSnapshot.data() || {};
            const expected = expectedRevision(rawPayload.expectedRevision);
            if (expected === null) throw new DomainError(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for column edits.');
            assertExpected(readRevision(current), expected, 'STALE_REVISION', 'Column changed; refresh and retry.');
            if (input.type !== undefined && input.type !== current.type) throw new DomainError(409, 'COLUMN_REPLACEMENT_REQUIRED', 'Changing a column type requires a new column identity.');
            const candidate = validateColumnInput({ type: current.type, label: input.label === undefined ? current.label : input.label, options: input.options === undefined ? current.options : input.options, statusLabels: input.statusLabels === undefined ? current.statusLabels : input.statusLabels });
            const next = { ...current, ...candidate, revision: expected + 1, updatedAt: iso(now()), updatedBy: identity.uid };
            transaction.set(columnRef(db, projectId, normalizedColumnId), next);
            const schemaBefore = readRevision(contentAccess.project.data, 'schemaRevision');
            assertExpected(schemaBefore, expectedSchema, 'STALE_SCHEMA_REVISION', 'Project schema changed; refresh and retry.');
            transaction.set(contentAccess.project.ref, { schemaRevision: schemaBefore + 1, updatedAt: next.updatedAt, updatedBy: identity.uid }, { merge: true });
            return { result: { column: { ...next, id: normalizedColumnId }, schemaRevision: schemaBefore + 1 }, before: { columnId: normalizedColumnId, revision: expected }, after: { columnId: normalizedColumnId, revision: next.revision }, affectedIds: [projectId, normalizedColumnId], affectedPaths: [projectPath(projectId), recordPath(projectId, 'columns', normalizedColumnId)], beforeRevisions: revisionMap([[projectPath(projectId), projectRevision(contentAccess.project.data)], [recordPath(projectId, 'columns', normalizedColumnId), expected]]), afterRevisions: revisionMap([[projectPath(projectId), projectRevision(contentAccess.project.data, { schemaRevision: schemaBefore + 1 })], [recordPath(projectId, 'columns', normalizedColumnId), next.revision]]) };
        }});
    }

    async function replaceColumn(identity, projectId, columnId, rawPayload = {}) {
        const input = { ...rawPayload };
        delete input.operationId;
        delete input.expectedRevision;
        delete input.expectedSchemaRevision;
        delete input.newColumnId;
        delete input.columnId;
        const payload = validateColumnInput(input);
        const opId = ensureOperation(rawPayload.operationId);
        const normalizedColumnId = safeColumnId(columnId);
        const newColumnId = rawPayload.newColumnId ? safeColumnId(rawPayload.newColumnId, 'new column ID') : randomId('column-replacement', opId, projectId);
        const expectedSchema = requiredRevision(rawPayload.expectedSchemaRevision, 'EXPECTED_SCHEMA_REVISION_REQUIRED', 'expectedSchemaRevision is required for column replacement.');
        return runCommand({ actorUid: identity.uid, command: 'replaceColumn', projectId, targetId: normalizedColumnId, operationId: opId, payload: { ...payload, newColumnId, expectedRevision: rawPayload.expectedRevision, expectedSchemaRevision: expectedSchema }, access: { owner: true, roles: ['Owner'] }, execute: async ({ transaction, contentAccess }) => {
            assertProjectActive(contentAccess.project);
            const oldSnapshot = await transaction.get(columnRef(db, projectId, normalizedColumnId));
            if (!oldSnapshot?.exists) throw new DomainError(404, 'COLUMN_NOT_FOUND', 'Column not found.');
            const old = oldSnapshot.data() || {};
            const expected = expectedRevision(rawPayload.expectedRevision);
            if (expected === null) throw new DomainError(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for column replacement.');
            assertExpected(readRevision(old), expected, 'STALE_REVISION', 'Column changed; refresh and retry.');
            if (newColumnId === normalizedColumnId) throw new DomainError(400, 'INVALID_COLUMN_ID', 'Replacement column requires a new identity.');
            const newRef = columnRef(db, projectId, newColumnId);
            if ((await transaction.get(newRef))?.exists) throw new DomainError(409, 'COLUMN_EXISTS', 'Replacement column already exists.');
            const timestamp = iso(now());
            const archivedOld = { ...old, lifecycle: 'archived', replacedBy: newColumnId, revision: expected + 1, updatedAt: timestamp, updatedBy: identity.uid };
            const replacement = { projectId, ...payload, lifecycle: 'active', replacesColumnId: normalizedColumnId, rank: old.rank || '0/1', revision: 1, createdAt: timestamp, updatedAt: timestamp, updatedBy: identity.uid };
            transaction.set(columnRef(db, projectId, normalizedColumnId), archivedOld);
            transaction.set(newRef, replacement);
            const schemaBefore = readRevision(contentAccess.project.data, 'schemaRevision');
            assertExpected(schemaBefore, expectedSchema, 'STALE_SCHEMA_REVISION', 'Project schema changed; refresh and retry.');
            transaction.set(contentAccess.project.ref, { schemaRevision: schemaBefore + 1, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            return { result: { archivedColumn: { ...archivedOld, id: normalizedColumnId }, column: { ...replacement, id: newColumnId }, schemaRevision: schemaBefore + 1 }, before: { columnId: normalizedColumnId, revision: expected }, after: { columnId: newColumnId, revision: 1 }, affectedIds: [projectId, normalizedColumnId, newColumnId], affectedPaths: [projectPath(projectId), recordPath(projectId, 'columns', normalizedColumnId), recordPath(projectId, 'columns', newColumnId)], beforeRevisions: revisionMap([[projectPath(projectId), projectRevision(contentAccess.project.data)], [recordPath(projectId, 'columns', normalizedColumnId), expected]]), afterRevisions: revisionMap([[projectPath(projectId), projectRevision(contentAccess.project.data, { schemaRevision: schemaBefore + 1 })], [recordPath(projectId, 'columns', normalizedColumnId), archivedOld.revision], [recordPath(projectId, 'columns', newColumnId), 1]]) };
        }});
    }

    async function moveSection(identity, projectId, sectionId, rawPayload = {}) {
        const normalizedSectionId = id(sectionId, 'section ID');
        const opId = ensureOperation(rawPayload.operationId);
        const expected = requiredRevision(rawPayload.expectedRevision, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for section moves.');
        const expectedStructure = requiredRevision(rawPayload.expectedStructureRevision, 'EXPECTED_STRUCTURE_REVISION_REQUIRED', 'expectedStructureRevision is required for section moves.');
        const index = expectedIndex(rawPayload.index, null);
        return runCommand({ actorUid: identity.uid, command: 'moveSection', projectId, targetId: normalizedSectionId, operationId: opId, payload: { index, expectedRevision: expected, expectedStructureRevision: expectedStructure }, access: { owner: true, roles: ['Owner'] }, execute: async ({ transaction, contentAccess }) => {
            const project = contentAccess.project;
            assertProjectActive(project);
            const sections = await readCollection(transaction, projectCollection(db, project.id, 'sections'));
            const sectionMap = mapById(sections);
            const currentRow = sectionMap.get(normalizedSectionId);
            if (!currentRow) throw new DomainError(404, 'SECTION_NOT_FOUND', 'Section not found.');
            if ((currentRow.data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'SECTION_LIFECYCLE_FORBIDDEN', 'Section is not active.');
            assertExpected(readRevision(currentRow.data), expected, 'STALE_REVISION', 'Section changed; refresh and retry.');
            const structureBefore = readRevision(project.data, 'structureRevision');
            assertExpected(structureBefore, expectedStructure, 'STALE_STRUCTURE_REVISION', 'Project structure changed; refresh and retry.');
            const siblings = sortSiblingRows(sections.filter((row) => row.id !== normalizedSectionId && (row.data.lifecycle || 'active') === 'active').map((row) => ({ ...row, rank: row.data.rank })));
            const order = computeOrder(siblings, expectedIndex(index, siblings.length));
            validateRankWriteCount(order.rebalance);
            const timestamp = iso(now());
            const rebalanceBefore = order.rebalance.map((change) => ({ id: change.id, rank: sectionMap.get(change.id)?.data?.rank || null, revision: readRevision(sectionMap.get(change.id)?.data) }));
            const rebalanceAfter = [];
            for (const change of order.rebalance) {
                const revision = readRevision(sectionMap.get(change.id)?.data) + 1;
                rebalanceAfter.push({ id: change.id, rank: change.rank, revision });
                transaction.set(sectionRef(db, project.id, change.id), { rank: change.rank, revision, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            }
            const next = { ...currentRow.data, rank: order.rank, revision: expected + 1, updatedAt: timestamp, updatedBy: identity.uid };
            transaction.set(sectionRef(db, project.id, normalizedSectionId), next);
            const structureAfter = structureBefore + 1;
            transaction.set(project.ref, { structureRevision: structureAfter, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            return { result: { section: { ...next, id: normalizedSectionId }, structureRevision: structureAfter }, before: { sectionId: normalizedSectionId, revision: expected, rank: currentRow.data.rank || null, rebalance: rebalanceBefore }, after: { sectionId: normalizedSectionId, revision: next.revision, rank: order.rank, rebalance: rebalanceAfter }, inverse: { kind: 'moveSection', targetId: normalizedSectionId, rank: currentRow.data.rank || null, expectedRevisionAfter: next.revision, expectedStructureRevisionAfter: structureAfter, rebalanceBefore, rebalanceAfter }, affectedIds: [project.id, normalizedSectionId, ...rebalanceAfter.map((entry) => entry.id)], affectedPaths: [projectPath(project.id), recordPath(project.id, 'sections', normalizedSectionId), ...rebalanceAfter.map((entry) => recordPath(project.id, 'sections', entry.id))], structureRevisionBefore: structureBefore, structureRevisionAfter: structureAfter, beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'sections', normalizedSectionId), expected], ...rebalanceBefore.map((entry) => [recordPath(project.id, 'sections', entry.id), entry.revision])]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data, { structureRevision: structureAfter })], [recordPath(project.id, 'sections', normalizedSectionId), next.revision], ...rebalanceAfter.map((entry) => [recordPath(project.id, 'sections', entry.id), entry.revision])]) };
        }});
    }

    async function moveColumn(identity, projectId, columnId, rawPayload = {}) {
        const normalizedColumnId = safeColumnId(columnId);
        const opId = ensureOperation(rawPayload.operationId);
        const expected = requiredRevision(rawPayload.expectedRevision, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for column moves.');
        const expectedSchema = requiredRevision(rawPayload.expectedSchemaRevision, 'EXPECTED_SCHEMA_REVISION_REQUIRED', 'expectedSchemaRevision is required for column moves.');
        const index = expectedIndex(rawPayload.index, null);
        return runCommand({ actorUid: identity.uid, command: 'moveColumn', projectId, targetId: normalizedColumnId, operationId: opId, payload: { index, expectedRevision: expected, expectedSchemaRevision: expectedSchema }, access: { owner: true, roles: ['Owner'] }, execute: async ({ transaction, contentAccess }) => {
            const project = contentAccess.project;
            assertProjectActive(project);
            const columns = await readCollection(transaction, projectCollection(db, project.id, 'columns'));
            const columnMap = mapById(columns);
            const currentRow = columnMap.get(normalizedColumnId);
            if (!currentRow) throw new DomainError(404, 'COLUMN_NOT_FOUND', 'Column not found.');
            if ((currentRow.data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'COLUMN_LIFECYCLE_FORBIDDEN', 'Column is not active.');
            assertExpected(readRevision(currentRow.data), expected, 'STALE_REVISION', 'Column changed; refresh and retry.');
            const schemaBefore = readRevision(project.data, 'schemaRevision');
            assertExpected(schemaBefore, expectedSchema, 'STALE_SCHEMA_REVISION', 'Project schema changed; refresh and retry.');
            const siblings = sortSiblingRows(columns.filter((row) => row.id !== normalizedColumnId && (row.data.lifecycle || 'active') === 'active').map((row) => ({ ...row, rank: row.data.rank })));
            const order = computeOrder(siblings, expectedIndex(index, siblings.length));
            validateRankWriteCount(order.rebalance);
            const timestamp = iso(now());
            const rebalanceBefore = order.rebalance.map((change) => ({ id: change.id, rank: columnMap.get(change.id)?.data?.rank || null, revision: readRevision(columnMap.get(change.id)?.data) }));
            const rebalanceAfter = [];
            for (const change of order.rebalance) {
                const revision = readRevision(columnMap.get(change.id)?.data) + 1;
                rebalanceAfter.push({ id: change.id, rank: change.rank, revision });
                transaction.set(columnRef(db, project.id, change.id), { rank: change.rank, revision, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            }
            const next = { ...currentRow.data, rank: order.rank, revision: expected + 1, updatedAt: timestamp, updatedBy: identity.uid };
            transaction.set(columnRef(db, project.id, normalizedColumnId), next);
            const schemaAfter = schemaBefore + 1;
            transaction.set(project.ref, { schemaRevision: schemaAfter, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            return { result: { column: { ...next, id: normalizedColumnId }, schemaRevision: schemaAfter }, before: { columnId: normalizedColumnId, revision: expected, rank: currentRow.data.rank || null, rebalance: rebalanceBefore }, after: { columnId: normalizedColumnId, revision: next.revision, rank: order.rank, rebalance: rebalanceAfter }, inverse: { kind: 'moveColumn', targetId: normalizedColumnId, rank: currentRow.data.rank || null, expectedRevisionAfter: next.revision, expectedSchemaRevisionAfter: schemaAfter, rebalanceBefore, rebalanceAfter }, affectedIds: [project.id, normalizedColumnId, ...rebalanceAfter.map((entry) => entry.id)], affectedPaths: [projectPath(project.id), recordPath(project.id, 'columns', normalizedColumnId), ...rebalanceAfter.map((entry) => recordPath(project.id, 'columns', entry.id))], beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'columns', normalizedColumnId), expected], ...rebalanceBefore.map((entry) => [recordPath(project.id, 'columns', entry.id), entry.revision])]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data, { schemaRevision: schemaAfter })], [recordPath(project.id, 'columns', normalizedColumnId), next.revision], ...rebalanceAfter.map((entry) => [recordPath(project.id, 'columns', entry.id), entry.revision])]) };
        }});
    }

    async function archiveColumn(identity, projectId, columnId, rawPayload = {}) {
        const normalizedColumnId = safeColumnId(columnId);
        const opId = ensureOperation(rawPayload.operationId);
        const expected = requiredRevision(rawPayload.expectedRevision, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for column archival.');
        const expectedSchema = requiredRevision(rawPayload.expectedSchemaRevision, 'EXPECTED_SCHEMA_REVISION_REQUIRED', 'expectedSchemaRevision is required for column archival.');
        return runCommand({ actorUid: identity.uid, command: 'archiveColumn', projectId, targetId: normalizedColumnId, operationId: opId, payload: { expectedRevision: expected, expectedSchemaRevision: expectedSchema }, access: { owner: true, roles: ['Owner'] }, execute: async ({ transaction, contentAccess }) => {
            const project = contentAccess.project;
            assertProjectActive(project);
            const currentSnapshot = await transaction.get(columnRef(db, project.id, normalizedColumnId));
            if (!currentSnapshot?.exists) throw new DomainError(404, 'COLUMN_NOT_FOUND', 'Column not found.');
            const current = currentSnapshot.data() || {};
            if ((current.lifecycle || 'active') === 'archived') throw new DomainError(409, 'COLUMN_LIFECYCLE_FORBIDDEN', 'Column is already archived.');
            assertExpected(readRevision(current), expected, 'STALE_REVISION', 'Column changed; refresh and retry.');
            const schemaBefore = readRevision(project.data, 'schemaRevision');
            assertExpected(schemaBefore, expectedSchema, 'STALE_SCHEMA_REVISION', 'Project schema changed; refresh and retry.');
            const timestamp = iso(now());
            const next = { ...current, lifecycle: 'archived', revision: expected + 1, updatedAt: timestamp, updatedBy: identity.uid };
            transaction.set(columnRef(db, project.id, normalizedColumnId), next);
            const schemaAfter = schemaBefore + 1;
            transaction.set(project.ref, { schemaRevision: schemaAfter, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
            return { result: { column: { ...next, id: normalizedColumnId }, schemaRevision: schemaAfter }, before: { columnId: normalizedColumnId, revision: expected }, after: { columnId: normalizedColumnId, revision: next.revision }, inverse: { kind: 'archiveColumn', targetId: normalizedColumnId, expectedRevisionAfter: next.revision, expectedSchemaRevisionAfter: schemaAfter, previous: current }, affectedIds: [project.id, normalizedColumnId], affectedPaths: [projectPath(project.id), recordPath(project.id, 'columns', normalizedColumnId)], beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'columns', normalizedColumnId), expected]]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data, { schemaRevision: schemaAfter })], [recordPath(project.id, 'columns', normalizedColumnId), next.revision]]) };
        }});
    }

    async function archiveTask(identity, projectId, taskId, rawPayload = {}) {
        return updateTask(identity, projectId, taskId, { ...rawPayload, lifecycle: rawPayload.lifecycle || 'archived' });
    }

    async function undoOperation(identity, projectId, operationIdValue, rawPayload = {}) {
        const opId = ensureOperation(operationIdValue);
        const newOperationId = ensureOperation(rawPayload.operationId);
        return runCommand({ actorUid: identity.uid, command: 'undoOperation', projectId, targetId: opId, operationId: newOperationId, payload: { originalOperationId: opId }, access: { write: true, roles: ['Owner', 'Editor'] }, execute: async ({ transaction, contentAccess }) => {
            assertProjectActive(contentAccess.project);
            const originalSnap = await transaction.get(operationRef(db, opId));
            const original = readData(originalSnap);
            if (!original || original.projectId !== contentAccess.project.id) throw new DomainError(404, 'OPERATION_NOT_FOUND', 'Operation not found.');
            if (original.command !== 'moveTask' || !original.inverse) throw new DomainError(409, 'UNDO_UNSUPPORTED', 'This operation cannot be undone in Phase2.');
            const inverse = original.inverse;
            const currentSnap = await transaction.get(taskRef(db, contentAccess.project.id, inverse.targetId));
            const current = readData(currentSnap);
            if (!current || readRevision(current) !== Number(inverse.expectedRevisionAfter)) throw new DomainError(409, 'UNDO_CONFLICT', 'Task changed after the original move.');
            const project = contentAccess.project;
            const structureBefore = readRevision(project.data, 'structureRevision');
            if (structureBefore !== Number(inverse.expectedStructureRevisionAfter)) throw new DomainError(409, 'UNDO_CONFLICT', 'Project structure changed after the original move.');
            const taskRows = await readCollection(transaction, projectCollection(db, project.id, 'tasks'));
            const taskMap = mapById(taskRows);
            for (const changed of inverse.rebalanceAfter || []) {
                const changedRow = taskMap.get(changed.id);
                if (!changedRow || readRevision(changedRow.data) !== Number(changed.revision)) throw new DomainError(409, 'UNDO_CONFLICT', 'Sibling order changed after the original move.');
            }
            const sections = mapById(await readCollection(transaction, projectCollection(db, project.id, 'sections')));
            const projectLifecycle = project.data.lifecycle || 'active';
            const currentState = resolveTaskState({ tasks: taskMap, taskId: inverse.targetId, projectLifecycle, sections });
            if (currentState.lifecycle !== 'active') throw new DomainError(409, 'UNDO_CONFLICT', 'Task or its current ancestry is no longer active.');
            assertNoCycle(taskMap, inverse.targetId, inverse.parentTaskId || null);
            const resolvedSectionId = inverse.parentTaskId ? effectiveSection(taskMap, inverse.parentTaskId) : inverse.sectionId;
            if (!resolvedSectionId || !sections.has(resolvedSectionId)) throw new DomainError(409, 'UNDO_CONFLICT', 'Original destination section is unavailable.');
            const destinationState = inverse.parentTaskId
                ? resolveTaskState({ tasks: taskMap, taskId: inverse.parentTaskId, projectLifecycle, sections })
                : null;
            if (destinationState && destinationState.lifecycle !== 'active') throw new DomainError(409, 'UNDO_CONFLICT', 'Original destination ancestry is no longer active.');
            if (!destinationState && (sections.get(resolvedSectionId).data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'UNDO_CONFLICT', 'Original destination section is no longer active.');
            const next = { ...current, parentTaskId: inverse.parentTaskId || null, rank: inverse.rank || current.rank, revision: readRevision(current) + 1, updatedAt: iso(now()), updatedBy: identity.uid };
            if (inverse.parentTaskId) delete next.sectionId; else next.sectionId = resolvedSectionId;
            transaction.set(taskRef(db, project.id, inverse.targetId), next);
            const restored = [];
            for (const changed of inverse.rebalanceBefore || []) {
                const changedRow = taskMap.get(changed.id);
                const restoredRevision = readRevision(changedRow.data) + 1;
                transaction.set(taskRef(db, project.id, changed.id), { ...changedRow.data, rank: changed.rank, revision: restoredRevision, updatedAt: next.updatedAt, updatedBy: identity.uid });
                restored.push({ id: changed.id, rank: changed.rank, revision: restoredRevision });
            }
            transaction.set(project.ref, { structureRevision: structureBefore + 1, updatedAt: next.updatedAt, updatedBy: identity.uid }, { merge: true });
            return { result: { task: { ...next, id: inverse.targetId }, structureRevision: structureBefore + 1 }, before: { taskId: inverse.targetId, revision: readRevision(current), rebalance: inverse.rebalanceAfter || [] }, after: { taskId: inverse.targetId, revision: next.revision, rebalance: restored }, inverse: { kind: 'moveTask', targetId: inverse.targetId, expectedRevisionAfter: next.revision, expectedStructureRevisionAfter: structureBefore + 1, rebalanceBefore: inverse.rebalanceAfter || [], rebalanceAfter: restored }, affectedIds: [project.id, inverse.targetId, ...restored.map((entry) => entry.id)], affectedPaths: [projectPath(project.id), recordPath(project.id, 'tasks', inverse.targetId), ...restored.map((entry) => recordPath(project.id, 'tasks', entry.id))], structureRevisionBefore: structureBefore, structureRevisionAfter: structureBefore + 1, beforeRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data)], [recordPath(project.id, 'tasks', inverse.targetId), readRevision(current)], ...(inverse.rebalanceAfter || []).map((entry) => [recordPath(project.id, 'tasks', entry.id), entry.revision])]), afterRevisions: revisionMap([[projectPath(project.id), projectRevision(project.data, { structureRevision: structureBefore + 1 })], [recordPath(project.id, 'tasks', inverse.targetId), next.revision], ...restored.map((entry) => [recordPath(project.id, 'tasks', entry.id), entry.revision])]) };
        }});
    }

    // Phase4 discussion/recovery commands use the same authenticated,
    // transactional operation boundary. Keep this executor private to the
    // feature package while exposing the already-authorized seam to focused
    // services; callers cannot bypass the access/idempotency envelope.
    return { runCommand, createProject: (identity, payload) => createProjectCommand(identity, payload), updateProject: (identity, projectId, payload) => updateProjectCommand(identity, projectId, payload),
        createTask: (identity, projectId, payload) => createTaskCommand(identity, projectId, payload),
        prepareCreateProject: ({ transaction, actorUid, payload }) => createProjectCommand({ uid: actorUid }, payload, requirePreparationTransaction(transaction)),
        prepareCreateTask: ({ transaction, actorUid, projectId, payload }) => createTaskCommand({ uid: actorUid }, projectId, payload, requirePreparationTransaction(transaction)),
        prepareUpdateProject: ({ transaction, actorUid, projectId, payload }) => updateProjectCommand({ uid: actorUid }, projectId, payload, requirePreparationTransaction(transaction)),
        createSection, updateSection, createColumn, updateColumn, replaceColumn, updateTask, moveTask, moveSection, moveColumn, archiveColumn, archiveTask, undoOperation, constants: { PROJECT_OPERATION_COLLECTION, PROJECT_EVENT_COLLECTION } };
}

module.exports = { buildService, createProjectsCommandService: buildService, ancestry, effectiveSection, effectiveLifecycle, assertNoCycle };
