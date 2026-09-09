'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const scope = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../../public/js/crm/data-input/profile-editor.js'),'utf8'),scope);
const { patch } = scope.window.CrmDataInputProfileEditor;

test('contact loading clones complete authorized groups and rejects wrong identities or truncation', () => {
    const { contactListFromContext } = scope.window.CrmDataInputProfileEditor;
    const result = { status: 'resolved', record: { kind: 'student', id: 's1', values: { contacts: { guardians: [{ name: 'Mai', phone: '123' }] } }, truncatedFields: [] } };
    const list = contactListFromContext(result, 's1', 'guardians');
    list[0].phone = '456'; assert.equal(result.record.values.contacts.guardians[0].phone, '123');
    assert.throws(() => contactListFromContext(result, 's2', 'guardians'), /student/i);
    result.record.truncatedFields = ['contacts.guardians.0.name'];
    assert.throws(() => contactListFromContext(result, 's1', 'guardians'), /incomplete/i);
    assert.equal(contactListFromContext(result, 's1', 'companies').length, 0);
});
test('one learning-profile correction preserves supplied sibling scores and dates without mutation', () => {
    const original = { overall: 50, listening: 42, testResultDueDate: '2026-10-01', visaType: 'Student' };
    const next = patch('learningProfile', original, 'listening', '55.5');
    assert.equal(next.listening, 55.5); assert.equal(next.overall, 50); assert.equal(next.testResultDueDate, '2026-10-01'); assert.equal(next.visaType, 'Student');
    assert.equal(original.listening, 42);
});
test('optional zero scores remain zero, clearing is explicit null and unsupported fields fail', () => {
    assert.equal(patch('targets', { exam: 'PTE' }, 'score', '0').score, 0);
    const next=patch('targets', { exam: 'PTE', score: 65 }, 'score', ''); assert.equal(next.score,null); assert.equal(next.exam,'PTE');
    assert.equal(patch('learningProfile', {}, 'targetLevel', ' B2 ').targetLevel,'B2');
    assert.throws(()=>patch('targets',{},'score','Infinity'),/number/);
    assert.throws(()=>patch('learningProfile',{},'isAdmin','true'),/field/);
});
