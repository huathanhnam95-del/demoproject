'use strict';
const { createHash, randomBytes, timingSafeEqual } = require('crypto');
const C = require('../collections');
const { digestDraft } = require('./draft-service');
const { prepareCommands } = require('./command-service');
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const reviewTypes = { [C.CRM_LEADS]: 'lead', [C.CRM_STUDENTS]: 'student', [C.ENTRANCE_TESTS]: 'entranceTest', [C.CRM_ENROLLMENTS]: 'enrollment', [C.CRM_CLASSROOMS]: 'classroom', [C.CRM_SCHEDULED_SESSIONS]: 'lesson', [C.CRM_INVOICES]: 'invoice', [C.CRM_PAYMENTS]: 'payment', [C.CRM_COMMISSIONS]: 'commission' };
function fail(code, message, status = 409) { throw Object.assign(new Error(message), { code, status }); }
function id(value) { if (typeof value !== 'string' || !idPattern.test(value)) fail('INVALID_ID', 'Invalid request identity.', 400); }
function json(value) {
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(json);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, json(value[key])]));
    if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return value;
    fail('INVALID_PLAN', 'Plan contains an unsupported value.');
}
const digest = value => createHash('sha256').update(JSON.stringify(json(value))).digest('hex');
const tokenHash = token => createHash('sha256').update(String(token)).digest('hex');
function checkToken(token, expected) {
    if (typeof token !== 'string' || token.length > 128 || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)
        || !timingSafeEqual(Buffer.from(tokenHash(token), 'hex'), Buffer.from(expected, 'hex'))) fail('INVALID_CONFIRMATION', 'Confirmation does not match this review.', 403);
}
function publicPreview(preview) { return { previewId: preview.previewId, confirmationToken: preview.confirmationToken, expiresAtMs: preview.expiresAtMs, review: preview.review }; }
function publicReceipt(receipt) { return { operationId: receipt.operationId, draftId: receipt.draftId, revision: receipt.revision, status: 'committed', results: receipt.results, committedAtMs: receipt.committedAtMs }; }
function imagePaymentActions(draft) {
    const actions = new Map(draft.actions.map(action => [action.actionId, action]));
    function derived(action, seen = new Set()) {
        if (!action || seen.has(action.actionId)) return false;
        seen.add(action.actionId);
        if (action.imageSources?.length || Object.values(action.provenance || {}).some(source => source.kind === 'image')) return true;
        function linked(value) {
            if (!value || typeof value !== 'object') return false;
            if (typeof value.$ref === 'string' && derived(actions.get(value.$ref.split('.')[0]), seen)) return true;
            return Object.values(value).some(linked);
        }
        return linked(action.values);
    }
    return draft.actions.filter(action => action.kind === 'recordPayment' && derived(action)).map(action => action.actionId).sort();
}
function buildReview(draft, plan) {
    const hidden = new Set(['createdAt', 'updatedAt', 'createdBy', 'createdByEmail', 'updatedBy', 'deliveryToken']);
    const visible = data => data ? Object.fromEntries(Object.entries(json(data)).filter(([key]) => !hidden.has(key))) : null;
    const effects = plan.writes.filter(write => write.path.split('/').length === 2 && reviewTypes[write.path.split('/')[0]])
        .map(write => {
            const before = visible(write.before), values = visible(write.data);
            const changes = [...new Set([...Object.keys(before || {}), ...Object.keys(values || {})])].sort()
                .filter(field => JSON.stringify(before?.[field]) !== JSON.stringify(values?.[field]))
                .map(field => ({ field, beforePresent: Object.hasOwn(before || {}, field), before: before?.[field] ?? null,
                    afterPresent: Object.hasOwn(values || {}, field), after: values?.[field] ?? null }));
            return { entityType: reviewTypes[write.path.split('/')[0]], recordId: write.path.split('/')[1], operation: write.kind,
                created: write.before === null, values, changes };
        });
    const review = { revision: draft.revision, actions: draft.actions.map(action => ({ actionId: action.actionId, kind: action.kind,
        sources: Object.entries(action.provenance || {}).map(([field, source]) => ({ field, kind: source.kind })),
        imageInvolved: !!action.imageSources?.length || Object.values(action.provenance || {}).some(source => source.kind === 'image') })), effects,
        paymentAssertions: imagePaymentActions(draft).map(actionId => ({ actionId, meaning: 'received-payment-v1',
            statement: 'I confirm this records a payment received, not merely a transfer request or screenshot. The image is not independent bank verification.' })) };
    if (Buffer.byteLength(JSON.stringify(review)) > 250000) fail('REVIEW_TOO_LARGE', 'Split this draft into a smaller review.', 400);
    return review;
}

function createCommitService({ db, authorize, identity, now = Date.now, publicOrigin, voice }) {
    if (!db || typeof authorize !== 'function' || typeof now !== 'function') throw new TypeError('Commit requires explicit database and authorization adapters.');
    const collection = db.collection(C.CRM_DATA_INPUT_DRAFTS);
    async function admission(tx, actorUid) {
        id(actorUid);
        if (actorUid !== identity?.uid || await authorize({ tx, actorUid, feature: 'crm-data-input' }) !== true) fail('FORBIDDEN', 'CRM data input access is required.', 403);
    }
    async function owned(tx, actorUid, draftId) {
        id(draftId);
        const ref = collection.doc(draftId), snapshot = await tx.get(ref), draft = snapshot.exists ? snapshot.data() : null;
        if (!draft || draft.actorUid !== actorUid) fail('DRAFT_NOT_FOUND', 'Conversation not found.', 404);
        return { ref, draft };
    }
    async function voiceTargets(tx, actorUid, draft, receipt) {
        if (typeof voice?.authorizeTargets !== 'function') fail('VOICE_CONFIRMATION_UNAVAILABLE', 'Trusted voice target checks are not available.', 409);
        if (await voice.authorizeTargets({ tx, actorUid, draft, receipt }) === false) fail('VOICE_TARGET_FORBIDDEN', 'Current CRM target authority is required.', 403);
    }
    return {
        async preview({ actorUid, draftId, expectedRevision, requestId }) {
            id(requestId);
            const confirmationToken = randomBytes(32).toString('base64url'), timestamp = now();
            return db.runTransaction(async tx => {
                await admission(tx, actorUid);
                const { ref, draft } = await owned(tx, actorUid, draftId);
                if (draft.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Draft revision changed.');
                if (!['draft', 'review'].includes(draft.status) || timestamp >= draft.expiresAtMs) fail('DRAFT_UNAVAILABLE', 'Draft is expired or unavailable.');
                const previewId = `preview-${digest([actorUid, draftId, expectedRevision, requestId])}`, previewRef = ref.collection('previews').doc(previewId);
                const existing = await tx.get(previewRef);
                if (existing.exists) {
                    if (draft.preview?.previewId !== previewId) fail('PREVIEW_SUPERSEDED', 'A newer review replaced this request.');
                    const saved = existing.data();
                    if (now() >= saved.expiresAtMs) fail('PREVIEW_EXPIRED', 'Review expired; request a new review.');
                    return publicPreview(saved);
                }
                const testTokens = Object.fromEntries(draft.actions.filter(action => action.kind === 'createEntranceTest').map(action => [action.actionId, randomBytes(32).toString('base64url')]));
                const prepared = await prepareCommands({ db, transaction: tx, draft, identity, nowMs: timestamp, testTokens, publicOrigin });
                const preview = { previewId, revision: draft.revision, draftDigest: digestDraft(draft), confirmationToken, tokenHash: tokenHash(confirmationToken),
                    createdAtMs: timestamp, expiresAtMs: Math.min(draft.expiresAtMs, timestamp + 600000), testTokens, publicOrigin: publicOrigin || null,
                    planDigest: digest(prepared.plan.writes), readDigest: digest(prepared.plan.reads), review: buildReview(draft, prepared.plan) };
                await admission(tx, actorUid);
                tx.set(previewRef, preview);
                tx.set(ref, { ...draft, status: 'review', preview: { previewId, revision: draft.revision, digest: preview.draftDigest }, confirmation: null });
                return publicPreview(preview);
            });
        },
        async commit({ actorUid, draftId, previewId, confirmationToken, voiceAttestationId, paymentAcknowledgements = [] }) {
            id(previewId);
            const spoken = voiceAttestationId !== undefined;
            if (spoken) {
                id(voiceAttestationId);
                if (confirmationToken !== undefined) fail('INVALID_CONFIRMATION', 'Choose one confirmation method.', 400);
                if (typeof voice?.confirmationService?.prepareConsumption !== 'function' || typeof voice?.authorizeTargets !== 'function') {
                    fail('VOICE_CONFIRMATION_UNAVAILABLE', 'Trusted voice confirmation is not available.', 409);
                }
            }
            return db.runTransaction(async tx => {
                await admission(tx, actorUid);
                const { ref, draft } = await owned(tx, actorUid, draftId);
                const receiptRef = ref.collection('operations').doc(previewId), receiptSnap = await tx.get(receiptRef);
                if (receiptSnap.exists) {
                    const receipt = receiptSnap.data();
                    if (receipt.actorUid !== actorUid) fail('FORBIDDEN', 'Operation owner does not match.', 403);
                    if (spoken) {
                        if (receipt.voiceConfirmation?.attestationId !== voiceAttestationId) fail('INVALID_CONFIRMATION', 'Confirmation does not match this receipt.', 403);
                        const replay = await voice.confirmationService.prepareConsumption(tx, { actorUid, feature: 'crm-data-input', attestationId: voiceAttestationId,
                            binding: receipt.voiceConfirmation.binding, receiptId: previewId });
                        if (replay?.replayed !== true) fail('INVALID_CONFIRMATION', 'Confirmation has not been consumed by this receipt.', 403);
                        await voiceTargets(tx, actorUid, draft, receipt);
                    } else checkToken(confirmationToken, receipt.tokenHash);
                    if (!spoken && receipt.voiceConfirmation) await voiceTargets(tx, actorUid, draft, receipt);
                    return publicReceipt(receipt);
                }
                const previewSnap = await tx.get(ref.collection('previews').doc(previewId));
                if (!previewSnap.exists || draft.status !== 'review' || draft.preview?.previewId !== previewId) fail('STALE_PREVIEW', 'Review the current draft before confirming.');
                const preview = previewSnap.data();
                if (!spoken) checkToken(confirmationToken, preview.tokenHash);
                if (draft.revision !== preview.revision || digestDraft(draft) !== preview.draftDigest) fail('STALE_PREVIEW', 'Draft changed after review.');
                if (now() >= preview.expiresAtMs) fail('PREVIEW_EXPIRED', 'Review expired; request a new review.');
                // Only server-held preview fields form the attestation binding.
                // Shared validation and domain target reads must precede all writes.
                let pendingVoice = null, voiceBinding = null;
                if (spoken) {
                    voiceBinding = { actorUid, feature: 'crm-data-input', draftId, previewId, revision: preview.revision,
                        draftDigest: preview.draftDigest, expiresAtMs: preview.expiresAtMs };
                    pendingVoice = await voice.confirmationService.prepareConsumption(tx, { actorUid, feature: 'crm-data-input', attestationId: voiceAttestationId,
                        binding: voiceBinding, receiptId: previewId });
                    if (pendingVoice?.replayed !== false || typeof pendingVoice.consume !== 'function') fail('INVALID_CONFIRMATION', 'Confirmation cannot authorize a new operation.', 403);
                    await voiceTargets(tx, actorUid, draft);
                }
                const requiredPayments = imagePaymentActions(draft);
                if (!Array.isArray(paymentAcknowledgements) || paymentAcknowledgements.length > 25
                    || paymentAcknowledgements.some(value => typeof value !== 'string')
                    || JSON.stringify([...paymentAcknowledgements].sort()) !== JSON.stringify(requiredPayments)) {
                    fail('PAYMENT_ASSERTION_REQUIRED', 'Confirm the received-payment meaning of each image-related payment in this review.', 422);
                }
                const prepared = await prepareCommands({ db, transaction: tx, draft, identity, nowMs: preview.createdAtMs, testTokens: preview.testTokens, publicOrigin: preview.publicOrigin });
                if (digest(prepared.plan.reads) !== preview.readDigest) fail('STALE_RECORDS', 'CRM records changed; review the updated operation.');
                if (digest(prepared.plan.writes) !== preview.planDigest) fail('STALE_PREVIEW', 'The resulting changes differ from the review.');
                await admission(tx, actorUid);
                const committedAtMs = now();
                if (committedAtMs >= preview.expiresAtMs) fail('PREVIEW_EXPIRED', 'Review expired; request a new review.');
                const receipt = { operationId: previewId, actorUid, draftId, revision: draft.revision, status: 'committed', tokenHash: preview.tokenHash, results: json(prepared.results), committedAtMs };
                if (spoken) receipt.voiceConfirmation = { attestationId: voiceAttestationId, binding: voiceBinding };
                if (requiredPayments.length) receipt.paymentAssertion = { meaning: 'received-payment-v1', actionIds: requiredPayments, actorUid, confirmedAtMs: committedAtMs };
                if (Buffer.byteLength(JSON.stringify(receipt)) > 750000) fail('RECEIPT_TOO_LARGE', 'Operation result exceeds the receipt limit.', 400);
                await prepared.flush();
                if (pendingVoice) pendingVoice.consume();
                tx.set(receiptRef, receipt);
                tx.set(ref, { ...draft, status: 'committed', preview: null, confirmation: null, receiptId: previewId, updatedAtMs: committedAtMs });
                return publicReceipt(receipt);
            });
        },
        async status({ actorUid, draftId }) {
            return db.runTransaction(async tx => {
                await admission(tx, actorUid);
                const { ref, draft } = await owned(tx, actorUid, draftId);
                if (draft.status !== 'committed') return { status: draft.status, receipt: null };
                const receipt = await tx.get(ref.collection('operations').doc(draft.receiptId));
                if (!receipt.exists) fail('RECEIPT_UNAVAILABLE', 'Committed operation receipt is unavailable.');
                const stored = receipt.data();
                if (stored.actorUid !== actorUid) fail('FORBIDDEN', 'Operation owner does not match.', 403);
                if (stored.voiceConfirmation) await voiceTargets(tx, actorUid, draft, stored);
                return { status: 'committed', receipt: publicReceipt(stored) };
            });
        }
    };
}
module.exports = { createCommitService };
