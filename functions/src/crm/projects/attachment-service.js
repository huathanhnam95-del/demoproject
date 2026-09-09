'use strict';

const crypto = require('crypto');
const { DomainError, id } = require('./domain/validation');
const { projectCollection, readData } = require('./domain/storage');
const { assertProjectTask, makeStableId, normalizeAttachmentFile, nowIso, pathFor } = require('./phase4-utils');

const ATTACHMENT_COLLECTION = 'attachments';

function attachmentRef(db, projectId, attachmentId) {
    return projectCollection(db, projectId, ATTACHMENT_COLLECTION).doc(attachmentId);
}

function messageRef(db, projectId, messageId) {
    return projectCollection(db, projectId, 'discussions').doc(messageId);
}

function objectPath(projectId, taskId, attachmentId) {
    return `crm-projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}`;
}

function revisionOf(value) {
    return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
}

function sameReservation(left, right) {
    return Boolean(left
        && left.operationId === right.operationId
        && left.projectId === right.projectId
        && left.taskId === right.taskId
        && left.messageId === right.messageId
        && left.attachmentId === right.attachmentId
        && left.bytesSha256 === right.bytesSha256
        && left.originalName === right.originalName
        && left.contentType === right.contentType
        && Number(left.size) === Number(right.size)
        && left.objectPath === right.objectPath);
}

async function readObjectFingerprint(object) {
    const [metadata] = await object.getMetadata();
    const custom = metadata?.metadata || {};
    const size = Number(metadata?.size);
    const contentType = String(metadata?.contentType || '').split(';')[0].toLowerCase();
    if (custom.bytesSha256) return { bytesSha256: String(custom.bytesSha256), size, contentType };
    const [bytes] = await object.download();
    return { bytesSha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length, contentType };
}

function buildService({ db, accessService, commandService, getStorageBucket, now = () => new Date() } = {}) {
    if (!db || typeof db.runTransaction !== 'function') throw new Error('Projects attachment service requires Firestore db.');
    if (!accessService || typeof accessService.assertTransactionContentAccess !== 'function') throw new Error('Projects attachment service requires canonical access.');
    if (!commandService || typeof commandService.runCommand !== 'function') throw new Error('Projects attachment service requires canonical command executor.');
    if (typeof getStorageBucket !== 'function') throw new Error('Projects attachment service requires Storage bucket access.');

    async function reserveAttachment(identity, projectId, taskId, messageId, file, rawPayload = {}) {
        const normalizedProjectId = id(projectId, 'project ID');
        const normalizedTaskId = id(taskId, 'task ID');
        const normalizedMessageId = id(messageId, 'message ID');
        const operationId = id(rawPayload.operationId, 'operation ID');
        const normalizedFile = file?.contentType && file?.originalName
            ? file
            : normalizeAttachmentFile(file);
        const bytesSha256 = crypto.createHash('sha256').update(normalizedFile.buffer).digest('hex');
        const attachmentId = rawPayload.attachmentId ? id(rawPayload.attachmentId, 'attachment ID') : makeStableId('attachment', operationId, `${normalizedProjectId}:${normalizedTaskId}:${normalizedMessageId}`);
        const storagePath = objectPath(normalizedProjectId, normalizedTaskId, attachmentId);
        const suppliedRevision = rawPayload.expectedMessageRevision;
        if (suppliedRevision !== undefined && (typeof suppliedRevision !== 'number' || !Number.isSafeInteger(suppliedRevision) || suppliedRevision < 0)) throw new DomainError(400, 'INVALID_REVISION', 'expectedMessageRevision must be a non-negative integer.');
        const request = {
            projectId: normalizedProjectId,
            taskId: normalizedTaskId,
            messageId: normalizedMessageId,
            attachmentId,
            operationId,
            bytesSha256,
            objectPath: storagePath,
            originalName: normalizedFile.originalName,
            contentType: normalizedFile.contentType,
            size: normalizedFile.buffer.length,
            expectedMessageRevision: suppliedRevision === undefined ? null : suppliedRevision
        };
        return commandService.runCommand({
            actorUid: identity.uid,
            command: 'reserveDiscussionFile',
            projectId: normalizedProjectId,
            targetId: attachmentId,
            operationId,
            // The caller's optimistic revision is a first-attempt fence only.
            // The durable reservation binds the server-observed initial
            // revision, so a retry after the message advances has the same
            // operation digest and can resume the pending upload.
            payload: { taskId: normalizedTaskId, messageId: normalizedMessageId, attachmentId, contentType: normalizedFile.contentType, size: normalizedFile.buffer.length, originalName: normalizedFile.originalName, bytesSha256, expectedMessageRevision: request.expectedMessageRevision },
            access: { write: true, roles: ['Owner', 'Editor'] },
            execute: async ({ transaction }) => {
                await assertProjectTask(transaction, db, normalizedProjectId, normalizedTaskId);
                const message = readData(await transaction.get(messageRef(db, normalizedProjectId, normalizedMessageId)));
                if (!message || message.projectId !== normalizedProjectId || message.taskId !== normalizedTaskId) throw new DomainError(404, 'MESSAGE_NOT_FOUND', 'Discussion message not found.');
                if (message.authorUid !== identity.uid) throw new DomainError(403, 'MESSAGE_AUTHOR_REQUIRED', 'Only the original message author can attach a file.');
                if (message.moderationState && message.moderationState !== 'visible') throw new DomainError(409, 'MESSAGE_LIFECYCLE_FORBIDDEN', 'Moderated messages cannot receive new attachments.');
                if (request.expectedMessageRevision !== null && request.expectedMessageRevision !== revisionOf(message.revision)) throw new DomainError(409, 'STALE_REVISION', 'Message changed; refresh before attaching a file.');
                const existing = readData(await transaction.get(attachmentRef(db, normalizedProjectId, attachmentId)));
                if (existing && !sameReservation(existing, request)) throw new DomainError(409, 'ATTACHMENT_CONFLICT', 'Attachment identity is already bound to another upload.');
                if (existing) return { result: { attachment: { ...existing, id: attachmentId } }, after: { attachmentId, status: existing.status, revision: revisionOf(existing.revision) }, affectedIds: [normalizedProjectId, normalizedTaskId, normalizedMessageId, attachmentId], affectedPaths: [pathFor(normalizedProjectId, ATTACHMENT_COLLECTION, attachmentId)] };
                const timestamp = nowIso(now);
                const reservation = { ...request, status: 'pending', revision: 1, createdAt: timestamp, updatedAt: timestamp, updatedBy: identity.uid, actorUid: identity.uid, expectedMessageRevision: revisionOf(message.revision) };
                transaction.create(attachmentRef(db, normalizedProjectId, attachmentId), reservation);
                const attachmentPath = pathFor(normalizedProjectId, ATTACHMENT_COLLECTION, attachmentId);
                return { result: { attachment: { ...reservation, id: attachmentId } }, before: { attachmentId, status: null, revision: null }, after: { attachmentId, status: 'pending', revision: 1 }, affectedIds: [normalizedProjectId, normalizedTaskId, normalizedMessageId, attachmentId], affectedPaths: [attachmentPath], beforeRevisions: { [attachmentPath]: null }, afterRevisions: { [attachmentPath]: 1 } };
            }
        });
    }

    async function finalizeAttachment(identity, reservation, finalizeOperationId) {
        return commandService.runCommand({
            actorUid: identity.uid,
            command: 'finalizeDiscussionFile',
            projectId: reservation.projectId,
            targetId: reservation.attachmentId,
            operationId: finalizeOperationId,
            payload: { taskId: reservation.taskId, messageId: reservation.messageId, attachmentId: reservation.attachmentId, reservationOperationId: reservation.operationId, bytesSha256: reservation.bytesSha256, expectedMessageRevision: reservation.expectedMessageRevision, size: reservation.size, contentType: reservation.contentType, originalName: reservation.originalName },
            access: { write: true, roles: ['Owner', 'Editor'] },
            execute: async ({ transaction }) => {
                const messageDocument = messageRef(db, reservation.projectId, reservation.messageId);
                const message = readData(await transaction.get(messageDocument));
                if (!message || message.projectId !== reservation.projectId || message.taskId !== reservation.taskId) throw new DomainError(404, 'MESSAGE_NOT_FOUND', 'Discussion message not found.');
                if (message.authorUid !== identity.uid) throw new DomainError(403, 'MESSAGE_AUTHOR_REQUIRED', 'Only the original message author can attach a file.');
                if (message.moderationState && message.moderationState !== 'visible') throw new DomainError(409, 'MESSAGE_LIFECYCLE_FORBIDDEN', 'Moderated messages cannot receive new attachments.');
                const stored = readData(await transaction.get(attachmentRef(db, reservation.projectId, reservation.attachmentId)));
                if (!stored || !sameReservation(stored, reservation)) throw new DomainError(409, 'ATTACHMENT_RESERVATION_CONFLICT', 'Attachment reservation no longer matches this upload.');
                if (stored.status === 'ready') return { result: { attachment: { ...stored, id: reservation.attachmentId } }, after: { attachmentId: reservation.attachmentId, status: 'ready', revision: revisionOf(stored.revision) }, affectedIds: [reservation.projectId, reservation.taskId, reservation.messageId, reservation.attachmentId], affectedPaths: [pathFor(reservation.projectId, ATTACHMENT_COLLECTION, reservation.attachmentId), pathFor(reservation.projectId, 'discussions', reservation.messageId)] };
                await assertProjectTask(transaction, db, reservation.projectId, reservation.taskId);
                if (revisionOf(message.revision) !== revisionOf(reservation.expectedMessageRevision)) throw new DomainError(409, 'STALE_REVISION', 'Message changed while the upload was in progress.');
                const timestamp = nowIso(now);
                const ready = { ...stored, status: 'ready', revision: revisionOf(stored.revision) + 1, readyAt: timestamp, updatedAt: timestamp, updatedBy: identity.uid };
                const previousMessageRevision = revisionOf(message.revision);
                transaction.set(attachmentRef(db, reservation.projectId, reservation.attachmentId), ready);
                transaction.set(messageDocument, { attachmentIds: Array.from(new Set([...(message.attachmentIds || []), reservation.attachmentId])), revision: previousMessageRevision + 1, updatedAt: timestamp, updatedBy: identity.uid }, { merge: true });
                const attachmentPath = pathFor(reservation.projectId, ATTACHMENT_COLLECTION, reservation.attachmentId);
                const discussionPath = pathFor(reservation.projectId, 'discussions', reservation.messageId);
                return {
                    result: { attachment: { ...ready, id: reservation.attachmentId } },
                    before: { attachmentId: reservation.attachmentId, status: 'pending', revision: revisionOf(stored.revision), messageRevision: previousMessageRevision },
                    after: { attachmentId: reservation.attachmentId, status: 'ready', revision: revisionOf(ready.revision), messageRevision: previousMessageRevision + 1 },
                    inverse: { kind: 'attachment', targetId: reservation.attachmentId, expectedRevisionAfter: revisionOf(ready.revision), messageId: reservation.messageId, messageExpectedRevisionAfter: previousMessageRevision + 1 },
                    affectedIds: [reservation.projectId, reservation.taskId, reservation.messageId, reservation.attachmentId],
                    affectedPaths: [attachmentPath, discussionPath],
                    beforeRevisions: { [attachmentPath]: revisionOf(stored.revision), [discussionPath]: previousMessageRevision },
                    afterRevisions: { [attachmentPath]: revisionOf(ready.revision), [discussionPath]: previousMessageRevision + 1 }
                };
            }
        });
    }

    async function readObjectFingerprintOrThrow(object, reservation) {
        const fingerprint = await readObjectFingerprint(object);
        if (fingerprint.bytesSha256 !== reservation.bytesSha256 || fingerprint.size !== Number(reservation.size) || fingerprint.contentType !== reservation.contentType) throw new DomainError(409, 'ATTACHMENT_OBJECT_CONFLICT', 'Attachment object already exists with different bytes or metadata.');
    }

    async function verifyOrCreateObject(bucket, reservation, file) {
        const object = bucket.file(reservation.objectPath);
        const [exists] = await object.exists();
        if (exists) {
            await readObjectFingerprintOrThrow(object, reservation);
            return;
        }
        try {
            await object.save(file.buffer, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: reservation.contentType, metadata: { projectId: reservation.projectId, taskId: reservation.taskId, messageId: reservation.messageId, attachmentId: reservation.attachmentId, operationId: reservation.operationId, bytesSha256: reservation.bytesSha256 } } });
        } catch (error) {
            const [afterExists] = await object.exists();
            if (!afterExists) throw error;
            await readObjectFingerprintOrThrow(object, reservation);
        }
    }

    async function uploadAttachment(identity, projectId, taskId, messageId, file, rawPayload = {}) {
        const bucket = await getStorageBucket();
        if (!bucket || typeof bucket.file !== 'function') throw new DomainError(503, 'STORAGE_UNAVAILABLE', 'Private attachment storage is unavailable.');
        const normalizedFile = normalizeAttachmentFile(file);
        const reservationResult = await reserveAttachment(identity, projectId, taskId, messageId, normalizedFile, rawPayload);
        const reservation = reservationResult?.attachment;
        if (!reservation || reservation.status === 'ready') return reservationResult;
        await verifyOrCreateObject(bucket, reservation, normalizedFile);
        return finalizeAttachment(identity, reservation, makeStableId('attachment-finalize', reservation.operationId, reservation.attachmentId));
    }

    async function readAttachment(identity, projectId, attachmentId, constraints = {}) {
        const normalizedProjectId = id(projectId, 'project ID');
        const normalizedAttachmentId = id(attachmentId, 'attachment ID');
        let metadata;
        await db.runTransaction(async (transaction) => {
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, normalizedProjectId, { roles: ['Owner', 'Editor', 'Viewer'] });
            metadata = readData(await transaction.get(attachmentRef(db, normalizedProjectId, normalizedAttachmentId)));
            if (!metadata || metadata.status !== 'ready') throw new DomainError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found.');
            if (constraints.taskId && metadata.taskId !== id(constraints.taskId, 'task ID')) throw new DomainError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found.');
            if (constraints.messageId && metadata.messageId !== id(constraints.messageId, 'message ID')) throw new DomainError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found.');
            const message = readData(await transaction.get(messageRef(db, normalizedProjectId, metadata.messageId)));
            if (!message) throw new DomainError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found.');
            if (message.moderationState && message.moderationState !== 'visible' && access.role !== 'Owner' && message.authorUid !== identity.uid) throw new DomainError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found.');
        }, { readOnly: true });
        return { ...metadata, id: normalizedAttachmentId };
    }

    async function downloadAttachment(identity, projectId, attachmentId, constraints = {}) {
        const metadata = await readAttachment(identity, projectId, attachmentId, constraints);
        const bucket = await getStorageBucket();
        if (!bucket || typeof bucket.file !== 'function') throw new DomainError(503, 'STORAGE_UNAVAILABLE', 'Private attachment storage is unavailable.');
        const [bytes] = await bucket.file(metadata.objectPath).download();
        if (!Buffer.isBuffer(bytes)) throw new DomainError(503, 'ATTACHMENT_READ_FAILED', 'Attachment bytes could not be read.');
        return { metadata, bytes };
    }

    return { uploadAttachment, readAttachment, downloadAttachment, constants: { ATTACHMENT_COLLECTION } };
}

module.exports = { buildService, createProjectsAttachmentService: buildService, ATTACHMENT_COLLECTION, objectPath };
