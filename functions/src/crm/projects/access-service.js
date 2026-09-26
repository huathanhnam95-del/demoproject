'use strict';

const crypto = require('crypto');
const { normalizeHolidayChoices, calendarSummary, datesInRange } = require('./calendar-model');

/**
 * Projects access is deliberately isolated from the legacy CRM role checks.
 * The service accepts the Firebase Admin dependencies from its caller so the
 * Functions app and the local adapter use the same authorization fence.
 */

const PROJECT_ROLES = Object.freeze(['Owner', 'Editor', 'Viewer']);
const WRITE_ROLES = new Set(['Owner', 'Editor']);
const ADMIN_ROLES = new Set(['admin', 'administrator', 'org_admin', 'organization_admin']);
const MODULE_KEYS = Object.freeze(['projects']);

const PROJECT_COLLECTIONS = Object.freeze({
    projects: 'crmProjects',
    members: 'crmProjectMembers',
    workforce: 'crmWorkforceAccounts',
    organizationConfig: 'crmProjectOrganizationConfig',
    allowance: 'crmProjectAllowanceConfigs',
    allowanceDefaults: 'crmProjectAllowanceDefaults',
    audit: 'crmProjectAccessAudit'
});

const DEFAULT_ALLOWANCE_CENTS = 500;
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_WORKING_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5]);
const AUTH_SYNC_ABANDONED_AFTER_MS = 5 * 60 * 1000;

class ProjectsAccessError extends Error {
    constructor(status, code, message, details = null) {
        super(message);
        this.name = 'ProjectsAccessError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function cleanString(value, maxLength = 200) {
    const text = String(value ?? '').trim();
    if (!text || text.length > maxLength || Array.from(text).some((character) => {
        const code = character.charCodeAt(0);
        return code < 0x20 || code === 0x7f;
    })) return '';
    return text;
}

function normalizeUid(value) {
    const uid = cleanString(value, 128);
    if (!uid || uid.includes('/') || uid.includes('\\')) return '';
    return uid;
}

function normalizeProjectId(value) {
    const id = cleanString(value, 128);
    if (!id || id.includes('/') || id.includes('\\')) return '';
    return id;
}

function normalizeRole(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'owner') return 'Owner';
    if (text === 'editor') return 'Editor';
    if (text === 'viewer') return 'Viewer';
    return '';
}

function normalizeAccountStatus(value, fallback = 'active') {
    const status = String(value ?? fallback).trim().toLowerCase();
    if (status === 'active') return 'active';
    if (status === 'suspended' || status === 'disabled') return 'suspended';
    if (status === 'archived' || status === 'archive') return 'archived';
    return '';
}

function normalizeExpectedRevision(value) {
    if (value === undefined || value === null || value === '') return null;
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 0) return NaN;
    return revision;
}

function toIso(now) {
    const date = now instanceof Date ? now : new Date(now || Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function memberDocumentId(projectId, uid) {
    const project = normalizeProjectId(projectId);
    const user = normalizeUid(uid);
    if (!project || !user) return '';
    // A deterministic opaque key prevents accidental collisions while keeping
    // one addressable record per project/UID pair. JSON tuple framing keeps
    // project/UID delimiters from creating ambiguous pairs.
    return Buffer.from(JSON.stringify([project, user]), 'utf8').toString('base64url');
}

function canonicalMembership(doc, expectedProjectId, expectedUid = '') {
    const data = doc?.data?.() || {};
    const projectId = normalizeProjectId(data.projectId);
    const uid = normalizeUid(data.uid);
    const role = normalizeRole(data.role);
    const expectedProject = normalizeProjectId(expectedProjectId);
    const expectedUser = expectedUid ? normalizeUid(expectedUid) : '';
    if (!expectedProject || projectId !== expectedProject || !uid
        || (expectedUser && uid !== expectedUser)
        || doc?.id !== memberDocumentId(projectId, uid)
        || !role || data.active === false) return null;
    return { id: doc.id, data, projectId, uid, role };
}

function readModuleGrant(workforce, module = 'projects') {
    const grants = workforce?.moduleGrants && typeof workforce.moduleGrants === 'object'
        ? workforce.moduleGrants
        : {};
    // Privileges are server-owned typed boolean values. Legacy strings,
    // objects, arrays, and profile claims must never become implicit grants.
    return grants[module] === true;
}

function hasAdminRole(workforce) {
    const role = String(workforce?.organizationRole || workforce?.workforceRole || workforce?.role || '')
        .trim().toLowerCase();
    return workforce?.isOrganizationAdmin === true || ADMIN_ROLES.has(role);
}

function hasActiveWorkforce(workforce) {
    return !!workforce && normalizeAccountStatus(workforce.status, '') === 'active';
}

function accountStatus(profile, workforce, authUser) {
    if (authUser?.disabled === true) return 'suspended';
    if (profile?.archived === true) return 'archived';
    if (workforce?.authSync && workforce.authSync.state !== 'succeeded') return 'suspended';
    const profileStatus = normalizeAccountStatus(
        profile?.accountStatus,
        profile?.archived === true ? 'archived' : 'active'
    );
    const workforceStatus = normalizeAccountStatus(workforce?.status, 'active');
    if (!profileStatus || !workforceStatus) return '';
    if (profileStatus !== 'active') return profileStatus;
    return workforceStatus;
}

function safePublicProfile(uid, profile, workforce, authUser) {
    const status = accountStatus(profile, workforce, authUser);
    const moduleGrants = {};
    for (const key of MODULE_KEYS) moduleGrants[key] = readModuleGrant(workforce, key);
    return {
        uid,
        email: cleanString(profile?.email || authUser?.email || '', 320),
        displayName: cleanString(profile?.displayName || profile?.name || authUser?.displayName || '', 200),
        isAdmin: profile?.isAdmin === true || hasAdminRole(workforce),
        isTeacher: profile?.isTeacher === true || String(profile?.crmRole || '').toLowerCase() === 'teacher',
        accountStatus: status,
        authDisabled: authUser?.disabled === true,
        workforceStatus: normalizeAccountStatus(workforce?.status, 'active') || null,
        moduleGrants
    };
}

function serializeProjectAccess(access) {
    const project = { ...(access?.project?.data || {}) };
    // Raw CRM link payloads may contain identifiers or record fields the
    // resolver did not authorize. Only emit the sanitized resolver result.
    delete project.crmLinks;
    delete project.links;
    delete project.linkedRecords;
    const linkedRecords = Array.isArray(access?.linkedRecords) ? access.linkedRecords : [];
    if (linkedRecords.length) project.linkedRecords = linkedRecords;
    return {
        ...project,
        // The Firestore document key is authoritative even when legacy data
        // contains a forged or stale id field.
        id: access?.project?.id || null,
        ...(access?.membership?.data ? { role: access.membership.data.role } : {})
    };
}

function serializeProjectManagement(project) {
    const data = project?.data || {};
    const result = {
        id: project?.id || null,
        name: cleanString(data.name || '', 200) || null,
        title: cleanString(data.title || '', 200) || null,
        status: cleanString(data.status || '', 40) || null,
        ownerUid: normalizeUid(data.ownerUid) || null,
        membershipRevision: Number.isSafeInteger(Number(data.membershipRevision))
            ? Number(data.membershipRevision)
            : 0
    };
    for (const key of ['createdAt', 'updatedAt']) {
        if (data[key] !== undefined && data[key] !== null) result[key] = data[key];
    }
    return result;
}

function createProjectsAccessService(deps = {}) {
    const db = deps.db;
    const auth = deps.auth || null;
    const verifyIdToken = deps.verifyIdToken
        || (auth?.verifyIdToken ? auth.verifyIdToken.bind(auth) : null);
    const getAuthUser = deps.getAuthUser
        || (auth?.getUser ? auth.getUser.bind(auth) : null);
    const now = deps.now || (() => new Date());
    const statusSyncLocks = new Map();
    if (!db || typeof db.collection !== 'function') throw new Error('Projects access service requires Firestore db.');
    if (typeof verifyIdToken !== 'function') throw new Error('Projects access service requires a Firebase ID-token verifier.');
    if (typeof getAuthUser !== 'function') throw new Error('Projects access service requires a Firebase Auth user lookup.');

    function ref(collection, id) {
        return db.collection(collection).doc(id);
    }

    async function readAuthUser(uid) {
        try {
            return await getAuthUser(uid);
        } catch (error) {
            if (error?.code === 'auth/user-not-found') {
                throw new ProjectsAccessError(401, 'UNAUTHORIZED', 'Authentication failed.');
            }
            throw error;
        }
    }

    async function authenticateToken(token) {
        const value = cleanString(token, 10000);
        if (!value) throw new ProjectsAccessError(401, 'UNAUTHORIZED', 'Missing bearer token.');
        let decoded;
        try {
            // Verify the signature and expiry locally. The disabled and
            // revoked-session checks that checkRevoked would add are made below
            // from one fresh Auth user lookup on every request, with the same
            // rules, instead of a second lookup inside the verifier.
            decoded = await verifyIdToken(value, false);
        } catch (error) {
            if (error instanceof ProjectsAccessError) throw error;
            const code = String(error?.code || '').toLowerCase();
            if (code === 'auth/user-disabled' || code === 'user-disabled') throw new ProjectsAccessError(403, 'ACCOUNT_INACTIVE', 'Account is not active.');
            throw new ProjectsAccessError(401, code.includes('revoked') ? 'REVOKED_TOKEN' : 'UNAUTHORIZED', 'Authentication failed.');
        }
        const uid = normalizeUid(decoded?.uid || decoded?.sub || decoded?.user_id);
        if (!uid) throw new ProjectsAccessError(401, 'UNAUTHORIZED', 'Authentication failed.');
        // The Auth user and Firestore identity reads are independent; read them
        // together. Every check below still completes before identity returns.
        const [authUser, profileSnap, workforceSnap] = await Promise.all([
            readAuthUser(uid),
            ref('users', uid).get(),
            ref(PROJECT_COLLECTIONS.workforce, uid).get()
        ]);
        // Same order and rules as Firebase checkRevoked: disabled first, then
        // a session revoked after this token's sign-in time.
        if (authUser?.disabled === true) throw new ProjectsAccessError(403, 'ACCOUNT_INACTIVE', 'Account is not active.');
        const validAfterMs = authUser?.tokensValidAfterTime ? new Date(authUser.tokensValidAfterTime).getTime() : 0;
        if (validAfterMs > 0 && Number(decoded?.auth_time || 0) * 1000 < validAfterMs) {
            throw new ProjectsAccessError(401, 'REVOKED_TOKEN', 'Session has been revoked.');
        }
        const profile = profileSnap?.exists ? (profileSnap.data() || {}) : {};
        const workforce = workforceSnap?.exists ? (workforceSnap.data() || {}) : null;
        return {
            uid,
            decoded,
            authUser,
            profile,
            workforce,
            profileExists: !!profileSnap?.exists,
            workforceExists: !!workforceSnap?.exists,
            status: accountStatus(profile, workforce, authUser)
        };
    }

    async function authenticateRequest(req) {
        const header = String(req?.headers?.authorization || '');
        if (!/^Bearer\s+/i.test(header)) {
            throw new ProjectsAccessError(401, 'UNAUTHORIZED', 'Missing or invalid authorization header.');
        }
        return authenticateToken(header.replace(/^Bearer\s+/i, '').trim());
    }

    function assertActive(identity) {
        if (!identity?.uid || !identity.profileExists) {
            throw new ProjectsAccessError(403, 'ACCOUNT_INACTIVE', 'Account is not authorized for Projects.');
        }
        if (identity.status !== 'active') {
            throw new ProjectsAccessError(403, 'ACCOUNT_INACTIVE', 'Account is not active.');
        }
    }

    function assertAdmin(identity) {
        assertActive(identity);
        if (identity.profile?.isAdmin !== true && !hasAdminRole(identity.workforce)) {
            throw new ProjectsAccessError(403, 'FORBIDDEN', 'Organization administrator access required.');
        }
        return identity;
    }

    function assertProjectsGrant(identity) {
        assertActive(identity);
        if (!identity.workforceExists || !hasActiveWorkforce(identity.workforce)) {
            throw new ProjectsAccessError(403, 'PROJECTS_ACCESS_DENIED', 'Projects access is not enabled for this account.');
        }
        if (!readModuleGrant(identity.workforce, 'projects')) {
            throw new ProjectsAccessError(403, 'PROJECTS_ACCESS_DENIED', 'Projects access is not enabled for this account.');
        }
    }

    // Mutation fences must re-read all server-owned identity state inside the
    // Firestore transaction. The request-time identity is only a hint: an
    // administrator may have been revoked, suspended, or removed from a
    // project after authentication and before the commit.
    async function readTransactionIdentity(transaction, rawUid) {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid account UID.');
        const [profileSnap, workforceSnap, authUser] = await Promise.all([
            transaction.get(ref('users', uid)),
            transaction.get(ref(PROJECT_COLLECTIONS.workforce, uid)),
            readAuthUser(uid)
        ]);
        const profile = profileSnap?.exists ? (profileSnap.data() || {}) : {};
        const workforce = workforceSnap?.exists ? (workforceSnap.data() || {}) : null;
        return {
            uid,
            authUser,
            profile,
            workforce,
            profileExists: !!profileSnap?.exists,
            workforceExists: !!workforceSnap?.exists,
            status: accountStatus(profile, workforce, authUser)
        };
    }

    function assertTransactionActive(identity) {
        assertActive(identity);
        return identity;
    }

    async function assertTransactionAdmin(transaction, rawUid) {
        const identity = await readTransactionIdentity(transaction, rawUid);
        assertTransactionActive(identity);
        if (identity.profile?.isAdmin !== true && !hasAdminRole(identity.workforce)) {
            throw new ProjectsAccessError(403, 'FORBIDDEN', 'Organization administrator access required.');
        }
        return identity;
    }

    // Content commands must use this fence instead of the management fence
    // above. Organization administration is intentionally not an implicit
    // project-content role: the member row is always read and checked in the
    // same transaction as the command's domain records.
    async function assertTransactionEligible(transaction, rawUid) {
        const identity = await readTransactionIdentity(transaction, rawUid);
        assertTransactionActive(identity);
        assertProjectsGrant(identity);
        return identity;
    }

    async function assertTransactionContentAccess(transaction, rawUid, projectId, options = {}) {
        // Start the project and member reads alongside the identity reads.
        // Decisions keep their order: identity first, then project ID, then
        // project/member; the prefetched documents are unused until then.
        const normalizedProjectId = normalizeProjectId(projectId);
        const prefetchUid = normalizeUid(rawUid);
        const projectRef = normalizedProjectId ? ref(PROJECT_COLLECTIONS.projects, normalizedProjectId) : null;
        const memberRef = normalizedProjectId && prefetchUid ? ref(PROJECT_COLLECTIONS.members, memberDocumentId(normalizedProjectId, prefetchUid)) : null;
        const reads = memberRef ? Promise.allSettled([
            Promise.resolve().then(() => transaction.get(projectRef)),
            Promise.resolve().then(() => transaction.get(memberRef))
        ]) : null;
        const identity = await assertTransactionEligible(transaction, rawUid);
        if (!normalizedProjectId) throw new ProjectsAccessError(400, 'INVALID_PROJECT_ID', 'Invalid project ID.');
        const outcomes = await reads;
        // Keep the original project-first read failure precedence.
        for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
        const [projectSnap, memberSnap] = outcomes.map(outcome => outcome.value);
        if (!projectSnap?.exists) throw new ProjectsAccessError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        const membership = memberSnap?.exists
            ? canonicalMembership(memberSnap, normalizedProjectId, identity.uid)
            : null;
        if (!membership) throw new ProjectsAccessError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        const role = membership.role;
        const allowedRoles = Array.isArray(options.roles) && options.roles.length
            ? options.roles
            : (options.owner === true ? ['Owner'] : (options.write === true ? ['Owner', 'Editor'] : PROJECT_ROLES));
        if (!allowedRoles.includes(role)) {
            if (options.owner === true) throw new ProjectsAccessError(403, 'PROJECT_OWNER_REQUIRED', 'Project owner access required.');
            if (options.write === true) throw new ProjectsAccessError(403, 'PROJECT_WRITE_FORBIDDEN', 'Viewer access is read-only.');
            throw new ProjectsAccessError(403, 'PROJECT_READ_FORBIDDEN', 'Project content access is not allowed.');
        }
        return {
            identity,
            actorUid: identity.uid,
            project: { id: normalizedProjectId, data: projectSnap.data() || {}, ref: projectRef },
            membership: { id: membership.id, data: { ...membership.data, uid: membership.uid, projectId: membership.projectId, role: membership.role }, ref: memberRef },
            role
        };
    }

    async function authorizeProjectContent(identity, projectId, options = {}) {
        assertProjectsGrant(identity);
        const project = await readProject(projectId);
        const membership = await readMembership(project.id, identity.uid);
        if (!membership) throw new ProjectsAccessError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        const allowedRoles = Array.isArray(options.roles) && options.roles.length
            ? options.roles
            : (options.owner === true ? ['Owner'] : (options.write === true ? ['Owner', 'Editor'] : PROJECT_ROLES));
        if (!allowedRoles.includes(membership.data.role)) {
            if (options.owner === true) throw new ProjectsAccessError(403, 'PROJECT_OWNER_REQUIRED', 'Project owner access required.');
            if (options.write === true) throw new ProjectsAccessError(403, 'PROJECT_WRITE_FORBIDDEN', 'Viewer access is read-only.');
            throw new ProjectsAccessError(403, 'PROJECT_READ_FORBIDDEN', 'Project content access is not allowed.');
        }
        return { identity, project, membership, role: membership.data.role };
    }

    async function assertTransactionProjectManager(transaction, rawUid, projectId) {
        const identity = await readTransactionIdentity(transaction, rawUid);
        assertTransactionActive(identity);
        const actorIsAdmin = identity.profile?.isAdmin === true || hasAdminRole(identity.workforce);
        let membership = null;
        if (!actorIsAdmin) {
            if (!identity.workforceExists || !hasActiveWorkforce(identity.workforce) || !readModuleGrant(identity.workforce, 'projects')) {
                throw new ProjectsAccessError(403, 'PROJECTS_ACCESS_DENIED', 'Projects access is not enabled for this account.');
            }
            const memberId = memberDocumentId(projectId, identity.uid);
            const memberSnap = await transaction.get(ref(PROJECT_COLLECTIONS.members, memberId));
            const member = memberSnap?.exists ? canonicalMembership(memberSnap, projectId, identity.uid) : null;
            if (!member || member.role !== 'Owner') {
                throw new ProjectsAccessError(403, 'PROJECT_OWNER_REQUIRED', 'Project owner access required.');
            }
            membership = { id: member.id, data: { ...member.data, uid: member.uid, projectId: member.projectId, role: member.role } };
        }
        return { identity, actorIsAdmin, membership };
    }

    async function readProject(projectId) {
        const id = normalizeProjectId(projectId);
        if (!id) throw new ProjectsAccessError(400, 'INVALID_PROJECT_ID', 'Invalid project ID.');
        const snapshot = await ref(PROJECT_COLLECTIONS.projects, id).get();
        if (!snapshot?.exists) throw new ProjectsAccessError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        return { id, data: snapshot.data() || {}, ref: ref(PROJECT_COLLECTIONS.projects, id) };
    }

    async function readMembership(projectId, uid, sourceDb = db) {
        const id = memberDocumentId(projectId, uid);
        if (!id) return null;
        const snapshot = await sourceDb.collection(PROJECT_COLLECTIONS.members).doc(id).get();
        if (!snapshot?.exists) return null;
        const member = canonicalMembership(snapshot, projectId, uid);
        if (!member) return null;
        return {
            id: member.id,
            data: { ...member.data, projectId: member.projectId, uid: member.uid, role: member.role },
            ref: sourceDb.collection(PROJECT_COLLECTIONS.members).doc(id)
        };
    }

    async function resolveLinkedRecords(project, identity) {
        const links = Array.isArray(project?.data?.crmLinks)
            ? project.data.crmLinks
            : (Array.isArray(project?.data?.links) ? project.data.links : []);
        if (links.length === 0) return [];
        const resolver = deps.resolveLinkedRecordAccess;
        if (typeof resolver !== 'function') return [];
        const allowed = [];
        for (const rawLink of links) {
            const link = rawLink && typeof rawLink === 'object' ? rawLink : {};
            // Link metadata never grants access. The resolver must check both
            // the existing module and the linked record authorization.
            const resolution = await resolver({ identity, link, project });
            if (resolution === true) {
                allowed.push({
                    type: cleanString(link.type || link.module || '', 100) || null,
                    module: cleanString(link.module || '', 100) || null,
                    recordId: cleanString(link.recordId || link.id || '', 200) || null
                });
            } else if (resolution && typeof resolution === 'object') {
                allowed.push({
                    type: cleanString(resolution.type || link.type || link.module || '', 100) || null,
                    module: cleanString(resolution.module || link.module || '', 100) || null,
                    recordId: cleanString(resolution.recordId || link.recordId || link.id || '', 200) || null,
                    ...(cleanString(resolution.label || '', 200) ? { label: cleanString(resolution.label, 200) } : {})
                });
            }
        }
        return allowed;
    }

    async function authorizeProject(identity, projectId, { write = false, owner = false } = {}) {
        assertProjectsGrant(identity);
        // Read the project and membership together; project errors keep precedence.
        const normalizedProjectId = normalizeProjectId(projectId);
        const [projectOutcome, membershipOutcome] = await Promise.allSettled([
            readProject(projectId),
            normalizedProjectId ? readMembership(normalizedProjectId, identity.uid) : Promise.resolve(null)
        ]);
        if (projectOutcome.status === 'rejected') throw projectOutcome.reason;
        if (membershipOutcome.status === 'rejected') throw membershipOutcome.reason;
        const project = projectOutcome.value;
        const membership = membershipOutcome.value;
        // Hide membership and link existence from accounts that do not belong to
        // the guessed project ID.
        if (!membership) throw new ProjectsAccessError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        if (write && !WRITE_ROLES.has(membership.data.role)) {
            throw new ProjectsAccessError(403, 'PROJECT_WRITE_FORBIDDEN', 'Viewer access is read-only.');
        }
        if (owner && membership.data.role !== 'Owner') {
            throw new ProjectsAccessError(403, 'PROJECT_OWNER_REQUIRED', 'Project owner access required.');
        }
        const linkedRecords = await resolveLinkedRecords(project, identity);
        return { identity, project, membership, linkedRecords };
    }

    async function authorizeProjectManagement(identity, projectId) {
        assertActive(identity);
        const isAdmin = identity.profile?.isAdmin === true || hasAdminRole(identity.workforce);
        if (isAdmin) {
            return { identity, project: await readProject(projectId), membership: null };
        }
        return authorizeProject(identity, projectId, { owner: true });
    }

    async function listPeople() {
        const [profilesSnap, workforceSnap, allowanceSnap] = await Promise.all([
            db.collection('users').get(),
            db.collection(PROJECT_COLLECTIONS.workforce).get(),
            db.collection(PROJECT_COLLECTIONS.allowance).get()
        ]);
        const workforceByUid = new Map();
        workforceSnap?.forEach?.((doc) => workforceByUid.set(doc.id, doc.data() || {}));
        const allowanceByUid = new Map();
        allowanceSnap?.forEach?.((doc) => allowanceByUid.set(doc.id, doc.data() || {}));
        const profileDocs = profilesSnap?.docs || [];
        const authByUid = new Map();
        if (typeof auth?.listUsers === 'function') {
            let pageToken;
            do {
                const page = await auth.listUsers(1000, pageToken);
                for (const authUser of page?.users || []) {
                    const uid = normalizeUid(authUser?.uid);
                    if (uid) authByUid.set(uid, authUser);
                }
                pageToken = page?.pageToken || undefined;
            } while (pageToken);
        } else {
            // Test adapters and small local auth shims may only provide
            // getUser. Keep those lookups bounded and concurrent instead of
            // serializing the directory over every profile.
            const queue = profileDocs.slice();
            const worker = async () => {
                while (queue.length) {
                    const doc = queue.shift();
                    const uid = normalizeUid(doc?.id);
                    if (!uid) continue;
                    try {
                        authByUid.set(uid, await readAuthUser(uid));
                    } catch (error) {
                        if (error instanceof ProjectsAccessError && error.code === 'UNAUTHORIZED') continue;
                        throw error;
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(16, Math.max(1, queue.length)) }, () => worker()));
        }
        const people = [];
        for (const doc of profileDocs) {
            const profile = doc.data() || {};
            const uid = normalizeUid(doc.id);
            if (!uid) continue;
            const workforce = workforceByUid.get(uid) || null;
            const authUser = authByUid.get(uid);
            // A stale profile with no Auth account is not a usable workforce
            // account and is omitted from the admin directory.
            if (!authUser) continue;
            const allowance = allowanceByUid.get(uid) || null;
            const current = safePublicProfile(uid, profile, workforce, authUser);
            people.push({
                ...current,
                workforceExists: !!workforce,
                workforceRevision: Number.isSafeInteger(Number(workforce?.revision)) ? Number(workforce.revision) : 0,
                moduleGrants: workforce?.moduleGrants && typeof workforce.moduleGrants === 'object'
                    ? { projects: readModuleGrant(workforce, 'projects') }
                    : { projects: false },
                allowanceOverrideCents: Number.isSafeInteger(Number(allowance?.monthlyAllowanceCents))
                    ? Number(allowance.monthlyAllowanceCents)
                    : null
            });
        }
        people.sort((a, b) => (a.displayName || a.email || a.uid).localeCompare(b.displayName || b.email || b.uid));
        return people;
    }

    function validateAllowanceCents(value) {
        if (value === undefined || value === null || value === '' || typeof value === 'boolean'
            || (typeof value === 'object' && value !== null)) {
            throw new ProjectsAccessError(400, 'INVALID_ALLOWANCE', 'Allowance must be a non-negative integer number of US cents.');
        }
        const cents = Number(value);
        if (!Number.isSafeInteger(cents) || cents < 0 || cents > DEFAULT_ALLOWANCE_CENTS) {
            throw new ProjectsAccessError(400, 'INVALID_ALLOWANCE', 'Allowance must be an integer from 0 through 500 US cents.');
        }
        return cents;
    }

    async function updateWorkforce(identity, rawUid, patch = {}) {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid account UID.');
        const previous = statusSyncLocks.get(uid) || Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const current = previous.then(() => gate);
        statusSyncLocks.set(uid, current);
        await previous;
        try {
            return await updateWorkforceLocked(identity, uid, patch);
        } finally {
            release();
            if (statusSyncLocks.get(uid) === current) statusSyncLocks.delete(uid);
        }
    }

    async function updateWorkforceLocked(identity, uid, patch = {}) {
        assertAdmin(identity);
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new ProjectsAccessError(400, 'INVALID_REQUEST', 'Access changes must be an object.');
        }
        const statusWasSubmitted = patch.status !== undefined || patch.accountStatus !== undefined;
        let requestedStatus = null;
        if (statusWasSubmitted) {
            requestedStatus = normalizeAccountStatus(patch.status ?? patch.accountStatus);
            if (!requestedStatus) throw new ProjectsAccessError(400, 'INVALID_ACCOUNT_STATUS', 'Status must be active, suspended, or archived.');
        }
        let requestedProjectsGrant = null;
        if (patch.projects !== undefined) {
            if (typeof patch.projects !== 'boolean') throw new ProjectsAccessError(400, 'INVALID_MODULE_GRANT', 'projects grant must be a boolean.');
            requestedProjectsGrant = patch.projects;
        }
        if (patch.moduleGrants !== undefined) {
            if (!patch.moduleGrants || typeof patch.moduleGrants !== 'object' || Array.isArray(patch.moduleGrants)
                || Object.keys(patch.moduleGrants).some((key) => key !== 'projects')) {
                throw new ProjectsAccessError(400, 'INVALID_MODULE_GRANT', 'Only the Projects module grant is managed here.');
            }
            if (patch.moduleGrants.projects !== undefined) {
                if (typeof patch.moduleGrants.projects !== 'boolean') throw new ProjectsAccessError(400, 'INVALID_MODULE_GRANT', 'projects grant must be a boolean.');
                requestedProjectsGrant = patch.moduleGrants.projects;
            }
        }
        const profileRef = ref('users', uid);
        const workforceRef = ref(PROJECT_COLLECTIONS.workforce, uid);
        let result = null;
        let resultingProfile = null;
        let resultingWorkforce = null;
        try {
            await db.runTransaction(async (transaction) => {
                const actorIdentity = await assertTransactionAdmin(transaction, identity.uid);
                const [profileSnap, workforceSnap] = await Promise.all([
                    transaction.get(profileRef),
                    transaction.get(workforceRef)
                ]);
                if (!profileSnap?.exists) throw new ProjectsAccessError(404, 'ACCOUNT_NOT_FOUND', 'User account not found.');
                const profile = profileSnap.data() || {};
                const existing = workforceSnap?.exists ? (workforceSnap.data() || {}) : {};
                if (existing.authSync && existing.authSync.state === 'pending') {
                    throw new ProjectsAccessError(409, 'AUTH_SYNC_PENDING', 'Account authentication access is still synchronizing; retry after it completes.');
                }
                const currentStatus = normalizeAccountStatus(existing.status, 'active');
                const nextStatus = requestedStatus || currentStatus;
                if (!nextStatus) throw new ProjectsAccessError(400, 'INVALID_ACCOUNT_STATUS', 'Status must be active, suspended, or archived.');
                if (uid === identity.uid && nextStatus !== 'active') {
                    throw new ProjectsAccessError(403, 'SELF_SUSPENSION_FORBIDDEN', 'Cannot suspend or archive your own administrator account.');
                }
                const bootstrapValues = deps.bootstrapAdminEmails instanceof Set
                    ? Array.from(deps.bootstrapAdminEmails)
                    : (Array.isArray(deps.bootstrapAdminEmails) ? deps.bootstrapAdminEmails : [deps.bootstrapAdminEmails]);
                const bootstrapEmailSet = new Set(
                    bootstrapValues
                        .map((value) => String(value || '').trim().toLowerCase())
                        .filter(Boolean)
                );
                const isBootstrapAdmin = profile.isBootstrapAdmin === true
                    || (profile.email && bootstrapEmailSet.has(String(profile.email).trim().toLowerCase()))
                    || (typeof deps.isBootstrapAdmin === 'function' && deps.isBootstrapAdmin({ uid, profile }) === true);
                if (isBootstrapAdmin && nextStatus !== 'active') {
                    throw new ProjectsAccessError(403, 'BOOTSTRAP_ADMIN_PROTECTED', 'Cannot suspend or archive the bootstrap administrator.');
                }
                const currentGrants = existing.moduleGrants && typeof existing.moduleGrants === 'object' ? existing.moduleGrants : {};
                const nextProjectsGrant = requestedProjectsGrant === null
                    ? readModuleGrant(existing, 'projects')
                    : requestedProjectsGrant;
                const currentRevision = Number.isSafeInteger(Number(existing.revision)) ? Number(existing.revision) : 0;
                const expected = normalizeExpectedRevision(patch.expectedRevision);
                if (Number.isNaN(expected)) throw new ProjectsAccessError(400, 'INVALID_REVISION', 'expectedRevision must be a non-negative integer.');
                if (expected !== null && expected !== currentRevision) throw new ProjectsAccessError(409, 'STALE_REVISION', 'Account access changed; refresh and retry.');
                const timestamp = toIso(now());
                const workforcePatch = {
                    uid,
                    status: nextStatus,
                    revision: currentRevision + 1,
                    updatedAt: timestamp,
                    updatedBy: identity.uid
                };
                if (requestedProjectsGrant !== null) workforcePatch.moduleGrants = { ...currentGrants, projects: nextProjectsGrant };
                if (statusWasSubmitted) {
                    workforcePatch.authSync = {
                        operationId: crypto.randomUUID(),
                        desiredDisabled: nextStatus !== 'active',
                        state: 'pending',
                        startedAt: timestamp,
                        startedBy: identity.uid
                    };
                }
                transaction.set(workforceRef, workforcePatch, { merge: true });
                if (statusWasSubmitted) {
                    transaction.set(profileRef, {
                        accountStatus: nextStatus,
                        archived: nextStatus === 'archived',
                        archivedAt: nextStatus === 'archived' ? timestamp : null,
                        projectsAccessUpdatedAt: timestamp,
                        projectsAccessUpdatedBy: identity.uid
                    }, { merge: true });
                }
                resultingProfile = { ...profile, ...(statusWasSubmitted ? { accountStatus: nextStatus, archived: nextStatus === 'archived' } : {}) };
                resultingWorkforce = { ...existing, ...workforcePatch };
                result = {
                    status: nextStatus,
                    authNeedsDisabled: nextStatus !== 'active',
                    statusWasSubmitted,
                    timestamp,
                    operationId: workforcePatch.authSync?.operationId || null
                };
            });
        } catch (error) {
            throw error instanceof ProjectsAccessError
                ? error
                : new ProjectsAccessError(503, 'ACCOUNT_UPDATE_FAILED', 'Account access could not be persisted.');
        }

        // Firestore remains the fail-closed source while Auth is synchronized:
        // a failed disable leaves the account blocked by profile/workforce
        // status, and a failed restore leaves Auth disabled until retried.
        let authUser;
        try {
            authUser = await readAuthUser(uid);
            if (result.statusWasSubmitted) {
                if (typeof auth?.updateUser !== 'function') throw new Error('Auth update is unavailable.');
                await auth.updateUser(uid, { disabled: result.authNeedsDisabled });
                if (result.authNeedsDisabled && typeof auth?.revokeRefreshTokens === 'function') {
                    await auth.revokeRefreshTokens(uid);
                }
                await db.runTransaction(async (transaction) => {
                    const latest = await transaction.get(workforceRef);
                    const latestData = latest?.exists ? (latest.data() || {}) : {};
                    const sync = latestData.authSync || {};
                    if (sync.operationId !== result.operationId || sync.state !== 'pending') {
                        throw new ProjectsAccessError(409, 'AUTH_SYNC_RACE', 'Account authentication state changed; retry the access update.');
                    }
                    const completedAt = toIso(now());
                    transaction.set(workforceRef, {
                        authSync: {
                            ...sync,
                            state: 'succeeded',
                            completedAt,
                            completedBy: identity.uid
                        }
                    }, { merge: true });
                    resultingWorkforce = {
                        ...resultingWorkforce,
                        authSync: { ...sync, state: 'succeeded', completedAt, completedBy: identity.uid }
                    };
                });
            }
        } catch (error) {
            if (result?.statusWasSubmitted && result?.operationId) {
                try {
                    await db.runTransaction(async (transaction) => {
                        const latest = await transaction.get(workforceRef);
                        const latestData = latest?.exists ? (latest.data() || {}) : {};
                        const sync = latestData.authSync || {};
                        if (sync.operationId !== result.operationId || sync.state !== 'pending') return;
                        transaction.set(workforceRef, {
                            authSync: {
                                ...sync,
                                state: 'failed',
                                failedAt: toIso(now()),
                                failedBy: identity.uid
                            }
                        }, { merge: true });
                    });
                } catch (_) {
                    // A matching pending record keeps access closed if failure
                    // recording itself is unavailable. A later reconciliation
                    // can recover an abandoned operation.
                }
            }
            throw new ProjectsAccessError(503, 'AUTH_UPDATE_FAILED', 'Account authentication state could not be updated.');
        }
        return safePublicProfile(uid, resultingProfile, resultingWorkforce, {
            ...(authUser || {}),
            disabled: result.statusWasSubmitted ? result.authNeedsDisabled : authUser?.disabled === true
        });
    }

    // A provider failure leaves a durable failed operation and keeps the
    // account closed. An administrator may explicitly retry that exact
    // desired Auth state; competing ordinary status changes remain blocked
    // while the operation is pending.
    async function retryWorkforceAuthSync(identity, rawUid) {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid account UID.');
        const previous = statusSyncLocks.get(uid) || Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const current = previous.then(() => gate);
        statusSyncLocks.set(uid, current);
        await previous;
        try {
            assertAdmin(identity);
            const profileRef = ref('users', uid);
            const workforceRef = ref(PROJECT_COLLECTIONS.workforce, uid);
            let result;
            let resultingProfile;
            let resultingWorkforce;
            await db.runTransaction(async (transaction) => {
                const actorIdentity = await assertTransactionAdmin(transaction, identity.uid);
                const [profileSnap, workforceSnap] = await Promise.all([
                    transaction.get(profileRef),
                    transaction.get(workforceRef)
                ]);
                if (!profileSnap?.exists || !workforceSnap?.exists) throw new ProjectsAccessError(404, 'ACCOUNT_NOT_FOUND', 'User account not found.');
                const profile = profileSnap.data() || {};
                const existing = workforceSnap.data() || {};
                const sync = existing.authSync || {};
                if (sync.state === 'pending') throw new ProjectsAccessError(409, 'AUTH_SYNC_PENDING', 'Account authentication state is still synchronizing; retry after it completes.');
                if (sync.state !== 'failed' || typeof sync.desiredDisabled !== 'boolean') {
                    throw new ProjectsAccessError(409, 'AUTH_SYNC_NOT_RETRYABLE', 'There is no failed authentication update to retry.');
                }
                const currentRevision = Number.isSafeInteger(Number(existing.revision)) ? Number(existing.revision) : 0;
                const timestamp = toIso(now());
                const operationId = crypto.randomUUID();
                const workforcePatch = {
                    revision: currentRevision + 1,
                    updatedAt: timestamp,
                    updatedBy: actorIdentity.uid,
                    authSync: {
                        ...sync,
                        operationId,
                        desiredDisabled: sync.desiredDisabled,
                        state: 'pending',
                        retryOf: sync.operationId || null,
                        startedAt: timestamp,
                        startedBy: actorIdentity.uid,
                        failedAt: null,
                        failedBy: null
                    }
                };
                transaction.set(workforceRef, workforcePatch, { merge: true });
                resultingProfile = profile;
                resultingWorkforce = { ...existing, ...workforcePatch };
                result = {
                    statusWasSubmitted: true,
                    authNeedsDisabled: sync.desiredDisabled,
                    operationId
                };
            });
            let authUser;
            try {
                authUser = await readAuthUser(uid);
                if (typeof auth?.updateUser !== 'function') throw new Error('Auth update is unavailable.');
                await auth.updateUser(uid, { disabled: result.authNeedsDisabled });
                if (result.authNeedsDisabled && typeof auth?.revokeRefreshTokens === 'function') await auth.revokeRefreshTokens(uid);
                await db.runTransaction(async (transaction) => {
                    const latest = await transaction.get(workforceRef);
                    const latestData = latest?.exists ? (latest.data() || {}) : {};
                    const sync = latestData.authSync || {};
                    if (sync.operationId !== result.operationId || sync.state !== 'pending') {
                        throw new ProjectsAccessError(409, 'AUTH_SYNC_RACE', 'Account authentication state changed; retry the access update.');
                    }
                    transaction.set(workforceRef, {
                        authSync: { ...sync, state: 'succeeded', completedAt: toIso(now()), completedBy: identity.uid }
                    }, { merge: true });
                    resultingWorkforce = { ...resultingWorkforce, authSync: { ...sync, state: 'succeeded' } };
                });
            } catch (error) {
                try {
                    await db.runTransaction(async (transaction) => {
                        const latest = await transaction.get(workforceRef);
                        const latestData = latest?.exists ? (latest.data() || {}) : {};
                        const sync = latestData.authSync || {};
                        if (sync.operationId !== result.operationId || sync.state !== 'pending') return;
                        transaction.set(workforceRef, {
                            authSync: {
                                ...sync,
                                state: 'failed',
                                failedAt: toIso(now()),
                                failedBy: identity.uid
                            }
                        }, { merge: true });
                    });
                } catch (_) { /* Keep the matching pending fence if recording fails. */ }
                throw new ProjectsAccessError(503, 'AUTH_UPDATE_FAILED', 'Account authentication state could not be updated.');
            }
            return safePublicProfile(uid, resultingProfile, resultingWorkforce, {
                ...(authUser || {}),
                disabled: result.authNeedsDisabled
            });
        } finally {
            release();
            if (statusSyncLocks.get(uid) === current) statusSyncLocks.delete(uid);
        }
    }

    async function reconcileAbandonedAuthSync(identity, rawUid, options = {}) {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid account UID.');
        if (options.confirmAbandoned !== true) {
            throw new ProjectsAccessError(400, 'CONFIRMATION_REQUIRED', 'Confirm that this pending authentication operation was abandoned.');
        }
        const previous = statusSyncLocks.get(uid) || Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const current = previous.then(() => gate);
        statusSyncLocks.set(uid, current);
        await previous;
        try {
            const profileRef = ref('users', uid);
            const workforceRef = ref(PROJECT_COLLECTIONS.workforce, uid);
            let result;
            let authUser;
            let resultingProfile;
            let resultingWorkforce;
            await db.runTransaction(async (transaction) => {
                const actorIdentity = await assertTransactionAdmin(transaction, identity.uid);
                const [profileSnap, workforceSnap] = await Promise.all([
                    transaction.get(profileRef),
                    transaction.get(workforceRef)
                ]);
                if (!profileSnap?.exists || !workforceSnap?.exists) throw new ProjectsAccessError(404, 'ACCOUNT_NOT_FOUND', 'User account not found.');
                const profile = profileSnap.data() || {};
                const existing = workforceSnap.data() || {};
                const sync = existing.authSync || {};
                if (sync.state !== 'pending' || typeof sync.desiredDisabled !== 'boolean') {
                    throw new ProjectsAccessError(409, 'AUTH_SYNC_NOT_PENDING', 'There is no pending authentication operation to reconcile.');
                }
                const startedAt = Date.parse(String(sync.startedAt || ''));
                const elapsed = new Date(now()).getTime() - startedAt;
                if (!Number.isFinite(startedAt) || elapsed < AUTH_SYNC_ABANDONED_AFTER_MS) {
                    throw new ProjectsAccessError(409, 'AUTH_SYNC_PENDING', 'The authentication operation is still within its recovery window.');
                }
                authUser = await readAuthUser(uid);
                const currentRevision = Number.isSafeInteger(Number(existing.revision)) ? Number(existing.revision) : 0;
                const timestamp = toIso(now());
                const providerMatches = authUser.disabled === sync.desiredDisabled;
                const nextSync = providerMatches
                    ? { ...sync, state: 'succeeded', completedAt: timestamp, completedBy: actorIdentity.uid, reconciled: true }
                    : { ...sync, state: 'failed', failedAt: timestamp, failedBy: actorIdentity.uid, failureReason: 'ABANDONED_OPERATION', reconciled: true };
                transaction.set(workforceRef, {
                    revision: currentRevision + 1,
                    updatedAt: timestamp,
                    updatedBy: actorIdentity.uid,
                    authSync: nextSync
                }, { merge: true });
                result = { providerMatches, statusWasSubmitted: true, authNeedsDisabled: sync.desiredDisabled, operationId: sync.operationId };
                resultingProfile = profile;
                resultingWorkforce = { ...existing, revision: currentRevision + 1, authSync: nextSync };
            });
            return safePublicProfile(uid, resultingProfile, resultingWorkforce, {
                ...(authUser || {}),
                disabled: authUser?.disabled === true
            });
        } finally {
            release();
            if (statusSyncLocks.get(uid) === current) statusSyncLocks.delete(uid);
        }
    }

    async function getOrganizationConfig(identity) {
        assertAdmin(identity);
        const snapshot = await ref(PROJECT_COLLECTIONS.organizationConfig, 'calendar').get();
        const data = snapshot?.exists ? (snapshot.data() || {}) : {};
        return {
            timezone: normalizeTimezone(data.timezone || DEFAULT_TIMEZONE),
            workingWeekdays: normalizeWeekdays(data.workingWeekdays),
            leaves: normalizeLeaves(data.leaves),
            holidayChoices: normalizeHolidayChoices(data.holidayChoices),
            ...calendarSummary(data),
            revision: Number.isSafeInteger(Number(data.revision)) ? Number(data.revision) : 0,
            updatedAt: data.updatedAt || null
        };
    }

    function normalizeWeekdays(value) {
        const raw = value === undefined ? DEFAULT_WORKING_WEEKDAYS : value;
        if (!Array.isArray(raw) || raw.length === 0) throw new ProjectsAccessError(400, 'INVALID_WORKING_WEEK', 'workingWeekdays must be a non-empty array of weekday numbers.');
        if (raw.some((day) => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6)) {
            throw new ProjectsAccessError(400, 'INVALID_WORKING_WEEK', 'workingWeekdays entries must be integers from 0 through 6.');
        }
        const unique = Array.from(new Set(raw));
        unique.sort((a, b) => a - b);
        return unique;
    }

    function normalizeTimezone(value) {
        const timezone = cleanString(value === undefined ? DEFAULT_TIMEZONE : value, 100);
        if (!timezone) throw new ProjectsAccessError(400, 'INVALID_TIMEZONE', 'timezone must be a non-empty IANA timezone.');
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
        } catch (_error) {
            throw new ProjectsAccessError(400, 'INVALID_TIMEZONE', 'timezone must be a valid IANA timezone.');
        }
        return timezone;
    }

    function normalizeLeaves(value) {
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.length > 500) throw new ProjectsAccessError(400, 'INVALID_CALENDAR_LEAVE', 'leaves must be an array of at most 500 entries.');
        return value.map((raw) => {
            const leave = raw && typeof raw === 'object' ? raw : {};
            let startDate, endDate;
            try {
                startDate = cleanString(leave.startDate || leave.date, 10);
                endDate = cleanString(leave.endDate || leave.date || leave.startDate, 10);
                datesInRange(startDate, endDate);
            } catch (_) { throw new ProjectsAccessError(400, 'INVALID_CALENDAR_LEAVE', 'Leave must use real dates and an inclusive range of at most 366 days.'); }
            const scope = String(leave.scope === undefined ? 'whole_team' : leave.scope).trim().toLowerCase();
            if (!['whole_team', 'specific_person'].includes(scope)) throw new ProjectsAccessError(400, 'INVALID_CALENDAR_LEAVE', 'Leave scope must be whole_team or specific_person.');
            const uid = scope === 'specific_person' ? normalizeUid(leave.uid) : null;
            if (scope === 'specific_person' && !uid) throw new ProjectsAccessError(400, 'INVALID_CALENDAR_LEAVE', 'Specific-person leave requires a UID.');
            return { ...(leave.startDate || leave.endDate ? { startDate, endDate } : { date: startDate }), scope, uid, label: cleanString(leave.label, 200) || null };
        });
    }

    async function assertTransactionEligibleLeavePeople(transaction, leaves) {
        const eligibleUids = Array.from(new Set((leaves || [])
            .filter((leave) => leave.scope === 'specific_person')
            .map((leave) => normalizeUid(leave.uid))
            .filter(Boolean)));
        for (const uid of eligibleUids) {
            const [profileSnap, workforceSnap] = await Promise.all([
                transaction.get(ref('users', uid)),
                transaction.get(ref(PROJECT_COLLECTIONS.workforce, uid))
            ]);
            const profile = profileSnap?.exists ? (profileSnap.data() || {}) : {};
            const workforce = workforceSnap?.exists ? (workforceSnap.data() || {}) : null;
            const authUser = await readAuthUser(uid);
            if (!profileSnap?.exists || !workforceSnap?.exists
                || !hasActiveWorkforce(workforce)
                || accountStatus(profile, workforce, authUser) !== 'active'
                || !readModuleGrant(workforce, 'projects')) {
                throw new ProjectsAccessError(400, 'INVALID_CALENDAR_LEAVE', 'Specific-person leave requires an active eligible Projects workforce account.');
            }
        }
    }

    async function updateOrganizationConfig(identity, patch = {}) {
        assertAdmin(identity);
        if (patch.timezone !== undefined) normalizeTimezone(patch.timezone);
        const currentRef = ref(PROJECT_COLLECTIONS.organizationConfig, 'calendar');
        let result;
        await db.runTransaction(async (transaction) => {
            const actorIdentity = await assertTransactionAdmin(transaction, identity.uid);
            const snapshot = await transaction.get(currentRef);
            const current = snapshot?.exists ? (snapshot.data() || {}) : {};
            const expected = normalizeExpectedRevision(patch.expectedRevision);
            const currentRevision = Number.isSafeInteger(Number(current.revision)) ? Number(current.revision) : 0;
            if (Number.isNaN(expected)) throw new ProjectsAccessError(400, 'INVALID_REVISION', 'expectedRevision must be a non-negative integer.');
            if (expected !== null && expected !== currentRevision) throw new ProjectsAccessError(409, 'STALE_REVISION', 'Calendar settings changed; refresh and retry.');
            const next = {
                timezone: patch.timezone !== undefined ? normalizeTimezone(patch.timezone) : normalizeTimezone(current.timezone || DEFAULT_TIMEZONE),
                workingWeekdays: patch.workingWeekdays !== undefined ? normalizeWeekdays(patch.workingWeekdays) : normalizeWeekdays(current.workingWeekdays),
                leaves: patch.leaves !== undefined ? normalizeLeaves(patch.leaves) : normalizeLeaves(current.leaves),
                holidayChoices: normalizeHolidayChoices(patch.holidayChoices !== undefined ? patch.holidayChoices : current.holidayChoices),
                revision: currentRevision + 1,
                updatedAt: toIso(now()),
                updatedBy: actorIdentity.uid
            };
            if (patch.leaves !== undefined) await assertTransactionEligibleLeavePeople(transaction, next.leaves);
            // Replace each managed top-level field. Recursive merge would retain
            // omitted year/choice keys and make explicitly cleared choices effective.
            transaction.set(currentRef, next, { mergeFields: Object.keys(next) });
            result = next;
        });
        return result;
    }

    async function getAllowanceConfig(identity, uid = null) {
        assertAdmin(identity);
        if (uid) {
            const targetUid = normalizeUid(uid);
            if (!targetUid) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid account UID.');
            const snapshot = await ref(PROJECT_COLLECTIONS.allowance, targetUid).get();
            const data = snapshot?.exists ? (snapshot.data() || {}) : {};
            return {
                uid: targetUid,
                monthlyAllowanceCents: Number.isSafeInteger(Number(data.monthlyAllowanceCents)) ? Number(data.monthlyAllowanceCents) : null,
                currency: data.currency || DEFAULT_CURRENCY,
                updatedAt: data.updatedAt || null,
                revision: Number.isSafeInteger(Number(data.revision)) ? Number(data.revision) : 0
            };
        }
        const snapshot = await ref(PROJECT_COLLECTIONS.allowanceDefaults, 'default').get();
        const data = snapshot?.exists ? (snapshot.data() || {}) : {};
        return {
            monthlyAllowanceCents: Number.isSafeInteger(Number(data.monthlyAllowanceCents)) ? Number(data.monthlyAllowanceCents) : DEFAULT_ALLOWANCE_CENTS,
            currency: data.currency || DEFAULT_CURRENCY,
            updatedAt: data.updatedAt || null,
            revision: Number.isSafeInteger(Number(data.revision)) ? Number(data.revision) : 0
        };
    }

    async function updateAllowanceConfig(identity, patch = {}, uid = null) {
        assertAdmin(identity);
        const targetId = uid ? normalizeUid(uid) : 'default';
        if (!targetId) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid account UID.');
        const cents = validateAllowanceCents(patch.monthlyAllowanceCents ?? patch.allowanceCents);
        const allowanceRef = uid
            ? ref(PROJECT_COLLECTIONS.allowance, targetId)
            : ref(PROJECT_COLLECTIONS.allowanceDefaults, 'default');
        let result;
        await db.runTransaction(async (transaction) => {
            const actorIdentity = await assertTransactionAdmin(transaction, identity.uid);
            const snapshot = await transaction.get(allowanceRef);
            const current = snapshot?.exists ? (snapshot.data() || {}) : {};
            const currentRevision = Number.isSafeInteger(Number(current.revision)) ? Number(current.revision) : 0;
            const expected = normalizeExpectedRevision(patch.expectedRevision);
            if (Number.isNaN(expected)) throw new ProjectsAccessError(400, 'INVALID_REVISION', 'expectedRevision must be a non-negative integer.');
            if (expected !== null && expected !== currentRevision) throw new ProjectsAccessError(409, 'STALE_REVISION', 'Allowance settings changed; refresh and retry.');
            result = {
                ...(uid ? { uid: targetId } : {}),
                monthlyAllowanceCents: cents,
                currency: DEFAULT_CURRENCY,
                revision: currentRevision + 1,
                updatedAt: toIso(now()),
                updatedBy: actorIdentity.uid
            };
            transaction.set(allowanceRef, result, { merge: true });
        });
        return result;
    }

    async function listProjectMembers(identity, projectId) {
        await authorizeProjectManagement(identity, projectId);
        const expectedProjectId = normalizeProjectId(projectId);
        const snapshot = await db.collection(PROJECT_COLLECTIONS.members).where('projectId', '==', expectedProjectId).get();
        const members = [];
        snapshot?.forEach?.((doc) => {
            const member = canonicalMembership(doc, expectedProjectId);
            if (member) {
                members.push({
                    id: member.id,
                    projectId: member.projectId,
                    uid: member.uid,
                    role: member.role,
                    active: true
                });
            }
        });
        members.sort((a, b) => a.role.localeCompare(b.role) || a.uid.localeCompare(b.uid));
        return members;
    }

    async function listProjects(identity) {
        assertAdmin(identity);
        const snapshot = await db.collection(PROJECT_COLLECTIONS.projects).get();
        const projects = [];
        snapshot?.forEach?.((doc) => {
            const data = doc.data() || {};
            const id = normalizeProjectId(doc.id);
            if (!id) return;
            projects.push(serializeProjectManagement({ id, data }));
        });
        projects.sort((a, b) => String(a.name || a.title || a.id).localeCompare(String(b.name || b.title || b.id)));
        return projects;
    }

    async function listEligiblePeople(identity, projectId) {
        await authorizeProjectManagement(identity, projectId);
        const [profilesSnap, workforceSnap] = await Promise.all([
            db.collection('users').get(),
            db.collection(PROJECT_COLLECTIONS.workforce).get()
        ]);
        const workforceByUid = new Map();
        workforceSnap?.forEach?.((doc) => workforceByUid.set(doc.id, doc.data() || {}));
        const people = [];
        for (const doc of profilesSnap?.docs || []) {
            const uid = normalizeUid(doc.id);
            const profile = doc.data() || {};
            const workforce = workforceByUid.get(uid);
            if (!uid || !workforce || !readModuleGrant(workforce, 'projects')) continue;
            const authUser = await readAuthUser(uid);
            if (accountStatus(profile, workforce, authUser) !== 'active') continue;
            people.push({
                uid,
                email: cleanString(profile.email || authUser.email || '', 320),
                displayName: cleanString(profile.displayName || profile.name || authUser.displayName || '', 200)
            });
        }
        people.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
        return people;
    }

    async function listProjectMemberDirectory(identity, projectId) {
        const access = await authorizeProject(identity, projectId);
        const expectedProjectId = access.project.id;
        const snapshot = await db.collection(PROJECT_COLLECTIONS.members).where('projectId', '==', expectedProjectId).get();
        const directory = [];
        const members = (snapshot?.docs || []).map((doc) => canonicalMembership(doc, expectedProjectId)).filter(Boolean);
        // Look up member accounts in bounded parallel batches; results are
        // handled in member order.
        const lookups = [];
        for (let start = 0; start < members.length; start += 20) {
            lookups.push(...await Promise.allSettled(members.slice(start, start + 20)
                .map((member) => (member.uid ? readIdentityByUid(member.uid) : Promise.resolve(null)))));
        }
        for (const [index, member] of members.entries()) {
            const { uid } = member;
            const lookup = lookups[index];
            if (lookup.status === 'rejected') {
                if (lookup.reason instanceof ProjectsAccessError && lookup.reason.code === 'UNAUTHORIZED') continue;
                throw lookup.reason;
            }
            const profile = lookup.value;
            if (!uid || !profile || profile.status !== 'active' || !hasActiveWorkforce(profile.workforce)) continue;
            directory.push({
                uid,
                role: member.role,
                email: cleanString(profile.profile.email || profile.authUser.email || '', 320),
                displayName: cleanString(profile.profile.displayName || profile.profile.name || profile.authUser.displayName || '', 200)
            });
        }
        directory.sort((a, b) => a.displayName.localeCompare(b.displayName));
        return directory;
    }

    async function addOrUpdateMember(identity, projectId, rawUid, patch = {}) {
        const targetUid = normalizeUid(rawUid);
        if (!targetUid) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid account UID.');
        const normalizedProjectId = normalizeProjectId(projectId);
        if (!normalizedProjectId) throw new ProjectsAccessError(400, 'INVALID_PROJECT_ID', 'Invalid project ID.');
        await authorizeProjectManagement(identity, normalizedProjectId);
        const role = normalizeRole(patch.role);
        if (!role) throw new ProjectsAccessError(400, 'INVALID_PROJECT_ROLE', `role must be one of: ${PROJECT_ROLES.join(', ')}.`);
        const memberRef = ref(PROJECT_COLLECTIONS.members, memberDocumentId(normalizedProjectId, targetUid));
        const projectRef = ref(PROJECT_COLLECTIONS.projects, normalizedProjectId);
        const targetProfileRef = ref('users', targetUid);
        const targetWorkforceRef = ref(PROJECT_COLLECTIONS.workforce, targetUid);
        let result;
        await db.runTransaction(async (transaction) => {
            const actorAccess = await assertTransactionProjectManager(transaction, identity.uid, normalizedProjectId);
            const [targetProfileSnap, targetWorkforceSnap, projectSnap, memberSnap, membersSnap] = await Promise.all([
                transaction.get(targetProfileRef),
                transaction.get(targetWorkforceRef),
                transaction.get(projectRef),
                transaction.get(memberRef),
                transaction.get(db.collection(PROJECT_COLLECTIONS.members).where('projectId', '==', normalizedProjectId))
            ]);
            if (!projectSnap?.exists) throw new ProjectsAccessError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
            const freshTargetAuth = await readAuthUser(targetUid);
            const targetWorkforce = targetWorkforceSnap?.exists ? (targetWorkforceSnap.data() || {}) : null;
            if (!targetProfileSnap?.exists || !targetWorkforceSnap?.exists
                || !hasActiveWorkforce(targetWorkforce)
                || accountStatus(targetProfileSnap.data() || {}, targetWorkforce, freshTargetAuth) !== 'active') {
                throw new ProjectsAccessError(403, 'ACCOUNT_INACTIVE', 'Target account is not active.');
            }
            if (!readModuleGrant(targetWorkforce, 'projects')) {
                throw new ProjectsAccessError(403, 'PROJECTS_ACCESS_DENIED', 'Target account does not have the Projects module grant.');
            }
            const project = projectSnap.data() || {};
            const currentRevision = Number.isSafeInteger(Number(project.membershipRevision)) ? Number(project.membershipRevision) : 0;
            const expected = normalizeExpectedRevision(patch.expectedRevision);
            if (Number.isNaN(expected)) throw new ProjectsAccessError(400, 'INVALID_REVISION', 'expectedRevision must be a non-negative integer.');
            if (expected !== null && expected !== currentRevision) throw new ProjectsAccessError(409, 'STALE_REVISION', 'Membership changed; refresh and retry.');
            const currentMember = memberSnap?.exists
                ? (canonicalMembership(memberSnap, normalizedProjectId, targetUid)?.data || {})
                : {};
            if (normalizeRole(currentMember.role) === 'Owner' && role !== 'Owner') {
                let owners = 0;
                membersSnap?.forEach?.((doc) => {
                    const member = canonicalMembership(doc, normalizedProjectId);
                    if (member?.role === 'Owner') owners += 1;
                });
                if (owners <= 1) throw new ProjectsAccessError(409, 'LAST_OWNER_REQUIRED', 'Transfer ownership before changing the last project owner.');
            }
            const timestamp = toIso(now());
            const nextMember = {
                ...currentMember,
                projectId: normalizedProjectId,
                uid: targetUid,
                role,
                active: true,
                createdAt: currentMember.createdAt || timestamp,
                updatedAt: timestamp,
                updatedBy: actorAccess.identity.uid
            };
            transaction.set(memberRef, nextMember, { merge: true });
            transaction.set(projectRef, { membershipRevision: currentRevision + 1, updatedAt: timestamp, updatedBy: actorAccess.identity.uid }, { merge: true });
            result = { id: memberRef.id, ...nextMember, membershipRevision: currentRevision + 1 };
        });
        return result;
    }

    async function removeMember(identity, projectId, rawUid, patch = {}) {
        const targetUid = normalizeUid(rawUid);
        if (!targetUid) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid account UID.');
        const normalizedProjectId = normalizeProjectId(projectId);
        if (!normalizedProjectId) throw new ProjectsAccessError(400, 'INVALID_PROJECT_ID', 'Invalid project ID.');
        await authorizeProjectManagement(identity, normalizedProjectId);
        const memberRef = ref(PROJECT_COLLECTIONS.members, memberDocumentId(normalizedProjectId, targetUid));
        const projectRef = ref(PROJECT_COLLECTIONS.projects, normalizedProjectId);
        let result;
        await db.runTransaction(async (transaction) => {
            const actorAccess = await assertTransactionProjectManager(transaction, identity.uid, normalizedProjectId);
            const [projectSnap, memberSnap, ownerQuery] = await Promise.all([
                transaction.get(projectRef),
                transaction.get(memberRef),
                transaction.get(db.collection(PROJECT_COLLECTIONS.members).where('projectId', '==', normalizedProjectId))
            ]);
            const currentMember = memberSnap?.exists
                ? canonicalMembership(memberSnap, normalizedProjectId, targetUid)
                : null;
            if (!projectSnap?.exists || !currentMember) throw new ProjectsAccessError(404, 'MEMBER_NOT_FOUND', 'Project member not found.');
            const currentRevision = Number.isSafeInteger(Number(projectSnap.data()?.membershipRevision)) ? Number(projectSnap.data()?.membershipRevision) : 0;
            const expected = normalizeExpectedRevision(patch.expectedRevision);
            if (Number.isNaN(expected)) throw new ProjectsAccessError(400, 'INVALID_REVISION', 'expectedRevision must be a non-negative integer.');
            if (expected !== null && expected !== currentRevision) throw new ProjectsAccessError(409, 'STALE_REVISION', 'Membership changed; refresh and retry.');
            if (normalizeRole(currentMember.role) === 'Owner') {
                let owners = 0;
                ownerQuery?.forEach?.((doc) => {
                    const member = canonicalMembership(doc, normalizedProjectId);
                    if (member?.role === 'Owner') owners += 1;
                });
                if (owners <= 1) throw new ProjectsAccessError(409, 'LAST_OWNER_REQUIRED', 'Transfer ownership before removing the last project owner.');
            }
            const timestamp = toIso(now());
            transaction.delete(memberRef);
            transaction.set(projectRef, { membershipRevision: currentRevision + 1, updatedAt: timestamp, updatedBy: actorAccess.identity.uid }, { merge: true });
            result = { uid: targetUid, projectId: normalizedProjectId, membershipRevision: currentRevision + 1 };
        });
        return result;
    }

    async function transferOwner(identity, projectId, rawTargetUid, patch = {}) {
        const targetUid = normalizeUid(rawTargetUid);
        if (!targetUid) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid target UID.');
        const normalizedProjectId = normalizeProjectId(projectId);
        if (!normalizedProjectId) throw new ProjectsAccessError(400, 'INVALID_PROJECT_ID', 'Invalid project ID.');
        await authorizeProjectManagement(identity, normalizedProjectId);
        const targetRef = ref(PROJECT_COLLECTIONS.members, memberDocumentId(normalizedProjectId, targetUid));
        const projectRef = ref(PROJECT_COLLECTIONS.projects, normalizedProjectId);
        const targetProfileRef = ref('users', targetUid);
        const targetWorkforceRef = ref(PROJECT_COLLECTIONS.workforce, targetUid);
        let result;
        await db.runTransaction(async (transaction) => {
            const actorAccess = await assertTransactionProjectManager(transaction, identity.uid, normalizedProjectId);
            const [targetProfileSnap, targetWorkforceSnap, projectSnap, targetSnap] = await Promise.all([
                transaction.get(targetProfileRef),
                transaction.get(targetWorkforceRef),
                transaction.get(projectRef),
                transaction.get(targetRef)
            ]);
            const targetMember = targetSnap?.exists
                ? canonicalMembership(targetSnap, normalizedProjectId, targetUid)
                : null;
            if (!projectSnap?.exists || !targetMember) throw new ProjectsAccessError(409, 'OWNER_TRANSFER_TARGET_INVALID', 'Ownership transfer requires an existing member.');
            const freshTargetAuth = await readAuthUser(targetUid);
            const targetWorkforce = targetWorkforceSnap?.exists ? (targetWorkforceSnap.data() || {}) : null;
            if (!targetProfileSnap?.exists || !targetWorkforceSnap?.exists
                || !hasActiveWorkforce(targetWorkforce)
                || accountStatus(targetProfileSnap.data() || {}, targetWorkforce, freshTargetAuth) !== 'active'
                || !readModuleGrant(targetWorkforce, 'projects')) {
                throw new ProjectsAccessError(403, 'OWNER_TRANSFER_TARGET_INVALID', 'Ownership transfer target is not eligible.');
            }
            const project = projectSnap.data() || {};
            const requestedCurrentUid = normalizeUid(patch.fromUid);
            const currentOwnerUid = normalizeUid(project.ownerUid) || identity.uid;
            if (requestedCurrentUid && requestedCurrentUid !== currentOwnerUid) {
                throw new ProjectsAccessError(409, 'OWNER_TRANSFER_TARGET_INVALID', 'The current owner changed; refresh and retry.');
            }
            if (!actorAccess.actorIsAdmin && currentOwnerUid !== actorAccess.identity.uid) {
                throw new ProjectsAccessError(403, 'PROJECT_OWNER_REQUIRED', 'Project owner access required.');
            }
            const currentRef = ref(PROJECT_COLLECTIONS.members, memberDocumentId(normalizedProjectId, currentOwnerUid));
            const currentSnap = await transaction.get(currentRef);
            const currentMember = currentSnap?.exists
                ? canonicalMembership(currentSnap, normalizedProjectId, currentOwnerUid)
                : null;
            if (!currentMember || currentMember.role !== 'Owner') {
                throw new ProjectsAccessError(409, 'OWNER_TRANSFER_TARGET_INVALID', 'Ownership transfer requires an existing active owner and member.');
            }
            if (currentOwnerUid === targetUid) {
                throw new ProjectsAccessError(400, 'OWNER_TRANSFER_TARGET_INVALID', 'Target is already the project owner.');
            }
            const currentRevision = Number.isSafeInteger(Number(project.membershipRevision)) ? Number(project.membershipRevision) : 0;
            const expected = normalizeExpectedRevision(patch.expectedRevision);
            if (Number.isNaN(expected)) throw new ProjectsAccessError(400, 'INVALID_REVISION', 'expectedRevision must be a non-negative integer.');
            if (expected !== null && expected !== currentRevision) throw new ProjectsAccessError(409, 'STALE_REVISION', 'Membership changed; refresh and retry.');
            const timestamp = toIso(now());
            transaction.set(currentRef, { role: 'Editor', updatedAt: timestamp, updatedBy: actorAccess.identity.uid }, { merge: true });
            transaction.set(targetRef, { role: 'Owner', updatedAt: timestamp, updatedBy: actorAccess.identity.uid }, { merge: true });
            transaction.set(projectRef, { ownerUid: targetUid, membershipRevision: currentRevision + 1, updatedAt: timestamp, updatedBy: actorAccess.identity.uid }, { merge: true });
            result = {
                projectId: normalizedProjectId,
                previousOwnerUid: currentOwnerUid,
                ownerUid: targetUid,
                membershipRevision: currentRevision + 1
            };
        });
        return result;
    }

    async function readIdentityByUid(rawUid) {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new ProjectsAccessError(400, 'INVALID_UID', 'Invalid account UID.');
        const [authUser, profileSnap, workforceSnap] = await Promise.all([
            readAuthUser(uid),
            ref('users', uid).get(),
            ref(PROJECT_COLLECTIONS.workforce, uid).get()
        ]);
        const profile = profileSnap?.exists ? (profileSnap.data() || {}) : {};
        const workforce = workforceSnap?.exists ? (workforceSnap.data() || {}) : null;
        return { uid, authUser, profile, workforce, profileExists: !!profileSnap?.exists, workforceExists: !!workforceSnap?.exists, status: accountStatus(profile, workforce, authUser) };
    }

    async function getAccessSummary(identity) {
        assertActive(identity);
        const projects = [];
        if (identity.workforceExists && hasActiveWorkforce(identity.workforce) && readModuleGrant(identity.workforce, 'projects')) {
            const memberships = await db.collection(PROJECT_COLLECTIONS.members).where('uid', '==', identity.uid).get();
            const projectIds = [];
            memberships?.forEach?.((doc) => {
                const data = doc.data() || {};
                const projectId = normalizeProjectId(data.projectId);
                const member = canonicalMembership(doc, projectId, identity.uid);
                if (member) {
                    projectIds.push({ projectId: member.projectId, role: member.role });
                }
            });
            for (const entry of projectIds) {
                try {
                    // Query rows are only candidates. Reuse the canonical
                    // project authorization fence so a forged document ID,
                    // stale tuple, or mismatched role cannot grant summary
                    // access or leak project data.
                    const access = await authorizeProject(identity, entry.projectId);
                    projects.push(serializeProjectAccess(access));
                } catch (error) {
                    if (error instanceof ProjectsAccessError && ['PROJECT_NOT_FOUND'].includes(error.code)) continue;
                    throw error;
                }
            }
        }
        return {
            identity: safePublicProfile(identity.uid, identity.profile, identity.workforce, identity.authUser),
            canManagePeople: identity.profile?.isAdmin === true || hasAdminRole(identity.workforce),
            projects
        };
    }

    return {
        authenticateToken,
        authenticateRequest,
        readIdentityByUid,
        assertActive,
        assertAdmin,
        assertProjectsGrant,
        assertTransactionEligible,
        assertTransactionContentAccess,
        authorizeProjectContent,
        authorizeProject,
        resolveLinkedRecords,
        getAccessSummary,
        listPeople,
        updateWorkforce,
        retryWorkforceAuthSync,
        reconcileAbandonedAuthSync,
        getOrganizationConfig,
        updateOrganizationConfig,
        getAllowanceConfig,
        updateAllowanceConfig,
        listProjectMembers,
        listProjects,
        listEligiblePeople,
        listProjectMemberDirectory,
        addOrUpdateMember,
        removeMember,
        transferOwner,
        authorizeProjectManagement,
        serializeProjectAccess,
        serializeProjectManagement,
        constants: {
            PROJECT_ROLES,
            PROJECT_COLLECTIONS,
            DEFAULT_ALLOWANCE_CENTS,
            DEFAULT_CURRENCY,
            DEFAULT_TIMEZONE,
            DEFAULT_WORKING_WEEKDAYS
        }
    };
}

module.exports = {
    PROJECT_ROLES,
    PROJECT_COLLECTIONS,
    DEFAULT_ALLOWANCE_CENTS,
    DEFAULT_CURRENCY,
    DEFAULT_TIMEZONE,
    DEFAULT_WORKING_WEEKDAYS,
    AUTH_SYNC_ABANDONED_AFTER_MS,
    ProjectsAccessError,
    createProjectsAccessService,
    serializeProjectAccess,
    serializeProjectManagement,
    normalizeUid,
    normalizeProjectId,
    normalizeRole,
    normalizeAccountStatus,
    memberDocumentId,
    readModuleGrant
};
