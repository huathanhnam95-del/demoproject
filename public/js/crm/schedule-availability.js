/**
 * CrmScheduleAvailability - Google Calendar-style Appointment Schedule Availability Matrix
 *
 * Generic, reusable weekly availability component.
 * Allows staff to configure weekly recurring slots with multi-interval same-day support,
 * live duration chips, duration editing, and strict validation.
 *
 * Uses CRM green design system tokens (--crm-*).
 */
(function (global) {
    'use strict';

    const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    const DAY_META = {
        mon: { name: 'Monday', short: 'Mon', weekday: 1 },
        tue: { name: 'Tuesday', short: 'Tue', weekday: 2 },
        wed: { name: 'Wednesday', short: 'Wed', weekday: 3 },
        thu: { name: 'Thursday', short: 'Thu', weekday: 4 },
        fri: { name: 'Friday', short: 'Fri', weekday: 5 },
        sat: { name: 'Saturday', short: 'Sat', weekday: 6 },
        sun: { name: 'Sunday', short: 'Sun', weekday: 0 }
    };

    const WEEKDAY_TO_KEY = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 0: 'sun' };

    function pad(val) {
        return String(val).padStart(2, '0');
    }

    function timeToMinutes(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return 0;
        const [h, m = 0] = timeStr.split(':').map((v) => Number(v));
        return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    }

    function minutesToTime(mins) {
        const clamped = Math.max(0, Math.min(Number(mins) || 0, 23 * 60 + 59));
        const h = Math.floor(clamped / 60);
        const m = clamped % 60;
        return `${pad(h)}:${pad(m)}`;
    }

    function formatDurationChip(durationMinutes) {
        if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
            return '—';
        }
        const h = Math.floor(durationMinutes / 60);
        const m = durationMinutes % 60;
        if (h > 0 && m > 0) return `${h}h ${m}m`;
        if (h > 0) return `${h}h`;
        return `${m}m`;
    }

    function formatHours(totalMinutes) {
        const h = totalMinutes / 60;
        return Number.isInteger(h) ? String(h) : h.toFixed(1);
    }

    let nextIntervalId = 1;
    function genIntervalId() {
        return `int_${Date.now()}_${nextIntervalId++}`;
    }

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function create(containerEl, options = {}) {
        if (!containerEl) {
            throw new Error('Container element is required for CrmScheduleAvailability.');
        }

        const state = {
            repeat: options.repeat || 'weekly',
            defaultLessonMinutes: Number(options.defaultLessonMinutes) || 120,
            durationStepMinutes: Number(options.durationStepMinutes) || 30,
            timezone: options.timezone || 'Asia/Ho_Chi_Minh',
            readOnly: Boolean(options.readOnly),
            days: {
                mon: [],
                tue: [],
                wed: [],
                thu: [],
                fri: [],
                sat: [],
                sun: []
            }
        };

        let onChangeCallback = typeof options.onChange === 'function' ? options.onChange : null;
        let summaryDebounceTimer = null;
        let isDestroyed = false;

        // Initialize days from options.initialDays or options.initialSlots
        if (options.initialDays && typeof options.initialDays === 'object') {
            DAY_KEYS.forEach((dayKey) => {
                const list = options.initialDays[dayKey];
                if (Array.isArray(list)) {
                    state.days[dayKey] = list.map((item) => ({
                        id: item.id || genIntervalId(),
                        start: minutesToTime(timeToMinutes(item.start || '09:00')),
                        end: minutesToTime(timeToMinutes(item.end || minutesToTime(timeToMinutes(item.start || '09:00') + state.defaultLessonMinutes))),
                        endEdited: Boolean(item.endEdited)
                    }));
                }
            });
        } else if (Array.isArray(options.initialSlots)) {
            options.initialSlots.forEach((slot) => {
                const weekday = slot.weekday !== undefined ? Number(slot.weekday) : (slot.day !== undefined ? DAY_META[String(slot.day).toLowerCase()]?.weekday : null);
                const dayKey = WEEKDAY_TO_KEY[weekday] || (slot.day && DAY_KEYS.includes(String(slot.day).toLowerCase()) ? String(slot.day).toLowerCase() : null);
                if (dayKey && state.days[dayKey]) {
                    const start = minutesToTime(timeToMinutes(slot.startTime || slot.start || '09:00'));
                    const dur = Number(slot.durationMinutes) > 0 ? Number(slot.durationMinutes) : state.defaultLessonMinutes;
                    const end = slot.endTime || slot.end
                        ? minutesToTime(timeToMinutes(slot.endTime || slot.end))
                        : minutesToTime(timeToMinutes(start) + dur);
                    const endEdited = Boolean(slot.endEdited || (slot.endTime && dur !== state.defaultLessonMinutes));
                    state.days[dayKey].push({
                        id: slot.id || genIntervalId(),
                        start,
                        end,
                        endEdited
                    });
                }
            });
        }

        // Render DOM shell
        containerEl.innerHTML = `
            <div class="crm-schedule-availability" role="region" aria-label="Weekly availability matrix">
                <div class="crm-availability-matrix"></div>
                <div class="crm-availability-summary" aria-live="polite" aria-atomic="true">
                    <span class="crm-availability-summary-text"><strong>0 lessons</strong> · <strong>0 hrs</strong> per week</span>
                    <span class="crm-availability-summary-sub text-muted">Lessons will repeat weekly in ${escapeHtml(state.timezone)}</span>
                </div>
            </div>
        `;

        let matrixEl = containerEl.querySelector('.crm-availability-matrix');
        let summaryTextEl = containerEl.querySelector('.crm-availability-summary-text');

        function renderDaySection(dayKey) {
            const meta = DAY_META[dayKey];
            const intervals = state.days[dayKey] || [];
            const isActive = intervals.length > 0;

            let html = `
                <div class="crm-availability-day-section" data-day="${dayKey}">
                    <div class="crm-availability-row ${isActive ? 'is-active' : 'is-unavailable'}" data-day="${dayKey}" role="group" aria-label="${meta.name} availability">
                        <div class="crm-availability-day-col">
                            <span class="crm-availability-day-label">${meta.name}</span>
                        </div>
                        <div class="crm-availability-intervals-col">
            `;

            if (!isActive) {
                html += `
                    <div class="crm-availability-empty-state">
                        <span class="crm-availability-unavailable">Unavailable</span>
                    </div>
                `;
            } else {
                html += `<div class="crm-availability-interval-list">`;
                intervals.forEach((interval) => {
                    const startMin = timeToMinutes(interval.start);
                    const endMin = timeToMinutes(interval.end);
                    const dur = endMin - startMin;
                    const chipText = formatDurationChip(dur);
                    const isInvalid = dur <= 0;

                    html += `
                        <div class="crm-availability-interval-item ${isInvalid ? 'has-error' : ''}" data-interval-id="${interval.id}">
                            <input type="time" class="crm-availability-time-input start-time" step="900" value="${escapeHtml(interval.start)}" aria-label="${meta.name} start time" ${state.readOnly ? 'disabled' : ''}>
                            <span class="crm-availability-sep" aria-hidden="true">–</span>
                            <input type="time" class="crm-availability-time-input end-time" step="900" value="${escapeHtml(interval.end)}" aria-label="${meta.name} end time" ${state.readOnly ? 'disabled' : ''}>
                            <span class="crm-availability-length-chip">${chipText}</span>
                            ${!state.readOnly ? `
                                <button type="button" class="crm-availability-btn-remove" aria-label="Remove ${meta.name} ${escapeHtml(interval.start)} to ${escapeHtml(interval.end)}">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                                        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                    `;
                });
                html += `</div>`;
            }

            html += `
                        </div>
                        <div class="crm-availability-actions-col">
                            ${!state.readOnly ? `
                                <button type="button" class="crm-availability-btn-add" aria-label="Add a lesson time on ${meta.name}">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="crm-availability-day-error" data-day-error="${dayKey}" role="alert" style="display: none;"></div>
                </div>
            `;

            return html;
        }

        function renderAllRows() {
            if (isDestroyed || !matrixEl) return;
            matrixEl.innerHTML = DAY_KEYS.map((dayKey) => renderDaySection(dayKey)).join('');
            validate();
            updateSummary();
        }

        function renderSingleDay(dayKey) {
            if (isDestroyed || !matrixEl) return;
            const section = matrixEl.querySelector(`.crm-availability-day-section[data-day="${dayKey}"]`);
            if (section) {
                section.outerHTML = renderDaySection(dayKey);
                validate();
                updateSummary();
            } else {
                renderAllRows();
            }
        }

        // Delegated Matrix Events: named handlers for complete teardown
        function onMatrixClick(e) {
            const addBtn = e.target.closest('.crm-availability-btn-add');
            if (addBtn) {
                e.preventDefault();
                const section = addBtn.closest('.crm-availability-day-section');
                const dayKey = section?.dataset.day;
                if (dayKey) addIntervalToDay(dayKey);
                return;
            }

            const removeBtn = e.target.closest('.crm-availability-btn-remove');
            if (removeBtn) {
                e.preventDefault();
                const item = removeBtn.closest('.crm-availability-interval-item');
                const section = removeBtn.closest('.crm-availability-day-section');
                const dayKey = section?.dataset.day;
                const intervalId = item?.dataset.intervalId;
                if (dayKey && intervalId) removeIntervalFromDay(dayKey, intervalId);
            }
        }

        function handleTimeInputChange(input) {
            const section = input.closest('.crm-availability-day-section');
            const item = input.closest('.crm-availability-interval-item');
            const dayKey = section?.dataset.day;
            const intervalId = item?.dataset.intervalId;
            if (!dayKey || !intervalId) return;

            const interval = (state.days[dayKey] || []).find((i) => i.id === intervalId);
            if (!interval) return;

            if (input.classList.contains('start-time')) {
                const newStart = input.value;
                const newStartMinutes = timeToMinutes(newStart);

                if (interval.endEdited) {
                    const prevDur = Math.max(timeToMinutes(interval.end) - timeToMinutes(interval.start), 15);
                    const newEndMinutes = Math.min(newStartMinutes + prevDur, 23 * 60 + 59);
                    interval.end = minutesToTime(newEndMinutes);
                } else {
                    const newEndMinutes = Math.min(newStartMinutes + state.defaultLessonMinutes, 23 * 60 + 59);
                    interval.end = minutesToTime(newEndMinutes);
                }
                interval.start = newStart;
            } else if (input.classList.contains('end-time')) {
                interval.end = input.value;
                interval.endEdited = true;
            }

            refreshIntervalRow(dayKey, intervalId);
            notifyChange();
        }

        function onMatrixChange(e) {
            const input = e.target.closest('.crm-availability-time-input');
            if (input) handleTimeInputChange(input);
        }

        function onMatrixInput(e) {
            const input = e.target.closest('.crm-availability-time-input');
            if (input) handleTimeInputChange(input);
        }

        matrixEl.addEventListener('click', onMatrixClick);
        matrixEl.addEventListener('change', onMatrixChange, true);
        matrixEl.addEventListener('input', onMatrixInput, true);

        function refreshIntervalRow(dayKey, intervalId) {
            const interval = (state.days[dayKey] || []).find((i) => i.id === intervalId);
            if (!interval) return;

            const itemEl = matrixEl.querySelector(`.crm-availability-interval-item[data-interval-id="${intervalId}"]`);
            if (!itemEl) return;

            const endInput = itemEl.querySelector('.end-time');
            if (endInput && endInput.value !== interval.end) {
                endInput.value = interval.end;
            }

            const chipEl = itemEl.querySelector('.crm-availability-length-chip');
            const startMin = timeToMinutes(interval.start);
            const endMin = timeToMinutes(interval.end);
            const dur = endMin - startMin;
            const chipText = formatDurationChip(dur);
            if (chipEl) {
                chipEl.textContent = chipText;
                chipEl.setAttribute('aria-label', `Duration: ${chipText}`);
            }

            itemEl.classList.toggle('has-error', dur <= 0);
            validate();
            updateSummary();
        }

        function addIntervalToDay(dayKey) {
            const intervals = state.days[dayKey] || [];
            let newStart = '09:00';
            let newEnd = '11:00';

            if (intervals.length === 0) {
                newStart = '09:00';
                newEnd = minutesToTime(timeToMinutes(newStart) + state.defaultLessonMinutes);
            } else {
                const prevLast = intervals[intervals.length - 1];
                const prevEndMin = timeToMinutes(prevLast.end);
                // Seed 4h after previous end, clamped to 21:00
                let candidateStart = prevEndMin + 240;
                if (candidateStart + state.defaultLessonMinutes > 23 * 60 + 59) {
                    // Fall back to 1h after previous end or 22:00
                    candidateStart = Math.min(prevEndMin + 60, 22 * 60);
                }
                candidateStart = Math.min(candidateStart, 21 * 60);
                newStart = minutesToTime(candidateStart);
                newEnd = minutesToTime(candidateStart + state.defaultLessonMinutes);
            }

            const newId = genIntervalId();
            intervals.push({
                id: newId,
                start: newStart,
                end: newEnd,
                endEdited: false
            });
            state.days[dayKey] = intervals;

            renderSingleDay(dayKey);

            // Focus the new interval's start time input
            const newItem = matrixEl.querySelector(`.crm-availability-interval-item[data-interval-id="${newId}"]`);
            const startInput = newItem?.querySelector('.start-time');
            if (startInput) {
                startInput.focus();
            }

            notifyChange();
        }

        function removeIntervalFromDay(dayKey, intervalId) {
            const intervals = state.days[dayKey] || [];
            const nextIntervals = intervals.filter((i) => i.id !== intervalId);
            state.days[dayKey] = nextIntervals;

            renderSingleDay(dayKey);

            if (nextIntervals.length === 0) {
                const section = matrixEl.querySelector(`.crm-availability-day-section[data-day="${dayKey}"]`);
                const addBtn = section?.querySelector('.crm-availability-btn-add');
                if (addBtn) addBtn.focus();
            }

            notifyChange();
        }

        function validate() {
            const errors = [];
            if (isDestroyed || !matrixEl) {
                return { valid: true, errors: [] };
            }

            DAY_KEYS.forEach((dayKey) => {
                const intervals = state.days[dayKey] || [];
                const errorEl = matrixEl.querySelector(`.crm-availability-day-error[data-day-error="${dayKey}"]`);
                const rowEl = matrixEl.querySelector(`.crm-availability-day-section[data-day="${dayKey}"] .crm-availability-row`);
                let dayError = null;

                // Check 1: End time must be after start time
                for (const item of intervals) {
                    if (timeToMinutes(item.end) <= timeToMinutes(item.start)) {
                        dayError = 'End time must be after start time.';
                        break;
                    }
                }

                // Check 2: Overlapping windows on one day
                if (!dayError && intervals.length > 1) {
                    const sorted = [...intervals].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
                    for (let i = 0; i < sorted.length - 1; i++) {
                        const curEnd = timeToMinutes(sorted[i].end);
                        const nxtStart = timeToMinutes(sorted[i + 1].start);
                        if (curEnd > nxtStart) {
                            dayError = 'Times overlap on this day.';
                            break;
                        }
                    }
                }

                if (dayError) {
                    errors.push({ day: dayKey, message: dayError });
                    if (errorEl) {
                        errorEl.textContent = dayError;
                        errorEl.style.display = 'block';
                    }
                    if (rowEl) rowEl.classList.add('has-day-error');
                } else {
                    if (errorEl) {
                        errorEl.textContent = '';
                        errorEl.style.display = 'none';
                    }
                    if (rowEl) rowEl.classList.remove('has-day-error');
                }
            });

            return {
                valid: errors.length === 0,
                errors
            };
        }

        function updateSummary() {
            if (isDestroyed) {
                return { totalLessons: 0, totalMinutes: 0, totalHours: 0 };
            }

            let totalLessons = 0;
            let totalMinutes = 0;

            DAY_KEYS.forEach((dayKey) => {
                const intervals = state.days[dayKey] || [];
                intervals.forEach((interval) => {
                    const startMin = timeToMinutes(interval.start);
                    const endMin = timeToMinutes(interval.end);
                    if (endMin > startMin) {
                        totalLessons += 1;
                        totalMinutes += (endMin - startMin);
                    }
                });
            });

            const lessonWord = totalLessons === 1 ? 'lesson' : 'lessons';
            const hoursStr = formatHours(totalMinutes);
            if (summaryTextEl) {
                summaryTextEl.innerHTML = `<strong>${totalLessons} ${lessonWord}</strong> · <strong>${hoursStr} hrs</strong> per week`;
            }

            return { totalLessons, totalMinutes, totalHours: totalMinutes / 60 };
        }

        function notifyChange() {
            if (isDestroyed) return;
            validate();
            const summary = updateSummary();

            if (onChangeCallback) {
                if (summaryDebounceTimer) clearTimeout(summaryDebounceTimer);
                summaryDebounceTimer = setTimeout(() => {
                    if (isDestroyed) return;
                    try {
                        onChangeCallback(getState());
                    } catch (err) {
                        console.error('[ScheduleAvailability] Error in onChange callback:', err);
                    }
                }, 50);
            }
        }

        function getSlots() {
            if (isDestroyed) return [];
            const slots = [];
            DAY_KEYS.forEach((dayKey) => {
                const meta = DAY_META[dayKey];
                const intervals = state.days[dayKey] || [];
                const sorted = [...intervals].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

                sorted.forEach((interval) => {
                    const startMin = timeToMinutes(interval.start);
                    const endMin = timeToMinutes(interval.end);
                    const dur = Math.max(endMin - startMin, 0);
                    slots.push({
                        weekday: meta.weekday,
                        day: dayKey,
                        startTime: interval.start,
                        endTime: interval.end,
                        durationMinutes: dur,
                        endEdited: Boolean(interval.endEdited)
                    });
                });
            });
            return slots;
        }

        function getState() {
            if (isDestroyed) {
                return {
                    repeat: state.repeat,
                    defaultLessonMinutes: state.defaultLessonMinutes,
                    durationStepMinutes: state.durationStepMinutes,
                    timezone: state.timezone,
                    days: {},
                    slots: [],
                    summary: { totalLessons: 0, totalMinutes: 0, totalHours: 0 },
                    isValid: true,
                    errors: []
                };
            }
            const validation = validate();
            const summary = updateSummary();
            return {
                repeat: state.repeat,
                defaultLessonMinutes: state.defaultLessonMinutes,
                durationStepMinutes: state.durationStepMinutes,
                timezone: state.timezone,
                days: JSON.parse(JSON.stringify(state.days)),
                slots: getSlots(),
                summary,
                isValid: validation.valid,
                errors: validation.errors
            };
        }

        function setDefaultLessonMinutes(newMinutes) {
            if (isDestroyed || !matrixEl) return;
            const mins = Number(newMinutes);
            if (!Number.isFinite(mins) || mins <= 0) return;
            state.defaultLessonMinutes = mins;

            // Update intervals where end was not manually edited
            DAY_KEYS.forEach((dayKey) => {
                (state.days[dayKey] || []).forEach((interval) => {
                    if (!interval.endEdited) {
                        const startMin = timeToMinutes(interval.start);
                        const endMin = Math.min(startMin + mins, 23 * 60 + 59);
                        interval.end = minutesToTime(endMin);
                    }
                });
            });

            renderAllRows();
            notifyChange();
        }

        function setDays(newDays) {
            if (isDestroyed || !matrixEl || !newDays || typeof newDays !== 'object') return;
            DAY_KEYS.forEach((dayKey) => {
                if (Array.isArray(newDays[dayKey])) {
                    state.days[dayKey] = newDays[dayKey].map((item) => ({
                        id: item.id || genIntervalId(),
                        start: minutesToTime(timeToMinutes(item.start || '09:00')),
                        end: minutesToTime(timeToMinutes(item.end || minutesToTime(timeToMinutes(item.start || '09:00') + state.defaultLessonMinutes))),
                        endEdited: Boolean(item.endEdited)
                    }));
                }
            });
            renderAllRows();
            notifyChange();
        }

        function setSlots(newSlots) {
            if (isDestroyed || !matrixEl || !Array.isArray(newSlots)) return;
            DAY_KEYS.forEach((dayKey) => {
                state.days[dayKey] = [];
            });
            newSlots.forEach((slot) => {
                const weekday = slot.weekday !== undefined ? Number(slot.weekday) : (slot.day !== undefined ? DAY_META[String(slot.day).toLowerCase()]?.weekday : null);
                const dayKey = WEEKDAY_TO_KEY[weekday] || (slot.day && DAY_KEYS.includes(String(slot.day).toLowerCase()) ? String(slot.day).toLowerCase() : null);
                if (dayKey && state.days[dayKey]) {
                    const start = minutesToTime(timeToMinutes(slot.startTime || slot.start || '09:00'));
                    const dur = Number(slot.durationMinutes) > 0 ? Number(slot.durationMinutes) : state.defaultLessonMinutes;
                    const end = slot.endTime || slot.end
                        ? minutesToTime(timeToMinutes(slot.endTime || slot.end))
                        : minutesToTime(timeToMinutes(start) + dur);
                    state.days[dayKey].push({
                        id: slot.id || genIntervalId(),
                        start,
                        end,
                        endEdited: Boolean(slot.endEdited || (slot.endTime && dur !== state.defaultLessonMinutes))
                    });
                }
            });
            renderAllRows();
            notifyChange();
        }

        function destroy() {
            if (isDestroyed) return;
            isDestroyed = true;
            if (summaryDebounceTimer) clearTimeout(summaryDebounceTimer);
            if (matrixEl) {
                matrixEl.removeEventListener('click', onMatrixClick);
                matrixEl.removeEventListener('change', onMatrixChange, true);
                matrixEl.removeEventListener('input', onMatrixInput, true);
            }
            if (containerEl) {
                containerEl.innerHTML = '';
            }
            onChangeCallback = null;
            matrixEl = null;
            summaryTextEl = null;
            containerEl = null;
        }

        // Initial render
        renderAllRows();

        return {
            getState,
            getSlots,
            validate,
            setDefaultLessonMinutes,
            setDays,
            setSlots,
            destroy
        };
    }

    global.CrmScheduleAvailability = {
        DAY_KEYS,
        DAY_META,
        WEEKDAY_TO_KEY,
        timeToMinutes,
        minutesToTime,
        formatDurationChip,
        formatHours,
        create
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = global.CrmScheduleAvailability;
    }
})(typeof window !== 'undefined' ? window : globalThis);
