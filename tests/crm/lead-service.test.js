const assert = require('assert');
const {
    buildLeadCreateData,
    buildLeadPatchData,
    buildLeadConversion,
    mapLeadRecord,
    LEAD_STAGES
} = require('../../functions/src/crm/lead-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

assert.deepStrictEqual(LEAD_STAGES, [
    'new',
    'contacted',
    'test_scheduled',
    'test_completed',
    'counseling',
    'trial',
    'won',
    'lost'
]);

const created = buildLeadCreateData({
    name: 'Lead Nguyen',
    email: 'lead@example.com',
    source: 'facebook',
    probability: 40,
    nextActionAt: '2026-03-12',
    lastContactAt: '2026-03-10'
}, context);

assert.strictEqual(created.stage, 'new');
assert.strictEqual(created.source, 'facebook');
assert.strictEqual(created.ownerUid, 'admin-1');
assert.strictEqual(created.probability, 40);

const patched = buildLeadPatchData(created, {
    stage: 'test_completed',
    lossReason: 'budget',
    probability: 65
}, context);

assert.strictEqual(patched.stage, 'test_completed');
assert.strictEqual(patched.lossReason, 'budget');
assert.strictEqual(patched.probability, 65);

const conversion = buildLeadConversion({
    leadId: 'lead-1',
    lead: {
        ...patched,
        name: 'Lead Nguyen',
        email: 'lead@example.com',
        phone: '01234',
        zalo: 'lead-zalo',
        facebook: 'lead.fb',
        source: 'facebook'
    },
    context
});

assert.strictEqual(conversion.student.acquisitionSource, 'facebook');
assert.strictEqual(conversion.student.leadId, 'lead-1');
assert.strictEqual(conversion.student.lifecycleStage, 'enrolled');
assert.strictEqual(conversion.leadPatch.stage, 'converted');
assert.strictEqual(conversion.leadPatch.studentId, 'PENDING_STUDENT_ID');

const mapped = mapLeadRecord({ id: 'lead-1', ...patched });
assert.strictEqual(mapped.leadId, 'lead-1');
assert.strictEqual(mapped.stage, 'test_completed');

assert.throws(
    () => buildLeadCreateData({}, context),
    /Please fill at least 1 lead contact field/
);

assert.throws(
    () => buildLeadPatchData(created, { stage: 'invalid' }, context),
    /Invalid lead stage/
);

console.log('lead service passed');
