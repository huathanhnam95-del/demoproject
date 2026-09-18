(function (globalScope) {
    'use strict';
    const STATUSES = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
    const PJ_ICON = {
        calendar: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.2" y="3.2" width="11.6" height="10.6" rx="1.6"/><path d="M2.2 6.4h11.6M5.4 1.9v2.6M10.6 1.9v2.6"/></svg>',
        flagDue: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.7 14.2V2.1"/><path d="M3.7 2.9h8.5l-1.8 2.7 1.8 2.7H3.7"/></svg>',
        bolt: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.8 1.8 3.5 9h3.4l-.7 5.2L12.5 7H9.1z"/></svg>',
        info: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.3v3.8M8 5.1h.01"/></svg>',
        link: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.7 9.3a2.9 2.9 0 0 0 4.1 0l1.9-1.9a2.9 2.9 0 1 0-4.1-4.1l-.9.9"/><path d="M9.3 6.7a2.9 2.9 0 0 0-4.1 0L3.3 8.6a2.9 2.9 0 1 0 4.1 4.1l.9-.9"/></svg>',
        subtask: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.2 2.4v6.2a2 2 0 0 0 2 2h5.6"/><path d="M9.4 8.2 12.1 10.6 9.4 13"/></svg>'
    };
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
        let taskKey = '', datesVersion = 0, calendarMonth = new Date().toISOString().slice(0, 7), ganttZoom = 'weeks';
        const calendarCache = new Map();
        let viewStale = false;
        const uid = () => String(deps.getCurrentUser?.()?.uid || '');
        const scope = () => ({ uid: uid(), projectId, generation });
        const current = (s) => s.uid === uid() && s.uid === actorUid && s.projectId === projectId && s.generation === generation;
        const taskScope = () => ({ ...scope(), taskId: task?.id, taskGeneration });
        const taskCurrent = (s) => current(s) && s.taskId === task?.id && s.taskGeneration === taskGeneration;
        const base = () => `/api/projects/${encodeURIComponent(projectId)}`;
        const canWrite = () => !!response && !!projectId && !!actorUid && uid() === actorUid && ['Owner', 'Editor'].includes(response?.membership?.role || board?.getState()?.membership?.role) && (response?.project?.lifecycle || 'active') === 'active';
        const status = (message) => { if (el('projects-view-status')) el('projects-view-status').textContent = message; };
        const taskStatus = (message) => { if (el('projects-task-status')) el('projects-task-status').textContent = message; };
        function syncFilterBadge() {
            const badge = el('projects-filter-count');
            if (!badge) return;
            const count = Object.values(filters).filter(Boolean).length;
            badge.textContent = String(count);
            badge.hidden = count === 0;
        }
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
            syncFilterBadge();
        }
        // The popover used to be six native selects and a three-line paragraph.
        // These chips are the control now; each one writes into the select that
        // still carries the value, so the filter contract below is untouched.
        function chipInitials(label) {
            const parts = String(label || '').trim().split(/\s+/).filter(Boolean);
            if (!parts.length) return '—';
            return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
        }
        function renderFilterChips() {
            const form = el('projects-view-filters');
            if (!form || typeof form.querySelectorAll !== 'function') return;
            const counts = response?.aggregates || {};
            const countFor = { status: counts.byStatus, ownerUid: counts.byOwnerUid };
            form.querySelectorAll('[data-filter-chips]').forEach((host) => {
                const name = host.dataset.filterChips;
                const control = form.elements.namedItem(name);
                if (!control || !control.options) return;
                const value = String(control.value || '');
                const tally = countFor[name] || null;
                const avatars = name === 'ownerUid' || name === 'assigneeUid';
                host.innerHTML = Array.from(control.options).map((option) => {
                    const id = String(option.value || '');
                    const on = id === value;
                    const count = id && tally ? tally[id] : null;
                    const label = option.textContent;
                    const mark = !id
                        ? ''
                        : (avatars
                            ? `<span class="crm-filter-chip-avatar" aria-hidden="true">${escape(chipInitials(option.textContent))}</span>`
                            : (name === 'status' ? `<span class="crm-filter-chip-dot" data-status="${escape(id)}" aria-hidden="true"></span>` : ''));
                    return `<button type="button" class="crm-filter-chip${on ? ' is-on' : ''}" data-chip-field="${escape(name)}" data-chip-value="${escape(id)}" aria-pressed="${on ? 'true' : 'false'}">`
                        + mark
                        + `<span class="crm-filter-chip-label">${escape(label)}</span>`
                        + (Number.isFinite(Number(count)) && count !== null ? `<span class="crm-filter-chip-count">${escape(count)}</span>` : '')
                        + '</button>';
                }).join('');
            });
        }
        function applyChip(field, value) {
            const form = el('projects-view-filters');
            const control = form?.elements?.namedItem(field);
            if (!control) return;
            // Toggle off when the active chip is pressed again, matching the
            // "Any" chip rather than leaving the filter stuck on.
            control.value = String(control.value || '') === String(value) ? '' : String(value);
            control.dispatchEvent(new Event('change', { bubbles: true }));
            renderFilterChips();
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
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
        function derived(t, isDetail = false) {
            if (!t.derived) return '';
            const d = t.derived;
            const total = Number(d.activeLeafCount) || 0;
            const done = Number(d.completedLeafCount) || 0;
            const hasDates = Boolean(d.startDate || d.dueDate);
            const spanText = hasDates ? `${escape(d.startDate || 'undated')} → ${escape(d.dueDate || 'undated')}` : 'undated';
            if (total === 0 && !hasDates) return '';
            const pct = Math.max(0, Math.min(100, Math.round(Number(d.completionPercent ?? (total > 0 ? (done / total * 100) : 0))) || 0));
            if (!isDetail) {
                if (total === 0) return `<small class="crm-projects-derived">Descendant span: ${spanText}</small>`;
                return `<small class="crm-projects-derived">↳ ${escape(done)}/${escape(total)} complete (${pct}%) · ${spanText}</small>`;
            }
            const battery = d.statusBattery;
            const hasBattery = battery && Number(battery.total) > 0;
            let trackMarkup = '';
            if (hasBattery) {
                const bTotal = Number(battery.total) || 1;
                const donePct = Math.round((Number(battery.done || 0) / bTotal) * 100);
                const inProgPct = Math.round((Number(battery.in_progress || 0) / bTotal) * 100);
                const blockedPct = Math.round((Number(battery.blocked || 0) / bTotal) * 100);
                const notStartedPct = Math.max(0, 100 - donePct - inProgPct - blockedPct);
                trackMarkup = `<div class="crm-detail-progress-track crm-battery-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Subtask completion">` +
                    (donePct > 0 ? `<span class="crm-battery-segment is-done" style="width:${donePct}%" title="${battery.done} Done"></span>` : '') +
                    (inProgPct > 0 ? `<span class="crm-battery-segment is-in-progress" style="width:${inProgPct}%" title="${battery.in_progress} In Progress"></span>` : '') +
                    (blockedPct > 0 ? `<span class="crm-battery-segment is-blocked" style="width:${blockedPct}%" title="${battery.blocked} Blocked"></span>` : '') +
                    (notStartedPct > 0 ? `<span class="crm-battery-segment is-not-started" style="width:${notStartedPct}%" title="${battery.not_started} Not Started"></span>` : '') +
                    `</div>`;
            } else {
                trackMarkup = `<div class="crm-detail-progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Subtask completion"><div class="crm-detail-progress-fill" style="width:${pct}%"></div></div>`;
            }
            const statMarkup = total > 0 ? `<span class="crm-detail-progress-stat ${done === total ? 'is-complete' : ''}"><b>${escape(done)}/${escape(total)}</b> complete (${pct}%)</span>` : '';
            return `<div class="crm-projects-derived crm-detail-progress-card"><div class="crm-detail-progress-head"><span class="crm-detail-progress-label"><span class="crm-progress-icon">${PJ_ICON.subtask}</span> Subtasks rollup</span>${statMarkup}</div>${total > 0 ? trackMarkup : ''}<div class="crm-detail-progress-foot"><span class="crm-detail-span-badge"><span class="crm-chip-icon">${PJ_ICON.calendar}</span> Descendant span: ${spanText}</span></div></div>`;
        }
        function taskButton(t) { return `<button type="button" class="crm-projects-task-open" data-task-open="${escape(t.id)}" data-status="${escape(t.status || 'not_started')}">${escape(t.title || 'Untitled task')}</button>`; }
        function taskRow(t, statusEditor = false) {
            return `<article class="crm-projects-view-row" data-view-task="${escape(t.id)}">${taskButton(t)}<span>${escape(array(t.ancestorTitles).join(' → '))}</span>${statusEditor ? `<label>Status <select data-task-status="${escape(t.id)}" class="crm-input"${canWrite() && !mutation ? '' : ' disabled'}>${Object.entries(STATUSES).map(([key, label]) => `<option value="${key}"${t.status === key ? ' selected' : ''}>${escape(response?.project?.statusLabels?.[key] || label)}</option>`).join('')}</select></label>` : `<span>${escape(STATUSES[t.status] || t.status)}</span>`}<span>Stored dates: ${escape(t.startDate || 'undated')} → ${escape(t.dueDate || 'undated')}</span>${derived(t)}${warningList(t.dependencyWarnings)}${warningList(t.calendarWarnings)}</article>`;
        }
        function initials(uid) {
            const name = memberName(uid);
            const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
            return parts.length ? Array.from(parts[0])[0].toLocaleUpperCase() + (parts.length > 1 ? Array.from(parts[parts.length - 1])[0].toLocaleUpperCase() : '') : '—';
        }
        function kanbanAvatarStack(ownerUid, assigneeUids) {
            const list = [ownerUid, ...array(assigneeUids)].map(String).filter(Boolean);
            if (!list.length) return '';
            const shown = list.slice(0, 3);
            const overflow = list.length - shown.length;
            const avatars = shown.map((u, i) => `<span class="crm-board-avatar${i === 0 ? ' is-owner' : ''}" title="${escape(memberName(u))}">${escape(initials(u))}</span>`).join('');
            const more = overflow > 0 ? `<span class="crm-board-avatar crm-board-avatar-more">+${overflow}</span>` : '';
            return `<span class="crm-board-people-stack">${avatars}${more}</span>`;
        }
        function kanbanDateChip(t) {
            if (!t.startDate && !t.dueDate) return '';
            const due = t.dueDate ? new Date(t.dueDate + 'T00:00:00') : null;
            let cls = 'crm-board-date-chip', flag = '';
            if (due && t.status !== 'done') {
                const today = new Date();
                const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                const diff = Math.round((due - now) / 86400000);
                if (diff < 0) { cls += ' is-overdue'; flag = `<span class="crm-board-due-badge crm-board-due-overdue">${Math.abs(diff)}d late</span>`; }
                else if (diff === 0) { cls += ' is-soon'; flag = '<span class="crm-board-due-badge crm-board-due-soon">Today</span>'; }
                else if (diff <= 2) { cls += ' is-soon'; flag = `<span class="crm-board-due-badge crm-board-due-soon">${diff}d</span>`; }
            }
            const label = t.dueDate || t.startDate;
            return `<span class="${cls}"><span class="crm-muted">${escape(label)}</span>${flag}</span>`;
        }
        function kanbanPriorityPill(priority) {
            if (!priority || priority === 'none') return '';
            const labels = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
            return `<span class="crm-board-prio-chip crm-prio-${escape(priority)}">${escape(labels[priority] || priority)}</span>`;
        }
        function kanbanCard(t) {
            const ancestors = array(t.ancestorTitles);
            const sec = ancestors.length ? ancestors.join(' → ') : '';
            const der = t.derived;
            const hasProgress = der && Number(der.activeLeafCount) > 0;
            const pct = hasProgress ? Math.max(0, Math.min(100, Math.round(Number(der.completionPercent ?? (der.completedLeafCount / der.activeLeafCount * 100)) || 0))) : 0;
            const priority = t.values?.priority || 'none';
            const statusEditor = `<label class="sr-only">Status <select data-task-status="${escape(t.id)}" class="crm-input"${canWrite() && !mutation ? '' : ' disabled'}>${Object.entries(STATUSES).map(([key, label]) => `<option value="${key}"${t.status === key ? ' selected' : ''}>${escape(response?.project?.statusLabels?.[key] || label)}</option>`).join('')}</select></label>`;
            return `<article class="crm-projects-kanban-card" draggable="${canWrite() && !mutation ? 'true' : 'false'}" data-kanban-task="${escape(t.id)}" data-card="${escape(t.id)}">
                ${sec ? `<span class="crm-projects-kanban-sec">${escape(sec)}</span>` : ''}
                <div class="crm-projects-kanban-title">${taskButton(t)}</div>
                ${hasProgress ? `<div class="crm-projects-kanban-progress"><span class="track"><i style="width:${pct}%"></i></span><b>${escape(der.completedLeafCount)}/${escape(der.activeLeafCount)}</b></div>` : ''}
                <div class="crm-projects-kanban-foot">
                    ${kanbanAvatarStack(t.ownerUid, t.assigneeUids)}
                    ${kanbanPriorityPill(priority)}
                    ${kanbanDateChip(t)}
                    ${statusEditor}
                </div>
            </article>`;
        }
        function kanbanColumn(key, label, tasks) {
            const colTasks = tasks.filter((t) => t.status === key);
            return `<section class="crm-projects-kanban-col" data-status-column="${key}" data-col="${key}" aria-label="${escape(label)}">
                <header><span class="crm-projects-status-pill s-${key}">${escape(label)}</span><b class="crm-projects-kanban-count">${colTasks.length}</b></header>
                <div class="crm-projects-kanban-cards">
                    ${colTasks.map(kanbanCard).join('') || '<p class="crm-muted crm-projects-kanban-empty">No tasks on this page.</p>'}
                </div>
            </section>`;
        }
        async function applyStatus(id, nextStatus) {
            const found = array(response?.tasks).find((t) => t.id === id);
            if (!found || found.status === nextStatus || !canWrite() || mutation) return;
            const prevStatus = found.status;
            const s = scope();
            mutation = true;
            syncTaskPermissions();
            found.status = nextStatus;
            render();
            const body = JSON.stringify({ operationId: operationId(), expectedRevision: found.revision, status: nextStatus });
            try {
                const request = () => api(`${base()}/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
                let result;
                try {
                    result = await request();
                } catch (error) {
                    if (error.status || !current(s)) throw error;
                    result = await request();
                }
                if (!current(s)) return;
                const minimal = result.task || result.result?.task || result.result || result;
                if (minimal?.revision !== undefined) {
                    found.revision = minimal.revision;
                }
                if (task && task.id === id) {
                    task = { ...task, status: nextStatus, ...(minimal?.revision !== undefined ? { revision: minimal.revision } : {}) };
                }
                if (board?.updateTask) {
                    board.updateTask({ ...found, status: nextStatus, ...(minimal?.revision !== undefined ? { revision: minimal.revision } : {}) });
                } else {
                    await board?.refresh();
                }
                if (current(s)) await refresh();
            } catch (err) {
                if (current(s)) {
                    found.status = prevStatus;
                    const msg = err?.message || 'Could not update task status';
                    status(msg);
                    taskStatus(msg);
                    render();
                    refresh();
                }
            } finally {
                if (current(s)) {
                    mutation = false;
                    syncTaskPermissions();
                    render();
                }
            }
        }
        // Switching views used to be a hard cut. Fade the outgoing surface out and
        // the incoming one in on the shared motion curve; reduced-motion zeroes it.
        const isGantt = (v) => v === 'timeline' || v === 'gantt';
        let lastRenderedView = null;
        function animateViewSwap() {
            const canonical = isGantt(view) ? 'gantt' : view;
            if (lastRenderedView === canonical) return;
            lastRenderedView = canonical;
            const surfaces = [el('projects-view-content'), el('projects-board-table-wrap')].filter(Boolean);
            surfaces.forEach((node) => node.classList?.add?.('is-view-entering'));
            const settle = () => surfaces.forEach((node) => node.classList?.remove?.('is-view-entering'));
            if (typeof globalScope.requestAnimationFrame === 'function') globalScope.requestAnimationFrame(() => globalScope.requestAnimationFrame(settle));
            else settle();
        }
        function render() {
            if (!el('projects-view-content')) return;
            animateViewSwap();
            fillFilters();
            renderFilterChips();
            document.querySelectorAll('#projects-view-tabs [data-view]').forEach((button) => {
                const bView = button.dataset.view;
                const active = isGantt(view) ? isGantt(bView) : bView === view;
                button.setAttribute('aria-pressed', String(active));
            });
            el('projects-board-table-wrap').hidden = view !== 'board';
            el('projects-view-content').hidden = view === 'board';
            el('projects-view-paging').hidden = view === 'board' || view === 'charts';
            el('projects-view-previous').disabled = loading || !previous.length;
            el('projects-view-more').disabled = loading || !response?.hasMore;
            const rows = array(response?.tasks), a = response?.aggregates;
            const fullSummary = response ? `${response.matchingTaskCount} matching tasks ${view === 'calendar' ? `overlapping ${calendarMonth} with the shared filters` : 'in the full project'}. Showing ${rows.length ? pageIndex * 200 + 1 : 0}–${pageIndex * 200 + rows.length} in this ${view === 'calendar' ? 'month' : 'view'} page. Active-leaf completion: ${a?.completedLeafTaskCount ?? 0}/${a?.activeLeafTaskCount ?? 0} (${a?.completionPercent ?? 0}%). Context ancestors are excluded from matching totals.` : '';
            const summary = el('projects-view-summary');
            summary.textContent = response ? `${response.matchingTaskCount} matching tasks${view === 'calendar' ? ` overlapping ${calendarMonth}` : ''} · ${a?.completionPercent ?? 0}% complete${rows.length < response.matchingTaskCount ? ` · Showing ${rows.length ? pageIndex * 200 + 1 : 0}–${pageIndex * 200 + rows.length} in this ${view === 'calendar' ? 'month' : 'view'} page` : ''}` : '';
            summary.title = fullSummary;
            summary.setAttribute?.('aria-label', fullSummary);
            if (view === 'board') return;
            if (!response && view === 'calendar') { renderCalendar([]); return; }
            if (!response) { el('projects-view-content').innerHTML = '<p class="crm-muted">Choose a project or refresh the view.</p>'; return; }
            if (view === 'kanban') {
                el('projects-view-content').innerHTML = `<div class="crm-projects-kanban">${Object.entries(STATUSES).map(([key, label]) => kanbanColumn(key, response.project?.statusLabels?.[key] || label, rows)).join('')}</div>`;
            } else if (isGantt(view)) {
                const hasActiveFilters = Boolean(filters.title || filters.status || filters.sectionId || filters.ownerUid || filters.assigneeUid || filters.fromDate || filters.toDate);
                if (!rows.length) {
                    if (!hasActiveFilters) {
                        el('projects-view-content').innerHTML = '';
                        return;
                    }
                    el('projects-view-content').innerHTML = `${ganttToolsMarkup()}<p class="crm-muted">No tasks match the active filters.</p>`;
                    return;
                }
                const hasInterval = (t) => t.startDate || t.dueDate || (hasDerivedTimelineSpan(t, rows) && (t.derived?.startDate || t.derived?.dueDate));
                const dated = rows.filter(hasInterval).sort((a, b) => String(a.startDate || a.dueDate || a.derived?.startDate || a.derived?.dueDate).localeCompare(String(b.startDate || b.dueDate || b.derived?.startDate || b.derived?.dueDate)));
                const undated = rows.filter((t) => !hasInterval(t));
                const tools = ganttToolsMarkup();
                const chart = ganttMarkup(dated);
                const undatedMarkup = undated.length ? `<h4>Undated tasks</h4>${undated.map((t) => taskRow(t)).join('')}` : '';
                el('projects-view-content').innerHTML = `${tools}${chart}${undatedMarkup}`;
            } else if (view === 'calendar') renderCalendar(rows);
            else if (view === 'charts') {
                const totalActive = Math.max(1, Number(a?.activeLeafTaskCount || 0));
                const pctComplete = Math.max(0, Math.min(100, Number(a?.completionPercent || 0)));
                const R = 52, C = 2 * Math.PI * R;
                const strokeDash = (C * pctComplete / 100).toFixed(1);
                const donutCircle = pctComplete > 0
                    ? `<circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--pj-accent)" stroke-width="15" stroke-linecap="round" stroke-dasharray="${strokeDash} ${C.toFixed(1)}" transform="rotate(-90 70 70)"/>`
                    : '';
                const donut = `<div class="crm-projects-chart-donut"><svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="${escape(pctComplete)} percent of active leaf tasks complete"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--pj-sunken)" stroke-width="15"/>${donutCircle}<text x="70" y="70" text-anchor="middle" dominant-baseline="central" fill="var(--pj-ink)" font-size="26" font-weight="700">${escape(pctComplete)}%</text><text x="70" y="93" text-anchor="middle" fill="var(--pj-muted)" font-size="10.5">${escape(a?.completedLeafTaskCount ?? 0)} of ${escape(a?.activeLeafTaskCount ?? 0)}</text></svg><p>Active leaf completion</p></div>`;
                const colorOf = { not_started: 'var(--st-ns-fg)', in_progress: 'var(--g4, #f5a742)', blocked: 'var(--sig-over-fg)', done: 'var(--st-dn-fg)' };
                const chart = (title, values, isStatus = false) => {
                    const entries = Object.entries(values || {});
                    if (!entries.length) {
                        return `<section class="crm-projects-chart crm-projects-chart-set"><h4>${title}</h4><p class="crm-muted">No active leaf tasks.</p></section>`;
                    }
                    const maxVal = Math.max(1, ...entries.map(([, count]) => Number(count) || 0));
                    return `<section class="crm-projects-chart crm-projects-chart-set"><h4>${title}</h4>${entries.map(([key, count]) => {
                        const n = Number(count) || 0;
                        const barPct = Math.min(100, Math.round((n / maxVal) * 100));
                        const label = escape(isStatus ? (response?.project?.statusLabels?.[key] || STATUSES[key] || key) : (key === 'unassigned' || key === '__unassigned__' ? 'Unassigned' : memberName(key)));
                        const bg = isStatus ? (colorOf[key] || 'var(--pj-accent)') : 'var(--pj-accent)';
                        return `<div class="crm-projects-chart-row"><span>${label}</span><span class="crm-projects-chart-track"><meter min="0" max="${totalActive}" value="${n}" style="display:none;">${n}</meter><i style="width:${barPct}%;background:${bg}"></i></span><b>${n}</b></div>`;
                    }).join('')}</section>`;
                };
                el('projects-view-content').innerHTML = `<p class="crm-muted">Complete server snapshot · matching active leaf tasks. Only matching tasks that are leaves in the full active project contribute. Parent rows and page size do not change this denominator.</p><p><strong>${escape(a?.completionPercent ?? 0)}% complete</strong> — ${escape(a?.completedLeafTaskCount ?? 0)} of ${escape(a?.activeLeafTaskCount ?? 0)} active leaf tasks</p><div class="crm-projects-charts-grid">${donut}<div>${chart('Active leaves by status', a?.byStatus, true)}${chart('Active leaves by accountable owner', a?.byOwnerUid, false)}</div></div>`;
            }
        }
        function hasDerivedTimelineSpan(t, rows) {
            return !!t.derived && (Number(t.activeChildCount) > 0 || (Number(t.derived.activeLeafCount) > 0 && rows.some((child) => child.id !== t.id && (child.parentTaskId === t.id || array(child.pathIds).includes(t.id)))));
        }
        const hasDerivedGanttSpan = hasDerivedTimelineSpan;
        function ganttToolsMarkup() {
            const hasActiveFilters = Boolean(filters.title || filters.status || filters.sectionId || filters.ownerUid || filters.assigneeUid || filters.fromDate || filters.toDate);
            const sections = array(board?.getState()?.sections);
            const members = array(board?.getState()?.members);
            return `<div class="crm-projects-gantt-tools" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap;"><div style="display:flex;align-items:center;gap:10px;"><div class="seg" role="group" aria-label="Gantt zoom"><button type="button" class="crm-btn-secondary${ganttZoom === 'days' ? ' is-active' : ''}" data-gantt-zoom="days"${ganttZoom === 'days' ? ' aria-pressed="true"' : ' aria-pressed="false"'}>Days</button><button type="button" class="crm-btn-secondary${ganttZoom === 'weeks' ? ' is-active' : ''}" data-gantt-zoom="weeks"${ganttZoom === 'weeks' ? ' aria-pressed="true"' : ' aria-pressed="false"'}>Weeks</button><button type="button" class="crm-btn-secondary${ganttZoom === 'months' ? ' is-active' : ''}" data-gantt-zoom="months"${ganttZoom === 'months' ? ' aria-pressed="true"' : ' aria-pressed="false"'}>Months</button></div></div><div class="crm-projects-gantt-filter-cluster" role="group" aria-label="Gantt chart filters" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><input type="search" class="crm-input crm-input-sm" data-gantt-filter="title" placeholder="Search tasks…" value="${escape(filters.title || '')}" aria-label="Search Gantt tasks" style="width:130px;"><select class="crm-input crm-input-sm" data-gantt-filter="status" aria-label="Filter by status"><option value="">All statuses</option>${Object.entries(STATUSES).map(([key, label]) => `<option value="${key}"${filters.status === key ? ' selected' : ''}>${escape(response?.project?.statusLabels?.[key] || label)}</option>`).join('')}</select><select class="crm-input crm-input-sm" data-gantt-filter="sectionId" aria-label="Filter by section"><option value="">All sections</option>${sections.map((s) => `<option value="${escape(s.id)}"${String(filters.sectionId || '') === String(s.id) ? ' selected' : ''}>${escape(s.title)}</option>`).join('')}</select><select class="crm-input crm-input-sm" data-gantt-filter="ownerUid" aria-label="Filter by owner"><option value="">All owners</option>${members.map((m) => `<option value="${escape(m.uid || m.id)}"${String(filters.ownerUid || '') === String(m.uid || m.id) ? ' selected' : ''}>${escape(m.displayName || m.name || m.email || m.uid || m.id)}</option>`).join('')}</select><select class="crm-input crm-input-sm" data-gantt-filter="assigneeUid" aria-label="Filter by assignee"><option value="">All assignees</option>${members.map((m) => `<option value="${escape(m.uid || m.id)}"${String(filters.assigneeUid || '') === String(m.uid || m.id) ? ' selected' : ''}>${escape(m.displayName || m.name || m.email || m.uid || m.id)}</option>`).join('')}</select><label class="crm-gantt-date-label" style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--pj-muted);">From<input type="date" class="crm-input crm-input-sm" data-gantt-filter="fromDate" value="${escape(filters.fromDate || '')}" aria-label="Gantt start date" style="padding:2px 4px;font-size:11px;"></label><label class="crm-gantt-date-label" style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--pj-muted);">To<input type="date" class="crm-input crm-input-sm" data-gantt-filter="toDate" value="${escape(filters.toDate || '')}" aria-label="Gantt due date" style="padding:2px 4px;font-size:11px;"></label>${hasActiveFilters ? '<button type="button" class="crm-btn-secondary crm-btn-sm" data-gantt-action="clear-filters" style="font-size:11px;padding:3px 8px;">Reset filters</button>' : ''}</div></div>`;
        }
        function ganttMarkup(rows) {
            const hasDerivedSpan = (t) => hasDerivedTimelineSpan(t, rows);
            const day = (value) => Date.parse(`${value}T00:00:00Z`) / 86400000;
            const safeDay = (value) => {
                if (!value) return null;
                const n = day(value);
                return Number.isFinite(n) ? n : null;
            };
            const dates = rows.flatMap((t) => [t.startDate, t.dueDate, ...(hasDerivedSpan(t) ? [t.derived?.startDate, t.derived?.dueDate] : [])]).map(safeDay).filter((v) => v !== null);
            if (!rows.length || !dates.length) return '<p class="crm-muted">No dated tasks on this page.</p>';
            const start = Math.min(...dates), end = Math.max(...dates), span = Math.max(1, end - start + 1);
            const dateLabel = (offset) => new Date((start + offset) * 86400000).toISOString().slice(0, 10);
            const bar = (from, to, derivedBar) => {
                const d1 = safeDay(from || to);
                const d2 = safeDay(to || from);
                if (d1 === null && d2 === null) return '';
                const fromDay = Math.min(d1 ?? d2, d2 ?? d1);
                const toDay = Math.max(d1 ?? d2, d2 ?? d1);
                const left = Math.max(0, ((fromDay - start) / span) * 100);
                const width = Math.max(0.5, ((toDay - fromDay + 1) / span) * 100);
                const label = `${derivedBar ? 'Derived descendant span' : 'Stored interval'}: ${from || to} through ${to || from}`;
                return `<span class="crm-projects-gantt-bar${derivedBar ? ' is-derived' : ''}" role="img" aria-label="${escape(label)}" style="left:${left.toFixed(2)}%;width:${Math.min(100 - left, width).toFixed(2)}%" title="${escape(label)}"></span>`;
            };
            const zoomWidths = { days: '2200px', weeks: '1200px', months: '850px' };
            const minW = zoomWidths[ganttZoom] || '1200px';

            let weekendBands = '';
            if (span <= 120) {
                for (let d = start; d <= end; d++) {
                    const dow = new Date(d * 86400000).getUTCDay();
                    if (d === start && dow === 0) {
                        const bWidth = Math.min(100, (1 / span) * 100);
                        weekendBands += `<span class="crm-projects-gantt-weekend" style="left:0%;width:${bWidth.toFixed(2)}%;"></span>`;
                    } else if (dow === 6) {
                        const bLeft = Math.max(0, ((d - start) / span) * 100);
                        const daysCovered = (d === end) ? 1 : 2;
                        const bWidth = Math.min(100 - bLeft, (daysCovered / span) * 100);
                        weekendBands += `<span class="crm-projects-gantt-weekend" style="left:${bLeft.toFixed(2)}%;width:${bWidth.toFixed(2)}%;"></span>`;
                    }
                }
            }

            const todayDay = Math.floor(Date.now() / 86400000);
            let todayMarker = '';
            if (todayDay >= start && todayDay <= end) {
                const tLeft = ((todayDay - start) / span) * 100;
                todayMarker = `<span class="crm-projects-gantt-today" style="left:${tLeft.toFixed(2)}%;"></span>`;
            }

            const milestone = (t) => {
                if (t.startDate && t.startDate === t.dueDate) {
                    const d = safeDay(t.startDate);
                    if (d === null) return '';
                    const mLeft = Math.max(0, ((d - start) / span) * 100);
                    return `<span class="crm-projects-gantt-milestone" style="left:${mLeft.toFixed(2)}%;" title="Milestone: ${escape(t.startDate)}"></span>`;
                }
                return '';
            };

            const depConnectors = (t) => {
                return array(t.predecessorTaskIds).map((predId) => {
                    const pred = rows.find((r) => r.id === predId);
                    if (!pred) return '';
                    const pEnd = safeDay(pred.dueDate || pred.startDate);
                    const tStart = safeDay(t.startDate || t.dueDate);
                    if (pEnd === null || tStart === null) return '';
                    const fromDay = Math.min(pEnd, tStart);
                    const toDay = Math.max(pEnd, tStart);
                    const dLeft = Math.max(0, ((fromDay - start) / span) * 100);
                    const dWidth = Math.max(0.5, ((toDay - fromDay) / span) * 100);
                    const title = `Dependency: ${escape(pred.title || predId)} → ${escape(t.title || t.id)}`;
                    return `<span class="crm-projects-gantt-dep-line" style="left:${dLeft.toFixed(2)}%;width:${dWidth.toFixed(2)}%;" title="${title}"></span>`;
                }).join('');
            };

            const legend = `<div class="crm-projects-gantt-legend"><span><i style="background:var(--pj-accent)"></i>Stored interval</span><span><i class="crm-projects-gantt-key-derived"></i>Derived descendant span</span><span><i class="crm-projects-gantt-key-dep"></i>Dependency</span><span><i class="crm-projects-gantt-key-milestone"></i>Milestone</span><span><i class="crm-projects-gantt-key-today"></i>Today</span></div>`;

            return `<p class="crm-muted">Blue bars show stored dates. Dashed gray bars show derived descendant spans. Open a task to preview a date change.</p><div class="crm-projects-gantt" style="min-width:${minW};"><div class="crm-projects-gantt-axis" style="min-width:${minW};"><span>Task</span><div>${Array.from({ length: 5 }, (_, i) => `<time style="left:${i * 25}%">${dateLabel(Math.floor((span - 1) * i / 4))}</time>`).join('')}${todayMarker}</div></div>${rows.map((t) => `<div class="crm-projects-gantt-row" style="min-width:${minW};" data-view-task="${escape(t.id)}"><div>${taskButton(t)}<small>Stored: ${t.startDate || t.dueDate ? `${escape(t.startDate || t.dueDate)} → ${escape(t.dueDate || t.startDate)}` : 'undated'}</small>${hasDerivedSpan(t) ? derived(t) : ''}</div><div class="crm-projects-gantt-track${hasDerivedSpan(t) ? ' has-derived-span' : ''}">${weekendBands}${todayMarker}${milestone(t)}${depConnectors(t)}${bar(t.startDate, t.dueDate, false)}${hasDerivedSpan(t) ? bar(t.derived?.startDate, t.derived?.dueDate, true) : ''}</div></div>`).join('')}</div>${legend}`;
        }
        const timelineMarkup = (rows) => (rows && rows.length ? ganttMarkup(rows) : '');
        function memberName(id) {
            const m = array(board?.getState()?.members).find((m) => (m.uid || m.id) === id);
            return m?.displayName || m?.name || m?.email || 'Project member';
        }
        function renderCalendar(rows) {
            const [year, month] = calendarMonth.split('-').map(Number);
            const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const monthTitle = `${monthNames[month - 1] || ''} ${year}`;
            const todayIso = new Date().toISOString().slice(0, 10);
            el('projects-view-content').innerHTML = `<div class="crm-projects-calendar-bar"><div class="crm-cal-nav-cluster"><div class="crm-cal-nav-group"><button type="button" class="crm-btn-secondary crm-cal-nav-btn" data-cal-nav="-1" aria-label="Previous month">‹</button><button type="button" class="crm-btn-secondary crm-cal-nav-btn is-today-btn" data-cal-nav="today">Today</button><button type="button" class="crm-btn-secondary crm-cal-nav-btn" data-cal-nav="1" aria-label="Next month">›</button></div><h3 class="crm-cal-month-title">${escape(monthTitle)}</h3><span id="projects-calendar-view-provenance" class="crm-cal-provenance-tag">Vietnam calendar</span></div><label class="crm-cal-month-picker-label">Visible calendar month <input id="projects-view-month" type="month" class="crm-input crm-cal-month-input" value="${escape(calendarMonth)}"></label></div><div class="crm-projects-calendar-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => `<strong>${name}</strong>`).join('')}${'<span class="crm-cal-empty-slot" aria-hidden="true"></span>'.repeat((new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7)}${Array.from({ length: days }, (_, i) => {
                const date = `${calendarMonth}-${String(i + 1).padStart(2, '0')}`;
                const cur = new Date(Date.UTC(year, month - 1, i + 1));
                const dow = cur.getUTCDay();
                const isWeekend = dow === 0 || dow === 6;
                const isToday = date === todayIso;
                const matches = rows.filter((t) => {
                    if (!t.startDate && !t.dueDate) return false;
                    const startVal = t.startDate && t.dueDate ? (t.startDate <= t.dueDate ? t.startDate : t.dueDate) : (t.startDate || t.dueDate);
                    const dueVal = t.startDate && t.dueDate ? (t.startDate <= t.dueDate ? t.dueDate : t.startDate) : (t.dueDate || t.startDate);
                    return startVal <= date && dueVal >= date;
                });
                return `<section class="crm-projects-calendar-day${isWeekend ? ' off' : ''}${isToday ? ' is-today' : ''}"><div class="crm-cal-day-header"><span class="crm-cal-day-num">${String(i + 1).padStart(2, '0')}</span><h5>${escape(date)}</h5></div><div class="crm-cal-day-tasks">${matches.slice(0, 5).map(taskButton).join('')}</div>${matches.length > 5 ? `<span class="crm-cal-more-badge">${matches.length - 5} more on this date; use the dated list below.</span>` : ''}</section>`;
            }).join('')}</div><h4>Tasks overlapping ${escape(calendarMonth)} on this page</h4>${calendarQuery().empty ? '<p class="crm-muted">The shared date filters do not overlap this month. No tasks match.</p>' : ''}${rows.map((t) => taskRow(t)).join('')}<details class="crm-calendar-tech-drawer" style="margin-top:24px;border-top:1px solid var(--pj-line, #e2e8f0);padding-top:12px;"><summary class="crm-muted" style="cursor:pointer;font-size:12px;font-weight:500;">Vietnam calendar details &amp; holiday rules</summary><div id="projects-calendar-details" class="crm-muted" style="margin-top:8px;font-size:12px;line-height:1.6;"></div><div id="projects-calendar-availability" style="margin-top:8px;"></div></details>`;
            if (response) loadCalendar(`${calendarMonth}-01`, `${calendarMonth}-${days}`);
        }
        function applyCalendarData(c) {
            if (!c) return;
            const prov = el('projects-calendar-view-provenance');
            if (prov) {
                prov.textContent = `Vietnam calendar${c?.coverage?.status === 'verified' ? ' · Verified' : ''}`;
            }
            const details = el('projects-calendar-details');
            if (details) {
                details.innerHTML = `${escape(calendarCoverage(c))} ${sourceLinks(c?.coverage?.sourceUrls)}<br>Accountable-owner availability governs scheduling; other assignees generate warnings.`;
            }
            const avail = el('projects-calendar-availability');
            if (avail) {
                avail.innerHTML = `<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:12px;">Availability and reason provenance for this month</summary>${array(c?.days).map((day) => `<p style="margin:4px 0;"><strong>${escape(day.date)}</strong>: organization ${day.organization?.working ? 'working' : 'nonworking'}${array(day.organization?.reasons).length ? ` — ${escape(day.organization.reasons.map(warningText).join('; '))}` : ''}${day.workingSwap ? ' · explicitly adopted working swap' : ''}${array(day.members).filter((m) => m.reasons?.some((r) => r.code === 'personal_leave')).map((m) => `<br>${escape(memberName(m.uid))}: personal leave`).join('')}</p>`).join('')}</details>`;
            }
        }
        async function loadCalendar(fromDate, toDate) {
            const s = scope(), sequence = ++calendarSequence;
            const rev = response?.calendar?.revision ?? 0;
            const cacheKey = `${actorUid}:${projectId}:${calendarMonth}:${rev}`;
            if (calendarCache.has(cacheKey)) {
                applyCalendarData(calendarCache.get(cacheKey));
                return;
            }
            try {
                const result = await api(`${base()}/calendar?${new URLSearchParams({ fromDate, toDate })}`);
                if (!current(s) || sequence !== calendarSequence || view !== 'calendar') return;
                const c = result.calendar;
                if (c) calendarCache.set(cacheKey, c);
                applyCalendarData(c);
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
            calendarCache.clear();
            if (notifyBoard) board?.invalidateAccess?.(deniedProjectId, false);
            const form = el('projects-view-filters');
            if (form) {
                for (const name of ['title', 'fromDate', 'toDate', 'status', 'sectionId', 'ownerUid', 'assigneeUid']) {
                    const control = form.elements.namedItem(name); if (control) control.value = '';
                }
                for (const name of ['sectionId', 'ownerUid', 'assigneeUid']) {
                    const control = form.elements.namedItem(name); if (control) control.innerHTML = '<option value="">Access unavailable</option>';
                }
                syncFilterBadge();
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
            calendarCache.clear();
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
            if (nextKey === taskKey) { task = next; if (task && el('projects-task-derived')) el('projects-task-derived').innerHTML = derived(task, true) + warningList(task.dependencyWarnings) + warningList(task.calendarWarnings); syncPredecessorPicker(); syncTaskPermissions(); return; }
            taskGeneration++; lookupSequence++; datesVersion++; taskKey = nextKey; task = next; preview = null; links = []; canManageLinks = false;
            renderTask();
            syncTaskPermissions();
            if (task) loadLinks();
        }
        function syncTaskPermissions() {
            const planning = el('projects-task-planning');
            planning?.querySelectorAll?.('#projects-task-schedule input, #projects-task-schedule button, #projects-task-dependencies textarea, #projects-task-dependencies select, #projects-task-dependencies button').forEach((control) => { control.disabled = !canWrite() || mutation; });
            planning?.querySelectorAll?.('#projects-task-links button, #projects-task-links input, #projects-task-links select').forEach((control) => { if (control.dataset?.studentLink === undefined) control.disabled = !canManageLinks || !canWrite() || mutation; });
            planning?.querySelectorAll?.('[data-remove-predecessor]').forEach((btn) => { btn.disabled = !canWrite() || mutation; });
            if (el('projects-task-apply')) el('projects-task-apply').disabled = !canWrite() || mutation || !preview?.canApply;
        }
        function predecessorOptions() {
            return response?.project?.id === projectId && uid() === actorUid
                ? array(response.tasks).filter((entry) => entry.id !== task?.id) : [];
        }
        function renderPredecessorChips() {
            const container = el('projects-task-predecessor-chips');
            const textarea = el('projects-task-predecessors');
            if (!container || !textarea) return;
            const currentIds = String(textarea.value || '').split(/[\n,]/).map((id) => id.trim()).filter(Boolean);
            if (!currentIds.length) {
                container.innerHTML = '<span class="crm-detail-no-deps">No predecessor dependencies linked.</span>';
                return;
            }
            const allTasks = array(response?.tasks);
            const boardTasks = board?.getState()?.tasks;
            const writable = canWrite() && !mutation;
            container.innerHTML = currentIds.map((id) => {
                const found = allTasks.find((t) => t.id === id) || (boardTasks && typeof boardTasks.get === 'function' ? boardTasks.get(id) : (Array.isArray(boardTasks) ? boardTasks.find((t) => t.id === id) : boardTasks?.[id]));
                const isUuid = id.startsWith('task-') || id.length > 20;
                const displayId = isUuid ? `${id.slice(0, 8)}…` : id;
                const title = found?.title || (isUuid ? `Task (${displayId})` : id);
                return `<span class="crm-dep-chip" title="Predecessor ID: ${escape(id)}"><span class="crm-dep-icon">${PJ_ICON.link}</span><span class="crm-dep-title">${escape(title)}</span>${found ? `<span class="crm-dep-id">${escape(displayId)}</span>` : ''}<button type="button" class="crm-dep-remove" data-remove-predecessor="${escape(id)}" aria-label="Remove dependency on ${escape(title)}"${writable ? '' : ' disabled'}>×</button></span>`;
            }).join('');
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
            renderPredecessorChips();
        }
        function renderTask() {
            const target = el('projects-task-planning');
            if (!target) return;
            if (!task) { target.innerHTML = ''; return; }
            target.innerHTML = `<div class="crm-detail-section"><div class="crm-detail-section-head"><h5>Schedule &amp; Timeline</h5></div><div id="projects-task-derived">${derived(task, true)}${warningList(task.dependencyWarnings)}${warningList(task.calendarWarnings)}</div><form id="projects-task-schedule" class="crm-detail-schedule-form"><div class="crm-detail-date-grid"><div class="crm-detail-field"><label for="projects-task-start" class="crm-detail-field-label"><span class="crm-field-icon">${PJ_ICON.calendar}</span> Proposed start</label><input id="projects-task-start" type="date" class="crm-input" value="${escape(task.startDate || '')}"${canWrite() ? '' : ' disabled'}></div><div class="crm-detail-field"><label for="projects-task-due" class="crm-detail-field-label"><span class="crm-field-icon">${PJ_ICON.flagDue}</span> Proposed due</label><input id="projects-task-due" type="date" class="crm-input" value="${escape(task.dueDate || '')}"${canWrite() ? '' : ' disabled'}></div></div><div class="crm-detail-form-actions"><button type="submit" class="crm-btn-secondary crm-btn-sm"${canWrite() ? '' : ' disabled'}><span class="crm-btn-icon">${PJ_ICON.bolt}</span> Preview date change</button></div></form><div id="projects-task-preview"></div></div><div class="crm-detail-section"><div class="crm-detail-section-head"><h5>Dependencies</h5><span class="crm-detail-section-subtitle">Finish-to-start predecessors</span></div><form id="projects-task-dependencies" class="crm-detail-dependencies-form"><div class="crm-detail-dep-picker-row"><div class="crm-detail-dep-select-wrap"><select id="projects-task-predecessor-picker" class="crm-input"><option value="">Choose a task</option>${predecessorOptions().map((t) => `<option value="${escape(t.id)}">${escape(t.title || 'Untitled task')}</option>`).join('')}</select></div><button id="projects-task-predecessor-add" type="button" class="crm-btn-secondary crm-btn-sm"${canWrite() ? '' : ' disabled'}>+ Add predecessor</button></div><div class="crm-detail-chips-wrapper"><div class="crm-detail-chips-label">Active Predecessors:</div><div id="projects-task-predecessor-chips" class="crm-detail-chips-list"></div></div><div class="crm-detail-hint"><span class="crm-hint-icon">${PJ_ICON.info}</span><span>Predecessors must finish before this task starts. Saving dependencies will not shift existing dates.</span></div><details class="crm-detail-advanced-dep"><summary class="crm-detail-advanced-summary">Manual task ID entry</summary><div class="crm-detail-advanced-content"><label for="projects-task-predecessors" class="crm-detail-field-label">Predecessor task IDs (one per line):</label><textarea id="projects-task-predecessors" class="crm-input crm-dep-textarea" rows="2"${canWrite() ? '' : ' disabled'}>${escape(array(task.predecessorTaskIds).join('\n'))}</textarea></div></details><div class="crm-detail-form-actions"><button type="submit" class="crm-btn-primary crm-btn-sm"${canWrite() ? '' : ' disabled'}>Save dependencies</button></div></form><p id="projects-task-status" role="status" class="crm-task-status-banner"></p></div><div class="crm-detail-section"><div class="crm-detail-section-head"><h5>CRM Links</h5></div><div id="projects-task-links"></div></div>`;
            renderPredecessorChips();
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
                const canonicalTask = result.task || result.result?.task;
                const minimal = canonicalTask || result.result || result;
                if (minimal?.revision !== undefined) task = { ...task, revision: minimal.revision };
                if (canonicalTask) task = { ...task, ...canonicalTask };
                if (payload?.predecessorTaskIds) task = { ...task, predecessorTaskIds: payload.predecessorTaskIds };
                taskStatus('Saved.'); preview = null;
                if (board?.updateTask && (canonicalTask || minimal?.id)) {
                    board.updateTask(task);
                } else {
                    await board?.refresh();
                }
                if (response?.tasks) {
                    response.tasks = response.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t));
                }
                if (view !== 'board' && current(s)) {
                    await refresh();
                } else {
                    viewStale = true;
                }
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
                const beforeDates = `${escape(preview.before?.startDate || 'undated')} → ${escape(preview.before?.dueDate || 'undated')}`;
                const afterDates = `${escape(preview.after?.startDate || 'undated')} → ${escape(preview.after?.dueDate || 'undated')}`;
                el('projects-task-preview').innerHTML = `<div class="crm-detail-preview-card"><div class="crm-preview-header"><span class="crm-preview-tag">Preview Date Shift</span><span class="crm-preview-task-title">${escape(task.title || 'Selected task')}</span></div><div class="crm-preview-comparison"><div class="crm-preview-col"><span class="crm-preview-label">Before:</span> <span class="crm-preview-dates">${beforeDates}</span></div><span class="crm-preview-arrow">➔</span><div class="crm-preview-col is-after"><span class="crm-preview-label">After:</span> <span class="crm-preview-dates">${afterDates}</span></div></div><div class="crm-preview-meta"><span class="crm-preview-pill">Working days: ${escape(preview.workingDayCount ?? 'unconfirmed')}</span></div>${warningList(preview.warnings)}<details class="crm-preview-details"><summary>Nonworking dates and reasons</summary>${warningList(preview.nonWorkingDays)}</details><div class="crm-preview-actions"><button id="projects-task-apply" type="button" class="crm-btn-primary crm-btn-sm"${preview.canApply ? '' : ' disabled'}>Apply this exact preview</button></div><details class="crm-preview-tech"><summary class="crm-muted">Calendar revision ${escape(preview.calendarRevision)}; feed ${escape(preview.feedVersion)}</summary><p class="crm-muted">No downstream dates move automatically. Task, dependency or calendar changes invalidate this preview.</p></details></div>`;
            } catch (error) { if (taskCurrent(s) && version === datesVersion) el('projects-task-preview').textContent = error.message || 'Preview unavailable.'; }
        }
        function init() {
            el('projects-project-links')?.addEventListener('submit', (event) => { event.preventDefault(); if (event.target.id === 'projects-project-link-lookup') lookupProjectLinks(); });
            const projectLookupChanged = (event) => { if (['projects-project-link-query', 'projects-project-link-type'].includes(event.target.id)) clearProjectLookup(); };
            el('projects-project-links')?.addEventListener('input', projectLookupChanged);
            el('projects-project-links')?.addEventListener('change', projectLookupChanged);
            el('projects-project-links')?.addEventListener('click', (event) => { if (event.target.dataset?.projectStudentLink !== undefined) openStudentLink(Number(event.target.dataset.projectStudentLink), true); if (event.target.dataset?.projectLinkRemove !== undefined) saveProjectLinks(projectLinks.filter((_, i) => i !== Number(event.target.dataset.projectLinkRemove))); });
            el('projects-view-tabs')?.addEventListener('click', (event) => {
                const button = event.target.closest('[data-view]');
                if (button && button.dataset.view !== view) {
                    const wasGantt = isGantt(view);
                    const willBeGantt = isGantt(button.dataset.view);
                    if (wasGantt && willBeGantt) {
                        view = button.dataset.view;
                        render();
                        return;
                    }
                    const monthScopeChanged = view === 'calendar' || button.dataset.view === 'calendar';
                    view = button.dataset.view;
                    if (monthScopeChanged || viewStale) {
                        viewStale = false;
                        resetViewPage();
                    } else render();
                }
            });
            const captureFilterDraft = (event) => { const name = event.target.name; if (['title', 'sectionId', 'status', 'ownerUid', 'assigneeUid', 'fromDate', 'toDate'].includes(name)) filterDrafts[name] = event.target.value; };
            el('projects-view-filters')?.addEventListener('click', (event) => {
                const chip = event.target.closest?.('[data-chip-value]');
                // A chip toggles, so a second handler on the same click would
                // quietly undo the first. Stamp the event and act once.
                if (!chip || event.crmChipHandled) return;
                event.crmChipHandled = true;
                event.preventDefault();
                applyChip(chip.dataset.chipField, chip.dataset.chipValue);
            });
            el('projects-view-filters')?.addEventListener('input', captureFilterDraft);
            el('projects-view-filters')?.addEventListener('change', captureFilterDraft);
            el('projects-view-filters')?.addEventListener('submit', (event) => {
                event.preventDefault();
                filterDrafts = Object.fromEntries(new FormData(event.target));
                if (filterDrafts.fromDate && filterDrafts.toDate && filterDrafts.fromDate > filterDrafts.toDate) {
                    filterDrafts.toDate = filterDrafts.fromDate;
                    const toInput = event.target.querySelector?.('[name="toDate"]');
                    if (toInput) toInput.value = filterDrafts.toDate;
                }
                filters = Object.fromEntries(Object.entries(filterDrafts).filter(([, value]) => value !== ''));
                syncFilterBadge();
                board?.setFilters(filters);
                refresh();
            });
            el('projects-view-filters')?.addEventListener('reset', () => {
                filters = {}; filterDrafts = {}; syncFilterBadge();
                if (typeof setTimeout === 'function') setTimeout(renderFilterChips, 0);
                else renderFilterChips();
                if (projectId) {
                    board?.setFilters(filters);
                    refresh();
                }
            });
            el('projects-view-more')?.addEventListener('click', () => { if (!loading && response?.hasMore) refresh(response.nextCursor, [...previous, cursor], pageIndex + 1); });
            el('projects-view-previous')?.addEventListener('click', () => { if (!loading && previous.length) refresh(previous.at(-1), previous.slice(0, -1), pageIndex - 1); });
            el('projects-view-retry')?.addEventListener('click', () => refresh());
            el('btn-projects-board-refresh')?.addEventListener('click', () => refresh());
            el('projects-view-content')?.addEventListener('click', (event) => {
                const zoomBtn = event.target.closest('[data-gantt-zoom]');
                if (zoomBtn) {
                    ganttZoom = zoomBtn.dataset.ganttZoom;
                    render();
                    return;
                }
                const clearFiltersBtn = event.target.closest('[data-gantt-action="clear-filters"]');
                if (clearFiltersBtn) {
                    filters = {};
                    filterDrafts = {};
                    const form = el('projects-view-filters');
                    form?.reset();
                    syncFilterBadge();
                    if (typeof setTimeout === 'function') setTimeout(renderFilterChips, 0);
                    else renderFilterChips();
                    if (projectId) {
                        board?.setFilters(filters);
                        refresh();
                    }
                    return;
                }
                const calNavBtn = event.target.closest('[data-cal-nav]');
                if (calNavBtn) {
                    const nav = calNavBtn.dataset.calNav;
                    let nextMonth;
                    if (nav === 'today') {
                        nextMonth = new Date().toISOString().slice(0, 7);
                    } else {
                        const [y, m] = calendarMonth.split('-').map(Number);
                        const targetDate = new Date(Date.UTC(y, m - 1 + Number(nav), 1));
                        nextMonth = `${targetDate.getUTCFullYear()}-${String(targetDate.getUTCMonth() + 1).padStart(2, '0')}`;
                    }
                    if (nextMonth !== calendarMonth) {
                        calendarMonth = nextMonth;
                        resetViewPage();
                    }
                    return;
                }
                const button = event.target.closest('[data-task-open]');
                const found = array(response?.tasks).find((t) => t.id === button?.dataset.taskOpen);
                if (found) board?.selectTask(found);
            });
            let dragTaskId = null;
            el('projects-view-content')?.addEventListener('dragstart', (e) => {
                const card = e.target?.closest ? e.target.closest('[data-kanban-task], [data-card]') : null;
                const isInteractive = Boolean(
                    (e.target?.tagName && ['SELECT', 'INPUT', 'TEXTAREA', 'OPTION'].includes(e.target.tagName)) ||
                    (typeof e.target?.matches === 'function' && e.target.matches('select, input, textarea, option'))
                );
                if (!card || !canWrite() || mutation || isInteractive) {
                    e.preventDefault?.();
                    return;
                }
                dragTaskId = card.dataset?.kanbanTask || card.dataset?.card;
                card.classList?.add?.('drag');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', dragTaskId); } catch (_) { /* legacy browser fallback */ }
                }
            });
            el('projects-view-content')?.addEventListener('dragend', () => {
                dragTaskId = null;
                (el('projects-view-content')?.querySelectorAll?.('[data-card].drag') || []).forEach((c) => c.classList.remove('drag'));
                (el('projects-view-content')?.querySelectorAll?.('[data-col].over') || []).forEach((c) => c.classList.remove('over'));
            });
            el('projects-view-content')?.addEventListener('dragover', (e) => {
                const col = e.target.closest ? e.target.closest('[data-status-column], [data-col]') : null;
                if (!col || !dragTaskId || !canWrite() || mutation) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                (el('projects-view-content')?.querySelectorAll?.('[data-col].over') || []).forEach((c) => { if (c !== col) c.classList.remove('over'); });
                col.classList.add('over');
            });
            el('projects-view-content')?.addEventListener('dragleave', (e) => {
                const col = e.target.closest ? e.target.closest('[data-status-column], [data-col]') : null;
                if (col && (!e.relatedTarget || !col.contains(e.relatedTarget))) {
                    col.classList.remove('over');
                }
            });
            el('projects-view-content')?.addEventListener('drop', async (e) => {
                const col = e.target.closest ? e.target.closest('[data-status-column], [data-col]') : null;
                const id = dragTaskId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : null);
                dragTaskId = null;
                (el('projects-view-content')?.querySelectorAll?.('[data-card].drag') || []).forEach((c) => c.classList.remove('drag'));
                (el('projects-view-content')?.querySelectorAll?.('[data-col].over') || []).forEach((c) => c.classList.remove('over'));
                if (!col || !id || !canWrite() || mutation) return;
                e.preventDefault();
                const nextStatus = col.dataset.statusColumn || col.dataset.col;
                await applyStatus(id, nextStatus);
            });
            el('projects-view-content')?.addEventListener('change', async (event) => {
                if (event.target.id === 'projects-view-month') { const next = event.target.value; if (view === 'calendar' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(next) && next !== calendarMonth) { calendarMonth = next; resetViewPage(); } return; }
                const ganttFilterField = event.target.dataset?.ganttFilter;
                if (ganttFilterField) {
                    let val = event.target.value;
                    if ((ganttFilterField === 'fromDate' || ganttFilterField === 'toDate') && val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                        val = '';
                        event.target.value = '';
                    }
                    if (ganttFilterField === 'fromDate' && val && filters.toDate && val > filters.toDate) {
                        filters.toDate = val;
                        filterDrafts.toDate = val;
                        const toControl = el('projects-view-filters')?.elements?.namedItem('toDate');
                        if (toControl) toControl.value = val;
                        const ganttToInput = el('projects-view-content')?.querySelector?.('[data-gantt-filter="toDate"]');
                        if (ganttToInput) ganttToInput.value = val;
                    } else if (ganttFilterField === 'toDate' && val && filters.fromDate && val < filters.fromDate) {
                        filters.fromDate = val;
                        filterDrafts.fromDate = val;
                        const fromControl = el('projects-view-filters')?.elements?.namedItem('fromDate');
                        if (fromControl) fromControl.value = val;
                        const ganttFromInput = el('projects-view-content')?.querySelector?.('[data-gantt-filter="fromDate"]');
                        if (ganttFromInput) ganttFromInput.value = val;
                    }
                    const form = el('projects-view-filters');
                    const control = form?.elements?.namedItem(ganttFilterField);
                    if (control) {
                        control.value = val;
                        if (typeof Event === 'function') control.dispatchEvent(new Event('change', { bubbles: true }));
                        else if (typeof control.dispatchEvent === 'function') control.dispatchEvent({ type: 'change', bubbles: true });
                    }
                    filterDrafts[ganttFilterField] = val;
                    if (val) filters[ganttFilterField] = val;
                    else delete filters[ganttFilterField];
                    syncFilterBadge();
                    renderFilterChips();
                    board?.setFilters(filters);
                    refresh();
                    return;
                }
                const id = event.target.dataset.taskStatus;
                if (id) {
                    await applyStatus(id, event.target.value);
                }
            });
            el('projects-view-content')?.addEventListener('search', (event) => {
                if (event.target.dataset?.ganttFilter === 'title') {
                    const val = event.target.value;
                    const form = el('projects-view-filters');
                    const control = form?.elements?.namedItem('title');
                    if (control) control.value = val;
                    filterDrafts.title = val;
                    if (val) filters.title = val;
                    else delete filters.title;
                    syncFilterBadge();
                    board?.setFilters(filters);
                    refresh();
                }
            });
            el('projects-view-content')?.addEventListener('input', (event) => {
                const ganttFilterField = event.target.dataset?.ganttFilter;
                if (ganttFilterField) {
                    filterDrafts[ganttFilterField] = event.target.value;
                    const form = el('projects-view-filters');
                    const control = form?.elements?.namedItem(ganttFilterField);
                    if (control) control.value = event.target.value;
                }
            });
            el('projects-view-content')?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && event.target.dataset?.ganttFilter === 'title') {
                    event.preventDefault();
                    const val = event.target.value;
                    if (val) filters.title = val;
                    else delete filters.title;
                    syncFilterBadge();
                    board?.setFilters(filters);
                    refresh();
                }
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
                if (event.target.id === 'projects-task-predecessors') renderPredecessorChips();
            });
            el('projects-task-planning')?.addEventListener('click', async (event) => {
                if (event.target.id === 'projects-task-predecessor-add' && canWrite()) {
                    const picker = el('projects-task-predecessor-picker');
                    const id = picker?.value;
                    if (id) {
                        const existing = el('projects-task-predecessors').value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
                        el('projects-task-predecessors').value = [...new Set([...existing, id])].join('\n');
                        if (picker) picker.value = '';
                        renderPredecessorChips();
                    }
                }
                const removeDepBtn = event.target.closest?.('[data-remove-predecessor]');
                if (removeDepBtn && canWrite() && !mutation) {
                    const removeId = removeDepBtn.dataset.removePredecessor;
                    const existing = (el('projects-task-predecessors')?.value || '').split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
                    if (el('projects-task-predecessors')) el('projects-task-predecessors').value = existing.filter((id) => id !== removeId).join('\n');
                    renderPredecessorChips();
                }
                if (event.target.dataset?.studentLink !== undefined) openStudentLink(Number(event.target.dataset.studentLink), false);
                if (event.target.id === 'projects-task-apply' && preview?.canApply && !mutation) { const token = preview.token, version = datesVersion; if (await mutate(`${base()}/schedule-apply`, { previewToken: token }, 'POST') && version === datesVersion) el('projects-task-preview').textContent = 'Preview applied.'; }
                if (event.target.dataset?.linkRemove !== undefined && !mutation) saveLinks(links.filter((_, i) => i !== Number(event.target.dataset.linkRemove)));
            });
        }
        return { init, setProject, setTask, refresh, invalidateAccess, syncBoard: fillFilters, getState: () => ({ projectId, actorUid, filters: { ...filters }, view, response, selectedTaskId: task?.id }) };
    }
    globalScope.CrmProjectsViews = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
