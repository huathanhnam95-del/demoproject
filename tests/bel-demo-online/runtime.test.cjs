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
