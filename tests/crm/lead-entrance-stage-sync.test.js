const assert = require('assert');
const { buildLeadStageSyncPatch } = require('../../functions/src/crm/lead-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

const baseLead = {
    leadId: 'lead-1',
    stage: 'contacted',
    notes: 'keep this note'
};

const scheduledPatch = buildLeadStageSyncPatch(baseLead, 'test_scheduled', context);
assert.strictEqual(scheduledPatch.stage, 'test_scheduled');
assert.strictEqual(scheduledPatch.notes, 'keep this note');
assert.strictEqual(scheduledPatch.updatedAt, 'SERVER_TS');
assert.strictEqual(scheduledPatch.updatedBy, 'admin-1');
assert.strictEqual(baseLead.stage, 'contacted');

const completedPatch = buildLeadStageSyncPatch(
    {
        leadId: 'lead-1',
        stage: 'test_scheduled'
    },
    'test_completed',
    context
);
assert.strictEqual(completedPatch.stage, 'test_completed');

const regressionPatch = buildLeadStageSyncPatch(
    {
        leadId: 'lead-1',
        stage: 'test_completed'
    },
    'test_scheduled',
    context
);
assert.strictEqual(regressionPatch, null, 'stage sync must not move a lead backward');

const sameStagePatch = buildLeadStageSyncPatch(
    {
        leadId: 'lead-1',
        stage: 'test_completed'
    },
    'test_completed',
    context
);
assert.strictEqual(sameStagePatch, null, 'stage sync should be a no-op when already at target stage');

console.log('lead entrance stage sync passed');
