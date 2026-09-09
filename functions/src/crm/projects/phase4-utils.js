'use strict';

const crypto = require('crypto');
const { PROJECT_COLLECTIONS, memberDocumentId } = require('./access-service');
const { DomainError, id, uid } = require('./domain/validation');
const { projectCollection, projectRef, readData, snapshotRows } = require('./domain/storage');
const { resolveTaskState } = require('./domain/hierarchy');

const MAX_MESSAGE_BODY = 20000;
const MAX_MENTIONS = 50;
const MAX_HISTORY_PAGE = 100;
const MAX_BULK_TASKS = 100;
const MAX_BULK_OPERATION_BYTES = 900000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = Object.freeze(new Set([
    'application/pdf',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]));

function nowIso(now = () => new Date()) {
    const value = now instanceof Function ? now() : now;
    const date = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function boundedMessageBody(value) {
    if (typeof value !== 'string') throw new DomainError(400, 'INVALID_MESSAGE_BODY', 'Message body must be text.');
    const body = value.trim();
    if (!body || body.length > MAX_MESSAGE_BODY) throw new DomainError(400, 'INVALID_MESSAGE_BODY', 'Message body is empty or too long.');
    for (const character of body) {
        const code = character.charCodeAt(0);
        if (code === 0 || (code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code)) || code === 0x7f) {
            throw new DomainError(400, 'INVALID_MESSAGE_BODY', 'Message body contains an unsupported control character.');
        }
    }
    return body;
}

function normalizeMentionUids(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_MENTIONS) throw new DomainError(400, 'INVALID_MENTIONS', 'Mentions are invalid.');
    const result = value.map((entry) => uid(entry, 'mention UID'));
    if (new Set(result).size !== result.length) throw new DomainError(400, 'INVALID_MENTIONS', 'Mentions must be unique.');
    return result;
}

function makeStableId(prefix, operationId, suffix = '') {
    return `${prefix}-${crypto.createHash('sha256').update(`${operationId}:${suffix}`).digest('hex').slice(0, 32)}`;
}

function pathFor(projectId, collection, recordId) {
    return `crmProjects/${projectId}/${collection}/${recordId}`;
}

function operationCursor(value) {
    if (!value) return null;
    try {
        const decoded = Buffer.from(String(value), 'base64url').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (!parsed || typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 128 || typeof parsed.createdAt !== 'string' || !parsed.createdAt || parsed.createdAt.length > 128 || Number.isNaN(Date.parse(parsed.createdAt))) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

function encodeOperationCursor(record) {
    return Buffer.from(JSON.stringify({ id: record.operationId, createdAt: record.createdAt || '' }), 'utf8').toString('base64url');
}

function recordCursor(value) {
    if (!value) return null;
    try {
        const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
        if (!parsed || typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 128 || typeof parsed.createdAt !== 'string' || !parsed.createdAt || parsed.createdAt.length > 128 || Number.isNaN(Date.parse(parsed.createdAt))) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

function encodeRecordCursor(record) {
    return Buffer.from(JSON.stringify({ id: String(record.id), createdAt: String(record.createdAt || '') }), 'utf8').toString('base64url');
}

async function readProjectRows(transaction, db, projectId, collectionName) {
    return snapshotRows(await transaction.get(projectCollection(db, projectId, collectionName)));
}

async function assertProjectTask(transaction, db, projectId, taskId, { allowInactive = false } = {}) {
    const normalizedProjectId = id(projectId, 'project ID');
    const normalizedTaskId = id(taskId, 'task ID');
    const taskRef = projectCollection(db, normalizedProjectId, 'tasks').doc(normalizedTaskId);
    const [snapshot, projectSnapshot] = await Promise.all([
        transaction.get(taskRef),
        transaction.get(projectRef(db, normalizedProjectId))
    ]);
    if (!snapshot?.exists) throw new DomainError(404, 'TASK_NOT_FOUND', 'Task not found.');
    const task = snapshot.data() || {};
    const tasks = new Map([[normalizedTaskId, { id: normalizedTaskId, data: task, ref: taskRef }]]);
    const seen = new Set([normalizedTaskId]);
    let current = tasks.get(normalizedTaskId);
    while (current?.data?.parentTaskId) {
        const parentId = id(current.data.parentTaskId, 'parent task ID');
        if (seen.has(parentId)) throw new DomainError(409, 'ANCESTRY_CYCLE', 'Task ancestry contains a cycle.');
        const parentRef = projectCollection(db, normalizedProjectId, 'tasks').doc(parentId);
        const parentSnapshot = await transaction.get(parentRef);
        if (!parentSnapshot?.exists) throw new DomainError(409, 'INVALID_PARENT_REFERENCE', 'Task parent must belong to the same project.');
        const parent = { id: parentId, data: parentSnapshot.data() || {}, ref: parentRef };
        tasks.set(parentId, parent);
        seen.add(parentId);
        current = parent;
    }
    const root = current || tasks.get(normalizedTaskId);
    const sectionId = root?.data?.sectionId || null;
    const sectionMap = new Map();
    if (!sectionId) throw new DomainError(409, 'INVALID_SECTION_REFERENCE', 'Root task must reference a section.');
    const sectionRef = projectCollection(db, normalizedProjectId, 'sections').doc(id(sectionId, 'section ID'));
    const sectionSnapshot = await transaction.get(sectionRef);
    if (!sectionSnapshot?.exists) throw new DomainError(409, 'INVALID_SECTION_REFERENCE', 'Root task section must belong to this project.');
    sectionMap.set(sectionId, { id: sectionId, data: sectionSnapshot.data() || {}, ref: sectionRef });
    const sections = sectionMap;
    let effectiveLifecycle = task.lifecycle || 'active';
    try {
        effectiveLifecycle = resolveTaskState({
            tasks,
            taskId: normalizedTaskId,
            projectLifecycle: projectSnapshot?.exists ? (projectSnapshot.data()?.lifecycle || 'active') : 'active',
            sections
        }).lifecycle;
    } catch (error) {
        if (error?.code) throw error;
        throw new DomainError(409, 'INVALID_TASK_HIERARCHY', 'Task hierarchy is invalid.');
    }
    if (!allowInactive && effectiveLifecycle !== 'active') throw new DomainError(409, 'TASK_LIFECYCLE_FORBIDDEN', 'Task or its ancestry is not active.');
    return { id: normalizedTaskId, data: task, ref: taskRef, effectiveLifecycle };
}

async function assertMemberMentions(transaction, db, accessService, projectId, mentionUids) {
    for (const mentionUid of mentionUids) {
        await accessService.assertTransactionEligible(transaction, mentionUid);
        const member = await transaction.get(db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(projectId, mentionUid)));
        const data = readData(member);
        if (!data || data.uid !== mentionUid || data.projectId !== projectId || data.active === false || !['Owner', 'Editor', 'Viewer'].includes(data.role)) {
            throw new DomainError(400, 'INVALID_MENTION_TARGET', 'Mention target must be an active project member.');
        }
    }
}

function safeDownloadName(value, fallback = 'attachment') {
    const input = String(value || fallback).replace(/[\\/\r\n\0]/g, '_').trim();
    const normalized = input.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 160).trim();
    return normalized || fallback;
}

function normalizeAttachmentType(value) {
    const type = String(value || '').split(';')[0].trim().toLowerCase();
    if (!ATTACHMENT_TYPES.has(type)) throw new DomainError(400, 'ATTACHMENT_TYPE_NOT_ALLOWED', 'Attachment type is not allowed.');
    return type;
}

function normalizeAttachmentFile(file) {
    if (!file || !Buffer.isBuffer(file.buffer)) throw new DomainError(400, 'ATTACHMENT_REQUIRED', 'Attachment bytes are required.');
    if (file.buffer.length < 1 || file.buffer.length > MAX_ATTACHMENT_BYTES) throw new DomainError(413, 'ATTACHMENT_TOO_LARGE', 'Attachment exceeds the 10 MB limit.');
    return {
        buffer: file.buffer,
        contentType: normalizeAttachmentType(file.mimetype),
        originalName: safeDownloadName(file.originalname, 'attachment')
    };
}

module.exports = {
    MAX_MESSAGE_BODY,
    MAX_MENTIONS,
    MAX_HISTORY_PAGE,
    MAX_BULK_TASKS,
    MAX_BULK_OPERATION_BYTES,
    MAX_ATTACHMENT_BYTES,
    ATTACHMENT_TYPES,
    nowIso,
    boundedMessageBody,
    normalizeMentionUids,
    makeStableId,
    pathFor,
    operationCursor,
    encodeOperationCursor,
    recordCursor,
    encodeRecordCursor,
    readProjectRows,
    assertProjectTask,
    assertMemberMentions,
    safeDownloadName,
    normalizeAttachmentType,
    normalizeAttachmentFile,
    projectRef
};
