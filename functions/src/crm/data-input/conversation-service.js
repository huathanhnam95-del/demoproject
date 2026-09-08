'use strict';
const { createHash } = require('crypto');
const { CRM_DATA_INPUT_DRAFTS } = require('../collections');
const { createDraft, applyChanges } = require('./draft-service');
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_MESSAGES = 100;

function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function identity(value) { if (typeof value !== 'string' || !idPattern.test(value)) fail('INVALID_ID', 'Invalid conversation identity.'); }
function stable(value, depth = 0) {
    if (depth > 12) fail('MESSAGE_LIMIT', 'Message nesting limit exceeded.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (Array.isArray(value)) return value.map(item => stable(item, depth + 1));
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_MESSAGE', 'Message must contain plain JSON.');
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key], depth + 1)]));
}
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

/** All access checks receive the same transaction as draft reads/writes. */
function createConversationService({ db, authorize, now = Date.now }) {
    if (!db || typeof authorize !== 'function' || typeof now !== 'function') throw new TypeError('Conversation requires explicit database, authorization and clock adapters.');
    const collection = db.collection(CRM_DATA_INPUT_DRAFTS);
    async function admitted(tx, actorUid) {
        identity(actorUid);
        if (await authorize({ tx, actorUid, feature: 'crm-data-input' }) !== true) fail('FORBIDDEN', 'CRM data input access is required.', 403);
    }
    async function owned(tx, actorUid, draftId) {
        identity(draftId);
        const ref = collection.doc(draftId), snap = await tx.get(ref);
        const draft = snap.exists ? snap.data() : null;
        if (!draft || draft.actorUid !== actorUid) fail('DRAFT_NOT_FOUND', 'Conversation not found.', 404);
        return { ref, draft };
    }
    return {
        async create({ actorUid, requestId }) {
            identity(actorUid); identity(requestId);
            const draftId = `draft-${hash([actorUid, requestId])}`, ref = collection.doc(draftId);
            return db.runTransaction(async tx => {
                await admitted(tx, actorUid);
                const existing = await tx.get(ref);
                if (existing.exists) {
                    const saved = existing.data();
                    if (saved.actorUid !== actorUid) fail('DRAFT_NOT_FOUND', 'Conversation not found.', 404);
                    return saved;
                }
                const draft = { ...createDraft({ actorUid, draftId, now: now() }), messageIds: [] };
                tx.set(ref, draft);
                return draft;
            });
        },
        async load({ actorUid, draftId }) {
            return db.runTransaction(async tx => {
                await admitted(tx, actorUid);
                const { ref, draft } = await owned(tx, actorUid, draftId);
                const messages = [];
                for (const messageId of draft.messageIds) {
                    const snap = await tx.get(ref.collection('messages').doc(messageId));
                    if (!snap.exists) fail('CONVERSATION_INCOMPLETE', 'Conversation history is incomplete.', 409);
                    const saved = snap.data();
                    messages.push({ messageId, source: saved.source, text: saved.text, revision: saved.appliedRevision, createdAtMs: saved.createdAtMs });
                }
                return { draft, messages, expired: now() >= draft.expiresAtMs };
            });
        },
        async apply({ actorUid, draftId, changes, source, text }) {
            if (typeof text !== 'string' || text.length > 16000) fail('MESSAGE_LIMIT', 'Message must contain at most 16000 characters.');
            identity(source?.messageId);
            const content = { changes, source, text };
            if (Buffer.byteLength(JSON.stringify(content)) > 65536) fail('MESSAGE_LIMIT', 'Message byte limit exceeded.');
            const fingerprint = hash(content);
            return db.runTransaction(async tx => {
                await admitted(tx, actorUid);
                const { ref, draft } = await owned(tx, actorUid, draftId);
                const messageRef = ref.collection('messages').doc(source.messageId), previous = await tx.get(messageRef);
                if (previous.exists) {
                    const receipt = previous.data();
                    if (receipt.fingerprint !== fingerprint) fail('MESSAGE_CONFLICT', 'Message identity was already used for different content.', 409);
                    return { draft, replayed: true, appliedRevision: receipt.appliedRevision };
                }
                if (draft.messageIds.length >= MAX_MESSAGES) fail('MESSAGE_LIMIT', 'Conversation message limit reached.');
                const timestamp = now();
                const next = applyChanges(draft, changes, source, timestamp);
                next.messageIds.push(source.messageId);
                tx.set(ref, next);
                tx.set(messageRef, { fingerprint, source, text, appliedRevision: next.revision, createdAtMs: timestamp });
                return { draft: next, replayed: false, appliedRevision: next.revision };
            });
        },
        async discard({ actorUid, draftId, expectedRevision }) {
            return db.runTransaction(async tx => {
                await admitted(tx, actorUid);
                const { ref, draft } = await owned(tx, actorUid, draftId);
                if (draft.status === 'cancelled') return draft;
                if (draft.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Draft revision changed.', 409);
                if (!['draft', 'review'].includes(draft.status)) fail('DRAFT_TERMINAL', 'This conversation cannot be discarded.');
                const next = { ...draft, status: 'cancelled', revision: draft.revision + 1, preview: null, confirmation: null, updatedAtMs: now() };
                tx.set(ref, next);
                return next;
            });
        }
    };
}

module.exports = { createConversationService };
