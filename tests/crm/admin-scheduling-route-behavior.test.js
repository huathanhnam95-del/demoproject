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

(async () => {
    await testSeedRejectsAlreadySeededContractedClass();
    await testRegenerateAfterSeededSessionsUsesPreviewApplyPath();
    process.stdout.write('admin scheduling route behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
