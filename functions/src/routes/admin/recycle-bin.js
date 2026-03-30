const {
    listRecycleBinEntries,
    restoreRecycleEntries,
    purgeRecycleEntries
} = require('../../crm/recycle-bin-service');

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function parseRequestedIds(req) {
    const bodyIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const queryIds = String(req.query?.ids || '')
        .split(',')
        .map((item) => cleanOptionalString(item))
        .filter(Boolean);
    return bodyIds.length ? bodyIds : queryIds;
}

function parseEntityTypes(req) {
    const bodyTypes = Array.isArray(req.body?.entityTypes) ? req.body.entityTypes : [];
    const queryTypes = String(req.query?.entityType || req.query?.entityTypes || '')
        .split(',')
        .map((item) => cleanOptionalString(item))
        .filter(Boolean);
    return bodyTypes.length ? bodyTypes : queryTypes;
}

module.exports = function registerRecycleBinRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, writeAuditLog } = deps;

    router.get('/recycle-bin', ...requireAdminHandlers, async (req, res) => {
        try {
            const requestedLimit = Number(req.query?.limit);
            const requestedPage = Number(req.query?.page);
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
                : 50;
            const page = Number.isFinite(requestedPage)
                ? Math.max(1, Math.floor(requestedPage))
                : 1;
            const entityTypes = parseEntityTypes(req);
            const sourcePanel = cleanOptionalString(req.query?.sourcePanel);
            const result = await listRecycleBinEntries(db, {
                page,
                limit,
                entityTypes,
                sourcePanel
            });
            return sendSuccess(res, result);
        } catch (error) {
            return sendError(res, 500, 'LIST_RECYCLE_BIN_ERROR', 'Failed to list recycle bin entries.', error?.message || error);
        }
    });

    router.post('/recycle-bin/restore', ...requireAdminHandlers, async (req, res) => {
        try {
            const ids = parseRequestedIds(req);
            const result = await restoreRecycleEntries(db, ids, { user: req.user });
            await writeAuditLog?.({
                action: 'recycle_bin.restore',
                entityType: 'recycle_bin',
                entityId: null,
                metadata: {
                    requestedIds: result.requestedIds,
                    restoredIds: result.restoredIds,
                    notFoundIds: result.notFoundIds,
                    failed: result.failed
                }
            }, { user: req.user });
            return sendSuccess(res, result, 'Recycle bin entries restored.');
        } catch (error) {
            return sendError(res, 500, 'RESTORE_RECYCLE_BIN_ERROR', 'Failed to restore recycle bin entries.', error?.message || error);
        }
    });

    router.post('/recycle-bin/purge', ...requireAdminHandlers, async (req, res) => {
        try {
            const ids = parseRequestedIds(req);
            const result = await purgeRecycleEntries(db, ids, { user: req.user });
            await writeAuditLog?.({
                action: 'recycle_bin.purge',
                entityType: 'recycle_bin',
                entityId: null,
                metadata: {
                    requestedIds: result.requestedIds,
                    purgedIds: result.purgedIds,
                    notFoundIds: result.notFoundIds
                }
            }, { user: req.user });
            return sendSuccess(res, result, 'Recycle bin entries purged.');
        } catch (error) {
            return sendError(res, 500, 'PURGE_RECYCLE_BIN_ERROR', 'Failed to purge recycle bin entries.', error?.message || error);
        }
    });
};
