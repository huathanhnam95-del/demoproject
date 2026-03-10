const ATTENDANCE_STATUSES = ['present', 'absent', 'late'];
const ENROLLMENT_STATUSES = ['active', 'paused', 'completed', 'inactive', 'withdrawn'];
const ATTENDANCE_RISK_THRESHOLD = 0.75;
const SCORE_RISK_THRESHOLD = 60;

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeEnrollmentStatus(value, fallback = 'active') {
    const normalized = cleanOptionalString(value) || fallback;
    if (!ENROLLMENT_STATUSES.includes(normalized)) {
        throw new Error(`Invalid enrollment status: ${normalized}`);
    }
    return normalized;
}

function normalizeAttendanceStatus(value, fallback = 'present') {
    const normalized = cleanOptionalString(value) || fallback;
    if (!ATTENDANCE_STATUSES.includes(normalized)) {
        throw new Error(`Invalid attendance status: ${normalized}`);
    }
    return normalized;
}

function getNumericScore(profile) {
    const overall = Number(profile?.overall);
    return Number.isFinite(overall) ? overall : null;
}

function buildEnrollmentCreateData(input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const studentId = cleanOptionalString(payload.studentId);
    const classId = cleanOptionalString(payload.classId);
    if (!studentId || !classId) {
        throw new Error('Enrollment requires studentId and classId.');
    }

    return {
        studentId,
        classId,
        courseId: cleanOptionalString(payload.courseId),
        studentUid: cleanOptionalString(payload.studentUid),
        studentName: cleanOptionalString(payload.studentName),
        studentEmail: cleanOptionalString(payload.studentEmail),
        status: normalizeEnrollmentStatus(payload.status),
        notes: cleanOptionalString(payload.notes),
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function buildEnrollmentPatchData(existing, input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const recognizedKeys = ['courseId', 'studentUid', 'studentName', 'studentEmail', 'status', 'notes'];
    const hasRecognizedPatch = recognizedKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
    if (!hasRecognizedPatch) {
        throw new Error('No enrollment fields provided for update.');
    }

    return {
        ...existing,
        courseId: Object.prototype.hasOwnProperty.call(payload, 'courseId') ? cleanOptionalString(payload.courseId) : (existing?.courseId ?? null),
        studentUid: Object.prototype.hasOwnProperty.call(payload, 'studentUid') ? cleanOptionalString(payload.studentUid) : (existing?.studentUid ?? null),
        studentName: Object.prototype.hasOwnProperty.call(payload, 'studentName') ? cleanOptionalString(payload.studentName) : (existing?.studentName ?? null),
        studentEmail: Object.prototype.hasOwnProperty.call(payload, 'studentEmail') ? cleanOptionalString(payload.studentEmail) : (existing?.studentEmail ?? null),
        status: Object.prototype.hasOwnProperty.call(payload, 'status')
            ? normalizeEnrollmentStatus(payload.status, existing?.status || 'active')
            : (existing?.status || 'active'),
        notes: Object.prototype.hasOwnProperty.call(payload, 'notes') ? cleanOptionalString(payload.notes) : (existing?.notes ?? null),
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
}

function buildClassroomMemberData(enrollment) {
    return {
        studentId: enrollment.studentId || null,
        studentName: enrollment.studentName || null,
        studentEmail: enrollment.studentEmail || null,
        enrollmentStatus: enrollment.status || 'active',
        createdAt: enrollment.createdAt || null,
        updatedAt: enrollment.updatedAt || null
    };
}

function buildAttendanceSessionCreateData(input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const classId = cleanOptionalString(payload.classId);
    const sessionDate = cleanOptionalString(payload.sessionDate);
    if (!classId || !sessionDate) {
        throw new Error('Attendance session requires classId and sessionDate.');
    }

    return {
        classId,
        sessionDate,
        title: cleanOptionalString(payload.title) || sessionDate,
        notes: cleanOptionalString(payload.notes),
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function buildAttendanceRecordWriteData(input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const sessionId = cleanOptionalString(payload.sessionId);
    const studentId = cleanOptionalString(payload.studentId);
    if (!sessionId || !studentId) {
        throw new Error('Attendance record requires sessionId and studentId.');
    }

    return {
        sessionId,
        classId: cleanOptionalString(payload.classId),
        studentId,
        studentUid: cleanOptionalString(payload.studentUid),
        studentName: cleanOptionalString(payload.studentName),
        status: normalizeAttendanceStatus(payload.status),
        absenceReason: cleanOptionalString(payload.absenceReason),
        interventionFlag: !!payload.interventionFlag,
        notes: cleanOptionalString(payload.notes),
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
}

function mapEnrollmentRecord(doc, enrollmentId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        enrollmentId: enrollmentId || doc?.id || null,
        studentId: data.studentId || null,
        classId: data.classId || null,
        courseId: data.courseId || null,
        studentUid: data.studentUid || null,
        studentName: data.studentName || null,
        studentEmail: data.studentEmail || null,
        status: data.status || 'active',
        notes: data.notes || null,
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

function mapAttendanceSessionRecord(doc, sessionId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        sessionId: sessionId || doc?.id || null,
        classId: data.classId || null,
        sessionDate: data.sessionDate || null,
        title: data.title || null,
        notes: data.notes || null,
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null
    };
}

function mapAttendanceRecord(doc, recordId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        recordId: recordId || doc?.id || null,
        sessionId: data.sessionId || null,
        classId: data.classId || null,
        studentId: data.studentId || null,
        studentUid: data.studentUid || null,
        studentName: data.studentName || null,
        status: data.status || 'present',
        absenceReason: data.absenceReason || null,
        interventionFlag: !!data.interventionFlag,
        notes: data.notes || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

function summarizeAttendanceByStudent({ enrollments, records }) {
    const enrollmentList = Array.isArray(enrollments) ? enrollments : [];
    const recordList = Array.isArray(records) ? records : [];

    return enrollmentList.map((enrollment) => {
        const studentRecords = recordList.filter((record) =>
            String(record.studentId || '') === String(enrollment.studentId || '')
            && String(record.classId || enrollment.classId || '') === String(enrollment.classId || '')
        );

        const totalSessions = studentRecords.length;
        let presentCount = 0;
        let absentCount = 0;
        let lateCount = 0;
        let interventionCount = 0;
        const absenceReasons = [];

        studentRecords.forEach((record) => {
            if (record.status === 'present') presentCount += 1;
            if (record.status === 'absent') absentCount += 1;
            if (record.status === 'late') lateCount += 1;
            if (record.interventionFlag) interventionCount += 1;
            if (record.absenceReason) absenceReasons.push(record.absenceReason);
        });

        return {
            enrollmentId: enrollment.enrollmentId || null,
            studentId: enrollment.studentId || null,
            studentUid: enrollment.studentUid || null,
            studentName: enrollment.studentName || 'Student',
            classId: enrollment.classId || null,
            totalSessions,
            presentCount,
            absentCount,
            lateCount,
            interventionCount,
            attendanceRate: totalSessions ? (presentCount + lateCount) / totalSessions : 0,
            absenceReasons
        };
    });
}

function computeAtRiskStatus({ attendanceSummary, learningProfile }) {
    const reasons = [];
    const attendanceRate = Number(attendanceSummary?.attendanceRate || 0);
    const score = getNumericScore(learningProfile);

    if (attendanceSummary && attendanceSummary.totalSessions > 0 && attendanceRate < ATTENDANCE_RISK_THRESHOLD) {
        reasons.push('low_attendance');
    }
    if (score !== null && score < SCORE_RISK_THRESHOLD) {
        reasons.push('low_score');
    }
    if (Number(attendanceSummary?.interventionCount || 0) > 0) {
        reasons.push('intervention_flag');
    }

    return {
        isAtRisk: reasons.length > 0,
        reasons
    };
}

module.exports = {
    ATTENDANCE_STATUSES,
    ENROLLMENT_STATUSES,
    ATTENDANCE_RISK_THRESHOLD,
    SCORE_RISK_THRESHOLD,
    buildEnrollmentCreateData,
    buildEnrollmentPatchData,
    buildClassroomMemberData,
    buildAttendanceSessionCreateData,
    buildAttendanceRecordWriteData,
    mapEnrollmentRecord,
    mapAttendanceSessionRecord,
    mapAttendanceRecord,
    summarizeAttendanceByStudent,
    computeAtRiskStatus
};
