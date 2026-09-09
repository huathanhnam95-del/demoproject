const assert = require('assert');
const {
    buildAddSessionPreview,
    buildCanonicalScheduledWindow,
    buildRegenerationPreview,
    buildScheduledSessionWriteData,
    computeContractedTargetCount,
    buildPushForwardPlan,
    buildScheduleSummary,
    buildSeedSessions,
    buildReplacementPlan,
    buildReplaceSessionPreview,
    buildSeriesShiftPlan,
    buildBulkRescheduleProjection,
    addCalendarDays,
    calendarDayDiff,
    calendarWeekday,
    toUtcDayMs,
    normalizeScheduledSession,
    validateRemainingDurationChange,
    syncSessionLockStateFromAttendance,
    toPositiveInteger
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
        status: 'scheduled',
        sessionOutcome: 'none',
        contractCountState: 'counts',
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
    nextScheduledAt: '2026-03-25T11:00:00.000Z',
    contractedMinutesTotal: 1440,
    contractedMinutesDelivered: 90,
    contractedMinutesRemaining: 1350
});

const summaryWithNonCounting = buildScheduleSummary({
    totalInstructionMinutes: 24 * 60,
    sessionMinutes: 90,
    sessions: [
        { unitType: 'contracted', status: 'scheduled', contractCountState: 'counts', scheduledStartAt: '2026-03-25T11:00:00.000Z' },
        { unitType: 'contracted', status: 'scheduled', sessionOutcome: 'absent_makeup', contractCountState: 'does_not_count', scheduledStartAt: '2026-03-20T11:00:00.000Z' },
        { unitType: 'contracted', status: 'completed', sessionOutcome: 'completed', contractCountState: 'counts', scheduledStartAt: '2026-03-21T11:00:00.000Z' },
        { unitType: 'contracted', status: 'scheduled', sessionOutcome: 'absent_counted', contractCountState: 'counts', scheduledStartAt: '2026-03-22T11:00:00.000Z' }
    ],
    nowIso: '2026-03-22T00:00:00.000Z'
});

assert.deepStrictEqual(summaryWithNonCounting, {
    contractedTargetCount: 16,
    contractedAssignedCount: 3,
    contractedCompletedCount: 2,
    remainingToScheduleCount: 13,
    overflowCount: 0,
    nextScheduledAt: '2026-03-22T11:00:00.000Z',
    contractedMinutesTotal: 1440,
    contractedMinutesDelivered: 180,
    contractedMinutesRemaining: 1260
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
        nextScheduledAt: null,
        contractedMinutesTotal: 1440,
        contractedMinutesDelivered: 0,
        contractedMinutesRemaining: 1440
    }
);

const replacement = buildReplacementPlan({
    replacementSession: {
        sessionId: 'session-replacement-99',
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
assert.strictEqual(replacement.cancelPatch.replacementSessionId, 'session-replacement-99');
assert.notStrictEqual(replacement.cancelPatch.replacementSessionId, 'session-2');

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
        },
        {
            sessionId: 'session-3',
            classId: 'class-1',
            teacherUid: 'teacher-1',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            unitType: 'contracted',
            status: 'cancelled',
            sessionOutcome: 'none',
            contractCountState: 'does_not_count',
            contractUnitIndex: 5,
            attendanceState: 'none',
            scheduledStartAtUtc: '2026-03-28T03:00:00.000Z',
            scheduledEndAtUtc: '2026-03-28T04:00:00.000Z',
            scheduledLocalDate: '2026-03-28',
            scheduledLocalTime: '10:00'
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

const addPreviewWithGap = buildAddSessionPreview({
    classId: 'class-1',
    courseId: 'course-1',
    teacherUid: 'teacher-1',
    totalInstructionMinutes: 180,
    targetSessionCount: 3,
    sessionMinutes: 60,
    timezone: 'Asia/Bangkok',
    targetLocalDate: '2026-04-05',
    targetLocalTime: '10:00',
    durationMinutes: 60,
    addMode: 'recurring',
    recurringCount: 2,
    existingSessions: [
        {
            sessionId: 'session-a',
            classId: 'class-1',
            teacherUid: 'teacher-1',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            unitType: 'contracted',
            contractUnitIndex: 1,
            status: 'scheduled',
            contractCountState: 'counts',
            attendanceState: 'none',
            scheduledStartAtUtc: '2026-03-28T03:00:00.000Z',
            scheduledEndAtUtc: '2026-03-28T04:00:00.000Z',
            scheduledLocalDate: '2026-03-28',
            scheduledLocalTime: '10:00'
        },
        {
            sessionId: 'session-b',
            classId: 'class-1',
            teacherUid: 'teacher-1',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            unitType: 'contracted',
            contractUnitIndex: 2,
            status: 'cancelled',
            sessionOutcome: 'none',
            contractCountState: 'does_not_count',
            attendanceState: 'none',
            scheduledStartAtUtc: '2026-03-31T03:00:00.000Z',
            scheduledEndAtUtc: '2026-03-31T04:00:00.000Z',
            scheduledLocalDate: '2026-03-31',
            scheduledLocalTime: '10:00'
        }
    ]
});

assert.strictEqual(addPreviewWithGap.validOccurrences[0].contractUnitIndex, 3);

const replacePreview = buildReplaceSessionPreview({
    classId: 'class-1',
    targetLocalDate: '2026-03-27',
    targetLocalTime: '09:00',
    timezone: 'Asia/Bangkok',
    durationMinutes: 60,
    nowIso: '2026-03-26T00:00:00.000Z',
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

// Phase 2: Multi-interval slots in buildSeedSessions
const alternatingSessions = buildSeedSessions({
    classId: 'class-slots-1',
    courseId: 'course-slots-1',
    teacherUid: 'teacher-1',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-09-07', // Monday
    totalInstructionMinutes: 24 * 60,
    slots: [
        { weekday: 1, startTime: '13:30', durationMinutes: 120 },
        { weekday: 3, startTime: '13:30', durationMinutes: 60 }
    ]
});

assert.strictEqual(alternatingSessions.length, 16);
assert.strictEqual(alternatingSessions[0].contractUnitIndex, 1);
assert.strictEqual(alternatingSessions[0].durationMinutes, 120);
assert.strictEqual(alternatingSessions[0].scheduledLocalDate, '2026-09-07');
assert.strictEqual(alternatingSessions[0].scheduledLocalTime, '13:30');

assert.strictEqual(alternatingSessions[1].contractUnitIndex, 2);
assert.strictEqual(alternatingSessions[1].durationMinutes, 60);
assert.strictEqual(alternatingSessions[1].scheduledLocalDate, '2026-09-09');

assert.strictEqual(alternatingSessions[15].contractUnitIndex, 16);
assert.strictEqual(alternatingSessions[15].durationMinutes, 60);

// Alternating 120/60 duration check across all 16
for (let i = 0; i < alternatingSessions.length; i++) {
    assert.strictEqual(alternatingSessions[i].contractUnitIndex, i + 1);
    assert.strictEqual(alternatingSessions[i].durationMinutes, i % 2 === 0 ? 120 : 60);
}

// Two slots on the same day (Fri 13:30 and Fri 19:00) both emit in time order
const multiSlotFriday = buildSeedSessions({
    classId: 'class-slots-2',
    courseId: 'course-slots-2',
    teacherUid: 'teacher-1',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-09-11', // Friday
    targetSessionCount: 2,
    slots: [
        { weekday: 5, startTime: '19:00', durationMinutes: 60 },
        { weekday: 5, startTime: '13:30', durationMinutes: 60 }
    ]
});
assert.strictEqual(multiSlotFriday.length, 2);
assert.strictEqual(multiSlotFriday[0].scheduledLocalDate, '2026-09-11');
assert.strictEqual(multiSlotFriday[0].scheduledLocalTime, '13:30');
assert.strictEqual(multiSlotFriday[0].contractUnitIndex, 1);
assert.strictEqual(multiSlotFriday[1].scheduledLocalDate, '2026-09-11');
assert.strictEqual(multiSlotFriday[1].scheduledLocalTime, '19:00');
assert.strictEqual(multiSlotFriday[1].contractUnitIndex, 2);

// Decision 3: a 13:30–15:30 window yields exactly one 120-minute session, not two 60-minute ones
const singleLongSession = buildSeedSessions({
    classId: 'class-slots-3',
    courseId: 'course-slots-3',
    teacherUid: 'teacher-1',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-09-07',
    targetSessionCount: 1,
    slots: [
        { weekday: 1, startTime: '13:30', durationMinutes: 120 }
    ]
});
assert.strictEqual(singleLongSession.length, 1);
assert.strictEqual(singleLongSession[0].durationMinutes, 120);

// Decision 7: 25h contract against a 3h week schedules 24.0h and reports remainder = 60
const remainderTest = buildSeedSessions({
    classId: 'class-slots-4',
    courseId: 'course-slots-4',
    teacherUid: 'teacher-1',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-09-07',
    totalInstructionMinutes: 25 * 60, // 1500 minutes
    slots: [
        { weekday: 1, startTime: '13:30', durationMinutes: 120 },
        { weekday: 3, startTime: '13:30', durationMinutes: 60 }
    ] // 180 min/week
});
assert.strictEqual(remainderTest.length, 16);
assert.strictEqual(remainderTest.accumulatedMinutes, 1440);
assert.strictEqual(remainderTest.remainderMinutes, 60);
assert.strictEqual(remainderTest.remainder, 60);

// A lesson longer than the whole contract yields zero sessions and an error
assert.throws(
    () => buildSeedSessions({
        classId: 'class-slots-5',
        courseId: 'course-slots-5',
        teacherUid: 'teacher-1',
        timezone: 'Asia/Ho_Chi_Minh',
        startDate: '2026-09-07',
        totalInstructionMinutes: 90, // 1.5h contract
        slots: [
            { weekday: 1, startTime: '13:30', durationMinutes: 120 } // 2h lesson
        ]
    }),
    /A 2h lesson is longer than the 1.5h contract/
);

// Push-forward cascade: buildPushForwardPlan on lesson 3 of 16
// lessons 4-16 shift back one slot, one new trailing lesson appears, and total counting minutes is unchanged.
const testSessionsForPush = alternatingSessions.map((s, idx) => ({
    ...s,
    sessionId: `session-${idx + 1}`
}));

const totalCountingMinutesBefore = testSessionsForPush
    .filter((s) => s.contractCountState === 'counts')
    .reduce((sum, s) => sum + s.durationMinutes, 0);

const pushPlan = buildPushForwardPlan({
    sessions: testSessionsForPush,
    fromSessionId: 'session-3',
    slots: [
        { weekday: 1, startTime: '13:30', durationMinutes: 120 },
        { weekday: 3, startTime: '13:30', durationMinutes: 60 }
    ],
    timezone: 'Asia/Ho_Chi_Minh'
});

assert.strictEqual(pushPlan.patches.length, 14); // 1 triggering (lesson 3) + 13 future (lessons 4-16)
assert.strictEqual(pushPlan.patches[0].sessionId, 'session-3');
assert.strictEqual(pushPlan.patches[0].sessionOutcome, 'absent_makeup');
assert.strictEqual(pushPlan.patches[0].contractCountState, 'does_not_count');
assert.strictEqual(pushPlan.patches[0].attendanceState, 'finalized');

// Future lessons renumbered: lesson 4 gets unitIndex 3, ..., lesson 16 gets unitIndex 15
assert.strictEqual(pushPlan.patches[1].sessionId, 'session-4');
assert.strictEqual(pushPlan.patches[1].contractUnitIndex, 3);
assert.strictEqual(pushPlan.patches[13].sessionId, 'session-16');
assert.strictEqual(pushPlan.patches[13].contractUnitIndex, 15);

// New trailing lesson appended with next contractUnitIndex 16
assert.strictEqual(pushPlan.newSession.contractUnitIndex, 16);
assert.strictEqual(pushPlan.newSession.contractCountState, 'counts');
assert.strictEqual(pushPlan.newSession.status, 'scheduled');

// Assert invariant: total contracted minutes that count is unchanged
const patchedSessions = testSessionsForPush.map((s) => {
    const patchObj = pushPlan.patches.find((p) => p.sessionId === s.sessionId);
    return patchObj ? { ...s, ...patchObj.patch } : s;
});
const allSessionsAfter = [...patchedSessions, pushPlan.newSession];
const totalCountingMinutesAfter = allSessionsAfter
    .filter((s) => s.contractCountState === 'counts')
    .reduce((sum, s) => sum + s.durationMinutes, 0);

assert.strictEqual(totalCountingMinutesAfter, totalCountingMinutesBefore);

// Check preview rows and date shift
assert.strictEqual(pushPlan.previewRows.length, 14);
assert.strictEqual(pushPlan.newEndDate > pushPlan.prevEndDate, true);

// Overlapping slots on the same day throw error
assert.throws(
    () => buildSeedSessions({
        classId: 'class-overlap',
        courseId: 'course-overlap',
        teacherUid: 'teacher-1',
        timezone: 'Asia/Ho_Chi_Minh',
        startDate: '2026-09-07',
        targetSessionCount: 2,
        slots: [
            { weekday: 1, startTime: '13:00', durationMinutes: 90 }, // 13:00 - 14:30
            { weekday: 1, startTime: '14:00', durationMinutes: 60 }  // 14:00 - 15:00 (overlaps!)
        ]
    }),
    /Overlapping slots on weekday 1/
);

// Pushing forward an already completed session throws error
assert.throws(
    () => buildPushForwardPlan({
        sessions: [
            { sessionId: 's1', status: 'completed', sessionOutcome: 'completed', scheduledLocalDate: '2026-09-07', scheduledLocalTime: '13:30' }
        ],
        fromSessionId: 's1',
        slots: [{ weekday: 1, startTime: '13:30', durationMinutes: 60 }]
    }),
    /Completed sessions cannot be pushed forward/
);

// Unpadded time strings (e.g. '9:00') are normalized and sorted before '13:30'
const unpaddedSlotsTest = buildSeedSessions({
    classId: 'class-unpadded',
    courseId: 'course-unpadded',
    teacherUid: 'teacher-1',
    timezone: 'Asia/Ho_Chi_Minh',
    startDate: '2026-09-07', // Monday
    targetSessionCount: 2,
    slots: [
        { weekday: 1, startTime: '13:30', durationMinutes: 60 },
        { weekday: 1, startTime: '9:00', durationMinutes: 60 }
    ]
});
assert.strictEqual(unpaddedSlotsTest[0].scheduledLocalTime, '09:00');
assert.strictEqual(unpaddedSlotsTest[1].scheduledLocalTime, '13:30');

// =========================================================================
// Tests for buildSeriesShiftPlan
// =========================================================================

// 1. Weekday + time filtering: moving Wed 18:00 ignores Wed 19:00 and Fri 18:00
{
    const sessions = [
        { sessionId: 's-wed-18-1', classId: 'c1', teacherUid: 't1', scheduledLocalDate: '2026-09-09', scheduledLocalTime: '18:00', durationMinutes: 60 },
        { sessionId: 's-wed-18-2', classId: 'c1', teacherUid: 't1', scheduledLocalDate: '2026-09-16', scheduledLocalTime: '18:00', durationMinutes: 60 },
        { sessionId: 's-wed-19-1', classId: 'c1', teacherUid: 't1', scheduledLocalDate: '2026-09-09', scheduledLocalTime: '19:00', durationMinutes: 60 },
        { sessionId: 's-fri-18-1', classId: 'c1', teacherUid: 't1', scheduledLocalDate: '2026-09-11', scheduledLocalTime: '18:00', durationMinutes: 60 }
    ];
    const plan = buildSeriesShiftPlan({
        sessions,
        anchorSession: sessions[0],
        targetIntent: {
            targetLocalDate: '2026-09-10', // Thursday
            targetLocalTime: '19:00',
            durationMinutes: 60,
            timezone: 'Asia/Ho_Chi_Minh'
        }
    });
    assert.strictEqual(plan.moved.length, 2, 'Only the two Wed 18:00 sessions should move');
    assert.deepStrictEqual(plan.moved.map(m => m.sessionId), ['s-wed-18-1', 's-wed-18-2']);
    assert.strictEqual(plan.moved[0].to.targetLocalDate, '2026-09-10');
    assert.strictEqual(plan.moved[0].to.targetLocalTime, '19:00');
    assert.strictEqual(plan.moved[1].to.targetLocalDate, '2026-09-17');
    assert.strictEqual(plan.moved[1].to.targetLocalTime, '19:00');
}

// 2. DST week-offset preservation across America/New_York fallback (Nov 1, 2026)
// Anchor: 2026-10-28 19:00 (EDT, UTC-4), moving 4 members to 2026-11-04 19:00
{
    const nyTz = 'America/New_York';
    const sessions = [
        { sessionId: 'ny-0', classId: 'c-ny', teacherUid: 't-ny', scheduledLocalDate: '2026-10-28', scheduledLocalTime: '19:00', durationMinutes: 60, timezone: nyTz },
        { sessionId: 'ny-1', classId: 'c-ny', teacherUid: 't-ny', scheduledLocalDate: '2026-11-04', scheduledLocalTime: '19:00', durationMinutes: 60, timezone: nyTz },
        { sessionId: 'ny-2', classId: 'c-ny', teacherUid: 't-ny', scheduledLocalDate: '2026-11-11', scheduledLocalTime: '19:00', durationMinutes: 60, timezone: nyTz },
        { sessionId: 'ny-3', classId: 'c-ny', teacherUid: 't-ny', scheduledLocalDate: '2026-11-18', scheduledLocalTime: '19:00', durationMinutes: 60, timezone: nyTz }
    ];

    // Verify raw sessions cross DST boundary:
    // ny-0 (2026-10-28T19:00 EDT) -> 23:00 UTC
    // ny-1 (2026-11-04T19:00 EST) -> 00:00 UTC next day (Nov 5)
    // Delta between ny-0 and ny-1 is 7 days + 1 hr = 169 hours
    const utc0 = new Date(buildCanonicalScheduledWindow({ targetLocalDate: '2026-10-28', targetLocalTime: '19:00', timezone: nyTz, durationMinutes: 60 }).scheduledStartAtUtc).getTime();
    const utc1 = new Date(buildCanonicalScheduledWindow({ targetLocalDate: '2026-11-04', targetLocalTime: '19:00', timezone: nyTz, durationMinutes: 60 }).scheduledStartAtUtc).getTime();
    const utc2 = new Date(buildCanonicalScheduledWindow({ targetLocalDate: '2026-11-11', targetLocalTime: '19:00', timezone: nyTz, durationMinutes: 60 }).scheduledStartAtUtc).getTime();
    assert.strictEqual((utc1 - utc0) / 3600000, 169, 'UTC delta across fallback must be 169 hours');
    assert.strictEqual((utc2 - utc1) / 3600000, 168, 'UTC delta after fallback must be 168 hours');

    const plan = buildSeriesShiftPlan({
        sessions,
        anchorSession: sessions[0],
        targetIntent: {
            targetLocalDate: '2026-11-04',
            targetLocalTime: '19:00',
            durationMinutes: 60,
            timezone: nyTz
        }
    });

    assert.strictEqual(plan.moved.length, 4, 'All 4 members should move');
    plan.moved.forEach((m, idx) => {
        assert.strictEqual(m.to.targetLocalTime, '19:00', `Member ${idx} local time must be preserved as 19:00`);
    });
    assert.strictEqual(plan.moved[0].to.targetLocalDate, '2026-11-04');
    assert.strictEqual(plan.moved[1].to.targetLocalDate, '2026-11-11');
    assert.strictEqual(plan.moved[2].to.targetLocalDate, '2026-11-18');
    assert.strictEqual(plan.moved[3].to.targetLocalDate, '2026-11-25');
}

// 3. Spring-forward gap -> invalid_local_time skip
// In America/New_York on 2026-03-08, 02:30 does not exist (clocks jump 02:00 -> 03:00)
{
    const nyTz = 'America/New_York';
    const sessions = [
        { sessionId: 'gap-0', classId: 'c-gap', teacherUid: 't-gap', scheduledLocalDate: '2026-03-01', scheduledLocalTime: '02:30', durationMinutes: 60, timezone: nyTz },
        { sessionId: 'gap-1', classId: 'c-gap', teacherUid: 't-gap', scheduledLocalDate: '2026-03-08', scheduledLocalTime: '02:30', durationMinutes: 60, timezone: nyTz }
    ];
    const plan = buildSeriesShiftPlan({
        sessions,
        anchorSession: sessions[0],
        targetIntent: {
            targetLocalDate: '2026-03-01',
            targetLocalTime: '02:30',
            durationMinutes: 60,
            timezone: nyTz
        }
    });
    // Session gap-0 is same_slot (2026-03-01 02:30 to 2026-03-01 02:30).
    // Session gap-1 tries to place on 2026-03-08 02:30, which is an invalid DST gap.
    const gapSkip = plan.skipped.find(s => s.sessionId === 'gap-1');
    assert(gapSkip, 'Candidate on spring-forward gap should be skipped');
    assert.strictEqual(gapSkip.reason, 'invalid_local_time');
}

// 4. Gapped series (offsets 0, 1, 3 -> T, T+7, T+21)
{
    const sessions = [
        { sessionId: 'gap-s0', classId: 'c-gapped', teacherUid: 't1', scheduledLocalDate: '2026-09-02', scheduledLocalTime: '10:00', durationMinutes: 60 },
        { sessionId: 'gap-s1', classId: 'c-gapped', teacherUid: 't1', scheduledLocalDate: '2026-09-09', scheduledLocalTime: '10:00', durationMinutes: 60 },
        { sessionId: 'gap-s3', classId: 'c-gapped', teacherUid: 't1', scheduledLocalDate: '2026-09-23', scheduledLocalTime: '10:00', durationMinutes: 60 }
    ];
    const plan = buildSeriesShiftPlan({
        sessions,
        anchorSession: sessions[0],
        targetIntent: {
            targetLocalDate: '2026-09-04', // Friday (+2 days)
            targetLocalTime: '14:00',
            durationMinutes: 60,
            timezone: 'UTC'
        }
    });
    assert.strictEqual(plan.moved.length, 3);
    assert.strictEqual(plan.moved[0].weekOffset, 0);
    assert.strictEqual(plan.moved[0].to.targetLocalDate, '2026-09-04');
    assert.strictEqual(plan.moved[1].weekOffset, 1);
    assert.strictEqual(plan.moved[1].to.targetLocalDate, '2026-09-11');
    assert.strictEqual(plan.moved[2].weekOffset, 3);
    assert.strictEqual(plan.moved[2].to.targetLocalDate, '2026-09-25');
}

// 5. Locked and cancelled skips
{
    const sessions = [
        { sessionId: 's-active', classId: 'c-mix', teacherUid: 't1', scheduledLocalDate: '2026-09-02', scheduledLocalTime: '10:00', durationMinutes: 60, status: 'scheduled' },
        { sessionId: 's-locked', classId: 'c-mix', teacherUid: 't1', scheduledLocalDate: '2026-09-09', scheduledLocalTime: '10:00', durationMinutes: 60, lockState: 'hard_locked' },
        { sessionId: 's-finalized', classId: 'c-mix', teacherUid: 't1', scheduledLocalDate: '2026-09-16', scheduledLocalTime: '10:00', durationMinutes: 60, attendanceState: 'finalized' },
        { sessionId: 's-cancelled', classId: 'c-mix', teacherUid: 't1', scheduledLocalDate: '2026-09-23', scheduledLocalTime: '10:00', durationMinutes: 60, status: 'cancelled' }
    ];
    const plan = buildSeriesShiftPlan({
        sessions,
        anchorSession: sessions[0],
        targetIntent: {
            targetLocalDate: '2026-09-03',
            targetLocalTime: '11:00',
            durationMinutes: 60,
            timezone: 'UTC'
        }
    });
    assert.strictEqual(plan.moved.length, 1);
    assert.strictEqual(plan.moved[0].sessionId, 's-active');
    assert.strictEqual(plan.skipped.length, 3);
    assert(plan.skipped.some(s => s.sessionId === 's-locked' && s.reason === 'locked'));
    assert(plan.skipped.some(s => s.sessionId === 's-finalized' && s.reason === 'locked'));
    assert(plan.skipped.some(s => s.sessionId === 's-cancelled' && s.reason === 'cancelled'));
}

// 6. Anchor maps exactly onto target
{
    const sessions = [
        { sessionId: 'anchor-only', classId: 'c-single', teacherUid: 't1', scheduledLocalDate: '2026-09-09', scheduledLocalTime: '18:00', durationMinutes: 90, timezone: 'Asia/Bangkok' }
    ];
    const plan = buildSeriesShiftPlan({
        sessions,
        anchorSession: sessions[0],
        targetIntent: {
            targetLocalDate: '2026-09-10',
            targetLocalTime: '19:30',
            durationMinutes: 90,
            timezone: 'Asia/Bangkok'
        }
    });
    assert.strictEqual(plan.moved.length, 1);
    assert.strictEqual(plan.moved[0].weekOffset, 0);
    assert.strictEqual(plan.moved[0].to.targetLocalDate, '2026-09-10');
    assert.strictEqual(plan.moved[0].to.targetLocalTime, '19:30');
    assert.strictEqual(plan.moved[0].to.durationMinutes, 90);
    assert.strictEqual(plan.canCommit, true);
}

// 7. toPositiveInteger supports numeric fallback without throwing
{
    assert.strictEqual(toPositiveInteger(undefined, 60), 60);
    assert.strictEqual(toPositiveInteger(null, 60), 60);
    assert.strictEqual(toPositiveInteger(undefined, '60'), 60);
    assert.strictEqual(toPositiveInteger(90, 60), 90);
    assert.strictEqual(toPositiveInteger('45', 60), 45);
    assert.strictEqual(toPositiveInteger(null, -5), null);
    assert.strictEqual(toPositiveInteger(null, null), null);
    assert.throws(() => toPositiveInteger(-5, 'Value'), /must be a positive integer/);
    assert.throws(() => toPositiveInteger('not_a_num', 'durationMinutes'), /durationMinutes must be a positive integer/);
}

// 8. buildSeriesShiftPlan candidate cap > 400 throws TOO_MANY_MOVES
{
    const manySessions = [];
    for (let i = 0; i < 405; i += 1) {
        manySessions.push({
            sessionId: `s-${i}`,
            classId: 'c-large',
            teacherUid: 't1',
            scheduledLocalDate: '2026-09-09',
            scheduledLocalTime: '18:00',
            durationMinutes: 60,
            timezone: 'UTC'
        });
    }
    assert.throws(
        () => buildSeriesShiftPlan({
            sessions: manySessions,
            anchorSession: manySessions[0],
            targetIntent: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC'
            }
        }),
        (err) => err.code === 'TOO_MANY_MOVES'
    );
}

// 9. Sanitized moved[].patch contains only scheduled window fields
{
    const sessions = [
        {
            sessionId: 's-sanitize',
            classId: 'c-san',
            teacherUid: 't1',
            scheduledLocalDate: '2026-09-09',
            scheduledLocalTime: '18:00',
            durationMinutes: 60,
            timezone: 'UTC',
            someRawInternalField: 'should-not-leak'
        }
    ];
    const plan = buildSeriesShiftPlan({
        sessions,
        anchorSession: sessions[0],
        targetIntent: {
            targetLocalDate: '2026-09-10',
            targetLocalTime: '19:00',
            durationMinutes: 60,
            timezone: 'UTC'
        }
    });
    assert.strictEqual(plan.moved.length, 1);
    const patch = plan.moved[0].patch;
    assert.strictEqual(patch.sessionId, undefined, 'patch must not leak sessionId');
    assert.strictEqual(patch.someRawInternalField, undefined, 'patch must not leak internal session doc fields');
    assert.strictEqual(patch.scheduledLocalDate, '2026-09-10');
    assert.strictEqual(patch.scheduledLocalTime, '19:00');
    assert.strictEqual(patch.durationMinutes, 60);
}

// 10. conflictAt is formatted as { scheduledLocalDate, scheduledLocalTime }
{
    const sessions = [
        { sessionId: 's-target', classId: 'c-1', teacherUid: 't1', scheduledLocalDate: '2026-09-09', scheduledLocalTime: '18:00', durationMinutes: 60, timezone: 'UTC' }
    ];
    const otherTeacherSessions = [
        {
            sessionId: 's-other',
            classId: 'c-2',
            teacherUid: 't1',
            scheduledLocalDate: '2026-09-10',
            scheduledLocalTime: '18:00',
            durationMinutes: 60,
            timezone: 'UTC',
            scheduledStartAtUtc: '2026-09-10T18:00:00.000Z',
            scheduledEndAtUtc: '2026-09-10T19:00:00.000Z'
        }
    ];
    const plan = buildSeriesShiftPlan({
        sessions,
        anchorSession: sessions[0],
        targetIntent: {
            targetLocalDate: '2026-09-10',
            targetLocalTime: '18:00',
            durationMinutes: 60,
            timezone: 'UTC'
        },
        outsideSessions: otherTeacherSessions
    });
    assert.strictEqual(plan.conflicts.length, 1);
    assert.deepStrictEqual(plan.conflicts[0].conflictAt, {
        scheduledLocalDate: '2026-09-10',
        scheduledLocalTime: '18:00'
    });
}

console.log('scheduling service passed');
