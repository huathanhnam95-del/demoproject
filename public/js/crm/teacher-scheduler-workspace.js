window.TeacherSchedulerWorkspace = (function () {
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function toLocalDateInput(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function startOfWeek(date = new Date()) {
        const next = new Date(date);
        const weekday = next.getDay() || 7;
        next.setDate(next.getDate() - weekday + 1);
        next.setHours(0, 0, 0, 0);
        return next;
    }

    function addDays(date, days) {
        const next = new Date(date);
        next.setDate(next.getDate() + Number(days || 0));
        return next;
    }

    function parseTimeToMinutes(value) {
        const [h, m] = String(value || '').split(':').map((part) => Number(part));
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        return (h * 60) + m;
    }

    function formatTimeRange(start, durationMinutes) {
        const startMinutes = parseTimeToMinutes(start);
        if (!Number.isFinite(startMinutes)) return start || '';
        const endMinutes = startMinutes + Number(durationMinutes || 0);
        const endHours = Math.floor(endMinutes / 60) % 24;
        const endMins = endMinutes % 60;
        return `${start} - ${pad(endHours)}:${pad(endMins)}`;
    }

    function hourSlots(fromHour = 7, toHour = 21) {
        const slots = [];
        for (let hour = fromHour; hour < toHour; hour += 1) {
            slots.push(`${pad(hour)}:00`);
            slots.push(`${pad(hour)}:30`);
        }
        return slots;
    }

    function closestTarget(evt, selector) {
        const rawTarget = evt?.target || null;
        const target = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement;
        return target?.closest(selector) || null;
    }

    function isLockedSession(session) {
        return String(session?.lockState || 'unlocked') === 'hard_locked'
            || String(session?.attendanceState || 'none') === 'in_progress'
            || String(session?.attendanceState || 'none') === 'finalized';
    }

    function createController(deps = {}) {
        const {
            elements,
            showToast
        } = deps;

        const state = {
            loaded: false,
            classrooms: [],
            sessions: [],
            fromDate: null,
            toDate: null,
            placementClassroomId: '',
            quickAdd: null,
            sessionBubble: null,
            patternClassId: '',
            patternStartTime: '18:00',
            patternWeekdays: new Set([1, 3, 5]),
            activationSummary: null,
            pendingSessionIds: new Set(),
            slotErrors: new Map(),
            pointerDrag: null,
            suppressedSessionClickId: null
        };

        function currentRange() {
            const from = state.fromDate ? new Date(`${state.fromDate}T00:00:00`) : startOfWeek(new Date());
            const to = state.toDate ? new Date(`${state.toDate}T23:59:59`) : addDays(from, 6);
            return { from, to };
        }

        function getRenderDays() {
            const { from, to } = currentRange();
            const days = [];
            const cursor = new Date(from);
            while (cursor <= to) {
                days.push(new Date(cursor));
                cursor.setDate(cursor.getDate() + 1);
            }
            return days;
        }

        function getClassroomById(classId) {
            return state.classrooms.find((classroom) => String(classroom.classroomId || '') === String(classId || '').trim()) || null;
        }

        function getSessionLocalDate(session) {
            if (session?.scheduledLocalDate) return String(session.scheduledLocalDate);
            if (!session?.scheduledStartAtUtc) return '';
            return String(new Date(session.scheduledStartAtUtc).toISOString().slice(0, 10));
        }

        function getSessionLocalTime(session) {
            if (session?.scheduledLocalTime) return String(session.scheduledLocalTime).slice(0, 5);
            const start = session?.scheduledStartAtUtc ? new Date(session.scheduledStartAtUtc) : null;
            return start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '';
        }

        function setToolbarDefaults() {
            if (!elements.inputTeacherSchedulerFromDate?.value) {
                elements.inputTeacherSchedulerFromDate.value = toLocalDateInput(startOfWeek(new Date()));
            }
            if (!elements.inputTeacherSchedulerToDate?.value) {
                const end = addDays(startOfWeek(new Date()), 6);
                elements.inputTeacherSchedulerToDate.value = toLocalDateInput(end);
            }
        }

        function clearPlacementMode() {
            state.placementClassroomId = '';
            renderClassRail();
        }

        function renderClassRail() {
            if (!elements.teacherSchedulerClassList) return;
            if (!state.classrooms.length) {
                elements.teacherSchedulerClassList.innerHTML = '<div class="crm-muted">No classrooms assigned yet.</div>';
                return;
            }

            elements.teacherSchedulerClassList.innerHTML = state.classrooms.map((classroom) => {
                const classId = String(classroom.classroomId || '');
                const summary = classroom.scheduleSummary || {};
                const assigned = Number(summary.contractedAssignedCount || 0);
                const target = Number(summary.contractedTargetCount || 0);
                const activeClass = state.placementClassroomId === classId ? 'is-armed' : '';
                return `
                    <button type="button" class="scheduler-class-card teacher-scheduler-class-card ${activeClass}" data-classroom-id="${escapeHtml(classId)}">
                        <div class="scheduler-class-card-title">${escapeHtml(classroom.name || classId)}</div>
                        <div class="scheduler-class-card-meta">${assigned}/${target} contracted scheduled</div>
                        <div class="scheduler-class-card-meta">${activeClass ? 'Placement mode active (Esc to exit)' : 'Click to arm placement mode'}</div>
                    </button>
                `;
            }).join('');

            if (elements.inputTeacherSchedulerPatternClass) {
                const selected = state.patternClassId && getClassroomById(state.patternClassId)
                    ? state.patternClassId
                    : String(state.classrooms[0]?.classroomId || '');
                state.patternClassId = selected;
                elements.inputTeacherSchedulerPatternClass.innerHTML = state.classrooms.map((classroom) => {
                    const classId = String(classroom.classroomId || '');
                    const selectedAttr = selected === classId ? ' selected' : '';
                    return `<option value="${escapeHtml(classId)}"${selectedAttr}>${escapeHtml(classroom.name || classId)}</option>`;
                }).join('');
            }

            renderPatternSummary();
        }

        function renderPatternSummary() {
            if (!elements.teacherSchedulerPatternSummary) return;
            const classroom = getClassroomById(state.patternClassId);
            const remaining = Number(classroom?.scheduleSummary?.remainingToScheduleCount || 0);
            const selectedDays = Array.from(state.patternWeekdays).sort((a, b) => a - b).map((day) => DAY_LABELS[day]).join(', ');
            const endLabel = remaining > 0 ? `Ends after ${remaining} occurrence${remaining === 1 ? '' : 's'}` : 'No remaining contracted sessions';
            elements.teacherSchedulerPatternSummary.textContent = `${selectedDays || 'No days selected'} • ${state.patternStartTime} • ${endLabel}`;
        }

        function renderActivationSummary() {
            if (!elements.teacherSchedulerActivationSummary) return;
            const summary = state.activationSummary;
            if (!summary) {
                elements.teacherSchedulerActivationSummary.style.display = 'none';
                elements.teacherSchedulerActivationSummary.innerHTML = '';
                return;
            }
            elements.teacherSchedulerActivationSummary.style.display = 'block';
            const counts = summary.summary || {};
            const details = Array.isArray(summary.details) ? summary.details : [];
            const detailsHtml = details.map((entry) => `
                <li>
                    <strong>${escapeHtml(entry.className || entry.classId || 'Class')}</strong>:
                    ${escapeHtml(entry.message || '')}
                    (${Number(entry.createdCount || 0)} created, ${Number(entry.blockedCount || 0)} blocked)
                </li>
            `).join('');
            elements.teacherSchedulerActivationSummary.innerHTML = `
                <div><strong>Activate recurrences:</strong> ${Number(counts.successCount || 0)} success, ${Number(counts.blockedCount || 0)} blocked, ${Number(counts.errorCount || 0)} error.</div>
                <details>
                    <summary>View details</summary>
                    <ul>${detailsHtml || '<li>No details.</li>'}</ul>
                </details>
            `;
        }

        function renderCalendarGrid() {
            if (!elements.teacherSchedulerCalendar) return;
            const days = getRenderDays();
            const slots = hourSlots(7, 21);
            const slotErrors = state.slotErrors;
            let html = '<div class="scheduler-calendar-grid">';
            html += '<div class="scheduler-calendar-head"></div>';
            days.forEach((day) => {
                html += `<div class="scheduler-calendar-head">${DAY_LABELS[day.getDay()]} ${pad(day.getDate())}</div>`;
            });

            slots.forEach((slotTime) => {
                html += `<div class="scheduler-calendar-time">${slotTime}</div>`;
                days.forEach((day) => {
                    const dateStr = toLocalDateInput(day);
                    const key = `${dateStr}|${slotTime}`;
                    const errorText = slotErrors.get(key) || '';
                    const sessions = state.sessions.filter((session) =>
                        getSessionLocalDate(session) === dateStr && getSessionLocalTime(session) === slotTime
                    );
                    html += `
                        <div class="scheduler-calendar-cell">
                            <div class="scheduler-calendar-slot teacher-scheduler-slot" data-date="${dateStr}" data-time="${slotTime}">
                                ${sessions.map((session) => {
                                    const sessionId = String(session.sessionId || '');
                                    const classroom = getClassroomById(session.classId);
                                    const title = classroom?.name || session.classId || 'Class';
                                    const pending = state.pendingSessionIds.has(sessionId) ? 'is-saving' : '';
                                    const label = session.unitType === 'overflow'
                                        ? `Overflow ${session.overflowSequence || ''}`.trim()
                                        : `Unit ${session.contractUnitIndex || ''}`.trim();
                                    return `
                                        <button type="button" class="scheduler-session-pill teacher-scheduler-session-pill ${pending}" data-session-id="${escapeHtml(sessionId)}">
                                            <strong>${escapeHtml(title)}</strong>
                                            <small>${escapeHtml(label)}</small>
                                        </button>
                                    `;
                                }).join('')}
                                ${errorText ? `<div class="teacher-scheduler-slot-error">${escapeHtml(errorText)}</div>` : ''}
                            </div>
                        </div>
                    `;
                });
            });
            html += '</div>';
            elements.teacherSchedulerCalendar.innerHTML = html;
        }

        function closeQuickAdd() {
            state.quickAdd = null;
            renderQuickAdd();
        }

        function openQuickAdd(targetDate, targetTime, anchorRect, classId = '') {
            const preferredClassId = classId && getClassroomById(classId)
                ? classId
                : (state.patternClassId && getClassroomById(state.patternClassId)
                    ? state.patternClassId
                    : String(state.classrooms[0]?.classroomId || ''));
            const classroom = getClassroomById(preferredClassId);
            state.quickAdd = {
                classId: preferredClassId,
                targetDate,
                targetTime,
                durationMinutes: Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 120,
                anchorLeft: Number(anchorRect?.left || 0),
                anchorTop: Number(anchorRect?.bottom || 0),
                error: '',
                suggestions: []
            };
            renderQuickAdd();
        }

        function renderQuickAdd() {
            if (!elements.teacherSchedulerQuickAdd) return;
            const draft = state.quickAdd;
            if (!draft || !state.classrooms.length) {
                elements.teacherSchedulerQuickAdd.style.display = 'none';
                elements.teacherSchedulerQuickAdd.setAttribute('aria-hidden', 'true');
                return;
            }

            elements.teacherSchedulerQuickAdd.style.display = 'block';
            elements.teacherSchedulerQuickAdd.setAttribute('aria-hidden', 'false');
            elements.teacherSchedulerQuickAdd.style.left = `${Math.max(16, draft.anchorLeft)}px`;
            elements.teacherSchedulerQuickAdd.style.top = `${Math.max(16, draft.anchorTop + window.scrollY)}px`;
            if (elements.inputTeacherSchedulerQuickClass) {
                elements.inputTeacherSchedulerQuickClass.innerHTML = state.classrooms.map((classroom) => {
                    const classId = String(classroom.classroomId || '');
                    const selected = classId === draft.classId ? ' selected' : '';
                    return `<option value="${escapeHtml(classId)}"${selected}>${escapeHtml(classroom.name || classId)}</option>`;
                }).join('');
            }
            if (elements.inputTeacherSchedulerQuickDate) {
                elements.inputTeacherSchedulerQuickDate.value = draft.targetDate;
            }
            if (elements.inputTeacherSchedulerQuickTime) {
                elements.inputTeacherSchedulerQuickTime.value = draft.targetTime;
            }
            if (elements.inputTeacherSchedulerQuickDuration) {
                elements.inputTeacherSchedulerQuickDuration.value = `${Number(draft.durationMinutes || 0)} minutes`;
            }
            if (elements.teacherSchedulerQuickError) {
                elements.teacherSchedulerQuickError.textContent = draft.error || '';
                elements.teacherSchedulerQuickError.style.display = draft.error ? 'block' : 'none';
            }
            if (elements.teacherSchedulerQuickSuggestions) {
                const list = Array.isArray(draft.suggestions) ? draft.suggestions : [];
                elements.teacherSchedulerQuickSuggestions.innerHTML = list.length
                    ? `<div class="crm-muted">Suggested open times: ${list.map((item) => `${item.date} ${item.time}`).join(' • ')}</div>`
                    : '';
            }
        }

        function markSlotError(targetDate, targetTime, message) {
            const key = `${targetDate}|${targetTime}`;
            state.slotErrors.set(key, String(message || 'Unavailable slot'));
            renderCalendarGrid();
            window.setTimeout(() => {
                state.slotErrors.delete(key);
                renderCalendarGrid();
            }, 4000);
        }

        function computeSuggestions(classId, durationMinutes, excludeSessionId = '') {
            const suggestions = [];
            const slots = hourSlots(7, 21);
            const days = getRenderDays();
            const sessions = state.sessions.filter((session) => String(session.sessionId || '') !== String(excludeSessionId || ''));

            function conflictsWithSession(candidateDate, candidateTime, minutes) {
                const candidateStart = parseTimeToMinutes(candidateTime);
                const candidateEnd = candidateStart + Number(minutes || 0);
                return sessions.some((session) => {
                    if (getSessionLocalDate(session) !== candidateDate) return false;
                    const start = parseTimeToMinutes(getSessionLocalTime(session));
                    const end = start + Number(session.durationMinutes || 0);
                    return candidateStart < end && candidateEnd > start;
                });
            }

            for (const day of days) {
                const date = toLocalDateInput(day);
                for (const time of slots) {
                    if (!conflictsWithSession(date, time, durationMinutes)) {
                        suggestions.push({ classId, date, time });
                        if (suggestions.length >= 5) {
                            return suggestions;
                        }
                    }
                }
            }
            return suggestions;
        }

        async function placeClassroomSession(classId, targetDate, targetTime, options = {}) {
            const classroom = getClassroomById(classId);
            if (!classroom || !window.ClassroomAPI?.teacherAddClassroomSession) {
                throw new Error('Teacher scheduler API unavailable.');
            }
            const durationMinutes = Number(classroom.scheduleConfig?.sessionMinutes || 0) || 120;
            try {
                await window.ClassroomAPI.teacherAddClassroomSession(classId, {
                    targetLocalDate: targetDate,
                    targetLocalTime: targetTime,
                    durationMinutes,
                    timezone: classroom.scheduleConfig?.timezone || 'UTC'
                });
                if (!options.silentToast) {
                    showToast?.('Session added.', 'success');
                }
                await refresh();
            } catch (error) {
                const message = error?.message || 'Failed to add session.';
                markSlotError(targetDate, targetTime, message);
                throw error;
            }
        }

        async function commitQuickAdd() {
            const draft = state.quickAdd;
            if (!draft) return;
            try {
                await placeClassroomSession(draft.classId, draft.targetDate, draft.targetTime, { silentToast: true });
                showToast?.('Session added.', 'success');
                closeQuickAdd();
            } catch (error) {
                draft.error = error?.message || 'Failed to add session.';
                draft.suggestions = computeSuggestions(draft.classId, draft.durationMinutes);
                renderQuickAdd();
            }
        }

        function closeSessionBubble() {
            state.sessionBubble = null;
            renderSessionBubble();
        }

        function openSessionBubble(sessionId, anchorRect) {
            state.sessionBubble = {
                sessionId: String(sessionId || ''),
                anchorLeft: Number(anchorRect?.left || 0),
                anchorTop: Number(anchorRect?.bottom || 0)
            };
            renderSessionBubble();
        }

        function renderSessionBubble() {
            if (!elements.teacherSchedulerSessionBubble) return;
            const bubble = state.sessionBubble;
            const session = bubble ? state.sessions.find((item) => String(item.sessionId || '') === bubble.sessionId) : null;
            if (!bubble || !session) {
                elements.teacherSchedulerSessionBubble.style.display = 'none';
                elements.teacherSchedulerSessionBubble.setAttribute('aria-hidden', 'true');
                return;
            }
            const classroom = getClassroomById(session.classId);
            const lockStatus = isLockedSession(session) ? 'Locked' : 'Editable';
            const label = session.unitType === 'overflow'
                ? `Overflow ${session.overflowSequence || ''}`.trim()
                : `Unit ${session.contractUnitIndex || ''}`.trim();
            elements.teacherSchedulerSessionBubble.style.display = 'block';
            elements.teacherSchedulerSessionBubble.setAttribute('aria-hidden', 'false');
            elements.teacherSchedulerSessionBubble.style.left = `${Math.max(16, bubble.anchorLeft)}px`;
            elements.teacherSchedulerSessionBubble.style.top = `${Math.max(16, bubble.anchorTop + window.scrollY)}px`;
            if (elements.teacherSchedulerSessionBubbleTitle) {
                elements.teacherSchedulerSessionBubbleTitle.textContent = classroom?.name || session.classId || 'Class';
            }
            if (elements.teacherSchedulerSessionBubbleMeta) {
                elements.teacherSchedulerSessionBubbleMeta.textContent = `${getSessionLocalDate(session)} ${formatTimeRange(getSessionLocalTime(session), session.durationMinutes)} • ${label}`;
            }
            if (elements.teacherSchedulerSessionBubbleLock) {
                elements.teacherSchedulerSessionBubbleLock.textContent = lockStatus;
            }
            if (elements.btnTeacherSchedulerCancelSession) {
                elements.btnTeacherSchedulerCancelSession.disabled = isLockedSession(session);
                elements.btnTeacherSchedulerCancelSession.dataset.sessionId = String(session.sessionId || '');
            }
            if (elements.btnTeacherSchedulerDuplicateSession) {
                elements.btnTeacherSchedulerDuplicateSession.dataset.sessionId = String(session.sessionId || '');
            }
            if (elements.btnTeacherSchedulerOpenAttendance) {
                elements.btnTeacherSchedulerOpenAttendance.dataset.sessionId = String(session.sessionId || '');
            }
        }

        async function cancelSession(sessionId) {
            if (!window.ClassroomAPI?.teacherCancelScheduledSession) {
                throw new Error('Cancel session API unavailable.');
            }
            await window.ClassroomAPI.teacherCancelScheduledSession(sessionId);
            showToast?.('Session cancelled.', 'success');
            closeSessionBubble();
            await refresh();
        }

        async function duplicateSession(sessionId) {
            const session = state.sessions.find((item) => String(item.sessionId || '') === String(sessionId || ''));
            if (!session) return;
            const slot = elements.teacherSchedulerCalendar?.querySelector(`.teacher-scheduler-slot[data-date="${getSessionLocalDate(session)}"][data-time="${getSessionLocalTime(session)}"]`);
            openQuickAdd(getSessionLocalDate(session), getSessionLocalTime(session), slot?.getBoundingClientRect?.() || null, session.classId);
            closeSessionBubble();
        }

        async function activateRecurrences() {
            if (!window.ClassroomAPI?.teacherActivateRecurrences) {
                showToast?.('Activate recurrences API unavailable.', 'error');
                return;
            }
            const expectedScheduleVersions = {};
            state.classrooms.forEach((classroom) => {
                expectedScheduleVersions[String(classroom.classroomId || '')] = Number(classroom?.scheduleConfig?.scheduleVersion || 0) || 1;
            });
            try {
                const result = await window.ClassroomAPI.teacherActivateRecurrences({
                    from: state.fromDate,
                    to: state.toDate,
                    expectedScheduleVersions
                });
                state.activationSummary = result;
                renderActivationSummary();
                await refresh();
            } catch (error) {
                showToast?.(error?.message || 'Failed to activate recurrences.', 'error');
            }
        }

        async function placePatternWeek() {
            if (!window.ClassroomAPI?.teacherAddClassroomSessionMulti) {
                showToast?.('Weekly pattern API unavailable.', 'error');
                return;
            }
            const classId = String(elements.inputTeacherSchedulerPatternClass?.value || state.patternClassId || '').trim();
            const weekdays = Array.from(state.patternWeekdays);
            if (!classId || !weekdays.length) {
                showToast?.('Choose a class and at least one weekday.', 'error');
                return;
            }
            try {
                const result = await window.ClassroomAPI.teacherAddClassroomSessionMulti(classId, {
                    weekdays,
                    startTime: state.patternStartTime,
                    from: state.fromDate,
                    to: state.toDate
                });
                const createdCount = Array.isArray(result?.createdSessions) ? result.createdSessions.length : 0;
                const skippedCount = Array.isArray(result?.skippedOccurrences) ? result.skippedOccurrences.length : 0;
                showToast?.(`${createdCount} session(s) placed${skippedCount ? `, ${skippedCount} skipped` : ''}.`, 'success');
                await refresh();
            } catch (error) {
                showToast?.(error?.message || 'Failed to place weekly pattern.', 'error');
            }
        }

        async function refresh() {
            if (!window.ClassroomAPI?.fetchTeacherSchedulerWorkspace) return;
            const from = String(elements.inputTeacherSchedulerFromDate?.value || '').trim();
            const to = String(elements.inputTeacherSchedulerToDate?.value || '').trim();
            const payload = await window.ClassroomAPI.fetchTeacherSchedulerWorkspace({ from, to });
            state.classrooms = Array.isArray(payload?.classrooms) ? payload.classrooms : [];
            state.sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
            state.fromDate = from || payload?.from || null;
            state.toDate = to || payload?.to || null;
            if (!getClassroomById(state.placementClassroomId)) {
                state.placementClassroomId = '';
            }
            if (!getClassroomById(state.patternClassId)) {
                state.patternClassId = String(state.classrooms[0]?.classroomId || '');
            }
            renderClassRail();
            renderActivationSummary();
            renderCalendarGrid();
            renderQuickAdd();
            renderSessionBubble();
        }

        function beginPointerDrag(kind, id, sourceEl, evt) {
            if (evt.button !== 0 || !id || !sourceEl) return;
            state.pointerDrag = {
                kind,
                id: String(id || '').trim(),
                sourceEl,
                startX: evt.clientX,
                startY: evt.clientY,
                active: false,
                activeSlot: null
            };
        }

        function updateDropTarget(slot) {
            const current = state.pointerDrag?.activeSlot || null;
            if (current === slot) return;
            if (current) current.classList.remove('is-drop-target');
            if (state.pointerDrag) state.pointerDrag.activeSlot = slot || null;
            if (slot) slot.classList.add('is-drop-target');
        }

        function findSlotFromPoint(clientX, clientY) {
            return document.elementFromPoint(clientX, clientY)?.closest('.teacher-scheduler-slot') || null;
        }

        function clearPointerDrag() {
            const drag = state.pointerDrag;
            if (drag?.activeSlot) drag.activeSlot.classList.remove('is-drop-target');
            if (drag?.sourceEl) drag.sourceEl.classList.remove('is-dragging');
            state.pointerDrag = null;
        }

        async function handleSessionDrop(sessionId, targetDate, targetTime) {
            const session = state.sessions.find((row) => String(row.sessionId || '') === String(sessionId || ''));
            if (!session) return;
            const previousDate = getSessionLocalDate(session);
            const previousTime = getSessionLocalTime(session);
            if (previousDate === targetDate && previousTime === targetTime) return;
            session.scheduledLocalDate = targetDate;
            session.scheduledLocalTime = targetTime;
            state.pendingSessionIds.add(String(sessionId || ''));
            renderCalendarGrid();
            try {
                await window.ClassroomAPI.teacherRescheduleScheduledSession(sessionId, {
                    targetLocalDate: targetDate,
                    targetLocalTime: targetTime,
                    durationMinutes: Number(session.durationMinutes || 0) || 120,
                    timezone: session.timezone || 'UTC'
                });
                showToast?.('Session rescheduled.', 'success');
                await refresh();
            } catch (error) {
                session.scheduledLocalDate = previousDate;
                session.scheduledLocalTime = previousTime;
                const message = error?.message || 'Failed to reschedule session.';
                showToast?.(message, 'error');
                markSlotError(targetDate, targetTime, message);
                renderCalendarGrid();
            } finally {
                state.pendingSessionIds.delete(String(sessionId || ''));
            }
        }

        function bindEvents() {
            if (elements.btnTeacherSchedulerRefresh) {
                elements.btnTeacherSchedulerRefresh.addEventListener('click', () => {
                    refresh().catch((error) => showToast?.(error?.message || 'Failed to refresh teacher scheduler.', 'error'));
                });
            }
            if (elements.inputTeacherSchedulerFromDate) {
                elements.inputTeacherSchedulerFromDate.addEventListener('change', () => refresh().catch(() => {}));
            }
            if (elements.inputTeacherSchedulerToDate) {
                elements.inputTeacherSchedulerToDate.addEventListener('change', () => refresh().catch(() => {}));
            }
            if (elements.teacherSchedulerClassList) {
                elements.teacherSchedulerClassList.addEventListener('click', (evt) => {
                    const card = closestTarget(evt, '.teacher-scheduler-class-card[data-classroom-id]');
                    if (!card) return;
                    const classId = String(card.dataset.classroomId || '').trim();
                    state.placementClassroomId = state.placementClassroomId === classId ? '' : classId;
                    renderClassRail();
                });
            }
            if (elements.teacherSchedulerCalendar) {
                elements.teacherSchedulerCalendar.addEventListener('click', (evt) => {
                    const pill = closestTarget(evt, '.teacher-scheduler-session-pill[data-session-id]');
                    if (pill) {
                        const sessionId = String(pill.dataset.sessionId || '').trim();
                        if (state.suppressedSessionClickId === sessionId) {
                            state.suppressedSessionClickId = null;
                            return;
                        }
                        openSessionBubble(sessionId, pill.getBoundingClientRect());
                        return;
                    }

                    const slot = closestTarget(evt, '.teacher-scheduler-slot[data-date][data-time]');
                    if (!slot) return;
                    const targetDate = String(slot.dataset.date || '').trim();
                    const targetTime = String(slot.dataset.time || '').trim();
                    if (!targetDate || !targetTime) return;
                    if (state.placementClassroomId) {
                        placeClassroomSession(state.placementClassroomId, targetDate, targetTime, { silentToast: true })
                            .then(() => showToast?.('Placed session.', 'success'))
                            .catch((error) => showToast?.(error?.message || 'Failed to place session.', 'error'));
                        return;
                    }
                    openQuickAdd(targetDate, targetTime, slot.getBoundingClientRect());
                });

                elements.teacherSchedulerCalendar.addEventListener('mousedown', (evt) => {
                    const pill = closestTarget(evt, '.teacher-scheduler-session-pill[data-session-id]');
                    if (!pill) return;
                    beginPointerDrag('session', pill.dataset.sessionId, pill, evt);
                });
            }

            document.addEventListener('mousemove', (evt) => {
                if (!state.pointerDrag) return;
                const deltaX = evt.clientX - state.pointerDrag.startX;
                const deltaY = evt.clientY - state.pointerDrag.startY;
                const distance = Math.sqrt((deltaX ** 2) + (deltaY ** 2));
                if (!state.pointerDrag.active && distance < 6) return;
                if (!state.pointerDrag.active) {
                    state.pointerDrag.active = true;
                    state.pointerDrag.sourceEl?.classList.add('is-dragging');
                }
                updateDropTarget(findSlotFromPoint(evt.clientX, evt.clientY));
            });

            document.addEventListener('mouseup', (evt) => {
                if (!state.pointerDrag) return;
                const drag = state.pointerDrag;
                const slot = drag.active ? (findSlotFromPoint(evt.clientX, evt.clientY) || drag.activeSlot) : null;
                const shouldSuppressClick = drag.active && drag.kind === 'session';
                clearPointerDrag();
                if (shouldSuppressClick) {
                    state.suppressedSessionClickId = drag.id;
                    window.setTimeout(() => {
                        if (state.suppressedSessionClickId === drag.id) {
                            state.suppressedSessionClickId = null;
                        }
                    }, 250);
                }
                if (!drag.active || !slot) return;
                const targetDate = String(slot.dataset.date || '').trim();
                const targetTime = String(slot.dataset.time || '').trim();
                if (!targetDate || !targetTime) return;
                handleSessionDrop(drag.id, targetDate, targetTime).catch((error) => {
                    showToast?.(error?.message || 'Failed to reschedule.', 'error');
                });
            });

            document.addEventListener('keydown', (evt) => {
                if (evt.key !== 'Escape') return;
                clearPlacementMode();
                closeQuickAdd();
                closeSessionBubble();
            });

            if (elements.btnTeacherSchedulerQuickCancel) {
                elements.btnTeacherSchedulerQuickCancel.addEventListener('click', () => closeQuickAdd());
            }
            if (elements.btnTeacherSchedulerQuickAdd) {
                elements.btnTeacherSchedulerQuickAdd.addEventListener('click', () => {
                    commitQuickAdd().catch((error) => showToast?.(error?.message || 'Failed to add session.', 'error'));
                });
            }
            if (elements.inputTeacherSchedulerQuickClass) {
                elements.inputTeacherSchedulerQuickClass.addEventListener('change', () => {
                    const classId = String(elements.inputTeacherSchedulerQuickClass.value || '').trim();
                    const classroom = getClassroomById(classId);
                    if (!state.quickAdd) return;
                    state.quickAdd.classId = classId;
                    state.quickAdd.durationMinutes = Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 120;
                    renderQuickAdd();
                });
            }
            if (elements.inputTeacherSchedulerQuickDate) {
                elements.inputTeacherSchedulerQuickDate.addEventListener('change', () => {
                    if (!state.quickAdd) return;
                    state.quickAdd.targetDate = String(elements.inputTeacherSchedulerQuickDate.value || '').trim();
                });
            }
            if (elements.inputTeacherSchedulerQuickTime) {
                elements.inputTeacherSchedulerQuickTime.addEventListener('change', () => {
                    if (!state.quickAdd) return;
                    state.quickAdd.targetTime = String(elements.inputTeacherSchedulerQuickTime.value || '').trim();
                });
            }

            if (elements.inputTeacherSchedulerPatternClass) {
                elements.inputTeacherSchedulerPatternClass.addEventListener('change', () => {
                    state.patternClassId = String(elements.inputTeacherSchedulerPatternClass.value || '').trim();
                    renderPatternSummary();
                });
            }
            if (elements.inputTeacherSchedulerPatternTime) {
                elements.inputTeacherSchedulerPatternTime.addEventListener('change', () => {
                    state.patternStartTime = String(elements.inputTeacherSchedulerPatternTime.value || '18:00').trim() || '18:00';
                    renderPatternSummary();
                });
            }
            if (elements.teacherSchedulerPatternDays) {
                elements.teacherSchedulerPatternDays.addEventListener('click', (evt) => {
                    const chip = closestTarget(evt, '.teacher-scheduler-day-chip[data-day]');
                    if (!chip) return;
                    const day = Number(chip.dataset.day || -1);
                    if (!Number.isInteger(day) || day < 0 || day > 6) return;
                    if (state.patternWeekdays.has(day)) {
                        state.patternWeekdays.delete(day);
                    } else {
                        state.patternWeekdays.add(day);
                    }
                    elements.teacherSchedulerPatternDays.querySelectorAll('.teacher-scheduler-day-chip[data-day]').forEach((node) => {
                        const nodeDay = Number(node.dataset.day || -1);
                        node.classList.toggle('is-selected', state.patternWeekdays.has(nodeDay));
                    });
                    renderPatternSummary();
                });
            }
            if (elements.btnTeacherSchedulerPlaceWeek) {
                elements.btnTeacherSchedulerPlaceWeek.addEventListener('click', () => {
                    placePatternWeek().catch((error) => showToast?.(error?.message || 'Failed to place week.', 'error'));
                });
            }
            if (elements.btnTeacherSchedulerActivateRecurrences) {
                elements.btnTeacherSchedulerActivateRecurrences.addEventListener('click', () => {
                    activateRecurrences().catch((error) => showToast?.(error?.message || 'Failed to activate recurrences.', 'error'));
                });
            }
            if (elements.btnTeacherSchedulerCloseBubble) {
                elements.btnTeacherSchedulerCloseBubble.addEventListener('click', () => closeSessionBubble());
            }
            if (elements.btnTeacherSchedulerCancelSession) {
                elements.btnTeacherSchedulerCancelSession.addEventListener('click', () => {
                    const sessionId = String(elements.btnTeacherSchedulerCancelSession.dataset.sessionId || '').trim();
                    if (!sessionId) return;
                    cancelSession(sessionId).catch((error) => showToast?.(error?.message || 'Failed to cancel session.', 'error'));
                });
            }
            if (elements.btnTeacherSchedulerDuplicateSession) {
                elements.btnTeacherSchedulerDuplicateSession.addEventListener('click', () => {
                    const sessionId = String(elements.btnTeacherSchedulerDuplicateSession.dataset.sessionId || '').trim();
                    duplicateSession(sessionId).catch((error) => showToast?.(error?.message || 'Failed to duplicate session.', 'error'));
                });
            }
            if (elements.btnTeacherSchedulerOpenAttendance) {
                elements.btnTeacherSchedulerOpenAttendance.addEventListener('click', () => {
                    const sessionId = String(elements.btnTeacherSchedulerOpenAttendance.dataset.sessionId || '').trim();
                    if (!sessionId) return;
                    window.ClassroomAPI?.openScheduledAttendanceSession?.(sessionId)
                        .then(() => showToast?.('Attendance opened.', 'success'))
                        .catch((error) => showToast?.(error?.message || 'Attendance action unavailable for this account.', 'error'));
                });
            }
            document.addEventListener('click', (evt) => {
                if (elements.teacherSchedulerQuickAdd?.style.display === 'block' && !closestTarget(evt, '#teacher-scheduler-quick-add, .teacher-scheduler-slot')) {
                    closeQuickAdd();
                }
                if (elements.teacherSchedulerSessionBubble?.style.display === 'block' && !closestTarget(evt, '#teacher-scheduler-session-bubble, .teacher-scheduler-session-pill')) {
                    closeSessionBubble();
                }
            });
        }

        function initPatternDayChips() {
            if (!elements.teacherSchedulerPatternDays) return;
            elements.teacherSchedulerPatternDays.innerHTML = DAY_LABELS.map((label, day) => {
                const selected = state.patternWeekdays.has(day) ? 'is-selected' : '';
                return `<button type="button" class="teacher-scheduler-day-chip ${selected}" data-day="${day}">${escapeHtml(label)}</button>`;
            }).join('');
            if (elements.inputTeacherSchedulerPatternTime) {
                elements.inputTeacherSchedulerPatternTime.value = state.patternStartTime;
            }
        }

        function init() {
            if (state.loaded) return;
            state.loaded = true;
            setToolbarDefaults();
            initPatternDayChips();
            bindEvents();
            refresh().catch((error) => {
                showToast?.(error?.message || 'Failed to load teacher scheduler.', 'error');
            });
        }

        return {
            init,
            refresh,
            load: refresh
        };
    }

    return {
        createController
    };
})();
