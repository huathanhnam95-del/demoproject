const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomState } = require('../../functions/src/crm/presentation-demo/contracts.cjs');
const { AuthoritativeRuntime, RuntimeError } = require('../../functions/src/crm/presentation-demo/runtime.cjs');

function room() {
    const value = createRoomState({ roomId: 'room-runtime', code: 'ABCD23', presenterUid: 'admin', now: 1000 });
    for (const [index, uid] of ['u1', 'u2', 'u3'].entries()) {
        value.slots[`p${index + 1}`].uid = uid;
        value.slots[`p${index + 1}`].joinedAt = 1000;
    }
    return value;
}

test('runtime accepts intentions, commits monotonic revisions, and fences stale generations', () => {
    const runtime = new AuthoritativeRuntime(room(), { clock: () => 1000 });
    const connection = runtime.connect('p1', 1);
    const moved = runtime.command('p1', connection.generation, { type: 'move', seq: 1, dx: 1, dy: 0 });
    assert.equal(moved.revision, 2);
    assert.equal(runtime.snapshot().slots.p1.position.x > 0, true);
    assert.throws(() => runtime.command('p1', connection.generation - 1, { type: 'move', seq: 2, dx: 1, dy: 0 }), error => error instanceof RuntimeError && error.code === 'STALE_CONNECTION');
});

test('disconnect does not pause the room and disconnected players do not block arrival gates', () => {
    const runtime = new AuthoritativeRuntime(room(), { clock: () => 1000 });
    for (const slotId of ['p0', 'p1', 'p2', 'p3']) runtime.connect(slotId, 1);
    runtime.command('p0', 1, { type: 'transition', seq: 1, to: 'playing' });
    for (const slotId of ['p0', 'p1', 'p2']) runtime.setArrival(slotId, true);
    runtime.setPresence('p3', false, 1001);
    const gate = runtime.arrivalGate(['p0', 'p1', 'p2', 'p3']);
    assert.equal(gate.blocked, false);
    assert.equal(runtime.snapshot().lifecycle, 'playing');
});

test('initial reception latch requires all three participant joins and bootstrap sessions', () => {
    const value = room();
    value.slots.p3.uid = null;
    const runtime = new AuthoritativeRuntime(value, { clock: () => 1000 });
    runtime.connect('p0', 1);
    assert.throws(() => runtime.command('p0', 1, { type: 'transition', seq: 1, to: 'playing' }), /PARTICIPANTS_NOT_JOINED/);
    value.slots.p3.uid = 'u3';
    value.slots.p3.joinedAt = 1000;
    runtime.refreshRoom(value);
    runtime.connect('p0', 1);
    runtime.connect('p1', 1);
    runtime.connect('p2', 1);
    runtime.connect('p3', 1);
    runtime.command('p0', 1, { type: 'transition', seq: 1, to: 'playing' });
    assert.ok(runtime.snapshot().allParticipantsJoinedAt);
});

test('commands refresh presence lease and prevent stale presence sweep while moving', () => {
    let now = 1000;
    const runtime = new AuthoritativeRuntime(room(), { clock: () => now });
    const connection = runtime.connect('p1', 1, { now });
    assert.equal(runtime.snapshot().slots.p1.connected, true);

    // Advance 15 seconds (within lease)
    now += 15000;
    const move1 = runtime.command('p1', connection.generation, { type: 'move', seq: 1, dx: 1, dy: 0 }, now);
    assert.equal(move1.type, 'move');

    // Advance 10 seconds (25s total since connect, but only 10s since last command)
    now += 10000;
    // Without command lastSeenAt refresh, 25s would have expired the 20s lease!
    runtime.tick(now);
    assert.equal(runtime.snapshot().slots.p1.connected, true);

    // Advance 15 more seconds (25s since last command, exceeding 20s lease)
    now += 15000;
    runtime.tick(now);
    assert.equal(runtime.snapshot().slots.p1.connected, false);
});

test('invalid command does not refresh lease and explicit now is honored', () => {
    let now = 1000;
    const runtime = new AuthoritativeRuntime(room(), { clock: () => now });
    const connection = runtime.connect('p1', 1, { now });

    // Advance 15 seconds
    now += 15000;
    // Malformed command (invalid type) throws COMMAND_TYPE_FORBIDDEN
    assert.throws(
        () => runtime.command('p1', connection.generation, { type: 'not-a-valid-command' }, now),
        error => error instanceof RuntimeError && error.code === 'COMMAND_TYPE_FORBIDDEN'
    );
    // Malformed movement command (invalid seq) throws COMMAND_INVALID_SEQ
    assert.throws(
        () => runtime.command('p1', connection.generation, { type: 'move', seq: 'bad', dx: 1, dy: 0 }, now),
        error => error instanceof RuntimeError && error.code === 'COMMAND_INVALID_SEQ'
    );

    // Because commands were invalid, lastSeenAt was not refreshed to 16000; it remains 1000.
    // Advancing 6 more seconds (total 21s > 20s lease from connect) will expire the slot on tick.
    now += 6000;
    runtime.tick(now);
    assert.equal(runtime.snapshot().slots.p1.connected, false);
});

test('replay command refreshes lease and expired slot cannot heartbeat or command', () => {
    let now = 1000;
    const runtime = new AuthoritativeRuntime(room(), { clock: () => now });
    const connection = runtime.connect('p1', 1, { now });

    // Send valid command at t=10000
    now += 9000;
    const cmd1 = { type: 'move', seq: 1, dx: 1, dy: 0 };
    const res1 = runtime.command('p1', connection.generation, cmd1, now);
    assert.equal(res1.type, 'move');

    // Advance 15s to t=25000 (15s since cmd1, lease still active)
    now += 15000;
    // Resend exact same command (idempotent replay)
    const resReplay = runtime.command('p1', connection.generation, cmd1, now);
    assert.deepEqual(resReplay, res1);

    // Advance 10s to t=35000 (total 25s since cmd1, but 10s since replay)
    now += 10000;
    runtime.tick(now);
    // Replay refreshed lastSeenAt, so slot is still connected
    assert.equal(runtime.snapshot().slots.p1.connected, true);

    // Heartbeat at t=45000 (10s since tick)
    now += 10000;
    const hb = runtime.heartbeat('p1', connection.generation, now);
    assert.equal(hb.accepted, true);

    // Advance 21s to t=66000 (exceeding 20s lease from heartbeat)
    now += 21000;
    // Command or heartbeat from expired slot must throw STALE_CONNECTION
    assert.throws(
        () => runtime.heartbeat('p1', connection.generation, now),
        error => error instanceof RuntimeError && error.code === 'STALE_CONNECTION'
    );
    assert.throws(
        () => runtime.command('p1', connection.generation, { type: 'move', seq: 2, dx: 0, dy: 1 }, now),
        error => error instanceof RuntimeError && error.code === 'STALE_CONNECTION'
    );
});


