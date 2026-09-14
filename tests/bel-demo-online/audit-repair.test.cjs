const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createMemoryRoomStores,
    createRoomService
} = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPdfService } = require('../../functions/src/crm/presentation-demo/pdf-service.cjs');
const { createPresentationDemoHandlers } = require('../../functions/src/routes/admin/presentation-demo.js');
const { assertActiveIdentity, serverIdentityFromAuth } = require('../../functions/src/crm/presentation-demo/identity.cjs');

const admin = { uid: 'admin', email: 'admin@example.com', accountStatus: 'active', isAdmin: true, isTeacher: true };
const p1 = { uid: 'p1', email: 'p1@example.com', accountStatus: 'active', isTeacher: true };
const p2 = { uid: 'p2', email: 'p2@example.com', accountStatus: 'active', isTeacher: true };

function response() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
        send(value) { this.body = value; return this; },
        set(name, value) { this.headers[name] = value; return this; }
    };
}

function setup() {
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({
        stores,
        clock: () => 1000,
        idFactory: () => 'room-auditfix',
        codeFactory: () => 'ABCD23'
    });
    const notes = createNotebookService({ roomService, clock: () => 1000 });
    const archives = createArchiveService({ roomService, notesService: notes, stores, clock: () => 1000 });
    const connections = createConnectionService({ roomService, clock: () => 1000 });
    const handlers = createPresentationDemoHandlers({
        roomService,
        connections,
        notes,
        archives,
        pdf: createPdfService({ archives, roomService, notesService: notes }),
        resolveIdentity: req => req.user
    });
    return { stores, roomService, notes, archives, connections, handlers };
}

test('connection commands require the current authenticated owner and current capability', async () => {
    const { roomService, connections, handlers } = setup();
    const room = await roomService.createOrResume(admin);
    const ticket = await roomService.issueTicket(admin, room.roomId);
    const connected = await connections.open(admin, ticket);
    const outsider = response();
    await handlers.input({ user: { ...p1 }, body: { connectionId: connected.connectionId, command: { type: 'slide', seq: 1, room: 'J', slide: 999 } } }, outsider);
    assert.equal(outsider.statusCode, 403);
    const disabled = response();
    await handlers.heartbeat({ user: { ...admin, disabled: true }, body: { connectionId: connected.connectionId } }, disabled);
    assert.equal(disabled.statusCode, 401);
});

test('connect returns only a public viewer DTO and never a raw runtime', async () => {
    const { roomService, notes, handlers } = setup();
    const room = await roomService.createOrResume(admin);
    await roomService.join(p1, room.roomId);
    await notes.savePage(p1, room.roomId, p1.uid, { pageId: 'secret', title: 'Private', body: 'OTHER_USER_PRIVATE_MARKER', expectedVersion: 0 });
    const ticket = response();
    await handlers.ticket({ user: p1, params: { roomId: room.roomId } }, ticket);
    const connected = response();
    await handlers.connect({ user: p1, body: { ticket: ticket.body.data.ticket } }, connected);
    assert.equal(connected.statusCode, 200);
    assert.equal(Object.hasOwn(connected.body.data, 'runtime'), false);
    assert.doesNotMatch(JSON.stringify(connected.body), /OTHER_USER_PRIVATE_MARKER/);
});

test('missing Firebase CRM profile fails closed at server identity admission', () => {
    const identity = serverIdentityFromAuth({ decodedToken: { uid: 'firebase-only' }, profile: null });
    assert.throws(() => assertActiveIdentity(identity), error => error.code === 'PROFILE_UNAVAILABLE');
});

test('late membership cannot be erased by a presenter runtime cached before the join', async () => {
    const { roomService, connections } = setup();
    const room = await roomService.createOrResume(admin);
    const presenterTicket = await roomService.issueTicket(admin, room.roomId);
    await connections.open(admin, presenterTicket);
    await roomService.join(p1, room.roomId);
    const participantTicket = await roomService.issueTicket(p1, room.roomId);
    const participant = await connections.open(p1, participantTicket);
    assert.equal(participant.seatId, 'p1');
    assert.equal((await roomService.getRoom(room.roomId)).slots.p1.uid, p1.uid);
});

test('presenter transition is blocked until every participant completed bootstrap', async () => {
    const { roomService, connections } = setup();
    const room = await roomService.createOrResume(admin);
    await roomService.join(p1, room.roomId);
    await roomService.join(p2, room.roomId);
    await roomService.join({ uid: 'p3', email: 'p3@example.com', accountStatus: 'active', isTeacher: true }, room.roomId);
    const ticket = await roomService.issueTicket(admin, room.roomId);
    const presenter = await connections.open(admin, ticket);
    await assert.rejects(connections.input(presenter, { type: 'transition', seq: 1, to: 'playing' }), error => error.code === 'PARTICIPANTS_NOT_READY');
});

test('notebook writes are author-only and terminal rooms reject writes before mutation', async () => {
    const { roomService, notes } = setup();
    const room = await roomService.createOrResume(admin);
    await roomService.join(p1, room.roomId);
    await assert.rejects(notes.savePage(admin, room.roomId, p1.uid, { pageId: 'other', title: 'Nope', body: 'NO', expectedVersion: 0 }), error => error.code === 'NOTE_AUTHOR_ONLY');
    await notes.savePage(p1, room.roomId, p1.uid, { pageId: 'owned', title: 'Original', body: 'ORIGINAL', expectedVersion: 0 });
    await roomService.end(admin, room.roomId);
    await assert.rejects(notes.savePage(p1, room.roomId, p1.uid, { pageId: 'owned', title: 'After', body: 'ACKNOWLEDGED_AFTER_END', expectedVersion: 1 }), error => error.code === 'ROOM_ENDED');
    assert.equal((await notes.readNotebookByUid(room.roomId, p1.uid)).pages[0].body, 'ORIGINAL');
});

test('PDF embeds Roboto, maps Unicode text, and paginates long notes', async () => {
    const { roomService, notes, archives } = setup();
    const room = await roomService.createOrResume(admin);
    await roomService.join(p1, room.roomId);
    const body = `${'dài '.repeat(2200)} hợp tác — tiếng Việt`;
    await notes.savePage(p1, room.roomId, p1.uid, { pageId: 'unicode', title: 'Tiếng Việt', body, expectedVersion: 0 });
    await roomService.end(admin, room.roomId);
    await archives.archiveRoom(room.roomId);
    const pdf = await createPdfService({ archives, roomService, notesService: notes }).exportPdf(admin, room.roomId);
    const source = pdf.toString('latin1');
    assert.match(source, /\/FontFile2/);
    assert.match(source, /\/BaseFont \/Roboto/);
    assert.match(source, /\/ToUnicode/);
    assert.ok((source.match(/\/Type \/Page\b/g) || []).length >= 2);
});
