'use strict';

const { fail, isUid } = require('./contracts.cjs');

function normalizeIdentity(input = {}) {
    const profile = input.profile && typeof input.profile === 'object' ? input.profile : input;
    const token = input.token && typeof input.token === 'object' ? input.token : {};
    const uid = String(input.uid ?? token.uid ?? profile.uid ?? '').trim();
    return {
        uid,
        email: String(input.email ?? profile.email ?? token.email ?? '').trim().toLowerCase() || null,
        disabled: profile.disabled === true || input.disabled === true,
        accountStatus: String(profile.accountStatus ?? input.accountStatus ?? 'active').toLowerCase(),
        isAdmin: profile.isAdmin === true || input.isAdmin === true,
        isTeacher: profile.isTeacher === true || input.isTeacher === true,
        moduleGrants: profile.moduleGrants && typeof profile.moduleGrants === 'object' ? structuredClone(profile.moduleGrants) : {}
    };
}

function assertActiveIdentity(input) {
    const identity = normalizeIdentity(input);
    if (!isUid(identity.uid)) fail('INVALID_IDENTITY');
    if (identity.disabled) fail('ACCOUNT_DISABLED');
    if (!['active', 'enabled'].includes(identity.accountStatus)) fail('ACCOUNT_INACTIVE');
    return identity;
}

function canCreatePresenterRoom(input) {
    const identity = normalizeIdentity(input);
    return !identity.disabled && ['active', 'enabled'].includes(identity.accountStatus) && identity.isAdmin === true;
}

function assertPresenter(identity) {
    const current = assertActiveIdentity(identity);
    if (!current.isAdmin) fail('PRESENTER_ONLY', 'Only an active admin can control a presenter room.');
    return current;
}

function assertRoomActor(identity, membership) {
    const current = assertActiveIdentity(identity);
    if (!membership || membership.uid !== current.uid) fail('ACTOR_MISMATCH');
    if (membership.role === 'presenter' && !current.isAdmin) fail('PRESENTER_ONLY');
    if (!['p0', 'p1', 'p2', 'p3'].includes(membership.seatId)) fail('SEAT_INVALID');
    return current;
}

function serverIdentityFromAuth({ decodedToken, profile } = {}) {
    return normalizeIdentity({
        uid: decodedToken?.uid,
        email: decodedToken?.email,
        token: decodedToken,
        profile
    });
}

module.exports = {
    assertActiveIdentity,
    assertPresenter,
    assertRoomActor,
    canCreatePresenterRoom,
    normalizeIdentity,
    serverIdentityFromAuth
};
