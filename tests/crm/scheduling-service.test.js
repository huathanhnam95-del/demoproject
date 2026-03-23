const assert = require('assert');
const {
    buildAddSessionPreview,
    buildCanonicalScheduledWindow,
    buildRegenerationPreview,
    buildScheduledSessionWriteData,
    computeContractedTargetCount,
    buildScheduleSummary,
    buildSeedSessions,
    buildReplacementPlan,
    buildReplaceSessionPreview,
    normalizeScheduledSession,
    validateRemainingDurationChange,
    syncSessionLockStateFromAttendance
} = require('../../functions/src/crm/scheduling-service');
const {
    buildClassroomScheduleBackfill,
    buildScheduledSessionCanonicalBackfill
} = require('../../functions/src/crm/scheduler-migration-service');

assert.deepStrictEqual(
    buildCanonicalScheduledWindow({
        targetLocalDate: '2026-03-23',
        targetLocalTime: '09:00',
        timezone: 'Asia/Bangkok',
        durationMinutes: 90
    }),
    {
        scheduledStartAtUtc: '2026-03-23T02:00:00.000Z',
        scheduledEndAtUtc: '2026-03-23T03:30:00.000Z',
        scheduledLocalDate: '2026-03-23',
        scheduledLocalTime: '09:00',
        scheduledStartAt: '2026-03-23T09:00:00',
        scheduledEndAt: '2026-03-23T10:30:00',
        timezone: 'Asia/Bangkok',
        durationMinutes: 90
    }
);

assert.deepStrictEqual(
    normalizeScheduledSession({
        sessionId: 'legacy-1',
        scheduledStartAt: '2026-03-23T09:00:00',
        scheduledEndAt: '2026-03-23T10:00:00',
        timezone: 'Asia/Bangkok',
        durationMinutes: 60
    }),
    {
        sessionId: 'legacy-1',
        scheduledStartAt: '2026-03-23T09:00:00',
        scheduledEndAt: '2026-03-23T10:00:00',
        timezone: 'Asia/Bangkok',
        durationMinutes: 60,
        scheduledStartAtUtc: '2026-03-23T02:00:00.000Z',
        scheduledEndAtUtc: '2026-03-23T03:00:00.000Z',
        scheduledLocalDate: '2026-03-23',
        scheduledLocalTime: '09:00'
    }
);

assert.strictEqual(
    computeContractedTargetCount({
        totalInstructionMinutes: 24 * 60,
        sessionMinutes: 90
    }),
    16
);

assert.throws(
    () => validateRemainingDurationChange({
        totalInstructionMinutes: 24 * 60,
        completedContractedMinutes: 8 * 60,
        nextSessionMinutes: 95
    }),
    /remaining instruction minutes/i
);

assert.deepStrictEqual(
    validateRemainingDurationChange({
        totalInstructionMinutes: 24 * 60,
        completedContractedMinutes: 8 * 60,
        nextSessionMinutes: 120
    }),
    {
        remainingInstructionMinutes: 16 * 60,
        contractedTargetCount: 8
    }
);

const seedSessions = buildSeedSessions({
    classId: 'class-1',
    courseId: 'course-1',
    teacherUid: 'teacher-1',
    sessionMinutes: 120,
    timezone: 'Asia/Bangkok',
    startDate: '2026-03-23',
    weekdayNumbers: [1, 3],
    startTime: '18:00',
    targetSessionCount: 3,
    seedBatchId: 'seed-1'
});

assert.strictEqual(seedSessions.length, 3);
assert.strictEqual(seedSessions[0].contractUnitIndex, 1);
assert.strictEqual(seedSessions[1].contractUnitIndex, 2);
assert.strictEqual(seedSessions[2].contractUnitIndex, 3);
assert.strictEqual(seedSessions[0].unitType, 'contracted');
assert.strictEqual(seedSessions[0].attendanceState, 'none');
assert.strictEqual(seedSessions[0].lockState, 'unlocked');
assert.strictEqual(seedSessions[0].scheduledLocalDate, '2026-03-23');
assert.strictEqual(seedSessions[0].scheduledLocalTime, '18:00');
assert.strictEqual(seedSessions[0].scheduledStartAtUtc, '2026-03-23T11:00:00.000Z');

const summary = buildScheduleSummary({
    totalInstructionMinutes: 24 * 60,
    sessionMinutes: 90,
    sessions: [
        { unitType: 'contracted', status: 'scheduled', attendanceState: 'none', scheduledStartAt: '2026-03-25T11:00:00.000Z' },
        { unitType: 'contracted', status: 'completed', attendanceState: 'finalized', scheduledStartAt: '2026-03-20T11:00:00.000Z' },
        { unitType: 'overflow', status: 'scheduled', attendanceState: 'none', scheduledStartAt: '2026-03-27T11:00:00.000Z' },
        { unitType: 'contracted', status: 'cancelled', attendanceState: 'none', scheduledStartAt: '2026-03-21T11:00:00.000Z' }
    ],
    nowIso: '2026-03-22T00:00:00.000Z'
});

assert.deepStrictEqual(summary, {
    contractedTargetCount: 16,
    contractedAssignedCount: 2,
    contractedCompletedCount: 1,
    remainingToScheduleCount: 14,
    overflowCount: 1,
    nextScheduledAt: '2026-03-25T11:00:00.000Z'
});

assert.deepStrictEqual(
    buildScheduleSummary({
        totalInstructionMinutes: 1440,
        sessionMinutes: 120,
        targetSessionCount: 16,
        sessions: [],
        nowIso: '2026-03-22T00:00:00.000Z'
    }),
    {
        contractedTargetCount: 16,
        contractedAssignedCount: 0,
        contractedCompletedCount: 0,
        remainingToScheduleCount: 16,
        overflowCount: 0,
        nextScheduledAt: null
    }
);

const replacement = buildReplacementPlan({
    replacementSession: {
        classId: 'class-1',
        courseId: 'course-1',
        teacherUid: 'teacher-2',
        scheduledStartAt: '2026-03-28T11:00:00.000Z',
        scheduledEndAt: '2026-03-28T12:30:00.000Z',
        durationMinutes: 90,
        timezone: 'Asia/Bangkok'
    },
    replacedSession: {
        sessionId: 'session-2',
        contractUnitIndex: 2,
        overflowSequence: null,
        unitType: 'contracted'
    }
});

assert.strictEqual(replacement.nextSession.contractUnitIndex, 2);
assert.strictEqual(replacement.nextSession.replacementOfSessionId, 'session-2');
assert.strictEqual(replacement.cancelPatch.status, 'cancelled');

const addPreview = buildAddSessionPreview({
    classId: 'class-1',
    courseId: 'course-1',
    teacherUid: 'teacher-1',
    totalInstructionMinutes: 120,
    targetSessionCount: 2,
    sessionMinutes: 60,
    timezone: 'Asia/Bangkok',
    targetLocalDate: '2026-03-24',
    targetLocalTime: '10:00',
    durationMinutes: 60,
    addMode: 'recurring',
    recurringCount: 3,
    existingSessions: [
        {
            sessionId: 'session-1',
            classId: 'class-1',
            teacherUid: 'teacher-1',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            unitType: 'contracted',
            status: 'scheduled',
            attendanceState: 'none',
            scheduledStartAtUtc: '2026-03-24T03:00:00.000Z',
            scheduledEndAtUtc: '2026-03-24T04:00:00.000Z',
            scheduledLocalDate: '2026-03-24',
            scheduledLocalTime: '10:00'
        },
        {
            sessionId: 'session-2',
            classId: 'class-1',
            teacherUid: 'teacher-1',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            unitType: 'contracted',
            status: 'scheduled',
            attendanceState: 'none',
            scheduledStartAtUtc: '2026-03-26T02:00:00.000Z',
            scheduledEndAtUtc: '2026-03-26T03:00:00.000Z',
            scheduledLocalDate: '2026-03-26',
            scheduledLocalTime: '09:00'
        }
    ]
});

assert.strictEqual(addPreview.requestedCount, 3);
assert.strictEqual(addPreview.validOccurrences.length, 2);
assert.strictEqual(addPreview.blockedOccurrences.length, 1);
assert.strictEqual(addPreview.blockedOccurrences[0].reasonCode, 'teacher_conflict');
assert.strictEqual(addPreview.wouldCreateContractedCount, 0);
assert.strictEqual(addPreview.wouldCreateOverflowCount, 2);
assert.strictEqual(addPreview.canCommit, true);

const replacePreview = buildReplaceSessionPreview({
    classId: 'class-1',
    targetLocalDate: '2026-03-27',
    targetLocalTime: '09:00',
    timezone: 'Asia/Bangkok',
    durationMinutes: 60,
    existingSessions: [
        {
            sessionId: 'same-slot',
            classId: 'class-1',
            timezone: 'Asia/Bangkok',
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            scheduledLocalDate: '2026-03-27',
            scheduledLocalTime: '09:00',
            scheduledStartAtUtc: '2026-03-27T02:00:00.000Z',
            scheduledEndAtUtc: '2026-03-27T03:00:00.000Z'
        },
        {
            sessionId: 'locked',
            classId: 'class-1',
            timezone: 'Asia/Bangkok',
            status: 'scheduled',
            attendanceState: 'in_progress',
            lockState: 'hard_locked',
            scheduledLocalDate: '2026-03-28',
            scheduledLocalTime: '09:00',
            scheduledStartAtUtc: '2026-03-28T02:00:00.000Z',
            scheduledEndAtUtc: '2026-03-28T03:00:00.000Z'
        },
        {
            sessionId: 'cancelled',
            classId: 'class-1',
            timezone: 'Asia/Bangkok',
            status: 'cancelled',
            attendanceState: 'none',
            lockState: 'unlocked',
            scheduledLocalDate: '2026-03-29',
            scheduledLocalTime: '09:00',
            scheduledStartAtUtc: '2026-03-29T02:00:00.000Z',
            scheduledEndAtUtc: '2026-03-29T03:00:00.000Z'
        },
        {
            sessionId: 'eligible',
            classId: 'class-1',
            timezone: 'Asia/Bangkok',
            status: 'scheduled',
            attendanceState: 'draft',
            lockState: 'unlocked',
            scheduledLocalDate: '2026-03-30',
            scheduledLocalTime: '09:00',
            scheduledStartAtUtc: '2026-03-30T02:00:00.000Z',
            scheduledEndAtUtc: '2026-03-30T03:00:00.000Z'
        }
    ]
});

assert.strictEqual(replacePreview.eligibleSessions.length, 1);
assert.strictEqual(replacePreview.eligibleSessions[0].sessionId, 'eligible');
assert.deepStrictEqual(
    replacePreview.ineligibleReasons.map((entry) => entry.code).sort(),
    ['attendance_started', 'cancelled', 'same_slot']
);
assert.strictEqual(replacePreview.canCommit, true);

assert.deepStrictEqual(
    buildScheduledSessionWriteData({ classId: 'class-1' }, {
        targetLocalDate: '2026-03-31',
        targetLocalTime: '09:00',
        timezone: 'Asia/Bangkok',
        durationMinutes: 60
    }),
    {
        classId: 'class-1',
        scheduledStartAtUtc: '2026-03-31T02:00:00.000Z',
        scheduledEndAtUtc: '2026-03-31T03:00:00.000Z',
        scheduledLocalDate: '2026-03-31',
        scheduledLocalTime: '09:00',
        scheduledStartAt: '2026-03-31T09:00:00',
        scheduledEndAt: '2026-03-31T10:00:00',
        timezone: 'Asia/Bangkok',
        durationMinutes: 60
    }
);

const sessionBackfill = buildScheduledSessionCanonicalBackfill({
    scheduledStartAt: '2026-03-23T09:00:00',
    scheduledEndAt: '2026-03-23T10:00:00',
    durationMinutes: 60
}, 'Asia/Bangkok');
assert.strictEqual(sessionBackfill.status, 'patched');
assert.strictEqual(sessionBackfill.patch.scheduledStartAtUtc, '2026-03-23T02:00:00.000Z');

const classroomBackfill = buildClassroomScheduleBackfill({
    scheduleConfig: {
        totalInstructionMinutes: 1440,
        sessionMinutes: 120,
        timezone: 'Asia/Bangkok'
    }
});
assert.strictEqual(classroomBackfill.status, 'patched');
assert.strictEqual(classroomBackfill.patch.scheduleConfig.targetSessionCount, 12);
assert.strictEqual(classroomBackfill.patch.scheduleConfig.scheduleVersion, 1);

const regenerationPreview = buildRegenerationPreview({
    classId: 'class-1',
    courseId: 'course-1',
    teacherUid: 'teacher-1',
    totalInstructionMinutes: 720,
    timezone: 'Asia/Bangkok',
    regenerateFromDate: '2026-04-01',
    sessionMinutes: 120,
    seedWeekdays: [1, 3],
    seedStartTime: '09:00',
    existingSessions: [
        {
            sessionId: 'past-contracted',
            classId: 'class-1',
            unitType: 'contracted',
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            durationMinutes: 120,
            scheduledStartAt: '2026-03-25T09:00:00',
            scheduledEndAt: '2026-03-25T11:00:00',
            timezone: 'Asia/Bangkok'
        },
        {
            sessionId: 'overflow-1',
            classId: 'class-1',
            unitType: 'overflow',
            overflowSequence: 1,
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            durationMinutes: 120,
            scheduledStartAt: '2026-04-01T09:00:00',
            scheduledEndAt: '2026-04-01T11:00:00',
            timezone: 'Asia/Bangkok'
        }
    ],
    teacherConflictSessions: [],
    unresolvedSessionIds: []
});
assert.strictEqual(regenerationPreview.canCommit, true);
assert.strictEqual(regenerationPreview.preservedContractedCount, 1);
assert.strictEqual(regenerationPreview.preservedOverflowCount, 1);
assert.strictEqual(regenerationPreview.generatedFutureContractedCount, 5);
assert.strictEqual(regenerationPreview.nextTargetSessionCount, 6);

const unresolvedRegenerationPreview = buildRegenerationPreview({
    classId: 'class-1',
    courseId: 'course-1',
    teacherUid: 'teacher-1',
    totalInstructionMinutes: 720,
    timezone: 'Asia/Bangkok',
    regenerateFromDate: '2026-04-01',
    sessionMinutes: 120,
    seedWeekdays: [1],
    seedStartTime: '09:00',
    existingSessions: [],
    teacherConflictSessions: [],
    unresolvedSessionIds: ['legacy-1']
});
assert.strictEqual(unresolvedRegenerationPreview.canCommit, false);
assert(unresolvedRegenerationPreview.blockedReasonCodes.includes('unresolved_legacy_session'));

assert.deepStrictEqual(
    syncSessionLockStateFromAttendance({
        lockState: 'unlocked',
        lockReason: null
    }, 'draft'),
    {
        attendanceState: 'draft',
        lockState: 'unlocked',
        lockReason: null
    }
);

assert.deepStrictEqual(
    syncSessionLockStateFromAttendance({
        lockState: 'unlocked',
        lockReason: null
    }, 'in_progress'),
    {
        attendanceState: 'in_progress',
        lockState: 'hard_locked',
        lockReason: 'attendance_in_progress'
    }
);

console.log('scheduling service passed');
