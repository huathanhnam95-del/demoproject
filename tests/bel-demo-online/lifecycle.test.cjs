const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createMaintenanceService } = require('../../functions/src/crm/presentation-demo/maintenance.cjs');

test('explicit end is terminal, archive preserves history, and a later room gets a new code', async () => {
    let now = 1000;
    const admin = { uid: 'admin', accountStatus: 'active', isAdmin: true };
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, clock: () => now, idFactory: (() => { let i = 0; return () => `room-life-${++i}`; })(), codeFactory: (() => { let i = 0; return () => i++ ? 'EFGH45' : 'ABCD23'; })() });
    const room = await roomService.createOrResume(admin);
    const notes = createNotebookService({ roomService, clock: () => now });
    await notes.savePage(admin, room.roomId, 'p0', { pageId: 'one', title: 'Retained', body: 'History', expectedVersion: 0 });
    await roomService.end(admin, room.roomId);
    const archives = createArchiveService({ roomService, notesService: notes, stores, clock: () => now });
    const maintenance = createMaintenanceService({ roomService, archiveService: archives, clock: () => now });
    assert.equal((await maintenance.run()).archived, 0);
    assert.equal((await archives.archiveRoom(room.roomId)).status, 'archived');
    const next = await roomService.createOrResume(admin);
    assert.notEqual(next.roomId, room.roomId);
    assert.notEqual(next.code, room.code);
    now += 1;
});
