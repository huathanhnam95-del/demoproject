'use strict';
// Execute only through the root-owned isolated emulator runner. No provider I/O.
const assert = require('node:assert/strict');
const h = require('./phase8-test-helpers');
async function main() {
    const suite = await h.bootSuite(); const results = [];
    try {
        const c = await h.project(suite, 'phase8-accounting'); const uid = c.uids.owner;
        const user = suite.db.collection('users').doc(uid); await user.update({ isAdmin: true });
        const run = (name, work) => h.caseRun(name, async () => {
            await h.resetBudget(suite, uid); suite.setTime('2026-09-30T16:00:00Z');
            await work(await h.accounting(suite, c));
        }, results);
        await run('actual Projects and data-input adapters contend for one final dollar across independent services', async a => {
            await a.projects.reserve(uid, a.request('initial-four', '4'));
            const b = a.restart().forFeature('crm-data-input');
            const outcomes = await Promise.allSettled([a.projects.reserve(uid, a.request('projects-last')), b.reserve(uid, a.request('input-last', '1', 'crm-data-input'))]);
            assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(outcomes.find(r => r.status === 'rejected').reason.code, 'BUDGET_EXHAUSTED');
            const budget = await a.projects.getBudget(uid); assert.equal(budget.pendingNano, '5000000000'); assert.equal(budget.availableNano, '0');
            assert.deepEqual(await b.getBudget(uid), budget);
        });
        await run('concurrent exact replay reserves once and changed payload conflicts', async a => {
            const request = a.request('same');
            const results = await Promise.all([a.projects.reserve(uid, request), a.restart().forFeature('projects').reserve(uid, request)]);
            assert.equal(results[0].reservationId, results[1].reservationId); assert.equal(results.filter(r => r.replayed).length, 1);
            assert.equal((await a.projects.getBudget(uid)).pendingNano, '1000000000');
            await assert.rejects(() => a.projects.reserve(uid, a.request('same', '2')), error => error.code === 'RESERVATION_CONFLICT');
        });
        await run('same-month bounded supporting calls coexist and each active obligation survives rollover', async a => {
            const primary = await a.projects.reserve(uid, a.request('primary-active', '3'));
            assert.ok((await a.projects.authorizeDispatch(uid, primary.reservationId)).sendPermit);
            const supporting = await a.dataInput.reserve(uid, a.request('support-active', '2', 'crm-data-input'));
            assert.ok((await a.dataInput.authorizeDispatch(uid, supporting.reservationId)).sendPermit);
            const budget = await a.projects.getBudget(uid); assert.equal(budget.pendingNano, '5000000000'); assert.equal(budget.blocked, false);
            await assert.rejects(() => a.projects.reserve(uid, a.request('too-much')), error => error.code === 'BUDGET_EXHAUSTED');
            suite.setTime('2026-09-30T17:00:00Z');
            await assert.rejects(() => a.projects.reserve(uid, a.request('old-active')), error => error.code === 'PRIOR_MONTH_DISPATCH');
            await a.ledger.settle(supporting.reservationId, a.evidence('support-final', '1'));
            await assert.rejects(() => a.projects.reserve(uid, a.request('one-still-active')), error => error.code === 'PRIOR_MONTH_DISPATCH');
            await a.ledger.settle(primary.reservationId, a.evidence('primary-final', '2'));
            assert.equal((await a.projects.getBudget(uid)).blocked, false);
            assert.equal((await a.projects.reserve(uid, a.request('both-complete'))).month, '2026-10');
        });
        await run('persisted cancellation and dispatch race yields one outcome without a refund after send permission', async a => {
            const r = await a.projects.reserve(uid, a.request('race'));
            const [dispatch, cancel] = await Promise.allSettled([a.projects.authorizeDispatch(uid, r.reservationId), a.restart().forFeature('projects').cancelBeforeDispatch(uid, r.reservationId)]);
            assert.equal(dispatch.status, 'fulfilled'); const budget = await a.projects.getBudget(uid);
            if (dispatch.value.sendPermit) {
                assert.equal(cancel.status, 'rejected'); assert.equal(cancel.reason.code, 'DISPATCH_AMBIGUOUS'); assert.equal(budget.pendingNano, '1000000000'); assert.equal(budget.blocked, false);
            } else {
                assert.equal(cancel.status, 'fulfilled'); assert.equal(cancel.value.state, 'canceled_before_dispatch'); assert.equal(budget.pendingNano, '0'); assert.equal(budget.blocked, false);
            }
        });
        await run('restart after dispatch blocks new Vietnam month and settlement survives current Auth revocation', async a => {
            const r = await a.projects.reserve(uid, a.request('crash', '5')); await a.projects.authorizeDispatch(uid, r.reservationId);
            suite.setTime('2026-09-30T17:00:00Z'); const restarted = a.restart();
            await assert.rejects(() => restarted.forFeature('crm-data-input').reserve(uid, a.request('rollover', '1', 'crm-data-input')), error => error.code === 'PRIOR_MONTH_DISPATCH');
            await suite.auth.updateUser(uid, { disabled: true });
            try {
                await assert.rejects(() => a.projects.getBudget(uid));
                const evidence = a.evidence('crash-final', '2'); await restarted.settle(r.reservationId, evidence);
                assert.equal((await restarted.settle(r.reservationId, evidence)).replayed, true);
            } finally { await suite.auth.updateUser(uid, { disabled: false }); }
            const budget = await a.projects.getBudget(uid); assert.equal(budget.blocked, false); assert.equal(budget.settledNano, '0');
            const old = await suite.db.collection(h.AI_ASSISTANCE_COLLECTIONS.ledgers).where('uid', '==', uid).where('month', '==', '2026-09').get();
            assert.equal(old.size, 1); assert.equal(old.docs[0].data().settledNano, '2000000000'); assert.equal(old.docs[0].data().pendingNano, '0');
        });
        await run('current domain admission cannot borrow Projects grant; contaminated staff and removed membership denied', async a => {
            await user.update({ isAdmin: false });
            try {
                await assert.rejects(() => a.dataInput.reserve(uid, a.request('no-record-admin', '1', 'crm-data-input')), error => error.code === 'ACCOUNT_INELIGIBLE');
                const r = await a.projects.reserve(uid, a.request('project-only')); await a.projects.cancelBeforeDispatch(uid, r.reservationId);
            } finally { await user.update({ isAdmin: true }); }
            const profile = (await user.get()).data();
            try {
                for (const role of ['student', 'learner', 'parent', 'guest']) {
                    await user.update({ role });
                    await assert.rejects(() => a.projects.reserve(uid, a.request(`projects-${role}`)));
                    await assert.rejects(() => a.dataInput.reserve(uid, a.request(`input-${role}`, '1', 'crm-data-input')), error => error.code === 'ACCOUNT_INELIGIBLE');
                }
            } finally { await user.set(profile); }
            const r = await a.projects.reserve(uid, a.request('member-revoked')); const member = c.memberRef('owner'); const saved = (await member.get()).data();
            await member.delete();
            try { await assert.rejects(() => a.projects.authorizeDispatch(uid, r.reservationId)); await assert.rejects(() => a.projects.reserve(uid, a.request('member-revoked'))); }
            finally { await member.set(saved); }
        });
        await run('administrative cap and decrease are persisted while existing pending obligations remain exact', async a => {
            await a.projects.reserve(uid, a.request('pending', '3'));
            h.expectStatus(await suite.global('/allowance', 'owner', 'PATCH', { monthlyAllowanceCents: 501, expectedRevision: 0 }), 400);
            h.expectStatus(await suite.global('/allowance', 'owner', 'PATCH', { monthlyAllowanceCents: 100, expectedRevision: 0 }), 200);
            const budget = h.expectStatus(await suite.global('/budget'), 200).budget;
            assert.equal(budget.allowanceNano, '1000000000'); assert.equal(budget.pendingNano, '3000000000'); assert.equal(budget.availableNano, '-2000000000');
            assert.equal((await a.restart().forFeature('projects').getBudget(uid)).availableNano, '-2000000000');
            await assert.rejects(() => a.dataInput.reserve(uid, a.request('decreased', '1', 'crm-data-input')), error => error.code === 'BUDGET_EXHAUSTED');
            const persisted = (await suite.db.collection('crmProjectAllowanceDefaults').doc('default').get()).data(); assert.equal(persisted.monthlyAllowanceCents, 100);
        });
        await run('client rules deny direct own-account reads and writes for every canonical accounting collection', async a => {
            await a.projects.reserve(uid, a.request('private')); const token = await suite.token('owner');
            for (const collection of Object.values(h.AI_ASSISTANCE_COLLECTIONS)) {
                const rows = await suite.db.collection(collection).where('uid', '==', uid).get(); assert.ok(rows.size > 0);
                for (const method of ['GET', 'PATCH']) {
                    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-crm-projects/databases/(default)/documents/${collection}/${rows.docs[0].id}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { pendingNano: { stringValue: '0' } } }) } : {}) });
                    assert.equal(response.status, 403, `${collection} ${method}: ${await response.text()}`);
                }
            }
        });
    } finally { await suite.close(); }
    h.finish(results);
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
