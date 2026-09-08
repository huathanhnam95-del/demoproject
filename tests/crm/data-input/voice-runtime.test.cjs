'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./transaction-fixture.cjs');
const { composeVoice } = require('../../../functions/src/crm/data-input/voice-runtime-composition');
const identity = (uid = 'staff1', auth_time = 200) => ({ uid, auth_time });
const denied = error => error.code === 'ACCOUNT_INELIGIBLE';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function setup(options = {}) {
    const f = fixture({ 'users/staff1': { isAdmin: true, role: 'admin' }, 'users/staff2': { isAdmin: true, role: 'admin' } });
    f.db.runTransaction = async work => {
        const current = fixture(Object.fromEntries(f.rows));
        current.transaction.create = (ref, value) => { assert.equal(current.rows.has(ref.path), false); current.transaction.set(ref, value); };
        const result = await work(current.transaction);
        f.rows.clear(); for (const [key, value] of current.rows) f.rows.set(key, value);
        return result;
    };
    const state = { deleted: 0, verifies: [], lookups: [], disabled: false, validAfter: '1970-01-01T00:02:30Z' };
    const auth = {
        async verifyIdToken(token, revoked) { state.verifies.push({ token, revoked }); if (state.beforeVerify) await state.beforeVerify(); if (token !== 'fixture-token') throw Error('Invalid fixture token'); return identity(); },
        async getUser(uid) { state.lookups.push(uid); if (state.beforeLookup) await state.beforeLookup(uid); return { disabled: state.disabled, tokensValidAfterTime: state.validAfter }; }
    };
    const app = { firestore() { if (options.startupFailure) throw options.startupFailure; return f.db; }, auth: () => auth,
        async delete() { state.deleted++; if (options.cleanupFailure) throw options.cleanupFailure; } };
    const admin = { initializeApp(config, name) { state.config = config; state.appName = name; return app; } };
    if (options.startupFailure) return { f, state, admin };
    const composition = await composeVoice({ config: { projectId: 'demo-crm-runtime', engineeringMode: true, nativeReady: true, ...options.config }, admin,
        nativeCredentials: options.nativeCredentials, createVoiceProvider: options.createVoiceProvider });
    return { ...f, state, admin, composition, budget: uid => composition.ledger.forFeature('crm-data-input').getBudget(uid) };
}

test('gated runtime verifies bearer revocation, reuses shared budget and never enables provider from config hints', async t => {
    const f = await setup(); t.after(() => f.composition.close());
    assert.equal(f.composition.nativeReady, false); assert.deepEqual(f.composition.features, {});
    assert.notEqual(f.composition.engineeringMode, true); assert.equal(f.composition.providerFactory, undefined);
    assert.deepEqual(f.state.config, { projectId: 'demo-crm-runtime' }); assert.match(f.state.appName, /^crm-data-input-voice-/);
    assert.deepEqual(await f.composition.authenticate('fixture-token'), identity());
    assert.deepEqual(f.state.verifies, [{ token: 'fixture-token', revoked: true }]);
    await assert.rejects(f.composition.authenticate('invalid'), /Invalid fixture token/);
    await assert.rejects(f.budget('staff1'), denied);
    const budget = await f.composition.runAsIdentity(identity(), () => f.budget('staff1'));
    assert.equal(budget.uid, 'staff1'); assert.equal(budget.allowanceNano, '5000000000');
    await assert.rejects(f.composition.runAsIdentity(identity(), () => f.composition.sessionService.prepare({ actorUid: 'staff1', feature: 'crm-data-input', requestId: 'r1', contextHints: {} })), error => error.code === 'NATIVE_VOICE_UNAVAILABLE');
});

test('native runtime registers only data input through the injected service factory without dispatch', async () => {
    let dependencies;
    const providerFactory = Object.assign(() => { throw Error('Unexpected dispatch'); }, { native: true });
    const f = await setup({ config: { nativeEnabled: true }, nativeCredentials: { apiKey: 'fixture-key' },
        createVoiceProvider: value => { dependencies = value; return providerFactory; } });
    try {
        assert.equal(f.composition.nativeReady, true); assert.equal(f.composition.nativeMode, true);
        assert.equal(f.composition.providerFactory, providerFactory);
        assert.equal(dependencies.ledger, f.composition.ledger);
        assert.equal(typeof dependencies.native.transcribe, 'function');
        assert.deepEqual(Object.keys(f.composition.features), ['crm-data-input']);
        assert.equal(f.composition.features['crm-data-input'].model, 'gemini-3.1-flash-live-preview');
        assert.equal(f.composition.features['crm-data-input'].engineeringOnly, false);
        await assert.rejects(f.budget('staff1'), denied);
        assert.equal((await f.composition.runAsIdentity(identity(), () => f.budget('staff1'))).paidDispatchAvailable, true);
        await f.composition.runAsIdentity(identity(), async () => {
            const prepared = await f.composition.sessionService.prepare({ actorUid: 'staff1', feature: 'crm-data-input', requestId: 'native1', contextHints: {} });
            assert.equal(prepared.engineeringOnly, false);
            const claimed = await f.composition.sessionService.claim({ actorUid: 'staff1', feature: 'crm-data-input', sessionId: prepared.sessionId,
                ticket: prepared.ticket, connectionId: 'connection1' });
            const scope = { actorUid: 'staff1', feature: 'crm-data-input', sessionId: prepared.sessionId, epoch: claimed.epoch };
            const admission = await f.composition.features['crm-data-input'].admission(scope);
            assert.equal(admission.purpose, 'draft'); assert.equal(admission.request.kind, 'live');
            assert.equal(admission.request.audioBytes, 3840000); assert.equal(admission.request.maxOutputTokens, 512);
            assert.ok(admission.request.inputBytes > 0);
            const reservation = await f.composition.ledger.forFeature('crm-data-input').reserve('staff1', { requestId: 'live1', ...admission });
            assert.ok(reservation.reservationId);
            f.state.disabled = true;
            await assert.rejects(f.composition.features['crm-data-input'].admission(scope), error => error.status === 403);
        });
    } finally { await f.composition.close(); }
    assert.equal(f.state.deleted, 1);
});

test('native startup refuses absent key or provider factory and cleans its app', async () => {
    const f = await setup(); await f.composition.close();
    await assert.rejects(composeVoice({ config: { projectId: 'demo-crm-runtime', nativeEnabled: true }, admin: f.admin }), /native|key|factory/i);
    await assert.rejects(composeVoice({ config: { projectId: 'demo-crm-runtime', nativeEnabled: true }, nativeCredentials: { apiKey: 'fixture-key' }, admin: f.admin }), /factory/i);
    assert.equal(f.state.deleted, 3);
});

test('overlapping identities and nested operations retain their own UID and restore outer context', async t => {
    const f = await setup(); t.after(() => f.composition.close()); const gate = deferred();
    const first = f.composition.runAsIdentity(identity(), async () => {
        await gate.promise;
        assert.equal((await f.budget('staff1')).uid, 'staff1');
        await assert.rejects(f.budget('staff2'), denied);
        await f.composition.runAsIdentity(identity('staff2'), async () => {
            assert.equal((await f.budget('staff2')).uid, 'staff2');
            await assert.rejects(f.budget('staff1'), denied);
        });
        assert.equal((await f.budget('staff1')).uid, 'staff1');
    });
    await f.composition.runAsIdentity(identity('staff2'), async () => {
        assert.equal((await f.budget('staff2')).uid, 'staff2'); gate.resolve(); await first;
        assert.equal((await f.budget('staff2')).uid, 'staff2');
    });
    await assert.rejects(f.budget('staff1'), denied);
});

test('same UID old and new tokens cannot replace one another during overlapping work', async t => {
    const f = await setup(); t.after(() => f.composition.close()); const gate = deferred();
    const old = f.composition.runAsIdentity(identity('staff1', 100), async () => { await gate.promise; await assert.rejects(f.budget('staff1'), denied); });
    await f.composition.runAsIdentity(identity('staff1', 200), async () => {
        assert.equal((await f.budget('staff1')).uid, 'staff1'); gate.resolve(); await old;
        assert.equal((await f.budget('staff1')).uid, 'staff1');
    });
});

test('current account disabling, token revocation and persisted student classification deny each invocation', async t => {
    const f = await setup(); t.after(() => f.composition.close());
    await f.composition.runAsIdentity(identity(), async () => {
        await f.budget('staff1');
        f.state.disabled = true; await assert.rejects(f.budget('staff1'), denied); f.state.disabled = false;
        f.state.validAfter = '1970-01-01T00:03:21Z'; await assert.rejects(f.budget('staff1'), denied); f.state.validAfter = '1970-01-01T00:02:30Z';
        f.rows.set('users/staff1', { isAdmin: true, profile: { accountType: 'student' } }); await assert.rejects(f.budget('staff1'), denied);
        f.rows.set('users/staff1', { isAdmin: true, role: 'admin' }); assert.equal((await f.budget('staff1')).uid, 'staff1');
    });
    assert.equal(f.state.lookups.length, 5);
});

test('identity snapshot cannot be mutated and detached work loses authority after its operation ends', async t => {
    const f = await setup(); t.after(() => f.composition.close()); const gate = deferred(), original = identity(); let detached;
    await f.composition.runAsIdentity(original, async () => {
        original.uid = 'staff2'; original.auth_time = 0;
        assert.equal((await f.budget('staff1')).uid, 'staff1');
        detached = gate.promise.then(() => assert.rejects(f.budget('staff1'), denied));
    });
    gate.resolve(); await detached;
    await assert.rejects(f.composition.runAsIdentity(identity(), async () => { throw Error('operation failed'); }), /operation failed/);
    await assert.rejects(f.budget('staff1'), denied);
});

test('malformed verified identity or absent work cannot create an authorization scope', async t => {
    const f = await setup(); t.after(() => f.composition.close()); let invoked = false;
    for (const claims of [null, {}, { uid: '', auth_time: 200 }, { uid: 'staff1' }, { uid: 'staff1', auth_time: '200' }, identity('staff1', NaN), identity('staff1', -1)]) {
        assert.throws(() => f.composition.runAsIdentity(claims, () => { invoked = true; }), /identity/i);
    }
    assert.throws(() => f.composition.runAsIdentity(identity(), null), /operation/i);
    assert.equal(invoked, false); await assert.rejects(f.budget('staff1'), denied);
});

test('unfinished authorization cannot outlive its operation and late bearer verification cannot outlive cleanup', async () => {
    const f = await setup(), entered = deferred(), release = deferred(); let detached;
    f.state.beforeLookup = async () => { entered.resolve(); await release.promise; };
    await f.composition.runAsIdentity(identity(), async () => {
        detached = assert.rejects(f.budget('staff1'), denied);
        await entered.promise;
    });
    release.resolve(); await detached;
    const verifyEntered = deferred(), verifyRelease = deferred();
    f.state.beforeVerify = async () => { verifyEntered.resolve(); await verifyRelease.promise; };
    const late = assert.rejects(f.composition.authenticate('fixture-token'), /closed/i);
    await verifyEntered.promise; await f.composition.close(); verifyRelease.resolve(); await late;
});

test('cleanup is identity-independent and idempotent, and fences active and future work', async () => {
    const f = await setup(), gate = deferred();
    const pending = f.composition.runAsIdentity(identity(), async () => { await gate.promise; await assert.rejects(f.budget('staff1'), denied); });
    const closing = f.composition.close(); assert.equal(f.composition.close(), closing); await closing;
    gate.resolve(); await pending; assert.equal(f.state.deleted, 1);
    assert.throws(() => f.composition.runAsIdentity(identity(), () => f.budget('staff1')), /closed/i);
    await assert.rejects(f.composition.authenticate('fixture-token'), /closed/i);
});

test('startup failure cleans its owned app and cleanup errors do not replace the original failure', async () => {
    const startupFailure = Error('fixture initialization failed');
    const f = await setup({ startupFailure, cleanupFailure: Error('fixture cleanup failed') });
    await assert.rejects(composeVoice({ config: { projectId: 'demo-crm-runtime' }, admin: f.admin }), error => error === startupFailure);
    assert.equal(f.state.deleted, 1);
    const cleanupFailure = Error('fixture deletion failed'), normal = await setup({ cleanupFailure });
    const closing = normal.composition.close(); await assert.rejects(closing, error => error === cleanupFailure);
    assert.equal(normal.composition.close(), closing); assert.equal(normal.state.deleted, 1);
});

test('shared runtime gives the owned composition the dedicated fixture credential without native dispatch', async () => {
    const { createRuntime } = require('../../../services/crm-voice-relay/runtime');
    const { EventEmitter } = require('node:events');
    const f = await setup(); await f.composition.close(); let composed = false;
    const runtime = await createRuntime({ env: { GCLOUD_PROJECT: 'demo-native-input', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8270',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9170', CRM_VOICE_ALLOWED_ORIGINS: 'http://127.0.0.1:9270', CRM_VOICE_NATIVE_ENABLED: 'true',
        CRM_VOICE_GEMINI_API_KEY: 'fixture-dedicated', GEMINI_API_KEY: 'fixture-legacy' },
        compose: async options => { assert.equal(options.nativeCredentials.apiKey, 'fixture-dedicated'); composed = true;
            return composeVoice({ ...options, admin: f.admin, createVoiceProvider: () => Object.assign(() => { throw Error('No dispatch expected'); }, { native: true }) }); },
        relayFactory: () => ({ server: new EventEmitter(), async close() {} }) });
    assert.equal(composed, true); await runtime.close(); assert.equal(f.state.deleted, 2);
});
