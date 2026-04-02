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

    /**
     * Pre-fill system-level defaults for NEW classrooms.
     * Only sets a field if it is currently empty, so editing existing
     * classrooms (which call applyToForm first) will never be overwritten.
     */
    function applyDefaults(elements) {
        const setIfEmpty = (el, value) => {
            if (el && !String(el.value || '').trim()) el.value = value;
        };

        // Timezone — all classes run in Vietnam
        setIfEmpty(elements.inputClassroomScheduleTimezone, 'Asia/Bangkok');

        // Seed Start Date — next Monday
        const today = new Date();
        const dow = today.getDay(); // 0=Sun … 6=Sat
        const daysUntilMon = dow === 0 ? 1 : (dow === 1 ? 7 : 8 - dow);
        const nextMonday = new Date(today);
        nextMonday.setDate(today.getDate() + daysUntilMon);
        const yyyy = nextMonday.getFullYear();
        const mm = String(nextMonday.getMonth() + 1).padStart(2, '0');
        const dd = String(nextMonday.getDate()).padStart(2, '0');
        setIfEmpty(elements.inputClassroomSeedStartDate, `${yyyy}-${mm}-${dd}`);

        // Seed Start Time — evening classes are most common
        setIfEmpty(elements.inputClassroomSeedStartTime, '18:00');

        // Seed Weekdays — most common 3-day pattern
        setIfEmpty(elements.inputClassroomSeedWeekdays, 'mon,wed,fri');

        // Allowed time window
        setIfEmpty(elements.inputClassroomAllowedStartTime, '07:00');
        setIfEmpty(elements.inputClassroomAllowedEndTime, '21:00');

        // Duration step
        setIfEmpty(elements.inputClassroomDurationStep, '30');

        // Session minutes fallback
        setIfEmpty(elements.inputClassroomSessionMinutes, '120');
    }

    /**
     * Auto-fill scheduling fields from the selected course's data attributes.
     * Called when the course dropdown changes.
     */
    function applyCourseDefaults(elements) {
        const option = elements.inputClassroomCourseId?.selectedOptions?.[0] || null;
        if (!option || !option.value) return;

        const totalMinutes = Number(option.dataset?.totalMinutes || 0);
        const sessionMinutes = Number(option.dataset?.defaultSessionMinutes || 0);
        const durationStep = Number(option.dataset?.durationStepMinutes || 0);
        const timezone = String(option.dataset?.timezone || '').trim();

        if (totalMinutes > 0 && elements.inputClassroomTotalHours) {
            const hours = totalMinutes / 60;
            elements.inputClassroomTotalHours.value = String(
                totalMinutes % 60 === 0 ? hours.toFixed(0) : hours.toFixed(1)
            );
        }
        if (sessionMinutes > 0 && elements.inputClassroomSessionMinutes) {
            elements.inputClassroomSessionMinutes.value = String(sessionMinutes);
        }
        if (durationStep > 0 && elements.inputClassroomDurationStep) {
            elements.inputClassroomDurationStep.value = String(durationStep);
        }
        if (timezone && elements.inputClassroomScheduleTimezone) {
            elements.inputClassroomScheduleTimezone.value = timezone;
        }

        // After course defaults, sync meeting fields
        syncMeetingFieldsFromSeed(elements);
    }

    /**
     * Auto-sync Meeting Days and Meeting Hours from seed configuration.
     * - Seed Weekdays → Meeting Days (capitalized)
     * - Seed Start Time + Session Minutes → Meeting Hours range
     */
    function syncMeetingFieldsFromSeed(elements) {
        // Sync weekdays → meeting days
        const seedWeekdays = String(elements.inputClassroomSeedWeekdays?.value || '').trim();
        if (seedWeekdays && elements.inputClassroomMeetingDays) {
            const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
            const formatted = seedWeekdays.split(',').map((d) => capitalize(d.trim())).filter(Boolean).join(', ');
            elements.inputClassroomMeetingDays.value = formatted;
        }

        // Sync start time + duration → meeting hours
        const seedStartTime = String(elements.inputClassroomSeedStartTime?.value || '').trim();
        const sessionMinutes = Number(elements.inputClassroomSessionMinutes?.value || 0);
        if (seedStartTime && sessionMinutes > 0 && elements.inputClassroomMeetingHours) {
            const [hh, mi] = seedStartTime.split(':').map(Number);
            if (Number.isFinite(hh) && Number.isFinite(mi)) {
                const totalEnd = hh * 60 + mi + sessionMinutes;
                const endH = String(Math.floor(totalEnd / 60) % 24).padStart(2, '0');
                const endM = String(totalEnd % 60).padStart(2, '0');
                elements.inputClassroomMeetingHours.value = `${seedStartTime}-${endH}:${endM}`;
            }
        }
    }

    return {
        applyToForm,
        applyDefaults,
        applyCourseDefaults,
        syncMeetingFieldsFromSeed,
        buildPayload
    };
})();
