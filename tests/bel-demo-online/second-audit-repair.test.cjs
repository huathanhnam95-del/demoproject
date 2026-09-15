const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { createRoomState } = require('../../functions/src/crm/presentation-demo/contracts.cjs');
const { AuthoritativeRuntime } = require('../../functions/src/crm/presentation-demo/runtime.cjs');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPresentationDemoHandlers } = require('../../functions/src/routes/admin/presentation-demo.js');

const admin = { uid: 'admin', email: 'admin@example.com', accountStatus: 'active', isAdmin: true, isTeacher: true };
const participant = { uid: 'p1', email: 'p1@example.com', accountStatus: 'active', isTeacher: true };
const participant2 = { uid: 'p2', email: 'p2@example.com', accountStatus: 'active', isTeacher: true };
const participant3 = { uid: 'p3', email: 'p3@example.com', accountStatus: 'active', isTeacher: true };

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

async function memoryRoomWithConnections({ now = 1000 } = {}) {
    let current = now;
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, clock: () => current, idFactory: () => 'room-online-audit', codeFactory: () => 'ABCD23', ticketFactory: (() => { let index = 0; return () => `ticket-${++index}`; })() });
    const room = await roomService.createOrResume(admin);
    await roomService.join(participant, room.roomId);
    await roomService.join(participant2, room.roomId);
    await roomService.join(participant3, room.roomId);
    const gatewayA = createConnectionService({ roomService, clock: () => current, gatewayId: 'gateway-a' });
    const gatewayB = createConnectionService({ roomService, clock: () => current, gatewayId: 'gateway-b' });
    async function open(service, actor, replaceExisting = false) {
        const ticket = await roomService.issueTicket(actor, room.roomId);
        return service.open(actor, ticket, { replaceExisting });
    }
    return { get now() { return current; }, set now(value) { current = value; }, room, roomService, gatewayA, gatewayB, open, actors: { admin, p1: participant, p2: participant2, p3: participant3 } };
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

test('different gateways relay live seats without stealing the runtime owner', async () => {
    const online = await memoryRoomWithConnections();
    const p1 = await online.open(online.gatewayA, participant);
    const p2 = await online.open(online.gatewayB, participant2);
    await online.gatewayA.heartbeat(p1, participant);
    const moved = await online.gatewayB.input(p2, { type: 'move', seq: 1, dx: 1, dy: 0 }, participant2, { commandId: 'p2-move-1' });
    assert.equal(moved.accepted, true);
    const replacement = await online.open(online.gatewayB, participant2, true);
    assert.notEqual(replacement.generation, p2.generation);
    await assert.doesNotReject(() => online.gatewayA.heartbeat(p1, participant));
});

test('runtime receipts bind command payloads and connection generations', async () => {
    const online = await memoryRoomWithConnections();
    const first = await online.open(online.gatewayA, participant);
    const original = { type: 'move', seq: 1, dx: 1, dy: 0 };
    await online.gatewayA.input(first, original, participant, { commandId: 'same-command' });
    await assert.rejects(
        online.gatewayA.input(first, { type: 'move', seq: 1, dx: 0, dy: 1 }, participant, { commandId: 'same-command' }),
        error => error.code === 'COMMAND_RECEIPT_CONFLICT'
    );
    const replacement = await online.open(online.gatewayA, participant, true);
    assert.notEqual(replacement.generation, first.generation);
    await assert.rejects(
        online.gatewayA.input(first, original, participant, { commandId: 'same-command' }),
        error => error.code === 'STALE_CONNECTION'
    );
});

test('silent seats expire on the authoritative heartbeat lease', () => {
    let now = 1000;
    const runtime = new AuthoritativeRuntime(populatedRoom(now), { clock: () => now });
    runtime.connect('p0', null, { now });
    runtime.connect('p1', null, { now });
    now += 15000;
    runtime.heartbeat('p0', 1, now);
    now += 6000;
    runtime.tick(now);
    assert.equal(runtime.snapshot().slots.p0.connected, true);
    assert.equal(runtime.snapshot().slots.p1.connected, false);
    assert.throws(() => runtime.heartbeat('p1', 1, now), error => error.code === 'STALE_CONNECTION');
});

test('full route mechanics reject direct jumps, self matches and unearned activity completion', () => {
    let now = 1000;
    const room = populatedRoom(now);
    room.lifecycle = 'playing';
    for (const slot of Object.values(room.slots)) if (slot.uid) Object.assign(slot, { connected: true, connectionGeneration: 1, scene: 'J', instanceId: 'J', lastSeenAt: now });
    const runtime = new AuthoritativeRuntime(room, { clock: () => now });
    assert.throws(() => runtime.command('p0', 1, { type: 'slide', seq: 1, room: 'J', slide: 21 }), { code: 'PROGRESSION_REQUIRED' });
    const world = runtime.room.gameplay;
    // Place a unit fixture beside the real cube target; the command must
    // claim that object through the same proximity reducer as the browser.
    Object.assign(world.players.p1, { x: 430, y: 190 });
    runtime.command('p1', 1, { type: 'world', seq: 1, action: 'interact', payload: { instance: 'J', target: 'cube-0' } });
    assert.equal(world.cubes.cubes[0].owner, 'p1');
    assert.throws(() => runtime.command('p1', 1, { type: 'world', seq: 2, action: 'interact', payload: { instance: 'J', target: 'p1' } }), /Walk closer/);
    assert.deepEqual(world.cubes.pairs, [false, false, false]);

    for (const slot of Object.values(room.slots)) { slot.scene = 'F'; slot.instanceId = 'F'; slot.activity.ready = true; }
    const bridge = new AuthoritativeRuntime(room, { clock: () => now });
    bridge.command('p0', 1, { type: 'world', seq: 1, action: 'activity', payload: { instance: 'F', generation: 0, action: 'start' } });
    assert.throws(() => bridge.command('p1', 1, { type: 'world', seq: 1, action: 'interact', payload: { instance: 'F', generation: 0, target: 'bridge-next' } }), /Walk closer/);
    now += 60000;
    for (const slot of Object.values(bridge.room.slots)) if (slot.uid) slot.lastSeenAt = now;
    bridge.tick(now);
    assert.equal(bridge.room.gameplay.bridge.phase, 'attempt');
    Object.assign(bridge.room.gameplay.players.p1, { x: 500, y: 260 });
    assert.throws(() => bridge.command('p1', 1, { type: 'world', seq: 1, action: 'interact', payload: { instance: 'F', generation: 0, target: 'bridge-next' } }), /Bring a plank/);
    assert.equal(bridge.room.gameplay.bridge.placed, 0);
    const w = bridge.room.gameplay;
    Object.assign(w.players.p1, { x: 500, y: 260, carry: 'plank-0' }); w.bridge.planks[0].owner = 'p1';
    bridge.command('p1', 1, { type: 'world', seq: 1, action: 'interact', payload: { instance: 'F', generation: 0, target: 'bridge-next' } });
    assert.equal(w.bridge.placed, 1);
    w.players.p1.carry = 'plank-2'; w.bridge.planks[2].owner = 'p1';
    assert.throws(() => bridge.command('p1', 1, { type: 'world', seq: 2, action: 'interact', payload: { instance: 'F', generation: 0, target: 'bridge-next' } }), /elsewhere/);
    assert.equal(w.players.p1.carry, 'plank-2');
    now += 120000;
    for (const slot of Object.values(bridge.room.slots)) if (slot.uid) slot.lastSeenAt = now;
    bridge.tick(now);
    assert.equal(w.reversal.phase, 'gathering');
});

test('runtime rejects expiry and follows the authored deck and timed activity progression', () => {
    let now = 1000;
    const room = populatedRoom(now);
    room.lifecycle = 'playing'; room.startedAt = now;
    room.slots.p0.scene = 'A'; room.slots.p0.instanceId = 'A';
    const runtime = new AuthoritativeRuntime(room, { clock: () => now });
    runtime.connect('p0', null, { now }); runtime.room.slots.p0.activity.ready = true;
    Object.assign(runtime.room.gameplay.players.p0, { x: 631, y: 175 });
    runtime.command('p0', 1, { type: 'presentation', seq: 1, action: 'open' });
    runtime.command('p0', 1, { type: 'slide', seq: 2, room: 'A', slide: 2 });
    runtime.command('p0', 1, { type: 'slide', seq: 3, room: 'A', slide: 3 });
    runtime.command('p0', 1, { type: 'presentation', seq: 4, action: 'close' });
    assert.equal(runtime.room.gameplay.unlocked.A, true);
    for (const slot of Object.values(runtime.room.slots)) if (slot.uid) {
        Object.assign(slot, { connected: true, connectionGeneration: 1, lastSeenAt: now, scene: 'F', instanceId: 'F' }); slot.activity.ready = true;
        Object.assign(runtime.room.gameplay.players[slot.slotId], { scene: 'F', instance: 'F', x: 350 + Number(slot.slotId[1]) * 68, y: 375 });
    }
    runtime.command('p0', 1, { type: 'activity', seq: 5, action: 'bridge', payload: { op: 'start', instance: 'F', generation: 0 } });
    now += 1000; runtime.tick(now);
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
    const browserApp = fs.readFileSync('public/js/presentation-demo/app.mjs', 'utf8');
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
    assert.match(durable, /canonical|mailbox|outbox/i);
    assert.match(transport, /commandId|requestId/);
    assert.match(notebook, /saveGeneration|pendingSave|new page/i);
    assert.match(server, /limit:\s*['"](?:256|512)kb['"]/i);
    assert.match(browserApp, /dataset\.deckSlide = String\(currentRoom\.deck\?\.slide \|\| 0\)/);
});

test('active teachers can read their own room history and archive exposes readable notes', async () => {
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, idFactory: () => 'room-teacher-history', codeFactory: () => 'ABCD23' });
    const notes = createNotebookService({ roomService });
    const archives = createArchiveService({ roomService, notesService: notes, stores });
    const handlers = createPresentationDemoHandlers({ roomService, connections: {}, notes, archives, pdf: { exportPdf: async () => Buffer.from('') }, resolveIdentity: req => req.user });
    const teacher = { ...participant, moduleGrants: {} };
    const room = await roomService.createOrResume(admin);
    await roomService.join(teacher, room.roomId);
    const rooms = response();
    await handlers.rooms({ user: teacher, query: {} }, rooms);
    assert.equal(rooms.statusCode, 200);
    await notes.savePage(teacher, room.roomId, teacher.uid, { pageId: 'history', title: 'History', body: 'Vietnamese hợp tác', expectedVersion: 0 });
    await roomService.end(admin, room.roomId);
    await archives.archiveRoom(admin, room.roomId);
    const archive = await archives.readArchive(teacher, room.roomId);
    assert.equal(archive.notebooks[teacher.uid].pages[0].body, 'Vietnamese hợp tác');
});

test('fresh and rehydrated room cubes render before notebook initialization', async () => {
    const { drawCubes } = await import('../../public/prototypes/bel-working-as-equals-demo/world/activity-renderer.mjs');
    const fresh = new AuthoritativeRuntime(populatedRoom());
    // Existing persisted rooms carry cubeIndex; the native renderer consumes
    // index. Exercise both initialization and migration through the real draw.
    const persisted = fresh.rawState();
    for (const cube of persisted.gameplay.cubes.cubes) delete cube.index;
    const restored = new AuthoritativeRuntime(JSON.parse(JSON.stringify(persisted)));
    for (const runtime of [fresh, restored]) {
        const draws = [];
        const canvas = { fillRect() {}, fillText() {}, drawImage(...args) { draws.push(args); } };
        drawCubes(canvas, runtime.snapshot().gameplay, { objectives: [] }, { J: 'sprite-atlas' }, 1000);
        assert.equal(draws.length, 6, 'all six authoritative cubes must render');
        assert.deepEqual(draws.map(args => args.slice(1, 3)), [[694, 371], [811, 371], [925, 371], [689, 438], [809, 438], [926, 438]]);
        assert.ok(draws.every(args => args.slice(1).every(Number.isFinite)), 'sprite and world coordinates must be finite');
    }
});

test('notebook reload restores the active unsaved page and its local draft', async () => {
    const storage = new Map();
    const originalGlobals = { document: global.document, window: global.window, localStorage: global.localStorage };
    const originalNow = Date.now;
    const installBrowser = () => {
        const created = [];
        class FakeElement {
            constructor(tagName = 'div') { this.tagName = tagName; this.value = ''; this.textContent = ''; this.children = []; this.listeners = {}; }
            setAttribute() {}
            before() {}
            replaceChildren(...children) { this.children = children; }
            append(child) { this.children.push(child); }
            addEventListener(type, listener) { this.listeners[type] = listener; }
            click() { this.listeners.click?.(); }
        }
        global.document = { createElement(tagName) { const element = new FakeElement(tagName); created.push(element); return element; } };
        global.window = { setTimeout, clearTimeout };
        global.localStorage = {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        };
        return { created, elements: { title: new FakeElement('input'), body: new FakeElement('textarea'), status: new FakeElement(), save: new FakeElement('button') } };
    };
    const transport = { readNotes: async () => ({ pages: [{ id: 'main', title: 'Main', body: 'saved', version: 1 }] }) };
    try {
        Date.now = () => 123456;
        const { bindNotebook } = await import('../../public/js/presentation-demo/notebook.mjs');
        const firstBrowser = installBrowser();
        const first = bindNotebook({ transport, roomId: 'room-reload', identity: { uid: 'p1' }, elements: firstBrowser.elements });
        await first.load();
        const newPage = firstBrowser.created.find(element => element.tagName === 'button' && element.textContent === 'New page');
        newPage.click();
        const firstSelect = firstBrowser.created.find(element => element.tagName === 'select');
        const activePageId = firstSelect.value;
        firstBrowser.elements.title.value = 'Unsaved page';
        firstBrowser.elements.body.value = 'Unsaved Vietnamese: hợp tác';
        first.persistDraft();

        const secondBrowser = installBrowser();
        const second = bindNotebook({ transport, roomId: 'room-reload', identity: { uid: 'p1' }, elements: secondBrowser.elements });
        await second.load();
        const secondSelect = secondBrowser.created.find(element => element.tagName === 'select');
        assert.equal(secondSelect.value, activePageId);
        assert.ok(secondSelect.children.some(option => option.value === activePageId && option.textContent.startsWith('Unsaved')));
        assert.equal(secondBrowser.elements.body.value, 'Unsaved Vietnamese: hợp tác');
        assert.match(secondBrowser.elements.status.textContent, /unsaved draft restored/i);
    } finally {
        Date.now = originalNow;
        global.document = originalGlobals.document;
        global.window = originalGlobals.window;
        global.localStorage = originalGlobals.localStorage;
    }
});
