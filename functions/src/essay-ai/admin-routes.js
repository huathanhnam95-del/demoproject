const express = require('express');
const crypto = require('crypto');
const { CRM_AUDIT_LOGS } = require('../crm/collections');
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function now() { return new Date(); }

function timestampMillis(value) {
    if (value && typeof value.toDate === 'function') return value.toDate().getTime();
    if (value && Number.isFinite(Number(value._seconds))) return Number(value._seconds) * 1000;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function isWorkerReady(worker, currentTime = now()) {
    if (!worker) return false;
    const ageMs = currentTime.getTime() - timestampMillis(worker.lastHeartbeatAt);
    return worker.state !== 'stopping'
        && ageMs >= 0
        && ageMs <= 45_000
        && worker.ollamaReachable === true
        && worker.modelsReady === true;
}

function serializeWorkerStatus(snapshot, currentTime = now()) {
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    const heartbeatMs = timestampMillis(data.lastHeartbeatAt);
    return {
        ...data,
        lastHeartbeatAt: heartbeatMs ? new Date(heartbeatMs).toISOString() : null,
        ready: isWorkerReady(data, currentTime)
    };
}

function buildJob({ mode, uid, requestId, includeFailed = false, sourcePreviewJobId = null, candidateCount = 0, scanCutoffAt = now() }) {
    const id = crypto.createHash('sha256').update(`${mode}:${uid}:${requestId}`).digest('hex');
    return { id, data: {
        requestId,
        mode,
        status: 'pending',
        includeFailed: Boolean(includeFailed),
        pageSize: 200,
        scanCutoffAt,
        cursorSubmittedAt: null,
        cursorAttemptId: null,
        scannedCount: 0,
        candidateCount: Number(candidateCount || 0),
        enqueuedCount: 0,
        skippedCount: 0,
        invalidCount: 0,
        sourcePreviewJobId,
        createdAt: now(),
        createdBy: uid,
        workerId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        completedAt: null,
        error: null
    }};
}

function createEssayAiAdminRouter({ db, authMiddleware, adminMiddleware, sendSuccess, sendError }) {
    const router = express.Router();
    router.get('/status', authMiddleware, adminMiddleware, async (_req, res) => {
        try {
            const [worker, control, pending, processing] = await Promise.all([
                db.collection('essay_ai_worker_status').doc('current').get(),
                db.collection('essay_ai_backfill_control').doc('current').get(),
                db.collection('essay_ai_queue').where('status', '==', 'pending').limit(500).get(),
                db.collection('essay_ai_queue').where('status', '==', 'processing').limit(500).get()
            ]);
            return sendSuccess(res, {
                worker: serializeWorkerStatus(worker),
                control: control.exists ? control.data() : null,
                pendingCount: pending.size,
                processingCount: processing.size
            });
        } catch (error) {
            return sendError(res, 500, 'ESSAY_AI_STATUS_ERROR', 'Failed to load Essay AI status.', error?.message || error);
        }
    });

    async function enqueueScan(req, res, mode) {
        try {
            const bodyKeys = Object.keys(req.body || {}).sort();
            const expectedKeys = mode === 'preview' ? ['includeFailed', 'requestId'] : ['previewJobId', 'requestId'];
            if (bodyKeys.length !== expectedKeys.length
                || bodyKeys.some((key, index) => key !== expectedKeys[index])
                || typeof req.body?.requestId !== 'string'
                || !REQUEST_ID_PATTERN.test(req.body.requestId)
                || (mode === 'preview' && typeof req.body.includeFailed !== 'boolean')
                || (mode === 'enqueue' && (
                    typeof req.body.previewJobId !== 'string'
                    || req.body.previewJobId.length === 0
                    || req.body.previewJobId.length > 128
                ))) {
                return sendError(res, 400, 'INVALID_REQUEST', 'Invalid Essay AI request schema.');
            }
            const controlRef = db.collection('essay_ai_backfill_control').doc('current');
            let sourcePreview = null;
            if (mode === 'enqueue') {
                const sourceRef = db.collection('essay_ai_backfill_jobs').doc(String(req.body.previewJobId));
                const sourceSnapshot = await sourceRef.get();
                sourcePreview = sourceSnapshot.exists ? sourceSnapshot.data() : null;
                if (!sourcePreview || sourcePreview.mode !== 'preview' || sourcePreview.status !== 'completed') return sendError(res, 409, 'STALE_PREVIEW', 'Preview is not completed or is stale.');
                const cutoff = sourcePreview.scanCutoffAt?.toDate ? sourcePreview.scanCutoffAt.toDate() : new Date(sourcePreview.scanCutoffAt);
                if (!Number.isFinite(cutoff.getTime()) || (Date.now() - cutoff.getTime()) > 10 * 60 * 1000) {
                    return sendError(res, 409, 'STALE_PREVIEW', 'Preview is stale; run a new preview.');
                }
            }
            const job = buildJob({
                mode, uid: req.user.uid, requestId: req.body.requestId,
                includeFailed: mode === 'preview' ? req.body.includeFailed === true : sourcePreview.includeFailed === true,
                sourcePreviewJobId: mode === 'enqueue' ? req.body.previewJobId : null,
                candidateCount: mode === 'enqueue' ? Number(sourcePreview.candidateCount || 0) : 0,
                scanCutoffAt: mode === 'enqueue' ? sourcePreview.scanCutoffAt : now()
            });
            const jobRef = db.collection('essay_ai_backfill_jobs').doc(job.id);
            const auditRef = mode === 'enqueue'
                ? db.collection(CRM_AUDIT_LOGS).doc(`essay-ai:${job.id}`)
                : null;
            const existingJob = await jobRef.get();
            if (existingJob.exists) {
                res.status(202);
                return sendSuccess(res, { jobId: job.id, mode, reused: true }, 'Essay AI scan already queued.');
            }
            const activeKey = mode === 'preview' ? 'activePreviewJobId' : 'activeEnqueueJobId';
            await db.runTransaction(async (tx) => {
                const controlSnap = await tx.get(controlRef);
                const control = controlSnap.exists ? controlSnap.data() : {};
                if (control[activeKey]) {
                    const active = await tx.get(db.collection('essay_ai_backfill_jobs').doc(String(control[activeKey])));
                    if (active.exists && ['pending', 'processing'].includes(active.data()?.status)) {
                        const error = new Error('ESSAY_AI_JOB_ACTIVE');
                        error.code = 'ESSAY_AI_JOB_ACTIVE';
                        error.activeJobId = active.id;
                        throw error;
                    }
                }
                tx.set(jobRef, job.data);
                tx.set(controlRef, { [activeKey]: job.id, updatedAt: now() }, { merge: true });
                if (auditRef) tx.set(auditRef, {
                    action: 'essay_ai_enqueue',
                    jobId: job.id,
                    sourcePreviewJobId: req.body.previewJobId,
                    candidateCount: Number(sourcePreview.candidateCount || 0),
                    includeFailed: sourcePreview.includeFailed === true,
                    adminUid: req.user.uid,
                    adminEmail: req.user.email || null,
                    createdAt: now()
                });
            });
            res.status(202);
            return sendSuccess(res, { jobId: job.id, mode }, 'Essay AI scan queued.');
        } catch (error) {
            if (error?.code === 'ESSAY_AI_JOB_ACTIVE') {
                res.status(202);
                return sendSuccess(res, { jobId: error.activeJobId, mode, reusedActive: true }, 'An Essay AI scan is already active.');
            }
            return sendError(res, 500, 'ESSAY_AI_TRIGGER_ERROR', 'Failed to queue Essay AI scan.', error?.message || error);
        }
    }

    router.post('/preview', authMiddleware, adminMiddleware, (req, res) => enqueueScan(req, res, 'preview'));
    router.post('/trigger', authMiddleware, adminMiddleware, (req, res) => enqueueScan(req, res, 'enqueue'));
    router.get('/backfill-jobs/:jobId', authMiddleware, adminMiddleware, async (req, res) => {
        const snapshot = await db.collection('essay_ai_backfill_jobs').doc(String(req.params.jobId || '')).get();
        if (!snapshot.exists) return sendError(res, 404, 'JOB_NOT_FOUND', 'Essay AI job not found.');
        const data = snapshot.data() || {};
        return sendSuccess(res, { jobId: snapshot.id, mode: data.mode, status: data.status, scannedCount: data.scannedCount || 0, candidateCount: data.candidateCount || 0, enqueuedCount: data.enqueuedCount || 0, skippedCount: data.skippedCount || 0, invalidCount: data.invalidCount || 0, scanCutoffAt: data.scanCutoffAt || null, error: data.error || null });
    });
    return router;
}

module.exports = createEssayAiAdminRouter;
module.exports.isWorkerReady = isWorkerReady;
