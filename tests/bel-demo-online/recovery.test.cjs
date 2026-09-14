const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomState } = require('../../functions/src/crm/presentation-demo/contracts.cjs');
const { AuthoritativeRuntime } = require('../../functions/src/crm/presentation-demo/runtime.cjs');
const { reconcileRoomState, createReconciler } = require('../../functions/src/crm/presentation-demo/reconciler.cjs');

test('owner epoch fences late gateway writes and permits takeover after lease expiry', () => {
    let now = 1000;
    const runtime = new AuthoritativeRuntime(createRoomState({ roomId: 'room-recov', code: 'ABCD23', presenterUid: 'admin', now }), { clock: () => now, ownerLeaseMs: 10 });
    const first = runtime.claimOwner('gateway-a');
    assert.throws(() => runtime.requireOwner('gateway-b', first.ownerEpoch), /OWNER_FENCED/);
    now = 1011;
    const second = runtime.claimOwner('gateway-b');
    assert.equal(second.ownerEpoch, first.ownerEpoch + 1);
    assert.throws(() => runtime.requireOwner('gateway-a', first.ownerEpoch), /OWNER_FENCED/);
});

test('reconciliation clears orphaned relationships and preserves valid seat identity', () => {
    const room = createRoomState({ roomId: 'room-recov', code: 'ABCD23', presenterUid: 'admin', now: 1000 });
    room.slots.p1.uid = 'u1';
    room.slots.p2.uid = 'u2';
    room.slots.p1.relationship = { leader: 'p2', follower: null, carry: 'missing-object', handhold: null };
    room.slots.p2.relationship = { leader: null, follower: 'p1', carry: null, handhold: null };
    const reconciled = reconcileRoomState(room);
    assert.equal(reconciled.slots.p1.uid, 'u1');
    assert.equal(reconciled.slots.p1.relationship.carry, null);
    assert.equal(reconciled.slots.p1.relationship.leader, 'p2');
    assert.equal(reconciled.slots.p2.relationship.follower, 'p1');
});

test('reconciler restores canonical room state and does not resurrect an ended room', async () => {
    const source = createRoomState({ roomId: 'room-recov', code: 'ABCD23', presenterUid: 'admin', now: 1000 });
    const roomService = { getRoom: async () => structuredClone(source) };
    const reconciler = createReconciler({ roomService });
    const restored = await reconciler.restore('room-recov');
    assert.equal(restored.roomId, source.roomId);
    source.lifecycle = 'ended';
    const blocked = await assert.rejects(reconciler.restore('room-recov'), error => error.code === 'ROOM_ENDED');
    assert.equal(blocked, undefined);
});
