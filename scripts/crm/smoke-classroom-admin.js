const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    buildClassroomCreateData,
    buildClassroomPatchData,
    computeMissingReviewItems,
    mapClassroomMembers
} = require('../../functions/src/crm/course-service');

function loadBrowserHelper(relativePath, globalName) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.window[globalName];
}

const classroomHelper = loadBrowserHelper('public/js/crm/classrooms.js', 'CrmClassrooms');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

const payload = classroomHelper.buildPayload({
    inputClassroomTotalHours: { value: '24' },
    inputClassroomPrimaryTeacher: { value: 'teacher-1' },
    inputClassroomSessionMinutes: { value: '90' },
    inputClassroomScheduleTimezone: { value: 'Asia/Bangkok' },
    inputClassroomSeedStartDate: { value: '2026-03-10' },
    inputClassroomSeedStartTime: { value: '09:00' },
    inputClassroomSeedWeekdays: { value: '1,3,5' },
    inputClassroomAllowedStartTime: { value: '07:00' },
    inputClassroomAllowedEndTime: { value: '21:00' },
    inputClassroomDurationStep: { value: '30' },
    inputClassroomName: { value: 'B1 Evening 2026' },
    inputClassroomCourseId: {
        value: 'course-1',
        selectedOptions: [
            {
                dataset: {
                    totalMinutes: '1440',
                    defaultSessionMinutes: '90',
                    durationStepMinutes: '30',
                    timezone: 'Asia/Bangkok'
                }
            }
        ]
    },
    inputClassroomStatus: { value: 'active' }
});

const created = buildClassroomCreateData(payload, context);
const patched = buildClassroomPatchData(created, {
    status: 'archived'
}, context);
const members = mapClassroomMembers([
    { id: 'uid-1', studentId: 'student-1', studentName: 'Alice' }
]);
const missing = computeMissingReviewItems({
    classworks: [{ id: 'work-1', title: 'Unit 1 Speaking Task' }],
    submissions: [],
    members
});

assert.strictEqual(created.name, 'B1 Evening 2026');
assert.strictEqual(created.courseId, 'course-1');
assert.strictEqual(patched.status, 'archived');
assert.strictEqual(missing.length, 1);
assert.strictEqual(missing[0].studentName, 'Alice');

console.log('classroom admin smoke passed');
