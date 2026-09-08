'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdmission } = require('../../../functions/src/crm/data-input/authorization');
const register = require('../../../functions/src/routes/admin/data-input');

function setup(dataInputProvider = null, dataInputEnabled = true, extraDeps = {}, throughRouter = false) {
    const state = { user: { isAdmin: true, role: 'admin' }, authUser: { disabled: false, tokensValidAfterTime: '1970-01-01T00:00:00Z' }, claims: { uid: 'staff-1', auth_time: 1000 }, verifications: [], rows: new Map() };
    const reference = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`) });
    const collection = path => ({ doc: id => reference(`${path}/${id}`) });
    const tx = {
        async get(ref) { const data = ref.path === 'users/staff-1' ? state.user : state.rows.get(ref.path); return { exists: !!data, data: () => structuredClone(data) }; },
        set(ref, data) { state.rows.set(ref.path, structuredClone(data)); }
    };
    const db = { collection, runTransaction: fn => fn(tx) };
    const authClient = { async getUser() { return state.authUser; }, async verifyIdToken(token, revoked) { state.verifications.push({ token, revoked }); return state.claims; } };
    const routes = new Map(), router = {};
    for (const method of ['get', 'post', 'patch']) router[method] = (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1));
    const deps = { db, dataInputAuth: authClient, dataInputProvider, dataInputEnabled, ...extraDeps, requireAdminHandlers: [],
        sendSuccess: (res, data) => Object.assign(res, { status: 200, data }),
        sendError: (res, status, code, message, details) => Object.assign(res, { status, code, message, details })
    };
    if (throughRouter) {
        const composed = require('../../../functions/src/routes/admin/create-crm-router')({ ...deps,
            authMiddleware: null, admin: { auth: () => authClient },
            identity: { generateClassCode() {}, lookupUserByEmail() {}, forceLinkProfile() {} } });
        for (const layer of composed.stack) if (layer.route) {
            for (const method of Object.keys(layer.route.methods)) routes.set(`${method} ${layer.route.path}`, layer.route.stack.at(-1).handle);
        }
    } else register(router, deps);
    async function call(route, body = {}, params = {}, requestOptions = {}) {
        const res = { set(value) { this.headers = value; return this; }, status(value) { this.statusCode = value; return this; }, send(value) { this.bytes = value; return this; } };
        await routes.get(route)({ body, params, ...requestOptions, headers: { authorization: 'Bearer test-token', ...requestOptions.headers } }, res);
        return res;
    }
    return { state, tx, db, authClient, call, routes };
}

test('normal CRM router lazily resolves native HTTP capabilities with current staff admission', async () => {
    let constructions = 0;
    const { createDataInputNativeServices } = require('../../../functions/src/crm/data-input/native-provider');
    const f = setup(null, true, { dataInputNativeConfigOptions: {
        env: { CRM_VOICE_NATIVE_ENABLED: 'true', CRM_VOICE_GEMINI_API_KEY: 'offline-key', CRM_VOICE_RELAY_URL: 'https://relay.example.invalid' },
        createNative(options) { constructions++; return createDataInputNativeServices({ ...options, fetchImpl: () => assert.fail('No paid call during configuration') }); }
    } }, true);
    assert.equal(constructions, 0);
    const response = await f.call('get /data-input/capabilities');
    assert.equal(response.status, 200); assert.equal(constructions, 1);
    assert.equal(response.data.interpretation, true); assert.equal(response.data.voice, true);
    assert.equal(response.data.voiceRelayUrl, 'https://relay.example.invalid');
    f.state.user.role = 'student';
    assert.equal((await f.call('get /data-input/capabilities')).status, 403);
    assert.equal(f.state.rows.size, 0);
});

test('normal router preserves explicit null and engineering configs without invoking native defaults', async () => {
    for (const config of [null, { engineeringMode: true, voiceRelayUrl: 'https://engineering.example.invalid' }]) {
        const f = setup(null, true, { dataInputAssistanceConfig: config, dataInputNativeConfigOptions: {
            env: { CRM_VOICE_NATIVE_ENABLED: 'true' }, resolveApiKey() { assert.fail('Explicit config must bypass credentials'); }
        } }, true);
        const response = await f.call('get /data-input/capabilities');
        assert.equal(response.status, 200); assert.equal(response.data.voice, !!config);
    }
});

test('enabled invalid native config is sanitized at request time while disabled and request-controlled config cannot activate it', async () => {
    const options = { env: { CRM_VOICE_NATIVE_ENABLED: 'true', CRM_VOICE_RELAY_URL: 'https://relay.example.invalid' },
        resolveApiKey() { throw Error('secret-private-configuration'); } };
    const invalid = setup(null, true, { dataInputNativeConfigOptions: options }, true);
    const response = await invalid.call('get /data-input/capabilities');
    assert.equal(response.status, 503); assert.equal(response.code, 'ASSISTANCE_UNAVAILABLE');
    assert.equal(JSON.stringify(response).includes('secret-private'), false);
    const disabled = setup(null, false, { dataInputNativeConfigOptions: options }, true);
    assert.equal((await disabled.call('get /data-input/capabilities')).data.voice, false);
    const off = setup(null, true, { dataInputNativeConfigOptions: { env: {} } }, true);
    const forged = await off.call('get /data-input/capabilities', { dataInputAssistanceConfig: { nativeMode: true }, CRM_VOICE_NATIVE_ENABLED: 'true' });
    assert.equal(forged.data.voice, false); assert.equal(forged.data.interpretation, false);
});

test('disabled rollout advertises no capabilities and prevents every data-input operation', async () => {
    let dispatches = 0;
    const f = setup({ generate: async () => { dispatches++; } }, false);
    assert.deepEqual((await f.call('get /data-input/capabilities')).data, { drafts: false, interpretation: false, attachments: false, imageInterpretation: false, budget: false, voice: false, voiceRelayUrl: null });
    for (const route of f.routes.keys()) {
        if (route === 'get /data-input/capabilities') continue;
        assert.equal((await f.call(route, {}, { draftId: 'd1', messageId: 'm1' })).code, 'DATA_INPUT_DISABLED', route);
    }
    assert.equal(f.state.rows.size, 0); assert.equal(dispatches, 0);
    f.state.user.isAdmin = false;
    assert.equal((await f.call('post /data-input/conversations')).status, 403);
    assert.equal((await f.call('get /data-input/capabilities')).status, 403);
});

test('budget route uses authenticated UID and native-off capabilities do not expose a voice endpoint', async () => {
    const f = setup();
    const capability = (await f.call('get /data-input/capabilities')).data;
    assert.equal(capability.budget, true); assert.equal(capability.voice, false); assert.equal(capability.voiceRelayUrl, null);
    const response = await f.call('get /data-input/budget');
    assert.equal(response.status, 200); assert.equal(response.data.budget.uid, 'staff-1'); assert.equal(response.data.budget.schemaVersion, 2); assert.equal(response.data.budget.quotaMode, 'usage_credits');
    assert.equal(response.data.budget.allowanceMicrocredits, '5000000000');
    assert.equal(response.data.budget.remainingMicrocredits, '5000000000');
    assert.equal(response.data.budget.equivalence.invoiceCap, false);
    assert.equal(response.data.budget.paidDispatchAvailable, false);
    f.state.user.role = 'student'; assert.equal((await f.call('get /data-input/budget')).status, 403);
});

test('voice commit only accepts opaque references under explicit server engineering composition', async () => {
    const off = setup();
    assert.equal((await off.call('post /data-input/conversations/:draftId/commit', { previewId: 'p1', voiceAttestationId: 'a1' }, { draftId: 'd1' })).code, 'VOICE_UNAVAILABLE');
    const f = setup(null, true, { dataInputAssistanceConfig: { engineeringMode: true, usageQuota: { enabled: false }, voiceRelayUrl: 'http://127.0.0.1:9271' } });
    assert.equal((await f.call('get /data-input/capabilities')).data.voice, true);
    const created = await f.call('post /data-input/conversations', { requestId: 'voice' }), params = { draftId: created.data.draftId };
    const context = await f.call('post /data-input/conversations/:draftId/voice-context', {}, params);
    assert.equal(context.status, 200); assert.equal(context.data.previewBinding, null);
    for (const extra of [{ text: 'save now' }, { actorUid: 'other' }, { binding: {} }]) {
        assert.equal((await f.call('post /data-input/conversations/:draftId/commit', { previewId: 'p1', voiceAttestationId: 'a1', ...extra }, params)).code, 'INVALID_REQUEST');
    }
    assert.equal((await f.call('post /data-input/conversations/:draftId/commit', { previewId: 'p1', voiceAttestationId: 'a1', confirmationToken: 'token' }, params)).code, 'INVALID_CONFIRMATION');
});

test('authorized attachment routes normalize upload, list, serve private bytes and remove', async () => {
    const objects = new Map();
    const dataInputStorage = { putIfAbsent: async (key, bytes) => objects.set(key, bytes), read: async key => objects.get(key), delete: async key => objects.delete(key) };
    const f = setup(null, true, { dataInputStorage });
    assert.equal((await f.call('get /data-input/capabilities')).data.attachments, true);
    const created = await f.call('post /data-input/conversations', { requestId: 'image' });
    const params = { draftId: created.data.draftId, attachmentId: 'image1' };
    const sharp = require(require.resolve('sharp', { paths: [require('node:path').join(__dirname, '../../../functions')] }));
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    const upload = await f.call('post /data-input/conversations/:draftId/attachments/:attachmentId', {}, params, { headers: { 'content-type': 'image/png', 'x-crm-draft-revision': '0' }, rawBody: bytes });
    assert.equal(upload.status, 200); assert.equal(upload.data.attachment.status, 'ready');
    const listed = await f.call('get /data-input/conversations/:draftId/attachments', {}, params);
    assert.equal(listed.data.attachments.length, 1);
    const read = await f.call('get /data-input/conversations/:draftId/attachments/:attachmentId', {}, params);
    assert.equal(read.statusCode, 200); assert.equal(read.headers['Cache-Control'], 'private, no-store');
    assert.equal(read.headers['X-Content-Type-Options'], 'nosniff'); assert.ok(Buffer.isBuffer(read.bytes));
    await f.call('post /data-input/conversations/:draftId/attachments/:attachmentId/remove', {}, params);
    assert.equal(objects.size, 0);
    assert.equal((await f.call('get /data-input/conversations/:draftId/attachments/:attachmentId', {}, params)).status, 404);
});
test('image interpretation routes read normalized owned bytes and preserve provenance through apply', async () => {
    const objects = new Map(); let calls = 0, received;
    const storage = { putIfAbsent: async (key, bytes) => objects.set(key, bytes), read: async key => objects.get(key), delete: async key => objects.delete(key) };
    const provider = { supportsImages: true, generate: async input => { calls++; received = input.request.image; return JSON.stringify({ upserts: [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan' } }], removals: [], questions: [], lookups: [] }); } };
    const f = setup(provider, true, { dataInputStorage: storage });
    assert.equal((await f.call('get /data-input/capabilities')).data.imageInterpretation, true);
    const created = await f.call('post /data-input/conversations', { requestId: 'image-draft' });
    const params = { draftId: created.data.draftId, attachmentId: 'a1', messageId: 'm1' };
    const bytes = await require('sharp')({ create: { width: 2, height: 3, channels: 3, background: 'blue' } }).png().toBuffer();
    const upload = await f.call('post /data-input/conversations/:draftId/attachments/:attachmentId', {}, params, { headers: { 'content-type': 'image/png', 'x-crm-draft-revision': '0' }, rawBody: bytes });
    const body = { messageId: 'm1', expectedRevision: upload.data.draft.revision, text: 'Use this name', attachmentId: 'a1' };
    const route = 'post /data-input/conversations/:draftId/interpretations';
    assert.equal((await f.call(route, { ...body, image: { inlineData: 'forged' } }, params)).status, 400);
    assert.equal((await f.call(route, { ...body, attachmentId: 'foreign' }, params)).status, 404); assert.equal(calls, 0);
    const result = await f.call(route, body, params); assert.equal(result.status, 200); assert.equal(result.data.status, 'done');
    assert.deepEqual(Buffer.from(received.inlineData.data, 'base64'), [...objects.values()][0]);
    assert.deepEqual((await f.call(route, body, params)).data, result.data); assert.equal(calls, 1);
    const applied = await f.call('post /data-input/conversations/:draftId/interpretations/:messageId/apply', {}, params);
    assert.deepEqual(applied.data.draft.actions[0].provenance.name, { kind: 'image', messageId: 'm1', attachmentId: 'a1' });
    await f.call('post /data-input/conversations/:draftId/attachments/:attachmentId/remove', {}, params);
    const current = await f.call('get /data-input/conversations/:draftId', {}, params);
    assert.equal((await f.call(route, { ...body, messageId: 'm2', expectedRevision: current.data.draft.revision }, params)).status, 404);
    assert.equal(calls, 1);
    provider.supportsImages = false;
    assert.equal((await f.call('get /data-input/capabilities')).data.imageInterpretation, false);
    provider.supportsImages = true;
    assert.equal((await setup(provider, true).call('get /data-input/capabilities')).data.imageInterpretation, false);
});

test('an inaccessible draft is rejected before the upload body is touched', async () => {
    const f = setup(); const created = await f.call('post /data-input/conversations', { requestId: 'private-image' });
    f.state.claims = { uid: 'staff-2', auth_time: 1000 }; f.state.rows.set('users/staff-2', { isAdmin: true, role: 'admin' });
    let bodyReads = 0; const result = {};
    await f.routes.get('post /data-input/conversations/:draftId/attachments/:attachmentId')({ headers: { authorization: 'Bearer test-token' }, params: { draftId: created.data.draftId, attachmentId: 'a1' }, get rawBody() { bodyReads++; throw Error('Must not read'); } }, result);
    assert.equal(result.status, 404); assert.equal(bodyReads, 0);
});

test('interpretation is unavailable by default and capability reads require current staff access', async () => {
    const { call, state } = setup();
    const capability = await call('get /data-input/capabilities');
    assert.equal(capability.data.interpretation, false);
    const created = await call('post /data-input/conversations', { requestId: 'input' });
    const result = await call('post /data-input/conversations/:draftId/interpretations', { messageId: 'm1', expectedRevision: 0, text: 'Add Lan' }, { draftId: created.data.draftId });
    assert.equal(result.status, 503); assert.equal(result.code, 'INTERPRETATION_UNAVAILABLE');
    assert.equal(state.rows.size, 1);
    state.user.isAdmin = false;
    assert.equal((await call('get /data-input/capabilities')).status, 403);
});

test('lookup endpoint binds the owner and revision and rejects supplied record context', async () => {
    const { call, state } = setup();
    const created = await call('post /data-input/conversations', { requestId: 'lookups' });
    const params = { draftId: created.data.draftId };
    assert.deepEqual((await call('post /data-input/conversations/:draftId/lookups', { expectedRevision: 0 }, params)).data, { revision: 0, queries: [] });
    assert.equal((await call('post /data-input/conversations/:draftId/lookups', { expectedRevision: 1 }, params)).code, 'REVISION_CONFLICT');
    assert.equal((await call('post /data-input/conversations/:draftId/lookups', { expectedRevision: 0, records: [] }, params)).status, 400);
    assert.equal((await call('post /data-input/conversations/:draftId/interpretations', { expectedRevision: 0, text: 'continue', messageId: 'm1', selections: [{ lookupIndex: 0, id: 's1', values: { name: 'Forged' } }] }, params)).code, 'INVALID_SELECTION');
    state.user.isAdmin = false;
    assert.equal((await call('post /data-input/conversations/:draftId/lookups', { expectedRevision: 0 }, params)).status, 403);
});

test('configured interpretation routes bind staff identity and recover the same proposal', async () => {
    let requests = 0;
    const { call, state } = setup({ generate: async request => {
        requests++; assert.equal(request.actorUid, 'staff-1'); assert.equal(request.request.model, 'gemini-3.8-flash');
        return JSON.stringify({ upserts: [{ actionId: 's1', kind: 'createStudent', values: { name: 'Lan' } }], removals: [], lookups: [], questions: [] });
    } });
    assert.equal((await call('get /data-input/capabilities')).data.interpretation, true);
    const created = await call('post /data-input/conversations', { requestId: 'input' });
    const params = { draftId: created.data.draftId, messageId: 'm1' };
    const body = { messageId: 'm1', expectedRevision: 0, text: 'Add Lan' };
    for (const forged of [{ model: 'other' }, { actorUid: 'other' }, { source: { kind: 'voice' } }]) {
        assert.equal((await call('post /data-input/conversations/:draftId/interpretations', { ...body, ...forged }, params)).status, 400);
    }
    const result = await call('post /data-input/conversations/:draftId/interpretations', body, params);
    assert.equal(result.status, 200); assert.equal(result.data.status, 'done');
    const recovered = await call('get /data-input/conversations/:draftId/interpretations/:messageId', {}, params);
    assert.deepEqual(recovered.data, result.data);
    await call('post /data-input/conversations/:draftId/interpretations', body, params);
    assert.equal(requests, 1);
    assert.equal(state.rows.get(`crmDataInputDrafts/${params.draftId}`).revision, 0);
    const forgedApply = await call('post /data-input/conversations/:draftId/interpretations/:messageId/apply', { changes: {} }, params);
    assert.equal(forgedApply.status, 400);
    const applied = await call('post /data-input/conversations/:draftId/interpretations/:messageId/apply', {}, params);
    assert.equal(applied.status, 200); assert.equal(applied.data.draft.revision, 1);
    state.claims = { uid: 'staff-2', auth_time: 1000 };
    state.rows.set('users/staff-2', { isAdmin: true, role: 'admin' });
    assert.equal((await call('get /data-input/conversations/:draftId/interpretations/:messageId', {}, params)).status, 404);
});

test('preview returns actionable field metadata without reflecting draft values', async () => {
    const { call } = setup();
    const created = await call('post /data-input/conversations', { requestId: 'questions' });
    const params = { draftId: created.data.draftId };
    await call('patch /data-input/conversations/:draftId', { messageId: 'm1', text: 'Add enquiry', changes: { expectedRevision: 0, upserts: [{ actionId: 'lead', kind: 'createLead', values: { name: 'Private name' } }] } }, params);
    const response = await call('post /data-input/conversations/:draftId/preview', { expectedRevision: 1, requestId: 'review' }, params);
    assert.equal(response.status, 422);
    assert.deepEqual(response.details, { issues: [{ code: 'REQUIRED_FIELD', actionId: 'lead', field: 'source' }] });
    assert.equal(JSON.stringify(response).includes('Private name'), false);
});

test('staff admission requires current admin, enabled Auth account and valid token age', async () => {
    const { state, tx, db, authClient } = setup();
    const admit = createAdmission({ db, authClient, identity: state.claims });
    assert.equal(await admit({ tx, actorUid: 'staff-1' }), true);
    state.user.isAdmin = false; assert.equal(await admit({ tx, actorUid: 'staff-1' }), false);
    state.user.isAdmin = true; state.authUser.disabled = true; assert.equal(await admit({ tx, actorUid: 'staff-1' }), false);
    state.authUser.disabled = false; state.authUser.tokensValidAfterTime = '2026-01-01T00:00:00Z';
    assert.equal(await admit({ tx, actorUid: 'staff-1' }), false);
    assert.equal(await admit({ tx, actorUid: 'staff-2' }), false);
});

test('student and other nonstaff roles cannot gain AI admission through an anomalous admin flag', async () => {
    const { state, tx, db, authClient } = setup();
    const admit = createAdmission({ db, authClient, identity: state.claims });
    for (const role of ['student', 'learner', 'parent', 'guest']) {
        state.user.role = role; assert.equal(await admit({ tx, actorUid: 'staff-1' }), false);
    }
    state.user.role = 'admin'; state.user.roles = ['student'];
    assert.equal(await admit({ tx, actorUid: 'staff-1' }), false);
});

test('persisted nonstaff identity aliases and flags override anomalous admin privileges', async () => {
    for (const location of ['user', 'profile', 'workforce']) {
        for (const key of ['role', 'crmRole', 'accountType', 'userType', 'type', 'organizationRole', 'workforceRole', 'roles', 'isStudent', 'isLearner', 'isParent', 'isGuest']) {
            const { state, tx, db, authClient } = setup();
            const record = location === 'user' ? state.user : (state.user[location] = {});
            record[key] = key.startsWith('is') ? true : key === 'roles' ? ['admin', ' STUDENT '] : ' Learner ';
            assert.equal(await createAdmission({ db, authClient, identity: state.claims })({ tx, actorUid: 'staff-1' }), false, `${location}.${key}`);
        }
    }
});

test('teacher practice-access Auth claims do not classify a CRM admin as a learner', async () => {
    const { state, tx, db, authClient } = setup();
    state.authUser.customClaims = { isTeacher: true, isStudent: true };
    state.claims.isStudent = true;
    state.user.crmRole = 'teacher'; state.user.isTeacher = true;
    state.user.profile = { organizationRole: 'staff', isLearner: false };
    assert.equal(await createAdmission({ db, authClient, identity: state.claims })({ tx, actorUid: 'staff-1' }), true);
});

test('routes derive the operator from freshly verified tokens and reject forged authority', async () => {
    const { call, state } = setup();
    const created = await call('post /data-input/conversations', { requestId: 'r1' });
    assert.equal(created.status, 200); assert.equal(created.data.actorUid, 'staff-1');
    assert.deepEqual(state.verifications[0], { token: 'test-token', revoked: true });
    const forged = await call('post /data-input/conversations', { requestId: 'r2', actorUid: 'staff-2' });
    assert.equal(forged.status, 400);
    assert.equal(state.rows.size, 1);
});

test('registered conversation endpoints persist edits and reload without a model call', async () => {
    const { call } = setup();
    const created = await call('post /data-input/conversations', { requestId: 'r1' });
    const params = { draftId: created.data.draftId };
    const edited = await call('patch /data-input/conversations/:draftId', { messageId: 'm1', text: 'Add Lan', changes: { expectedRevision: 0, upserts: [{ actionId: 's1', kind: 'createStudent', values: { name: 'Lan' } }] } }, params);
    assert.equal(edited.status, 200);
    const loaded = await call('get /data-input/conversations/:draftId', {}, params);
    assert.equal(loaded.data.messages[0].source.kind, 'text');
    assert.equal(loaded.data.draft.actions[0].values.name, 'Lan');
    const discarded = await call('post /data-input/conversations/:draftId/discard', { expectedRevision: 1 }, params);
    assert.equal(discarded.data.status, 'cancelled');
});

test('revocation after creation denies later reads and edits', async () => {
    const { call, state } = setup();
    const created = await call('post /data-input/conversations', { requestId: 'r1' });
    state.user.isAdmin = false;
    const result = await call('get /data-input/conversations/:draftId', {}, { draftId: created.data.draftId });
    assert.equal(result.status, 403);
});

test('provider provenance and confirmation cannot be forged through manual edit routes', async () => {
    const { call, routes } = setup();
    const result = await call('patch /data-input/conversations/:draftId', { source: { kind: 'voice' }, confirmation: true }, { draftId: 'd1' });
    assert.equal(result.status, 400);
    assert.equal(routes.has('post /data-input/conversations/:draftId/commit'), true);
    const forged = await call('post /data-input/conversations/:draftId/commit', { changes: {}, actorUid: 'other', confirmation: true }, { draftId: 'd1' });
    assert.equal(forged.status, 400);
});

test('unavailable authorization infrastructure fails closed without exposing internals', async () => {
    const { call, authClient, state } = setup();
    authClient.verifyIdToken = async () => { throw new Error('private credentials internal error'); };
    const result = await call('post /data-input/conversations', { requestId: 'r1' });
    assert.equal(result.status, 401);
    assert.equal(result.message.includes('private'), false);
    assert.equal(state.rows.size, 0);
});

test('malformed corrections return validation errors instead of server failures', async () => {
    const { call } = setup();
    const created = await call('post /data-input/conversations', { requestId: 'r1' });
    for (const changes of [null, [], { expectedRevision: '0' }, { expectedRevision: 0, upserts: {} }, { expectedRevision: 0, preview: true }]) {
        const result = await call('patch /data-input/conversations/:draftId', { messageId: 'm1', text: 'Add Lan', changes }, { draftId: created.data.draftId });
        assert.equal(result.status, 400);
    }
});
