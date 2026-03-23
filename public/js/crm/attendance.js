window.CrmAttendance = (function () {
    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function buildSessionPayload(elements) {
        return {
            sessionDate: getValue(elements.inputAttendanceSessionDate),
            title: getValue(elements.inputAttendanceSessionTitle)
        };
    }

    function buildScheduledSessionOpenPayload(session) {
        return {
            scheduledSessionId: String(session?.scheduledSessionId || session?.sessionId || '').trim(),
            classId: String(session?.classId || '').trim(),
            title: String(session?.title || '').trim() || null
        };
    }

    function buildBulkRecordPayload(rows) {
        return (rows || []).map((row) => ({
            studentId: String(row?.dataset?.studentId || '').trim(),
            studentUid: String(row?.dataset?.studentUid || '').trim() || null,
            status: String(row?.querySelector('.attendance-status')?.value || 'present').trim(),
            absenceReason: String(row?.querySelector('.attendance-reason')?.value || '').trim(),
            interventionFlag: !!row?.querySelector('.attendance-intervention')?.checked
        }));
    }

    function formatRiskLabel(studentSummary) {
        if (!studentSummary?.atRisk?.isAtRisk) return 'Stable';
        return 'At Risk';
    }

    return {
        buildSessionPayload,
        buildScheduledSessionOpenPayload,
        buildBulkRecordPayload,
        formatRiskLabel
    };
})();
