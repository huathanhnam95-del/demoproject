const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { createRoomState } = require('../../functions/src/crm/presentation-demo/contracts.cjs');
const { AuthoritativeRuntime } = require('../../functions/src/crm/presentation-demo/runtime.cjs');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPresentationDemoHandlers } = require('../../functions/src/routes/admin/presentation-demo.js');

const admin = { uid: 'admin', email: 'admin@example.com', accountStatus: 'active', isAdmin: true, isTeacher: true };
const participant = { uid: 'p1', email: 'p1@example.com', accountStatus: 'active', isTeacher: true };

function populatedRoom(now = 1000) {
    const room = createRoomState({ roomId: 'room-second-audit', code: 'ABCD23', presenterUid: admin.uid, now });
    room.slots.p1.uid = participant.uid;
    room.slots.p1.joinedAt = now;
    room.slots.p2.uid = 'p2';
    room.slots.p2.joinedAt = now;
    room.slots.p3.uid = 'p3';
    room.slots.p3.joinedAt = now;
    return room;
}

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
        send(value) { this.body = value; return this; },
        set() { return this; }
    };
}

test('refresh never revives a superseded connection generation', () => {
    let now = 1000;
    const runtime = new AuthoritativeRuntime(populatedRoom(now), { clock: () => now });
    runtime.connect('p1', null, { now });
    const persisted = runtime.rawState();
    persisted.slots.p1.connected = false;
    persisted.slots.p1.connectionGeneration += 1;
    persisted.revision += 1;
    runtime.refreshRoom(persisted);
    assert.equal(runtime.snapshot().slots.p1.connected, false);
    assert.equal(runtime.rawState().slots.p1.connectionGeneration, 2);
});

test('runtime rejects expiry and follows the authored deck and timed activity progression', () => {
    let now = 1000;
    const room = populatedRoom(now);
    room.lifecycle = 'playing';
    room.startedAt = now;
    const runtime = new AuthoritativeRuntime(room, { clock: () => now });
    runtime.connect('p0', null, { now });
    runtime.command('p0', 1, { type: 'slide', seq: 1, room: 'A', slide: 1 }, now);
    runtime.command('p0', 1, { type: 'slide', seq: 2, room: 'A', slide: 3 }, now);
    runtime.command('p0', 1, { type: 'slide', seq: 3, room: 'C', slide: 4 }, now);
    runtime.command('p0', 1, { type: 'activity', seq: 4, action: 'bridge', payload: { op: 'start' } }, now);
    now += 1000;
    runtime.tick(now);
    assert.equal(runtime.snapshot().gameplay.bridge.remaining, 59000);
    const expired = new AuthoritativeRuntime({ ...runtime.rawState(), expiresAt: now - 1 }, { clock: () => now });
    assert.throws(() => expired.connect('p0', null, { now }), error => error.code === 'ROOM_EXPIRED');
});

test('deleted pages advance their CAS version and cannot be recreated from a stale version', async () => {
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, idFactory: () => 'room-notebook-cas', codeFactory: () => 'ABCD23' });
    const room = await roomService.createOrResume(admin);
    await roomService.join(participant, room.roomId);
    const notes = createNotebookService({ roomService });
    await notes.savePage(participant, room.roomId, participant.uid, { pageId: 'one', title: 'One', body: 'body', expectedVersion: 0 });
    await notes.deletePage(participant, room.roomId, participant.uid, { pageId: 'one', expectedVersion: 1 });
    await assert.rejects(notes.savePage(participant, room.roomId, participant.uid, { pageId: 'one', title: 'stale', body: 'resurrection', expectedVersion: 1 }), error => error.code === 'NOTE_CONFLICT');
});

test('demoted presenters cannot archive aggregate peer content', async () => {
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, idFactory: () => 'room-demotion', codeFactory: () => 'ABCD23' });
    const notes = createNotebookService({ roomService });
    const archives = createArchiveService({ roomService, notesService: notes, stores });
    const handlers = createPresentationDemoHandlers({ roomService, connections: {}, notes, archives, pdf: { exportPdf: async () => Buffer.from('') }, resolveIdentity: req => req.user });
    const room = await roomService.createOrResume(admin);
    await roomService.join(participant, room.roomId);
    await notes.savePage(participant, room.roomId, participant.uid, { pageId: 'secret', title: 'Secret', body: 'PEER_PRIVATE', expectedVersion: 0 });
    await roomService.end(admin, room.roomId);
    const demoted = response();
    await handlers.archive({ user: { ...admin, isAdmin: false, accountStatus: 'active' }, params: { roomId: room.roomId } }, demoted);
    assert.equal(demoted.statusCode, 403);
    assert.equal(stores.archives.has(room.roomId), false);
});

test('durable and browser boundaries declare CAS, page partitioning, reconnect, measured PDF widths, and the runtime namespace', () => {
    const durable = fs.readFileSync('functions/src/crm/presentation-demo/firebase-stores.cjs', 'utf8');
    const transport = fs.readFileSync('public/js/presentation-demo/transport.mjs', 'utf8');
    const server = fs.readFileSync('backend/presentation-demo/server.cjs', 'utf8');
    const notebook = fs.readFileSync('public/js/presentation-demo/notebook.mjs', 'utf8');
    const pdf = fs.readFileSync('functions/src/crm/presentation-demo/pdf-service.cjs', 'utf8');
    const orchestrator = fs.readFileSync('scripts/bel-demo/start-online-emulators.cjs', 'utf8');
    assert.match(durable, /expectedRevision/);
    assert.match(durable, /expectedGenerations/);
    assert.match(durable, /presentationDemoNotebookPages/);
    assert.match(durable, /presentationDemoArchivePages/);
    assert.match(transport, /addEventListener\(['"]close['"]/);
    assert.match(transport, /reconnect/);
    assert.match(server, /Access-Control-Allow-Headers/);
    assert.match(server, /Access-Control-Allow-Methods/);
    assert.match(notebook, /flushDraft/);
    assert.match(notebook, /pageId/);
    assert.match(pdf, /glyphWidths|\/W\s*\[/);
    assert.match(orchestrator, /default-rtdb/);
});
