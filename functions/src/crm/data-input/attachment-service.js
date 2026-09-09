'use strict';
const { createHash } = require('node:crypto');
const { CRM_DATA_INPUT_DRAFTS } = require('../collections');
const { applyChanges, LIMITS } = require('./draft-service');
const { normalizeImage, IMAGE_LIMITS } = require('./image-validation');
const hash = value => createHash('sha256').update(value).digest('hex');
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
let activeDecodes = 0;
function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function publicAttachment(record, now) {
    const { attachmentId, status, width, height, mimeType, sha256, sourceSha256, sourceMimeType, bytesLength, expiresAtMs } = record;
    return { attachmentId, status: expiresAtMs <= now && !['deleted', 'deleting'].includes(status) ? 'expired' : status, width, height, mimeType, sha256, sourceSha256, sourceMimeType, bytesLength, expiresAtMs };
}
/** Storage is private injected infrastructure: immutable putIfAbsent, bounded
 * read, and idempotent exact-path delete. No user-supplied storage paths or URLs. */
function createAttachmentService({ db, authorize, storage, normalize = normalizeImage, now = Date.now }) {
    if (!db || typeof authorize !== 'function' || !storage || ['putIfAbsent', 'read', 'delete'].some(method => typeof storage[method] !== 'function')) throw TypeError('Attachment infrastructure is required.');
    async function owned(tx, input) {
        for (const key of ['actorUid', 'draftId']) if (typeof input[key] !== 'string' || !idPattern.test(input[key])) fail('INVALID_ID', 'Invalid attachment identity.');
        if (await authorize({ tx, actorUid: input.actorUid, feature: 'crm-data-input' }) !== true) fail('FORBIDDEN', 'CRM access is required.', 403);
        const draftRef = db.collection(CRM_DATA_INPUT_DRAFTS).doc(input.draftId), snap = await tx.get(draftRef), draft = snap.exists ? snap.data() : null;
        if (!draft || draft.actorUid !== input.actorUid) fail('DRAFT_NOT_FOUND', 'Conversation not found.', 404);
        return { draft, draftRef };
    }
    function attachmentRef(draftRef, input) {
        if (typeof input.attachmentId !== 'string' || !idPattern.test(input.attachmentId)) fail('INVALID_ID', 'Invalid attachment identity.');
        return draftRef.collection('attachments').doc(input.attachmentId);
    }
    function editable(draft) { if (now() >= draft.expiresAtMs || !['draft', 'review'].includes(draft.status)) fail('DRAFT_UNAVAILABLE', 'Draft is expired or unavailable.', 409); }
    function advance(draft, attachmentId) {
        return applyChanges(draft, { expectedRevision: draft.revision }, { kind: 'image', messageId: attachmentId, attachmentId }, now());
    }
    const reply = (record, draft) => ({ attachment: publicAttachment(record, now()), draft });
    return {
        async upload(input) {
            const preflight = await db.runTransaction(async tx => {
                const { draft, draftRef } = await owned(tx, input), ref = attachmentRef(draftRef, input), snap = await tx.get(ref);
                editable(draft);
                if (!Buffer.isBuffer(input.bytes) || !input.bytes.length || input.bytes.length > IMAGE_LIMITS.inputBytes || typeof input.mimeType !== 'string') fail('IMAGE_SIZE', 'Choose an image of at most 4 MiB.');
                const fingerprint = hash(JSON.stringify([hash(input.bytes), input.mimeType]));
                if (snap.exists) {
                    const record = snap.data();
                    if (record.fingerprint !== fingerprint) fail('ATTACHMENT_CONFLICT', 'Attachment identity was already used.', 409);
                    if (!['uploading', 'ready'].includes(record.status)) fail('ATTACHMENT_UNAVAILABLE', 'Attachment is no longer available.', 409);
                    if (record.status === 'ready') return { replay: reply(record, draft) };
                } else {
                    if (draft.revision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Draft revision changed.', 409);
                    if ((draft.attachmentIds || []).length >= 5) fail('ATTACHMENT_LIMIT', 'Use at most five attachments per conversation.');
                }
                return { fingerprint };
            });
            if (preflight.replay) return preflight.replay;
            if (activeDecodes >= 2) fail('IMAGE_BUSY', 'Image processing is busy. Try again shortly.', 429);
            let image;
            activeDecodes++;
            try { image = await normalize({ bytes: input.bytes, mimeType: input.mimeType }); } finally { activeDecodes--; }
            const claim = await db.runTransaction(async tx => {
                const { draft, draftRef } = await owned(tx, input), ref = attachmentRef(draftRef, input), snap = await tx.get(ref);
                editable(draft);
                if (snap.exists) {
                    const record = snap.data();
                    if (record.fingerprint !== preflight.fingerprint) fail('ATTACHMENT_CONFLICT', 'Attachment identity was already used.', 409);
                    if (!['uploading', 'ready'].includes(record.status)) fail('ATTACHMENT_UNAVAILABLE', 'Attachment is no longer available.', 409);
                    return { record, ref, replay: record.status === 'ready' ? reply(record, draft) : null };
                }
                if (draft.revision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Draft revision changed.', 409);
                if ((draft.attachmentIds || []).length >= 5) fail('ATTACHMENT_LIMIT', 'Use at most five attachments per conversation.');
                const record = { attachmentId: input.attachmentId, actorUid: input.actorUid, fingerprint: preflight.fingerprint, status: 'uploading',
                    objectPath: `crm-data-input/${hash(input.actorUid)}/${hash(input.draftId)}/${hash(input.attachmentId)}.png`,
                    width: image.width, height: image.height, mimeType: image.mimeType, sha256: image.sha256, sourceSha256: image.sourceSha256,
                    sourceMimeType: image.sourceMimeType, bytesLength: image.bytes.length, expiresAtMs: draft.expiresAtMs, createdAtMs: now() };
                const next = advance(draft, input.attachmentId); next.attachmentIds = [...(draft.attachmentIds || []), input.attachmentId];
                if (Buffer.byteLength(JSON.stringify(next)) > LIMITS.bytes) fail('DRAFT_LIMIT', 'Draft byte limit exceeded.');
                tx.set(ref, record); tx.set(draftRef, next);
                return { ref, record };
            });
            if (claim.replay) return claim.replay;
            if (claim.record.sha256 !== image.sha256) fail('ATTACHMENT_CONFLICT', 'Image decoding changed. Use a new attachment identity.', 409);
            try { await storage.putIfAbsent(claim.record.objectPath, image.bytes, { sha256: claim.record.sha256, expiresAtMs: claim.record.expiresAtMs }); }
            catch { fail('ATTACHMENT_UNCERTAIN', 'Upload response was interrupted. Retry the same attachment.', 503); }
            const result = await db.runTransaction(async tx => {
                const { draft, draftRef } = await owned(tx, input), snap = await tx.get(claim.ref), record = snap.exists ? snap.data() : null;
                if (!record || !['uploading', 'ready'].includes(record.status)) return null;
                editable(draft);
                if (record.status === 'ready') return reply(record, draft);
                const next = advance(draft, input.attachmentId), ready = { ...record, status: 'ready', readyAtMs: now() };
                tx.set(claim.ref, ready); tx.set(draftRef, next); return reply(ready, next);
            });
            if (!result) { await storage.delete(claim.record.objectPath); fail('ATTACHMENT_UNAVAILABLE', 'Attachment was removed during upload.', 409); }
            return result;
        },
        async list(input) {
            return db.runTransaction(async tx => {
                const { draft, draftRef } = await owned(tx, input), attachments = [];
                for (const attachmentId of draft.attachmentIds || []) { const snap = await tx.get(attachmentRef(draftRef, { attachmentId })); if (snap.exists) attachments.push(publicAttachment(snap.data(), now())); }
                return { revision: draft.revision, attachments };
            });
        },
        async read(input) {
            async function current() { return db.runTransaction(async tx => { const { draftRef } = await owned(tx, input), snap = await tx.get(attachmentRef(draftRef, input)); const record = snap.exists ? snap.data() : null; if (!record || record.status !== 'ready' || now() >= record.expiresAtMs) fail('ATTACHMENT_UNAVAILABLE', 'Attachment is unavailable.', 404); return record; }); }
            const record = await current(), bytes = await storage.read(record.objectPath, IMAGE_LIMITS.outputBytes);
            if (!Buffer.isBuffer(bytes) || bytes.length !== record.bytesLength || bytes.length > IMAGE_LIMITS.outputBytes || hash(bytes) !== record.sha256) fail('ATTACHMENT_INTEGRITY', 'Attachment data does not match its receipt.', 409);
            await current(); return { attachment: publicAttachment(record, now()), bytes };
        },
        async remove(input) {
            const record = await db.runTransaction(async tx => {
                const { draft, draftRef } = await owned(tx, input), ref = attachmentRef(draftRef, input), snap = await tx.get(ref);
                if (!snap.exists) fail('ATTACHMENT_UNAVAILABLE', 'Attachment is unavailable.', 404);
                const existing = snap.data(); if (existing.status === 'deleted') return existing;
                const deleting = { ...existing, status: 'deleting' };
                if (existing.status !== 'deleting' && now() < draft.expiresAtMs && ['draft', 'review'].includes(draft.status)) tx.set(draftRef, advance(draft, input.attachmentId));
                tx.set(ref, deleting); return deleting;
            });
            if (record.status === 'deleted') return { attachment: publicAttachment(record, now()) };
            await storage.delete(record.objectPath);
            return db.runTransaction(async tx => { const { draftRef } = await owned(tx, input); const deleted = { ...record, status: 'deleted', deletedAtMs: now() }; tx.set(attachmentRef(draftRef, input), deleted); return { attachment: publicAttachment(deleted, now()) }; });
        }
    };
}
module.exports = { createAttachmentService };
