(function (globalScope) {
    'use strict';
    const STATUSES = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const array = (value) => Array.isArray(value) ? value : [];
    const operationId = () => `crm-view-${globalScope.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    function createController(deps) {
        const board = deps.board;
        const api = deps.apiFetchJson;
        const el = (id) => document.getElementById(id);
        let projectId = '', actorUid = '', generation = 0, readSequence = 0, taskGeneration = 0, lookupSequence = 0;
        let filterDrafts = {};
        let filters = {}, view = 'board', response = null, task = null, preview = null, links = [], canManageLinks = false;
        let cursor = null, previous = [], pageIndex = 0, loading = false, mutation = false, calendarSequence = 0;
        let projectLinks = [], projectLinkAccess = false, projectLinkSequence = 0, projectLookupSequence = 0, projectLinkBusy = false;
        let taskLinkSequence = 0;
        let projectLinkLayoutKey = '';
        let taskKey = '', datesVersion = 0, calendarMonth = new Date().toISOString().slice(0, 7);
        const uid = () => String(deps.getCurrentUser?.()?.uid || '');
        const scope = () => ({ uid: uid(), projectId, generation });
        const current = (s) => s.uid === uid() && s.uid === actorUid && s.projectId === projectId && s.generation === generation;
        const taskScope = () => ({ ...scope(), taskId: task?.id, taskGeneration });
        const taskCurrent = (s) => current(s) && s.taskId === task?.id && s.taskGeneration === taskGeneration;
        const base = () => `/api/projects/${encodeURIComponent(projectId)}`;
        const canWrite = () => !!response && !!projectId && !!actorUid && uid() === actorUid && ['Owner', 'Editor'].includes(response?.membership?.role || board?.getState()?.membership?.role) && (response?.project?.lifecycle || 'active') === 'active';
        const status = (message) => { if (el('projects-view-status')) el('projects-view-status').textContent = message; };
        const taskStatus = (message) => { if (el('projects-task-status')) el('projects-task-status').textContent = message; };
        function fillFilters() {
            const state = board?.getState() || {};
            if (!state.project || state.project.id !== projectId || uid() !== actorUid || (state.actorUid !== undefined && state.actorUid !== actorUid) || state.filterOptionsReady === false) return;
            const form = el('projects-view-filters');
            if (!form) return;
            const fill = (name, options, title) => {
                const control = form.elements.namedItem(name);
                const value = Object.prototype.hasOwnProperty.call(filterDrafts, name) ? filterDrafts[name] : (control.value || filters[name] || '');
                const unavailable = value && !options.some(([id]) => String(id) === String(value)) ? `<option value="${escape(value)}">Selected filter unavailable</option>` : '';
                control.innerHTML = `<option value="">${escape(title)}</option>${unavailable}${options.map(([id, label]) => `<option value="${escape(id)}">${escape(label)}</option>`).join('')}`;
                control.value = value;
            };
            fill('sectionId', array(state.sections).map((s) => [s.id, s.title]), 'All sections');
            const members = array(state.members).map((m) => [m.uid || m.id, m.displayName || m.name || m.email || m.uid || m.id]);
            fill('ownerUid', members, 'All owners'); fill('assigneeUid', members, 'All assignees');
        }
        function choiceLabel(choice) {
            const [year, key] = String(choice).split(':');
            const labels = { tetScheme: 'Tet employer scheme', nationalDayAdjacent: 'National Day adjacent holiday', verifiedLunarDates: 'verified lunar holiday dates', verifiedAnnualSwaps: 'verified annual working swaps', cultureDayCompensation: 'Culture Day compensation guidance' };
            return `${year}: ${labels[key] || 'calendar configuration'}`;
        }
        function warningText(warning) {
            if (typeof warning === 'string') return warning;
            if (warning?.date && warning.reasons) return `${warning.date}: ${array(warning.reasons).map(warningText).join('; ')}`;
            const labels = { DEPENDENCY_UNAVAILABLE: 'A predecessor is archived or unavailable.', DEPENDENCY_DATES_MISSING: 'A predecessor finish or successor start date is missing.', DEPENDENCY_DATE_CONFLICT: 'The successor must start after the predecessor finishes.', TASK_DATES_MISSING: 'Set both dates to calculate working days.', SCHEDULE_RANGE_UNSUPPORTED: 'This date range exceeds supported calendar coverage.', CALENDAR_INCOMPLETE: 'Working days are unconfirmed until calendar choices are resolved.', ASSIGNEE_LEAVE: `${memberName(warning?.uid)} has leave on ${warning?.date || 'this date'}. The accountable owner still determines the schedule.`, weekly_rest: 'Weekly rest day', whole_team_leave: 'Whole-team leave', personal_leave: 'Personal leave', new_year: 'New Year holiday', reunification: 'Reunification Day', labour_day: 'Labour Day', national_day: 'National Day', national_day_adjacent: 'Selected National Day adjacent holiday', culture_day: 'Culture Day', hung_kings: 'Hung Kings Commemoration Day', tet: 'Tet holiday', adopted_public_sector_swap: 'Explicitly adopted public-sector day off', weekly_rest_compensation: 'Compensatory day off for a holiday on weekly rest' };
            const title = array(response?.tasks).find((t) => t.id === warning?.predecessorTaskId)?.title;
            return `${labels[warning?.code] || warning?.message || 'Calendar or dependency availability needs review.'}${title ? ` Predecessor: ${title}.` : ''}${warning?.choices ? ` Resolve ${array(warning.choices).map(choiceLabel).join('; ')}.` : ''}${warning?.compensatesDate ? ` For ${warning.compensatesDate}.` : ''}`;
        }
        function sourceLinks(sources) {
            return array(sources).filter((source) => /^https:\/\//.test(source)).map((source, i) => `<a href="${escape(source)}" target="_blank" rel="noopener noreferrer">Verified source ${i + 1}</a>`).join(' · ');
        }
        function calendarCoverage(c) {
            const coverage = c?.coverage || {};
            return `Vietnam calendar · ${coverage.status === 'verified' ? 'Verified coverage' : 'Coverage incomplete'}${array(coverage.annualYears).length ? ` · annual dates: ${coverage.annualYears.join(', ')}` : ''}${coverage.verifiedAt ? ` · verified ${coverage.verifiedAt}` : ''}. ${array(c?.requiresConfiguration).length ? `Needs configuration: ${c.requiresConfiguration.map(choiceLabel).join('; ')}.` : 'No unresolved choices in this range.'}`;
        }
        function warningList(warnings) {
            return array(warnings).length ? `<ul class="crm-projects-warnings">${warnings.map((w) => `<li>${escape(warningText(w))}</li>`).join('')}</ul>` : '';
        }
        function derived(t) {
            if (!t.derived) return '';
            const d = t.derived;
            return `<small class="crm-projects-derived">Derived active leaves: ${escape(d.completedLeafCount)}/${escape(d.activeLeafCount)} complete (${escape(d.completionPercent)}%). Descendant span: ${escape(d.startDate || 'undated')} → ${escape(d.dueDate || 'undated')}. Stored status/dates remain separate.</small>`;
        }
        function taskButton(t) { return `<button type="button" class="crm-projects-task-open" data-task-open="${escape(t.id)}">${escape(t.title || 'Untitled task')}</button>`; }
        function taskRow(t, statusEditor = false) {
            return `<article class="crm-projects-view-row" data-view-task="${escape(t.id)}">${taskButton(t)}<span>${escape(array(t.ancestorTitles).join(' → '))}</span>${statusEditor ? `<label>Status <select data-task-status="${escape(t.id)}" class="crm-input"${canWrite() && !mutation ? '' : ' disabled'}>${Object.entries(STATUSES).map(([key, label]) => `<option value="${key}"${t.status === key ? ' selected' : ''}>${escape(response?.project?.statusLabels?.[key] || label)}</option>`).join('')}</select></label>` : `<span>${escape(STATUSES[t.status] || t.status)}</span>`}<span>Stored dates: ${escape(t.startDate || 'undated')} → ${escape(t.dueDate || 'undated')}</span>${derived(t)}${warningList(t.dependencyWarnings)}${warningList(t.calendarWarnings)}</article>`;
        }
        function render() {
            if (!el('projects-view-content')) return;
            fillFilters();
            document.querySelectorAll('#projects-view-tabs [data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
            el('projects-board-table-wrap').hidden = view !== 'board';
            el('projects-view-content').hidden = view === 'board';
            el('projects-view-paging').hidden = view === 'board' || view === 'charts';
            el('projects-view-previous').disabled = loading || !previous.length;
            el('projects-view-more').disabled = loading || !response?.hasMore;
            const rows = array(response?.tasks), a = response?.aggregates;
            el('projects-view-summary').textContent = response ? `${response.matchingTaskCount} matching tasks ${view === 'calendar' ? `overlapping ${calendarMonth} with the shared filters` : 'in the full project'}. Showing ${rows.length ? pageIndex * 200 + 1 : 0}–${pageIndex * 200 + rows.length} in this ${view === 'calendar' ? 'month' : 'view'} page. Active-leaf completion: ${a?.completedLeafTaskCount ?? 0}/${a?.activeLeafTaskCount ?? 0} (${a?.completionPercent ?? 0}%). Context ancestors are excluded from matching totals.` : '';
            if (view === 'board') return;
            if (!response && view === 'calendar') { renderCalendar([]); return; }
            if (!response) { el('projects-view-content').innerHTML = '<p class="crm-muted">Choose a project or refresh the view.</p>'; return; }
            if (view === 'kanban') {
                el('projects-view-content').innerHTML = `<div class="crm-projects-kanban">${Object.entries(STATUSES).map(([key, label]) => `<section aria-label="${escape(label)}"><h4>${escape(response.project?.statusLabels?.[key] || label)}</h4>${rows.filter((t) => t.status === key).map((t) => taskRow(t, true)).join('') || '<p class="crm-muted">No tasks on this page.</p>'}</section>`).join('')}</div>`;
            } else if (view === 'timeline') {
                const hasInterval = (t) => t.startDate || t.dueDate || (hasDerivedTimelineSpan(t, rows) && (t.derived.startDate || t.derived.dueDate));
                const dated = rows.filter(hasInterval).sort((a, b) => String(a.startDate || a.dueDate || a.derived?.startDate || a.derived?.dueDate).localeCompare(String(b.startDate || b.dueDate || b.derived?.startDate || b.derived?.dueDate)));
                el('projects-view-content').innerHTML = timelineMarkup(dated) + `<h4>Undated tasks</h4>${rows.filter((t) => !hasInterval(t)).map((t) => taskRow(t)).join('')}`;
            } else if (view === 'calendar') renderCalendar(rows);
            else if (view === 'charts') {
                const chart = (title, values) => `<section class="crm-projects-chart"><h4>${title}</h4>${Object.entries(values || {}).map(([key, count]) => `<div><span>${escape(STATUSES[key] || (key === 'unassigned' || key === '__unassigned__' ? 'Unassigned' : memberName(key)))}</span><meter min="0" max="${Math.max(1, Number(a?.activeLeafTaskCount || 0))}" value="${Number(count) || 0}">${Number(count) || 0}</meter><strong>${Number(count) || 0}</strong></div>`).join('')}</section>`;
                el('projects-view-content').innerHTML = `<p>Complete server snapshot · matching active leaf tasks. Only matching tasks that are leaves in the full active project contribute. Parent rows and page size do not change this denominator.</p><p><strong>${escape(a?.completionPercent ?? 0)}% complete</strong> — ${escape(a?.completedLeafTaskCount ?? 0)} of ${escape(a?.activeLeafTaskCount ?? 0)} active leaf tasks</p>${chart('Active leaves by status', a?.byStatus)}${chart('Active leaves by accountable owner', a?.byOwnerUid)}`;
            }
        }
        function hasDerivedTimelineSpan(t, rows) {
            return !!t.derived && (Number(t.activeChildCount) > 0 || (Number(t.derived.activeLeafCount) > 0 && rows.some((child) => child.id !== t.id && (child.parentTaskId === t.id || array(child.pathIds).includes(t.id)))));
        }
        function timelineMarkup(rows) {
            if (!rows.length) return '<p>No dated tasks on this page.</p>';
            const hasDerivedSpan = (t) => hasDerivedTimelineSpan(t, rows);
            const day = (value) => Date.parse(`${value}T00:00:00Z`) / 86400000;
            const dates = rows.flatMap((t) => [t.startDate, t.dueDate, ...(hasDerivedSpan(t) ? [t.derived.startDate, t.derived.dueDate] : [])]).filter(Boolean).map(day).filter(Number.isFinite);
            const start = Math.min(...dates), end = Math.max(...dates), span = Math.max(1, end - start + 1);
            const dateLabel = (offset) => new Date((start + offset) * 86400000).toISOString().slice(0, 10);
            const bar = (from, to, derivedBar) => {
                if (!from && !to) return '';
                const left = Math.max(0, ((day(from || to) - start) / span) * 100);
                const width = Math.max(0.5, ((day(to || from) - day(from || to) + 1) / span) * 100);
                const label = `${derivedBar ? 'Derived descendant span' : 'Stored interval'}: ${from || to} through ${to || from}`;
                return `<span class="crm-projects-gantt-bar${derivedBar ? ' is-derived' : ''}" role="img" aria-label="${escape(label)}" style="left:${left}%;width:${Math.min(100 - left, width)}%" title="${escape(label)}"></span>`;
            };
            return `<p class="crm-muted">Blue bars show stored dates. Dashed gray bars show derived descendant spans. Open a task to preview a date change.</p><div class="crm-projects-gantt"><div class="crm-projects-gantt-axis"><span>Task</span><div>${Array.from({ length: 5 }, (_, i) => `<time style="left:${i * 25}%">${dateLabel(Math.floor((span - 1) * i / 4))}</time>`).join('')}</div></div>${rows.map((t) => `<div class="crm-projects-gantt-row" data-view-task="${escape(t.id)}"><div>${taskButton(t)}<small>Stored: ${t.startDate || t.dueDate ? `${escape(t.startDate || t.dueDate)} → ${escape(t.dueDate || t.startDate)}` : 'undated'}</small>${hasDerivedSpan(t) ? derived(t) : ''}</div><div class="crm-projects-gantt-track${hasDerivedSpan(t) ? ' has-derived-span' : ''}">${bar(t.startDate, t.dueDate, false)}${hasDerivedSpan(t) ? bar(t.derived.startDate, t.derived.dueDate, true) : ''}</div></div>`).join('')}</div>`;
        }
        function memberName(id) {
            const m = array(board?.getState()?.members).find((m) => (m.uid || m.id) === id);
            return m?.displayName || m?.name || m?.email || 'Project member';
        }
        function renderCalendar(rows) {
            const [year, month] = calendarMonth.split('-').map(Number);
            const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
            el('projects-view-content').innerHTML = `<label>Visible calendar month <input id="projects-view-month" type="month" class="crm-input" value="${escape(calendarMonth)}"></label><p id="projects-calendar-view-provenance" class="crm-muted"></p><div id="projects-calendar-availability"></div><div class="crm-projects-calendar-grid">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((name) => `<strong>${name}</strong>`).join('')}${'<span aria-hidden="true"></span>'.repeat((new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7)}${Array.from({ length: days }, (_, i) => {
                const date = `${calendarMonth}-${String(i + 1).padStart(2, '0')}`;
                const matches = rows.filter((t) => (t.startDate || t.dueDate) && (t.startDate || t.dueDate) <= date && (t.dueDate || t.startDate) >= date);
                return `<section class="crm-projects-calendar-day"><h5>${escape(date)}</h5>${matches.slice(0, 5).map(taskButton).join('')}${matches.length > 5 ? `<span>${matches.length - 5} more on this date; use the dated list below.</span>` : ''}</section>`;
            }).join('')}</div><h4>Tasks overlapping ${escape(calendarMonth)} on this page</h4>${calendarQuery().empty ? '<p class="crm-muted">The shared date filters do not overlap this month. No tasks match.</p>' : ''}${rows.map((t) => taskRow(t)).join('')}`;
            if (response) loadCalendar(`${calendarMonth}-01`, `${calendarMonth}-${days}`);
        }
        async function loadCalendar(fromDate, toDate) {
            const s = scope(), sequence = ++calendarSequence;
            try {
                const result = await api(`${base()}/calendar?${new URLSearchParams({ fromDate, toDate })}`);
                if (!current(s) || sequence !== calendarSequence || view !== 'calendar') return;
                const c = result.calendar;
                el('projects-calendar-view-provenance').innerHTML = `${escape(calendarCoverage(c))} ${sourceLinks(c.coverage?.sourceUrls)}<br>Accountable-owner availability governs scheduling; other assignees generate warnings.`;
                el('projects-calendar-availability').innerHTML = `<details><summary>Availability and reason provenance for this month</summary>${array(c.days).map((day) => `<p><strong>${escape(day.date)}</strong>: organization ${day.organization?.working ? 'working' : 'nonworking'}${array(day.organization?.reasons).length ? ` — ${escape(day.organization.reasons.map(warningText).join('; '))}` : ''}${day.workingSwap ? ' · explicitly adopted working swap' : ''}${array(day.members).filter((m) => m.reasons?.some((r) => r.code === 'personal_leave')).map((m) => `<br>${escape(memberName(m.uid))}: personal leave`).join('')}</p>`).join('')}</details>`;
            } catch (error) { if (current(s) && sequence === calendarSequence) status(error.message || 'Calendar could not be loaded.'); }
        }
        function calendarQuery() {
            const [year, month] = calendarMonth.split('-').map(Number);
            const fromDate = `${calendarMonth}-01`, toDate = `${calendarMonth}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
            const effective = { ...filters, fromDate: filters.fromDate > fromDate ? filters.fromDate : fromDate, toDate: filters.toDate && filters.toDate < toDate ? filters.toDate : toDate };
            const empty = effective.fromDate > effective.toDate;
            // Keep an authenticated bounded read for role/access changes even when the
            // intersection is empty; never send inverted dates to the canonical API.
            return { filters: empty ? { ...filters, fromDate, toDate } : effective, empty };
        }
        function resetViewPage() {
            readSequence++; calendarSequence++;
            cursor = null; previous = []; pageIndex = 0; response = null;
            loading = true; syncTaskPermissions(); render(); refresh();
        }
        async function refresh(nextCursor = null, nextPrevious = [], nextIndex = 0) {
            if (!projectId || !uid() || uid() !== actorUid) return;
            const s = scope(), sequence = ++readSequence;
            loading = true; status('Loading project snapshot…');
            const query = view === 'calendar' ? calendarQuery() : { filters, empty: false };
            const params = new URLSearchParams({ pageSize: '200', filters: JSON.stringify(query.filters) });
            if (nextCursor) params.set('cursor', nextCursor);
            try {
                let result = await api(`${base()}/views?${params}`);
                if (query.empty) result = { ...result, tasks: [], matchingTaskCount: 0, hasMore: false, nextCursor: null, aggregates: { activeLeafTaskCount: 0, completedLeafTaskCount: 0, completionPercent: 0, byStatus: {}, byOwnerUid: {} } };
                if (!current(s) || sequence !== readSequence) return;
                response = result; syncPredecessorPicker(); renderProjectLinks();
                if (result.linkAccess?.canManage === false) { links = []; projectLinks = []; canManageLinks = false; projectLinkAccess = false; renderLinks(); renderProjectLinks(); }
                loadProjectLinks();
                cursor = nextCursor; previous = nextPrevious; pageIndex = nextIndex;
                status('');
                if (task) {
                    const updated = array(result.tasks).find((t) => t.id === task.id);
                    if (updated) { task = updated; board?.selectTask(updated); }
                    loadLinks();
                }
            } catch (error) {
                if (current(s) && sequence === readSequence) {
                    if ([401, 403, 404].includes(Number(error?.status))) { invalidateAccess(s.projectId); return; }
                    status(`${error.message || 'View could not be loaded.'} Refresh to retry; filters are retained.`);
                }
            } finally { if (current(s) && sequence === readSequence) { loading = false; syncTaskPermissions(); render(); } }
        }
        function invalidateAccess(deniedProjectId, notifyBoard = true) {
            if (String(deniedProjectId || '') !== projectId) return;
            // Invalidate every in-flight view, lookup, preview and mutation before clearing DOM.
            generation++; readSequence++; taskGeneration++; calendarSequence++; lookupSequence++; taskLinkSequence++; projectLinkSequence++; projectLookupSequence++; datesVersion++;
            projectId = ''; response = null; task = null; taskKey = ''; preview = null; filters = {}; filterDrafts = {};
            links = []; canManageLinks = false; projectLinks = []; projectLinkAccess = false;
            cursor = null; previous = []; pageIndex = 0; loading = false; mutation = false; projectLinkBusy = false;
            if (notifyBoard) board?.invalidateAccess?.(deniedProjectId, false);
            const form = el('projects-view-filters');
            if (form) {
                for (const name of ['title', 'fromDate', 'toDate', 'status', 'sectionId', 'ownerUid', 'assigneeUid']) {
                    const control = form.elements.namedItem(name); if (control) control.value = '';
                }
                for (const name of ['sectionId', 'ownerUid', 'assigneeUid']) {
                    const control = form.elements.namedItem(name); if (control) control.innerHTML = '<option value="">Access unavailable</option>';
                }
            }
            for (const id of ['projects-view-content', 'projects-project-links', 'projects-task-planning', 'projects-view-summary', 'projects-board-detail-body']) {
                const target = el(id); if (target) { target.innerHTML = ''; target.textContent = ''; }
            }
            if (el('projects-board-detail')) el('projects-board-detail').hidden = true;
            if (el('projects-board-workspace')) el('projects-board-workspace').hidden = true;
            if (el('projects-view-paging')) el('projects-view-paging').hidden = true;
            status('Project access is no longer available. Select an authorized project.');
            globalScope.CrmProjectsDiscussion?.setSelection?.(null);
            globalScope.CrmProjectsRecovery?.setSelection?.(null);
        }
        function setProject(id) {
            const next = String(id || ''), nextUid = uid();
            if (next === projectId && nextUid === actorUid) return;
            generation++; readSequence++; calendarSequence++; projectId = next; actorUid = nextUid;
            filters = {}; filterDrafts = {}; response = null; cursor = null; previous = []; pageIndex = 0; loading = false; mutation = false;
            const form = el('projects-view-filters');
            form?.reset();
            for (const name of ['sectionId', 'ownerUid', 'assigneeUid']) {
                const control = form?.elements.namedItem(name);
                if (control) { control.innerHTML = '<option value="">Loading project options…</option>'; control.value = ''; }
            }
            setTask(null); render();
            projectLinks = []; projectLinkAccess = false; projectLinkSequence++; projectLookupSequence++; projectLinkBusy = false; renderProjectLinks();
            if (projectId) refresh();
        }
        const canEditProjectLinks = () => projectLinkAccess && response?.membership?.role === 'Owner' && response?.project?.lifecycle === 'active';
        function syncProjectLinkControls() {
            el('projects-project-links')?.querySelectorAll?.('#projects-project-link-lookup input, #projects-project-link-lookup select, #projects-project-link-lookup button, #projects-project-link-options button, [data-project-link-remove]').forEach((control) => {
                control.disabled = projectLinkBusy || !canEditProjectLinks();
            });
        }
        function clearProjectLookup() {
            projectLookupSequence++;
            el('projects-project-link-options')?.replaceChildren();
        }
        function renderProjectLinks() {
            const target = el('projects-project-links'); if (!target) return;
            if (!projectId) { projectLinkLayoutKey = ''; target.innerHTML = ''; return; }
            const readable = projectLinkAccess || projectLinks.length > 0;
            const editable = canEditProjectLinks();
            const layoutKey = JSON.stringify([projectId, actorUid, generation, readable, editable, response?.membership?.role, response?.project?.lifecycle]);
            const list = projectLinks.map((link, i) => `<li>${escape(link.label)} (${escape(link.type)})${link.type === 'student' ? ` <button type="button" data-project-student-link="${i}">Open student</button>` : (safeHref(link.href) ? ` <a href="${escape(link.href)}">${link.type === 'lead' ? 'View leads' : 'View classrooms'}</a>` : '')}${editable ? ` <button type="button" data-project-link-remove="${i}"${projectLinkBusy ? ' disabled' : ''}>Remove</button>` : ''}</li>`).join('');
            if (layoutKey !== projectLinkLayoutKey) {
                // A scope or authority transition invalidates lookup results.
                // Same-authority refreshes update only the persisted links list.
                clearProjectLookup();
                projectLinkLayoutKey = layoutKey;
                target.innerHTML = `<h4>Project CRM links</h4>${readable ? `<ul id="projects-project-link-list">${list}</ul>${editable ? '<form id="projects-project-link-lookup" class="crm-inline-fields"><label>Record type<select id="projects-project-link-type" class="crm-input"><option value="lead">Lead</option><option value="student">Student</option><option value="classroom">Classroom</option></select></label><label>Find CRM record<input id="projects-project-link-query" type="search" class="crm-input" maxlength="200"></label><button class="crm-btn-secondary" type="submit">Search authorized records</button></form><div id="projects-project-link-options"></div>' : ''}` : '<p class="crm-muted">Independent CRM access is required to view project links.</p>'}<p id="projects-project-link-status" role="status"></p>`;
            } else {
                const targetList = el('projects-project-link-list');
                if (targetList && targetList.innerHTML !== list) targetList.innerHTML = list;
            }
            syncProjectLinkControls();
        }
        async function loadProjectLinks() {
            const s = scope(), sequence = ++projectLinkSequence;
            try {
                const result = await api(`${base()}/links`);
                if (!current(s) || sequence !== projectLinkSequence) return;
                projectLinkAccess = result.canManage === true; projectLinks = array(result.links); renderProjectLinks();
            } catch (error) { if (current(s) && sequence === projectLinkSequence) { projectLinkAccess = false; projectLinks = []; renderProjectLinks(); } }
        }
        async function lookupProjectLinks() {
            if (projectLinkBusy || !canEditProjectLinks()) return;
            const s = scope(), sequence = ++projectLookupSequence;
            const params = new URLSearchParams({ type: el('projects-project-link-type').value, query: el('projects-project-link-query').value, limit: '25' });
            try {
                const result = await api(`${base()}/crm-link-options?${params}`);
                if (!current(s) || sequence !== projectLookupSequence || !canEditProjectLinks()) return;
                el('projects-project-link-options')?.replaceChildren(...array(result.options).map((option) => {
                    const button = document.createElement('button'); button.type = 'button'; button.className = 'crm-btn-secondary'; button.textContent = `Link ${option.label}`;
                    button.addEventListener('click', () => { if (current(s) && sequence === projectLookupSequence && canEditProjectLinks()) saveProjectLinks([...projectLinks, option]); }); return button;
                }));
                syncProjectLinkControls();
            } catch (error) { if (current(s) && sequence === projectLookupSequence) { projectLinks = []; projectLinkAccess = false; renderProjectLinks(); } }
        }
        async function saveProjectLinks(next) {
            if (projectLinkBusy || !canEditProjectLinks()) return;
            const s = scope(); projectLinkBusy = true; syncProjectLinkControls();
            const body = JSON.stringify({ operationId: operationId(), expectedRevision: response.project.revision, links: [...new Map(next.map((l) => [`${l.type}:${l.recordId}`, { type: l.type, recordId: l.recordId }])).values()] });
            try {
                const request = () => api(`${base()}/links`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
                try { await request(); } catch (error) { if (error.status || !current(s)) throw error; await request(); }
                if (!current(s)) return;
                clearProjectLookup();
                await refresh(); if (current(s)) await loadProjectLinks();
            } catch (error) {
                if (current(s)) {
                    if ([401, 403].includes(error.status)) { projectLinks = []; projectLinkAccess = false; renderProjectLinks(); }
                    if (el('projects-project-link-status')) el('projects-project-link-status').textContent = error.message || 'Project links could not be saved. Refresh before retrying a stale revision.';
                }
            } finally { if (current(s)) { projectLinkBusy = false; renderProjectLinks(); } }
        }
        function setTask(next) {
            const nextKey = next ? `${projectId}:${next.id}` : '';
            if (nextKey === taskKey) { task = next; if (task && el('projects-task-derived')) el('projects-task-derived').innerHTML = derived(task) + warningList(task.dependencyWarnings) + warningList(task.calendarWarnings); syncPredecessorPicker(); syncTaskPermissions(); return; }
            taskGeneration++; lookupSequence++; datesVersion++; taskKey = nextKey; task = next; preview = null; links = []; canManageLinks = false;
            renderTask();
            syncTaskPermissions();
            if (task) loadLinks();
        }
        function syncTaskPermissions() {
            const planning = el('projects-task-planning');
            planning?.querySelectorAll?.('#projects-task-schedule input, #projects-task-schedule button, #projects-task-dependencies textarea, #projects-task-dependencies select, #projects-task-dependencies button').forEach((control) => { control.disabled = !canWrite() || mutation; });
            planning?.querySelectorAll?.('#projects-task-links button, #projects-task-links input, #projects-task-links select').forEach((control) => { if (control.dataset?.studentLink === undefined) control.disabled = !canManageLinks || !canWrite() || mutation; });
            if (el('projects-task-apply')) el('projects-task-apply').disabled = !canWrite() || mutation || !preview?.canApply;
        }
        function predecessorOptions() {
            return response?.project?.id === projectId && uid() === actorUid
                ? array(response.tasks).filter((entry) => entry.id !== task?.id) : [];
        }
        function syncPredecessorPicker() {
            const picker = el('projects-task-predecessor-picker');
            if (!picker || !task) return;
            const selected = picker.value;
            const options = predecessorOptions();
            const markup = '<option value="">Choose a task</option>' + options.map((entry) => `<option value="${escape(entry.id)}">${escape(entry.title || 'Untitled task')}</option>`).join('');
            // Refresh only the authorized page options, preserving the detail
            // form, unsaved dates/dependencies and the exact schedule preview.
            if (picker.innerHTML !== markup) picker.innerHTML = markup;
            picker.value = options.some((entry) => String(entry.id) === selected) ? selected : '';
        }
        function renderTask() {
            const target = el('projects-task-planning');
            if (!target) return;
            if (!task) { target.innerHTML = ''; return; }
            target.innerHTML = `<h5>Schedule and dependencies</h5><div id="projects-task-derived">${derived(task)}${warningList(task.dependencyWarnings)}${warningList(task.calendarWarnings)}</div><form id="projects-task-schedule" class="crm-projects-view-filters"><label>Proposed start<input id="projects-task-start" type="date" class="crm-input" value="${escape(task.startDate || '')}"${canWrite() ? '' : ' disabled'}></label><label>Proposed due<input id="projects-task-due" type="date" class="crm-input" value="${escape(task.dueDate || '')}"${canWrite() ? '' : ' disabled'}></label><button type="submit" class="crm-btn-secondary"${canWrite() ? '' : ' disabled'}>Preview date change</button></form><div id="projects-task-preview"></div><form id="projects-task-dependencies"><label>Add a predecessor from this view page<select id="projects-task-predecessor-picker" class="crm-input"><option value="">Choose a task</option>${predecessorOptions().map((t) => `<option value="${escape(t.id)}">${escape(t.title || 'Untitled task')}</option>`).join('')}</select></label><button id="projects-task-predecessor-add" type="button" class="crm-btn-secondary">Add predecessor</button><p class="crm-muted">Picker shows the current authorized page only. You can paste another same-project task ID below.</p><label>Finish-to-start predecessors (task IDs, one per line)<textarea id="projects-task-predecessors" class="crm-input" rows="3"${canWrite() ? '' : ' disabled'}>${escape(array(task.predecessorTaskIds).join('\n'))}</textarea></label><p class="crm-muted">Same project only. Missing or archived predecessors remain warnings. Saving dependencies never moves dates; cycles are rejected.</p><button type="submit" class="crm-btn-secondary"${canWrite() ? '' : ' disabled'}>Save dependencies</button></form><p id="projects-task-status" role="status"></p><h5>CRM links</h5><div id="projects-task-links"></div>`;
        }
        async function loadLinks() {
            const s = taskScope(), sequence = ++taskLinkSequence;
            try {
                const result = await api(`${base()}/tasks/${encodeURIComponent(task.id)}/links`);
                if (!taskCurrent(s) || sequence !== taskLinkSequence) return;
                canManageLinks = result.canManage === true;
                links = array(result.links);
                renderLinks();
            } catch (error) { if (taskCurrent(s) && sequence === taskLinkSequence) { canManageLinks = false; links = []; renderLinks(); } }
        }
        function renderLinks() {
            const target = el('projects-task-links'); if (!target) return;
            const queryDraft = el('projects-link-query')?.value || '', typeDraft = el('projects-link-type')?.value || 'lead';
            if (!canManageLinks && !links.length) { target.innerHTML = '<p class="crm-muted">CRM link access is unavailable for this account.</p>'; return; }
            target.innerHTML = `<ul>${links.map((link, i) => `<li>${escape(link.label)} (${escape(link.type)})${link.type === 'student' ? ` <button type="button" data-student-link="${i}">Open student</button>` : (safeHref(link.href) ? ` <a href="${escape(link.href)}">${link.type === 'lead' ? 'View leads' : 'View classrooms'}</a>` : '')} <button type="button" data-link-remove="${i}"${canManageLinks && canWrite() && !mutation ? '' : ' disabled'}>Remove</button></li>`).join('')}</ul>${canManageLinks && canWrite() ? '<form id="projects-link-lookup" class="crm-inline-fields"><label>Record type<select id="projects-link-type" class="crm-input"><option value="lead">Lead</option><option value="student">Student</option><option value="classroom">Classroom</option></select></label><label>Find record<input id="projects-link-query" type="search" maxlength="200" class="crm-input"></label><button type="submit" class="crm-btn-secondary">Search authorized records</button></form><div id="projects-link-options"></div>' : ''}`;
            if (el('projects-link-query')) el('projects-link-query').value = queryDraft;
            if (el('projects-link-type')) el('projects-link-type').value = typeDraft;
            syncTaskPermissions();
        }
        async function openStudentLink(index, projectLevel) {
            const s = projectLevel ? scope() : taskScope();
            const valid = () => projectLevel ? current(s) : taskCurrent(s);
            const selected = (projectLevel ? projectLinks : links)[index];
            if (!selected || selected.type !== 'student') return;
            try {
                const result = await api(projectLevel ? `${base()}/links` : `${base()}/tasks/${encodeURIComponent(task.id)}/links`);
                if (!valid()) return;
                if (!array(result.links).some((l) => l.type === 'student' && l.recordId === selected.recordId)) throw new Error('This link is no longer available.');
                await deps.openStudentLink?.(selected.recordId, valid);
            } catch (error) { if (valid()) { if (projectLevel) { projectLinks = []; projectLinkAccess = false; renderProjectLinks(); } else { links = []; canManageLinks = false; renderLinks(); } status(error.message || 'Linked student could not be opened.'); } }
        }
        function safeHref(href) { return typeof href === 'string' && (/^\/(?!\/)/.test(href) || /^#/.test(href)); }
        async function lookup() {
            if (!canManageLinks || !canWrite()) return;
            const s = taskScope(), sequence = ++lookupSequence;
            const type = el('projects-link-type').value, query = el('projects-link-query').value;
            el('projects-link-options').textContent = 'Searching…';
            try {
                const result = await api(`${base()}/crm-link-options?${new URLSearchParams({ type, query, limit: '25' })}`);
                if (!taskCurrent(s) || sequence !== lookupSequence) return;
                const options = array(result.options);
                el('projects-link-options').replaceChildren(...options.map((option) => {
                    const button = document.createElement('button'); button.type = 'button'; button.className = 'crm-btn-secondary'; button.textContent = option.label;
                    button.addEventListener('click', () => { if (taskCurrent(s)) saveLinks([...links, option]); }); return button;
                }));
                if (!options.length) el('projects-link-options').textContent = 'No authorized matches.';
            } catch (error) {
                if (!taskCurrent(s) || sequence !== lookupSequence) return;
                el('projects-link-options').textContent = 'Lookup unavailable.';
                if ([401, 403].includes(error.status)) { links = []; canManageLinks = false; renderLinks(); }
            }
        }
        async function mutate(path, payload, method = 'PATCH') {
            if (mutation || !canWrite() || !task) return false;
            const s = taskScope(); mutation = true; syncTaskPermissions(); taskStatus('Saving…');
            const body = JSON.stringify({ operationId: operationId(), ...payload });
            try {
                let result;
                try { result = await api(path, { method, headers: { 'Content-Type': 'application/json' }, body }); }
                catch (error) {
                    // An uncertain transport result retries the identical operation, never a new intent.
                    if (error.status || !taskCurrent(s)) throw error;
                    result = await api(path, { method, headers: { 'Content-Type': 'application/json' }, body });
                }
                if (!taskCurrent(s)) return false;
                const minimal = result.task || result.result?.task || result.result || result;
                if (minimal.revision !== undefined) task = { ...task, revision: minimal.revision };
                taskStatus('Saved.'); preview = null;
                await board?.refresh();
                if (current(s)) await refresh();
                return taskCurrent(s);
            } catch (error) {
                if (taskCurrent(s)) { taskStatus(`${error.message || 'Save failed.'} Your inputs are retained; refresh stale task state before retrying.`); if ([401, 403].includes(error.status)) { links = []; canManageLinks = false; renderLinks(); } }
                return false;
            } finally { if (current(s)) { mutation = false; syncTaskPermissions(); render(); } }
        }
        async function saveLinks(next) {
            if (!canManageLinks || !task) return;
            const s = taskScope();
            const unique = [...new Map(next.map((l) => [`${l.type}:${l.recordId}`, { type: l.type, recordId: l.recordId }])).values()];
            if (await mutate(`${base()}/tasks/${encodeURIComponent(task.id)}/links`, { expectedRevision: task.revision, links: unique }) && taskCurrent(s)) await loadLinks();
        }
        async function schedulePreview() {
            if (!task || !canWrite()) return;
            const s = taskScope(), version = ++datesVersion;
            preview = null; el('projects-task-preview').textContent = 'Preparing preview…';
            const payload = { taskId: task.id, expectedRevision: task.revision, startDate: el('projects-task-start').value || null, dueDate: el('projects-task-due').value || null };
            try {
                const result = await api(`${base()}/schedule-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (!taskCurrent(s) || version !== datesVersion) return;
                preview = result.preview;
                el('projects-task-preview').innerHTML = `<p>Affected task: ${escape(task.title || 'Selected task')}. Before: ${escape(preview.before?.startDate || 'undated')} → ${escape(preview.before?.dueDate || 'undated')}. After: ${escape(preview.after?.startDate || 'undated')} → ${escape(preview.after?.dueDate || 'undated')}.</p><p>Working days: ${escape(preview.workingDayCount ?? 'unconfirmed')}. Calendar revision ${escape(preview.calendarRevision)}; feed ${escape(preview.feedVersion)}.</p>${warningList(preview.warnings)}<details><summary>Nonworking dates and reasons</summary>${warningList(preview.nonWorkingDays)}</details><button id="projects-task-apply" type="button" class="crm-btn-primary"${preview.canApply ? '' : ' disabled'}>Apply this exact preview</button><p class="crm-muted">No downstream dates move automatically. Task, dependency or calendar changes invalidate this preview.</p>`;
            } catch (error) { if (taskCurrent(s) && version === datesVersion) el('projects-task-preview').textContent = error.message || 'Preview unavailable.'; }
        }
        function init() {
            el('projects-project-links')?.addEventListener('submit', (event) => { event.preventDefault(); if (event.target.id === 'projects-project-link-lookup') lookupProjectLinks(); });
            const projectLookupChanged = (event) => { if (['projects-project-link-query', 'projects-project-link-type'].includes(event.target.id)) clearProjectLookup(); };
            el('projects-project-links')?.addEventListener('input', projectLookupChanged);
            el('projects-project-links')?.addEventListener('change', projectLookupChanged);
            el('projects-project-links')?.addEventListener('click', (event) => { if (event.target.dataset.projectStudentLink !== undefined) openStudentLink(Number(event.target.dataset.projectStudentLink), true); if (event.target.dataset.projectLinkRemove !== undefined) saveProjectLinks(projectLinks.filter((_, i) => i !== Number(event.target.dataset.projectLinkRemove))); });
            el('projects-view-tabs')?.addEventListener('click', (event) => { const button = event.target.closest('[data-view]'); if (button && button.dataset.view !== view) { const monthScopeChanged = view === 'calendar' || button.dataset.view === 'calendar'; view = button.dataset.view; if (monthScopeChanged) resetViewPage(); else render(); } });
            const captureFilterDraft = (event) => { const name = event.target.name; if (['title', 'sectionId', 'status', 'ownerUid', 'assigneeUid', 'fromDate', 'toDate'].includes(name)) filterDrafts[name] = event.target.value; };
            el('projects-view-filters')?.addEventListener('input', captureFilterDraft);
            el('projects-view-filters')?.addEventListener('change', captureFilterDraft);
            el('projects-view-filters')?.addEventListener('submit', (event) => { event.preventDefault(); filterDrafts = Object.fromEntries(new FormData(event.target)); filters = Object.fromEntries(Object.entries(filterDrafts).filter(([, value]) => value !== '')); board?.setFilters(filters); refresh(); });
            el('projects-view-filters')?.addEventListener('reset', () => { filters = {}; filterDrafts = {}; if (projectId) { board?.setFilters(filters); refresh(); } });
            el('projects-view-more')?.addEventListener('click', () => { if (!loading && response?.hasMore) refresh(response.nextCursor, [...previous, cursor], pageIndex + 1); });
            el('projects-view-previous')?.addEventListener('click', () => { if (!loading && previous.length) refresh(previous.at(-1), previous.slice(0, -1), pageIndex - 1); });
            el('projects-view-retry')?.addEventListener('click', () => refresh());
            el('btn-projects-board-refresh')?.addEventListener('click', () => refresh());
            el('projects-view-content')?.addEventListener('click', (event) => { const button = event.target.closest('[data-task-open]'); const found = array(response?.tasks).find((t) => t.id === button?.dataset.taskOpen); if (found) board?.selectTask(found); });
            el('projects-view-content')?.addEventListener('change', async (event) => {
                if (event.target.id === 'projects-view-month') { const next = event.target.value; if (view === 'calendar' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(next) && next !== calendarMonth) { calendarMonth = next; resetViewPage(); } return; }
                const id = event.target.dataset.taskStatus;
                if (id) { const found = array(response?.tasks).find((t) => t.id === id); if (!found) return; event.target.disabled = true; board?.selectTask(found); await mutate(`${base()}/tasks/${encodeURIComponent(id)}`, { expectedRevision: found.revision, status: event.target.value }); }
            });
            el('projects-task-planning')?.addEventListener('submit', (event) => {
                event.preventDefault();
                if (event.target.id === 'projects-task-schedule') schedulePreview();
                if (event.target.id === 'projects-link-lookup') lookup();
                if (event.target.id === 'projects-task-dependencies' && task) mutate(`${base()}/tasks/${encodeURIComponent(task.id)}/dependencies`, { expectedRevision: task.revision, expectedStructureRevision: response?.project?.structureRevision ?? board?.getState()?.project?.structureRevision, predecessorTaskIds: el('projects-task-predecessors').value.split(/[\n,]/).map((id) => id.trim()).filter(Boolean) });
            });
            el('projects-task-planning')?.addEventListener('input', (event) => {
                if (['projects-task-start', 'projects-task-due'].includes(event.target.id)) { datesVersion++; preview = null; el('projects-task-preview').textContent = 'Dates changed. Generate a new preview.'; }
                if (['projects-link-type', 'projects-link-query'].includes(event.target.id)) { lookupSequence++; el('projects-link-options').textContent = ''; }
            });
            el('projects-task-planning')?.addEventListener('click', async (event) => {
                if (event.target.id === 'projects-task-predecessor-add' && canWrite()) { const id = el('projects-task-predecessor-picker').value; if (id) { const existing = el('projects-task-predecessors').value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean); el('projects-task-predecessors').value = [...new Set([...existing, id])].join('\n'); } }
                if (event.target.dataset.studentLink !== undefined) openStudentLink(Number(event.target.dataset.studentLink), false);
                if (event.target.id === 'projects-task-apply' && preview?.canApply && !mutation) { const token = preview.token, version = datesVersion; if (await mutate(`${base()}/schedule-apply`, { previewToken: token }, 'POST') && version === datesVersion) el('projects-task-preview').textContent = 'Preview applied.'; }
                if (event.target.dataset.linkRemove !== undefined && !mutation) saveLinks(links.filter((_, i) => i !== Number(event.target.dataset.linkRemove)));
            });
        }
        return { init, setProject, setTask, refresh, invalidateAccess, syncBoard: fillFilters, getState: () => ({ projectId, actorUid, filters: { ...filters }, view, response, selectedTaskId: task?.id }) };
    }
    globalScope.CrmProjectsViews = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
