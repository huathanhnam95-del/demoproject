'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createRelayServer } = require('../../../services/crm-voice-relay/server');
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(done => setTimeout(done, 10)); } assert.fail('Expected operation did not run'); }
async function fixture() {
    const store = new AsyncLocalStorage(), observations = [], providers = new Map(), revoked = new Set(), unknown = [];
    const origin = 'http://127.0.0.1:45555'; let holdStatus, holdAudio, sequence = 0;
    const identities = { first: { uid: 'staff', auth_time: 100 }, second: { uid: 'staff', auth_time: 200 } };
    const observe = (kind, scope) => observations.push({ kind, sessionId: scope?.sessionId, identity: store.getStore() });
    const service = {
        async prepare(input) { observe('prepare', input); return { sessionId: `s${++sequence}`, ticket: 'ticket', engineeringOnly: true }; },
        async claim(input) { observe('claim', input); return { ...input, epoch: 1, contextRevision: 0, state: 'connected' }; },
        async readStatus(input) {
            observe('status-before', input);
            if (holdStatus && input.sessionId === 'held') await holdStatus.promise;
            observe('status-after', input); return { sessionId: input.sessionId, epoch: 1, contextRevision: 0, state: 'connected' };
        },
        async close() {},
        providerChannel(scope) { return { async getContext() { observe('context', scope); return {}; }, async beginUtterance() { observe('begin', scope); } }; }
    };
    const providerFactory = Object.assign(async options => {
        observe('provider-create', options.scope); providers.set(options.scope.sessionId, options);
        return { async sendAudio() { observe('audio', options.scope); if (holdAudio) await holdAudio.promise; }, async close() {} };
    }, { engineeringOnly: true });
    const relay = createRelayServer({ sessionService: service, allowedOrigins: [origin], engineeringMode: true,
        authenticate: async token => { if (revoked.has(token) || !identities[token]) throw Error('revoked'); return identities[token]; },
        runAsIdentity: (identity, work) => store.run(Object.freeze({ uid: identity.uid, auth_time: identity.auth_time }), work),
        providerFactory, features: { projects: { engineeringOnly: true, model: 'engineering-model', provider: 'engineering-provider', admission: async scope => { observe('admission', scope); return { model: 'engineering-model' }; } } },
        ledger: { forFeature() { return { async reserve() { observe('reserve'); return { reservationId: `r${sequence}` }; }, async authorizeDispatch() { observe('dispatch'); return { sendPermit: { engineeringOnly: true, model: 'engineering-model', provider: 'engineering-provider' } }; } }; }, async markUnknown(id) { unknown.push(id); }, async settle() {} }
    });
    await new Promise(done => relay.server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${relay.server.address().port}`;
    async function post(token, sessionId) { return fetch(url + '/status', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'projects', sessionId }) }); }
    return { observations, providers, revoked, unknown, store, post,
        holdStatus() { holdStatus = deferred(); return holdStatus; }, holdAudio() { holdAudio = deferred(); return holdAudio; },
        async connect(token, sessionId) {
            const ws = new WebSocket(url.replace('http:', 'ws:') + '/voice', { origin }); await once(ws, 'open');
            const response = once(ws, 'message'); ws.send(JSON.stringify({ type: 'authenticate', idToken: token, feature: 'projects', sessionId, ticket: 'ticket' }));
            assert.equal(JSON.parse((await response)[0]).type, 'ready'); return ws;
        }, async close() { holdStatus?.resolve(); holdAudio?.resolve(); await relay.close(); }
    };
}
test('overlapping HTTP operations for the same UID retain their own verified auth_time', async () => {
    const f = await fixture(), hold = f.holdStatus();
    try {
        const first = f.post('first', 'held'); await until(() => f.observations.some(row => row.sessionId === 'held'));
        assert.equal((await f.post('second', 'other')).status, 200); hold.resolve(); assert.equal((await first).status, 200);
        for (const row of f.observations) assert.deepEqual(row.identity, { uid: 'staff', auth_time: row.sessionId === 'held' ? 100 : 200 });
        assert.equal(f.store.getStore(), undefined);
    } finally { await f.close(); }
});
test('provider callbacks reenter their own connection identity even after another same-UID connection', async () => {
    const f = await fixture(); let first, second;
    try {
        first = await f.connect('first', 'first-session'); second = await f.connect('second', 'second-session');
        f.observations.length = 0;
        const response = once(first, 'message');
        await f.store.run({ uid: 'unrelated', auth_time: 999 }, async () => f.providers.get('first-session').onMessage({ assistant: { parts: [{ text: 'reply' }] } }));
        assert.equal(JSON.parse((await response)[0]).text, 'reply');
        assert.ok(f.observations.length); for (const row of f.observations) assert.deepEqual(row.identity, { uid: 'staff', auth_time: 100 });
    } finally { first?.terminate(); second?.terminate(); await f.close(); }
});
test('queued work rechecks the token at execution and revocation cannot block unknown-usage cleanup', async () => {
    const f = await fixture(), hold = f.holdAudio(); let ws;
    try {
        ws = await f.connect('first', 'queued-session'); const audio = JSON.stringify({ type: 'audio', data: Buffer.alloc(640).toString('base64') });
        ws.send(audio); await until(() => f.observations.some(row => row.kind === 'audio'));
        ws.send(audio); f.revoked.add('first'); hold.resolve(); await once(ws, 'close'); await until(() => f.unknown.length === 1);
        assert.equal(f.observations.filter(row => row.kind === 'audio').length, 1);
        for (const row of f.observations) assert.deepEqual(row.identity, { uid: 'staff', auth_time: 100 });
    } finally { ws?.terminate(); await f.close(); }
});


async function deadlineFixture({ admissionDelay = 0, providerDelay = 0, claimDelay = 0, retirementFails = false } = {}) {
    const diagnostics = [], diagnosticDetails = [], events = []; const origin = 'http://127.0.0.1:45555';
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const service = {
        async claim() { await delay(claimDelay); events.push('claimed'); return { epoch: 1, contextRevision: 0 }; },
        async readStatus() { return { epoch: 1, state: 'connected', contextRevision: 0 }; },
        providerChannel() { return { async getContext() { return {}; } }; },
        async close() { assert.fail('Public authorized close is not disconnect retirement'); },
        async retireConnection(scope) { events.push('retired'); assert.deepEqual(scope, { actorUid: 'staff', feature: 'projects', sessionId: 'session', epoch: 1 }); if (retirementFails) throw Error('backend unavailable'); }
    };
    const providerFactory = Object.assign(async ({ signal }) => { events.push('provider'); await delay(providerDelay); events.push(signal.aborted ? 'late-aborted' : 'ready'); return { async close() { events.push('provider-closed'); } }; }, { engineeringOnly: true });
    const relay = createRelayServer({ sessionService: service, authenticate: async () => ({ uid: 'staff' }), allowedOrigins: [origin], engineeringMode: true, providerFactory,
        limits: { authTimeoutMs: 300, providerSetupTimeoutMs: 300 }, onDiagnostic: event => { diagnostics.push(event.code); diagnosticDetails.push(event); },
        features: { projects: { engineeringOnly: true, model: 'engineering-model', provider: 'engineering-provider', async admission() { await delay(admissionDelay); events.push('admission'); return { model: 'engineering-model' }; } } },
        ledger: { forFeature() { return { async reserve() { events.push('reserve'); return { reservationId: 'r' }; }, async authorizeDispatch() { events.push('dispatch'); return { sendPermit: { engineeringOnly: true, model: 'engineering-model', provider: 'engineering-provider' } }; } }; }, async markUnknown() { events.push('unknown'); } }
    });
    await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
    const ws = new WebSocket(`ws://127.0.0.1:${relay.server.address().port}/voice`, { origin }); await once(ws, 'open');
    const response = once(ws, 'message'); ws.send(JSON.stringify({ type: 'authenticate', idToken: 'token', feature: 'projects', sessionId: 'session', ticket: 'ticket' }));
    return { events, diagnostics, diagnosticDetails, ws, response, async close() { ws.terminate(); await relay.close(); } };
}
test('actual relay gives authenticated admission and provider setup independent bounded deadlines', async () => {
    const f = await deadlineFixture({ admissionDelay: 200, providerDelay: 200 });
    try { assert.equal(JSON.parse((await f.response)[0]).type, 'ready'); assert.equal(f.events.filter(x => x === 'provider').length, 1); }
    finally { await f.close(); }
    await until(() => f.events.includes('retired')); assert.equal(f.events.filter(x => x === 'retired').length, 1);
});
test('auth timeout prevents late admission and retires a late verified claim', async () => {
    const f = await deadlineFixture({ claimDelay: 400 });
    try { assert.equal(JSON.parse((await f.response)[0]).type, 'error'); await until(() => f.events.includes('retired')); assert.ok(f.diagnostics.includes('AUTH_TIMEOUT')); assert.ok(f.diagnosticDetails.some(e => e.code === 'AUTH_TIMEOUT' && e.phase === 'authentication' && e.elapsedMs >= 290)); assert.equal(f.events.includes('reserve'), false); assert.equal(f.events.includes('provider'), false); }
    finally { await f.close(); }
});
test('provider setup timeout aborts late factory and independently diagnoses failed retirement', async () => {
    const f = await deadlineFixture({ providerDelay: 400, retirementFails: true });
    try { assert.equal(JSON.parse((await f.response)[0]).type, 'error'); await until(() => f.events.includes('provider-closed')); assert.ok(f.diagnostics.includes('PROVIDER_SETUP_TIMEOUT')); assert.ok(f.diagnosticDetails.some(e => e.code === 'PROVIDER_SETUP_TIMEOUT' && e.phase === 'provider_setup' && e.elapsedMs >= 290)); assert.ok(f.diagnostics.includes('SESSION_RETIREMENT_FAILED')); assert.ok(f.events.includes('late-aborted')); assert.ok(f.events.includes('unknown')); assert.equal(f.events.filter(x => x === 'retired').length, 1); }
    finally { await f.close(); }
});

test('auth deadline covers admission and prevents a late reservation or provider dispatch', async () => {
    const f = await deadlineFixture({ admissionDelay: 400 });
    try { assert.equal(JSON.parse((await f.response)[0]).type, 'error'); await until(() => f.events.includes('admission')); assert.equal(f.events.includes('reserve'), false); assert.equal(f.events.includes('dispatch'), false); assert.equal(f.events.includes('provider'), false); assert.equal(f.events.filter(x => x === 'retired').length, 1); }
    finally { await f.close(); }
});
