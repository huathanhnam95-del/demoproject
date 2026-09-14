const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomService, createMemoryRoomStores } = require('../../functions/src/crm/presentation-demo/room-service.cjs');

const admin = { uid: 'admin-1', email: 'admin@example.com', accountStatus: 'active', isAdmin: true };
const student = uid => ({ uid, accountStatus: 'active', isAdmin: false });

function setup() {
    let now = 1000;
    const stores = createMemoryRoomStores();
    const service = createRoomService({ stores, clock: () => now, idFactory: (() => { let i = 0; return () => `room-${++i}`; })(), codeFactory: (() => { let i = 0; return () => ['ABCD23', 'EFGH45', 'JKLM67'][i++]; })() });
    return { service, stores, advance(ms) { now += ms; } };
}

test('concurrent create/resume is idempotent and creates one active room per presenter', async () => {
    const { service } = setup();
    const [a, b] = await Promise.all([
        service.createOrResume(admin, { operationId: 'create-1' }),
        service.createOrResume(admin, { operationId: 'create-2' })
    ]);
    assert.equal(a.roomId, b.roomId);
    assert.equal(a.code, b.code);
    assert.equal(a.slots.p0.uid, admin.uid);
});

test('join reserves one stable seat per account, rejects fifth account, and tolerates replay', async () => {
    const { service } = setup();
    const room = await service.createOrResume(admin, { operationId: 'create-1' });
    const p1 = await service.join(student('u1'), room.code, { operationId: 'join-u1' });
    const p1Replay = await service.join(student('u1'), room.code, { operationId: 'join-u1-replay' });
    assert.equal(p1.seatId, 'p1');
    assert.equal(p1Replay.seatId, 'p1');
    assert.equal((await service.join(student('u2'), room.code)).seatId, 'p2');
    assert.equal((await service.join(student('u3'), room.code)).seatId, 'p3');
    await assert.rejects(service.join(student('u4'), room.code), error => error.code === 'ROOM_FULL');
    const restored = await service.getRoom(room.roomId);
    assert.deepEqual(Object.values(restored.slots).map(slot => slot.uid), ['admin-1', 'u1', 'u2', 'u3']);
});

test('only the presenter can end and presenter inactivity expires without heartbeat extension', async () => {
    const { service, advance } = setup();
    const room = await service.createOrResume(admin);
    await assert.rejects(service.end(student('u1'), room.roomId), error => error.code === 'PRESENTER_ONLY');
    advance(24 * 60 * 60 * 1000 - 1);
    assert.equal((await service.expireDue()).length, 0);
    advance(1);
    const ended = await service.expireDue();
    assert.equal(ended.length, 1);
    assert.equal((await service.getRoom(room.roomId)).lifecycle, 'ended');
    assert.equal((await service.end(admin, room.roomId)).endReason, 'expired');
});
