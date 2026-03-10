window.CrmClassrooms = (function () {
    function buildPayload(elements) {
        return {
            name: String(elements.inputClassroomName?.value || '').trim(),
            courseId: String(elements.inputClassroomCourseId?.value || '').trim(),
            status: String(elements.inputClassroomStatus?.value || '').trim() || 'draft'
        };
    }

    function applyToForm(elements, classroom) {
        if (elements.inputClassroomName) elements.inputClassroomName.value = String(classroom?.name || '');
        if (elements.inputClassroomCourseId) elements.inputClassroomCourseId.value = String(classroom?.courseId || '');
        if (elements.inputClassroomStatus) elements.inputClassroomStatus.value = String(classroom?.status || 'draft');
    }

    return {
        applyToForm,
        buildPayload
    };
})();
