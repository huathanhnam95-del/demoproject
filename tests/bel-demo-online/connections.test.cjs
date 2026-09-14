const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomService, createMemoryRoomStores } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');

const admin = { uid: 'admin', accountStatus: 'active', isAdmin: true };
const user = { uid: 'user-1', accountStatus: 'active', isAdmin: false };

async function setup() {
    const roomService = createRoomService({ stores: createMemoryRoomStores(), clock: () => 1000, idFactory: () => 'room-abc123', codeFactory: () => 'ABCD23' });
    const room = await roomService.createOrResume(admin);
    await roomService.join(user, room.code);
    const connections = createConnectionService({ roomService, clock: () => 1000 });
    return { roomService, connections, room };
}

test('connection admission consumes a server ticket and fences stale generations', async () => {
    const { roomService, connections, room } = await setup();
    const ticket1 = await roomService.issueTicket(user, room.roomId);
    const first = await connections.open(user, ticket1);
    assert.equal(first.seatId, 'p1');
    const ticket2 = await roomService.issueTicket(user, room.roomId);
    await assert.rejects(connections.open(user, ticket2), error => error.code === 'CONNECTION_EXISTS');
    const replacement = await connections.open(user, ticket2, { replaceExisting: true });
    assert.equal(replacement.generation, first.generation + 1);
    await assert.rejects(connections.input(first, { type: 'move', seq: 1, dx: 1, dy: 0 }), error => error.code === 'STALE_CONNECTION');
    await assert.rejects(connections.heartbeat(first), error => error.code === 'STALE_CONNECTION');
    const accepted = await connections.input(replacement, { type: 'move', seq: 1, dx: 1, dy: 0 });
    assert.equal(accepted.accepted, true);
});

test('goodbye is generation-bound and does not end or pause the room', async () => {
    const { connections, room } = await setup();
    const ticket = await connections.roomService.issueTicket(user, room.roomId);
    const context = await connections.open(user, ticket);
    await connections.close(context);
    const current = await connections.roomService.getRoom(room.roomId);
    assert.equal(current.lifecycle, 'reception');
    assert.equal(current.slots.p1.connected, false);
});

test('per-room serialization prevents an older heartbeat snapshot from fencing a newer input', async () => {
    const { roomService, connections, room } = await setup();
    const ticket = await roomService.issueTicket(user, room.roomId);
    const context = await connections.open(user, ticket);
    const results = await Promise.all([
        connections.heartbeat(context),
        connections.input(context, { type: 'move', seq: 1, dx: 1, dy: 0 }),
        connections.heartbeat(context)
    ]);
    assert.equal(results[1].accepted, true);
    assert.equal((await roomService.getRoom(room.roomId)).lastCommandSeq.p1, 1);
});
