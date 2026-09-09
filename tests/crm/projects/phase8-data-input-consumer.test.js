'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLedgerService } = require('../../../functions/src/ai-assistance/accounting/ledger-service');
const { createDataInputBudgetFeatureAdapter } = require('../../../functions/src/ai-assistance/adapters/data-input');
const { createAccountedGenerationProvider } = require('../../../functions/src/ai-assistance/providers/accounted-generation');
// Integration deliberately imports the actual separately owned consumer; missing
// checkout is a failure, not a skipped or copied-domain approximation.
const consumerRoot = path.resolve(process.env.CRM_DATA_INPUT_CHECKOUT || 'C:/Cursor AI-data-input-20260907');
const external = name => require(path.join(consumerRoot, 'functions/src/crm/data-input', name));
const { createInterpretationService } = external('interpretation-service');
const { createAdmission } = external('authorization');
const { createDraft } = external('draft-service');
const { buildProposalRequest } = external('proposal-service');
const OUTPUT = JSON.stringify({ upserts: [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan' } }], removals: [], questions: [], lookups: [] });
const START = { actorUid: 'staff1', draftId: 'draft1', messageId: 'message1', expectedRevision: 0, text: 'Create Lan' };
function fixture({ mode = 'ok', native = false } = {}) {
    const records = new Map(); const state = { calls: 0, now: Date.parse('2026-09-08T00:00:00Z'), disabled: false, revokeAtDispatch: false };
    const doc = p => ({ path: p, collection: name => collection(`${p}/${name}`) });
    const collection = p => ({ doc: id => doc(`${p}/${id}`) });
    let queue = Promise.resolve();
    const db = { collection, runTransaction(fn) {
        const result = queue.then(async () => {
            const pending = new Map(); let wrote = false;
            const tx = { async get(ref) { assert.equal(wrote, false, 'read before write'); return { exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) }; }, set(ref, value) { wrote = true; pending.set(ref.path, structuredClone(value)); }, create(ref, value) { assert.equal(records.has(ref.path), false); this.set(ref, value); } };
            const result = await fn(tx); for (const entry of pending) records.set(...entry); return result;
        }); queue = result.catch(() => {}); return result;
    } };
    records.set('users/staff1', { isAdmin: true });
    const draft = createDraft({ draftId: 'draft1', actorUid: 'staff1', now: state.now }); records.set('crmDataInputDrafts/draft1', draft);
    const authorize = createAdmission({ db, authClient: { getUser: async () => ({ disabled: state.disabled }) }, identity: { uid: 'staff1', auth_time: state.now / 1000 } });
    const adapter = createDataInputBudgetFeatureAdapter({ authorize, engineeringModels: ['engineering-text'] });
    const trusted = new WeakSet();
    const ledger = createLedgerService({ db, runTransaction: fn => db.runTransaction(fn), now: () => new Date(state.now), featureAdapters: { 'crm-data-input': adapter }, resolveAllowance: async () => ({ allowanceNano: '5000000000' }), engineeringMode: true,
        pricingRegistry: [{ versionId: 'engineering-price', provider: 'engineering-provider', model: 'engineering-text', serviceTier: 'standard', effectiveAt: '2026-01-01T00:00:00Z', expiresAt: '2028-01-01T00:00:00Z', ratesNano: { inputBytes: '1', outputBytes: '1' } }],
        boundsRegistry: { 'engineering-bound': { proven: true, engineeringOnly: true, models: ['engineering-text'], deriveMaximum({ request }) {
            assert.equal(request.inputBytes, Buffer.byteLength(JSON.stringify(request.descriptor))); assert.equal(request.maxRequests, 1);
            assert.equal(crypto.createHash('sha256').update(JSON.stringify(request.descriptor)).digest('hex'), request.descriptorDigest);
            return { inputBytes: String(request.inputBytes), outputBytes: String(request.maxOutputBytes) };
        } } },
        providerAdapters: { 'engineering-provider': { engineeringOnly: true, normalizeEvidence({ evidence }) { if (!trusted.has(evidence)) throw Object.assign(Error('Untrusted fixture evidence'), { code: 'UNTRUSTED_EVIDENCE', status: 403 }); return evidence; } } }
    });
    const baseFeature = ledger.forFeature('crm-data-input');
    const wrapped = { ...ledger, forFeature: name => { assert.equal(name, 'crm-data-input'); return { ...baseFeature, async authorizeDispatch(...args) { if (state.revokeAtDispatch) state.disabled = true; return baseFeature.authorizeDispatch(...args); } }; } };
    const provider = createAccountedGenerationProvider({ ledger: wrapped, ...(native ? {} : { engineeringMode: true, engineeringMapping: { sourceModel: 'gemini-3.8-flash', model: 'engineering-text', boundsVersion: 'engineering-bound', maxOutputBytes: 65536 }, async transport({ permit, request }) {
        state.calls++; assert.equal([...records.values()].find(x => x.reservationId === permit.reservationId).state, 'dispatch_intent');
        assert.ok(request.descriptor.systemInstruction.includes('CRM')); assert.ok(request.descriptor.responseSchema.properties.upserts); assert.ok(request.descriptor.input.includes('Create Lan'));
        if (mode === 'throw') throw Error('Disconnected');
        if (mode === 'missing') return { output: OUTPUT };
        const evidence = { evidenceId: 'receipt1', providerRequestId: 'provider-request1', complete: mode !== 'partial', ...(mode !== 'partial' ? { quantities: { inputBytes: String(request.inputBytes), outputBytes: String(Buffer.byteLength(OUTPUT)) } } : {}) }; trusted.add(evidence);
        if (mode === 'revokeAfterSend') state.disabled = true;
        return { output: OUTPUT, evidence };
    } }) });
    const request = buildProposalRequest({ draft, actorUid: 'staff1', source: { kind: 'text', messageId: 'message1' }, nowMs: state.now, text: START.text });
    const call = { actorUid: 'staff1', feature: 'crm-data-input', purpose: 'draft', operationId: 'operation1', request };
    return { state, records, db, authorize, adapter, ledger, provider, call, service: createInterpretationService({ db, authorize, provider, now: () => state.now }) };
}

test('actual external interpretation consumer settles before returning proposal and replays without I/O', async () => {
    const f = fixture(); const result = await f.service.start(START); assert.equal(result.status, 'done'); assert.equal(result.proposal.changes.upserts[0].values.name, 'Lan');
    assert.equal((await f.ledger.forFeature('crm-data-input').getBudget('staff1')).pendingNano, '0');
    assert.ok([...f.records.values()].some(row => row.state === 'settled')); assert.equal(f.state.calls, 1);
    assert.deepEqual(await f.service.start(START), result); assert.equal(f.state.calls, 1);
    f.state.disabled = true; await assert.rejects(f.service.start(START), e => e.code === 'FORBIDDEN');
});

test('consumed permit cannot redispatch and changed descriptor conflicts with stable operation', async () => {
    const f = fixture(); assert.equal(await f.provider.generate(f.call), OUTPUT);
    await assert.rejects(f.provider.generate(f.call), e => e.code === 'RESPONSE_RECOVERY_REQUIRED'); assert.equal(f.state.calls, 1);
    const request = buildProposalRequest({ draft: f.records.get('crmDataInputDrafts/draft1'), actorUid: 'staff1', source: { kind: 'text', messageId: 'message1' }, nowMs: f.state.now, text: 'Create another student' });
    await assert.rejects(f.provider.generate({ ...f.call, request }), e => e.code === 'RESERVATION_CONFLICT'); assert.equal(f.state.calls, 1);
    f.state.disabled = true; await assert.rejects(f.provider.generate(f.call), e => e.code === 'ACCOUNT_INELIGIBLE');
});

test('actual domain authorization is rechecked before dispatch without Projects grants', async () => {
    const f = fixture(); f.state.revokeAtDispatch = true;
    await assert.rejects(f.provider.generate(f.call), e => e.code === 'ACCOUNT_INELIGIBLE'); assert.equal(f.state.calls, 0);
    assert.equal([...f.records.values()].find(row => row.reservationId).state, 'reserved');
    assert.throws(() => createDataInputBudgetFeatureAdapter({}), TypeError);
    for (const role of ['student', 'learner', 'parent', 'guest']) { const next = fixture(); next.records.set('users/staff1', { isAdmin: true, role }); await assert.rejects(next.provider.generate(next.call), e => e.code === 'ACCOUNT_INELIGIBLE'); assert.equal(next.state.calls, 0); }
});

test('native, wrong feature/purpose, images, oversized and tampered descriptors never dispatch', async () => {
    const f = fixture({ native: true }); await assert.rejects(f.provider.generate(f.call), e => e.code === 'PAID_DISPATCH_DISABLED');
    const actual = await f.service.start(START); assert.equal(actual.status, 'unknown'); assert.equal(f.state.calls, 0); assert.ok(![...f.records.keys()].some(k => k.startsWith('crmAiBudget')));
    const e = fixture();
    for (const patch of [{ feature: 'projects' }, { purpose: 'execute' }]) await assert.rejects(e.provider.generate({ ...e.call, ...patch }), err => err.code === 'FEATURE_PURPOSE_NOT_ALLOWED');
    for (const [patch, code] of [[{ image: {} }, 'IMAGES_UNSUPPORTED'], [{ input: 'x'.repeat(60001) }, 'DESCRIPTOR_TOO_LARGE'], [{ systemInstruction: 'changed' }, 'DESCRIPTOR_DIGEST_MISMATCH']]) await assert.rejects(e.provider.generate({ ...e.call, request: { ...e.call.request, ...patch } }), err => err.code === code);
    assert.equal(e.state.calls, 0);
});

test('missing usage, partial evidence and transport failure retain obligations and prevent retry I/O', async () => {
    for (const mode of ['missing', 'partial', 'throw']) {
        const f = fixture({ mode }); const result = await f.service.start(START); assert.equal(result.status, 'unknown', mode); assert.equal(f.state.calls, 1);
        const budget = await f.ledger.forFeature('crm-data-input').getBudget('staff1'); assert.ok(BigInt(budget.pendingNano) > 0n); assert.equal(budget.settledNano, '0'); assert.equal(budget.blockReason, 'USAGE_UNKNOWN');
        assert.deepEqual(await f.service.start(START), result); assert.equal(f.state.calls, 1);
    }
});

test('trusted settlement survives authorization revoked after dispatch', async () => {
    const f = fixture({ mode: 'revokeAfterSend' }); assert.equal(await f.provider.generate(f.call), OUTPUT);
    assert.equal([...f.records.values()].find(row => row.reservationId).state, 'settled'); assert.equal(f.state.calls, 1);
});
