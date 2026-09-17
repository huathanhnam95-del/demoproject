'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./transaction-fixture.cjs');
const { createDraft, applyChanges } = require('../../../functions/src/crm/data-input/draft-service');
const { prepareCommands } = require('../../../functions/src/crm/data-input/command-service');
const { hashTokenToTestId } = require('../../../functions/src/entrance-test/test36plus');
const nowMs = Date.parse('2026-09-07T15:00:00Z');
function draft(actions) { return applyChanges(createDraft({ draftId: 'd1', actorUid: 'staff1', now: nowMs }), { expectedRevision: 0, upserts: actions }, { kind: 'text', messageId: 'm1' }, nowMs); }
const ref = (action, field) => ({ $ref: `${action}.${field}` });
function prepare(f, actions, extra = {}) { return prepareCommands({ db: f.db, transaction: f.transaction, draft: draft(actions), identity: { uid: 'staff1' }, nowMs, publicOrigin: 'http://localhost:9000', ...extra }); }

test('replacing a guardian list preserves company contacts and review retains original contacts', async () => {
    const contacts = { guardians: [{ name: 'Mai', phone: '123', email: null }], companies: [{ name: 'Company', email: 'company@example.test', phone: null }] };
    const f = fixture({ 'crmStudents/s1': { name: 'Lan', contacts } });
    const result = await prepare(f, [{ actionId: 'student', kind: 'updateStudent', values: { studentId: 's1', contacts: { guardians: [{ name: 'Mai', phone: '456' }] } } }]);
    const write = result.plan.writes.find(item => item.path === 'crmStudents/s1');
    assert.deepEqual(write.data.contacts.companies, contacts.companies);
    assert.equal(write.data.contacts.guardians[0].phone, '456');
    assert.deepEqual(write.before.contacts, contacts);
});

test('new agent source assignments require a current active source and bind the record read', async () => {
    const action = { actionId: 'student', kind: 'createStudent', values: { name: 'Lan', agentSourceId: 'a1' } };
    for (const source of [undefined, { status: 'inactive' }, { status: 'active', deletedAt: 123 }]) {
        const f = fixture(source ? { 'crmAgentSources/a1': source } : {});
        await assert.rejects(prepare(f, [action]), error => error.code === 'AGENT_SOURCE_UNAVAILABLE');
        assert.equal(f.calls.some(call => call[0] === 'write'), false);
    }
    const f = fixture({ 'crmAgentSources/a1': { name: 'Agency', status: 'active' } });
    const result = await prepare(f, [action]);
    assert.ok(result.plan.reads.documents.some(read => read.path === 'crmAgentSources/a1'));
    f.rows.set('crmAgentSources/a1', { name: 'Agency', status: 'inactive' });
    await assert.rejects(prepare(f, [action]), error => error.code === 'AGENT_SOURCE_UNAVAILABLE');
});

test('editing a student may preserve an inactive historical source or explicitly clear it', async () => {
    for (const agentSourceId of ['a1', null]) {
        const f = fixture({ 'crmStudents/s1': { name: 'Lan', agentSourceId: 'a1' }, 'crmAgentSources/a1': { name: 'Agency', status: 'inactive' } });
        const result = await prepare(f, [{ actionId: 'student', kind: 'updateStudent', values: { studentId: 's1', notes: 'Updated', agentSourceId } }]);
        const student = result.plan.writes.find(write => write.path === 'crmStudents/s1').data;
        assert.equal(student.agentSourceId, agentSourceId);
    }
});

test('padded converted stages cannot bypass the canonical conversion action', async () => {
    for (const stage of ['converted', ' converted ', '\tconverted\n']) {
        for (const kind of ['createLead', 'updateLead']) {
            const f = fixture({ 'crmLeads/l1': { name: 'Lan', source: 'facebook', stage: 'new' } });
            const values = kind === 'createLead' ? { name: 'Lan', source: 'facebook', stage } : { leadId: 'l1', stage };
            await assert.rejects(prepare(f, [{ actionId: 'lead', kind, values }]), error => error.code === 'VALIDATION_ERROR' && /conversion action/i.test(error.message));
            assert.equal(f.calls.some(call => call[0] === 'write'), false);
        }
    }
    const f = fixture({ 'crmLeads/l1': { name: 'Lan', source: 'facebook', stage: 'converted', studentId: 's1' } });
    const plan = await prepare(f, [{ actionId: 'lead', kind: 'updateLead', values: { leadId: 'l1', stage: ' converted ', notes: 'Existing link retained' } }]);
    const lead = plan.plan.writes.find(write => write.path === 'crmLeads/l1').data;
    assert.equal(lead.stage, 'converted'); assert.equal(lead.studentId, 's1');
});

test('teacher assignment reads current eligible account and binds it into review', async () => {
    const initial = { 'users/t1': { isTeacher: true }, 'crmClassrooms/c1': { primaryTeacherUid: 't1', scheduleConfig: { sessionMinutes: 60, targetSessionCount: 1, timezone: 'Asia/Ho_Chi_Minh' } } };
    const actions = [{ actionId: 'schedule', kind: 'seedClassSchedule', values: { classId: 'c1', startDate: '2026-09-08', weekdayNumbers: [2], startTime: '18:00' } }];
    const f = fixture(initial);
    const result = await prepare(f, actions);
    assert.ok(result.plan.reads.documents.some(read => read.path === 'users/t1'));
    assert.equal(f.calls.some(call => call[0] === 'write'), false);
    const sessions = result.plan.writes.filter(write => write.path.startsWith('crmScheduledSessions/'));
    assert.equal(sessions.length, 1); assert.equal(sessions[0].data.teacherUid, 't1');
    f.rows.set('users/t1', { isTeacher: false });
    await assert.rejects(prepare(f, actions), error => error.code === 'TEACHER_UNAVAILABLE');
    assert.equal(f.calls.some(call => call[0] === 'write'), false);
});

test('invalid explicit teachers fail before any business write', async () => {
    for (const account of [undefined, { isStudent: true }, { isTeacher: true, disabled: true }, { crmRole: 'teacher', deletedAt: 123 }]) {
        const f = fixture({ 'crmClassrooms/c1': { primaryTeacherUid: 't1' }, ...(account ? { 'users/t1': account } : {}) });
        await assert.rejects(prepare(f, [{ actionId: 'enroll', kind: 'createEnrollment', values: { studentId: 's1', classId: 'c1', teacherUid: 't1' } }]), error => error.code === 'TEACHER_UNAVAILABLE');
        assert.equal(f.calls.some(call => call[0] === 'write'), false);
    }
});

test('existing class enrollment cannot silently ignore a conflicting teacher selection', async () => {
    const f = fixture({ 'users/t2': { crmRole: 'teacher' }, 'crmStudents/s1': { name: 'Lan' }, 'crmClassrooms/c1': { primaryTeacherUid: 't1' } });
    await assert.rejects(prepare(f, [{ actionId: 'enroll', kind: 'createEnrollment', values: { studentId: 's1', classId: 'c1', teacherUid: 't2' } }]), error => error.code === 'TEACHER_CLASS_MISMATCH');
    assert.equal(f.calls.some(call => call[0] === 'write'), false);
});

test('incomplete command errors carry exact correction fields before any business reads or writes', async () => {
    const f = fixture({});
    let reads = 0, writes = 0;
    f.transaction.get = async () => { reads++; throw new Error('Unexpected business read'); };
    f.transaction.set = () => { writes++; throw new Error('Unexpected business write'); };
    await assert.rejects(prepare(f, [{ actionId: 'lead', kind: 'createLead', values: { name: 'Lan', dateOfBirth: 'next Friday' } }]), error => {
        assert.equal(error.code, 'DRAFT_INCOMPLETE');
        assert.deepEqual(error.details.issues, [{ code: 'REQUIRED_FIELD', actionId: 'lead', field: 'source' }, { code: 'CLARIFY_DATE', actionId: 'lead', field: 'dateOfBirth' }]);
        assert.equal(JSON.stringify(error.details).includes('next Friday'), false);
        return true;
    });
    assert.equal(reads, 0); assert.equal(writes, 0);
});

test('one reviewed operation prepares lead, conversion, test, enrollment, invoice and payment', async () => {
    const f = fixture({ 'crmClassrooms/c1': { name: 'Class', status: 'active' } });
    const token = 'a'.repeat(48);
    const result = await prepare(f, [
        { actionId: 'lead', kind: 'createLead', values: { name: 'Lan', source: 'facebook' } },
        { actionId: 'convert', kind: 'convertLead', values: { leadId: ref('lead', 'leadId') } },
        { actionId: 'test', kind: 'createEntranceTest', values: { studentId: ref('convert', 'studentId'), testType: 'entrance_test_36plus_v1' } },
        { actionId: 'enroll', kind: 'createEnrollment', values: { studentId: ref('convert', 'studentId'), classId: 'c1' } },
        { actionId: 'invoice', kind: 'createInvoice', values: { studentId: ref('convert', 'studentId'), enrollmentId: ref('enroll', 'enrollmentId'), amount: 100, discount: 10 } },
        { actionId: 'payment', kind: 'recordPayment', values: { studentId: ref('convert', 'studentId'), invoiceId: ref('invoice', 'invoiceId'), amount: 90, paidAt: '2026-09-07', reference: 'TX-123' } }
    ], { testTokens: { test: token } });
    assert.equal(f.rows.size, 1);
    assert.equal(result.results.test.testId, hashTokenToTestId(token));
    assert.equal(result.results.convert.studentLink, '/crm-admin#students/a0001');
    assert.equal(result.results.test.testLink, `http://localhost:9000/entrance-test.html?token=${token}`);
    await result.flush();
    const invoice = f.rows.get(`crmInvoices/${result.results.invoice.invoiceId}`);
    assert.equal(invoice.netAmount, 90); assert.equal(invoice.paidAmount, 90); assert.equal(invoice.status, 'paid');
    const payment = f.rows.get(`crmPayments/${result.results.payment.paymentId}`);
    assert.equal(payment.reference, 'TX-123'); assert.equal(payment.paymentDate, '2026-09-07');
    assert.equal(payment.enrollmentId, result.results.enroll.enrollmentId);
    assert.equal(f.rows.get(`crmStudents/${result.results.convert.studentId}`).lifecycleStage, 'enrolled');
    assert.equal(f.rows.get(`entranceTests/${hashTokenToTestId(token)}`).studentId, result.results.convert.studentId);
});

test('student links use persisted CRM IDs, including existing converted students, and omit invalid legacy IDs', async () => {
    for (const crmId of ['B0042', 'javascript:alert(1)', null]) {
        const f = fixture({ 'crmLeads/l1': { name: 'Lan', studentId: 'document-id' }, 'crmStudents/document-id': { name: 'Lan', crmId } });
        const result = await prepare(f, [{ actionId: 'convert', kind: 'convertLead', values: { leadId: 'l1' } }]);
        assert.equal(result.results.convert.studentId, 'document-id');
        assert.equal(result.results.convert.studentLink, crmId === 'B0042' ? '/crm-admin#students/b0042' : undefined);
    }
});

test('multiple proposed payments calculate one coherent invoice total', async () => {
    const f = fixture({ 'crmStudents/s1': { name: 'Lan' }, 'crmInvoices/i1': { studentId: 's1', amount: 100, netAmount: 100, currency: 'VND', status: 'open' } });
    const result = await prepare(f, [
        { actionId: 'p1', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 40 } },
        { actionId: 'p2', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 60 } }
    ]);
    await result.flush();
    assert.equal(f.rows.get('crmInvoices/i1').paidAmount, 100);
    assert.equal(f.rows.get('crmInvoices/i1').status, 'paid');
    assert.equal([...f.rows.keys()].filter(path => path.startsWith('crmPayments/')).length, 2);
});

test('invoice and payment linkage mismatches abort the entire proposed operation', async () => {
    for (const action of [
        { actionId: 'i', kind: 'createInvoice', values: { studentId: 's1', enrollmentId: 'e2', amount: 100 } },
        { actionId: 'p', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i2', amount: 100 } }
    ]) {
        const f = fixture({ 'crmStudents/s1': { name: 'Lan' }, 'crmEnrollments/e2': { studentId: 's2' }, 'crmInvoices/i2': { studentId: 's2', amount: 100, netAmount: 100 } });
        await assert.rejects(prepare(f, [action]), error => /MISMATCH/.test(error.code));
        assert.equal(f.rows.size, 3);
    }
});

test('server time and identities make unchanged command plans reproducible', async () => {
    const initial = { 'crmStudents/s1': { name: 'Lan', linked_user_ids: ['u1'] }, 'crmInvoices/i1': { studentId: 's1', amount: 100, netAmount: 100, status: 'open' } };
    const actions = [{ actionId: 'update', kind: 'updateStudent', values: { studentId: 's1', notes: 'Changed' } }, { actionId: 'pay', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 10 } }];
    const a = await prepare(fixture(initial), actions), b = await prepare(fixture(initial), actions);
    assert.deepEqual(a.plan, b.plan);
});

test('incomplete drafts and another actor cannot prepare business commands', async () => {
    const f = fixture();
    await assert.rejects(prepare(f, [{ actionId: 'lead', kind: 'createLead', values: { name: 'Lan' } }]), error => error.code === 'DRAFT_INCOMPLETE');
    await assert.rejects(prepare(f, [{ actionId: 'lead', kind: 'createLead', values: { name: 'Lan', source: 'facebook' } }], { identity: { uid: 'other' } }), error => error.code === 'FORBIDDEN');
    assert.equal(f.rows.size, 0);
});

test('payment precision comes from the invoice currency even when omitted by the operator', async () => {
    const f = fixture({ 'crmStudents/s1': { name: 'Lan' }, 'crmInvoices/i1': { studentId: 's1', currency: 'USD', amount: 10.25, netAmount: 10.25, status: 'open' } });
    const result = await prepare(f, [{ actionId: 'pay', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 10.25 } }]);
    await result.flush();
    assert.equal(f.rows.get(`crmPayments/${result.results.pay.paymentId}`).amount, 10.25);
    assert.equal(f.rows.get('crmInvoices/i1').status, 'paid');
});

test('agent commission is created only on the transition to fully paid', async () => {
    const f = fixture({ 'crmStudents/s1': { name: 'Lan' }, 'crmInvoices/i1': { studentId: 's1', amount: 100, netAmount: 100, status: 'open', agentSourceId: 'a1', agentCommissionBps: 1000 } });
    const result = await prepare(f, [
        { actionId: 'p1', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 40 } },
        { actionId: 'p2', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 60 } }
    ]);
    await result.flush();
    const commissions = [...f.rows.entries()].filter(([path]) => path.startsWith('crmCommissions/')).map(([, data]) => data);
    assert.equal(commissions.length, 1);
    assert.equal(commissions[0].role, 'agent_source');
    assert.equal(commissions[0].amount, 10);
});
