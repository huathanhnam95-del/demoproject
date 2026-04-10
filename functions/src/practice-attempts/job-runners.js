const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { getStorageBucket } = require('../utils/firebase_admin_init');
const {
    PRACTICE_ACCESS_JOBS,
    reconcilePracticeAccessForUid
} = require('../crm/practice-access-service');

const SPEAKING_ATTEMPTS = 'speakingAttempts';
const SPEAKING_ATTEMPT_SHARES = 'speakingAttemptShares';

const RETENTION = {
    promoted: 'promoted_student',
    nonstudentTtl: 'nonstudent_ttl',
    nonstudentBookmarked: 'nonstudent_bookmarked'
};

function asDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? new Date(ms) : null;
    }
    return null;
}

async function safeDeleteFile(bucket, path) {
    if (!path) return;
    try {
        await bucket.file(path).delete();
    } catch (e) {
        const code = String(e?.code || '');
        if (code === '404') return;
        if ((e?.message || '').includes('No such object')) return;
        throw e;
    }
}

async function deleteFeedbackCascade(db, attemptId, bucket) {
    const feedbackRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId).collection('feedback');
    const snap = await feedbackRef.limit(200).get();
    const deletes = [];
    for (const doc of snap.docs) {
        const data = doc.data() || {};
        const audioPath = String(data.audioPath || '').trim();
        if (audioPath) {
            deletes.push(safeDeleteFile(bucket, audioPath));
        }
        deletes.push(doc.ref.delete().catch(() => null));
    }
    await Promise.all(deletes);
}

async function deleteAttemptCascade(db, attemptId) {
    const bucket = await getStorageBucket();
    const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
    const snap = await attemptRef.get();
    if (!snap.exists) return;
    const attempt = snap.data() || {};

    const shareId = String(attempt.shareId || '').trim();
    const studentPath = String(attempt.audio?.studentPath || '').trim();

    await deleteFeedbackCascade(db, attemptId, bucket);
    if (shareId) {
        await db.collection(SPEAKING_ATTEMPT_SHARES).doc(shareId).delete().catch(() => null);
    }
    if (studentPath) {
        await safeDeleteFile(bucket, studentPath);
    }

    await attemptRef.delete().catch(() => null);
}

async function claimAttemptForDeletion(db, attemptRef, now) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(attemptRef);
        if (!snap.exists) return { ok: false, reason: 'missing' };
        const data = snap.data() || {};

        const state = String(data.deletionState || '').trim();
        if (state === 'deleting') {
            const lockedAt = asDate(data.deletionLockedAt);
            if (lockedAt && now.getTime() - lockedAt.getTime() < 30 * 60 * 1000) {
                return { ok: false, reason: 'locked' };
            }
        }

        tx.set(attemptRef, {
            deletionState: 'deleting',
            deletionLockedAt: now,
            deletionLastError: null,
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        return { ok: true };
    });
}

async function runSpeakingAttemptCleanup(db, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();

    // Clean up stale drafts (prepared but never submitted).
    // This prevents abandoned attempts from accumulating indefinitely.
    const draftCutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const draftSnap = await db.collection(SPEAKING_ATTEMPTS)
        .where('status', '==', 'awaiting_upload')
        .where('createdAt', '<=', draftCutoff)
        .orderBy('createdAt', 'asc')
        .limit(200)
        .get()
        .catch(() => null);

    if (draftSnap && Array.isArray(draftSnap.docs) && draftSnap.docs.length) {
        const bucket = await getStorageBucket();
        for (const doc of draftSnap.docs) {
            const data = doc.data() || {};
            const studentPath = String(data.audio?.studentPath || '').trim();
            if (studentPath) {
                await safeDeleteFile(bucket, studentPath).catch(() => null);
            }
            await doc.ref.delete().catch(() => null);
        }
    }

    // NOTE: requires an index for retentionState + deleteAfterAt ordering if large.
    const snap = await db.collection(SPEAKING_ATTEMPTS)
        .where('retentionState', '==', RETENTION.nonstudentTtl)
        .where('deleteAfterAt', '<=', now)
        .orderBy('deleteAfterAt', 'asc')
        .limit(200)
        .get();

    const results = { scanned: snap.docs.length, deleted: 0, failed: 0, skipped: 0 };
    for (const doc of snap.docs) {
        const attemptId = doc.id;
        const attemptRef = doc.ref;
        const claim = await claimAttemptForDeletion(db, attemptRef, now);
        if (!claim.ok) {
            results.skipped += 1;
            continue;
        }

        try {
            await deleteAttemptCascade(db, attemptId);
            results.deleted += 1;
        } catch (e) {
            results.failed += 1;
            await attemptRef.set({
                deletionState: 'failed',
                deletionLastError: String(e?.message || e),
                retryAfterAt: new Date(now.getTime() + 60 * 60 * 1000),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true }).catch(() => null);
        }
    }

    return results;
}

async function claimJob(db, jobRef, now) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(jobRef);
        if (!snap.exists) return { ok: false };
        const data = snap.data() || {};

        const status = String(data.status || '').trim();
        const runAfterAt = asDate(data.runAfterAt);
        if (status !== 'queued') return { ok: false };
        if (runAfterAt && runAfterAt.getTime() > now.getTime()) return { ok: false };

        tx.set(jobRef, {
            status: 'running',
            lockedAt: now,
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return { ok: true, data };
    });
}

async function runPracticeAccessReconcileJobs(db, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const snap = await db.collection(PRACTICE_ACCESS_JOBS)
        .where('kind', '==', 'reconcileUid')
        .where('status', '==', 'queued')
        .where('runAfterAt', '<=', now)
        .orderBy('runAfterAt', 'asc')
        .limit(40)
        .get();

    const results = { scanned: snap.docs.length, reconciled: 0, failed: 0, skipped: 0 };
    for (const doc of snap.docs) {
        const jobRef = doc.ref;
        const claim = await claimJob(db, jobRef, now);
        if (!claim.ok) {
            results.skipped += 1;
            continue;
        }
        const job = claim.data || {};
        const uid = String(job.uid || '').trim();
        if (!uid) {
            await jobRef.set({ status: 'error', lastError: 'Missing uid', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            results.failed += 1;
            continue;
        }

        try {
            await reconcilePracticeAccessForUid(db, uid, { now });
            await jobRef.set({
                status: 'done',
                finishedAt: FieldValue.serverTimestamp(),
                lastError: null,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            results.reconciled += 1;
        } catch (e) {
            await jobRef.set({
                status: 'queued',
                runAfterAt: new Date(now.getTime() + 60 * 60 * 1000),
                lastError: String(e?.message || e),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            results.failed += 1;
        }
    }

    return results;
}

async function runPromotionForUid(db, uid, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const jobRef = options.jobRef || null;
    const cursorAttemptId = String(options.cursorAttemptId || '').trim();

    let query = db.collection(SPEAKING_ATTEMPTS)
        .where('ownerUid', '==', uid)
        .where('retentionState', 'in', [RETENTION.nonstudentTtl, RETENTION.nonstudentBookmarked])
        .orderBy(FieldPath.documentId())
        .limit(200);
    if (cursorAttemptId) {
        query = query.startAfter(cursorAttemptId);
    }

    const snap = await query.get();
    if (snap.empty) {
        if (jobRef) {
            await jobRef.set({
                status: 'done',
                cursorAttemptId: null,
                finishedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true }).catch(() => null);
        }
        return { promoted: 0, done: true };
    }

    const batch = db.batch();
    let lastId = null;
    for (const doc of snap.docs) {
        lastId = doc.id;
        batch.set(doc.ref, {
            retentionState: RETENTION.promoted,
            deleteAfterAt: null,
            promotion: {
                promotedAt: FieldValue.serverTimestamp(),
                triggeredBy: 'entitlement_change',
                previousRetentionState: doc.data()?.retentionState || null
            },
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    }
    await batch.commit();

    if (jobRef) {
        await jobRef.set({
            status: 'queued',
            runAfterAt: new Date(now.getTime() + 60 * 1000),
            cursorAttemptId: lastId,
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => null);
    }

    return { promoted: snap.docs.length, done: false };
}

async function runPracticeAccessPromotionJobs(db, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const snap = await db.collection(PRACTICE_ACCESS_JOBS)
        .where('kind', '==', 'promoteUid')
        .where('status', '==', 'queued')
        .where('runAfterAt', '<=', now)
        .orderBy('runAfterAt', 'asc')
        .limit(20)
        .get();

    const results = { scanned: snap.docs.length, promoted: 0, failed: 0, skipped: 0 };
    for (const doc of snap.docs) {
        const jobRef = doc.ref;
        const claim = await claimJob(db, jobRef, now);
        if (!claim.ok) {
            results.skipped += 1;
            continue;
        }
        const job = claim.data || {};
        const uid = String(job.uid || '').trim();
        if (!uid) {
            await jobRef.set({ status: 'error', lastError: 'Missing uid', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            results.failed += 1;
            continue;
        }

        try {
            const cursorAttemptId = String(job.cursorAttemptId || '').trim();
            const out = await runPromotionForUid(db, uid, { now, cursorAttemptId, jobRef });
            results.promoted += out.promoted || 0;
        } catch (e) {
            await jobRef.set({
                status: 'queued',
                runAfterAt: new Date(now.getTime() + 60 * 60 * 1000),
                lastError: String(e?.message || e),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            results.failed += 1;
        }
    }

    return results;
}

module.exports = {
    runSpeakingAttemptCleanup,
    runPracticeAccessReconcileJobs,
    runPracticeAccessPromotionJobs
};
