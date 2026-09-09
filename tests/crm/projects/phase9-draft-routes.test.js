'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const draftModule = require('../../../functions/src/crm/projects/voice/draft-service');
const realFactory = draftModule.createProjectsDraftService;
const constructions = [];
// Observe constructor wiring while retaining the actual domain service.
draftModule.createProjectsDraftService = options => { constructions.push(options); return realFactory(options); };
const createRouter = require('../../../functions/src/routes/crm/projects');
draftModule.createProjectsDraftService = realFactory;
function dependencies(overrides = {}) {
    const identity = Object.freeze({ uid: 'authenticated_staff', role: 'staff' });
    const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { throw Error('Unexpected database access'); } };
    const accessService = { assertTransactionEligible() { throw Error('Unexpected eligibility I/O'); }, assertTransactionContentAccess() { throw Error('Unexpected content I/O'); }, async authenticateRequest(req) { if (req.headers.authorization !== 'Bearer valid') throw Object.assign(Error('Authentication required'), { status: 401, code: 'AUTH_REQUIRED' }); return identity; } };
    const commandService = { runCommand() { throw Error('Unexpected command'); } };
    const recoveryService = { prepareFieldBatch() {}, prepareMoveBatch() {} };
    return { db, accessService, commandService, recoveryService, queryService: {}, discussionService: {}, attachmentService: {}, automationService: {}, notificationService: {}, budgetService: {}, identity, ...overrides };
}
async function withApp(deps, run) {
    const prior = process.env.CRM_PROJECTS_ENABLED; process.env.CRM_PROJECTS_ENABLED = 'true';
    const app = express(); app.use(express.json()); app.use('/api/projects', createRouter(deps));
    const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    async function request(path, { method = 'GET', body, token = 'valid' } = {}) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const text = await response.text(); let parsed; try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
        return { status: response.status, body: parsed };
    }
    try { await run(request); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (prior === undefined) delete process.env.CRM_PROJECTS_ENABLED; else process.env.CRM_PROJECTS_ENABLED = prior; }
}
test('five draft endpoints delegate authenticated identity, path ID and body through normal success contract', async () => {
    const calls = []; const draftService = {};
    for (const method of ['read', 'correct', 'decline', 'preview', 'apply']) draftService[method] = (...args) => { calls.push({ method, args }); return { draftId: args[1], delegated: method }; };
    const deps = dependencies({ draftService });
    await withApp(deps, async request => {
        const read = await request('/ai/drafts/draft_one'); assert.equal(read.status, 200); assert.equal(read.body.success, true); assert.equal(read.body.delegated, 'read');
        for (const method of ['correct', 'decline', 'preview', 'apply']) {
            const body = { requestId: `request_${method}`, actorUid: 'forged_actor' };
            const response = await request(`/ai/drafts/draft_one/${method}`, { method: 'POST', body }); assert.equal(response.status, 200); assert.equal(response.body.delegated, method);
            assert.deepEqual(calls.at(-1).args, [deps.identity, 'draft_one', body]); assert.equal(calls.at(-1).args[0], deps.identity);
        }
        assert.deepEqual(calls[0].args, [deps.identity, 'draft_one']);
        for (const path of ['/ai/drafts', '/ai/drafts/draft_one/createFromProposal', '/ai/drafts/draft_one/propose']) assert.equal((await request(path, { method: 'POST', body: { actions: [] } })).status, 404);
    });
});
test('every draft endpoint rejects query parameters and preserves feature/authentication middleware', async () => {
    let calls = 0; const draftService = Object.fromEntries(['read', 'correct', 'decline', 'preview', 'apply'].map(method => [method, () => { calls += 1; return {}; }]));
    await withApp(dependencies({ draftService }), async request => {
        for (const method of ['read', 'correct', 'decline', 'preview', 'apply']) {
            const path = `/ai/drafts/draft_one${method === 'read' ? '' : `/${method}`}`; const options = method === 'read' ? {} : { method: 'POST', body: {} };
            assert.equal((await request(`${path}?actorUid=forged`, options)).status, 400);
            assert.equal((await request(path, { ...options, token: '' })).status, 401);
            process.env.CRM_PROJECTS_ENABLED = 'false'; assert.equal((await request(path, options)).status, 404); process.env.CRM_PROJECTS_ENABLED = 'true';
        }
        assert.equal(calls, 0);
    });
});
test('actual draft service rejects raw apply actions, client actor overrides and unsupported bodies before domain I/O', async () => {
    await withApp(dependencies(), async request => {
        for (const body of [{ actions: [{ kind: 'field_update', taskId: 'a', patch: { title: 'forged' } }] }, { previewId: 'preview', attestationId: 'proof', actorUid: 'forged' }, { previewId: 'preview', attestationId: 'proof', engineeringMode: true }]) {
            const response = await request('/ai/drafts/draft_one/apply', { method: 'POST', body }); assert.equal(response.status, 400);
        }
        for (const method of ['correct', 'decline', 'preview']) assert.equal((await request(`/ai/drafts/draft_one/${method}`, { method: 'POST', body: { actions: [] } })).status, 400);
    });
});
test('production constructor defaults engineering off; only explicit server true enables fixtures and Date clock becomes milliseconds', () => {
    const now = new Date('2026-09-08T12:34:56Z');
    for (const setting of [undefined, false, 'true', 1, true]) {
        const deps = dependencies({ now: () => now, ...(setting === undefined ? {} : { projectsVoiceEngineeringMode: setting }) }); createRouter(deps);
        const options = constructions.at(-1);
        assert.equal(options.engineeringMode, setting === true); assert.equal(options.now(), now.getTime());
        assert.equal(options.db, deps.db); assert.equal(options.accessService, deps.accessService); assert.equal(options.commandService, deps.commandService); assert.equal(options.recoveryService, deps.recoveryService);
    }
    const count = constructions.length; createRouter(dependencies({ draftService: {} })); assert.equal(constructions.length, count);
});
