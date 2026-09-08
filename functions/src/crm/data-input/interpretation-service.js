'use strict';
const { createHash } = require('node:crypto');
const { CRM_DATA_INPUT_DRAFTS } = require('../collections');
const { buildProposalRequest, parseProposal } = require('./proposal-service');
const { applyChanges, LIMITS } = require('./draft-service');
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function id(value) { if (typeof value !== 'string' || !idPattern.test(value)) fail('INVALID_ID', 'Invalid interpretation identity.'); }
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function publicResult(record) {
    return { operationId: record.operationId, messageId: record.messageId, text: record.text, baseRevision: record.baseRevision, status: record.status,
        ...(record.appliedRevision !== undefined ? { appliedRevision: record.appliedRevision } : {}),
        ...(record.proposal ? { proposal: record.proposal } : {}), ...(record.errorCode ? { errorCode: record.errorCode } : {}) };
}
/** The injected provider owns shared admission, reservation, dispatch and usage
 * settlement. This service contains no native transport or budget implementation.
 * A durable running/unknown record is never automatically redispatched. Recovery
 * of uncertain provider work requires its trusted shared-provider receipt. */
function createInterpretationService({ db, authorize, provider = null, context = null, attachments = null, now = Date.now }) {
    if (!db || typeof authorize !== 'function' || typeof now !== 'function') throw TypeError('Interpretation requires database, authorization and clock adapters.');
    async function owned(tx, actorUid, draftId) {
        id(actorUid); id(draftId);
        if (await authorize({ tx, actorUid, feature: 'crm-data-input' }) !== true) fail('FORBIDDEN', 'CRM data input access is required.', 403);
        const draftRef = db.collection(CRM_DATA_INPUT_DRAFTS).doc(draftId), snap = await tx.get(draftRef);
        const draft = snap.exists ? snap.data() : null;
        if (!draft || draft.actorUid !== actorUid) fail('DRAFT_NOT_FOUND', 'Conversation not found.', 404);
        return { draft, draftRef };
    }
    function available(draft, expectedRevision) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_REQUEST', 'Provide the current draft revision.');
        if (draft.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Draft revision changed.', 409);
        if (!['draft', 'review'].includes(draft.status) || now() >= draft.expiresAtMs) fail('DRAFT_UNAVAILABLE', 'Draft is expired or unavailable.', 409);
    }
    function validateSelections(selections, count = 5) {
        if (!Array.isArray(selections) || selections.length > 5) fail('INVALID_SELECTION', 'Choose bounded lookup results.');
        const seen = new Set();
        for (const selection of selections) {
            if (!selection || typeof selection !== 'object' || Array.isArray(selection)
                || Object.keys(selection).some(key => !['lookupIndex', 'id', 'match'].includes(key))
                || !Number.isInteger(selection.lookupIndex) || selection.lookupIndex < 0 || selection.lookupIndex >= count
                || seen.has(selection.lookupIndex) || (!selection.id && !selection.match)
                || (selection.id !== undefined && (typeof selection.id !== 'string' || !idPattern.test(selection.id)))) fail('INVALID_SELECTION', 'Choose one current result for each lookup.');
            seen.add(selection.lookupIndex);
        }
    }
    async function resolvePending(draft, actorUid, selections = []) {
        const pending = draft.pendingLookups || [];
        if (!Array.isArray(pending) || pending.length > 5) fail('INVALID_LOOKUP', 'Invalid pending context.');
        validateSelections(selections, pending.length);
        if (pending.length && typeof context?.resolve !== 'function') fail('CONTEXT_UNAVAILABLE', 'Record lookup is unavailable.', 503);
        const queries = [];
        for (const [lookupIndex, lookup] of pending.entries()) {
            const selection = selections.find(item => item.lookupIndex === lookupIndex);
            const match = selection?.match || { field: lookup.field, value: lookup.value };
            const result = await context.resolve({ actorUid, kind: lookup.kind, match });
            const candidates = result.status === 'resolved' ? [result.record] : result.candidates || [];
            if (selection?.id) {
                const record = candidates.find(candidate => candidate.id === selection.id && candidate.kind === lookup.kind);
                if (!record) fail('LOOKUP_SELECTION_REQUIRED', 'The selected record no longer matches. Refresh the lookup.', 422);
                queries.push({ lookupIndex, lookup, result: { status: 'resolved', record } });
            } else queries.push({ lookupIndex, lookup, result });
        }
        return queries;
    }
    return {
        async lookups({ actorUid, draftId, expectedRevision, selections = [] }) {
            const draft = await db.runTransaction(async tx => { const ownedDraft = await owned(tx, actorUid, draftId); available(ownedDraft.draft, expectedRevision); return ownedDraft.draft; });
            const queries = await resolvePending(draft, actorUid, selections);
            await db.runTransaction(async tx => { available((await owned(tx, actorUid, draftId)).draft, expectedRevision); });
            return { revision: expectedRevision, queries };
        },
        async apply({ actorUid, draftId, messageId }) {
            id(messageId);
            return db.runTransaction(async tx => {
                const { draft, draftRef } = await owned(tx, actorUid, draftId);
                const ref = draftRef.collection('interpretations').doc(messageId), snap = await tx.get(ref);
                if (!snap.exists) fail('INTERPRETATION_NOT_FOUND', 'Interpretation not found.', 404);
                const record = snap.data();
                if (record.status === 'applied') return { ...publicResult(record), draft };
                if (record.status !== 'done' || !record.proposal || draft.revision !== record.baseRevision) fail('STALE_PROPOSAL', 'Interpret the current draft again before applying this proposal.', 409);
                const messageRef = draftRef.collection('messages').doc(messageId), message = await tx.get(messageRef);
                if (message.exists || draft.messageIds?.includes(messageId)) fail('MESSAGE_CONFLICT', 'Message identity was already used.', 409);
                if ((draft.messageIds || []).length >= 100) fail('MESSAGE_LIMIT', 'Conversation message limit reached.');
                const timestamp = now(), source = record.source || { kind: 'text', messageId };
                const next = applyChanges(draft, record.proposal.changes, source, timestamp);
                next.interpretationQuestions = record.proposal.questions;
                next.pendingLookups = record.proposal.lookups;
                next.pendingLookupMessages = record.proposal.lookups.length ? [...(draft.pendingLookupMessages || []), record.text] : [];
                next.messageIds = [...(draft.messageIds || []), messageId];
                if (Buffer.byteLength(JSON.stringify(next)) > LIMITS.bytes) fail('DRAFT_LIMIT', 'Draft byte limit exceeded.');
                const applied = { ...record, status: 'applied', appliedRevision: next.revision, appliedAtMs: timestamp };
                tx.set(draftRef, next);
                tx.set(messageRef, { fingerprint: `interpretation:${record.fingerprint}`, source, text: record.text, appliedRevision: next.revision, createdAtMs: timestamp });
                tx.set(ref, applied);
                return { ...publicResult(applied), draft: next };
            });
        },
        async get({ actorUid, draftId, messageId }) {
            id(messageId);
            return db.runTransaction(async tx => {
                const { draftRef } = await owned(tx, actorUid, draftId);
                const snap = await tx.get(draftRef.collection('interpretations').doc(messageId));
                if (!snap.exists) fail('INTERPRETATION_NOT_FOUND', 'Interpretation not found.', 404);
                return publicResult(snap.data());
            });
        },
        async start({ actorUid, draftId, messageId, expectedRevision, text, selections = [], attachmentId }) {
            id(actorUid); id(draftId); id(messageId);
            if (attachmentId !== undefined) id(attachmentId);
            if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof text !== 'string' || !text.trim() || text.length > 16000) fail('INVALID_REQUEST', 'Provide bounded text and the current draft revision.');
            validateSelections(selections);
            const sortedSelections = [...selections].sort((left, right) => left.lookupIndex - right.lookupIndex);
            const fingerprint = digest([actorUid, draftId, messageId, expectedRevision, text, ...(sortedSelections.length ? [sortedSelections] : []), ...(attachmentId ? [{ attachmentId }] : [])]);
            const source = attachmentId ? { kind: 'image', messageId, attachmentId } : { kind: 'text', messageId };
            // Authenticate and inspect replay before doing context reads. Lookup data
            // comes exclusively from the server resolver, never the request body.
            const preflight = await db.runTransaction(async tx => {
                const { draft, draftRef } = await owned(tx, actorUid, draftId);
                const previous = await tx.get(draftRef.collection('interpretations').doc(messageId));
                if (previous.exists) {
                    if (previous.data().fingerprint !== fingerprint) fail('MESSAGE_CONFLICT', 'Message identity was already used for different content.', 409);
                    return { replay: publicResult(previous.data()) };
                }
                available(draft, expectedRevision);
                return { draft };
            });
            if (preflight.replay) return preflight.replay;
            let image;
            if (attachmentId) {
                if (provider?.supportsImages !== true || typeof attachments?.read !== 'function') fail('INTERPRETATION_UNAVAILABLE', 'Image interpretation is not available.', 503);
                if (!preflight.draft.attachmentIds?.includes(attachmentId)) fail('ATTACHMENT_UNAVAILABLE', 'Attachment is unavailable.', 404);
                image = await attachments.read({ actorUid, draftId, attachmentId });
            }
            const queries = await resolvePending(preflight.draft, actorUid, sortedSelections);
            if (queries.some(query => query.result.status !== 'resolved')) fail('LOOKUP_SELECTION_REQUIRED', 'Resolve each requested record before continuing this instruction.', 422);
            const claim = await db.runTransaction(async tx => {
                const { draft, draftRef } = await owned(tx, actorUid, draftId);
                const ref = draftRef.collection('interpretations').doc(messageId), previous = await tx.get(ref);
                if (previous.exists) {
                    const record = previous.data();
                    if (record.fingerprint !== fingerprint) fail('MESSAGE_CONFLICT', 'Message identity was already used for different content.', 409);
                    return { replay: publicResult(record) };
                }
                if (!provider || typeof provider.generate !== 'function') fail('INTERPRETATION_UNAVAILABLE', 'AI interpretation is not available.', 503);
                available(draft, expectedRevision);
                if (draft.messageIds?.includes(messageId)) fail('MESSAGE_CONFLICT', 'Message identity was already used for a draft edit.', 409);
                const proposalContext = { draft, actorUid, source, nowMs: now(), resolutions: queries.map(query => query.result) };
                const request = buildProposalRequest({ ...proposalContext, text, ...(image ? { image } : {}) });
                const record = { operationId: `interpret-${digest([actorUid, draftId, messageId])}`, actorUid, messageId, text, fingerprint,
                    source, baseRevision: draft.revision, status: 'running', requestDigest: request.requestDigest, createdAtMs: proposalContext.nowMs, expiresAtMs: draft.expiresAtMs };
                tx.set(ref, record);
                return { ref, record, request, context: proposalContext };
            });
            if (claim.replay) return claim.replay;
            async function finish(status, proposal = null, errorCode = null) {
                return db.runTransaction(async tx => {
                    const { draft } = await owned(tx, actorUid, draftId);
                    const snap = await tx.get(claim.ref), current = snap.exists ? snap.data() : null;
                    if (!current || current.fingerprint !== fingerprint) fail('INTERPRETATION_CONFLICT', 'Interpretation state changed.', 409);
                    if (current.status !== 'running') return publicResult(current);
                    const stale = status === 'done' && (draft.revision !== expectedRevision || !['draft', 'review'].includes(draft.status) || now() >= draft.expiresAtMs);
                    const next = { ...current, status: stale ? 'stale' : status, completedAtMs: now() };
                    if (proposal) next.proposal = { ...proposal, readyForReview: !stale && proposal.readyForReview };
                    if (errorCode) next.errorCode = errorCode;
                    tx.set(claim.ref, next);
                    return publicResult(next);
                });
            }
            let raw;
            try {
                // Outside the database transaction. The provider must recheck
                // current authority immediately before its actual dispatch.
                raw = await provider.generate({ actorUid, feature: 'crm-data-input', purpose: 'draft', operationId: claim.record.operationId, request: claim.request });
            } catch { return finish('unknown', null, 'INTERPRETATION_UNCERTAIN'); }
            let parsed;
            try { parsed = parseProposal(raw, claim.context); }
            catch { return finish('rejected', null, 'INVALID_PROPOSAL'); }
            const { changes, inspection, questions, lookups, readyForReview } = parsed;
            return finish('done', { changes, inspection, questions, lookups, readyForReview });
        }
    };
}
module.exports = { createInterpretationService };
