'use strict';
// Coordinator-owned nonpaid fixture. Real current apiApp, authorization and domain
// services; only model output/usage and microphone provenance are engineering fixtures.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const admin = require('firebase-admin');
const h = require('./phase9-test-helpers');
const { createRelayServer } = require('../../../services/crm-voice-relay/server');
const { serveShell, login, selectProject } = require('../../browser/crm-projects/phase9-gemini-relay-browser-check');
const ROOT = path.resolve(__dirname, '../../..');

async function bootCombinedJourney(runId) {
    assert.match(runId, /^[a-z0-9-]{8,48}$/);
    h.assertDedicatedEmulators();
    assert.equal(process.env.CRM_ACCEPTANCE_NONPAID, '1');
    assert.notEqual(process.env.CRM_NATIVE_PAID_TEST, 'true');
    const f = await h.boot(`connected-${runId}`), drivers = [], diagnostics = [];
    let relay, ownedDefault, originalRouter, routerPath;
    const originalClose = f.close;
    try {
        // apiApp uses the default Firebase app. This app has the same dedicated
        // emulator project as the real Auth/Firestore fixture, never production.
        assert.equal(f.suite.app.options.projectId, 'demo-crm-projects');
        assert.ok(!admin.apps.some(app => app.name === '[DEFAULT]'), 'Fresh process must own its default Firebase app');
        ownedDefault = admin.initializeApp({ ...f.suite.app.options, storageBucket: 'demo-crm-projects.appspot.com' });
        const providerFactory = async ({ scope, sendPermit, onMessage, onError }) => {
            assert.equal(sendPermit.engineeringOnly, true);
            const driver = { scope, reservationId: sendPermit.reservationId, chunks: [], emit: onMessage, disconnect: onError };
            drivers.push(driver);
            return {
                async sendAudio({ bytes, sampleRate, utteranceId }) {
                    assert.equal(sampleRate, 16000); assert.ok(bytes.length >= 640 && bytes.length <= 3200);
                    driver.chunks.push(Buffer.from(bytes)); driver.utteranceId = utteranceId;
                }, close() {}, interrupt() {}, updateContext() {}
            };
        };
        providerFactory.engineeringOnly = true;
        relay = createRelayServer({ sessionService: f.sessionService, ledger: f.ledger,
            authenticate: token => f.suite.auth.verifyIdToken(token, true), allowedOrigins: [f.baseUrl],
            engineeringMode: true, providerFactory, onDiagnostic: value => diagnostics.push(value),
            features: { projects: { engineeringOnly: true, model: 'engineering-projects', provider: 'engineering-projects-provider',
                admission: () => ({ model: 'engineering-projects', purpose: 'planning', context: { projectId: f.c.projectId },
                    boundsVersion: 'phase9-engineering-bounds', request: { inputTokens: '0', outputTokens: '1', maxRequests: 1 } }) } } });
        f.setRelayUrl(f.baseUrl);
        routerPath = require.resolve('../../../functions/src/routes/crm/projects');
        originalRouter = require(routerPath);
        require.cache[routerPath].exports = deps => originalRouter({ ...deps,
            // Keep apiApp's current HTTP/auth/middleware composition while
            // supplying a dedicated h.boot service assembly: real emulator-
            // backed Auth/Firestore, access, command, recovery, draft,
            // budget, proposal and clock constructors. No authorization
            // function, response, or domain command is stubbed; model output,
            // usage evidence and relay speech remain engineering fixtures.
            db: f.suite.db,
            auth: f.suite.auth,
            accessService: f.suite.accessService,
            commandService: f.suite.commandService,
            recoveryService: f.deps.recoveryService,
            draftService: f.deps.draftService,
            budgetService: f.deps.budgetService,
            proposalService: f.proposalService,
            now: f.deps.now,
            projectsVoiceEngineeringMode: true,
            projectsGenerationMapping: f.deps.projectsGenerationMapping,
            projectsGenerationTransport: f.deps.projectsGenerationTransport,
            get projectsVoiceRelayUrl() { return f.deps.projectsVoiceRelayUrl; } });
        const apiPath = require.resolve('../../../functions/src/apiApp');
        assert.equal(require.cache[apiPath], undefined, 'apiApp must load after explicit fixture composition');
        const api = require(apiPath);
        require.cache[routerPath].exports = originalRouter;
        const app = express();
        // Existing shell helper only provides emulator config/login, current HTML
        // and static assets. API mounting is the actual combined apiApp.
        const mount = { expressApp: app, baseUrl: f.baseUrl };
        serveShell(mount);
        app.use(api);
        f.server.removeAllListeners('request');
        f.server.on('request', (req, res) => ['/prepare', '/status'].includes(new URL(req.url, f.baseUrl).pathname)
            ? relay.server.emit('request', req, res) : app(req, res));
        f.server.on('upgrade', (req, socket, head) => relay.server.emit('upgrade', req, socket, head));
        f.api = async (suffix, role = 'owner', method = 'GET', body) => {
            const token = role === null ? null : await f.suite.token(role);
            return method === 'GET' ? h.request(f.server, `/api/projects${suffix}`, token)
                : h.jsonRequest(f.server, `/api/projects${suffix}`, token, method, body);
        };
        f.drivers = drivers; f.diagnostics = diagnostics;
        f.close = async () => {
            try { await relay?.close(); } finally {
                try { await originalClose(); } finally { await ownedDefault?.delete(); }
            }
        };
        return f;
    } catch (error) {
        if (routerPath && originalRouter) require.cache[routerPath].exports = originalRouter;
        try { await relay?.close(); } finally { try { await originalClose(); } finally { await ownedDefault?.delete(); } }
        throw error;
    }
}
function writeMicrophone(file) {
    const pcm = Buffer.alloc(64000);
    for (let n = 0; n < pcm.length / 2; n++) pcm.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * n / 16000)), n * 2);
    const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(file, Buffer.concat([header, pcm]), { flag: 'wx' });
}
module.exports = { ...h, ROOT, bootCombinedJourney, writeMicrophone, login, selectProject };
