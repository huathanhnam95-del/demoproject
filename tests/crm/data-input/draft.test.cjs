'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDraft, applyChanges, inspectDraft, digestDraft } = require('../../../functions/src/crm/data-input/draft-service');
const now = Date.parse('2026-09-07T15:00:00Z');
const source = { kind: 'text', messageId: 'message-1' };
const fresh = () => createDraft({ draftId: 'draft-1', actorUid: 'staff-1', now });
const change = (draft, upserts, provenance = source) => applyChanges(draft, { expectedRevision: draft.revision, upserts }, provenance, now);

test('full-form corrections preserve unchanged field sources and image involvement', () => {
    const first = change(fresh(), [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan', email: 'lan@example.test' } }], { kind: 'image', messageId: 'image-1', attachmentId: 'a1' });
    const corrected = change(first, [{ actionId: 'student', values: { name: 'Mai', email: 'lan@example.test' } }]);
    assert.equal(corrected.actions[0].provenance.name.kind, 'text');
    assert.equal(corrected.actions[0].provenance.email.kind, 'image');
    assert.deepEqual(corrected.actions[0].imageSources, ['a1']);
    const allCorrected = change(corrected, [{ actionId: 'student', values: { name: 'Mai', email: 'mai@example.test' } }]);
    assert.deepEqual(allCorrected.actions[0].imageSources, ['a1']);
    assert.equal(allCorrected.actions[0].provenance.email.kind, 'text');
    assert.throws(() => change(first, [{ actionId: 'student', values: { name: 'Mai' }, imageSources: [] }]), /action properties/i);
});

test('model clarification and lookups block review; manual corrections clear only addressed questions', () => {
    const draft = change(fresh(), [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan' } }]);
    draft.interpretationQuestions = [{ actionId: 'student', field: 'name', text: 'Confirm spelling.' }, { actionId: 'student', field: 'learningProfile.testResultDueDate', text: 'Confirm deadline.' }];
    assert.equal(inspectDraft(draft).readyForPreview, false);
    const unrelated = change(draft, [{ actionId: 'student', values: { learningProfile: { overall: 65 } } }]);
    assert.equal(unrelated.interpretationQuestions.length, 2);
    const corrected = change(unrelated, [{ actionId: 'student', values: { name: 'Lân', learningProfile: { testResultDueDate: '2026-09-10' } } }]);
    assert.deepEqual(corrected.interpretationQuestions, []);
    assert.equal(inspectDraft(corrected).readyForPreview, true);
    corrected.pendingLookups = [{ kind: 'student', field: 'name', value: 'Lân' }];
    assert.equal(inspectDraft(corrected).questions[0].code, 'RECORD_LOOKUP_REQUIRED');
    const before = digestDraft(corrected);
    corrected.pendingLookups = [];
    assert.notEqual(digestDraft(corrected), before);
});

test('ambiguous and impossible calendar dates become field questions without losing the supplied text', () => {
    for (const input of ['09/10/2026', 'tomorrow', '2026-02-30', '2026-13-01', '2026-09-01T00:00:00Z']) {
        const proposed = change(fresh(), [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan', dateOfBirth: input } }]);
        assert.deepEqual(inspectDraft(proposed).questions, [{ code: 'CLARIFY_DATE', actionId: 'student', field: 'dateOfBirth' }]);
        assert.equal(proposed.actions[0].values.dateOfBirth, input);
    }
    const valid = change(fresh(), [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan', dateOfBirth: '2024-02-29', learningProfile: { testResultDueDate: '2026-09-10' } } }]);
    assert.equal(inspectDraft(valid).readyForPreview, true);
    const nested = change(valid, [{ actionId: 'student', values: { learningProfile: { testResultDueDate: 'next Friday' } } }]);
    assert.equal(inspectDraft(nested).questions[0].field, 'learningProfile.testResultDueDate');
});

test('payment instants require an explicit offset and dates must precede enrollment end dates', () => {
    for (const value of ['2026-09-07', '2026-09-07T10:30:00+07:00', '2026-09-07T03:30:00.123Z']) {
        const proposed = change(fresh(), [{ actionId: 'pay', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 10.25, paidAt: value } }]);
        assert.equal(inspectDraft(proposed).readyForPreview, true);
    }
    for (const value of ['2026-09-07T10:30:00', '2026-02-30T10:30:00Z', '2026-09-07T25:30:00Z']) {
        const proposed = change(fresh(), [{ actionId: 'pay', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 10.25, paidAt: value } }]);
        assert.equal(inspectDraft(proposed).questions[0].field, 'paidAt');
    }
    const reversed = change(fresh(), [{ actionId: 'enroll', kind: 'createEnrollment', values: { studentId: 's1', classId: 'c1', startDate: '2026-09-10', endDate: '2026-09-09' } }]);
    assert.deepEqual(inspectDraft(reversed).errors, [{ code: 'DATE_ORDER', actionId: 'enroll', field: 'endDate' }]);
});

test('correction retains stable action identity and unrelated supplied context', () => {
    const first = change(fresh(), [{ actionId: 'student', kind: 'createStudent', values: { name: 'Lan', email: 'lan@example.test', targets: { exam: 'PTE', score: 65 } } }]);
    const next = change(first, [{ actionId: 'student', values: { name: 'Lân', targets: { score: 79 } } }], { kind: 'voice', messageId: 'message-2' });
    assert.equal(next.actions.length, 1);
    assert.deepEqual(next.actions[0].values, { name: 'Lân', email: 'lan@example.test', targets: { exam: 'PTE', score: 79 } });
    assert.equal(first.actions[0].values.name, 'Lan');
    assert.equal(next.actions[0].provenance.name.messageId, 'message-2');
    assert.equal(next.actions[0].provenance.email.messageId, 'message-1');
    assert.equal(next.revision, 2);
    assert.notEqual(digestDraft(first), digestDraft(next));
});

test('a correction cannot preserve an earlier review or confirmation capability', () => {
    const draft = change(fresh(), [{ actionId: 'lead', kind: 'createLead', values: { name: 'Lan' } }]);
    draft.preview = { digest: 'old', revision: 1 };
    draft.confirmation = { token: 'old' };
    const next = change(draft, [{ actionId: 'lead', values: { phone: '0123456789' } }]);
    assert.equal(next.preview, null);
    assert.equal(next.confirmation, null);
    assert.equal(next.status, 'draft');
    assert.throws(() => applyChanges(next, { expectedRevision: 1, upserts: [] }, source, now), /revision/i);
});

test('conversion and enrollment link draft outputs without payment or test prerequisites', () => {
    const draft = change(fresh(), [
        { actionId: 'lead', kind: 'createLead', values: { name: 'Lan', source: 'facebook' } },
        { actionId: 'convert', kind: 'convertLead', values: { leadId: { $ref: 'lead.leadId' } } },
        { actionId: 'enroll', kind: 'createEnrollment', values: { studentId: { $ref: 'convert.studentId' }, classId: 'class-1' } }
    ]);
    const inspection = inspectDraft(draft);
    assert.deepEqual(inspection.questions, []);
    assert.deepEqual(inspection.errors, []);
    assert.deepEqual(inspection.executionOrder, ['lead', 'convert', 'enroll']);
    assert.equal(inspection.readyForPreview, true);
});

test('only blocking missing fields become questions and optional details stay optional', () => {
    const draft = change(fresh(), [{ actionId: 'enroll', kind: 'createEnrollment', values: { studentId: 's1', courseId: 'course-1' } }]);
    assert.deepEqual(inspectDraft(draft).questions.map(q => q.field).sort(), ['slots', 'startDate']);
    const complete = change(draft, [{ actionId: 'enroll', values: { startDate: '2026-09-08', slots: [{ weekday: 2, startTime: '09:00', endTime: '10:00' }] } }]);
    assert.deepEqual(inspectDraft(complete).questions, []);
});

test('required questions match existing lead and student create contracts', () => {
    const lead = change(fresh(), [{ actionId: 'lead', kind: 'createLead', values: { name: 'Lan' } }]);
    assert.deepEqual(inspectDraft(lead).questions.map(q => q.field), ['source']);
    const enquiry = change(lead, [{ actionId: 'lead', values: { name: null, source: 'facebook', notes: 'Asked about the course' } }]);
    assert.deepEqual(inspectDraft(enquiry).questions, []);
    const student = change(fresh(), [{ actionId: 'student', kind: 'createStudent', values: { label: 'Walk-in enquiry' } }]);
    assert.deepEqual(inspectDraft(student).questions, []);
    const blank = change(student, [{ actionId: 'student', values: { label: '   ' } }]);
    assert.deepEqual(inspectDraft(blank).questions.map(q => q.field), ['name']);
});

test('untrusted proposals cannot create commands, permissions, confirmation or conversion linkage', () => {
    for (const kind of ['deleteStudent', 'runJavascript', 'confirm']) assert.throws(() => change(fresh(), [{ actionId: 'x', kind, values: {} }]), /action/i);
    for (const key of ['isAdmin', 'createdBy', 'confirmation', 'studentId']) assert.throws(() => change(fresh(), [{ actionId: 'lead', kind: 'createLead', values: { [key]: 'forged' } }]), /field/i);
    assert.throws(() => change(fresh(), [{ actionId: 'x', kind: 'createStudent', values: JSON.parse('{"name":"Lan","targets":{"__proto__":{"isAdmin":true}}}') }]), /unsafe/i);
    assert.throws(() => change(fresh(), [{ actionId: 'x', kind: 'createStudent', values: { name: 'Lan' } }], { kind: 'assistant', messageId: 'x' }), /source/i);
});

test('image transaction extraction retains provenance without asserting funds verification', () => {
    const draft = change(fresh(), [{ actionId: 'pay', kind: 'recordPayment', values: { studentId: 's1', invoiceId: 'i1', amount: 100000, method: 'bank_transfer' } }], { kind: 'image', messageId: 'm1', attachmentId: 'image-1' });
    assert.equal(draft.actions[0].provenance.amount.kind, 'image');
    assert.equal(draft.actions[0].values.bankVerified, undefined);
    assert.throws(() => change(draft, [{ actionId: 'pay', values: { bankVerified: true } }]), /field/i);
});

test('bad, incompatible, cyclic and removed references prevent preview', () => {
    const bad = change(fresh(), [{ actionId: 'x', kind: 'convertLead', values: { leadId: { $ref: 'missing.leadId' } } }]);
    assert.equal(inspectDraft(bad).readyForPreview, false);
    assert.equal(inspectDraft(bad).errors[0].code, 'INVALID_REFERENCE');
    const wrong = change(fresh(), [{ actionId: 'a', kind: 'createStudent', values: { name: 'A' } }, { actionId: 'b', kind: 'convertLead', values: { leadId: { $ref: 'a.studentId' } } }]);
    assert.equal(inspectDraft(wrong).errors[0].code, 'INVALID_REFERENCE');
    const self = change(fresh(), [{ actionId: 'a', kind: 'convertLead', values: { leadId: { $ref: 'a.leadId' } } }]);
    assert.equal(inspectDraft(self).readyForPreview, false);
    const removed = applyChanges(wrong, { expectedRevision: wrong.revision, removals: ['a'] }, source, now);
    assert.equal(inspectDraft(removed).errors[0].code, 'INVALID_REFERENCE');
});

test('expired, terminal and excessive drafts cannot be mutated', () => {
    assert.throws(() => applyChanges(fresh(), { expectedRevision: 0, upserts: [] }, source, now + 86400001), /expired/i);
    const draft = fresh(); draft.status = 'committed';
    assert.throws(() => change(draft, []), /committed/i);
    assert.throws(() => change(fresh(), Array.from({ length: 26 }, (_, i) => ({ actionId: `a${i}`, kind: 'createLead', values: { name: 'a' } }))), /limit/i);
    assert.throws(() => change(fresh(), [{ actionId: 'a', kind: 'createLead', values: { notes: 'a'.repeat(33000) } }]), /limit/i);
});

test('draft digest ignores object key order but binds actor and actual values', () => {
    const a = change(fresh(), [{ actionId: 'x', kind: 'createLead', values: { name: 'Lan', email: 'lan@example.test' } }]);
    const b = change(fresh(), [{ actionId: 'x', kind: 'createLead', values: { email: 'lan@example.test', name: 'Lan' } }]);
    assert.equal(digestDraft(a), digestDraft(b));
    b.actorUid = 'staff-2'; assert.notEqual(digestDraft(a), digestDraft(b));
});
