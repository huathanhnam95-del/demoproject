window.CrmClassrooms = (function () {
    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function getListValue(element) {
        const raw = getValue(element);
        if (!raw) return [];
        const seen = new Set();
        const values = [];
        raw.split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .forEach((item) => {
                const key = item.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                values.push(item);
            });
        return values;
    }

    function buildPayload(elements) {
        return {
            name: getValue(elements.inputClassroomName),
            courseId: getValue(elements.inputClassroomCourseId),
            status: getValue(elements.inputClassroomStatus) || 'draft',
            meetingDays: getListValue(elements.inputClassroomMeetingDays),
            meetingHours: getListValue(elements.inputClassroomMeetingHours)
        };
    }

    function applyToForm(elements, classroom) {
        if (elements.inputClassroomName) elements.inputClassroomName.value = String(classroom?.name || '');
        if (elements.inputClassroomCourseId) elements.inputClassroomCourseId.value = String(classroom?.courseId || '');
        if (elements.inputClassroomStatus) elements.inputClassroomStatus.value = String(classroom?.status || 'draft');
        if (elements.inputClassroomMeetingDays) elements.inputClassroomMeetingDays.value = Array.isArray(classroom?.meetingDays) ? classroom.meetingDays.join(', ') : '';
        if (elements.inputClassroomMeetingHours) elements.inputClassroomMeetingHours.value = Array.isArray(classroom?.meetingHours) ? classroom.meetingHours.join(', ') : '';
    }

    return {
        applyToForm,
        buildPayload
    };
})();
