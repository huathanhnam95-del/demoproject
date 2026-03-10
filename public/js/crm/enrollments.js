window.CrmEnrollments = (function () {
    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function buildEnrollmentPayload(elements, selectedStudent = null) {
        return {
            studentId: selectedStudent?.studentId || getValue(elements.inputEnrollmentStudentId),
            studentUid: selectedStudent?.linked_user_ids?.[0] || getValue(elements.inputEnrollmentStudentUid),
            studentName: selectedStudent?.name || getValue(elements.inputEnrollmentStudentName),
            studentEmail: selectedStudent?.email || getValue(elements.inputEnrollmentStudentEmail)
        };
    }

    return {
        buildEnrollmentPayload
    };
})();
