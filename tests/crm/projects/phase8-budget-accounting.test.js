'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { integer, centsToNano, validateAllowanceNano, vietnamMonth, monthEnd, STANDARD_PRICING, selectPricing, calculateCost, reject, strict } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
const { normalizeFlashUsage, validateBoundedRequest, NATIVE_PAID_DISPATCH_AVAILABLE } = require('../../../functions/src/ai-assistance/accounting/provider-accounting');
const { createLedgerService } = require('../../../functions/src/ai-assistance/accounting/ledger-service');
const { assertStaffIdentity, createProjectsAllowanceResolver, createProjectsBudgetFeatureAdapter } = require('../../../functions/src/crm/projects/budget-service');

test('nanodollar arithmetic is exact; malformed configuration and allowances above $5 fail closed', () => {
    assert.equal(centsToNano(500), '5000000000'); assert.equal(centsToNano(0), '0'); assert.equal(centsToNano(125), '1250000000');
    for (const value of [501, 1000, -1, 1.2, '500', null, true, NaN]) assert.throws(() => centsToNano(value), error => error.code === 'INVALID_ALLOWANCE');
    assert.throws(() => validateAllowanceNano('5000000001'), error => error.code === 'ALLOWANCE_CAP_EXCEEDED');
    assert.equal(integer('-23', 'available', { signed: true }), -23n);
    for (const value of ['01', '-0', '1.2', '1e3', 100]) assert.throws(() => integer(value));
    assert.equal(calculateCost(STANDARD_PRICING[0], { inputText: '1', outputText: '1' }), '4500');
});
test('Vietnam year/month and immutable effective pricing use server boundaries', () => {
    assert.equal(vietnamMonth('2026-12-31T16:59:59.999Z'), '2026-12'); assert.equal(vietnamMonth('2026-12-31T17:00:00.000Z'), '2027-01');
    assert.equal(monthEnd('2026-12'), '2026-12-31T17:00:00.000Z');
    assert.equal(selectPricing(STANDARD_PRICING, 'gemini-3.8-flash', '2026-12-31T23:59:59Z').ratesNano.outputText, '3750');
    assert.equal(selectPricing(STANDARD_PRICING, 'gemini-3.8-flash', '2027-01-01T00:00:00Z').ratesNano.outputText, '7500');
    assert.throws(() => selectPricing([], 'unknown', new Date()), error => error.code === 'PRICING_UNAVAILABLE');
});
test('Flash normalization adds thoughts once and treats totals only as an integrity check', () => {
    const usage = { serviceTier: 'standard', promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 3, totalTokenCount: 33 };
    assert.deepEqual(normalizeFlashUsage(usage), { inputText: '10', outputText: '23' });
    for (const patch of [{ totalTokenCount: 30 }, { cachedContentTokenCount: 1 }, { toolUsePromptTokenCount: 1 }, { serviceTier: 'priority' }, { promptTokenCount: -1 }, { groundingCost: 2 }]) assert.throws(() => normalizeFlashUsage({ ...usage, ...patch }));
    assert.throws(() => normalizeFlashUsage({ ...usage, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 10 }] }));
    assert.equal(NATIVE_PAID_DISPATCH_AVAILABLE, false);
});
test('bounded engineering requests reject arbitrary prices, fractional quantities and unlimited retries', () => {
    assert.deepEqual(validateBoundedRequest({ inputTokens: '10', outputTokens: '2', maxRequests: 1 }), { inputTokens: '10', outputTokens: '2', maxRequests: 1 });
    for (const patch of [{ outputTokens: '1.1' }, { inputTokens: '1048577' }, { maxRequests: 4 }, { priceNano: '1' }]) assert.throws(() => validateBoundedRequest({ inputTokens: '10', outputTokens: '2', maxRequests: 1, ...patch }));
});

// Deliberately in-memory transaction model: these tests prove service contracts,
// not Firestore concurrency or a provider hard maximum. Persisted races remain
// an independent required acceptance gate.
function fixture() {
    const records = new Map(); const state = { date: new Date('2026-09-30T16:00:00Z'), allowanceNano: '5000000000', revoked: false };
    const doc = path => ({ path });
    const query = (path, filters = [], after = null, limit = 100) => ({ collectionPath: path, filters, after, limitValue: limit, doc: id => doc(`${path}/${id}`), where: (field, operator, value) => query(path, [...filters, { field, value }], after, limit), orderBy: () => query(path, filters, after, limit), startAfter: id => query(path, filters, id, limit), limit: size => query(path, filters, after, size) });
    const db = { collection: path => query(path) }; let tail = Promise.resolve();
    const runTransaction = callback => {
        const result = tail.then(async () => {
            const candidate = new Map([...records].map(([key, value]) => [key, structuredClone(value)])); let writes = false;
            const transaction = { async get(reference) {
                assert.equal(writes, false, 'All reads must precede writes');
                if (reference.collectionPath) return { docs: [...candidate].filter(([path, value]) => path.startsWith(`${reference.collectionPath}/`) && reference.filters.every(filter => value[filter.field] === filter.value)).sort(([a], [b]) => a.localeCompare(b)).filter(([path]) => !reference.after || path.split('/').pop() > reference.after).slice(0, reference.limitValue).map(([path, value]) => ({ id: path.split('/').pop(), data: () => structuredClone(value) })) };
                return { exists: candidate.has(reference.path), data: () => structuredClone(candidate.get(reference.path)) };
            }, create(reference, value) { assert.equal(candidate.has(reference.path), false); writes = true; candidate.set(reference.path, structuredClone(value)); }, set(reference, value) { writes = true; candidate.set(reference.path, structuredClone(value)); } };
            const value = await callback(transaction); records.clear(); for (const entry of candidate) records.set(...entry); return value;
        }); tail = result.catch(() => {}); return result;
    };
    const trusted = new WeakSet(); const evidence = value => { trusted.add(value); return value; };
    const adapter = { models: ['engineering-model'], normalizeContext(value) { strict(value, ['targetId']); return value; }, async authorize(transaction, { actorUid }) { if (state.revoked) reject('REVOKED', 'Revoked', 403); return { uid: actorUid }; } };
    const options = { db, runTransaction, now: () => state.date, resolveAllowance: async () => ({ allowanceNano: state.allowanceNano }), featureAdapters: { projects: adapter, 'crm-data-input': adapter }, engineeringMode: true,
        pricingRegistry: [{ versionId: 'engineering-price', provider: 'engineering-provider', model: 'engineering-model', serviceTier: 'standard', effectiveAt: '2026-01-01T00:00:00Z', expiresAt: '2028-01-01T00:00:00Z', ratesNano: { inputText: '0', outputText: '1000000000' } }],
        boundsRegistry: { 'engineering-bound': { proven: true, engineeringOnly: true, models: ['engineering-model'], deriveMaximum({ request }) { const checked = validateBoundedRequest(request); return { inputText: (BigInt(checked.inputTokens) * BigInt(checked.maxRequests)).toString(), outputText: (BigInt(checked.outputTokens) * BigInt(checked.maxRequests)).toString() }; } } },
        providerAdapters: { 'engineering-provider': { engineeringOnly: true, normalizeEvidence({ evidence: value }) { if (!trusted.has(value)) reject('UNTRUSTED_EVIDENCE', 'Only fixture-authorized reports are accepted.', 403); return value; } } } };
    const ledger = createLedgerService(options); const projects = ledger.forFeature('projects'); const dataInput = ledger.forFeature('crm-data-input');
    const request = (requestId, outputs = '3') => ({ requestId, purpose: 'task_draft', context: { targetId: 'target' }, model: 'engineering-model', boundsVersion: 'engineering-bound', request: { inputTokens: '0', outputTokens: outputs, maxRequests: 1 } });
    return { db, records, state, options, ledger, projects, dataInput, request, evidence };
}
test('one aggregate wallet spans features and request identity survives rollover without duplication', async () => {
    const f = fixture(); const first = await f.projects.reserve('staff', f.request('one')); await assert.rejects(() => f.dataInput.reserve('staff', f.request('two')), error => error.code === 'BUDGET_EXHAUSTED');
    await assert.rejects(() => f.dataInput.reserve('staff', f.request('one')), error => error.code === 'RESERVATION_CONFLICT');
    f.state.date = new Date('2026-09-30T17:01:00Z'); const replay = await f.projects.reserve('staff', f.request('one')); assert.equal(replay.reservationId, first.reservationId); assert.equal(replay.month, '2026-09');
    const next = await f.dataInput.reserve('staff', f.request('two')); assert.equal(next.month, '2026-10');
    f.state.revoked = true; await assert.rejects(() => f.projects.reserve('staff', f.request('one')), error => error.code === 'REVOKED');
});
test('dispatch permit is issued once; ambiguity blocks new months and trusted settlement survives revocation', async () => {
    const f = fixture(); const reservation = await f.projects.reserve('staff', f.request('one')); await assert.rejects(() => f.ledger.markUnknown(reservation.reservationId), error => error.code === 'INVALID_RESERVATION_STATE');
    const dispatch = await f.projects.authorizeDispatch('staff', reservation.reservationId); assert.equal(dispatch.sendPermit.engineeringOnly, true); assert.notEqual(dispatch.sendPermit.provider, 'gemini');
    assert.equal((await f.projects.authorizeDispatch('staff', reservation.reservationId)).sendPermit, null);
    await f.ledger.markUnknown(reservation.reservationId); await f.ledger.markUnknown(reservation.reservationId); f.state.date = new Date('2026-10-01T00:00:00Z');
    await assert.rejects(() => f.dataInput.reserve('staff', f.request('two', '1')), error => error.code === 'USAGE_UNKNOWN');
    f.state.revoked = true; const report = f.evidence({ evidenceId: 'final', providerRequestId: 'provider-one', complete: true, quantities: { inputText: '0', outputText: '2' } });
    assert.equal((await f.ledger.settle(reservation.reservationId, report)).settledNano, '2000000000'); assert.equal((await f.ledger.settle(reservation.reservationId, report)).replayed, true);
    f.state.revoked = false; assert.equal((await f.projects.getBudget('staff')).blocked, false); assert.equal((await f.projects.getBudget('staff')).settledNano, '0');
    await assert.rejects(() => f.ledger.settle(reservation.reservationId, f.evidence({ ...report, quantities: { inputText: '0', outputText: '1' } })), error => error.code === 'EVIDENCE_CONFLICT');
});
test('partial reports retain maximum, actual overbound cost is fully recorded and durable guard remains', async () => {
    const f = fixture(); const reservation = await f.projects.reserve('staff', f.request('one', '1')); await f.projects.authorizeDispatch('staff', reservation.reservationId);
    const partial = f.evidence({ evidenceId: 'partial', providerRequestId: 'provider-one', complete: false }); await f.ledger.settle(reservation.reservationId, partial);
    assert.equal((await f.projects.getBudget('staff')).pendingNano, '1000000000'); await f.ledger.settle(reservation.reservationId, partial);
    const final = f.evidence({ evidenceId: 'final', providerRequestId: 'provider-one', complete: true, quantities: { inputText: '0', outputText: '6' } }); await f.ledger.settle(reservation.reservationId, final);
    const usage = await f.projects.getBudget('staff'); assert.equal(usage.settledNano, '6000000000'); assert.equal(usage.availableNano, '-1000000000'); assert.equal(usage.blockReason, 'BOUNDS_VIOLATED');
    f.state.date = new Date('2026-10-01T00:00:00Z'); await assert.rejects(() => f.projects.reserve('staff', f.request('two', '1')), error => error.code === 'BOUNDS_VIOLATED');
});
test('dispatch crash blocks rollover before any recovery call and direct settlement clears its guard exactly once', async () => {
    const f = fixture(); const reservation = await f.projects.reserve('staff', f.request('crash', '5'));
    await f.projects.authorizeDispatch('staff', reservation.reservationId);
    assert.equal((await f.projects.authorizeDispatch('staff', reservation.reservationId)).sendPermit, null);
    assert.equal((await f.projects.getBudget('staff')).blockReason, null);
    f.state.date = new Date('2026-09-30T17:01:00Z');
    const restarted = createLedgerService(f.options);
    await assert.rejects(() => restarted.forFeature('crm-data-input').reserve('staff', f.request('after-crash', '5')), error => error.code === 'PRIOR_MONTH_DISPATCH');
    const report = f.evidence({ evidenceId: 'final', providerRequestId: 'crashed-provider', complete: true, quantities: { inputText: '0', outputText: '2' } });
    await restarted.settle(reservation.reservationId, report);
    assert.equal((await restarted.settle(reservation.reservationId, report)).replayed, true);
    const budget = await f.projects.getBudget('staff'); assert.equal(budget.blocked, false); assert.equal(budget.settledNano, '0');
    const original = [...f.records.values()].find(row => row.month === '2026-09' && row.currency === 'USD');
    assert.equal(original.settledNano, '2000000000'); assert.equal(original.pendingNano, '0');
    assert.equal([...f.records.values()].find(row => row.uid === 'staff' && Object.hasOwn(row, 'unknownCount')).unknownCount, 0);
    assert.equal((await restarted.forFeature('crm-data-input').reserve('staff', f.request('after-crash', '5'))).month, '2026-10');
});
test('missing final categories retain obligations; explicit zero usage settles after idempotent recovery', async () => {
    const f = fixture(); const reservation = await f.projects.reserve('staff', f.request('missing', '3'));
    await f.projects.authorizeDispatch('staff', reservation.reservationId);
    for (const quantities of [{}, { inputText: '0' }, { outputText: '0' }]) {
        await assert.rejects(() => f.ledger.settle(reservation.reservationId, f.evidence({ evidenceId: 'final', providerRequestId: 'provider-one', complete: true, quantities })), error => error.code === 'INVALID_EVIDENCE');
        const budget = await f.projects.getBudget('staff'); assert.equal(budget.pendingNano, '3000000000'); assert.equal(budget.settledNano, '0'); assert.equal(budget.blockReason, 'USAGE_UNKNOWN');
    }
    await f.ledger.markUnknown(reservation.reservationId); await f.ledger.markUnknown(reservation.reservationId);
    assert.equal([...f.records.values()].find(row => row.uid === 'staff' && Object.hasOwn(row, 'unknownCount')).unknownCount, 1);
    const report = f.evidence({ evidenceId: 'final', providerRequestId: 'provider-one', complete: true, quantities: { inputText: '0', outputText: '0' } });
    assert.equal((await f.ledger.settle(reservation.reservationId, report)).settledNano, '0');
    assert.equal((await f.ledger.settle(reservation.reservationId, report)).replayed, true);
    const budget = await f.projects.getBudget('staff'); assert.equal(budget.pendingNano, '0'); assert.equal(budget.availableNano, '5000000000'); assert.equal(budget.blocked, false);
    assert.equal([...f.records.values()].find(row => row.uid === 'staff' && Object.hasOwn(row, 'unknownCount')).unknownCount, 0);
});
test('allowance decrease preserves obligations; cancellation is exclusive to undispatched work', async () => {
    const f = fixture(); const reservation = await f.projects.reserve('staff', f.request('one')); f.state.allowanceNano = '1000000000'; assert.equal((await f.projects.getBudget('staff')).availableNano, '-2000000000');
    await f.projects.cancelBeforeDispatch('staff', reservation.reservationId); assert.equal((await f.projects.getBudget('staff')).pendingNano, '0');
    const next = await f.projects.reserve('staff', f.request('two', '1')); await f.projects.authorizeDispatch('staff', next.reservationId); await assert.rejects(() => f.projects.cancelBeforeDispatch('staff', next.reservationId), error => error.code === 'DISPATCH_AMBIGUOUS');
    f.state.allowanceNano = '5000000001'; await assert.rejects(() => f.projects.getBudget('staff'), error => error.code === 'ALLOWANCE_CAP_EXCEEDED');
});
test('native models cannot obtain engineering send permissions and reads omit raw context/evidence', async () => {
    const f = fixture(); const native = createLedgerService({ ...f.options, engineeringMode: false }).forFeature('projects'); await assert.rejects(() => native.reserve('staff', f.request('native')), error => error.code === 'PAID_DISPATCH_DISABLED');
    const nativeModel = 'gemini-3.8-flash';
    const fakeNativeProof = createLedgerService({ ...f.options, featureAdapters: { projects: { ...f.options.featureAdapters.projects, models: [nativeModel] } }, pricingRegistry: [{ ...f.options.pricingRegistry[0], model: nativeModel }], boundsRegistry: { 'engineering-bound': { ...f.options.boundsRegistry['engineering-bound'], models: [nativeModel] } } }).forFeature('projects');
    await assert.rejects(() => fakeNativeProof.reserve('staff', { ...f.request('forged-native-proof'), model: nativeModel }), error => error.code === 'PAID_DISPATCH_DISABLED');
    await f.projects.reserve('staff', f.request('one', '1')); const list = await f.projects.listReservations('staff', { pageSize: 1 });
    assert.ok(!JSON.stringify(list).includes('targetId')); assert.ok(!JSON.stringify(list).includes('dispatchToken')); assert.equal((await f.projects.getBudget('staff')).paidDispatchAvailable, false);
    assert.throws(() => f.ledger.forFeature('unregistered'), error => error.code === 'FEATURE_NOT_REGISTERED');
});
test('Projects adapter rejects nonstaff role contamination and strictly reads existing numeric configuration', async () => {
    for (const role of ['student', 'learner', 'parent', 'guest']) assert.throws(() => assertStaffIdentity({ profile: { role }, workforce: { status: 'active', moduleGrants: { projects: true } } }), error => error.code === 'STAFF_ACCOUNT_REQUIRED');
    const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }) }; const values = new Map(); const transaction = { get: async ref => ({ exists: values.has(ref.path), data: () => values.get(ref.path) }) }; const resolve = createProjectsAllowanceResolver({ db });
    assert.equal((await resolve(transaction, 'staff')).allowanceNano, '5000000000'); values.set('crmProjectAllowanceDefaults/default', { currency: 'USD', monthlyAllowanceCents: 250 }); assert.equal((await resolve(transaction, 'staff')).allowanceNano, '2500000000');
    values.set('crmProjectAllowanceConfigs/staff', { currency: 'USD', monthlyAllowanceCents: 0 }); assert.equal((await resolve(transaction, 'staff')).allowanceNano, '0');
    values.set('crmProjectAllowanceConfigs/staff', { currency: 'USD', monthlyAllowanceCents: 501 }); await assert.rejects(() => resolve(transaction, 'staff'), error => error.code === 'INVALID_ALLOWANCE');
    values.set('crmProjectAllowanceConfigs/staff', { currency: 'USD', monthlyAllowanceCents: '100' }); await assert.rejects(() => resolve(transaction, 'staff'), error => error.code === 'INVALID_ALLOWANCE');
});
test('Projects purpose permissions do not borrow an unrelated grant or treat unknown purpose as planning', async () => {
    const old = process.env.CRM_PROJECTS_ENABLED; process.env.CRM_PROJECTS_ENABLED = '1'; const calls = [];
    try { const adapter = createProjectsBudgetFeatureAdapter({ accessService: { async assertTransactionContentAccess(transaction, uid, project, options) { calls.push(options); return { identity: { uid, profile: { role: 'staff' }, workforce: {} }, project: { data: { lifecycle: 'active' } } }; } } });
        for (const purpose of ['planning', 'task_draft', 'automation_draft']) await adapter.authorize({}, { actorUid: 'staff', purpose, context: { projectId: 'p' }, operation: 'reserve' });
        assert.deepEqual(calls, [{}, { write: true }, { owner: true }]); await assert.rejects(() => adapter.authorize({}, { actorUid: 'staff', purpose: 'arbitrary', context: { projectId: 'p' }, operation: 'reserve' }), error => error.code === 'PURPOSE_NOT_ALLOWED');
    } finally { if (old === undefined) delete process.env.CRM_PROJECTS_ENABLED; else process.env.CRM_PROJECTS_ENABLED = old; }
});

test('same-month Live-like and Flash-like dispatches share pending balance and fence rollover', async () => {
    const f = fixture();
    const live = await f.projects.reserve('staff', f.request('live-like', '2'));
    await f.projects.authorizeDispatch('staff', live.reservationId);
    assert.equal((await f.dataInput.getBudget('staff')).blocked, false);
    const [flash, another] = await Promise.all([f.dataInput.reserve('staff', f.request('flash-like', '1')), f.projects.reserve('staff', f.request('supporting', '2'))]);
    await Promise.all([f.dataInput.authorizeDispatch('staff', flash.reservationId), f.projects.authorizeDispatch('staff', another.reservationId)]);
    const budget = await f.projects.getBudget('staff'); assert.equal(budget.pendingNano, '5000000000'); assert.equal(budget.blocked, false);
    await assert.rejects(f.projects.reserve('staff', f.request('overflow', '1')), e => e.code === 'BUDGET_EXHAUSTED');
    const guard = () => [...f.records.values()].find(row => Object.hasOwn(row, 'dispatchedByMonth'));
    assert.deepEqual(guard().dispatchedByMonth, { '2026-09': 3 }); assert.equal(guard().unknownCount, 0);
    f.state.date = new Date('2026-09-30T17:00:00Z');
    assert.equal((await f.projects.getBudget('staff')).blockReason, 'PRIOR_MONTH_DISPATCH');
    await assert.rejects(f.dataInput.reserve('staff', f.request('rollover', '1')), e => e.code === 'PRIOR_MONTH_DISPATCH');
    await f.ledger.markUnknown(live.reservationId); await f.ledger.markUnknown(live.reservationId);
    assert.equal(guard().unknownCount, 1); assert.equal((await f.projects.getBudget('staff')).blockReason, 'USAGE_UNKNOWN');
    for (const reservation of [flash, live, another]) {
        const evidence = f.evidence({ evidenceId: `final-${reservation.reservationId}`, providerRequestId: reservation.reservationId, complete: true, quantities: { inputText: '0', outputText: '1' } });
        await f.ledger.settle(reservation.reservationId, evidence); const before = structuredClone(guard()); await f.ledger.settle(reservation.reservationId, evidence); assert.deepEqual(guard(), before);
    }
    assert.deepEqual(guard().dispatchedByMonth, {}); assert.equal(guard().unknownCount, 0);
    assert.equal((await f.projects.getBudget('staff')).blocked, false);
    assert.equal((await f.dataInput.reserve('staff', f.request('rollover', '1'))).month, '2026-10');
});

test('malformed dispatch maps fail closed and legacy unknown intent remains conservatively blocked', async () => {
    for (const map of [null, [], { '2026-13': 1 }, { '2026-09': 0 }, { '2026-09': -1 }, { '2026-09': 1.5 }, { '2026-09': '1' }, { '2026-09': Number.MAX_SAFE_INTEGER, '2026-08': 1 }]) {
        const f = fixture(); await f.projects.reserve('staff', f.request('seed', '1'));
        const guard = [...f.records.values()].find(row => Object.hasOwn(row, 'unknownCount')); guard.dispatchedByMonth = map;
        await assert.rejects(f.projects.getBudget('staff'), e => e.code === 'LEDGER_INTEGRITY');
        await assert.rejects(f.projects.reserve('staff', f.request('next', '1')), e => e.code === 'LEDGER_INTEGRITY');
    }
    const f = fixture(); const reservation = await f.projects.reserve('staff', f.request('legacy', '1')); await f.projects.authorizeDispatch('staff', reservation.reservationId);
    const guard = [...f.records.values()].find(row => Object.hasOwn(row, 'unknownCount')); delete guard.dispatchedByMonth; guard.unknownCount = 1;
    const row = [...f.records.values()].find(value => value.reservationId === reservation.reservationId); delete row.dispatchCounted; row.unknownCounted = true;
    assert.equal((await f.projects.getBudget('staff')).blockReason, 'USAGE_UNKNOWN');
    await assert.rejects(f.dataInput.reserve('staff', f.request('next', '1')), e => e.code === 'USAGE_UNKNOWN');
    await f.ledger.settle(reservation.reservationId, f.evidence({ evidenceId: 'legacy-final', providerRequestId: 'legacy-provider', complete: true, quantities: { inputText: '0', outputText: '1' } }));
    assert.equal((await f.projects.getBudget('staff')).blocked, false);
});

test('missing month counter for a counted dispatch cannot settle or clear obligations', async () => {
    const f = fixture(); const reservation = await f.projects.reserve('staff', f.request('damaged', '1')); await f.projects.authorizeDispatch('staff', reservation.reservationId);
    const guard = [...f.records.values()].find(row => Object.hasOwn(row, 'unknownCount')); guard.dispatchedByMonth = {};
    await assert.rejects(f.ledger.settle(reservation.reservationId, f.evidence({ evidenceId: 'final', providerRequestId: 'provider', complete: true, quantities: { inputText: '0', outputText: '0' } })), e => e.code === 'LEDGER_INTEGRITY');
    assert.equal((await f.projects.getBudget('staff')).pendingNano, '1000000000');
});


test('persisted crmRole nonstaff contamination blocks profile and workforce allowance access', () => {
    const { assertStaffIdentity } = require('../../../functions/src/crm/projects/budget-service');
    for (const source of ['profile', 'workforce']) for (const role of ['student', 'learner', 'parent', 'guest']) {
        const identity = { uid: 'staff', profile: {}, workforce: { moduleGrants: { projects: true } }, [source]: { crmRole: ` ${role.toUpperCase()} ` } };
        assert.throws(() => assertStaffIdentity(identity), error => error.code === 'STAFF_ACCOUNT_REQUIRED');
    }
    const staff = { uid: 'staff', profile: { crmRole: 'teacher' }, workforce: { crmRole: 'admin' } };
    assert.equal(assertStaffIdentity(staff), staff);
});
function nativeFixture(enabled = true) {
    const f = fixture();
    const { createNativeAccountingPolicy } = require('../../../functions/src/ai-assistance/accounting/native-policy');
    const { normalizeNativeUsage } = require('../../../functions/src/ai-assistance/accounting/provider-accounting');
    const model = 'gemini-3.8-flash'; const adapter = { ...f.options.featureAdapters.projects, models: [model] };
    const options = { ...f.options, engineeringMode: false, nativeMode: enabled, nativePolicy: createNativeAccountingPolicy({ versionId: 'native-test-estimate', models: [model], deriveEstimatedQuantities: () => ({ inputText: '0', outputText: '1' }) }), featureAdapters: { projects: adapter, 'crm-data-input': adapter }, pricingRegistry: [{ versionId: 'native-test-price', provider: 'gemini', model, serviceTier: 'standard', effectiveAt: '2026-01-01T00:00:00Z', expiresAt: '2028-01-01T00:00:00Z', ratesNano: { inputText: '0', outputText: '1000000000', inputAudio: '0', inputImage: '0' } }], providerAdapters: { gemini: { native: true, normalizeEvidence({ evidence }) { if (!f.evidenceSet?.has(evidence)) reject('UNTRUSTED_EVIDENCE', 'Trusted transport required.'); return evidence; } } } };
    f.evidenceSet = new WeakSet(); const ledger = createLedgerService(options), feature = ledger.forFeature('projects');
    const request = id => ({ ...f.request(id, '1'), model, boundsVersion: 'native-test-estimate' });
    const usage = (reservationId, count, evidenceId = 'native-final') => { const evidence = normalizeNativeUsage({ kind: 'flash', dispatchIdentity: reservationId, providerRequestId: null, evidenceId, serviceTier: 'standard', final: true, usageMetadata: count === null ? {} : { promptTokenCount: 0, candidatesTokenCount: count, totalTokenCount: count } }); f.evidenceSet.add(evidence); return evidence; };
    return { ...f, ledger, feature, request, usage, options };
}
test('native estimated cost overrun settles full reported cost and marks monitored target without permanent bounds block', async () => {
    const f = nativeFixture(); const reservation = await f.feature.reserve('staff', f.request('native'));
    assert.equal(reservation.reservationKind, 'estimated'); assert.equal(reservation.engineeringOnly, false);
    const results = await Promise.all([f.feature.authorizeDispatch('staff', reservation.reservationId), f.feature.authorizeDispatch('staff', reservation.reservationId)]);
    assert.equal(results.filter(result => result.sendPermit).length, 1); assert.equal(results.find(result => result.sendPermit).sendPermit.dispatchIdentity, reservation.reservationId);
    const settled = await f.ledger.settle(reservation.reservationId, f.usage(reservation.reservationId, 6)); assert.equal(settled.settledNano, '6000000000'); assert.equal(settled.estimateExceeded, true); assert.equal(settled.boundsViolated, false);
    const budget = await f.feature.getBudget('staff'); assert.equal(budget.targetExceeded, true); assert.equal(budget.blocked, false); assert.equal(budget.pendingNano, '0'); assert.equal(budget.availableNano, '-1000000000'); assert.equal(budget.policyMode, 'monitored_target'); assert.equal(budget.paidDispatchAvailable, true);
    await assert.rejects(() => f.feature.reserve('staff', f.request('over-target')), error => error.code === 'BUDGET_EXHAUSTED');
});
test('native default off, current authority replay, incomplete usage and rollover retain once-only obligations', async () => {
    const off = nativeFixture(false); assert.equal((await off.feature.getBudget('staff')).paidDispatchAvailable, false); await assert.rejects(() => off.feature.reserve('staff', off.request('off')));
    const f = nativeFixture(); const one = await f.feature.reserve('staff', f.request('one')); await f.feature.authorizeDispatch('staff', one.reservationId);
    f.state.revoked = true; await assert.rejects(() => f.feature.reserve('staff', f.request('one')), error => error.code === 'REVOKED'); f.state.revoked = false;
    const partial = await f.ledger.settle(one.reservationId, f.usage(one.reservationId, null, 'partial')); assert.equal(partial.state, 'usage_unknown'); assert.equal((await f.feature.getBudget('staff')).pendingNano, '1000000000');
    f.state.date = new Date('2026-10-01T00:00:00Z'); await assert.rejects(() => f.feature.reserve('staff', f.request('two')), error => error.code === 'PRIOR_MONTH_DISPATCH');
    const final = f.usage(one.reservationId, 1); await f.ledger.settle(one.reservationId, final); assert.equal((await f.ledger.settle(one.reservationId, final)).replayed, true); assert.equal((await f.feature.getBudget('staff')).blocked, false);
});
test('native settlement evidence identity and raw metadata digest cannot be changed on replay', async () => {
    const f = nativeFixture(); const one = await f.feature.reserve('staff', f.request('identity')); await f.feature.authorizeDispatch('staff', one.reservationId);
    const original = f.usage(one.reservationId, 1); await f.ledger.settle(one.reservationId, original);
    await assert.rejects(() => f.ledger.settle(one.reservationId, f.usage(one.reservationId, 2)), error => error.code === 'EVIDENCE_CONFLICT');
    assert.equal((await f.feature.getBudget('staff')).settledNano, '1000000000');
    const two = await f.feature.reserve('staff', f.request('provenance')); await f.feature.authorizeDispatch('staff', two.reservationId); const tampered = f.usage(two.reservationId, 1); tampered.provenance.usageMetadata.totalTokenCount = 999;
    await assert.rejects(() => f.ledger.settle(two.reservationId, tampered), error => error.code === 'INVALID_EVIDENCE'); assert.equal((await f.feature.getBudget('staff')).pendingNano, '1000000000'); assert.equal((await f.feature.getBudget('staff')).blockReason, null); assert.equal((await f.feature.getBudget('staff')).estimatedUnknownCount, 1);
});

test('native estimated unknowns retain pending target while allowing supporting calls and exact settlement', async () => {
    const f = nativeFixture(); const one = await f.feature.reserve('staff', f.request('unknown-one')); await f.feature.authorizeDispatch('staff', one.reservationId);
    await f.ledger.markUnknown(one.reservationId); await f.ledger.markUnknown(one.reservationId);
    const support = f.ledger.forFeature('crm-data-input'); const two = await support.reserve('staff', f.request('support')); await support.authorizeDispatch('staff', two.reservationId);
    let budget = await f.feature.getBudget('staff'); assert.equal(budget.unknownCount, 1); assert.equal(budget.estimatedUnknownCount, 1); assert.equal(budget.pendingNano, '2000000000'); assert.equal(budget.possibleOverage, true);
    await f.ledger.settle(one.reservationId, f.usage(one.reservationId, 1)); await f.ledger.settle(one.reservationId, f.usage(one.reservationId, 1));
    budget = await f.feature.getBudget('staff'); assert.equal(budget.estimatedUnknownCount, 0); assert.equal(budget.unknownCount, 0); assert.equal(budget.pendingNano, '1000000000');
});
test('native unknown limit, missing legacy classification and corrupted counters block admission', async () => {
    const f = nativeFixture(); const options = { ...f.options, pricingRegistry: f.options.pricingRegistry.map(price => ({ ...price, ratesNano: { inputText: '0', outputText: '1000' } })) }; const ledger = createLedgerService(options), feature = ledger.forFeature('projects');
    for (let index = 0; index < 8; index++) { const reservation = await feature.reserve('staff', f.request('limit-' + index)); await feature.authorizeDispatch('staff', reservation.reservationId); await ledger.markUnknown(reservation.reservationId); }
    assert.equal((await feature.getBudget('staff')).estimatedUnknownCount, 8); await assert.rejects(feature.reserve('staff', f.request('ninth')), error => error.code === 'NATIVE_UNKNOWN_LIMIT');
    const guard = [...f.records.values()].find(row => Object.hasOwn(row, 'unknownCount')); delete guard.estimatedUnknownCount;
    assert.equal((await feature.getBudget('staff')).blockReason, 'USAGE_UNKNOWN');
    for (const invalid of [-1, 9, 1.5, '8']) { [...f.records.values()].find(row => Object.hasOwn(row, 'unknownCount')).estimatedUnknownCount = invalid; await assert.rejects(feature.getBudget('staff'), error => error.code === 'LEDGER_INTEGRITY'); }
});


test('native text Flash settles with the deployed native audio pricing vector', async () => {
    const f = nativeFixture();
    const { NATIVE_STANDARD_PRICING } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
    const ledger = createLedgerService({ ...f.options, pricingRegistry: NATIVE_STANDARD_PRICING });
    const feature = ledger.forFeature('projects');
    const reservation = await feature.reserve('staff', f.request('actual-native-price'));
    await feature.authorizeDispatch('staff', reservation.reservationId);
    const result = await ledger.settle(reservation.reservationId, f.usage(reservation.reservationId, 2));
    assert.equal(result.state, 'settled'); assert.equal(result.settledNano, '7500');
    assert.equal((await feature.getBudget('staff')).unknownCount, 0);
});

test('creation accounting uses same Projects feature and current staff without fake project authority', async () => {
    const previous = process.env.CRM_PROJECTS_ENABLED; process.env.CRM_PROJECTS_ENABLED = 'true';
    try { let denied = false; const adapter = createProjectsBudgetFeatureAdapter({ accessService: { async assertTransactionEligible(_tx, actorUid) { if (denied) throw Error('revoked'); return { uid: actorUid, profile: {} }; }, async assertTransactionContentAccess() { assert.fail('No existing project in creation context'); } } });
        const context = adapter.normalizeContext({ mode: 'create_project' }); assert.deepEqual(await adapter.authorize({}, { actorUid: 'staff', purpose: 'task_draft', context, operation: 'reserve' }), { uid: 'staff' });
        await assert.rejects(() => adapter.authorize({}, { actorUid: 'staff', purpose: 'automation_draft', context, operation: 'reserve' })); denied = true; await assert.rejects(() => adapter.authorize({}, { actorUid: 'staff', purpose: 'planning', context, operation: 'reserve' })); assert.throws(() => adapter.normalizeContext({ mode: 'create_project', projectId: 'p' }));
    } finally { if (previous === undefined) delete process.env.CRM_PROJECTS_ENABLED; else process.env.CRM_PROJECTS_ENABLED = previous; }
});
