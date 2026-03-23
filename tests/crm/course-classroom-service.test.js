const assert = require('assert');
const {
    buildCourseCreateData,
    buildCoursePatchData,
    buildClassroomCreateData,
    buildClassroomPatchData,
    computeMissingReviewItems,
    mapClassroomMembers
} = require('../../functions/src/crm/course-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

const course = buildCourseCreateData({
    name: 'PTE Foundation',
    teachers: ['Teacher@One.com', 'teacher2@example.com'],
    deliveryTemplate: {
        totalHours: 24,
        defaultSessionMinutes: 90,
        timezone: 'Asia/Bangkok'
    }
}, context);
assert.strictEqual(course.name, 'PTE Foundation');
assert.deepStrictEqual(course.teachers, ['teacher@one.com', 'teacher2@example.com']);
assert.deepStrictEqual(course.deliveryTemplate, {
    totalInstructionMinutes: 1440,
    defaultSessionMinutes: 90,
    timezone: 'Asia/Bangkok',
    durationStepMinutes: 30
});

const patchedCourse = buildCoursePatchData(course, {
    status: 'inactive',
    teachers: ['mentor@example.com'],
    deliveryTemplate: {
        totalHours: 30,
        defaultSessionMinutes: 120,
        timezone: 'Asia/Bangkok',
        durationStepMinutes: 60
    }
}, context);
assert.strictEqual(patchedCourse.status, 'inactive');
assert.deepStrictEqual(patchedCourse.teachers, ['mentor@example.com']);
assert.deepStrictEqual(patchedCourse.deliveryTemplate, {
    totalInstructionMinutes: 1800,
    defaultSessionMinutes: 120,
    timezone: 'Asia/Bangkok',
    durationStepMinutes: 60
});

const classroom = buildClassroomCreateData({
    name: 'B1 Evening 2026',
    courseId: 'course-1',
    primaryTeacherUid: 'teacher-1',
    scheduleConfig: {
        totalInstructionMinutes: 1440,
        sessionMinutes: 90,
        targetSessionCount: 16,
        timezone: 'Asia/Bangkok',
        planningStatus: 'needs_setup'
    }
}, context);
assert.strictEqual(classroom.name, 'B1 Evening 2026');
assert.strictEqual(classroom.courseId, 'course-1');
assert.strictEqual(classroom.primaryTeacherUid, 'teacher-1');
assert.deepStrictEqual(classroom.scheduleConfig, {
    totalInstructionMinutes: 1440,
    sessionMinutes: 90,
    targetSessionCount: 16,
    timezone: 'Asia/Bangkok',
    durationStepMinutes: 30,
    allowedStartTime: null,
    allowedEndTime: null,
    seedWeekdays: [],
    seedStartDate: null,
    seedStartTime: null,
    skipDates: [],
    planningStatus: 'needs_setup',
    scheduleVersion: 1,
    lastRegeneratedAt: null,
    lastRegeneratedBy: null,
    lastRegenerateFromDate: null
});
assert.deepStrictEqual(classroom.scheduleSummary, {
    contractedTargetCount: 16,
    contractedAssignedCount: 0,
    contractedCompletedCount: 0,
    remainingToScheduleCount: 16,
    overflowCount: 0,
    nextScheduledAt: null
});

const classroomWithoutExplicitTarget = buildClassroomCreateData({
    name: 'B2 Morning 2026',
    courseId: 'course-2',
    scheduleConfig: {
        totalInstructionMinutes: 1440,
        sessionMinutes: 120,
        timezone: 'Asia/Bangkok',
        planningStatus: 'needs_setup'
    }
}, context);
assert.strictEqual(classroomWithoutExplicitTarget.scheduleConfig.targetSessionCount, 12);

const patchedClassroom = buildClassroomPatchData(classroom, {
    status: 'active',
    scheduleConfig: {
        totalInstructionMinutes: 1440,
        sessionMinutes: 120,
        targetSessionCount: 12,
        timezone: 'Asia/Bangkok',
        planningStatus: 'configured'
    }
}, context);
assert.strictEqual(patchedClassroom.status, 'active');
assert.strictEqual(patchedClassroom.updatedBy, 'admin-1');
assert.deepStrictEqual(patchedClassroom.scheduleConfig, {
    totalInstructionMinutes: 1440,
    sessionMinutes: 120,
    targetSessionCount: 12,
    timezone: 'Asia/Bangkok',
    durationStepMinutes: 30,
    allowedStartTime: null,
    allowedEndTime: null,
    seedWeekdays: [],
    seedStartDate: null,
    seedStartTime: null,
    skipDates: [],
    planningStatus: 'configured',
    scheduleVersion: 1,
    lastRegeneratedAt: null,
    lastRegeneratedBy: null,
    lastRegenerateFromDate: null
});

const preservedTargetPatch = buildClassroomPatchData(classroom, {
    scheduleConfig: {
        totalInstructionMinutes: 1440,
        sessionMinutes: 120,
        timezone: 'Asia/Bangkok',
        planningStatus: 'configured'
    }
}, context);
assert.strictEqual(preservedTargetPatch.scheduleConfig.targetSessionCount, 16);
assert.strictEqual(preservedTargetPatch.scheduleConfig.scheduleVersion, 1);

const members = mapClassroomMembers([
    { id: 'uid-member-1', studentId: 'student-1', studentName: 'Alice' },
    { id: 'uid-member-2', studentId: 'student-2', studentName: 'Bao' }
]);

const missing = computeMissingReviewItems({
    classworks: [
        { id: 'work-1', title: 'Essay Draft' }
    ],
    submissions: [
        { id: 'sub-1', workId: 'work-1', studentUid: 'uid-member-1', status: 'turned-in' },
        { id: 'sub-unrelated', workId: 'work-1', studentUid: 'uid-outsider', status: 'turned-in' }
    ],
    members
});

assert.strictEqual(missing.length, 1);
assert.strictEqual(missing[0].studentUid, 'uid-member-2');
assert.strictEqual(missing[0].studentName, 'Bao');

console.log('course classroom service passed');
