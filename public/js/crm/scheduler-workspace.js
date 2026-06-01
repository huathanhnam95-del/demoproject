window.CrmSchedulerWorkspace = (function () {
    const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function toLocalDateInput(date) {
        const y = date.getFullYear();
        const m = pad(date.getMonth() + 1);
        const d = pad(date.getDate());
        return `${y}-${m}-${d}`;
    }

    function startOfWeek(date = new Date()) {
        const ref = new Date(date);
        const day = ref.getDay() || 7;
        ref.setDate(ref.getDate() - day + 1);
        ref.setHours(0, 0, 0, 0);
        return ref;
    }

    function addDaysToDate(date, days) {
        const next = new Date(date);
        next.setDate(next.getDate() + Number(days || 0));
        return next;
    }

    function formatTimeLabel(hours, minutes) {
        return `${pad(hours)}:${pad(minutes)}`;
    }

    function hourSlots(fromHour = 7, toHour = 21) {
        const slots = [];
        for (let hour = fromHour; hour < toHour; hour += 1) {
            slots.push(formatTimeLabel(hour, 0));
            slots.push(formatTimeLabel(hour, 30));
        }
        return slots;
    }

    function parseWeekdayNumbers(value) {
        const map = {
            sun: 0,
            sunday: 0,
            mon: 1,
            monday: 1,
            tue: 2,
            tues: 2,
            tuesday: 2,
            wed: 3,
            wednesday: 3,
            thu: 4,
            thur: 4,
            thurs: 4,
            thursday: 4,
            fri: 5,
            friday: 5,
            sat: 6,
            saturday: 6
        };
        const source = Array.isArray(value) ? value : String(value || '').split(',');
        return source
            .map((item) => {
                const token = String(item || '').trim().toLowerCase();
                if (/^[0-6]$/.test(token)) return Number(token);
                return map[token];
            })
            .filter((item) => Number.isInteger(item));
    }

    function getSessionCardSummary(session, classroomIndex) {
        const classroom = classroomIndex.get(String(session.classId || ''));
        const title = classroom?.name || session.classId || 'Class';
        const label = session.unitType === 'overflow'
            ? `Overflow ${session.overflowSequence || ''}`.trim()
            : `Unit ${session.contractUnitIndex || ''}`.trim();
        return { title, label };
    }

    function createController(deps = {}) {
        const {
            elements,
            showToast,
            escapeHtml: externalEscapeHtml
        } = deps;

        const state = {
            loaded: false,
            classrooms: [],
            sessions: [],
            fromDate: null,
            toDate: null,
            teacherFilter: '',
            selectedClassroomId: '',
            pointerDrag: null,
            suppressedSessionClickId: null,
            schedulerAction: null,
            schedulerActionPreviousFocus: null,
            schedulerActionPreviewRequestId: 0
        };

        const htmlEscape = typeof externalEscapeHtml === 'function' ? externalEscapeHtml : escapeHtml;

        function closestEventTarget(evt, selector) {
            const rawTarget = evt?.target || null;
            const target = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement;
            return target?.closest(selector) || null;
        }

        function currentRange() {
            const from = state.fromDate ? new Date(state.fromDate) : startOfWeek(new Date());
            const to = state.toDate ? new Date(state.toDate) : new Date(from);
            if (!state.toDate) {
                to.setDate(to.getDate() + 6);
            }
            from.setHours(0, 0, 0, 0);
            to.setHours(23, 59, 59, 999);
            return { from, to };
        }

        function sessionStart(session) {
            if (session?.scheduledStartAtUtc) {
                return new Date(session.scheduledStartAtUtc);
            }
            return session?.scheduledStartAt ? new Date(session.scheduledStartAt) : null;
        }

        function getSessionLocalDate(session) {
            if (session?.scheduledLocalDate) return String(session.scheduledLocalDate);
            const start = sessionStart(session);
            return start ? toLocalDateInput(start) : '';
        }

        function getSessionLocalTime(session) {
            if (session?.scheduledLocalTime) return String(session.scheduledLocalTime).slice(0, 5);
            const start = sessionStart(session);
            return start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '';
        }

        function sessionMatchesRange(session, from, to) {
            const localDate = getSessionLocalDate(session);
            if (!localDate) return false;
            const rangeDate = new Date(`${localDate}T00:00:00`);
            if (!Number.isFinite(rangeDate.getTime())) return false;
            return rangeDate >= from && rangeDate <= to;
        }

        function setToolbarDefaults() {
            if (elements.inputSchedulerFromDate && !elements.inputSchedulerFromDate.value) {
                elements.inputSchedulerFromDate.value = toLocalDateInput(startOfWeek(new Date()));
            }
            if (elements.inputSchedulerToDate && !elements.inputSchedulerToDate.value) {
                const end = startOfWeek(new Date());
                end.setDate(end.getDate() + 6);
                elements.inputSchedulerToDate.value = toLocalDateInput(end);
            }
        }

        function getRenderDays() {
            const { from, to } = currentRange();
            const days = [];
            const cursor = new Date(from);
            cursor.setHours(0, 0, 0, 0);
            while (cursor <= to) {
                days.push(new Date(cursor));
                cursor.setDate(cursor.getDate() + 1);
            }
            return days;
        }

        function renderClassRail() {
            if (!elements.schedulerClassList) return;
            const classrooms = Array.isArray(state.classrooms) ? state.classrooms : [];
            if (!classrooms.length) {
                elements.schedulerClassList.innerHTML = '<div class="crm-muted">No classrooms found.</div>';
                return;
            }

            elements.schedulerClassList.innerHTML = classrooms.map((classroom) => {
                const summary = classroom.scheduleSummary || {};
                const assigned = Number(summary.contractedAssignedCount || 0);
                const target = Number(summary.contractedTargetCount || 0);
                const overflow = Number(summary.overflowCount || 0);
                const classroomId = String(classroom.classroomId || classroom.id || '').trim();
                const selected = classroomId && classroomId === state.selectedClassroomId;
                return `
                    <div class="scheduler-class-card ${selected ? 'is-selected' : ''}" data-classroom-id="${escapeHtml(classroomId)}" tabindex="0" role="button" aria-pressed="${selected ? 'true' : 'false'}">
                        <div class="scheduler-class-card-title">${htmlEscape(classroom.name || 'Classroom')}</div>
                        <div class="scheduler-class-card-meta">
                            Assigned ${assigned}/${target || 0}${overflow > 0 ? `, overflow ${overflow}` : ''}
                        </div>
                        <div class="scheduler-class-card-meta">
                            Teacher ${htmlEscape(classroom.primaryTeacherUid || 'Unassigned')}
                        </div>
                        <div class="scheduler-class-card-meta">Drag to calendar to schedule</div>
                    </div>
                `;
            }).join('');

        }

        function renderCalendarGrid() {
            if (!elements.schedulerCalendar) return;
            const days = getRenderDays();
            const { from, to } = currentRange();
            const sessions = state.sessions.filter((session) => sessionMatchesRange(session, from, to));
            const classroomIndex = new Map(state.classrooms.map((classroom) => [String(classroom.classroomId || ''), classroom]));
            const slotKeys = hourSlots(7, 21);

            let html = '<div class="scheduler-calendar-grid">';
            html += '<div class="scheduler-calendar-head"></div>';
            days.forEach((day) => {
                html += `<div class="scheduler-calendar-head">${DAY_LABELS[(day.getDay() + 6) % 7]} ${pad(day.getDate())}</div>`;
            });

            slotKeys.forEach((slotTime) => {
                html += `<div class="scheduler-calendar-time">${slotTime}</div>`;
                days.forEach((day) => {
                    const dateStr = toLocalDateInput(day);
                    const cellSessions = sessions.filter((session) => {
                        return getSessionLocalDate(session) === dateStr && getSessionLocalTime(session) === slotTime;
                    });

                    html += `
                        <div class="scheduler-calendar-cell">
                            <div class="scheduler-calendar-slot" data-date="${dateStr}" data-time="${slotTime}">
                                ${cellSessions.map((session) => {
                                    const summary = getSessionCardSummary(session, classroomIndex);
                                    return `
                                        <div class="scheduler-session-pill" data-session-id="${escapeHtml(session.sessionId || '')}">
                                            <strong>${htmlEscape(summary.title)}</strong>
                                            <small>${htmlEscape(slotTime)} ${htmlEscape(summary.label)}</small>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                });
            });

            html += '</div>';
            elements.schedulerCalendar.innerHTML = html;
        }

        function getSchedulerActionSessionMinutes(classroom) {
            return Number(classroom?.scheduleConfig?.sessionMinutes || 0) || 120;
        }

        function getSchedulerActionDateTimeLabel(targetDate, targetTime) {
            const date = new Date(`${targetDate}T${targetTime}:00`);
            if (!Number.isFinite(date.getTime())) {
                return `${targetDate} ${targetTime}`;
            }
            return date.toLocaleString([], {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        function getSchedulerActionPayload(classroom) {
            const draft = state.schedulerAction;
            if (!draft) return null;
            return {
                targetLocalDate: draft.targetDate,
                targetLocalTime: draft.targetTime,
                timezone: classroom?.scheduleConfig?.timezone || 'UTC',
                durationMinutes: getSchedulerActionSessionMinutes(classroom),
                addMode: draft.addKind === 'recurring' ? 'recurring' : 'once',
                recurringCount: draft.addKind === 'recurring'
                    ? Math.max(2, Math.min(12, Number(draft.recurringCount || 2)))
                    : 1
            };
        }

        function describeReplaceReasons(reasonEntries = []) {
            if (!Array.isArray(reasonEntries) || !reasonEntries.length) {
                return 'No eligible sessions are available.';
            }
            const labels = {
                locked: 'locked',
                attendance_started: 'attendance started',
                attendance_finalized: 'attendance finalized',
                cancelled: 'already cancelled',
                same_slot: 'already on this slot',
                past_session: 'in the past',
                conflict_if_replaced: 'would still conflict'
            };
            return reasonEntries
                .map((entry) => `${Number(entry.count || 0)} ${labels[String(entry.code || '')] || String(entry.code || 'blocked')}`)
                .join(', ');
        }

        async function refreshSchedulerActionPreview() {
            const draft = state.schedulerAction;
            if (!draft || !window.ClassroomAPI) return;
            const classroom = state.classrooms.find((row) => String(row.classroomId || '') === String(draft.classroomId || ''));
            if (!classroom) return;

            const requestId = state.schedulerActionPreviewRequestId + 1;
            state.schedulerActionPreviewRequestId = requestId;
            draft.previewLoading = true;
            draft.previewError = '';
            renderSchedulerActionModal();

            try {
                if (draft.mode === 'replace') {
                    const replacePreview = await window.ClassroomAPI.previewClassroomSessionReplace(classroom.classroomId || classroom.id, getSchedulerActionPayload(classroom));
                    if (!state.schedulerAction || state.schedulerActionPreviewRequestId !== requestId) return;
                    state.schedulerAction.replacePreview = replacePreview || {};
                    const eligibleIds = new Set((replacePreview?.eligibleSessions || []).map((session) => String(session.sessionId || '')));
                    if (!eligibleIds.has(String(state.schedulerAction.replacementSessionId || ''))) {
                        state.schedulerAction.replacementSessionId = '';
                    }
                } else {
                    const addPreview = await window.ClassroomAPI.previewClassroomSessionAdd(classroom.classroomId || classroom.id, getSchedulerActionPayload(classroom));
                    if (!state.schedulerAction || state.schedulerActionPreviewRequestId !== requestId) return;
                    state.schedulerAction.addPreview = addPreview || {};
                }
            } catch (error) {
                if (!state.schedulerAction || state.schedulerActionPreviewRequestId !== requestId) return;
                state.schedulerAction.previewError = error?.message || 'Failed to load preview.';
            } finally {
                if (state.schedulerAction && state.schedulerActionPreviewRequestId === requestId) {
                    state.schedulerAction.previewLoading = false;
                    renderSchedulerActionModal();
                }
            }
        }

        function closeSchedulerActionModal() {
            if (!elements.schedulerActionModal) return;
            elements.schedulerActionModal.style.display = 'none';
            elements.schedulerActionModal.setAttribute('aria-hidden', 'true');
            state.schedulerActionPreviewRequestId += 1;
            state.schedulerAction = null;
            const previousFocus = state.schedulerActionPreviousFocus;
            state.schedulerActionPreviousFocus = null;
            if (previousFocus && typeof previousFocus.focus === 'function') {
                window.setTimeout(() => {
                    previousFocus.focus();
                }, 0);
            }
        }

        function setSchedulerActionMode(mode) {
            if (!state.schedulerAction) return;
            const nextMode = mode === 'replace' ? 'replace' : 'add';
            if (state.schedulerAction.mode === nextMode) {
                return;
            }
            state.schedulerAction.mode = nextMode;
            state.schedulerAction.previewError = '';
            renderSchedulerActionModal();
            refreshSchedulerActionPreview().catch(() => {});
        }

        function selectReplacementSession(sessionId) {
            if (!state.schedulerAction) return;
            state.schedulerAction.replacementSessionId = String(sessionId || '').trim();
            renderSchedulerActionModal();
        }

        function renderSchedulerActionCandidates() {
            const modal = elements.schedulerActionModal;
            if (!modal) return;

            const container = elements.schedulerActionReplaceList;
            if (!container) return;

            const draft = state.schedulerAction;
            const candidates = Array.isArray(draft?.replacePreview?.eligibleSessions) ? draft.replacePreview.eligibleSessions : [];
            if (!candidates.length) {
                const summary = draft?.replacePreview?.ineligibleReasons?.length
                    ? describeReplaceReasons(draft.replacePreview.ineligibleReasons)
                    : 'No eligible future sessions are available to replace.';
                container.innerHTML = `<div class="crm-muted">${htmlEscape(summary)}</div>`;
                return;
            }

            container.innerHTML = candidates.map((session) => {
                const selected = String(session.sessionId || '') === String(draft?.replacementSessionId || '');
                const whenLabel = `${getSessionLocalDate(session)} ${getSessionLocalTime(session)}`;
                const label = session.unitType === 'overflow'
                    ? `Overflow ${session.overflowSequence || ''}`.trim()
                    : `Unit ${session.contractUnitIndex || ''}`.trim();
                return `
                    <button type="button" class="scheduler-action-session-choice ${selected ? 'is-selected' : ''}" data-session-id="${escapeHtml(session.sessionId || '')}">
                        <div class="scheduler-action-session-choice-main">
                            <strong>${htmlEscape(whenLabel)}</strong>
                            <span>${htmlEscape(label || 'Scheduled session')}</span>
                        </div>
                        <div class="scheduler-action-session-choice-meta">
                            ${htmlEscape(session.teacherUid || 'Unassigned')}
                        </div>
                    </button>
                `;
            }).join('');
        }

        function selectClassroom(classroomId) {
            const cleaned = String(classroomId || '').trim();
            if (!cleaned) return;
            state.selectedClassroomId = cleaned;
            renderClassRail();
            refreshSchedulerSummaryCard();
        }

        function renderSchedulerActionModal() {
            if (!elements.schedulerActionModal || !state.schedulerAction) return;

            const classroom = state.classrooms.find((row) => String(row.classroomId || '') === String(state.schedulerAction?.classroomId || ''));
            const sessionMinutes = getSchedulerActionSessionMinutes(classroom);
            const targetLabel = getSchedulerActionDateTimeLabel(state.schedulerAction.targetDate, state.schedulerAction.targetTime);
            const addPreview = state.schedulerAction.addPreview || {};
            const replacePreview = state.schedulerAction.replacePreview || {};
            const selectedCandidates = Array.isArray(replacePreview.eligibleSessions) ? replacePreview.eligibleSessions : [];

            if (elements.schedulerActionTitle) {
                elements.schedulerActionTitle.textContent = state.schedulerAction.mode === 'replace'
                    ? 'Replace Class Session'
                    : 'Add Class Session';
            }
            if (elements.schedulerActionClassName) {
                elements.schedulerActionClassName.textContent = classroom?.name || classroom?.classroomId || 'Classroom';
            }
            if (elements.schedulerActionTargetDateTime) {
                elements.schedulerActionTargetDateTime.textContent = targetLabel;
            }
            if (elements.schedulerActionTeacher) {
                elements.schedulerActionTeacher.textContent = classroom?.primaryTeacherUid || 'Unassigned';
            }
            if (elements.schedulerActionContractSummary) {
                const summary = classroom?.scheduleSummary || {};
                elements.schedulerActionContractSummary.textContent = `${Number(summary.contractedAssignedCount || 0)}/${Number(summary.contractedTargetCount || 0)} assigned`;
            }
            if (elements.schedulerActionBadge) {
                elements.schedulerActionBadge.textContent = state.schedulerAction.mode === 'replace' ? 'Replace' : 'Add';
            }
            if (elements.schedulerActionAddButton) {
                elements.schedulerActionAddButton.classList.toggle('active', state.schedulerAction.mode === 'add');
                elements.schedulerActionAddButton.setAttribute('aria-pressed', state.schedulerAction.mode === 'add' ? 'true' : 'false');
            }
            if (elements.schedulerActionReplaceButton) {
                elements.schedulerActionReplaceButton.classList.toggle('active', state.schedulerAction.mode === 'replace');
                elements.schedulerActionReplaceButton.setAttribute('aria-pressed', state.schedulerAction.mode === 'replace' ? 'true' : 'false');
            }
            if (elements.schedulerActionAddPanel) {
                elements.schedulerActionAddPanel.style.display = state.schedulerAction.mode === 'add' ? 'block' : 'none';
            }
            if (elements.schedulerActionReplacePanel) {
                elements.schedulerActionReplacePanel.style.display = state.schedulerAction.mode === 'replace' ? 'block' : 'none';
            }
            if (elements.schedulerActionRecurringCount) {
                elements.schedulerActionRecurringCount.value = String(state.schedulerAction.recurringCount || 1);
                elements.schedulerActionRecurringCount.disabled = state.schedulerAction.addKind !== 'recurring';
            }
            if (elements.schedulerActionAddOnce) {
                elements.schedulerActionAddOnce.checked = state.schedulerAction.addKind === 'once';
            }
            if (elements.schedulerActionAddRecurring) {
                elements.schedulerActionAddRecurring.checked = state.schedulerAction.addKind === 'recurring';
            }
            if (elements.schedulerActionAddWarning) {
                if (state.schedulerAction.previewLoading && state.schedulerAction.mode === 'add') {
                    elements.schedulerActionAddWarning.textContent = 'Loading add preview...';
                } else if (state.schedulerAction.previewError && state.schedulerAction.mode === 'add') {
                    elements.schedulerActionAddWarning.textContent = state.schedulerAction.previewError;
                } else {
                    const warnings = Array.isArray(addPreview.warnings) && addPreview.warnings.length
                        ? addPreview.warnings.join(' ')
                        : `Each session uses ${sessionMinutes} minutes. Recurring adds repeat weekly on the dropped slot.`;
                    elements.schedulerActionAddWarning.textContent = warnings;
                }
            }
            if (elements.schedulerActionPreviewRequested) {
                elements.schedulerActionPreviewRequested.textContent = String(addPreview.requestedCount || (state.schedulerAction.addKind === 'recurring'
                    ? Math.max(2, Math.min(12, Number(state.schedulerAction.recurringCount || 2)))
                    : 1));
            }
            if (elements.schedulerActionPreviewValid) {
                elements.schedulerActionPreviewValid.textContent = String((addPreview.validOccurrences || []).length || 0);
            }
            if (elements.schedulerActionPreviewSkipped) {
                elements.schedulerActionPreviewSkipped.textContent = String((addPreview.blockedOccurrences || []).length || 0);
            }
            if (elements.schedulerActionPreviewOverflow) {
                elements.schedulerActionPreviewOverflow.textContent = String(addPreview.wouldCreateOverflowCount || 0);
            }
            if (elements.schedulerActionReplaceSummary) {
                if (state.schedulerAction.previewLoading && state.schedulerAction.mode === 'replace') {
                    elements.schedulerActionReplaceSummary.textContent = 'Loading eligible replacement sessions...';
                } else if (state.schedulerAction.previewError && state.schedulerAction.mode === 'replace') {
                    elements.schedulerActionReplaceSummary.textContent = state.schedulerAction.previewError;
                } else if (replacePreview.canCommit) {
                    elements.schedulerActionReplaceSummary.textContent = `${selectedCandidates.length} eligible session(s) can be replaced by this slot.`;
                } else {
                    elements.schedulerActionReplaceSummary.textContent = describeReplaceReasons(replacePreview.ineligibleReasons || []);
                }
            }
            renderSchedulerActionCandidates();
            if (elements.btnConfirmSchedulerAction) {
                const canReplace = state.schedulerAction.mode === 'replace' && !!state.schedulerAction.replacementSessionId && !!replacePreview.canCommit;
                const canAdd = state.schedulerAction.mode === 'add' && !!addPreview.canCommit;
                elements.btnConfirmSchedulerAction.disabled = state.schedulerAction.previewLoading
                    || (state.schedulerAction.mode === 'replace' ? !canReplace : !canAdd);
                elements.btnConfirmSchedulerAction.textContent = state.schedulerAction.mode === 'replace'
                    ? 'Confirm Replace'
                    : 'Confirm Add';
            }
        }

        function openSchedulerActionModal(classroomId, targetDate, targetTime) {
            const classroom = state.classrooms.find((row) => String(row.classroomId || '') === String(classroomId || ''));
            if (!classroom) return;
            state.schedulerActionPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            state.schedulerAction = {
                classroomId: String(classroomId || '').trim(),
                targetDate,
                targetTime,
                mode: 'add',
                addKind: 'once',
                recurringCount: 2,
                replacementSessionId: '',
                committed: false,
                addPreview: null,
                replacePreview: null,
                previewLoading: false,
                previewError: ''
            };
            if (elements.schedulerActionModal) {
                elements.schedulerActionModal.style.display = 'flex';
                elements.schedulerActionModal.setAttribute('aria-hidden', 'false');
            }
            renderSchedulerActionModal();
            refreshSchedulerActionPreview().catch(() => {});
            window.setTimeout(() => {
                const focusTarget = state.schedulerAction?.mode === 'replace'
                    ? (elements.schedulerActionReplaceButton || elements.btnConfirmSchedulerAction)
                    : (elements.schedulerActionAddButton || elements.btnConfirmSchedulerAction);
                if (focusTarget && typeof focusTarget.focus === 'function') {
                    focusTarget.focus();
                }
            }, 0);
        }

        function getSchedulerActionFocusableElements() {
            if (!elements.schedulerActionModal || elements.schedulerActionModal.style.display !== 'flex') {
                return [];
            }
            return Array.from(elements.schedulerActionModal.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter((node) => node instanceof HTMLElement);
        }

        function handleSchedulerActionKeydown(evt) {
            if (!state.schedulerAction || !elements.schedulerActionModal || elements.schedulerActionModal.style.display !== 'flex') {
                return;
            }
            if (evt.key === 'Escape') {
                evt.preventDefault();
                closeSchedulerActionModal();
                return;
            }

            const focusables = getSchedulerActionFocusableElements();
            if (evt.key === 'ArrowLeft' || evt.key === 'ArrowRight') {
                const current = document.activeElement;
                const activeToggle = current === elements.schedulerActionAddButton || current === elements.schedulerActionReplaceButton;
                if (activeToggle) {
                    evt.preventDefault();
                    setSchedulerActionMode(evt.key === 'ArrowRight' ? 'replace' : 'add');
                    (evt.key === 'ArrowRight'
                        ? (elements.schedulerActionReplaceButton || elements.btnConfirmSchedulerAction)
                        : (elements.schedulerActionAddButton || elements.btnConfirmSchedulerAction)
                    )?.focus?.();
                    return;
                }

                if (focusables.length) {
                    const index = focusables.indexOf(current);
                    if (index >= 0) {
                        evt.preventDefault();
                        const nextIndex = evt.key === 'ArrowRight'
                            ? (index + 1) % focusables.length
                            : (index - 1 + focusables.length) % focusables.length;
                        focusables[nextIndex]?.focus?.();
                        return;
                    }
                }
            }

            if (evt.key !== 'Tab' || !focusables.length) return;

            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const current = document.activeElement;
            if (evt.shiftKey && current === first) {
                evt.preventDefault();
                last.focus();
            } else if (!evt.shiftKey && current === last) {
                evt.preventDefault();
                first.focus();
            }
        }

        async function commitAddSchedulerAction() {
            const draft = state.schedulerAction;
            if (!draft) return;
            const classroom = state.classrooms.find((row) => String(row.classroomId || '') === String(draft.classroomId || ''));
            if (!classroom) throw new Error('Classroom not found.');

            const payload = {
                ...getSchedulerActionPayload(classroom),
                teacherUid: classroom.primaryTeacherUid || null
            };
            const result = await window.ClassroomAPI.addClassroomSessionBatch(classroom.classroomId || classroom.id, payload);
            const createdCount = Array.isArray(result?.createdSessions) ? result.createdSessions.length : 0;
            const skippedCount = Array.isArray(result?.skippedOccurrences) ? result.skippedOccurrences.length : 0;
            if (!createdCount) {
                throw new Error('No valid occurrences could be created.');
            }
            const successMessage = skippedCount
                ? `${createdCount} session(s) added, ${skippedCount} skipped.`
                : `${createdCount} session${createdCount === 1 ? '' : 's'} added.`;
            showToast?.(successMessage, 'success');
            closeSchedulerActionModal();
            await refresh();
            return result?.createdSessions || [];
        }

        async function commitReplaceSchedulerAction() {
            const draft = state.schedulerAction;
            if (!draft) return;
            const classroom = state.classrooms.find((row) => String(row.classroomId || '') === String(draft.classroomId || ''));
            if (!classroom) throw new Error('Classroom not found.');
            if (!draft.replacementSessionId) throw new Error('Select a session to replace.');

            await window.ClassroomAPI.replaceClassroomSession(classroom.classroomId || classroom.id, {
                replacedSessionId: draft.replacementSessionId,
                ...getSchedulerActionPayload(classroom),
                teacherUid: classroom.primaryTeacherUid || null
            });
            showToast?.('Session replaced.', 'success');
            closeSchedulerActionModal();
            await refresh();
        }

        async function commitSchedulerAction() {
            if (!state.schedulerAction) return;
            if (state.schedulerAction.mode === 'replace') {
                await commitReplaceSchedulerAction();
                return;
            }
            await commitAddSchedulerAction();
        }

        async function handleClassDrop(classroomId, targetDate, targetTime) {
            const classroom = state.classrooms.find((row) => String(row.classroomId || '') === classroomId);
            if (!classroom) return;
            openSchedulerActionModal(classroomId, targetDate, targetTime);
        }

        function clearDropTarget() {
            const activeSlot = state.pointerDrag?.activeSlot || null;
            if (activeSlot) {
                activeSlot.classList.remove('is-drop-target');
            }
        }

        function clearPointerDrag() {
            clearDropTarget();
            if (state.pointerDrag?.sourceEl) {
                state.pointerDrag.sourceEl.classList.remove('is-dragging');
            }
            elements.schedulerWorkspace?.classList.remove('is-pointer-dragging');
            state.pointerDrag = null;
        }

        function beginPointerDrag(kind, id, sourceEl, evt) {
            if (evt.button !== 0 || !id || !sourceEl) return;
            clearPointerDrag();
            state.pointerDrag = {
                kind,
                id: String(id).trim(),
                sourceEl,
                startX: evt.clientX,
                startY: evt.clientY,
                active: false,
                activeSlot: null
            };
        }

        function findSlotFromPoint(clientX, clientY) {
            if (typeof document === 'undefined') return null;
            return document.elementFromPoint(clientX, clientY)?.closest('.scheduler-calendar-slot') || null;
        }

        function updateDropTarget(slot) {
            const current = state.pointerDrag?.activeSlot || null;
            if (current === slot) return;
            if (current) current.classList.remove('is-drop-target');
            if (state.pointerDrag) {
                state.pointerDrag.activeSlot = slot || null;
            }
            if (slot) slot.classList.add('is-drop-target');
        }

        function handlePointerMove(evt) {
            if (!state.pointerDrag) return;
            const deltaX = evt.clientX - state.pointerDrag.startX;
            const deltaY = evt.clientY - state.pointerDrag.startY;
            const distance = Math.sqrt((deltaX ** 2) + (deltaY ** 2));
            if (!state.pointerDrag.active && distance < 6) {
                return;
            }
            if (!state.pointerDrag.active) {
                state.pointerDrag.active = true;
                elements.schedulerWorkspace?.classList.add('is-pointer-dragging');
                state.pointerDrag.sourceEl?.classList.add('is-dragging');
            }
            updateDropTarget(findSlotFromPoint(evt.clientX, evt.clientY));
        }

        async function finalizePointerDrop(drag, slot) {
            if (!drag || !slot) return;
            const targetDate = String(slot.dataset.date || '').trim();
            const targetTime = String(slot.dataset.time || '').trim();
            if (!targetDate || !targetTime) return;

            if (drag.kind === 'class') {
                await handleClassDrop(drag.id, targetDate, targetTime);
                return;
            }
            if (drag.kind === 'session') {
                await handleSessionReschedule(drag.id, targetDate, targetTime);
            }
        }

        function handlePointerUp(evt) {
            if (!state.pointerDrag) return;
            const drag = state.pointerDrag;
            const slot = drag.active ? (findSlotFromPoint(evt.clientX, evt.clientY) || drag.activeSlot || null) : null;
            const shouldSuppressSessionClick = drag.active && drag.kind === 'session';
            clearPointerDrag();
            if (shouldSuppressSessionClick) {
                state.suppressedSessionClickId = drag.id;
                window.setTimeout(() => {
                    if (state.suppressedSessionClickId === drag.id) {
                        state.suppressedSessionClickId = null;
                    }
                }, 250);
            }
            if (!drag.active || !slot) return;
            finalizePointerDrop(drag, slot).catch((error) => {
                showToast?.(error?.message || 'Failed to update schedule.', 'error');
            });
        }

        function bindPointerInteractions() {
            if (elements.schedulerClassList) {
                elements.schedulerClassList.addEventListener('mousedown', (evt) => {
                    const card = closestEventTarget(evt, '.scheduler-class-card[data-classroom-id]');
                    if (!card) return;
                    beginPointerDrag('class', card.dataset.classroomId, card, evt);
                });
                elements.schedulerClassList.addEventListener('click', (evt) => {
                    const card = closestEventTarget(evt, '.scheduler-class-card[data-classroom-id]');
                    if (!card) return;
                    selectClassroom(card.dataset.classroomId);
                });
                elements.schedulerClassList.addEventListener('keydown', (evt) => {
                    if (evt.key !== 'Enter' && evt.key !== ' ') return;
                    const card = closestEventTarget(evt, '.scheduler-class-card[data-classroom-id]');
                    if (!card) return;
                    evt.preventDefault();
                    selectClassroom(card.dataset.classroomId);
                });
            }

            if (elements.schedulerCalendar) {
                elements.schedulerCalendar.addEventListener('mousedown', (evt) => {
                    const pill = closestEventTarget(evt, '.scheduler-session-pill[data-session-id]');
                    if (!pill) return;
                    beginPointerDrag('session', pill.dataset.sessionId, pill, evt);
                });

                elements.schedulerCalendar.addEventListener('click', async (evt) => {
                    const pill = closestEventTarget(evt, '.scheduler-session-pill[data-session-id]');
                    if (!pill) return;
                    const sessionId = String(pill.dataset.sessionId || '').trim();
                    if (!sessionId || !window.ClassroomAPI) return;
                    if (state.suppressedSessionClickId === sessionId) {
                        state.suppressedSessionClickId = null;
                        evt.preventDefault();
                        return;
                    }
                    try {
                        const result = await window.ClassroomAPI.openScheduledAttendanceSession(sessionId);
                        showToast?.(result?.message || 'Attendance session opened.', 'success');
                    } catch (error) {
                        showToast?.(error?.message || 'Failed to open attendance session.', 'error');
                    }
                });
            }

            document.addEventListener('mousemove', handlePointerMove);
            document.addEventListener('mouseup', handlePointerUp);
        }

        async function handleSessionReschedule(sessionId, targetDate, targetTime) {
            const session = state.sessions.find((row) => String(row.sessionId || '') === sessionId);
            if (!session) return;
            try {
                await window.ClassroomAPI.rescheduleScheduledSession(sessionId, {
                    targetLocalDate: targetDate,
                    targetLocalTime: targetTime,
                    durationMinutes: Number(session.durationMinutes || 0) || 120,
                    timezone: session.timezone || null
                });
                showToast?.('Session rescheduled.', 'success');
                await refresh();
            } catch (error) {
                showToast?.(error?.message || 'Failed to reschedule session.', 'error');
            }
        }

        function refreshSchedulerSummaryCard() {
            if (!elements.classroomScheduleSummary) return;
            const classrooms = state.classrooms;
            if (!classrooms.length) {
                elements.classroomScheduleSummary.innerHTML = `
                    <div class="crm-summary-card">
                        <div class="crm-summary-card-label">Assigned</div>
                        <div class="crm-summary-card-value">0/0</div>
                    </div>
                `;
                return;
            }

            const selectedId = state.selectedClassroomId || '';
            const classroom = selectedId
                ? classrooms.find((row) => String(row.classroomId || row.id || '') === String(selectedId))
                : classrooms[0];
            if (!classroom) return;

            const summary = classroom.scheduleSummary || {};
            elements.classroomScheduleSummary.innerHTML = `
                <div class="crm-summary-card">
                    <div class="crm-summary-card-label">Assigned</div>
                    <div class="crm-summary-card-value">${Number(summary.contractedAssignedCount || 0)}/${Number(summary.contractedTargetCount || 0)}</div>
                </div>
                <div class="crm-summary-card">
                    <div class="crm-summary-card-label">Remaining</div>
                    <div class="crm-summary-card-value">${Number(summary.remainingToScheduleCount || 0)}</div>
                </div>
                <div class="crm-summary-card">
                    <div class="crm-summary-card-label">Overflow</div>
                    <div class="crm-summary-card-value">${Number(summary.overflowCount || 0)}</div>
                </div>
            `;
        }

        async function loadWorkspace() {
            setToolbarDefaults();
            await refresh();
        }

        async function refresh() {
            if (!elements.schedulerWorkspace || !window.ClassroomAPI || typeof window.ClassroomAPI.fetchSchedulerWorkspace !== 'function') {
                return;
            }

            const teacherUid = String(elements.inputSchedulerTeacherFilter?.value || '').trim();
            const from = String(elements.inputSchedulerFromDate?.value || '').trim();
            const to = String(elements.inputSchedulerToDate?.value || '').trim();
            const json = await window.ClassroomAPI.fetchSchedulerWorkspace({ teacherUid, from, to });
            state.classrooms = Array.isArray(json?.classrooms) ? json.classrooms : [];
            state.sessions = Array.isArray(json?.sessions) ? json.sessions : [];
            if (state.selectedClassroomId && !state.classrooms.some((row) => String(row.classroomId || row.id || '') === state.selectedClassroomId)) {
                state.selectedClassroomId = '';
            }
            if (!state.selectedClassroomId && state.classrooms.length) {
                state.selectedClassroomId = String(state.classrooms[0].classroomId || state.classrooms[0].id || '').trim();
            }
            state.teacherFilter = teacherUid;
            state.fromDate = from || null;
            state.toDate = to || null;
            renderClassRail();
            renderCalendarGrid();
            refreshSchedulerSummaryCard();
        }

        function bindControls() {
            if (elements.btnRefreshScheduler) {
                elements.btnRefreshScheduler.addEventListener('click', () => {
                    refresh().catch((error) => {
                        showToast?.(error?.message || 'Failed to refresh scheduler.', 'error');
                    });
                });
            }

            if (elements.btnSeedScheduler) {
                elements.btnSeedScheduler.addEventListener('click', async () => {
                    const classId = state.selectedClassroomId || '';
                    const classroom = state.classrooms.find((row) => String(row.classroomId || row.id || '') === String(classId || ''));
                    if (!classId || !classroom) {
                        showToast?.('Select a class first, then generate its first schedule.', 'error');
                        return;
                    }
                    try {
                        const scheduleConfig = classroom.scheduleConfig || {};
                        await window.ClassroomAPI.seedClassroomSessions(classId, {
                            startDate: String(scheduleConfig.seedStartDate || '').trim(),
                            startTime: String(scheduleConfig.seedStartTime || '').trim(),
                            weekdayNumbers: parseWeekdayNumbers(scheduleConfig.seedWeekdays),
                            teacherUid: classroom.primaryTeacherUid || null
                        });
                        showToast?.('Schedule generated.', 'success');
                        await refresh();
                    } catch (error) {
                        showToast?.(error?.message || 'Failed to generate schedule.', 'error');
                    }
                });
            }

            if (elements.inputSchedulerTeacherFilter) {
                elements.inputSchedulerTeacherFilter.addEventListener('change', () => refresh().catch(() => {}));
            }
            if (elements.inputSchedulerFromDate) {
                elements.inputSchedulerFromDate.addEventListener('change', () => refresh().catch(() => {}));
            }
            if (elements.inputSchedulerToDate) {
                elements.inputSchedulerToDate.addEventListener('change', () => refresh().catch(() => {}));
            }

            if (elements.schedulerActionModal) {
                elements.schedulerActionModal.addEventListener('click', (evt) => {
                    if (evt.target === elements.schedulerActionModal) {
                        closeSchedulerActionModal();
                    }
                });
            }

            if (elements.btnCloseSchedulerActionModal) {
                elements.btnCloseSchedulerActionModal.addEventListener('click', () => {
                    closeSchedulerActionModal();
                });
            }
            if (elements.btnCancelSchedulerAction) {
                elements.btnCancelSchedulerAction.addEventListener('click', () => {
                    closeSchedulerActionModal();
                });
            }
            if (elements.btnConfirmSchedulerAction) {
                elements.btnConfirmSchedulerAction.addEventListener('click', () => {
                    commitSchedulerAction().catch((error) => {
                        showToast?.(error?.message || 'Failed to update schedule.', 'error');
                    });
                });
            }
            if (elements.schedulerActionAddButton) {
                elements.schedulerActionAddButton.addEventListener('click', () => setSchedulerActionMode('add'));
            }
            if (elements.schedulerActionReplaceButton) {
                elements.schedulerActionReplaceButton.addEventListener('click', () => setSchedulerActionMode('replace'));
            }
            if (elements.schedulerActionAddOnce) {
                elements.schedulerActionAddOnce.addEventListener('change', () => {
                    if (!state.schedulerAction) return;
                    state.schedulerAction.addKind = 'once';
                    renderSchedulerActionModal();
                    refreshSchedulerActionPreview().catch(() => {});
                });
            }
            if (elements.schedulerActionAddRecurring) {
                elements.schedulerActionAddRecurring.addEventListener('change', () => {
                    if (!state.schedulerAction) return;
                    state.schedulerAction.addKind = 'recurring';
                    renderSchedulerActionModal();
                    refreshSchedulerActionPreview().catch(() => {});
                });
            }
            if (elements.schedulerActionRecurringCount) {
                elements.schedulerActionRecurringCount.addEventListener('input', () => {
                    if (!state.schedulerAction) return;
                    state.schedulerAction.recurringCount = Math.max(2, Math.min(12, Number(elements.schedulerActionRecurringCount.value || 2)));
                    renderSchedulerActionModal();
                    refreshSchedulerActionPreview().catch(() => {});
                });
            }
            if (elements.schedulerActionReplaceList) {
                elements.schedulerActionReplaceList.addEventListener('click', (evt) => {
                    const choice = closestEventTarget(evt, '.scheduler-action-session-choice[data-session-id]');
                    if (!choice) return;
                    selectReplacementSession(choice.dataset.sessionId);
                });
            }
            if (elements.schedulerActionModal) {
                elements.schedulerActionModal.addEventListener('keydown', handleSchedulerActionKeydown);
            }
        }

        function init() {
            if (state.loaded) return;
            state.loaded = true;
            bindPointerInteractions();
            bindControls();
            loadWorkspace().catch((error) => {
                showToast?.(error?.message || 'Failed to load scheduler.', 'error');
            });
        }

        return {
            init,
            load: loadWorkspace,
            refresh
        };
    }

    return {
        createController
    };
})();
