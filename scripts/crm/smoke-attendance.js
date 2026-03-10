const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    buildEnrollmentCreateData,
    buildAttendanceSessionCreateData,
    buildAttendanceRecordWriteData,
    summarizeAttendanceByStudent,
    computeAtRiskStatus
} = require('../../functions/src/crm/enrollment-service');

function loadBrowserHelper(relativePath, globalName) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.window[globalName];
}

const enrollmentHelper = loadBrowserHelper('public/js/crm/enrollments.js', 'CrmEnrollments');
const attendanceHelper = loadBrowserHelper('public/js/crm/attendance.js', 'CrmAttendance');

const enrollment = buildEnrollmentCreateData({
    classId: 'class-1',
    courseId: 'course-1',
    ...enrollmentHelper.buildEnrollmentPayload({
        inputEnrollmentStudentId: { value: 'student-1' },
        inputEnrollmentStudentUid: { value: 'uid-student-1' },
        inputEnrollmentStudentName: { value: 'Alice' },
        inputEnrollmentStudentEmail: { value: 'alice@example.com' }
    })
}, {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
});

const session = buildAttendanceSessionCreateData({
    classId: 'class-1',
    ...attendanceHelper.buildSessionPayload({
        inputAttendanceSessionDate: { value: '2026-03-10' },
        inputAttendanceSessionTitle: { value: 'Session 1' }
    })
}, {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
});

const records = attendanceHelper.buildBulkRecordPayload([
    {
        dataset: {
            studentId: 'student-1',
            studentUid: 'uid-student-1'
        },
        querySelector: (selector) => {
            const fields = {
                '.attendance-status': { value: 'absent' },
                '.attendance-reason': { value: 'Sick' },
                '.attendance-intervention': { checked: true }
            };
            return fields[selector] || null;
        }
    }
]).map((record) => buildAttendanceRecordWriteData({
    sessionId: 'session-1',
    classId: 'class-1',
    ...record
}, {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
}));

const summary = summarizeAttendanceByStudent({
    enrollments: [enrollment],
    records
});
const risk = computeAtRiskStatus({
    attendanceSummary: summary[0],
    learningProfile: { overall: 55 }
});

assert.strictEqual(session.sessionDate, '2026-03-10');
assert.strictEqual(records[0].interventionFlag, true);
assert.strictEqual(summary[0].absentCount, 1);
assert.strictEqual(risk.isAtRisk, true);

console.log('attendance smoke passed');
