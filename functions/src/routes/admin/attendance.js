const {
    CRM_ENROLLMENTS,
    CRM_ATTENDANCE_SESSIONS,
    CRM_ATTENDANCE_RECORDS,
    CRM_STUDENTS
} = require('../../crm/collections');
const {
    buildAttendanceSessionCreateData,
    buildAttendanceRecordWriteData,
    mapAttendanceSessionRecord,
    mapAttendanceRecord,
    mapEnrollmentRecord,
    summarizeAttendanceByStudent,
    computeAtRiskStatus
} = require('../../crm/enrollment-service');

function buildRecordId(sessionId, studentId, studentUid) {
    return `${sessionId}__${studentId || studentUid || 'student'}`;
}

module.exports = function registerAttendanceRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.post('/attendance/sessions', ...requireAdminHandlers, async (req, res) => {
        try {
            const session = buildAttendanceSessionCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_ATTENDANCE_SESSIONS).doc();
            await ref.set(session);
            const snap = await ref.get();
            await writeAuditLog?.({
                action: 'attendance.session.create',
                entityType: 'attendance_session',
                entityId: ref.id,
                metadata: { classId: session.classId, sessionDate: session.sessionDate }
            }, { user: req.user });
            return sendSuccess(res, {
                sessionId: ref.id,
                session: mapAttendanceSessionRecord(snap, ref.id)
            }, 'Attendance session created.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('Attendance session requires')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_ATTENDANCE_SESSION_ERROR', 'Failed to create attendance session.', error?.message || error);
        }
    });

    router.post('/attendance/records/bulk', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.body?.classId || '').trim();
            const recordsInput = Array.isArray(req.body?.records) ? req.body.records : [];
            if (!classId || !recordsInput.length) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'classId and records are required.');
            }

            const writes = [];
            for (const entry of recordsInput) {
                const base = buildAttendanceRecordWriteData({
                    ...entry,
                    classId
                }, {
                    user: req.user,
                    serverTimestamp
                });

                let studentName = base.studentName;
                if (!studentName && base.studentId) {
                    const studentSnap = await db.collection(CRM_STUDENTS).doc(base.studentId).get();
                    if (studentSnap.exists) {
                        const student = studentSnap.data() || {};
                        studentName = student.name || student.email || null;
                    }
                }

                writes.push({
                    id: buildRecordId(base.sessionId, base.studentId, base.studentUid),
                    data: {
                        ...base,
                        studentName
                    }
                });
            }

            await Promise.all(writes.map((write) =>
                db.collection(CRM_ATTENDANCE_RECORDS).doc(write.id).set(write.data, { merge: true })
            ));
            await writeAuditLog?.({
                action: 'attendance.records.bulk_save',
                entityType: 'attendance_record',
                entityId: classId,
                metadata: { classId, count: writes.length }
            }, { user: req.user });

            return sendSuccess(res, { count: writes.length }, 'Attendance records saved.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('Attendance record requires') || message.includes('Invalid attendance status')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'SAVE_ATTENDANCE_RECORDS_ERROR', 'Failed to save attendance records.', error?.message || error);
        }
    });

    router.get('/attendance/summary', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.query?.classId || '').trim();
            const studentId = String(req.query?.studentId || '').trim();

            const [enrollmentSnap, sessionSnap, recordSnap] = await Promise.all([
                classId
                    ? db.collection(CRM_ENROLLMENTS).where('classId', '==', classId).get()
                    : db.collection(CRM_ENROLLMENTS).get(),
                classId
                    ? db.collection(CRM_ATTENDANCE_SESSIONS).where('classId', '==', classId).get()
                    : db.collection(CRM_ATTENDANCE_SESSIONS).get(),
                classId
                    ? db.collection(CRM_ATTENDANCE_RECORDS).where('classId', '==', classId).get()
                    : db.collection(CRM_ATTENDANCE_RECORDS).get()
            ]);

            let enrollments = enrollmentSnap.docs.map((doc) => mapEnrollmentRecord(doc, doc.id));
            let records = recordSnap.docs.map((doc) => mapAttendanceRecord(doc, doc.id));
            const sessions = sessionSnap.docs.map((doc) => mapAttendanceSessionRecord(doc, doc.id))
                .sort((left, right) => String(right.sessionDate || '').localeCompare(String(left.sessionDate || '')));

            if (studentId) {
                enrollments = enrollments.filter((enrollment) => String(enrollment.studentId || '') === studentId);
                records = records.filter((record) => String(record.studentId || '') === studentId);
            }

            const summaries = summarizeAttendanceByStudent({
                enrollments,
                records
            });

            const studentSnaps = await Promise.all(summaries.map((summary) =>
                summary.studentId ? db.collection(CRM_STUDENTS).doc(summary.studentId).get() : Promise.resolve(null)
            ));

            const students = summaries.map((summary, index) => {
                const studentSnap = studentSnaps[index];
                const student = studentSnap?.exists ? (studentSnap.data() || {}) : {};
                const risk = computeAtRiskStatus({
                    attendanceSummary: summary,
                    learningProfile: student.learningProfile || {}
                });
                return {
                    ...summary,
                    learningProfile: student.learningProfile || null,
                    atRisk: risk
                };
            });

            return sendSuccess(res, {
                students,
                sessions
            });
        } catch (error) {
            return sendError(res, 500, 'GET_ATTENDANCE_SUMMARY_ERROR', 'Failed to load attendance summary.', error?.message || error);
        }
    });
};
