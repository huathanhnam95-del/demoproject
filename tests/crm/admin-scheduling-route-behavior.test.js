const assert = require('assert');
const express = require('express');

const registerSchedulingRoutes = require('../../functions/src/routes/admin/scheduling');
const { CRM_CLASSROOMS, CRM_SCHEDULED_SESSIONS } = require('../../functions/src/crm/collections');
const { callRoute, createFakeDb } = require('./route-test-helpers');

function createSchedulingRouter(db) {
    const router = express.Router();
    registerSchedulingRoutes(router, {
        db,
        requireAdminHandlers: [
            (req, _res, next) => {
                req.user = { uid: 'admin-1', email: 'admin@example.com' };
                next();
            }
        ],
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => {}
    });
    return router;
}

async function testSeedRejectsAlreadySeededContractedClass() {
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-1`]: {
            name: 'IELTS Evening',
            courseId: 'course-1',
            primaryTeacherUid: 'teacher-1',
            scheduleConfig: {
                totalInstructionMinutes: 60,
                sessionMinutes: 60,
                targetSessionCount: 1,
                timezone: 'Asia/Bangkok',
                seedWeekdays: [1],
                seedStartTime: '09:00',
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 1,
                contractedAssignedCount: 1,
                remainingToScheduleCount: 0,
                overflowCount: 0
            }
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-1`]: {
            sessionId: 'session-1',
            classId: 'class-1',
            courseId: 'course-1',
            teacherUid: 'teacher-1',
            unitType: 'contracted',
            contractUnitIndex: 1,
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            scheduledStartAtUtc: '2026-04-06T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-06T03:00:00.000Z',
            scheduledLocalDate: '2026-04-06',
            scheduledLocalTime: '09:00'
        }
    });

    const router = createSchedulingRouter(db);
    const res = await callRoute(router, '/classrooms/:classId/sessions/seed', 'post', {
        params: { classId: 'class-1' },
        body: {
            startDate: '2026-04-08',
            startTime: '10:00',
            weekdayNumbers: [3],
            teacherUid: 'teacher-1'
        }
    });

    assert.strictEqual(res._status, 409);
    assert.strictEqual(res._json.error, 'SCHEDULE_ALREADY_SEEDED');
    const classSessionKeys = Array.from(db.docs.keys())
        .filter((key) => key.startsWith(`${CRM_SCHEDULED_SESSIONS}/`));
    assert.deepStrictEqual(classSessionKeys, [`${CRM_SCHEDULED_SESSIONS}/session-1`]);
}

async function testRegenerateAfterSeededSessionsUsesPreviewApplyPath() {
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-2`]: {
            name: 'IELTS Weekend',
            courseId: 'course-2',
            primaryTeacherUid: 'teacher-2',
            scheduleConfig: {
                totalInstructionMinutes: 120,
                sessionMinutes: 60,
                targetSessionCount: 2,
                timezone: 'Asia/Bangkok',
                seedWeekdays: [1],
                seedStartTime: '09:00',
                scheduleVersion: 3
            },
            scheduleSummary: {
                contractedTargetCount: 2,
                contractedAssignedCount: 2,
                remainingToScheduleCount: 0,
                overflowCount: 0
            }
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-preserved`]: {
            sessionId: 'session-preserved',
            classId: 'class-2',
            courseId: 'course-2',
            teacherUid: 'teacher-2',
            unitType: 'contracted',
            contractUnitIndex: 1,
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            scheduledStartAtUtc: '2026-04-06T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-06T03:00:00.000Z',
            scheduledLocalDate: '2026-04-06',
            scheduledLocalTime: '09:00',
            version: 1
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-future`]: {
            sessionId: 'session-future',
            classId: 'class-2',
            courseId: 'course-2',
            teacherUid: 'teacher-2',
            unitType: 'contracted',
            contractUnitIndex: 2,
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            scheduledStartAtUtc: '2026-04-13T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-13T03:00:00.000Z',
            scheduledLocalDate: '2026-04-13',
            scheduledLocalTime: '09:00',
            version: 1
        }
    });

    const router = createSchedulingRouter(db);
    const payload = {
        regenerateFromDate: '2026-04-13',
        sessionMinutes: 60,
        seedWeekdays: [3],
        seedStartTime: '10:00',
        expectedScheduleVersion: 3
    };

    const previewRes = await callRoute(router, '/classrooms/:classId/schedule/regenerate-preview', 'post', {
        params: { classId: 'class-2' },
        body: payload
    });
    assert.strictEqual(previewRes._status, 200);
    assert.strictEqual(previewRes._json.success, true);
    assert.strictEqual(previewRes._json.canCommit, true);
    assert.strictEqual(previewRes._json.classroomScheduleVersion, 3);
    assert.strictEqual(previewRes._json.cancelledFutureContractedCount, 1);
    assert.strictEqual(previewRes._json.generatedFutureContractedCount, 1);

    const applyRes = await callRoute(router, '/classrooms/:classId/schedule/regenerate', 'post', {
        params: { classId: 'class-2' },
        body: payload
    });
    assert.strictEqual(applyRes._status, 200);
    assert.strictEqual(applyRes._json.success, true);
    assert.deepStrictEqual(applyRes._json.cancelledSessionIds, ['session-future']);
    assert.strictEqual(applyRes._json.createdSessions.length, 1);
    assert.strictEqual(applyRes._json.createdSessions[0].scheduledLocalDate, '2026-04-15');
    assert.strictEqual(applyRes._json.createdSessions[0].scheduledLocalTime, '10:00');

    const cancelledSession = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/session-future`);
    assert.strictEqual(cancelledSession.status, 'cancelled');
    assert.strictEqual(cancelledSession.version, 2);

    const createdSessionKey = Array.from(db.docs.keys())
        .find((key) => key.startsWith(`${CRM_SCHEDULED_SESSIONS}/crmScheduledSessions-auto-`));
    assert(createdSessionKey, 'Expected regeneration to create a replacement scheduled session.');
    const createdSession = db.docs.get(createdSessionKey);
    assert.strictEqual(createdSession.classId, 'class-2');
    assert.strictEqual(createdSession.unitType, 'contracted');
    assert.strictEqual(createdSession.contractUnitIndex, 2);

    const updatedClassroom = db.docs.get(`${CRM_CLASSROOMS}/class-2`);
    assert.strictEqual(updatedClassroom.scheduleConfig.scheduleVersion, 4);
    assert.deepStrictEqual(updatedClassroom.scheduleConfig.seedWeekdays.map(Number), [3]);
    assert.strictEqual(updatedClassroom.scheduleConfig.seedStartTime, '10:00');
    assert.strictEqual(updatedClassroom.scheduleSummary.contractedAssignedCount, 2);
    assert.strictEqual(updatedClassroom.scheduleSummary.remainingToScheduleCount, 0);
}

async function testAdminWorkspaceAllTeachersFilterAndRescheduleHealing() {
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-admin-test`]: {
            name: 'Class Admin Test',
            courseId: 'course-admin-1',
            primaryTeacherUid: 'teacher-primary',
            scheduleConfig: {
                totalInstructionMinutes: 180,
                sessionMinutes: 60,
                targetSessionCount: 3,
                timezone: 'Asia/Bangkok',
                seedWeekdays: [1],
                seedStartTime: '09:00',
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 3,
                contractedAssignedCount: 2,
                remainingToScheduleCount: 1,
                overflowCount: 0
            }
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-t1`]: {
            sessionId: 'session-t1',
            classId: 'class-admin-test',
            teacherUid: 'teacher-1',
            status: 'scheduled',
            unitType: 'contracted',
            scheduledLocalDate: '2026-04-06',
            scheduledLocalTime: '09:00',
            durationMinutes: 60,
            timezone: 'Asia/Bangkok',
            scheduledStartAtUtc: '2026-04-06T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-06T03:00:00.000Z'
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-t2`]: {
            sessionId: 'session-t2',
            classId: 'class-admin-test',
            teacherUid: 'teacher-2',
            status: 'scheduled',
            unitType: 'contracted',
            scheduledLocalDate: '2026-04-07',
            scheduledLocalTime: '09:00',
            durationMinutes: 60,
            timezone: 'Asia/Bangkok',
            scheduledStartAtUtc: '2026-04-07T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-07T03:00:00.000Z'
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-legacy-all`]: {
            sessionId: 'session-legacy-all',
            classId: 'class-admin-test',
            teacherUid: 'all',
            status: 'scheduled',
            unitType: 'contracted',
            scheduledLocalDate: '2026-04-08',
            scheduledLocalTime: '09:00',
            durationMinutes: 60,
            timezone: 'Asia/Bangkok',
            scheduledStartAtUtc: '2026-04-08T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-08T03:00:00.000Z'
        }
    });

    const router = createSchedulingRouter(db);

    // 1. GET /scheduler/workspace with teacherUid: 'all' must return all sessions across teachers
    const wsRes = await callRoute(router, '/scheduler/workspace', 'get', {
        query: { teacherUid: 'all' }
    });
    assert.strictEqual(wsRes._status, 200);
    assert.strictEqual(wsRes._json.sessions.length, 3, 'Workspace with teacherUid=all must return all sessions');

    // 2. POST /classrooms/:classId/sessions/add with teacherUid: 'all' must fall back to primaryTeacherUid
    const addRes = await callRoute(router, '/classrooms/:classId/sessions/add', 'post', {
        params: { classId: 'class-admin-test' },
        body: {
            teacherUid: 'all',
            targetLocalDate: '2026-04-13',
            targetLocalTime: '09:00',
            durationMinutes: 60
        }
    });
    assert.strictEqual(addRes._status, 200);
    const addedSessionId = addRes._json.sessionId;
    const addedSession = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${addedSessionId}`);
    assert.strictEqual(addedSession.teacherUid, 'teacher-primary', 'Admin passing "all" in session add must fall back to primary teacher');

    // 3. PATCH /sessions/:sessionId/reschedule on session-legacy-all must heal teacherUid from 'all' to primaryTeacherUid
    const reschedRes = await callRoute(router, '/sessions/:sessionId/reschedule', 'patch', {
        params: { sessionId: 'session-legacy-all' },
        body: {
            targetLocalDate: '2026-04-20',
            targetLocalTime: '09:00',
            durationMinutes: 60
        }
    });
    assert.strictEqual(reschedRes._status, 200);
    const healedSession = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/session-legacy-all`);
    assert.strictEqual(healedSession.teacherUid, 'teacher-primary', 'Rescheduling session with "all" must heal to primary teacher');
}

(async () => {
    const seedDb = createFakeDb({
        [`${CRM_CLASSROOMS}/atomic`]: { name: 'Atomic', primaryTeacherUid: 'teacher', scheduleConfig: { totalInstructionMinutes: 120, sessionMinutes: 60, targetSessionCount: 2, timezone: 'UTC' } },
        [`${CRM_SCHEDULED_SESSIONS}/busy`]: { classId: 'other', teacherUid: 'teacher', status: 'scheduled', scheduledStartAtUtc: '2026-09-14T09:00:00.000Z', scheduledEndAtUtc: '2026-09-14T10:00:00.000Z' }
    });
    const beforeSeed = JSON.stringify([...seedDb.docs]);
    const seedRes = await callRoute(createSchedulingRouter(seedDb), '/classrooms/:classId/sessions/seed', 'post', { params: { classId: 'atomic' }, body: { startDate: '2026-09-07', weekdayNumbers: [1], startTime: '09:00' } });
    assert.strictEqual(seedRes._status, 409);
    assert.strictEqual(JSON.stringify([...seedDb.docs]), beforeSeed, 'A late conflict must not partially seed a class.');
    await testSeedRejectsAlreadySeededContractedClass();
    await testRegenerateAfterSeededSessionsUsesPreviewApplyPath();
    await testAdminWorkspaceAllTeachersFilterAndRescheduleHealing();
    process.stdout.write('admin scheduling route behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
