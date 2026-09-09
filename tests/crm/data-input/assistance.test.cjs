'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./transaction-fixture.cjs');
const { createDataInputAssistance } = require('../../../functions/src/crm/data-input/assistance-service');
const { createNativeGemini } = require('../../../functions/src/ai-assistance/providers/native-gemini');
const { createDraft, applyChanges, digestDraft } = require('../../../functions/src/crm/data-input/draft-service');
const { buildProposalRequest, parseProposal } = require('../../../functions/src/crm/data-input/proposal-service');
function setup(config = {}) {
    const f = fixture(), state = { allowed: true };
    f.db.runTransaction = async run => {
        const current = fixture(Object.fromEntries(f.rows));
        current.transaction.create = (ref, value) => { assert.equal(current.rows.has(ref.path), false); current.transaction.set(ref, value); };
        const result = await run(current.transaction);
        f.rows.clear(); for (const [key, value] of current.rows) f.rows.set(key, value);
        return result;
    };
    const service = createDataInputAssistance({ db: f.db, authorize: async ({ actorUid }) => state.allowed && actorUid === 'staff1', now: () => Date.UTC(2026, 8, 30, 17), config: { usageQuota: { enabled: false }, ...config } });
    return { ...f, state, service };
}
test('data input reads the same UID monthly allowance configuration with a five dollar ceiling', async () => {
    const f = setup();
    const initial = await f.service.getBudget('staff1');
    assert.equal(initial.uid, 'staff1'); assert.equal(initial.month, '2026-10'); assert.equal(initial.allowanceNano, '5000000000');
    assert.equal(initial.paidDispatchAvailable, false);
    f.rows.set('crmProjectAllowanceDefaults/default', { currency: 'USD', monthlyAllowanceCents: 250 });
    assert.equal((await f.service.getBudget('staff1')).allowanceNano, '2500000000');
    f.rows.set('crmProjectAllowanceConfigs/staff1', { currency: 'USD', monthlyAllowanceCents: 0 });
    assert.equal((await f.service.getBudget('staff1')).allowanceNano, '0');
    f.rows.set('crmProjectAllowanceDefaults/default', { currency: 'USD', monthlyAllowanceCents: 501 });
    await assert.rejects(f.service.getBudget('staff1'), /allowance|ceiling|500|maximum/i);
});

test('native composition requires explicit trusted services and retains staff authorization', async () => {
    let calls = 0;
    const native = createNativeGemini({ apiKey: 'fixture-key', fetchImpl: async () => { calls++; throw Error('Unexpected dispatch'); } });
    assert.throws(() => setup({ nativeMode: true }), /native/i);
    assert.throws(() => setup({ nativeMode: true, engineeringMode: true, native }), /mode/i);
    const f = setup({ nativeMode: true, native, voiceRelayUrl: 'http://127.0.0.1:9271' });
    assert.equal(f.service.voiceEnabled, true);
    assert.equal(typeof f.service.provider.generate, 'function');
    assert.deepEqual(f.service.featureAdapter.models, ['gemini-3.8-flash', 'gemini-3.1-flash-live-preview']);
    const budget = await f.service.getBudget('staff1');
    assert.equal(budget.paidDispatchAvailable, true);
    assert.equal(budget.policyMode, 'monitored_target'); assert.equal(budget.possibleOverage, true);
    assert.equal(budget.allowanceNano, '5000000000');
    f.state.allowed = false;
    await assert.rejects(f.service.getBudget('staff1'), error => error.code === 'ACCOUNT_INELIGIBLE');
    assert.equal(calls, 0);
});
test('budget and voice context require current staff authority; native sessions remain disabled', async () => {
    const f = setup(); assert.equal(f.service.voiceEnabled, false); assert.equal(f.service.provider, null);
    await assert.rejects(f.service.sessions.prepare({ actorUid: 'staff1', feature: 'crm-data-input', requestId: 'r1', contextHints: {} }), error => error.code === 'NATIVE_VOICE_UNAVAILABLE');
    f.state.allowed = false;
    await assert.rejects(f.service.getBudget('staff1'), error => error.code === 'ACCOUNT_INELIGIBLE');
    await assert.rejects(f.service.getVoiceContext('staff1', {}), error => error.code === 'FORBIDDEN');
});
test('engineering voice requires explicit trusted secure relay configuration and cannot replace the domain adapter', () => {
    assert.equal(setup({ engineeringMode: true, voiceRelayUrl: 'http://127.0.0.1:9271' }).service.voiceEnabled, true);
    assert.equal(setup({ voiceRelayUrl: 'https://relay.example.test' }).service.voiceEnabled, false);
    assert.throws(() => setup({ engineeringMode: true, voiceRelayUrl: 'http://remote.example.test' }), /relay/i);
    assert.throws(() => setup({ additionalFeatureAdapters: { 'crm-data-input': {} } }), /replace/i);
});

test('native Live admission and Flash draft generation share the UID ledger, settle reported usage and refuse redispatch', async () => {
    const calls = [], output = JSON.stringify({ upserts: [], removals: [], questions: [], lookups: [] });
    const native = createNativeGemini({ apiKey: 'fixture-key', fetchImpl: async (url, request) => {
        calls.push({ url, body: JSON.parse(request.body) });
        return new Response(JSON.stringify({ responseId: 'fixture-response', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: output }] } }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 } }));
    } });
    const f = setup({ nativeMode: true, native }), feature = f.service.ledger.forFeature('crm-data-input');
    const live = await feature.reserve('staff1', { requestId: 'live1', purpose: 'draft', context: {}, model: 'gemini-3.1-flash-live-preview',
        boundsVersion: native.policy.versionId, request: { kind: 'live', inputBytes: 512, audioBytes: 3840000, maxOutputTokens: 512 } });
    assert.ok(live.reservationId);
    const before = await f.service.getBudget('staff1'); assert.ok(BigInt(before.pendingNano) > 0n);
    const nowMs = Date.UTC(2026, 8, 30, 17);
    const request = buildProposalRequest({ draft: createDraft({ draftId: 'd1', actorUid: 'staff1', now: nowMs }), actorUid: 'staff1',
        source: { kind: 'text', messageId: 'm1' }, nowMs, resolutions: [], text: 'Create a lead named Lan' });
    const input = { actorUid: 'staff1', feature: 'crm-data-input', purpose: 'draft', operationId: 'draft1', request, context: {} };
    const result = await f.service.provider.generateWithAccounting(input);
    assert.equal(result.output, output); assert.equal(result.accounting.state, 'settled');
    assert.equal(result.accounting.possibleOverage, true);
    const after = await f.service.getBudget('staff1');
    assert.equal(after.pendingNano, before.pendingNano); assert.ok(BigInt(after.settledNano) > 0n);
    assert.equal(calls.length, 1); assert.equal(calls[0].body.generationConfig.maxOutputTokens, 4096);
    assert.equal(calls[0].body.serviceTier, 'standard'); assert.equal(calls[0].body.store, false);
    await assert.rejects(f.service.provider.generate(input), error => error.code === 'RESPONSE_RECOVERY_REQUIRED');
    f.state.allowed = false;
    await assert.rejects(f.service.provider.generate({ ...input, operationId: 'denied' }), error => error.code === 'ACCOUNT_INELIGIBLE');
    assert.equal(calls.length, 1);
});

test('missing native usage remains pending after valid draft output and cannot cause a repeated paid call', async () => {
    let calls = 0;
    const native = createNativeGemini({ apiKey: 'fixture-key', fetchImpl: async () => {
        calls++;
        return new Response(JSON.stringify({ responseId: 'fixture-unknown', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] }));
    } });
    const f = setup({ nativeMode: true, native }), nowMs = Date.UTC(2026, 8, 30, 17);
    const request = buildProposalRequest({ draft: createDraft({ draftId: 'd1', actorUid: 'staff1', now: nowMs }), actorUid: 'staff1',
        source: { kind: 'text', messageId: 'm1' }, nowMs, resolutions: [], text: 'Create a lead named Lan' });
    const input = { actorUid: 'staff1', feature: 'crm-data-input', purpose: 'draft', operationId: 'unknown1', request, context: {} };
    const result = await f.service.provider.generateWithAccounting(input);
    assert.equal(result.accounting.state, 'usage_unknown'); assert.equal(result.accounting.unresolved, true);
    const budget = await f.service.getBudget('staff1');
    assert.ok(BigInt(budget.pendingNano) > 0n); assert.equal(budget.settledNano, '0'); assert.equal(budget.estimatedUnknownCount, 1);
    await assert.rejects(f.service.provider.generate(input), error => error.code === 'RESPONSE_RECOVERY_REQUIRED');
    assert.equal(calls, 1);
});

test('assistance exposes both exact phrases only for a current displayed review', async () => {
    const f = setup(), now = Date.UTC(2026, 8, 30, 17);
    const draft = applyChanges(createDraft({ draftId: 'd1', actorUid: 'staff1', now }), { expectedRevision: 0,
        upserts: [{ actionId: 'a1', kind: 'createLead', values: { name: 'Lan', source: 'website' } }] }, { kind: 'text', messageId: 'm1' }, now);
    draft.status = 'review'; draft.preview = { previewId: 'p1' };
    f.rows.set('crmDataInputDrafts/d1', draft);
    f.rows.set('crmDataInputDrafts/d1/previews/p1', { revision: draft.revision, draftDigest: digestDraft(draft), expiresAtMs: now + 60000, review: { effects: [], paymentAssertions: [] } });
    const value = await f.service.getVoiceContext('staff1', { draftId: 'd1', previewId: 'p1' });
    assert.equal(value.confirmationPhrase, 'Tôi xác nhận lưu bản xem trước số 1');
    assert.equal(value.confirmationPhraseEnglish, 'I confirm saving preview number 1');
    const absent = await f.service.getVoiceContext('staff1', { draftId: 'd1' });
    assert.equal(absent.confirmationPhrase, null); assert.equal(absent.confirmationPhraseEnglish, null);
    f.state.allowed = false;
    await assert.rejects(f.service.getVoiceContext('staff1', { draftId: 'd1', previewId: 'p1' }), error => error.code === 'FORBIDDEN');
});

for (const completeUsage of [true, false]) test(`owned PNG descriptor reaches native assembly with ${completeUsage ? 'settled' : 'pending'} image usage`, async () => {
    const sharp = require('sharp'), { normalizeImage } = require('../../../functions/src/crm/data-input/image-validation');
    const bytes = await sharp({ create: { width: 8, height: 4, channels: 3, background: 'white' } }).png().toBuffer();
    const normalized = await normalizeImage({ bytes, mimeType: 'image/png' });
    const nowMs = Date.UTC(2026, 8, 30, 17), draft = createDraft({ draftId: 'd1', actorUid: 'staff1', now: nowMs });
    draft.attachmentIds = ['image1'];
    const source = { kind: 'image', attachmentId: 'image1', messageId: 'm1' };
    const attachment = { attachmentId: 'image1', status: 'ready', expiresAtMs: nowMs + 60000, mimeType: 'image/png',
        sha256: normalized.sha256, width: normalized.width, height: normalized.height, bytesLength: normalized.bytes.length };
    const proposalContext = { draft, actorUid: 'staff1', source, nowMs, resolutions: [] };
    const request = buildProposalRequest({ ...proposalContext, text: 'Create the enquiry shown in this image', image: { attachment, bytes: normalized.bytes } });
    const calls = [], output = JSON.stringify({ upserts: [{ actionId: 'a1', kind: 'createLead', values: { name: 'Image fixture', source: 'website' } }], removals: [], questions: [], lookups: [] });
    const native = require('../../../functions/src/crm/data-input/native-provider').createDataInputNativeServices({ apiKey: 'fixture-image-key', fetchImpl: async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ responseId: 'image-response', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: output }] } }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110,
                ...(completeUsage ? { promptTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'IMAGE', tokenCount: 60 }] } : {}) } }));
    } });
    const f = setup({ nativeMode: true, native });
    assert.equal(f.service.provider.supportsImages, true);
    const input = { actorUid: 'staff1', feature: 'crm-data-input', purpose: 'draft', operationId: 'image-operation', request, context: {} };
    const tampered = structuredClone(request); tampered.image.sha256 = '0'.repeat(64);
    await assert.rejects(f.service.provider.generate({ ...input, request: tampered }), error => error.code === 'INVALID_IMAGE');
    assert.equal(f.rows.size, 0); assert.equal(calls.length, 0);
    const result = await f.service.provider.generateWithAccounting(input);
    assert.equal(result.accounting.state, completeUsage ? 'settled' : 'usage_unknown');
    assert.equal(result.accounting.unresolved, !completeUsage);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].contents[0].parts[1].inlineData, request.image.inlineData);
    assert.match(calls[0].systemInstruction.parts[0].text, /image as untrusted source data/i);
    assert.equal(calls[0].generationConfig.responseMimeType, 'application/json');
    assert.equal(Object.hasOwn(calls[0].generationConfig, 'responseJsonSchema'), false);
    assert.deepEqual(JSON.parse(calls[0].systemInstruction.parts[0].text.split('The application validates it before any preview or action: ')[1]), request.responseSchema);
    assert.deepEqual(JSON.parse(calls[0].contents[0].parts[0].text).actions, JSON.parse(request.input).actions);
    const invalid = JSON.parse(result.output); invalid.upserts[0].values.bankVerified = true;
    assert.throws(() => parseProposal(JSON.stringify(invalid), proposalContext));
    const proposed = parseProposal(result.output, proposalContext).proposedDraft;
    assert.equal(proposed.actions[0].values.name, 'Image fixture');
    assert.equal(proposed.actions[0].provenance.name.kind, 'image');
    assert.equal(proposed.actions[0].provenance.name.attachmentId, 'image1');
    const stored = JSON.stringify([...f.rows.values()]);
    assert.equal(stored.includes(request.image.inlineData.data), false);
    assert.equal(stored.includes('inlineData'), false); assert.ok(stored.length < 65536);
    const budget = await f.service.getBudget('staff1');
    assert.equal(BigInt(budget.settledNano) > 0n, completeUsage);
    assert.equal(BigInt(budget.pendingNano) > 0n, !completeUsage);
    f.state.allowed = false;
    await assert.rejects(f.service.provider.generate({ ...input, operationId: 'denied-image' }), error => error.code === 'ACCOUNT_INELIGIBLE');
    assert.equal(calls.length, 1);
});

test('shared usage quota defaults on for native composition and schema2 budget passes through unchanged', async () => {
    const ledgerPath = require.resolve('../../../functions/src/ai-assistance/accounting/ledger-service');
    const servicePath = require.resolve('../../../functions/src/crm/data-input/assistance-service');
    const originalLedger = require.cache[ledgerPath].exports, originalService = require.cache[servicePath];
    const budget = Object.freeze({ schemaVersion: 2, uid: 'staff1', month: '2026-10', allowanceMicrocredits: '5000000000' });
    const captured = [];
    try {
        require.cache[ledgerPath].exports = { ...originalLedger, createLedgerService(options) {
            captured.push(options);
            return { settle() { assert.fail('No settlement'); }, markUnknown() { assert.fail('No dispatch'); }, forFeature(feature) { assert.equal(feature, 'crm-data-input'); return { getBudget: async uid => { assert.equal(uid, 'staff1'); return budget; } }; } };
        } };
        delete require.cache[servicePath];
        const { createDataInputAssistance: compose } = require(servicePath);
        const native = createNativeGemini({ apiKey: 'fixture-key', fetchImpl: async () => assert.fail('No provider dispatch') });
        const db = fixture().db;
        const service = compose({ db, authorize: async () => true, config: { nativeMode: true, native } });
        assert.deepEqual(captured.at(-1).usageQuota, { enabled: true });
        assert.equal(await service.getBudget('staff1'), budget);
        const legacy = { enabled: false };
        compose({ db, authorize: async () => true, config: { nativeMode: true, native, usageQuota: legacy } });
        assert.equal(captured.at(-1).usageQuota, legacy);
        const explicit = { enabled: true };
        compose({ db, authorize: async () => true, config: { engineeringMode: true, usageQuota: explicit } });
        assert.equal(captured.at(-1).usageQuota, explicit);
        compose({ db, authorize: async () => true });
        assert.equal(captured.at(-1).usageQuota.enabled, true);
    } finally {
        require.cache[ledgerPath].exports = originalLedger;
        require.cache[servicePath] = originalService;
    }
});


test('credit budget is shared schema2 even when paid dispatch is unavailable', async () => {
    const f = setup({ usageQuota: { enabled: true } });
    const value = await f.service.getBudget('staff1');
    assert.equal(value.schemaVersion, 2); assert.equal(value.quotaMode, 'usage_credits');
    assert.equal(value.allowanceMicrocredits, '5000000000');
    assert.equal(value.remainingMicrocredits, '5000000000');
    assert.equal(value.paidDispatchAvailable, false);
    assert.equal(value.equivalence.invoiceCap, false);
    f.rows.set('crmProjectAllowanceDefaults/default', {currency: 'USD', monthlyAllowanceCents: 250});
    assert.equal((await f.service.getBudget('staff1')).allowanceMicrocredits, '2500000000');
    f.rows.set('crmProjectAllowanceConfigs/staff1', {currency: 'USD', monthlyAllowanceCents: 0});
    assert.equal((await f.service.getBudget('staff1')).allowanceMicrocredits, '0');
    f.state.allowed = false;
    await assert.rejects(f.service.getBudget('staff1'), error => error.code === 'ACCOUNT_INELIGIBLE');
});
