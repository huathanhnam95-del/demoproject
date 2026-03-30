const { previewBulkDelete, executeBulkDelete } = require('../../crm/recycle-bin-service');

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

function parseForceDelete(req) {
    return req.body?.force === true || String(req.query?.force || '').trim().toLowerCase() === 'true';
}

function parseSourcePanel(req) {
    return cleanOptionalString(req.body?.sourcePanel || req.query?.sourcePanel);
}

module.exports = function registerBulkDeleteRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, writeAuditLog } = deps;

    function register(kind) {
        router.post(`/${kind}/bulk-delete/preview`, ...requireAdminHandlers, async (req, res) => {
            try {
                const ids = parseRequestedIds(req);
                const result = await previewBulkDelete(db, kind, ids, {
                    sourcePanel: parseSourcePanel(req)
                });
                return sendSuccess(res, result);
            } catch (error) {
                return sendError(res, 500, 'BULK_DELETE_PREVIEW_ERROR', 'Failed to preview recycle-bin operation.', error?.message || error);
            }
        });

        router.post(`/${kind}/bulk-delete`, ...requireAdminHandlers, async (req, res) => {
            try {
                const ids = parseRequestedIds(req);
                const force = parseForceDelete(req);
                const result = await executeBulkDelete(db, kind, ids, {
                    force,
                    sourcePanel: parseSourcePanel(req)
                });
                await writeAuditLog?.({
                    action: `${kind}.archive`,
                    entityType: kind,
                    entityId: null,
                    metadata: {
                        requestedIds: result.requestedIds,
                        archivedIds: result.archivedIds,
                        recycleIds: result.recycleIds,
                        notFoundIds: result.notFoundIds,
                        force
                    }
                }, { user: req.user });
                return sendSuccess(res, result, 'Moved to Recycle Bin.');
            } catch (error) {
                return sendError(res, 500, 'BULK_DELETE_ERROR', 'Failed to archive records.', error?.message || error);
            }
        });
    }

    ['leads', 'students', 'courses', 'classrooms'].forEach(register);
};
