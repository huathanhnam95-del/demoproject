'use strict';
const { randomUUID } = require('node:crypto');
const LEASE_MS = 600000;
/** One metadata-only storage page per invocation. This maintenance path stays
 * active when new input is disabled so earlier uploads still expire. */
function createAttachmentCleanup({ db, storage, now = Date.now }) {
    if (!db || typeof storage?.sweepExpired !== 'function') throw TypeError('Cleanup infrastructure required.');
    const ref = db.collection('crmDataInputMaintenance').doc('attachment-expiry');
    return { async run() {
        const leaseToken = randomUUID();
        const claim = await db.runTransaction(async tx => {
            const snap = await tx.get(ref), state = snap.exists ? snap.data() : {};
            if (state.leaseToken && state.leaseUntilMs > now()) return null;
            tx.set(ref, { ...state, leaseToken, leaseUntilMs: now() + LEASE_MS, startedAtMs: now() });
            return { pageToken: state.pageToken || undefined };
        });
        if (!claim) return { status: 'busy' };
        try {
            const result = await storage.sweepExpired({ limit: 100, ...(claim.pageToken ? { pageToken: claim.pageToken } : {}) });
            const saved = await db.runTransaction(async tx => {
                const snap = await tx.get(ref), state = snap.exists ? snap.data() : {};
                if (state.leaseToken !== leaseToken || state.leaseUntilMs <= now()) return false;
                tx.set(ref, { ...state, pageToken: result.nextPageToken, leaseToken: null, leaseUntilMs: 0,
                    completedAtMs: now(), lastErrorCode: null, lastPage: result,
                    completedScans: (state.completedScans || 0) + (result.nextPageToken === null ? 1 : 0) });
                return true;
            });
            return { status: saved ? 'completed' : 'lease-lost', ...result };
        } catch (error) {
            // Preserve the original failure even if Firestore is also down.
            // An unreleased lease can be reclaimed after its bounded expiry.
            try {
                await db.runTransaction(async tx => {
                    const snap = await tx.get(ref), state = snap.exists ? snap.data() : {};
                    if (state.leaseToken !== leaseToken) return;
                    tx.set(ref, { ...state, leaseToken: null, leaseUntilMs: 0, failedAtMs: now(), lastErrorCode: 'SWEEP_FAILED' });
                });
            } catch { /* Expiring lease is the durable crash recovery path. */ }
            throw error;
        }
    } };
}
module.exports = { createAttachmentCleanup };
