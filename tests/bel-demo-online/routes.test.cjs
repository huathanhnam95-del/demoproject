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

test('rollback gates stop admission and saves while retaining permitted private reads', async () => {
    const keys = ['PRESENTATION_DEMO_ADMISSION_ENABLED', 'PRESENTATION_DEMO_MUTATIONS_ENABLED', 'PRESENTATION_DEMO_ARCHIVED_ACCESS_ENABLED'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const { handlers } = setup(), user = { uid: 'admin', accountStatus: 'active', isAdmin: true };
    try {
        const created = response(); await handlers.create({ user, body: {} }, created);
        const roomId = created.body.data.roomId;
        process.env.PRESENTATION_DEMO_ADMISSION_ENABLED = '0';
        const blocked = response(); await handlers.create({ user, body: {} }, blocked);
        assert.equal(blocked.statusCode, 503);
        process.env.PRESENTATION_DEMO_MUTATIONS_ENABLED = '0';
        const save = response(); await handlers.saveNote({ user, params: { roomId }, body: { pageId: 'blocked', title: 'x', body: 'x', expectedVersion: 0 } }, save);
        assert.equal(save.body.error.code, 'SERVICE_RECOVERY');
        const read = response(); await handlers.readNotes({ user, params: { roomId } }, read);
        assert.equal(read.statusCode, 200); assert.equal(read.body.data.pages.length, 0);
        process.env.PRESENTATION_DEMO_ARCHIVED_ACCESS_ENABLED = '0';
        const denied = response(); await handlers.readNotes({ user, params: { roomId } }, denied);
        assert.equal(denied.statusCode, 503);
    } finally { for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
});

test('provider failures return retryable service errors without internal details', async () => {
    const { handlers, roomService } = setup();
    roomService.getRoom = async () => { throw Object.assign(new Error('private provider path and request data'), { code: 14 }); };
    const result = response();
    await handlers.room({ user: { uid: 'admin', accountStatus: 'active', isAdmin: true }, params: { roomId: 'room-route' } }, result);
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.code, 'OUTCOME_UNKNOWN');
    assert.doesNotMatch(JSON.stringify(result.body), /private provider/);
});

test('capabilities expose only an operator-configured exact HTTPS realtime origin', async () => {
    const before = process.env.PRESENTATION_DEMO_REALTIME_ORIGIN;
    const { handlers } = setup(), req = { user: { uid: 'admin', accountStatus: 'active', isAdmin: true } };
    try {
        process.env.PRESENTATION_DEMO_REALTIME_ORIGIN = 'https://bel-gateway.example';
        const valid = response(); await handlers.capabilities(req, valid);
        assert.equal(valid.body.data.realtimeOrigin, 'https://bel-gateway.example');
        process.env.PRESENTATION_DEMO_REALTIME_ORIGIN = 'https://bel-gateway.example/?token=bad';
        const invalid = response(); await handlers.capabilities(req, invalid);
        assert.equal(invalid.statusCode, 503);
        assert.doesNotMatch(JSON.stringify(invalid.body), /token=bad/);
    } finally { if (before === undefined) delete process.env.PRESENTATION_DEMO_REALTIME_ORIGIN; else process.env.PRESENTATION_DEMO_REALTIME_ORIGIN = before; }
});

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
