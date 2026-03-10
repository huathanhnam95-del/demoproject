const assert = require('assert');
const {
    ACTIVITY_TYPES,
    TASK_STATUSES,
    buildActivityCreateData,
    buildTaskCreateData,
    buildTaskPatchData,
    mapActivityRecord,
    mapTaskRecord,
    summarizeTasks
} = require('../../functions/src/crm/activity-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS',
    now: () => new Date('2026-03-10T09:00:00.000Z')
};

assert.deepStrictEqual(ACTIVITY_TYPES, [
    'note',
    'call',
    'email',
    'zalo',
    'facebook',
    'meeting',
    'system'
]);

assert.deepStrictEqual(TASK_STATUSES, [
    'open',
    'done',
    'canceled'
]);

const activity = buildActivityCreateData({
    leadId: 'lead-1',
    type: 'email',
    subject: 'Initial outreach',
    body: 'Shared intake form.'
}, context);

assert.strictEqual(activity.leadId, 'lead-1');
assert.strictEqual(activity.type, 'email');
assert.strictEqual(activity.actorUid, 'admin-1');
assert.strictEqual(activity.createdAt, 'SERVER_TS');

const task = buildTaskCreateData({
    studentId: 'student-1',
    title: 'Follow up after placement test',
    dueAt: '2026-03-11T08:00:00.000Z',
    priority: 'high'
}, context);

assert.strictEqual(task.studentId, 'student-1');
assert.strictEqual(task.status, 'open');
assert.strictEqual(task.priority, 'high');
assert.strictEqual(task.ownerUid, 'admin-1');

const completedTask = buildTaskPatchData(task, {
    status: 'done'
}, context);

assert.strictEqual(completedTask.status, 'done');
assert.strictEqual(completedTask.completedAt, 'SERVER_TS');
assert.strictEqual(completedTask.updatedBy, 'admin-1');

const mappedActivity = mapActivityRecord({ id: 'activity-1', ...activity });
assert.strictEqual(mappedActivity.activityId, 'activity-1');
assert.strictEqual(mappedActivity.subject, 'Initial outreach');

const mappedTask = mapTaskRecord({ id: 'task-1', ...task });
assert.strictEqual(mappedTask.taskId, 'task-1');
assert.strictEqual(mappedTask.title, 'Follow up after placement test');

const summary = summarizeTasks([
    mapTaskRecord({
        id: 'task-overdue',
        leadId: 'lead-1',
        title: 'Past due call',
        status: 'open',
        priority: 'medium',
        dueAt: '2026-03-08T08:00:00.000Z'
    }),
    mapTaskRecord({
        id: 'task-next',
        leadId: 'lead-1',
        title: 'Next call',
        status: 'open',
        priority: 'medium',
        dueAt: '2026-03-11T08:00:00.000Z'
    }),
    mapTaskRecord({
        id: 'task-done',
        leadId: 'lead-1',
        title: 'Completed',
        status: 'done',
        priority: 'low',
        dueAt: '2026-03-09T08:00:00.000Z'
    })
], context.now());

assert.strictEqual(summary.openCount, 2);
assert.strictEqual(summary.overdueCount, 1);
assert.strictEqual(summary.nextActionAt, '2026-03-08T08:00:00.000Z');

assert.throws(
    () => buildActivityCreateData({ type: 'note', body: 'Missing entity ref' }, context),
    /Activity must be linked/
);

assert.throws(
    () => buildTaskCreateData({ leadId: 'lead-1' }, context),
    /Task title is required/
);

assert.throws(
    () => buildTaskPatchData(task, {}, context),
    /No task fields provided/
);

console.log('activity service passed');
