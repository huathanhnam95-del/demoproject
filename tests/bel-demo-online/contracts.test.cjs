const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ROOM_SCHEMA_VERSION,
    SLOT_IDS,
    ROOM_CODE_ALPHABET,
    normalizeRoomCode,
    createRoomState,
    validateRoomState,
    publicRoomSnapshot,
    validateClientCommand
} = require('../../functions/src/crm/presentation-demo/contracts.cjs');

test('room contract creates exactly one presenter and three participant slots', () => {
    const room = createRoomState({ roomId: 'room-1', code: 'ABCD23', presenterUid: 'admin-1', now: 1000 });
    assert.equal(room.schemaVersion, ROOM_SCHEMA_VERSION);
    assert.deepEqual(Object.keys(room.slots), SLOT_IDS);
    assert.equal(room.slots.p0.role, 'presenter');
    assert.deepEqual(Object.keys(room.slots).slice(1), ['p1', 'p2', 'p3']);
    assert.equal(room.lifecycle, 'reception');
    assert.equal(room.expiresAt, 1000 + 24 * 60 * 60 * 1000);
    assert.equal(validateRoomState(room), room);
});

test('room codes normalize and use an unambiguous six-character alphabet', () => {
    assert.equal(normalizeRoomCode(' ab-cd23 '), 'ABCD23');
    assert.equal(ROOM_CODE_ALPHABET.includes('0'), false);
    assert.equal(ROOM_CODE_ALPHABET.includes('1'), false);
    assert.equal(ROOM_CODE_ALPHABET.includes('I'), false);
    assert.equal(ROOM_CODE_ALPHABET.includes('O'), false);
    assert.throws(() => normalizeRoomCode('short'), error => error.code === 'ROOM_CODE_INVALID');
});

test('public projection excludes connection secrets and private notebook bodies', () => {
    const room = createRoomState({ roomId: 'room-2', code: 'ABCD23', presenterUid: 'admin-1', now: 1000 });
    room.slots.p1.uid = 'user-1';
    room.slots.p1.notes = [{ id: 'p1', title: 'Private', body: 'private', version: 1 }];
    room.slots.p1.connectionSecret = 'do-not-project';
    const snapshot = publicRoomSnapshot(room, 'user-2');
    assert.equal(snapshot.slots.p1.notes, undefined);
    assert.equal(snapshot.slots.p1.connectionSecret, undefined);
    assert.equal(snapshot.roomId, 'room-2');
});

test('client commands reject forged server fields and invalid values', () => {
    assert.deepEqual(validateClientCommand({ type: 'move', seq: 1, dx: 1, dy: 0 }), { type: 'move', seq: 1, dx: 1, dy: 0 });
    assert.throws(() => validateClientCommand({ type: 'move', seq: 1, dx: 1, dy: 0, slotId: 'p0' }), /COMMAND_EXTRA_FIELD/);
    assert.throws(() => validateClientCommand({ type: 'move', seq: 0, dx: 1, dy: 0 }), /COMMAND_INVALID_SEQ/);
    assert.throws(() => validateClientCommand({ type: 'setPosition', seq: 1, x: 10, y: 10 }), /COMMAND_TYPE_FORBIDDEN/);
});
