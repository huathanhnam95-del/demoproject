const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIdentity, assertActiveIdentity, canCreatePresenterRoom, assertRoomActor } = require('../../functions/src/crm/presentation-demo/identity.cjs');

test('identity is derived from the verified server profile, not client role claims', () => {
    const identity = normalizeIdentity({ uid: 'u1', token: { uid: 'u1', admin: true }, profile: { accountStatus: 'active', isAdmin: false } });
    assert.equal(identity.uid, 'u1');
    assert.equal(identity.isAdmin, false);
    assert.equal(canCreatePresenterRoom(identity), false);
    assert.equal(assertActiveIdentity(identity).uid, identity.uid);
});

test('disabled or inactive accounts cannot join or present', () => {
    assert.throws(() => assertActiveIdentity(normalizeIdentity({ uid: 'u1', profile: { disabled: true } })), /ACCOUNT_DISABLED/);
    assert.throws(() => assertActiveIdentity(normalizeIdentity({ uid: 'u1', profile: { accountStatus: 'suspended' } })), /ACCOUNT_INACTIVE/);
});

test('presenter controls require a current active admin and actor membership', () => {
    const admin = normalizeIdentity({ uid: 'admin', profile: { accountStatus: 'active', isAdmin: true } });
    const participant = normalizeIdentity({ uid: 'student', profile: { accountStatus: 'active', isAdmin: false } });
    assert.equal(canCreatePresenterRoom(admin), true);
    assert.equal(canCreatePresenterRoom(participant), false);
    assert.equal(assertRoomActor(admin, { uid: 'admin', seatId: 'p0', role: 'presenter' }).uid, admin.uid);
    assert.throws(() => assertRoomActor(participant, { uid: 'admin', seatId: 'p0', role: 'presenter' }), /ACTOR_MISMATCH/);
    assert.throws(() => assertRoomActor(participant, { uid: 'student', seatId: 'p0', role: 'presenter' }), /PRESENTER_ONLY/);
});
