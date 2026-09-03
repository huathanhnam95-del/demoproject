const assert = require('assert');
const {
    buildCourseCreateData,
    buildCoursePatchData,
    buildClassroomCreateData,
    buildClassroomPatchData,
    buildEmptyScheduleSummary,
    computeMissingReviewItems,
    mapClassroomMembers,
    mapCourseRecord,
    normalizeCommissionBps
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
    courseType: '1on1',
    durationDays: 60,
    agentCommissionBps: 850,
    teachers: ['Teacher@One.com', 'teacher2@example.com'],
    deliveryTemplate: {
        totalHours: 24,
        defaultSessionMinutes: 90,
        timezone: 'Asia/Bangkok'
    }
}, context);
assert.strictEqual(course.name, 'PTE Foundation');
assert.strictEqual(course.courseType, '1on1');
assert.strictEqual(course.durationDays, 60);
assert.strictEqual(course.agentCommissionBps, 850);
assert.deepStrictEqual(course.teachers, ['teacher@one.com', 'teacher2@example.com']);
assert.deepStrictEqual(course.deliveryTemplate, {
    totalInstructionMinutes: 1440,
    defaultSessionMinutes: 90,
    timezone: 'Asia/Bangkok',
    durationStepMinutes: 30
});

const patchedCourse = buildCoursePatchData(course, {
    status: 'inactive',
    agentCommissionBps: 1200,
    teachers: ['mentor@example.com'],
    deliveryTemplate: {
        totalHours: 30,
        defaultSessionMinutes: 120,
        timezone: 'Asia/Bangkok',
        durationStepMinutes: 60
    }
}, context);
assert.strictEqual(patchedCourse.status, 'inactive');
assert.strictEqual(patchedCourse.agentCommissionBps, 1200);
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
    nextScheduledAt: null,
    contractedMinutesTotal: 1440,
    contractedMinutesDelivered: 0,
    contractedMinutesRemaining: 1440
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

// Verify that patching scheduleConfig preserves existing completed counts & delivered minutes
const classroomWithHistory = {
    ...classroom,
    scheduleSummary: {
        contractedTargetCount: 16,
        contractedAssignedCount: 16,
        contractedCompletedCount: 5,
        remainingToScheduleCount: 0,
        overflowCount: 1,
        nextScheduledAt: '2026-04-01T09:00:00.000Z',
        contractedMinutesTotal: 1440,
        contractedMinutesDelivered: 450,
        contractedMinutesRemaining: 990
    }
};
const patchedWithHistory = buildClassroomPatchData(classroomWithHistory, {
    scheduleConfig: {
        totalInstructionMinutes: 1440,
        sessionMinutes: 120,
        targetSessionCount: 12
    }
}, context);
assert.strictEqual(patchedWithHistory.scheduleSummary.contractedTargetCount, 12);
assert.strictEqual(patchedWithHistory.scheduleSummary.contractedCompletedCount, 5);
assert.strictEqual(patchedWithHistory.scheduleSummary.contractedMinutesDelivered, 450);
assert.strictEqual(patchedWithHistory.scheduleSummary.contractedMinutesRemaining, 990);


const mappedCourse = mapCourseRecord({
    id: 'course-1',
    name: 'PTE Foundation',
    agentCommissionBps: 975
});
assert.strictEqual(mappedCourse.courseId, 'course-1');
assert.strictEqual(mappedCourse.agentCommissionBps, 975);

assert.strictEqual(normalizeCommissionBps(12.4), 12);
assert.strictEqual(normalizeCommissionBps('250'), 250);
assert.strictEqual(normalizeCommissionBps(null), null);
assert.throws(() => normalizeCommissionBps(-1), /between 0 and 10000/);
assert.throws(() => normalizeCommissionBps(10001), /between 0 and 10000/);

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

// Course type / duration days ------------------------------------------------

assert.throws(
    () => buildCourseCreateData({ name: 'No Type' }, context),
    /course type/i,
    'courseType is required on create'
);
assert.throws(
    () => buildCourseCreateData({ name: 'Bad Type', courseType: 'group' }, context),
    /Invalid course type/,
    'courseType is validated against the enum'
);
assert.throws(
    () => buildCourseCreateData({ name: 'Bad Days', courseType: '1on1', durationDays: 0 }, context),
    /positive integer/,
    'durationDays must be a positive integer'
);

// durationDays is optional — such courses just require an explicit end date at enrolment.
const noDuration = buildCourseCreateData({ name: 'Pronunciation', courseType: 'pronun' }, context);
assert.strictEqual(noDuration.courseType, 'pronun');
assert.strictEqual(noDuration.durationDays, null);

// Patch does not require courseType, so legacy courses can still be edited pre-migration.
const patchedType = buildCoursePatchData(course, { courseType: 'pronun', durationDays: 90 }, context);
assert.strictEqual(patchedType.courseType, 'pronun');
assert.strictEqual(patchedType.durationDays, 90);
const patchedOther = buildCoursePatchData({ name: 'Legacy' }, { status: 'inactive' }, context);
assert.strictEqual(patchedOther.status, 'inactive');

// Reads tolerate legacy documents that predate both fields.
const legacyRecord = mapCourseRecord({ name: 'Legacy', courseType: 'nonsense', durationDays: -5 }, 'course-legacy');
assert.strictEqual(legacyRecord.courseType, null);
assert.strictEqual(legacyRecord.durationDays, null);

// Case-insensitivity and trailing period toleration
const dotTypeRecord = buildCourseCreateData({ name: 'Coaching', courseType: 'Pronun.', durationDays: '45' }, context);
assert.strictEqual(dotTypeRecord.courseType, 'pronun');
assert.strictEqual(dotTypeRecord.durationDays, 45);

const caseTypeRecord = buildCourseCreateData({ name: 'Tutoring', courseType: '1On1' }, context);
assert.strictEqual(caseTypeRecord.courseType, '1on1');

// buildEmptyScheduleSummary without config returns full 0 minutes summary
const emptySummary = buildEmptyScheduleSummary(null);
assert.strictEqual(emptySummary.contractedMinutesTotal, 0);
assert.strictEqual(emptySummary.contractedMinutesDelivered, 0);
assert.strictEqual(emptySummary.contractedMinutesRemaining, 0);

console.log('course classroom service passed');
