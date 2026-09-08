'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountedGenerationProvider } = require('../../../functions/src/ai-assistance/providers/accounted-generation');
const { createLedgerService } = require('../../../functions/src/ai-assistance/accounting/ledger-service');
const { createProjectsBudgetFeatureAdapter } = require('../../../functions/src/crm/projects/budget-service');
const { createDataInputBudgetFeatureAdapter } = require('../../../functions/src/ai-assistance/adapters/data-input');
const { digest } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
process.env.CRM_PROJECTS_ENABLED = 'true';
function fixture(options = {}) {
    const rows = new Map(), state = { io: 0, authorizations: [], revoked: false, revokeAtDispatch: false }; let queue = Promise.resolve();
    const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }) };
    const runTransaction = work => { const result = queue.then(async () => { const pending = new Map(); let writing = false; const tx = { async get(ref) { assert.equal(writing, false); return { exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)) }; }, set(ref, value) { writing = true; pending.set(ref.path, structuredClone(value)); }, create(ref, value) { assert.equal(rows.has(ref.path), false); this.set(ref, value); } }; const value = await work(tx); for (const entry of pending) rows.set(...entry); return value; }); queue = result.catch(() => {}); return result; };
    const accessService = {
        async assertTransactionEligible(tx, uid) { assert.ok(tx); return { uid, profile: {}, workforce: {} }; },
        async assertTransactionContentAccess(tx, uid, projectId, options) { assert.ok(tx); state.authorizations.push({ uid, projectId, options }); if (state.revoked || state.revokeAtDispatch && state.authorizations.length === 2) throw Object.assign(Error('current project permission revoked'), { code: 'PROJECT_REVOKED', status: 403 }); return { identity: { uid, profile: {}, workforce: {} }, project: { id: projectId, data: { lifecycle: 'active' } } }; }
    };
    const trusted = new WeakSet();
    const ledger = createLedgerService({ db, runTransaction, now: () => new Date('2026-09-08T00:00:00Z'), engineeringMode: true, nativeMode: options.native === true,
        nativePolicy: { versionId: 'native-policy', kind: 'estimated', models: ['gemini-3.8-flash'], deriveEstimatedQuantities(request) { assert.equal(request.maxOutputTokens, 128); assert.equal(digest(request.descriptor), request.descriptorDigest); return { inputText: String(request.inputBytes), outputText: String(request.maxOutputTokens), inputAudio: '0' }; } }, resolveAllowance: async () => ({ allowanceNano: '5000000000' }),
        featureAdapters: { projects: createProjectsBudgetFeatureAdapter({ accessService, engineeringModels: ['engineering-generation'] }), 'crm-data-input': createDataInputBudgetFeatureAdapter({ authorize: async ({ tx, actorUid }) => { assert.ok(tx); return actorUid === 'staff' && !state.revoked; }, engineeringModels: ['engineering-generation'] }) },
        pricingRegistry: [{ versionId: 'engineering-price', provider: 'engineering-provider', model: 'engineering-generation', serviceTier: 'standard', effectiveAt: '2026-01-01T00:00:00Z', expiresAt: '2028-01-01T00:00:00Z', ratesNano: { inputBytes: '1', outputBytes: '1' } },
            { versionId: 'native-price', provider: 'gemini', model: 'gemini-3.8-flash', serviceTier: 'standard', effectiveAt: '2026-01-01T00:00:00Z', expiresAt: '2028-01-01T00:00:00Z', ratesNano: { inputText: '1', outputText: '1', inputAudio: '1' } }],
        boundsRegistry: { 'engineering-bound': { proven: true, engineeringOnly: true, models: ['engineering-generation'], deriveMaximum({ request }) { assert.equal(digest(request.descriptor), request.descriptorDigest); assert.equal(request.inputBytes, Buffer.byteLength(JSON.stringify(request.descriptor))); return { inputBytes: String(request.inputBytes), outputBytes: String(request.maxOutputBytes) }; } } },
        providerAdapters: { 'engineering-provider': { engineeringOnly: true, normalizeEvidence({ evidence }) { assert.ok(trusted.has(evidence), 'only trusted server fixture evidence'); return evidence; } },
            gemini: { native: true, normalizeEvidence({ evidence }) { assert.ok(trusted.has(evidence), 'native evidence must originate from server transport'); return evidence; } } }
    });
    const bridgeLedger = options.alterPermit ? { ...ledger, forFeature(feature) { const adapter = ledger.forFeature(feature); return { ...adapter, async authorizeDispatch(...args) { const dispatch = await adapter.authorizeDispatch(...args); if (dispatch.sendPermit) dispatch.sendPermit = options.alterPermit(dispatch.sendPermit); return dispatch; } }; } } : ledger;
    const provider = createAccountedGenerationProvider({ ledger: bridgeLedger, onAccounting: options.onAccounting || null,
        ...(options.native ? { nativeMode: true, nativeMapping: { sourceModel: 'gemini-3.8-flash', model: 'gemini-3.8-flash', boundsVersion: 'native-policy', maxOutputBytes: 1024, maxOutputTokens: 128 } } : { engineeringMode: true, engineeringMapping: { sourceModel: 'gemini-3.8-flash', model: 'engineering-generation', boundsVersion: 'engineering-bound', maxOutputBytes: 1024 } }), async transport({ permit, request }) {
        state.io++; assert.equal([...rows.values()].find(r => r.reservationId === permit.reservationId).state, 'dispatch_intent');
        if (options.throwTransport) throw Object.assign(new Error('secret provider body'), { code: 'TRANSPORT_FAILURE' });
        if (options.native) {
            assert.equal(permit.engineeringOnly, false); assert.equal(permit.provider, 'gemini'); assert.equal(request.maxOutputTokens, 128);
            const evidence = { evidenceId: permit.reservationId, dispatchIdentity: permit.reservationId, providerRequestId: null, complete: options.incomplete !== true,
                ...(options.incomplete ? {} : { quantities: { inputText: '2', outputText: options.overEstimate ? '6000000000' : '3', inputAudio: '0' } }),
                provenance: { usageMetadata: {}, usageDigest: digest({}), normalizationVersion: 'test-native-v1', aggregation: 'one-response', reasons: options.incomplete ? ['missing counts'] : [], derived: false, serviceTier: 'standard' } };
            if (!options.untrusted) trusted.add(evidence);
            return { output: Object.hasOwn(options, 'output') ? options.output : '{}', evidence };
        }
        const evidence = { evidenceId: permit.reservationId, providerRequestId: permit.reservationId, complete: true, quantities: { inputBytes: String(request.inputBytes), outputBytes: '2' } }; trusted.add(evidence); return { output: '{}', evidence };
    } });
    const descriptor = { model: 'gemini-3.8-flash', systemInstruction: 'Provide a draft only.', input: '{"tasks":[]}', responseSchema: { type: 'object' } };
    const request = { ...descriptor, requestDigest: digest(descriptor) };
    const call = { actorUid: 'staff', feature: 'projects', purpose: 'planning', context: { projectId: 'project-one' }, operationId: 'operation', request };
    return { rows, state, ledger, provider, call };
}

test('all registered Projects purposes recheck canonical project permission at reserve and dispatch', async () => {
    for (const [purpose, options] of [['planning', {}], ['task_draft', { write: true }], ['task_correction', { write: true }], ['automation_draft', { owner: true }]]) {
        const f = fixture(); assert.equal(await f.provider.generate({ ...f.call, purpose }), '{}'); assert.equal(f.state.io, 1); assert.equal(f.state.authorizations.length, 2);
        for (const check of f.state.authorizations) assert.deepEqual(check, { uid: 'staff', projectId: 'project-one', options });
        const reservation = [...f.rows.values()].find(row => row.reservationId); assert.deepEqual(reservation.context, { projectId: 'project-one' }); assert.equal(reservation.purpose, purpose); assert.equal(reservation.state, 'settled');
    }
});

test('Projects revocation between reservation and dispatch prevents transport', async () => {
    const f = fixture(); f.state.revokeAtDispatch = true;
    await assert.rejects(f.provider.generate({ ...f.call, purpose: 'task_draft' }), error => error.code === 'PROJECT_REVOKED'); assert.equal(f.state.io, 0);
    assert.equal([...f.rows.values()].find(row => row.reservationId).state, 'reserved');
});

test('unsupported feature/purpose and unbounded or foreign context fail before ledger admission', async () => {
    const f = fixture();
    for (const patch of [{ feature: 'arbitrary' }, { purpose: 'execute' }, { feature: 'crm-data-input', purpose: 'planning', context: {} }]) await assert.rejects(f.provider.generate({ ...f.call, ...patch }), e => e.code === 'FEATURE_PURPOSE_NOT_ALLOWED');
    for (const context of [undefined, null, {}, { projectId: 'project-one', uid: 'other' }, { projectId: 'a'.repeat(129) }, { projectId: '../other' }]) await assert.rejects(f.provider.generate({ ...f.call, context }));
    await assert.rejects(f.provider.generate({ ...f.call, feature: 'crm-data-input', purpose: 'draft' }));
    assert.equal(f.state.io, 0); assert.equal(f.rows.size, 0);
});

test('legacy data-input omission and explicit empty context remain accepted in shared wallet', async () => {
    const f = fixture(), { context: _context, ...legacy } = f.call;
    assert.equal(await f.provider.generate({ ...legacy, feature: 'crm-data-input', purpose: 'draft' }), '{}');
    assert.equal(await f.provider.generate({ ...legacy, feature: 'crm-data-input', purpose: 'draft', context: {}, operationId: 'second' }), '{}');
    assert.equal(f.state.io, 2); assert.equal(f.state.authorizations.length, 0);
    for (const row of [...f.rows.values()].filter(row => row.reservationId)) assert.deepEqual(row.context, {});
    assert.equal([...f.rows.values()].filter(row => row.currency === 'USD').length, 1);
});

test('same logical operation across features has distinct reservations but one aggregate ledger; same-feature retry never resends', async () => {
    const f = fixture(); await f.provider.generate(f.call);
    const { context: _context, ...legacy } = f.call; await f.provider.generate({ ...legacy, feature: 'crm-data-input', purpose: 'draft' });
    const reservations = [...f.rows.values()].filter(row => row.reservationId); assert.equal(reservations.length, 2); assert.equal(new Set(reservations.map(row => row.reservationId)).size, 2);
    const ledgers = [...f.rows.values()].filter(row => row.currency === 'USD'); assert.equal(ledgers.length, 1); assert.equal(ledgers[0].pendingNano, '0'); assert.ok(BigInt(ledgers[0].settledNano) > 0n);
    await assert.rejects(f.provider.generate(f.call), e => e.code === 'RESPONSE_RECOVERY_REQUIRED');
    await assert.rejects(f.provider.generate({ ...f.call, context: { projectId: 'project-two' } }), e => e.code === 'RESERVATION_CONFLICT'); assert.equal(f.state.io, 2);
});

test('native Projects generation remains hard disabled without engineering mapping', async () => {
    const f = fixture(), native = createAccountedGenerationProvider({ ledger: f.ledger });
    await assert.rejects(native.generate(f.call), e => e.code === 'PAID_DISPATCH_DISABLED'); assert.equal(f.state.io, 0); assert.equal(f.rows.size, 0);
});

test('explicit native mapping dispatches once through the actual ledger and exposes reported accounting', async () => {
    const observed = []; const f = fixture({ native: true, onAccounting: value => observed.push(value) });
    const result = await f.provider.generateWithAccounting(f.call);
    assert.equal(result.output, '{}'); assert.equal(result.accounting.state, 'settled'); assert.equal(result.accounting.unresolved, false);
    assert.equal(result.accounting.policyMode, 'monitored_target'); assert.equal(result.accounting.possibleOverage, true);
    assert.equal(result.accounting.engineeringOnly, false); assert.equal(result.accounting.costBasis, 'reported_usage_calculation');
    assert.equal(result.accounting.settledNano, '5'); assert.deepEqual(observed, [result.accounting]); assert.equal(Object.isFrozen(observed[0]), true);
    assert.equal(f.state.authorizations.length, 2); assert.equal(f.state.io, 1);
    await assert.rejects(f.provider.generate(f.call), e => e.code === 'RESPONSE_RECOVERY_REQUIRED'); assert.equal(f.state.io, 1);
});

test('incomplete native usage is durably unknown before output/observer and keeps pending estimate', async () => {
    let f; const observed = [];
    f = fixture({ native: true, incomplete: true, onAccounting(value) {
        const reservation = [...f.rows.values()].find(row => row.reservationId);
        assert.equal(reservation.state, 'usage_unknown'); assert.equal(reservation.evidence.length, 1); observed.push(value);
    } });
    assert.equal(await f.provider.generate(f.call), '{}'); assert.equal(observed[0].unresolved, true); assert.equal(observed[0].state, 'usage_unknown');
    const wallet = [...f.rows.values()].find(row => row.currency === 'USD'); assert.ok(BigInt(wallet.pendingNano) > 0n); assert.equal(wallet.settledNano, '0');
    await assert.rejects(f.provider.generate(f.call), e => e.code === 'RESPONSE_RECOVERY_REQUIRED'); assert.equal(f.state.io, 1);
});

test('reported native expense exceeding both estimate and monthly target remains settled and disclosed', async () => {
    const f = fixture({ native: true, overEstimate: true }); const result = await f.provider.generateWithAccounting(f.call);
    assert.equal(result.output, '{}'); assert.equal(result.accounting.estimateExceeded, true); assert.equal(result.accounting.boundsViolated, false);
    assert.equal(result.accounting.settledNano, '6000000002');
    const wallet = [...f.rows.values()].find(row => row.currency === 'USD'); assert.equal(wallet.pendingNano, '0'); assert.equal(wallet.settledNano, '6000000002');
});

test('native setup is explicit, bounded, and default off even with a native-capable ledger', async () => {
    const f = fixture({ native: true }); const mapping = { sourceModel: 'gemini-3.8-flash', model: 'gemini-3.8-flash', boundsVersion: 'native-policy', maxOutputBytes: 1024, maxOutputTokens: 128 };
    const disabled = createAccountedGenerationProvider({ ledger: f.ledger, nativeMode: true });
    await assert.rejects(disabled.generate(f.call), e => e.code === 'PAID_DISPATCH_DISABLED');
    for (const patch of [{ sourceModel: 'other' }, { model: 'other' }, { maxOutputBytes: 65537 }, { maxOutputTokens: 0 }, { maxOutputTokens: 65537 }]) {
        assert.throws(() => createAccountedGenerationProvider({ ledger: f.ledger, nativeMode: true, nativeMapping: { ...mapping, ...patch }, transport: async () => {} }));
    }
    assert.throws(() => createAccountedGenerationProvider({ ledger: f.ledger, nativeMapping: mapping, transport: async () => {} }));
    assert.equal(f.state.io, 0); assert.equal(f.rows.size, 0);
});

test('native permit model, provider, reservation and nonengineering flag must match before transport', async () => {
    for (const patch of [{ engineeringOnly: true }, { provider: 'engineering-provider' }, { model: 'other' }, { reservationId: 'other' }]) {
        const f = fixture({ native: true, alterPermit: permit => ({ ...permit, ...patch }) });
        await assert.rejects(f.provider.generate(f.call), e => e.code === 'PAID_DISPATCH_DISABLED'); assert.equal(f.state.io, 0);
        assert.equal([...f.rows.values()].find(row => row.reservationId).state, 'usage_unknown');
        await assert.rejects(f.provider.generate(f.call), e => e.code === 'RESPONSE_RECOVERY_REQUIRED');
    }
});

test('native output JSON/byte checks reject without erasing real expense or releasing unknown usage', async () => {
    for (const incomplete of [true, false]) for (const output of ['not JSON secret output', ' '.repeat(1025), null]) {
        const f = fixture({ native: true, incomplete, output });
        await assert.rejects(f.provider.generate(f.call), e => e.code === 'INVALID_OUTPUT' && !e.message.includes('secret'));
        const reservation = [...f.rows.values()].find(row => row.reservationId); assert.equal(reservation.state, incomplete ? 'usage_unknown' : 'settled');
        await assert.rejects(f.provider.generate(f.call), e => e.code === 'RESPONSE_RECOVERY_REQUIRED'); assert.equal(f.state.io, 1);
    }
});

test('native transport failure and untrusted evidence keep the consumed operation unreplayable', async () => {
    for (const options of [{ throwTransport: true }, { untrusted: true }]) {
        const f = fixture({ native: true, ...options }); await assert.rejects(f.provider.generate(f.call), error => !options.throwTransport || error.code === 'PROVIDER_GENERATION_FAILED' && !error.message.includes('secret'));
        assert.equal([...f.rows.values()].find(row => row.reservationId).state, 'usage_unknown');
        await assert.rejects(f.provider.generate(f.call), e => e.code === 'RESPONSE_RECOVERY_REQUIRED'); assert.equal(f.state.io, 1);
    }
});

test('native descriptor digest, context, purpose and image rejection happen before admission', async () => {
    const f = fixture({ native: true });
    for (const patch of [{ request: { ...f.call.request, input: 'tampered' } }, { request: { ...f.call.request, image: {} } }, { context: { projectId: 'project-one', actorUid: 'other' } }, { purpose: 'apply' }]) await assert.rejects(f.provider.generate({ ...f.call, ...patch }));
    assert.equal(f.rows.size, 0); assert.equal(f.state.io, 0);
});
