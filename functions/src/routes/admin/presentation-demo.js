'use strict';

const { assertActiveIdentity } = require('../../crm/presentation-demo/identity.cjs');
const { fail, assertOperationEnabled } = require('../../crm/presentation-demo/contracts.cjs');

function createPresentationDemoHandlers({ roomService, connections, notes, archives, pdf, resolveIdentity = req => req.user } = {}) {
    if (!roomService || !connections || !notes || !archives || !pdf) throw new TypeError('presentation demo services are required');
    async function identity(req) {
        const value = await resolveIdentity(req);
        if (!value) {
            const error = new Error('Authentication required.');
            error.code = 'UNAUTHORIZED';
            throw error;
        }
        return assertActiveIdentity(value);
    }
    function ok(res, data) { return res.status(200).json({ success: true, data }); }
    function realtimeOrigin() {
        const configured = process.env.PRESENTATION_DEMO_REALTIME_ORIGIN;
        if (!configured) return null;
        let origin;
        try { origin = new URL(configured); } catch (_) { fail('OUTCOME_UNKNOWN', 'The realtime service configuration is unavailable.'); }
        if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) fail('OUTCOME_UNKNOWN', 'The realtime service configuration is unavailable.');
        return origin.origin;
    }
    function failResponse(res, error) {
        const known = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code);
        const code = known ? error.code : 'OUTCOME_UNKNOWN';
        if (code === 'SERVICE_RECOVERY') return res.status(503).json({ success: false, error: { code, message: error.message } });
        const status = ['RATE_LIMITED', 'PDF_BUSY'].includes(code) ? 429 : ['OUTCOME_UNKNOWN', 'AUTHORITY_CLOSED', 'PDF_RENDER_FAILED'].includes(code) ? 503 : ['NOTE_CONFLICT', 'OPERATION_ID_REUSED', 'COMMAND_RECEIPT_CONFLICT', 'SEQUENCE_GAP', 'ALREADY_APPLIED_RESYNC', 'PROTOCOL_MISMATCH'].includes(code) ? 409 : ['ROOM_ENDED', 'ROOM_EXPIRED'].includes(code) ? 410 : ['UNAUTHORIZED', 'INVALID_IDENTITY', 'ACCOUNT_DISABLED', 'ACCOUNT_INACTIVE', 'PROFILE_UNAVAILABLE', 'REVOKED_TOKEN'].includes(code) ? 401 : ['PRESENTER_ONLY', 'ACTOR_MISMATCH', 'NOTE_FORBIDDEN', 'NOTE_AUTHOR_ONLY', 'EXPORT_FORBIDDEN', 'CRM_ELIGIBILITY_REQUIRED', 'CONNECTION_EXISTS', 'STALE_CONNECTION', 'PROJECTS_ACCESS_REQUIRED'].includes(code) ? 403 : ['ROOM_NOT_FOUND', 'ARCHIVE_NOT_FOUND'].includes(code) ? 404 : 400;
        if (status === 429) res.set('Retry-After', '60');
        return res.status(status).json({ success: false, error: { code, message: known ? error?.message || code : 'The service is temporarily unavailable. Retry the same operation.' } });
    }
    function handler(fn) {
        return async (req, res) => {
            try { return await fn(req, res); } catch (error) { return failResponse(res, error); }
        };
    }

    const handlers = {
        capabilities: handler(async (req, res) => {
            const current = await identity(req);
            return ok(res, { uid: current.uid, isAdmin: current.isAdmin === true, isTeacher: current.isTeacher === true, moduleGrants: current.moduleGrants, crmEligible: current.crmEligible === true, realtimeOrigin: realtimeOrigin() });
        }),
        rooms: handler(async (req, res) => {
            const current = await identity(req);
            if (current.isAdmin !== true && current.moduleGrants?.projects !== true && current.isTeacher !== true) fail('PROJECTS_ACCESS_REQUIRED', 'Projects access is required to view room history.');
            return ok(res, await roomService.listRooms(current, { limit: req.query?.limit }));
        }),
        room: handler(async (req, res) => {
            const current = await identity(req);
            const room = await roomService.getRoom(req.params.roomId);
            if (!room) { const error = new Error('Room not found.'); error.code = 'ROOM_NOT_FOUND'; throw error; }
            const member = Object.values(room.slots).find(slot => slot.uid === current.uid);
            if (!member) { const error = new Error('Room access denied.'); error.code = 'ACTOR_MISMATCH'; throw error; }
            return ok(res, require('../../crm/presentation-demo/contracts.cjs').publicRoomSnapshot(room, current.uid));
        }),
        create: handler(async (req, res) => { const current = await identity(req); await roomService.throttle?.(current, 'create', 10); return ok(res, await roomService.createOrResume(current, { operationId: req.body?.operationId })); }),
        join: handler(async (req, res) => { const current = await identity(req); await roomService.throttle?.(current, 'join', 20); return ok(res, await roomService.join(current, req.body?.code || req.body?.roomId, { operationId: req.body?.operationId })); }),
        bootstrap: handler(async (req, res) => ok(res, await roomService.markBootstrap(await identity(req), req.params.roomId))),
        ticket: handler(async (req, res) => { const current = await identity(req); await roomService.throttle?.(current, 'ticket', 60); return ok(res, await roomService.issueTicket(current, req.params.roomId)); }),
        connect: handler(async (req, res) => ok(res, await connections.open(await identity(req), req.body?.ticket, { replaceExisting: req.body?.replaceExisting === true }))),
        heartbeat: handler(async (req, res) => ok(res, await connections.heartbeatById(req.body?.connectionId, await identity(req)))),
        input: handler(async (req, res) => ok(res, await connections.inputById(req.body?.connectionId, req.body?.command, await identity(req), { commandId: req.body?.commandId || null }))),
        disconnect: handler(async (req, res) => ok(res, await connections.closeById(req.body?.connectionId, await identity(req)))),
        readNotes: handler(async (req, res) => ok(res, await notes.readNotebook(await identity(req), req.params.roomId, req.params.uid || undefined))),
        saveNote: handler(async (req, res) => ok(res, await notes.savePage(await identity(req), req.params.roomId, req.params.uid || undefined, req.body))),
        deleteNote: handler(async (req, res) => ok(res, await notes.deletePage(await identity(req), req.params.roomId, req.params.uid || undefined, req.body))),
        end: handler(async (req, res) => {
            const current = await identity(req);
            const ended = await roomService.end(current, req.params.roomId, req.body?.reason || 'explicit');
            try {
                const finalized = await archives.archiveRoom(current, req.params.roomId);
                ended.archiveStatus = finalized?.status || 'archived';
            } catch (error) {
                // Terminal state is still committed when archive storage is
                // temporarily unavailable; the bounded maintenance runner
                // can retry the pending archive later.
                ended.archiveStatus = 'pending';
                ended.archiveErrorClass = error.code || 'ARCHIVE_ERROR';
                console.error('[presentation-demo] archive finalization failed', { roomId: req.params.roomId, code: ended.archiveErrorClass });
            }
            return ok(res, require('../../crm/presentation-demo/contracts.cjs').publicRoomSnapshot(ended, current.uid));
        }),
        archive: handler(async (req, res) => {
            const current = await identity(req);
            return ok(res, await archives.archiveRoom(current, req.params.roomId));
        }),
        readArchive: handler(async (req, res) => ok(res, await archives.readArchive(await identity(req), req.params.roomId))),
        exportPdf: handler(async (req, res) => {
            const current = await identity(req);
            if (Object.keys(req.query || {}).some(key => key !== 'scope')) fail('EXPORT_FORBIDDEN');
            await roomService.throttle?.(current, 'export', 6);
            const buffer = await pdf.exportPdf(current, req.params.roomId, req.query?.scope);
            res.set('Content-Type', 'application/pdf');
            res.set('Content-Disposition', `attachment; filename="bel-presentation-${req.params.roomId}.pdf"`);
            res.set('Cache-Control', 'private, no-store');
            res.set('X-Content-Type-Options', 'nosniff');
            return res.status(200).send(buffer);
        })
    };
    const gates = {
        create: ['admission', 'mutation'], join: ['mutation'], bootstrap: ['mutation'], ticket: ['mutation'],
        connect: ['mutation'], heartbeat: ['mutation'], input: ['mutation'], disconnect: ['mutation'],
        saveNote: ['mutation'], deleteNote: ['mutation'], end: ['mutation'],
        readArchive: ['archive'], exportPdf: ['archive'], readNotes: ['archive']
    };
    for (const [name, kinds] of Object.entries(gates)) {
        const original = handlers[name];
        handlers[name] = handler(async (req, res) => { for (const kind of kinds) assertOperationEnabled(kind); return original(req, res); });
    }
    return handlers;
}

function createPresentationDemoRouter(options = {}) {
    const express = options.express || require('express');
    const router = express.Router();
    const handlers = options.handlers || createPresentationDemoHandlers(options);
    const authMiddleware = options.authMiddleware || ((req, res, next) => next());
    router.use(authMiddleware);
    router.get('/capabilities', handlers.capabilities);
    router.get('/rooms', handlers.rooms);
    router.post('/rooms', handlers.create);
    router.get('/rooms/:roomId', handlers.room);
    router.post('/rooms/:roomId/bootstrap', handlers.bootstrap);
    router.post('/rooms/:roomId/ticket', handlers.ticket);
    router.post('/rooms/:roomId/end', handlers.end);
    router.post('/rooms/:roomId/archive', handlers.archive);
    router.get('/rooms/:roomId/archive', handlers.readArchive);
    // Express 5's path-to-regexp no longer accepts the Express 4 `:uid?`
    // suffix. Keep both forms explicit so the API works with the Functions
    // runtime and the local Express adapter alike.
    router.get('/rooms/:roomId/notes', handlers.readNotes);
    router.get('/rooms/:roomId/notes/:uid', handlers.readNotes);
    router.put('/rooms/:roomId/notes', handlers.saveNote);
    router.put('/rooms/:roomId/notes/:uid', handlers.saveNote);
    router.delete('/rooms/:roomId/notes', handlers.deleteNote);
    router.delete('/rooms/:roomId/notes/:uid', handlers.deleteNote);
    router.get('/rooms/:roomId/export.pdf', handlers.exportPdf);
    router.post('/join', handlers.join);
    router.post('/connect', handlers.connect);
    router.post('/heartbeat', handlers.heartbeat);
    router.post('/input', handlers.input);
    router.post('/disconnect', handlers.disconnect);
    return router;
}

module.exports = { createPresentationDemoHandlers, createPresentationDemoRouter };
