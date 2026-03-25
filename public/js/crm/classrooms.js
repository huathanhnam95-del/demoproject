window.CrmClassrooms = (function () {
    function buildPayload(elements) {
        const selectedCourseOption = elements.inputClassroomCourseId?.selectedOptions?.[0] || null;
        const courseTotalMinutes = Number(selectedCourseOption?.dataset?.totalMinutes || 0);
        const courseSessionMinutes = Number(selectedCourseOption?.dataset?.defaultSessionMinutes || 0);
        const courseDurationStepMinutes = Number(selectedCourseOption?.dataset?.durationStepMinutes || 30);
        const courseTimezone = String(selectedCourseOption?.dataset?.timezone || '').trim();
        const totalHours = Number(elements.inputClassroomTotalHours?.value || 0);
        const sessionMinutes = Number(elements.inputClassroomSessionMinutes?.value || courseSessionMinutes || 0);
        const durationStepMinutes = Number(elements.inputClassroomDurationStep?.value || courseDurationStepMinutes || 30);
        const weekdays = String(elements.inputClassroomSeedWeekdays?.value || '')
            .split(',')
            .map((day) => day.trim())
            .filter(Boolean);
        const meetingDays = String(elements.inputClassroomMeetingDays?.value || '')
            .split(',')
            .map((day) => day.trim())
            .filter(Boolean);
        const meetingHours = String(elements.inputClassroomMeetingHours?.value || '')
            .split(',')
            .map((hour) => hour.trim())
            .filter(Boolean);

        return {
            name: String(elements.inputClassroomName?.value || '').trim(),
            courseId: String(elements.inputClassroomCourseId?.value || '').trim(),
            status: String(elements.inputClassroomStatus?.value || '').trim() || 'draft',
            primaryTeacherUid: String(elements.inputClassroomPrimaryTeacher?.value || '').trim(),
            meetingDays,
            meetingHours,
            scheduleConfig: {
                totalInstructionMinutes: Number.isFinite(totalHours) && totalHours > 0
                    ? Math.round(totalHours * 60)
                    : (Number.isFinite(courseTotalMinutes) && courseTotalMinutes > 0 ? Math.round(courseTotalMinutes) : null),
                sessionMinutes: Number.isFinite(sessionMinutes) && sessionMinutes > 0 ? Math.round(sessionMinutes) : null,
                timezone: String(elements.inputClassroomScheduleTimezone?.value || courseTimezone || '').trim(),
                allowedStartTime: String(elements.inputClassroomAllowedStartTime?.value || '').trim(),
                allowedEndTime: String(elements.inputClassroomAllowedEndTime?.value || '').trim(),
                seedWeekdays: weekdays,
                seedStartDate: String(elements.inputClassroomSeedStartDate?.value || '').trim(),
                seedStartTime: String(elements.inputClassroomSeedStartTime?.value || '').trim(),
                skipDates: [],
                planningStatus: 'needs_setup',
                durationStepMinutes: Number.isFinite(durationStepMinutes) && durationStepMinutes > 0 ? Math.round(durationStepMinutes) : 30
            }
        };
    }

    function applyToForm(elements, classroom) {
        if (elements.inputClassroomName) elements.inputClassroomName.value = String(classroom?.name || '');
        if (elements.inputClassroomCourseId) elements.inputClassroomCourseId.value = String(classroom?.courseId || '');
        if (elements.inputClassroomStatus) elements.inputClassroomStatus.value = String(classroom?.status || 'draft');
        if (elements.inputClassroomTotalHours) {
            const minutes = Number(classroom?.scheduleConfig?.totalInstructionMinutes || 0);
            elements.inputClassroomTotalHours.value = minutes > 0 ? String((minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)) : '';
        }
        if (elements.inputClassroomPrimaryTeacher) elements.inputClassroomPrimaryTeacher.value = String(classroom?.primaryTeacherUid || '');
        if (elements.inputClassroomSessionMinutes) {
            elements.inputClassroomSessionMinutes.value = String(classroom?.scheduleConfig?.sessionMinutes || '');
        }
        if (elements.inputClassroomScheduleTimezone) {
            elements.inputClassroomScheduleTimezone.value = String(classroom?.scheduleConfig?.timezone || '');
        }
        if (elements.inputClassroomDurationStep) {
            elements.inputClassroomDurationStep.value = String(classroom?.scheduleConfig?.durationStepMinutes || 30);
        }
        if (elements.inputClassroomAllowedStartTime) {
            elements.inputClassroomAllowedStartTime.value = String(classroom?.scheduleConfig?.allowedStartTime || '');
        }
        if (elements.inputClassroomAllowedEndTime) {
            elements.inputClassroomAllowedEndTime.value = String(classroom?.scheduleConfig?.allowedEndTime || '');
        }
        if (elements.inputClassroomSeedStartDate) {
            elements.inputClassroomSeedStartDate.value = String(classroom?.scheduleConfig?.seedStartDate || '');
        }
        if (elements.inputClassroomSeedStartTime) {
            elements.inputClassroomSeedStartTime.value = String(classroom?.scheduleConfig?.seedStartTime || '');
        }
        if (elements.inputClassroomSeedWeekdays) {
            const weekdays = Array.isArray(classroom?.scheduleConfig?.seedWeekdays)
                ? classroom.scheduleConfig.seedWeekdays.join(',')
                : '';
            elements.inputClassroomSeedWeekdays.value = weekdays;
        }
        if (elements.inputClassroomMeetingDays) {
            elements.inputClassroomMeetingDays.value = Array.isArray(classroom?.meetingDays)
                ? classroom.meetingDays.join(', ')
                : '';
        }
        if (elements.inputClassroomMeetingHours) {
            elements.inputClassroomMeetingHours.value = Array.isArray(classroom?.meetingHours)
                ? classroom.meetingHours.join(', ')
                : '';
        }
    }

    return {
        applyToForm,
        buildPayload
    };
})();
