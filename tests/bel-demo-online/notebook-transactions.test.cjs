const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const admin = { uid: 'admin', isAdmin: true, accountStatus: 'active' };
const person = { uid: 'person', accountStatus: 'active' };
async function fixture() {
    const roomService = createRoomService({ idFactory: () => 'notebook-atomic', codeFactory: () => 'ABCD23' });
    const room = await roomService.createOrResume(admin); await roomService.join(person, room.roomId);
    const notes = createNotebookService({ roomService });
    return { roomService, room, notes };
}
test('an ambiguous save replays the committed result once, including after End', async () => {
    const { roomService, room, notes } = await fixture();
    const page = { operationId: 'save-once', pageId: 'one', title: 'Vietnamese', body: 'hợp tác', expectedVersion: 0 };
    const first = await notes.savePage(person, room.roomId, person.uid, page);
    assert.deepEqual(await notes.savePage(person, room.roomId, person.uid, page), first);
    await roomService.end(admin, room.roomId);
    assert.deepEqual(await notes.savePage(person, room.roomId, person.uid, page), first);
    await assert.rejects(notes.savePage(person, room.roomId, person.uid, { ...page, body: 'changed' }), { code: 'OPERATION_ID_REUSED' });
    assert.equal((await notes.readNotebook(person, room.roomId, person.uid)).pages[0].version, 1);
});
test('concurrent save and End have one committed ordering and no successful late write', async () => {
    const { roomService, room, notes } = await fixture();
    const results = await Promise.allSettled([
        notes.savePage(person, room.roomId, person.uid, { operationId: 'racing', pageId: 'one', title: 'Once', body: 'saved before End', expectedVersion: 0 }),
        roomService.end(admin, room.roomId)
    ]);
    const pages = (await notes.readNotebook(person, room.roomId, person.uid)).pages;
    assert.equal(pages.length, results[0].status === 'fulfilled' ? 1 : 0, 'a rejected save must not have committed its page');
    await assert.rejects(notes.savePage(person, room.roomId, person.uid, { operationId: 'late', pageId: 'two', title: 'Late', body: 'late', expectedVersion: 0 }), { code: 'ROOM_ENDED' });
});
test('export snapshot uses all notebook revisions at a single read boundary', async () => {
    const { room, notes } = await fixture();
    await notes.savePage(person, room.roomId, person.uid, { operationId: 'first', pageId: 'one', title: 'First', body: 'one', expectedVersion: 0 });
    const snapshot = await notes.snapshotNotebooks(admin, room.roomId, [admin.uid, person.uid]);
    await notes.savePage(person, room.roomId, person.uid, { operationId: 'second', pageId: 'two', title: 'Second', body: 'two', expectedVersion: 0 });
    assert.equal(snapshot.notebooks.person.notebookRevision, 1);
    assert.equal(snapshot.notebooks.person.pages.length, 1);
    assert.equal((await notes.snapshotNotebooks(admin, room.roomId, [person.uid])).notebooks.person.notebookRevision, 2);
    await assert.rejects(notes.snapshotNotebooks(person, room.roomId, [admin.uid]), { code: 'NOTE_FORBIDDEN' });
});
