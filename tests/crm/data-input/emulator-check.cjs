'use strict';
// Explicit effectful acceptance command; never included in the unit registry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const projectId = 'demo-crm-data-input';
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8270'
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9170') throw new Error('This check requires the dedicated loopback demo emulators.');
const output = process.env.CRM_DATA_INPUT_EVIDENCE;
if (!output || !path.isAbsolute(output)) throw new Error('Absolute external evidence directory is required.');
const { db, getAuth } = require('../../../functions/src/utils/firebase_admin_init');
const app = require('../../../functions/src/apiApp');
const auth = getAuth();
const runId = `input-${Date.now()}`;
const uid = `${runId}-staff`, email = `${runId}@example.test`, password = randomBytes(24).toString('base64url');
const collections = ['users', 'crmDataInputDrafts', 'crmLeads', 'crmStudents', 'crmClassrooms', 'crmEnrollments', 'crmInvoices', 'crmPayments', 'crmCounters', 'crmAuditLogs', 'crmCommissions', 'entranceTests', 'practiceAccessJobs'];
const before = new Map(), evidence = { projectId, runId, checks: [], passed: false };
let server, token;
async function call(method, suffix, body, expected = 200) {
    const response = await fetch(`http://127.0.0.1:9270/api/admin/data-input${suffix}`, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${suffix}: ${value.error || value.message || response.status}`);
    return value;
}
const ref = (action, field) => ({ $ref: `${action}.${field}` });
async function conversation(actions, requestId) {
    const created = await call('POST', '/conversations', { requestId });
    const edited = await call('PATCH', `/conversations/${created.draftId}`, { messageId: 'm1', text: 'Local acceptance fixture', changes: { expectedRevision: 0, upserts: actions } });
    return edited.draft;
}
async function preview(draft, requestId = 'review1') {
    return call('POST', `/conversations/${draft.draftId}/preview`, { requestId, expectedRevision: draft.revision });
}
async function commit(draft, review, expected = 200) {
    return call('POST', `/conversations/${draft.draftId}/commit`, { previewId: review.previewId, confirmationToken: review.confirmationToken }, expected);
}
async function main() {
    for (const name of collections) before.set(name, new Set((await db.collection(name).get()).docs.map(doc => doc.id)));
    await auth.createUser({ uid, email, password });
    await db.collection('users').doc(uid).set({ isAdmin: true, role: 'admin', email });
    const signin = await fetch('http://127.0.0.1:9170/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    assert.equal(signin.status, 200, 'Emulator sign-in failed'); token = (await signin.json()).idToken;
    server = await new Promise((resolve, reject) => { const listener = app.listen(9270, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
    const classId = `${runId}-class`;
    await db.collection('crmClassrooms').doc(classId).set({ name: 'Local acceptance class', status: 'active' });
    const draft = await conversation([
        { actionId: 'lead', kind: 'createLead', values: { name: 'Local acceptance student', source: 'facebook' } },
        { actionId: 'convert', kind: 'convertLead', values: { leadId: ref('lead', 'leadId') } },
        { actionId: 'test', kind: 'createEntranceTest', values: { studentId: ref('convert', 'studentId'), testType: 'entrance_test_36plus_v1' } },
        { actionId: 'enroll', kind: 'createEnrollment', values: { studentId: ref('convert', 'studentId'), classId } },
        { actionId: 'invoice', kind: 'createInvoice', values: { studentId: ref('convert', 'studentId'), enrollmentId: ref('enroll', 'enrollmentId'), amount: 100, discount: 10 } },
        { actionId: 'pay', kind: 'recordPayment', values: { studentId: ref('convert', 'studentId'), invoiceId: ref('invoice', 'invoiceId'), amount: 90, reference: 'LOCAL-ACCEPTANCE' } }
    ], 'full-chain');
    const leadCount = (await db.collection('crmLeads').get()).size;
    const review = await preview(draft);
    assert.equal((await db.collection('crmLeads').get()).size, leadCount, 'Preview wrote a lead');
    evidence.checks.push('preview-no-business-writes');
    const [first, duplicate] = await Promise.all([commit(draft, review), commit(draft, review)]);
    assert.deepEqual(duplicate, first);
    const result = first.results;
    const student = (await db.collection('crmStudents').doc(result.convert.studentId).get()).data();
    const invoice = (await db.collection('crmInvoices').doc(result.invoice.invoiceId).get()).data();
    const payment = (await db.collection('crmPayments').doc(result.pay.paymentId).get()).data();
    assert.equal(student.lifecycleStage, 'enrolled'); assert.equal(invoice.status, 'paid'); assert.equal(invoice.paidAmount, 90);
    assert.equal(payment.enrollmentId, result.enroll.enrollmentId); assert.equal(payment.reference, 'LOCAL-ACCEPTANCE');
    const payments = await db.collection('crmPayments').where('invoiceId', '==', result.invoice.invoiceId).get();
    assert.equal(payments.size, 1);
    assert.equal((await db.collection('entranceTests').doc(result.test.testId).get()).data().studentId, result.convert.studentId);
    evidence.checks.push('atomic-linked-chain-persisted', 'concurrent-confirmation-one-payment');
    const recovered = await call('GET', `/conversations/${draft.draftId}/operation`);
    assert.equal(recovered.receipt.operationId, first.operationId);
    evidence.checks.push('receipt-recovery');
    const stale = await conversation([{ actionId: 'invoice', kind: 'createInvoice', values: { studentId: result.convert.studentId, amount: 20 } }], 'stale-record');
    const staleReview = await preview(stale);
    await db.collection('crmStudents').doc(result.convert.studentId).set({ notes: 'Changed after review' }, { merge: true });
    const staleResult = await commit(stale, staleReview, 409);
    assert.equal(staleResult.error, 'STALE_RECORDS');
    evidence.checks.push('stale-record-requires-review');
    const revoked = await conversation([{ actionId: 'lead', kind: 'createLead', values: { name: 'Must not save', source: 'facebook' } }], 'revoked');
    const revokedReview = await preview(revoked);
    await db.collection('users').doc(uid).set({ isAdmin: false }, { merge: true });
    await commit(revoked, revokedReview, 403);
    evidence.checks.push('revoked-admin-denied');
    await db.collection('users').doc(uid).set({ isAdmin: true }, { merge: true });
    const direct = await fetch(`http://127.0.0.1:8270/v1/projects/${projectId}/databases/(default)/documents/crmDataInputDrafts/${draft.draftId}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(direct.status, 403, 'Direct draft read must be denied even to CRM admins');
    evidence.checks.push('direct-client-draft-read-denied');
    const directWrite = await fetch(`http://127.0.0.1:8270/v1/projects/${projectId}/databases/(default)/documents/crmDataInputDrafts/${draft.draftId}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { status: { stringValue: 'committed' } } }) });
    assert.equal(directWrite.status, 403, 'Direct draft write must be denied even to CRM admins');
    evidence.checks.push('direct-client-draft-write-denied');
    evidence.passed = true;
}
main().catch(error => { evidence.error = error.stack; process.exitCode = 1; }).finally(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    try {
        for (const name of collections) {
            if (!before.has(name)) continue;
            const docs = await db.collection(name).get();
            for (const doc of docs.docs) if (!before.get(name).has(doc.id)) await db.recursiveDelete(doc.ref);
        }
        await auth.deleteUser(uid).catch(error => { if (error.code !== 'auth/user-not-found') throw error; });
        evidence.cleaned = true;
    } catch (error) { evidence.cleanupError = error.message; process.exitCode = 1; }
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'emulator-results.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    await db.terminate();
});
