const assert = require('assert');
const {
    buildAgentSourceCreateData,
    buildAgentSourcePatchData,
    mapAgentSourceRecord
} = require('../../functions/src/crm/agent-source-service');

const context = {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
};

// Test create
const created = buildAgentSourceCreateData({
    name: 'Agent Alpha',
    status: 'active',
    notes: 'Premium partner',
    courseRates: {
        'course-1': 1500,
        'course-2': '1250',
        '  course-3  ': '999.6'
    }
}, context);

assert.strictEqual(created.name, 'Agent Alpha');
assert.strictEqual(created.status, 'active');
assert.deepStrictEqual(created.courseRates, {
    'course-1': 1500,
    'course-2': 1250,
    'course-3': 1000
});

// Test patch
const patched = buildAgentSourcePatchData(created, {
    courseRates: {
        'course-1': 1800,
        'course-3': 1000
    }
}, context);

assert.deepStrictEqual(patched.courseRates, {
    'course-1': 1800,
    'course-3': 1000
});

// Test map
const mapped = mapAgentSourceRecord({
    id: 'agent-1',
    ...patched
});

assert.strictEqual(mapped.agentSourceId, 'agent-1');
assert.deepStrictEqual(mapped.courseRates, {
    'course-1': 1800,
    'course-3': 1000
});

assert.throws(
    () => buildAgentSourceCreateData({
        name: 'Bad Blank Course',
        courseRates: { ' ': 1000 }
    }, context),
    /course id/i
);

assert.throws(
    () => buildAgentSourceCreateData({
        name: 'Bad High Rate',
        courseRates: { 'course-1': 10001 }
    }, context),
    /between 0 and 10000/i
);

assert.throws(
    () => buildAgentSourcePatchData(created, {
        courseRates: { 'course-1': 'not-a-rate' }
    }, context),
    /must be a number/i
);

console.log('agent source service unit tests passed');
