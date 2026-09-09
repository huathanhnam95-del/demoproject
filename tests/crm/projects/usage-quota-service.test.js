'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createLedgerService } = require('../../../functions/src/ai-assistance/accounting/ledger-service');
const { NATIVE_STANDARD_PRICING, digest, reject } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
const { normalizeNativeUsage } = require('../../../functions/src/ai-assistance/accounting/provider-accounting');

// Atomic committed-copy transaction fixture, including a strict read-before-write
// fence. This tests actual service races; it is not a Firestore emulator claim.
function fixture({ quota = true } = {}) {
    const records = new Map(), state = { at: '2026-09-09T00:00:00Z', allowance: '5000000000', revoked: false };
    const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }) };
    let tail = Promise.resolve();
    const runTransaction = work => {
        const result = tail.then(async () => {
            const copy = new Map([...records].map(([key, value]) => [key, structuredClone(value)])); let wrote = false;
            const tx = { get: async ref => { assert.equal(wrote, false, 'Firestore reads precede every write'); return { exists: copy.has(ref.path), data: () => structuredClone(copy.get(ref.path)) }; },
                set: (ref, value) => { wrote = true; copy.set(ref.path, structuredClone(value)); },
                create: (ref, value) => { assert.equal(copy.has(ref.path), false, 'create is unique'); wrote = true; copy.set(ref.path, structuredClone(value)); } };
            const result = await work(tx); records.clear(); for (const entry of copy) records.set(...entry); return result;
        }); tail = result.catch(() => {}); return result;
    };
    db.runTransaction = runTransaction;
    const adapter = { models: ['gemini-3.8-flash', 'gemini-3.1-flash-live-preview'], normalizeContext: value => value,
        authorize: async (_tx, { actorUid }) => { if (state.revoked) reject('REVOKED', 'Revoked', 403); return { uid: actorUid }; } };
    const trusted = new WeakSet();
    const options = { db, runTransaction, now: () => state.at, resolveAllowance: async () => ({ allowanceNano: state.allowance, allowanceMicrocredits: state.allowance }),
        featureAdapters: { projects: adapter, 'crm-data-input': adapter }, nativeMode: true, usageQuota: { enabled: quota }, pricingRegistry: NATIVE_STANDARD_PRICING,
        nativePolicy: { versionId: 'test-native', kind: 'estimated', models: adapter.models, deriveEstimatedQuantities: () => ({ inputText: '10', outputText: '10' }) },
        providerAdapters: { gemini: { native: true, normalizeEvidence: ({ evidence }) => { if (!trusted.has(evidence)) throw Error('Untrusted'); return evidence; } } } };
    const ledger = createLedgerService(options);
    const request = id => ({ requestId: id, purpose: 'planning', context: {}, model: 'gemini-3.8-flash', boundsVersion: 'test-native', request: { inputBytes: 10, maxOutputTokens: 10 } });
    const invoice = (id, complete = false, tokens = 5) => {
        const raw = complete ? { promptTokenCount: tokens, candidatesTokenCount: 0, totalTokenCount: tokens } : null;
        const evidence = normalizeNativeUsage({ kind: 'flash', usageMetadata: raw, serviceTier: 'standard', dispatchIdentity: id, evidenceId: complete ? `full-${tokens}` : 'unknown', final: true }); trusted.add(evidence); return evidence;
    };
    const usage = (eventId, final = true, patch = {}) => ({ eventId, stage: 'generation', final,
        counters: { inputActiveSamples: 0, outputActiveSamples: 0, inputTextBytes: 10, outputTextBytes: 3, processingTokens: 2, imageUnits: 0, ...patch },
        inputSampleRate: 16000, outputSampleRate: 24000, meteringVersion: 'crm-ai-activity-v1' });
    return { records, state, db, options, ledger, request, invoice, usage, moneyPath: month => `crmAiBudgetLedgers/${digest(['ledger', 'u', month])}`, accountPath: `crmAiBudgetAccounts/${digest(['account', 'u'])}` };
}
module.exports = { fixture };
if (require.main === module) {
    test('migrated shared budget reads do not contend with reservations by rewriting account guards', async () => {
        const f = fixture(), writes = [];
        const ledger = createLedgerService({ ...f.options, runTransaction: work => f.options.runTransaction(tx => work({ ...tx,
            set: (ref, value) => { writes.push(ref.path); return tx.set(ref, value); },
            create: (ref, value) => { writes.push(ref.path); return tx.create(ref, value); }
        })) });
        const projects = ledger.forFeature('projects'), input = ledger.forFeature('crm-data-input');
        const first = await projects.getBudget('u');
        assert.ok(writes.includes(f.accountPath), 'initial account cutover is persisted');
        assert.ok(writes.includes(f.moneyPath('2026-09')), 'origin month migration is persisted');
        writes.length = 0;
        assert.deepEqual(await input.getBudget('u'), first);
        assert.deepEqual(writes, [], 'already migrated reads must remain read-only');
        const reservation = await projects.reserve('u', f.request('active'));
        await projects.authorizeDispatch('u', reservation.reservationId);
        writes.length = 0;
        const active = await input.getBudget('u');
        assert.equal(active.reservedMicrocredits, reservation.quota.reservedMicrocredits);
        assert.equal(active.providerAccounting.pendingNano, reservation.maximumNano);
        assert.deepEqual(writes, [], 'live holds do not make a budget refresh a writer');
        f.state.revoked = true;
        await assert.rejects(input.getBudget('u'), { code: 'REVOKED' });
        assert.deepEqual(writes, [], 'fresh authority remains mandatory');
    });

    test('credit balance remains available before native provider configuration', async () => {
        const f = fixture();
        const ledger = createLedgerService({ ...f.options, nativeMode: false, nativePolicy: null, providerAdapters: {} });
        const feature = ledger.forFeature('projects'), budget = await feature.getBudget('u');
        assert.equal(budget.schemaVersion, 2); assert.equal(budget.paidDispatchAvailable, false); assert.equal(budget.remainingMicrocredits, '5000000000');
        await assert.rejects(feature.reserve('u', f.request('disabled')), { code: 'BOUNDS_UNPROVEN' });
    });
    test('shared quota is atomic across competing feature and process reservations', async () => {
        const f = fixture(), other = createLedgerService(f.options);
        const one = await f.ledger.forFeature('projects').reserve('u', f.request('size'));
        assert.ok(one.quota, 'new admission exposes separate quota');
        await f.ledger.forFeature('projects').cancelBeforeDispatch('u', one.reservationId);
        f.state.allowance = one.quota.reservedMicrocredits;
        const results = await Promise.allSettled([f.ledger.forFeature('projects').reserve('u', f.request('a')), other.forFeature('crm-data-input').reserve('u', f.request('b'))]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(results.find(r => r.status === 'rejected').reason.code, 'BUDGET_EXHAUSTED');
    });
    test('meter replay, conflict, monotonicity and quota finalization are independent of invoice settlement', async () => {
        const f = fixture(), feature = f.ledger.forFeature('projects'), r = await feature.reserve('u', f.request('r'));
        assert.equal(typeof f.ledger.recordUsage, 'function');
        const permit = await feature.authorizeDispatch('u', r.reservationId); assert.deepEqual(permit.sendPermit.quota.bounds, r.quota.bounds);
        await f.ledger.recordUsage(r.reservationId, f.usage('progress', false));
        await assert.rejects(f.ledger.recordUsage(r.reservationId, f.usage('regress', false, { inputTextBytes: 9 })), { code: 'USAGE_COUNTER_REGRESSION' });
        const unknown = await f.ledger.settle(r.reservationId, f.invoice(r.reservationId)); assert.equal(unknown.state, 'usage_unknown');
        const final = await f.ledger.recordUsage(r.reservationId, f.usage('final')); assert.equal(final.state, 'usage_unknown'); assert.equal(final.quota.state, 'finalized');
        const replay = await f.ledger.recordUsage(r.reservationId, f.usage('final')); assert.equal(replay.replayed, true);
        await assert.rejects(f.ledger.recordUsage(r.reservationId, f.usage('final', true, { outputTextBytes: 4 })), { code: 'USAGE_EVENT_CONFLICT' });
        const before = await feature.getBudget('u'); await f.ledger.settle(r.reservationId, f.invoice(r.reservationId, true, 100));
        const after = await feature.getBudget('u'); assert.equal(after.usedMicrocredits, before.usedMicrocredits); assert.equal(after.reservedMicrocredits, '0');
    });
    test('nine incomplete invoices and prior-month dispatch do not block remaining quota; authority still does', async () => {
        const f = fixture(), feature = f.ledger.forFeature('projects');
        for (let i = 0; i < 9; i++) { const r = await feature.reserve('u', f.request(`r${i}`)); await feature.authorizeDispatch('u', r.reservationId); await f.ledger.settle(r.reservationId, f.invoice(r.reservationId)); }
        f.state.at = '2026-09-30T17:00:00Z';
        const budget = await feature.getBudget('u'); assert.equal(budget.schemaVersion, 2); assert.equal(budget.remainingMicrocredits, f.state.allowance); assert.equal(budget.blocked, false);
        await feature.reserve('u', f.request('new-month'));
        f.state.revoked = true; await assert.rejects(feature.reserve('u', f.request('revoked')), { code: 'REVOKED' });
    });
    test('quota bounds and terminal identity prevent invalid usage from releasing a dispatched hold', async () => {
        const f = fixture(), feature = f.ledger.forFeature('projects'), r = await feature.reserve('u', f.request('r'));
        assert.ok(r.quota); await feature.authorizeDispatch('u', r.reservationId);
        await assert.rejects(f.ledger.recordUsage(r.reservationId, f.usage('too-large', true, { inputTextBytes: r.quota.bounds.inputTextBytes + 1 })), { code: 'USAGE_QUOTA_BOUND_EXCEEDED' });
        const budget = await feature.getBudget('u'); assert.equal(budget.reservedMicrocredits, r.quota.reservedMicrocredits);
        await assert.rejects(feature.cancelBeforeDispatch('u', r.reservationId), { code: 'DISPATCH_AMBIGUOUS' });
    });
    test('tampered sidecar bounds and a missing admitted quota month fail integrity checks', async () => {
        const f = fixture(), feature = f.ledger.forFeature('projects'), r = await feature.reserve('u', f.request('r'));
        const qpath = `crmAiUsageReservations/${r.reservationId}`, original = structuredClone(f.records.get(qpath));
        f.records.set(qpath, { ...original, bounds: { ...original.bounds, inputTextBytes: original.bounds.inputTextBytes + 1 } });
        await assert.rejects(feature.authorizeDispatch('u', r.reservationId), { code: 'LEDGER_INTEGRITY' });
        f.records.set(qpath, original);
        const monthPath = `crmAiUsageMonths/${digest(['usage-month', 'u', '2026-09'])}`;
        f.records.delete(monthPath);
        await assert.rejects(feature.authorizeDispatch('u', r.reservationId), { code: 'LEDGER_INTEGRITY' });
    });
    test('lowering allowance before dispatch does not issue a permit or reset the reservation', async () => {
        const f = fixture(), feature = f.ledger.forFeature('projects'), r = await feature.reserve('u', f.request('r'));
        f.state.allowance = '0'; await assert.rejects(feature.authorizeDispatch('u', r.reservationId), { code: 'BUDGET_EXHAUSTED' });
        assert.equal((await feature.getBudget('u')).reservedMicrocredits, r.quota.reservedMicrocredits);
        f.state.allowance = '5000000000'; assert.ok((await feature.authorizeDispatch('u', r.reservationId)).sendPermit);
        assert.equal((await feature.authorizeDispatch('u', r.reservationId)).sendPermit, null);
    });
}
