'use strict';

const crypto = require('crypto');
const { DomainError, id } = require('./domain/validation');
const { projectCollection, operationRef, readData, snapshotRows } = require('./domain/storage');
const {
    boundedMessageBody,
    normalizeMentionUids,
    makeStableId,
    nowIso,
    assertProjectTask,
    assertMemberMentions,
    pathFor,
    recordCursor,
    encodeRecordCursor
} = require('./phase4-utils');

const DISCUSSION_COLLECTION = 'discussions';
const DISCUSSION_HISTORY_COLLECTION = 'discussionHistory';
const MAX_MESSAGES = 5000;

function messageRef(db, projectId, messageId) {
    return projectCollection(db, projectId, DISCUSSION_COLLECTION).doc(messageId);
}

function historyRef(db, projectId, historyId) {
    return projectCollection(db, projectId, DISCUSSION_HISTORY_COLLECTION).doc(historyId);
}

function buildService({ db, accessService, commandService, now = () => new Date() } = {}) {
    if (!db || typeof db.runTransaction !== 'function') throw new Error('Projects discussion service requires Firestore db.');
    if (!accessService || typeof accessService.assertTransactionContentAccess !== 'function') throw new Error('Projects discussion service requires the canonical access service.');
    if (!commandService || typeof commandService.runCommand !== 'function') throw new Error('Projects discussion service requires the canonical command executor.');

    async function assertMessageTarget(transaction, projectId, taskId, messageId = null, { allowInactive = false } = {}) {
        const task = await assertProjectTask(transaction, db, projectId, taskId, { allowInactive });
        if (!messageId) return { task, message: null };
        const normalizedMessageId = id(messageId, 'message ID');
        const snapshot = await transaction.get(messageRef(db, projectId, normalizedMessageId));
        const message = readData(snapshot);
        if (!message || message.projectId !== projectId || message.taskId !== task.id) throw new DomainError(404, 'MESSAGE_NOT_FOUND', 'Discussion message not found.');
        return { task, message: { id: normalizedMessageId, data: message, ref: messageRef(db, projectId, normalizedMessageId) } };
    }

    async function createMessage(identity, projectId, taskId, rawPayload = {}) {
        const normalizedProjectId = id(projectId, 'project ID');
        const normalizedTaskId = id(taskId, 'task ID');
        const operationId = id(rawPayload.operationId, 'operation ID');
        const body = boundedMessageBody(rawPayload.body ?? rawPayload.text ?? '');
        const mentions = normalizeMentionUids(rawPayload.mentions ?? rawPayload.mentionUids);
        const parentMessageId = rawPayload.parentMessageId ? id(rawPayload.parentMessageId, 'parent message ID') : null;
        const messageId = rawPayload.messageId ? id(rawPayload.messageId, 'message ID') : makeStableId('message', operationId, `${normalizedProjectId}:${normalizedTaskId}`);
        return commandService.runCommand({
            actorUid: identity.uid,
            command: parentMessageId ? 'replyToDiscussion' : 'createDiscussionMessage',
            projectId: normalizedProjectId,
            targetId: messageId,
            operationId,
            payload: { taskId: normalizedTaskId, body, mentions, parentMessageId, messageId },
            access: { write: true, roles: ['Owner', 'Editor'] },
            execute: async ({ transaction, contentAccess }) => {
                const target = await assertMessageTarget(transaction, normalizedProjectId, normalizedTaskId, parentMessageId);
                if (parentMessageId === messageId) throw new DomainError(409, 'INVALID_REPLY_TARGET', 'A message cannot reply to itself.');
                if (parentMessageId && target.message.data.projectId !== normalizedProjectId) throw new DomainError(400, 'INVALID_REPLY_TARGET', 'Reply target is outside this project.');
                await assertMemberMentions(transaction, db, accessService, normalizedProjectId, mentions);
                const existing = await transaction.get(messageRef(db, normalizedProjectId, messageId));
                if (existing?.exists) throw new DomainError(409, 'MESSAGE_EXISTS', 'Message already exists.');
                const timestamp = nowIso(now);
                const record = {
                    projectId: normalizedProjectId,
                    taskId: normalizedTaskId,
                    parentMessageId,
                    authorUid: identity.uid,
                    body,
                    mentions,
                    attachmentIds: [],
                    moderationState: 'visible',
                    revision: 1,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    updatedBy: identity.uid
                };
                transaction.set(messageRef(db, normalizedProjectId, messageId), record);
                return {
                    result: { message: { ...record, id: messageId } },
                    after: { messageId, revision: 1 },
                    inverse: { kind: 'discussionMessageCreate', targetId: messageId, expectedRevisionAfter: 1 },
                    affectedIds: [normalizedProjectId, normalizedTaskId, messageId],
                    affectedPaths: [pathFor(normalizedProjectId, DISCUSSION_COLLECTION, messageId)],
                    beforeRevisions: { [pathFor(normalizedProjectId, DISCUSSION_COLLECTION, messageId)]: null },
                    afterRevisions: { [pathFor(normalizedProjectId, DISCUSSION_COLLECTION, messageId)]: 1 },
                    origin: 'manual'
                };
            }
        });
    }

    async function editMessage(identity, projectId, messageId, rawPayload = {}, taskIdConstraint = null) {
        const normalizedProjectId = id(projectId, 'project ID');
        const normalizedMessageId = id(messageId, 'message ID');
        const operationId = id(rawPayload.operationId, 'operation ID');
        const expectedRevision = rawPayload.expectedRevision;
        if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new DomainError(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for message edits.');
        const body = rawPayload.body === undefined && rawPayload.text === undefined ? undefined : boundedMessageBody(rawPayload.body ?? rawPayload.text);
        const mentions = rawPayload.mentions === undefined && rawPayload.mentionUids === undefined ? undefined : normalizeMentionUids(rawPayload.mentions ?? rawPayload.mentionUids);
        if (body === undefined && mentions === undefined) throw new DomainError(400, 'INVALID_MESSAGE_PATCH', 'Message patch cannot be empty.');
        return commandService.runCommand({
            actorUid: identity.uid,
            command: 'editDiscussionMessage',
            projectId: normalizedProjectId,
            targetId: normalizedMessageId,
            operationId,
            payload: { expectedRevision, body, mentions },
            access: { write: true, roles: ['Owner', 'Editor'] },
            execute: async ({ transaction }) => {
                const snapshot = await transaction.get(messageRef(db, normalizedProjectId, normalizedMessageId));
                const current = readData(snapshot);
                if (!current) throw new DomainError(404, 'MESSAGE_NOT_FOUND', 'Discussion message not found.');
                if (taskIdConstraint && current.taskId !== id(taskIdConstraint, 'task ID')) throw new DomainError(404, 'MESSAGE_NOT_FOUND', 'Discussion message not found.');
                await assertProjectTask(transaction, db, normalizedProjectId, current.taskId);
                if (current.authorUid !== identity.uid) throw new DomainError(403, 'MESSAGE_AUTHOR_REQUIRED', 'Only the message author can edit this message.');
                if (Number(current.revision || 0) !== expectedRevision) throw new DomainError(409, 'STALE_REVISION', 'Message changed; refresh and retry.');
                if (current.moderationState === 'deleted') throw new DomainError(409, 'MESSAGE_LIFECYCLE_FORBIDDEN', 'Deleted messages cannot be edited.');
                if (mentions !== undefined) await assertMemberMentions(transaction, db, accessService, normalizedProjectId, mentions);
                const timestamp = nowIso(now);
                const next = { ...current, ...(body === undefined ? {} : { body }), ...(mentions === undefined ? {} : { mentions }), revision: expectedRevision + 1, updatedAt: timestamp, updatedBy: identity.uid };
                const historyId = `edit-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`.slice(0, 120);
                transaction.set(historyRef(db, normalizedProjectId, historyId), {
                    projectId: normalizedProjectId,
                    messageId: normalizedMessageId,
                    taskId: current.taskId,
                    kind: 'edit',
                    actorUid: identity.uid,
                    reason: null,
                    snapshot: current,
                    createdAt: timestamp
                });
                transaction.set(messageRef(db, normalizedProjectId, normalizedMessageId), next);
                const messagePath = pathFor(normalizedProjectId, DISCUSSION_COLLECTION, normalizedMessageId);
                return {
                    result: { message: { ...next, id: normalizedMessageId } },
                    before: { messageId: normalizedMessageId, revision: expectedRevision },
                    after: { messageId: normalizedMessageId, revision: next.revision },
                    inverse: { kind: 'discussionMessage', targetId: normalizedMessageId, expectedRevisionAfter: next.revision, previous: current },
                    affectedIds: [normalizedProjectId, current.taskId, normalizedMessageId],
                    affectedPaths: [messagePath, pathFor(normalizedProjectId, DISCUSSION_HISTORY_COLLECTION, historyId)],
                    beforeRevisions: { [messagePath]: expectedRevision },
                    afterRevisions: { [messagePath]: next.revision },
                    origin: 'manual'
                };
            }
        });
    }

    async function moderateMessage(identity, projectId, messageId, rawPayload = {}, taskIdConstraint = null) {
        const normalizedProjectId = id(projectId, 'project ID');
        const normalizedMessageId = id(messageId, 'message ID');
        const operationId = id(rawPayload.operationId, 'operation ID');
        const expectedRevision = rawPayload.expectedRevision;
        if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new DomainError(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required for moderation.');
        const action = String(rawPayload.action || '').trim().toLowerCase();
        if (!['hide', 'restore', 'delete'].includes(action)) throw new DomainError(400, 'INVALID_MODERATION_ACTION', 'Moderation action must be hide, restore, or delete.');
        if (rawPayload.reason === undefined || rawPayload.reason === null || rawPayload.reason === '') throw new DomainError(400, 'MODERATION_REASON_REQUIRED', 'A moderation reason is required.');
        const reason = boundedMessageBody(String(rawPayload.reason));
        return commandService.runCommand({
            actorUid: identity.uid,
            command: 'moderateDiscussionMessage',
            projectId: normalizedProjectId,
            targetId: normalizedMessageId,
            operationId,
            payload: { action, expectedRevision, reason },
            access: { owner: true, roles: ['Owner'] },
            execute: async ({ transaction }) => {
                const snapshot = await transaction.get(messageRef(db, normalizedProjectId, normalizedMessageId));
                const current = readData(snapshot);
                if (!current) throw new DomainError(404, 'MESSAGE_NOT_FOUND', 'Discussion message not found.');
                if (taskIdConstraint && current.taskId !== id(taskIdConstraint, 'task ID')) throw new DomainError(404, 'MESSAGE_NOT_FOUND', 'Discussion message not found.');
                await assertProjectTask(transaction, db, normalizedProjectId, current.taskId);
                if (Number(current.revision || 0) !== expectedRevision) throw new DomainError(409, 'STALE_REVISION', 'Message changed; refresh and retry.');
                const timestamp = nowIso(now);
                const state = action === 'restore' ? 'visible' : (action === 'delete' ? 'deleted' : 'hidden');
                const next = { ...current, moderationState: state, moderationReason: reason, moderatedBy: identity.uid, moderatedAt: timestamp, revision: expectedRevision + 1, updatedAt: timestamp, updatedBy: identity.uid };
                const historyId = `moderation-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`.slice(0, 120);
                transaction.set(historyRef(db, normalizedProjectId, historyId), {
                    projectId: normalizedProjectId,
                    messageId: normalizedMessageId,
                    taskId: current.taskId,
                    kind: 'moderation',
                    actorUid: identity.uid,
                    reason,
                    action,
                    snapshot: current,
                    createdAt: timestamp
                });
                transaction.set(messageRef(db, normalizedProjectId, normalizedMessageId), next);
                const messagePath = pathFor(normalizedProjectId, DISCUSSION_COLLECTION, normalizedMessageId);
                return {
                    result: { message: { ...next, id: normalizedMessageId } },
                    before: { messageId: normalizedMessageId, revision: expectedRevision },
                    after: { messageId: normalizedMessageId, revision: next.revision, moderationState: state },
                    inverse: { kind: 'discussionMessage', targetId: normalizedMessageId, expectedRevisionAfter: next.revision, previous: current },
                    affectedIds: [normalizedProjectId, current.taskId, normalizedMessageId],
                    affectedPaths: [messagePath, pathFor(normalizedProjectId, DISCUSSION_HISTORY_COLLECTION, historyId)],
                    beforeRevisions: { [messagePath]: expectedRevision },
                    afterRevisions: { [messagePath]: next.revision },
                    origin: 'manual'
                };
            }
        });
    }

    async function listMessages(identity, projectId, taskId, rawOptions = {}) {
        const normalizedProjectId = id(projectId, 'project ID');
        const normalizedTaskId = id(taskId, 'task ID');
        let output;
        await db.runTransaction(async (transaction) => {
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, normalizedProjectId, { roles: ['Owner', 'Editor', 'Viewer'] });
            await assertProjectTask(transaction, db, normalizedProjectId, normalizedTaskId, { allowInactive: true });
            const rawPageSize = rawOptions.pageSize === undefined ? 50 : Number(rawOptions.pageSize);
            if (!Number.isSafeInteger(rawPageSize) || rawPageSize < 1 || rawPageSize > 100) throw new DomainError(400, 'INVALID_DISCUSSION_PAGE_SIZE', 'Discussion page size must be from 1 to 100.');
            const order = rawOptions.order === undefined ? 'asc' : rawOptions.order;
            if (order !== 'asc' && order !== 'desc') throw new DomainError(400, 'INVALID_DISCUSSION_ORDER', 'Discussion order must be asc or desc.');
            const suppliedCursor = rawOptions.cursor ? String(rawOptions.cursor) : '';
            const cursor = suppliedCursor ? recordCursor(suppliedCursor) : null;
            if (suppliedCursor && (!cursor || (cursor.order === undefined ? 'asc' : cursor.order) !== order)) throw new DomainError(400, 'INVALID_DISCUSSION_CURSOR', 'Discussion cursor is invalid for this order.');
            let messageQuery = projectCollection(db, normalizedProjectId, DISCUSSION_COLLECTION)
                .where('taskId', '==', normalizedTaskId)
                .orderBy('createdAt', order)
                .orderBy('__name__', order);
            if (cursor) messageQuery = messageQuery.startAfter(cursor.createdAt, cursor.id);
            messageQuery = messageQuery
                .limit(rawPageSize + 1);
            const rows = snapshotRows(await transaction.get(messageQuery));
            // Firestore supplies timestamp/document-ID order, including its exact
            // ID comparison semantics. Do not re-sort with localeCompare here.
            const matching = rows;
            const page = matching.slice(0, rawPageSize);
            const hasMore = matching.length > page.length;
            output = page.map((row) => {
                const message = { ...row.data, id: row.id };
                const canInspectModerated = access.role === 'Owner' || message.authorUid === identity.uid;
                if (message.moderationState !== 'visible' && !canInspectModerated) {
                    message.body = null;
                    message.mentions = [];
                    message.attachmentIds = [];
                    message.redacted = true;
                }
                return message;
            });
            const last = output[output.length - 1];
            const nextCursor = hasMore && last ? (order === 'asc'
                ? encodeRecordCursor(last)
                : Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt, order }), 'utf8').toString('base64url')) : null;
            output = { messages: output, taskId: normalizedTaskId, count: output.length, hasMore, nextCursor };
        }, { readOnly: true });
        return output;
    }

    async function listMessageHistory(identity, projectId, messageId, rawOptions = {}, taskIdConstraint = null) {
        const normalizedProjectId = id(projectId, 'project ID');
        const normalizedMessageId = id(messageId, 'message ID');
        let result;
        await db.runTransaction(async (transaction) => {
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, normalizedProjectId, { roles: ['Owner', 'Editor', 'Viewer'] });
            const messageSnapshot = await transaction.get(messageRef(db, normalizedProjectId, normalizedMessageId));
            const message = readData(messageSnapshot);
            if (!message) throw new DomainError(404, 'MESSAGE_NOT_FOUND', 'Discussion message not found.');
            if (taskIdConstraint && message.taskId !== id(taskIdConstraint, 'task ID')) throw new DomainError(404, 'MESSAGE_NOT_FOUND', 'Discussion message not found.');
            const rawPageSize = rawOptions.pageSize === undefined ? 50 : Number(rawOptions.pageSize);
            if (!Number.isSafeInteger(rawPageSize) || rawPageSize < 1 || rawPageSize > 100) throw new DomainError(400, 'INVALID_HISTORY_PAGE_SIZE', 'Message history page size must be from 1 to 100.');
            const suppliedCursor = rawOptions.cursor ? String(rawOptions.cursor) : '';
            const cursor = suppliedCursor ? recordCursor(suppliedCursor) : null;
            if (suppliedCursor && !cursor) throw new DomainError(400, 'INVALID_HISTORY_CURSOR', 'Message history cursor is invalid.');
            let historyQuery = projectCollection(db, normalizedProjectId, DISCUSSION_HISTORY_COLLECTION)
                .where('messageId', '==', normalizedMessageId)
                .orderBy('createdAt')
                .orderBy('__name__');
            if (cursor) historyQuery = historyQuery.startAfter(cursor.createdAt, cursor.id);
            historyQuery = historyQuery.limit(rawPageSize + 1);
            const rows = snapshotRows(await transaction.get(historyQuery));
            const canInspectModerated = access.role === 'Owner' || message.authorUid === identity.uid;
            const publicMessage = { ...message, id: normalizedMessageId };
            if (message.moderationState !== 'visible' && !canInspectModerated) {
                publicMessage.body = null;
                publicMessage.mentions = [];
                publicMessage.attachmentIds = [];
                publicMessage.redacted = true;
            }
            const historyRows = rows.sort((left, right) => String(left.data.createdAt || '').localeCompare(String(right.data.createdAt || '')) || left.id.localeCompare(right.id));
            const history = historyRows.slice(0, rawPageSize);
            result = { message: publicMessage, history: history.map((row) => {
                const source = row.data || {};
                const item = {
                    id: row.id,
                    projectId: source.projectId,
                    messageId: source.messageId,
                    taskId: source.taskId,
                    kind: source.kind,
                    actorUid: source.actorUid,
                    action: source.action,
                    reason: source.reason || null,
                    createdAt: source.createdAt
                };
                if (canInspectModerated) {
                    const snapshot = source.snapshot || {};
                    item.revision = snapshot.revision ?? source.revision ?? null;
                    item.moderationState = snapshot.moderationState ?? null;
                    item.body = snapshot.body ?? null;
                    item.mentions = Array.isArray(snapshot.mentions) ? snapshot.mentions : [];
                    item.attachmentIds = Array.isArray(snapshot.attachmentIds) ? snapshot.attachmentIds : [];
                } else {
                    item.redacted = true;
                }
                return item;
            }), hasMore: historyRows.length > history.length, nextCursor: historyRows.length > history.length && history.length ? encodeRecordCursor({ id: history[history.length - 1].id, createdAt: history[history.length - 1].data.createdAt }) : null };
        }, { readOnly: true });
        return result;
    }

    return {
        createMessage,
        replyToMessage: createMessage,
        editMessage,
        moderateMessage,
        listMessages,
        listMessageHistory,
        constants: { DISCUSSION_COLLECTION, DISCUSSION_HISTORY_COLLECTION, MAX_MESSAGES }
    };
}

module.exports = { buildService, createProjectsDiscussionService: buildService, DISCUSSION_COLLECTION, DISCUSSION_HISTORY_COLLECTION };
