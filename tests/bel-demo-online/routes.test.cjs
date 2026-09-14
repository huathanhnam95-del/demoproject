const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPdfService } = require('../../functions/src/crm/presentation-demo/pdf-service.cjs');
const { createPresentationDemoHandlers } = require('../../functions/src/routes/admin/presentation-demo.js');

function response() {
    return { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, set(name, value) { this.headers[name] = value; return this; } };
}

function setup() {
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, clock: () => 1000, idFactory: () => 'room-route', codeFactory: () => 'ABCD23' });
    const notes = createNotebookService({ roomService, clock: () => 1000 });
    const archives = createArchiveService({ roomService, notesService: notes, stores, clock: () => 1000 });
    const pdf = createPdfService({ archives });
    const connections = createConnectionService({ roomService, clock: () => 1000 });
    const handlers = createPresentationDemoHandlers({ roomService, connections, notes, archives, pdf, resolveIdentity: req => req.user });
    return { handlers, roomService };
}

test('HTTP handlers enforce current identity and presenter-only create/end', async () => {
    const { handlers } = setup();
    const denied = response();
    await handlers.create({ user: { uid: 'student', accountStatus: 'active', isAdmin: false }, body: {} }, denied);
    assert.equal(denied.statusCode, 403);
    const created = response();
    await handlers.create({ user: { uid: 'admin', accountStatus: 'active', isAdmin: true }, body: {} }, created);
    assert.equal(created.statusCode, 200);
    assert.equal(created.body.data.slots.p0.role, 'presenter');
});

test('HTTP handlers support participant join, ticket connection and reject participant export control', async () => {
    const { handlers, roomService } = setup();
    const admin = { uid: 'admin', accountStatus: 'active', isAdmin: true };
    const participant = { uid: 'student', accountStatus: 'active', isAdmin: false };
    const created = response();
    await handlers.create({ user: admin, body: {} }, created);
    const room = created.body.data;
    const joined = response();
    await handlers.join({ user: participant, body: { code: room.code } }, joined);
    assert.equal(joined.body.data.seatId, 'p1');
    const ticket = response();
    await handlers.ticket({ user: participant, params: { roomId: room.roomId } }, ticket);
    const connected = response();
    await handlers.connect({ user: participant, body: { ticket: ticket.body.data.ticket } }, connected);
    assert.equal(connected.body.data.seatId, 'p1');
    const end = response();
    await handlers.end({ user: participant, params: { roomId: room.roomId }, body: {} }, end);
    assert.equal(end.statusCode, 403);
    assert.equal((await roomService.getRoom(room.roomId)).lifecycle, 'reception');
});
