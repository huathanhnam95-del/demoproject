'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeGemini, POLICY_VERSION } = require('../../../functions/src/ai-assistance/providers/native-gemini');
const { createAccountedGenerationProvider } = require('../../../functions/src/ai-assistance/providers/accounted-generation');
const { createNativeVoiceProvider, createLiveUsageDescriptor } = require('../../../services/crm-voice-relay/native-provider');
const { emptyCounters, assertWithinBounds, usageEvidence } = require('../../../functions/src/ai-assistance/accounting/usage-meter');
const { deriveUsageReservation, validateUsageEvidence } = require('../../../functions/src/ai-assistance/accounting/usage-credit-policy');
const { digest } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
const scope = { actorUid: 'staff', feature: 'projects', sessionId: 'session', epoch: 1 };
const context = { context: { project: { id: 'project' } }, summary: 'Untrusted current screen' };
function pcm(samples, value = 1000) { const data = Buffer.alloc(samples * 2); for (let i = 0; i < samples; i++) data.writeInt16LE(value, i * 2); return data; }
function fixture({ output = '{"transcript":"Xin chào"}', quotaPatch = {}, failed = false, generationFormat = 'schema' } = {}) {
    const records = [], requests = [], reservations = [], unknown = [], rows = new Map();
    const native = createNativeGemini({ apiKey: 'fixture-key', generationFormat, fetchImpl: async (_url, options) => {
        requests.push(JSON.parse(options.body)); if (failed) throw Error('fixture transport failure');
        return new Response(JSON.stringify({ responseId: 'response', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: output }] } }] }), { status: 200 });
    } });
    const ledger = {
        forFeature() { return {
            async reserve(_uid, value) {
                reservations.push(value); const stage = value.request.kind === 'live' ? 'live' : value.request.kind === 'transcription' ? 'asr' : 'generation';
                const policy = deriveUsageReservation({ model: stage === 'live' ? 'gemini-3.1-flash-live-preview' : 'gemini-3.8-flash', request: value.request, at: '2026-09-09T00:00:00Z' });
                const row = { reservationId: `r${reservations.length}`, quota: { ...policy, bounds: { ...policy.bounds, ...quotaPatch } } }; rows.set(row.reservationId, row); return row;
            },
            async authorizeDispatch(_uid, id) { const row = rows.get(id); return { ...row, sendPermit: { reservationId: id, token: `token-${id}`, provider: 'gemini', engineeringOnly: false, model: row.quota.stage === 'live' ? 'gemini-3.1-flash-live-preview' : 'gemini-3.8-flash', quota: row.quota } }; }
        }; },
        async settle(id) { return { ...rows.get(id), state: 'usage_unknown', boundsViolated: false }; },
        async markUnknown(id) { unknown.push(id); },
        async recordUsage(id, evidence) { validateUsageEvidence(evidence); assertWithinBounds(evidence.counters, rows.get(id).quota.bounds); records.push({ id, evidence }); return { ...rows.get(id), state: 'usage_unknown', quota: { ...rows.get(id).quota, finalized: true } }; }
    };
    return { native, ledger, requests, reservations, records, unknown };
}
async function live(f, connectorPatch = {}) {
    let sends = 0, connects = 0;
    const descriptor = createLiveUsageDescriptor({ scope, context });
    const reservation = await f.ledger.forFeature(scope.feature).reserve('staff', { requestId: 'live-source', purpose: 'planning', context: { projectId: 'project' }, model: 'gemini-3.1-flash-live-preview', boundsVersion: POLICY_VERSION, request: descriptor.request });
    const { sendPermit } = await f.ledger.forFeature(scope.feature).authorizeDispatch('staff', reservation.reservationId);
    const factory = createNativeVoiceProvider({ apiKey: 'fixture', native: f.native, ledger: f.ledger, connector: async options => { connects++; assert.equal(options.contextText, descriptor.contextText); return { sendAudio: async () => { sends++; }, endInput: async () => {}, close() {}, ...connectorPatch }; } });
    const provider = await factory({ scope, context, sendPermit });
    return { provider, sends: () => sends, connects: () => connects };
}
function generation(f, requestPatch = {}, feature = 'projects') {
    const descriptor = { model: 'gemini-3.8-flash', systemInstruction: 'Return a proposal.', input: 'Xin chào 🌏', responseSchema: { type: 'object' }, ...requestPatch };
    const bridge = createAccountedGenerationProvider({ ledger: f.ledger, nativeMode: true, nativeMapping: { sourceModel: 'gemini-3.8-flash', model: 'gemini-3.8-flash', boundsVersion: POLICY_VERSION, maxOutputTokens: 2048, maxOutputBytes: 65536 }, transport: f.native.generationTransport });
    return bridge.generateWithAccounting({ actorUid: 'staff', feature, purpose: feature === 'projects' ? 'planning' : 'draft', operationId: 'generation', context: feature === 'projects' ? { projectId: 'project' } : {}, request: { ...descriptor, requestDigest: digest(descriptor) } });
}
test('completed silent Live input has zero quota and does not run duplicate ASR', async () => {
    const f = fixture(), h = await live(f);
    try {
        await h.provider.sendAudio({ bytes: pcm(640, 0), sampleRate: 16000, utteranceId: 'u' }); await h.provider.endInput();
        assert.equal((await h.provider.processMessage({ serverContent: { turnComplete: true } })).turnComplete, true);
        assert.deepEqual(f.records[0].evidence.counters, emptyCounters()); assert.equal(f.requests.length, 0);
        assert.deepEqual(await h.provider.processMessage({ serverContent: { turnComplete: true } }), {}); assert.equal(f.records.length, 1);
    } finally { h.provider.close(); }
});
test('Live unique activity owns audio and transcripts; actual ASR measures only its separate processing', async () => {
    const f = fixture(), h = await live(f);
    try {
        await h.provider.sendAudio({ bytes: pcm(320), sampleRate: 16000, utteranceId: 'u' });
        await h.provider.processMessage({ serverContent: { inputTranscription: { text: 'duplicate display' }, outputTranscription: { text: 'duplicate audio text' }, modelTurn: { parts: [{ inlineData: { data: pcm(480).toString('base64') } }] } } });
        await h.provider.endInput(); const result = await h.provider.processMessage({ serverContent: { turnComplete: true } });
        assert.equal(result.userTranscription.final, true); assert.equal(result.userTranscription.text, 'Xin chào');
        assert.equal(f.records.length, 2); const [liveRecord, asrRecord] = f.records.map(row => row.evidence);
        assert.equal(liveRecord.counters.inputActiveSamples, 320); assert.equal(liveRecord.counters.outputActiveSamples, 480); assert.equal(liveRecord.counters.outputTextBytes, 0);
        assert.equal(asrRecord.stage, 'asr'); assert.equal(asrRecord.counters.inputActiveSamples, 0); assert.equal(asrRecord.counters.outputActiveSamples, 0); assert.equal(asrRecord.counters.outputTextBytes, 0); assert.equal(asrRecord.counters.processingTokens, 2048);
        const body = f.requests[0]; assert.equal(asrRecord.counters.inputTextBytes, Buffer.byteLength(body.systemInstruction.parts[0].text)); assert.ok(Buffer.byteLength(JSON.stringify(body)) > asrRecord.counters.inputTextBytes);
        assert.equal(f.requests.length, 1);
    } finally { h.provider.close(); }
});
test('activity threshold does not reject semantic speech observed by Live', async () => {
    const f = fixture(), h = await live(f);
    try {
        await h.provider.sendAudio({ bytes: pcm(320, 100), sampleRate: 16000, utteranceId: 'u' });
        await h.provider.processMessage({ serverContent: { inputTranscription: { text: 'Quiet words' } } }); await h.provider.endInput();
        const result = await h.provider.processMessage({ serverContent: { turnComplete: true } });
        assert.equal(result.userTranscription.final, true); assert.equal(f.requests.length, 1); assert.equal(f.records[0].evidence.counters.inputActiveSamples, 0);
        assert.equal(f.records[1].evidence.counters.processingTokens, 2048);
    } finally { h.provider.close(); }
});
test('Live input and output caps reject before forwarding, with no silent output clamp or final refund', async () => {
    const f = fixture({ quotaPatch: { inputActiveSamples: 320, outputActiveSamples: 480 } }), h = await live(f);
    try {
        await assert.rejects(h.provider.sendAudio({ bytes: pcm(321), sampleRate: 16000, utteranceId: 'u' }), /INPUT_AUDIO_LIMIT/); assert.equal(h.sends(), 0);
        await assert.rejects(h.provider.processMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm(481).toString('base64') } }] } } }), /OUTPUT_AUDIO_LIMIT/);
        await assert.rejects(h.provider.processMessage({ serverContent: { modelTurn: { parts: [{ text: 'é'.repeat(8001) }] } } }), /OUTPUT_TEXT_LIMIT/);
        assert.equal(f.records.length, 0);
    } finally { h.provider.close(); }
});
test('generation meters actual composed text and returns useful output despite missing invoice usage', async () => {
    for (const generationFormat of ['schema', 'json']) {
        const f = fixture({ output: '{"title":"Draft"}', generationFormat }); const result = await generation(f);
        assert.equal(result.accounting.state, 'usage_unknown'); assert.equal(result.accounting.quota.finalized, true); assert.equal(result.output, '{"title":"Draft"}');
        const body = f.requests[0], counters = f.records[0].evidence.counters;
        assert.equal(counters.inputTextBytes, Buffer.byteLength(body.systemInstruction.parts[0].text) + Buffer.byteLength(body.contents[0].parts[0].text));
        assert.equal(counters.outputTextBytes, Buffer.byteLength(result.output)); assert.equal(counters.processingTokens, 2048); assert.equal(counters.inputActiveSamples, 0);
    }
});
test('generation predispatch input bounds and returned output bounds cannot exceed reserved quota', async () => {
    const input = fixture({ quotaPatch: { inputTextBytes: 1 } }); await assert.rejects(generation(input), { code: 'PROVIDER_GENERATION_FAILED' }); assert.equal(input.requests.length, 0); assert.equal(input.records.length, 0);
    const output = fixture({ output: '{"title":"Too much"}', quotaPatch: { outputTextBytes: 4 } }); await assert.rejects(generation(output), { code: 'PROVIDER_GENERATION_FAILED' }); assert.equal(output.requests.length, 1); assert.equal(output.records.length, 0); assert.equal(output.unknown.length, 1);
    const failed = fixture({ failed: true }); await assert.rejects(generation(failed)); assert.equal(failed.records.length, 0); assert.equal(failed.unknown.length, 1);
});
test('ASR independent UTF8 output cap fails without creating a second audio debit', async () => {
    const f = fixture({ output: JSON.stringify({ transcript: 'é'.repeat(8001) }) });
    await assert.rejects(f.native.transcribe({ ledger: f.ledger, scope, context: { projectId: 'project' }, pcm: pcm(320) }), { code: 'INVALID_TRANSCRIPTION' }); assert.equal(f.records.length, 0);
});
test('Live descriptor is exact composed text and rejects oversized context before admission', () => {
    const value = createLiveUsageDescriptor({ scope, context }); assert.equal(value.request.inputBytes, Buffer.byteLength(value.contextText)); assert.equal(Object.hasOwn(value.request, 'contextText'), false);
    assert.throws(() => createLiveUsageDescriptor({ scope, context: { text: 'x'.repeat(32768) } }), { code: 'LIVE_CONTEXT_LIMIT' });
});
test('image tile policy measures units while canonical image bytes and base64 stay outside text', async () => {
    const data = Buffer.alloc(70000); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data); data.writeUInt32BE(13, 8); data.write('IHDR', 12); data.writeUInt32BE(1000, 16); data.writeUInt32BE(900, 20);
    const image = { attachmentId: 'owned-image', width: 1000, height: 900, bytesLength: data.length, sha256: require('node:crypto').createHash('sha256').update(data).digest('hex'), inlineData: { mimeType: 'image/png', data: data.toString('base64') } };
    const f = fixture({ output: '{"title":"Image draft"}' }); await generation(f, { image }, 'crm-data-input');
    const measured = f.records[0].evidence.counters, request = f.requests[0]; assert.equal(measured.imageUnits, 4);
    assert.equal(measured.inputTextBytes, Buffer.byteLength(request.systemInstruction.parts[0].text) + Buffer.byteLength(request.contents[0].parts[0].text));
    assert.ok(measured.inputTextBytes < 1000); assert.ok(Buffer.byteLength(JSON.stringify(request)) > 70000);
});
test('actual ledger sidecars finalize local generation independently of invoices and preserve dispatch idempotency', async () => {
    const core = require('./usage-quota-service.test').fixture();
    const { createLedgerService } = require('../../../functions/src/ai-assistance/accounting/ledger-service');
    const f = fixture({ output: '{"title":"Metered draft"}' });
    f.ledger = createLedgerService({ ...core.options, nativePolicy: f.native.policy, pricingRegistry: f.native.pricingRegistry, providerAdapters: { gemini: f.native.accountingAdapter } });
    const result = await generation(f); assert.equal(result.accounting.state, 'usage_unknown'); assert.equal(result.accounting.quota.state, 'finalized');
    const budget = await f.ledger.forFeature('projects').getBudget('staff');
    assert.ok(BigInt(budget.usedMicrocredits) > 0n); assert.equal(budget.reservedMicrocredits, '0'); assert.ok(BigInt(budget.providerAccounting.pendingNano) > 0n);
    await assert.rejects(generation(f), { code: 'RESPONSE_RECOVERY_REQUIRED' }); assert.equal(f.requests.length, 1);
    const after = await f.ledger.forFeature('projects').getBudget('staff'); assert.equal(after.usedMicrocredits, budget.usedMicrocredits);
});
test('actual ledger Live plus ASR finalize disjoint activity and processing while unknown invoices remain pending', async () => {
    const core = require('./usage-quota-service.test').fixture();
    const { createLedgerService } = require('../../../functions/src/ai-assistance/accounting/ledger-service');
    const f = fixture(); f.ledger = createLedgerService({ ...core.options, nativePolicy: f.native.policy, pricingRegistry: f.native.pricingRegistry, providerAdapters: { gemini: f.native.accountingAdapter } });
    const h = await live(f);
    try {
        await h.provider.sendAudio({ bytes: pcm(320), sampleRate: 16000, utteranceId: 'u' }); await h.provider.endInput();
        const result = await h.provider.processMessage({ serverContent: { turnComplete: true } }); assert.equal(result.userTranscription.final, true);
        const rows = [...core.records.values()].filter(row => row.source === 'local_usage'); assert.equal(rows.length, 2); assert.ok(rows.every(row => row.state === 'finalized'));
        assert.equal(rows.find(row => row.stage === 'live').counters.inputActiveSamples, 320);
        assert.deepEqual(rows.find(row => row.stage === 'asr').counters, { ...emptyCounters(), inputTextBytes: Buffer.byteLength(f.requests[0].systemInstruction.parts[0].text), processingTokens: 2048 });
        const budget = await f.ledger.forFeature('projects').getBudget('staff'); assert.equal(budget.reservedMicrocredits, '0'); assert.ok(BigInt(budget.usedMicrocredits) > 0n); assert.ok(BigInt(budget.providerAccounting.pendingNano) > 0n);
        const liveRow = rows.find(row => row.stage === 'live');
        const replay = await f.ledger.recordUsage(liveRow.reservationId, usageEvidence({ eventId: 'live-final', stage: 'live', counters: liveRow.counters })); assert.equal(replay.replayed, true);
        assert.equal((await f.ledger.forFeature('projects').getBudget('staff')).usedMicrocredits, budget.usedMicrocredits);
        const proposal = await generation(f, { input: result.userTranscription.text }); assert.equal(proposal.accounting.quota.state, 'finalized'); assert.equal(proposal.accounting.state, 'usage_unknown');
        const after = await f.ledger.forFeature('projects').getBudget('staff'); assert.ok(BigInt(after.remainingMicrocredits) < BigInt(budget.remainingMicrocredits)); assert.equal(after.reservedMicrocredits, '0'); assert.equal(f.requests.length, 2);
    } finally { h.provider.close(); }
});
test('Live composed context must fit exposed quota before creating a provider connection', async () => {
    const f = fixture({ quotaPatch: { inputTextBytes: 1 } }); let connected = false;
    const descriptor = createLiveUsageDescriptor({ scope, context });
    const reserved = await f.ledger.forFeature('projects').reserve('staff', { request: descriptor.request });
    const { sendPermit } = await f.ledger.forFeature('projects').authorizeDispatch('staff', reserved.reservationId);
    const factory = createNativeVoiceProvider({ apiKey: 'fixture', native: f.native, ledger: f.ledger, connector: async () => { connected = true; return {}; } });
    await assert.rejects(factory({ scope, context, sendPermit }), { code: 'USAGE_BOUND_EXCEEDED' }); assert.equal(connected, false); assert.equal(f.records.length, 0);
});
