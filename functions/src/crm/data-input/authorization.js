'use strict';
const { USERS } = require('../collections');
const excludedRoles = new Set(['student', 'learner', 'parent', 'guest']);

/** Preserve CRM record-admin policy; token claims alone never grant access. */
function createAdmission({ db, authClient, identity }) {
    return async function admit({ tx, actorUid }) {
        if (!tx || !identity || actorUid !== identity.uid || !Number.isFinite(identity.auth_time)) return false;
        if (!authClient || typeof authClient.getUser !== 'function') return false;
        let account;
        try { account = await authClient.getUser(actorUid); } catch { return false; }
        const validAfter = account.tokensValidAfterTime ? Date.parse(account.tokensValidAfterTime) : 0;
        if (account.disabled !== false || !Number.isFinite(validAfter) || identity.auth_time * 1000 < validAfter) return false;
        const snapshot = await tx.get(db.collection(USERS).doc(actorUid));
        if (!snapshot.exists) return false;
        const user = snapshot.data() || {};
        if (user.isAdmin !== true || user.disabled === true) return false;
        // Persisted account classification wins over an anomalous admin flag.
        // Do not inspect Auth isStudent claims: teachers also receive that claim
        // for practice access, independently of their CRM staff identity.
        for (const record of [user, user.profile, user.workforce]) {
            if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
            const roles = [record.role, record.crmRole, record.accountType, record.userType, record.type,
                record.organizationRole, record.workforceRole, ...(Array.isArray(record.roles) ? record.roles : [])];
            if (roles.some(role => typeof role === 'string' && excludedRoles.has(role.trim().toLowerCase()))
                || ['isStudent', 'isLearner', 'isParent', 'isGuest'].some(key => record[key] === true)) return false;
        }
        return true;
    };
}

module.exports = { createAdmission };
