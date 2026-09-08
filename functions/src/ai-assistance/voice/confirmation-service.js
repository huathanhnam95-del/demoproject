'use strict';
const { strict, text, reject, digest } = require('../accounting/money-pricing');
const { AI_VOICE_COLLECTIONS: C } = require('../collections');
const { binding: validateBinding, dependencies } = require('./contracts');
function createVoiceConfirmationService(options = {}) {
    const { db, time, authorize, resolve } = dependencies(options);
    return Object.freeze({
        async prepareConsumption(tx, input) {
            strict(input, ['actorUid', 'feature', 'attestationId', 'binding', 'receiptId']); text(input.attestationId); const receiptId = text(input.receiptId);
            const ref = db.collection(C.attestations).doc(input.attestationId), snap = await tx.get(ref), record = snap.exists ? snap.data() : null;
            if (!record || record.actorUid !== input.actorUid || record.feature !== input.feature) reject('ATTESTATION_NOT_FOUND', 'Confirmation attestation not found.', 404);
            await authorize(tx, input.actorUid, input.feature);
            if (record.engineeringOnly !== false && options.engineeringMode !== true) reject('ENGINEERING_ATTESTATION', 'Engineering evidence cannot authorize production effects.', 403);
            const originalBinding = validateBinding(input.binding, input.actorUid, input.feature, Number.MIN_SAFE_INTEGER);
            if (digest(originalBinding) !== digest(record.binding)) reject('STALE_ATTESTATION', 'Confirmation binding differs from the original preview.', 409);
            if (record.consumedReceiptId !== null) {
                if (record.consumedReceiptId !== receiptId) reject('ATTESTATION_CONSUMED', 'Confirmation was consumed by another receipt.', 409);
                // Domain receipt replay performs no effects and survives preview
                // clearing/session expiry, but never bypasses current authority.
                return Object.freeze({ replayed: true, consume() {} });
            }
            const context = await resolve(tx, input.actorUid, input.feature, record.contextHints);
            const sessionSnapshot = await tx.get(db.collection(C.sessions).doc(record.sessionId));
            const session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
            if (!session || session.actorUid !== input.actorUid || session.feature !== input.feature || session.epoch !== record.epoch || session.contextRevision !== record.contextRevision || session.state !== 'connected' || session.expiresAtMs <= time()) reject('STALE_ATTESTATION', 'Confirmation session changed or expired.', 409);
            const binding = validateBinding(input.binding, input.actorUid, input.feature, time());
            if (record.expiresAtMs <= time() || digest(binding) !== digest(record.binding) || context.contextDigest !== record.contextDigest || digest(context.previewBinding) !== digest(binding)) reject('STALE_ATTESTATION', 'Confirmation does not match the current exact preview.', 409);
            const replayed = false; let staged = false;
            return Object.freeze({ replayed, consume() { if (staged) return; if (record.expiresAtMs <= time()) reject('STALE_ATTESTATION', 'Confirmation expired before effects were staged.', 409); staged = true; if (!replayed) tx.set(ref, { ...record, consumedReceiptId: receiptId, consumedAtMs: time() }); } });
        }
    });
}
module.exports = { createVoiceConfirmationService };
