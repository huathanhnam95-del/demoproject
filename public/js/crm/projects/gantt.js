(function (global) {
    'use strict';
    const DAY = 86400000;
    const ROW = 64;
    const array = value => Array.isArray(value) ? value : [];
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const day = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const stamp = Date.parse(`${value}T00:00:00Z`);
        return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp / DAY : null;
    };
    const iso = value => new Date(value * DAY).toISOString().slice(0, 10);
    const formatters = new Map();
    const date = (value, options = {}) => {
        const key = JSON.stringify(options);
        if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', ...options }));
        return formatters.get(key).format(new Date(value * DAY));
    };
    const status = task => ({ not_started: ['Not started', '○'], in_progress: ['In progress', '◐'], blocked: ['Blocked', '!'], done: ['Done', '✓'] }[task.status] || ['Not started', '○']);
    const statusKey = task => ['not_started', 'in_progress', 'blocked', 'done'].includes(task.status) ? task.status : 'not_started';
    const opener = task => `data-task-open="${esc(task.id)}" data-task-revision="${esc(task.revision ?? '')}"`;
    function interval(source) {
        const start = day(source?.startDate), end = day(source?.dueDate);
        if (start === null && end === null) return null;
        return { start, end, first: Math.min(start ?? end, end ?? start), last: Math.max(start ?? end, end ?? start) };
    }
    function summary(span) {
        if (!span) return 'No valid dates';
        if (span.start === null) return `Due ${date(span.end)}`;
        if (span.end === null) return `Starts ${date(span.start)}`;
        if (span.start > span.end) return `Start ${date(span.start)} · due ${date(span.end)} (check dates)`;
        return span.start === span.end ? date(span.start) : `${date(span.start)} – ${date(span.end)}`;
    }
    function render(options = {}) {
        const tasks = array(options.tasks).filter(task => task && task.id);
        const zoom = ['days', 'weeks', 'months'].includes(options.zoom) ? options.zoom : 'weeks';
        const limit = Math.max(1, Math.min(1000, Number(options.limit) || 40));
        const undatedLimit = Math.max(1, Math.min(1000, Number(options.undatedLimit) || 40));
        const sections = new Map(array(options.sections).map(section => [section.id, section.title || section.name || '']));
        const items = tasks.map(task => {
            const isParent = !!task.derived && (Number(task.activeChildCount) > 0 || (Number(task.derived.activeLeafCount) > 0 && tasks.some(child => child.id !== task.id && (child.parentTaskId === task.id || array(child.pathIds).includes(task.id)))));
            return { task, stored: interval(task), derived: isParent ? interval(task.derived) : null };
        });
        const scheduled = items.filter(item => item.stored || item.derived), undated = items.filter(item => !item.stored && !item.derived);
        const rows = scheduled.slice(0, limit);
        const page = Math.max(1, (Number(options.pageIndex) || 0) + 1);
        const scope = `Page ${page} · ${tasks.length} matching ${tasks.length === 1 ? 'task' : 'tasks'} · ${scheduled.length} scheduled · ${undated.length} need dates${options.hasMore ? ' · more tasks on later pages' : ''}`;
        const tools = todayAvailable => `<div class="crm-gantt-tools"><div><h3>Schedule</h3><p>${esc(scope)}</p></div><div class="crm-gantt-controls"><div class="crm-gantt-zoom" role="group" aria-label="Timeline scale">${['days', 'weeks', 'months'].map(value => `<button type="button" data-gantt-zoom="${value}" aria-pressed="${zoom === value}">${value[0].toUpperCase() + value.slice(1)}</button>`).join('')}</div>${todayAvailable ? '<button type="button" class="crm-gantt-today-button" data-gantt-action="today">Today</button>' : ''}</div></div>`;
        const undatedMarkup = undated.length ? `<section class="crm-gantt-undated" aria-label="Tasks needing dates"><div class="crm-gantt-undated-heading"><h4>Needs dates <span>${undated.length}</span></h4><p>Open a task to plan its schedule.</p></div><ul>${undated.slice(0, undatedLimit).map(({ task }) => `<li data-view-task="${esc(task.id)}"><span class="crm-gantt-status" data-status="${statusKey(task)}" title="${status(task)[0]}" aria-label="${status(task)[0]}">${status(task)[1]}</span><button type="button" class="crm-gantt-undated-task" ${opener(task)} title="${esc(task.title || 'Untitled task')}">${esc(task.title || 'Untitled task')}</button><span class="crm-gantt-undated-section">${esc(sections.get(task.sectionId) || '')}</span>${options.canWrite ? `<button type="button" class="crm-gantt-set-dates" data-gantt-schedule="${esc(task.id)}" aria-label="Set dates for ${esc(task.title || 'Untitled task')}">Set dates</button>` : '<span class="crm-gantt-date-note">No dates</span>'}</li>`).join('')}</ul>${undated.length > undatedLimit ? '<button type="button" class="crm-gantt-more" data-view-more="gantt-undated">Show more tasks needing dates</button>' : ''}</section>` : '';
        if (!rows.length) return `<div class="crm-gantt-view">${tools(false)}<div class="crm-gantt-empty"><strong>${tasks.length ? 'Ready when your tasks have dates' : options.hasActiveFilters ? 'No tasks match these filters' : 'No tasks on this page'}</strong><p>${tasks.length ? 'Add a start or due date to place a task on the timeline.' : options.hasActiveFilters ? 'Adjust the shared filters to see more tasks.' : 'Tasks with a start or due date will appear here.'}</p></div>${undatedMarkup}</div>`;
        // Adding visible rows must not change the scale or move dates underneath them.
        const boundaries = scheduled.flatMap(item => [item.stored, item.derived].filter(Boolean).flatMap(span => [span.first, span.last]));
        let start = Math.min(...boundaries) - 2, end = Math.max(...boundaries) + 2;
        const span = end - start + 1;
        const width = Math.round(Math.min(18000, Math.max(720, span * ({ days: 42, weeks: 15, months: 5 }[zoom]))));
        const x = value => (value - start) / span * width;
        const today = day(options.today), todayVisible = today !== null && today >= start && today <= end;
        // Keep calendar boundaries meaningful while bounding markup for unusually long plans.
        const scale = span > 7300 ? 'years' : span > 1400 ? 'months' : zoom === 'days' && span > 180 ? 'weeks' : zoom;
        const ticks = [];
        let cursor = start;
        while (cursor <= end && ticks.length < 260) {
            const current = new Date(cursor * DAY);
            let next;
            if (scale === 'days') next = cursor + 1;
            else if (scale === 'weeks') next = cursor + (7 - (current.getUTCDay() + 6) % 7);
            else if (scale === 'months') { current.setUTCDate(1); current.setUTCMonth(current.getUTCMonth() + 1); next = current.getTime() / DAY; }
            else { const step = Math.max(1, Math.ceil(span / 365 / 100)); current.setUTCMonth(0, 1); current.setUTCFullYear(current.getUTCFullYear() + step); next = current.getTime() / DAY; }
            const label = scale === 'years' ? String(current.getUTCFullYear() - Math.max(1, Math.ceil(span / 365 / 100))) : scale === 'months' ? date(cursor, { day: undefined, month: 'short', year: 'numeric' }) : scale === 'days' ? date(cursor, { month: undefined, weekday: 'short' }) : date(cursor);
            ticks.push({ day: cursor, next: Math.min(next, end + 1), label });
            cursor = next;
        }
        const tickMarkup = ticks.map(tick => `<time datetime="${iso(tick.day)}" style="left:${x(tick.day)}px;width:${x(tick.next) - x(tick.day)}px">${esc(tick.label)}</time>`).join('');
        let bands = '';
        if (span <= 730) for (let value = start; value <= end; value++) {
            const weekday = new Date(value * DAY).getUTCDay();
            if (weekday === 0 || weekday === 6) bands += `<i class="crm-gantt-weekend" style="left:${x(value)}px;width:${width / span}px"></i>`;
        }
        const grid = ticks.map(tick => `<i class="crm-gantt-gridline" style="left:${x(tick.day)}px"></i>`).join('');
        const byId = new Map(rows.map((item, index) => [item.task.id, { ...item, index }]));
        let missing = 0;
        const edges = rows.flatMap((item, index) => array(item.task.predecessorTaskIds).map(id => {
            const predecessor = byId.get(id);
            if (!predecessor || predecessor.stored?.end == null || item.stored?.start == null) { missing++; return ''; }
            const from = x(predecessor.stored.end + 1), to = x(item.stored.start), y1 = predecessor.index * ROW + 29, y2 = index * ROW + 29;
            const elbow = Math.max(from + 10, to - 12);
            return `<path d="M ${from} ${y1} H ${elbow} V ${y2} H ${to}"/><path d="M ${to - 4} ${y2 - 3} L ${to} ${y2} L ${to - 4} ${y2 + 3}"/><title>${esc(`Dependency: ${predecessor.task.title || id} to ${item.task.title || item.task.id}`)}</title>`;
        })).join('');
        const bar = (item, derived) => {
            const range = derived ? item.derived : item.stored;
            if (!range) return '';
            const label = `${derived ? 'Descendant span' : 'Stored dates'}: ${summary(range)}`;
            return `<button type="button" class="crm-gantt-bar${derived ? ' is-derived' : ''}" data-status="${statusKey(item.task)}" ${opener(item.task)} style="left:${x(range.first)}px;width:${Math.max(3, x(range.last + 1) - x(range.first))}px" title="${esc(`${item.task.title || 'Untitled task'} · ${label}`)}" aria-label="${esc(`Open ${item.task.title || 'Untitled task'}. ${label}`)}">${derived ? '' : `<span>${status(item.task)[1]} ${esc(item.task.title || 'Untitled task')}</span>`}</button>`;
        };
        const chart = `<div class="crm-gantt-scroll" data-gantt-scroll tabindex="0" role="region" aria-label="Task schedule, scroll horizontally for dates"><div class="crm-gantt-chart" style="--crm-gantt-width:${width}px;--crm-gantt-row:${ROW}px"><div class="crm-gantt-axis"><div class="crm-gantt-axis-label">Task <span>${rows.length} shown</span></div><div class="crm-gantt-axis-dates"><div class="crm-gantt-range">${date(start, { year: 'numeric' })} – ${date(end, { year: 'numeric' })}</div><div class="crm-gantt-ticks">${tickMarkup}</div></div></div><div class="crm-gantt-body"><div class="crm-gantt-background" data-gantt-timeline data-start-day="${start}" data-end-day="${end}" aria-hidden="true">${bands}${grid}${todayVisible ? `<span class="crm-gantt-today" data-gantt-today style="left:${x(today) + width / span / 2}px"><b>Today</b></span>` : ''}<svg class="crm-gantt-dependencies" width="${width}" height="${rows.length * ROW}" xmlns="http://www.w3.org/2000/svg">${edges}</svg></div>${rows.map(item => `<div class="crm-gantt-row" data-view-task="${esc(item.task.id)}"><div class="crm-gantt-task"><span class="crm-gantt-status" data-status="${statusKey(item.task)}" aria-label="${status(item.task)[0]}" title="${status(item.task)[0]}">${status(item.task)[1]}</span><div><button type="button" ${opener(item.task)} title="${esc(item.task.title || 'Untitled task')}">${esc(item.task.title || 'Untitled task')}</button><small title="${esc(item.stored ? summary(item.stored) : `Descendants: ${summary(item.derived)}`)}">${esc(item.stored ? summary(item.stored) : `Descendants: ${summary(item.derived)}`)}</small></div></div><div class="crm-gantt-track">${bar(item, false)}${bar(item, true)}</div></div>`).join('')}</div></div></div>`;
        return `<div class="crm-gantt-view">${tools(todayVisible)}<div class="crm-gantt-legend"><span><i class="crm-gantt-key-stored"></i>Stored dates</span><span><i class="crm-gantt-key-derived"></i>Descendant span</span><span>→ Dependency</span>${span <= 730 ? '<span>Shading: Saturday / Sunday</span>' : ''}</div>${scale !== zoom ? `<p class="crm-gantt-note">Long date range · calendar ${scale} shown for readability.</p>` : ''}${chart}${scheduled.length > rows.length ? `<button type="button" class="crm-gantt-more" data-view-more="gantt">Show more scheduled tasks (${rows.length} of ${scheduled.length})</button>` : ''}${missing ? `<p class="crm-gantt-note">${missing} ${missing === 1 ? 'dependency is' : 'dependencies are'} not drawn because an endpoint or its required date is outside these visible rows or unavailable.</p>` : ''}${undatedMarkup}</div>`;
    }
    global.CrmProjectsGantt = Object.freeze({ render });
}(typeof window !== 'undefined' ? window : globalThis));
