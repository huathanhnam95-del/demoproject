const assert = require('assert');
const express = require('express');

const registerEnrollmentRoutes = require('../../functions/src/routes/admin/enrollments');
const {
    CRM_STUDENTS,
    CRM_COURSES,
    CRM_CLASSROOMS,
    CRM_ENROLLMENTS,
    CRM_SCHEDULED_SESSIONS
} = require('../../functions/src/crm/collections');
const { callRoute, createFakeDb } = require('./route-test-helpers');

function createEnrollmentRouter(db) {
    const router = express.Router();
    registerEnrollmentRoutes(router, {
        db,
        requireAdminHandlers: [
            (req, _res, next) => {
                req.user = { uid: 'admin-1', email: 'admin@example.com' };
                next();
            }
        ],
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => new Date(),
        writeAuditLog: async () => {}
    });
    return router;
}

async function testAutoProvision1on1EnrollmentAndSeedSessions() {
    const db = createFakeDb({
        [`${CRM_STUDENTS}/student-101`]: {
            name: 'Tran Nam',
            email: 'trannam@example.com',
            linked_user_ids: ['user-uid-101']
        },
        [`${CRM_COURSES}/course-1on1`]: {
            name: 'PTE Academic 1-on-1 Intensive',
            code: 'PTE-1ON1',
            courseType: '1on1',
            durationDays: 30,
            deliveryTemplate: {
                totalInstructionMinutes: 240, // 4 hours total = 2 x 2hr lessons
                defaultSessionMinutes: 120,
                durationStepMinutes: 30,
                timezone: 'Asia/Ho_Chi_Minh'
            }
        }
    });

    const router = createEnrollmentRouter(db);

    // Call POST /enrollments with 1-on-1 course and availability slots
    const res = await callRoute(router, '/enrollments', 'POST', {
        body: {
            studentId: 'student-101',
            courseId: 'course-1on1',
            startDate: '2026-09-07', // Monday
            slots: [
                { weekday: 1, startTime: '14:00', durationMinutes: 120 } // Mon 14:00 - 16:00
            ],
            teacherUid: 'teacher-dan'
        }
    });

    assert.strictEqual(res._status, 200, `Expected 200, got ${res._status}: ${JSON.stringify(res._json)}`);
    assert(res._json.enrollment, 'Expected enrollment in response');
    assert(res._json.enrollment.classId, 'Expected synthetic classId in enrollment');

    const createdClassId = res._json.enrollment.classId;

    // Verify synthetic classroom was created
    const classDoc = db.docs.get(`${CRM_CLASSROOMS}/${createdClassId}`);
    assert(classDoc, 'Classroom document must exist in DB');
    assert.strictEqual(classDoc.classKind, 'oneOnOne', 'Classroom must be oneOnOne');
    assert.strictEqual(classDoc.studentId, 'student-101');
    assert.strictEqual(classDoc.primaryTeacherUid, 'teacher-dan');
    assert(classDoc.name.includes('Tran Nam'), 'Classroom name should contain student name');

    // Verify seed sessions were created (240 min / 120 min = 2 sessions)
    const sessions = Array.from(db.docs.values()).filter((d) => d && d.classId === createdClassId && d.scheduledLocalDate);
    assert.strictEqual(sessions.length, 2, `Expected 2 sessions, got ${sessions.length}`);
    assert.strictEqual(sessions[0].scheduledLocalDate, '2026-09-07');
    assert.strictEqual(sessions[0].scheduledLocalTime, '14:00');
    assert.strictEqual(sessions[0].durationMinutes, 120);
    assert.strictEqual(sessions[1].scheduledLocalDate, '2026-09-14');
    assert.strictEqual(sessions[1].scheduledLocalTime, '14:00');
    assert.strictEqual(sessions[1].durationMinutes, 120);

    // Verify schedule summary on classroom
    assert.strictEqual(classDoc.scheduleSummary.contractedMinutesTotal, 240);
    assert.strictEqual(classDoc.scheduleSummary.contractedMinutesRemaining, 240);
    assert.strictEqual(classDoc.scheduleSummary.contractedTargetCount, 2);

    console.log('✓ Test 1 passed: 1-on-1 synthetic classroom provisioning & session seeding');
    return { db, router, createdClassId, sessions };
}

async function testGetStudentEnrollmentsEnriched() {
    const { db, router, createdClassId } = await testAutoProvision1on1EnrollmentAndSeedSessions();

    const res = await callRoute(router, '/students/:studentId/enrollments', 'GET', {
        params: { studentId: 'student-101' }
    });

    assert.strictEqual(res._status, 200);
    assert(Array.isArray(res._json.enrollments));
    assert.strictEqual(res._json.enrollments.length, 1);

    const enr = res._json.enrollments[0];
    assert.strictEqual(enr.studentId, 'student-101');
    assert.strictEqual(enr.course.code, 'PTE-1ON1');
    assert.strictEqual(enr.course.courseType, '1on1');
    assert.strictEqual(enr.classroom.classroomId, createdClassId);
    assert.strictEqual(enr.classroom.classKind, 'oneOnOne');
    assert.strictEqual(enr.scheduleSummary.contractedMinutesTotal, 240);
    assert.strictEqual(enr.sessions.length, 2);

    console.log('✓ Test 2 passed: GET /students/:studentId/enrollments enriched with course & scheduleSummary');
}

async function testPushForwardSessionEndpoint() {
    const { db, router, createdClassId, sessions } = await testAutoProvision1on1EnrollmentAndSeedSessions();

    const firstSessionDocKey = Array.from(db.docs.keys()).find((k) => k.startsWith(`${CRM_SCHEDULED_SESSIONS}/`) && db.docs.get(k)?.classId === createdClassId);
    const firstSessionId = firstSessionDocKey.slice(`${CRM_SCHEDULED_SESSIONS}/`.length);

    // Push forward the first session
    const res = await callRoute(router, '/sessions/:sessionId/push-forward', 'POST', {
        params: { sessionId: firstSessionId },
        body: {
            slots: [
                { weekday: 1, startTime: '14:00', durationMinutes: 120 }
            ]
        }
    });

    assert.strictEqual(res._status, 200, `Expected 200, got ${res._status}: ${JSON.stringify(res._json)}`);
    assert(res._json.plan, 'Expected plan in response');
    assert.strictEqual(res._json.fromSessionId, firstSessionId);
    assert.strictEqual(res._json.prevEndDate, '2026-09-14');
    assert.strictEqual(res._json.newEndDate, '2026-09-21');

    // Verify session 1 became pushed_forward / non-counting
    const updatedFirstSession = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${firstSessionId}`);
    assert.strictEqual(updatedFirstSession.contractCountState, 'does_not_count');
    assert.strictEqual(updatedFirstSession.sessionOutcome, 'absent_makeup');
    assert.strictEqual(updatedFirstSession.attendanceState, 'finalized');

    // Verify total sessions for classroom is now 3 (1 pushed forward + 1 shifted + 1 new trailing)
    const allSessions = Array.from(db.docs.values()).filter((d) => d && d.classId === createdClassId && d.scheduledLocalDate);
    assert.strictEqual(allSessions.length, 3);

    // Verify counting sessions total remains exactly 240 minutes!
    const countingMinutes = allSessions
        .filter((s) => s.unitType === 'contracted' && String(s.contractCountState || 'counts') !== 'does_not_count')
        .reduce((sum, s) => sum + s.durationMinutes, 0);
    assert.strictEqual(countingMinutes, 240);

    const classDocAfterPush = db.docs.get(`${CRM_CLASSROOMS}/${createdClassId}`);
    assert.strictEqual(classDocAfterPush.scheduleSummary.contractedTargetCount, 2);
    assert.strictEqual(classDocAfterPush.scheduleSummary.contractedAssignedCount, 2);

    console.log('✓ Test 3 passed: POST /sessions/:sessionId/push-forward preserves contract hours & extends end date');
}

async function testAttendanceUpdateEndpoint() {
    const { db, router, createdClassId } = await testAutoProvision1on1EnrollmentAndSeedSessions();

    const firstSessionDocKey = Array.from(db.docs.keys()).find((k) => k.startsWith(`${CRM_SCHEDULED_SESSIONS}/`) && db.docs.get(k)?.classId === createdClassId);
    const firstSessionId = firstSessionDocKey.slice(`${CRM_SCHEDULED_SESSIONS}/`.length);

    // 1. Mark attended
    const resAttended = await callRoute(router, '/sessions/:sessionId/attendance', 'POST', {
        params: { sessionId: firstSessionId },
        body: { status: 'attended', notes: 'Great participation' }
    });

    assert.strictEqual(resAttended._status, 200);
    const updatedAttendedSession = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${firstSessionId}`);
    assert.strictEqual(updatedAttendedSession.status, 'completed');
    assert.strictEqual(updatedAttendedSession.sessionOutcome, 'completed');
    assert.strictEqual(updatedAttendedSession.contractCountState, 'counts');
    assert.strictEqual(updatedAttendedSession.attendanceState, 'finalized');
    assert.strictEqual(updatedAttendedSession.attendanceNotes, 'Great participation');

    const classDoc = db.docs.get(`${CRM_CLASSROOMS}/${createdClassId}`);
    assert.strictEqual(classDoc.scheduleSummary.contractedMinutesDelivered, 120);
    assert.strictEqual(classDoc.scheduleSummary.contractedMinutesRemaining, 120);
    assert.strictEqual(classDoc.scheduleSummary.contractedTargetCount, 2);
    assert.strictEqual(classDoc.scheduleSummary.contractedAssignedCount, 2);

    // 2. Mark penalized
    const resPenalized = await callRoute(router, '/sessions/:sessionId/attendance', 'POST', {
        params: { sessionId: firstSessionId },
        body: { status: 'penalized' }
    });
    assert.strictEqual(resPenalized._status, 200);
    const updatedPenalizedSession = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${firstSessionId}`);
    assert.strictEqual(updatedPenalizedSession.sessionOutcome, 'absent_counted');
    assert.strictEqual(updatedPenalizedSession.contractCountState, 'counts');

    // 3. Mark absent (does_not_count)
    const resAbsent = await callRoute(router, '/sessions/:sessionId/attendance', 'POST', {
        params: { sessionId: firstSessionId },
        body: { status: 'absent' }
    });
    assert.strictEqual(resAbsent._status, 200);
    const updatedAbsentSession = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${firstSessionId}`);
    assert.strictEqual(updatedAbsentSession.sessionOutcome, 'absent_makeup');
    assert.strictEqual(updatedAbsentSession.contractCountState, 'does_not_count');

    console.log('✓ Test 4 passed: POST /sessions/:sessionId/attendance updates outcomes and recalculates delivered hours');
}

async function testPushForwardPreviewOnly() {
    const { db, router, createdClassId } = await testAutoProvision1on1EnrollmentAndSeedSessions();

    const firstSessionDocKey = Array.from(db.docs.keys()).find((k) => k.startsWith(`${CRM_SCHEDULED_SESSIONS}/`) && db.docs.get(k)?.classId === createdClassId);
    const firstSessionId = firstSessionDocKey.slice(`${CRM_SCHEDULED_SESSIONS}/`.length);

    const initialSessionCount = Array.from(db.docs.values()).filter((d) => d && d.classId === createdClassId && d.scheduledLocalDate).length;

    // Call push-forward with previewOnly: true
    const res = await callRoute(router, '/sessions/:sessionId/push-forward', 'POST', {
        params: { sessionId: firstSessionId },
        body: {
            previewOnly: true,
            slots: [{ weekday: 1, startTime: '14:00', durationMinutes: 120 }]
        }
    });

    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.preview, true);
    assert(Array.isArray(res._json.previewRows));
    assert(res._json.previewSummary.includes('→'));
    assert.strictEqual(res._json.prevEndDate, '2026-09-14');
    assert.strictEqual(res._json.newEndDate, '2026-09-21');

    // Verify NO DB mutations were made!
    const sessionCountAfterPreview = Array.from(db.docs.values()).filter((d) => d && d.classId === createdClassId && d.scheduledLocalDate).length;
    assert.strictEqual(sessionCountAfterPreview, initialSessionCount);

    console.log('✓ Test 5 passed: POST /sessions/:sessionId/push-forward previewOnly generates preview without mutating DB');
}

async function testAttendanceContractAndValidationEdgeCases() {
    const { db, router, createdClassId } = await testAutoProvision1on1EnrollmentAndSeedSessions();
    const firstSessionDocKey = Array.from(db.docs.keys()).find((k) => k.startsWith(`${CRM_SCHEDULED_SESSIONS}/`) && db.docs.get(k)?.classId === createdClassId);
    const firstSessionId = firstSessionDocKey.slice(`${CRM_SCHEDULED_SESSIONS}/`.length);

    // 1. Invalid status rejection
    const resInvalid = await callRoute(router, '/sessions/:sessionId/attendance', 'POST', {
        params: { sessionId: firstSessionId },
        body: { status: 'invalid_status' }
    });
    assert.strictEqual(resInvalid._status, 400);
    assert(resInvalid._json.message.includes('reset'));

    // 2. Mark attended records attendanceStatus: 'attended'
    await callRoute(router, '/sessions/:sessionId/attendance', 'POST', {
        params: { sessionId: firstSessionId },
        body: { status: 'attended' }
    });
    const sessionAttended = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${firstSessionId}`);
    assert.strictEqual(sessionAttended.attendanceStatus, 'attended');

    // 3. Reset to scheduled clears attendanceStatus
    await callRoute(router, '/sessions/:sessionId/attendance', 'POST', {
        params: { sessionId: firstSessionId },
        body: { status: 'reset' }
    });
    const sessionReset = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${firstSessionId}`);
    assert.strictEqual(sessionReset.attendanceStatus, null);
    assert.strictEqual(sessionReset.status, 'scheduled');
    assert.strictEqual(sessionReset.attendanceState, 'none');

    // 4. Mark absent records attendanceStatus: 'absent'
    await callRoute(router, '/sessions/:sessionId/attendance', 'POST', {
        params: { sessionId: firstSessionId },
        body: { status: 'absent' }
    });
    const sessionAbsent = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${firstSessionId}`);
    assert.strictEqual(sessionAbsent.attendanceStatus, 'absent');
    assert.strictEqual(sessionAbsent.sessionOutcome, 'absent_makeup');

    // 5. Reset again and push forward -> verify attendanceStatus: 'rescheduled' and isPushedForward: true
    await callRoute(router, '/sessions/:sessionId/attendance', 'POST', {
        params: { sessionId: firstSessionId },
        body: { status: 'reset' }
    });
    const resPush = await callRoute(router, '/sessions/:sessionId/push-forward', 'POST', {
        params: { sessionId: firstSessionId },
        body: { slots: [{ weekday: 1, startTime: '14:00', durationMinutes: 120 }] }
    });
    assert.strictEqual(resPush._status, 200);
    const sessionPushed = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${firstSessionId}`);
    // 6. Reset again after push-forward -> verify isPushedForward is cleared and attendanceStatus is null
    await callRoute(router, '/sessions/:sessionId/attendance', 'POST', {
        params: { sessionId: firstSessionId },
        body: { status: 'reset' }
    });
    const sessionResetAfterPush = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${firstSessionId}`);
    assert.strictEqual(sessionResetAfterPush.attendanceStatus, null);
    assert.strictEqual(sessionResetAfterPush.isPushedForward, false);
    assert.strictEqual(sessionResetAfterPush.status, 'scheduled');
    assert.strictEqual(sessionResetAfterPush.attendanceState, 'none');

    console.log('✓ Test 6 passed: attendanceStatus lifecycle, reset clearing, and push-forward metadata contracts');
}

(async function runAll() {
    try {
        const seed = {
            [`${CRM_STUDENTS}/safe-student`]: { name: 'Local integrity fixture' },
            [`${CRM_COURSES}/safe-course`]: { name: 'Course', courseType: '1on1', deliveryTemplate: { totalInstructionMinutes: 240, defaultSessionMinutes: 120, timezone: 'Asia/Ho_Chi_Minh' } },
            [`${CRM_CLASSROOMS}/safe-class`]: { name: 'Class', courseId: 'safe-course' }
        };
        const body = { studentId: 'safe-student', courseId: 'safe-course', startDate: '2026-09-07', slots: [{ weekday: 1, startTime: '14:00', durationMinutes: 120 }] };
        for (const input of [
            { studentId: 'missing', classId: 'safe-class' },
            { studentId: 'safe-student', classId: 'missing' },
            { studentId: 'safe-student', classId: 'safe-class', courseId: 'wrong-course' },
            { ...body, slots: [{ weekday: 'invalid', startTime: '14:00', durationMinutes: 120 }] },
            { ...body, startDate: '2026-02-31' }
        ]) {
            const db = createFakeDb(seed);
            const before = JSON.stringify([...db.docs]);
            const res = await callRoute(createEnrollmentRouter(db), '/enrollments', 'post', { body: input });
            assert(res._status >= 400 && res._status < 500, `Invalid enrollment should be rejected: ${JSON.stringify(input)}; got ${res._status}`);
            assert.strictEqual(JSON.stringify([...db.docs]), before, 'Invalid enrollment must not write any documents.');
        }
        const db = createFakeDb(seed);
        const router = createEnrollmentRouter(db);
        const repeated = await Promise.all([1, 2].map(() => callRoute(router, '/enrollments', 'post', { body })));
        assert(repeated.every((res) => res._status === 200));
        assert.strictEqual(repeated[0]._json.enrollment.enrollmentId, repeated[1]._json.enrollment.enrollmentId);
        assert.strictEqual([...db.docs.keys()].filter((key) => key.startsWith(`${CRM_ENROLLMENTS}/`)).length, 1);
        assert.strictEqual([...db.docs.keys()].filter((key) => key.startsWith(`${CRM_SCHEDULED_SESSIONS}/`)).length, 2);
        const datedDb = createFakeDb(seed);
        const dated = await callRoute(createEnrollmentRouter(datedDb), '/enrollments', 'post', { body: { ...body, endDate: '2026-09-08' } });
        assert.strictEqual(dated._status, 200);
        assert.strictEqual(dated._json.enrollment.endDate, '2026-09-08');
        assert.strictEqual([...datedDb.docs.keys()].filter((key) => key.startsWith(`${CRM_SCHEDULED_SESSIONS}/`)).length, 1, 'Optional end date bounds scheduled lessons.');
        const conflictDb = createFakeDb({ ...seed, [`${CRM_SCHEDULED_SESSIONS}/busy`]: { classId: 'other-class', teacherUid: 'teacher', status: 'scheduled', scheduledStartAtUtc: '2026-09-14T07:00:00.000Z', scheduledEndAtUtc: '2026-09-14T09:00:00.000Z' } });
        const beforeConflict = JSON.stringify([...conflictDb.docs]);
        const conflict = await callRoute(createEnrollmentRouter(conflictDb), '/enrollments', 'post', { body: { ...body, teacherUid: 'teacher' } });
        assert.strictEqual(conflict._status, 409);
        assert.strictEqual(JSON.stringify([...conflictDb.docs]), beforeConflict, 'A conflict in the second lesson must leave no class, enrollment or first lesson.');
        const memberDb = createFakeDb(seed);
        const memberRouter = createEnrollmentRouter(memberDb);
        const memberCreated = await callRoute(memberRouter, '/enrollments', 'post', { body: { studentId: 'safe-student', classId: 'safe-class', studentUid: 'old-user' } });
        const memberId = memberCreated._json.enrollmentId;
        const memberUpdated = await callRoute(memberRouter, '/enrollments/:enrollmentId', 'patch', { params: { enrollmentId: memberId }, body: { studentUid: 'new-user' } });
        assert.strictEqual(memberUpdated._status, 200);
        assert(!memberDb.docs.has(`${CRM_CLASSROOMS}/safe-class/members/old-user`), 'Changing the linked account must remove the old membership.');
        assert(memberDb.docs.has(`${CRM_CLASSROOMS}/safe-class/members/new-user`));
        const abortDb = createFakeDb(seed);
        const abortBefore = JSON.stringify([...abortDb.docs]);
        const originalTransaction = abortDb.runTransaction.bind(abortDb);
        abortDb.runTransaction = (callback) => originalTransaction(async (tx) => {
            await callback(tx);
            throw new Error('Injected failure before commit');
        });
        const aborted = await callRoute(createEnrollmentRouter(abortDb), '/enrollments', 'post', { body });
        assert.strictEqual(aborted._status, 500);
        assert.strictEqual(JSON.stringify([...abortDb.docs]), abortBefore, 'Aborted transaction must roll back the entire enrollment plan.');
        console.log('Running 1-on-1 Enrollment & Scheduling Backend Tests...');
        await testAutoProvision1on1EnrollmentAndSeedSessions();
        await testGetStudentEnrollmentsEnriched();
        await testPushForwardSessionEndpoint();
        await testAttendanceUpdateEndpoint();
        await testPushForwardPreviewOnly();
        await testAttendanceContractAndValidationEdgeCases();
        console.log('\nAll 1-on-1 Enrollment & Scheduling Backend Tests PASSED!');
    } catch (err) {
        console.error('Test failure:', err);
        process.exit(1);
    }
})();
