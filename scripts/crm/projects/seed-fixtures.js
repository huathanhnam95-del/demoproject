'use strict';

const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const functionsRequire = createRequire(path.join(__dirname, '../../../functions/package.json'));
const admin = functionsRequire('firebase-admin');
const {
    DEMO_PROJECT_ID,
    emulatorEnvironment,
    getEmulatorConfig,
    assertSafeEmulatorConfig
} = require('./emulator-config');

const FIXTURE_COLLECTION = 'crmProjectsPhase0Fixtures';
const FIXTURE_DOC_ID = 'phase0-seed';
const FIXTURE_VERSION = 'crm-projects-phase0-fixtures-v1';
const PROJECT_COLLECTION = 'crmProjects';
const MEMBER_COLLECTION = 'crmProjectMembers';
const WORKFORCE_COLLECTION = 'crmWorkforceAccounts';
const FIXTURE_USERS = Object.freeze([
    { uid: 'crm-projects-admin', email: 'admin@demo.crm-projects.test', role: 'admin', accountStatus: 'active', isAdmin: true, workforceGrant: 'administrator' },
    { uid: 'crm-projects-teacher', email: 'teacher@demo.crm-projects.test', role: 'teacher', accountStatus: 'active', isTeacher: true, workforceGrant: 'teacher' },
    { uid: 'crm-projects-staff-editor', email: 'staff-editor@demo.crm-projects.test', role: 'staff', accountStatus: 'active', workforceGrant: 'editor', canEdit: true },
    { uid: 'crm-projects-viewer', email: 'viewer@demo.crm-projects.test', role: 'viewer', accountStatus: 'active', workforceGrant: 'viewer' },
    { uid: 'crm-projects-unauthorized', email: 'unauthorized@demo.crm-projects.test', role: 'unauthorized', accountStatus: 'active', workforceGrant: null },
    { uid: 'crm-projects-profile-only', email: 'profile-only@demo.crm-projects.test', role: 'staff', accountStatus: 'active', workforceGrant: null },
    { uid: 'crm-projects-suspended', email: 'suspended@demo.crm-projects.test', role: 'staff', accountStatus: 'suspended', workforceGrant: 'editor', disabled: true }
]);

function applyEmulatorEnvironment(config, env = process.env) {
    assertSafeEmulatorConfig(config);
    if (config.projectId !== DEMO_PROJECT_ID) {
        throw new Error(`Fixture seeding requires ${DEMO_PROJECT_ID}.`);
    }
    const expected = emulatorEnvironment(config);
    for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
        if (env[key] && env[key] !== expected[key]) {
            throw new Error(`${key} is already set to ${env[key]}; refusing to overwrite an existing emulator or production endpoint.`);
        }
    }
    Object.assign(env, expected);
    return env;
}

function assertFixtureApp(app, config) {
    if (!app || app.options?.projectId !== config.projectId) {
        throw new Error('Fixture app must be initialized for the dedicated demo project.');
    }
    const expected = emulatorEnvironment(config);
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== expected.FIREBASE_AUTH_EMULATOR_HOST
        || process.env.FIRESTORE_EMULATOR_HOST !== expected.FIRESTORE_EMULATOR_HOST
        || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== expected.FIREBASE_STORAGE_EMULATOR_HOST) {
        throw new Error('Injected fixture app requires matching Auth, Firestore, and Storage emulator endpoints.');
    }
}

function initializeFixtureApp(config) {
    applyEmulatorEnvironment(config);
    const appName = `crm-projects-phase0-${process.pid}-${Date.now()}`;
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    return admin.initializeApp({
        projectId: config.projectId,
        credential: admin.credential.cert({
            projectId: config.projectId,
            clientEmail: `phase0-${process.pid}@${config.projectId}.invalid`,
            privateKey
        })
    }, appName);
}

async function ensureAuthUser(auth, fixture) {
    let user;
    try {
        user = await auth.getUser(fixture.uid);
    } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
        user = await auth.createUser({
            uid: fixture.uid,
            email: fixture.email,
            password: 'Phase0-only-password!123',
            displayName: fixture.role,
            disabled: fixture.disabled === true,
            emailVerified: true
        });
    }
    await auth.updateUser(user.uid, {
        email: fixture.email,
        displayName: fixture.role,
        disabled: fixture.disabled === true,
        emailVerified: true
    });
    await auth.setCustomUserClaims(fixture.uid, {
        crmRole: fixture.role,
        accountStatus: fixture.accountStatus,
        archived: false,
        isAdmin: fixture.isAdmin === true,
        isTeacher: fixture.isTeacher === true,
        canEdit: fixture.canEdit === true,
        workforceGrants: fixture.workforceGrant ? { projects: fixture.workforceGrant } : {}
    });
    return auth.getUser(fixture.uid);
}

function fixtureProfile(fixture) {
    return {
        uid: fixture.uid,
        email: fixture.email,
        role: fixture.role,
        accountStatus: fixture.accountStatus,
        isAdmin: fixture.isAdmin === true,
        isTeacher: fixture.isTeacher === true,
        canEdit: fixture.canEdit === true,
        workforceGrants: fixture.workforceGrant ? { projects: fixture.workforceGrant } : {},
        disabled: fixture.disabled === true,
        fixtureVersion: FIXTURE_VERSION
    };
}

async function resetPhase1ProjectFixtures(db, projectId) {
    const memberSnapshot = await db.collection(MEMBER_COLLECTION).get();
    let batch = db.batch();
    let writes = 0;
    for (const doc of memberSnapshot.docs || []) {
        if ((doc.data() || {}).projectId !== projectId) continue;
        batch.delete(doc.ref);
        writes += 1;
        if (writes === 450) {
            await batch.commit();
            batch = db.batch();
            writes = 0;
        }
    }
    if (writes) await batch.commit();
    // The project document is test-owned and is recreated below with the
    // canonical fixture fields. Deleting first also removes linked-record and
    // forged-id fields left by an earlier persisted access test.
    await db.collection(PROJECT_COLLECTION).doc(projectId).delete();
}

async function seedFixtures({ config = getEmulatorConfig(), app = null } = {}) {
    assertSafeEmulatorConfig(config);
    const ownedApp = app || initializeFixtureApp(config);
    if (app) assertFixtureApp(app, config);
    const auth = ownedApp.auth();
    const db = ownedApp.firestore();
    const profiles = [];
    try {
        await resetPhase1ProjectFixtures(db, 'phase1-access-demo');
        for (const fixture of FIXTURE_USERS) {
            await ensureAuthUser(auth, fixture);
            const profile = fixtureProfile(fixture);
            await db.collection('users').doc(fixture.uid).set(profile, { merge: true });
            await db.collection(WORKFORCE_COLLECTION).doc(fixture.uid).set({
                uid: fixture.uid,
                status: fixture.accountStatus === 'active' ? 'active' : 'suspended',
                moduleGrants: { projects: fixture.accountStatus === 'active'
                    && fixture.workforceGrant !== null },
                authSync: { state: 'succeeded', reconciled: true },
                revision: 1,
                fixtureVersion: FIXTURE_VERSION
            }, { merge: true });
            profiles.push(profile);
        }
        const projectId = 'phase1-access-demo';
        await db.collection(PROJECT_COLLECTION).doc(projectId).set({
            name: 'Phase1 access demo',
            status: 'active',
            ownerUid: 'crm-projects-teacher',
            membershipRevision: 1,
            fixtureVersion: FIXTURE_VERSION
        }, { merge: true });
        for (const [uid, role] of [
            ['crm-projects-teacher', 'Owner'],
            ['crm-projects-staff-editor', 'Editor'],
            ['crm-projects-viewer', 'Viewer']
        ]) {
            const id = Buffer.from(JSON.stringify([projectId, uid]), 'utf8').toString('base64url');
            await db.collection(MEMBER_COLLECTION).doc(id).set({
                projectId,
                uid,
                role,
                active: true,
                fixtureVersion: FIXTURE_VERSION
            }, { merge: true });
        }
        const seedDoc = {
            fixtureVersion: FIXTURE_VERSION,
            projectId: config.projectId,
            seededUserUids: profiles.map((profile) => profile.uid),
            users: profiles,
            source: 'scripts/crm/projects/seed-fixtures.js'
        };
        await db.collection(FIXTURE_COLLECTION).doc(FIXTURE_DOC_ID).set(seedDoc);
        return { fixtureVersion: FIXTURE_VERSION, projectId: config.projectId, users: profiles };
    } finally {
        if (!app) await ownedApp.delete();
    }
}

async function verifyFixtureRoundTrip({ config = getEmulatorConfig(), app = null } = {}) {
    assertSafeEmulatorConfig(config);
    const ownedApp = app || initializeFixtureApp(config);
    if (app) assertFixtureApp(app, config);
    const auth = ownedApp.auth();
    const db = ownedApp.firestore();
    try {
        const seedSnapshot = await db.collection(FIXTURE_COLLECTION).doc(FIXTURE_DOC_ID).get();
        if (!seedSnapshot.exists) throw new Error(`Missing persisted fixture ${FIXTURE_COLLECTION}/${FIXTURE_DOC_ID}.`);
        const seed = seedSnapshot.data();
        if (seed.fixtureVersion !== FIXTURE_VERSION || seed.projectId !== config.projectId) {
            throw new Error('Persisted fixture marker or project identity did not round-trip.');
        }
        const users = [];
        for (const fixture of FIXTURE_USERS) {
            const authUser = await auth.getUser(fixture.uid);
            const profileSnapshot = await db.collection('users').doc(fixture.uid).get();
            if (!profileSnapshot.exists) throw new Error(`Missing persisted user profile for ${fixture.uid}.`);
            const profile = profileSnapshot.data();
            if (profile.role !== fixture.role || profile.accountStatus !== fixture.accountStatus) {
                throw new Error(`Persisted role/status mismatch for ${fixture.uid}.`);
            }
            if (profile.isAdmin !== (fixture.isAdmin === true) || profile.isTeacher !== (fixture.isTeacher === true)) {
                throw new Error(`Persisted workforce identity mismatch for ${fixture.uid}.`);
            }
            if (profile.canEdit !== (fixture.canEdit === true)
                || profile.disabled !== (fixture.disabled === true)
                || profile.workforceGrants?.projects !== (fixture.workforceGrant || undefined)) {
                throw new Error(`Persisted workforce grant mismatch for ${fixture.uid}.`);
            }
            const claims = authUser.customClaims || {};
            if (claims.isAdmin !== (fixture.isAdmin === true)
                || claims.isTeacher !== (fixture.isTeacher === true)
                || claims.crmRole !== fixture.role
                || claims.accountStatus !== fixture.accountStatus
                || claims.canEdit !== (fixture.canEdit === true)
                || claims.workforceGrants?.projects !== (fixture.workforceGrant || undefined)) {
                throw new Error(`Auth claims mismatch for ${fixture.uid}.`);
            }
            users.push({
                uid: authUser.uid,
                role: profile.role,
                accountStatus: profile.accountStatus,
                disabled: authUser.disabled
            });
        }
        return { fixtureVersion: seed.fixtureVersion, projectId: seed.projectId, users };
    } finally {
        if (!app) await ownedApp.delete();
    }
}

async function main() {
    const config = getEmulatorConfig();
    if (config.projectId !== DEMO_PROJECT_ID) throw new Error('Refusing to seed a non-demo project.');
    const seeded = await seedFixtures({ config });
    const verified = await verifyFixtureRoundTrip({ config });
    process.stdout.write(`${JSON.stringify({ seeded, verified })}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    FIXTURE_COLLECTION,
    FIXTURE_DOC_ID,
    FIXTURE_VERSION,
    FIXTURE_USERS,
    PROJECT_COLLECTION,
    MEMBER_COLLECTION,
    WORKFORCE_COLLECTION,
    applyEmulatorEnvironment,
    assertFixtureApp,
    fixtureProfile,
    seedFixtures,
    verifyFixtureRoundTrip,
    initializeFixtureApp
};
