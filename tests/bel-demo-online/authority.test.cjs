const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomState } = require('../../functions/src/crm/presentation-demo/contracts.cjs');
const { createMemoryAuthorityStore } = require('../../functions/src/crm/presentation-demo/authority-store.cjs');
const { createRoomAuthority } = require('../../functions/src/crm/presentation-demo/authority-service.cjs');

test('RTDB sparse reveal arrays rehydrate as a Firestore-safe map', () => {
    const { hydrate } = require('../../functions/src/crm/presentation-demo/authority-store.cjs');
    const room = createRoomState({ roomId: 'array-room', code: 'ABCD23', presenterUid: 'admin', now: 1000 });
    room.deck.steps = []; room.deck.steps[2] = 1; room.deck.steps[4] = 3;
    room.gameplay.deck = structuredClone(room.deck);
    const result = hydrate(room);
    assert.deepEqual(result.deck.steps, { 2: 1, 4: 3 });
    assert.deepEqual(result.gameplay.deck.steps, result.deck.steps);
});

function fixture() {
    let now = 1000;
    const room = createRoomState({ roomId: 'authority-room', code: 'ABCD23', presenterUid: 'admin', now });
    room.slots.p1.uid = 'one'; room.slots.p1.joinedAt = now;
    room.slots.p2.uid = 'two'; room.slots.p2.joinedAt = now;
    const rooms = new Map([[room.roomId, room]]);
    const store = createMemoryAuthorityStore({ rooms });
    const options = { store, clock: () => now, autoStart: false };
    const a = createRoomAuthority({ ...options, gatewayId: 'a' });
    const b = createRoomAuthority({ ...options, gatewayId: 'b' });
    const actor = uid => ({ uid, accountStatus: 'active', isAdmin: uid === 'admin', isTeacher: true });
    const connect = (service, seatId, uid, id) => service.submit(room.roomId, { kind: 'connect', id, seatId, identity: actor(uid), replaceExisting: false });
    return { a, b, store, rooms, roomId: room.roomId, actor, connect, advance(ms) { now += ms; }, close() { a.close(); b.close(); } };
}

test('mutation rollback freezes authority ticks and rejects new commands without changing the room', async () => {
    const previous = process.env.PRESENTATION_DEMO_MUTATIONS_ENABLED, f = fixture();
    try {
        await f.connect(f.a, 'p1', 'one', 'before-freeze');
        await f.a.drain();
        process.env.PRESENTATION_DEMO_MUTATIONS_ENABLED = '0';
        const before = await f.store.read(f.roomId);
        f.advance(30000); await f.a.pump(f.roomId);
        await assert.rejects(f.connect(f.b, 'p2', 'two', 'during-freeze'), { code: 'SERVICE_RECOVERY' });
        assert.deepEqual(await f.store.read(f.roomId), before);
    } finally { if (previous === undefined) delete process.env.PRESENTATION_DEMO_MUTATIONS_ENABLED; else process.env.PRESENTATION_DEMO_MUTATIONS_ENABLED = previous; f.close(); }
});

test('remote gateways enqueue; only the leased owner reduces and acknowledges committed commands', async () => {
    const f = fixture();
    try {
        const one = await f.connect(f.a, 'p1', 'one', 'connect-one');
        const two = await f.connect(f.b, 'p2', 'two', 'connect-two');
        const commands = [
            { kind: 'input', id: 'move-one', seatId: 'p1', generation: one.generation, identity: f.actor('one'), command: { type: 'move', seq: 1, dx: 1, dy: 0 } },
            { kind: 'input', id: 'move-two', seatId: 'p2', generation: two.generation, identity: f.actor('two'), command: { type: 'move', seq: 1, dx: 0, dy: 1 } }
        ];
        const results = await Promise.all([f.a.submit(f.roomId, commands[0]), f.b.submit(f.roomId, commands[1])]);
        assert.ok(results.every(result => result.accepted));
        assert.equal((await f.store.read(f.roomId)).owner.gatewayId, 'a');
        assert.equal(f.b.metrics.reducedCommands, 0, 'non-owner must never run a command reducer');
        assert.equal(f.a.metrics.reducedCommands, 4);
        f.a.close();
        f.advance(15001);
        await f.b.pump(f.roomId);
        const replay = await f.b.submit(f.roomId, commands[0]);
        assert.equal(replay.revision, results[0].revision, 'receipt and state survive the process owner');
        await assert.rejects(f.b.submit(f.roomId, { ...commands[0], command: { ...commands[0].command, dy: 1 } }), { code: 'COMMAND_RECEIPT_CONFLICT' });
        assert.equal((await f.store.read(f.roomId)).lastInputSeq.p1, 1);
    } finally { f.close(); }
});

test('owner ticks expire a silent seat without any heartbeat or input', async () => {
    const f = fixture();
    try {
        await f.connect(f.a, 'p1', 'one', 'silent-seat');
        f.advance(20001);
        await f.a.pump(f.roomId);
        assert.equal((await f.store.read(f.roomId)).slots.p1.connected, false);
    } finally { f.close(); }
});

test('a replaced generation cannot replay its previously accepted result', async () => {
    const f = fixture();
    try {
        const c = await f.connect(f.a, 'p1', 'one', 'first');
        const req = { kind: 'input', id: 'original', seatId: 'p1', generation: c.generation, identity: f.actor('one'), command: { type: 'move', seq: 1, dx: 1, dy: 0 } };
        await f.a.submit(f.roomId, req);
        await f.b.submit(f.roomId, { kind: 'connect', id: 'replacement', seatId: 'p1', identity: f.actor('one'), replaceExisting: true });
        await assert.rejects(f.a.submit(f.roomId, req), { code: 'STALE_CONNECTION' });
    } finally { f.close(); }
});

test('a suspended owner cannot commit with a lease that expired while suspended', async () => {
    const f = fixture();
    let release, entered;
    const paused = new Promise(resolve => { entered = resolve; });
    const hold = new Promise(resolve => { release = resolve; });
    const stale = createRoomAuthority({ store: f.store, gatewayId: 'stale', autoStart: false, clock: () => now, beforeCommit: async () => { entered(); await hold; } });
    let now = 1000;
    try {
        const oldPump = stale.pump(f.roomId);
        await paused;
        now += 15001; f.advance(15001);
        await f.b.pump(f.roomId);
        const state = await f.store.read(f.roomId);
        release(); await oldPump;
        assert.deepEqual(await f.store.read(f.roomId), state);
        assert.equal(stale.metrics.commits, 0);
        assert.equal(state.owner.gatewayId, 'b');
    } finally { release?.(); stale.close(); f.close(); }
});

test('receipt replay checks silent expiry even before the next presence tick', async () => {
    const f = fixture();
    try {
        const c = await f.connect(f.a, 'p1', 'one', 'first');
        const req = { kind: 'input', id: 'once', seatId: 'p1', generation: c.generation, identity: f.actor('one'), command: { type: 'move', seq: 1, dx: 1, dy: 0 } };
        await f.a.submit(f.roomId, req);
        f.advance(20001);
        await assert.rejects(f.b.submit(f.roomId, req), { code: 'STALE_CONNECTION' });
    } finally { f.close(); }
});
