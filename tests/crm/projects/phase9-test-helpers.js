'use strict';
// Authoring fixture only: callers must enter the dedicated demo emulator runner.
// Every model result and usage record below is explicitly engineering evidence.
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const h = require('./phase6-test-helpers');
const { resetBudget } = require('./phase8-test-helpers');
const { createProjectsBudgetService } = require('../../../functions/src/crm/projects/budget-service');
const { createProjectsRecoveryService } = require('../../../functions/src/crm/projects/recovery-service');
const { createTaskLinksService } = require('../../../functions/src/crm/projects/task-links-service');
const { createProjectsDraftService } = require('../../../functions/src/crm/projects/voice/draft-service');
const { createProjectsProposalService } = require('../../../functions/src/crm/projects/voice/proposal-service');
const { createVoiceSessionService } = require('../../../functions/src/ai-assistance/voice/session-service');
const { createAccountedGenerationProvider } = require('../../../functions/src/ai-assistance/providers/accounted-generation');
const { reject } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
const { validateBoundedRequest } = require('../../../functions/src/ai-assistance/accounting/provider-accounting');
const createRouter = require('../../../functions/src/routes/crm/projects');
async function boot(name = 'phase9-context-api') {
    const suite = await h.bootSuite(); let server;
    try {
        const c = await h.project(suite, name);
        for (const taskId of ['one', 'two', 'three', 'parent']) await c.task(taskId);
        await resetBudget(suite, c.uids.owner);
        const now = () => new Date(); const trusted = new WeakSet(); let evidenceSequence = 0;
        const evidence = (reservationId, quantities = {}) => { const value = { evidenceId: `${reservationId}-${++evidenceSequence}`, providerRequestId: reservationId, complete: true, quantities: { inputBytes: '0', outputBytes: '0', inputText: '0', outputText: '0', ...quantities } }; trusted.add(value); return value; };
        const budgetService = createProjectsBudgetService({ db: suite.db, accessService: suite.accessService, now, engineeringMode: true, engineeringModels: ['engineering-projects'],
            pricingRegistry: [{ versionId: 'phase9-engineering-price', provider: 'engineering-projects-provider', model: 'engineering-projects', serviceTier: 'standard', effectiveAt: '2026-01-01T00:00:00Z', expiresAt: '2028-01-01T00:00:00Z', ratesNano: { inputBytes: '1', outputBytes: '1', inputText: '0', outputText: '1000000' } }],
            boundsRegistry: { 'phase9-engineering-bounds': { proven: true, engineeringOnly: true, models: ['engineering-projects'], deriveMaximum({ request }) {
                if (request.descriptor) { const bytes = Buffer.byteLength(JSON.stringify(request.descriptor)); assert.equal(bytes, request.inputBytes); assert.equal(request.maxRequests, 1); assert.equal(request.maxOutputBytes, 65536); return { inputBytes: String(bytes), outputBytes: String(request.maxOutputBytes), inputText: '0', outputText: '0' }; }
                const value = validateBoundedRequest(request); return { inputBytes: '0', outputBytes: '0', inputText: value.inputTokens, outputText: (BigInt(value.outputTokens) * BigInt(value.maxRequests)).toString() };
            } } },
            providerAdapters: { 'engineering-projects-provider': { engineeringOnly: true, normalizeEvidence({ evidence: value }) { if (!trusted.has(value)) reject('UNTRUSTED_EVIDENCE', 'Explicit engineering evidence required.', 403); return value; } } }
        });
        const ledger = budgetService.ledger;
        const recoveryService = createProjectsRecoveryService({ db: suite.db, accessService: suite.accessService, commandService: suite.commandService, now });
        const taskLinksService = createTaskLinksService({ db: suite.db, accessService: suite.accessService, commandService: suite.commandService, now, authorizeCrmIdentity: ({ identity }) => identity.profile?.isAdmin === true });
        const draftService = createProjectsDraftService({ db: suite.db, accessService: suite.accessService, commandService: suite.commandService, recoveryService, taskLinksService, now: Date.now, engineeringMode: true });
        const sessionService = createVoiceSessionService({ db: suite.db, runTransaction: work => suite.db.runTransaction(work), now: Date.now, featureAdapters: { projects: draftService.voiceAdapter }, engineeringMode: true });
        let output = { kind: 'planning', text: 'Engineering fixture plan.' }; const generationCalls = [];
        const mapping = { sourceModel: 'gemini-3.8-flash', model: 'engineering-projects', boundsVersion: 'phase9-engineering-bounds', maxOutputBytes: 65536 };
        const transport = async ({ permit, request }) => {
            generationCalls.push({ permit, request });
            const result = typeof output === 'function' ? await output(request.descriptor, permit) : output;
            const text = typeof result === 'string' ? result : JSON.stringify(result);
            return { output: text, evidence: evidence(permit.reservationId, { inputBytes: String(request.inputBytes), outputBytes: String(Buffer.byteLength(text)) }) };
        };
        const provider = createAccountedGenerationProvider({ ledger, engineeringMode: true, engineeringMapping: mapping, transport });
        const proposalService = createProjectsProposalService({ db: suite.db, accessService: suite.accessService, draftService, provider, now: Date.now });
        let relayUrl = null;
        const deps = { db: suite.db, auth: suite.auth, accessService: suite.accessService, commandService: suite.commandService, recoveryService, draftService, budgetService, now, projectsVoiceEngineeringMode: true, projectsGenerationMapping: mapping, projectsGenerationTransport: transport, get projectsVoiceRelayUrl() { return relayUrl; } };
        const expressApp = express(); expressApp.use(express.json({ limit: '1mb' })); expressApp.use('/api/projects', createRouter(deps));
        server = http.createServer(expressApp); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const api = async (path, role = 'owner', method = 'GET', payload) => { const token = role === null ? null : await suite.token(role); return method === 'GET' ? h.request(server, `/api/projects${path}`, token) : h.jsonRequest(server, `/api/projects${path}`, token, method, payload); };
        return { suite, c, api, baseUrl, server, expressApp, draftService, sessionService, budgetService, ledger, proposalService, mapping, transport, deps, evidence, generationCalls,
            setOutput(value) { output = value; }, setRelayUrl(value) { relayUrl = value; },
            async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await suite.close(); }
        };
    } catch (error) { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await suite.close(); throw error; }
}
module.exports = { ...h, boot };
