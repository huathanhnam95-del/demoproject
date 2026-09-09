'use strict';

const assert = require('assert');
const express = require('express');
const http = require('http');
const {
    DEMO_PROJECT_ID,
    getEmulatorConfig
} = require('../../../scripts/crm/projects/emulator-config');
const {
    initializeFixtureApp,
    seedFixtures
} = require('../../../scripts/crm/projects/seed-fixtures');
const createProjectsRouter = require('../../../functions/src/routes/crm/projects');
const {
    PROJECT_COLLECTIONS,
    createProjectsAccessService,
    memberDocumentId
} = require('../../../functions/src/crm/projects/access-service');

const PASSWORD = 'Phase0-only-password!123';

function emulatorUrl(endpoint, pathname) {
    return `http://${endpoint}/${String(pathname || '').replace(/^\//, '')}`;
}

async function signIn(email, password = PASSWORD) {
    const endpoint = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const response = await fetch(emulatorUrl(endpoint, '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Auth emulator sign-in failed for ${email}: ${JSON.stringify(body)}`);
    return body.idToken;
}

async function request(server, path, token, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...options, headers });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_error) { body = { raw: text }; }
    return { status: response.status, body };
}

async function firestoreClientRequest(path, token, options = {}) {
    const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
    const response = await fetch(`http://${endpoint}/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    return { status: response.status, body: await response.text() };
}

function makeBarrierDb(db, beforeTransaction) {
    let armed = true;
    return {
        collection: (...args) => db.collection(...args),
        runTransaction: async (callback) => {
            if (armed) {
                armed = false;
                await beforeTransaction();
            }
            return db.runTransaction(callback);
        }
    };
}

function jsonHeaders() {
    return { 'content-type': 'application/json' };
}

async function assertMutationBarrier({ db, auth, identity, mutateBeforeTransaction, operation }) {
    const barrierDb = makeBarrierDb(db, mutateBeforeTransaction);
    const service = createProjectsAccessService({ db: barrierDb, auth });
    await assert.rejects(
        () => operation(service),
        (error) => error?.code === 'PROJECTS_ACCESS_DENIED'
            || error?.code === 'PROJECT_OWNER_REQUIRED'
            || error?.code === 'FORBIDDEN'
            || error?.code === 'ACCOUNT_INACTIVE'
    );
}

async function main() {
    assert.strictEqual(process.env.CRM_PROJECTS_EMULATOR_READY, '1', 'Phase1 persisted checks require the isolated emulator runner.');
    const previousFlag = process.env.CRM_PROJECTS_ENABLED;
    process.env.CRM_PROJECTS_ENABLED = 'true';
    const config = getEmulatorConfig(process.env);
    const app = initializeFixtureApp(config);
    let server;
    try {
        await seedFixtures({ config, app });
        const auth = app.auth();
        const db = app.firestore();
        await db.collection(PROJECT_COLLECTIONS.projects).doc('phase1-access-demo').set({
            id: 'forged-project-id',
            links: [{ module: 'crmLeads', recordId: 'raw-secret-lead' }],
            crmLinks: [{ module: 'crmLeads', recordId: 'forged-link-id' }],
            linkedRecords: [{ module: 'crmLeads', recordId: 'forged-record-id', secret: 'must-not-leak' }]
        }, { merge: true });
        const adminToken = await signIn('admin@demo.crm-projects.test');
        const teacherToken = await signIn('teacher@demo.crm-projects.test');
        const editorToken = await signIn('staff-editor@demo.crm-projects.test');
        const viewerToken = await signIn('viewer@demo.crm-projects.test');
        const unauthorizedToken = await signIn('unauthorized@demo.crm-projects.test');
        const profileOnlyToken = await signIn('profile-only@demo.crm-projects.test');

        const service = createProjectsAccessService({
            db,
            auth,
            bootstrapAdminEmails: new Set(['admin@demo.crm-projects.test'])
        });
        const api = express();
        api.use(express.json());
        api.use('/api/projects', createProjectsRouter({ db, auth, accessService: service }));
        server = http.createServer(api);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

        for (const [token, role] of [[teacherToken, 'Owner'], [editorToken, 'Editor'], [viewerToken, 'Viewer']]) {
            const response = await request(server, '/api/projects/phase1-access-demo', token);
            assert.strictEqual(response.status, 200);
            assert.strictEqual(response.body.project.role, role);
            assert.strictEqual(response.body.project.links, undefined);
            assert.strictEqual(response.body.project.crmLinks, undefined);
            assert.strictEqual(response.body.project.linkedRecords, undefined);
            assert.strictEqual(response.body.project.id, 'phase1-access-demo');
            assert.ok(!JSON.stringify(response.body).includes('raw-secret-lead'));
            assert.ok(!JSON.stringify(response.body).includes('forged-link-id'));
            assert.ok(!JSON.stringify(response.body).includes('forged-record-id'));
        }
        let response = await request(server, '/api/projects/access', teacherToken);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.projects.length, 1);
        assert.strictEqual(response.body.projects[0].id, 'phase1-access-demo');
        assert.strictEqual(response.body.projects[0].linkedRecords, undefined);
        assert.ok(!JSON.stringify(response.body).includes('raw-secret-lead'));
        assert.ok(!JSON.stringify(response.body).includes('forged-link-id'));
        assert.ok(!JSON.stringify(response.body).includes('forged-record-id'));
        await db.collection(PROJECT_COLLECTIONS.members).doc('forged-viewer-membership').set({
            projectId: 'phase1-access-demo', uid: 'crm-projects-viewer', role: 'Viewer', active: true
        });
        response = await request(server, '/api/projects/access', viewerToken);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.projects.length, 1, 'A forged duplicate membership row must not duplicate summary access.');
        await db.collection(PROJECT_COLLECTIONS.members).doc('forged-admin-membership').set({
            projectId: 'phase1-access-demo', uid: 'crm-projects-admin', role: 'Viewer', active: true
        });
        response = await request(server, '/api/projects/access', adminToken);
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(response.body.projects, [], 'A forged membership document must not grant summary access.');
        response = await request(server, '/api/projects/phase1-access-demo/members', teacherToken);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.members.length, 3, 'Project member listings must omit forged membership rows.');
        assert.ok(response.body.members.every((member) => !member.id.startsWith('forged-')));
        response = await request(server, '/api/projects/phase1-access-demo/member-directory', viewerToken);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.people.length, 3, 'Member directories must omit forged membership rows.');
        assert.strictEqual(response.body.people.filter((person) => person.uid === 'crm-projects-viewer').length, 1);
        response = await request(server, '/api/projects/phase1-access-demo', unauthorizedToken);
        assert.strictEqual(response.status, 403, 'An active account without a server grant must be denied.');
        response = await request(server, '/api/projects/phase1-access-demo', profileOnlyToken);
        assert.strictEqual(response.status, 403, 'A profile-only workforceGrants field must not grant access.');
        response = await request(server, '/api/projects/phase1-access-demo', adminToken);
        assert.strictEqual(response.status, 404, 'An administrator without explicit membership must not read project content.');
        response = await request(server, '/api/projects/access', adminToken);
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(response.body.projects, []);
        response = await request(server, '/api/projects/phase1-access-demo/eligible-people', adminToken);
        assert.strictEqual(response.status, 200);
        assert.ok(response.body.people.some((person) => person.email === 'teacher@demo.crm-projects.test'));
        assert.ok(response.body.people.every((person) => Object.keys(person).sort().join(',') === 'displayName,email,uid'));
        response = await request(server, '/api/projects/phase1-access-demo/eligible-people', viewerToken);
        assert.strictEqual(response.status, 403, 'Viewer cannot enumerate workforce candidates.');
        response = await request(server, '/api/projects/phase1-access-demo/member-directory', viewerToken);
        assert.strictEqual(response.status, 200, 'Project members may resolve a minimal member directory.');
        assert.ok(response.body.people.some((person) => person.role === 'Owner'));
        assert.ok(response.body.people.every((person) => !Object.prototype.hasOwnProperty.call(person, 'moduleGrants')));
        response = await request(server, '/api/projects/people', adminToken);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.people.find((person) => person.uid === 'crm-projects-suspended')?.accountStatus, 'suspended', 'People directory must reflect current Auth disabled state.');
        process.env.CRM_PROJECTS_ENABLED = 'false';
        response = await request(server, '/api/projects/access', adminToken);
        assert.strictEqual(response.status, 404, 'Every Projects route must fail closed when the feature is disabled.');
        process.env.CRM_PROJECTS_ENABLED = 'true';

        // Viewer writes are rejected at the membership boundary.
        response = await request(server, '/api/projects/phase1-access-demo/members/crm-projects-viewer', viewerToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ role: 'Editor' })
        });
        assert.strictEqual(response.status, 403);

        // The default config and the UID "default" use separate collections.
        response = await request(server, '/api/projects/calendar', adminToken);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.calendar.revision, 0);
        for (const invalidPatch of [
            { timezone: 'Not/An-IANA-Zone' },
            { timezone: '' },
            { timezone: null },
            { workingWeekdays: [1, 7] },
            { workingWeekdays: [1, '2'] },
            { leaves: [{ date: '2026-02-30', scope: 'whole_team' }] },
            { leaves: [{ date: '2026-09-21', scope: 'specific_person', uid: 'crm-projects-unauthorized' }] },
            { leaves: [{ date: '2026-09-21', scope: '' }] }
        ]) {
            response = await request(server, '/api/projects/calendar', adminToken, {
                method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(invalidPatch)
            });
            assert.strictEqual(response.status, 400, `Invalid calendar input must be rejected: ${JSON.stringify(invalidPatch)}`);
        }
        response = await request(server, '/api/projects/calendar', adminToken, {
            method: 'PATCH', headers: jsonHeaders(),
            body: JSON.stringify({ expectedRevision: 0, timezone: 'Asia/Ho_Chi_Minh', workingWeekdays: [1, 2, 3, 4, 5], leaves: [{ date: '2026-09-18', scope: 'whole_team', label: 'Holiday' }] })
        });
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.calendar.revision, 1);
        for (const allowancePath of ['/api/projects/allowance', '/api/projects/allowance/default']) {
            response = await request(server, allowancePath, adminToken, {
                method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ expectedRevision: 0, monthlyAllowanceCents: 501 })
            });
            assert.strictEqual(response.status, 400, 'The aggregate allowance maximum is 500 cents, including per-person overrides.');
        }
        response = await request(server, '/api/projects/allowance', adminToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ monthlyAllowanceCents: null })
        });
        assert.strictEqual(response.status, 400, 'Malformed allowance values must be rejected.');
        response = await request(server, '/api/projects/allowance', adminToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ expectedRevision: 0, monthlyAllowanceCents: 500 })
        });
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.allowance.revision, 1);
        response = await request(server, '/api/projects/allowance/default', adminToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ expectedRevision: 0, monthlyAllowanceCents: 400 })
        });
        assert.strictEqual(response.status, 200);
        response = await request(server, '/api/projects/allowance', adminToken);
        assert.strictEqual(response.body.allowance.monthlyAllowanceCents, 500);
        response = await request(server, '/api/projects/allowance/default', adminToken);
        assert.strictEqual(response.body.allowance.monthlyAllowanceCents, 400);
        response = await request(server, '/api/projects/allowance/crm-projects-staff-editor', adminToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ expectedRevision: 0, monthlyAllowanceCents: 250 })
        });
        assert.strictEqual(response.status, 200);
        response = await request(server, '/api/projects/people', adminToken);
        assert.strictEqual(response.body.people.find((person) => person.uid === 'crm-projects-staff-editor')?.allowanceOverrideCents, 250, 'People directory must read saved per-person allowance config.');

        const forgedUid = 'crm-projects-forged-profile';
        await auth.createUser({ uid: forgedUid, email: 'forged-profile@demo.crm-projects.test', password: PASSWORD, emailVerified: true });
        const forgedProfileToken = await signIn('forged-profile@demo.crm-projects.test');
        const forgedProfile = await firestoreClientRequest(`users/${forgedUid}`, forgedProfileToken, {
            method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fields: {
                email: { stringValue: 'forged-profile@demo.crm-projects.test' },
                displayName: { stringValue: 'Forged profile' },
                accountStatus: { stringValue: 'active' },
                archived: { booleanValue: false },
                workforceGrants: { mapValue: { fields: { projects: { booleanValue: true } } } },
                monthlyAllowanceCents: { integerValue: '999999' }
            } })
        });
        assert.strictEqual(forgedProfile.status, 200, 'An own profile may be created with legacy-looking fields for compatibility.');
        response = await request(server, '/api/projects/phase1-access-demo', forgedProfileToken);
        assert.strictEqual(response.status, 403, 'Profile-created workforce and allowance fields must not grant Projects access.');

        // Direct client access to server-owned collections stays denied even
        // for the organization administrator and for a guessed document ID.
        for (const token of [adminToken, teacherToken]) {
            for (const collection of [
                PROJECT_COLLECTIONS.workforce,
                PROJECT_COLLECTIONS.members,
                PROJECT_COLLECTIONS.organizationConfig,
                PROJECT_COLLECTIONS.allowance,
                PROJECT_COLLECTIONS.allowanceDefaults,
                PROJECT_COLLECTIONS.audit,
                PROJECT_COLLECTIONS.projects
            ]) {
                const directRead = await firestoreClientRequest(`${collection}/guessed-id`, token);
                assert.strictEqual(directRead.status, 403, `Direct ${collection} read must be denied.`);
                const directWrite = await firestoreClientRequest(`${collection}/guessed-id`, token, {
                    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { status: { stringValue: 'active' } } })
                });
                assert.strictEqual(directWrite.status, 403, `Direct ${collection} write must be denied.`);
            }
        }
        const forgedCreate = await firestoreClientRequest('users/forged-project-admin', unauthorizedToken, {
            method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fields: { isAdmin: { booleanValue: true }, accountStatus: { stringValue: 'active' } } })
        });
        assert.strictEqual(forgedCreate.status, 403, 'A client cannot create a forged privileged profile.');
        const forgedGrant = await firestoreClientRequest('users/crm-projects-unauthorized', unauthorizedToken, {
            method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fields: { workforceGrants: { mapValue: { fields: { projects: { booleanValue: true } } } } } })
        });
        assert.strictEqual(forgedGrant.status, 403, 'A client cannot add workforce grant fields to its own profile.');

        // Server-owned grants win over stale profile claims and legacy-shaped
        // values. The project remains closed after each persisted mutation.
        await db.collection('users').doc('crm-projects-teacher').set({ workforceGrants: { projects: false } }, { merge: true });
        response = await request(server, '/api/projects/phase1-access-demo', teacherToken);
        assert.strictEqual(response.status, 200, 'Membership grant remains server-owned when a stale profile claim changes.');
        await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-teacher').set({ moduleGrants: { projects: false }, modules: ['projects'] }, { merge: true });
        response = await request(server, '/api/projects/phase1-access-demo', teacherToken);
        assert.strictEqual(response.status, 403, 'False typed grant cannot be replaced by a legacy modules array.');
        await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-teacher').set({ moduleGrants: { projects: true } }, { merge: true });
        await db.collection('users').doc('crm-projects-teacher').set({ archived: true, accountStatus: 'active' }, { merge: true });
        response = await request(server, '/api/projects/phase1-access-demo', teacherToken);
        assert.strictEqual(response.status, 403, 'An archived profile remains denied even when accountStatus says active.');
        await db.collection('users').doc('crm-projects-teacher').set({ archived: false }, { merge: true });
        await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-teacher').set({ status: null }, { merge: true });
        response = await request(server, '/api/projects/phase1-access-demo', teacherToken);
        assert.strictEqual(response.status, 403, 'A missing or malformed workforce active status must deny Projects access.');
        await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-teacher').set({ status: 'active' }, { merge: true });

        const teacherIdentity = await service.authenticateToken(teacherToken);
        const editorIdentity = await service.authenticateToken(editorToken);
        const adminIdentity = await service.authenticateToken(adminToken);
        const targetRef = db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('phase1-access-demo', 'crm-projects-viewer'));
        const targetBefore = (await targetRef.get()).data();
        const ownerMemberRef = db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('phase1-access-demo', teacherIdentity.uid));
        const ownerMemberBefore = (await ownerMemberRef.get()).data();
        const ownerProjectRef = db.collection(PROJECT_COLLECTIONS.projects).doc('phase1-access-demo');
        const ownerProjectBefore = (await ownerProjectRef.get()).data();
        const forgedOwnerRef = db.collection(PROJECT_COLLECTIONS.members).doc('forged-owner-membership');
        await forgedOwnerRef.set({ projectId: 'phase1-access-demo', uid: 'crm-projects-forged-owner', role: 'Owner', active: true });
        try {
            await assert.rejects(
                () => service.addOrUpdateMember(teacherIdentity, 'phase1-access-demo', teacherIdentity.uid, { role: 'Editor' }),
                (error) => error?.code === 'LAST_OWNER_REQUIRED'
            );
            await ownerMemberRef.set(ownerMemberBefore);
            await ownerProjectRef.set(ownerProjectBefore);
            await assert.rejects(
                () => service.removeMember(teacherIdentity, 'phase1-access-demo', teacherIdentity.uid),
                (error) => error?.code === 'LAST_OWNER_REQUIRED'
            );
            assert.deepStrictEqual((await ownerMemberRef.get()).data(), ownerMemberBefore, 'A forged Owner row must not make the canonical Owner demotable or removable.');
        } finally {
            await forgedOwnerRef.delete();
            await ownerMemberRef.set(ownerMemberBefore);
            await ownerProjectRef.set(ownerProjectBefore);
        }

        // Direct and summary access must reject a canonical membership whose
        // stored tuple no longer matches its project/UID key.
        const teacherMemberRef = db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('phase1-access-demo', teacherIdentity.uid));
        const teacherMemberBefore = (await teacherMemberRef.get()).data();
        await teacherMemberRef.set({ uid: 'forged-owner' }, { merge: true });
        try {
            response = await request(server, '/api/projects/phase1-access-demo', teacherToken);
            assert.strictEqual(response.status, 404, 'A forged membership tuple must deny direct project access.');
            response = await request(server, '/api/projects/access', teacherToken);
            assert.strictEqual(response.status, 200);
            assert.deepStrictEqual(response.body.projects, [], 'A forged membership tuple must deny summary access.');
        } finally {
            await teacherMemberRef.set(teacherMemberBefore);
        }

        // Re-check the same tuple inside the transaction after the outside
        // authorization has already observed a valid owner.
        await assertMutationBarrier({
            db,
            auth,
            identity: teacherIdentity,
            mutateBeforeTransaction: () => teacherMemberRef.set({ uid: 'forged-owner' }, { merge: true }),
            operation: (barrierService) => barrierService.addOrUpdateMember(teacherIdentity, 'phase1-access-demo', 'crm-projects-viewer', { role: 'Editor' })
        });
        assert.deepStrictEqual((await targetRef.get()).data(), targetBefore, 'A forged membership tuple must not mutate transaction targets.');
        await teacherMemberRef.set(teacherMemberBefore);

        await assertMutationBarrier({
            db,
            auth,
            identity: teacherIdentity,
            mutateBeforeTransaction: () => db.collection(PROJECT_COLLECTIONS.workforce).doc(teacherIdentity.uid).set({ moduleGrants: { projects: false } }, { merge: true }),
            operation: (barrierService) => barrierService.addOrUpdateMember(teacherIdentity, 'phase1-access-demo', 'crm-projects-viewer', { role: 'Editor' })
        });
        assert.deepStrictEqual((await targetRef.get()).data(), targetBefore, 'Revoked actor grant must leave membership unchanged.');
        await db.collection(PROJECT_COLLECTIONS.workforce).doc(teacherIdentity.uid).set({ moduleGrants: { projects: true } }, { merge: true });

        await assertMutationBarrier({
            db,
            auth,
            identity: teacherIdentity,
            mutateBeforeTransaction: () => db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('phase1-access-demo', teacherIdentity.uid)).set({ role: 'Editor' }, { merge: true }),
            operation: (barrierService) => barrierService.addOrUpdateMember(teacherIdentity, 'phase1-access-demo', 'crm-projects-viewer', { role: 'Editor' })
        });
        assert.deepStrictEqual((await targetRef.get()).data(), targetBefore, 'Revoked actor owner role must leave membership unchanged.');
        await db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('phase1-access-demo', teacherIdentity.uid)).set({ role: 'Owner' }, { merge: true });

        await assertMutationBarrier({
            db,
            auth,
            identity: adminIdentity,
            mutateBeforeTransaction: () => db.collection('users').doc(adminIdentity.uid).set({ isAdmin: false }, { merge: true }),
            operation: (barrierService) => barrierService.updateOrganizationConfig(adminIdentity, { expectedRevision: 1, workingWeekdays: [1, 2, 3, 4, 5, 6] })
        });
        assert.strictEqual((await db.collection(PROJECT_COLLECTIONS.organizationConfig).doc('calendar').get()).data().revision, 1, 'Revoked actor admin status must leave calendar unchanged.');
        await db.collection('users').doc(adminIdentity.uid).set({ isAdmin: true }, { merge: true });

        const workforceBefore = (await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-viewer').get()).data();
        await assertMutationBarrier({
            db,
            auth,
            identity: adminIdentity,
            mutateBeforeTransaction: () => db.collection('users').doc(adminIdentity.uid).set({ isAdmin: false }, { merge: true }),
            operation: (barrierService) => barrierService.updateWorkforce(adminIdentity, 'crm-projects-viewer', { projects: false, expectedRevision: workforceBefore.revision })
        });
        assert.deepStrictEqual((await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-viewer').get()).data(), workforceBefore, 'Revoked admin status must leave workforce access unchanged.');
        await db.collection('users').doc(adminIdentity.uid).set({ isAdmin: true }, { merge: true });

        const allowanceBefore = (await db.collection(PROJECT_COLLECTIONS.allowance).doc('crm-projects-default-target').get()).data();
        await assertMutationBarrier({
            db,
            auth,
            identity: adminIdentity,
            mutateBeforeTransaction: () => db.collection('users').doc(adminIdentity.uid).set({ isAdmin: false }, { merge: true }),
            operation: (barrierService) => barrierService.updateAllowanceConfig(adminIdentity, { monthlyAllowanceCents: 300, expectedRevision: allowanceBefore?.revision || 0 }, 'crm-projects-default-target')
        });
        assert.deepStrictEqual((await db.collection(PROJECT_COLLECTIONS.allowance).doc('crm-projects-default-target').get()).data(), allowanceBefore, 'Revoked admin status must leave per-person allowance unchanged.');
        await db.collection('users').doc(adminIdentity.uid).set({ isAdmin: true }, { merge: true });

        await assertMutationBarrier({
            db,
            auth,
            identity: teacherIdentity,
            mutateBeforeTransaction: () => db.collection(PROJECT_COLLECTIONS.workforce).doc(teacherIdentity.uid).set({ moduleGrants: { projects: false } }, { merge: true }),
            operation: (barrierService) => barrierService.removeMember(teacherIdentity, 'phase1-access-demo', 'crm-projects-viewer', { expectedRevision: 1 })
        });
        assert.deepStrictEqual((await targetRef.get()).data(), targetBefore, 'Revoked actor grant must leave removal target unchanged.');
        await db.collection(PROJECT_COLLECTIONS.workforce).doc(teacherIdentity.uid).set({ moduleGrants: { projects: true } }, { merge: true });

        const projectBeforeTransfer = (await db.collection(PROJECT_COLLECTIONS.projects).doc('phase1-access-demo').get()).data();
        await assertMutationBarrier({
            db,
            auth,
            identity: teacherIdentity,
            mutateBeforeTransaction: () => db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('phase1-access-demo', teacherIdentity.uid)).set({ role: 'Editor' }, { merge: true }),
            operation: (barrierService) => barrierService.transferOwner(teacherIdentity, 'phase1-access-demo', 'crm-projects-staff-editor', { expectedRevision: projectBeforeTransfer.membershipRevision })
        });
        assert.deepStrictEqual((await db.collection(PROJECT_COLLECTIONS.projects).doc('phase1-access-demo').get()).data(), projectBeforeTransfer, 'Revoked owner role must leave transfer state unchanged.');
        await db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('phase1-access-demo', teacherIdentity.uid)).set({ role: 'Owner' }, { merge: true });

        // Bootstrap protection accepts the Functions Set resolver and blocks
        // a non-self target without relying on a legacy role claim.
        await db.collection('users').doc('crm-projects-staff-editor').set({ isBootstrapAdmin: true }, { merge: true });
        await assert.rejects(
            () => service.updateWorkforce(adminIdentity, 'crm-projects-staff-editor', { status: 'suspended' }),
            (error) => error?.code === 'BOOTSTRAP_ADMIN_PROTECTED'
        );
        await db.collection('users').doc('crm-projects-staff-editor').set({ isBootstrapAdmin: false }, { merge: true });

        // Provider failure keeps the target closed, records a durable failed
        // operation, and can only be reopened through an explicit retry.
        const originalUpdateUser = auth.updateUser.bind(auth);
        let failSuspension = true;
        auth.updateUser = async (uid, patch) => {
            if (uid === 'crm-projects-staff-editor' && patch?.disabled === true && failSuspension) {
                failSuspension = false;
                throw new Error('deliberate Auth emulator failure');
            }
            return originalUpdateUser(uid, patch);
        };
        const editorWorkforceBeforeSync = (await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-staff-editor').get()).data();
        await assert.rejects(
            () => service.updateWorkforce(adminIdentity, 'crm-projects-staff-editor', { status: 'suspended', expectedRevision: editorWorkforceBeforeSync.revision }),
            (error) => error?.code === 'AUTH_UPDATE_FAILED'
        );
        const failedSync = (await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-staff-editor').get()).data().authSync;
        assert.strictEqual(failedSync.state, 'failed');
        response = await request(server, '/api/projects/phase1-access-demo', editorToken);
        assert.strictEqual(response.status, 403, 'Auth synchronization failure must keep project access closed.');
        response = await request(server, '/api/projects/people/crm-projects-staff-editor/auth-sync/retry', adminToken, {
            method: 'POST', headers: jsonHeaders(), body: '{}'
        });
        assert.strictEqual(response.status, 200);
        assert.strictEqual((await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-staff-editor').get()).data().authSync.state, 'succeeded');
        auth.updateUser = originalUpdateUser;

        // A stale pending operation can be safely reconciled into failed
        // state, then retried. No reconciliation path opens access while the
        // provider state is uncertain.
        const pendingRevision = (await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-staff-editor').get()).data().revision;
        await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-staff-editor').set({
            revision: pendingRevision + 1,
            authSync: {
                operationId: 'abandoned-operation', desiredDisabled: true, state: 'pending',
                startedAt: new Date(Date.now() - (10 * 60 * 1000)).toISOString()
            }
        }, { merge: true });
        await assert.rejects(
            () => service.updateWorkforce(adminIdentity, 'crm-projects-staff-editor', { projects: true }),
            (error) => error?.code === 'AUTH_SYNC_PENDING'
        );
        response = await request(server, '/api/projects/people/crm-projects-staff-editor/auth-sync/reconcile', adminToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ confirmAbandoned: true })
        });
        assert.strictEqual(response.status, 200);
        assert.strictEqual((await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-staff-editor').get()).data().authSync.state, 'succeeded', 'Matching Auth state may safely complete an abandoned operation.');

        // Restore the fixture editor to active through the same serialized
        // status path before the concurrency and revocation checks.
        await service.updateWorkforce(adminIdentity, 'crm-projects-staff-editor', { status: 'active' });
        const concurrentStatus = await Promise.all([
            service.updateWorkforce(adminIdentity, 'crm-projects-staff-editor', { status: 'suspended' }),
            service.updateWorkforce(adminIdentity, 'crm-projects-staff-editor', { status: 'active' })
        ]);
        assert.ok(concurrentStatus.length === 2);
        const concurrentWorkforce = (await db.collection(PROJECT_COLLECTIONS.workforce).doc('crm-projects-staff-editor').get()).data();
        const concurrentAuthUser = await auth.getUser('crm-projects-staff-editor');
        assert.strictEqual(concurrentWorkforce.status, 'active');
        assert.strictEqual(concurrentWorkforce.authSync.state, 'succeeded');
        assert.strictEqual(concurrentAuthUser.disabled, false, 'Serialized status sync must leave Auth enabled for the final active state.');

        const competingLastOwner = await Promise.allSettled([
            service.addOrUpdateMember(teacherIdentity, 'phase1-access-demo', teacherIdentity.uid, { role: 'Editor' }),
            service.removeMember(teacherIdentity, 'phase1-access-demo', teacherIdentity.uid)
        ]);
        assert.ok(competingLastOwner.every((entry) => entry.status === 'rejected'), 'Concurrent last-owner demotion/removal must both fail.');
        assert.strictEqual((await db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId('phase1-access-demo', teacherIdentity.uid)).get()).data().role, 'Owner');

        // Two concurrent owner transfers are serialized by Firestore's
        // transaction retry and leave exactly one active owner.
        const transfers = await Promise.allSettled([
            service.transferOwner(teacherIdentity, 'phase1-access-demo', 'crm-projects-staff-editor'),
            service.transferOwner(teacherIdentity, 'phase1-access-demo', 'crm-projects-viewer')
        ]);
        assert.strictEqual(transfers.filter((entry) => entry.status === 'fulfilled').length, 1, 'Only one concurrent owner transfer may commit.');
        assert.strictEqual(transfers.filter((entry) => entry.status === 'rejected').length, 1, 'The losing owner transfer must be rejected after re-reading membership.');
        const ownerSnapshot = await db.collection(PROJECT_COLLECTIONS.members).where('projectId', '==', 'phase1-access-demo').get();
        const activeOwners = ownerSnapshot.docs.filter((doc) => doc.data().active !== false && doc.data().role === 'Owner');
        assert.strictEqual(activeOwners.length, 1, 'Concurrent owner transfers must leave one owner.');

        // A suspended Auth user is denied even if a membership and grant are
        // still present in Firestore.
        const suspendedAuth = await auth.getUser('crm-projects-suspended');
        await auth.updateUser(suspendedAuth.uid, { disabled: false });
        const suspendedToken = await signIn('suspended@demo.crm-projects.test');
        await auth.updateUser(suspendedAuth.uid, { disabled: true });
        response = await request(server, '/api/projects/phase1-access-demo', suspendedToken);
        assert.strictEqual(response.status, 403);

        // Revoke a previously valid token and verify checkRevoked blocks it.
        await auth.revokeRefreshTokens('crm-projects-viewer');
        response = await request(server, '/api/projects/phase1-access-demo', viewerToken);
        assert.strictEqual(response.status, 401);

        process.stdout.write('crm projects Phase1 persisted Auth + Firestore access matrix passed\n');
    } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await app.delete();
        if (previousFlag === undefined) delete process.env.CRM_PROJECTS_ENABLED;
        else process.env.CRM_PROJECTS_ENABLED = previousFlag;
    }
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
