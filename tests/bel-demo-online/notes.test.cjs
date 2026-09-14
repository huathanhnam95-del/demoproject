const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomService, createMemoryRoomStores } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');

const admin = { uid: 'admin', accountStatus: 'active', isAdmin: true };
const p1 = { uid: 'p1', accountStatus: 'active', isAdmin: false };
const p2 = { uid: 'p2', accountStatus: 'active', isAdmin: false };

async function setup() {
    const roomService = createRoomService({ stores: createMemoryRoomStores(), clock: () => 1000, idFactory: () => 'room-notes', codeFactory: () => 'ABCD23' });
    const room = await roomService.createOrResume(admin);
    await roomService.join(p1, room.code);
    await roomService.join(p2, room.code);
    const notes = createNotebookService({ roomService, clock: () => 1000 });
    return { roomService, room, notes };
}

test('notebooks use page CAS and participant privacy while presenter can read all', async () => {
    const { room, notes } = await setup();
    const saved = await notes.savePage(p1, room.roomId, 'p1', { pageId: 'one', title: 'Idea', body: 'Keep this', expectedVersion: 0 });
    assert.equal(saved.version, 1);
    await assert.rejects(notes.savePage(p1, room.roomId, 'p1', { pageId: 'one', title: 'Stale', body: 'Overwrite', expectedVersion: 0 }), error => error.code === 'NOTE_CONFLICT');
    assert.deepEqual((await notes.readNotebook(p1, room.roomId, 'p1')).pages.map(page => page.body), ['Keep this']);
    await assert.rejects(notes.readNotebook(p2, room.roomId, 'p1'), error => error.code === 'NOTE_FORBIDDEN');
    assert.deepEqual((await notes.readNotebook({ ...admin }, room.roomId, 'p1')).pages.map(page => page.body), ['Keep this']);
});

test('note saves reset presenter inactivity only for the presenter author', async () => {
    const { roomService, room, notes } = await setup();
    await notes.savePage(p1, room.roomId, 'p1', { pageId: 'one', title: 'P', body: 'P', expectedVersion: 0 });
    assert.equal((await roomService.getRoom(room.roomId)).lastPresenterActivityAt, 1000);
    await notes.savePage(admin, room.roomId, 'p0', { pageId: 'one', title: 'Admin', body: 'A', expectedVersion: 0 });
    assert.equal((await roomService.getRoom(room.roomId)).lastPresenterActivityAt, 1000);
});
