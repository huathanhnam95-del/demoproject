const assert = require('assert');
const {
    ATTENDANCE_STATUSES,
    buildEnrollmentCreateData,
    buildEnrollmentPatchData,
    buildClassroomMemberData,
    buildAttendanceSessionCreateData,
    buildAttendanceRecordWriteData,
    summarizeAttendanceByStudent,
    computeAtRiskStatus
} = require('../../functions/src/crm/enrollment-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

assert.deepStrictEqual(ATTENDANCE_STATUSES, ['present', 'absent', 'late']);

const enrollment = buildEnrollmentCreateData({
    studentId: 'student-1',
    classId: 'class-1',
    courseId: 'course-1',
    studentUid: 'uid-student-1',
    studentName: 'Alice',
    studentEmail: 'alice@example.com'
}, context);

assert.strictEqual(enrollment.studentId, 'student-1');
assert.strictEqual(enrollment.classId, 'class-1');
assert.strictEqual(enrollment.studentUid, 'uid-student-1');
assert.strictEqual(enrollment.status, 'active');
assert.strictEqual(enrollment.createdBy, 'admin-1');

const memberDoc = buildClassroomMemberData(enrollment);
assert.strictEqual(memberDoc.studentId, 'student-1');
assert.strictEqual(memberDoc.studentName, 'Alice');
assert.strictEqual(memberDoc.studentEmail, 'alice@example.com');

const patchedEnrollment = buildEnrollmentPatchData(enrollment, {
    status: 'paused',
    notes: 'Temporary leave'
}, context);

assert.strictEqual(patchedEnrollment.status, 'paused');
assert.strictEqual(patchedEnrollment.notes, 'Temporary leave');
assert.strictEqual(patchedEnrollment.updatedBy, 'admin-1');

const session = buildAttendanceSessionCreateData({
    classId: 'class-1',
    sessionDate: '2026-03-10',
    title: 'Session 1'
}, context);

assert.strictEqual(session.classId, 'class-1');
assert.strictEqual(session.sessionDate, '2026-03-10');

const attendanceRecord = buildAttendanceRecordWriteData({
    sessionId: 'session-1',
    classId: 'class-1',
    studentId: 'student-1',
    studentUid: 'uid-student-1',
    status: 'absent',
    absenceReason: 'Sick',
    interventionFlag: true
}, context);

assert.strictEqual(attendanceRecord.status, 'absent');
assert.strictEqual(attendanceRecord.absenceReason, 'Sick');
assert.strictEqual(attendanceRecord.interventionFlag, true);

const summary = summarizeAttendanceByStudent({
    enrollments: [
        {
            enrollmentId: 'enrollment-1',
            studentId: 'student-1',
            studentUid: 'uid-student-1',
            studentName: 'Alice'
        }
    ],
    records: [
        { sessionId: 'session-1', studentId: 'student-1', status: 'present', interventionFlag: false },
        { sessionId: 'session-2', studentId: 'student-1', status: 'absent', interventionFlag: true, absenceReason: 'Sick' },
        { sessionId: 'session-3', studentId: 'student-1', status: 'late', interventionFlag: false }
    ]
});

assert.strictEqual(summary.length, 1);
assert.strictEqual(summary[0].attendanceRate, 2 / 3);
assert.strictEqual(summary[0].absentCount, 1);
assert.strictEqual(summary[0].lateCount, 1);
assert.strictEqual(summary[0].interventionCount, 1);

const atRisk = computeAtRiskStatus({
    attendanceSummary: summary[0],
    learningProfile: {
        overall: 48
    }
});

assert.strictEqual(atRisk.isAtRisk, true);
assert.deepStrictEqual(atRisk.reasons, ['low_attendance', 'low_score', 'intervention_flag']);

assert.throws(
    () => buildEnrollmentCreateData({ classId: 'class-1' }, context),
    /Enrollment requires/
);

assert.throws(
    () => buildAttendanceRecordWriteData({ sessionId: 'session-1', studentId: 'student-1', status: 'unknown' }, context),
    /Invalid attendance status/
);

console.log('enrollment attendance service passed');
