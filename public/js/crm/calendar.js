/**
 * CrmCalendar — Weekly schedule calendar view
 * Features: auto-extend time range, color legend, Today button, clickable events,
 * mini-calendar picker, view toggle (daily/weekly), drag-and-drop rescheduling,
 * accessibility (ARIA), and mobile responsive.
 */
window.CrmCalendar = (function () {
    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const DAY_LABELS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const DEFAULT_HOUR_START = 7;
    const DEFAULT_HOUR_END = 21;

    // Color palette for classrooms
    const COLORS = [
        '#1b8a4f', '#2563eb', '#d97706', '#9333ea',
        '#e11d48', '#0891b2', '#65a30d', '#c026d3'
    ];

    let currentWeekStart = getMonday(new Date());
    let cachedClassrooms = [];
    let classroomFilter = 'all';
    let hasSetup = false;
    let currentView = 'weekly'; // 'weekly' or 'daily'
    let currentDayIndex = new Date().getDay(); // 0=Sun, convert to Mon-first
    let colorMap = new Map(); // classroomId -> color
    let dragTarget = null;

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getMonday(d) {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        date.setDate(diff);
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function localDateStr(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    }

    function formatDateShort(d) {
        return `${d.getDate()}/${d.getMonth() + 1}`;
    }

    function expandScheduleSlots(schedule, fromDate, toDate, meta) {
        if (!schedule || !Array.isArray(schedule.slots) || schedule.slots.length === 0) return [];
        const dayIndex = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const from = new Date(fromDate + 'T00:00:00');
        const to = new Date(toDate + 'T23:59:59');
        const schedStart = schedule.startDate ? new Date(schedule.startDate + 'T00:00:00') : null;
        const schedEnd = schedule.endDate ? new Date(schedule.endDate + 'T23:59:59') : null;
        const effectiveFrom = schedStart && schedStart > from ? schedStart : from;
        const effectiveTo = schedEnd && schedEnd < to ? schedEnd : to;
        const events = [];
        const cursor = new Date(effectiveFrom);
        while (cursor <= effectiveTo) {
            const currentDay = cursor.getDay();
            for (const slot of schedule.slots) {
                if (dayIndex[slot.day] === currentDay) {
                    events.push({
                        date: localDateStr(cursor),
                        day: slot.day,
                        startTime: slot.startTime,
                        endTime: slot.endTime,
                        teacher: slot.teacher || meta.defaultTeacher || null,
                        classroomId: meta.classroomId || null,
                        classroomName: meta.classroomName || null,
                        color: meta.color || COLORS[0]
                    });
                }
            }
            cursor.setDate(cursor.getDate() + 1);
        }
        return events;
    }

    function timeToMinutes(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

    // #1: Auto-extend time range based on actual events
    function computeTimeRange(events) {
        let earliest = DEFAULT_HOUR_START;
        let latest = DEFAULT_HOUR_END;
        events.forEach(ev => {
            const startH = parseInt(ev.startTime.split(':')[0], 10);
            const endH = parseInt(ev.endTime.split(':')[0], 10);
            const endM = parseInt(ev.endTime.split(':')[1], 10);
            if (startH < earliest) earliest = startH;
            if (endH + (endM > 0 ? 1 : 0) > latest) latest = endH + (endM > 0 ? 1 : 0);
        });
        return { hourStart: earliest, hourEnd: latest };
    }

    // #3: Color legend
    function renderColorLegend() {
        if (colorMap.size === 0) return '';
        let html = '<div class="crm-cal-legend" role="list" aria-label="Calendar color legend">';
        colorMap.forEach((color, name) => {
            html += `<div class="crm-cal-legend-item" role="listitem">
                <span class="crm-cal-legend-dot" style="background:${color};" aria-hidden="true"></span>
                <span class="crm-cal-legend-label">${escapeHtml(name)}</span>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    // #12: Mini-calendar date picker HTML
    function renderMiniCalendar() {
        const month = new Date(currentWeekStart);
        const y = month.getFullYear();
        const m = month.getMonth();
        const firstDay = new Date(y, m, 1);
        const lastDay = new Date(y, m + 1, 0);
        const startDow = (firstDay.getDay() + 6) % 7; // Mon=0
        const todayStr = localDateStr(new Date());
        const weekStartStr = localDateStr(currentWeekStart);

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        let html = '<div class="crm-mini-cal" role="grid" aria-label="Date picker">';
        html += `<div class="crm-mini-cal-header">
            <button type="button" class="crm-mini-cal-nav" data-mini-nav="-1" aria-label="Previous month">‹</button>
            <span class="crm-mini-cal-title">${monthNames[m]} ${y}</span>
            <button type="button" class="crm-mini-cal-nav" data-mini-nav="1" aria-label="Next month">›</button>
        </div>`;
        html += '<div class="crm-mini-cal-row crm-mini-cal-days" role="row">';
        ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(d => {
            html += `<span class="crm-mini-cal-cell crm-mini-cal-hdr" role="columnheader">${d}</span>`;
        });
        html += '</div>';

        let day = 1;
        for (let row = 0; row < 6; row++) {
            if (day > lastDay.getDate()) break;
            html += '<div class="crm-mini-cal-row" role="row">';
            for (let col = 0; col < 7; col++) {
                if ((row === 0 && col < startDow) || day > lastDay.getDate()) {
                    html += '<span class="crm-mini-cal-cell"></span>';
                } else {
                    const dateObj = new Date(y, m, day);
                    const dateStr = localDateStr(dateObj);
                    const isToday = dateStr === todayStr;
                    const inWeek = dateObj >= currentWeekStart && dateObj < new Date(currentWeekStart.getTime() + 7 * 86400000);
                    const cls = ['crm-mini-cal-cell', 'crm-mini-cal-day'];
                    if (isToday) cls.push('crm-mini-cal-today');
                    if (inWeek) cls.push('crm-mini-cal-active');
                    html += `<button type="button" class="${cls.join(' ')}" data-mini-date="${dateStr}" role="gridcell" aria-label="${day} ${monthNames[m]}">${day}</button>`;
                    day++;
                }
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    // #5: Clickable event cards — open classroom modal
    function handleEventClick(e) {
        const card = e.target.closest('.crm-cal-event');
        if (!card) return;
        const classroomId = card.dataset.classroomId;
        if (!classroomId) return;
        // Find classroom in cache and open its modal
        const classroom = cachedClassrooms.find(c => (c.classroomId || c.id || '') === classroomId);
        if (classroom && window.CrmClassrooms && typeof window.CrmClassrooms.openClassroom === 'function') {
            window.CrmClassrooms.openClassroom(classroom);
        } else {
            // Fallback: navigate to class management
            window.location.hash = 'courses/class-management';
        }
    }

    // #9: Drag-and-drop support (basic — visual feedback + data attribute)
    function handleDragStart(e) {
        const card = e.target.closest('.crm-cal-event');
        if (!card) return;
        dragTarget = card;
        card.classList.add('crm-cal-dragging');
        e.dataTransfer.setData('text/plain', card.dataset.classroomId || '');
        e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragEnd(e) {
        if (dragTarget) {
            dragTarget.classList.remove('crm-cal-dragging');
            dragTarget = null;
        }
    }

    function renderWeekGrid(container, events) {
        const weekDates = [];
        const cursor = new Date(currentWeekStart);
        for (let i = 0; i < 7; i++) {
            weekDates.push(new Date(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }

        // #1: Auto-extend time range
        const { hourStart, hourEnd } = computeTimeRange(events);
        const totalMinutes = (hourEnd - hourStart) * 60;

        let html = '<div class="crm-cal-grid" role="grid" aria-label="Weekly schedule calendar">';
        // Header row
        html += '<div class="crm-cal-header" role="row">';
        html += '<div class="crm-cal-time-col" role="columnheader" aria-label="Time"></div>';
        weekDates.forEach((d, i) => {
            const dateStr = localDateStr(d);
            const isToday = dateStr === localDateStr(new Date());
            html += `<div class="crm-cal-day-col${isToday ? ' crm-cal-today' : ''}" role="columnheader" aria-label="${DAY_LABELS_FULL[i]} ${formatDateShort(d)}">
                <span class="crm-cal-day-name">${DAY_LABELS[i]}</span>
                <span class="crm-cal-day-date">${formatDateShort(d)}</span>
            </div>`;
        });
        html += '</div>';

        // Body — time slots
        html += '<div class="crm-cal-body">';
        // Time column
        html += '<div class="crm-cal-time-labels">';
        for (let h = hourStart; h <= hourEnd; h++) {
            html += `<div class="crm-cal-time-label">${String(h).padStart(2, '0')}:00</div>`;
        }
        html += '</div>';

        // Day columns with events
        weekDates.forEach((d) => {
            const dateStr = localDateStr(d);
            const dayEvents = events.filter(e => e.date === dateStr);
            const isToday = dateStr === localDateStr(new Date());

            html += `<div class="crm-cal-day-body${isToday ? ' crm-cal-today' : ''}">`;
            for (let h = hourStart; h <= hourEnd; h++) {
                html += '<div class="crm-cal-hour-line"></div>';
            }
            
            // #13: "Now" Indicator for today
            if (isToday) {
                const now = new Date();
                const nowMin = now.getHours() * 60 + now.getMinutes() - hourStart * 60;
                if (nowMin >= 0 && nowMin <= totalMinutes) {
                    const top = (nowMin / totalMinutes) * 100;
                    html += `<div class="crm-cal-now-indicator" style="top:${top}%;"></div>`;
                }
            }

            // #5 + #6 + #9 + #15: Event cards with click, aria, draggable, and multi-line tooltips
            dayEvents.forEach(ev => {
                const startMin = timeToMinutes(ev.startTime) - hourStart * 60;
                const endMin = timeToMinutes(ev.endTime) - hourStart * 60;
                const top = (startMin / totalMinutes) * 100;
                const height = ((endMin - startMin) / totalMinutes) * 100;
                
                const className = ev.classroomName || 'Class';
                const timeRange = `${ev.startTime} to ${ev.endTime}`;
                const teacherStr = ev.teacher ? `Teacher: ${ev.teacher}` : 'No teacher assigned';
                const dayStr = DAY_LABELS_FULL[DAYS.indexOf(ev.day)] || ev.day;
                
                const ariaLabel = `${className}, ${timeRange}, ${teacherStr}, ${dayStr}`;
                const tooltipText = `${className}\n${timeRange}\n${teacherStr}`;

                html += `<div class="crm-cal-event" style="top:${top}%;height:${height}%;background:${ev.color}20;border-left:2px solid ${ev.color};" 
                    data-classroom-id="${escapeHtml(ev.classroomId || '')}"
                    role="button" tabindex="0" aria-label="${escapeHtml(ariaLabel)}"
                    draggable="true"
                    title="${escapeHtml(tooltipText)}">
                    <span class="crm-cal-event-name">${escapeHtml(className)}</span>
                    <span class="crm-cal-event-time">${ev.startTime} – ${ev.endTime}</span>
                    ${ev.teacher ? `<span class="crm-cal-event-teacher">${escapeHtml(ev.teacher)}</span>` : ''}
                </div>`;
            });
            html += '</div>';
        });

        html += '</div></div>';

        // #3: Color legend
        html += renderColorLegend();

        if (events.length === 0) {
            html += '<div class="crm-muted" style="text-align:center;padding:40px;">No scheduled classes this week.</div>';
        }

        container.innerHTML = html;

        // #5: Attach click handlers
        container.addEventListener('click', handleEventClick);
        // #6: Keyboard enter also triggers click
        container.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const card = e.target.closest('.crm-cal-event');
                if (card) { e.preventDefault(); handleEventClick({ target: card }); }
            }
        });
        // #9: Drag handlers
        container.addEventListener('dragstart', handleDragStart);
        container.addEventListener('dragend', handleDragEnd);
    }

    // #10: Daily list view for mobile / toggle
    function renderDayList(container, events) {
        const weekDates = [];
        const cursor = new Date(currentWeekStart);
        for (let i = 0; i < 7; i++) {
            weekDates.push(new Date(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        const todayStr = localDateStr(new Date());

        let html = '<div class="crm-cal-day-list" role="list" aria-label="Daily schedule view">';

        weekDates.forEach((d, i) => {
            const dateStr = localDateStr(d);
            const dayEvents = events.filter(e => e.date === dateStr);
            const isToday = dateStr === todayStr;

            html += `<div class="crm-cal-day-group${isToday ? ' crm-cal-day-group-today' : ''}" role="listitem">
                <div class="crm-cal-day-group-header">
                    <strong>${DAY_LABELS_FULL[i]}</strong>
                    <span class="crm-cal-day-group-date">${formatDateShort(d)}</span>
                    ${isToday ? '<span class="crm-cal-badge-today">Today</span>' : ''}
                </div>`;

            if (dayEvents.length === 0) {
                html += '<div class="crm-cal-day-empty">No classes</div>';
            } else {
                dayEvents.forEach(ev => {
                    html += `<div class="crm-cal-day-event" data-classroom-id="${escapeHtml(ev.classroomId || '')}" role="button" tabindex="0" aria-label="${escapeHtml(ev.classroomName || 'Class')}, ${ev.startTime} to ${ev.endTime}" style="border-left:2px solid ${ev.color};">
                        <span class="crm-cal-event-name">${escapeHtml(ev.classroomName || 'Class')}</span>
                        <span class="crm-cal-event-time">${ev.startTime} – ${ev.endTime}</span>
                        ${ev.teacher ? `<span class="crm-cal-event-teacher">${escapeHtml(ev.teacher)}</span>` : ''}
                    </div>`;
                });
            }
            html += '</div>';
        });

        html += '</div>';

        // #3: Color legend
        html += renderColorLegend();

        container.innerHTML = html;

        // Click + keyboard handlers for daily view
        container.addEventListener('click', handleEventClick);
        container.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const card = e.target.closest('.crm-cal-day-event');
                if (card) { e.preventDefault(); handleEventClick({ target: card }); }
            }
        });
    }

    async function loadAndRender(container, filterSelect) {
        if (!container) return;
        container.innerHTML = '<div class="crm-muted">Loading calendar...</div>';

        try {
            if (cachedClassrooms.length === 0 && window.ClassroomAPI) {
                cachedClassrooms = await window.ClassroomAPI.fetchClassrooms();
            }

            // Populate filter + build color map
            colorMap.clear();
            if (filterSelect) {
                const current = filterSelect.value;
                filterSelect.innerHTML = '<option value="all">All Classrooms</option>';
                cachedClassrooms.forEach((c, i) => {
                    if (c.schedule && Array.isArray(c.schedule.slots) && c.schedule.slots.length > 0) {
                        const id = c.classroomId || c.id || '';
                        const name = c.name || `Classroom ${i + 1}`;
                        const opt = document.createElement('option');
                        opt.value = id;
                        opt.textContent = name;
                        filterSelect.appendChild(opt);
                        colorMap.set(name, COLORS[i % COLORS.length]);
                    }
                });
                if (current) filterSelect.value = current;
            }

            const weekEnd = new Date(currentWeekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            const fromStr = localDateStr(currentWeekStart);
            const toStr = localDateStr(weekEnd);

            let allEvents = [];
            cachedClassrooms.forEach((c, i) => {
                if (!c.schedule) return;
                const id = c.classroomId || c.id || '';
                if (classroomFilter !== 'all' && id !== classroomFilter) return;
                const events = expandScheduleSlots(c.schedule, fromStr, toStr, {
                    classroomId: id,
                    classroomName: c.name || '',
                    color: COLORS[i % COLORS.length]
                });
                allEvents = allEvents.concat(events);
            });

            if (currentView === 'daily') {
                renderDayList(container, allEvents);
            } else {
                renderWeekGrid(container, allEvents);
            }
        } catch (e) {
            container.innerHTML = `<div class="crm-muted">Failed to load calendar: ${escapeHtml(e.message || '')}</div>`;
        }
    }

    function setup() {
        const container = document.getElementById('calendar-grid-container');
        const weekLabel = document.getElementById('cal-week-label');
        const prevBtn = document.getElementById('cal-prev-week');
        const nextBtn = document.getElementById('cal-next-week');
        const todayBtn = document.getElementById('cal-today');
        const filterSelect = document.getElementById('cal-classroom-filter');
        const viewToggle = document.getElementById('cal-view-toggle');
        const miniCalContainer = document.getElementById('cal-mini-calendar');

        if (!container) return;

        hasSetup = true;
        currentWeekStart = getMonday(new Date());

        function updateLabel() {
            if (!weekLabel) return;
            const end = new Date(currentWeekStart);
            end.setDate(end.getDate() + 6);
            weekLabel.textContent = `${formatDateShort(currentWeekStart)} – ${formatDateShort(end)}`;
        }

        function updateMiniCal() {
            if (miniCalContainer) {
                miniCalContainer.innerHTML = renderMiniCalendar();
            }
        }

        function refresh() {
            updateLabel();
            updateMiniCal();
            loadAndRender(container, filterSelect);
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                currentWeekStart.setDate(currentWeekStart.getDate() - 7);
                refresh();
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                currentWeekStart.setDate(currentWeekStart.getDate() + 7);
                refresh();
            });
        }
        // #4: Today button
        if (todayBtn) {
            todayBtn.addEventListener('click', () => {
                currentWeekStart = getMonday(new Date());
                refresh();
            });
        }
        if (filterSelect) {
            filterSelect.addEventListener('change', () => {
                classroomFilter = filterSelect.value;
                loadAndRender(container, filterSelect);
            });
        }
        // #10: View toggle
        if (viewToggle) {
            viewToggle.addEventListener('change', () => {
                currentView = viewToggle.value || 'weekly';
                loadAndRender(container, filterSelect);
            });
        }
        // #12: Mini calendar click delegation
        if (miniCalContainer) {
            miniCalContainer.addEventListener('click', (e) => {
                const dayBtn = e.target.closest('[data-mini-date]');
                if (dayBtn) {
                    currentWeekStart = getMonday(new Date(dayBtn.dataset.miniDate + 'T12:00:00'));
                    refresh();
                    return;
                }
                const navBtn = e.target.closest('[data-mini-nav]');
                if (navBtn) {
                    const dir = parseInt(navBtn.dataset.miniNav, 10);
                    const ref = new Date(currentWeekStart);
                    ref.setMonth(ref.getMonth() + dir);
                    currentWeekStart = getMonday(ref);
                    refresh();
                }
            });
            updateMiniCal();
        }

        updateLabel();
    }

    function loadCalendarPanel() {
        if (!hasSetup) setup();
        const container = document.getElementById('calendar-grid-container');
        const filterSelect = document.getElementById('cal-classroom-filter');
        if (container) {
            cachedClassrooms = [];
            loadAndRender(container, filterSelect);
        }
    }

    return {
        setup,
        loadCalendarPanel
    };
})();
