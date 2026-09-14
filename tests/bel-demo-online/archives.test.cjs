const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomService, createMemoryRoomStores } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');

test('archive is idempotent, checksummed, and retains notebooks after terminal cleanup', async () => {
    const admin = { uid: 'admin', accountStatus: 'active', isAdmin: true };
    const p1 = { uid: 'p1', accountStatus: 'active', isAdmin: false };
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, clock: () => 1000, idFactory: () => 'room-archive', codeFactory: () => 'ABCD23' });
    const room = await roomService.createOrResume(admin);
    await roomService.join(p1, room.code);
    const notes = createNotebookService({ roomService, clock: () => 1000 });
    await notes.savePage(p1, room.roomId, 'p1', { pageId: 'one', title: 'Vietnamese', body: 'Xin chào', expectedVersion: 0 });
    await roomService.end(admin, room.roomId);
    const archives = createArchiveService({ roomService, notesService: notes, stores, clock: () => 1000 });
    const first = await archives.archiveRoom(room.roomId);
    const second = await archives.archiveRoom(room.roomId);
    assert.equal(first.checksum, second.checksum);
    assert.equal(first.status, 'archived');
    assert.equal((await archives.readArchive(p1, room.roomId)).notebooks.p1.pages[0].body, 'Xin chào');
});
