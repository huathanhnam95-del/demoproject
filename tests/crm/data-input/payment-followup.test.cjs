'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./transaction-fixture.cjs');
const { createPaymentFollowupService, projectPaymentFollowup } = require('../../../functions/src/crm/payment-followup-service');
const { buildLeadConversion } = require('../../../functions/src/crm/lead-service');
const { mapStudentRecord, buildStudentPatchData } = require('../../../functions/src/crm/student-service');
test('conversion without money carries required followup and manual updates cannot waive it', () => {
    const result = buildLeadConversion({ leadId: 'l1', lead: { name: 'New student' }, context: { user: { uid: 'staff' } } });
    assert.deepEqual(result.student.paymentFollowupRequired, { version: 1, source: 'lead_conversion' });
    assert.deepEqual(mapStudentRecord(result.student, 's1').paymentFollowupRequired, result.student.paymentFollowupRequired);
    const patch = buildStudentPatchData(result.student, { paymentFollowupRequired: null, name: 'Corrected name' }, {});
    assert.deepEqual(patch.paymentFollowupRequired, result.student.paymentFollowupRequired);
    assert.equal(result.student.paidAmount, undefined);
});
test('required conversion followup distinguishes absent money from absent evidence without inventing payment', () => {
    const student = { paymentFollowupRequired: { version: 1, source: 'lead_conversion' } };
    const empty = projectPaymentFollowup(student, []);
    assert.equal(empty.paymentStatus, 'not_recorded');
    assert.deepEqual(empty.requiredActions, ['payment_details', 'receipt_image']);
    const payment = { paymentId: 'p1', amount: 12, currency: 'USD', paymentDate: '2026-09-01' };
    const missing = projectPaymentFollowup(student, [payment]);
    assert.equal(missing.paymentStatus, 'recorded'); assert.equal(missing.evidenceStatus, 'missing');
    assert.deepEqual(missing.requiredActions, ['receipt_image']);
    assert.equal(projectPaymentFollowup({}, []).required, false);
    assert.throws(() => projectPaymentFollowup(student, [{ ...payment, amount: 0 }]), /payment/i);
});
test('current authorized projection reads real records; revoked users cannot inspect finance', async () => {
    const f = fixture({ 'crmStudents/s1': { paymentFollowupRequired: { version: 1, source: 'lead_conversion' } } });
    let allowed = true;
    f.db.runTransaction = work => work(fixture(Object.fromEntries(f.rows)).transaction);
    const service = createPaymentFollowupService({ db: f.db, authorize: async () => allowed });
    assert.equal((await service.get('staff', 's1')).paymentStatus, 'not_recorded');
    f.rows.set('crmPayments/p1', { studentId: 's1', amount: 10, currency: 'USD' });
    assert.equal((await service.get('staff', 's1')).paymentStatus, 'recorded');
    allowed = false;
    await assert.rejects(service.get('staff', 's1'), error => error.code === 'FORBIDDEN');
    assert.equal(f.rows.size, 2);
});
test('receipt completion changes only evidence, retries once, and rechecks authority after storage', async () => {
    const f = fixture({ 'crmStudents/s1': { paymentFollowupRequired: { version: 1, source: 'lead_conversion' } },
        'crmPayments/p1': { studentId: 's1', invoiceId: 'i1', amount: 10, currency: 'USD', paymentDate: '2026-09-01' },
        'crmInvoices/i1': { outstandingAmount: 20, status: 'partial' } });
    f.db.runTransaction = async work => { const next = fixture(Object.fromEntries(f.rows)); const result = await work(next.transaction); f.rows.clear(); for (const pair of next.rows) f.rows.set(...pair); return result; };
    let allowed = true, revokeOnPut = false;
    const sha256 = 'a'.repeat(64), bytes = Buffer.from('image');
    const service = createPaymentFollowupService({ db: f.db, authorize: async () => allowed,
        normalizeImage: async () => ({ bytes, sha256 }), storage: { put: async () => { if (revokeOnPut) allowed = false; }, read: async () => bytes } });
    const before = structuredClone(f.rows.get('crmPayments/p1'));
    assert.equal((await service.putEvidence('staff', 'p1', {})).deduped, false);
    assert.equal((await service.putEvidence('staff', 'p1', {})).deduped, true);
    const saved = { ...f.rows.get('crmPayments/p1') }; delete saved.receiptEvidence; delete saved.receiptEvidenceAttempts;
    assert.deepEqual(saved, before); assert.equal(f.rows.get('crmInvoices/i1').outstandingAmount, 20);
    assert.deepEqual((await service.get('staff', 's1')).requiredActions, []);
    assert.deepEqual(await service.readEvidence('staff', 'p1'), bytes);
    f.rows.set('crmPayments/p2', { ...before }); revokeOnPut = true;
    await assert.rejects(service.putEvidence('staff', 'p2', {}), error => error.code === 'FORBIDDEN');
    assert.equal(f.rows.get('crmPayments/p2').receiptEvidence, undefined);
    assert.equal(f.rows.get('crmPayments/p2').receiptEvidenceAttempts[sha256].status, 'pending');
    assert.equal(f.rows.get('crmPayments/p2').receiptEvidenceAttempts[sha256].objectPath, `crmPaymentEvidence/p2/${sha256}.png`);
    revokeOnPut = false; allowed = true;
    const recovered = await service.putEvidence('staff', 'p2', {});
    assert.equal(recovered.deduped, false);
    assert.equal(f.rows.get('crmPayments/p2').receiptEvidence.sha256, sha256);
    assert.equal(f.rows.get('crmPayments/p2').receiptEvidenceAttempts[sha256].status, 'attached');
});

test('serialized concurrent different-image upload keeps the losing hash referenced', async () => {
    const f = fixture({
        'crmStudents/s1': { paymentFollowupRequired: { version: 1, source: 'lead_conversion' } },
        'crmPayments/p1': { studentId: 's1', amount: 10, currency: 'USD', paymentDate: '2026-09-01' }
    });
    // The fixture has no optimistic conflict retries. This queue models the
    // Firestore invariant that commits serialize, while leaving that retry
    // behavior outside the scope of this unit assertion.
    let transactionChain = Promise.resolve();
    f.db.runTransaction = work => {
        const run = transactionChain.then(async () => {
            const next = fixture(Object.fromEntries(f.rows));
            const result = await work(next.transaction);
            f.rows.clear();
            for (const pair of next.rows) f.rows.set(...pair);
            return result;
        });
        transactionChain = run.catch(() => undefined);
        return run;
    };
    const pendingStorage = [], storageCalls = [], stored = new Map();
    const storage = { put: async (objectPath, bytes) => {
        storageCalls.push(objectPath);
        await new Promise(resolve => pendingStorage.push(resolve));
        stored.set(objectPath, Buffer.from(bytes));
    } };
    const normalizeImage = async input => {
        const bytes = Buffer.from(String(input.marker));
        const sha256 = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
        return { bytes, sha256 };
    };
    const service = createPaymentFollowupService({ db: f.db, authorize: async () => true, normalizeImage, storage });
    const first = service.putEvidence('staff', 'p1', { marker: 'first image' });
    const second = service.putEvidence('staff', 'p1', { marker: 'second image' });
    let timeout, stopped = false;
    try {
        await Promise.race([
            new Promise(resolve => {
                const started = () => { if (stopped) return; if (storageCalls.length === 2) resolve(); else setImmediate(started); };
                started();
            }),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`timed out after ${storageCalls.length} storage calls`)), 2000); })
        ]);
    } finally {
        stopped = true;
        clearTimeout(timeout);
    }
    pendingStorage.splice(0).forEach(resolve => resolve());
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.equal(rejected.reason.code, 'EVIDENCE_EXISTS');
    const payment = f.rows.get('crmPayments/p1');
    const hashes = ['first image', 'second image'].map(marker => require('node:crypto').createHash('sha256').update(marker).digest('hex'));
    const winner = payment.receiptEvidence.sha256, loser = hashes.find(hash => hash !== winner);
    assert.ok(hashes.includes(winner));
    assert.equal(payment.receiptEvidenceAttempts[winner].status, 'attached');
    assert.equal(payment.receiptEvidenceAttempts[loser].status, 'pending');
    assert.equal(payment.receiptEvidenceAttempts[loser].objectPath, `crmPaymentEvidence/p1/${loser}.png`);
    assert.ok(stored.has(`crmPaymentEvidence/p1/${loser}.png`));
});

test('ninth distinct attempt stops before storage while an existing hash can retry', async () => {
    const { createHash } = require('node:crypto');
    const hashes = Array.from({ length: 8 }, (_, index) => createHash('sha256').update(`existing-${index}`).digest('hex'));
    const attempts = Object.fromEntries(hashes.map((sha256, index) => [sha256, {
        objectPath: `crmPaymentEvidence/p1/${sha256}.png`, status: 'pending', requestedBy: 'staff', requestedAtMs: index + 1
    }]));
    const f = fixture({
        'crmStudents/s1': { paymentFollowupRequired: { version: 1, source: 'lead_conversion' } },
        'crmPayments/p1': { studentId: 's1', amount: 10, currency: 'USD', receiptEvidenceAttempts: attempts }
    });
    f.db.runTransaction = async work => {
        const next = fixture(Object.fromEntries(f.rows));
        const result = await work(next.transaction);
        f.rows.clear();
        for (const pair of next.rows) f.rows.set(...pair);
        return result;
    };
    let storageCalls = 0;
    const service = createPaymentFollowupService({ db: f.db, authorize: async () => true,
        normalizeImage: async input => {
            const bytes = Buffer.from(input.kind === 'existing' ? 'existing-0' : 'ninth-distinct');
            return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
        },
        storage: { put: async () => { storageCalls++; } }
    });
    await assert.rejects(service.putEvidence('staff', 'p1', { kind: 'distinct' }), error => error.code === 'EVIDENCE_ATTEMPT_LIMIT');
    assert.equal(storageCalls, 0);
    const retry = await service.putEvidence('staff', 'p1', { kind: 'existing' });
    assert.equal(retry.deduped, false);
    assert.equal(storageCalls, 1);
    assert.equal(f.rows.get('crmPayments/p1').receiptEvidence.sha256, hashes[0]);
});
test('student cue separates recorded payment from receipt gap and uploads only evidence', async () => {
    const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
    const doc = { createTextNode(text) { return { textContent: text }; }, createElement(tag) { const attributes = new Map(); return { tag, ownerDocument: doc, children: [], style: {}, events: {},
        setAttribute(name, value) { attributes.set(String(name), String(value)); }, getAttribute(name) { return attributes.has(String(name)) ? attributes.get(String(name)) : null; },
        hasAttribute(name) { return attributes.has(String(name)); }, removeAttribute(name) { attributes.delete(String(name)); },
        append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
        insertAdjacentElement() {}, addEventListener(name, action) { this.events[name] = action; } }; } };
    const elements = { studentModalTitle: doc.createElement('h2'), studentFinanceWorkflowNote: doc.createElement('p') };
    const modalState = { studentId: 's1', studentSessionKey: 1 }, calls = [];
    let evidence = false;
    const context = { window: {}, URL };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/student-finance.js'), 'utf8'), context);
    const controller = context.window.CrmStudentFinance.createController({ elements, modalState, renderStudentSchedulePrompt() {},
        apiFetchJson: async (url, options = {}) => {
            calls.push({ url, options });
            if (options.method === 'PUT') { evidence = true; return {}; }
            return { required: true, paymentStatus: 'recorded', evidenceStatus: evidence ? 'complete' : 'missing', requiredActions: evidence ? [] : ['receipt_image'],
                payments: [{ paymentId: 'p1', amount: 10, currency: 'USD', evidencePresent: evidence }] };
        } });
    await controller.refreshStudentFinance();
    assert.match(elements.studentPaymentFollowupNote.textContent, /payment is recorded; a receipt image is still missing/);
    const row = elements.studentPaymentEvidence.children.at(-1);
    row.children.find(item => item.tag === 'input').files = [{ type: 'image/png' }];
    await row.children.find(item => item.tag === 'button').events.click();
    assert.equal(calls.filter(call => call.options.method).length, 0);
    row.children.find(item => item.tag === 'label').children[0].checked = true;
    await row.children.find(item => item.tag === 'button').events.click();
    assert.match(elements.studentPaymentFollowupNote.textContent, /complete/);
    const writes = calls.filter(call => call.options.method);
    assert.equal(writes.length, 1); assert.equal(writes[0].url, '/api/admin/payments/p1/evidence');
    assert.equal(writes[0].options.method, 'PUT');
});
