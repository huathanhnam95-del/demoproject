const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    buildActivityCreateData,
    buildTaskCreateData,
    mapActivityRecord,
    mapTaskRecord,
    summarizeTasks
} = require('../../functions/src/crm/activity-service');

function loadBrowserHelper(relativePath, globalName) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.window[globalName];
}

const helper = loadBrowserHelper('public/js/crm/activities.js', 'CrmActivities');
const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

const taskPayload = helper.buildTaskPayload({
    inputTaskTitle: { value: 'Call back prospect' },
    inputTaskDueAt: { value: '2026-03-11T09:00' },
    inputTaskPriority: { value: 'high' }
});

const activityPayload = helper.buildActivityPayload({
    inputActivityType: { value: 'call' },
    inputActivitySubject: { value: 'Discovery call' },
    inputActivityBody: { value: 'Discussed placement test timing.' }
});

const task = mapTaskRecord(buildTaskCreateData({
    leadId: 'lead-1',
    ...taskPayload
}, context), 'task-1');

const activity = mapActivityRecord(buildActivityCreateData({
    leadId: 'lead-1',
    ...activityPayload
}, context), 'activity-1');

const summary = summarizeTasks([task], new Date('2026-03-10T09:00:00.000Z'));

assert.strictEqual(task.title, 'Call back prospect');
assert.strictEqual(activity.type, 'call');
assert.strictEqual(summary.openCount, 1);
assert.strictEqual(helper.getBadgeLabel(summary), 'Next action due');

console.log('activity timeline smoke passed');
