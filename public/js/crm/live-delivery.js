window.CrmLiveDelivery = (function () {
    function createController(deps = {}) {
        const {
            elements,
            modalState,
            escapeHtml,
            formatDateTime,
            formatDateTimeLocalValue,
            renderClassroomSchedulePrompt
        } = deps;

        function getPrimaryLiveSession(sessions = []) {
            const rows = Array.isArray(sessions) ? sessions : [];
            return rows.find((row) => row && row.status === 'live')
                || rows.find((row) => row && row.status === 'scheduled')
                || rows[0]
                || null;
        }

        function getSelectedLiveSession() {
            const selectedId = String(modalState.liveSessionId || '').trim();
            if (selectedId === '__new__') {
                return null;
            }
            const sessions = Array.isArray(modalState.liveSessions) ? modalState.liveSessions : [];
            if (selectedId) {
                const selected = sessions.find((row) => String(row?.sessionId || '') === selectedId);
                if (selected) return selected;
            }
            return getPrimaryLiveSession(sessions);
        }

        function resetLiveSessionForm() {
            modalState.liveSessionId = '__new__';
            if (elements.inputLiveSessionTitle) elements.inputLiveSessionTitle.value = '';
            if (elements.inputLiveSessionStatus) elements.inputLiveSessionStatus.value = 'draft';
            if (elements.inputLiveSessionStartAt) elements.inputLiveSessionStartAt.value = '';
            if (elements.inputLiveSessionEndAt) elements.inputLiveSessionEndAt.value = '';
            if (elements.inputLiveSessionMeetingUrl) elements.inputLiveSessionMeetingUrl.value = '';
            if (elements.inputLiveSessionHostUrl) elements.inputLiveSessionHostUrl.value = '';
            if (elements.inputLiveSessionMeetingId) elements.inputLiveSessionMeetingId.value = '';
            if (elements.inputLiveSessionPasscode) elements.inputLiveSessionPasscode.value = '';
            if (elements.inputLiveSessionNotes) elements.inputLiveSessionNotes.value = '';
        }

        function applyLiveSessionToForm(session) {
            if (!session) {
                resetLiveSessionForm();
                return;
            }

            modalState.liveSessionId = String(session.sessionId || '').trim() || null;
            if (elements.inputLiveSessionTitle) elements.inputLiveSessionTitle.value = session.title || '';
            if (elements.inputLiveSessionStatus) elements.inputLiveSessionStatus.value = session.status || 'draft';
            if (elements.inputLiveSessionStartAt) elements.inputLiveSessionStartAt.value = formatDateTimeLocalValue(session.scheduledStartAt);
            if (elements.inputLiveSessionEndAt) elements.inputLiveSessionEndAt.value = formatDateTimeLocalValue(session.scheduledEndAt);
            if (elements.inputLiveSessionMeetingUrl) elements.inputLiveSessionMeetingUrl.value = session.meetingUrl || '';
            if (elements.inputLiveSessionHostUrl) elements.inputLiveSessionHostUrl.value = session.hostUrl || '';
            if (elements.inputLiveSessionMeetingId) elements.inputLiveSessionMeetingId.value = session.meetingId || '';
            if (elements.inputLiveSessionPasscode) elements.inputLiveSessionPasscode.value = session.passcode || '';
            if (elements.inputLiveSessionNotes) elements.inputLiveSessionNotes.value = session.notes || '';
        }

        function collectLiveSessionPayload() {
            return {
                title: String(elements.inputLiveSessionTitle?.value || '').trim(),
                status: String(elements.inputLiveSessionStatus?.value || 'draft').trim() || 'draft',
                scheduledStartAt: String(elements.inputLiveSessionStartAt?.value || '').trim() || null,
                scheduledEndAt: String(elements.inputLiveSessionEndAt?.value || '').trim() || null,
                meetingUrl: String(elements.inputLiveSessionMeetingUrl?.value || '').trim() || null,
                hostUrl: String(elements.inputLiveSessionHostUrl?.value || '').trim() || null,
                meetingId: String(elements.inputLiveSessionMeetingId?.value || '').trim() || null,
                passcode: String(elements.inputLiveSessionPasscode?.value || '').trim() || null,
                notes: String(elements.inputLiveSessionNotes?.value || '').trim() || null
            };
        }

        function renderLiveSessionList(sessions = []) {
            if (!elements.liveSessionList) return;
            const rows = Array.isArray(sessions) ? sessions : [];
            if (!rows.length) {
                elements.liveSessionList.innerHTML = '<div class="crm-muted">No live sessions yet.</div>';
                return;
            }

            const selectedId = String((getSelectedLiveSession() || {}).sessionId || '').trim();
            elements.liveSessionList.innerHTML = rows.map((session) => {
                const isSelected = String(session.sessionId || '') === selectedId;
                const tone = session.status === 'live'
                    ? 'submitted'
                    : session.status === 'scheduled'
                        ? 'created'
                        : session.status === 'ended'
                            ? 'graded'
                            : 'draft';
                const reasons = [];
                if (session.scheduledStartAt) reasons.push(`Start ${formatDateTime(session.scheduledStartAt)}`);
                if (session.meetingId) reasons.push(`Meeting ID ${session.meetingId}`);
                return `
        <button type="button" class="crm-task-item crm-live-session-card ${isSelected ? 'active' : ''}" data-live-session-id="${escapeHtml(session.sessionId || '')}" style="text-align:left; width:100%;">
          <div class="crm-task-head">
            <strong>${escapeHtml(session.title || 'Untitled session')}</strong>
            <span class="crm-test-status ${tone}">${escapeHtml(session.status || 'draft')}</span>
          </div>
          <div class="crm-task-meta">${escapeHtml(reasons.join(' • ') || 'No schedule details yet.')}</div>
          ${session.notes ? `<div class="crm-timeline-meta" style="margin-top:6px;">${escapeHtml(session.notes)}</div>` : ''}
        </button>
      `;
            }).join('');

            Array.from(elements.liveSessionList.querySelectorAll('[data-live-session-id]')).forEach((button) => {
                button.addEventListener('click', () => {
                    modalState.liveSessionId = String(button.dataset.liveSessionId || '').trim() || null;
                    applyLiveSessionToForm(getSelectedLiveSession());
                    renderLiveDeliverySummary(modalState.liveSessions);
                    renderLiveSessionList(modalState.liveSessions);
                    renderAttendanceWorkflowGuidance();
                    renderClassworkWorkflowGuidance();
                });
            });
        }

        function renderLiveDeliverySummary(sessions = []) {
            if (!elements.liveDeliverySummary) return;
            const selected = getSelectedLiveSession() || getPrimaryLiveSession(sessions);
            if (!selected) {
                elements.liveDeliverySummary.innerHTML = '<div class="crm-muted">Create a live session before class starts.</div>';
                if (elements.btnStartLiveSession) elements.btnStartLiveSession.disabled = true;
                if (elements.btnEndLiveSession) elements.btnEndLiveSession.disabled = true;
                if (elements.btnCopyLiveJoinLink) elements.btnCopyLiveJoinLink.disabled = true;
                if (elements.btnCopyLiveHostLink) elements.btnCopyLiveHostLink.disabled = true;
                return;
            }

            const guidance = selected.status === 'live'
                ? 'Session is live. Take attendance and manage class from the Attendance tab.'
                : selected.status === 'scheduled'
                    ? 'Session is scheduled. Start the session when class begins.'
                    : selected.status === 'ended'
                        ? 'Session has ended. Move to classwork and review submissions.'
                        : selected.status === 'cancelled'
                            ? 'Session is cancelled. Create or reschedule another session before class.'
                            : 'Draft session. Add the meeting link and schedule before class starts.';

            elements.liveDeliverySummary.innerHTML = `
      <div class="crm-task-item">
        <div class="crm-task-head">
          <strong>${escapeHtml(selected.title || 'Untitled session')}</strong>
          <span class="crm-test-status ${escapeHtml(selected.status === 'live' ? 'submitted' : selected.status === 'scheduled' ? 'created' : selected.status === 'ended' ? 'graded' : 'draft')}">${escapeHtml(selected.status || 'draft')}</span>
        </div>
        <div class="crm-task-meta">${escapeHtml(guidance)}</div>
        <div class="crm-timeline-meta" style="margin-top: 8px;">Join link: ${selected.meetingUrl ? escapeHtml(selected.meetingUrl) : 'Not set'}</div>
        ${selected.hostUrl ? `<div class="crm-timeline-meta" style="margin-top: 6px;">Host link: ${escapeHtml(selected.hostUrl)}</div>` : ''}
      </div>
    `;

            if (elements.btnStartLiveSession) elements.btnStartLiveSession.disabled = selected.status !== 'scheduled';
            if (elements.btnEndLiveSession) elements.btnEndLiveSession.disabled = selected.status !== 'live';
            if (elements.btnCopyLiveJoinLink) elements.btnCopyLiveJoinLink.disabled = !selected.meetingUrl;
            if (elements.btnCopyLiveHostLink) elements.btnCopyLiveHostLink.disabled = !selected.hostUrl;
        }

        function renderAttendanceWorkflowGuidance() {
            if (!elements.attendanceLiveSessionNote) return;
            const selected = getSelectedLiveSession();
            if (!selected) {
                elements.attendanceLiveSessionNote.textContent = 'Create a live session before class starts.';
                return;
            }
            if (selected.status === 'scheduled') {
                elements.attendanceLiveSessionNote.textContent = `Next step: Start session when class begins. Scheduled for ${formatDateTime(selected.scheduledStartAt)}.`;
                return;
            }
            if (selected.status === 'live') {
                elements.attendanceLiveSessionNote.textContent = 'Next step: Take attendance and manage class while the session is live.';
                return;
            }
            if (selected.status === 'ended') {
                elements.attendanceLiveSessionNote.textContent = 'Last live session ended. Next step: assign homework or review submissions.';
                return;
            }
            if (selected.status === 'cancelled') {
                elements.attendanceLiveSessionNote.textContent = 'Current session is cancelled. Create another session before taking attendance.';
                return;
            }
            elements.attendanceLiveSessionNote.textContent = 'Draft live session found. Add the meeting link and schedule before class starts.';
        }

        function renderClassworkWorkflowGuidance() {
            if (!elements.classworkLiveSessionNote) return;
            const selected = getSelectedLiveSession();
            if (!selected) {
                elements.classworkLiveSessionNote.textContent = 'Create or complete a live session before assigning follow-up work.';
                return;
            }
            if (selected.status === 'ended') {
                elements.classworkLiveSessionNote.textContent = 'Live session ended. Next step: assign homework and review student submissions.';
                return;
            }
            if (selected.status === 'live') {
                elements.classworkLiveSessionNote.textContent = 'Class is currently live. Finish delivery first, then assign follow-up work.';
                return;
            }
            if (selected.status === 'scheduled') {
                elements.classworkLiveSessionNote.textContent = 'Upcoming session scheduled. Use classwork for prep materials or wait until the session ends for homework.';
                return;
            }
            elements.classworkLiveSessionNote.textContent = 'Live delivery has not been finalized yet. Confirm the session before relying on this classwork cycle.';
        }

        async function loadLiveSessions(classId, options = {}) {
            if (!window.ClassroomAPI || typeof window.ClassroomAPI.fetchLiveSessions !== 'function') return [];
            if (!classId) return [];

            const previousSelection = String(options.sessionId || modalState.liveSessionId || '').trim();
            const sessions = await window.ClassroomAPI.fetchLiveSessions(classId);
            modalState.liveSessions = Array.isArray(sessions) ? sessions : [];

            const nextSelection = previousSelection && previousSelection !== '__new__'
                && modalState.liveSessions.find((row) => String(row?.sessionId || '') === previousSelection)
                ? previousSelection
                : String(getPrimaryLiveSession(modalState.liveSessions)?.sessionId || '').trim();
            modalState.liveSessionId = nextSelection || null;

            applyLiveSessionToForm(getSelectedLiveSession());
            renderLiveDeliverySummary(modalState.liveSessions);
            renderLiveSessionList(modalState.liveSessions);
            renderAttendanceWorkflowGuidance();
            renderClassworkWorkflowGuidance();
            return modalState.liveSessions;
        }

        async function refreshAttendanceClassroomFitNote() {
            if (!elements.attendanceClassroomFitNote) return;
            const studentId = String(elements.inputAttendanceStudentSelect?.value || '').trim();
            if (!studentId) {
                elements.attendanceClassroomFitNote.textContent = 'Select a student to see schedule fit guidance.';
                elements.attendanceClassroomFitNote.style.color = '';
                renderClassroomSchedulePrompt();
                return;
            }

            if (!window.ClassroomAPI || typeof window.ClassroomAPI.fetchClassroomMatches !== 'function') {
                elements.attendanceClassroomFitNote.textContent = 'Schedule fit guidance is unavailable.';
                elements.attendanceClassroomFitNote.style.color = '';
                renderClassroomSchedulePrompt();
                return;
            }

            const classroomCourseId = String(elements.inputClassroomCourseId?.value || '').trim();
            const json = await window.ClassroomAPI.fetchClassroomMatches(
                studentId,
                classroomCourseId ? { courseId: classroomCourseId } : {}
            ).catch((error) => {
                console.error('[CRM Admin] Failed to load attendance fit guidance:', error);
                return { matches: [], recommendedClassroom: null };
            });
            const matches = Array.isArray(json.matches) ? json.matches : [];
            const current = matches.find((match) => String(match.classroomId || '') === String(modalState.classroomId || '')) || null;
            const top = matches[0] || null;

            if (!matches.length) {
                elements.attendanceClassroomFitNote.textContent = 'No active classrooms are available to compare.';
                elements.attendanceClassroomFitNote.style.color = '';
                renderClassroomSchedulePrompt();
                return;
            }

            if (!current) {
                elements.attendanceClassroomFitNote.textContent = `Top recommendation is ${top?.name || 'another classroom'} (${Number(top?.fitScore || 0)}% fit).`;
                elements.attendanceClassroomFitNote.style.color = '#b45309';
                renderClassroomSchedulePrompt();
                return;
            }

            if (current.recommended) {
                elements.attendanceClassroomFitNote.textContent = `This classroom is the top recommendation for ${top?.name || 'this student'} (${Number(current.fitScore || 0)}% fit).`;
                elements.attendanceClassroomFitNote.style.color = '#15803d';
                renderClassroomSchedulePrompt();
                return;
            }

            elements.attendanceClassroomFitNote.textContent = `This classroom fits at ${Number(current.fitScore || 0)}% versus ${Number(top?.fitScore || 0)}% for the top recommendation (${top?.name || 'another classroom'}).`;
            elements.attendanceClassroomFitNote.style.color = '#b45309';
            renderClassroomSchedulePrompt();
        }

        return {
            getPrimaryLiveSession,
            getSelectedLiveSession,
            resetLiveSessionForm,
            applyLiveSessionToForm,
            collectLiveSessionPayload,
            renderLiveSessionList,
            renderLiveDeliverySummary,
            renderAttendanceWorkflowGuidance,
            renderClassworkWorkflowGuidance,
            loadLiveSessions,
            refreshAttendanceClassroomFitNote
        };
    }

    return {
        createController
    };
})();
