'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./usage-quota-service.test');
const { createLedgerService } = require('../../../functions/src/ai-assistance/accounting/ledger-service');
const { digest } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
test('current aggregate migration is exact once; config changes never reset spent or pending credits', async () => {
    const f = fixture();
    f.records.set(f.moneyPath('2026-09'), { uid: 'u', month: '2026-09', currency: 'USD', settledNano: '1200000000', pendingNano: '300000000', revision: 7 });
    const feature = f.ledger.forFeature('projects');
    const a = await feature.getBudget('u'); assert.equal(a.usedMicrocredits, '1200000000'); assert.equal(a.reservedMicrocredits, '300000000');
    assert.equal((await f.ledger.forFeature('crm-data-input').getBudget('u')).remainingMicrocredits, '3500000000');
    f.state.allowance = '1000000000'; const low = await feature.getBudget('u'); assert.equal(low.remainingMicrocredits, '0'); assert.equal(low.overdrawnMicrocredits, '500000000');
    f.state.allowance = '4000000000'; assert.equal((await feature.getBudget('u')).remainingMicrocredits, '2500000000');
    f.state.at = '2026-09-30T17:00:00Z'; const next = await feature.getBudget('u'); assert.equal(next.usedMicrocredits, '0'); assert.equal(next.legacyCarryMicrocredits, '0');
});
test('legacy pending reconciliation partitions imported aggregate and updates only origin month once', async () => {
    const f = fixture({ quota: false }), legacyFeature = f.ledger.forFeature('projects');
    const r = await legacyFeature.reserve('u', f.request('old')); await legacyFeature.authorizeDispatch('u', r.reservationId);
    const quota = createLedgerService({ ...f.options, usageQuota: { enabled: true } }), feature = quota.forFeature('projects');
    const initial = await feature.getBudget('u'); assert.equal(initial.reservedMicrocredits, r.reservedNano);
    f.state.at = '2026-09-30T17:00:00Z'; const fresh = await feature.getBudget('u'); assert.equal(fresh.reservedMicrocredits, '0');
    await quota.settle(r.reservationId, f.invoice(r.reservationId, true, 100));
    await quota.settle(r.reservationId, f.invoice(r.reservationId, true, 100));
    assert.equal((await feature.getBudget('u')).usedMicrocredits, '0');
    f.state.at = '2026-09-09T00:00:00Z'; const origin = await feature.getBudget('u'); assert.equal(origin.usedMicrocredits, '75000'); assert.equal(origin.reservedMicrocredits, '0');
});
test('updated legacy-mode writers obey per-account cutover without erasing financial history', async () => {
    const f = fixture(); await f.ledger.forFeature('projects').getBudget('u');
    const legacy = createLedgerService({ ...f.options, usageQuota: { enabled: false } });
    await assert.rejects(legacy.forFeature('projects').reserve('u', f.request('legacy')), { code: 'USAGE_QUOTA_CUTOVER' });
});
test('migration racing late legacy settlement has the same aggregate in either commit order', async () => {
    for (const settleFirst of [true, false]) {
        const f = fixture({ quota: false }), legacy = f.ledger.forFeature('projects');
        const r = await legacy.reserve('u', f.request('old')); await legacy.authorizeDispatch('u', r.reservationId);
        const quota = createLedgerService({ ...f.options, usageQuota: { enabled: true } }), feature = quota.forFeature('projects');
        const settle = () => quota.settle(r.reservationId, f.invoice(r.reservationId, true, 100));
        await Promise.all(settleFirst ? [settle(), feature.getBudget('u')] : [feature.getBudget('u'), settle()]);
        const result = await feature.getBudget('u'); assert.equal(result.usedMicrocredits, '75000'); assert.equal(result.reservedMicrocredits, '0');
    }
});
test('canceling an imported undispatched reservation releases its existing baseline once', async () => {
    const f = fixture({ quota: false }), r = await f.ledger.forFeature('projects').reserve('u', f.request('old'));
    const quota = createLedgerService({ ...f.options, usageQuota: { enabled: true } }), feature = quota.forFeature('projects');
    await feature.getBudget('u');
    await assert.rejects(feature.authorizeDispatch('u', r.reservationId), { code: 'USAGE_QUOTA_READMISSION_REQUIRED' });
    await feature.cancelBeforeDispatch('u', r.reservationId); await feature.cancelBeforeDispatch('u', r.reservationId);
    const result = await feature.getBudget('u'); assert.equal(result.usedMicrocredits, '0'); assert.equal(result.reservedMicrocredits, '0');
});
test('central allowance resolver preserves defaults, overrides and malformed configuration rejection', async () => {
    const { createAllowanceResolver } = require('../../../functions/src/ai-assistance/accounting/allowance-service');
    const f = fixture(), resolve = createAllowanceResolver({ db: f.db });
    const read = () => f.db.runTransaction(tx => resolve(tx, 'u'));
    assert.deepEqual(await read(), { allowanceNano: '5000000000', allowanceMicrocredits: '5000000000' });
    f.records.set('crmProjectAllowanceDefaults/default', { currency: 'USD', monthlyAllowanceCents: 200 });
    assert.equal((await read()).allowanceMicrocredits, '2000000000');
    f.records.set('crmProjectAllowanceConfigs/u', { currency: 'USD', monthlyAllowanceCents: 50 });
    assert.equal((await read()).allowanceMicrocredits, '500000000');
    f.records.set('crmProjectAllowanceConfigs/u', { currency: 'USD', monthlyAllowanceCents: '50' });
    await assert.rejects(read(), { code: 'INVALID_ALLOWANCE' });
});
test('origin money marker prevents missing quota month from resetting quota on read or reserve', async () => {
    const f = fixture(), feature = f.ledger.forFeature('projects');
    await feature.getBudget('u');
    f.records.delete(`crmAiUsageMonths/${digest(['usage-month', 'u', '2026-09'])}`);
    await assert.rejects(feature.getBudget('u'), { code: 'LEDGER_INTEGRITY' });
    await assert.rejects(feature.reserve('u', f.request('after-deletion')), { code: 'LEDGER_INTEGRITY' });
    assert.equal(f.records.get(f.moneyPath('2026-09')).settledNano, '0');
});
