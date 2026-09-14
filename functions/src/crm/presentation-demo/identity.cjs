'use strict';

const { fail, isUid } = require('./contracts.cjs');

function normalizeIdentity(input = {}) {
    const profile = input.profile && typeof input.profile === 'object' ? input.profile : input;
    const token = input.token && typeof input.token === 'object' ? input.token : {};
    const workforce = input.workforce && typeof input.workforce === 'object' ? input.workforce : {};
    const uid = String(input.uid ?? token.uid ?? profile.uid ?? '').trim();
    const profileResolved = input.profileResolved === true ? true : input.profileResolved === false ? false : undefined;
    const profileStatus = String(profile.accountStatus ?? input.accountStatus ?? '').toLowerCase();
    const workforceStatus = String(workforce.accountStatus ?? workforce.status ?? '').toLowerCase();
    const workforceClosed = workforce.archived === true || workforce.active === false || ['archived', 'suspended', 'inactive', 'disabled'].includes(workforceStatus);
    const accountStatus = workforceClosed ? 'inactive' : profileStatus || workforceStatus || 'unknown';
    const moduleGrants = profile.moduleGrants && typeof profile.moduleGrants === 'object'
        ? profile.moduleGrants
        : workforce.moduleGrants && typeof workforce.moduleGrants === 'object' ? workforce.moduleGrants : {};
    return {
        uid,
        email: String(input.email ?? profile.email ?? token.email ?? '').trim().toLowerCase() || null,
        disabled: profile.disabled === true || input.disabled === true || input.authUser?.disabled === true,
        accountStatus,
        isAdmin: profile.isAdmin === true || input.isAdmin === true,
        isTeacher: profile.isTeacher === true || String(profile.crmRole || '').toLowerCase() === 'teacher' || input.isTeacher === true,
        moduleGrants: structuredClone(moduleGrants),
        crmEligible: !workforceClosed && (input.crmEligible === true || profile.isAdmin === true || profile.isTeacher === true
            || String(profile.crmRole || '').toLowerCase() === 'teacher' || moduleGrants.projects === true),
        profileResolved,
        authUserResolved: input.authUser !== undefined
    };
}

function assertActiveIdentity(input) {
    const identity = normalizeIdentity(input);
    if (!isUid(identity.uid)) fail('INVALID_IDENTITY');
    if (identity.profileResolved === false) fail('PROFILE_UNAVAILABLE', 'CRM account could not be verified.');
    if (identity.authUserResolved && identity.authUser?.disabled === true) fail('ACCOUNT_DISABLED');
    if (identity.disabled) fail('ACCOUNT_DISABLED');
    if (!['active', 'enabled'].includes(identity.accountStatus)) fail('ACCOUNT_INACTIVE');
    if (identity.profileResolved && identity.crmEligible !== true) fail('CRM_ELIGIBILITY_REQUIRED', 'An active CRM teacher or Projects account is required.');
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

function serverIdentityFromAuth({ decodedToken, profile, workforce = null, authUser = undefined } = {}) {
    return normalizeIdentity({
        uid: decodedToken?.uid,
        email: decodedToken?.email,
        token: decodedToken,
        profile,
        workforce,
        authUser,
        profileResolved: profile !== null && profile !== undefined
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
