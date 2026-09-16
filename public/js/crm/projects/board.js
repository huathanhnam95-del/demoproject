(function (globalScope) {
    'use strict';

    const STATUS_KEYS = ['not_started', 'in_progress', 'blocked', 'done'];
    const STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
    const PRIORITY_KEYS = ['none', 'low', 'medium', 'high', 'urgent'];
    const PRIORITY_LABELS = { none: 'None', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
    let ROW_HEIGHT = 44;
    const OVERSCAN = 8;
    // Five hues, same count and same hash, so every section keeps the colour it
    // already has in production -- only the tone changes.
    const GROUP_COLORS = ['#4f52d9', '#0d8478', '#2470c9', '#a86a12', '#b83a6e'];
    const PJ_ICON = {
        flag: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.7 14.2V2.1"/><path d="M3.7 2.9h8.5l-1.8 2.7 1.8 2.7H3.7"/></svg>',
        folder: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.9 4.2a1.1 1.1 0 0 1 1.1-1.1h2.8l1.5 1.8h5.8a1.1 1.1 0 0 1 1.1 1.1v5.9a1.1 1.1 0 0 1-1.1 1.1H3a1.1 1.1 0 0 1-1.1-1.1z"/></svg>',
        copy: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8.3" height="8.3" rx="1.4"/><path d="M10.5 3.3A1.4 1.4 0 0 0 9.1 2H3.6a1.4 1.4 0 0 0-1.4 1.4V9a1.4 1.4 0 0 0 1.4 1.4"/></svg>',
        cog: '<svg class="crm-pj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5"/></svg>'
    };
    function groupColor(id) {
        let hash = 0;
        for (const character of String(id || '')) hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
        return GROUP_COLORS[hash % GROUP_COLORS.length];
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function cssEscape(val) {
        return (globalScope.CSS && typeof globalScope.CSS.escape === 'function')
            ? globalScope.CSS.escape(val)
            : String(val ?? '').replace(/["\\]/g, '\\$&');
    }

    function operationId(prefix) {
        const token = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return `crm-board-${prefix}-${token}`.slice(0, 120);
    }

    function asArray(value) { return Array.isArray(value) ? value : []; }
    function asText(value, fallback = '') { return value === null || value === undefined ? fallback : String(value); }
    function rankCompare(left, right) {
        const a = asText(left?.rank, '0/1');
        const b = asText(right?.rank, '0/1');
        try {
            const [an, ad] = a.split('/').map((part) => BigInt(part));
            const [bn, bd] = b.split('/').map((part) => BigInt(part));
            const comparison = an * bd < bn * ad ? -1 : (an * bd > bn * ad ? 1 : 0);
            return comparison || asText(left?.id).localeCompare(asText(right?.id));
        } catch (_) {
            return a.localeCompare(b) || asText(left?.id).localeCompare(asText(right?.id));
        }
    }

    function createController(deps = {}) {
        const elements = deps.elements || {};
        const controllerActorUid = String(deps.getCurrentUser?.()?.uid || '');
        const apiFetchJson = typeof deps.apiFetchJson === 'function' ? deps.apiFetchJson : null;
        const escape = deps.escapeHtml || escapeHtml;
        const showToast = typeof deps.showToast === 'function' ? deps.showToast : () => {};
        const adminMode = deps.adminMode === true;
        const selectProject = typeof deps.selectProject === 'function' ? deps.selectProject : async () => false;
        const refreshProjects = typeof deps.refreshProjects === 'function' ? deps.refreshProjects : async () => false;
        const stateModel = typeof globalScope.CrmProjectsBoardState?.createBoardState === 'function'
            ? globalScope.CrmProjectsBoardState.createBoardState()
            : null;
        let bound = false;
        let sharedFilters = {};
        let filterGeneration = 0;
        let projectEpoch = 0;
        let refreshSequence = 0;
        let activeLoad = null;
        let selection = { projects: [], selectedProjectId: '', selectedProject: null };
        let project = null;
        let membership = null;
        let authorityRevision = 0;
        let members = [];
        let sections = [];
        let columns = [];
        let tasks = new Map();
        let expanded = new Set();
        const collapsedSections = new Set();
        let loadedBranches = new Set();
        let branchCursors = new Map();
        let branchHasMore = new Map();
        let branchLoadChains = new Map();
        let drafts = new Map();
        let pending = new Map();
        const movePending = new Set();
        let selectedTaskId = '';
        let selectedTaskIds = [];
        let focusedRowId = '';
        let logicalRows = [];
        let lastError = null;
        let dragState = null;
        let dragExpandTimer = null;
        let dragHoverTaskId = '';
        let dragHoverTargetRowId = '';
        let dragAutoScrollTimer = null;
        let dragAutoScrollDirection = 0;
        let renderQueued = false;
        let taskMutationQueues = new Map();
        let draftVersions = new Map();
        const draftBases = new Map();
        let remoteObserver = null;
        let busy = false;
        let loadBusy = false;
        const columnMovesPending = new Set();
        const taskMovesPending = new Set();
        const refreshIntents = new Set();
        let latestRefreshIntent = null;
        let authorityPending = true;
        let sectionCreatePending = false;
        let taskCreateOperation = null;
        let columnEditor = null;
        const settingsDrafts = new Map();
        const recentlyExecutedOperations = new Set();
        function recordOperation(opId) {
            if (!opId) return;
            recentlyExecutedOperations.add(String(opId));
            if (recentlyExecutedOperations.size > 200) {
                const oldest = recentlyExecutedOperations.values().next().value;
                recentlyExecutedOperations.delete(oldest);
            }
        }

        function currentProjectId() { return String(selection.selectedProjectId || '').trim(); }
        function role() { return membership?.role || selection.selectedProject?.role || ''; }
        // Rendering a retained editor never grants mutation authority.
        function canRenderTaskEditor() { return !!project && String(project.id) === currentProjectId() && String(deps.getCurrentUser?.()?.uid || '') === controllerActorUid && (project.lifecycle || 'active') === 'active' && (role() === 'Owner' || role() === 'Editor'); }
        function refreshRequested() { return [...refreshIntents].some(scopeIsCurrent); }
        function canWrite() { return !authorityPending && String(deps.getCurrentUser?.()?.uid || '') === controllerActorUid && (project?.lifecycle || 'active') === 'active' && (role() === 'Owner' || role() === 'Editor'); }
        function canSchema() { return !authorityPending && String(deps.getCurrentUser?.()?.uid || '') === controllerActorUid && (project?.lifecycle || 'active') === 'active' && role() === 'Owner'; }
        function hasProject() { return !!currentProjectId() && !!project; }
        function captureScope() {
            return { uid: deps.getCurrentUser?.()?.uid || '', projectId: currentProjectId(), epoch: projectEpoch, stateToken: stateModel?.beginRefresh() || null };
        }
        function scopeIsCurrent(scope) {
            return !!scope && scope.uid === (deps.getCurrentUser?.()?.uid || '') && scope.projectId === currentProjectId() && scope.epoch === projectEpoch
                && (!scope.stateToken || stateModel?.isCurrent(scope.stateToken));
        }
        function taskFor(id) { return tasks.get(String(id || '')) || null; }
        function projectRevision() { return Number(project?.revision || 0); }
        function structureRevision() { return Number(boardRevision.structureRevision ?? project?.structureRevision ?? 0); }
        const boardRevision = { structureRevision: 0, schemaRevision: 0 };
        function scopedKey(projectId, id) { return JSON.stringify([String(projectId || ''), String(id || '')]); }
        function draftKey(taskId, field) { return JSON.stringify([currentProjectId(), String(taskId || ''), String(field || '')]); }
        function draftKeyFor(taskId, field) { return draftKey(taskId, field); }
        function pendingKey(taskId, projectId = currentProjectId(), epoch = projectEpoch) {
            return JSON.stringify([String(projectId || ''), Number(epoch) || 0, String(taskId || '')]);
        }
        function pendingKeyFor(scope, taskId) { return pendingKey(taskId, scope?.projectId, scope?.epoch); }
        function enqueueTaskMutation(taskId, operation) {
            const key = pendingKey(taskId);
            const previous = taskMutationQueues.get(key) || Promise.resolve();
            const run = previous.catch(() => {}).then(operation);
            taskMutationQueues.set(key, run);
            run.then(() => { if (taskMutationQueues.get(key) === run) taskMutationQueues.delete(key); }, () => { if (taskMutationQueues.get(key) === run) taskMutationQueues.delete(key); });
            return run;
        }
        function queueEntriesFor(projectId, epoch, taskId = null) {
            const entries = [];
            for (const [key, promise] of taskMutationQueues.entries()) {
                try {
                    const tuple = JSON.parse(key);
                    if (tuple[0] !== String(projectId || '') || Number(tuple[1]) !== Number(epoch)) continue;
                    if (taskId !== null && tuple[2] !== String(taskId)) continue;
                    entries.push(promise);
                } catch (_) { /* an obsolete queue key cannot block a refresh */ }
            }
            return entries;
        }
        async function waitForProjectTaskQueues(projectId, epoch) {
            let entries = queueEntriesFor(projectId, epoch);
            while (entries.length) {
                await Promise.all(entries.map((promise) => Promise.resolve(promise).catch(() => {})));
                entries = queueEntriesFor(projectId, epoch);
            }
        }
        async function waitForTaskQueue(scope, taskId) {
            const entries = queueEntriesFor(scope?.projectId, scope?.epoch, taskId);
            if (entries.length) await Promise.all(entries.map((promise) => Promise.resolve(promise).catch(() => {})));
        }

        function setStatus(message, kind = 'muted') {
            lastError = kind === 'error' ? message : null;
            if (!elements.projectsBoardStatus) return;
            elements.projectsBoardStatus.textContent = message || '';
            elements.projectsBoardStatus.classList.toggle('crm-projects-board-error-text', kind === 'error');
        }

        function syncSectionForm() {
            const owner = canSchema();
            const disabled = busy || !owner || sectionCreatePending;
            if (elements.projectsBoardSectionName) elements.projectsBoardSectionName.disabled = disabled;
            if (elements.projectsBoardSaveSection) elements.projectsBoardSaveSection.disabled = disabled;
            if (elements.projectsBoardCancelSection) elements.projectsBoardCancelSection.disabled = sectionCreatePending;
            if (elements.projectsBoardAddSection) elements.projectsBoardAddSection.disabled = disabled;
        }

        function normalizedInsertionIndex(index, siblingCount) {
            if (!Number.isSafeInteger(index) || index < 0) return null;
            return Math.min(index, Math.max(0, siblingCount));
        }

        function sourceExcludedInsertionIndex(rows, sourceId) {
            const currentIndex = rows.findIndex((entry) => String(entry.id) === String(sourceId));
            return currentIndex < 0 ? null : Math.min(currentIndex, Math.max(0, rows.length - 1));
        }

        function resetSectionForm() {
            if (elements.projectsBoardSectionForm) elements.projectsBoardSectionForm.hidden = true;
            if (elements.projectsBoardSectionName) elements.projectsBoardSectionName.value = '';
            syncSectionForm();
        }

        function openSectionForm() {
            if (!canSchema() || busy || sectionCreatePending) return;
            if (elements.projectsBoardSectionForm) elements.projectsBoardSectionForm.hidden = false;
            if (elements.projectsBoardSectionName) {
                elements.projectsBoardSectionName.value = '';
                elements.projectsBoardSectionName.focus();
            }
            syncSectionForm();
        }

        function closeSectionForm() {
            if (sectionCreatePending) return;
            resetSectionForm();
        }

        function selectableTask(task) {
            return !!task && !task.contextOnly && (task.effectiveLifecycle || task.lifecycle || 'active') === 'active';
        }
        function setSelectedTaskIds(ids) {
            if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim())) throw new TypeError('Task selection requires task IDs.');
            const unique = [...new Set(ids.map(id => id.trim()))];
            if (unique.length > 20) throw new RangeError('Select at most 20 tasks.');
            const currentActor = String(deps.getCurrentUser?.()?.uid || '');
            const next = hasProject() && String(project.id) === currentProjectId() && (project.lifecycle || 'active') === 'active' && currentActor === controllerActorUid ? unique.filter(id => selectableTask(tasks.get(id))) : [];
            if (JSON.stringify(next) === JSON.stringify(selectedTaskIds)) return next.slice();
            selectedTaskIds = next;
            stateModel?.setSelectedTaskIds?.(next);
            renderVirtualRows();
            renderBatchDock();
            deps.onContextChanged?.(contextSnapshot());
            return next.slice();
        }
        function toggleSelection(taskId) {
            if (!selectableTask(tasks.get(taskId))) return;
            if (!selectedTaskIds.includes(taskId) && selectedTaskIds.length >= 20) { setStatus('Select at most 20 tasks.', 'error'); return; }
            setSelectedTaskIds(selectedTaskIds.includes(taskId) ? selectedTaskIds.filter(id => id !== taskId) : [...selectedTaskIds, taskId]);
        }
        function renderBatchDock() {
            const dock = document.getElementById('projects-batch-dock');
            if (!dock) return;
            const count = selectedTaskIds.length;
            dock.hidden = count === 0;
            const countEl = document.getElementById('projects-batch-count');
            if (countEl) countEl.innerHTML = `<span class="crm-batch-badge">${count}</span><span>${count === 1 ? 'Task' : 'Tasks'} selected</span>`;
            const sectionSelect = document.getElementById('projects-batch-section');
            if (sectionSelect) {
                const currentVal = sectionSelect.value;
                const opts = '<option value="">Move to section…</option>' +
                    sections.map((s) => `<option value="${escape(s.id)}">${escape(s.title || 'Section')}</option>`).join('');
                if (sectionSelect.innerHTML !== opts) {
                    sectionSelect.innerHTML = opts;
                    if (currentVal) sectionSelect.value = currentVal;
                }
            }
        }
        async function executeBatchStatus(newStatus) {
            if (!newStatus || !selectedTaskIds.length || !canWrite()) return;
            const mutationScope = captureScope();
            const taskIdsToUpdate = [...selectedTaskIds];
            setBusy(true);
            try {
                await requestMutation(`/api/projects/${encodeURIComponent(mutationScope.projectId)}/tasks/bulk`, {
                    operationId: operationId('batch-status'),
                    taskIds: taskIdsToUpdate,
                    patch: { status: newStatus }
                });
                taskIdsToUpdate.forEach((id) => {
                    const t = taskFor(id);
                    if (t) tasks.set(id, { ...t, status: newStatus });
                });
                showToast(`Updated status for ${taskIdsToUpdate.length} task${taskIdsToUpdate.length === 1 ? '' : 's'}.`, 'success');
                renderBoard();
            } catch (err) {
                showToast(err?.message || 'Batch status update failed.', 'error');
            } finally {
                setBusy(false);
                const statusSelect = document.getElementById('projects-batch-status');
                if (statusSelect) statusSelect.value = '';
            }
        }
        async function executeBatchSection(targetSectionId) {
            if (!targetSectionId || !selectedTaskIds.length || !canWrite()) return;
            const mutationScope = captureScope();
            let resolvedTargetId = optimisticSectionIdMap.get(targetSectionId) || targetSectionId;
            if (String(resolvedTargetId).startsWith('opt-sec-') || sections.some(s => s.id === resolvedTargetId && s.isOptimistic)) {
                await sectionCreateQueue;
                if (!scopeIsCurrent(mutationScope)) return;
                resolvedTargetId = optimisticSectionIdMap.get(targetSectionId) || targetSectionId;
            }
            const taskIdsToMove = [...selectedTaskIds];
            setBusy(true);
            try {
                for (const id of taskIdsToMove) {
                    const t = taskFor(id);
                    if (t && (t.effectiveSectionId || t.sectionId) !== resolvedTargetId) {
                        await requestMutation(`/api/projects/${encodeURIComponent(mutationScope.projectId)}/tasks/${encodeURIComponent(id)}/move`, {
                            operationId: operationId(`batch-move-${id}`),
                            expectedRevision: t.revision,
                            expectedStructureRevision: structureRevision(),
                            parentTaskId: null,
                            sectionId: resolvedTargetId,
                            index: rootsForSection(resolvedTargetId).length
                        });
                    }
                }
                showToast(`Moved ${taskIdsToMove.length} task${taskIdsToMove.length === 1 ? '' : 's'} to section.`, 'success');
                await loadProject(mutationScope.projectId, { preserve: true });
            } catch (err) {
                showToast(err?.message || 'Batch section move failed.', 'error');
            } finally {
                setBusy(false);
                const sectionSelect = document.getElementById('projects-batch-section');
                if (sectionSelect) sectionSelect.value = '';
            }
        }
        async function executeBatchDelete() {
            if (!selectedTaskIds.length || !canWrite()) return;
            if (!window.confirm(`Archive ${selectedTaskIds.length} selected task${selectedTaskIds.length === 1 ? '' : 's'}?`)) return;
            const mutationScope = captureScope();
            const taskIdsToArchive = [...selectedTaskIds];
            setBusy(true);
            try {
                await requestMutation(`/api/projects/${encodeURIComponent(mutationScope.projectId)}/tasks/bulk`, {
                    operationId: operationId('batch-archive'),
                    taskIds: taskIdsToArchive,
                    patch: { lifecycle: 'archived' }
                });
                taskIdsToArchive.forEach((id) => tasks.delete(id));
                selectedTaskIds = [];
                renderBatchDock();
                showToast(`Archived ${taskIdsToArchive.length} task${taskIdsToArchive.length === 1 ? '' : 's'}.`, 'success');
                renderBoard();
            } catch (err) {
                showToast(err?.message || 'Batch archive failed.', 'error');
            } finally {
                setBusy(false);
            }
        }
        function contextSnapshot() {
            if (String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid) { if (project || tasks.size) invalidateAccess(currentProjectId()); resetColumnForm(); selectedTaskIds = []; stateModel?.setSelectedTaskIds?.([]); }
            return { project, actorUid: controllerActorUid, authorityPending, authorizationReady: !authorityPending && hasProject() && !refreshRequested(), filterOptionsReady: !!project && !busy && !authorityPending, authorityRevision, membership, members: members.slice(), sections: sections.slice(), columns: columns.slice(), tasks: new Map(tasks), selectedTaskId, selectedTaskIds: selectedTaskIds.slice() };
        }

        function syncTaskCreation() {
            const pending = !!taskCreateOperation && scopeIsCurrent(taskCreateOperation.scope);
            const button = elements.projectsBoardAddTask;
            if (!button) return;
            button.disabled = busy || !canWrite() || pending;
            button.textContent = pending ? 'Creating…' : 'New task';
            button.setAttribute('aria-busy', String(pending));
        }

        function setBusy(value) {
            loadBusy = value === true;
            busy = loadBusy || [...columnMovesPending, ...taskMovesPending, ...refreshIntents].some(scopeIsCurrent);
            if (elements.projectsBoardSection) elements.projectsBoardSection.setAttribute('aria-busy', busy ? 'true' : 'false');
            if (elements.projectsBoardProjectSelect) elements.projectsBoardProjectSelect.disabled = !selection.projects.length;
            if (elements.projectsBoardRefresh) elements.projectsBoardRefresh.disabled = busy;
            syncTaskCreation();
            if (!loadBusy) {
                const skeleton = document.getElementById('projects-board-initial-loading');
                if (skeleton) skeleton.hidden = true;
            }
            if (elements.projectsBoardAddSection) elements.projectsBoardAddSection.disabled = busy || !canSchema();
            if (elements.projectsBoardAddColumn) elements.projectsBoardAddColumn.disabled = busy || !canSchema();
            if (elements.projectsBoardSaveSettings) elements.projectsBoardSaveSettings.disabled = busy || !canSchema();
            if (elements.projectsBoardTableWrap) elements.projectsBoardTableWrap.classList.toggle('is-loading', busy);
            syncSectionForm();
            if (columnEditor && (!scopeIsCurrent(columnEditor.scope) || (!busy && !canSchema()))) resetColumnForm();
            syncColumnForm();
            deps.onContextChanged?.(contextSnapshot());
        }

        function snapshotView() {
            const scrollTop = elements.projectsBoardScroll?.scrollTop || 0;
            const scrollLeft = elements.projectsBoardScroll?.scrollLeft || 0;
            const active = document.activeElement;
            const row = active?.closest?.('[data-row-id]');
            const taskRow = active?.closest?.('[data-task-id]');
            const sectionRow = active?.closest?.('[data-section-id]');
            return {
                scrollTop,
                scrollLeft,
                externalFocus: !!active && active !== document.body && !row && !taskRow && !sectionRow && !Object.entries(elements).some(([name, element]) => name.startsWith('projectsBoard') && element && (element === active || element.contains?.(active))),
                activeId: row?.dataset?.rowId || focusedRowId,
                controlId: active?.id || '',
                taskId: taskRow?.dataset?.taskId || '',
                sectionId: sectionRow?.dataset?.sectionId || '',
                fieldKind: active?.dataset?.fieldKind || '',
                selectionControl: active?.dataset?.action === 'select-task',
                columnId: active?.dataset?.columnId || '',
                selectionStart: typeof active?.selectionStart === 'number' ? active.selectionStart : null,
                selectionEnd: typeof active?.selectionEnd === 'number' ? active.selectionEnd : null,
                selectionDirection: active?.selectionDirection || 'none'
            };
        }

        function restoreView(view) {
            if (!view) return;
            const safeCss = (val) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
                ? CSS.escape(val)
                : (typeof cssEscape === 'function' ? cssEscape(val) : String(val ?? '').replace(/["\\]/g, '\\$&'));
            if (elements.projectsBoardScroll) elements.projectsBoardScroll.scrollTop = view.scrollTop || 0;
            if (elements.projectsBoardScroll) elements.projectsBoardScroll.scrollLeft = view.scrollLeft || 0;
            if (view.externalFocus) return;
            let target = view.controlId ? document.getElementById(view.controlId) : null;
            if (!target && view.taskId && view.selectionControl) {
                target = elements.projectsBoardRows?.querySelector(`[data-task-id="${safeCss(view.taskId)}"] [data-action="select-task"]`) || null;
            }
            if (!target && view.taskId && view.fieldKind) {
                const row = elements.projectsBoardRows?.querySelector(`[data-task-id="${safeCss(view.taskId)}"]`);
                target = row?.querySelector(`[data-field-kind="${safeCss(view.fieldKind)}"]${view.columnId ? `[data-column-id="${safeCss(view.columnId)}"]` : ''}`) || null;
            }
            if (!target && view.sectionId && view.fieldKind) {
                const row = elements.projectsBoardRows?.querySelector(`[data-section-id="${safeCss(view.sectionId)}"]`);
                target = row?.querySelector(`[data-field-kind="${safeCss(view.fieldKind)}"]`) || null;
            }
            if (target) {
                target.focus?.();
                if (view.selectionStart !== null && typeof target.setSelectionRange === 'function') {
                    try { target.setSelectionRange(view.selectionStart, view.selectionEnd ?? view.selectionStart, view.selectionDirection || 'none'); } catch (_) { /* select range is optional */ }
                }
                return;
            }
            if (view.activeId) elements.projectsBoardRows?.querySelector(`[data-row-id="${safeCss(view.activeId)}"]`)?.focus?.();
        }

        function invalidateAccess(deniedProjectId, notifyViews = true) {
            if (String(deniedProjectId || '') !== currentProjectId()) return;
            closePeoplePicker(); closeStatusPicker();
            remoteObserver?.stop(); draftBases.clear();
            projectEpoch++; refreshSequence++; authorityPending = true;
            stateModel?.switchProject('');
            selection = { projects: selection.projects.filter((entry) => String(entry.id) !== String(deniedProjectId)), selectedProjectId: '', selectedProject: null };
            project = null; membership = null; members = []; sections = []; columns = []; tasks = new Map();
            selectedTaskId = ''; selectedTaskIds = []; focusedRowId = ''; logicalRows = [];
            expanded.clear(); collapsedSections.clear(); loadedBranches.clear(); branchCursors.clear(); branchHasMore.clear(); branchLoadChains.clear();
            drafts.clear(); draftVersions.clear(); settingsDrafts.clear(); pending.clear(); movePending.clear();
            optimisticIdMap.clear(); optimisticSectionIdMap.clear(); recentlyExecutedOperations.clear();
            taskCreateQueue = Promise.resolve(); sectionCreateQueue = Promise.resolve();
            boardRevision.structureRevision = 0; boardRevision.schemaRevision = 0;
            clearDragInteraction(); resetSectionForm(); resetColumnForm(); setBusy(false); renderProjectPicker();
            for (const name of ['projectsBoardRows', 'projectsBoardHeader', 'projectsBoardDetailBody', 'projectsBoardDetailTitle', 'projectsBoardCount']) {
                if (elements[name]) { elements[name].innerHTML = ''; elements[name].textContent = ''; }
            }
            for (const name of ['projectsBoardSettingsName', 'projectsBoardSettingsDescription', 'projectsBoardStatusNotStarted', 'projectsBoardStatusInProgress', 'projectsBoardStatusBlocked', 'projectsBoardStatusDone']) {
                if (elements[name]) { elements[name].value = ''; elements[name].disabled = true; }
            }
            if (elements.projectsBoardWorkspace) elements.projectsBoardWorkspace.hidden = true;
            if (elements.projectsBoardDetail) elements.projectsBoardDetail.hidden = true;
            globalScope.CrmProjectsRecovery?.setSelection(null);
            globalScope.CrmProjectsDiscussion?.setSelection(null);
            deps.onTaskSelection?.(null);
            if (notifyViews) globalScope.projectsViewsController?.invalidateAccess?.(deniedProjectId, false);
            deps.onProjectAccessDenied?.(deniedProjectId);
            setStatus('Project access is no longer available. Select an authorized project.', 'error');
        }

        function setProjects(nextSelection = {}) {
            const nextProjects = asArray(nextSelection.projects);
            const nextId = String(Object.prototype.hasOwnProperty.call(nextSelection, 'selectedProjectId') ? (nextSelection.selectedProjectId || '') : (nextProjects[0]?.id || '')).trim();
            const changed = nextId !== currentProjectId();
            if (changed) {
                closePeoplePicker(); closeStatusPicker();
                remoteObserver?.stop(); draftBases.clear();
                selectedTaskIds = [];
                sharedFilters = {};
                globalScope.CrmProjectsRecovery?.setSelection(null);
                globalScope.CrmProjectsDiscussion?.setSelection(null);
                projectEpoch += 1;
                authorityPending = true;
                stateModel?.switchProject(nextId);
                resetSectionForm(); resetColumnForm();
                optimisticIdMap.clear(); optimisticSectionIdMap.clear(); recentlyExecutedOperations.clear();
                taskCreateQueue = Promise.resolve(); sectionCreateQueue = Promise.resolve();
            }
            selection = {
                projects: nextProjects,
                selectedProjectId: nextId,
                selectedProject: nextSelection.selectedProject || nextProjects.find((entry) => String(entry.id) === nextId) || null
            };
            if (columnEditor && selection.selectedProject?.role && selection.selectedProject.role !== 'Owner') resetColumnForm();
            renderProjectPicker();
            if (!nextId) {
                globalScope.CrmProjectsRecovery?.setSelection(null);
                globalScope.CrmProjectsDiscussion?.setSelection(null);
                refreshSequence += 1;
                setBusy(false);
                project = null;
                membership = null; members = []; sections = []; columns = []; tasks = new Map();
                selectedTaskId = ''; selectedTaskIds = []; focusedRowId = ''; logicalRows = [];
                expanded.clear(); collapsedSections.clear(); loadedBranches.clear(); branchCursors.clear(); branchHasMore.clear();
                drafts.clear(); draftVersions.clear(); settingsDrafts.clear();
                for (const name of ['projectsBoardRows', 'projectsBoardHeader', 'projectsBoardDetailBody', 'projectsBoardDetailTitle', 'projectsBoardCount']) {
                    if (elements[name]) { elements[name].innerHTML = ''; elements[name].textContent = ''; }
                }
                renderDetail(); resetSectionForm();
                renderEmptyState();
                deps.onContextChanged?.(contextSnapshot());
                return;
            }
            if (changed || !project) loadProject(nextId);
        }

        function renderProjectPicker() {
            const picker = elements.projectsBoardProjectSelect;
            if (!picker) return;
            picker.innerHTML = selection.projects.length
                ? selection.projects.map((entry) => `<option value="${escape(entry.id)}">${escape(entry.name || entry.title || entry.id)}</option>`).join('')
                : '<option value="">No projects available</option>';
            picker.value = currentProjectId();
            picker.disabled = !selection.projects.length;
        }

        function renderEmptyState() {
            if (elements.projectsBoardWorkspace) elements.projectsBoardWorkspace.hidden = true;
            if (elements.projectsBoardEmpty) elements.projectsBoardEmpty.hidden = selection.projects.length > 0;
            setStatus(selection.projects.length ? 'Choose a project to load its tasks.' : 'No project memberships are available.');
        }

        function queryPath(projectId, parentTaskId = null, cursor = null, queryFilters = sharedFilters) {
            const filters = parentTaskId
                ? { ...queryFilters, parentTaskId, parentScope: 'direct' }
                : { ...queryFilters, parentScope: 'root' };
            const params = new URLSearchParams({ pageSize: '200', filters: JSON.stringify(filters), sort: JSON.stringify({ field: 'rank', direction: 'asc' }) });
            params.set('includeAncestorContext', 'true');
            if (cursor) params.set('cursor', cursor);
            return `/api/projects/${encodeURIComponent(projectId)}/tasks?${params.toString()}`;
        }

        async function fetchBranch(projectId, parentTaskId = null, loadSequence = refreshSequence, cursor = null) {
            if (!apiFetchJson) return null;
            const key = parentTaskId || '__root__';
            const scope = captureScope();
            const queryGeneration = filterGeneration, queryFilters = { ...sharedFilters };
            const response = await apiFetchJson(queryPath(projectId, parentTaskId, cursor, queryFilters));
            if (queryGeneration !== filterGeneration || loadSequence !== refreshSequence || projectId !== currentProjectId() || !scopeIsCurrent(scope) || scope.uid !== controllerActorUid) return null;
            asArray(response?.tasks).forEach((task) => tasks.set(String(task.id), { ...task }));
            if (Array.isArray(response?.sections)) sections = response.sections.slice().sort(rankCompare);
            if (Array.isArray(response?.columns)) columns = response.columns.slice().sort(rankCompare);
            boardRevision.structureRevision = Number(response?.revision?.structureRevision ?? boardRevision.structureRevision);
            boardRevision.schemaRevision = Number(response?.revision?.schemaRevision ?? boardRevision.schemaRevision);
            loadedBranches.add(key);
            branchCursors.set(key, response?.nextCursor || null);
            branchHasMore.set(key, !!response?.nextCursor);
            return response;
        }

        async function loadBranch(parentTaskId = null, { append = false, render = true, fenced = false } = {}) {
            const projectId = currentProjectId();
            if (!projectId || busy) return false;
            if (remoteObserver && !fenced) return remoteObserver.snapshot(projectId, () => loadBranch(parentTaskId, { append, render, fenced: true }));
            const loadSequence = refreshSequence;
            const key = parentTaskId || '__root__';
            const cursor = append ? branchCursors.get(key) : null;
            if (append && !cursor) return false;
            try {
                const response = await fetchBranch(projectId, parentTaskId, loadSequence, cursor);
                if (!response || loadSequence !== refreshSequence) return false;
                if (render) renderBoard();
                return true;
            } catch (error) {
                if (loadSequence === refreshSequence) {
                    if ([401, 403, 404].includes(Number(error?.status))) invalidateAccess(projectId);
                    else setStatus(error?.message || 'Tasks could not be loaded.', 'error');
                }
                return false;
            }
        }

        async function loadAllBranch(parentTaskId = null, { render = true, fenced = false } = {}) {
            const key = parentTaskId || '__root__';
            const queryGeneration = filterGeneration;
            const chainKey = JSON.stringify([currentProjectId(), projectEpoch, refreshSequence, queryGeneration, key, fenced]);
            const existing = branchLoadChains.get(chainKey);
            if (existing) {
                const result = await existing;
                if (render && result) renderBoard();
                return result;
            }
            const chain = (async () => {
                if (!await loadBranch(parentTaskId, { render, fenced }) || queryGeneration !== filterGeneration) return false;
                while (branchHasMore.get(key) === true) {
                    if (queryGeneration !== filterGeneration || !await loadBranch(parentTaskId, { append: true, render, fenced }) || queryGeneration !== filterGeneration) return false;
                }
                return true;
            })();
            branchLoadChains.set(chainKey, chain);
            try {
                return await chain;
            } finally {
                if (branchLoadChains.get(chainKey) === chain) branchLoadChains.delete(chainKey);
            }
        }

        async function loadProject(projectId, options = {}) {
            const normalized = String(projectId || '').trim();
            // Capture filter intent before either observer or active-load queues.
            const entryFilterGeneration = options.filterGeneration ?? filterGeneration;
            const requestOptions = { ...options, filterGeneration: entryFilterGeneration, filterSnapshot: { ...(options.filterSnapshot || sharedFilters) } };
            if (remoteObserver && !options.fenced) return remoteObserver.snapshot(normalized, () => loadProject(normalized, { ...requestOptions, fenced: true }));
            const entryEpoch = projectEpoch;
            const entryIsCurrent = () => normalized === currentProjectId() && entryEpoch === projectEpoch && entryFilterGeneration === filterGeneration;
            if (!normalized || !entryIsCurrent()) return false;
            const prior = activeLoad && activeLoad.projectId === normalized ? activeLoad.promise : null;
            if (prior) await prior;
            if (!entryIsCurrent()) return false;
            const promise = loadProjectInternal(normalized, { ...requestOptions, expectedEpoch: entryEpoch });
            const record = { projectId: normalized, promise };
            activeLoad = record;
            try {
                return await promise;
            } finally {
                if (activeLoad === record) activeLoad = null;
            }
        }

        async function loadProjectInternal(projectId, options = {}) {
            const normalized = String(projectId || '').trim();
            const expectedEpoch = Number.isInteger(options.expectedEpoch) ? options.expectedEpoch : projectEpoch;
            const actorUid = String(deps.getCurrentUser?.()?.uid || '');
            const expectedFilterGeneration = options.filterGeneration ?? filterGeneration;
            const loadFilters = { ...(options.filterSnapshot || sharedFilters) };
            const loadIsCurrent = () => normalized === currentProjectId() && expectedEpoch === projectEpoch && expectedFilterGeneration === filterGeneration
                && actorUid === controllerActorUid && actorUid === String(deps.getCurrentUser?.()?.uid || '');
            if (!normalized || !apiFetchJson || !loadIsCurrent()) return false;
            const preserve = options.preserve === true && String(project?.id || '') === normalized;
            if (!preserve) {
                drafts = new Map(); settingsDrafts.clear(); expanded = new Set(); collapsedSections.clear();
                selectedTaskId = ''; selectedTaskIds = []; stateModel?.setSelectedTaskIds?.([]); focusedRowId = '';
                project = null; membership = null; members = []; sections = []; columns = []; tasks = new Map();
                loadedBranches = new Set(); branchCursors = new Map(); branchHasMore = new Map();
                boardRevision.structureRevision = 0; boardRevision.schemaRevision = 0;
            }
            const loadSequence = ++refreshSequence;
            if (preserve) {
                await waitForProjectTaskQueues(normalized, expectedEpoch);
                if (loadSequence !== refreshSequence || !loadIsCurrent()) return false;
            }
            const stateToken = stateModel?.beginRefresh();
            const current = () => {
                if (loadSequence === refreshSequence && normalized === currentProjectId() && actorUid !== String(deps.getCurrentUser?.()?.uid || '')) invalidateAccess(normalized);
                return loadSequence === refreshSequence && loadIsCurrent() && (!stateToken || stateModel.isCurrent(stateToken));
            };
            // Retain a selectable read model while a separate fresh snapshot loads.
            // Cached membership never authorizes writes during or after a failed refresh.
            authorityPending = true;
            setBusy(true);
            if (preserve) { renderBoard(); setStatus('Refreshing project board…'); }
            else {
                if (elements.projectsBoardWorkspace) elements.projectsBoardWorkspace.hidden = true;
                if (elements.projectsBoardEmpty) elements.projectsBoardEmpty.hidden = true;
                const skeleton = document.getElementById('projects-board-initial-loading');
                if (skeleton) skeleton.hidden = false;
                setStatus('Loading project board…');
            }
            let successMessage = null;
            let publishView = null;
            const read = async (url) => {
                try { return await apiFetchJson(url); }
                catch (error) {
                    if (current() && [401, 403, 404].includes(Number(error?.status))) invalidateAccess(normalized);
                    throw error;
                }
            };
            try {
                const [projectResponse, memberResponse] = await Promise.all([
                    read(`/api/projects/${encodeURIComponent(normalized)}`),
                    read(`/api/projects/${encodeURIComponent(normalized)}/member-directory`)
                ]);
                if (!current()) return false;
                const nextProject = projectResponse?.project;
                const nextMembership = projectResponse?.membership;
                if (String(nextProject?.id || '') !== normalized || !['Owner', 'Editor', 'Viewer'].includes(nextMembership?.role)) {
                    invalidateAccess(normalized); return false;
                }
                // Publish a downgrade immediately, even while the task GET is held.
                const previousRole = role();
                membership = nextMembership;
                if (previousRole !== nextMembership.role) renderBoard();
                if ((nextProject.lifecycle || 'active') !== 'active') setSelectedTaskIds([]);
                const nextTasks = new Map(), nextLoaded = new Set(), nextCursors = new Map(), nextMore = new Map();
                let nextSections = [], nextColumns = [];
                let nextStructure = Number(nextProject.structureRevision || 0), nextSchema = Number(nextProject.schemaRevision || 0);
                const readBranch = async (parentTaskId = null) => {
                    let cursor = null;
                    do {
                        const response = await read(queryPath(normalized, parentTaskId, cursor, loadFilters));
                        if (!current()) return false;
                        asArray(response?.tasks).forEach(task => nextTasks.set(String(task.id), { ...task }));
                        if (Array.isArray(response?.sections)) nextSections = response.sections.slice().sort(rankCompare);
                        if (Array.isArray(response?.columns)) nextColumns = response.columns.slice().sort(rankCompare);
                        nextStructure = Number(response?.revision?.structureRevision ?? nextStructure);
                        nextSchema = Number(response?.revision?.schemaRevision ?? nextSchema);
                        cursor = response?.nextCursor || null;
                    } while (cursor);
                    const key = parentTaskId || '__root__';
                    nextLoaded.add(key); nextCursors.set(key, null); nextMore.set(key, false);
                    return true;
                };
                if ((nextProject.lifecycle || 'active') === 'active') {
                    if (!await readBranch()) return false;
                    // Consult current expansion so user actions during the refresh survive.
                    let pendingExpansion = true;
                    while (pendingExpansion) {
                        pendingExpansion = false;
                        for (const id of expanded) {
                            if (!nextTasks.has(id) || nextLoaded.has(id)) continue;
                            if (!await readBranch(id)) return false;
                            pendingExpansion = true;
                        }
                    }
                }
                if (!current()) return false;
                publishView = preserve ? snapshotView() : null;
                // An absent task is only known removed when its parent branch was
                // fully reloaded without filters. Unloaded descendants retain intent.
                const previousTasks = tasks;
                const removed = new Set(Object.keys(loadFilters).length ? [] : [...previousTasks]
                    .filter(([id, task]) => nextLoaded.has(task.parentTaskId || '__root__') && !nextTasks.has(id)).map(([id]) => id));
                expanded = new Set([...expanded].filter(id => {
                    const seen = new Set();
                    for (let ancestor = id; ancestor && !seen.has(ancestor); ancestor = previousTasks.get(ancestor)?.parentTaskId) {
                        if (removed.has(ancestor)) return false;
                        seen.add(ancestor);
                    }
                    return true;
                }));
                project = nextProject; membership = nextMembership; members = asArray(memberResponse?.people);
                tasks = nextTasks; sections = nextSections; columns = nextColumns;
                loadedBranches = nextLoaded; branchCursors = nextCursors; branchHasMore = nextMore;
                boardRevision.structureRevision = nextStructure; boardRevision.schemaRevision = nextSchema;
                if (!tasks.has(selectedTaskId)) selectedTaskId = '';
                authorityPending = false;
                setSelectedTaskIds(selectedTaskIds);
                authorityRevision += 1;
                successMessage = (project.lifecycle || 'active') === 'active'
                    ? ''
                    : `Project is ${project.lifecycle}. Use project records and recovery to restore it.`;
                return true;
            } catch (error) {
                if (!current()) return false;
                setStatus(error?.message || 'Project board could not be refreshed.', 'error');
                return false;
            } finally {
                if (current()) {
                    const view = publishView || (preserve ? snapshotView() : null);
                    setBusy(false);
                    if (project) { renderBoard(); restoreView(view); }
                    if (successMessage !== null) setStatus(successMessage);
                }
            }
        }
        function resolveEffectiveSectionId(taskId) {
            let current = taskFor(taskId);
            const seen = new Set();
            while (current && !seen.has(current.id)) {
                seen.add(current.id);
                if (current.effectiveSectionId) return current.effectiveSectionId;
                if (current.sectionId) return current.sectionId;
                if (!current.parentTaskId) break;
                current = taskFor(current.parentTaskId);
            }
            return sections[0]?.id || null;
        }

        function childrenOf(parentTaskId) {
            const parent = parentTaskId || null;
            return Array.from(tasks.values())
                .filter((task) => (task.parentTaskId || null) === parent && (task.effectiveLifecycle || task.lifecycle || 'active') === 'active')
                .sort(rankCompare);
        }

        let currentGroupBy = 'section';

        function activeGroups() {
            if (currentGroupBy === 'status') {
                return [
                    { id: 'not_started', title: 'Not Started', color: 'var(--st-ns-solid)' },
                    { id: 'in_progress', title: 'In Progress', color: 'var(--st-ip-solid)' },
                    { id: 'blocked', title: 'Blocked', color: 'var(--st-bl-solid)' },
                    { id: 'done', title: 'Done', color: 'var(--st-dn-solid)' }
                ];
            }
            if (currentGroupBy === 'ownerUid') {
                return members.map((m) => ({ id: m.uid, title: m.displayName || m.email || m.uid, color: groupColor(m.uid) })).concat([{ id: '__unassigned__', title: 'Unassigned', color: '#94a3b8' }]);
            }
            if (currentGroupBy === 'priority') {
                return [
                    { id: 'urgent', title: 'Urgent', color: 'var(--sig-over-fg)' },
                    { id: 'high', title: 'High', color: 'var(--st-ip-fg)' },
                    { id: 'medium', title: 'Medium', color: 'var(--pj-accent)' },
                    { id: 'low', title: 'Low', color: 'var(--pj-muted)' },
                    { id: 'none', title: 'None', color: 'var(--pj-faint)' }
                ];
            }
            return sections.map((s) => ({ ...s, color: groupColor(s.id) }));
        }

        function rootsForGroup(groupId) {
            const activeTasks = Array.from(tasks.values()).filter((task) => !task.parentTaskId && (task.effectiveLifecycle || task.lifecycle || 'active') === 'active');
            if (currentGroupBy === 'section') {
                return activeTasks.filter((task) => (task.effectiveSectionId || task.sectionId) === groupId).sort(rankCompare);
            }
            if (currentGroupBy === 'status') {
                return activeTasks.filter((task) => (task.status || 'not_started') === groupId).sort(rankCompare);
            }
            if (currentGroupBy === 'ownerUid') {
                return activeTasks.filter((task) => (groupId === '__unassigned__' ? !task.ownerUid : task.ownerUid === groupId)).sort(rankCompare);
            }
            if (currentGroupBy === 'priority') {
                return activeTasks.filter((task) => (task.values?.priority || task.priority || 'none') === groupId).sort(rankCompare);
            }
            return [];
        }

        function rootsForSection(sectionId) {
            return rootsForGroup(sectionId);
        }

        function hasPotentialChildren(task) {
            const key = String(task.id);
            if (childrenOf(key).length) return true;
            if (Number.isInteger(Number(task.activeChildCount))) return Number(task.activeChildCount) > 0;
            return !loadedBranches.has(key) || branchHasMore.get(key) === true;
        }

        function flattenRows() {
            const rows = [];
            const appendTask = (task, depth) => {
                rows.push({ kind: 'task', id: `task:${String(task.id)}`, task, depth });
                if (!expanded.has(String(task.id))) return;
                childrenOf(task.id).forEach((child) => appendTask(child, depth + 1));
            };
            const groups = activeGroups();
            groups.forEach((group) => {
                rows.push({ kind: 'section', id: `section:${group.id}`, section: group, depth: 0 });
                if (!collapsedSections.has(String(group.id))) {
                    const groupRoots = rootsForGroup(group.id);
                    groupRoots.forEach((task) => appendTask(task, 0));
                }
            });
            return rows;
        }

        function statusOptions(current, labels = {}) {
            return STATUS_KEYS.map((key) => `<option value="${key}"${current === key ? ' selected' : ''}>${escape(labels[key] || STATUS_LABELS[key])}</option>`).join('');
        }
        function statusPillMarkup(status, labels = {}, disabled = '', fieldKind = 'status', columnId = null) {
            const current = status || 'not_started';
            const labelText = labels[current] || STATUS_LABELS[current] || current;
            const ariaLabel = fieldKind === 'status' ? `Status: ${labelText}` : labelText;
            const colAttr = columnId ? ` data-column-id="${escape(columnId)}"` : '';
            return `<button type="button" class="crm-board-status-pill" data-action="pick-status"${colAttr} data-status="${escape(current)}" aria-haspopup="listbox" aria-label="${escape(ariaLabel)}"${disabled}><span class="crm-board-status-dot" aria-hidden="true"></span><span class="crm-board-status-text">${escape(labelText)}</span></button><select class="crm-board-field crm-board-status-select" data-field-kind="${escape(fieldKind)}"${colAttr} data-status="${escape(current)}" aria-label="${escape(ariaLabel)}"${disabled} tabindex="-1">${statusOptions(current, labels)}</select>`;
        }
        function priorityOptions(current) {
            return PRIORITY_KEYS.map((key) => `<option value="${key}"${current === key ? ' selected' : ''}>${escape(PRIORITY_LABELS[key])}</option>`).join('');
        }
        function memberOptions(current, multiple = false) {
            const selected = multiple ? new Set(asArray(current)) : new Set(current ? [current] : []);
            const options = [`<option value="">${multiple ? 'No additional assignees' : 'Unassigned'}</option>`];
            members.forEach((person) => {
                const uid = String(person.uid || '');
                if (!uid) return;
                options.push(`<option value="${escape(uid)}"${selected.has(uid) ? ' selected' : ''}>${escape(person.displayName || person.email || uid)}</option>`);
            });
            return options.join('');
        }
        function ownerInitials(uid) {
            const person = members.find((entry) => String(entry.uid) === String(uid));
            const parts = asText(person?.displayName || person?.email || uid).trim().split(/\s+/).filter(Boolean);
            return parts.length ? Array.from(parts[0])[0].toLocaleUpperCase() + (parts.length > 1 ? Array.from(parts[parts.length - 1])[0].toLocaleUpperCase() : '') : '—';
        }
        function derivedRing(task) {
            if (!task?.derived || !(Number(task.derived.activeLeafCount) > 0)) return '';
            const total = Number(task.derived.activeLeafCount) || 0;
            const done = Number(task.derived.completedLeafCount) || 0;
            const pct = Math.max(0, Math.min(100, Math.round(Number(task.derived.completionPercent ?? (total > 0 ? (done / total * 100) : 0))) || 0));
            return `<span class="crm-board-progress-ring" style="--pj-pct:${pct}%" title="${escape(done)}/${escape(total)} complete (${pct}%)" aria-label="${pct}% complete"></span>`;
        }
        function peopleStack(uids) {
            const list = asArray(uids).map(String).filter(Boolean);
            if (!list.length) return '';
            const shown = list.slice(0, 3);
            const overflow = list.length - shown.length;
            const avatars = shown.map((uid) => {
                const person = members.find((entry) => String(entry.uid) === String(uid));
                const name = person?.displayName || person?.email || uid;
                return `<span class="crm-board-avatar" title="${escape(name)}">${escape(ownerInitials(uid))}</span>`;
            }).join('');
            const more = overflow > 0 ? `<span class="crm-board-avatar crm-board-avatar-more">+${overflow}</span>` : '';
            return `<span class="crm-board-people-stack" aria-hidden="true">${avatars}${more}</span>`;
        }
        function relativeDue(dueDate) {
            if (!dueDate) return '';
            const due = new Date(dueDate + 'T00:00:00');
            if (Number.isNaN(due.getTime())) return '';
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
            if (diffDays < 0) return `${Math.abs(diffDays)}d late`;
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Tomorrow';
            if (diffDays <= 7) return `${diffDays}d`;
            return '';
        }
        function dueState(task) {
            if (!task?.dueDate || task.status === 'done') return 'none';
            const due = new Date(task.dueDate + 'T00:00:00');
            if (Number.isNaN(due.getTime())) return 'none';
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
            if (diffDays < 0) return 'overdue';
            if (diffDays <= 2) return 'soon';
            return 'normal';
        }
        function memberName(uid) {
            if (!uid) return '';
            const person = members.find((entry) => String(entry.uid) === String(uid));
            return asText(person?.displayName || person?.email || uid);
        }

        function taskGroupColor(task) {
            const root = asArray(task.pathIds).map((id) => taskFor(id)).find((entry) => entry && !entry.parentTaskId);
            return groupColor(task.effectiveSectionId || task.sectionId || root?.effectiveSectionId || root?.sectionId);
        }
        function computeWorkingDays(startDateStr, dueDateStr) {
            if (!startDateStr || !dueDateStr) return null;
            const start = new Date(startDateStr + 'T00:00:00');
            const end = new Date(dueDateStr + 'T00:00:00');
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;
            let count = 0;
            const cur = new Date(start);
            while (cur <= end) {
                const day = cur.getDay();
                if (day !== 0 && day !== 6) count++;
                cur.setDate(cur.getDate() + 1);
            }
            return count;
        }
        function statusBatteryBar(task) {
            const battery = task?.derived?.statusBattery;
            if (!battery || !battery.total || battery.total <= 1) return '';
            const total = battery.total;
            const donePct = Math.round((battery.done / total) * 100);
            const inProgressPct = Math.round((battery.in_progress / total) * 100);
            const blockedPct = Math.round((battery.blocked / total) * 100);
            const notStartedPct = Math.max(0, 100 - donePct - inProgressPct - blockedPct);
            const title = `Subitems: ${battery.done} Done, ${battery.in_progress} In Progress, ${battery.blocked} Blocked, ${battery.not_started} Not Started (${total} total)`;
            return `<div class="crm-board-status-battery" title="${escape(title)}" aria-label="${escape(title)}">` +
                (donePct > 0 ? `<span class="crm-battery-segment is-done" style="width:${donePct}%"></span>` : '') +
                (inProgressPct > 0 ? `<span class="crm-battery-segment is-in-progress" style="width:${inProgressPct}%"></span>` : '') +
                (blockedPct > 0 ? `<span class="crm-battery-segment is-blocked" style="width:${blockedPct}%"></span>` : '') +
                (notStartedPct > 0 ? `<span class="crm-battery-segment is-not-started" style="width:${notStartedPct}%"></span>` : '') +
                `</div>`;
        }
        function customCell(task, column) {
            const raw = task.values?.[column.id] ?? null;
            const draftKey = draftKeyFor(task.id, `value:${column.id}`);
            const value = drafts.has(draftKey) ? drafts.get(draftKey) : raw;
            const disabled = canWrite() && !busy && !movePending.has(pendingKey(task.id)) ? '' : ' disabled';
            const label = escape(column.label || column.id);
            const unavailable = column.type === 'dropdown' && value && !asArray(column.options).some(option => option.key === value);
            const rollup = column.type === 'number' && task.derived?.columnSums?.[column.id] && task.derived.activeLeafCount > 1 ? task.derived.columnSums[column.id] : null;
            const sumBadge = rollup ? `<span class="crm-board-sum-badge" title="Sum: ${rollup.sum} (Avg: ${rollup.average}, Count: ${rollup.count})">&Sigma; ${rollup.sum}</span>` : '';
            if (!canRenderTaskEditor()) return `${sumBadge}<span class="crm-board-null">${escape(unavailable ? `${value} (unavailable)` : value === null || value === undefined || value === '' ? '—' : (Array.isArray(value) ? value.join(', ') : value))}</span>`;
            if (column.type === 'status') return statusPillMarkup(value, column.statusLabels || {}, disabled, 'value', column.id);
            if (column.type === 'priority') return `<select class="crm-board-field" data-field-kind="value" data-column-id="${escape(column.id)}" data-value="${escape(value || 'none')}" aria-label="${label}"${disabled}>${priorityOptions(value || 'none')}</select>`;
            if (column.type === 'dropdown') return `<select class="crm-board-field" data-field-kind="value" data-column-id="${escape(column.id)}" aria-label="${label}"${disabled}><option value="">Clear</option>${unavailable ? `<option value="${escape(value)}" selected disabled>${escape(value)} (unavailable)</option>` : ''}${asArray(column.options).map((option) => `<option value="${escape(option.key)}"${value === option.key ? ' selected' : ''}>${escape(option.label || option.key)}</option>`).join('')}</select>`;
            if (column.type === 'people') return `<select multiple class="crm-board-field crm-board-people-field" data-field-kind="value" data-column-id="${escape(column.id)}" aria-label="${label}"${disabled}>${memberOptions(value, true)}</select>`;
            const inputType = column.type === 'number' ? 'number' : (column.type === 'date' ? 'date' : 'text');
            const inputValue = Array.isArray(value) ? value.join(', ') : (value ?? '');
            const inputState = (authorityPending || busy) && canRenderTaskEditor() ? ' readonly' : disabled;
            return `${sumBadge}<input class="crm-board-field" data-field-kind="value" data-column-id="${escape(column.id)}" type="${inputType}" value="${escape(inputValue)}" aria-label="${label}"${inputState}>`;
        }

        function dateControl(kind, value, disabled) {
            const label = kind === 'startDate' ? 'Start date' : 'Due date';
            const text = value ? new Date(value + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' }) : (kind === 'startDate' ? 'Set start' : 'Set due');
            return `<span class="crm-board-date-control"><input class="crm-board-field" data-field-kind="${kind}" type="date" value="${escape(value)}" aria-label="${label}" tabindex="-1"${disabled}><button type="button" class="crm-board-date-trigger" data-action="pick-date" aria-haspopup="dialog" aria-label="${label}: ${escape(value || 'not set')}"${disabled}>${escape(text)}</button></span>`;
        }

        function taskRowMarkup(row) {
            const task = row.task;
            const selected = String(task.id) === String(selectedTaskId);
            const isPending = pending.has(pendingKey(task.id)) || movePending.has(pendingKey(task.id));
            const disabled = canWrite() && !busy && !movePending.has(pendingKey(task.id)) ? '' : ' disabled';
            const titleDraft = drafts.get(draftKeyFor(task.id, 'title'));
            const title = titleDraft === undefined ? asText(task.title, 'Untitled task') : titleDraft;
            const ownerDraft = drafts.get(draftKeyFor(task.id, 'ownerUid'));
            const ownerUid = ownerDraft === undefined ? (task.ownerUid || '') : ownerDraft;
            const assigneeDraft = drafts.get(draftKeyFor(task.id, 'assigneeUids'));
            const assignees = assigneeDraft === undefined ? asArray(task.assigneeUids) : assigneeDraft;
            const startDateKey = draftKeyFor(task.id, 'startDate');
            const dueDateKey = draftKeyFor(task.id, 'dueDate');
            const startDate = drafts.has(startDateKey) ? drafts.get(startDateKey) : (task.startDate || '');
            const dueDate = drafts.has(dueDateKey) ? drafts.get(dueDateKey) : (task.dueDate || '');
            const depth = Math.min(4, Math.max(0, Number(row.depth) || 0));
            const indent = depth * 22;
            const treeElbow = depth > 0 ? '<span class="crm-board-tree-elbow" aria-hidden="true"></span>' : '';
            const depthChip = depth > 0 ? `<span class="crm-board-depth-chip" title="Subtask Level ${depth}">L${depth}</span>` : '';
            const status = drafts.get(draftKeyFor(task.id, 'status')) ?? task.status ?? 'not_started';
            const hasKids = hasPotentialChildren(task);
            const isExp = expanded.has(String(task.id));
            const expander = hasKids
                ? `<button type="button" class="crm-board-expander" data-action="toggle-task" aria-label="${isExp ? 'Collapse' : 'Expand'} ${escape(title)}" aria-expanded="${isExp ? 'true' : 'false'}">${isExp ? '▾' : '▸'}</button>`
                : `<button type="button" class="crm-board-expander is-leaf" data-action="add-subtask" aria-label="Add subtask to ${escape(title)}" title="Add subtask (Ctrl+N)">▸</button>`;
            const selectionCheckbox = selectableTask(task) ? `<input type="checkbox" data-action="select-task" aria-label="Select ${escape(title)}"${selectedTaskIds.includes(String(task.id)) ? ' checked' : ''}>` : '';
            const inputState = (authorityPending || busy) && canRenderTaskEditor() ? ' readonly' : disabled;
            const titleCell = canRenderTaskEditor()
                ? `<input class="crm-board-title-input crm-board-field" data-field-kind="title" type="text" value="${escape(title)}" aria-label="Task title"${inputState}>`
                : `<span class="crm-board-title-text">${escape(title)}</span>`;
            const dState = dueState(task);
            const relDue = relativeDue(dueDate);
            const dueBadge = relDue && dState !== 'none' && dState !== 'normal' ? `<span class="crm-board-due-badge crm-board-due-${dState}">${escape(relDue)}</span>` : '';
            const workingDays = computeWorkingDays(startDate, dueDate);
            // Two date inputs plus two badges do not fit a 238px cell. The due state is
            // the actionable signal, so duration yields to it and stays available as a title.
            const durationBadge = workingDays !== null && !dueBadge ? `<span class="crm-board-duration-badge" title="${workingDays} working days">${workingDays}d</span>` : '';
            const optClass = task.isOptimistic ? ' is-optimistic' : '';
            return `<div class="crm-projects-board-row${selected ? ' is-selected' : ''}${isPending ? ' is-pending' : ''}${optClass}" role="row" tabindex="0"${canWrite() ? ' aria-keyshortcuts="Alt+ArrowRight Alt+ArrowLeft" aria-description="Alt+Right indents; Alt+Left outdents. Tab navigates controls."' : ''} draggable="${canWrite() && !busy && !movePending.has(pendingKey(task.id)) ? 'true' : 'false'}" data-row-kind="task" data-row-id="${escape(row.id)}" data-task-id="${escape(task.id)}" data-depth="${depth}" aria-selected="${selected ? 'true' : 'false'}" style="top:${row.index * ROW_HEIGHT}px;height:${ROW_HEIGHT}px;--crm-project-group-color:${taskGroupColor(task)}">
              <div class="crm-projects-board-cell crm-projects-board-task-title" role="cell" style="padding-left:${10 + indent}px">${treeElbow}${depthChip}${task.contextOnly ? '<span class="crm-projects-context">Context</span>' : ''}${selectionCheckbox}${expander}<button type="button" class="crm-board-drag-handle" data-action="drag-handle" aria-label="Move ${escape(title)}">⠿</button>${derivedRing(task)}${titleCell}<button type="button" class="crm-board-add-subtask" data-action="add-subtask" title="Add subtask (Ctrl+N)" aria-label="Add subtask to ${escape(title)}"${disabled}>+</button><button type="button" class="crm-board-detail-button" data-action="open-detail" aria-label="Open details and discussion for ${escape(title)}">&#8599;</button></div>
              <div class="crm-projects-board-cell crm-board-status-cell" role="cell" data-status="${escape(status)}">${statusBatteryBar(task)}${statusPillMarkup(status, project?.statusLabels || {}, disabled, 'status')}</div>
              <div class="crm-projects-board-cell crm-board-owner-cell" role="cell"><button type="button" class="crm-people-trigger" data-action="pick-people" data-people-kind="ownerUid" aria-haspopup="listbox" aria-label="Change accountable owner for ${escape(title)}"${disabled}><span class="crm-board-owner-avatar" aria-hidden="true">${escape(ownerInitials(ownerUid))}</span><span class="crm-people-trigger-name">${escape(memberName(ownerUid) || 'Assign')}</span></button><select class="crm-board-field" data-field-kind="ownerUid" aria-label="Accountable owner"${disabled}>${memberOptions(ownerUid)}</select></div>
              <div class="crm-projects-board-cell crm-board-assignees-cell" role="cell"><button type="button" class="crm-people-trigger is-stack" data-action="pick-people" data-people-kind="assigneeUids" aria-haspopup="listbox" aria-label="Change assignees for ${escape(title)}"${disabled}>${peopleStack(assignees) || '<span class="crm-people-trigger-name">Assign</span>'}</button><select multiple class="crm-board-field crm-board-people-field" data-field-kind="assigneeUids" aria-label="Additional assignees"${disabled}>${memberOptions(assignees, true)}</select></div>
              <div class="crm-projects-board-cell crm-board-date-cell" role="cell" data-due-state="${dState}">${dueBadge}${durationBadge}${dateControl('startDate', startDate, disabled)}${dateControl('dueDate', dueDate, disabled)}</div>
              ${columns.map((column) => `<div class="crm-projects-board-cell" role="cell">${customCell(task, column)}</div>`).join('')}
            </div>`;
        }

        function sectionRowMarkup(row) {
            const section = row.section;
            const titleDraft = drafts.get(draftKey(section.id, 'title'));
            const title = titleDraft !== undefined ? titleDraft : asText(section.title, 'Section');
            const editable = canSchema() && !busy
                ? `<input class="crm-board-section-input crm-board-field" data-field-kind="section-title" type="text" value="${escape(title)}" aria-label="Section title">`
                : `<span class="crm-board-group-title">${escape(title)}</span>`;
            return `<div class="crm-projects-board-section-row" role="row" tabindex="0" draggable="${canSchema() && !busy ? 'true' : 'false'}" data-row-kind="section" data-row-id="${escape(row.id)}" data-section-id="${escape(section.id)}" style="top:${row.index * ROW_HEIGHT}px;height:${ROW_HEIGHT}px;--crm-project-group-color:${groupColor(section.id)}"><div role="cell"><button type="button" class="crm-board-group-expander" data-action="toggle-section" aria-expanded="${collapsedSections.has(String(section.id)) ? 'false' : 'true'}" aria-label="${collapsedSections.has(String(section.id)) ? 'Expand' : 'Collapse'} group ${escape(title)}">${collapsedSections.has(String(section.id)) ? '&#9656;' : '&#9662;'}</button><span class="crm-board-drag-handle" aria-hidden="true">⠿</span>${editable}</div><div role="cell"><span class="crm-muted">${rootsForSection(section.id).length} root task${rootsForSection(section.id).length === 1 ? '' : 's'}</span></div></div>`;
        }

        function sectionSummaryRowMarkup(row) {
            const groupTasks = Array.from(tasks.values()).filter((t) => {
                if ((t.effectiveLifecycle || t.lifecycle || 'active') !== 'active') return false;
                if (currentGroupBy === 'status') return (t.status || 'not_started') === row.sectionId;
                if (currentGroupBy === 'ownerUid') return (row.sectionId === '__unassigned__' ? !t.ownerUid : t.ownerUid === row.sectionId);
                if (currentGroupBy === 'priority') return (t.values?.priority || t.priority || 'none') === row.sectionId;
                return (t.effectiveSectionId || t.sectionId) === row.sectionId;
            });
            const totalCount = groupTasks.length;
            const doneCount = groupTasks.filter(t => t.status === 'done').length;
            const owners = new Set(groupTasks.map(t => t.ownerUid).filter(Boolean));
            const numericSums = {};
            columns.forEach(col => {
                if (col.type === 'number') {
                    let sum = 0;
                    let hasAny = false;
                    groupTasks.forEach(t => {
                        const val = t.values?.[col.id];
                        if (typeof val === 'number' && !Number.isNaN(val)) {
                            sum += val;
                            hasAny = true;
                        }
                    });
                    if (hasAny) numericSums[col.id] = Math.round(sum * 100) / 100;
                }
            });
            return `<div class="crm-projects-board-row crm-board-summary-row" role="row" tabindex="-1" data-row-kind="summary" data-row-id="${escape(row.id)}" data-section-id="${escape(row.sectionId)}" style="top:${row.index * ROW_HEIGHT}px;height:${ROW_HEIGHT}px;--crm-project-group-color:${groupColor(row.sectionId)}">
              <div class="crm-projects-board-cell crm-board-summary-title" role="cell"><span class="crm-board-summary-tag">SUMMARY</span> <span class="crm-muted">${totalCount} task${totalCount === 1 ? '' : 's'}</span></div>
              <div class="crm-projects-board-cell crm-board-summary-cell" role="cell"><span class="crm-board-summary-stat">${doneCount}/${totalCount} done (${totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%)</span></div>
              <div class="crm-projects-board-cell crm-board-summary-cell" role="cell"><span class="crm-board-summary-stat">${owners.size} owner${owners.size === 1 ? '' : 's'}</span></div>
              <div class="crm-projects-board-cell crm-board-summary-cell" role="cell"></div>
              <div class="crm-projects-board-cell crm-board-summary-cell" role="cell"></div>
              ${columns.map((col) => `<div class="crm-projects-board-cell crm-board-summary-cell" role="cell">${numericSums[col.id] !== undefined ? `<span class="crm-board-sum-badge">&Sigma; ${numericSums[col.id]}</span>` : ''}</div>`).join('')}
            </div>`;
        }

        function renderHeader() {
            if (!elements.projectsBoardHeader) return;
            const base = ['Task', 'Status', 'Accountable owner', 'Assignees', 'Dates'];
            const gridTemplate = [
                'minmax(300px, 2.8fr)',
                'minmax(126px, .85fr)',
                'minmax(146px, 1fr)',
                'minmax(124px, .95fr)',
                'minmax(200px, 1fr)',
                ...columns.map(() => 'minmax(130px, 1fr)')
            ].join(' ');
            elements.projectsBoardTable?.style.setProperty('--crm-project-grid-template', gridTemplate);
            elements.projectsBoardTable?.style.setProperty('--crm-project-column-count', String(columns.length));
            const minimumWidth = 300 + 126 + 146 + 124 + 200 + (columns.length * 130);
            if (elements.projectsBoardTable) elements.projectsBoardTable.style.minWidth = `${minimumWidth}px`;
            elements.projectsBoardHeader.innerHTML = base.concat(columns.map((column) => column.label || column.id)).map((label, index) => `<div role="columnheader"${index >= 5 && canSchema() ? ' class="crm-projects-board-column-editable"' : ''}${index >= 5 && canSchema() && !busy ? ` draggable="true" data-column-id="${escape(columns[index - 5].id)}"` : ''}><span class="crm-projects-board-column-label" title="${escape(label)}">${escape(label)}</span>${index >= 5 && canSchema() ? `<button type="button" data-action="edit-column" data-column-id="${escape(columns[index - 5].id)}" aria-label="Edit column ${escape(label)}"${busy ? ' disabled' : ''}>Edit column</button>` : ''}</div>`).join('');
        }

        function rowMarkup(row) {
            if (row.kind === 'section') return sectionRowMarkup(row);
            if (row.kind === 'summary') return sectionSummaryRowMarkup(row);
            return taskRowMarkup(row);
        }

        function createRowNode(row) {
            const template = document.createElement('template');
            template.innerHTML = rowMarkup(row).trim();
            return template.content.firstElementChild;
        }

        function taskFieldValue(task, control) {
            if (!task || !control) return null;
            const kind = control.dataset.fieldKind;
            if (kind === 'value') return task.values?.[control.dataset.columnId] ?? null;
            return task[kind] ?? null;
        }

        function syncFocusedControl(node, row) {
            const active = document.activeElement;
            if (row.kind !== 'task' || !active || !node.contains(active) || !active.classList.contains('crm-board-field')) return;
            const kind = active.dataset.fieldKind === 'value' ? `value:${active.dataset.columnId}` : active.dataset.fieldKind;
            if (drafts.has(draftKeyFor(row.task.id, kind))) return;
            const nextValue = taskFieldValue(row.task, active);
            if (active.multiple) {
                const selected = new Set(asArray(nextValue).map((value) => String(value)));
                Array.from(active.options).forEach((option) => { option.selected = selected.has(String(option.value)); });
                return;
            }
            const normalized = nextValue === null || nextValue === undefined ? '' : String(nextValue);
            if (active.value === normalized) return;
            const start = typeof active.selectionStart === 'number' ? active.selectionStart : null;
            const end = typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
            active.value = normalized;
            if (start !== null && typeof active.setSelectionRange === 'function') {
                try { active.setSelectionRange(Math.min(start, normalized.length), Math.min(end ?? start, normalized.length)); } catch (_) { /* selection is optional */ }
            }
        }

        function canPreserveFocusedEditor(currentCell, freshCell, activeElement) {
            if (!activeElement || !currentCell || !freshCell || !currentCell.contains(activeElement)) return false;
            const currentControl = activeElement.closest?.('.crm-board-field');
            const freshControl = freshCell.querySelector?.('.crm-board-field');
            if (!currentControl || !freshControl || currentControl.disabled || freshControl.disabled) return false;
            const compatible = currentControl.tagName === freshControl.tagName
                && currentControl.type === freshControl.type
                && (currentControl.dataset.fieldKind || '') === (freshControl.dataset.fieldKind || '')
                && (currentControl.dataset.columnId || '') === (freshControl.dataset.columnId || '');
            if (compatible && currentControl.tagName === 'INPUT') currentControl.readOnly = freshControl.readOnly;
            return compatible;
        }

        function syncRowMetadata(node, fresh) {
            const transientClasses = ['is-drop-target', 'is-drop-parent', 'is-dragging']
                .filter((className) => node.classList.contains(className));
            node.className = fresh.className;
            transientClasses.forEach((className) => node.classList.add(className));
            ['role', 'tabindex', 'draggable', 'aria-selected', 'data-row-kind', 'data-row-id', 'data-task-id', 'data-section-id'].forEach((attribute) => {
                if (fresh.hasAttribute(attribute)) node.setAttribute(attribute, fresh.getAttribute(attribute));
                else node.removeAttribute(attribute);
            });
        }

        function syncSelectionCheckbox(node, fresh) {
            const current = node.querySelector('[data-action="select-task"]');
            const next = fresh.querySelector('[data-action="select-task"]');
            if (current && !next) current.remove();
            else if (!current && next) node.querySelector('.crm-projects-board-task-title')?.prepend(next.cloneNode(true));
            else if (current && next) { current.checked = next.checked; current.setAttribute('aria-label', next.getAttribute('aria-label')); }
        }
        function syncFocusedSelectionCell(cell, freshCell, checkbox, action = 'select-task') {
            const nextCheckbox = freshCell?.querySelector(`[data-action="${action}"]`);
            if (!cell || !nextCheckbox || !cell.contains(checkbox)) return false;
            // Keep the focused action attached. Refresh its surroundings so
            // current permissions and remote titles never retain stale editors.
            for (const child of Array.from(cell.childNodes)) if (child !== checkbox) child.remove();
            for (const attribute of Array.from(cell.attributes)) if (!freshCell.hasAttribute(attribute.name)) cell.removeAttribute(attribute.name);
            for (const attribute of Array.from(freshCell.attributes)) cell.setAttribute(attribute.name, attribute.value);
            let beforeCheckbox = true;
            for (const child of Array.from(freshCell.childNodes)) {
                if (child === nextCheckbox) { beforeCheckbox = false; continue; }
                if (beforeCheckbox) cell.insertBefore(child, checkbox);
                else cell.appendChild(child);
            }
            return true;
        }

        function syncPinnedExpander(node, fresh) {
            const current = node.querySelector('.crm-board-expander');
            const next = fresh.querySelector('.crm-board-expander');
            if (!current && !next) return;
            if (!current && next) {
                const titleCell = node.querySelector('.crm-projects-board-task-title');
                const dragHandle = titleCell?.querySelector('[data-action="drag-handle"]');
                if (dragHandle) titleCell.insertBefore(next.cloneNode(true), dragHandle);
                else titleCell?.prepend(next.cloneNode(true));
                return;
            }
            if (current && !next) {
                current.remove();
                return;
            }
            if (current.tagName !== next.tagName) {
                current.replaceWith(next.cloneNode(true));
                return;
            }
            ['type', 'data-action', 'aria-label', 'aria-expanded', 'title'].forEach((attribute) => {
                if (next.hasAttribute(attribute)) current.setAttribute(attribute, next.getAttribute(attribute));
                else current.removeAttribute(attribute);
            });
            current.className = next.className;
            current.textContent = next.textContent;
        }

        function dragSourceRowId() {
            if (!dragState || (dragState.kind !== 'task' && dragState.kind !== 'section')) return '';
            return `${dragState.kind}:${String(dragState.id || '')}`;
        }

        function updateExistingRow(node, row, activeElement, interactionPinned = false) {
            node.style.top = `${row.index * ROW_HEIGHT}px`;
            node.style.height = `${ROW_HEIGHT}px`;
            const fresh = createRowNode(row);
            if (!fresh) return;
            syncRowMetadata(node, fresh);
            node.style.setProperty('--crm-project-group-color', row.kind === 'section' ? groupColor(row.section.id) : (row.kind === 'summary' ? groupColor(row.sectionId) : taskGroupColor(row.task)));
            // Refresh decoration without replacing a focused native editor.
            for (const selector of ['.crm-board-status-cell', '[data-field-kind="status"]', '.crm-board-status-pill']) {
                const current = node.querySelector(selector), next = fresh.querySelector(selector);
                if (current && next) {
                    current.setAttribute('data-status', next.getAttribute('data-status'));
                    if (selector === '.crm-board-status-pill') {
                        const nextText = next.querySelector('.crm-board-status-text')?.textContent;
                        const currentText = current.querySelector('.crm-board-status-text');
                        if (currentText && nextText) currentText.textContent = nextText;
                        if (next.getAttribute('aria-label')) current.setAttribute('aria-label', next.getAttribute('aria-label'));
                    }
                }
            }
            const avatar = node.querySelector('.crm-board-owner-avatar');
            if (avatar) avatar.textContent = fresh.querySelector('.crm-board-owner-avatar')?.textContent || '—';
            syncSelectionCheckbox(node, fresh);
            if (interactionPinned && activeElement?.dataset?.action !== 'select-task') {
                syncPinnedExpander(node, fresh);
                return;
            }
            const focusedCell = (activeElement?.classList?.contains('crm-board-field') || ['select-task', 'toggle-section', 'open-detail', 'pick-status', 'pick-people'].includes(activeElement?.dataset?.action))
                ? activeElement.closest?.('[role="cell"]')
                : null;
            const cells = Array.from(node.children);
            const freshCells = Array.from(fresh.children || []);
            const cellCount = Math.max(cells.length, freshCells.length);
            for (let index = 0; index < cellCount; index += 1) {
                const cell = cells[index];
                const freshCell = freshCells[index];
                if (cell && cell === focusedCell && ['toggle-section', 'open-detail', 'pick-status', 'pick-people'].includes(activeElement?.dataset?.action)) {
                    const action = activeElement.dataset.action;
                    const next = freshCell?.querySelector(`[data-action="${action}"]`);
                    if (next) {
                        if (action === 'toggle-section') activeElement.setAttribute('aria-expanded', next.getAttribute('aria-expanded'));
                        activeElement.setAttribute('aria-label', next.getAttribute('aria-label'));
                        if (action === 'pick-status') {
                            activeElement.setAttribute('data-status', next.getAttribute('data-status') || '');
                            const curText = activeElement.querySelector('.crm-board-status-text');
                            const nxtText = next.querySelector('.crm-board-status-text');
                            if (curText && nxtText) curText.textContent = nxtText.textContent;
                        } else {
                            activeElement.textContent = next.textContent;
                        }
                        if (syncFocusedSelectionCell(cell, freshCell, activeElement, action)) continue;
                    }
                }
                if (cell && cell === focusedCell && activeElement?.dataset?.action === 'select-task' && syncFocusedSelectionCell(cell, freshCell, activeElement)) continue;
                if (cell && cell === focusedCell && canPreserveFocusedEditor(cell, freshCell, activeElement)) continue;
                if (cell && freshCell) cell.replaceWith(freshCell);
                else if (freshCell) node.appendChild(freshCell);
                else if (cell) cell.remove();
            }
            syncFocusedControl(node, row);
        }

        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('pointerdown', (event) => {
                if (peoplePopover && !peoplePopover.contains(event.target) && !event.target.closest?.('[data-action="pick-people"]')) {
                    closePeoplePicker();
                }
                if (statusPopover && !statusPopover.contains(event.target) && !event.target.closest?.('[data-action="pick-status"]')) {
                    closeStatusPicker();
                }
            }, true);
        }

        function renderVirtualRows({ viewportOnly = false, focusRowId = '' } = {}) {
            if (!elements.projectsBoardRows || !elements.projectsBoardScroll) return;
            // Scroll only changes which current rows are mounted. Data, schema,
            // permissions and selection always use the default full render.
            if (!viewportOnly) {
                logicalRows = flattenRows().map((row, index) => ({ ...row, index }));
                const totalHeight = logicalRows.length * ROW_HEIGHT;
                elements.projectsBoardRows.style.height = `${Math.max(totalHeight, ROW_HEIGHT)}px`;
                elements.projectsBoardTable?.setAttribute('aria-rowcount', String(logicalRows.length));
            }
            const scrollTop = elements.projectsBoardScroll.scrollTop || 0;
            const viewport = elements.projectsBoardScroll.clientHeight || 420;
            const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
            const last = Math.min(logicalRows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
            const visibleRows = logicalRows.slice(first, last);
            const activeElement = document.activeElement;
            const activeRow = activeElement?.closest?.('[data-row-id]');
            const activeRowId = activeRow?.dataset?.rowId || '';
            const sourceRowId = dragSourceRowId();
            const pinnedIds = new Set([activeRowId, sourceRowId, dragHoverTargetRowId, focusRowId].filter(Boolean));
            const pinnedRows = logicalRows.filter((row) => pinnedIds.has(String(row.id))
                && !visibleRows.some((visibleRow) => String(visibleRow.id) === String(row.id)));
            const desiredRows = visibleRows.concat(pinnedRows);
            if (!desiredRows.length) {
                elements.projectsBoardRows.innerHTML = '<div class="crm-projects-board-loading">No tasks yet. Add a task to begin.</div>';
                return;
            }
            const desiredIds = new Set(desiredRows.map((row) => String(row.id)));
            const existing = new Map(Array.from(elements.projectsBoardRows.children)
                .filter((node) => node.dataset?.rowId)
                .map((node) => [String(node.dataset.rowId), node]));
            Array.from(elements.projectsBoardRows.children).forEach((node) => {
                if (!node.dataset?.rowId || !desiredIds.has(String(node.dataset.rowId))) node.remove();
            });
            desiredRows.forEach((row) => {
                let node = existing.get(String(row.id));
                if (!node) {
                    node = createRowNode(row);
                    if (!node) return;
                    elements.projectsBoardRows.appendChild(node);
                } else if (!viewportOnly) {
                    const interactionPinned = String(row.id) === sourceRowId || String(row.id) === dragHoverTargetRowId;
                    updateExistingRow(node, row, activeElement, interactionPinned);
                    elements.projectsBoardRows.appendChild(node);
                }
                if (!node.dataset.crmFocusBound) {
                    node.dataset.crmFocusBound = 'true';
                    node.addEventListener('focus', () => { focusedRowId = node.dataset.rowId || ''; });
                }
            });
        }

        // The drawer used to be one long scroll that put dates, dependencies and
        // links ahead of the conversation. Updates is now the landing panel.
        function activateDetailTab(name) {
            const dialog = elements.projectsBoardDetail;
            if (!dialog || typeof dialog.querySelectorAll !== 'function') return;
            dialog.querySelectorAll('[data-detail-tab]').forEach((tab) => {
                const active = tab.dataset.detailTab === name;
                tab.setAttribute('aria-selected', String(active));
                tab.tabIndex = active ? 0 : -1;
            });
            dialog.querySelectorAll('[data-detail-panel]').forEach((panel) => {
                panel.hidden = panel.dataset.detailPanel !== name;
            });
        }

        function renderDetail() {
            const detail = elements.projectsBoardDetail;
            const task = taskFor(selectedTaskId);
            if (task && String(task.id) !== String(lastDetailTaskId)) {
                lastDetailTaskId = String(task.id);
                activateDetailTab('updates');
            }
            if (!detail || !task) {
                if (detail) detail.hidden = true;
                deps.onTaskSelection?.(null);
                const discussion = globalScope.CrmProjectsDiscussion;
                if (discussion && typeof discussion.setSelection === 'function') discussion.setSelection(null);
                return;
            }
            detail.hidden = false;
            deps.onTaskSelection?.(task);
            if (elements.projectsBoardDetailTitle) elements.projectsBoardDetailTitle.textContent = asText(task.title, 'Task details');
            const path = asArray(task.pathIds).map((id) => taskFor(id)?.title || id).join(' → ') || 'Root task';
            const lifecycle = task.effectiveLifecycle || task.lifecycle || 'active';
            const statusKey = task.status || 'not_started';
            const statusLabel = project?.statusLabels?.[statusKey] || STATUS_LABELS[statusKey] || statusKey;
            const ownerUid = task.ownerUid;
            const owner = asArray(members).find((m) => (m.uid || m.id) === ownerUid);
            const ownerName = owner?.displayName || owner?.name || (ownerUid ? 'Assigned' : '');
            const priorityVal = task.values?.priority || task.priority || '';
            const priorityMarkup = priorityVal && priorityVal !== 'none'
                ? `<span class="crm-detail-pill crm-pill-priority crm-prio-${escape(priorityVal)}" title="Priority: ${escape(priorityVal)}"><span class="crm-prio-flag">${PJ_ICON.flag}</span> <span>${escape(priorityVal.toUpperCase())}</span></span>`
                : '';
            const ownerMarkup = ownerUid
                ? `<span class="crm-detail-pill crm-pill-owner" title="Owner: ${escape(ownerName)}"><span class="crm-board-owner-avatar" aria-hidden="true">${escape(ownerInitials(ownerUid))}</span> <span>${escape(ownerName)}</span></span>`
                : '';
            if (elements.projectsBoardDetailBody) {
                elements.projectsBoardDetailBody.innerHTML = `<div class="crm-detail-property-bar"><div class="crm-detail-path-chip" title="Location: ${escape(path)}"><span class="crm-chip-icon">${PJ_ICON.folder}</span> <span class="crm-chip-text">${escape(path)}</span></div><div class="crm-detail-meta-pills"><span class="crm-detail-pill crm-pill-status" data-status="${escape(statusKey)}"><span class="crm-status-dot"></span> <span>${escape(statusLabel)}</span></span>${ownerMarkup}${priorityMarkup}<span class="crm-detail-pill crm-pill-lifecycle crm-lifecycle-${escape(lifecycle)}">${escape(lifecycle)}</span></div></div><details class="crm-detail-tech-drawer"><summary class="crm-detail-tech-summary"><span class="crm-tech-icon">${PJ_ICON.cog}</span> <span>Task info</span></summary><div class="crm-detail-tech-content"><button type="button" class="crm-detail-copy-id" data-copy-id="${escape(task.id)}" title="Click to copy Task ID" aria-label="Copy Task ID"><span class="crm-copy-icon">${PJ_ICON.copy}</span> <span class="crm-id-code">${escape(task.id)}</span> <span class="crm-copy-feedback" aria-live="polite">Copy ID</span></button><dl><dt>Task ID</dt><dd>${escape(task.id)}</dd></dl><dl><dt>Parent path</dt><dd>${escape(path)}</dd></dl><dl><dt>Revision</dt><dd>${escape(task.revision || 0)}</dd></dl><dl><dt>Lifecycle</dt><dd>${escape(lifecycle)}</dd></dl></div></details>`;
            }
            const discussion = globalScope.CrmProjectsDiscussion;
            if (discussion && typeof discussion.setSelection === 'function') discussion.setSelection({
                projectId: currentProjectId(),
                taskId: task.id,
                taskRevision: Number(task.revision || 0),
                role: role(),
                lifecycle: lifecycle
            });

        }

        function renderSettings() {
            const owner = canSchema();
            const nameKey = scopedKey(currentProjectId(), 'settings:name');
            const descriptionKey = scopedKey(currentProjectId(), 'settings:description');
            if (elements.projectsBoardSettingsName) { if (document.activeElement !== elements.projectsBoardSettingsName) elements.projectsBoardSettingsName.value = settingsDrafts.has(nameKey) ? settingsDrafts.get(nameKey) : asText(project?.name || project?.title); elements.projectsBoardSettingsName.disabled = busy || !owner; }
            if (elements.projectsBoardSettingsDescription) { if (document.activeElement !== elements.projectsBoardSettingsDescription) elements.projectsBoardSettingsDescription.value = settingsDrafts.has(descriptionKey) ? settingsDrafts.get(descriptionKey) : asText(project?.description); elements.projectsBoardSettingsDescription.disabled = busy || !owner; }
            const statusControls = { not_started: elements.projectsBoardStatusNotStarted, in_progress: elements.projectsBoardStatusInProgress, blocked: elements.projectsBoardStatusBlocked, done: elements.projectsBoardStatusDone };
            Object.entries(statusControls).forEach(([key, control]) => {
                if (!control) return;
                const draftKey = scopedKey(currentProjectId(), `settings:status:${key}`);
                if (document.activeElement !== control) control.value = settingsDrafts.has(draftKey) ? settingsDrafts.get(draftKey) : asText(project?.statusLabels?.[key] || STATUS_LABELS[key]);
                control.disabled = busy || !owner;
            });
            if (elements.projectsBoardSaveSettings) elements.projectsBoardSaveSettings.disabled = busy || !owner;
            if (elements.projectsBoardAddColumn) elements.projectsBoardAddColumn.disabled = busy || !owner;
        }

        function renderBoard({ focusRowId = '' } = {}) {
            deps.onContextChanged?.(contextSnapshot());
            if (!hasProject()) return;
            globalScope.CrmProjectsRecovery?.setSelection({ projectId: currentProjectId(), role: role(), lifecycle: project?.lifecycle || 'active' });
            if (elements.projectsBoardWorkspace) elements.projectsBoardWorkspace.hidden = (project?.lifecycle || 'active') !== 'active';
            if ((project?.lifecycle || 'active') !== 'active') { globalScope.CrmProjectsDiscussion?.setSelection(null); return; }
            if (elements.projectsBoardEmpty) elements.projectsBoardEmpty.hidden = true;
            renderHeader();
            renderVirtualRows({ focusRowId });
            renderDetail();
            renderSettings();
            syncSectionForm();
            renderBatchDock();
            if (elements.projectsBoardCount) elements.projectsBoardCount.textContent = `${tasks.size} loaded · ${sections.length} section${sections.length === 1 ? '' : 's'}`;
        }

        function queueRender() {
            if (renderQueued) return;
            renderQueued = true;
            requestAnimationFrame(() => { renderQueued = false; renderBoard(); });
        }

        async function requestMutation(path, payload, options = {}) {
            const body = { ...payload };
            if (payload?.operationId) recordOperation(payload.operationId);
            const retries = options.retries === undefined ? 1 : options.retries;
            let attempt = 0;
            let lastError = null;
            while (attempt <= retries) {
                try {
                    if ((authorityPending && path !== '/api/projects') || String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid) throw new Error('Refresh project access before making changes.');
                    return await apiFetchJson(path, { method: options.method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                } catch (error) {
                    lastError = error;
                    const uncertain = !error?.status && attempt < retries;
                    if (!uncertain) break;
                    attempt += 1;
                    await new Promise((resolve) => setTimeout(resolve, 180 * attempt));
                }
            }
            throw lastError || new Error('The Projects operation failed.');
        }

        function fieldValue(control) {
            if (!control || typeof control !== 'object') return control ?? null;
            if (control.multiple) return Array.from(control.selectedOptions || []).map((option) => option.value).filter(Boolean);
            if (control.type === 'number') return control.value === '' ? null : Number(control.value);
            return control.value === '' ? null : control.value;
        }

        async function saveTaskField(taskId, kind, control) {
            if (refreshRequested()) return;
            const ctrl = control && typeof control === 'object' && ('value' in control || control.nodeType) ? control : { value: control, dataset: {} };
            const value = fieldValue(ctrl);
            const mutationScope = captureScope();
            const mutationProjectId = mutationScope.projectId;
            const columnId = ctrl.dataset?.columnId;
            const key = kind === 'value' && columnId ? `value:${columnId}` : kind;
            const keyForDraft = draftKeyFor(taskId, key);
            if (!draftBases.has(keyForDraft)) draftBases.set(keyForDraft, Number(taskFor(taskId)?.revision || 0));
            const baseRevision = draftBases.get(keyForDraft);
            drafts.set(keyForDraft, value);
            const draftVersion = (draftVersions.get(keyForDraft) || 0) + 1;
            draftVersions.set(keyForDraft, draftVersion);
            const currentTask = taskFor(taskId);
            if (currentTask?.isOptimistic) {
                if (kind === 'value' && columnId) {
                    currentTask.values = { ...(currentTask.values || {}), [columnId]: value };
                } else {
                    currentTask[kind] = value;
                }
                return;
            }
            return enqueueTaskMutation(taskId, async (predecessor) => {
                if (!scopeIsCurrent(mutationScope)) return;
                const task = taskFor(taskId);
                if (!task || !canWrite()) return;
                // Only acknowledgments from this scoped local queue can advance a draft base.
                // A newer remotely observed task revision must still conflict and be reviewed.
                const followsLocal = predecessor?.bases?.includes(baseRevision) === true;
                const expectedRevision = followsLocal ? predecessor.revision : baseRevision;
                const patch = kind === 'value' && columnId ? { values: { [columnId]: value } } : { [kind]: value };
                const previous = { ...task, values: { ...(task.values || {}) } };
                const next = { ...task, ...patch, values: { ...(task.values || {}), ...(patch.values || {}) } };
                const opId = operationId(`edit-${taskId}`);
                const operationPendingKey = pendingKeyFor(mutationScope, taskId);
                tasks.set(taskId, next);
                pending.set(operationPendingKey, opId);
                const view = snapshotView();
                renderVirtualRows();
                try {
                    const response = await requestMutation(`/api/projects/${encodeURIComponent(mutationProjectId)}/tasks/${encodeURIComponent(taskId)}`, {
                        operationId: opId, expectedRevision, ...patch
                    }, { method: 'PATCH' });
                    if (!scopeIsCurrent(mutationScope)) return;
                    const saved = response?.task || response?.result?.task;
                    if (taskFor(taskId) && saved && Number(saved.revision) >= Number(taskFor(taskId).revision || 0)) tasks.set(taskId, { ...taskFor(taskId), ...saved });
                    if (draftVersions.get(keyForDraft) === draftVersion) {
                        drafts.delete(keyForDraft);
                        draftVersions.delete(keyForDraft);
                        draftBases.delete(keyForDraft);
                    }
                    let lineage;
                    if (saved && String(saved.id) === String(taskId) && Number.isSafeInteger(saved.revision) && saved.revision > expectedRevision) {
                        // Preserve newer unsent drafts, including other fields on this task,
                        // while advancing only bases covered by this exact local write.
                        for (const [draftKey, draftBase] of draftBases) {
                            const [draftProjectId, draftTaskId] = JSON.parse(draftKey);
                            if (draftProjectId === mutationProjectId && draftTaskId === String(taskId) && draftBase === expectedRevision) draftBases.set(draftKey, saved.revision);
                        }
                        lineage = { revision: saved.revision, bases: [...(followsLocal ? predecessor.bases : []), expectedRevision] };
                    }
                    setStatus('Task saved.');
                    deps.onTaskMutation?.();
                    return lineage;
                } catch (error) {
                    if (!scopeIsCurrent(mutationScope)) return;
                    if (tasks.get(taskId) === next) tasks.set(taskId, previous);
                    setStatus(error?.message || 'Task save failed. Your draft is retained.', 'error');
                    if (Number(error?.status) === 409 && elements.projectsBoardStatus) {
                        const review = document.createElement('button'); review.type = 'button'; review.className = 'crm-btn-secondary crm-btn-sm'; review.textContent = 'Review and retry'; review.dataset.remoteConflictReview = taskId;
                        review.addEventListener('click', async () => {
                            if (refreshRequested()) return;
                            review.disabled = true;
                            try {
                                const latest = await apiFetchJson(`/api/projects/${encodeURIComponent(mutationProjectId)}/tasks/${encodeURIComponent(taskId)}`);
                                if (!scopeIsCurrent(mutationScope) || refreshRequested() || !canWrite() || !latest?.task) return;
                                const observed = taskFor(taskId);
                                const reviewedTask = Number(observed?.revision || 0) > Number(latest.task.revision || 0) ? observed : latest.task;
                                const currentValue = kind === 'value' ? reviewedTask.values?.[control.dataset.columnId] : reviewedTask[kind];
                                if (!globalScope.confirm(`Current saved value: ${JSON.stringify(currentValue ?? '')}\n\nSave your retained draft instead?`)) return;
                                const retained = drafts.get(keyForDraft);
                                if (retained === undefined) return;
                                if (Number(reviewedTask.revision || 0) >= Number(taskFor(taskId)?.revision || 0)) tasks.set(taskId, { ...taskFor(taskId), ...reviewedTask });
                                draftBases.set(keyForDraft, reviewedTask.revision);
                                const retryControl = { dataset: { ...control.dataset }, value: retained, type: control.type, multiple: Array.isArray(retained), selectedOptions: Array.isArray(retained) ? retained.map(value => ({ value })) : [] };
                                await saveTaskField(taskId, kind, retryControl);
                            } catch (failure) { if (scopeIsCurrent(mutationScope)) setStatus(failure.message || 'Review failed. Your draft is retained.', 'error'); }
                            finally { review.disabled = false; }
                        });
                        elements.projectsBoardStatus.append(' ', review);
                    }
                } finally {
                    if (pending.get(operationPendingKey) === opId) pending.delete(operationPendingKey);
                    if (scopeIsCurrent(mutationScope)) {
                        renderBoard();
                        restoreView(view);
                    }
                }
            });
        }

        async function saveSection(sectionId, control) {
            if (refreshRequested()) return;
            if (!canSchema()) return;
            const mutationScope = captureScope();
            const mutationProjectId = mutationScope.projectId;
            let resolvedSectionId = optimisticSectionIdMap.get(sectionId) || sectionId;
            let section = sections.find((entry) => String(entry.id) === String(resolvedSectionId));
            const title = String(control?.value || '').trim();
            if (!section || !title || title === section.title) {
                if (section && control) control.value = section.title;
                drafts.delete(draftKey(resolvedSectionId, 'title'));
                draftBases.delete(draftKey(resolvedSectionId, 'title'));
                draftVersions.delete(draftKey(resolvedSectionId, 'title'));
                return;
            }
            if (section.isOptimistic) {
                await sectionCreateQueue;
                if (!scopeIsCurrent(mutationScope)) return;
                resolvedSectionId = optimisticSectionIdMap.get(sectionId) || sectionId;
                section = sections.find((entry) => String(entry.id) === String(resolvedSectionId));
                if (!section || !title || title === section.title) return;
            }
            const key = draftKey(resolvedSectionId, 'title');
            const draftVersion = draftVersions.get(key) || 0;
            try {
                const response = await requestMutation(`/api/projects/${encodeURIComponent(mutationProjectId)}/sections/${encodeURIComponent(resolvedSectionId)}`, { operationId: operationId('section-edit'), expectedRevision: section.revision, title }, { method: 'PATCH' });
                if (!scopeIsCurrent(mutationScope)) return;
                const updated = response?.section || response?.result?.section;
                if (updated) sections = sections.map((entry) => String(entry.id) === String(resolvedSectionId) ? { ...entry, ...updated } : entry).sort(rankCompare);
                boardRevision.structureRevision = Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision);
                if (draftVersions.get(key) === draftVersion) {
                    drafts.delete(key);
                    draftBases.delete(key);
                    draftVersions.delete(key);
                }
                renderBoard();
            } catch (error) {
                if (!scopeIsCurrent(mutationScope)) return;
                if (control && typeof control === 'object' && 'value' in control) control.value = section.title;
                setStatus(error?.message || 'Section could not be renamed.', 'error');
            }
        }

        async function createProject() {
            if (!apiFetchJson || !elements.projectsBoardProjectName) return;
            const name = String(elements.projectsBoardProjectName.value || '').trim();
            if (!name) { showToast('Enter a project name.', 'error'); return; }
            const creationActor = String(deps.getCurrentUser?.()?.uid || '');
            try {
                const response = await requestMutation('/api/projects', { operationId: operationId('project-create'), name, description: String(elements.projectsBoardProjectDescription?.value || '') }, { retries: 0 });
                const created = response?.project || response?.result?.project;
                if (elements.projectsBoardCreateProject) elements.projectsBoardCreateProject.hidden = true;
                if (elements.projectsBoardProjectName) elements.projectsBoardProjectName.value = '';
                if (elements.projectsBoardProjectDescription) elements.projectsBoardProjectDescription.value = '';
                const refreshed = await refreshProjects();
                if (created?.id && refreshed !== false && String(deps.getCurrentUser?.()?.uid || '') === creationActor) {
                    await selectProject(created.id);
                }
                showToast('Project created.', 'success');
            } catch (error) { showToast(error?.message || 'Project could not be created.', 'error'); }
        }

        let sectionCreateQueue = Promise.resolve();
        const optimisticSectionIdMap = new Map();

        async function createSection() {
            if (refreshRequested()) return;
            if (!canSchema() || busy) return;
            const title = String(elements.projectsBoardSectionName?.value || '').trim();
            if (!title) {
                setStatus('Enter a section name.', 'error');
                elements.projectsBoardSectionName?.focus();
                return;
            }
            const scope = captureScope();
            const optId = `opt-sec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const targetIndex = sections.length;
            const optSection = {
                id: optId,
                projectId: scope.projectId,
                title,
                rank: '999999/1',
                revision: 1,
                isOptimistic: true,
                lifecycle: 'active'
            };
            sections.push(optSection);
            sections.sort(rankCompare);
            resetSectionForm();
            renderBoard();

            sectionCreateQueue = sectionCreateQueue.catch(() => {}).then(async () => {
                if (!scopeIsCurrent(scope)) return;
                try {
                    const response = await requestMutation(`/api/projects/${encodeURIComponent(scope.projectId)}/sections`, {
                        operationId: operationId('section-create'),
                        title,
                        index: targetIndex,
                        expectedStructureRevision: structureRevision()
                    });
                    if (!scopeIsCurrent(scope)) return;
                    const created = response?.section || response?.result?.section;
                    if (created) {
                        optimisticSectionIdMap.set(optId, created.id);
                        const pendingDrafts = {};
                        for (const [key, value] of Array.from(drafts.entries())) {
                            try {
                                const parsed = JSON.parse(key);
                                if (parsed[0] === scope.projectId && parsed[1] === optId) {
                                    const field = parsed[2];
                                    drafts.delete(key);
                                    drafts.set(draftKey(created.id, field), value);
                                    pendingDrafts[field] = value;
                                }
                            } catch (_) { /* ignore draft key parse error */ }
                        }
                        for (const [key, base] of Array.from(draftBases.entries())) {
                            try {
                                const parsed = JSON.parse(key);
                                if (parsed[0] === scope.projectId && parsed[1] === optId) {
                                    draftBases.delete(key);
                                    draftBases.set(draftKey(created.id, parsed[2]), base);
                                }
                            } catch (_) { /* ignore draft key parse error */ }
                        }
                        for (const [key, ver] of Array.from(draftVersions.entries())) {
                            try {
                                const parsed = JSON.parse(key);
                                if (parsed[0] === scope.projectId && parsed[1] === optId) {
                                    draftVersions.delete(key);
                                    draftVersions.set(draftKey(created.id, parsed[2]), ver);
                                }
                            } catch (_) { /* ignore draft key parse error */ }
                        }

                        for (const task of tasks.values()) {
                            if (task.sectionId === optId) task.sectionId = created.id;
                            if (task.effectiveSectionId === optId) task.effectiveSectionId = created.id;
                        }
                        if (collapsedSections.has(optId)) {
                            collapsedSections.delete(optId);
                            collapsedSections.add(created.id);
                        }

                        sections = sections.map((s) => (s.id === optId ? { ...s, ...created, isOptimistic: false } : s)).sort(rankCompare);
                        boardRevision.structureRevision = Math.max(structureRevision(), Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision));
                        renderBoard();

                        if (pendingDrafts.title && pendingDrafts.title !== created.title) {
                            saveSection(created.id, { value: pendingDrafts.title });
                        }
                    } else {
                        sections = sections.filter((s) => s.id !== optId);
                        renderBoard();
                    }
                } catch (error) {
                    sections = sections.filter((s) => s.id !== optId);
                    renderBoard();
                    if (scopeIsCurrent(scope)) setStatus(error?.message || 'Section could not be created.', 'error');
                }
            });
            await sectionCreateQueue;
            return sections.find((s) => String(s.id) === String(optimisticSectionIdMap.get(optId) || optId));
        }

        let taskCreateQueue = Promise.resolve();
        const optimisticIdMap = new Map();

        async function createTask(parentTaskId = null, explicitSectionId = null) {
            if (refreshRequested()) return;
            if (!canWrite()) return;
            const scope = captureScope();
            const resolvedParentTaskId = parentTaskId ? (optimisticIdMap.get(parentTaskId) || parentTaskId) : null;
            const rawSectionId = explicitSectionId || (resolvedParentTaskId ? resolveEffectiveSectionId(resolvedParentTaskId) : (resolveEffectiveSectionId(selectedTaskId) || sections[0]?.id));
            const sectionId = optimisticSectionIdMap.get(rawSectionId) || rawSectionId;
            if (!sectionId) { showToast('Create a section before adding tasks.', 'error'); return; }

            const optId = `opt-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const parent = resolvedParentTaskId ? taskFor(resolvedParentTaskId) : null;
            const optTask = {
                id: optId,
                projectId: scope.projectId,
                title: 'New task',
                status: 'not_started',
                priority: 'none',
                parentTaskId: resolvedParentTaskId ? String(resolvedParentTaskId) : null,
                sectionId: resolvedParentTaskId ? null : sectionId,
                effectiveSectionId: sectionId,
                ancestorIds: parent ? [...(parent.ancestorIds || []), parent.id] : [],
                pathIds: parent ? [optId, ...(parent.pathIds || [parent.id])] : [optId],
                rank: '999999/1',
                lifecycle: 'active',
                isOptimistic: true,
                activeChildCount: 0,
                totalChildCount: 0,
                ownerUid: null,
                assigneeUids: [],
                dueDate: null,
                startDate: null,
                revision: 1
            };

            tasks.set(optId, optTask);
            if (resolvedParentTaskId) {
                expanded.add(String(resolvedParentTaskId));
                if (parent) parent.activeChildCount = (Number(parent.activeChildCount) || 0) + 1;
            }
            collapsedSections.delete(String(sectionId));

            const operation = { scope, trigger: document.activeElement, moved: false };
            taskCreateOperation = operation;
            const trackFocus = event => { if (event.target !== operation.trigger && event.target !== document.body) operation.moved = true; };
            document.addEventListener?.('focusin', trackFocus);
            document.addEventListener?.('pointerdown', trackFocus);
            syncTaskCreation();

            renderBoard({ focusRowId: `task:${optId}` });
            const optRow = elements.projectsBoardRows?.querySelector(`[data-task-id="${cssEscape(optId)}"]`);
            const titleInput = optRow?.querySelector('[data-field-kind="title"]');
            titleInput?.focus?.();
            titleInput?.select?.();

            taskCreateQueue = taskCreateQueue.catch(() => {}).then(async () => {
                if (!scopeIsCurrent(scope)) return;
                if (sectionId && (String(sectionId).startsWith('opt-sec-') || sections.some(s => s.id === sectionId && s.isOptimistic))) {
                    await sectionCreateQueue;
                    if (!scopeIsCurrent(scope)) return;
                }
                const effectiveParentId = resolvedParentTaskId ? (optimisticIdMap.get(resolvedParentTaskId) || resolvedParentTaskId) : null;
                if (resolvedParentTaskId && String(resolvedParentTaskId).startsWith('opt-task-') && !optimisticIdMap.has(resolvedParentTaskId)) {
                    tasks.delete(optId);
                    renderBoard();
                    setStatus('Subtask could not be created because the parent task failed to save.', 'error');
                    return;
                }
                const targetSectionId = optimisticSectionIdMap.get(sectionId) || sectionId;
                if (!sections.some(s => String(s.id) === String(targetSectionId))) {
                    tasks.delete(optId);
                    renderBoard();
                    setStatus('Task could not be created because the section failed to save.', 'error');
                    return;
                }
                const targetIndex = effectiveParentId
                    ? childrenOf(effectiveParentId).filter(t => t.id !== optId).length
                    : rootsForSection(targetSectionId).filter(t => t.id !== optId).length;

                try {
                    const response = await requestMutation(`/api/projects/${encodeURIComponent(scope.projectId)}/tasks`, {
                        operationId: operationId('task-create'),
                        title: 'New task',
                        parentTaskId: effectiveParentId || null,
                        sectionId: targetSectionId,
                        index: targetIndex,
                        expectedStructureRevision: structureRevision()
                    });
                    if (!scopeIsCurrent(scope)) return;
                    const created = response?.task || response?.result?.task;
                    const activeEl = document.activeElement;
                    const hadFocusInOpt = activeEl && activeEl.closest?.(`[data-task-id="${cssEscape(optId)}"]`);
                    const fieldKind = hadFocusInOpt ? activeEl.getAttribute('data-field-kind') : null;
                    const shouldFocus = !operation.moved && (hadFocusInOpt || !document.activeElement || document.activeElement === operation.trigger || document.activeElement === document.body);

                    if (created) {
                        optimisticIdMap.set(optId, created.id);
                        const pendingDrafts = {};
                        for (const [key, value] of Array.from(drafts.entries())) {
                            try {
                                const parsed = JSON.parse(key);
                                if (parsed[0] === scope.projectId && parsed[1] === optId) {
                                    const field = parsed[2];
                                    drafts.delete(key);
                                    drafts.set(draftKeyFor(created.id, field), value);
                                    pendingDrafts[field] = value;
                                }
                            } catch (_) { /* ignore draft key parse error */ }
                        }
                        for (const [key, base] of Array.from(draftBases.entries())) {
                            try {
                                const parsed = JSON.parse(key);
                                if (parsed[0] === scope.projectId && parsed[1] === optId) {
                                    draftBases.delete(key);
                                    draftBases.set(draftKeyFor(created.id, parsed[2]), base);
                                }
                            } catch (_) { /* ignore draft key parse error */ }
                        }
                        for (const [key, ver] of Array.from(draftVersions.entries())) {
                            try {
                                const parsed = JSON.parse(key);
                                if (parsed[0] === scope.projectId && parsed[1] === optId) {
                                    draftVersions.delete(key);
                                    draftVersions.set(draftKeyFor(created.id, parsed[2]), ver);
                                }
                            } catch (_) { /* ignore draft key parse error */ }
                        }

                        if (selectedTaskId === optId) selectedTaskId = String(created.id);
                        const selIdx = selectedTaskIds.indexOf(optId);
                        if (selIdx !== -1) selectedTaskIds[selIdx] = String(created.id);

                        tasks.delete(optId);
                        if (!created.effectiveSectionId) created.effectiveSectionId = targetSectionId;
                        tasks.set(String(created.id), created);

                        boardRevision.structureRevision = Math.max(structureRevision(), Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision));
                        if (effectiveParentId) expanded.add(String(effectiveParentId));

                        renderBoard({ focusRowId: shouldFocus ? `task:${created.id}` : '' });
                        const newRow = elements.projectsBoardRows?.querySelector(`[data-task-id="${cssEscape(created.id)}"]`);
                        if (shouldFocus) {
                            if (fieldKind) {
                                const field = newRow?.querySelector(`[data-field-kind="${cssEscape(fieldKind)}"]`);
                                field?.focus?.();
                            } else {
                                const title = newRow?.querySelector('[data-field-kind="title"]');
                                title?.focus?.();
                            }
                        }
                        if (newRow && !globalScope.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                            newRow.classList.add('is-new');
                            newRow.addEventListener('animationend', () => newRow.classList.remove('is-new'), { once: true });
                        }

                        for (const [field, val] of Object.entries(pendingDrafts)) {
                            if (field.startsWith('value:')) {
                                const colId = field.slice(6);
                                if (val !== created.values?.[colId]) {
                                    saveTaskField(created.id, 'value', { value: val, dataset: { columnId: colId } });
                                }
                            } else if (val !== created[field]) {
                                saveTaskField(created.id, field, { value: val });
                            }
                        }
                    } else {
                        tasks.delete(optId);
                        renderBoard();
                    }
                } catch (error) {
                    tasks.delete(optId);
                    if (resolvedParentTaskId) {
                        const p = taskFor(resolvedParentTaskId);
                        if (p) p.activeChildCount = Math.max(0, (Number(p.activeChildCount) || 1) - 1);
                    }
                    for (const key of Array.from(drafts.keys())) {
                        try {
                            const parsed = JSON.parse(key);
                            if (parsed[0] === scope.projectId && parsed[1] === optId) drafts.delete(key);
                        } catch (_) { /* ignore draft key parse error */ }
                    }
                    if (selectedTaskId === optId) selectedTaskId = '';
                    selectedTaskIds = selectedTaskIds.filter(id => id !== optId);
                    if (scopeIsCurrent(scope)) {
                        renderBoard();
                        showToast(error?.message || 'Task could not be created.', 'error');
                    }
                } finally {
                    document.removeEventListener?.('focusin', trackFocus);
                    document.removeEventListener?.('pointerdown', trackFocus);
                    if (taskCreateOperation === operation) taskCreateOperation = null;
                    syncTaskCreation();
                }
            });
            await taskCreateQueue;
            return taskFor(optimisticIdMap.get(optId) || optId);
        }

        function resetColumnForm() {
            columnEditor = null;
            if (elements.projectsBoardColumnForm) elements.projectsBoardColumnForm.hidden = true;
            if (elements.projectsBoardColumnLabel) elements.projectsBoardColumnLabel.value = '';
            if (elements.projectsBoardColumnOptions) { elements.projectsBoardColumnOptions.value = ''; elements.projectsBoardColumnOptions.hidden = false; }
            elements.projectsBoardColumnForm?.querySelector('[data-column-editor-fields]')?.remove();
            const optionsLabel = elements.projectsBoardColumnForm?.querySelector('label[for="projects-board-column-options"]');
            if (optionsLabel) optionsLabel.hidden = false;
            const save = document.getElementById('btn-projects-board-save-column');
            if (save) save.textContent = 'Add column';
            syncColumnForm();
        }

        function syncColumnForm() {
            const disabled = busy || !canSchema() || !!columnEditor?.pending;
            for (const control of elements.projectsBoardColumnForm?.querySelectorAll('input,select,textarea,button') || []) control.disabled = disabled;
            if (elements.projectsBoardColumnType) elements.projectsBoardColumnType.disabled = disabled || !!columnEditor?.column;
        }

        function openColumnForm(columnId = '') {
            if (!canSchema() || busy || columnEditor?.pending) return;
            resetColumnForm();
            const column = columns.find(entry => String(entry.id) === String(columnId)) || null;
            columnEditor = { scope: captureScope(), column, revision: column?.revision, schemaRevision: boardRevision.schemaRevision, pending: false };
            const form = elements.projectsBoardColumnForm;
            if (!form) return;
            form.hidden = false;
            elements.projectsBoardColumnLabel.value = column?.label || '';
            elements.projectsBoardColumnType.value = column?.type || 'text';
            elements.projectsBoardColumnOptions.hidden = !!column;
            const optionsLabel = form.querySelector('label[for="projects-board-column-options"]');
            if (optionsLabel) optionsLabel.hidden = !!column;
            const save = document.getElementById('btn-projects-board-save-column');
            if (save) save.textContent = column ? 'Save column' : 'Add column';
            const fields = document.createElement('div');
            fields.dataset.columnEditorFields = '';
            form.appendChild(fields);
            function addOption(option = { key: operationId('option'), label: '' }) {
                const row = document.createElement('div');
                row.innerHTML = `<input type="text" data-option-key="${escape(option.key)}" aria-label="Option label" value="${escape(option.label)}"><button type="button" data-remove-option>Remove option</button>`;
                row.querySelector('button').addEventListener('click', () => { if (!columnEditor?.pending) row.remove(); });
                fields.insertBefore(row, fields.querySelector('[data-add-option]'));
            }
            if (column?.type === 'dropdown') {
                const add = document.createElement('button'); add.type = 'button'; add.dataset.addOption = ''; add.textContent = 'Add option';
                add.addEventListener('click', () => { if (!columnEditor?.pending) addOption(); }); fields.appendChild(add);
                asArray(column.options).forEach(addOption);
            }
            if (column?.type === 'status') fields.innerHTML = STATUS_KEYS.map(key => `<label>${escape(STATUS_LABELS[key])}<input data-status-key="${key}" aria-label="Custom ${escape(STATUS_LABELS[key])} label" value="${escape(column.statusLabels?.[key] || STATUS_LABELS[key])}"></label>`).join('');
            if (column) {
                const archive = document.createElement('button'); archive.type = 'button'; archive.dataset.archiveColumn = ''; archive.textContent = 'Archive column';
                archive.addEventListener('click', () => createColumn(true)); fields.appendChild(archive);
            }
            syncColumnForm(); elements.projectsBoardColumnLabel.focus();
        }

        async function createColumn(archive = false) {
            if (typeof refreshRequested === 'function' && refreshRequested()) return;
            const editor = columnEditor;
            if (!editor || editor.pending || !canSchema() || !scopeIsCurrent(editor.scope)) return;
            archive = archive === true;
            const label = String(elements.projectsBoardColumnLabel?.value || '').trim();
            const type = editor.column?.type || String(elements.projectsBoardColumnType?.value || 'text');
            if (!archive && !label) { showToast('Enter a column label.', 'error'); return; }
            const payload = { operationId: operationId(archive ? 'column-archive' : 'column-save'), expectedSchemaRevision: editor.schemaRevision };
            if (editor.column) payload.expectedRevision = editor.revision;
            else { payload.type = type; payload.index = columns.length; }
            if (!archive) {
                payload.label = label;
                if (type === 'dropdown') payload.options = editor.column
                    ? [...elements.projectsBoardColumnForm.querySelectorAll('[data-option-key]')].map(input => ({ key: input.dataset.optionKey, label: input.value.trim() }))
                    : String(elements.projectsBoardColumnOptions?.value || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(label => ({ key: operationId('option'), label }));
                if (editor.column && type === 'status') payload.statusLabels = Object.fromEntries([...elements.projectsBoardColumnForm.querySelectorAll('[data-status-key]')].map(input => [input.dataset.statusKey, input.value.trim()]));
            }
            editor.pending = true; syncColumnForm();
            try {
                const url = `/api/projects/${encodeURIComponent(editor.scope.projectId)}/columns${editor.column ? `/${encodeURIComponent(editor.column.id)}${archive ? '/archive' : ''}` : ''}`;
                const response = await requestMutation(url, payload, { method: editor.column && !archive ? 'PATCH' : 'POST' });
                if (!scopeIsCurrent(editor.scope) || columnEditor !== editor || !canSchema()) return;
                const saved = response?.column || response?.result?.column;
                const savedSchemaRevision = Number(response?.schemaRevision ?? response?.result?.schemaRevision ?? boardRevision.schemaRevision);
                const currentColumn = columns.find(column => column.id === saved?.id);
                // A refresh can observe a later committed schema while this response is in flight.
                if (savedSchemaRevision < boardRevision.schemaRevision || Number(currentColumn?.revision || 0) > Number(saved?.revision || 0)) {
                    resetColumnForm(); renderBoard(); return;
                }
                if (editor.column) columns = columns.filter(column => column.id !== editor.column.id);
                if (saved && !archive) columns.push(saved);
                columns.sort(rankCompare);
                boardRevision.schemaRevision = Number(response?.schemaRevision ?? response?.result?.schemaRevision ?? boardRevision.schemaRevision);
                resetColumnForm(); renderBoard();
            } catch (error) {
                if (scopeIsCurrent(editor.scope) && columnEditor === editor) {
                    if ([401, 403].includes(Number(error?.status))) resetColumnForm();
                    showToast(error?.message || 'Column could not be saved. Your draft is retained.', 'error');
                }
            } finally {
                if (columnEditor === editor) {
                    if (!scopeIsCurrent(editor.scope) || !canSchema()) resetColumnForm();
                    else { editor.pending = false; syncColumnForm(); }
                }
            }
        }

        async function saveSettings() {
            if (refreshRequested()) return;
            if (!canSchema() || !project) return;
            const mutationScope = captureScope();
            const mutationProjectId = mutationScope.projectId;
            const nameKey = scopedKey(mutationProjectId, 'settings:name');
            const descriptionKey = scopedKey(mutationProjectId, 'settings:description');
            const name = String(settingsDrafts.has(nameKey) ? settingsDrafts.get(nameKey) : (elements.projectsBoardSettingsName?.value || '')).trim();
            const description = String(settingsDrafts.has(descriptionKey) ? settingsDrafts.get(descriptionKey) : (elements.projectsBoardSettingsDescription?.value || ''));
            const statusControls = { not_started: elements.projectsBoardStatusNotStarted, in_progress: elements.projectsBoardStatusInProgress, blocked: elements.projectsBoardStatusBlocked, done: elements.projectsBoardStatusDone };
            const statusLabels = Object.fromEntries(Object.entries(statusControls).map(([key, control]) => [key, String(settingsDrafts.get(scopedKey(mutationProjectId, `settings:status:${key}`)) ?? control?.value ?? STATUS_LABELS[key]).trim()]));
            if (!name) { showToast('Project name is required.', 'error'); return; }
            try {
                const response = await requestMutation(`/api/projects/${encodeURIComponent(mutationProjectId)}`, { operationId: operationId('project-edit'), expectedRevision: projectRevision(), expectedSchemaRevision: boardRevision.schemaRevision, name, description, statusLabels }, { method: 'PATCH', retries: 1 });
                if (!scopeIsCurrent(mutationScope)) return;
                project = { ...project, ...(response?.project || response?.result?.project || {}) };
                selection.selectedProject = { ...(selection.selectedProject || {}), name: project.name };
                settingsDrafts.delete(nameKey);
                settingsDrafts.delete(descriptionKey);
                Object.keys(statusLabels).forEach((key) => settingsDrafts.delete(scopedKey(mutationProjectId, `settings:status:${key}`)));
                renderBoard();
                showToast('Project details saved.', 'success');
            } catch (error) {
                if (!scopeIsCurrent(mutationScope)) return;
                showToast(error?.message || 'Project details could not be saved.', 'error');
            }
        }

        function expandDestinationAncestry(destination) {
            const seen = new Set();
            let parentId = destination?.parentTaskId || null;
            while (parentId) {
                const id = String(parentId);
                if (seen.has(id)) break;
                seen.add(id);
                expanded.add(id);
                parentId = taskFor(id)?.parentTaskId || null;
            }
        }

        function isTaskMoveNoop(task, destination) {
            const currentParentId = task.parentTaskId || null;
            const destinationParentId = destination?.parentTaskId || null;
            if (String(currentParentId || '') !== String(destinationParentId || '')) return false;
            const currentSectionId = task.effectiveSectionId || task.sectionId || null;
            if (!destinationParentId && String(currentSectionId || '') !== String(destination?.sectionId || '')) return false;
            const siblings = siblingsFor(currentParentId, currentSectionId);
            const destinationIndex = normalizedInsertionIndex(destination?.index, Math.max(0, siblings.length - 1));
            const currentIndex = sourceExcludedInsertionIndex(siblings, task.id);
            return destinationIndex !== null && currentIndex !== null && destinationIndex === currentIndex;
        }

        async function moveTask(taskId, destination) {
            if (refreshRequested()) return;
            const mutationScope = captureScope();
            if (String(taskId).startsWith('opt-task-') || String(destination?.parentTaskId || '').startsWith('opt-task-')) {
                await taskCreateQueue;
                if (!scopeIsCurrent(mutationScope)) return;
                taskId = optimisticIdMap.get(taskId) || taskId;
                if (destination?.parentTaskId) {
                    destination.parentTaskId = optimisticIdMap.get(destination.parentTaskId) || destination.parentTaskId;
                }
            }
            await waitForTaskQueue(mutationScope, taskId);
            if (!scopeIsCurrent(mutationScope)) return;
            const task = taskFor(taskId);
            if (!task || !canWrite()) return;
            if (isTaskMoveNoop(task, destination)) return;
            const mutationProjectId = mutationScope.projectId;
            const opId = operationId(`move-${taskId}`);
            const operationPendingKey = pendingKeyFor(mutationScope, taskId);
            taskMovesPending.add(mutationScope);
            setBusy(loadBusy);
            movePending.add(operationPendingKey);
            pending.set(operationPendingKey, opId);
            renderBoard();
            try {
                if (destination.sectionId && (String(destination.sectionId).startsWith('opt-sec-') || sections.some(s => s.id === destination.sectionId && s.isOptimistic))) {
                    await sectionCreateQueue;
                    if (!scopeIsCurrent(mutationScope)) return;
                }
                const destSectionId = destination.sectionId ? (optimisticSectionIdMap.get(destination.sectionId) || destination.sectionId) : null;
                const destParentTaskId = destination.parentTaskId ? (optimisticIdMap.get(destination.parentTaskId) || destination.parentTaskId) : null;
                const response = await requestMutation(`/api/projects/${encodeURIComponent(mutationProjectId)}/tasks/${encodeURIComponent(taskId)}/move`, { operationId: opId, expectedRevision: task.revision, expectedStructureRevision: structureRevision(), parentTaskId: destParentTaskId, sectionId: destSectionId, index: destination.index });
                if (!scopeIsCurrent(mutationScope)) return;
                boardRevision.structureRevision = Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision);
                expandDestinationAncestry(destination);
                selectedTaskId = String(taskId);
                const saved = response?.task || response?.result?.task;
                const destParent = destination.parentTaskId ? taskFor(destination.parentTaskId) : null;
                const effectiveSec = destination.parentTaskId ? resolveEffectiveSectionId(destination.parentTaskId) : destSectionId;
                const ancestorIds = destParent ? [...(destParent.ancestorIds || []), destParent.id] : [];
                const pathIds = destParent ? [taskId, ...(destParent.pathIds || [destParent.id])] : [taskId];
                const oldParentId = task.parentTaskId;
                if (oldParentId && oldParentId !== destination.parentTaskId) {
                    const oldParent = taskFor(oldParentId);
                    if (oldParent && oldParent.activeChildCount > 0) oldParent.activeChildCount -= 1;
                }
                if (destination.parentTaskId && destination.parentTaskId !== oldParentId) {
                    const newParent = taskFor(destination.parentTaskId);
                    if (newParent) newParent.activeChildCount = (Number(newParent.activeChildCount) || 0) + 1;
                }
                const updatedTask = {
                    ...task,
                    ...(saved || {}),
                    parentTaskId: destination.parentTaskId || null,
                    sectionId: destination.parentTaskId ? null : destSectionId,
                    effectiveSectionId: effectiveSec,
                    ancestorIds,
                    pathIds
                };
                tasks.set(String(taskId), updatedTask);
                const updateDescendants = (parentId, pSectionId) => {
                    for (const child of childrenOf(parentId)) {
                        child.effectiveSectionId = pSectionId;
                        const p = taskFor(parentId);
                        child.ancestorIds = p ? [...(p.ancestorIds || []), p.id] : [];
                        child.pathIds = p ? [child.id, ...(p.pathIds || [p.id])] : [child.id];
                        tasks.set(String(child.id), child);
                        updateDescendants(child.id, pSectionId);
                    }
                };
                updateDescendants(taskId, effectiveSec);
            } catch (error) {
                if (!scopeIsCurrent(mutationScope)) return;
                setStatus(error?.message || 'Move conflicted; refresh and retry.', 'error');
            } finally {
                if (pending.get(operationPendingKey) === opId) pending.delete(operationPendingKey);
                movePending.delete(operationPendingKey);
                taskMovesPending.delete(mutationScope);
                if (scopeIsCurrent(mutationScope)) {
                    const completionView = snapshotView();
                    setBusy(loadBusy);
                    renderBoard();
                    restoreView(completionView);
                }
            }
        }

        async function moveSection(sectionId, index) {
            if (refreshRequested()) return;
            if (!canSchema()) return;
            const scope = captureScope();
            let resolvedSectionId = optimisticSectionIdMap.get(sectionId) || sectionId;
            let section = sections.find((entry) => String(entry.id) === String(resolvedSectionId));
            if (!section) return;
            const destinationIndex = normalizedInsertionIndex(index, Math.max(0, sections.length - 1));
            const currentIndex = sourceExcludedInsertionIndex(sections, resolvedSectionId);
            if (destinationIndex !== null && currentIndex !== null && destinationIndex === currentIndex) return;

            const [moved] = sections.splice(currentIndex, 1);
            sections.splice(destinationIndex, 0, moved);
            renderBoard();

            try {
                if (section.isOptimistic) {
                    await sectionCreateQueue;
                    if (!scopeIsCurrent(scope)) return;
                    resolvedSectionId = optimisticSectionIdMap.get(sectionId) || sectionId;
                    section = sections.find((entry) => String(entry.id) === String(resolvedSectionId));
                    if (!section) return;
                }
                const response = await requestMutation(`/api/projects/${encodeURIComponent(scope.projectId)}/sections/${encodeURIComponent(resolvedSectionId)}/move`, { operationId: operationId('section-move'), expectedRevision: section.revision, expectedStructureRevision: structureRevision(), index: destinationIndex });
                if (!scopeIsCurrent(scope)) return;
                boardRevision.structureRevision = Number(response?.structureRevision ?? response?.result?.structureRevision ?? boardRevision.structureRevision);
                const saved = response?.section || response?.result?.section;
                if (saved) {
                    sections = sections.map((entry) => String(entry.id) === String(resolvedSectionId) ? { ...entry, ...saved } : entry);
                    sections.sort(rankCompare);
                    renderBoard();
                }
            } catch (error) {
                if (scopeIsCurrent(scope)) {
                    const curr = sections.indexOf(moved);
                    if (curr !== -1) {
                        sections.splice(curr, 1);
                        sections.splice(currentIndex, 0, moved);
                        renderBoard();
                    }
                    setStatus(error?.message || 'Section move conflicted; refresh and retry.', 'error');
                }
            }
        }

        async function moveColumn(columnId, index) {
            if (refreshRequested()) return;
            if (!canSchema() || busy) return;
            const column = columns.find((entry) => String(entry.id) === String(columnId));
            if (!column) return;
            const destinationIndex = normalizedInsertionIndex(index, Math.max(0, columns.length - 1));
            const currentIndex = sourceExcludedInsertionIndex(columns, columnId);
            if (destinationIndex !== null && currentIndex !== null && destinationIndex === currentIndex) return;
            const scope = captureScope();
            columnMovesPending.add(scope);
            setBusy(loadBusy);
            renderBoard();
            setStatus('Moving column...');
            try {
                const response = await requestMutation(`/api/projects/${encodeURIComponent(scope.projectId)}/columns/${encodeURIComponent(columnId)}/move`, { operationId: operationId('column-move'), expectedRevision: column.revision, expectedSchemaRevision: boardRevision.schemaRevision, index });
                if (!scopeIsCurrent(scope)) return;
                boardRevision.schemaRevision = Number(response?.schemaRevision ?? response?.result?.schemaRevision ?? boardRevision.schemaRevision);
                const saved = response?.column || response?.result?.column;
                if (saved) {
                    columns = columns.map((entry) => String(entry.id) === String(columnId) ? { ...entry, ...saved } : entry);
                } else if (destinationIndex !== null && currentIndex !== null) {
                    const [moved] = columns.splice(currentIndex, 1);
                    columns.splice(destinationIndex, 0, moved);
                }
                columns.sort(rankCompare);
                renderBoard();
            } catch (error) { if (scopeIsCurrent(scope)) setStatus(error?.message || 'Column move conflicted; refresh and retry.', 'error'); }
            finally {
                columnMovesPending.delete(scope);
                if (scopeIsCurrent(scope)) { setBusy(loadBusy); renderBoard(); }
            }
        }

        function appendChildCountHint(parentTaskId) {
            const id = String(parentTaskId || '');
            const loadedCount = childrenOf(id).length;
            const hint = Number(taskFor(id)?.activeChildCount);
            return Number.isSafeInteger(hint) && hint >= loadedCount ? hint : null;
        }

        async function appendIndexForParent(parentTaskId, scope) {
            const id = String(parentTaskId || '');
            if (!id || !scopeIsCurrent(scope)) return null;
            const hintedCount = appendChildCountHint(id);
            if (hintedCount !== null) return hintedCount;
            const branchComplete = loadedBranches.has(id) && branchHasMore.get(id) !== true;
            if (!branchComplete) {
                const loaded = await loadAllBranch(id, { render: false });
                if (!loaded || !scopeIsCurrent(scope)) return null;
            }
            if (!scopeIsCurrent(scope)) return null;
            const refreshedHint = appendChildCountHint(id);
            return refreshedHint === null ? childrenOf(id).length : refreshedHint;
        }

        function siblingsFor(parentTaskId, sectionId = null) {
            return parentTaskId ? childrenOf(parentTaskId) : rootsForSection(sectionId);
        }

        async function selectedSiblingMove(delta, indentDelta = 0) {
            const task = taskFor(selectedTaskId);
            if (!task || !canWrite() || busy) return;
            const taskId = String(task.id);
            const parentId = task.parentTaskId || null;
            const sectionId = task.effectiveSectionId || task.sectionId;
            const currentSiblings = siblingsFor(parentId, sectionId);
            const siblings = currentSiblings.filter((entry) => String(entry.id) !== String(task.id));
            const currentIndex = currentSiblings.findIndex((entry) => String(entry.id) === String(task.id));
            if (indentDelta > 0 && currentIndex > 0) {
                const previous = currentSiblings[currentIndex - 1];
                const previousId = String(previous.id);
                const scope = captureScope();
                const index = await appendIndexForParent(previousId, scope);
                if (index === null || !scopeIsCurrent(scope) || String(selectedTaskId) !== taskId) return;
                const currentTask = taskFor(taskId);
                const currentPrevious = taskFor(previousId);
                if (!currentTask || !currentPrevious) return;
                return moveTask(currentTask.id, { parentTaskId: currentPrevious.id, sectionId: null, index });
            }
            if (indentDelta < 0 && parentId) {
                const parent = taskFor(parentId);
                const grandparent = parent?.parentTaskId || null;
                const parentSiblings = siblingsFor(grandparent, parent?.effectiveSectionId || parent?.sectionId);
                const parentIndex = parentSiblings.findIndex((entry) => String(entry.id) === String(parentId));
                return moveTask(task.id, { parentTaskId: grandparent, sectionId: grandparent ? null : (parent?.effectiveSectionId || parent?.sectionId), index: parentIndex + 1 });
            }
            const nextIndex = Math.max(0, Math.min(siblings.length, currentIndex + delta));
            if (nextIndex === currentIndex || currentIndex < 0) return;
            return moveTask(task.id, { parentTaskId: parentId, sectionId: parentId ? null : (task.effectiveSectionId || task.sectionId), index: nextIndex });
        }

        async function toggleTask(taskId) {
            const id = String(taskId || '');
            if (!id) return;
            if (expanded.has(id)) { expanded.delete(id); renderBoard(); return; }
            expanded.add(id);
            renderBoard();
            const scope = captureScope(), sequence = refreshSequence;
            const current = () => scopeIsCurrent(scope) && sequence === refreshSequence && !busy;
            if (!loadedBranches.has(id) && !await loadAllBranch(id)) return;
            // Reopening a collapsed branch restores only reachable expanded paths.
            // Descendants behind another collapsed ancestor remain unloaded.
            let pendingExpansion = true;
            while (current() && pendingExpansion) {
                pendingExpansion = false;
                for (const childId of expanded) {
                    if (!current()) return;
                    const child = taskFor(childId);
                    if (!child || loadedBranches.has(childId)) continue;
                    let reachable = true;
                    const seen = new Set();
                    for (let parentId = child.parentTaskId; parentId && !seen.has(parentId); parentId = taskFor(parentId)?.parentTaskId) {
                        if (!expanded.has(parentId)) { reachable = false; break; }
                        seen.add(parentId);
                    }
                    if (!reachable) continue;
                    if (!await loadAllBranch(childId)) return;
                    pendingExpansion = true;
                }
            }
        }

        function startExpandHover(taskId) {
            const id = String(taskId || '');
            if (!id || expanded.has(id)) return;
            if (dragHoverTaskId === id && dragExpandTimer) return;
            clearTimeout(dragExpandTimer);
            dragHoverTaskId = id;
            dragExpandTimer = setTimeout(() => {
                dragExpandTimer = null;
                dragHoverTaskId = '';
                if (dragState && !expanded.has(id)) toggleTask(id);
            }, 650);
        }

        function clearDropClasses() { elements.projectsBoardRows?.querySelectorAll('.is-drop-target,.is-drop-parent').forEach((node) => node.classList.remove('is-drop-target', 'is-drop-parent')); }

        function stopDragAutoScroll() {
            if (dragAutoScrollTimer) clearInterval(dragAutoScrollTimer);
            dragAutoScrollTimer = null;
            dragAutoScrollDirection = 0;
        }

        function clearDragInteraction() {
            clearTimeout(dragExpandTimer);
            dragExpandTimer = null;
            dragHoverTaskId = '';
            dragHoverTargetRowId = '';
            stopDragAutoScroll();
            dragState = null;
            clearDropClasses();
        }

        function updateDragAutoScroll(event) {
            const scroll = elements.projectsBoardScroll;
            if (!scroll) return;
            const bounds = scroll.getBoundingClientRect();
            let direction = 0;
            if (event.clientY < bounds.top + 42) direction = -1;
            else if (event.clientY > bounds.bottom - 42) direction = 1;
            if (!direction) {
                stopDragAutoScroll();
                return;
            }
            if (direction === dragAutoScrollDirection && dragAutoScrollTimer) return;
            stopDragAutoScroll();
            dragAutoScrollDirection = direction;
            const step = () => {
                if (!dragState || !dragAutoScrollDirection) return;
                scroll.scrollTop += dragAutoScrollDirection * 12;
            };
            step();
            dragAutoScrollTimer = setInterval(step, 50);
        }

        function dropDestination(event, target) {
            const targetKind = target?.dataset?.rowKind;
            if (targetKind === 'section') {
                const section = sections.find((entry) => String(entry.id) === String(target.dataset.sectionId));
                if (dragState?.kind === 'task' && section) return { type: 'task', parentTaskId: null, sectionId: section.id, index: rootsForSection(section.id).length };
                if (dragState?.kind === 'section') return { type: 'section', sectionId: dragState.id, index: sections.findIndex((entry) => String(entry.id) === String(section.id)) };
            }
            if (targetKind === 'task') {
                const targetTask = taskFor(target.dataset.taskId);
                if (!targetTask || !dragState) return null;
                if (dragState.kind === 'task' && String(dragState.id) === String(targetTask.id)) return null;
                const asParent = isParentDrop(event, target);
                if (dragState.kind === 'task') {
                    if (asParent) return { type: 'task', parentTaskId: targetTask.id, sectionId: null, index: appendChildCountHint(targetTask.id) ?? childrenOf(targetTask.id).length };
                    const parentId = targetTask.parentTaskId || null;
                    const siblings = siblingsFor(parentId, targetTask.effectiveSectionId || targetTask.sectionId).filter((entry) => String(entry.id) !== String(dragState.id));
                    return { type: 'task', parentTaskId: parentId, sectionId: parentId ? null : (targetTask.effectiveSectionId || targetTask.sectionId), index: Math.max(0, siblings.findIndex((entry) => String(entry.id) === String(targetTask.id))) };
                }
            }
            return null;
        }

        function isParentDrop(event, target) {
            if (target?.dataset?.rowKind !== 'task') return false;
            const rect = target.getBoundingClientRect();
            return event.shiftKey || event.altKey || event.clientX > rect.left + rect.width * .56;
        }

        function onDragStart(event) {
            if (refreshRequested()) { event.preventDefault(); return; }
            if (event.target.closest('[data-action="select-task"]')) { event.preventDefault(); return; }
            if (!canWrite()) { event.preventDefault(); return; }
            const row = event.target.closest('[data-row-kind]');
            if (!row || row.dataset.rowKind === 'summary') return;
            clearDragInteraction();
            dragState = { kind: row.dataset.rowKind, id: row.dataset.rowKind === 'task' ? row.dataset.taskId : row.dataset.sectionId, handled: false };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', `${dragState.kind}:${dragState.id}`);
        }

        function onDragOver(event) {
            if (!dragState) return;
            event.preventDefault();
            updateDragAutoScroll(event);
            const target = event.target.closest('[data-row-kind]');
            if (!target || target.dataset.rowKind === 'summary') return;
            dragHoverTargetRowId = target.dataset.rowId || '';
            clearDropClasses();
            const asParent = target.dataset.rowKind === 'task' && (event.shiftKey || event.altKey || event.clientX > target.getBoundingClientRect().left + target.getBoundingClientRect().width * .56);
            target.classList.add(asParent ? 'is-drop-parent' : 'is-drop-target');
            if (asParent && target.dataset.taskId) startExpandHover(target.dataset.taskId);
        }

        function onDragLeave(event) {
            const next = event.relatedTarget;
            const boardRoot = elements.projectsBoardSection || elements.projectsBoardTable || elements.projectsBoardRows;
            if (next && boardRoot?.contains(next)) return;
            clearDragInteraction();
        }

        async function onDrop(event) {
            if (refreshRequested()) { event.preventDefault(); clearDragInteraction(); return; }
            if (!dragState || dragState.handled) return;
            event.preventDefault();
            const target = event.target.closest('[data-row-kind]');
            if (!target || target.dataset.rowKind === 'summary') return;
            if (dragState.kind === 'task' && isParentDrop(event, target)) {
                const scope = captureScope();
                const index = await appendIndexForParent(target.dataset.taskId, scope);
                if (index === null || !scopeIsCurrent(scope) || !dragState) {
                    clearDragInteraction();
                    return;
                }
            }
            const destination = dropDestination(event, target);
            dragState.handled = true;
            clearDropClasses();
            const source = dragState;
            clearDragInteraction();
            if (!destination) return;
            if (destination.type === 'task') await moveTask(source.id, destination);
            else if (destination.type === 'section') await moveSection(destination.sectionId, destination.index);
        }

        // Assigning someone used to mean opening a raw OS listbox showing an email
        // address. This is a search-and-pick popover; the native <select> underneath
        // stays the value store, so saveTaskField and every pinned selector are intact.
        let lastDetailTaskId = null;
        let statusPopover = null;
        let statusContext = null;

        function closeStatusPicker() {
            if (!statusPopover) return;
            statusPopover.remove();
            statusPopover = null;
            statusContext = null;
        }

        function syncStatusElement(control, newStatus, labels = {}) {
            if (!control) return;
            const status = newStatus || control.value || 'not_started';
            control.value = status;
            control.setAttribute('data-status', status);
            const cell = control.closest('[role="cell"]');
            if (cell) cell.setAttribute('data-status', status);
            const pill = cell?.querySelector('.crm-board-status-pill');
            if (pill) {
                pill.setAttribute('data-status', status);
                const textEl = pill.querySelector('.crm-board-status-text');
                const labelText = labels[status] || project?.statusLabels?.[status] || STATUS_LABELS[status] || status;
                if (textEl) textEl.textContent = labelText;
                pill.setAttribute('aria-label', control.dataset?.fieldKind === 'status' ? `Status: ${labelText}` : labelText);
            }
        }

        function commitStatus(newStatus) {
            if (!statusContext) return;
            const { control, trigger, labels, taskId, fieldKind, columnId } = statusContext;
            closeStatusPicker();
            if (!control || control.disabled) return;
            // Synchronously update DOM attributes, pill text, and cell immediately (0ms)
            syncStatusElement(control, newStatus, labels);
            // Synchronously update draft in drafts map so any re-renders retain it immediately
            const key = fieldKind === 'value' && columnId ? `value:${columnId}` : fieldKind;
            const keyForDraft = draftKeyFor(taskId, key);
            if (!draftBases.has(keyForDraft)) draftBases.set(keyForDraft, Number(taskFor(taskId)?.revision || 0));
            drafts.set(keyForDraft, newStatus);
            draftVersions.set(keyForDraft, (draftVersions.get(keyForDraft) || 0) + 1);
            // Dispatch change event to trigger saveTaskField and persist
            control.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function openStatusPicker(trigger) {
            closeStatusPicker();
            closePeoplePicker();
            const cell = trigger.closest('[role="cell"]');
            const row = trigger.closest('[data-task-id]');
            const control = cell?.querySelector('.crm-board-field');
            if (!control || control.disabled || !row) return;

            const taskId = row.dataset.taskId;
            const fieldKind = control.dataset.fieldKind;
            const columnId = control.dataset.columnId;
            const current = control.value || trigger.dataset.status || 'not_started';
            const column = columnId ? columns.find((c) => String(c.id) === String(columnId)) : null;
            const labels = (fieldKind === 'status' ? project?.statusLabels : column?.statusLabels) || {};

            statusContext = { control, trigger, labels, taskId, fieldKind, columnId, current };

            statusPopover = document.createElement('div');
            statusPopover.className = 'crm-status-popover';
            statusPopover.setAttribute('role', 'listbox');
            statusPopover.setAttribute('aria-label', 'Select status');

            const itemsHtml = STATUS_KEYS.map((key) => {
                const isChosen = key === current;
                const labelText = escape(labels[key] || STATUS_LABELS[key] || key);
                return `<button type="button" role="option" aria-selected="${isChosen ? 'true' : 'false'}" class="crm-status-popover-item${isChosen ? ' is-chosen' : ''}" data-status-key="${escape(key)}">`
                    + `<span class="crm-status-pill-badge" data-status="${escape(key)}"><span class="crm-status-pill-dot"></span><span>${labelText}</span></span>`
                    + (isChosen ? '<span class="crm-status-popover-check" aria-hidden="true">&#10003;</span>' : '')
                    + '</button>';
            }).join('');

            statusPopover.innerHTML = `<div class="crm-status-popover-list">${itemsHtml}</div>`;

            const panel = document.querySelector('[data-panel="projects"]');
            const scale = (panel && globalScope.getComputedStyle && parseFloat(globalScope.getComputedStyle(panel).zoom)) || 1;
            const validScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
            (panel || document.body).appendChild(statusPopover);

            const box = trigger.getBoundingClientRect();
            const popoverRect = statusPopover.getBoundingClientRect();
            const width = Math.max(160, box.width);
            const visualWidth = width * validScale;
            statusPopover.style.width = `${width}px`;
            statusPopover.style.left = `${Math.max(8, Math.min(box.left, (globalScope.innerWidth || 1024) - visualWidth - 8)) / validScale}px`;

            const fitsBelow = (box.bottom + popoverRect.height + 8) <= (globalScope.innerHeight || 768);
            if (fitsBelow) {
                statusPopover.style.top = `${(box.bottom + 4) / validScale}px`;
            } else {
                statusPopover.style.top = `${Math.max(8, box.top - popoverRect.height - 4) / validScale}px`;
            }

            const chosenItem = statusPopover.querySelector('.crm-status-popover-item.is-chosen') || statusPopover.querySelector('.crm-status-popover-item');
            chosenItem?.focus();

            statusPopover.addEventListener('click', (event) => {
                const option = event.target.closest('[data-status-key]');
                if (option) {
                    event.preventDefault();
                    event.stopPropagation();
                    commitStatus(option.dataset.statusKey);
                }
            });

            statusPopover.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    closeStatusPicker();
                    trigger.focus();
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const options = Array.from(statusPopover.querySelectorAll('.crm-status-popover-item'));
                    const idx = options.indexOf(document.activeElement);
                    if (idx !== -1) {
                        const nextIdx = event.key === 'ArrowDown' ? (idx + 1) % options.length : (idx - 1 + options.length) % options.length;
                        options[nextIdx]?.focus();
                    }
                } else if (event.key === 'Enter' || event.key === ' ') {
                    const option = event.target.closest('[data-status-key]');
                    if (option) {
                        event.preventDefault();
                        commitStatus(option.dataset.statusKey);
                    }
                }
            });
        }

        let peoplePopover = null;
        let peopleContext = null;

        function closePeoplePicker() {
            closeStatusPicker();
            if (!peoplePopover) return;
            peoplePopover.remove();
            peoplePopover = null;
            peopleContext = null;
        }

        function peopleRowMarkup(person, chosen) {
            const uid = String(person.uid || '');
            const name = asText(person.displayName || person.email || uid);
            const secondary = person.displayName && person.email ? escape(person.email) : '';
            return `<button type="button" role="option" aria-selected="${chosen ? 'true' : 'false'}" class="crm-people-option${chosen ? ' is-chosen' : ''}" data-people-uid="${escape(uid)}">`
                + `<span class="crm-board-owner-avatar" aria-hidden="true">${escape(ownerInitials(uid))}</span>`
                + `<span class="crm-people-option-text"><span class="crm-people-option-name">${escape(name)}</span>`
                + (secondary ? `<span class="crm-people-option-mail">${secondary}</span>` : '')
                + '</span><span class="crm-people-option-tick" aria-hidden="true"></span></button>';
        }

        function renderPeopleOptions(query) {
            if (!peoplePopover || !peopleContext) return;
            const term = String(query || '').trim().toLowerCase();
            const chosen = new Set(peopleContext.selected);
            const matches = members.filter((person) => {
                if (!term) return true;
                const name = asText(person.displayName || '').toLowerCase();
                const mail = asText(person.email || '').toLowerCase();
                return name.includes(term) || mail.includes(term);
            });
            const list = peoplePopover.querySelector('[data-people-list]');
            if (!list) return;
            const none = peopleContext.multiple
                ? ''
                : peopleRowMarkup({ uid: '', displayName: 'Unassigned' }, !peopleContext.selected.length);
            list.innerHTML = none + (matches.length
                ? matches.map((person) => peopleRowMarkup(person, chosen.has(String(person.uid)))).join('')
                : '<p class="crm-people-empty">No members match.</p>');
        }

        function commitPeople(uid) {
            if (!peopleContext) return;
            const control = peopleContext.control;
            if (!control) return;
            if (peopleContext.multiple) {
                const next = new Set(peopleContext.selected);
                if (next.has(uid)) next.delete(uid); else next.add(uid);
                peopleContext.selected = Array.from(next).filter(Boolean);
                Array.from(control.options).forEach((option) => { option.selected = peopleContext.selected.includes(option.value); });
                renderPeopleOptions(peoplePopover?.querySelector('[data-people-search]')?.value);
            } else {
                peopleContext.selected = uid ? [uid] : [];
                control.value = uid;
                closePeoplePicker();
            }
            control.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function openPeoplePicker(trigger) {
            closePeoplePicker();
            const cell = trigger.closest('[role="cell"]');
            const control = cell?.querySelector('.crm-board-field');
            if (!control || control.disabled) return;
            const multiple = trigger.dataset.peopleKind === 'assigneeUids';
            peopleContext = {
                control,
                multiple,
                selected: multiple
                    ? Array.from(control.selectedOptions || []).map((option) => option.value).filter(Boolean)
                    : (control.value ? [control.value] : [])
            };
            peoplePopover = document.createElement('div');
            peoplePopover.className = 'crm-people-popover';
            peoplePopover.setAttribute('role', 'dialog');
            peoplePopover.innerHTML = '<input type="search" class="crm-people-search" data-people-search placeholder="Search people" aria-label="Search people">'
                + '<div class="crm-people-list" role="listbox" data-people-list></div>';
            // Parent to the panel, not <body>: the --pj-* tokens and the dark
            // override are declared on the panel, so a popover outside it has
            // no surface, no border and no ink.
            const panel = document.querySelector('[data-panel="projects"]');
            const scale = (panel && globalScope.getComputedStyle && parseFloat(globalScope.getComputedStyle(panel).zoom)) || 1;
            const validScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
            (panel || document.body).appendChild(peoplePopover);
            const box = trigger.getBoundingClientRect();
            const width = 248;
            const visualWidth = width * validScale;
            peoplePopover.style.left = `${Math.max(8, Math.min(box.left, (globalScope.innerWidth || 1024) - visualWidth - 8)) / validScale}px`;
            peoplePopover.style.top = `${(box.bottom + 4) / validScale}px`;
            peoplePopover.style.width = `${width}px`;
            renderPeopleOptions('');
            peoplePopover.querySelector('[data-people-search]')?.focus();
            peoplePopover.addEventListener('input', (event) => {
                if (event.target.matches('[data-people-search]')) renderPeopleOptions(event.target.value);
            });
            peoplePopover.addEventListener('click', (event) => {
                const option = event.target.closest('[data-people-uid]');
                if (option) { event.preventDefault(); commitPeople(option.dataset.peopleUid); }
            });
            peoplePopover.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); closePeoplePicker(); trigger.focus(); } });
        }

        function onBoardClick(event) {
            const row = event.target.closest('[data-row-id]');
            if (row?.dataset?.rowKind === 'summary') return;
            const action = event.target.closest('[data-action]')?.dataset?.action;
            if (String(deps.getCurrentUser?.()?.uid || '') !== controllerActorUid) { invalidateAccess(currentProjectId()); return; }
            if (action === 'toggle-section' && row?.dataset?.rowKind === 'section') {
                const id = String(row.dataset.sectionId || '');
                if (!sections.some((section) => String(section.id) === id)) return;
                if (collapsedSections.has(id)) collapsedSections.delete(id); else collapsedSections.add(id);
                renderVirtualRows();
                return;
            }
            if (action === 'select-task' && row) { event.stopPropagation(); toggleSelection(row.dataset.taskId); event.target.checked = selectedTaskIds.includes(row.dataset.taskId); return; }
            if (action === 'toggle-task' && row) { toggleTask(row.dataset.taskId); return; }
            if (action === 'add-subtask' && row) { event.stopPropagation(); createTask(row.dataset.taskId); return; }
            if (action === 'pick-date') { event.stopPropagation(); globalScope.CrmProjectsDatePicker?.open(event.target.closest('.crm-board-date-control')?.querySelector('input')); return; }
            if (action === 'pick-people') { event.stopPropagation(); openPeoplePicker(event.target.closest('[data-people-kind]')); return; }
            if (action === 'pick-status') { event.stopPropagation(); openStatusPicker(event.target.closest('.crm-board-status-pill')); return; }
            if (action === 'drag-handle') return;
            if (action !== 'open-detail' && event.target.closest('input, select, textarea, button, a')) return;
            if (row?.dataset?.rowKind === 'task') { selectedTaskId = row.dataset.taskId; focusedRowId = row.dataset.rowId; renderDetail(); renderVirtualRows(); }
        }

        function onBoardChange(event) {
            const control = event.target.closest('.crm-board-field');
            if (control && (control.dataset.fieldKind === 'status' || (control.dataset.fieldKind === 'value' && control.classList.contains('crm-board-status-select')))) {
                syncStatusElement(control, control.value);
            }
            const row = control?.closest('[data-task-id]');
            if (control && row) saveTaskField(row.dataset.taskId, control.dataset.fieldKind, control);
            const sectionInput = event.target.closest('.crm-board-section-input');
            if (sectionInput) saveSection(sectionInput.closest('[data-section-id]')?.dataset?.sectionId, sectionInput);
        }

        function onBoardInput(event) {
            const control = event.target.closest('.crm-board-field');
            if (control && (control.dataset.fieldKind === 'status' || (control.dataset.fieldKind === 'value' && control.classList.contains('crm-board-status-select')))) {
                syncStatusElement(control, control.value);
            }
            const sectionInput = event.target.closest('.crm-board-section-input');
            if (sectionInput) {
                const sectionRow = sectionInput.closest('[data-section-id]');
                const sectionId = sectionRow?.dataset?.sectionId;
                if (sectionId) {
                    const key = draftKey(sectionId, 'title');
                    const resolvedId = optimisticSectionIdMap.get(sectionId) || sectionId;
                    const section = sections.find((s) => String(s.id) === String(resolvedId));
                    if (!draftBases.has(key)) draftBases.set(key, Number(section?.revision || 0));
                    drafts.set(key, sectionInput.value);
                    draftVersions.set(key, (draftVersions.get(key) || 0) + 1);
                }
                return;
            }
            const row = control?.closest('[data-task-id]');
            if (!control || !row) return;
            const taskId = row.dataset.taskId;
            const kind = control.dataset.fieldKind;
            const key = draftKeyFor(taskId, kind === 'value' ? `value:${control.dataset.columnId}` : kind);
            if (!draftBases.has(key)) draftBases.set(key, Number(taskFor(taskId)?.revision || 0));
            drafts.set(key, fieldValue(control));
            draftVersions.set(key, (draftVersions.get(key) || 0) + 1);
        }

        function onBoardKeydown(event) {
            const row = event.target.closest('[data-row-id]');
            if (!row) return;
            if (event.key === 'Enter' && event.target === row) { event.preventDefault(); selectedTaskId = row.dataset.taskId || ''; renderDetail(); return; }
            if (row.dataset.rowKind !== 'task' || event.target !== row) return;
            selectedTaskId = row.dataset.taskId;
            if (event.key === 'Tab') return;
            if (event.altKey && canWrite() && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) { event.preventDefault(); selectedSiblingMove(0, event.key === 'ArrowRight' ? 1 : -1); }
            else if (event.key === 'ArrowRight') { event.preventDefault(); if (!expanded.has(selectedTaskId)) toggleTask(selectedTaskId); else row.querySelector('.crm-board-expander')?.focus(); }
            else if (event.key === 'ArrowLeft') { event.preventDefault(); if (expanded.has(selectedTaskId)) toggleTask(selectedTaskId); else { const parent = taskFor(selectedTaskId)?.parentTaskId; if (parent) { selectedTaskId = parent; renderBoard(); } } }
            else if (event.key === 'ArrowDown') { event.preventDefault(); selectedSiblingMove(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); selectedSiblingMove(-1); }
            else if (event.key.toLowerCase() === 'n' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); createTask(selectedTaskId); }
        }

        async function refresh() {
            if (!currentProjectId()) return false;
            const intent = typeof captureScope === 'function' ? captureScope() : { projectId: currentProjectId() };
            if (typeof latestRefreshIntent !== 'undefined') latestRefreshIntent = intent;
            if (typeof refreshIntents !== 'undefined' && refreshIntents?.add) refreshIntents.add(intent);
            // Readiness starts before the observer handshake or local-save queue wait.
            // Keep admitted saves authorized until the loader drains their queue.
            if (typeof setBusy === 'function') setBusy(typeof loadBusy !== 'undefined' ? loadBusy : false);
            if (typeof renderBoard === 'function') renderBoard();
            let refreshed = false;
            try {
                refreshed = await loadProject(intent.projectId, { preserve: true });
                return refreshed;
            } finally {
                if (typeof refreshIntents !== 'undefined' && refreshIntents?.delete) refreshIntents.delete(intent);
                if (typeof scopeIsCurrent === 'function' && scopeIsCurrent(intent)) {
                    if (!refreshed && typeof latestRefreshIntent !== 'undefined' && latestRefreshIntent === intent && typeof authorityPending !== 'undefined') authorityPending = true;
                    const view = typeof snapshotView === 'function' ? snapshotView() : null;
                    if (typeof setBusy === 'function') setBusy(typeof loadBusy !== 'undefined' ? loadBusy : false);
                    if (typeof renderBoard === 'function') renderBoard();
                    if (view && typeof restoreView === 'function') restoreView(view);
                }
            }
        }

        function init() {
            if (bound) return;
            bound = true;
            elements.projectsBoardProjectSelect?.addEventListener('change', (event) => selectProject(event.target.value));
            elements.projectsBoardRefresh?.addEventListener('click', async () => {
                const scope = captureScope(); const taskId = selectedTaskId;
                if (await refresh() && scopeIsCurrent(scope) && taskId === selectedTaskId) await globalScope.projectsDiscussionController?.refresh?.();
            });
            document.getElementById('btn-projects-board-create-project')?.addEventListener('click', () => { if (elements.projectsBoardCreateProject) elements.projectsBoardCreateProject.hidden = false; elements.projectsBoardProjectName?.focus(); });
            document.getElementById('btn-projects-board-empty-create')?.addEventListener('click', () => { if (elements.projectsBoardCreateProject) elements.projectsBoardCreateProject.hidden = false; elements.projectsBoardProjectName?.focus(); });
            document.getElementById('btn-projects-board-save-project')?.addEventListener('click', createProject);
            document.getElementById('btn-projects-board-cancel-project')?.addEventListener('click', () => { if (elements.projectsBoardCreateProject) elements.projectsBoardCreateProject.hidden = true; });
            elements.projectsBoardSectionForm?.addEventListener('submit', (event) => { event.preventDefault(); createSection(); });
            elements.projectsBoardAddSection?.addEventListener('click', openSectionForm);
            elements.projectsBoardCancelSection?.addEventListener('click', closeSectionForm);
            document.getElementById('btn-projects-board-add-task')?.addEventListener('click', () => createTask(null));
            document.getElementById('btn-projects-board-add-column')?.addEventListener('click', () => openColumnForm());
            document.getElementById('btn-projects-board-save-column')?.addEventListener('click', createColumn);
            document.getElementById('btn-projects-board-cancel-column')?.addEventListener('click', () => { if (!columnEditor?.pending) resetColumnForm(); });
            document.getElementById('btn-projects-board-save-settings')?.addEventListener('click', saveSettings);
            document.getElementById('btn-projects-board-close-detail')?.addEventListener('click', () => { selectedTaskId = ''; renderDetail(); });
            elements.projectsBoardDetail?.addEventListener('click', (event) => {
                const copyBtn = event.target.closest?.('[data-copy-id]');
                if (copyBtn?.dataset?.copyId) {
                    const idToCopy = copyBtn.dataset.copyId;
                    try {
                        if (globalScope.navigator?.clipboard?.writeText) {
                            globalScope.navigator.clipboard.writeText(idToCopy).catch(() => { /* ignore clipboard denial */ });
                        }
                    } catch (_) {
                        /* ignore clipboard failure */
                    }
                    const feedback = copyBtn.querySelector('.crm-copy-feedback');
                    if (feedback) {
                        const prev = feedback.textContent;
                        feedback.textContent = 'Copied!';
                        copyBtn.classList.add('is-copied');
                        setTimeout(() => {
                            feedback.textContent = prev;
                            copyBtn.classList.remove('is-copied');
                        }, 1800);
                    }
                }
            });
            elements.projectsBoardScroll?.addEventListener('scroll', () => renderVirtualRows({ viewportOnly: true }), { passive: true });
            elements.projectsBoardScroll?.addEventListener('scroll', () => { closePeoplePicker(); closeStatusPicker(); }, { passive: true });
            elements.projectsBoardRows?.addEventListener('click', onBoardClick);
            elements.projectsBoardRows?.addEventListener('change', onBoardChange);
            elements.projectsBoardRows?.addEventListener('input', onBoardInput);
            elements.projectsBoardRows?.addEventListener('keydown', onBoardKeydown);
            elements.projectsBoardRows?.addEventListener('dragstart', onDragStart);
            elements.projectsBoardRows?.addEventListener('dragover', onDragOver);
            elements.projectsBoardRows?.addEventListener('dragleave', onDragLeave);
            elements.projectsBoardRows?.addEventListener('drop', onDrop);
            elements.projectsBoardRows?.addEventListener('dragend', clearDragInteraction);
            elements.projectsBoardHeader?.addEventListener('click', event => { const button = event.target.closest('[data-action="edit-column"]'); if (button) openColumnForm(button.dataset.columnId); });
            elements.projectsBoardHeader?.addEventListener('dragstart', onDragStart);
            elements.projectsBoardHeader?.addEventListener('dragover', onDragOver);
            elements.projectsBoardHeader?.addEventListener('drop', async (event) => { if (!dragState || dragState.kind !== 'column') return; event.preventDefault(); const target = event.target.closest('[data-column-id]'); if (!target) { clearDragInteraction(); return; } const index = columns.findIndex((entry) => String(entry.id) === String(target.dataset.columnId)); const source = dragState; clearDragInteraction(); await moveColumn(source.id, index); });
            elements.projectsBoardHeader?.addEventListener('dragend', clearDragInteraction);
            elements.projectsBoardHeader?.addEventListener('dragstart', (event) => { if (event.target.closest('button')) { event.preventDefault(); return; } const column = event.target.closest('[data-column-id]'); if (column && canSchema()) { clearDragInteraction(); dragState = { kind: 'column', id: column.dataset.columnId, handled: false }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', `column:${dragState.id}`); } });
            elements.projectsBoardSettingsName?.addEventListener('input', (event) => settingsDrafts.set(scopedKey(currentProjectId(), 'settings:name'), event.target.value));
            elements.projectsBoardSettingsDescription?.addEventListener('input', (event) => settingsDrafts.set(scopedKey(currentProjectId(), 'settings:description'), event.target.value));
            const statusControls = { not_started: elements.projectsBoardStatusNotStarted, in_progress: elements.projectsBoardStatusInProgress, blocked: elements.projectsBoardStatusBlocked, done: elements.projectsBoardStatusDone };
            Object.entries(statusControls).forEach(([key, control]) => control?.addEventListener('input', (event) => settingsDrafts.set(scopedKey(currentProjectId(), `settings:status:${key}`), event.target.value)));

            const groupBySelect = document.getElementById('projects-board-group-by');
            groupBySelect?.addEventListener('change', (event) => {
                currentGroupBy = event.target.value || 'section';
                renderBoard();
            });
            document.getElementById('projects-batch-status')?.addEventListener('change', (e) => {
                if (e.target.value) executeBatchStatus(e.target.value);
            });
            document.getElementById('projects-batch-section')?.addEventListener('change', (e) => {
                if (e.target.value) executeBatchSection(e.target.value);
            });
            document.getElementById('btn-projects-batch-delete')?.addEventListener('click', executeBatchDelete);
            elements.projectsBoardDetail?.addEventListener?.('click', (event) => {
                const tab = event.target.closest?.('[data-detail-tab]');
                if (tab) activateDetailTab(tab.dataset.detailTab);
            });
            elements.projectsBoardDetail?.addEventListener?.('keydown', (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !event.target.matches?.('[data-detail-tab]')) return;
                const tabs = Array.from(elements.projectsBoardDetail.querySelectorAll('[data-detail-tab]'));
                const index = tabs.indexOf(event.target);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                event.preventDefault();
                activateDetailTab(tabs[next].dataset.detailTab);
                tabs[next].focus();
            });
            document.getElementById('btn-projects-batch-clear')?.addEventListener('click', () => {
                setSelectedTaskIds([]);
            });
        }

        async function applyRemote(change) {
            if (!change.isCurrent() || !project || currentProjectId() !== change.authority.project.id) return false;
            const view = snapshotView();
            const authority = change.authority;
            const structureChanged = Number(authority.project.structureRevision || 0) !== structureRevision();
            const schemaChanged = Number(authority.project.schemaRevision || 0) !== boardRevision.schemaRevision;
            const lifecycleChanged = authority.project.lifecycle !== project.lifecycle;
            const membershipChanged = authority.project.membershipRevision !== project.membershipRevision || authority.membership.role !== role();
            if (Number(authority.project.revision || 0) >= projectRevision()) project = { ...project, ...authority.project };
            membership = { ...membership, ...authority.membership };
            if (membershipChanged) { authorityRevision++; if (!canSchema()) { resetSectionForm(); resetColumnForm(); } }
            const hasChanges = Boolean(change.changes && change.changes.length > 0);
            const selfEcho = Boolean(
                hasChanges
                    ? change.changes.every(item => item.operationId && recentlyExecutedOperations.has(item.operationId))
                    : (change.operationId && recentlyExecutedOperations.has(change.operationId))
            );
            const aggregateChange = Boolean(hasChanges && change.changes.some(item => item.aggregates));
            const selectedAggregateChange = Boolean(aggregateChange && selectedTaskId && asArray(change.hydration?.tasks).some(task => asArray(task.ancestorIds).includes(selectedTaskId)));
            if (!selfEcho && (change.refresh || structureChanged || schemaChanged || lifecycleChanged || membershipChanged || selectedAggregateChange || (hasChanges && Object.keys(sharedFilters).length))) {
                // Exceptional structural/schema/filtered reconciliation retains
                // loaded expansion, drafts and view. Ordinary fields stay below.
                const ok = await loadProject(currentProjectId(), { preserve: true, fenced: true });
                if (!ok || !change.isCurrent()) return false;
            } else {
                if (selfEcho) {
                    boardRevision.structureRevision = Math.max(structureRevision(), Number(authority?.project?.structureRevision || 0));
                    boardRevision.schemaRevision = Math.max(boardRevision.schemaRevision, Number(authority?.project?.schemaRevision || 0));
                }
                const removed = new Set(change.hydration?.unavailableTaskIds || []);
                for (const [taskId, task] of tasks) if (removed.has(taskId) || asArray(task.ancestorIds).some(id => removed.has(id))) tasks.delete(taskId);
                for (const task of asArray(change.hydration?.tasks)) {
                    if (aggregateChange) for (const ancestorId of asArray(task.ancestorIds)) { const ancestor = taskFor(ancestorId); if (ancestor) tasks.set(ancestorId, { ...ancestor, derived: null }); }
                    const old = taskFor(task.id);
                    // Field events may arrive for unloaded branches. Only place
                    // rows in branches the member has actually loaded.
                    if (!old && !loadedBranches.has(task.parentTaskId || '__root__')) continue;
                    if (!old || Number(task.revision || 0) >= Number(old.revision || 0)) tasks.set(task.id, { ...old, ...task });
                }
                if (!taskFor(selectedTaskId)) selectedTaskId = '';
                selectedTaskIds = selectedTaskIds.filter(id => tasks.has(id));
                if (hasChanges || membershipChanged || change.authorityChanged) { renderBoard(); restoreView(view); }
            }
            return true;
        }
        return { init, refresh, setProjects, loadProject, invalidateAccess, setSelectedTaskIds, getSnapshot: contextSnapshot,
            attachRemoteObserver(observer) { remoteObserver = observer; }, applyRemote,
            setDensity: (mode) => {
                ROW_HEIGHT = mode === 'compact' ? 36 : 44;
                elements.projectsBoardTableWrap?.classList.toggle('is-compact', mode === 'compact');
                renderBoard();
            },
            saveTaskField: (taskId, kind, control) => saveTaskField(taskId, kind, control),
            saveSection: (sectionId, control) => saveSection(sectionId, control),
            createSection: () => createSection(),
            createTask: (parentTaskId, explicitSectionId) => createTask(parentTaskId, explicitSectionId),
            moveSection: (sectionId, index) => moveSection(sectionId, index),
            moveTask: (taskId, destination) => moveTask(taskId, destination),
            setFilters: (filters) => { sharedFilters = { ...filters }; filterGeneration++; if (currentProjectId()) { authorityPending = true; setBusy(true); } return refresh(); },
            selectTask: (task) => { if (!task?.id || !hasProject()) return; tasks.set(String(task.id), task); asArray(task.pathIds).filter((id) => id !== task.id).forEach((id) => expanded.add(String(id))); selectedTaskId = String(task.id); renderDetail(); renderVirtualRows(); },
            getState: contextSnapshot };
    }

    globalScope.CrmProjectsBoard = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
