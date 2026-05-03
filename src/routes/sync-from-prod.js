const express = require('express');

const { getProdDb } = require('../utils/prod-firestore');
const { db, admin } = require('../utils/firebase');
const authMiddleware = require('../middleware/auth');
const { sendError } = require('../utils/response-helper');
const { createSyncFromProdService } = require('../utils/sync-from-prod-service');

function createSyncFromProdRouter(rawDeps = {}) {
    const deps = {
        db,
        admin,
        authMiddleware,
        sendError,
        getProdDb,
        ...rawDeps
    };
    const router = express.Router();
    const guardHandlers = Array.isArray(deps.guardHandlers) && deps.guardHandlers.length > 0
        ? deps.guardHandlers
        : [deps.authMiddleware].filter(Boolean);
    const service = deps.syncService || createSyncFromProdService({
        admin: deps.admin,
        localDb: deps.db,
        getProdDb: deps.getProdDb,
        jobStore: deps.jobStore,
        logger: deps.logger,
        maxStagedDocs: deps.maxStagedDocs,
        maxBackupDocs: deps.maxBackupDocs
    });

    function ensureSyncAvailable(req, res, next) {
        if (!process.env.FIRESTORE_EMULATOR_HOST) {
            return deps.sendError(res, 403, 'NOT_DEV_MODE', 'This endpoint is only available when running with emulators.');
        }
        if (!deps.db) {
            return deps.sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Local Firestore (emulator) not initialized.');
        }
        next();
    }

    function sendStart(res, payload) {
        return res.status(202).json({
            success: true,
            data: payload
        });
    }

    function startMode(mode) {
        return (req, res) => {
            const started = service.startJob(mode, req.body || {});
            if (started.error) {
                return deps.sendError(res, started.error.status, started.error.code, started.error.message);
            }
            return sendStart(res, started.value);
        };
    }

    router.post('/sync-from-prod', ...guardHandlers, ensureSyncAvailable, startMode('full'));
    router.post('/sync-from-prod/selective', ...guardHandlers, ensureSyncAvailable, startMode('selective'));

    router.get('/sync-from-prod/collections', ...guardHandlers, ensureSyncAvailable, (req, res) => {
        return res.json({
            success: true,
            data: {
                collections: service.listCollections()
            }
        });
    });

    router.get('/sync-from-prod/jobs/latest', ...guardHandlers, ensureSyncAvailable, (req, res) => {
        return res.json({
            success: true,
            data: service.getLatestJob()
        });
    });

    router.get('/sync-from-prod/jobs/:jobId', ...guardHandlers, ensureSyncAvailable, (req, res) => {
        const jobId = String(req.params.jobId || '').trim();
        const job = service.getJob(jobId);
        if (!job) {
            return deps.sendError(res, 404, 'SYNC_JOB_NOT_FOUND', 'Sync job not found.');
        }
        return res.json({
            success: true,
            data: job
        });
    });

    return router;
}

const router = createSyncFromProdRouter();

module.exports = router;
module.exports.createSyncFromProdRouter = createSyncFromProdRouter;
