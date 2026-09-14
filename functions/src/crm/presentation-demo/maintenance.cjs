'use strict';

function createMaintenanceService({ roomService, archiveService, clock = () => Date.now() } = {}) {
    if (!roomService || !archiveService) throw new TypeError('roomService and archiveService are required');
    async function run({ limit = 50 } = {}) {
        const ended = await roomService.expireDue();
        const archived = [];
        for (const room of ended.slice(0, limit)) {
            try { archived.push(await archiveService.archiveRoom(room.roomId)); } catch (error) { archived.push({ roomId: room.roomId, status: 'failed', errorClass: error.code || 'ARCHIVE_ERROR' }); }
        }
        return { now: clock(), expired: ended.length, archived: archived.filter(item => item.status === 'archived').length, failedArchives: archived.filter(item => item.status === 'failed').length };
    }
    return { run };
}

module.exports = { createMaintenanceService };
