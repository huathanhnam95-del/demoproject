'use strict';

function createMaintenanceService({ roomService, archiveService, clock = () => Date.now() } = {}) {
    if (!roomService || !archiveService) throw new TypeError('roomService and archiveService are required');
    async function run({ limit = 50 } = {}) {
        const ended = await roomService.expireDue();
        const candidates = [...ended];
        if (typeof roomService.listPendingArchives === 'function') {
            const pending = await roomService.listPendingArchives(limit);
            const known = new Set(candidates.map(room => room.roomId));
            for (const room of pending) if (!known.has(room.roomId)) candidates.push(room);
        }
        const archived = [];
        for (const room of candidates.slice(0, limit)) {
            try { archived.push(await archiveService.archiveRoom(room.roomId)); } catch (error) { archived.push({ roomId: room.roomId, status: 'failed', errorClass: error.code || 'ARCHIVE_ERROR' }); }
        }
        const cleanup = await roomService.cleanupTransient?.(limit);
        return { now: clock(), expired: ended.length, attemptedArchives: archived.length, archived: archived.filter(item => item.status === 'archived').length, failedArchives: archived.filter(item => item.status === 'failed').length, removedTransient: cleanup?.removed || 0 };
    }
    return { run };
}

module.exports = { createMaintenanceService };
