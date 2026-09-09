'use strict';

const assert = require('assert');
const express = require('express');
const http = require('http');
const createProjectsRouter = require('../../../functions/src/routes/crm/projects');
const {
    PROJECT_COLLECTIONS,
    createProjectsAccessService,
    memberDocumentId,
    readModuleGrant
} = require('../../../functions/src/crm/projects/access-service');

class FakeSnapshot {
    constructor(id, value) { this.id = id; this._value = value; this.exists = value !== undefined; }
    data() { return this._value; }
}

class FakeQuery {
    constructor(collection, field, value) { this.collection = collection; this.field = field; this.value = value; }
    async get() { return this.collection.db.query(this); }
}

class FakeCollection {
    constructor(db, name) { this.db = db; this.name = name; }
    doc(id) { return new FakeDoc(this.db, this.name, String(id)); }
    where(field, op, value) { assert.strictEqual(op, '=='); return new FakeQuery(this, field, value); }
    async get() { return this.db.query(new FakeQuery(this, null, null)); }
}

class FakeDoc {
    constructor(db, collection, id) { this.db = db; this.collection = collection; this.id = id; this.path = `${collection}/${id}`; }
    async get() { return this.db.snapshot(this.collection, this.id); }
    set(value, options) { return this.db.write(this.collection, this.id, value, options); }
    delete() { return this.db.remove(this.collection, this.id); }
}

class FakeDb {
    constructor() { this.data = new Map(); }
    collection(name) { return new FakeCollection(this, name); }
    key(collection, id) { return `${collection}/${id}`; }
    snapshot(collection, id) { const value = this.data.get(this.key(collection, id)); return Promise.resolve(new FakeSnapshot(String(id), value && { ...value })); }
    query(query) {
        const rows = [];
        for (const [key, value] of this.data.entries()) {
            const [collection, ...idParts] = key.split('/');
            if (collection !== query.collection.name) continue;
            if (query.field && value[query.field] !== query.value) continue;
            rows.push(new FakeSnapshot(idParts.join('/'), { ...value }));
        }
        return Promise.resolve({ docs: rows, forEach(fn) { rows.forEach(fn); } });
    }
    write(collection, id, value, options = {}) {
        const key = this.key(collection, id);
        const current = this.data.get(key) || {};
        this.data.set(key, options.merge ? { ...current, ...value } : { ...value });
        return Promise.resolve();
    }
    remove(collection, id) { this.data.delete(this.key(collection, id)); return Promise.resolve(); }
    async runTransaction(fn) {
        const writes = [];
        const transaction = {
            get: async (target) => target instanceof FakeQuery ? this.query(target) : target.get(),
            set: (target, value, options) => writes.push(() => this.write(target.collection, target.id, value, options)),
            delete: (target) => writes.push(() => this.remove(target.collection, target.id))
        };
        const result = await fn(transaction);
        for (const write of writes) await write();
        return result;
    }
}

function makeAuth() {
    const users = new Map();
    const tokens = new Map();
    const calls = { verify: [] };
    return {
        users, tokens, calls,
        verifyIdToken: async (token, checkRevoked) => {
            calls.verify.push({ token, checkRevoked });
            if (token === 'revoked') { const error = new Error('revoked'); error.code = 'auth/id-token-revoked'; throw error; }
            if (token === 'suspended-token' && checkRevoked) { const error = new Error('disabled'); error.code = 'auth/user-disabled'; throw error; }
            const decoded = tokens.get(token);
            if (!decoded) throw new Error('invalid');
            return { ...decoded };
        },
        getUser: async (uid) => {
            const user = users.get(uid);
            if (!user) { const error = new Error('missing'); error.code = 'auth/user-not-found'; throw error; }
            return { ...user };
        },
        updateUser: async (uid, patch) => { users.set(uid, { ...users.get(uid), ...patch }); },
        revokeRefreshTokens: async () => {}
    };
}

function seed(db, auth) {
    const profiles = [
        ['admin', { uid: 'admin', email: 'admin@example.test', accountStatus: 'active', isAdmin: true }],
        ['owner', { uid: 'owner', email: 'owner@example.test', accountStatus: 'active', isTeacher: true, workforceGrants: { projects: true } }],
        ['editor', { uid: 'editor', email: 'editor@example.test', accountStatus: 'active' }],
        ['viewer', { uid: 'viewer', email: 'viewer@example.test', accountStatus: 'active' }],
        ['profile-only', { uid: 'profile-only', email: 'profile-only@example.test', accountStatus: 'active', workforceGrants: { projects: true } }],
        ['suspended', { uid: 'suspended', email: 'suspended@example.test', accountStatus: 'suspended' }]
    ];
    for (const [uid, profile] of profiles) {
        db.data.set(`users/${uid}`, profile);
        db.data.set(`${PROJECT_COLLECTIONS.workforce}/${uid}`, {
            uid, status: uid === 'suspended' ? 'suspended' : 'active', moduleGrants: { projects: uid !== 'profile-only' }, revision: 1
        });
        auth.users.set(uid, { uid, email: profile.email, disabled: uid === 'suspended' });
        auth.tokens.set(`${uid}-token`, { uid, auth_time: 100 });
    }
    db.data.set('crmProjects/demo', {
        name: 'Demo', ownerUid: 'owner', membershipRevision: 1,
        links: [{ module: 'crmLeads', recordId: 'secret-lead', details: 'private' }],
        linkedRecords: [
            { module: 'crmLeads', recordId: 'raw-secret-lead', secret: 'must-not-leak' },
            { module: 'crmLeads', recordId: 'forged-record-id' }
        ],
        id: 'forged-project-id',
        internalNotes: 'management-only fixture secret'
    });
    for (const [uid, role] of [['owner', 'Owner'], ['editor', 'Editor'], ['viewer', 'Viewer']]) {
        db.data.set(`${PROJECT_COLLECTIONS.members}/${memberDocumentId('demo', uid)}`, { projectId: 'demo', uid, role, active: true });
    }
}

async function request(server, path, token, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...options, headers });
    return { status: response.status, body: await response.json() };
}

async function main() {
    const previousFlag = process.env.CRM_PROJECTS_ENABLED;
    process.env.CRM_PROJECTS_ENABLED = 'true';
    const db = new FakeDb();
    const auth = makeAuth();
    seed(db, auth);
    db.data.set(`${PROJECT_COLLECTIONS.allowance}/editor`, { monthlyAllowanceCents: 377, revision: 1 });
    assert.strictEqual(readModuleGrant({ moduleGrants: { projects: true } }), true);
    assert.strictEqual(readModuleGrant({ moduleGrants: { projects: false }, modules: ['projects'] }), false);
    assert.strictEqual(readModuleGrant({ moduleGrants: { projects: 'true' } }), false);
    assert.strictEqual(readModuleGrant({ moduleGrants: { projects: { enabled: true } } }), false);
    const service = createProjectsAccessService({ db, auth, bootstrapAdminEmails: ['bootstrap@example.test'] });
    const app = express();
    app.use(express.json());
    app.use('/api/projects', createProjectsRouter({ db, auth, accessService: service }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        let response = await request(server, '/api/projects/access', null);
        assert.strictEqual(response.status, 401);
        response = await request(server, '/api/projects/demo', 'admin-token');
        assert.strictEqual(response.status, 404, 'admin without membership must not receive project content');
        response = await request(server, '/api/projects/', 'admin-token');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.projects[0].internalNotes, undefined, 'Admin project listing must expose management metadata only.');
        assert.strictEqual(response.body.projects[0].links, undefined);
        assert.strictEqual(response.body.projects[0].linkedRecords, undefined);
        assert.strictEqual(response.body.projects[0].id, 'demo');
        response = await request(server, '/api/projects/people', 'admin-token');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.people.find((person) => person.uid === 'suspended')?.accountStatus, 'suspended', 'People directory must use current Auth disabled state.');
        assert.strictEqual(response.body.people.find((person) => person.uid === 'editor')?.allowanceOverrideCents, 377, 'People directory must use the canonical per-person allowance collection.');
        response = await request(server, '/api/projects/demo', 'viewer-token');
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(response.body.project.linkedRecords, undefined, 'raw linked content must be redacted without a resolver');
        assert.strictEqual(response.body.project.links, undefined);
        assert.strictEqual(response.body.project.id, 'demo', 'The canonical project document ID must win over stored project data.');
        assert.ok(!JSON.stringify(response.body).includes('raw-secret-lead'));
        assert.ok(!JSON.stringify(response.body).includes('forged-record-id'));
        response = await request(server, '/api/projects/access', 'viewer-token');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.projects.length, 1);
        assert.strictEqual(response.body.projects[0].id, 'demo');
        assert.strictEqual(response.body.projects[0].linkedRecords, undefined, 'Summary responses must redact raw linked content without a resolver');
        assert.strictEqual(response.body.projects[0].links, undefined);
        assert.ok(!JSON.stringify(response.body).includes('raw-secret-lead'));
        assert.ok(!JSON.stringify(response.body).includes('forged-record-id'));

        db.data.set(`${PROJECT_COLLECTIONS.members}/forged-viewer-membership`, {
            projectId: 'demo', uid: 'viewer', role: 'Viewer', active: true
        });
        response = await request(server, '/api/projects/access', 'viewer-token');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.projects.length, 1, 'A forged duplicate membership row must not duplicate summary access.');

        // Summary rows must be backed by the canonical membership tuple.
        db.data.set(`${PROJECT_COLLECTIONS.members}/forged-admin-membership`, {
            projectId: 'demo', uid: 'admin', role: 'Viewer', active: true
        });
        response = await request(server, '/api/projects/access', 'admin-token');
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(response.body.projects, [], 'A forged membership document must not grant summary access.');
        response = await request(server, '/api/projects/demo/members', 'owner-token');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.members.length, 3, 'Project member listings must omit forged membership rows.');
        assert.ok(response.body.members.every((member) => !member.id.startsWith('forged-')));
        response = await request(server, '/api/projects/demo/member-directory', 'viewer-token');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.people.length, 3, 'Member directories must omit forged membership rows.');
        assert.strictEqual(response.body.people.filter((person) => person.uid === 'viewer').length, 1);

        // A canonical membership document with a forged tuple must deny every
        // access path and leave transaction targets untouched.
        const ownerIdentity = await service.authenticateToken('owner-token');
        const ownerMemberRef = db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('demo', 'owner'));
        const ownerMemberBefore = (await ownerMemberRef.get()).data();
        const viewerMemberRef = db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('demo', 'viewer'));
        const viewerMemberBefore = (await viewerMemberRef.get()).data();
        const projectRef = db.collection(PROJECT_COLLECTIONS.projects).doc('demo');
        const projectBefore = (await projectRef.get()).data();
        const forgedOwnerRef = db.collection(PROJECT_COLLECTIONS.members).doc('forged-owner-membership');
        await forgedOwnerRef.set({ projectId: 'demo', uid: 'forged-owner', role: 'Owner', active: true });
        try {
            await assert.rejects(
                () => service.addOrUpdateMember(ownerIdentity, 'demo', 'owner', { role: 'Editor' }),
                (error) => error?.code === 'LAST_OWNER_REQUIRED'
            );
            await assert.rejects(
                () => service.removeMember(ownerIdentity, 'demo', 'owner'),
                (error) => error?.code === 'LAST_OWNER_REQUIRED'
            );
            assert.deepStrictEqual((await ownerMemberRef.get()).data(), ownerMemberBefore, 'A forged Owner row must not make the canonical Owner demotable or removable.');
        } finally {
            await forgedOwnerRef.delete();
            await ownerMemberRef.set(ownerMemberBefore);
            await projectRef.set(projectBefore);
        }
        await ownerMemberRef.set({ uid: 'forged-owner' }, { merge: true });
        try {
            response = await request(server, '/api/projects/demo', 'owner-token');
            assert.strictEqual(response.status, 404, 'A forged membership tuple must deny direct project access.');
            response = await request(server, '/api/projects/access', 'owner-token');
            assert.strictEqual(response.status, 200);
            assert.deepStrictEqual(response.body.projects, [], 'A forged membership tuple must deny summary access.');
        } finally {
            await ownerMemberRef.set(ownerMemberBefore);
            await viewerMemberRef.set(viewerMemberBefore);
            await projectRef.set(projectBefore);
        }
        let barrierArmed = true;
        const barrierDb = {
            collection: (...args) => db.collection(...args),
            runTransaction: async (callback) => {
                if (barrierArmed) {
                    barrierArmed = false;
                    await ownerMemberRef.set({ uid: 'forged-owner' }, { merge: true });
                }
                return db.runTransaction(callback);
            }
        };
        const barrierService = createProjectsAccessService({ db: barrierDb, auth });
        try {
            await assert.rejects(
                () => barrierService.addOrUpdateMember(ownerIdentity, 'demo', 'viewer', { role: 'Editor' }),
                (error) => error?.code === 'PROJECT_OWNER_REQUIRED'
            );
            assert.deepStrictEqual((await viewerMemberRef.get()).data(), viewerMemberBefore, 'A forged membership tuple must not mutate transaction targets.');
        } finally {
            await ownerMemberRef.set(ownerMemberBefore);
            await viewerMemberRef.set(viewerMemberBefore);
            await projectRef.set(projectBefore);
        }
        response = await request(server, '/api/projects/demo/members/editor', 'viewer-token', { method: 'PATCH', body: JSON.stringify({ role: 'Viewer' }), headers: { 'Content-Type': 'application/json' } });
        assert.strictEqual(response.status, 403);
        response = await request(server, '/api/projects/demo/members/owner', 'owner-token', { method: 'PATCH', body: JSON.stringify({ role: 'Editor' }), headers: { 'Content-Type': 'application/json' } });
        assert.strictEqual(response.status, 409, 'last owner role demotion must be rejected');
        response = await request(server, '/api/projects/demo/owner-transfer', 'owner-token', { method: 'POST', body: JSON.stringify({ targetUid: 'editor' }), headers: { 'Content-Type': 'application/json' } });
        assert.strictEqual(response.status, 200);
        const ownerWorkforce = db.data.get(`${PROJECT_COLLECTIONS.workforce}/owner`);
        db.data.set(`${PROJECT_COLLECTIONS.workforce}/owner`, { ...ownerWorkforce, status: null });
        response = await request(server, '/api/projects/demo', 'owner-token');
        assert.strictEqual(response.status, 403, 'A missing workforce active status must deny project access.');
        db.data.set(`${PROJECT_COLLECTIONS.workforce}/owner`, ownerWorkforce);
        response = await request(server, '/api/projects/demo', 'owner-token');
        assert.strictEqual(response.status, 200, 'transferred owner remains an editor');
        response = await request(server, '/api/projects/demo', 'profile-only-token');
        assert.strictEqual(response.status, 403, 'profile workforceGrants must not self-grant access');
        response = await request(server, '/api/projects/demo', 'suspended-token');
        assert.strictEqual(response.status, 403);
        response = await request(server, '/api/projects/access', 'revoked');
        assert.strictEqual(response.status, 401);
        assert.ok(auth.calls.verify.some((call) => call.token === 'suspended-token' && call.checkRevoked === true), 'disabled-user requests must first use revoked-token verification');
        assert.ok(!auth.calls.verify.some((call) => call.token === 'suspended-token' && call.checkRevoked === false), 'disabled-user requests must not retry token verification without revoked-token checks');
        assert.ok(auth.calls.verify.filter((call) => call.token !== 'suspended-token').every((call) => call.checkRevoked === true), 'every non-disabled Projects request must request revoked-token verification');
        assert.notStrictEqual(memberDocumentId('a:b', 'c'), memberDocumentId('a', 'b:c'));
        process.stdout.write('crm projects Phase1 API access contract passed\n');
    } finally {
        await new Promise((resolve) => server.close(resolve));
        if (previousFlag === undefined) delete process.env.CRM_PROJECTS_ENABLED;
        else process.env.CRM_PROJECTS_ENABLED = previousFlag;
    }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
